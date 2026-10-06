'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { List, LocateFixed, Map as MapIcon } from 'lucide-react';
import { DemoVideoButton } from '@/components/app/demo-video';
import type { PaymentConfig } from '@/components/payments/card-entry';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { EmptyState, Spinner } from '@/components/ui/misc';
import { DIETARY_TAGS } from '@/lib/constants';
import { supabaseBrowser } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { CheckoutDialog } from './checkout-dialog';
import { OfferCard } from './offer-card';
import type { MapConfig, OfferRow, Origin } from './types';

const OffersMap = dynamic(() => import('./offers-map'), { ssr: false, loading: () => <div className="mb-6 grid h-[560px] place-items-center rounded-card border border-line"><Spinner /></div> });

type Filters = { q: string; area: string; dietary: string; sort: string; radius: string };

const readSession = <T,>(key: string, fallback: T): T => {
  try {
    const v = sessionStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const writeSession = (key: string, value: unknown) => {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable
  }
};

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function OffersBrowser({ map, payment }: { map: MapConfig; payment: PaymentConfig }) {
  const supabase = supabaseBrowser();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<Filters>({ q: '', area: '', dietary: '', sort: '', radius: '' });
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [view, setView] = useState<'list' | 'map'>('list');
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [selected, setSelected] = useState<OfferRow | null>(null);
  const f = useDebounced(filters, 250);

  // Browser-only session preferences, read after hydration.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(readSession<Origin | null>('bw-origin', null));
    setView(readSession<'list' | 'map'>('bw-view', 'list'));
  }, []);

  // City and ZIP suggestions for the area box.
  const areas = useQuery({
    queryKey: ['areas'],
    staleTime: Infinity,
    queryFn: async () => (await supabase.from('zips').select('zip, city, county').order('city')).data ?? [],
  });
  const cities = [...new Map((areas.data ?? []).map((z) => [z.city, z.county])).entries()];

  const offers = useQuery({
    queryKey: ['offers', f, origin],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      // A known city or ZIP ("Tacoma", "98198") searches around that place; otherwise the user's own location.
      let place: { label: string; lat: number; lng: number } | null = null;
      if (f.area.trim()) {
        const { data } = await supabase.rpc('resolve_area', { p_query: f.area });
        place = data?.[0] ?? null;
      }
      const center = place ?? origin;
      const radius = f.radius ? Number(f.radius) : place ? 10 : undefined;
      const { data, error } = await supabase.rpc('search_offers', {
        p_lat: center?.lat, p_lng: center?.lng, p_radius_miles: radius, p_query: f.q.trim() || undefined,
        p_area_text: f.area.trim() && !place ? f.area.trim() : undefined, p_dietary: f.dietary || undefined, p_sort: f.sort || undefined,
      });
      if (error) throw new Error(error.message);
      return { offers: data ?? [], place, radius, center: center ? { ...center, label: place?.label ?? 'You are here' } : null };
    },
  });

  // Live feed: any change to offers (new posts, quantities, timers) refreshes the list over WebSockets.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const channel = supabase
      .channel('offers-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'offers' }, () => {
        clearTimeout(t);
        t = setTimeout(() => queryClient.invalidateQueries({ queryKey: ['offers'] }), 400);
      })
      .subscribe();
    return () => {
      clearTimeout(t);
      supabase.removeChannel(channel);
    };
  }, [supabase, queryClient]);

  const set = (k: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setFilters((x) => ({ ...x, [k]: e.target.value }));
  const switchView = (v: 'list' | 'map') => {
    setView(v);
    writeSession('bw-view', v);
  };
  const locate = () => {
    if (!navigator.geolocation) return setGeoError('Location is not available in this browser.');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const o = { lat: Number(pos.coords.latitude.toFixed(4)), lng: Number(pos.coords.longitude.toFixed(4)) };
        setOrigin(o);
        writeSession('bw-origin', o);
        setLocating(false);
        setGeoError(null);
      },
      () => {
        setLocating(false);
        setGeoError('We could not get your location. You can search by city or ZIP instead.');
      },
      { timeout: 10000, maximumAge: 600000 },
    );
  };

  const list = offers.data?.offers ?? [];
  const fitKey = JSON.stringify([f, origin]);
  return (
    <main className="container-page py-8">
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div>
          <h1 className="m-0 text-3xl font-extrabold">Deals near you</h1>
          <p className="m-0 text-muted">Surplus food from local restaurants, discounted before it goes to waste. Updates live.</p>
        </div>
        <span className="flex-1" />
        <DemoVideoButton tour="customer" label="How it works" />
        <div className="inline-flex rounded-full border border-line bg-surface p-1">
          {(['list', 'map'] as const).map((v) => (
            <button
              key={v}
              onClick={() => switchView(v)}
              className={cn('inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-bold text-muted', view === v && 'bg-primary-soft text-primary-ink')}
            >
              {v === 'list' ? <List className="size-4" /> : <MapIcon className="size-4" />} {v === 'list' ? 'List' : 'Map'}
            </button>
          ))}
        </div>
      </div>

      <form className="mb-3 grid gap-3 rounded-card border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-[1.4fr_1.2fr_repeat(3,minmax(10.5rem,1fr))_auto]" onSubmit={(e) => e.preventDefault()}>
        <Input placeholder="Search dishes, restaurants, cuisines…" aria-label="Search" value={filters.q} onChange={set('q')} />
        <Input placeholder="City or ZIP code" aria-label="City or ZIP" list="area-list" value={filters.area} onChange={set('area')} />
        <datalist id="area-list">
          {cities.map(([c, county]) => <option key={c} value={c}>{county} County</option>)}
          {(areas.data ?? []).map((z) => <option key={z.zip} value={z.zip}>{z.city}</option>)}
        </datalist>
        <Select aria-label="Dietary" value={filters.dietary} onChange={set('dietary')}>
          <option value="">Any diet</option>
          {DIETARY_TAGS.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
        </Select>
        <Select aria-label="Distance" value={filters.radius} onChange={set('radius')}>
          <option value="">Any distance</option>
          {[2, 5, 10, 25, 50].map((m) => <option key={m} value={m}>Within {m} mi</option>)}
        </Select>
        <Select aria-label="Sort" value={filters.sort} onChange={set('sort')}>
          <option value="">Best match</option>
          <option value="distance">Nearest</option>
          <option value="discount">Biggest discount</option>
          <option value="price">Lowest price</option>
          <option value="ending">Ending soon</option>
        </Select>
        <Button type="button" variant="ghost" onClick={locate} disabled={locating}>
          <LocateFixed /> {locating ? 'Locating…' : origin ? 'Location on' : 'Use my location'}
        </Button>
      </form>
      {offers.data?.place && (
        <p className="mb-3 text-sm text-muted">
          Showing deals within {offers.data.radius} miles of {offers.data.place.label}. Change the distance filter to widen the search.
        </p>
      )}
      {geoError && <Alert tone="warn" className="mb-3">{geoError}</Alert>}
      {offers.error && <Alert tone="error" className="mb-3">{offers.error.message}</Alert>}

      {view === 'map' && (
        <OffersMap offers={list} origin={offers.data?.center ?? null} config={map} fitKey={fitKey} onOpen={(id) => setSelected(list.find((o) => o.id === id) ?? null)} />
      )}
      {view === 'list' && (
        offers.isLoading ? (
          <div className="grid place-items-center py-20"><Spinner /></div>
        ) : list.length ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((o) => <OfferCard key={o.id} offer={o} onOrder={() => setSelected(o)} />)}
          </div>
        ) : (
          <EmptyState title="No deals match right now">New surplus food is posted throughout the day. Check back soon or widen your search.</EmptyState>
        )
      )}
      <CheckoutDialog offer={selected} origin={offers.data?.center ?? origin} payment={payment} onClose={() => setSelected(null)} />
    </main>
  );
}
