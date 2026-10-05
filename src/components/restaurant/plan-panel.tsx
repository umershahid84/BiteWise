'use client';

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CreditCard, Leaf, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { createPlanSetupIntent, getPlan, setPlanAtRenewal, setPlanAutoRenew, subscribePlan, updatePlanCard } from '@/app/actions/restaurant';
import { CardEntry, type CardEntryHandle, type PaymentConfig } from '@/components/payments/card-entry';
import { Alert, ErrorText } from '@/components/ui/alert';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/field';
import { Spinner, Table } from '@/components/ui/misc';
import { fmtDate, money } from '@/lib/format';
import type { PlanSummary } from '@/lib/subscriptions';
import { cn } from '@/lib/utils';

type PaidPlan = 'monthly' | 'annual';
const NAMES = { founding: 'Founding Partner', monthly: 'Monthly', annual: 'Annual' } as const;
const usd = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

// The restaurant's Bite Wise plan: Founding Partner (free), or a monthly or annual plan that renews automatically.
export function PlanPanel({ payment, approved }: { payment: PaymentConfig; approved: boolean }) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['plan'],
    queryFn: async () => {
      const res = await getPlan();
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
  });
  const [checkout, setCheckout] = useState<{ plan: PaidPlan; mode: 'subscribe' | 'card' } | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['plan'] });

  if (isLoading) return <div className="grid place-items-center py-10"><Spinner /></div>;
  if (error || !data) return <Alert tone="error">{error?.message ?? 'Could not load your plan.'}</Alert>;
  const sub = data.subscription;
  const p = data.prices;

  return (
    <div className="grid gap-5">
      {sub?.plan === 'founding' ? (
        <FoundingCard number={sub.foundingNumber} />
      ) : sub && sub.status !== 'expired' ? (
        <CurrentPlan data={data} onCard={() => setCheckout({ plan: sub.plan as PaidPlan, mode: 'card' })} onChanged={refresh} />
      ) : (
        <>
          {sub?.status === 'expired' && <Alert tone="error">⛔ <b>Your plan has ended.</b> Your offers are paused. Choose a plan to post offers again.</Alert>}
          {!sub && !approved && p.foundingLeft > 0 && (
            <Alert tone="info">
              🌱 <b>Good news: {p.foundingLeft} of {p.foundingSpots} Founding Partner spots are still open.</b> Founding Partners use Bite Wise free for as long as they stay
              partners. If a spot is still open when your restaurant is approved, it&apos;s yours automatically: nothing to do now.
            </Alert>
          )}
          {!sub && approved && <Alert tone="warn">⭐ <b>Choose a plan to start posting offers.</b> No commission on your sales: just one simple fee.</Alert>}
          <PlanChooser prices={p} onChoose={(plan) => setCheckout({ plan, mode: 'subscribe' })} />
        </>
      )}

      {data.payments.length > 0 && (
        <Card>
          <CardTitle>Billing history</CardTitle>
          <Table>
            <thead><tr><th>Date</th><th>Invoice</th><th>Plan</th><th>Card</th><th className="text-right">Amount</th><th>Status</th></tr></thead>
            <tbody>
              {data.payments.map((x) => (
                <tr key={x.id}>
                  <td>{fmtDate(x.createdAt)}</td>
                  <td className="font-mono text-xs">{x.invoiceNumber ?? '–'}</td>
                  <td>{NAMES[x.plan]}{x.periodEnd && x.status === 'paid' && <div className="text-xs text-muted">through {fmtDate(x.periodEnd)}</div>}</td>
                  <td className="text-sm">{x.cardLabel}</td>
                  <td className="text-right font-semibold">{money(x.amountCents)}</td>
                  <td>{x.status === 'paid' ? <Badge tone="green">Paid</Badge> : <Badge tone="red" title={x.error}>Failed</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <Dialog open={!!checkout} onOpenChange={(o) => !o && setCheckout(null)}>
        {checkout && (
          <CheckoutForm
            payment={payment}
            plan={checkout.plan}
            mode={checkout.mode}
            amountCents={checkout.plan === 'annual' ? p.annualCents : p.monthlyCents}
            onDone={() => {
              setCheckout(null);
              refresh();
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

function FoundingCard({ number }: { number: number | null }) {
  return (
    <Card className="overflow-hidden border-primary/40 bg-primary-soft/60">
      <div className="flex flex-wrap items-center gap-5">
        <div className="grid size-20 place-items-center rounded-full bg-primary-600 text-white shadow-pop"><Leaf className="size-10" /></div>
        <div className="flex-1">
          <p className="m-0 text-sm font-bold tracking-wide text-primary-ink uppercase">Your plan</p>
          <h2 className="m-0 text-2xl font-extrabold">Founding Partner{number ? ` #${number}` : ''} 🎉</h2>
          <p className="m-0 mt-1 text-ink-2">
            As one of the first restaurants on Bite Wise, you pay <b>no subscription fee, for as long as you&apos;re a partner</b>. No card needed, nothing to renew.
            Thank you for helping us rescue good food from day one.
          </p>
        </div>
      </div>
    </Card>
  );
}

function PlanChooser({ prices, onChoose }: { prices: PlanSummary['prices']; onChoose: (plan: PaidPlan) => void }) {
  const saving = prices.monthlyCents * 12 - prices.annualCents;
  const perks = ['Unlimited offers and menu items', 'Counter kiosk for your tablet', 'Live order bell and daily reports', 'Payouts at every pickup (Stripe)', 'No commission on your sales'];
  const plans: { plan: PaidPlan; price: string; per: string; note: string; best?: boolean }[] = [
    { plan: 'monthly', price: usd(prices.monthlyCents), per: '/ month', note: 'Billed monthly. Cancel any time.' },
    { plan: 'annual', price: usd(prices.annualCents), per: '/ year', note: `Billed yearly: ${usd(Math.round(prices.annualCents / 12))} a month.`, best: saving > 0 },
  ];
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {plans.map((x) => (
        <Card key={x.plan} className={cn('relative flex flex-col', x.best && 'border-2 border-primary shadow-pop')}>
          {x.best && <span className="absolute -top-3 right-5 rounded-full bg-accent px-3 py-1 text-xs font-extrabold text-white shadow">SAVE {usd(saving)}</span>}
          <p className="m-0 text-sm font-bold tracking-wide text-muted uppercase">{NAMES[x.plan]}</p>
          <p className="m-0 mt-1"><span className="text-4xl font-extrabold">{x.price}</span> <span className="text-muted">{x.per}</span></p>
          <p className="mt-1 mb-4 text-sm text-ink-2">{x.note}</p>
          <ul className="mb-5 grid flex-1 list-none gap-2 p-0 text-sm">
            {perks.map((perk) => <li key={perk} className="flex gap-2"><Check className="size-4 shrink-0 text-primary" /> {perk}</li>)}
          </ul>
          <Button block variant={x.best ? 'green' : 'primary'} onClick={() => onChoose(x.plan)}>Choose {NAMES[x.plan].toLowerCase()}</Button>
        </Card>
      ))}
      <p className="m-0 text-xs text-muted md:col-span-2">
        Plans are paid in advance and renew automatically at the end of each period until you turn auto-renewal off. Prices in US dollars. See section 5.6 of the
        Restaurant Partner Agreement.
      </p>
    </div>
  );
}

function CurrentPlan({ data, onCard, onChanged }: { data: PlanSummary; onCard: () => void; onChanged: () => void }) {
  const sub = data.subscription!;
  const [busy, setBusy] = useState(false);
  const other: PaidPlan = sub.plan === 'annual' ? 'monthly' : 'annual';
  const nextPlan = (sub.renewPlan ?? sub.plan) as PaidPlan;
  const nextPrice = nextPlan === 'annual' ? data.prices.annualCents : data.prices.monthlyCents;
  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(done);
    onChanged();
  };
  return (
    <Card>
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex-1">
          <p className="m-0 text-sm font-bold tracking-wide text-muted uppercase">Your plan</p>
          <h2 className="m-0 text-2xl font-extrabold">{NAMES[sub.plan]} · {usd(sub.priceCents)}<span className="text-base font-semibold text-muted"> / {sub.plan === 'annual' ? 'year' : 'month'}</span></h2>
          <p className="m-0 mt-1 text-ink-2">
            {sub.status === 'past_due'
              ? <>Payment failed. Please update your card by <b>{fmtDate(sub.graceEnd)}</b> to keep your offers live.</>
              : sub.autoRenew
                ? <>Renews automatically on <b>{fmtDate(sub.periodEnd)}</b> for {usd(nextPrice)} ({NAMES[nextPlan].toLowerCase()}).</>
                : <>Auto-renewal is off: your plan ends on <b>{fmtDate(sub.periodEnd)}</b>.</>}
          </p>
        </div>
        <StatusBadge status={sub.status} label={sub.status === 'past_due' ? 'Payment failed' : undefined} />
      </div>
      {sub.status === 'past_due' && sub.lastPaymentError && <Alert tone="error" className="mt-4">💳 {sub.lastPaymentError}</Alert>}

      <div className="mt-5 grid gap-3 border-t border-line pt-5 sm:grid-cols-3">
        <div>
          <p className="m-0 text-xs font-bold text-muted uppercase">Auto-renewal</p>
          <label className="mt-2 flex cursor-pointer items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={sub.autoRenew}
              disabled={busy}
              onClick={() => act(() => setPlanAutoRenew(!sub.autoRenew), sub.autoRenew ? 'Auto-renewal is off' : 'Auto-renewal is on')}
              className={cn('relative h-7 w-12 rounded-full transition-colors', sub.autoRenew ? 'bg-primary-600' : 'bg-line')}
            >
              <span className={cn('absolute top-1 left-1 size-5 rounded-full bg-white shadow transition-transform', sub.autoRenew && 'translate-x-5')} />
            </button>
            <span className="font-semibold">{sub.autoRenew ? 'On' : 'Off'}</span>
          </label>
        </div>
        <div>
          <p className="m-0 text-xs font-bold text-muted uppercase">Card</p>
          <p className="m-0 mt-2 flex items-center gap-2 font-semibold"><CreditCard className="size-4" /> {sub.cardLabel || '–'}</p>
          <Button size="sm" variant="ghost" className="mt-2" onClick={onCard}>{sub.status === 'past_due' ? 'Update card & pay' : 'Change card'}</Button>
        </div>
        <div>
          <p className="m-0 text-xs font-bold text-muted uppercase">From your next renewal</p>
          <p className="m-0 mt-2 font-semibold">{NAMES[nextPlan]} plan</p>
          <Button size="sm" variant="ghost" className="mt-2" disabled={busy} onClick={() => act(() => setPlanAtRenewal(nextPlan === sub.plan ? other : sub.plan), `From your next renewal: ${NAMES[nextPlan === sub.plan ? other : sub.plan].toLowerCase()} plan`)}>
            <RefreshCw /> Switch to {NAMES[nextPlan === sub.plan ? other : sub.plan].toLowerCase()}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function CheckoutForm({ payment, plan, mode, amountCents, onDone }: { payment: PaymentConfig; plan: PaidPlan; mode: 'subscribe' | 'card'; amountCents: number; onDone: () => void }) {
  const ref = useRef<CardEntryHandle>(null);
  const [autoRenew, setAutoRenew] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      // With Stripe the card is confirmed through a SetupIntent so renewals can charge it later.
      let secret: string | null = null;
      if (payment.mode === 'stripe') {
        const setup = await createPlanSetupIntent();
        if (!setup.ok) throw new Error(setup.error);
        secret = setup.data.clientSecret;
      }
      const token = await ref.current!.confirmSetup(secret);
      if (mode === 'subscribe') {
        const res = await subscribePlan({ plan, token, autoRenew });
        if (!res.ok) throw new Error(res.error);
        toast.success(`You're on the ${NAMES[plan].toLowerCase()} plan. Receipt ${res.data.invoiceNumber} is on its way.`);
      } else {
        const res = await updatePlanCard(token);
        if (!res.ok) throw new Error(res.error);
        toast.success(`Card updated: ${res.data.cardLabel}`);
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <DialogContent
      title={mode === 'subscribe' ? `${NAMES[plan]} plan · ${usd(amountCents)} / ${plan === 'annual' ? 'year' : 'month'}` : 'Change the card for your plan'}
      description={mode === 'subscribe' ? 'Paid now, in advance. Your offers can go live straight away.' : 'Future renewals are charged to this card. A failed payment is retried now.'}
    >
      <CardEntry config={payment} ref={ref} />
      {mode === 'subscribe' && (
        <Checkbox
          className="my-3"
          checked={autoRenew}
          onChange={(e) => setAutoRenew(e.target.checked)}
          label={<>Renew automatically every {plan === 'annual' ? 'year' : 'month'} (turn off any time in this tab)</>}
        />
      )}
      <ErrorText error={error} />
      <Button variant="green" block disabled={busy} onClick={submit}>
        {busy ? 'Processing…' : mode === 'subscribe' ? `Pay ${usd(amountCents)} and start my plan` : 'Save card'}
      </Button>
    </DialogContent>
  );
}
