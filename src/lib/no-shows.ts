import 'server-only';
import { sendEmail } from '@/lib/email/send';
import { adminAlertEmail, noShowBannedEmail, noShowSuspendedEmail, noShowWarningEmail } from '@/lib/email/templates';
import { publicEnv } from '@/lib/env';
import { must } from '@/lib/errors';
import { BAN, cancelOpenOrders, setLoginBan } from '@/lib/moderation';
import { supabaseAdmin } from '@/lib/supabase/admin';

// Missed pickups (supabase/migrations/20261011000100_no_shows_alerts_plan_tax.sql). The database counts a customer's
// consecutive no-shows when their orders expire, and suspends (3 in a row: 30 days) or bans (the first one after that
// suspension) the account in the same transaction, recording an admin alert. This job then finishes the work for
// each new alert: blocks the login (for the suspension's length, or for good), cancels open orders, and emails the
// customer and every admin. Run by the scheduled jobs (src/lib/jobs.ts) right after the sweep that expires orders.

const db = () => supabaseAdmin();
const setting = (rows: { key: string; value: unknown }[], key: string, fallback: number) => Number(rows.find((r) => r.key === key)?.value ?? fallback);

export async function noShowRules() {
  const rows = must(await db().from('settings').select('key, value').in('key', ['no_show_limit', 'no_show_suspension_days']));
  return { limit: setting(rows, 'no_show_limit', 3), days: setting(rows, 'no_show_suspension_days', 30) };
}

export async function processAlerts() {
  const pending = must(await db().from('admin_alerts').select('*').is('processed_at', null).order('id').limit(100));
  if (!pending.length) return { alerts: 0 };
  const rules = await noShowRules();
  const admins = must(await db().from('profiles').select('email').eq('role', 'admin').eq('status', 'active')).map((a) => a.email);
  const consoleUrl = `${publicEnv.siteUrl}/admin#alerts`;
  let done = 0;
  for (const alert of pending) {
    // Claim it first, so two job runs never act on (or email about) the same alert twice.
    const claimed = must(await db().from('admin_alerts').update({ processed_at: new Date().toISOString() }).eq('id', alert.id).is('processed_at', null).select('id'));
    if (!claimed.length || !alert.user_id) continue;
    try {
      const p = must(await db().from('profiles').select('id, username, email, status, suspended_until, no_show_probation, no_shows_total').eq('id', alert.user_id).single());
      const send = (email: { subject: string; html: string; text: string }) =>
        sendEmail({ to: p.email, ...email }).catch((err) => console.error(`no-show email to ${p.email}:`, err));

      if (alert.kind === 'no_show') {
        const order = alert.order_id ? (await db().from('orders').select('id, item_title, restaurants(name)').eq('id', alert.order_id).maybeSingle()).data : null;
        await send(noShowWarningEmail({
          username: p.username, orderId: alert.order_id ?? 0, item: order?.item_title ?? 'your order', restaurant: order?.restaurants?.name ?? 'the restaurant',
          strikes: alert.strikes, limit: rules.limit, probation: p.no_show_probation, ordersUrl: `${publicEnv.siteUrl}/orders`,
        }));
      } else {
        const banned = alert.kind === 'no_show_ban';
        // The account may have been changed by an admin since; only act if it's still suspended/banned.
        if ((banned && p.status === 'banned') || (!banned && p.status === 'suspended')) {
          const hours = !banned && p.suspended_until ? Math.max(1, Math.ceil((Date.parse(p.suspended_until) - Date.now()) / 3_600_000)) : 0;
          await setLoginBan(p.id, banned ? BAN : `${hours}h`);
          await cancelOpenOrders('user_id', p.id);
          await send(banned
            ? noShowBannedEmail({ username: p.username })
            : noShowSuspendedEmail({ username: p.username, strikes: alert.strikes, days: rules.days, until: p.suspended_until! }));
        }
        const title = banned ? `${p.username} was banned for missed pickups` : `${p.username} was suspended for ${rules.days} days for missed pickups`;
        for (const to of admins) {
          await sendEmail({ to, ...adminAlertEmail({ title, message: alert.message, customer: p.username, email: p.email, noShowsTotal: p.no_shows_total, consoleUrl }) })
            .catch((err) => console.error(`admin alert email to ${to}:`, err));
        }
      }
      done++;
    } catch (err) {
      console.error(`acting on admin alert ${alert.id}:`, err);
      // Let the next run try again.
      await db().from('admin_alerts').update({ processed_at: null }).eq('id', alert.id);
    }
  }
  return { alerts: done };
}
