import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { portalFor, type Portal } from '@/lib/constants';
import { sendEmail } from '@/lib/email/send';
import { passwordResetEmail } from '@/lib/email/templates';
import { publicEnv } from '@/lib/env';
import { AppError, check } from '@/lib/errors';
import { supabaseAdmin } from '@/lib/supabase/admin';

// Forgot password: the user types their email (or user name), gets a 6-digit code by email, and types the code with
// a new password. Supabase Auth makes and checks the code (a password recovery one-time code, valid for an hour);
// Bite Wise sends it in its own email. Limits: one code a minute, and 5 wrong tries per code.
// Staff accounts have no email address of their own: the restaurant owner resets their password.

const RESEND_SECONDS = 60;
export const MAX_ATTEMPTS = 5;
const CODE_MINUTES = 60;

type Account = { id: string; email: string; username: string; role: Database['public']['Enums']['user_role']; password_reset_sent_at: string | null; password_reset_attempts: number };

async function findAccount(login: string): Promise<Account | null> {
  const db = supabaseAdmin().from('profiles').select('id, email, username, role, password_reset_sent_at, password_reset_attempts');
  const { data } = await (login.includes('@') ? db.eq('email', login.toLowerCase()) : db.eq('username', login)).maybeSingle();
  return data;
}

const STAFF = 'Staff accounts don\'t have an email address. Ask your restaurant owner to reset your password in the Staff tab of the restaurant portal.';

// The answer is the same whether or not the account exists, so the form can't be used to look accounts up.
export async function requestPasswordReset(login: string) {
  const account = await findAccount(login);
  if (!account) return;
  if (account.role === 'staff') throw new AppError(400, STAFF);
  const last = account.password_reset_sent_at ? Date.parse(account.password_reset_sent_at) : 0;
  if (Date.now() - last < RESEND_SECONDS * 1000) throw new AppError(429, 'A code was sent less than a minute ago. Please check your email, or wait a minute and try again.');
  const { data, error } = await supabaseAdmin().auth.admin.generateLink({ type: 'recovery', email: account.email });
  if (error || !data.properties.email_otp) {
    console.error('password reset code:', error?.message ?? 'no code returned');
    throw new AppError(500, 'We couldn\'t send a code right now. Please try again in a few minutes.');
  }
  check(await supabaseAdmin().from('profiles').update({ password_reset_sent_at: new Date().toISOString(), password_reset_attempts: 0 }).eq('id', account.id));
  await sendEmail({ to: account.email, ...passwordResetEmail({ username: account.username, code: data.properties.email_otp, minutes: CODE_MINUTES }) });
}

const WRONG = 'That code is wrong or has expired. Check the latest email from Bite Wise, or ask for a new code.';

// Checks the code and sets the new password. Returns the page to log in on.
export async function resetPassword(login: string, code: string, password: string): Promise<Portal> {
  const account = await findAccount(login);
  if (!account || account.role === 'staff' || !account.password_reset_sent_at) throw new AppError(400, WRONG);
  if (account.password_reset_attempts >= MAX_ATTEMPTS) {
    throw new AppError(429, 'Too many wrong codes. Please ask for a new code.', 'reset_locked');
  }
  // A throwaway client: checking the code signs the user in, which this flow doesn't keep.
  const auth = createClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } }).auth;
  const { data, error } = await auth.verifyOtp({ email: account.email, token: code, type: 'recovery' });
  if (error || data.user?.id !== account.id) {
    const attempts = account.password_reset_attempts + 1;
    await supabaseAdmin().from('profiles').update({ password_reset_attempts: attempts }).eq('id', account.id);
    if (attempts >= MAX_ATTEMPTS) throw new AppError(429, 'Too many wrong codes. Please ask for a new code.', 'reset_locked');
    throw new AppError(400, `${WRONG} (${MAX_ATTEMPTS - attempts} ${MAX_ATTEMPTS - attempts === 1 ? 'try' : 'tries'} left)`);
  }
  const { error: updateError } = await supabaseAdmin().auth.admin.updateUserById(account.id, { password });
  await auth.signOut().catch(() => undefined);
  if (updateError) {
    if (/should be different|same password/i.test(updateError.message)) throw new AppError(400, 'Please choose a password you haven\'t used for this account before.');
    throw new AppError(400, updateError.message);
  }
  // The code is used up.
  check(await supabaseAdmin().from('profiles').update({ password_reset_attempts: MAX_ATTEMPTS, password_reset_sent_at: null }).eq('id', account.id));
  return portalFor(account.role);
}
