import type { Metadata } from 'next';
import { RestaurantDashboard } from '@/components/restaurant/dashboard';
import { requirePageViewer } from '@/lib/auth';
import { paymentConfig, publicEnv } from '@/lib/env';
import { must } from '@/lib/errors';
import { SERVICE_FEE_KEYS, serviceFeeFrom } from '@/lib/service-fee';
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
    supabase.from('settings').select('key, value').in('key', SERVICE_FEE_KEYS),
    supabase.rpc('restaurant_plan_ok', { p_restaurant_id: restaurant.id }),
    supabase.from('restaurant_subscriptions').select('status').eq('restaurant_id', restaurant.id).maybeSingle(),
  ]);
  // Pioneer spots left (the first restaurants to choose a plan get it free), for the "choose your plan" banner.
  const { foundingLeft } = await prices();
  return (
    <RestaurantDashboard
      restaurant={restaurant}
      staff={viewer.staff}
      serviceFee={serviceFeeFrom(fee)}
      map={publicEnv.map}
      payment={paymentConfig(viewer.restaurant!.country)}
      planNotice={planOk ? null : sub?.status === 'past_due' ? 'delinquent' : 'choose'}
      hasPlan={!!sub && sub.status !== 'expired'}
      pioneerSpotsLeft={foundingLeft}
      initialTab={typeof tab === 'string' ? tab : 'pickup'}
      stripeReturn={stripe === 'return' || stripe === 'refresh'}
    />
  );
}
