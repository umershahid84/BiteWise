import 'server-only';
import { sendEmail } from '@/lib/email/send';
import { customerWelcomeEmail } from '@/lib/email/templates';
import { publicEnv } from '@/lib/env';
import { check } from '@/lib/errors';
import { supabaseAdmin } from '@/lib/supabase/admin';

// The congratulations email a customer gets once their email address is confirmed, with buttons to put Bite Wise
// on their phone (/app?device=...). Sent once; an admin can send it again (`resend`).
export type CustomerWelcome = { sent: true; to: string } | { sent: false; reason: 'not_found' | 'not_customer' | 'not_confirmed' | 'already_sent' | 'failed'; to?: string };

export async function sendCustomerWelcome(userId: string, o: { resend?: boolean } = {}): Promise<CustomerWelcome> {
  const db = supabaseAdmin();
  const { data: p } = await db.from('profiles').select('email, username, role, welcome_email_sent_at').eq('id', userId).maybeSingle();
  if (!p) return { sent: false, reason: 'not_found' };
  if (p.role !== 'customer') return { sent: false, reason: 'not_customer', to: p.email };
  if (p.welcome_email_sent_at && !o.resend) return { sent: false, reason: 'already_sent', to: p.email };
  const { data: u } = await db.auth.admin.getUserById(userId);
  if (!u.user?.email_confirmed_at) return { sent: false, reason: 'not_confirmed', to: p.email };
  const site = publicEnv.siteUrl.replace(/\/$/, '');
  const app = (device: string) => `${site}/app?device=${device}`;
  const ok = await sendEmail({
    to: p.email,
    ...customerWelcomeEmail({ username: p.username, androidUrl: app('android'), iphoneUrl: app('iphone'), windowsUrl: app('windows'), dealsUrl: `${site}/offers` }),
  });
  if (!ok) return { sent: false, reason: 'failed', to: p.email };
  check(await db.from('profiles').update({ welcome_email_sent_at: new Date().toISOString() }).eq('id', userId));
  return { sent: true, to: p.email };
}
