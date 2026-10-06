import 'server-only';
import { emailConfigured, sendEmail } from '@/lib/email/send';
import { applicationPendingEmail, welcomeEmail } from '@/lib/email/templates';
import { publicEnv } from '@/lib/env';
import { ensureKioskToken, kioskUrls } from '@/lib/kiosk';
import { signedAgreementPdf } from '@/lib/legal/agreement-pdf';
import { getSubscription, isPioneer, prices } from '@/lib/subscriptions';
import { supabaseAdmin } from '@/lib/supabase/admin';

// The emails a restaurant gets while joining, after Supabase's "confirm your email":
//   1. once its email is confirmed and it waits for approval: "your application is pending";
//   2. once it is approved (and its email confirmed): the welcome email, with the signed Restaurant Partner
//      Agreement attached and its kiosk link.
// Called when an email is confirmed, after sign-up, and when an admin changes a restaurant's status. Each email is
// sent at most once (claimed in restaurant_onboarding first), unless `resend` (an admin's "Send welcome email").
// Never throws: it returns what happened, so the owner console can say why an email didn't go out.
export type OnboardingResult =
  | { sent: 'welcome' | 'pending'; to: string }
  | { sent: null; reason: 'not_found' | 'suspended' | 'not_confirmed' | 'already_sent' | 'email_off' | 'failed'; to?: string; error?: string };

export async function sendOnboardingEmails(restaurantId: number, o: { resend?: boolean } = {}): Promise<OnboardingResult> {
  try {
    const db = supabaseAdmin();
    const { data: r } = await db.from('restaurants').select('id, name, status, owner_id').eq('id', restaurantId).maybeSingle();
    if (!r) return { sent: null, reason: 'not_found' };
    if (r.status === 'suspended' || r.status === 'banned' || r.status === 'deleted') return { sent: null, reason: 'suspended' };
    const { data: auth } = await db.auth.admin.getUserById(r.owner_id);
    const email = auth.user?.email;
    if (!email) return { sent: null, reason: 'not_found' };
    // The welcome email goes out when the owner confirms their email (src/app/auth/confirm/route.ts).
    if (!auth.user?.email_confirmed_at) return { sent: null, reason: 'not_confirmed', to: email };
    await db.from('restaurant_onboarding').upsert({ restaurant_id: r.id }, { onConflict: 'restaurant_id', ignoreDuplicates: true });

    const dashboardUrl = `${publicEnv.siteUrl}/restaurant`;
    const column = r.status === 'approved' ? 'welcome_email_sent_at' : 'pending_email_sent_at';
    const mark = (v: string | null) => (column === 'welcome_email_sent_at' ? { welcome_email_sent_at: v } : { pending_email_sent_at: v });
    const now = new Date().toISOString();
    let claim = db.from('restaurant_onboarding').update(mark(now)).eq('restaurant_id', r.id);
    if (!o.resend) claim = claim.is(column, null);
    const { data: claimed } = await claim.select('restaurant_id').maybeSingle();
    if (!claimed) return { sent: null, reason: 'already_sent', to: email };

    let sent = false;
    let error = '';
    try {
      if (r.status === 'approved') {
        const urls = kioskUrls(await ensureKioskToken(r.id));
        const agreement = await signedAgreementPdf(r.id, now);
        const [sub, p] = await Promise.all([getSubscription(r.id), prices()]);
        const plan = {
          founding: isPioneer(sub) ? sub!.founding_number : null, hasPlan: !!sub && sub.status !== 'expired',
          pioneerSpotsLeft: p.foundingLeft, monthlyCents: p.monthlyCents, annualCents: p.annualCents,
        };
        sent = await sendEmail({
          to: email,
          ...welcomeEmail({ restaurant: r.name, dashboardUrl, ...urls, plan }),
          attachments: [{ filename: agreement.filename, content: agreement.pdf, contentType: 'application/pdf' }],
        });
      } else {
        sent = await sendEmail({ to: email, ...applicationPendingEmail({ restaurant: r.name, dashboardUrl }) });
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      console.error(`onboarding email for restaurant ${restaurantId}:`, err);
    } finally {
      // Not sent (no SMTP configured, or an error): leave it unmarked so it goes out next time.
      if (!sent) await db.from('restaurant_onboarding').update(mark(null)).eq('restaurant_id', r.id);
    }
    if (sent) return { sent: r.status === 'approved' ? 'welcome' : 'pending', to: email };
    return error ? { sent: null, reason: 'failed', to: email, error } : { sent: null, reason: emailConfigured() ? 'failed' : 'email_off', to: email };
  } catch (err) {
    console.error(`onboarding email for restaurant ${restaurantId}:`, err);
    return { sent: null, reason: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
}

// What to tell the admin after approving a restaurant (or resending its welcome email).
export function onboardingMessage(res: OnboardingResult) {
  if (res.sent) return { ok: true, text: `${res.sent === 'welcome' ? 'Welcome' : 'Application'} email sent to ${res.to}.` };
  switch (res.reason) {
    case 'not_confirmed':
      return { ok: false, text: `The welcome email wasn't sent yet: the owner (${res.to}) hasn't confirmed their email address. It goes out automatically as soon as they do. You can resend the confirmation email from the Restaurants tab.` };
    case 'already_sent':
      return { ok: true, text: `The welcome email was already sent to ${res.to}. Use "Send welcome email" to send it again.` };
    case 'email_off':
      return { ok: false, text: 'The welcome email was not sent: the app has no email account set up (SMTP_HOST and SMTP_PASSWORD in .env.local). It will be sent once email works; use "Send welcome email" then.' };
    case 'suspended':
      return { ok: false, text: 'No email sent: the restaurant is suspended, banned or deleted.' };
    case 'not_found':
      return { ok: false, text: 'No email sent: the restaurant or its owner was not found.' };
    default:
      return { ok: false, text: `The welcome email could not be sent${res.error ? `: ${res.error}` : ''}. Check the email settings, then use "Send welcome email".` };
  }
}
