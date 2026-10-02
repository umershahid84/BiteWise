'use client';

import { Alert } from '@/components/ui/alert';
import { Card, CardTitle } from '@/components/ui/card';
import { Kpi, SectionLabel, Spinner, Table } from '@/components/ui/misc';
import { money } from '@/lib/format';
import { DailyChart } from './daily-chart';
import { day, RangePicker, useAdmin, type Range } from './shared';

type Overview = {
  range: Range;
  totals: Record<string, number> & { placed: Record<string, number> };
  now: { customers: number; restaurants: Record<string, number>; activeOffers: number; awaitingPickup: number; payoutsOwedCents: number; creditOutstandingCents: number };
  daily: { date: string; orders: number; meals: number; gmvCents: number; feesCents: number; foodCents: number }[];
  topRestaurants: { id: number; name: string; city: string; orders: number; meals: number; foodCents: number }[];
};

export function OverviewPanel({ range, setRange, go }: { range: Range; setRange: (r: Range) => void; go: (tab: string) => void }) {
  const { data, isLoading, error } = useAdmin<Overview>(['overview', range], 'overview', range);
  if (error) return <Alert tone="error">{error.message}</Alert>;
  if (isLoading || !data) return <div className="grid place-items-center py-20"><Spinner /></div>;
  const t = data.totals;
  const n = data.now;
  const pending = n.restaurants.pending ?? 0;
  return (
    <>
      <RangePicker range={range} onChange={setRange} />
      {pending > 0 && (
        <Alert tone="warn" className="mb-4">
          🏪 <b>{pending} restaurant{pending > 1 ? 's are' : ' is'} waiting for approval.</b>{' '}
          <button className="underline" onClick={() => go('restaurants')}>Review now →</button>
        </Alert>
      )}
      <SectionLabel>{day(data.range.from)} – {day(data.range.to)} · completed orders</SectionLabel>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi value={money(t.serviceFeesCents)} label="Bite Wise revenue (service fees)" />
        <Kpi value={money(t.gmvCents)} label="Total charged to customers" />
        <Kpi value={money(t.foodSalesCents)} label="Restaurant food sales" />
        <Kpi value={money(t.salesTaxCents)} label="Sales tax collected" />
        <Kpi value={t.ordersPickedUp} label="Orders picked up" />
        <Kpi value={t.mealsRescued} label="Meals rescued from waste" />
        <Kpi value={money(t.discountsCents)} label="Customer savings" />
        <Kpi value={money(t.refundsCents)} label="Refunds to original payment" />
        <Kpi value={money(t.creditRefundsCents)} label="Refunds as platform credit (your cost)" />
        <Kpi value={money(t.creditRedeemedCents)} label="Platform credit used on orders" />
        <Kpi value={money(t.cardChargedCents)} label="Charged to cards (net)" />
        <Kpi value={money(n.creditOutstandingCents)} label="Platform credit outstanding" />
      </div>
      <Card className="mt-5">
        <div className="flex items-center"><CardTitle className="m-0">Daily total charged</CardTitle><span className="flex-1" /><span className="text-xs text-muted">Hover a bar for details</span></div>
        <DailyChart rows={data.daily} />
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">Show as table</summary>
          <Table>
            <thead><tr><th>Date</th><th>Orders</th><th>Meals</th><th>Total charged</th><th>Food sales</th><th>Service fees</th></tr></thead>
            <tbody>{data.daily.map((x) => <tr key={x.date}><td>{day(x.date)}</td><td>{x.orders}</td><td>{x.meals}</td><td>{money(x.gmvCents)}</td><td>{money(x.foodCents)}</td><td>{money(x.feesCents)}</td></tr>)}</tbody>
          </Table>
        </details>
      </Card>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardTitle>Right now</CardTitle>
          <Table>
            <tbody>
              <tr><td>Customers</td><td><b>{n.customers}</b></td></tr>
              <tr><td>Restaurants approved / pending / suspended</td><td><b>{n.restaurants.approved ?? 0}</b> / <b>{pending}</b> / <b>{n.restaurants.suspended ?? 0}</b></td></tr>
              <tr><td>Live offers</td><td><b>{n.activeOffers}</b></td></tr>
              <tr><td>Orders awaiting pickup</td><td><b>{n.awaitingPickup}</b></td></tr>
              <tr><td>Owed to restaurants</td><td><b>{money(n.payoutsOwedCents)}</b> <button className="text-sm text-primary" onClick={() => go('payouts')}>Pay →</button></td></tr>
              <tr><td>Orders placed · cancelled · not picked up (period)</td><td><b>{Object.values(t.placed).reduce((a, b) => a + b, 0)}</b> · {t.placed.cancelled ?? 0} · {t.placed.expired ?? 0}</td></tr>
            </tbody>
          </Table>
        </Card>
        <Card>
          <CardTitle>Top restaurants (period)</CardTitle>
          {data.topRestaurants.length ? (
            <Table>
              <thead><tr><th>Restaurant</th><th>Orders</th><th>Meals</th><th>Food sales</th></tr></thead>
              <tbody>{data.topRestaurants.map((r) => <tr key={r.id}><td><b>{r.name}</b><div className="text-xs text-muted">{r.city}</div></td><td>{r.orders}</td><td>{r.meals}</td><td>{money(r.foodCents)}</td></tr>)}</tbody>
            </Table>
          ) : <p className="text-muted">No completed orders in this period yet.</p>}
        </Card>
      </div>
    </>
  );
}
