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
  it('gives the free Founding Partner spots to the first restaurants approved, until they run out', async () => {
    const db = admin();
    const { count } = await db.from('restaurant_subscriptions').select('restaurant_id', { count: 'exact', head: true }).not('founding_number', 'is', null);
    const old = (await db.from('settings').select('value').eq('key', 'founding_spots').single()).data!.value;
    await db.from('settings').update({ value: (count ?? 0) + 1 }).eq('key', 'founding_spots');
    try {
      const first = await newRestaurant(false);
      const second = await newRestaurant(false);
      await moderation.setRestaurantStatus(first.restaurant.id, { status: 'approved' });
      await moderation.setRestaurantStatus(second.restaurant.id, { status: 'approved' });
      const s1 = await subOf(first.restaurant.id);
      expect(s1).toMatchObject({ plan: 'founding', status: 'active', price_cents: 0 });
      expect(s1.founding_number).toBeGreaterThan(0);
      expect((await admin().from('restaurant_subscriptions').select('*').eq('restaurant_id', second.restaurant.id).maybeSingle()).data).toBeNull();
      expect((await first.post()).error).toBeNull();
      expect((await second.post()).error?.message).toMatch(/Choose a Bite Wise plan/);
      // Approving again (e.g. after a suspension) keeps the same spot.
      await moderation.setRestaurantStatus(first.restaurant.id, { status: 'approved' });
      expect((await subOf(first.restaurant.id)).founding_number).toBe(s1.founding_number);
      expect((await subs.planSummary(second.restaurant.id)).prices.foundingLeft).toBe(0);
    } finally {
      await db.from('settings').update({ value: old }).eq('key', 'founding_spots');
    }
  });

  it('starts a paid plan by charging the card, and refuses a declined card', async () => {
    const shop = await newRestaurant();
    await expect(subs.subscribe(shop.restaurant.id, { plan: 'monthly', token: card('0002'), autoRenew: true })).rejects.toThrow(/declined/);
    expect((await admin().from('restaurant_subscriptions').select('*').eq('restaurant_id', shop.restaurant.id).maybeSingle()).data).toBeNull();

    const res = await subs.subscribe(shop.restaurant.id, { plan: 'annual', token: card('4242'), autoRenew: true });
    expect(res.invoiceNumber).toMatch(/^BW-SUB-\d{6}$/);
    const s = await subOf(shop.restaurant.id);
    expect(s).toMatchObject({ plan: 'annual', status: 'active', price_cents: 15000, auto_renew: true, card_label: 'VISA •••• 4242' });
    const days = (Date.parse(s.current_period_end!) - Date.parse(s.current_period_start!)) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(365);
    expect((await paymentsOf(shop.restaurant.id)).map((p) => [p.status, p.amount_cents])).toEqual([['failed', 1500], ['paid', 15000]]);
    expect((await shop.post()).error).toBeNull();
    await expect(subs.subscribe(shop.restaurant.id, { plan: 'monthly', token: card('4242'), autoRenew: true })).rejects.toThrow(/already have an active plan/);
  });

  it('renews automatically, switching plans at renewal, and lets a plan end when auto-renewal is off', async () => {
    const shop = await newRestaurant();
    await subs.subscribe(shop.restaurant.id, { plan: 'monthly', token: card('4242'), autoRenew: true });
    await subs.setRenewPlan(shop.restaurant.id, 'annual');
    const ended = new Date(Date.now() - 60_000).toISOString();
    await admin().from('restaurant_subscriptions').update({ current_period_end: ended }).eq('restaurant_id', shop.restaurant.id);
    await subs.renewDue();
    const renewed = await subOf(shop.restaurant.id);
    expect(renewed).toMatchObject({ plan: 'annual', renew_plan: null, status: 'active', price_cents: 15000 });
    expect(Date.parse(renewed.current_period_start!)).toBe(Date.parse(ended)); // the new period starts where the old one ended
    expect((await paymentsOf(shop.restaurant.id)).filter((p) => p.status === 'paid').map((p) => p.plan)).toEqual(['monthly', 'annual']);

    // Auto-renewal off: nothing is charged and the plan lapses; live offers are paused.
    expect((await shop.post()).error).toBeNull();
    await subs.setAutoRenew(shop.restaurant.id, false);
    await admin().from('restaurant_subscriptions').update({ current_period_end: new Date(Date.now() - 60_000).toISOString() }).eq('restaurant_id', shop.restaurant.id);
    await subs.renewDue();
    await admin().rpc('sweep');
    expect((await subOf(shop.restaurant.id)).status).toBe('expired');
    expect((await paymentsOf(shop.restaurant.id))).toHaveLength(2);
    const live = (await admin().from('offers').select('status').eq('restaurant_id', shop.restaurant.id)).data!;
    expect(live.map((o) => o.status)).toEqual(['paused']);
    expect((await shop.post()).error?.message).toMatch(/Choose a Bite Wise plan/);
  });

  it('keeps the plan for a grace period when a renewal fails, and charges the new card', async () => {
    const shop = await newRestaurant();
    await subs.subscribe(shop.restaurant.id, { plan: 'monthly', token: card('4242'), autoRenew: true });
    await admin().from('restaurant_subscriptions').update({ card_ref: 'pm_mock_test_0002', current_period_end: new Date(Date.now() - 60_000).toISOString() })
      .eq('restaurant_id', shop.restaurant.id);
    await subs.renewDue();
    const failed = await subOf(shop.restaurant.id);
    expect(failed.status).toBe('past_due');
    expect(failed.last_payment_error).toMatch(/declined/);
    expect((await shop.post()).error).toBeNull(); // still inside the 7-day grace period

    await subs.updateCard(shop.restaurant.id, card('4444'));
    const fixed = await subOf(shop.restaurant.id);
    expect(fixed).toMatchObject({ status: 'active', last_payment_error: '', card_label: 'VISA •••• 4444' });
    expect(Date.parse(fixed.current_period_end!)).toBeGreaterThan(Date.now() + 20 * 86_400_000);
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
});
