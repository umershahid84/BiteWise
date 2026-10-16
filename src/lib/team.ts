import 'server-only';
import { randomBytes } from 'node:crypto';
import { sendEmail } from '@/lib/email/send';
import { updateAccount } from '@/lib/admin-edit';
import { teamPasswordEmail, teamWelcomeEmail } from '@/lib/email/templates';
import { requestPasswordReset } from '@/lib/password-reset';
import { publicEnv } from '@/lib/env';
import { AppError, check, must } from '@/lib/errors';
import { supabaseAdmin } from '@/lib/supabase/admin';

// The admin team (supabase/migrations/20261014000200_admin_team.sql): admins have full access to the owner console;
// admin employees ('support') see Alerts, Restaurants, Customers, Orders and Live offers, and issue refunds and
// credit only when an admin allows it (can_refund). Only admins manage the team.

const db = () => supabaseAdmin();
export type TeamRole = 'admin' | 'support';
// Location: the country the member works in. They only see and act on that country's restaurants, customers and orders,
// and admins' plan-fee sales tax follows it (src/lib/subscriptions.ts).
export type TeamCountry = 'US' | 'CA';
export type TeamMember = { id: string; email: string; username: string; role: TeamRole; country: TeamCountry; canRefund: boolean; status: string; createdAt: string; lastSignInAt: string | null };

export async function listTeam(): Promise<TeamMember[]> {
  const rows = must(await db().from('profiles').select('id, email, username, role, country, can_refund, status, created_at')
    .in('role', ['admin', 'support']).neq('status', 'deleted').order('created_at'));
  const users = await Promise.all(rows.map((r) => db().auth.admin.getUserById(r.id)));
  return rows.map((r, i) => ({
    id: r.id, email: r.email, username: r.username, role: r.role as TeamRole, country: r.country === 'CA' ? 'CA' : 'US', canRefund: r.role === 'admin' || r.can_refund,
    status: r.status, createdAt: r.created_at, lastSignInAt: users[i].data.user?.last_sign_in_at ?? null,
  }));
}

export async function addTeamMember(by: string, o: { email: string; username: string; password: string; role: TeamRole; country: TeamCountry; canRefund: boolean }) {
  if ((await db().from('profiles').select('id').eq('email', o.email).maybeSingle()).data) throw new AppError(409, `An account already uses ${o.email}.`);
  if ((await db().from('profiles').select('id').eq('username', o.username).maybeSingle()).data) throw new AppError(409, `The user name ${o.username} is already taken.`);
  const token = randomBytes(32).toString('hex');
  check(await db().from('team_invites').insert({ token, role: o.role, can_refund: o.canRefund, created_by: by }));
  const { data, error } = await db().auth.admin.createUser({
    email: o.email, password: o.password, email_confirm: true, user_metadata: { username: o.username, team_invite: token },
  });
  if (error || !data.user) throw new AppError(400, error?.message.includes('Database error') ? 'We couldn\'t create this account. Check the user name.' : (error?.message ?? 'Could not create the account.'));
  check(await db().from('profiles').update({ country: o.country }).eq('id', data.user.id));
  await sendEmail({ to: o.email, ...teamWelcomeEmail({ username: o.username, role: o.role, canRefund: o.role === 'admin' || o.canRefund, loginUrl: `${publicEnv.siteUrl.replace(/\/$/, '')}/admin/login` }) });
  return data.user.id;
}

async function adminsLeft(exceptId: string) {
  const { count } = await db().from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin').eq('status', 'active').neq('id', exceptId);
  return count ?? 0;
}

export async function updateTeamMember(by: string, id: string, o: { role: TeamRole; canRefund: boolean; country?: TeamCountry }) {
  const p = must(await db().from('profiles').select('role').eq('id', id).single());
  if (p.role !== 'admin' && p.role !== 'support') throw new AppError(404, 'Team member not found.');
  if (p.role === 'admin' && o.role !== 'admin') {
    if (id === by) throw new AppError(400, 'You can\'t remove your own admin access. Ask another admin.');
    if (!(await adminsLeft(id))) throw new AppError(400, 'ResDish needs at least one admin.');
  }
  check(await db().from('profiles').update({ role: o.role, can_refund: o.role === 'admin' || o.canRefund, ...(o.country ? { country: o.country } : {}) }).eq('id', id));
}

// Checks before an admin deletes a team account (moderation.deleteAccount does the deleting).
export async function checkTeamRemoval(by: string, id: string) {
  const p = must(await db().from('profiles').select('role').eq('id', id).single());
  if (p.role !== 'admin' && p.role !== 'support') throw new AppError(404, 'Team member not found.');
  if (id === by) throw new AppError(400, 'You can\'t delete your own account here.');
  if (p.role === 'admin' && !(await adminsLeft(id))) throw new AppError(400, 'ResDish needs at least one admin.');
}

async function teamMember(id: string) {
  const p = must(await db().from('profiles').select('id, email, username, role, status').eq('id', id).single());
  if ((p.role !== 'admin' && p.role !== 'support') || p.status === 'deleted') throw new AppError(404, 'Team member not found.');
  return p;
}

// A team member's email address and user name.
export async function editTeamMember(id: string, o: { email: string; username: string }) {
  await teamMember(id);
  return updateAccount(id, o);
}

// A readable temporary password (e.g. "Kite-4827-Plum") that meets the password rules.
const WORDS = ['Apple', 'Basil', 'Cedar', 'Delta', 'Ember', 'Fable', 'Grove', 'Harbor', 'Indigo', 'Juniper', 'Kite', 'Lemon', 'Maple', 'Nova',
  'Olive', 'Pepper', 'Quartz', 'River', 'Sage', 'Tulip', 'Umber', 'Violet', 'Willow', 'Yarrow', 'Zephyr', 'Plum', 'Mint', 'Coral'];
export function temporaryPassword() {
  const b = randomBytes(4);
  return `${WORDS[b[0] % WORDS.length]}-${1000 + (b.readUInt16BE(1) % 9000)}-${WORDS[b[3] % WORDS.length]}`;
}

// Sets a team member's password. A temporary one must be changed the next time they log in (Viewer.mustChangePassword).
export async function setTeamPassword(id: string, password: string, o: { temporary: boolean; email: boolean }) {
  const p = await teamMember(id);
  const { error } = await db().auth.admin.updateUserById(id, { password, app_metadata: { must_change_password: o.temporary } });
  if (error) throw new AppError(400, error.message);
  if (o.email) {
    await sendEmail({ to: p.email, ...teamPasswordEmail({ username: p.username, password, temporary: o.temporary, loginUrl: `${publicEnv.siteUrl.replace(/\/$/, '')}/admin/login` }) });
  }
  return p;
}

// Emails a team member a code to choose a new password themselves (the Forgot password flow).
export async function sendTeamResetCode(id: string) {
  const p = await teamMember(id);
  await requestPasswordReset(p.email);
  return p;
}
