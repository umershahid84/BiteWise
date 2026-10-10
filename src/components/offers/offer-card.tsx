'use client';

import { useState } from 'react';
import { Clock, MapPin } from 'lucide-react';
import { Countdown } from '@/components/app/countdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cuisineEmoji, cuisineHue, OFFER_REASONS } from '@/lib/constants';
import { fmtTime, money } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { OfferRow } from './types';

export function OfferImage({ offer, className, children }: { offer: Pick<OfferRow, 'image_url' | 'title' | 'cuisine'>; className?: string; children?: React.ReactNode }) {
  const hue = cuisineHue(offer.cuisine);
  return (
    <div
      className={cn('relative grid place-items-center overflow-hidden', className)}
      style={offer.image_url ? undefined : { background: `linear-gradient(135deg, hsl(${hue} var(--tile-s) var(--tile-l1)), hsl(${hue + 40} var(--tile-s) var(--tile-l2)))` }}
    >
      {offer.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={offer.image_url} alt={offer.title} loading="lazy" className="absolute inset-0 size-full object-cover" />
      ) : (
        <span aria-hidden className="text-[54px] drop-shadow-lg">{cuisineEmoji(offer.cuisine)}</span>
      )}
      {children}
    </div>
  );
}

export function OfferCard({ offer, onOrder }: { offer: OfferRow; onOrder: () => void }) {
  const [expired, setExpired] = useState(false);
  return (
    <article className={cn('flex flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card transition hover:-translate-y-0.5', expired && 'opacity-50 grayscale')}>
      <OfferImage offer={offer} className={offer.image_url ? 'h-[180px]' : 'h-32'}>
        <span className="absolute top-3 left-3 rounded-full bg-accent px-3 py-1 font-heading text-sm font-extrabold text-on-accent">-{offer.discount_pct}%</span>
        <span className={cn('absolute top-3 right-3 rounded-full px-2.5 py-1 text-xs font-bold backdrop-blur', offer.quantity_available <= 2 ? 'bg-accent text-on-accent' : 'bg-bg/70 text-ink')}>
          {offer.quantity_available} left
        </span>
        <span className="absolute bottom-3 left-3 rounded-full bg-bg/75 px-2.5 py-1 text-xs backdrop-blur">
          <Countdown until={offer.pickup_end} onExpire={() => setExpired(true)} />
        </span>
      </OfferImage>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="m-0 text-lg font-bold">{offer.title}</h3>
        <div className="text-sm text-muted">{offer.restaurant_name} · {offer.city}</div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2">
          <span className="inline-flex items-center gap-1"><Clock className="size-3.5" /> Pick up by {fmtTime(offer.pickup_end)}</span>
          {offer.distance_miles != null && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" /> {offer.distance_miles} mi</span>}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge tone="amber">{OFFER_REASONS[offer.reason]}</Badge>
          {offer.dietary.map((d) => <Badge key={d} tone="diet">{d}</Badge>)}
        </div>
        <div className="mt-auto flex items-center gap-2 border-t border-dashed border-line pt-3">
          <span className="font-heading text-2xl font-extrabold tracking-tight">{money(offer.price_cents)}</span>
          <span className="text-muted line-through">{money(offer.original_price_cents)}</span>
          <span className="flex-1" />
          <Button size="sm" disabled={expired} onClick={onOrder}>{expired ? 'Expired' : 'Order'}</Button>
        </div>
      </div>
    </article>
  );
}
