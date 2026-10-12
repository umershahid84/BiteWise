import { CA_PROVINCES, provinceByCode } from '@/lib/tax/provinces';
import { stateByCode, US_STATES } from '@/lib/tax/states';

// The two countries Bite Wise serves. The country decides which terms people accept (src/lib/legal/documents.ts),
// and, with the state or province, the sales tax on a restaurant's food (src/lib/tax).
export type Country = 'US' | 'CA';
export const COUNTRIES: { code: Country; name: string; regionLabel: string; postalLabel: string }[] = [
  { code: 'US', name: 'United States', regionLabel: 'State', postalLabel: 'ZIP code' },
  { code: 'CA', name: 'Canada', regionLabel: 'Province or territory', postalLabel: 'Postal code' },
];
export const isCountry = (v: unknown): v is Country => v === 'US' || v === 'CA';
export const countryInfo = (c: Country) => COUNTRIES.find((x) => x.code === c)!;

export const regionsOf = (c: Country) => (c === 'CA' ? CA_PROVINCES : US_STATES).map((r) => ({ code: r.code, name: r.name }));
export const regionName = (c: Country, code: string) => (c === 'CA' ? provinceByCode(code) : stateByCode(code))?.name ?? code;
export const validRegion = (c: Country, code: string) => !!(c === 'CA' ? provinceByCode(code) : stateByCode(code));

// US: 12345 or 12345-6789. Canada: A1A 1A1 (stored upper case with one space).
export function normalizePostal(c: Country, v: string) {
  const s = v.trim().toUpperCase();
  if (c === 'CA') {
    const m = /^([A-Z]\d[A-Z])\s*-?\s*(\d[A-Z]\d)$/.exec(s);
    return m ? `${m[1]} ${m[2]}` : null;
  }
  return /^\d{5}(-\d{4})?$/.test(s) ? s : null;
}

// A customer's home area: a full ZIP or postal code, or in Canada also just its first three characters (the area,
// e.g. "M5V"), which is enough to find nearby deals.
export function normalizeHomePostal(c: Country, v: string) {
  const full = normalizePostal(c, v);
  if (full || c !== 'CA') return full;
  const area = v.trim().toUpperCase().replace(/\s+/g, '');
  return /^[A-Z]\d[A-Z]$/.test(area) ? area : null;
}

// What the person sees while typing: Canadian codes in capitals with the space in the middle ("m5v3l9" → "M5V 3L9").
export function formatPostalInput(c: Country, v: string) {
  if (c !== 'CA') return v.replace(/[^\d-]/g, '').slice(0, 10);
  const s = v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  return s.length > 3 ? `${s.slice(0, 3)} ${s.slice(3)}` : s;
}

// The message when a code isn't recognised.
export const postalHelp = (c: Country) =>
  c === 'CA'
    ? 'Enter your postal code: 6 characters, letter-number-letter number-letter-number, like M5V 3L9 or T2P 1J9.'
    : 'Enter your 5-digit ZIP code, like 98101.';
