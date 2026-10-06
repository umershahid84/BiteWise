import { describe, expect, it } from 'vitest';
import { orderInvoiceEmail, subscriptionReceiptEmail } from '@/lib/email/templates';
import type { Receipt } from '@/lib/receipts/data';

const receipt = {
  receiptNumber: 'BW-20261006-000042', orderId: 42, pickedUpAtText: 'Oct 6, 2026, 6:10 PM', card: 'VISA •••• 4242',
  restaurant: { name: 'Pho & Co', address: '1 Main St', city: 'Seattle', zip: '98101', phone: '' },
  item: { title: 'Pho', quantity: 2, originalUnitCents: 1500, discountPct: 50, unitPriceCents: 750, lineOriginalCents: 3000, lineTotalCents: 1500, savingsCents: 1500 },
  subtotalCents: 1500, serviceFeeCents: 75, serviceFeePct: 5, taxRateBps: 1035, taxCents: 155, totalCents: 1730,
  creditAppliedCents: 500, amountChargedCents: 1230,
} as unknown as Receipt;

describe('invoice emails', () => {
  it('itemizes a customer order: price, discount, fee, tax, total and how it was paid', () => {
    const e = orderInvoiceEmail(receipt, { receiptUrl: 'https://bitewise.app/orders/42/receipt' });
    expect(e.subject).toBe('Your Bite Wise invoice BW-20261006-000042: $17.30 at Pho & Co');
    expect(e.html).toContain('Pho &amp; Co');
    for (const s of ['$30.00', '−$15.00', '$0.75', '$1.55', '$17.30', '$12.30 on VISA •••• 4242 + $5.00 in Bite Wise credit', 'https://bitewise.app/orders/42/receipt']) {
      expect(e.html).toContain(s);
    }
    expect(e.text).toContain('Paid with: $12.30 on VISA •••• 4242 + $5.00 in Bite Wise credit');
  });

  it('shows a Pioneer invoice as the price, minus the discount, for $0.00, with a link to the invoice', () => {
    const e = subscriptionReceiptEmail({
      restaurant: 'Pho & Co', plan: 'annual', amountCents: 0, invoiceNumber: 'BW-SUB-000001', cardLabel: 'No charge', periodEnd: '2027-10-06T00:00:00Z',
      autoRenew: true, renewal: false, planUrl: 'https://bitewise.app/restaurant?tab=plan', listPriceCents: 15000, discountCents: 15000,
      discountLabel: 'Pioneer Members Discount', invoiceUrl: 'https://bitewise.app/restaurant/invoices/7',
    });
    expect(e.html).toMatch(/\$150\.00[\s\S]*Pioneer Members Discount[\s\S]*−\$150\.00[\s\S]*\$0\.00/);
    expect(e.html).toContain('View my invoice');
    expect(e.text).toContain('Your invoice: https://bitewise.app/restaurant/invoices/7');
  });
});
