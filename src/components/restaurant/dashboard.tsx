'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, Bell, BellOff, ClipboardList, FileText, KeyRound, Plus, Store, Tag, UtensilsCrossed } from 'lucide-react';
import { DemoVideoButton } from '@/components/app/demo-video';
import type { MapConfig } from '@/components/offers/types';
import { Alert } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Kpi } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { fmtTime, money, pct } from '@/lib/format';
import { supabaseBrowser } from '@/lib/supabase/client';
import { isUnlocked, ringBell, unlockOnInteraction } from './bell';
import { MenuPanel } from './menu-panel';
import { OfferFormDialog } from './offer-form-dialog';
import { OffersPanel } from './offers-panel';
import { OrdersPanel } from './orders-panel';
import { PayoutsPanel } from './payouts-panel';
import { PickupPanel } from './pickup-panel';
import { ProfilePanel } from './profile-panel';
import type { Ctx, Restaurant } from './types';

type NewOrder = { id: number; quantity: number; item_title: string; customer_username: string; total_cents: number; pickup_end: string; image_url: string | null };

export function RestaurantDashboard({ restaurant, serviceFeeBps, map, paymentMode, initialTab, stripeReturn }: {
  restaurant: Restaurant;
  serviceFeeBps: number;
  map: MapConfig;
  paymentMode: 'stripe' | 'mock';
  initialTab: string;
  stripeReturn: boolean;
}) {
  const supabase = supabaseBrowser();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [tab, setTab] = useState(initialTab);
  const [offerForm, setOfferForm] = useState<{ open: boolean; offerId?: number; menuItemId?: number }>({ open: false });
  const [alertOrder, setAlertOrder] = useState<NewOrder | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  const seen = useRef(new Set<number>());
  const ctx: Ctx = { restaurant, serviceFeeBps, map, paymentMode };

  const stats = useQuery({
    queryKey: ['restaurant-stats'],
    refetchInterval: 30_000,
    queryFn: async () => (await supabase.rpc('restaurant_stats')).data as {
      today: { meals: number; salesCents: number };
      allTime: { meals: number; salesCents: number };
      awaitingPickup: number;
      activeOffers: number;
    } | null,
  });

  const changeTab = (t: string) => {
    setTab(t);
    router.replace(`/restaurant?tab=${t}`, { scroll: false });
  };

  // ---- Live order alerts (Supabase Realtime over WebSockets): the counter bell rings for each new order.
  useEffect(() => {
    try {
      // Browser-only preference, read after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSoundOn(localStorage.getItem('bb-sound') !== 'off');
    } catch {
      // storage unavailable
    }
    return unlockOnInteraction(() => setUnlocked(isUnlocked()));
  }, []);

  const soundRef = useRef(soundOn);
  useEffect(() => {
    soundRef.current = soundOn;
  }, [soundOn]);
  const announce = useCallback((order: NewOrder) => {
    if (soundRef.current) ringBell();
    setAlertOrder(order);
    const base = document.title;
    let on = false;
    let n = 0;
    const flash = setInterval(() => {
      document.title = (on = !on) ? '🔔 New order! · Rescue Bites' : base;
      if (++n > 12 || document.hasFocus()) {
        clearInterval(flash);
        document.title = base;
      }
    }, 1000);
    setTimeout(() => setAlertOrder((cur) => (cur?.id === order.id ? null : cur)), 12000);
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel(`restaurant-orders-${restaurant.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${restaurant.id}` }, (payload) => {
        const row = payload.new as NewOrder & { status: string };
        if (row?.status === 'reserved' && !seen.current.has(row.id)) {
          seen.current.add(row.id);
          announce(row);
        }
        queryClient.invalidateQueries({ queryKey: ['restaurant-stats'] });
        queryClient.invalidateQueries({ queryKey: ['restaurant-orders'] });
        queryClient.invalidateQueries({ queryKey: ['restaurant-offers'] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, queryClient, restaurant.id, announce]);

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    try {
      localStorage.setItem('bb-sound', next ? 'on' : 'off');
    } catch {
      // ignore
    }
    if (next) setTimeout(() => ringBell(), 50);
  };

  const s = stats.data;
  return (
    <main className="container-page py-8">
      {restaurant.status === 'pending' && (
        <Alert tone="warn" className="mb-5">
          ⏳ <b>Your restaurant is waiting for approval.</b> You can set up your menu and offers now; customers will see them once Rescue Bites approves
          your account (usually within 1 business day).
        </Alert>
      )}
      {restaurant.status === 'suspended' && (
        <Alert tone="error" className="mb-5">
          ⛔ <b>Your restaurant is suspended.</b> Your offers are hidden and you can&apos;t post new ones. You can still verify pickups for existing
          orders. Contact Rescue Bites support.{restaurant.admin_note && <> Note: {restaurant.admin_note}</>}
        </Alert>
      )}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="m-0 text-3xl font-extrabold">{restaurant.name}</h1>
          <p className="m-0 text-sm text-muted">{restaurant.address}, {restaurant.city} {restaurant.zip} · Sales tax {pct(restaurant.tax_rate_bps)}</p>
        </div>
        <span className="flex-1" />
        <DemoVideoButton tour="restaurant" label="Watch the tour" />
        <Button variant="ghost" size="sm" onClick={toggleSound} className={soundOn ? '' : 'opacity-70'}>
          {soundOn ? <Bell /> : <BellOff />} Order sound: {soundOn ? 'on' : 'off'}
        </Button>
        <Link href="/restaurant/report" className={buttonVariants({ variant: 'ghost', size: 'sm' })}><FileText /> Daily report</Link>
        <Button size="sm" onClick={() => setOfferForm({ open: true })}><Plus /> Post surplus food</Button>
      </div>
      {soundOn && !unlocked && (
        <Alert tone="info" className="mb-5">🔔 Click anywhere on this page once to turn on the new-order bell (browsers only play sound after you interact).</Alert>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi value={s?.awaitingPickup ?? '–'} label="Orders awaiting pickup" />
        <Kpi value={s?.activeOffers ?? '–'} label="Active offers" />
        <Kpi value={s?.today.meals ?? '–'} label={`Meals rescued today · ${money(s?.today.salesCents ?? 0)}`} />
        <Kpi value={s?.allTime.meals ?? '–'} label={`Meals rescued all-time · ${money(s?.allTime.salesCents ?? 0)}`} />
      </div>

      <Tabs value={tab} onValueChange={changeTab}>
        <TabsList>
          <TabsTrigger value="pickup"><KeyRound /> Verify pickup</TabsTrigger>
          <TabsTrigger value="offers"><Tag /> Offers</TabsTrigger>
          <TabsTrigger value="menu"><UtensilsCrossed /> Menu</TabsTrigger>
          <TabsTrigger value="orders"><ClipboardList /> Orders</TabsTrigger>
          <TabsTrigger value="payouts"><Banknote /> Payouts</TabsTrigger>
          <TabsTrigger value="profile"><Store /> Profile</TabsTrigger>
        </TabsList>
        <TabsContent value="pickup"><PickupPanel /></TabsContent>
        <TabsContent value="offers"><OffersPanel ctx={ctx} onEdit={(id) => setOfferForm({ open: true, offerId: id })} onNew={() => setOfferForm({ open: true })} /></TabsContent>
        <TabsContent value="menu"><MenuPanel onDiscount={(menuItemId) => setOfferForm({ open: true, menuItemId })} /></TabsContent>
        <TabsContent value="orders"><OrdersPanel restaurantId={restaurant.id} /></TabsContent>
        <TabsContent value="payouts"><PayoutsPanel ctx={ctx} stripeReturn={stripeReturn} /></TabsContent>
        <TabsContent value="profile"><ProfilePanel ctx={ctx} /></TabsContent>
      </Tabs>

      <OfferFormDialog
        ctx={ctx}
        state={offerForm}
        onClose={() => setOfferForm({ open: false })}
        onGoToMenu={() => {
          setOfferForm({ open: false });
          changeTab('menu');
        }}
        onSaved={() => changeTab('offers')}
      />

      {alertOrder && (
        <div role="alert" onClick={() => setAlertOrder(null)} className="fixed right-4 bottom-4 z-[900] w-[min(380px,calc(100%-32px))] cursor-pointer rounded-card border border-primary/50 bg-surface p-4 shadow-pop">
          <div className="flex items-center gap-3">
            {alertOrder.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={alertOrder.image_url} alt="" className="size-12 rounded-lg object-cover" />
            ) : <span className="text-3xl">🛎️</span>}
            <div className="flex-1">
              <b>New order!</b>
              <div className="text-sm">{alertOrder.quantity} × {alertOrder.item_title}</div>
              <div className="text-xs text-muted">{alertOrder.customer_username} · {money(alertOrder.total_cents)} · pick up by {fmtTime(alertOrder.pickup_end)}</div>
            </div>
            <span aria-hidden className="animate-bounce text-2xl">🔔</span>
          </div>
        </div>
      )}
    </main>
  );
}
