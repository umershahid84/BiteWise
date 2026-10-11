import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

// Whether this browser still has a signed-in session (src/components/app/session-watch.tsx).
export async function GET() {
  const { data } = await (await supabaseServer()).auth.getClaims();
  return NextResponse.json({ signedIn: !!data?.claims, userId: data?.claims?.sub ?? null }, { headers: { 'Cache-Control': 'private, no-store' } });
}
