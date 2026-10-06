import { execFileSync } from 'node:child_process';
import { config } from 'dotenv';

// After the test run, removes the throwaway accounts and restaurants the integration tests created
// (scripts/remove-test-data.ts), so the local database keeps only the demo data. Only for the local stack: the
// integration tests never run against a hosted project (see tests/support/db.ts).
export async function teardown() {
  config({ path: '.env.local', quiet: true });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/.test(url)) return;
  try {
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/remove-test-data.ts', '--yes'], { stdio: 'ignore', timeout: 120_000 });
  } catch {
    // The database may be down; the next run cleans up.
  }
}
