import { CA_PROVINCES, provinceByCode } from '@/lib/tax/provinces';
import { stateByCode, US_STATES } from '@/lib/tax/states';

// The two countries ResDish serves. The country decides which terms people accept (src/lib/legal/documents.ts),
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

// The city line of an address: "Seattle, WA 98101", "St. John's, NL A1H 0G5".
type Place = { city: string; state?: string | null; zip: string; country?: string | null };
export const cityLine = (r: Place) => `${r.city}${r.state ? `, ${r.state}` : ''} ${r.zip}`.trim();
// A Google Maps link to a place, with its country so the right one is found.
export const mapUrl = (r: Place & { name?: string; address: string }) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    [r.name, r.address, cityLine(r), r.country === 'CA' ? 'Canada' : 'USA'].filter(Boolean).join(', '),
  )}`;
// Driving directions to a place in the phone's own maps app: Apple Maps on iPhones, iPads and Macs (their built-in
// maps), Google Maps everywhere else (Android's default; on a computer it opens in the browser). Both start from
// where the person is now. The address is used rather than the map pin, so a pin placed at the middle of a ZIP code
// never sends anyone to the wrong place.
export const isApple = (userAgent: string) => /iPhone|iPad|iPod|Macintosh/i.test(userAgent);
export function directionsUrl(r: Place & { address: string }, userAgent = '') {
  const to = encodeURIComponent([r.address, cityLine(r), r.country === 'CA' ? 'Canada' : 'USA'].filter(Boolean).join(', '));
  return isApple(userAgent)
    ? `https://maps.apple.com/?daddr=${to}&dirflg=d`
    : `https://www.google.com/maps/dir/?api=1&destination=${to}&travelmode=driving`;
}
