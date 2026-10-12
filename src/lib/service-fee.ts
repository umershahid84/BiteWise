import { money, pct } from '@/lib/format';

// The customer service fee: a percentage of the food subtotal, or a fixed amount per order (in the order's currency:
// the same number in US dollars and Canadian dollars), whichever the admin chose in Settings. The database's
// price_quote() applies it to every new order; orders keep the fee they were placed with.
export type ServiceFee = { mode: 'percent' | 'fixed'; bps: number; fixedCents: number };

export const DEFAULT_SERVICE_FEE: ServiceFee = { mode: 'percent', bps: 500, fixedCents: 99 };

// From rows of the settings table.
export function serviceFeeFrom(rows: { key: string; value: unknown }[] | null | undefined): ServiceFee {
  const get = (k: string) => rows?.find((r) => r.key === k)?.value;
  return {
    mode: get('service_fee_mode') === 'fixed' ? 'fixed' : 'percent',
    bps: Number(get('service_fee_bps') ?? DEFAULT_SERVICE_FEE.bps),
    fixedCents: Number(get('service_fee_fixed_cents') ?? DEFAULT_SERVICE_FEE.fixedCents),
  };
}
export const SERVICE_FEE_KEYS = ['service_fee_mode', 'service_fee_bps', 'service_fee_fixed_cents'];

// "5% of the food subtotal" or "$0.99 per order" ("CA$0.99 per order" in Canadian dollars).
export const describeServiceFee = (f: ServiceFee, currency?: string | null) =>
  f.mode === 'fixed' ? `${money(f.fixedCents, currency)} per order` : `${pct(f.bps)} of the food subtotal`;

// The fee's line on a quote, receipt or invoice. An order's service_fee_bps is 0 when the fee was a fixed amount.
export const serviceFeeLabel = (bps: number) => (bps > 0 ? `Service fee (${pct(bps)})` : 'Service fee');

// One "Sales tax" line for the customer: the food's tax and the service fee's together. It shows the rate when both
// were taxed at it (the fee's tax matches that rate), and no rate when they differ (e.g. HST on the fee in Canada).
export function salesTaxLabel(o: { taxRateBps: number; serviceFeeCents: number; feeTaxCents: number }) {
  const sameRate = Math.floor((o.serviceFeeCents * o.taxRateBps) / 10000 + 0.5) === o.feeTaxCents;
  return sameRate || !o.feeTaxCents ? `Sales tax (${pct(o.taxRateBps)})` : 'Sales tax';
}
