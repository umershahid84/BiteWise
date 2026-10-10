// All money is handled in integer cents. Rates are in basis points (1 bp = 0.01%).
// The database function public.price_quote() uses the same math; checkout always uses the database.

export const roundHalfUp = (n: number) => Math.floor(n + 0.5);

export const discountedUnitPrice = (originalCents: number, discountPct: number) =>
  roundHalfUp((originalCents * (100 - discountPct)) / 100);

export type Quote = {
  quantity: number;
  originalUnitCents: number;
  discountPct: number;
  unitPriceCents: number;
  subtotalCents: number;
  savingsCents: number;
  serviceFeeBps: number;
  serviceFeeCents: number;
  taxRateBps: number;
  taxCents: number;
  totalCents: number;
};

export function quote(q: {
  originalUnitCents: number;
  discountPct: number;
  quantity: number;
  serviceFeeBps: number;
  taxRateBps: number;
  taxServiceFee?: boolean;
}): Quote {
  const unitPriceCents = discountedUnitPrice(q.originalUnitCents, q.discountPct);
  const subtotalCents = unitPriceCents * q.quantity;
  const serviceFeeCents = roundHalfUp((subtotalCents * q.serviceFeeBps) / 10000);
  const taxableCents = subtotalCents + (q.taxServiceFee ? serviceFeeCents : 0);
  const taxCents = roundHalfUp((taxableCents * q.taxRateBps) / 10000);
  return {
    quantity: q.quantity,
    originalUnitCents: q.originalUnitCents,
    discountPct: q.discountPct,
    unitPriceCents,
    subtotalCents,
    savingsCents: (q.originalUnitCents - unitPriceCents) * q.quantity,
    serviceFeeBps: q.serviceFeeBps,
    serviceFeeCents,
    taxRateBps: q.taxRateBps,
    taxCents,
    totalCents: subtotalCents + serviceFeeCents + taxCents,
  };
}

// The Bite Wise service fee is never refunded, whether or not the order is picked up. When the fee is taxed, the
// sales tax on it isn't refunded either. Same math as public.order_non_refundable().
type Charged = { subtotal_cents: number; service_fee_cents: number; tax_cents: number; tax_rate_bps: number; total_cents: number };
export const feeTaxCents = (o: Charged) => Math.max(0, o.tax_cents - roundHalfUp((o.subtotal_cents * o.tax_rate_bps) / 10000));
export const nonRefundableCents = (o: Charged) => o.service_fee_cents + feeTaxCents(o);
// What a refund can return in all: the food and its sales tax.
export const refundableTotalCents = (o: Charged) => Math.max(0, o.total_cents - nonRefundableCents(o));

// The restaurant's share of an order is the food subtotal. A refund (which never includes the service fee) takes the
// same proportion of the food subtotal back from the restaurant; the rest of the refund is the food's sales tax.
export const restaurantShareOfRefund = (refundCents: number, o: Charged) => {
  const base = refundableTotalCents(o);
  return base ? Math.round((refundCents * o.subtotal_cents) / base) : 0;
};
