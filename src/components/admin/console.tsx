'use client';

import { useEffect, useState } from 'react';
import { BarChart3, Banknote, Bell, ClipboardList, Crown, DollarSign, Landmark, ScrollText, Settings, Store, Tag, Users } from 'lucide-react';
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
import { daysAgo, todayPT, type Range } from './shared';
import { TaxPanel } from './tax';
import { UsersPanel } from './users';

const TABS = [
  ['overview', 'Overview', BarChart3], ['income', 'Income', DollarSign], ['alerts', 'Alerts', Bell], ['restaurants', 'Restaurants', Store], ['plans', 'Plans', Crown], ['customers', 'Customers', Users], ['orders', 'Orders', ClipboardList],
  ['offers', 'Live offers', Tag], ['payouts', 'Payouts', Banknote], ['tax', 'Sales tax', Landmark], ['settings', 'Settings', Settings], ['audit', 'Audit log', ScrollText],
] as const;

export function AdminConsole({ adminId }: { adminId: string }) {
  const [tab, setTab] = useState('overview');
  const [range, setRange] = useState<Range>({ from: daysAgo(29), to: todayPT() });
  const unread = useUnreadAlerts();
  useEffect(() => {
    const h = location.hash.slice(1);
    // The URL hash only exists in the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (TABS.some(([k]) => k === h)) setTab(h);
  }, []);
  const go = (t: string) => {
    setTab(t);
    history.replaceState(null, '', `#${t}`);
  };
  return (
    <main className="container-wide py-8">
      <h1 className="text-3xl font-extrabold">Owner console</h1>
      <p className="-mt-1 mb-5 text-muted">Everything about Bite Wise in one place: income, alerts, restaurants, customers, orders, refunds, payouts and taxes.</p>
      <Tabs value={tab} onValueChange={go}>
        <TabsList>
          {TABS.map(([k, label, Icon]) => (
            // Tighter tabs below 1536px, so all of them fit on one row on laptop screens.
            <TabsTrigger key={k} value={k} className="px-2 text-[13px] 2xl:px-3 2xl:text-sm">
              <Icon /> {label}
              {k === 'alerts' && unread > 0 && <span className="ml-1 rounded-full bg-danger px-1.5 text-[11px] leading-[18px] font-extrabold text-white" aria-label={`${unread} new`}>{unread}</span>}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview"><OverviewPanel range={range} setRange={setRange} go={go} /></TabsContent>
        <TabsContent value="income"><IncomePanel /></TabsContent>
        <TabsContent value="alerts"><AlertsPanel go={go} /></TabsContent>
        <TabsContent value="restaurants"><RestaurantsPanel /></TabsContent>
        <TabsContent value="plans"><PlansPanel /></TabsContent>
        <TabsContent value="customers"><UsersPanel adminId={adminId} /></TabsContent>
        <TabsContent value="orders"><OrdersPanel range={range} setRange={setRange} /></TabsContent>
        <TabsContent value="offers"><OffersPanel /></TabsContent>
        <TabsContent value="payouts"><PayoutsPanel /></TabsContent>
        <TabsContent value="tax"><TaxPanel range={range} setRange={setRange} /></TabsContent>
        <TabsContent value="settings"><SettingsPanel /></TabsContent>
        <TabsContent value="audit"><AuditPanel /></TabsContent>
      </Tabs>
    </main>
  );
}
