// Coupons (src/lib/coupons.ts): food discounts paid by the restaurant, waived service fees paid by ResDish.
import { describe, expect, it } from 'vitest';
import { createCoupon } from '@/lib/coupons';
import * as orders from '@/lib/orders';
import { admin, CANADIAN_CUSTOMER, restaurantWithOffer, signUp, supabaseAvailable, visa } from '../support/db';

const available = await supabaseAvailable();
const db = () => admin();
const inAWeek = () => new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
const code = () => `T-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
const boss = async () => (await db().from('profiles').select('id').eq('role', 'admin').limit(1).single()).data!.id;
// $20.00 food at 50% off = $10.00; 5% fee = 50; 10.35% tax.
const shop = () => restaurantWithOffer({ price: 2000, discount: 50, quantity: 5 });

describe.skipIf(!available)('coupons', () => {
  it('takes a percentage off the food, out of the restaurant\'s share, and is used once per customer', async () => {
    const s = await shop();
    const c = await signUp('customer');
    const cp = await createCoupon(await boss(), 'US', { code: code(), kind: 'percent', percent: 20, description: '', expiresOn: inAWeek() });
    const q = await orders.quoteOffer(s.offer.id, 1, cp.code.toLowerCase());
    expect(q).toMatchObject({ foodCents: 1000, couponDiscountCents: 200, subtotalCents: 800, serviceFeeCents: 50 });
    const o = await orders.getOrder((await orders.checkout(c.id, { offerId: s.offer.id, quantity: 1, creditCents: 0, newCard: visa, couponCode: cp.code })).orderId);
    expect(o).toMatchObject({ coupon_code: cp.code, coupon_discount_cents: 200, subtotal_cents: 800, service_fee_cents: 50 });
    expect(o.tax_cents).toBe(83 + 5); // 10.35% of $8.00 (after the coupon), and of the 50¢ fee
    expect(o.restaurant_share_cents).toBe(800 + 83); // the restaurant pays for the coupon
    await expect(orders.checkout(c.id, { offerId: s.offer.id, quantity: 1, creditCents: 0, newCard: visa, couponCode: cp.code })).rejects.toThrow(/already used/);
    // Cancelling the order gives the coupon back.
    expect((await c.client.rpc('my_cancel_order', { p_order_id: o.id })).error).toBeNull();
    await orders.voidIfNeeded(o.id);
    await expect(orders.quoteOffer(s.offer.id, 1, cp.code)).resolves.toBeTruthy();
    await orders.checkout(c.id, { offerId: s.offer.id, quantity: 1, creditCents: 0, newCard: visa, couponCode: cp.code });
  });

  it('takes a fixed amount off the food, never more than the food', async () => {
    const s = await shop();
    const cp = await createCoupon(await boss(), 'US', { code: code(), kind: 'fixed', amountCents: 2500, description: '', expiresOn: inAWeek() });
    const q = await orders.quoteOffer(s.offer.id, 2, cp.code);
    expect(q).toMatchObject({ foodCents: 2000, couponDiscountCents: 2000, subtotalCents: 0, foodTaxCents: 0, serviceFeeCents: 100 });
  });

  it('waives the service fee at ResDish\'s cost, leaving the restaurant\'s share whole', async () => {
    const s = await shop();
    const c = await signUp('customer');
    const cp = await createCoupon(await boss(), 'US', { code: code(), kind: 'no_fee', description: 'On us', expiresOn: inAWeek() });
    const o = await orders.getOrder((await orders.checkout(c.id, { offerId: s.offer.id, quantity: 1, creditCents: 0, newCard: visa, couponCode: cp.code })).orderId);
    expect(o).toMatchObject({ subtotal_cents: 1000, service_fee_cents: 0, coupon_fee_waived_cents: 50, coupon_discount_cents: 0, tax_cents: 104, total_cents: 1104 });
    expect(o.restaurant_share_cents).toBe(1104);
  });

  it('refuses unknown, expired, turned-off and other-country coupons', async () => {
    const s = await shop();
    await expect(orders.quoteOffer(s.offer.id, 1, 'NO-SUCH-CODE')).rejects.toThrow(/isn't valid/);
    const ca = await createCoupon(await boss(), 'CA', { code: code(), kind: 'percent', percent: 10, description: '', expiresOn: inAWeek() });
    await expect(orders.quoteOffer(s.offer.id, 1, ca.code)).rejects.toThrow(/restaurants in Canada/);
    const off = await createCoupon(await boss(), 'US', { code: code(), kind: 'percent', percent: 10, description: '', expiresOn: inAWeek() });
    await db().from('coupons').update({ active: false }).eq('id', off.id);
    await expect(orders.quoteOffer(s.offer.id, 1, off.code)).rejects.toThrow(/isn't valid/);
    const old = await createCoupon(await boss(), 'US', { code: code(), kind: 'percent', percent: 10, description: '', expiresOn: inAWeek() });
    await db().from('coupons').update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq('id', old.id);
    await expect(orders.quoteOffer(s.offer.id, 1, old.code)).rejects.toThrow(/expired/);
    await expect(createCoupon(await boss(), 'US', { code: 'X', kind: 'no_fee', description: '', expiresOn: inAWeek() })).rejects.toThrow(/3 to 24/);
  });

  it('works for Canadian restaurants in Canadian dollars', async () => {
    const s = await restaurantWithOffer({ price: 2000, discount: 50, canada: true });
    const c = await signUp('customer', CANADIAN_CUSTOMER);
    const cp = await createCoupon(await boss(), 'CA', { code: code(), kind: 'fixed', amountCents: 300, description: '', expiresOn: inAWeek() });
    const o = await orders.getOrder((await orders.checkout(c.id, { offerId: s.offer.id, quantity: 1, creditCents: 0, newCard: visa, couponCode: cp.code })).orderId);
    expect(o).toMatchObject({ currency: 'cad', subtotal_cents: 700, coupon_discount_cents: 300 });
  });
});

describe.skipIf(!available)('coupon emails', () => {
  it('fills the template placeholders and adds the code box', async () => {
    const { listCouponTemplates, previewCouponEmail } = await import('@/lib/coupons');
    const templates = await listCouponTemplates();
    expect(templates.map((t) => t.name)).toContain('A thank-you treat');
    const cp = await createCoupon(await boss(), 'US', { code: code(), kind: 'percent', percent: 15, description: 'Enjoy!', expiresOn: inAWeek() });
    const t = templates.find((x) => x.name === 'A thank-you treat')!;
    const p = await previewCouponEmail(cp.id, 'US', { subject: t.subject, body: t.body });
    expect(p.subject).toBe('A thank-you from ResDish: 15% off your food');
    expect(p.html).toContain('Hi Alex,');
    expect(p.html).toContain(cp.code);
    expect(p.html).toContain('Enjoy!');
    expect(p.html).not.toContain('{{');
    await expect(previewCouponEmail(cp.id, 'CA', { subject: t.subject, body: t.body })).rejects.toThrow(/not found/);
    await expect(previewCouponEmail(cp.id, 'US', { subject: '', body: t.body })).rejects.toThrow(/subject/);
  });
});
