// Puts restaurants on the map at their street address. Restaurants that signed up before addresses were looked up
// sit at the middle of their ZIP code; this finds their real position (US Census geocoder, then OpenStreetMap).
//
//   npm run locate-restaurants              lists what would change (nothing is saved)
//   npm run locate-restaurants -- --yes     saves the new positions
//   add --all to look up every restaurant, including ones that already have a position of their own
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../src/lib/database.types';
import { geocodeAddress } from '../src/lib/geocode';

config({ path: '.env.local' });
config();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (see .env.example).');
const db = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const apply = process.argv.includes('--yes');
const everyone = process.argv.includes('--all');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { data: rows, error } = await db.from('restaurants').select('id, name, address, city, zip, lat, lng').neq('status', 'deleted').order('id');
  if (error) throw new Error(error.message);
  let changed = 0;
  let notFound = 0;
  for (const r of rows ?? []) {
    const { data: area } = await db.rpc('resolve_area', { p_query: r.zip.slice(0, 5) });
    const zip = area?.[0] ? { lat: area[0].lat, lng: area[0].lng } : null;
    const atZipCenter = r.lat == null || (zip && Math.abs(r.lat - zip.lat) < 1e-6 && Math.abs(r.lng! - zip.lng) < 1e-6);
    if (!everyone && !atZipCenter) continue;
    const spot = await geocodeAddress({ address: r.address, city: r.city, zip: r.zip }, { near: zip });
    await sleep(1100); // the free services ask for at most about one request a second
    if (!spot) {
      notFound++;
      console.log(`  ✗ ${r.name}: "${r.address}, ${r.city} ${r.zip}" not found; it stays where it is (drag the pin in the dashboard's Profile tab)`);
      continue;
    }
    changed++;
    console.log(`  ✓ ${r.name}: ${r.lat?.toFixed(5) ?? '–'}, ${r.lng?.toFixed(5) ?? '–'}  →  ${spot.lat.toFixed(5)}, ${spot.lng.toFixed(5)}`);
    if (apply) {
      const res = await db.from('restaurants').update({ location: `SRID=4326;POINT(${spot.lng} ${spot.lat})` }).eq('id', r.id);
      if (res.error) throw new Error(`${r.name}: ${res.error.message}`);
    }
  }
  console.log(`\n${changed} restaurant${changed === 1 ? '' : 's'} ${apply ? 'moved to their street address' : 'can be moved to their street address'}${notFound ? `, ${notFound} address${notFound === 1 ? '' : 'es'} not found` : ''}.`);
  if (!apply && changed) console.log('Nothing was saved. To save them, run:  npm run locate-restaurants -- --yes');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
