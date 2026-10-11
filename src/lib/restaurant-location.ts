import 'server-only';
import { geocodeAddress, type Point } from '@/lib/geocode';
import { supabaseAdmin } from '@/lib/supabase/admin';

// A restaurant's map position: its street address when it can be found, otherwise the middle of its ZIP code.
export async function locateRestaurant(a: { address: string; city: string; zip: string; state?: string; country?: 'US' | 'CA' }): Promise<(Point & { source: 'address' | 'zip' }) | null> {
  // The ZIP code's center (US ZIP codes only), to check the address match and to fall back on.
  const { data } = a.country === 'CA' ? { data: null } : await supabaseAdmin().rpc('resolve_area', { p_query: a.zip.slice(0, 5) });
  const zip = data?.[0] ? { lat: data[0].lat, lng: data[0].lng } : null;
  const found = await geocodeAddress(a, { near: zip });
  if (found) return { ...found, source: 'address' };
  return zip && { ...zip, source: 'zip' };
}
