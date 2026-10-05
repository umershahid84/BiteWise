import 'server-only';
import { sendEmail } from '@/lib/email/send';
import { applicationPendingEmail, welcomeEmail } from '@/lib/email/templates';
import { publicEnv } from '@/lib/env';
import { ensureKioskToken, kioskUrls } from '@/lib/kiosk';
import { signedAgreementPdf } from '@/lib/legal/agreement-pdf';
import { supabaseAdmin } from '@/lib/supabase/admin';

// The emails a restaurant gets while joining, after Supabase's "confirm your email":
//   1. once its email is confirmed and it waits for approval: "your application is pending";
//   2. once it is approved (and its email confirmed): the welcome email, with the signed Restaurant Partner
//      Agreement attached and its kiosk link.
// Called when an email is confirmed, after sign-up, and when an admin changes a restaurant's status. Each email is
// sent at most once (claimed in restaurant_onboarding first). Problems are logged, never thrown at the caller.
export async function sendOnboardingEmails(restaurantId: number) {
  try {
    const db = supabaseAdmin();
    const { data: r } = await db.from('restaurants').select('id, name, status, owner_id').eq('id', restaurantId).maybeSingle();
    if (!r || r.status === 'suspended') return;
    const { data: auth } = await db.auth.admin.getUserById(r.owner_id);
    const email = auth.user?.email;
    if (!email || !auth.user?.email_confirmed_at) return;
    await db.from('restaurant_onboarding').upsert({ restaurant_id: r.id }, { onConflict: 'restaurant_id', ignoreDuplicates: true });

    const dashboardUrl = `${publicEnv.siteUrl}/restaurant`;
    const column = r.status === 'approved' ? 'welcome_email_sent_at' : 'pending_email_sent_at';
    const mark = (v: string | null) => (column === 'welcome_email_sent_at' ? { welcome_email_sent_at: v } : { pending_email_sent_at: v });
    const now = new Date().toISOString();
    const { data: claimed } = await db.from('restaurant_onboarding').update(mark(now))
      .eq('restaurant_id', r.id).is(column, null).select('restaurant_id').maybeSingle();
    if (!claimed) return; // already sent

    let sent = false;
    try {
      if (r.status === 'approved') {
        const urls = kioskUrls(await ensureKioskToken(r.id));
        const agreement = await signedAgreementPdf(r.id, now);
        sent = await sendEmail({
          to: email,
          ...welcomeEmail({ restaurant: r.name, dashboardUrl, ...urls }),
          attachments: [{ filename: agreement.filename, content: agreement.pdf, contentType: 'application/pdf' }],
        });
      } else {
        sent = await sendEmail({ to: email, ...applicationPendingEmail({ restaurant: r.name, dashboardUrl }) });
      }
    } finally {
      // Not sent (no SMTP configured, or an error): leave it unmarked so it goes out next time.
      if (!sent) await db.from('restaurant_onboarding').update(mark(null)).eq('restaurant_id', r.id);
    }
  } catch (err) {
    console.error(`onboarding email for restaurant ${restaurantId}:`, err);
  }
}
