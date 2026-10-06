// The owner console's Income tab: service fees + plan fees (without sales tax) - platform credit Bite Wise funds.
// Against the local database; compares before and after, so other data in it doesn't matter.
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => true), emailConfigured: () => true }));

const adminLib = await import('@/lib/admin');
const orders = await import('@/lib/orders');
const subs = await import('@/lib/subscriptions');
const { admin, restaurantWithOffer, signUp, supabaseAvailable, visa } = await import('../support/db');

const available = await supabaseAvailable();
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
const load = () => adminLib.income(new URLSearchParams({ from: today(), to: today(), by: 'day' }));

describe.skipIf(!available)('income', () => {
  it('adds service fees and plan fees, leaves out sales tax, and takes off platform credit', async () => {
    const before = await load();

    // A completed order.
    const shop = await restaurantWithOffer({ price: 2000, discount: 50 });
    const c = await signUp('customer');
    const { orderId } = await orders.checkout(c.id, { offerId: shop.offer.id, quantity: 1, creditCents: 0, newCard: visa });
    const pin = (await admin().from('order_pins').select('pin').eq('order_id', orderId).single()).data!.pin;
    const claimed = (await admin().rpc('begin_pickup_for', { p_restaurant_id: shop.restaurant.id, p_pin: pin, p_order_id: orderId })).data as unknown as {
      id: number; paymentRef: string | null; destinationAccount: string | null;
    };
    const order = await orders.completePickup(claimed);

    // A paid monthly plan ($15.00 + sales tax).
    const owner = await signUp('restaurant');
    const r = (await admin().from('restaurants').select('id').eq('owner_id', owner.id).single()).data!;
    await admin().from('restaurants').update({ status: 'approved' }).eq('id', r.id);
    await subs.subscribe(r.id, { plan: 'monthly', token: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 }, autoRenew: true });
    const plan = (await admin().from('subscription_payments').select('*').eq('restaurant_id', r.id).eq('status', 'paid').single()).data!;

    // $3.00 goodwill credit.
    await admin().from('credit_ledger').insert({ user_id: c.id, amount_cents: 300, kind: 'goodwill', note: 'test' });

    const after = await load();
    const d = (k: keyof typeof after.totals) => after.totals[k] - before.totals[k];
    expect(d('orders')).toBe(1);
    expect(d('serviceFeesCents')).toBe(order.service_fee_cents);
    expect(d('planFeesCents')).toBe(1500);
    expect(d('planTaxCents')).toBe(plan.tax_cents);
    expect(plan.tax_cents).toBeGreaterThan(0);
    expect(d('orderTaxCents')).toBe(order.tax_cents);
    expect(d('creditCostCents')).toBe(300);
    expect(d('netCents')).toBe(order.service_fee_cents + 1500 - 300);
    // Today, this month and this year include it too.
    expect(after.quick.today.netCents - before.quick.today.netCents).toBe(order.service_fee_cents + 1500 - 300);
    expect(after.quick.year.netCents).toBeGreaterThanOrEqual(after.quick.month.netCents);
    // Grouped by month or year, the periods add up to the same total.
    const byMonth = await adminLib.income(new URLSearchParams({ from: today(), to: today(), by: 'month' }));
    expect(byMonth.periods.reduce((n, p) => n + p.netCents, 0)).toBe(after.totals.netCents);
    expect(after.restaurants.find((x) => x.id === r.id)?.planFeesCents).toBe(1500);
  });
});
