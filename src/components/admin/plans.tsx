'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { chargeDelinquentPlan, updatePlanPrices } from '@/app/actions/admin';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/field';
import { Kpi, Spinner, Table } from '@/components/ui/misc';
import { money } from '@/lib/format';
import { day, run, useAdmin } from './shared';

type Row = {
  restaurantId: number; name: string; city: string; restaurantStatus: string; ownerEmail: string;
  plan: 'founding' | 'monthly' | 'annual' | null; status: 'active' | 'past_due' | 'expired' | null; foundingNumber: number | null; autoRenew: boolean;
  priceCents: number; periodEnd: string | null; cardLabel: string; lastPaymentError: string; paid12mCents: number;
};
type Data = {
  prices: { monthlyCents: number; annualCents: number; foundingSpots: number; foundingTaken: number; foundingLeft: number };
  summary: { founding: number; monthly: number; annual: number; delinquent: number; noPlan: number; mrrCents: number; paid12mCents: number };
  rows: Row[];
};

const FILTERS = { all: 'All restaurants', past_due: 'Delinquent', founding: 'Founding Partners', monthly: 'Monthly', annual: 'Annual', none: 'No plan', expired: 'Ended' } as const;

function PlanCell({ r }: { r: Row }) {
  if (!r.plan) return <Badge tone="neutral">No plan</Badge>;
  if (r.plan === 'founding') return <Badge tone="green">🌱 Founding #{r.foundingNumber ?? '–'}</Badge>;
  const name = r.plan === 'annual' ? 'Annual' : 'Monthly';
  if (r.status === 'past_due') return <Badge tone="red">{name}: delinquent</Badge>;
  if (r.status === 'expired') return <Badge tone="neutral">{name}: ended</Badge>;
  return <Badge tone="green">{name}</Badge>;
}

// Restaurant plans: change the prices at any time, and see every restaurant's plan, with delinquent ones first.
export function PlansPanel() {
  const queryClient = useQueryClient();
  const { data } = useAdmin<Data>(['plans'], 'plans');
  const [filter, setFilter] = useState<keyof typeof FILTERS>('all');
  if (!data) return <Spinner />;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin'] });
  const rows = data.rows.filter((r) =>
    filter === 'all' ? true : filter === 'none' ? !r.plan : filter === 'past_due' || filter === 'expired' ? r.status === filter : r.plan === filter && r.status === 'active');
  const s = data.summary;
  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi value={money(s.mrrCents)} label="Monthly recurring revenue" />
        <Kpi value={money(s.paid12mCents)} label="Plan payments, last 12 months" />
        <Kpi value={`${s.monthly} · ${s.annual}`} label="Paying: monthly · annual" />
        <Kpi value={`${data.prices.foundingTaken} / ${data.prices.foundingSpots}`} label="Founding Partner spots used" />
        <Kpi value={<span className={s.delinquent ? 'text-danger' : undefined}>{s.delinquent}</span>} label={`Delinquent · ${s.noPlan} without a plan`} />
      </div>

      <PricesForm key={JSON.stringify(data.prices)} prices={data.prices} onSaved={refresh} />

      <Card className="p-2">
        <div className="flex flex-wrap items-center gap-3 p-3">
          <CardTitle className="m-0 flex-1">Restaurant plans</CardTitle>
          <Select className="max-w-56" value={filter} onChange={(e) => setFilter(e.target.value as keyof typeof FILTERS)}>
            {Object.entries(FILTERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
        <Table>
          <thead><tr><th>Restaurant</th><th>Plan</th><th>Price</th><th>Paid through</th><th>Card</th><th className="text-right">Paid (12 mo)</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.restaurantId}>
                <td><b>{r.name}</b><div className="text-xs text-muted">{r.city} · {r.ownerEmail}{r.restaurantStatus !== 'approved' && ` · ${r.restaurantStatus}`}</div></td>
                <td><PlanCell r={r} />{r.status === 'past_due' && r.lastPaymentError && <div className="mt-1 max-w-56 text-xs text-danger">{r.lastPaymentError}</div>}</td>
                <td className="text-sm">{r.plan && r.plan !== 'founding' ? `${money(r.priceCents)} / ${r.plan === 'annual' ? 'yr' : 'mo'}` : r.plan === 'founding' ? 'Free' : '–'}</td>
                <td className="text-sm">{r.periodEnd ? day(r.periodEnd) : '–'}{r.plan && r.plan !== 'founding' && r.status === 'active' && <div className="text-xs text-muted">{r.autoRenew ? 'auto-renews' : 'ends'}</div>}</td>
                <td className="text-sm">{r.cardLabel || '–'}</td>
                <td className="text-right text-sm">{r.paid12mCents ? money(r.paid12mCents) : '–'}</td>
                <td className="whitespace-nowrap">
                  {r.status === 'past_due' && (
                    <Button size="sm" variant="green" onClick={async () => {
                      if (await run(() => chargeDelinquentPlan({ restaurantId: r.restaurantId }), `${r.name}: paid and active again`)) refresh();
                      else refresh();
                    }}>Charge default card</Button>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} className="py-8 text-center text-muted">No restaurants here.</td></tr>}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

function PricesForm({ prices, onSaved }: { prices: Data['prices']; onSaved: () => void }) {
  const [f, setF] = useState({
    monthlyPrice: String(prices.monthlyCents / 100),
    annualPrice: String(prices.annualCents / 100),
    foundingSpots: String(prices.foundingSpots),
  });
  const saving = Number(f.monthlyPrice) * 12 - Number(f.annualPrice);
  return (
    <Card>
      <CardTitle>Subscription fees</CardTitle>
      <p className="mt-0 text-sm text-muted">
        Change them whenever you need to. New prices apply to new plans straight away, and to existing plans from their next renewal. The Restaurant Partner
        Agreement (section 5.6) promises partners 30 days&apos; notice of a price change, so tell them before it takes effect.
      </p>
      <div className="grid gap-x-4 sm:grid-cols-3">
        <Field label="Monthly plan ($ / month)" htmlFor="p-monthly"><Input id="p-monthly" inputMode="decimal" value={f.monthlyPrice} onChange={(e) => setF({ ...f, monthlyPrice: e.target.value })} /></Field>
        <Field label="Annual plan ($ / year)" htmlFor="p-annual" hint={saving > 0 ? `Saves $${saving.toFixed(saving % 1 ? 2 : 0)} a year vs monthly` : 'Not cheaper than 12 monthly payments'}>
          <Input id="p-annual" inputMode="decimal" value={f.annualPrice} onChange={(e) => setF({ ...f, annualPrice: e.target.value })} />
        </Field>
        <Field label="Founding Partner spots (free)" htmlFor="p-founding" hint={`${prices.foundingTaken} used · first approved restaurants`}>
          <Input id="p-founding" inputMode="numeric" value={f.foundingSpots} onChange={(e) => setF({ ...f, foundingSpots: e.target.value })} />
        </Field>
      </div>
      <Button onClick={async () => { if (await run(() => updatePlanPrices(f), 'Subscription fees saved')) onSaved(); }}>Save fees</Button>
    </Card>
  );
}
