// Automatic sales tax rates from the restaurant's address (src/lib/restaurant-tax.ts), against the local database.
// The lookup services are faked.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as orders from '@/lib/orders';
import { refreshDueTaxRates, refreshRestaurantTax, setManualTaxRate } from '@/lib/restaurant-tax';
import * as subs from '@/lib/subscriptions';
import { admin, restaurantWithOffer, signUp, supabaseAvailable, visa } from '../support/db';

const available = await supabaseAvailable();
const DOR = '<response rate="0.1025" code="0"><rate name="TACOMA" staterate="0.065" localrate="0.0375" /></response>';
const fetcher = (body: string, status = 200) => (async () => new Response(body, { status })) as unknown as typeof fetch;
const restaurantOf = async (ownerId: string) => (await admin().from('restaurants').select('*').eq('owner_id', ownerId).single()).data!;
const card = { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 };

describe.skipIf(!available)('automatic sales tax', () => {
  beforeEach(() => { process.env.TAX_LOOKUP = 'on'; });
  afterEach(() => { process.env.TAX_LOOKUP = 'off'; });

  it('keeps the state from the sign-up form (WA when an older client sends none)', async () => {
    const or = await signUp('restaurant', { restaurant: { name: 'Rose City Eats', address: '1 Main St', city: 'Portland', state: 'or', zip: '97201' } });
    expect((await restaurantOf(or.id)).state).toBe('OR');
    const wa = await signUp('restaurant');
    expect(await restaurantOf(wa.id)).toMatchObject({ state: 'WA', tax_source: 'auto', tax_accuracy: '', tax_checked_at: null });
  });

  it('looks the rate up from the address, keeps it when the service is down, and leaves a hand-set rate alone', async () => {
    const owner = await signUp('restaurant');
    const r = await restaurantOf(owner.id);
    const found = await refreshRestaurantTax(r.id, { fetcher: fetcher(DOR), stripe: null });
    expect(found).toMatchObject({ rateBps: 1025, accuracy: 'address', changed: true });
    expect(await restaurantOf(owner.id)).toMatchObject({ tax_rate_bps: 1025, tax_jurisdiction: 'Tacoma, WA (WA Department of Revenue)', tax_accuracy: 'address', tax_lookup_error: '' });

    // The service is down: the rate stays (not dropped to the 6.5% state rate), and it is tried again tomorrow.
    const down = await refreshRestaurantTax(r.id, { fetcher: fetcher('', 503), stripe: null });
    expect(down).toMatchObject({ rateBps: 1025, kept: true });
    const after = await restaurantOf(owner.id);
    expect(after.tax_rate_bps).toBe(1025);
    expect(after.tax_lookup_error).toMatch(/current one was kept/);
    expect(Date.parse(after.tax_checked_at!)).toBeLessThan(Date.now() - 28 * 86400000);

    // An admin sets the rate by hand: lookups leave it alone until asked.
    await setManualTaxRate(r.id, 900, 'Special district');
    expect(await refreshRestaurantTax(r.id, { fetcher: fetcher(DOR), stripe: null })).toBeNull();
    expect(await restaurantOf(owner.id)).toMatchObject({ tax_rate_bps: 900, tax_source: 'manual', tax_jurisdiction: 'Special district' });
    expect(await refreshRestaurantTax(r.id, { fetcher: fetcher(DOR), stripe: null, force: true })).toMatchObject({ rateBps: 1025 });
    expect((await restaurantOf(owner.id)).tax_source).toBe('auto');
  });

  it('the scheduled refresh does nothing with lookups off', async () => {
    process.env.TAX_LOOKUP = 'off';
    expect(await refreshDueTaxRates()).toEqual({ checked: 0, updated: 0 });
  });

  it('charges orders at the restaurant rate and records where', async () => {
    const shop = await restaurantWithOffer({ price: 1000, discount: 50 });
    await admin().from('restaurants').update({ tax_rate_bps: 800, tax_jurisdiction: 'Testville, WA (WA Department of Revenue)' }).eq('id', shop.restaurant.id);
    const c = await signUp('customer');
    const res = await orders.checkout(c.id, { offerId: shop.offer.id, quantity: 2, creditCents: 0, newCard: visa });
    const o = (await admin().from('orders').select('tax_rate_bps, tax_cents, subtotal_cents, tax_jurisdiction').eq('id', res.orderId).single()).data!;
    expect(o).toEqual({ tax_rate_bps: 800, tax_cents: 80, subtotal_cents: 1000, tax_jurisdiction: 'Testville, WA (WA Department of Revenue)' });
  });

  it('taxes plan fees only in the states set by the admin', async () => {
    const db = admin();
    const old = (await db.from('settings').select('value').eq('key', 'plan_tax_states').single()).data!.value;
    try {
      await db.from('settings').update({ value: 'WA, NY' }).eq('key', 'plan_tax_states');
      const ny = await signUp('restaurant', { restaurant: { name: 'Big Apple Bites', address: '1 Broadway', city: 'New York', state: 'NY', zip: '10004' } });
      const or = await signUp('restaurant', { restaurant: { name: 'Rose City Eats', address: '1 Main St', city: 'Portland', state: 'OR', zip: '97201' } });
      for (const [owner, rate] of [[ny, 888], [or, 0]] as const) {
        const r = await restaurantOf(owner.id);
        await db.from('restaurants').update({ status: 'approved', tax_rate_bps: rate, tax_jurisdiction: `${r.city}, ${r.state}` }).eq('id', r.id);
        await subs.subscribe(r.id, { plan: 'monthly', token: card, autoRenew: true });
      }
      const pay = async (ownerId: string) => (await db.from('subscription_payments').select('list_price_cents, tax_rate_bps, tax_cents, tax_jurisdiction')
        .eq('restaurant_id', (await restaurantOf(ownerId)).id).single()).data!;
      expect(await pay(ny.id)).toEqual({ list_price_cents: 1500, tax_rate_bps: 888, tax_cents: 133, tax_jurisdiction: 'New York, NY' });
      expect(await pay(or.id)).toEqual({ list_price_cents: 1500, tax_rate_bps: 0, tax_cents: 0, tax_jurisdiction: '' });

      await db.from('settings').update({ value: 'WA' }).eq('key', 'plan_tax_states');
      expect((await subs.planSummary((await restaurantOf(ny.id)).id)).taxRateBps).toBe(0);
    } finally {
      await db.from('settings').update({ value: old }).eq('key', 'plan_tax_states');
    }
  });
});
