'use client';

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { confirmPickup, lookupPickup, type PickupOrder } from '@/app/actions/restaurant';
import { ErrorText } from '@/components/ui/alert';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { fmtDateTime, money } from '@/lib/format';

export function PickupPanel() {
  const queryClient = useQueryClient();
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const [digits, setDigits] = useState(['', '', '', '']);
  const [order, setOrder] = useState<PickupOrder | null>(null);
  const [done, setDone] = useState<{ quantity: number; itemTitle: string; customerUsername: string; totalCents: number; creditAppliedCents: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pin = digits.join('');

  const reset = () => {
    setDigits(['', '', '', '']);
    setTimeout(() => inputs.current[0]?.focus(), 0);
  };

  const find = async (value: string) => {
    setBusy(true);
    setDone(null);
    const res = await lookupPickup(value);
    setBusy(false);
    if (!res.ok) {
      setOrder(null);
      setError(res.error);
      reset();
      return;
    }
    setError(null);
    setOrder(res.data);
  };

  const setDigit = (i: number, v: string) => {
    const next = [...digits];
    next[i] = v.replace(/\D/g, '').slice(-1);
    setDigits(next);
    if (next[i] && i < 3) inputs.current[i + 1]?.focus();
    if (next.every(Boolean)) find(next.join(''));
  };

  const confirm = async () => {
    if (!order) return;
    setBusy(true);
    const res = await confirmPickup(pin, order.id);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setDone(res.data);
    setOrder(null);
    setError(null);
    reset();
    queryClient.invalidateQueries({ queryKey: ['restaurant-stats'] });
    queryClient.invalidateQueries({ queryKey: ['restaurant-orders'] });
  };

  return (
    <Card className="mx-auto max-w-[520px]">
      <h2 className="text-center text-2xl font-extrabold">Verify a pickup</h2>
      <p className="text-center text-muted">Ask the customer for their 4-digit Bite Wise PIN.</p>
      <form autoComplete="off" onSubmit={(e) => { e.preventDefault(); if (pin.length === 4) find(pin); }}>
        <div className="my-5 flex justify-center gap-3">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => { inputs.current[i] = el; }}
              autoFocus={i === 0}
              inputMode="numeric"
              maxLength={1}
              aria-label={`PIN digit ${i + 1}`}
              data-i={i}
              value={d}
              onChange={(e) => setDigit(i, e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Backspace' && !d && i > 0) inputs.current[i - 1]?.focus(); }}
              onPaste={(e) => {
                const p = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 4);
                if (p.length === 4) {
                  e.preventDefault();
                  setDigits(p.split(''));
                  find(p);
                }
              }}
              className="h-20 w-16 rounded-2xl border-2 border-line bg-bg-2 text-center font-heading text-4xl font-extrabold outline-none focus:border-primary"
            />
          ))}
        </div>
        <Button variant="green" block type="submit" disabled={busy || pin.length < 4}>{busy ? 'Please wait…' : 'Find order'}</Button>
      </form>
      <ErrorText error={error} />
      {order && (
        <div className="mt-4 rounded-card border border-line bg-surface-2 p-5">
          <div className="flex items-center"><StatusBadge status="reserved" label="Awaiting pickup" /><span className="flex-1" /><span className="text-sm text-muted">Order #{order.id}</span></div>
          <div className="mt-3 flex items-center gap-3">
            {order.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={order.imageUrl} alt="" className="size-16 rounded-xl object-cover" />
            )}
            <h3 className="m-0 text-xl font-bold">{order.quantity} × {order.itemTitle}</h3>
          </div>
          <p className="mt-1 mb-3 text-sm text-muted">Customer: <b className="text-ink">{order.customerUsername}</b> · Ordered {fmtDateTime(order.createdAt)}</p>
          <table className="w-full text-sm [&_td]:py-0.5 [&_td:last-child]:text-right">
            <tbody>
              <tr><td>Food ({order.quantity} × {money(order.unitPriceCents)})</td><td>{money(order.subtotalCents)}</td></tr>
              <tr><td>Service fee</td><td>{money(order.serviceFeeCents)}</td></tr>
              <tr><td>Sales tax</td><td>{money(order.taxCents)}</td></tr>
              <tr className="border-t border-line font-bold"><td className="pt-1">Customer pays</td><td className="pt-1">{money(order.totalCents)}</td></tr>
            </tbody>
          </table>
          <Button block className="mt-4" disabled={busy} onClick={confirm}>
            {busy ? 'Charging…' : `Hand over food & charge ${money(order.totalCents - order.creditAppliedCents)}`}
          </Button>
          <Button variant="ghost" block className="mt-2" onClick={() => { setOrder(null); reset(); }}>Not this order</Button>
        </div>
      )}
      {done && (
        <div className="py-4 text-center">
          <div className="mx-auto mb-2 grid size-14 place-items-center rounded-full bg-primary text-3xl font-bold text-on-primary">✓</div>
          <h3 className="text-xl font-bold">Pickup confirmed</h3>
          <p className="text-muted">
            {done.quantity} × {done.itemTitle} for {done.customerUsername}.<br />
            {done.totalCents - done.creditAppliedCents > 0 ? `Card charged ${money(done.totalCents - done.creditAppliedCents)}.` : 'Paid with Bite Wise credit.'}
          </p>
        </div>
      )}
    </Card>
  );
}
