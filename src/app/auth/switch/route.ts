import { NextResponse, type NextRequest } from 'next/server';
import { loginForPath } from '@/lib/constants';
import { supabaseServer } from '@/lib/supabase/server';

// Someone signed in with one kind of account opened a page for another (for example a restaurant clicked a link in
// its email while a customer was logged in on this browser): log the other account out and show the log-in page
// for the page they wanted, coming back to it afterwards.
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('next') ?? '/';
  const next = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
  await (await supabaseServer()).auth.signOut();
  const url = req.nextUrl.clone();
  // Signing up for a new account: straight back to the sign-up page, now logged out.
  if (/^\/(restaurant\/)?signup(\?|$)/.test(next)) return NextResponse.redirect(new URL(next, req.nextUrl.origin));
  url.pathname = loginForPath(next.split('?')[0]);
  url.search = `?switched=1&next=${encodeURIComponent(next)}${next.startsWith('/restaurant') ? '&as=restaurant' : ''}`;
  return NextResponse.redirect(url);
}
