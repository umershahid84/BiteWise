import { NextResponse, type NextRequest } from 'next/server';
import { publicEnv } from '@/lib/env';
import { directionsUrl } from '@/lib/regions';
import { supabaseAdmin } from '@/lib/supabase/admin';

// "Drive to Restaurant" (the order email's button): opens driving directions to the restaurant in the phone's own maps
// app (src/lib/regions.ts directionsUrl). No login, so it works straight from the email; it only reveals the
// restaurant's public address.
export async function GET(req: NextRequest, ctx: RouteContext<'/directions/[restaurantId]'>) {
  const { restaurantId } = await ctx.params;
  const id = Number(restaurantId);
  const { data: r } = Number.isInteger(id)
    ? await supabaseAdmin().from('restaurants').select('address, city, state, zip, country, status').eq('id', id).maybeSingle()
    : { data: null };
  if (!r || r.status === 'deleted') return NextResponse.redirect(new URL('/orders', publicEnv.siteUrl));
  return NextResponse.redirect(directionsUrl(r, req.headers.get('user-agent') ?? ''));
}
