// Runs once when the server starts. On a long-running server (npm start, or the Linux service) it also runs the
// scheduled jobs every 5 minutes, so card holds are voided and restaurant plans renew without a separate cron.
// Serverless hosts (Vercel) don't keep the process running: there vercel.json calls /api/cron/sweep instead.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.VERCEL || process.env.DISABLE_SCHEDULED_JOBS) return;
  const { runScheduledJobs } = await import('@/lib/jobs');
  const run = () => runScheduledJobs().catch((err) => console.error('scheduled jobs:', err instanceof Error ? err.message : err));
  setTimeout(run, 30_000).unref();
  setInterval(run, 5 * 60_000).unref();
}
