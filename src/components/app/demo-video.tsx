'use client';

import { useEffect, useRef, useState } from 'react';
import { PlayCircle, Store, UtensilsCrossed } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

// Short narrated screen recordings of the app (public/videos, made with scripts/demo-video; see its README).
export const TOURS = {
  customer: {
    title: 'How Rescue Bites works for customers',
    length: '1:02',
    src: '/videos/customer-tour',
    steps: ['Browse live deals near you', 'See the full total before you order', 'Your card is held, not charged', 'Show your 4-digit PIN at pickup'],
  },
  restaurant: {
    title: 'How Rescue Bites works for restaurants',
    length: '1:02',
    src: '/videos/restaurant-tour',
    steps: ['Post surplus food in under a minute', 'A bell rings when someone orders', 'Type the PIN and hand over the food', 'Get paid through Stripe, with reports'],
  },
} as const;

export type TourName = keyof typeof TOURS;

export function DemoVideo({ tour, autoPlay, className }: { tour: TourName; autoPlay?: boolean; className?: string }) {
  const t = TOURS[tour];
  const ref = useRef<HTMLVideoElement>(null);
  // Opened from a button click, so browsers allow playing with sound. If one still refuses, the controls stay.
  useEffect(() => {
    if (autoPlay) ref.current?.play().catch(() => {});
  }, [autoPlay, tour]);
  return (
    <video
      ref={ref}
      key={tour}
      className={cn('aspect-video w-full rounded-card border border-line bg-black shadow-pop', className)}
      poster={`${t.src}.jpg`}
      controls
      playsInline
      preload={autoPlay ? 'auto' : 'none'}
      aria-label={`${t.title} (${t.length}, with voice-over): ${t.steps.join(', ')}.`}
    >
      <source src={`${t.src}.webm`} type="video/webm" />
      <source src={`${t.src}.mp4`} type="video/mp4" />
      <track kind="subtitles" src={`${t.src}.vtt`} srcLang="en" label="English" />
    </video>
  );
}

// A button that opens the tour in a pop-up, for use inside the app.
export function DemoVideoButton({ tour, label = 'Watch how it works', ...props }: { tour: TourName; label?: string } & ButtonProps) {
  const t = TOURS[tour];
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" {...props}><PlayCircle /> {label}</Button>
      </DialogTrigger>
      <DialogContent title={t.title} description={`A ${t.length} narrated walkthrough of the app. Turn your sound on, or turn on subtitles in the player.`} className="w-[min(960px,calc(100%-24px))]">
        <DemoVideo tour={tour} autoPlay />
        <Steps tour={tour} className="mt-4" />
      </DialogContent>
    </Dialog>
  );
}

function Steps({ tour, className }: { tour: TourName; className?: string }) {
  return (
    <ol className={cn('grid gap-2 p-0 text-sm sm:grid-cols-2 lg:grid-cols-4', className)}>
      {TOURS[tour].steps.map((s, i) => (
        <li key={s} className="flex list-none items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-2.5 font-semibold text-ink-2">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-extrabold text-primary-ink">{i + 1}</span>
          {s}
        </li>
      ))}
    </ol>
  );
}

// Landing-page section with a customer / restaurant switch.
export function DemoVideoShowcase() {
  const [tour, setTour] = useState<TourName>('customer');
  return (
    <div className="mx-auto max-w-[960px]">
      <div className="mb-5 flex justify-center">
        <div role="group" aria-label="Choose a video" className="inline-flex rounded-full border border-line bg-surface p-1">
          {([['customer', 'For customers', UtensilsCrossed], ['restaurant', 'For restaurants', Store]] as const).map(([name, label, Icon]) => (
            <button
              key={name}
              aria-pressed={tour === name}
              onClick={() => setTour(name)}
              className={cn('inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold text-muted transition-colors hover:text-ink', tour === name && 'bg-primary-soft text-primary-ink')}
            >
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>
      </div>
      <DemoVideo tour={tour} />
      <Steps tour={tour} className="mt-4" />
    </div>
  );
}
