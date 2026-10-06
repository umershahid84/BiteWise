'use client';

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CreditCard, Leaf, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  addPlanCard, choosePlan, createPlanSetupIntent, getPlan, payPlanNow, removePlanCard, setDefaultPlanCard, setPlanAtRenewal, setPlanAutoRenew, subscribePlan,
} from '@/app/actions/restaurant';
import { CardEntry, type CardEntryHandle, type PaymentConfig } from '@/components/payments/card-entry';
import { Alert, ErrorText } from '@/components/ui/alert';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/field';
import { Spinner, Table } from '@/components/ui/misc';
import { fmtDate, money, pct } from '@/lib/format';
import type { PlanSummary } from '@/lib/subscriptions';
import { cn } from '@/lib/utils';

type PaidPlan = 'monthly' | 'annual';
type SavedCard = PlanSummary['cards'][number];
const NAMES = { founding: 'Pioneer', monthly: 'Monthly', annual: 'Annual' } as const;
const usd = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
const cardLabel = (c: SavedCard) => `${c.brand.toUpperCase()} •••• ${c.last4}`;

// Gets a card token from the card form. With Stripe the card is confirmed through a SetupIntent first, so it can be
// charged later without the restaurant present (auto-renewal).
async function cardToken(payment: PaymentConfig, ref: React.RefObject<CardEntryHandle | null>) {
  let secret: string | null = null;
  if (payment.mode === 'stripe') {
    const setup = await createPlanSetupIntent();
    if (!setup.ok) throw new Error(setup.error);
    secret = setup.data.clientSecret;
  }
  return ref.current!.confirmSetup(secret);
}

// The restaurant's Bite Wise plan. The first restaurants to choose a plan are Pioneer Members: free, no card, with a
// $0.00 invoice each period. Others pay a monthly or annual plan that renews automatically with the default card on
// file; a declined payment makes the plan delinquent until it is paid.
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
  const [subscribeTo, setSubscribeTo] = useState<PaidPlan | null>(null);
  const [addingCard, setAddingCard] = useState(false);
  const [paying, setPaying] = useState(false);
  const [choosing, setChoosing] = useState<PaidPlan | null>(null);
  const [welcome, setWelcome] = useState<{ number: number; plan: PaidPlan; invoice: string } | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['plan'] });

  if (isLoading) return <div className="grid place-items-center py-10"><Spinner /></div>;
  if (error || !data) return <Alert tone="error">{error?.message ?? 'Could not load your plan.'}</Alert>;
  const sub = data.subscription;
  const p = data.prices;
  const pioneer = !!sub?.pioneer || sub?.plan === 'founding';
  const paid = sub && !pioneer;

  // Pioneer spots left: the plan is free and no card is asked for. Otherwise the card form opens (once approved).
  const choose = async (plan: PaidPlan) => {
    setChoosing(plan);
    const res = await choosePlan(plan);
    setChoosing(null);
    if (!res.ok) return toast.error(res.error);
    if (res.data.pioneer) {
      setWelcome({ number: res.data.pioneer, plan, invoice: res.data.invoiceNumber ?? '' });
      refresh();
      return;
    }
    if (!res.data.canPay) return toast.info('All Pioneer spots are taken. You can choose a paid plan as soon as your restaurant is approved.');
    setSubscribeTo(plan);
  };

  const change = data.upcomingChange;
  const keepsFee = !!paid && sub!.status !== 'expired' && (sub!.grandfathered || (change && !change.appliesToExisting));
  return (
    <div className="grid gap-5">
      {change && !pioneer && (
        <Alert tone="info">
          📣 <b>Subscription fees change on {fmtDate(change.effectiveAt)} (12:01 AM Pacific):</b> {usd(change.monthlyCents)} a month or {usd(change.annualCents)} a year.{' '}
          {paid && sub!.status !== 'expired'
            ? keepsFee ? 'Good news: your current fee stays the same.' : 'Your plan pays the new fee from your first renewal on or after that date.'
            : 'Plans started from that date pay the new fees.'}
        </Alert>
      )}
      {sub?.status === 'past_due' && (
        <Card className="border-2 border-danger/60">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1">
              <p className="m-0 text-sm font-bold tracking-wide text-danger uppercase">Delinquent</p>
              <h2 className="m-0 text-xl font-extrabold">Your payment was declined, so your offers are paused.</h2>
              <p className="m-0 mt-1 text-ink-2">
                You can&apos;t post offers until your plan is paid. Pay {usd(sub.nextAmountCents)} now ({NAMES[(sub.renewPlan ?? sub.plan) as PaidPlan].toLowerCase()} plan) and
                you&apos;re live again straight away.{sub.lastPaymentError && <> Reason: {sub.lastPaymentError}</>}
              </p>
            </div>
            <Button variant="danger" onClick={() => setPaying(true)}>Pay {usd(sub.nextAmountCents)} now</Button>
          </div>
        </Card>
      )}

      {pioneer && sub ? (
        <PioneerCard sub={sub} onChanged={refresh} />
      ) : sub && sub.status !== 'expired' ? (
        <CurrentPlan data={data} onChanged={refresh} />
      ) : (
        <>
          {sub?.status === 'expired' && <Alert tone="error">⛔ <b>Your plan has ended.</b> Your offers are paused. Choose a plan to post offers again.</Alert>}
          {p.foundingLeft > 0 ? (
            <Card className="border-2 border-primary/60 bg-primary-soft/40">
              <p className="m-0 text-sm font-bold tracking-wide text-primary-ink uppercase">Pioneer offer · {p.foundingLeft} of {p.foundingSpots} spots left</p>
              <h2 className="m-0 mt-1 text-2xl font-extrabold">Choose your plan now and it&apos;s FREE 🎉</h2>
              <p className="m-0 mt-1 text-ink-2">
                The first {p.foundingSpots} restaurants to choose a plan become <b>Pioneer Members</b>: your monthly or annual plan costs $0.00 for as long as you stay
                a member, with no card needed. Every month or year you get an invoice showing your plan price, minus the Pioneer Members Discount, for a total of $0.00.
                {!approved && ' You can choose now, while we review your restaurant.'}
              </p>
            </Card>
          ) : (
            <>
              {!approved && <Alert tone="info">⏳ All Pioneer spots are taken. You can choose your plan as soon as your restaurant is approved.</Alert>}
              {approved && <Alert tone="warn">⭐ <b>Choose a plan to start posting offers.</b> No commission on your sales: just one simple fee.</Alert>}
            </>
          )}
          <PlanChooser prices={p} pioneer={p.foundingLeft > 0} taxed={data.taxRateBps > 0} busy={choosing} onChoose={choose} />
        </>
      )}

      {!pioneer && (
        <CardsOnFile cards={data.cards} renewing={!!paid && sub!.status !== 'expired' && sub!.autoRenew} onAdd={() => setAddingCard(true)} onChanged={refresh} />
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
                  <td className="font-mono text-xs">
                    {x.invoiceNumber ? <a href={`/restaurant/invoices/${x.id}`} target="_blank" rel="noopener">{x.invoiceNumber}</a> : '–'}
                  </td>
                  <td>{NAMES[x.plan]}{x.periodEnd && x.status === 'paid' && <div className="text-xs text-muted">through {fmtDate(x.periodEnd)}</div>}</td>
                  <td className="text-sm">{x.cardLabel || '–'}</td>
                  <td className="text-right">
                    {x.discountCents > 0 ? (
                      <>
                        <span className="text-xs text-muted line-through">{money(x.listPriceCents ?? x.discountCents)}</span>{' '}
                        <b>{money(x.amountCents)}</b>
                        <div className="text-xs text-primary-ink">−{money(x.discountCents)} {x.discountLabel}</div>
                      </>
                    ) : <b>{money(x.amountCents)}</b>}
                    {x.taxCents > 0 && <div className="text-xs text-muted">incl. {money(x.taxCents)} sales tax</div>}
                  </td>
                  <td>
                    {x.status === 'paid' ? <Badge tone="green">{x.amountCents === 0 && x.discountCents > 0 ? 'FREE' : 'Paid'}</Badge> : <Badge tone="red" title={x.error}>Declined</Badge>}
                    {x.status === 'failed' && x.error && <div className="mt-1 text-xs text-muted">{x.error}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <Dialog open={!!welcome} onOpenChange={(o) => !o && setWelcome(null)}>
        {welcome && (
          <DialogContent title="Congratulations! 🎉" description="You're one of our first restaurants.">
            <div className="rounded-2xl bg-primary-soft/60 p-5 text-center">
              <p className="m-0 text-sm font-bold tracking-wide text-primary-ink uppercase">Pioneer Member #{welcome.number}</p>
              <p className="m-0 mt-1 text-3xl font-extrabold">Your subscription is FREE</p>
              <p className="m-0 mt-2 text-ink-2">
                {NAMES[welcome.plan]} plan: <span className="line-through">{usd(welcome.plan === 'annual' ? p.annualCents : p.monthlyCents)}</span> → <b>$0.00</b> every{' '}
                {welcome.plan === 'annual' ? 'year' : 'month'}. No card needed.
              </p>
            </div>
            <p className="mb-4 text-sm text-ink-2">
              Your first invoice{welcome.invoice && <> ({welcome.invoice})</>} is in your inbox and below. {approved ? 'You can post offers now.' : 'Once your restaurant is approved, your offers go live.'}
            </p>
            <Button block variant="green" onClick={() => setWelcome(null)}>Wonderful!</Button>
          </DialogContent>
        )}
      </Dialog>
      <Dialog open={!!subscribeTo} onOpenChange={(o) => !o && setSubscribeTo(null)}>
        {subscribeTo && (
          <SubscribeForm
            payment={payment}
            plan={subscribeTo}
            cards={data.cards}
            amountCents={subscribeTo === 'annual' ? p.annualCents : p.monthlyCents}
            taxRateBps={data.taxRateBps}
            onDone={() => { setSubscribeTo(null); refresh(); }}
          />
        )}
      </Dialog>
      <Dialog open={addingCard} onOpenChange={(o) => !o && setAddingCard(false)}>
        {addingCard && <AddCardForm payment={payment} first={data.cards.length === 0} onDone={() => { setAddingCard(false); refresh(); }} />}
      </Dialog>
      <Dialog open={paying} onOpenChange={(o) => !o && setPaying(false)}>
        {paying && sub && <PayNowForm payment={payment} cards={data.cards} amountCents={sub.nextAmountCents} onDone={() => { setPaying(false); refresh(); }} />}
      </Dialog>
    </div>
  );
}

function PioneerCard({ sub, onChanged }: { sub: NonNullable<PlanSummary['subscription']>; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const legacy = sub.plan === 'founding';
  const plan = legacy ? null : ((sub.renewPlan ?? sub.plan) as PaidPlan);
  const other: PaidPlan = plan === 'annual' ? 'monthly' : 'annual';
  return (
    <Card className="overflow-hidden border-primary/40 bg-primary-soft/60">
      <div className="flex flex-wrap items-center gap-5">
        <div className="grid size-20 place-items-center rounded-full bg-primary-600 text-white shadow-pop"><Leaf className="size-10" /></div>
        <div className="flex-1">
          <p className="m-0 text-sm font-bold tracking-wide text-primary-ink uppercase">Pioneer Member{sub.foundingNumber ? ` #${sub.foundingNumber}` : ''}</p>
          <h2 className="m-0 text-2xl font-extrabold">{legacy ? 'Your plan' : `${NAMES[sub.plan as PaidPlan]} plan`} · FREE 🎉</h2>
          <p className="m-0 mt-1 text-ink-2">
            {legacy
              ? 'As one of the first restaurants on Bite Wise, you pay no subscription fee.'
              : <>Your <span className="line-through">{usd(sub.listPriceCents)}</span> {sub.plan === 'annual' ? 'yearly' : 'monthly'} fee is covered by the <b>Pioneer Members Discount</b>.
                You get a $0.00 invoice every {sub.plan === 'annual' ? 'year' : 'month'}; the next one on <b>{fmtDate(sub.periodEnd)}</b>. No card needed.</>}
          </p>
        </div>
        {plan && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={async () => {
            setBusy(true);
            const res = await setPlanAtRenewal(other);
            setBusy(false);
            if (!res.ok) return toast.error(res.error);
            toast.success(`From ${fmtDate(sub.periodEnd)}: ${NAMES[other].toLowerCase()} plan, still FREE`);
            onChanged();
          }}>
            <RefreshCw /> {sub.renewPlan ? `Switching to ${NAMES[sub.renewPlan as PaidPlan].toLowerCase()}` : `Switch to ${NAMES[other].toLowerCase()}`}
          </Button>
        )}
      </div>
    </Card>
  );
}

function PlanChooser({ prices, pioneer, taxed, busy, onChoose }: { prices: PlanSummary['prices']; pioneer: boolean; taxed: boolean; busy: PaidPlan | null; onChoose: (plan: PaidPlan) => void }) {
  const saving = prices.monthlyCents * 12 - prices.annualCents;
  const perks = ['Unlimited offers and menu items', 'Counter kiosk for your tablet', 'Live order bell and daily reports', 'Payouts at every pickup (Stripe)', 'No commission on your sales'];
  const plans: { plan: PaidPlan; price: string; per: string; note: string; best?: boolean }[] = [
    { plan: 'monthly', price: usd(prices.monthlyCents), per: pioneer || !taxed ? '/ month' : '/ month + tax', note: pioneer ? 'A $0.00 invoice every month.' : 'Billed monthly. Cancel any time.' },
    { plan: 'annual', price: usd(prices.annualCents), per: pioneer || !taxed ? '/ year' : '/ year + tax', note: pioneer ? 'A $0.00 invoice every year.' : `Billed yearly: ${usd(Math.round(prices.annualCents / 12))} a month.`, best: saving > 0 },
  ];
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {plans.map((x) => (
        <Card key={x.plan} className={cn('relative flex flex-col', x.best && 'border-2 border-primary shadow-pop')}>
          {pioneer
            ? <span className="absolute -top-3 right-5 rounded-full bg-primary-600 px-3 py-1 text-xs font-extrabold text-white shadow">FREE FOR PIONEERS</span>
            : x.best && <span className="absolute -top-3 right-5 rounded-full bg-accent px-3 py-1 text-xs font-extrabold text-white shadow">SAVE {usd(saving)}</span>}
          <p className="m-0 text-sm font-bold tracking-wide text-muted uppercase">{NAMES[x.plan]}</p>
          {pioneer ? (
            <p className="m-0 mt-1"><span className="text-4xl font-extrabold">$0.00</span> <span className="text-muted line-through">{x.price}</span> <span className="text-muted">{x.per}</span></p>
          ) : (
            <p className="m-0 mt-1"><span className="text-4xl font-extrabold">{x.price}</span> <span className="text-muted">{x.per}</span></p>
          )}
          <p className="mt-1 mb-4 text-sm text-ink-2">{x.note}</p>
          <ul className="mb-5 grid flex-1 list-none gap-2 p-0 text-sm">
            {perks.map((perk) => <li key={perk} className="flex gap-2"><Check className="size-4 shrink-0 text-primary" /> {perk}</li>)}
          </ul>
          <Button block variant={x.best || pioneer ? 'green' : 'primary'} disabled={!!busy} onClick={() => onChoose(x.plan)}>
            {busy === x.plan ? 'One moment…' : `Choose ${NAMES[x.plan].toLowerCase()}${pioneer ? ': FREE' : ''}`}
          </Button>
        </Card>
      ))}
      <p className="m-0 text-xs text-muted md:col-span-2">
        {pioneer
          ? 'Pioneer memberships renew automatically, free, with no card on file. Prices shown are the regular prices covered by the Pioneer Members Discount.'
          : 'Plans are paid in advance and renew automatically with your default card on file until you turn auto-renewal off. If a payment is declined, your offers are paused until the plan is paid.'}{' '}
        Prices in US dollars. See section 5.6 of the Restaurant Partner Agreement.
      </p>
    </div>
  );
}

function CurrentPlan({ data, onChanged }: { data: PlanSummary; onChanged: () => void }) {
  const sub = data.subscription!;
  const [busy, setBusy] = useState(false);
  const nextPlan = (sub.renewPlan ?? sub.plan) as PaidPlan;
  const other: PaidPlan = nextPlan === 'annual' ? 'monthly' : 'annual';
  const defaultCard = data.cards.find((c) => c.isDefault);
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
          {sub.grandfathered && <p className="m-0 mt-1 text-sm font-semibold text-primary-ink">🔒 Your fee is locked in: you keep this price when it renews.</p>}
          <p className="m-0 mt-1 text-ink-2">
            {sub.status === 'past_due'
              ? <>Delinquent since {fmtDate(sub.periodEnd)}: pay to post offers again.</>
              : sub.autoRenew
                ? <>Renews automatically on <b>{fmtDate(sub.periodEnd)}</b> for {usd(sub.nextAmountCents)} {sub.nextTaxCents ? <> including {usd(sub.nextTaxCents)} sales tax</> : null} ({NAMES[nextPlan].toLowerCase()}), charged to {defaultCard ? cardLabel(defaultCard) : 'your default card'}.</>
                : <>Auto-renewal is off: your plan ends on <b>{fmtDate(sub.periodEnd)}</b>.</>}
          </p>
        </div>
        <StatusBadge status={sub.status} label={sub.status === 'past_due' ? 'Delinquent' : undefined} />
      </div>

      <div className="mt-5 grid gap-4 border-t border-line pt-5 sm:grid-cols-2">
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
            <span className="font-semibold">{sub.autoRenew ? 'On: your default card is charged at each renewal' : 'Off'}</span>
          </label>
        </div>
        <div>
          <p className="m-0 text-xs font-bold text-muted uppercase">From your next {sub.status === 'past_due' ? 'payment' : 'renewal'}</p>
          <p className="m-0 mt-2 font-semibold">{NAMES[nextPlan]} plan · {usd(sub.nextAmountCents)}</p>
          <Button size="sm" variant="ghost" className="mt-2" disabled={busy} onClick={() => act(() => setPlanAtRenewal(other), `From your next renewal: ${NAMES[other].toLowerCase()} plan`)}>
            <RefreshCw /> Switch to {NAMES[other].toLowerCase()}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function CardsOnFile({ cards, renewing, onAdd, onChanged }: { cards: SavedCard[]; renewing: boolean; onAdd: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState<number | null>(null);
  const act = async (id: number, fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setBusy(id);
    const res = await fn();
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    toast.success(done);
    onChanged();
  };
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <CardTitle className="m-0">Cards on file</CardTitle>
          <p className="m-0 text-sm text-muted">Your <b>default</b> card pays for your plan and its automatic renewals.</p>
        </div>
        <Button size="sm" onClick={onAdd}><Plus /> Add a card</Button>
      </div>
      {cards.length === 0 ? (
        <p className="m-0 rounded-xl border border-dashed border-line p-4 text-sm text-muted">No cards on file yet.{renewing && ' Add one so your plan can renew.'}</p>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {cards.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line px-4 py-3">
              <CreditCard className="size-5 text-muted" />
              <span className="font-semibold">{cardLabel(c)}</span>
              <span className="text-sm text-muted">expires {String(c.expMonth).padStart(2, '0')}/{String(c.expYear).slice(-2)}</span>
              {c.isDefault && <Badge tone="green">Default · auto-renewal</Badge>}
              <span className="flex-1" />
              {!c.isDefault && <Button size="sm" variant="ghost" disabled={busy === c.id} onClick={() => act(c.id, () => setDefaultPlanCard(c.id), `${cardLabel(c)} is your default card`)}>Make default</Button>}
              <Button size="sm" variant="ghost" className="text-danger" disabled={busy === c.id} aria-label={`Remove ${cardLabel(c)}`}
                onClick={() => confirm(`Remove ${cardLabel(c)}?`) && act(c.id, () => removePlanCard(c.id), 'Card removed')}><Trash2 /></Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// Choose a card on file, or enter a new one (it is saved to the cards on file).
function CardPicker({ payment, cards, choice, onChoice, entryRef }: {
  payment: PaymentConfig; cards: SavedCard[]; choice: number | 'new'; onChoice: (c: number | 'new') => void; entryRef: React.RefObject<CardEntryHandle | null>;
}) {
  return (
    <div className="mb-3 grid gap-2" role="radiogroup" aria-label="Card">
      {cards.map((c) => (
        <label key={c.id} className={cn('flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3', choice === c.id ? 'border-primary bg-primary-soft/40' : 'border-line')}>
          <input type="radio" name="card" checked={choice === c.id} onChange={() => onChoice(c.id)} />
          <CreditCard className="size-4 text-muted" /> <span className="font-semibold">{cardLabel(c)}</span>
          {c.isDefault && <span className="text-xs text-muted">default</span>}
        </label>
      ))}
      {cards.length > 0 && (
        <label className={cn('flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3', choice === 'new' ? 'border-primary bg-primary-soft/40' : 'border-line')}>
          <input type="radio" name="card" checked={choice === 'new'} onChange={() => onChoice('new')} /> <Plus className="size-4" /> A new card
        </label>
      )}
      {choice === 'new' && <div className="mt-1"><CardEntry config={payment} ref={entryRef} /></div>}
    </div>
  );
}

// `amountCents` is the plan price; sales tax (the restaurant's rate, where plan fees are taxed) is added at checkout.
function SubscribeForm({ payment, plan, cards, amountCents, taxRateBps, onDone }: {
  payment: PaymentConfig; plan: PaidPlan; cards: SavedCard[]; amountCents: number; taxRateBps: number; onDone: () => void;
}) {
  const tax = Math.round((amountCents * taxRateBps) / 10000);
  const total = amountCents + tax;
  const ref = useRef<CardEntryHandle>(null);
  const [choice, setChoice] = useState<number | 'new'>(cards.find((c) => c.isDefault)?.id ?? cards[0]?.id ?? 'new');
  const [autoRenew, setAutoRenew] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = choice === 'new'
        ? await subscribePlan({ plan, token: await cardToken(payment, ref), autoRenew })
        : await subscribePlan({ plan, cardId: choice, autoRenew });
      if (!res.ok) throw new Error(res.error);
      toast.success(`You're on the ${NAMES[plan].toLowerCase()} plan. Receipt ${res.data.invoiceNumber} is on its way.`);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <DialogContent title={`${NAMES[plan]} plan · ${usd(amountCents)} / ${plan === 'annual' ? 'year' : 'month'}`} description={`Paid now, in advance${taxRateBps ? ', plus sales tax' : ''}. Your offers can go live straight away.`}>
      <div className="mb-3 grid grid-cols-[1fr_auto] gap-y-1 rounded-xl bg-surface-2 px-4 py-3 text-sm">
        <span>{NAMES[plan]} plan</span><span className="text-right">{usd(amountCents)}</span>
        <span className="text-muted">Sales tax ({pct(taxRateBps)})</span><span className="text-right text-muted">{usd(tax)}</span>
        <b>Total today</b><b className="text-right">{usd(total)}</b>
      </div>
      <CardPicker payment={payment} cards={cards} choice={choice} onChoice={setChoice} entryRef={ref} />
      {choice === 'new' && <p className="mt-0 mb-2 text-xs text-muted">This card is saved to your cards on file as your default card.</p>}
      <Checkbox className="my-3" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)}
        label={<>Renew automatically every {plan === 'annual' ? 'year' : 'month'} with my default card (turn off any time)</>} />
      <ErrorText error={error} />
      <Button variant="green" block disabled={busy} onClick={submit}>{busy ? 'Processing…' : `Pay ${usd(total)} and start my plan`}</Button>
    </DialogContent>
  );
}

function PayNowForm({ payment, cards, amountCents, onDone }: { payment: PaymentConfig; cards: SavedCard[]; amountCents: number; onDone: () => void }) {
  const ref = useRef<CardEntryHandle>(null);
  const [choice, setChoice] = useState<number | 'new'>(cards.find((c) => c.isDefault)?.id ?? cards[0]?.id ?? 'new');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      let cardId = choice;
      if (cardId === 'new') {
        const added = await addPlanCard(await cardToken(payment, ref), true);
        if (!added.ok) throw new Error(added.error);
        cardId = added.data.id;
      }
      const res = await payPlanNow(cardId);
      if (!res.ok) throw new Error(res.error);
      toast.success(`Paid. Your plan is active until ${fmtDate(res.data.periodEnd)} and you can post offers again.`);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <DialogContent title={`Pay ${usd(amountCents)} now`} description="Your plan becomes active again as soon as the payment goes through, and a new period starts today.">
      <CardPicker payment={payment} cards={cards} choice={choice} onChoice={setChoice} entryRef={ref} />
      {choice === 'new' && <p className="mt-0 mb-2 text-xs text-muted">This card is saved to your cards on file as your default card.</p>}
      <ErrorText error={error} />
      <Button variant="green" block disabled={busy} onClick={submit}>{busy ? 'Processing…' : `Pay ${usd(amountCents)}`}</Button>
    </DialogContent>
  );
}

function AddCardForm({ payment, first, onDone }: { payment: PaymentConfig; first: boolean; onDone: () => void }) {
  const ref = useRef<CardEntryHandle>(null);
  const [makeDefault, setMakeDefault] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await addPlanCard(await cardToken(payment, ref), makeDefault || first);
      if (!res.ok) throw new Error(res.error);
      toast.success('Card saved');
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <DialogContent title="Add a card on file" description="Saved securely with our payment processor. Nothing is charged now.">
      <CardEntry config={payment} ref={ref} />
      {!first && <Checkbox className="my-3" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} label="Make this my default card (used for auto-renewal)" />}
      <ErrorText error={error} />
      <Button variant="green" block disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Save card'}</Button>
    </DialogContent>
  );
}
