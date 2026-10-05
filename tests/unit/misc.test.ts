import { describe, expect, it } from 'vitest';
import { code128, PATTERNS } from '@/lib/code128';
import { distanceMiles } from '@/lib/geo';
import { money, pct, timeLeft } from '@/lib/format';
import { LEGAL_VERSION, renderDocument, requiredDocuments } from '@/lib/legal/documents';
import { dayRange, todayIn } from '@/lib/receipts/time';

describe('geo', () => {
  it('computes haversine distances in miles', () => {
    // Seattle (Pike Place) to Tacoma (Union Station): about 25 miles.
    expect(distanceMiles(47.6097, -122.3422, 47.2396, -122.4285)).toBeCloseTo(25.8, 0);
    expect(distanceMiles(47.6, -122.3, 47.6, -122.3)).toBe(0);
  });
});

describe('code128', () => {
  it('encodes with start, checksum and stop symbols', () => {
    const bars = code128('BW-20260929-000064');
    // 18 characters + start + checksum + stop; each symbol is 11 modules, the stop is 13.
    expect(bars.reduce((a, b) => a + b, 0)).toBe(20 * 11 + 13);
    expect(PATTERNS).toHaveLength(107);
    expect(() => code128('é')).toThrow();
  });
});

describe('format', () => {
  it('formats money, rates and timers', () => {
    expect(money(1957)).toBe('$19.57');
    expect(pct(1035)).toBe('10.35%');
    expect(pct(500)).toBe('5%');
    const now = Date.parse('2026-09-29T12:00:00Z');
    expect(timeLeft('2026-09-29T14:05:00Z', now)).toBe('2h 05m');
    expect(timeLeft('2026-09-29T12:04:09Z', now)).toBe('4:09');
    expect(timeLeft('2026-09-29T11:00:00Z', now)).toBe('Expired');
  });
});

describe('Pacific time days', () => {
  it('handles daylight saving time', () => {
    expect(dayRange('2026-07-01', 'America/Los_Angeles')).toEqual({ start: '2026-07-01T07:00:00.000Z', end: '2026-07-02T07:00:00.000Z' });
    expect(dayRange('2026-12-01', 'America/Los_Angeles')).toEqual({ start: '2026-12-01T08:00:00.000Z', end: '2026-12-02T08:00:00.000Z' });
    expect(todayIn('America/Los_Angeles', new Date('2026-09-30T05:00:00Z'))).toBe('2026-09-29');
  });
});

describe('legal documents', () => {
  const company = { entity: 'Bite Wise <LLC>', email: 'help@example.com', address: 'Seattle', serviceFeePct: 5, graceMinutes: 10, monthlyPrice: 15, annualPrice: 150, foundingSpots: 50 };
  it('lists what each role must accept', () => {
    expect(requiredDocuments('customer').map((d) => d.id)).toEqual(['customer-terms', 'privacy']);
    expect(requiredDocuments('restaurant').map((d) => d.id)).toEqual(['restaurant-agreement', 'privacy']);
  });
  it('renders with escaped company details and the live service fee', () => {
    const doc = renderDocument('customer-terms', company)!;
    expect(doc.version).toBe(LEGAL_VERSION);
    expect(doc.html).toContain('Bite Wise &lt;LLC&gt;');
    expect(doc.html).toContain('currently 5% of the food subtotal');
    expect(renderDocument('restaurant-agreement', company)!.html).toContain('Stripe Connect');
    expect(renderDocument('restaurant-agreement', company)!.html).toMatch(/\$15 per month[^]*\$150 per year[^]*\$30 less/);
    expect(renderDocument('nope', company)).toBeNull();
  });
});
