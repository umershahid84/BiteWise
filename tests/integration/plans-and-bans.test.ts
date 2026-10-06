// Restaurant plans (founding spots, paid plans, renewals) and bans/suspensions, against the local database.
import { describe, expect, it } from 'vitest';
import { ensureKioskToken, kioskByToken } from '@/lib/kiosk';
import * as moderation from '@/lib/moderation';
import * as orders from '@/lib/orders';
import * as subs from '@/lib/subscriptions';
import { admin, anon, PASSWORD, restaurantWithOffer, signUp, supabaseAvailable, visa } from '../support/db';

const available = await supabaseAvailable();
const card = (last4: string) => ({ brand: 'visa', last4, expMonth: 12, expYear: 2030 });

// A newly signed-up restaurant with one menu item (no plan yet). Approved unless said otherwise.
async function newRestaurant(approve = true) {
  const owner = await signUp('restaurant');
  const db = admin();
  const r = (await db.from('restaurants').select('*').eq('owner_id', owner.id).single()).data!;
  if (approve) await db.from('restaurants').update({ status: 'approved' }).eq('id', r.id);
  const item = (await owner.client.from('menu_items').insert({ restaurant_id: r.id, name: 'Test Bowl', price_cents: 1000 }).select('*').single()).data!;
  const post = () => owner.client.rpc('restaurant_save_offer', {
    p_offer_id: null as unknown as number, p_menu_item_id: item.id, p_reason: 'end_of_day', p_description: '',
    p_discount_pct: 50, p_quantity: 2, p_expires_in_minutes: 60,
  });
  return { owner, restaurant: r, item, post };
}
const subOf = async (rid: number) => (await admin().from('restaurant_subscriptions').select('*').eq('restaurant_id', rid).single()).data!;
const paymentsOf = async (rid: number) => (await admin().from('subscription_payments').select('*').eq('restaurant_id', rid).order('id')).data!;
const canLogIn = async (email: string) => !(await anon().auth.signInWithPassword({ email, password: PASSWORD })).error;

describe.skipIf(!available)('restaurant plans', () => {
  it('gives the first restaurants to choose a plan a free Pioneer membership, without a card, even before approval', async () => {
    const db = admin();
    const { count } = await db.from('restaurant_subscriptions').select('restaurant_id', { count: 'exact', head: true }).not('founding_number', 'is', null);
    const old = (await db.from('settings').select('value').eq('key', 'founding_spots').single()).data!.value;
    await db.from('settings').update({ value: (count ?? 0) + 1 }).eq('key', 'founding_spots');
    try {
      const first = await newRestaurant(false); // still waiting for approval
      const second = await newRestaurant(false);
      const res = await subs.choosePlan(first.restaurant.id, 'annual');
      expect(res.pioneer).toBeGreaterThan(0);
      const s1 = await subOf(first.restaurant.id);
      expect(s1).toMatchObject({ plan: 'annual', status: 'active', price_cents: 0, auto_renew: true, founding_number: res.pioneer });
      expect((Date.parse(s1.current_period_end!) - Date.parse(s1.current_period_start!)) / 86_400_000).toBeGreaterThanOrEqual(365);
      const [invoice] = await paymentsOf(first.restaurant.id);
      expect(invoice).toMatchObject({ amount_cents: 0, status: 'paid', list_price_cents: 15000, discount_cents: 15000, discount_label: 'Pioneer Members Discount' });
      expect(invoice.invoice_number).toMatch(/^BW-SUB-/);
      expect(await subs.cardsOf(first.owner.id)).toEqual([]); // no card was asked for
      await expect(subs.setAutoRenew(first.restaurant.id, false)).rejects.toThrow(/renew automatically, free/);

      // No spots left: the second restaurant has to pay, which it can only do once approved.
      expect(await subs.choosePlan(second.restaurant.id, 'monthly')).toEqual({ pioneer: null, canPay: false });
      await expect(subs.subscribe(second.restaurant.id, { plan: 'monthly', token: card('4242'), autoRenew: true })).rejects.toThrow(/once your restaurant is approved/);
      await moderation.setRestaurantStatus(second.restaurant.id, { status: 'approved' });
      expect(await subs.choosePlan(second.restaurant.id, 'monthly')).toEqual({ pioneer: null, canPay: true });

      // Approved, the Pioneer Member posts like everyone else; each period brings another $0.00 invoice.
      await moderation.setRestaurantStatus(first.restaurant.id, { status: 'approved' });
      expect((await first.post()).error).toBeNull();
      await subs.setRenewPlan(first.restaurant.id, 'monthly');
      await db.from('restaurant_subscriptions').update({ current_period_end: new Date(Date.now() - 60_000).toISOString() }).eq('restaurant_id', first.restaurant.id);
      await subs.renewDue();
      const renewed = await subOf(first.restaurant.id);
      expect(renewed).toMatchObject({ plan: 'monthly', status: 'active', price_cents: 0 });
      expect(Date.parse(renewed.current_period_end!)).toBeGreaterThan(Date.now() + 25 * 86_400_000);
      expect((await paymentsOf(first.restaurant.id)).map((x) => [x.plan, x.amount_cents, x.discount_cents])).toEqual([['annual', 0, 15000], ['monthly', 0, 1500]]);
      expect((await subs.planSummary(second.restaurant.id)).prices.foundingLeft).toBe(0);
    } finally {
      await db.from('settings').update({ value: old }).eq('key', 'founding_spots');
    }
  });

  it('starts a paid plan with a new card, which is saved on file, and refuses a declined card', async () => {
    const shop = await newRestaurant();
    await expect(subs.subscribe(shop.restaurant.id, { plan: 'monthly', token: card('0002'), autoRenew: true })).rejects.toThrow(/declined/);
    expect((await admin().from('restaurant_subscriptions').select('*').eq('restaurant_id', shop.restaurant.id).maybeSingle()).data).toBeNull();
    expect(await subs.cardsOf(shop.owner.id)).toEqual([]); // the declined card isn't kept

    const res = await subs.subscribe(shop.restaurant.id, { plan: 'annual', token: card('4242'), autoRenew: true });
    expect(res.invoiceNumber).toMatch(/^BW-SUB-\d{6}$/);
    const s = await subOf(shop.restaurant.id);
    expect(s).toMatchObject({ plan: 'annual', status: 'active', price_cents: 15000, auto_renew: true, card_label: 'VISA •••• 4242' });
    expect((Date.parse(s.current_period_end!) - Date.parse(s.current_period_start!)) / 86_400_000).toBeGreaterThanOrEqual(365);
    // The plan fee plus Washington sales tax at the restaurant's rate (10.35% in Seattle).
    expect((await paymentsOf(shop.restaurant.id)).map((p) => [p.status, p.list_price_cents, p.tax_rate_bps, p.tax_cents, p.amount_cents]))
      .toEqual([['failed', 1500, 1035, 155, 1655], ['paid', 15000, 1035, 1553, 16553]]);
    expect((await subs.cardsOf(shop.owner.id)).map((c) => [c.last4, c.is_default])).toEqual([['4242', true]]);
    expect((await shop.post()).error).toBeNull();
    await expect(subs.subscribe(shop.restaurant.id, { plan: 'monthly', token: card('4242'), autoRenew: true })).rejects.toThrow(/already have an active plan/);
  });

  it('keeps cards on file: auto-renewal charges the default card, and the last card of a renewing plan stays', async () => {
    const shop = await newRestaurant();
    const first = await subs.addCard(shop.restaurant.id, card('4242'), false);
    const second = await subs.addCard(shop.restaurant.id, card('5556'), false);
    expect((await subs.cardsOf(shop.owner.id)).find((c) => c.is_default)?.id).toBe(first.id); // the first card is the default
    await subs.subscribe(shop.restaurant.id, { plan: 'monthly', cardId: first.id, autoRenew: true });
    await subs.setDefaultCard(shop.restaurant.id, second.id);
    await admin().from('restaurant_subscriptions').update({ current_period_end: new Date(Date.now() - 60_000).toISOString() }).eq('restaurant_id', shop.restaurant.id);
    await subs.renewDue();
    expect((await subOf(shop.restaurant.id)).card_label).toBe('VISA •••• 5556');
    expect((await paymentsOf(shop.restaurant.id)).map((p) => p.card_label)).toEqual(['VISA •••• 4242', 'VISA •••• 5556']);

    await subs.removeCard(shop.restaurant.id, first.id);
    await expect(subs.removeCard(shop.restaurant.id, second.id)).rejects.toThrow(/Add another card first/);
    await subs.setAutoRenew(shop.restaurant.id, false);
    await subs.removeCard(shop.restaurant.id, second.id);
    await expect(subs.setAutoRenew(shop.restaurant.id, true)).rejects.toThrow(/Add a card on file/);
  });

  it('renews at the current price, switching plans at renewal, and lets a plan end when auto-renewal is off', async () => {
    const db = admin();
    const shop = await newRestaurant();
    await subs.subscribe(shop.restaurant.id, { plan: 'monthly', token: card('4242'), autoRenew: true });
    await subs.setRenewPlan(shop.restaurant.id, 'annual');
    const old = (await db.from('settings').select('value').eq('key', 'subscription_annual_cents').single()).data!.value;
    await db.from('settings').update({ value: 12000 }).eq('key', 'subscription_annual_cents'); // the admin changes the price
    const ended = new Date(Date.now() - 60_000).toISOString();
    await db.from('restaurant_subscriptions').update({ current_period_end: ended }).eq('restaurant_id', shop.restaurant.id);
    try {
      await subs.renewDue();
    } finally {
      await db.from('settings').update({ value: old }).eq('key', 'subscription_annual_cents');
    }
    const renewed = await subOf(shop.restaurant.id);
    expect(renewed).toMatchObject({ plan: 'annual', renew_plan: null, status: 'active', price_cents: 12000 });
    expect(Date.parse(renewed.current_period_start!)).toBe(Date.parse(ended)); // the new period starts where the old one ended
    expect((await paymentsOf(shop.restaurant.id)).filter((p) => p.status === 'paid').map((p) => [p.plan, p.amount_cents - p.tax_cents])).toEqual([['monthly', 1500], ['annual', 12000]]);

    // Auto-renewal off: nothing is charged and the plan lapses; live offers are paused.
    expect((await shop.post()).error).toBeNull();
    await subs.setAutoRenew(shop.restaurant.id, false);
    await db.from('restaurant_subscriptions').update({ current_period_end: new Date(Date.now() - 60_000).toISOString() }).eq('restaurant_id', shop.restaurant.id);
    await subs.renewDue();
    await db.rpc('sweep');
    expect((await subOf(shop.restaurant.id)).status).toBe('expired');
    expect(await paymentsOf(shop.restaurant.id)).toHaveLength(2);
    expect((await db.from('offers').select('status').eq('restaurant_id', shop.restaurant.id)).data!.map((o) => o.status)).toEqual(['paused']);
    expect((await shop.post()).error?.message).toMatch(/Choose a Bite Wise plan/);
  });

  it('makes the plan delinquent as soon as a payment is declined, until a payment succeeds', async () => {
    const db = admin();
    const shop = await newRestaurant();
    await subs.subscribe(shop.restaurant.id, { plan: 'monthly', token: card('4242'), autoRenew: true });
    expect((await shop.post()).error).toBeNull();
    // The bank declines the default card at renewal.
    await db.from('payment_methods').update({ provider_ref: 'pm_mock_test_0002' }).eq('user_id', shop.owner.id);
    await db.from('restaurant_subscriptions').update({ current_period_end: new Date(Date.now() - 60_000).toISOString() }).eq('restaurant_id', shop.restaurant.id);
    await subs.renewDue();

    const late = await subOf(shop.restaurant.id);
    expect(late.status).toBe('past_due');
    expect(late.last_payment_error).toMatch(/declined/);
    expect((await db.from('offers').select('status').eq('restaurant_id', shop.restaurant.id)).data!.map((o) => o.status)).toEqual(['paused']);
    expect((await shop.post()).error?.message).toMatch(/delinquent/);
    // It stays delinquent: the sweep never lets it lapse, and paying with the declined card fails again.
    await db.rpc('sweep');
    expect((await subOf(shop.restaurant.id)).status).toBe('past_due');
    await expect(subs.payNow(shop.restaurant.id)).rejects.toThrow(/declined/);
    expect((await shop.post()).error?.message).toMatch(/delinquent/);

    // Paying with a good card makes it active again straight away, with a new period from today.
    const good = await subs.addCard(shop.restaurant.id, card('4444'), true);
    const before = Date.now();
    await subs.payNow(shop.restaurant.id, good.id);
    const paid = await subOf(shop.restaurant.id);
    expect(paid).toMatchObject({ status: 'active', last_payment_error: '', card_label: 'VISA •••• 4444' });
    expect(Date.parse(paid.current_period_start!)).toBeGreaterThanOrEqual(before - 1000);
    expect((await shop.post()).error).toBeNull();
    await expect(subs.payNow(shop.restaurant.id)).rejects.toThrow(/nothing to pay/);
  });

  it('lets owners read only their own plan', async () => {
    const mine = await restaurantWithOffer();
    const other = await restaurantWithOffer();
    const rows = (await mine.owner.client.from('restaurant_subscriptions').select('restaurant_id')).data!;
    expect(rows.map((r) => r.restaurant_id)).toEqual([mine.restaurant.id]);
    expect((await mine.owner.client.from('restaurant_subscriptions').update({ plan: 'founding' }).eq('restaurant_id', other.restaurant.id).select()).data ?? []).toEqual([]);
    const customer = await signUp('customer');
    expect((await customer.client.from('subscription_payments').select('id')).data).toEqual([]);
  });
});

describe.skipIf(!available)('suspensions and bans', () => {
  it('bans a customer for good: no login, open orders cancelled', async () => {
    const shop = await restaurantWithOffer();
    const c = await signUp('customer');
    const { orderId } = await orders.checkout(c.id, { offerId: shop.offer.id, quantity: 1, creditCents: 0, newCard: visa });
    expect(await canLogIn(c.email)).toBe(true);
    const res = await moderation.setUserStatus(c.id, { status: 'banned', note: 'Fraud' });
    expect(res.details).toMatch(/1 open order cancelled/);
    expect((await orders.getOrder(orderId)).status).toBe('cancelled');
    expect((await admin().from('profiles').select('status').eq('id', c.id).single()).data!.status).toBe('banned');
    expect(await canLogIn(c.email)).toBe(false);
    // Lifting the ban lets them back in.
    expect((await moderation.setUserStatus(c.id, { status: 'active' })).action).toBe('user.unban');
    expect(await canLogIn(c.email)).toBe(true);
  });

  it('suspends a restaurant for a number of days, then reinstates it by itself', async () => {
    const shop = await restaurantWithOffer();
    await expect(moderation.setRestaurantStatus(shop.restaurant.id, { status: 'suspended' })).rejects.toThrow(/how many days/);
    await moderation.setRestaurantStatus(shop.restaurant.id, { status: 'suspended', days: 5, note: 'Complaints' });
    const r = (await admin().from('restaurants').select('status, suspended_until').eq('id', shop.restaurant.id).single()).data!;
    expect(r.status).toBe('suspended');
    expect(Math.round((Date.parse(r.suspended_until!) - Date.now()) / 86_400_000)).toBe(5);
    const posted = await shop.owner.client.rpc('restaurant_save_offer', {
      p_offer_id: null as unknown as number, p_menu_item_id: shop.item.id, p_reason: 'end_of_day', p_description: '', p_discount_pct: 50, p_quantity: 1, p_expires_in_minutes: 60,
    });
    expect(posted.error?.message).toMatch(/suspended until/);
    expect(await canLogIn(shop.owner.email)).toBe(true); // the owner can still log in to hand over existing orders

    await admin().from('restaurants').update({ suspended_until: new Date(Date.now() - 1000).toISOString() }).eq('id', shop.restaurant.id);
    await admin().rpc('sweep');
    expect((await admin().from('restaurants').select('status, suspended_until').eq('id', shop.restaurant.id).single()).data).toEqual({ status: 'approved', suspended_until: null });
  });

  it('bans a restaurant: offers end, orders are cancelled, the kiosk and the owner login stop working', async () => {
    const shop = await restaurantWithOffer();
    const token = await ensureKioskToken(shop.restaurant.id);
    const c = await signUp('customer');
    const { orderId } = await orders.checkout(c.id, { offerId: shop.offer.id, quantity: 1, creditCents: 0, newCard: visa });
    await moderation.setRestaurantStatus(shop.restaurant.id, { status: 'banned', note: 'Unsafe food' });
    expect((await orders.getOrder(orderId)).status).toBe('cancelled');
    expect((await admin().from('offers').select('status').eq('id', shop.offer.id).single()).data!.status).toBe('ended');
    expect(await kioskByToken(token)).toBeNull();
    expect(await canLogIn(shop.owner.email)).toBe(false);
    expect((await anon().from('restaurants').select('id').eq('id', shop.restaurant.id)).data).toEqual([]);

    await moderation.setRestaurantStatus(shop.restaurant.id, { status: 'approved' });
    expect(await canLogIn(shop.owner.email)).toBe(true);
  });

  it("bans a restaurant owner's account together with the restaurant", async () => {
    const shop = await restaurantWithOffer();
    const res = await moderation.setUserStatus(shop.owner.id, { status: 'banned' });
    expect(res.details).toMatch(/restaurant removed/);
    expect((await admin().from('restaurants').select('status').eq('id', shop.restaurant.id).single()).data!.status).toBe('banned');
    await moderation.setUserStatus(shop.owner.id, { status: 'active' });
    expect((await admin().from('restaurants').select('status').eq('id', shop.restaurant.id).single()).data!.status).toBe('approved');
  });

  it('deletes a restaurant with no history completely, and keeps the records of one with sales', async () => {
    const db = admin();
    const fresh = await restaurantWithOffer();
    expect((await moderation.deleteRestaurant(fresh.restaurant.id)).anonymized).toBe(false);
    expect((await db.from('restaurants').select('id').eq('id', fresh.restaurant.id)).data).toEqual([]);
    expect(await canLogIn(fresh.owner.email)).toBe(false);

    const busy = await restaurantWithOffer();
    const token = await ensureKioskToken(busy.restaurant.id);
    const c = await signUp('customer');
    const { orderId } = await orders.checkout(c.id, { offerId: busy.offer.id, quantity: 1, creditCents: 0, newCard: visa });
    const res = await moderation.deleteRestaurant(busy.restaurant.id);
    expect(res.anonymized).toBe(true);
    expect(res.details).toMatch(/1 restaurant order cancelled/);
    expect((await orders.getOrder(orderId)).status).toBe('cancelled');
    expect((await db.from('restaurants').select('status').eq('id', busy.restaurant.id).single()).data!.status).toBe('deleted');
    expect((await db.from('offers').select('status').eq('id', busy.offer.id).single()).data!.status).toBe('ended');
    expect(await kioskByToken(token)).toBeNull();
    expect((await db.from('profiles').select('status, email').eq('id', busy.owner.id).single()).data).toMatchObject({ status: 'deleted' });
    expect(await canLogIn(busy.owner.email)).toBe(false);
    await expect(moderation.deleteRestaurant(busy.restaurant.id)).rejects.toThrow(/Not found/);
  });

  it("cancels a customer's open orders when the account is deleted", async () => {
    const shop = await restaurantWithOffer();
    const c = await signUp('customer');
    const { orderId } = await orders.checkout(c.id, { offerId: shop.offer.id, quantity: 1, creditCents: 0, newCard: visa });
    const res = await moderation.deleteAccount(c.id);
    expect(res).toMatchObject({ anonymized: true });
    expect(res.details).toMatch(/1 open order cancelled/);
    const o = await orders.getOrder(orderId);
    expect(o).toMatchObject({ status: 'cancelled', customer_username: 'Deleted user' });
  });
});
