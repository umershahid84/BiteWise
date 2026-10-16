import { describe, expect, it } from 'vitest';
import { orderInvoiceEmail, orderPlacedEmail, subscriptionReceiptEmail } from '@/lib/email/templates';
import { directionsUrl } from '@/lib/regions';
import type { Receipt } from '@/lib/receipts/data';

const receipt = {
  receiptNumber: 'RD-20261006-000042', orderId: 42, pickedUpAtText: 'Oct 6, 2026, 6:10 PM', card: 'VISA •••• 4242',
  restaurant: { name: 'Pho & Co', address: '1 Main St', city: 'Seattle', zip: '98101', phone: '' },
  item: { title: 'Pho', quantity: 2, originalUnitCents: 1500, discountPct: 50, unitPriceCents: 750, lineOriginalCents: 3000, lineTotalCents: 1500, savingsCents: 1500 },
  subtotalCents: 1500, serviceFeeCents: 75, serviceFeeLabel: 'Service fee (5%)', taxRateBps: 1035, taxCents: 155, foodTaxCents: 155, feeTaxCents: 0, totalCents: 1730,
  creditAppliedCents: 500, amountChargedCents: 1230,
} as unknown as Receipt;

describe('invoice emails', () => {
  it('itemizes a customer order: price, discount, fee, tax, total and how it was paid', () => {
    const e = orderInvoiceEmail(receipt, { receiptUrl: 'https://bitewise.app/orders/42/receipt' });
    expect(e.subject).toBe('Payment confirmed: your ResDish receipt RD-20261006-000042 ($17.30 at Pho & Co)');
    expect(e.html).not.toContain('Drive to Restaurant');
    expect(e.html).toContain('Pho &amp; Co');
    for (const s of ['$30.00', '−$15.00', '$0.75', '$1.55', '$17.30', '$12.30 on VISA •••• 4242 + $5.00 in ResDish credit', 'https://bitewise.app/orders/42/receipt']) {
      expect(e.html).toContain(s);
    }
    expect(e.text).toContain('Paid with: $12.30 on VISA •••• 4242 + $5.00 in ResDish credit');
  });

  it('sends the hold receipt with the PIN, pickup deadline, address and a Drive to Restaurant button', () => {
    const placed = { ...receipt, status: 'reserved', pin: '4827', pickupByText: 'Oct 6, 2026, 8:00 PM', amountChargedCents: 0,
      restaurant: { ...receipt.restaurant, state: 'WA', phone: '(206) 555-0101' } } as unknown as Receipt;
    const e = orderPlacedEmail(placed, { directionsUrl: 'https://x.test/directions/7', ordersUrl: 'https://x.test/orders', receiptUrl: 'https://x.test/orders/42/receipt' });
    expect(e.subject).toBe('Order placed: 2 × Pho at Pho & Co (PIN 4827)');
    for (const s of ['4827', 'Oct 6, 2026, 8:00 PM', '1 Main St, Seattle, WA 98101', '(206) 555-0101', 'Drive to Restaurant', 'https://x.test/directions/7',
      '$17.30', '$12.30 held on VISA •••• 4242 + $5.00 in ResDish credit', 'charged when you pick up']) {
      expect(e.html).toContain(s);
    }
    expect(e.text).toContain('YOUR PICKUP PIN: 4827');
    expect(e.text).toContain('Drive to Restaurant: https://x.test/directions/7');
  });

  it('opens directions in Apple Maps on Apple devices and Google Maps elsewhere', () => {
    const r = { address: '3 Sumac Street', city: "St. John's", state: 'NL', zip: 'A1H 0G5', country: 'CA' };
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
    const android = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36';
    expect(directionsUrl(r, iphone)).toBe("https://maps.apple.com/?daddr=3%20Sumac%20Street%2C%20St.%20John's%2C%20NL%20A1H%200G5%2C%20Canada&dirflg=d");
    expect(directionsUrl(r, android)).toBe("https://www.google.com/maps/dir/?api=1&destination=3%20Sumac%20Street%2C%20St.%20John's%2C%20NL%20A1H%200G5%2C%20Canada&travelmode=driving");
  });

  it('shows a Pioneer invoice as the price, minus the discount, for $0.00, with a link to the invoice', () => {
    const e = subscriptionReceiptEmail({
      restaurant: 'Pho & Co', plan: 'annual', amountCents: 0, invoiceNumber: 'RD-SUB-000001', cardLabel: 'No charge', periodEnd: '2027-10-06T00:00:00Z',
      autoRenew: true, renewal: false, planUrl: 'https://bitewise.app/restaurant?tab=plan', listPriceCents: 15000, discountCents: 15000,
      discountLabel: 'Pioneer Members Discount', invoiceUrl: 'https://bitewise.app/restaurant/invoices/7',
    });
    expect(e.html).toMatch(/\$150\.00[\s\S]*Pioneer Members Discount[\s\S]*−\$150\.00[\s\S]*\$0\.00/);
    expect(e.html).toContain('View my invoice');
    expect(e.text).toContain('Your invoice: https://bitewise.app/restaurant/invoices/7');
  });

  it('shows sales tax on a paid plan: price, subtotal, tax and total', () => {
    const e = subscriptionReceiptEmail({
      restaurant: 'Pho & Co', plan: 'monthly', amountCents: 1655, invoiceNumber: 'RD-SUB-000002', cardLabel: 'VISA •••• 4242', periodEnd: '2026-11-06T00:00:00Z',
      autoRenew: true, renewal: false, planUrl: 'https://bitewise.app/restaurant?tab=plan', listPriceCents: 1500, taxCents: 155, taxRateBps: 1035,
    });
    expect(e.html).toMatch(/\$15\.00[\s\S]*Subtotal[\s\S]*Sales tax \(10\.35%\)[\s\S]*\$1\.55[\s\S]*\$16\.55/);
    expect(e.text).toContain('Sales tax (10.35%): $1.55');
  });
});
