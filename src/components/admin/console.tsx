'use client';

import { useEffect, useState } from 'react';
import { BarChart3, Banknote, Bell, ClipboardList, Crown, DollarSign, Landmark, ScrollText, Settings, ShieldCheck, Store, Tag, Users } from 'lucide-react';
import { SUPPORT_TABS } from '@/lib/constants';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertsPanel, useUnreadAlerts } from './alerts';
import { AuditPanel } from './audit';
import { IncomePanel } from './income';
import { OffersPanel } from './offers';
import { OrdersPanel } from './orders';
import { OverviewPanel } from './overview';
import { PayoutsPanel } from './payouts';
import { PlansPanel } from './plans';
import { RestaurantsPanel } from './restaurants';
import { SettingsPanel } from './settings';
import { AccessContext, daysAgo, todayPT, type Access, type Range } from './shared';
import { TeamPanel } from './team';
import { TaxPanel } from './tax';
import { UsersPanel } from './users';

const TABS = [
  ['overview', 'Overview', BarChart3], ['income', 'Income', DollarSign], ['alerts', 'Alerts', Bell], ['restaurants', 'Restaurants', Store], ['plans', 'Plans', Crown], ['customers', 'Customers', Users], ['orders', 'Orders', ClipboardList],
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
    <main className="container-wide py-8">
      <h1 className="text-3xl font-extrabold">Owner console</h1>
      <p className="-mt-1 mb-5 text-muted">
        {access.role === 'admin'
          ? 'Everything about Bite Wise in one place: income, alerts, restaurants, customers, orders, refunds, payouts and taxes.'
          : `Support: alerts, restaurants, customers, orders and live offers${access.canRefund ? ', including refunds and credit' : ''}.`}
      </p>
      <Tabs value={tab} onValueChange={go} orientation="vertical" className="lg:grid lg:grid-cols-[208px_minmax(0,1fr)] lg:items-start lg:gap-6">
        <TabsList variant="sidebar">
          {tabs.map(([k, label, Icon]) => (
            <TabsTrigger variant="sidebar" key={k} value={k}>
              <Icon /> {label}
              {k === 'alerts' && unread > 0 && <span className="ml-auto rounded-full bg-danger px-1.5 text-[11px] leading-[18px] font-extrabold text-white" aria-label={`${unread} new`}>{unread}</span>}
            </TabsTrigger>
          ))}
        </TabsList>
        {access.role === 'admin' && (
          <>
            <TabsContent value="overview"><OverviewPanel range={range} setRange={setRange} go={go} /></TabsContent>
            <TabsContent value="income"><IncomePanel /></TabsContent>
            <TabsContent value="plans"><PlansPanel /></TabsContent>
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
    </AccessContext.Provider>
  );
}
