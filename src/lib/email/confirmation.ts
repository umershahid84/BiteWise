import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { publicEnv } from '@/lib/env';
import { emailConfigured } from './send';

// The sign-up confirmation email, sent by the app itself through its own SMTP account, so it is always the Bite Wise
// design in supabase/templates/confirmation.html. (When Supabase sends it, Supabase uses its own stored copy of the
// template, which stays whatever was last installed there.) Supabase only creates the account and the confirmation
// token (auth.admin.generateLink); the link in the email goes to /auth/confirm like Supabase's would.

const TEMPLATE = path.join(process.cwd(), 'supabase', 'templates', 'confirmation.html');
export const CONFIRM_SUBJECT = 'Confirm your email for Bite Wise 🍃';

export type ConfirmData = { email: string; tokenHash: string; username?: string; role?: string; restaurant?: string };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// Fills in the template's Go-template tags (the subset it uses: values, `if`, `if eq`, `else`, `end`).
export function renderConfirmation(html: string, d: ConfirmData, siteUrl = publicEnv.siteUrl) {
  const values: Record<string, string> = {
    '.SiteURL': siteUrl.replace(/\/$/, ''),
    '.TokenHash': encodeURIComponent(d.tokenHash),
    '.Email': esc(d.email),
    '.Data.username': esc(d.username ?? ''),
    '.Data.role': d.role ?? '',
    '.Data.restaurant': d.restaurant ? 'yes' : '',
    '.Data.restaurant.name': esc(d.restaurant ?? ''),
  };
  const test = (cond: string) => {
    const eq = cond.match(/^eq\s+(\S+)\s+"([^"]*)"$/);
    return eq ? values[eq[1]] === eq[2] : Boolean(values[cond]);
  };
  // The logo is attached to the email (cid:logo), so it shows without being hosted anywhere.
  let out = html.replace(/\{\{ \.SiteURL \}\}\/assets\/email-logo\.png/g, 'cid:logo');
  // Innermost `if` blocks first, until none are left.
  const block = /\{\{ if ([^}]+?) \}\}((?:(?!\{\{ if )[\s\S])*?)(?:\{\{ else \}\}((?:(?!\{\{ if )[\s\S])*?))?\{\{ end \}\}/;
  for (let m = out.match(block); m; m = out.match(block)) out = out.replace(m[0], test(m[1].trim()) ? m[2] : (m[3] ?? ''));
  return out.replace(/\{\{ (\.[\w.]+) \}\}/g, (_, k: string) => values[k] ?? '');
}

export function confirmationEmail(d: ConfirmData) {
  const link = `${publicEnv.siteUrl.replace(/\/$/, '')}/auth/confirm?token_hash=${encodeURIComponent(d.tokenHash)}&type=email`;
  return {
    subject: CONFIRM_SUBJECT,
    html: renderConfirmation(fs.readFileSync(TEMPLATE, 'utf8'), d),
    text: `Welcome to Bite Wise${d.username ? `, ${d.username}` : ''}!

${d.role === 'restaurant'
    ? `Thanks for signing up${d.restaurant ? ` ${d.restaurant}` : ''} with Bite Wise. Confirm your email and we will review your application.`
    : 'Thanks for joining Bite Wise. Confirm your email to start rescuing great restaurant food at a discount.'}

Confirm your email: ${link}

You're getting this email because ${d.email} was used to sign up for Bite Wise. If that wasn't you, ignore this email.`,
  };
}

// The app sends the confirmation email itself when it can send email and Supabase asks for confirmed emails.
// With "Confirm email" off in Supabase (the local default), sign-up logs in straight away and no email is needed.
let autoconfirm: { value: boolean; at: number } | undefined;
export async function sendsOwnConfirmation() {
  if (!emailConfigured()) return false;
  if (!autoconfirm || Date.now() - autoconfirm.at > 60_000) {
    try {
      const res = await fetch(`${publicEnv.supabaseUrl}/auth/v1/settings`, { headers: { apikey: publicEnv.supabaseKey }, signal: AbortSignal.timeout(5000) });
      const s = (await res.json()) as { mailer_autoconfirm?: boolean };
      autoconfirm = { value: Boolean(s.mailer_autoconfirm), at: Date.now() };
    } catch (err) {
      console.warn('Could not read the Supabase Auth settings; Supabase sends the confirmation email.', err instanceof Error ? err.message : err);
      return false;
    }
  }
  return !autoconfirm.value;
}
