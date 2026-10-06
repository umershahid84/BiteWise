import { serverEnv } from '@/lib/env';

// Finds a restaurant's map position from its street address, so offers show at the restaurant and not at the middle
// of its ZIP code. Two free services, no API key:
//   1. the US Census Bureau geocoder (official US street data);
//   2. OpenStreetMap's Nominatim (fair-use: one request a second, with a contact in the User-Agent).
// A result far from the ZIP code (more than 25 miles) is ignored as a wrong match. Returns null when the address
// can't be found (the caller then falls back to the ZIP code). GEOCODING=off turns lookups off.

export type Point = { lat: number; lng: number };
type Address = { address: string; city: string; zip: string; state?: string };
type Fetch = typeof fetch;

const TIMEOUT_MS = 6000;
const MAX_MILES_FROM_ZIP = 25;

function miles(a: Point, b: Point) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

const valid = (p: Point) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

async function getJson(fetcher: Fetch, url: string) {
  const res = await fetcher(url, {
    headers: { 'User-Agent': `BiteWise/1.0 (${serverEnv.legal.email})`, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function census(a: Address, fetcher: Fetch): Promise<Point | null> {
  const q = new URLSearchParams({ street: a.address, city: a.city, state: a.state ?? 'WA', zip: a.zip.slice(0, 5), benchmark: 'Public_AR_Current', format: 'json' });
  const data = await getJson(fetcher, `https://geocoding.geo.census.gov/geocoder/locations/address?${q}`);
  const c = data?.result?.addressMatches?.[0]?.coordinates;
  return c ? { lat: Number(c.y), lng: Number(c.x) } : null;
}

async function nominatim(a: Address, fetcher: Fetch): Promise<Point | null> {
  const q = new URLSearchParams({ street: a.address, city: a.city, state: a.state ?? 'WA', postalcode: a.zip.slice(0, 5), countrycodes: 'us', format: 'jsonv2', limit: '1' });
  const data = await getJson(fetcher, `https://nominatim.openstreetmap.org/search?${q}`);
  const r = Array.isArray(data) ? data[0] : null;
  return r ? { lat: Number(r.lat), lng: Number(r.lon) } : null;
}

export async function geocodeAddress(a: Address, o: { near?: Point | null; fetcher?: Fetch } = {}): Promise<Point | null> {
  if (process.env.GEOCODING === 'off' || !a.address.trim()) return null;
  const fetcher = o.fetcher ?? fetch;
  for (const service of [census, nominatim]) {
    try {
      const p = await service(a, fetcher);
      if (!p || !valid(p)) continue;
      if (o.near && miles(p, o.near) > MAX_MILES_FROM_ZIP) continue; // matched a street of the same name elsewhere
      return { lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 };
    } catch (err) {
      console.warn(`address lookup (${service.name}) failed for "${a.address}, ${a.city} ${a.zip}":`, err instanceof Error ? err.message : err);
    }
  }
  return null;
}
