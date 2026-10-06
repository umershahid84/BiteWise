'use client';

import { Card } from '@/components/ui/card';
import { Kpi, Spinner, Table } from '@/components/ui/misc';
import { money, pct } from '@/lib/format';
import { DownloadIcons, exportHref, RangePicker, TableHead, useAdmin, type Range } from './shared';

type Totals = { taxableCents: number; taxCents: number };
type Tax = {
  rows: { city: string; zip: string; rateBps: number; orders: number; taxableCents: number; taxCents: number }[];
  planRows: { city: string; zip: string; rateBps: number; invoices: number; taxableCents: number; taxCents: number }[];
  totals: Totals; planTotals: Totals; allTotals: Totals;
};

export function TaxPanel({ range, setRange }: { range: Range; setRange: (r: Range) => void }) {
  const { data, isLoading } = useAdmin<Tax>(['tax', range], 'tax', range);
  return (
    <>
      <div className="flex flex-wrap items-start"><RangePicker range={range} onChange={setRange} /><span className="flex-1" />
        {/* The whole tab (totals and both tables) as one PDF. */}
        <DownloadIcons what="the sales tax report" pdf={exportHref('tax', range, 'pdf')} /></div>
      <p className="mb-4 text-sm text-muted">Retail sales tax collected on completed orders (less refunds to the original payment) and on restaurant plan fees, by restaurant location. Use it for your Washington excise tax return.</p>
      {isLoading || !data ? <Spinner /> : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi value={money(data.allTotals.taxCents)} label="All sales tax collected" />
            <Kpi value={money(data.totals.taxCents)} label={`On food orders (${money(data.totals.taxableCents)} taxable)`} />
            <Kpi value={money(data.planTotals.taxCents)} label={`On plan fees (${money(data.planTotals.taxableCents)} taxable)`} />
            <Kpi value={money(data.allTotals.taxableCents)} label="Taxable sales and fees" />
          </div>
          <Card className="p-2">
            <TableHead title="Food orders" kind="tax" params={range} section="orders" what="sales tax on food orders" />
            <Table>
              <thead><tr><th>City</th><th>ZIP</th><th>Rate</th><th>Orders</th><th>Taxable sales</th><th>Sales tax</th></tr></thead>
              <tbody>{data.rows.map((x) => <tr key={`${x.city}${x.zip}${x.rateBps}`}><td>{x.city}</td><td>{x.zip}</td><td>{pct(x.rateBps)}</td><td>{x.orders}</td><td>{money(x.taxableCents)}</td><td>{money(x.taxCents)}</td></tr>)}</tbody>
            </Table>
          </Card>
          <Card className="mt-6 p-2">
            <TableHead title="Restaurant plan fees" kind="tax" params={range} section="plans" what="sales tax on plan fees" />
            <Table>
              <thead><tr><th>City</th><th>ZIP</th><th>Rate</th><th>Invoices</th><th>Taxable fees</th><th>Sales tax</th></tr></thead>
              <tbody>
                {data.planRows.map((x) => <tr key={`${x.city}${x.zip}${x.rateBps}`}><td>{x.city}</td><td>{x.zip}</td><td>{pct(x.rateBps)}</td><td>{x.invoices}</td><td>{money(x.taxableCents)}</td><td>{money(x.taxCents)}</td></tr>)}
                {!data.planRows.length && <tr><td colSpan={6} className="text-center text-sm text-muted">No taxable plan fees in this period.</td></tr>}
              </tbody>
            </Table>
          </Card>
        </>
      )}
    </>
  );
}
