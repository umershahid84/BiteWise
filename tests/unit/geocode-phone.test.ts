import { describe, expect, it } from 'vitest';
import { geocodeAddress } from '@/lib/geocode';
import { displayPhone, formatPhoneInput } from '@/lib/phone';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const seattle = { lat: 47.61, lng: -122.33 };
const address = { address: '1410 2nd Ave', city: 'Seattle', zip: '98101' };

describe('address lookup', () => {
  it('uses the US Census geocoder first', async () => {
    const urls: string[] = [];
    const fetcher = (async (url: string) => {
      urls.push(url);
      return json({ result: { addressMatches: [{ coordinates: { x: -122.338512, y: 47.608713 } }] } });
    }) as unknown as typeof fetch;
    expect(await geocodeAddress(address, { near: seattle, fetcher })).toEqual({ lat: 47.608713, lng: -122.338512 });
    expect(urls[0]).toMatch(/^https:\/\/geocoding\.geo\.census\.gov\/.*street=1410\+2nd\+Ave.*zip=98101/);
  });

  it('falls back to OpenStreetMap, and ignores matches far from the ZIP code', async () => {
    const osm = (async (url: string) => (url.includes('census')
      ? json({ result: { addressMatches: [] } })
      : json([{ lat: '47.6087', lon: '-122.3385' }]))) as unknown as typeof fetch;
    expect(await geocodeAddress(address, { near: seattle, fetcher: osm })).toEqual({ lat: 47.6087, lng: -122.3385 });

    const faraway = (async () => json({ result: { addressMatches: [{ coordinates: { x: -71.06, y: 42.36 } }] } })) as unknown as typeof fetch; // Boston
    const none = (async (url: string) => (url.includes('census') ? faraway(url) : json([]))) as unknown as typeof fetch;
    expect(await geocodeAddress(address, { near: seattle, fetcher: none })).toBeNull();
  });

  it('returns null when the services are down', async () => {
    const down = (async () => json({}, 503)) as unknown as typeof fetch;
    expect(await geocodeAddress(address, { near: seattle, fetcher: down })).toBeNull();
  });
});

describe('phone numbers', () => {
  it('formats as you type', () => {
    expect(formatPhoneInput('2')).toBe('(2');
    expect(formatPhoneInput('206')).toBe('(206');
    expect(formatPhoneInput('2065')).toBe('(206) 5');
    expect(formatPhoneInput('206555012')).toBe('(206) 555-012');
    expect(formatPhoneInput('2065550123')).toBe('(206) 555-0123');
    expect(formatPhoneInput('+1 206.555.0123 ext 9')).toBe('(206) 555-0123');
    expect(formatPhoneInput('abc')).toBe('');
  });
  it('shows complete numbers formatted and leaves others alone', () => {
    expect(displayPhone('206-555-0123')).toBe('(206) 555-0123');
    expect(displayPhone('555-01')).toBe('555-01');
    expect(displayPhone(null)).toBe('');
  });
});
