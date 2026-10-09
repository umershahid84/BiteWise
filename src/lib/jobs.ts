import 'server-only';
import { applyDuePriceChanges } from '@/lib/fee-changes';
import { processAlerts } from '@/lib/no-shows';
import { sweep } from '@/lib/orders';
import { refreshDueTaxRates } from '@/lib/restaurant-tax';
import { renewDue } from '@/lib/subscriptions';
import { supabaseAdmin } from '@/lib/supabase/admin';

// The app's scheduled work: the cleanup sweep (stale checkouts, missed pickups, card holds), no-show suspensions and
// bans, subscription fee changes that take effect, and restaurant plan renewals and reminders. Run by /api/cron/sweep
// and, on a self-hosted server, every few minutes by src/instrumentation.ts.
// Fee changes that take effect are applied first, so renewals charged in the same run use the new prices.
export async function runScheduledJobs() {
  const priceChanges = await applyDuePriceChanges();
  const swept = await sweep();
  // Missed pickups the sweep just recorded: suspensions, bans and emails.
  const noShows = await processAlerts();
  const subscriptions = await renewDue();
  // Sales tax rates for new addresses, and every 30 days (after renewals, so a slow lookup never delays them).
  const taxRates = await refreshDueTaxRates();
  return { ...swept, noShows, priceChanges, subscriptions, taxRates };
}

// Null when the database has the tables this version of the app needs; otherwise what to do about it. Checked by
// src/instrumentation.ts, so a database that is missing an update gets one clear message instead of an error every
// few minutes.
export async function databaseNotReady() {
  // The newest table and column (20261014000200_admin_team.sql); staff_invites is from 20261013000300.
  const checks = await Promise.all([
    supabaseAdmin().from('team_invites').select('token').limit(1),
    supabaseAdmin().from('staff_invites').select('token').limit(1),
    supabaseAdmin().from('profiles').select('can_refund').limit(1),
  ]);
  const error = checks.find((c) => c.error)?.error;
  if (!error) return null;
  if (error.code === 'PGRST205' || error.code === '42P01' || error.code === '42703' || error.code === 'PGRST204') {
    return 'The database is missing the latest updates (for example restaurant staff and admin team accounts). Stop the app and run: npx supabase db push   then start it again.';
  }
  return `Can't check the database: ${error.message}`;
}
