import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import type { Database } from '@/lib/database.types';
import { homeFor, LOGIN_PATH, portalFor, type Role } from '@/lib/constants';
import { AppError, must } from '@/lib/errors';
import { supabaseServer } from '@/lib/supabase/server';

export type Viewer = {
  id: string;
  email: string;
  username: string;
  role: Role;
  restaurant: { id: number; name: string; status: Database['public']['Enums']['restaurant_status'] } | null;
  // Restaurant staff (managers, supervisors): their restaurant is in `restaurant`.
  staff: { fullName: string; title: string } | null;
  creditCents: number;
  pendingTerms: { id: string; title: string; version: string }[];
};

// The signed-in user (verified with Supabase Auth), or null. Cached for the rest of the request.
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', auth.user.id).maybeSingle();
  if (!profile || profile.status !== 'active') return null;

  const [restaurant, credit, pending, staff] = await Promise.all([
    profile.role === 'restaurant'
      ? supabase.from('restaurants').select('id, name, status').eq('owner_id', profile.id).maybeSingle()
      : Promise.resolve({ data: null }),
    profile.role === 'customer' ? supabase.rpc('my_credit_balance') : Promise.resolve({ data: 0 }),
    profile.role === 'admin' || profile.role === 'staff' ? Promise.resolve({ data: [] }) : supabase.rpc('pending_terms'),
    profile.role === 'staff'
      ? supabase.from('restaurant_staff').select('full_name, title, restaurants(id, name, status)').eq('user_id', profile.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  // Staff of a banned or deleted restaurant can't sign in.
  const staffOf = staff.data?.restaurants;
  if (profile.role === 'staff' && (!staffOf || staffOf.status === 'banned' || staffOf.status === 'deleted')) return null;

  return {
    id: profile.id,
    email: profile.email,
    username: profile.username,
    role: profile.role,
    restaurant: restaurant.data ?? staffOf ?? null,
    staff: staff.data ? { fullName: staff.data.full_name, title: staff.data.title } : null,
    creditCents: Number(credit.data ?? 0),
    pendingTerms: (pending.data ?? []).map((d) => ({ id: d.id, title: d.title, version: d.version })),
  };
});

// For pages: sends visitors to the log-in page, and users with another role to their own home page.
// `role` may list several roles (e.g. the restaurant dashboard: owners and staff).
export async function requirePageViewer(role?: Role | Role[]): Promise<Viewer> {
  const roles = role === undefined ? null : Array.isArray(role) ? role : [role];
  const viewer = await getViewer();
  if (!viewer) redirect(LOGIN_PATH[portalFor(roles?.[0])]);
  if (roles && !roles.includes(viewer.role)) redirect(homeFor(viewer.role));
  return viewer;
}

// For Server Actions and Route Handlers: throws unless the caller has the role and has accepted
// the current terms.
export async function requireActor(role?: Role): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) throw new AppError(401, 'Please log in.');
  if (role && viewer.role !== role) throw new AppError(403, 'This page is not available for your account type.');
  if (viewer.pendingTerms.length) throw new AppError(403, 'Please review and accept our updated terms to continue.', 'terms_required');
  return viewer;
}

// The restaurant owner; with `staff: true`, also the restaurant's staff (posting offers, the menu, handing orders
// over). Payouts, billing, reports, the kiosk link, the profile and staff accounts are for the owner only.
export async function requireRestaurant(o: { staff?: boolean } = {}) {
  const viewer = await getViewer();
  if (!viewer) throw new AppError(401, 'Please log in.');
  if (viewer.role === 'staff' && !o.staff) throw new AppError(403, 'Only the restaurant owner can do this.');
  if (viewer.role !== 'restaurant' && viewer.role !== 'staff') throw new AppError(403, 'This page is not available for your account type.');
  if (viewer.pendingTerms.length) throw new AppError(403, 'Please review and accept our updated terms to continue.', 'terms_required');
  if (!viewer.restaurant) throw new AppError(404, 'Restaurant profile not found.');
  return { viewer, restaurant: viewer.restaurant };
}

export { must };
