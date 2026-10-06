import 'server-only';
import { applyDuePriceChanges } from '@/lib/fee-changes';
import { sweep } from '@/lib/orders';
import { renewDue } from '@/lib/subscriptions';
import { supabaseAdmin } from '@/lib/supabase/admin';

// The app's scheduled work: the cleanup sweep (stale checkouts, missed pickups, card holds), subscription fee
// changes that take effect, and restaurant plan renewals and reminders. Run by /api/cron/sweep and, on a self-hosted server, every few minutes by src/instrumentation.ts.
// Fee changes that take effect are applied first, so renewals charged in the same run use the new prices.
export async function runScheduledJobs() {
  const priceChanges = await applyDuePriceChanges();
  return { ...(await sweep()), priceChanges, subscriptions: await renewDue() };
}

// Null when the database has the tables this version of the app needs; otherwise what to do about it. Checked by
// src/instrumentation.ts, so a database that is missing an update gets one clear message instead of an error every
// few minutes.
export async function databaseNotReady() {
  const { error } = await supabaseAdmin().from('restaurant_subscriptions').select('restaurant_id').limit(1);
  if (!error) return null;
  if (error.code === 'PGRST205' || error.code === '42P01') {
    return 'The database is missing the latest updates (for example restaurant plans). Stop the app and run: npx supabase db push   then start it again.';
  }
  return `Can't check the database: ${error.message}`;
}
