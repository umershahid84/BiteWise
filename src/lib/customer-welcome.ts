import 'server-only';
import { sendEmail } from '@/lib/email/send';
import { customerWelcomeEmail } from '@/lib/email/templates';
import { publicEnv } from '@/lib/env';
import { check } from '@/lib/errors';
import { currencyOf, money } from '@/lib/format';
import { supabaseAdmin } from '@/lib/supabase/admin';

// The congratulations email a customer gets once their email address is confirmed, with buttons to put Bite Wise
// on their phone (/app?device=...). Sent once; an admin can send it again (`resend`).
export type CustomerWelcome = { sent: true; to: string } | { sent: false; reason: 'not_found' | 'not_customer' | 'not_confirmed' | 'already_sent' | 'failed'; to?: string };

// The welcome bonus (Settings: welcome_credit_cents, $10.00 by default): platform credit a new customer gets once, when
// their email address is confirmed. Returns the amount given now (0 if it was given before, or is turned off).
export async function grantWelcomeCredit(userId: string) {
  const { data: u } = await supabaseAdmin().auth.admin.getUserById(userId);
  if (!u.user?.email_confirmed_at) return 0;
  const { data, error } = await supabaseAdmin().rpc('grant_welcome_credit', { p_user: userId });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

export async function sendCustomerWelcome(userId: string, o: { resend?: boolean } = {}): Promise<CustomerWelcome> {
  const db = supabaseAdmin();
  const { data: p } = await db.from('profiles').select('email, username, role, country, welcome_email_sent_at, welcome_credit_at').eq('id', userId).maybeSingle();
  if (!p) return { sent: false, reason: 'not_found' };
  if (p.role !== 'customer') return { sent: false, reason: 'not_customer', to: p.email };
  if (p.welcome_email_sent_at && !o.resend) return { sent: false, reason: 'already_sent', to: p.email };
  const { data: u } = await db.auth.admin.getUserById(userId);
  if (!u.user?.email_confirmed_at) return { sent: false, reason: 'not_confirmed', to: p.email };
  // The welcome bonus they got, to mention in the email.
  const bonus = p.welcome_credit_at
    ? (await db.from('credit_ledger').select('amount_cents').eq('user_id', userId).eq('note', 'Welcome bonus').maybeSingle()).data?.amount_cents ?? 0
    : 0;
  const site = publicEnv.siteUrl.replace(/\/$/, '');
  const app = (device: string) => `${site}/app?device=${device}`;
  const ok = await sendEmail({
    to: p.email,
    ...customerWelcomeEmail({ username: p.username, androidUrl: app('android'), iphoneUrl: app('iphone'), windowsUrl: app('windows'), dealsUrl: `${site}/offers`,
      welcomeCredit: bonus ? money(bonus, currencyOf(p.country)) : null }),
  });
  if (!ok) return { sent: false, reason: 'failed', to: p.email };
  check(await db.from('profiles').update({ welcome_email_sent_at: new Date().toISOString() }).eq('id', userId));
  return { sent: true, to: p.email };
}
