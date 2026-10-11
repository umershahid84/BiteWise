import type { Metadata } from 'next';
import { OffersBrowser } from '@/components/offers/offers-browser';
import { requirePageViewer } from '@/lib/auth';
import { paymentConfigs, publicEnv } from '@/lib/env';
import { supabaseServer } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Deals near you' };

export default async function OffersPage() {
  const viewer = await requirePageViewer('customer');
  // The customer's ZIP or postal code: the page opens with the deals nearest to it.
  const supabase = await supabaseServer();
  const { data: p } = await supabase.from('profiles').select('postal_code, home_lat, home_lng').eq('id', viewer.id).maybeSingle();
  const home = p?.postal_code ? { postalCode: p.postal_code, lat: p.home_lat, lng: p.home_lng } : null;
  return <OffersBrowser map={publicEnv.map} payments={paymentConfigs()} country={viewer.country} home={home} />;
}
