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
  const company = { entity: 'Bite Wise <LLC>', email: 'help@example.com', address: 'Seattle', serviceFee: { mode: 'percent' as const, bps: 500, fixedCents: 99 }, graceMinutes: 10, monthlyPrice: 15, annualPrice: 150, foundingSpots: 50 };
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

describe('test-payments Stripe accounts', async () => {
  const { isTestStripeAccount } = await import('@/lib/constants');
  it('recognises accounts made without Stripe keys', () => {
    expect(isTestStripeAccount('acct_mock_000095')).toBe(true);
    expect(isTestStripeAccount('acct_1PqRsT2eZvKYlo2C')).toBe(false);
    expect(isTestStripeAccount(null)).toBe(false);
  });
});

describe('log-in pages', async () => {
  const { homeFor, loginFor, loginForPath, portalFor } = await import('@/lib/constants');
  it('send each kind of account to its own log-in page and home', () => {
    expect([portalFor('customer'), portalFor('restaurant'), portalFor('staff'), portalFor('admin'), portalFor('support'), portalFor(null)]).toEqual(['main', 'main', 'main', 'admin', 'admin', 'main']);
    expect([loginFor('staff'), loginFor('admin'), loginFor('customer')]).toEqual(['/login', '/admin/login', '/login']);
    expect([loginForPath('/restaurant/report'), loginForPath('/admin'), loginForPath('/orders/3')]).toEqual(['/login', '/admin/login', '/login']);
    expect(homeFor('staff')).toBe('/restaurant');
  });
});

describe('password reset email', () => {
  it('shows every digit Supabase sends (6 or 8)', async () => {
    const { passwordResetEmail } = await import('@/lib/email/templates');
    for (const code of ['123456', '81619168']) {
      const e = passwordResetEmail({ username: 'sam', code, minutes: 60 });
      expect(e.subject).toContain(code);
      expect(e.html).toContain(`Your ${code.length}-digit code`);
    }
  });
});

describe('United States and Canada', () => {
  const company = { entity: 'Bite Wise', email: 'support@bitewise.app', address: 'Seattle', serviceFee: { mode: 'percent' as const, bps: 500, fixedCents: 99 }, graceMinutes: 10, monthlyPrice: 15, annualPrice: 150, foundingSpots: 50 };
  it('asks people to accept the documents of their country', async () => {
    const { requiredDocuments } = await import('@/lib/legal/documents');
    expect(requiredDocuments('customer', 'CA').map((d) => d.id)).toEqual(['customer-terms-ca', 'privacy-ca']);
    expect(requiredDocuments('restaurant', 'CA').map((d) => d.id)).toEqual(['restaurant-agreement-ca', 'privacy-ca']);
    expect(requiredDocuments('restaurant', 'US').map((d) => d.id)).toEqual(['restaurant-agreement', 'privacy']);
  });
  it('writes the US documents for the whole country and the Canadian ones for Canada', async () => {
    const { renderDocument } = await import('@/lib/legal/documents');
    for (const id of ['customer-terms', 'restaurant-agreement']) {
      const html = renderDocument(id, company)!.html;
      expect(html).not.toMatch(/King County|RCW|Washington State|State of Washington/);
      expect(html).toContain('United States');
    }
    const ca = renderDocument('customer-terms-ca', company)!.html;
    expect(ca).toMatch(/province or territory/);
    expect(ca).toContain('/legal/privacy-ca');
    expect(renderDocument('restaurant-agreement-ca', company)!.html).toMatch(/GST\/HST/);
    expect(renderDocument('privacy-ca', company)!.html).toMatch(/PIPEDA/);
  });
  it('knows the sales tax on restaurant meals in every province', async () => {
    const { lookupTaxRate } = await import('@/lib/tax/lookup');
    const on = await lookupTaxRate({ address: '1 Main St', city: 'Toronto', state: 'ON', zip: 'M5V 2T6', country: 'CA' });
    expect(on).toMatchObject({ rateBps: 1300, accuracy: 'address', failed: false });
    expect((await lookupTaxRate({ address: '1 Rue', city: 'Montréal', state: 'QC', zip: 'H2X 1Y4', country: 'CA' })).rateBps).toBe(1498);
    expect((await lookupTaxRate({ address: '1 St', city: 'Calgary', state: 'AB', zip: 'T2P 1J9', country: 'CA' })).rateBps).toBe(500);
  });
  it('checks postal codes for the country', async () => {
    const { normalizePostal, validRegion } = await import('@/lib/regions');
    expect(normalizePostal('CA', 'k1a0b1')).toBe('K1A 0B1');
    expect(normalizePostal('CA', '98101')).toBeNull();
    expect(normalizePostal('US', '98101')).toBe('98101');
    expect(validRegion('CA', 'ON')).toBe(true);
    expect(validRegion('US', 'ON')).toBe(false);
  });
});

describe('postal codes', () => {
  it('accepts real Canadian postal codes in any form, and their first 3 characters for a home area', async () => {
    const { formatPostalInput, normalizeHomePostal, normalizePostal } = await import('@/lib/regions');
    for (const [typed, stored] of [['M5V 3L9', 'M5V 3L9'], ['m5v3l9', 'M5V 3L9'], ['T2P-1J9', 'T2P 1J9'], ['A1C 5H6', 'A1C 5H6'], [' h2x 1y4 ', 'H2X 1Y4']]) {
      expect(normalizePostal('CA', typed)).toBe(stored);
      expect(normalizeHomePostal('CA', typed)).toBe(stored);
    }
    expect(normalizeHomePostal('CA', 'm5v')).toBe('M5V');
    expect(normalizePostal('CA', 'M5V')).toBeNull(); // a restaurant needs its full code
    expect(normalizeHomePostal('CA', '98101')).toBeNull();
    expect(normalizeHomePostal('US', '98101')).toBe('98101');
    expect(formatPostalInput('CA', 'm5v3l9')).toBe('M5V 3L9');
    expect(formatPostalInput('CA', 'M5V 3')).toBe('M5V 3');
  });
});

describe('distances', () => {
  it('shows miles in the US and kilometres in Canada', async () => {
    const { distanceText, distanceUnit } = await import('@/lib/format');
    expect(distanceText(0.4, distanceUnit('US'))).toBe('0.4 mi');
    expect(distanceText(0.4, distanceUnit('CA'))).toBe('0.6 km');
    expect(distanceText(10, distanceUnit('CA'))).toBe('16.1 km');
  });
});
