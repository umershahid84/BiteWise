import { NextResponse, type NextRequest } from 'next/server';
import { serverEnv } from '@/lib/env';
import { runScheduledJobs } from '@/lib/jobs';

// Scheduled jobs: releases stale checkouts and missed pickups, ends expired offers, voids the matching card holds,
// and renews restaurant plans. pg_cron runs the database part every minute, and a self-hosted server runs all of it
// every few minutes by itself (src/instrumentation.ts). On serverless hosts call this route regularly (vercel.json
// schedules it) with "Authorization: Bearer <CRON_SECRET>".
export async function GET(req: NextRequest) {
  if (!serverEnv.cronSecret || req.headers.get('authorization') !== `Bearer ${serverEnv.cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  return NextResponse.json(await runScheduledJobs());
}
