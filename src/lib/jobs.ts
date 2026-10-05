import 'server-only';
import { sweep } from '@/lib/orders';
import { renewDue } from '@/lib/subscriptions';

// The app's scheduled work: the cleanup sweep (stale checkouts, missed pickups, card holds) and restaurant plan
// renewals. Run by /api/cron/sweep and, on a self-hosted server, every few minutes by src/instrumentation.ts.
export async function runScheduledJobs() {
  return { ...(await sweep()), subscriptions: await renewDue() };
}
