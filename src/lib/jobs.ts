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
  // restaurants.tax_accuracy is the newest column (20261012000100_automatic_sales_tax.sql).
  const { error } = await supabaseAdmin().from('restaurants').select('tax_accuracy').limit(1);
  if (!error) return null;
  if (error.code === 'PGRST205' || error.code === '42P01' || error.code === '42703' || error.code === 'PGRST204') {
    return 'The database is missing the latest updates (for example automatic sales tax rates). Stop the app and run: npx supabase db push   then start it again.';
  }
  return `Can't check the database: ${error.message}`;
}
