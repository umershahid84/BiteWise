'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, Lock } from 'lucide-react';
import { payRestaurant } from '@/app/actions/admin';
import { Alert, ErrorText } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import { Spinner, Table } from '@/components/ui/misc';
import { PagerBar, PagerFooter, usePager } from '@/components/ui/pager';
import { fmtDateTime, money } from '@/lib/format';
import { day, useAdmin } from './shared';

type Balance = {
  restaurantId: number; name: string; city: string; status: string; email: string; orders: number; earnedCents: number; paidCents: number;
  balanceCents: number; lastPaidAt: string | null; stripeAccount: string | null; stripeReady: boolean; bank: string;
};
type History = { id: number; paid_at: string; invoice_number: string | null; kind: string; amount_cents: number; bank_details: string; transaction_id: string; note: string; restaurants: { name: string } | null };

export function PayoutsPanel() {
  const queryClient = useQueryClient();
  const [paying, setPaying] = useState<Balance | null>(null);
  const { data, isLoading } = useAdmin<{ balances: Balance[]; history: History[] }>(['payouts'], 'payouts');
  const balances = usePager(data?.balances ?? []);
  const history = usePager(data?.history ?? []);

  if (isLoading || !data) return <div className="grid place-items-center py-10"><Spinner /></div>;
  const owed = data.balances.reduce((n, b) => n + Math.max(0, b.balanceCents), 0);
  return (
    <>
      <Alert tone="info" className="mb-4">
        Restaurants connected to <b>Stripe Connect</b> are paid automatically at each pickup (destination charges with Bite Wise&apos;s application fee).
        Anything still owed, for example orders completed before a restaurant connected Stripe, shows below: send it through Stripe, or record a payment made another way.
      </Alert>
      <div className="mb-3 flex items-center">
        <CardTitle className="m-0">Balances · {money(owed)} owed</CardTitle>
        <span className="flex-1" />
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- CSV download, not a page */}
        <a className={buttonVariants({ variant: 'ghost', size: 'sm' })} href="/api/admin/export/payouts"><FileSpreadsheet /> Export CSV</a>
      </div>
      <Card className="mb-5 p-2">
        <PagerBar pager={balances} label="restaurants" />
        <Table>
          <thead><tr><th>Restaurant</th><th>Stripe</th><th>Orders</th><th>Earned</th><th>Paid</th><th>Owed</th><th /></tr></thead>
          <tbody>
            {balances.rows.map((b) => (
              <tr key={b.restaurantId}>
                <td><b>{b.name}</b><div className="text-xs text-muted">{b.city} · {b.email}</div></td>
                <td>{b.stripeReady ? <Badge tone="green">Connected</Badge> : <Badge tone="amber">Not connected</Badge>}<div className="text-xs text-muted">{b.bank}</div></td>
                <td>{b.orders}</td><td>{money(b.earnedCents)}</td><td>{money(b.paidCents)}</td>
                <td className={b.balanceCents > 0 ? 'font-bold text-accent-ink' : b.balanceCents < 0 ? 'text-danger' : ''}>{money(b.balanceCents)}</td>
                <td>{b.balanceCents > 0 && <Button size="sm" onClick={() => setPaying(b)}>Pay</Button>}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        <PagerFooter pager={balances} />
      </Card>
      <CardTitle>Payout history</CardTitle>
      <Card className="p-2">
        <PagerBar pager={history} label="payouts" />
        <Table>
          <thead><tr><th>Date</th><th>Invoice number</th><th>Restaurant</th><th>Bank / transaction details</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            {history.rows.map((h) => (
              <tr key={h.id}>
                <td className="text-xs whitespace-nowrap">{fmtDateTime(h.paid_at)}</td>
                <td><code className="text-xs">{h.invoice_number}</code><div className="text-xs text-muted">{h.kind}{h.note && ` · ${h.note}`}</div></td>
                <td className="text-sm">{h.restaurants?.name}</td>
                <td className="text-xs text-muted">{h.bank_details}<div>{h.transaction_id}</div></td>
                <td className={`text-right font-bold ${h.amount_cents < 0 ? 'text-danger' : ''}`}>{money(h.amount_cents)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        <PagerFooter pager={history} />
      </Card>
      <Dialog open={!!paying} onOpenChange={(o) => !o && setPaying(null)}>
        {paying && <PayForm b={paying} onDone={() => queryClient.invalidateQueries({ queryKey: ['admin'] })} />}
      </Dialog>
    </>
  );
}

function PayForm({ b, onDone }: { b: Balance; onDone: () => void }) {
  const [amount, setAmount] = useState((b.balanceCents / 100).toFixed(2));
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ invoiceNumber: string | null; transactionId: string; bankDetails: string } | null>(null);
  const manual = !b.stripeReady;
  const pay = async () => {
    setBusy(true);
    const res = await payRestaurant({ restaurantId: b.restaurantId, amount, note, manual });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setResult(res.data);
    onDone();
  };
  const bank = result?.bankDetails ?? (manual ? 'Paid outside Stripe (recorded by Bite Wise)' : `Stripe Connect ${b.stripeAccount}${b.bank ? ` · ${b.bank}` : ''}`);
  return (
    <DialogContent title={manual ? `Record payout to ${b.name}` : `Send payout to ${b.name}`}
      description={manual ? 'This restaurant has not connected Stripe. Record a payment you made another way (e.g. bank transfer).' : `Transfers ${money(b.balanceCents)} owed from Bite Wise's Stripe balance to the restaurant's Stripe account.`}>
      <Field label="Amount ($)" htmlFor="p-amt"><Input id="p-amt" inputMode="decimal" value={amount} disabled={!!result} onChange={(e) => setAmount(e.target.value)} /></Field>
      <Field label={<span className="inline-flex items-center gap-1.5"><Lock className="size-3.5" /> Invoice Number</span>} hint="Assigned by the system when the payout is saved. It can't be changed.">
        <Input readOnly value={result?.invoiceNumber ?? `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-… (assigned on save)`} className="font-mono text-sm" />
      </Field>
      <Field label={<span className="inline-flex items-center gap-1.5"><Lock className="size-3.5" /> Bank/Transaction Details</span>} hint="Filled in by the system. It can't be changed.">
        <Input readOnly value={result ? `${bank} · ${result.transactionId}` : bank} className="text-sm" />
      </Field>
      <Field label="Note (optional)" htmlFor="p-note"><Input id="p-note" value={note} disabled={!!result} onChange={(e) => setNote(e.target.value)} /></Field>
      <ErrorText error={error} />
      {result ? (
        <Alert tone="info">✓ Payout saved: <b>{result.invoiceNumber}</b> · {result.transactionId} · {day(new Date().toISOString())}</Alert>
      ) : (
        <Button block disabled={busy} onClick={pay}>{busy ? 'Working…' : manual ? 'Record payout' : `Send ${money(Math.round(Number(amount) * 100) || 0)} via Stripe`}</Button>
      )}
    </DialogContent>
  );
}
