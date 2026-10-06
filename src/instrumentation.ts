// Runs once when the server starts. On a long-running server (npm start, or the Linux service) it also runs the
// scheduled jobs every 5 minutes, so card holds are voided and restaurant plans renew without a separate cron.
// Serverless hosts (Vercel) don't keep the process running: there vercel.json calls /api/cron/sweep instead.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // Old sign-in cookies are handled (the visitor is logged out); don't fill the log with them.
  (await import('@/lib/quiet-auth-logs')).quietStaleSessionLogs();
  if (process.env.VERCEL || process.env.DISABLE_SCHEDULED_JOBS) return;
  const { databaseNotReady, runScheduledJobs } = await import('@/lib/jobs');
  let warned = '';
  const run = async () => {
    const problem = await databaseNotReady().catch((err) => `Can't reach the database: ${err instanceof Error ? err.message : err}`);
    if (problem) {
      if (problem !== warned) console.warn(`\n⚠  Scheduled jobs are paused. ${problem}\n`);
      warned = problem;
      return;
    }
    warned = '';
    await runScheduledJobs().catch((err) => console.error('scheduled jobs:', err instanceof Error ? err.message : err));
  };
  setTimeout(run, 30_000).unref();
  setInterval(run, 5 * 60_000).unref();
}
