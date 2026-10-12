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
  // A coupon (from the database's price_quote; the TypeScript quote() below has none): foodCents is the food before
  // it, subtotalCents after it. no_fee coupons waive the service fee instead (couponFeeWaivedCents).
  foodCents?: number;
  couponCode?: string;
  couponKind?: 'no_fee' | 'fixed' | 'percent' | null;
  couponDescription?: string;
  couponDiscountCents?: number;
  couponFeeWaivedCents?: number;
  subtotalCents: number;
  savingsCents: number;
  serviceFeeBps: number;
  serviceFeeCents: number;
  taxRateBps: number;
  // Food: the restaurant's rate. Service fee (Bite Wise's platform fee): the rate of Bite Wise's location in the
  // restaurant's country (Washington / Newfoundland and Labrador HST).
  foodTaxCents: number;
  serviceFeeTaxBps: number;
  serviceFeeTaxCents: number;
  taxCents: number;
  totalCents: number;
};

export function quote(q: {
  originalUnitCents: number;
  discountPct: number;
  quantity: number;
  serviceFeeBps: number;
  // A fixed fee per order instead of the percentage (then serviceFeeBps is ignored and recorded as 0).
  serviceFeeFixedCents?: number | null;
  taxRateBps: number;
  serviceFeeTaxBps?: number;
}): Quote {
  const unitPriceCents = discountedUnitPrice(q.originalUnitCents, q.discountPct);
  const subtotalCents = unitPriceCents * q.quantity;
  const fixed = q.serviceFeeFixedCents != null;
  const serviceFeeCents = fixed ? q.serviceFeeFixedCents! : roundHalfUp((subtotalCents * q.serviceFeeBps) / 10000);
  const foodTaxCents = roundHalfUp((subtotalCents * q.taxRateBps) / 10000);
  const serviceFeeTaxCents = roundHalfUp((serviceFeeCents * (q.serviceFeeTaxBps ?? 0)) / 10000);
  const taxCents = foodTaxCents + serviceFeeTaxCents;
  return {
    quantity: q.quantity,
    originalUnitCents: q.originalUnitCents,
    discountPct: q.discountPct,
    unitPriceCents,
    subtotalCents,
    savingsCents: (q.originalUnitCents - unitPriceCents) * q.quantity,
    serviceFeeBps: fixed ? 0 : q.serviceFeeBps,
    serviceFeeCents,
    taxRateBps: q.taxRateBps,
    foodTaxCents,
    serviceFeeTaxBps: q.serviceFeeTaxBps ?? 0,
    serviceFeeTaxCents,
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

// A refund (which never includes the service fee) takes back from the restaurant the same proportion of what it was
// paid for the order (restaurant_share_cents: the food price, plus the food's sales tax when the restaurant got it).
export const restaurantShareOfRefund = (refundCents: number, o: Charged & { restaurant_share_cents: number }) => {
  const base = refundableTotalCents(o);
  return base ? Math.min(o.restaurant_share_cents, Math.round((refundCents * o.restaurant_share_cents) / base)) : 0;
};
