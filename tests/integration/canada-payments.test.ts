// Canada: orders at Canadian restaurants are in Canadian dollars, through the Canadian payment account, with cards saved
// for Canada; customers' ZIP or postal codes place them on the deals map.
import { describe, expect, it } from 'vitest';
import { saveHomeArea } from '@/lib/home-area';
import * as orders from '@/lib/orders';
import { admin, CANADIAN_CUSTOMER, restaurantWithOffer, signUp, supabaseAvailable, visa } from '../support/db';

const available = await supabaseAvailable();
const db = () => admin();
const pinOf = async (orderId: number) => (await db().from('order_pins').select('pin').eq('order_id', orderId).single()).data!.pin;

describe.skipIf(!available)('Canadian dollars', () => {
  it('charges an order at a Canadian restaurant in Canadian dollars and saves the card for Canada', async () => {
    const shop = await restaurantWithOffer({ canada: true });
    const c = await signUp('customer', CANADIAN_CUSTOMER);
    const res = await orders.checkout(c.id, { offerId: shop.offer.id, quantity: 1, creditCents: 0, newCard: { ...visa, save: true } });
    const o = await orders.getOrder(res.orderId);
    expect(o.currency).toBe('cad');
    const cards = (await db().from('payment_methods').select('country, is_default').eq('user_id', c.id)).data!;
    expect(cards).toEqual([{ country: 'CA', is_default: true }]);

    // Picked up: captured, and the restaurant's share is recorded in Canadian dollars.
    const claimed = await shop.owner.client.rpc('restaurant_begin_pickup', { p_pin: await pinOf(o.id), p_order_id: o.id });
    expect(claimed.error).toBeNull();
    await orders.completePickup(claimed.data as { id: number; paymentRef: string | null; destinationAccount: string | null });
    expect((await orders.getOrder(o.id)).status).toBe('picked_up');
  });

  it("doesn't use a card saved for the US at a Canadian restaurant", async () => {
    const us = await restaurantWithOffer();
    const ca = await restaurantWithOffer({ canada: true });
    const c = await signUp('customer');
    await orders.checkout(c.id, { offerId: us.offer.id, quantity: 1, creditCents: 0, newCard: { ...visa, save: true } });
    const card = (await db().from('payment_methods').select('id, country').eq('user_id', c.id).single()).data!;
    expect(card.country).toBe('US');
    expect((await orders.getOrder((await db().from('orders').select('id').eq('user_id', c.id).single()).data!.id)).currency).toBe('usd');
    await expect(orders.checkout(c.id, { offerId: ca.offer.id, quantity: 1, creditCents: 0, cardId: card.id })).rejects.toThrow();
  });

  it('only lets credit pay at restaurants in the customer\'s own country', async () => {
    const ca = await restaurantWithOffer({ canada: true });
    const c = await signUp('customer'); // a US customer: their credit is in US dollars
    await db().from('credit_ledger').insert({ user_id: c.id, amount_cents: 5000, kind: 'goodwill', note: 'test' });
    await expect(orders.checkout(c.id, { offerId: ca.offer.id, quantity: 1, creditCents: 500, newCard: visa })).rejects.toThrow(/credit/i);
  });

  it('shows Canadian offers with their country, found by postal code', async () => {
    const ca = await restaurantWithOffer({ canada: true });
    const c = await signUp('customer', CANADIAN_CUSTOMER);
    const { data, error } = await c.client.rpc('search_offers', { p_area_text: 'm5v3l9' });
    expect(error).toBeNull();
    const row = data!.find((o) => o.id === ca.offer.id);
    expect(row?.country).toBe('CA');
  });
});

describe.skipIf(!available)('home ZIP and postal codes', () => {
  it('saves a customer\'s ZIP code with its map position', async () => {
    const c = await signUp('customer');
    const saved = await saveHomeArea(c.id, 'US', '98101');
    expect(saved).toEqual({ postalCode: '98101', located: true });
    const p = (await db().from('profiles').select('postal_code, home_lat, home_lng').eq('id', c.id).single()).data!;
    expect(p.postal_code).toBe('98101');
    expect(p.home_lat).toBeCloseTo(47.6, 0);
    expect(p.home_lng).toBeCloseTo(-122.3, 0);
  });

  it('normalizes a Canadian postal code and refuses one that is malformed', async () => {
    const c = await signUp('customer', CANADIAN_CUSTOMER);
    const saved = await saveHomeArea(c.id, 'CA', 'm5v3l9');
    expect(saved.postalCode).toBe('M5V 3L9');
    await expect(saveHomeArea(c.id, 'CA', '98101')).rejects.toThrow(/postal code/);
    await expect(saveHomeArea(c.id, 'US', 'M5V 3L9')).rejects.toThrow(/ZIP code/);
  });
});

describe.skipIf(!available)('admin locations', () => {
  it("shows each location only its own country's restaurants, customers and orders", async () => {
    const { restaurants, users, orders: adminOrders } = await import('@/lib/admin');
    const us = await restaurantWithOffer();
    const ca = await restaurantWithOffer({ canada: true });
    const caCustomer = await signUp('customer', CANADIAN_CUSTOMER);
    const caOrder = await orders.checkout(caCustomer.id, { offerId: ca.offer.id, quantity: 1, creditCents: 0, newCard: visa });
    const at = (country: string) => new URLSearchParams({ country });

    const usShops = (await restaurants(at('US'))).map((r) => r.id);
    const caShops = (await restaurants(at('CA'))).map((r) => r.id);
    expect(usShops).toContain(us.restaurant.id);
    expect(usShops).not.toContain(ca.restaurant.id);
    expect(caShops).toContain(ca.restaurant.id);
    expect(caShops).not.toContain(us.restaurant.id);

    expect((await users(at('US'))).map((u) => u.id)).not.toContain(caCustomer.id);
    expect((await users(at('CA'))).map((u) => u.id)).toContain(caCustomer.id);
    expect((await adminOrders(at('US'))).orders.map((o) => o.id)).not.toContain(caOrder.orderId);
    expect((await adminOrders(at('CA'))).orders.map((o) => o.id)).toContain(caOrder.orderId);
  });
});

describe.skipIf(!available)('tax on the service fee', () => {
  it("taxes the service fee at ResDish's location: Washington in the US, Newfoundland and Labrador HST in Canada", async () => {
    const us = await restaurantWithOffer({ price: 2000, discount: 50 });
    const ca = await restaurantWithOffer({ price: 2000, discount: 50, canada: true });
    await db().from('restaurants').update({ tax_rate_bps: 800 }).in('id', [us.restaurant.id, ca.restaurant.id]);
    const usCustomer = await signUp('customer');
    const caCustomer = await signUp('customer', CANADIAN_CUSTOMER);
    const o1 = await orders.getOrder((await orders.checkout(usCustomer.id, { offerId: us.offer.id, quantity: 1, creditCents: 0, newCard: visa })).orderId);
    const o2 = await orders.getOrder((await orders.checkout(caCustomer.id, { offerId: ca.offer.id, quantity: 1, creditCents: 0, newCard: visa })).orderId);
    // $10.00 food at 8% = 80; 5% fee = 50, taxed at 10.35% (WA) = 5, or 15% (NL HST) = 8.
    expect([o1.subtotal_cents, o1.service_fee_cents, o1.tax_cents, o1.total_cents]).toEqual([1000, 50, 80 + 5, 1135]);
    expect([o2.subtotal_cents, o2.service_fee_cents, o2.tax_cents, o2.total_cents]).toEqual([1000, 50, 80 + 8, 1138]);
    // The fee and its tax are ResDish's: the restaurant's share is the food and the food's tax.
    expect(o1.restaurant_share_cents).toBe(1080);
    expect(o2.restaurant_share_cents).toBe(1080);
  });
});
