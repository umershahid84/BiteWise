// Order lifecycle and money movement (mock payment processor), against the local database.
import { describe, expect, it } from 'vitest';
import * as orders from '@/lib/orders';
import { admin, restaurantWithOffer, signUp, supabaseAvailable, visa } from '../support/db';

const available = await supabaseAvailable();
const db = () => admin();

async function giveCredit(userId: string, cents: number) {
  await db().from('credit_ledger').insert({ user_id: userId, amount_cents: cents, kind: 'goodwill', note: 'test' });
}
const balance = async (userId: string) => ((await db().from('credit_ledger').select('amount_cents').eq('user_id', userId)).data ?? []).reduce((n, r) => n + r.amount_cents, 0);
const pinOf = async (orderId: number) => (await db().from('order_pins').select('pin').eq('order_id', orderId).single()).data!.pin;
const offerLeft = async (offerId: number) => (await db().from('offers').select('quantity_available').eq('id', offerId).single()).data!.quantity_available;

async function pickUp(shop: Awaited<ReturnType<typeof restaurantWithOffer>>, orderId: number) {
  const claimed = await shop.owner.client.rpc('restaurant_begin_pickup', { p_pin: await pinOf(orderId), p_order_id: orderId });
  if (claimed.error) throw new Error(claimed.error.message);
  return orders.completePickup(claimed.data as { id: number; paymentRef: string | null; destinationAccount: string | null });
}

describe.skipIf(!available)('checkout', () => {
  it('reserves food, puts a hold on the card and gives the customer a PIN', async () => {
    const shop = await restaurantWithOffer({ quantity: 3 });
    const c = await signUp('customer');
    const res = await orders.checkout(c.id, { offerId: shop.offer.id, quantity: 2, creditCents: 0, newCard: visa });
    const o = await orders.getOrder(res.orderId);
    expect(o.status).toBe('reserved');
    expect(o.payment_ref).toMatch(/^pi_mock_/);
    expect(o.destination_account).toMatch(/^acct_mock_/); // destination charge to the restaurant's Connect account
    expect(o.total_cents).toBe(500 * 2 + 50 + 104); // $10 at 50% off x2 + 5% fee + 10.35% tax
    expect(await pinOf(o.id)).toMatch(/^\d{4}$/);
    expect(await offerLeft(shop.offer.id)).toBe(1);
  });

  it("never sells more than the restaurant's quantity, even at the same moment", async () => {
    const shop = await restaurantWithOffer({ quantity: 1 });
    const [a, b] = [await signUp('customer'), await signUp('customer')];
    const results = await Promise.allSettled([
      orders.checkout(a.id, { offerId: shop.offer.id, quantity: 1, creditCents: 0, newCard: visa }),
      orders.checkout(b.id, { offerId: shop.offer.id, quantity: 1, creditCents: 0, newCard: visa }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason.message).toMatch(/Sold out|no longer available/);
    await expect(orders.checkout(a.id, { offerId: shop.offer.id, quantity: 1, creditCents: 0, newCard: visa })).rejects.toThrow();
  });

  it('refuses more than what is available', async () => {
    const shop = await restaurantWithOffer({ quantity: 2 });
    const c = await signUp('customer');
    await expect(orders.checkout(c.id, { offerId: shop.offer.id, quantity: 3, creditCents: 0, newCard: visa }))
      .rejects.toThrow("Only 2 available. The restaurant set that limit, so you can't order more.");
  });

  it('releases the food when the card is declined', async () => {
    const shop = await restaurantWithOffer({ quantity: 1 });
    const c = await signUp('customer');
    const declined = { token: { brand: 'visa', last4: '0002', expMonth: 12, expYear: 2030 }, save: false };
    await expect(orders.checkout(c.id, { offerId: shop.offer.id, quantity: 1, creditCents: 0, newCard: declined })).rejects.toThrow('declined');
    expect(await offerLeft(shop.offer.id)).toBe(1);
  });

  it('applies platform credit, with at least $0.50 left for the card', async () => {
    const shop = await restaurantWithOffer({ quantity: 5 });
    const c = await signUp('customer');
    await giveCredit(c.id, 2000);
    const total = 500 + 25 + 52;
    await expect(orders.checkout(c.id, { offerId: shop.offer.id, quantity: 1, creditCents: total - 20, newCard: visa })).rejects.toThrow('at least $0.50');
    // Credit covering everything needs no card at all.
    const res = await orders.checkout(c.id, { offerId: shop.offer.id, quantity: 1, creditCents: total, cardId: null, newCard: null });
    const o = await orders.getOrder(res.orderId);
    expect(o).toMatchObject({ status: 'reserved', payment_ref: null, credit_applied_cents: total, card_label: 'Platform credit' });
    expect(await balance(c.id)).toBe(2000 - total);
    await expect(orders.checkout(c.id, { offerId: shop.offer.id, quantity: 3, creditCents: 5000, newCard: visa })).rejects.toThrow();
  });

  it('gives back credit and food when a customer cancels, but charges the non-refundable service fee to the card', async () => {
    const shop = await restaurantWithOffer({ quantity: 2 });
    const c = await signUp('customer');
    await giveCredit(c.id, 300);
    const { orderId } = await orders.checkout(c.id, { offerId: shop.offer.id, quantity: 2, creditCents: 300, newCard: visa });
    expect(await offerLeft(shop.offer.id)).toBe(0);
    const res = await c.client.rpc('my_cancel_order', { p_order_id: orderId });
    expect(res.error).toBeNull();
    expect((res.data as { keptCents: number }).keptCents).toBe(50);
    await orders.voidIfNeeded(orderId);
    const o = await orders.getOrder(orderId);
    expect(o).toMatchObject({ status: 'cancelled', needs_void: false, needs_fee_charge: false, kept_fee_cents: 50, kept_tax_cents: 0, kept_card_cents: 50 });
    expect(o.fee_charge_ref).toBeTruthy();
    expect(await offerLeft(shop.offer.id)).toBe(2);
    expect(await balance(c.id)).toBe(300);
  });

  it('takes the service fee from platform credit when credit paid the whole order', async () => {
    const shop = await restaurantWithOffer();
    const c = await signUp('customer');
    await giveCredit(c.id, 2000);
    const total = (await orders.quoteOffer(shop.offer.id, 1)).totalCents;
    const { orderId } = await orders.checkout(c.id, { offerId: shop.offer.id, quantity: 1, creditCents: total, cardId: null, newCard: null });
    expect((await c.client.rpc('my_cancel_order', { p_order_id: orderId })).error).toBeNull();
    await orders.voidIfNeeded(orderId);
    expect(await orders.getOrder(orderId)).toMatchObject({ status: 'cancelled', kept_fee_cents: 25, kept_card_cents: 0, needs_fee_charge: false });
    expect(await balance(c.id)).toBe(2000 - 25);
  });

  it('releases the whole hold, fee included, when Bite Wise cancels', async () => {
    const shop = await restaurantWithOffer();
    const c = await signUp('customer');
    const { orderId } = await orders.checkout(c.id, { offerId: shop.offer.id, quantity: 1, creditCents: 0, newCard: visa });
    expect(await orders.release(orderId, 'reserved', 'cancelled', true)).toBe(true);
    expect(await orders.getOrder(orderId)).toMatchObject({ status: 'cancelled', kept_fee_cents: 0, needs_void: false, needs_fee_charge: false, fee_charge_ref: null });
  });
});

describe.skipIf(!available)('pickup and payouts', () => {
  it('charges at pickup and pays the restaurant its food subtotal through Stripe Connect', async () => {
    const shop = await restaurantWithOffer();
    const c = await signUp('customer');
    const { orderId } = await orders.checkout(c.id, { offerId: shop.offer.id, quantity: 1, creditCents: 0, newCard: visa });
    const done = await pickUp(shop, orderId);
    expect(done.status).toBe('picked_up');
    const payouts = (await db().from('payouts').select('*').eq('order_id', orderId)).data!;
    expect(payouts).toHaveLength(1);
    expect(payouts[0]).toMatchObject({ kind: 'transfer', amount_cents: 500 });
    expect(payouts[0].invoice_number).toMatch(/^INV-\d{8}-\d{6}$/);
    expect(payouts[0].transaction_id).toMatch(/^tr_mock_/);
    const bal = (await db().from('restaurant_balances').select('*').eq('restaurant_id', shop.restaurant.id).single()).data!;
    expect(bal).toMatchObject({ earned_cents: 500, paid_cents: 500, balance_cents: 0 });
    // The PIN can't be used twice.
    const again = await shop.owner.client.rpc('restaurant_find_pickup', { p_pin: await pinOf(orderId) });
    expect(again.data).toBeNull();
  });

  it('tops up the restaurant when platform credit paid part of the food', async () => {
    const shop = await restaurantWithOffer({ price: 2000 });
    const c = await signUp('customer');
    await giveCredit(c.id, 900);
    const { orderId } = await orders.checkout(c.id, { offerId: shop.offer.id, quantity: 1, creditCents: 900, newCard: visa });
    await pickUp(shop, orderId);
    const payouts = (await db().from('payouts').select('amount_cents, note').eq('order_id', orderId).order('id')).data!;
    expect(payouts.reduce((n, p) => n + p.amount_cents, 0)).toBe(1000); // full food subtotal
    expect(payouts.some((p) => p.note.includes('top-up'))).toBe(true);
  });

  it('holds the money for restaurants that have not connected Stripe', async () => {
    const shop = await restaurantWithOffer({ connected: false });
    const c = await signUp('customer');
    const { orderId } = await orders.checkout(c.id, { offerId: shop.offer.id, quantity: 1, creditCents: 0, newCard: visa });
    expect((await orders.getOrder(orderId)).destination_account).toBeNull();
    await pickUp(shop, orderId);
    const bal = (await db().from('restaurant_balances').select('*').eq('restaurant_id', shop.restaurant.id).single()).data!;
    expect(bal).toMatchObject({ earned_cents: 500, paid_cents: 0, balance_cents: 500 });
  });

  it('rate-limits wrong PINs', async () => {
    const shop = await restaurantWithOffer();
    const tries = [];
    for (let i = 0; i < 15; i++) tries.push(await shop.owner.client.rpc('restaurant_find_pickup', { p_pin: '0000' }));
    expect(tries.every((t) => t.data === null)).toBe(true);
    const locked = await shop.owner.client.rpc('restaurant_find_pickup', { p_pin: '0000' });
    expect(locked.error?.message).toMatch(/Too many incorrect PINs/);
  });
});

describe.skipIf(!available)('refunds', () => {
  async function completedOrder() {
    const shop = await restaurantWithOffer();
    const c = await signUp('customer');
    const { orderId } = await orders.checkout(c.id, { offerId: shop.offer.id, quantity: 1, creditCents: 0, newCard: visa });
    await pickUp(shop, orderId);
    const adminUser = await signUp('customer');
    return { shop, c, orderId, adminId: adminUser.id };
  }

  it('refunds to the card and takes the restaurant share back from its transfer', async () => {
    const { shop, orderId, adminId } = await completedOrder();
    const o = await orders.getOrder(orderId);
    expect(orders.refundableCents(o)).toBe(o.total_cents - o.service_fee_cents); // the service fee is never refunded
    const half = Math.round(orders.refundableCents(o) / 2);
    const res = await orders.refundOrder(orderId, { amountCents: half, method: 'original', reason: 'cold food', adminId });
    expect(res.cardCents).toBe(half);
    const reversal = (await db().from('payouts').select('*').eq('order_id', orderId).eq('kind', 'reversal')).data!;
    expect(reversal[0].amount_cents).toBe(-250);
    const bal = (await db().from('restaurant_balances').select('*').eq('restaurant_id', shop.restaurant.id).single()).data!;
    expect(bal).toMatchObject({ earned_cents: 250, paid_cents: 250, balance_cents: 0 });
  });

  it('refunds as platform credit without touching the restaurant', async () => {
    const { shop, c, orderId, adminId } = await completedOrder();
    const o = await orders.getOrder(orderId);
    await expect(orders.refundOrder(orderId, { amountCents: o.total_cents, method: 'credit', reason: 'sorry', adminId })).rejects.toThrow('service fee is not refundable');
    await orders.refundOrder(orderId, { amountCents: o.total_cents - o.service_fee_cents, method: 'credit', reason: 'sorry', adminId });
    expect(await balance(c.id)).toBe(o.total_cents - o.service_fee_cents);
    const bal = (await db().from('restaurant_balances').select('*').eq('restaurant_id', shop.restaurant.id).single()).data!;
    expect(bal).toMatchObject({ earned_cents: 500, paid_cents: 500 });
    await expect(orders.refundOrder(orderId, { amountCents: 1, method: 'credit', reason: 'again', adminId })).rejects.toThrow('fully refunded');
  });
});

describe.skipIf(!available)('cleanup sweep', () => {
  it('releases missed pickups, keeping only the service fee, and ends expired offers', async () => {
    const shop = await restaurantWithOffer({ quantity: 2 });
    const c = await signUp('customer');
    await giveCredit(c.id, 200);
    const { orderId } = await orders.checkout(c.id, { offerId: shop.offer.id, quantity: 1, creditCents: 200, newCard: visa });
    const past = new Date(Date.now() - 20 * 60000).toISOString();
    await db().from('offers').update({ pickup_start: new Date(Date.now() - 3600000).toISOString(), pickup_end: past }).eq('id', shop.offer.id);
    await db().from('orders').update({ pickup_end: past }).eq('id', orderId);
    await orders.sweep();
    expect(await orders.getOrder(orderId)).toMatchObject({ status: 'expired', needs_void: false, needs_fee_charge: false, kept_fee_cents: 25, kept_card_cents: 25 });
    expect(await balance(c.id)).toBe(200);
    expect((await db().from('offers').select('status').eq('id', shop.offer.id).single()).data!.status).toBe('ended');
  });
});
