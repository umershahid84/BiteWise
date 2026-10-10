import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { LOGIN_PATH, loginForPath } from '@/lib/constants';
import { publicEnv } from '@/lib/env';
import { themeForPath } from '@/lib/theme';

// Refreshes the Supabase session cookie on every page request and sends signed-out visitors to the log-in page
// for pages that need an account (/login, or /admin/login for the owner console). Role checks happen in the pages.
const PROTECTED = ['/offers', '/orders', '/account', '/restaurant', '/admin'];
// /restaurant/login is an old address that forwards to /login.
const PUBLIC = new Set(['/restaurant/login', LOGIN_PATH.admin, '/restaurant/signup']);

export async function proxy(request: NextRequest) {
  // The look of the page (customer, restaurant or admin), read by the root layout.
  // (The log-in and sign-up pages opened on their restaurant side start in the restaurant look.)
  const q = request.nextUrl.searchParams;
  const restaurantSide = q.get('as') === 'restaurant' || q.get('role') === 'restaurant';
  request.headers.set('x-bw-theme', restaurantSide ? 'restaurant' : themeForPath(request.nextUrl.pathname));
  let response = NextResponse.next({ request });
  const supabase = createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(toSet) {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const path = request.nextUrl.pathname;
  if (!data?.claims && !PUBLIC.has(path) && PROTECTED.some((p) => path === p || path.startsWith(`${p}/`))) {
    const url = request.nextUrl.clone();
    url.pathname = loginForPath(path);
    url.search = `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|api/stripe|api/cron|assets|fonts|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|woff2?)$).*)'],
};
