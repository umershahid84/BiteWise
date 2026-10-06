'use client';

import { useMemo, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Kpi, Spinner, Table } from '@/components/ui/misc';
import { PagerBar, PagerFooter, usePager } from '@/components/ui/pager';
import { money } from '@/lib/format';
import { cn } from '@/lib/utils';
import { RangePicker, daysAgo, todayPT, useAdmin, type Range } from './shared';

type Line = {
  orders: number; meals: number; gmvCents: number; serviceFeesCents: number; planFeesCents: number; planInvoices: number; pioneerDiscountsCents: number;
  creditCostCents: number; netCents: number; orderTaxCents: number; planTaxCents: number;
};
type By = 'day' | 'month' | 'year';
type Income = {
  range: Range; by: By; totals: Line; quick: { today: Line; month: Line; year: Line };
  periods: (Line & { key: string })[];
  restaurants: (Line & { id: number; name: string; city: string })[];
};

const FEES = '#0fa874';
const PLANS = '#5b8def';

const label = (key: string, by: By, short = false) => {
  if (by === 'year') return key;
  if (by === 'month') return new Date(`${key}-15T12:00:00Z`).toLocaleDateString('en-US', { month: short ? 'short' : 'long', year: short ? '2-digit' : 'numeric' });
  return new Date(`${key}T12:00:00Z`).toLocaleDateString('en-US', short ? { month: 'numeric', day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
};

// The platform owner's income: today, this month and this year, then any date range by day, month or year.
export function IncomePanel() {
  const today = todayPT();
  const [range, setRange] = useState<Range>({ from: daysAgo(29), to: today });
  const [by, setBy] = useState<By>('day');
  const { data, isLoading } = useAdmin<Income>(['income', range, by], 'income', { ...range, by });
  // Newest period first, 25 a page.
  const key = `${range.from}|${range.to}|${by}`;
  const periods = usePager(useMemo(() => [...(data?.periods ?? [])].reverse(), [data]), key);
  const restaurants = usePager(data?.restaurants ?? [], key);
  const year = today.slice(0, 4);
  const presets: [string, Range, By][] = [
    ['This month', { from: `${today.slice(0, 8)}01`, to: today }, 'day'],
    ['This year', { from: `${year}-01-01`, to: today }, 'month'],
    ['Last year', { from: `${Number(year) - 1}-01-01`, to: `${Number(year) - 1}-12-31` }, 'month'],
    ['Since launch', { from: '2026-01-01', to: today }, 'year'],
  ];
  return (
    <>
      {data && (
        <div className="mb-6 grid gap-3 md:grid-cols-3">
          <QuickCard title="Today" line={data.quick.today} />
          <QuickCard title="This month" line={data.quick.month} />
          <QuickCard title="This year" line={data.quick.year} />
        </div>
      )}

      <div className="flex flex-wrap items-start gap-2">
        <RangePicker range={range} onChange={setRange} />
        {presets.map(([l, r, b]) => <Button key={l} variant="ghost" size="sm" onClick={() => { setRange(r); setBy(b); }}>{l}</Button>)}
        <span className="flex-1" />
        <div className="flex rounded-full border border-line p-0.5" role="group" aria-label="Group by">
          {(['day', 'month', 'year'] as const).map((b) => (
            <button key={b} type="button" onClick={() => setBy(b)} aria-pressed={by === b}
              className={cn('rounded-full px-3 py-1 text-sm font-bold text-muted', by === b && 'bg-primary-soft text-primary-ink')}>
              {b === 'day' ? 'Daily' : b === 'month' ? 'Monthly' : 'Yearly'}
            </button>
          ))}
        </div>
        <a className={buttonVariants({ variant: 'ghost', size: 'sm' })} href={`/api/admin/export/income?from=${range.from}&to=${range.to}&by=${by}`}><FileSpreadsheet /> Export CSV</a>
      </div>

      {isLoading || !data ? <div className="grid place-items-center py-10"><Spinner /></div> : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi value={<span className="text-primary-ink">{money(data.totals.netCents)}</span>} label="Net income" />
            <Kpi value={money(data.totals.serviceFeesCents)} label={`Service fees · ${data.totals.orders} orders`} />
            <Kpi value={money(data.totals.planFeesCents)} label={`Plan fees · ${data.totals.planInvoices} invoices`} />
            <Kpi value={data.totals.creditCostCents ? `−${money(data.totals.creditCostCents)}` : money(0)} label="Platform credit Bite Wise funded" />
            <Kpi value={money(data.totals.orders ? Math.round(data.totals.serviceFeesCents / data.totals.orders) : 0)} label="Average service fee per order" />
            <Kpi value={money(data.totals.gmvCents)} label={`Charged to customers · ${data.totals.meals} meals`} />
            <Kpi value={money(data.totals.pioneerDiscountsCents)} label="Pioneer Members discounts given" />
            <Kpi value={money(data.totals.orderTaxCents + data.totals.planTaxCents)} label="Sales tax collected (owed to WA, not income)" />
          </div>

          <Card className="mb-4 p-4">
            <div className="mb-2 flex flex-wrap items-center gap-4 text-sm">
              <b>Income {by === 'day' ? 'per day' : by === 'month' ? 'per month' : 'per year'}</b>
              <span className="flex items-center gap-1.5 text-muted"><i className="inline-block size-3 rounded-sm" style={{ background: FEES }} /> Service fees</span>
              <span className="flex items-center gap-1.5 text-muted"><i className="inline-block size-3 rounded-sm" style={{ background: PLANS }} /> Plan fees</span>
            </div>
            <IncomeChart rows={data.periods} by={by} />
          </Card>

          <Card className="mb-4 p-2">
            <PagerBar pager={periods} label={by === 'day' ? 'days' : by === 'month' ? 'months' : 'years'} />
            <Table>
              <thead><tr><th>{by === 'day' ? 'Day' : by === 'month' ? 'Month' : 'Year'}</th><th>Orders</th><th>Service fees</th><th>Plan fees</th><th>Credit cost</th><th>Net income</th><th>Sales tax collected</th></tr></thead>
              <tbody>
                {periods.rows.map((p) => (
                  <tr key={p.key}>
                    <td className="whitespace-nowrap">{label(p.key, by)}</td>
                    <td>{p.orders}</td>
                    <td>{money(p.serviceFeesCents)}</td>
                    <td>{money(p.planFeesCents)}{p.planInvoices > 0 && <span className="text-xs text-muted"> · {p.planInvoices}</span>}</td>
                    <td className={p.creditCostCents ? 'text-danger' : 'text-muted'}>{p.creditCostCents ? `−${money(p.creditCostCents)}` : '–'}</td>
                    <td><b>{money(p.netCents)}</b></td>
                    <td className="text-muted">{money(p.orderTaxCents + p.planTaxCents)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-line font-bold">
                  <td>Total{periods.pages > 1 && <span className="text-xs font-normal text-muted"> (all {periods.total})</span>}</td><td>{data.totals.orders}</td><td>{money(data.totals.serviceFeesCents)}</td><td>{money(data.totals.planFeesCents)}</td>
                  <td>{data.totals.creditCostCents ? `−${money(data.totals.creditCostCents)}` : '–'}</td><td>{money(data.totals.netCents)}</td>
                  <td>{money(data.totals.orderTaxCents + data.totals.planTaxCents)}</td>
                </tr>
              </tbody>
            </Table>
            <PagerFooter pager={periods} />
          </Card>

          <h3 className="mt-6 mb-2 text-lg font-extrabold">Income by restaurant</h3>
          <Card className="p-2">
            {!data.restaurants.length ? <p className="p-4 text-center text-sm text-muted">No income in this period.</p> : (
              <>
                <PagerBar pager={restaurants} label="restaurants" />
                <Table>
                  <thead><tr><th>Restaurant</th><th>Orders</th><th>Service fees</th><th>Plan fees</th><th>Income</th><th>Sales charged</th></tr></thead>
                  <tbody>
                    {restaurants.rows.map((x) => (
                      <tr key={x.id}>
                        <td><b>{x.name}</b><div className="text-xs text-muted">{x.city}</div></td>
                        <td>{x.orders}</td><td>{money(x.serviceFeesCents)}</td><td>{money(x.planFeesCents)}</td><td><b>{money(x.netCents)}</b></td><td className="text-muted">{money(x.gmvCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                <PagerFooter pager={restaurants} />
              </>
            )}
          </Card>
          <p className="mt-3 text-xs text-muted">
            Net income = service fees on completed orders + restaurant plan fees − platform credit Bite Wise funded (refunds as credit and goodwill credit),
            before payment processing (Stripe) fees. Orders count on their pickup day, plan fees on their payment day, in Pacific Time. Sales tax is
            collected for Washington State and is not income: see the Sales tax tab.
          </p>
        </>
      )}
    </>
  );
}

function QuickCard({ title, line }: { title: string; line: Line }) {
  return (
    <Card className="p-5">
      <p className="m-0 text-sm font-bold tracking-wide text-muted uppercase">{title}</p>
      <p className="m-0 mt-1 font-heading text-3xl font-extrabold text-primary-ink">{money(line.netCents)}</p>
      <div className="mt-3 grid grid-cols-[1fr_auto] gap-y-1 text-sm">
        <span className="text-muted">Service fees · {line.orders} orders</span><span className="text-right">{money(line.serviceFeesCents)}</span>
        <span className="text-muted">Plan fees · {line.planInvoices} invoices</span><span className="text-right">{money(line.planFeesCents)}</span>
        <span className="text-muted">Platform credit funded</span><span className="text-right">{line.creditCostCents ? `−${money(line.creditCostCents)}` : money(0)}</span>
      </div>
    </Card>
  );
}

// Stacked bars per period: service fees (bottom) and plan fees (top). Hover a bar for the numbers.
function IncomeChart({ rows, by }: { rows: (Line & { key: string })[]; by: By }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 900;
  const H = 240;
  const m = { t: 12, r: 12, b: 28, l: 56 };
  const max = Math.max(100, ...rows.map((r) => r.serviceFeesCents + r.planFeesCents));
  const rough = max / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * pow).find((s) => s >= rough) ?? rough;
  const top = Math.ceil(max / step) * step;
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const bw = iw / Math.max(1, rows.length);
  const barW = Math.max(2, Math.min(48, bw - 4));
  const y = (v: number) => m.t + ih - (v / top) * ih;
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  const labelEvery = Math.ceil(rows.length / 12);
  const h = hover !== null ? rows[hover] : null;
  return (
    <div className="relative">
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Income per period: service fees and plan fees" onMouseLeave={() => setHover(null)}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeWidth={1} />
            <text x={m.l - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--color-muted)">{money(v).replace('.00', '')}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const x = m.l + i * bw + (bw - barW) / 2;
          const fees = (Math.max(0, r.serviceFeesCents) / top) * ih;
          const plans = (Math.max(0, r.planFeesCents) / top) * ih;
          const o = hover === null || hover === i ? 1 : 0.55;
          return (
            <g key={r.key} onMouseEnter={() => setHover(i)}>
              <rect x={m.l + i * bw} y={m.t} width={bw} height={ih} fill="transparent" />
              {fees > 0 && <rect x={x} y={m.t + ih - fees} width={barW} height={fees} fill={FEES} opacity={o} />}
              {plans > 0 && <rect x={x} y={m.t + ih - fees - plans} width={barW} height={plans} rx={Math.min(3, barW / 2)} fill={PLANS} opacity={o} />}
              {i % labelEvery === 0 && <text x={m.l + i * bw + bw / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--color-muted)">{label(r.key, by, true)}</text>}
            </g>
          );
        })}
        <line x1={m.l} x2={W - m.r} y1={m.t + ih} y2={m.t + ih} stroke="var(--color-muted)" strokeWidth={1} />
      </svg>
      {h && (
        <div className="pointer-events-none absolute top-2 right-2 rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-pop">
          <b className="block text-sm">{label(h.key, by)}</b>
          <span style={{ color: FEES }}>■</span> Service fees {money(h.serviceFeesCents)} · {h.orders} orders<br />
          <span style={{ color: PLANS }}>■</span> Plan fees {money(h.planFeesCents)}<br />
          {h.creditCostCents > 0 && <>Credit funded −{money(h.creditCostCents)}<br /></>}
          <b>Net income {money(h.netCents)}</b>
        </div>
      )}
    </div>
  );
}
