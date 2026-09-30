'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileSpreadsheet } from 'lucide-react';
import { adminCancelOrder, refundOrder } from '@/app/actions/admin';
import { ErrorText } from '@/components/ui/alert';
import { StatusBadge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { SectionLabel, Spinner, Table } from '@/components/ui/misc';
import { ORDER_STATUS_LABELS, type OrderStatus } from '@/lib/constants';
import { fmtDateTime, money } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { AdminOrder } from '@/lib/admin';
import { adminGet, RangePicker, run, useAdmin, type Range } from './shared';

export function OrdersPanel({ range, setRange }: { range: Range; setRange: (r: Range) => void }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [refunding, setRefunding] = useState<AdminOrder | null>(null);
  const { data, isLoading } = useAdmin<{ orders: AdminOrder[] }>(['orders', range, status, q], 'orders', { ...range, status, q });
  const cancel = async (o: AdminOrder) => {
    const reason = prompt(`Cancel order #${o.id}? The customer's card hold is released. Reason (optional):`);
    if (reason === null) return;
    if (await run(() => adminCancelOrder({ id: o.id, reason }), `Order #${o.id} cancelled`)) queryClient.invalidateQueries({ queryKey: ['admin'] });
  };
  return (
    <>
      <RangePicker range={range} onChange={setRange} />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input className="max-w-sm" placeholder="Order #, customer, restaurant or item" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select className="max-w-52" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {(['reserved', 'picked_up', 'cancelled', 'expired', 'pending_payment'] as OrderStatus[]).map((s) => <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>)}
        </Select>
        <span className="flex-1" />
        <a className={buttonVariants({ variant: 'ghost', size: 'sm' })} href={`/api/admin/export/orders?from=${range.from}&to=${range.to}`}><FileSpreadsheet /> Export CSV</a>
      </div>
      <Card className="p-2">
        {isLoading ? <div className="grid place-items-center py-10"><Spinner /></div> : (
          <Table>
            <thead><tr><th>#</th><th>Order</th><th>Customer</th><th>Total</th><th>Refunded</th><th>Status</th><th /></tr></thead>
            <tbody>
              {(data?.orders ?? []).map((o) => (
                <tr key={o.id}>
                  <td>{o.id}</td>
                  <td><b>{o.quantity} × {o.itemTitle}</b><div className="text-xs text-muted">{o.restaurant} · {fmtDateTime(o.createdAt)}</div></td>
                  <td className="text-sm">{o.customer}<div className="text-xs text-muted">{o.customerEmail}</div></td>
                  <td>{money(o.totalCents)}{o.creditAppliedCents > 0 && <div className="text-xs text-accent-ink">{money(o.creditAppliedCents)} credit</div>}</td>
                  <td className="text-sm">
                    {o.refundedCents > 0 && <div>{money(o.refundedCents)} original</div>}
                    {o.creditedCents > 0 && <div className="text-accent-ink">{money(o.creditedCents)} as credit</div>}
                    {!o.refundedCents && !o.creditedCents && <span className="text-muted">–</span>}
                  </td>
                  <td><StatusBadge status={o.status} label={ORDER_STATUS_LABELS[o.status]} /></td>
                  <td className="whitespace-nowrap">
                    <div className="flex gap-1.5">
                      {o.status === 'picked_up' && o.refundableCents > 0 && <Button size="sm" variant="warm" onClick={() => setRefunding(o)}>Refund</Button>}
                      {(o.status === 'reserved' || o.status === 'pending_payment') && <Button size="sm" variant="danger" onClick={() => cancel(o)}>Cancel</Button>}
                      <a className={buttonVariants({ variant: 'ghost', size: 'sm' })} href={`/api/orders/${o.id}/receipt`} aria-label={`Receipt PDF for order ${o.id}`}><Download /></a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Dialog open={!!refunding} onOpenChange={(o) => !o && setRefunding(null)}>
        {refunding && <RefundForm order={refunding} onDone={() => { setRefunding(null); queryClient.invalidateQueries({ queryKey: ['admin'] }); }} />}
      </Dialog>
    </>
  );
}

const PRESETS = [10, 25, 50, 75, 100];

function RefundForm({ order: o, onDone }: { order: AdminOrder; onDone: () => void }) {
  const [percent, setPercent] = useState<number | null>(100);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'original' | 'credit'>('original');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const history = useQuery({ queryKey: ['admin', 'refunds', o.id], queryFn: () => adminGet<{ id: number; amount_cents: number; method: string; reason: string; created_at: string }[]>('refunds', { orderId: o.id }) });
  const cents = percent !== null ? Math.max(1, Math.round((o.refundableCents * percent) / 100)) : Math.round(Number(amount.replace(/[$,]/g, '')) * 100) || 0;
  const card = method === 'original' ? Math.min(cents, o.cardRefundableCents) : 0;
  const creditBack = method === 'original' ? cents - card : cents;
  const originalLabel = [o.cardRefundableCents > 0 && o.card, o.creditAppliedCents > 0 && 'platform credit they used'].filter(Boolean).join(' + ') || o.card;
  const submit = async () => {
    setBusy(true);
    const res = await refundOrder({ id: o.id, method, reason, ...(percent !== null ? { percent } : { amount }) });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onDone();
  };
  return (
    <DialogContent title={`Refund order #${o.id}`} description={`${o.quantity} × ${o.itemTitle} · ${o.restaurant} · ${o.customer}. Paid ${money(o.totalCents)}, ${money(o.refundableCents)} left to refund.`}>
      <SectionLabel className="mt-0">Amount</SectionLabel>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button key={p} type="button" onClick={() => setPercent(p)} className={cn('rounded-full border px-3 py-1.5 text-sm font-semibold', percent === p ? 'border-primary bg-primary-soft text-primary-ink' : 'border-line text-ink-2')}>{p}%</button>
        ))}
        <button type="button" onClick={() => setPercent(null)} className={cn('rounded-full border px-3 py-1.5 text-sm font-semibold', percent === null ? 'border-primary bg-primary-soft text-primary-ink' : 'border-line text-ink-2')}>Manual</button>
      </div>
      {percent === null && <Field label="Refund amount ($)" htmlFor="r-amt" className="mt-3 max-w-48"><Input id="r-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5.00" /></Field>}
      <div className="mt-2 text-sm">Refund: <b>{money(cents)}</b></div>

      <SectionLabel>Refund to</SectionLabel>
      <div className="space-y-2">
        <label className="flex cursor-pointer gap-2.5 rounded-xl border border-line p-3 has-[:checked]:border-primary has-[:checked]:bg-primary-soft/40">
          <input type="radio" name="method" className="mt-1 accent-[var(--color-primary)]" checked={method === 'original'} onChange={() => setMethod('original')} />
          <span><b>Original form of payment</b> · {originalLabel}
            <span className="block text-xs text-muted">{card > 0 && `${money(card)} back to ${o.card}`}{card > 0 && creditBack > 0 && ' + '}{creditBack > 0 && `${money(creditBack)} back to their credit balance`}. The restaurant and Rescue Bites both give up their share.</span></span>
        </label>
        <label className="flex cursor-pointer gap-2.5 rounded-xl border border-line p-3 has-[:checked]:border-primary has-[:checked]:bg-primary-soft/40">
          <input type="radio" name="method" className="mt-1 accent-[var(--color-primary)]" checked={method === 'credit'} onChange={() => setMethod('credit')} />
          <span><b>Rescue Bites platform credit</b>
            <span className="block text-xs text-muted">{money(cents)} added to their credit for future orders. Paid by Rescue Bites; the restaurant keeps its full payment.</span></span>
        </label>
      </div>
      <Field label="Reason" htmlFor="r-reason" className="mt-4"><Input id="r-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Food was cold at pickup" /></Field>
      {history.data && history.data.length > 0 && (
        <div className="mb-3 text-xs text-muted">Earlier refunds: {history.data.map((h) => `${money(h.amount_cents)} (${h.method === 'credit' ? 'credit' : 'original'})`).join(', ')}</div>
      )}
      <ErrorText error={error} />
      <Button variant="warm" block disabled={busy || cents < 1} onClick={submit}>{busy ? 'Refunding…' : `Refund ${money(cents)}`}</Button>
    </DialogContent>
  );
}
