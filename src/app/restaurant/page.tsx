import type { Metadata } from 'next';
import { RestaurantDashboard } from '@/components/restaurant/dashboard';
import { requirePageViewer } from '@/lib/auth';
import { paymentMode, publicEnv } from '@/lib/env';
import { must } from '@/lib/errors';
import { supabaseServer } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Restaurant dashboard' };

export default async function RestaurantPage({ searchParams }: PageProps<'/restaurant'>) {
  const viewer = await requirePageViewer('restaurant');
  const { tab, stripe } = await searchParams;
  const supabase = await supabaseServer();
  const restaurant = must(await supabase.from('restaurants').select('*').eq('owner_id', viewer.id).single());
  const [{ data: fee }, { data: planOk }] = await Promise.all([
    supabase.from('settings').select('value').eq('key', 'service_fee_bps').single(),
    supabase.rpc('restaurant_plan_ok', { p_restaurant_id: restaurant.id }),
  ]);
  return (
    <RestaurantDashboard
      restaurant={restaurant}
      serviceFeeBps={Number(fee?.value ?? 500)}
      map={publicEnv.map}
      paymentMode={paymentMode()}
      stripePublishableKey={publicEnv.stripePublishableKey}
      needsPlan={!planOk}
      initialTab={typeof tab === 'string' ? tab : 'pickup'}
      stripeReturn={stripe === 'return' || stripe === 'refresh'}
    />
  );
}
