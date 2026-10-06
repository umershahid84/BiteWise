// Sales tax rate lookup from a restaurant's address (src/lib/tax/lookup.ts), with the services faked.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lookupTaxRate } from '@/lib/tax/lookup';

const SEATTLE = { address: '400 Broad St', city: 'Seattle', state: 'WA', zip: '98109' };
const dor = (body: string, status = 200) => (async () => new Response(body, { status })) as unknown as typeof fetch;
const DOR_EXACT = '<?xml version="1.0"?><response loccode="1726" localrate="0.0385" rate="0.1035" code="0" xmlns="http://dor.wa.gov"><addressline houselow="400" /><rate name="SEATTLE" code="1726" staterate="0.065" localrate="0.0385" /></response>';
const stripe = (result: { tax_amount_exclusive: number; tax_breakdown: { taxability_reason: string }[] }) => {
  const calls: unknown[] = [];
  return { calls, client: { tax: { calculations: { create: (async (p: unknown) => { calls.push(p); return result; }) as never } } } };
};

describe('sales tax lookup', () => {
  beforeEach(() => { process.env.TAX_LOOKUP = 'on'; });
  afterEach(() => { process.env.TAX_LOOKUP = 'off'; });

  it('uses the WA Department of Revenue rate for a Washington street address', async () => {
    const r = await lookupTaxRate(SEATTLE, { fetcher: dor(DOR_EXACT), stripe: null });
    expect(r).toMatchObject({ rateBps: 1035, accuracy: 'address', failed: false, jurisdiction: 'Seattle, WA (WA Department of Revenue)' });
  });

  it('marks a ZIP-area match, and skips unknown addresses', async () => {
    const zip = await lookupTaxRate(SEATTLE, { fetcher: dor(DOR_EXACT.replace('code="0"', 'code="2"')), stripe: null });
    expect(zip).toMatchObject({ rateBps: 1035, accuracy: 'zip' });
    const none = await lookupTaxRate(SEATTLE, { fetcher: dor('<response code="3" rate="-1" />'), stripe: null });
    expect(none).toMatchObject({ rateBps: 650, accuracy: 'state', failed: false });
    expect(none.note).toMatch(/county and city taxes may be missing/);
  });

  it('falls back to the state rate, flagged, outside Washington or when the service is down', async () => {
    const or = await lookupTaxRate({ ...SEATTLE, state: 'OR', city: 'Portland', zip: '97201' }, { fetcher: dor(''), stripe: null });
    expect(or).toMatchObject({ rateBps: 0, accuracy: 'state', failed: false });
    expect(or.note).toMatch(/no state sales tax/);
    const down = await lookupTaxRate(SEATTLE, { fetcher: dor('busy', 503), stripe: null });
    expect(down).toMatchObject({ accuracy: 'state', failed: true });
    expect(down.note).toMatch(/WA Department of Revenue lookup failed: HTTP 503/);
  });

  it('uses Stripe Tax first when it is on, for prepared food at the address', async () => {
    const s = stripe({ tax_amount_exclusive: 1025, tax_breakdown: [{ taxability_reason: 'standard_rated' }] });
    const r = await lookupTaxRate({ address: '1 Main St', city: 'AUSTIN', state: 'TX', zip: '78701' }, { fetcher: dor(''), stripe: s.client });
    expect(r).toMatchObject({ rateBps: 825 + 200, accuracy: 'address', jurisdiction: 'Austin, TX (Stripe Tax)' });
    expect(s.calls[0]).toMatchObject({
      line_items: [{ amount: 10000, tax_code: 'txcd_40060003', tax_behavior: 'exclusive' }],
      customer_details: { address: { line1: '1 Main St', state: 'TX', postal_code: '78701', country: 'US' } },
    });
  });

  it('skips Stripe Tax in a state without a tax registration', async () => {
    const s = stripe({ tax_amount_exclusive: 0, tax_breakdown: [{ taxability_reason: 'not_collecting' }] });
    const r = await lookupTaxRate(SEATTLE, { fetcher: dor(DOR_EXACT), stripe: s.client });
    expect(r).toMatchObject({ rateBps: 1035, accuracy: 'address' });
    expect(r.note).toMatch(/no WA tax registration in Stripe Tax/);
  });

  it('TAX_LOOKUP=off uses no services', async () => {
    process.env.TAX_LOOKUP = 'off';
    const r = await lookupTaxRate(SEATTLE, { fetcher: dor(DOR_EXACT), stripe: null });
    expect(r).toMatchObject({ rateBps: 650, accuracy: 'state' });
  });
});
