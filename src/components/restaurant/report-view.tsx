'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Download, FileSpreadsheet } from 'lucide-react';
import { PrintButton } from '@/components/app/print-button';
import { buttonVariants } from '@/components/ui/button';
import { Paper } from '@/components/ui/card';
import { money } from '@/lib/format';
import type { Report } from '@/lib/receipts/data';
import { cn } from '@/lib/utils';

export function ReportView({ report: rep, today }: { report: Report; today: string }) {
  const router = useRouter();
  const s = rep.summary;
  const kpis: [string, string][] = [
    ['Food sales', money(s.foodSalesCents)], ['Orders picked up', String(s.ordersPickedUp)], ['Meals rescued', String(s.mealsRescued)],
    ['Discounts given', money(s.discountsCents)], ['Sales tax', money(s.salesTaxCents)], ['Total charged', money(s.totalChargedCents)],
  ];
  return (
    <main className="container-page py-8">
      <div className="no-print mb-5 flex flex-wrap items-center gap-2">
        <Link href="/restaurant" className={buttonVariants({ variant: 'ghost', size: 'sm' })}><ArrowLeft /> Dashboard</Link>
        <label className="ml-2 flex items-center gap-2 text-sm text-muted">
          Day
          <input
            type="date"
            value={rep.date}
            max={today}
            onChange={(e) => e.target.value && router.push(`/restaurant/report?date=${e.target.value}`)}
            className="h-9 rounded-full border border-line bg-bg-2 px-3 text-ink"
          />
        </label>
        <span className="flex-1" />
        <PrintButton />
        <a href={`/api/restaurant/report/csv?date=${rep.date}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}><FileSpreadsheet /> CSV</a>
        <a href={`/api/restaurant/report/pdf?date=${rep.date}`} className={buttonVariants({ size: 'sm' })}><Download /> Download PDF</a>
      </div>
      <Paper className="p-8">
        <div className="mb-5 flex items-start justify-between gap-4 border-b border-[#e3eae6] pb-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/logo.svg" alt="Rescue Bites" className="h-14" />
          <div className="text-right">
            <h1 className="m-0 text-2xl font-extrabold">Daily sales report</h1>
            <div className="text-sm text-[#6b7b73]">{rep.restaurant.name} · {rep.dateText}</div>
            <div className="text-sm text-[#6b7b73]">{rep.restaurant.address}, {rep.restaurant.city}, WA {rep.restaurant.zip}{rep.restaurant.phone && ` · ${rep.restaurant.phone}`}</div>
          </div>
        </div>
        <div className="mb-3 grid grid-cols-2 gap-2.5 md:grid-cols-6">
          {kpis.map(([k, v], i) => (
            <div key={k} className="rounded-xl bg-[#f2f7f4] px-3 py-2.5 print:[print-color-adjust:exact]">
              <div className="text-[0.68rem] font-bold tracking-wider text-[#6b7b73] uppercase">{k}</div>
              <b className={cn('block font-heading text-lg font-extrabold', i === 0 && 'text-[#047857]')}>{v}</b>
            </div>
          ))}
        </div>
        <p className="mb-5 text-sm text-[#6b7b73]">
          Menu value {money(s.menuValueCents)} · Rescue Bites service fees paid by customers {money(s.serviceFeesCents)} · Awaiting pickup {s.awaitingPickup} ·
          Cancelled {s.cancelled} · Not picked up {s.notPickedUp}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[0.82rem] [&_td]:border-b [&_td]:border-[#e3eae6] [&_td]:px-1.5 [&_td]:py-2 [&_th]:border-b [&_th]:border-[#e3eae6] [&_th]:px-1.5 [&_th]:py-2 [&_th]:text-left [&_th]:text-[0.68rem] [&_th]:tracking-wider [&_th]:text-[#6b7b73] [&_th]:uppercase">
            <thead>
              <tr><th>#</th><th>Ordered</th><th>Picked up</th><th>Customer</th><th>Item</th><th>Qty</th><th>Original</th><th>Disc.</th><th>Price</th><th>Food</th><th>Tax</th><th>Total</th><th>Status</th></tr>
            </thead>
            <tbody className="[&_tr:nth-child(even)]:bg-[#f8fbf9]">
              {rep.orders.length ? rep.orders.map((o) => (
                <tr key={o.id}>
                  <td>{o.id}</td><td>{o.orderedTime}</td><td>{o.pickedUpTime || '-'}</td><td>{o.customer}</td><td className="font-semibold">{o.item}</td>
                  <td>{o.quantity}</td><td>{money(o.originalUnitCents)}</td><td>{o.discountPct}%</td><td>{money(o.unitPriceCents)}</td>
                  <td>{money(o.subtotalCents)}</td><td>{money(o.taxCents)}</td><td>{money(o.totalCents)}</td>
                  <td><span className={cn('rounded-full px-2 py-0.5 text-[0.72rem] font-bold whitespace-nowrap', o.status === 'picked_up' ? 'bg-[#d1fae5] text-[#065f46]' : o.status === 'reserved' ? 'bg-[#fef3c7] text-[#92400e]' : 'bg-[#eef2f0] text-[#4b5a53]')}>{o.statusLabel}</span></td>
                </tr>
              )) : <tr><td colSpan={13} className="py-6 text-center text-[#6b7b73]">No orders on this day.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-xs text-[#6b7b73]">Sales totals include orders picked up (and charged) on this day. Times in Pacific Time. Generated {rep.generatedAtText}.</p>
      </Paper>
    </main>
  );
}
