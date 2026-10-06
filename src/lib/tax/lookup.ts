import Stripe from 'stripe';
import { stateByCode } from './states';

// Finds the sales tax rate for a restaurant's street address. Food on Bite Wise is always picked up at the
// restaurant, so the sale takes place there and the restaurant's address sets the rate (state, county, city and any
// special districts). Plan fees are paid by the restaurant at the same address.
//
// Sources, best first:
//   1. Stripe Tax (STRIPE_TAX=on and a Stripe secret key): any US address, rate for prepared food, and only in states
//      where Bite Wise has added a tax registration in the Stripe dashboard.
//   2. Washington State Department of Revenue's free address rate lookup, for WA addresses.
//   3. The state's own rate (an estimate: local taxes missing). Flagged for an admin to check.
// TAX_LOOKUP=off skips 1 and 2 (tests and offline development).

export type TaxAddress = { address: string; city: string; state: string; zip: string };
export type TaxAccuracy = 'address' | 'zip' | 'state';
export type TaxRate = {
  rateBps: number;
  jurisdiction: string;
  accuracy: TaxAccuracy;
  // A problem worth showing an admin (a lookup service failed, Stripe Tax isn't registered in the state...).
  note?: string;
};
// A service that failed (as opposed to one that doesn't cover the address).
export type TaxLookupResult = TaxRate & { failed: boolean };

type Fetch = typeof fetch;
type StripeTaxClient = { tax: { calculations: { create: Stripe['tax']['calculations']['create'] } } };
export type LookupOptions = { fetcher?: Fetch; stripe?: StripeTaxClient | null };

const TIMEOUT_MS = 8000;
// Stripe's tax code for prepared food (restaurant meals). STRIPE_TAX_CODE can override it.
const FOOD_TAX_CODE = process.env.STRIPE_TAX_CODE || 'txcd_40060003';

const title = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

export function stripeTaxClient(): StripeTaxClient | null {
  const key = process.env.STRIPE_SECRET_KEY;
  return process.env.STRIPE_TAX === 'on' && key ? new Stripe(key, { appInfo: { name: 'Bite Wise' } }) : null;
}

// Stripe Tax: the tax on $100.00 of prepared food at the address, in cents, is the rate in basis points.
async function stripeTax(a: TaxAddress, stripe: StripeTaxClient): Promise<TaxRate | { skip: string }> {
  const calc = await stripe.tax.calculations.create({
    currency: 'usd',
    line_items: [{ amount: 10000, reference: 'rate-check', tax_code: FOOD_TAX_CODE, tax_behavior: 'exclusive' }],
    customer_details: {
      address: { line1: a.address, city: a.city, state: a.state, postal_code: a.zip.slice(0, 5), country: 'US' },
      address_source: 'billing',
    },
  });
  const reasons = calc.tax_breakdown.map((b) => b.taxability_reason);
  if (reasons.includes('not_collecting')) {
    return { skip: `Bite Wise has no ${a.state} tax registration in Stripe Tax, so Stripe doesn't calculate tax there.` };
  }
  return { rateBps: calc.tax_amount_exclusive, jurisdiction: `${title(a.city)}, ${a.state} (Stripe Tax)`, accuracy: 'address' };
}

// Washington State Department of Revenue: https://dor.wa.gov/taxes-rates/retail-sales-tax/destination-based-sales-tax-and-streamlined-sales-tax/wa-sales-tax-rate-lookup-url-interface
// Result codes: 0 = the address was found, 1 = ZIP+4 area used, 2 = 5-digit ZIP area used, 3+ = not found or invalid.
async function washington(a: TaxAddress, fetcher: Fetch): Promise<TaxRate | null> {
  if (a.state !== 'WA') return null;
  const q = new URLSearchParams({ output: 'xml', addr: a.address, city: a.city, zip: a.zip });
  const res = await fetcher(`https://webgis.dor.wa.gov/webapi/addressrates.aspx?${q}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  const attr = (tag: string, name: string) => new RegExp(`<${tag}\\b[^>]*\\s${name}="([^"]*)"`, 'i').exec(xml)?.[1];
  const code = Number(attr('response', 'code'));
  const rate = Number(attr('response', 'rate'));
  if (!(code >= 0 && code <= 2) || !Number.isFinite(rate) || rate <= 0 || rate > 0.2) return null;
  const place = attr('rate', 'name');
  return {
    rateBps: Math.round(rate * 10000),
    jurisdiction: `${place ? title(place) : title(a.city)}, WA (WA Department of Revenue)`,
    accuracy: code === 0 ? 'address' : 'zip',
  };
}

function stateOnly(a: TaxAddress): TaxRate {
  const s = stateByCode(a.state);
  const rateBps = s?.mealsRateBps ?? 0;
  return {
    rateBps,
    jurisdiction: `${a.state} state rate only (estimate)`,
    accuracy: 'state',
    note: rateBps
      ? `Only the ${s?.name ?? a.state} state rate is known: county and city taxes may be missing. Check the rate and set it by hand if needed.`
      : `${s?.name ?? a.state} has no state sales tax, but local or meals taxes may apply. Check the rate and set it by hand if needed.`,
  };
}

export async function lookupTaxRate(a: TaxAddress, o: LookupOptions = {}): Promise<TaxLookupResult> {
  const fetcher = o.fetcher ?? fetch;
  const notes: string[] = [];
  let failed = false;
  if (process.env.TAX_LOOKUP !== 'off') {
    const stripe = o.stripe === undefined ? stripeTaxClient() : o.stripe;
    const services: Array<[string, () => Promise<TaxRate | { skip: string } | null>]> = [
      ...(stripe ? [['Stripe Tax', () => stripeTax(a, stripe)] as [string, () => Promise<TaxRate | { skip: string }>]] : []),
      ['WA Department of Revenue', () => washington(a, fetcher)],
    ];
    for (const [name, run] of services) {
      try {
        const r = await run();
        if (r && 'skip' in r) notes.push(r.skip);
        else if (r) return { ...r, note: notes.join(' ') || undefined, failed: false };
      } catch (err) {
        failed = true;
        notes.push(`${name} lookup failed: ${err instanceof Error ? err.message : String(err)}.`);
      }
    }
  }
  const fallback = stateOnly(a);
  return { ...fallback, note: [...notes, fallback.note].join(' '), failed };
}
