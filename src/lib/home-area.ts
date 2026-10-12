import 'server-only';
import { AppError, check } from '@/lib/errors';
import { geocodePostal } from '@/lib/geocode';
import { normalizeHomePostal, postalHelp, type Country } from '@/lib/regions';
import { supabaseAdmin } from '@/lib/supabase/admin';

// A customer's home area: their ZIP code (US) or postal code (Canada) and its map position. The deals page opens
// around it, nearest deals first. When the code can't be located on the map, deals are matched by the code itself.
export async function saveHomeArea(userId: string, country: Country, postal: string) {
  const code = normalizeHomePostal(country, postal);
  if (!code) throw new AppError(400, postalHelp(country));
  const spot = await homeSpot(country, code);
  check(await supabaseAdmin().from('profiles').update({ postal_code: code, home_lat: spot?.lat ?? null, home_lng: spot?.lng ?? null }).eq('id', userId));
  return { postalCode: code, located: !!spot };
}

// The ZIP codes the app knows (the zips table) need no lookup; anything else asks the map service.
async function homeSpot(country: Country, code: string) {
  if (country === 'US') {
    const { data } = await supabaseAdmin().rpc('resolve_area', { p_query: code.slice(0, 5) });
    if (data?.[0]) return { lat: data[0].lat, lng: data[0].lng };
  }
  return geocodePostal(country, code).catch(() => null);
}
