import 'server-only';
import { randomBytes } from 'node:crypto';
import { AppError, check, must } from '@/lib/errors';
import { supabaseAdmin } from '@/lib/supabase/admin';

// Restaurant staff accounts (supabase/migrations/20261013000300_restaurant_staff.sql). The owner gives each manager
// or supervisor a user name and password; staff log in on the partner log-in page with their user name. Supabase
// Auth needs an email address, so each staff account gets an internal one that never receives email
// (….staff.bitewise.invalid); for the same reason staff can't use "Forgot password": the owner sets a new one.

const db = () => supabaseAdmin();
export const STAFF_EMAIL_DOMAIN = 'staff.bitewise.invalid';
export type StaffTitle = 'Manager' | 'Supervisor';
export type StaffMember = { userId: string; username: string; fullName: string; title: StaffTitle; status: string; createdAt: string; lastSignInAt: string | null };

export async function listStaff(restaurantId: number): Promise<StaffMember[]> {
  const rows = must(await db().from('restaurant_staff').select('user_id, full_name, title, created_at, profiles!restaurant_staff_user_id_fkey(username, status)')
    .eq('restaurant_id', restaurantId).order('created_at'));
  const users = await Promise.all(rows.map((r) => db().auth.admin.getUserById(r.user_id)));
  return rows.map((r, i) => ({
    userId: r.user_id, username: r.profiles?.username ?? '', fullName: r.full_name, title: r.title as StaffTitle,
    status: r.profiles?.status ?? 'active', createdAt: r.created_at, lastSignInAt: users[i].data.user?.last_sign_in_at ?? null,
  }));
}

export async function createStaff(restaurantId: number, ownerId: string, o: { fullName: string; username: string; password: string; title: StaffTitle }) {
  const { data: taken } = await db().from('profiles').select('id').eq('username', o.username).maybeSingle();
  if (taken) throw new AppError(409, `The user name ${o.username} is already taken. Try another, like ${o.username}${Math.floor(Math.random() * 90 + 10)}.`);
  const email = `${o.username.toLowerCase()}.${randomBytes(4).toString('hex')}@${STAFF_EMAIL_DOMAIN}`;
  // A one-time invite tells the sign-up trigger this is a staff account of this restaurant.
  const token = randomBytes(32).toString('hex');
  check(await db().from('staff_invites').insert({ token, restaurant_id: restaurantId, full_name: o.fullName, title: o.title, created_by: ownerId }));
  const { data, error } = await db().auth.admin.createUser({
    email, password: o.password, email_confirm: true,
    user_metadata: { username: o.username, staff_invite: token },
  });
  if (error || !data.user) throw new AppError(400, error?.message.includes('Database error') ? 'We couldn\'t create this account. Check the user name.' : (error?.message ?? 'Could not create the account.'));
  return data.user.id;
}

// Only staff of this restaurant can be changed by its owner.
async function ownStaff(restaurantId: number, userId: string) {
  const { data } = await db().from('restaurant_staff').select('user_id').eq('user_id', userId).eq('restaurant_id', restaurantId).maybeSingle();
  if (!data) throw new AppError(404, 'Staff member not found.');
}

export async function updateStaff(restaurantId: number, userId: string, o: { fullName: string; title: StaffTitle; password?: string; active?: boolean }) {
  await ownStaff(restaurantId, userId);
  check(await db().from('restaurant_staff').update({ full_name: o.fullName, title: o.title }).eq('user_id', userId));
  if (o.password) {
    const { error } = await db().auth.admin.updateUserById(userId, { password: o.password });
    if (error) throw new AppError(400, error.message);
  }
  if (o.active !== undefined) {
    // A paused account can't log in (and loses access at once).
    check(await db().from('profiles').update({ status: o.active ? 'active' : 'suspended', suspended_until: null }).eq('id', userId));
    const { error } = await db().auth.admin.updateUserById(userId, { ban_duration: o.active ? 'none' : '876000h' });
    if (error) throw new AppError(500, error.message);
  }
}

export async function removeStaff(restaurantId: number, userId: string) {
  await ownStaff(restaurantId, userId);
  // Offers they posted stay; the account goes.
  const { error } = await db().auth.admin.deleteUser(userId);
  if (error) throw new AppError(500, error.message);
}
