import { describe, expect, it } from 'vitest';
import { discountedUnitPrice, feeTaxCents, nonRefundableCents, quote, refundableTotalCents, restaurantShareOfRefund } from '@/lib/pricing';

describe('pricing', () => {
  it('rounds the discounted price half up', () => {
    expect(discountedUnitPrice(1695, 50)).toBe(848); // $8.475 -> $8.48
    expect(discountedUnitPrice(1000, 33)).toBe(670);
  });

  it('builds the full total: food + 5% service fee + WA sales tax', () => {
    const q = quote({ originalUnitCents: 1695, discountPct: 50, quantity: 2, serviceFeeBps: 500, taxRateBps: 1035 });
    expect(q).toMatchObject({ unitPriceCents: 848, subtotalCents: 1696, savingsCents: 1694, serviceFeeCents: 85, taxCents: 176, totalCents: 1957 });
  });

  it('can tax the service fee when configured', () => {
    const q = quote({ originalUnitCents: 1000, discountPct: 50, quantity: 1, serviceFeeBps: 500, taxRateBps: 1000, taxServiceFee: true });
    expect(q.taxCents).toBe(Math.floor((500 + 25) * 0.1 + 0.5));
  });

  it('never refunds the service fee (or the tax on it) and takes the food share back from the restaurant', () => {
    const o = { subtotal_cents: 1000, service_fee_cents: 50, tax_cents: 104, tax_rate_bps: 1035, total_cents: 1154 };
    expect(nonRefundableCents(o)).toBe(50);
    expect(refundableTotalCents(o)).toBe(1104);
    expect(restaurantShareOfRefund(1104, o)).toBe(1000);
    expect(restaurantShareOfRefund(552, o)).toBe(500);
    const taxedFee = { ...o, tax_cents: 109, total_cents: 1159 }; // 10.35% on $10.50
    expect(feeTaxCents(taxedFee)).toBe(5);
    expect(refundableTotalCents(taxedFee)).toBe(1104);
    expect(restaurantShareOfRefund(100, { subtotal_cents: 0, service_fee_cents: 0, tax_cents: 0, tax_rate_bps: 0, total_cents: 0 })).toBe(0);
  });
});
