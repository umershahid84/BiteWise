'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Minus, Plus, Receipt } from 'lucide-react';
import { confirmOrderPayment, placeOrder, type OrderConfirmation } from '@/app/actions/customer';
import { confetti } from '@/components/app/confetti';
import { Countdown } from '@/components/app/countdown';
import { PinTiles } from '@/components/app/pin-tiles';
import { CardEntry, cardText, type CardEntryHandle, type PaymentConfig } from '@/components/payments/card-entry';
import { Alert, ErrorText } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Checkbox, Input } from '@/components/ui/field';
import { SectionLabel } from '@/components/ui/misc';
import { MIN_CARD_CHARGE_CENTS, OFFER_REASONS } from '@/lib/constants';
import { fmtTime, money, pct } from '@/lib/format';
import { distanceMiles } from '@/lib/geo';
import type { Quote } from '@/lib/pricing';
import { supabaseBrowser } from '@/lib/supabase/client';
import { OfferImage } from './offer-card';
import type { OfferRow, Origin } from './types';
import { displayPhone } from '@/lib/phone';

export function CheckoutDialog({ offer, origin, payment, onClose }: {
  offer: OfferRow | null;
  origin: Origin | null;
  payment: PaymentConfig;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!offer} onOpenChange={(o) => !o && onClose()}>
      {offer && <CheckoutContent key={offer.id} offer={offer} origin={origin} payment={payment} onClose={onClose} />}
    </Dialog>
  );
}

function CheckoutContent({ offer, origin, payment, onClose }: { offer: OfferRow; origin: Origin | null; payment: PaymentConfig; onClose: () => void }) {
  const supabase = supabaseBrowser();
  const queryClient = useQueryClient();
  const router = useRouter();
  const cardRef = useRef<CardEntryHandle>(null);
  const [quantity, setQuantity] = useState(1);
  const [useCredit, setUseCredit] = useState(true);
  const [creditInput, setCreditInput] = useState<string | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [saveCard, setSaveCard] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<OrderConfirmation | null>(null);
  // The restaurant decides how many are available; customers can't order more than that.
  const max = offer.quantity_available;

  const quote = useQuery({
    queryKey: ['quote', offer.id, quantity],
    queryFn: async () => {
      const { data, error: e } = await supabase.rpc('quote_offer', { p_offer_id: offer.id, p_quantity: quantity });
      if (e) throw new Error(e.message);
      return data as unknown as Quote;
    },
    placeholderData: (prev) => prev,
  });
  const credit = useQuery({
    queryKey: ['credit-balance'],
    queryFn: async () => Number((await supabase.rpc('my_credit_balance')).data ?? 0),
  });
  const cards = useQuery({
    queryKey: ['cards'],
    queryFn: async () => (await supabase.from('payment_methods').select('*').order('is_default', { ascending: false }).order('created_at', { ascending: false })).data ?? [],
  });

  const total = quote.data?.totalCents ?? 0;
  const balance = credit.data ?? 0;
  const creditCents = useMemo(() => {
    if (!balance || !useCredit) return 0;
    const typed = creditInput === null ? Math.min(balance, total) : Math.round(Number(creditInput.replace(/[$,]/g, '')) * 100) || 0;
    return Math.max(0, Math.min(typed, balance, total));
  }, [balance, useCredit, creditInput, total]);
  const cardCents = total - creditCents;
  const selected = choice ?? (cards.data?.[0] ? String(cards.data[0].id) : 'new');

  const place = async () => {
    setBusy(true);
    setError(null);
    try {
      if (cardCents > 0 && cardCents < MIN_CARD_CHARGE_CENTS) {
        throw new Error('The amount left for your card must be at least $0.50. Apply a little more or less credit.');
      }
      const needsCard = cardCents > 0; // no card when credit covers the whole total
      const input = {
        offerId: offer.id,
        quantity,
        creditCents,
        cardId: needsCard && selected !== 'new' ? Number(selected) : null,
        newCard: needsCard && selected === 'new' ? { token: await cardRef.current!.getToken(), save: saveCard } : null,
      };
      const res = await placeOrder(input);
      if (!res.ok) {
        if (res.status === 404 || res.status === 409) queryClient.invalidateQueries({ queryKey: ['offers'] });
        throw new Error(res.error);
      }
      let order = res.data.order;
      if (res.data.requiresAction) {
        await cardRef.current!.handleAction(res.data.clientSecret!);
        const confirmed = await confirmOrderPayment(res.data.orderId);
        if (!confirmed.ok) throw new Error(confirmed.error);
        order = confirmed.data;
      }
      setDone(order);
      confetti();
      queryClient.invalidateQueries({ queryKey: ['offers'] });
      queryClient.invalidateQueries({ queryKey: ['credit-balance'] });
      queryClient.invalidateQueries({ queryKey: ['cards'] });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (done) return <Confirmation order={done} onClose={onClose} />;

  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${offer.restaurant_name}, ${offer.address}, ${offer.city}, WA ${offer.zip}`)}`;
  const away = origin && offer.lat != null ? distanceMiles(origin.lat, origin.lng, offer.lat, offer.lng) : null;
  const q = quote.data;
  return (
    <DialogContent title={offer.title}>
      {offer.image_url && (
        <OfferImage offer={offer} className="-mt-1 mb-4 h-48 rounded-xl">
          <span className="absolute top-3 left-3 rounded-full bg-accent px-3 py-1 font-heading text-sm font-extrabold text-on-accent">-{offer.discount_pct}%</span>
        </OfferImage>
      )}
      <p className="mb-1"><b>{offer.restaurant_name}</b>{offer.cuisine ? ` · ${offer.cuisine}` : ''}</p>
      <p className="mb-3 text-sm text-muted">
        {offer.address}, {offer.city}, WA {offer.zip} · <a href={mapUrl} target="_blank" rel="noopener">Map</a>
        {offer.phone && <> · <a href={`tel:${offer.phone.replace(/[^\d+]/g, '')}`}>{displayPhone(offer.phone)}</a></>}
        {away != null && <> · {away.toFixed(1)} mi away</>}
      </p>
      {offer.description && <p className="mb-3 text-ink-2">{offer.description}</p>}
      <div className="mb-3 flex flex-wrap gap-1.5">
        <Badge tone="amber">Why it&apos;s discounted: {OFFER_REASONS[offer.reason]}</Badge>
        {offer.dietary.map((d) => <Badge key={d} tone="diet">{d}</Badge>)}
      </div>
      <Alert tone="warn" className="mb-4">
        <Countdown until={offer.pickup_end} suffix=" until this food is discarded" />
        <br />
        Pick up by <b>{fmtTime(offer.pickup_end)}</b>. If you don&apos;t make it, your order is released and you&apos;re not charged.
      </Alert>

      <div className="flex items-center gap-3">
        <SectionLabel className="m-0">Quantity</SectionLabel>
        <span className="flex-1" />
        <div className="flex items-center gap-1 rounded-full border border-line bg-bg-2 p-1">
          <Button size="icon" variant="ghost" className="size-8" aria-label="Fewer" disabled={quantity <= 1} onClick={() => setQuantity((n) => Math.max(1, n - 1))}><Minus /></Button>
          <span className="w-8 text-center font-bold" aria-live="polite">{quantity}</span>
          <Button size="icon" variant="ghost" className="size-8" aria-label="More" disabled={quantity >= max} onClick={() => setQuantity((n) => Math.min(max, n + 1))}><Plus /></Button>
        </div>
      </div>
      <div className="mt-1.5 text-right text-xs text-muted">
        {quantity >= max
          ? <span className="text-accent-ink">That&apos;s all {max === 1 ? 'there is' : `${max} available`}. The restaurant set this limit.</span>
          : `${max} available`}
      </div>

      <SectionLabel>Order summary</SectionLabel>
      <div className="rounded-xl border border-line bg-bg-2 p-4 text-sm">
        {q ? (
          <table className="w-full [&_td]:py-1 [&_td:last-child]:text-right [&_td:last-child]:tabular-nums">
            <tbody>
              <tr><td>{q.quantity} × {offer.title} <span className="text-muted line-through">{money(q.originalUnitCents)}</span> {money(q.unitPriceCents)}</td><td>{money(q.subtotalCents)}</td></tr>
              <tr><td colSpan={2} className="text-primary-ink">You save {money(q.savingsCents)} ({q.discountPct}% off)</td></tr>
              <tr><td>Service fee ({pct(q.serviceFeeBps)})</td><td>{money(q.serviceFeeCents)}</td></tr>
              <tr><td>Sales tax ({pct(q.taxRateBps)})</td><td>{money(q.taxCents)}</td></tr>
              <tr className="border-t border-line text-base font-bold"><td className="pt-2">Total</td><td className="pt-2">{money(q.totalCents)}</td></tr>
              {creditCents > 0 && (
                <>
                  <tr className="text-primary-ink"><td>Bite Wise credit applied</td><td>−{money(creditCents)}</td></tr>
                  <tr className="font-bold"><td>{cardCents ? 'Card (charged at pickup)' : 'Due'}</td><td>{money(cardCents)}</td></tr>
                </>
              )}
            </tbody>
          </table>
        ) : (
          <div className="text-muted">Calculating…</div>
        )}
      </div>

      <SectionLabel>Payment</SectionLabel>
      {balance > 0 && (
        <div className="mb-3 rounded-xl border border-accent/30 bg-accent-soft/50 p-3">
          <Checkbox checked={useCredit} onChange={(e) => setUseCredit(e.target.checked)} label={<>Use my Bite Wise credit · <b>{money(balance)}</b> available</>} />
          {useCredit && (
            <div className="mt-2 flex items-center gap-2 text-sm">
              <span className="text-muted">Apply $</span>
              <Input className="h-9 w-28" inputMode="decimal" value={creditInput ?? (Math.min(balance, total) / 100).toFixed(2)} onChange={(e) => setCreditInput(e.target.value)} />
              <span className="text-xs text-muted">up to {money(Math.min(balance, total))}</span>
            </div>
          )}
        </div>
      )}
      {cardCents > 0 && (
        <div className="space-y-2">
          {(cards.data ?? []).map((c) => (
            <label key={c.id} className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-line px-3 py-2.5 has-[:checked]:border-primary has-[:checked]:bg-primary-soft/40">
              <input type="radio" name="pay" className="accent-[var(--color-primary)]" checked={selected === String(c.id)} onChange={() => setChoice(String(c.id))} />
              💳 {cardText(c)} <span className="text-xs text-muted">exp {String(c.exp_month).padStart(2, '0')}/{String(c.exp_year).slice(-2)}</span>
            </label>
          ))}
          <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-line px-3 py-2.5 has-[:checked]:border-primary has-[:checked]:bg-primary-soft/40">
            <input type="radio" name="pay" className="accent-[var(--color-primary)]" checked={selected === 'new'} onChange={() => setChoice('new')} /> ➕ Use a new card
          </label>
          {selected === 'new' && (
            <div className="rounded-xl border border-line p-3">
              <CardEntry config={payment} ref={cardRef} />
              <Checkbox className="mt-3" checked={saveCard} onChange={(e) => setSaveCard(e.target.checked)} label="Save this card for future orders" />
            </div>
          )}
        </div>
      )}
      <p className="my-3 text-sm text-muted">
        🔒 We&apos;ll place a temporary hold for the total now. <b>Your card is charged only when you pick up</b> and the restaurant enters your PIN.
      </p>
      <ErrorText error={error ?? quote.error?.message} />
      <Button block disabled={busy || !q} onClick={place}>
        {busy ? 'Placing order…' : cardCents ? `Place order · ${money(cardCents)}${creditCents ? ' + credit' : ''}` : 'Place order · paid with credit'}
      </Button>
    </DialogContent>
  );
}

function Confirmation({ order, onClose }: { order: OrderConfirmation; onClose: () => void }) {
  const r = order.restaurant;
  return (
    <DialogContent title="Order confirmed" hideTitle>
      <div className="text-center">
        {order.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={order.imageUrl} alt={order.itemTitle} className="mx-auto mb-3 h-36 w-full rounded-xl object-cover" />
        ) : (
          <div aria-hidden className="mb-2 text-6xl">🎉</div>
        )}
        <h2 className="text-2xl font-extrabold">🎉 Congratulations!</h2>
        <p className="text-muted">
          Your food is secured. You just rescued {order.quantity === 1 ? 'a meal' : `${order.quantity} meals`} from going to waste.
        </p>
        {order.pin && (
          <div className="my-5 rounded-card bg-grad p-5 text-on-primary">
            <small className="mb-2 block text-xs font-bold tracking-widest uppercase opacity-70">Your pickup PIN</small>
            <PinTiles pin={order.pin} />
            <div className="mt-2 text-sm opacity-90">Show this PIN at the counter</div>
          </div>
        )}
        <div className="rounded-xl bg-bg-2 p-4 text-left text-sm leading-relaxed">
          <b>{order.quantity} × {order.itemTitle}</b>
          <br />
          <span className="text-muted">{r?.name} · {r?.address}, {r?.city}</span>
          <br />
          Pick up by <b>{fmtTime(order.pickupEnd)}</b> · <Countdown until={order.pickupEnd} />
          <br />
          {order.creditAppliedCents >= order.totalCents
            ? <>Paid with your Bite Wise credit.</>
            : <>💳 {order.cardLabel} will be charged <b>{money(order.totalCents - order.creditAppliedCents)}</b> only when the restaurant enters your PIN.</>}
        </div>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link href="/orders" className={buttonVariants()}>View my orders</Link>
          <Link href={`/orders/${order.id}/receipt`} className={buttonVariants({ variant: 'ghost' })}><Receipt /> Receipt</Link>
          <Button variant="ghost" onClick={onClose}>Keep browsing</Button>
        </div>
      </div>
    </DialogContent>
  );
}
