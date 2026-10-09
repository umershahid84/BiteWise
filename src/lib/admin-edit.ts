import 'server-only';
import { AppError, check, must } from '@/lib/errors';
import { locateRestaurant } from '@/lib/restaurant-location';
import { refreshRestaurantTax } from '@/lib/restaurant-tax';
import { supabaseAdmin } from '@/lib/supabase/admin';

// Admins correcting account details: a user's email address and user name, and a restaurant's details. An email
// address an admin enters counts as confirmed (the admin vouches for it); the profile follows the change through the
// on_auth_user_email_changed trigger. Returns what changed, for the audit log.

const db = () => supabaseAdmin();

export async function updateAccount(userId: string, o: { email?: string; username?: string }) {
  const p = must(await db().from('profiles').select('email, username, status').eq('id', userId).single());
  if (p.status === 'deleted') throw new AppError(400, 'This account was deleted.');
  const changed: string[] = [];
  if (o.username && o.username !== p.username) {
    const { data: taken } = await db().from('profiles').select('id').eq('username', o.username).neq('id', userId).maybeSingle();
    if (taken) throw new AppError(409, `The user name ${o.username} is already taken.`);
    check(await db().from('profiles').update({ username: o.username }).eq('id', userId));
    changed.push(`username ${p.username} → ${o.username}`);
  }
  if (o.email && o.email !== p.email) {
    const { data: taken } = await db().from('profiles').select('id').eq('email', o.email).neq('id', userId).maybeSingle();
    if (taken) throw new AppError(409, `Another account already uses ${o.email}.`);
    const { error } = await db().auth.admin.updateUserById(userId, { email: o.email, email_confirm: true });
    if (error) throw new AppError(400, error.message);
    changed.push(`email ${p.email} → ${o.email}`);
  }
  return changed;
}

type RestaurantFields = { name: string; cuisine: string; description: string; address: string; city: string; state: string; zip: string; phone: string };

export async function updateRestaurantDetails(restaurantId: number, f: RestaurantFields) {
  const r = must(await db().from('restaurants').select('name, cuisine, description, address, city, state, zip, phone').eq('id', restaurantId).single());
  const changed = (Object.keys(f) as (keyof RestaurantFields)[]).filter((k) => r[k] !== f[k]);
  if (!changed.length) return changed;
  const moved = (['address', 'city', 'state', 'zip'] as const).some((k) => r[k] !== f[k]);
  // A new address moves the map pin to it (or to the ZIP code's center) and can change the sales tax rate.
  const spot = moved ? await locateRestaurant(f) : null;
  check(await db().from('restaurants').update({
    ...f, ...(spot ? { location: `SRID=4326;POINT(${spot.lng} ${spot.lat})` } : {}),
  }).eq('id', restaurantId));
  if (moved) await refreshRestaurantTax(restaurantId).catch((err) => console.warn('tax rate lookup failed:', err instanceof Error ? err.message : err));
  return changed;
}
