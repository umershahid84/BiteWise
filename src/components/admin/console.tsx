'use client';

import { useEffect, useState } from 'react';
import { BarChart3, Banknote, Bell, ClipboardList, Crown, DollarSign, Landmark, ScrollText, Settings, ShieldCheck, Store, Tag, Ticket, Users } from 'lucide-react';
import { SUPPORT_TABS } from '@/lib/constants';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertsPanel, useUnreadAlerts } from './alerts';
import { AuditPanel } from './audit';
import { CouponsPanel } from './coupons';
import { IncomePanel } from './income';
import { OffersPanel } from './offers';
import { OrdersPanel } from './orders';
import { OverviewPanel } from './overview';
import { PayoutsPanel } from './payouts';
import { PlansPanel } from './plans';
import { ChangePasswordButton } from '@/components/auth/change-password';
import { RestaurantsPanel } from './restaurants';
import { SettingsPanel } from './settings';
import { AccessContext, daysAgo, MarketContext, setMarket, todayPT, type Access, type Range } from './shared';
import { TeamPanel } from './team';
import { TaxPanel } from './tax';
import { UsersPanel } from './users';

const TABS = [
  ['overview', 'Overview', BarChart3], ['income', 'Income', DollarSign], ['alerts', 'Alerts', Bell], ['restaurants', 'Restaurants', Store], ['plans', 'Plans', Crown], ['coupons', 'Coupons', Ticket], ['customers', 'Customers', Users], ['orders', 'Orders', ClipboardList],
  ['offers', 'Live offers', Tag], ['payouts', 'Payouts', Banknote], ['tax', 'Sales tax', Landmark], ['settings', 'Settings', Settings], ['team', 'Team', ShieldCheck],
  ['audit', 'Audit log', ScrollText],
] as const;

// Admin employees see Alerts, Restaurants, Customers, Orders and Live offers; admins see everything.
const allowed = (access: Access, tab: string) =>
  access.role === 'admin' || (SUPPORT_TABS as readonly string[]).includes(tab === 'customers' ? 'users' : tab);

export function AdminConsole({ access }: { access: Access }) {
  const adminId = access.id;
  const tabs = TABS.filter(([k]) => allowed(access, k));
  const [tab, setTab] = useState<string>(tabs[0][0]);
  const [range, setRange] = useState<Range>({ from: daysAgo(29), to: todayPT() });
  const unread = useUnreadAlerts();
  // The console shows only the signed-in member's location (United States or Canada); the server enforces it too.
  const market = access.country;
  setMarket(market);
  useEffect(() => {
    const h = location.hash.slice(1);
    // The URL hash only exists in the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (TABS.some(([k]) => k === h) && allowed(access, h)) setTab(h);
  }, [access]);
  const go = (t: string) => {
    setTab(t);
    history.replaceState(null, '', `#${t}`);
  };
  return (
    <AccessContext.Provider value={access}>
    <MarketContext.Provider value={market}>
    <main className="container-wide py-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="m-0 flex-1 text-3xl font-extrabold">Owner console</h1>
        <span className="rounded-full border border-line bg-surface px-3 py-1 text-sm font-bold text-ink-2" title="Your location: you see and manage only this country. An admin can change it in the Team tab.">
          {market === 'CA' ? '🇨🇦 Canada · CAD' : '🇺🇸 United States · USD'}
        </span>
        <ChangePasswordButton />
      </div>
      <p className="-mt-1 mb-5 text-muted">
        {access.role === 'admin'
          ? 'Everything about ResDish in one place: income, alerts, restaurants, customers, orders, payouts and taxes.'
          : `Support: alerts, restaurants, customers, orders and live offers${access.canRefund ? ', including platform credit' : ''}.`}
      </p>
      <Tabs value={tab} onValueChange={go}>
        {/* The console has many tabs: on laptop screens and up the bar is as wide as its tabs (wider than the page if needed), so they all fit
            on one line. */}
        <TabsList className="lg:relative lg:left-1/2 lg:w-max lg:max-w-[calc(100vw-32px)] lg:-translate-x-1/2">
          {tabs.map(([k, label, Icon]) => (
            // Tighter tabs below 1536px, so all of them fit on one row on laptop screens.
            <TabsTrigger key={k} value={k} className="gap-1 px-1.5 text-[13px] xl:px-2.5 2xl:gap-1.5 2xl:px-3 2xl:text-sm">
              <Icon /> {label}
              {k === 'alerts' && unread > 0 && <span className="ml-1 rounded-full bg-danger px-1.5 text-[11px] leading-[18px] font-extrabold text-white" aria-label={`${unread} new`}>{unread}</span>}
            </TabsTrigger>
          ))}
        </TabsList>
        {access.role === 'admin' && (
          <>
            <TabsContent value="overview"><OverviewPanel range={range} setRange={setRange} go={go} /></TabsContent>
            <TabsContent value="income"><IncomePanel /></TabsContent>
            <TabsContent value="plans"><PlansPanel /></TabsContent>
            <TabsContent value="coupons"><CouponsPanel /></TabsContent>
            <TabsContent value="payouts"><PayoutsPanel /></TabsContent>
            <TabsContent value="tax"><TaxPanel range={range} setRange={setRange} /></TabsContent>
            <TabsContent value="settings"><SettingsPanel /></TabsContent>
            <TabsContent value="team"><TeamPanel /></TabsContent>
            <TabsContent value="audit"><AuditPanel /></TabsContent>
          </>
        )}
        <TabsContent value="alerts"><AlertsPanel go={go} /></TabsContent>
        <TabsContent value="restaurants"><RestaurantsPanel /></TabsContent>
        <TabsContent value="customers"><UsersPanel adminId={adminId} /></TabsContent>
        <TabsContent value="orders"><OrdersPanel range={range} setRange={setRange} /></TabsContent>
        <TabsContent value="offers"><OffersPanel /></TabsContent>
      </Tabs>
    </main>
    </MarketContext.Provider>
    </AccessContext.Provider>
  );
}
