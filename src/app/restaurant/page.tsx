import type { Metadata } from 'next';
import { RestaurantDashboard } from '@/components/restaurant/dashboard';
import { requirePageViewer } from '@/lib/auth';
import { paymentMode, publicEnv } from '@/lib/env';
import { must } from '@/lib/errors';
import { prices } from '@/lib/subscriptions';
import { supabaseServer } from '@/lib/supabase/server';

// Menu imports from a website can take a while (several pages, or reading a PDF with the AI menu reader).
export const maxDuration = 60;

export const metadata: Metadata = { title: 'Restaurant dashboard' };

export default async function RestaurantPage({ searchParams }: PageProps<'/restaurant'>) {
  const viewer = await requirePageViewer(['restaurant', 'staff']);
  const { tab, stripe } = await searchParams;
  const supabase = await supabaseServer();
  const restaurant = must(await supabase.from('restaurants').select('*').eq('id', viewer.restaurant!.id).single());
  const [{ data: fee }, { data: planOk }, { data: sub }] = await Promise.all([
    supabase.from('settings').select('value').eq('key', 'service_fee_bps').single(),
    supabase.rpc('restaurant_plan_ok', { p_restaurant_id: restaurant.id }),
    supabase.from('restaurant_subscriptions').select('status').eq('restaurant_id', restaurant.id).maybeSingle(),
  ]);
  // Pioneer spots left (the first restaurants to choose a plan get it free), for the "choose your plan" banner.
  const { foundingLeft } = await prices();
  return (
    <RestaurantDashboard
      restaurant={restaurant}
      staff={viewer.staff}
      serviceFeeBps={Number(fee?.value ?? 500)}
      map={publicEnv.map}
      paymentMode={paymentMode()}
      stripePublishableKey={publicEnv.stripePublishableKey}
      planNotice={planOk ? null : sub?.status === 'past_due' ? 'delinquent' : 'choose'}
      hasPlan={!!sub && sub.status !== 'expired'}
      pioneerSpotsLeft={foundingLeft}
      initialTab={typeof tab === 'string' ? tab : 'pickup'}
      stripeReturn={stripe === 'return' || stripe === 'refresh'}
    />
  );
}
