'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Check, Delete, MonitorDown, MoreHorizontal, MoreVertical, Share, SquarePlus, Store, Wifi, WifiOff, X } from 'lucide-react';
import { kioskConfirm, kioskLookup, kioskOrders, type KioskOrder } from '@/app/actions/kiosk';
import type { PickupOrder } from '@/app/actions/restaurant';
import { ringBell, unlockOnInteraction } from '@/components/restaurant/bell';
import { money } from '@/lib/format';
import { cn } from '@/lib/utils';

// The restaurant's counter kiosk: orders awaiting pickup (with the bell for new ones) and a PIN pad to hand them
// over. Installed to the tablet's home screen, it opens full-screen like an app (see the manifest route).

type Status = 'pending' | 'approved' | 'suspended';
export type InstallTarget = 'android' | 'apple' | 'windows';
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
type Done = { quantity: number; itemTitle: string; customerUsername: string; totalCents: number; creditAppliedCents: number };

const POLL_MS = 5000;
const NEW_FOR_MS = 120_000;
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const ago = (iso: string, now: number) => {
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`;
};

// Opened from the home-screen icon (installed), rather than in a browser tab.
const standaloneQuery = '(display-mode: standalone)';
const subscribeStandalone = (cb: () => void) => {
  const mq = matchMedia(standaloneQuery);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};
const isStandalone = () => matchMedia(standaloneQuery).matches || (navigator as { standalone?: boolean }).standalone === true;

function detectDevice(): InstallTarget | null {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'apple';
  if (/Android/.test(ua)) return 'android';
  if (/Windows/.test(ua)) return 'windows';
  return null;
}

export function KioskApp({ token, name, initialStatus, install }: { token: string; name: string; initialStatus: Status; install: InstallTarget | null }) {
  const [started, setStarted] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [toast, setToast] = useState<string | null>(null);
  const [firstSeen, setFirstSeen] = useState<Map<number, number> | null>(null); // order id → when this kiosk first saw it
  const seen = useRef<Map<number, number> | null>(null);

  const standalone = useSyncExternalStore(subscribeStandalone, isStandalone, () => false);
  const [installChoice, setInstallChoice] = useState<InstallTarget | 'choose' | null | undefined>(undefined);
  const installOpen = installChoice === undefined ? (install && !standalone ? install : null) : installChoice;
  const [promptEvent, setPromptEvent] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);

  // ---- install to the home screen
  useEffect(() => {
    navigator.serviceWorker?.register('/kiosk-sw.js', { scope: '/kiosk/' }).catch(() => {});
    const onPrompt = (e: Event) => { e.preventDefault(); setPromptEvent(e as InstallPrompt); };
    const onInstalled = () => setInstalled(true);
    addEventListener('beforeinstallprompt', onPrompt);
    addEventListener('appinstalled', onInstalled);
    return () => { removeEventListener('beforeinstallprompt', onPrompt); removeEventListener('appinstalled', onInstalled); };
  }, []);

  // ---- sound, clock, screen kept awake
  useEffect(() => unlockOnInteraction(), []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!started) return;
    let lock: { release: () => Promise<void> } | null = null;
    const request = async () => {
      try { lock = await (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen') ?? null; } catch { /* not supported */ }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') request(); };
    request();
    document.addEventListener('visibilitychange', onVisible);
    return () => { document.removeEventListener('visibilitychange', onVisible); lock?.release().catch(() => {}); };
  }, [started]);

  // ---- orders, every few seconds, with the bell for new ones
  const { data, isError } = useQuery({
    queryKey: ['kiosk', token],
    queryFn: async () => {
      const res = await kioskOrders(token);
      if (!res.ok) throw new Error(res.error);
      const prev = seen.current;
      const fresh = res.data.orders.filter((o) => !prev?.has(o.id));
      if (fresh.length || !prev) {
        const next = new Map(prev ?? []);
        for (const o of fresh) next.set(o.id, prev ? Date.now() : 0);
        seen.current = next;
        setFirstSeen(next);
      }
      if (prev && fresh.length) {
        ringBell();
        const o = fresh[0];
        setToast(`New order: ${o.quantity} × ${o.itemTitle} for ${o.customerUsername}${fresh.length > 1 ? ` (+${fresh.length - 1} more)` : ''}`);
        setTimeout(() => setToast(null), 7000);
      }
      return res.data;
    },
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: true,
  });
  const orders: KioskOrder[] = data?.orders ?? [];
  const status: Status = data?.status ?? initialStatus;
  const pickedUpToday = data?.pickedUpToday ?? 0;
  const online = !isError;
  const queryClient = useQueryClient();
  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: ['kiosk', token] }), [queryClient, token]);

  return (
    <div className="fixed inset-0 z-[2000] flex flex-col bg-bg text-ink select-none">
      <header className="flex items-center gap-4 border-b border-line bg-bg-2 px-5 py-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/logo-dark-compact.svg" alt="Bite Wise" className="h-9" />
        <div className="min-w-0 flex-1 border-l border-line pl-4">
          <div className="truncate font-heading text-xl font-extrabold">{name}</div>
          <div className="text-xs text-muted">Pickup kiosk · {pickedUpToday} picked up in the last 24 h</div>
        </div>
        {!standalone && (
          <button type="button" onClick={() => setInstallChoice(detectDevice() ?? 'choose')} className="hidden rounded-full border border-line px-4 py-2 text-sm font-bold text-primary-ink sm:block">
            <SquarePlus className="mr-1.5 inline size-4" />Install kiosk
          </button>
        )}
        <span className={cn('flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold', online ? 'bg-primary-soft text-primary-ink' : 'bg-danger-soft text-danger')}>
          {online ? <Wifi className="size-4" /> : <WifiOff className="size-4" />}{online ? 'Live' : 'Offline'}
        </span>
        <span className="font-heading text-2xl font-extrabold tabular-nums" suppressHydrationWarning>{new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
      </header>

      {toast && (
        <div className="absolute top-20 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full bg-accent px-6 py-3 text-lg font-extrabold text-on-accent shadow-pop">
          <BellRing className="size-6" /> {toast}
        </div>
      )}

      <main className="grid min-h-0 flex-1 gap-4 p-4 md:grid-cols-[1fr_minmax(380px,0.9fr)]">
        <section className="flex min-h-0 flex-col rounded-card border border-line bg-surface">
          <h2 className="m-0 flex items-center justify-between border-b border-line px-5 py-4 text-lg font-extrabold">
            Waiting for pickup <span className="rounded-full bg-primary-soft px-3 py-0.5 text-primary-ink">{orders.length}</span>
          </h2>
          <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3">
            {orders.length === 0 && <p className="py-16 text-center text-muted">No orders waiting right now. New orders appear here with a bell.</p>}
            {orders.map((o) => {
              const isNew = (firstSeen?.get(o.id) ?? 0) > now - NEW_FOR_MS;
              return (
                <div key={o.id} className={cn('flex items-center gap-4 rounded-2xl border px-4 py-3', isNew ? 'border-accent bg-accent-soft' : 'border-line bg-surface-2')}>
                  <div className="grid size-14 shrink-0 place-items-center rounded-xl bg-bg font-heading text-2xl font-extrabold">{o.quantity}×</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-lg font-bold">{o.itemTitle}{isNew && <span className="ml-2 rounded-full bg-accent px-2 py-0.5 align-middle text-xs font-extrabold text-on-accent">NEW</span>}</div>
                    <div className="text-sm text-ink-2">for <b>{o.customerUsername}</b> · ordered {ago(o.createdAt, now)}</div>
                  </div>
                  <div className="text-right text-sm text-muted">pick up by<br /><b className="text-base text-ink">{time(o.pickupEnd)}</b></div>
                </div>
              );
            })}
          </div>
        </section>
        <PinPad token={token} onDone={refresh} />
      </main>

      {status !== 'approved' && (
        <div className="absolute inset-x-0 bottom-0 z-10 bg-accent-soft px-6 py-4 text-center font-bold text-accent-ink">
          {status === 'pending'
            ? 'Your restaurant is waiting for approval. Orders will appear here once Bite Wise approves you.'
            : 'This restaurant is suspended, so it gets no new orders. Contact Bite Wise support.'}
        </div>
      )}

      {!started && !installOpen && (
        <button type="button" onClick={() => setStarted(true)} className="absolute inset-0 z-30 grid place-items-center bg-bg/95 text-center">
          <span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/logo-dark.svg" alt="Bite Wise" className="mx-auto mb-8 h-24" />
            <span className="block font-heading text-4xl font-extrabold">{name}</span>
            <span className="mt-6 inline-flex items-center gap-3 rounded-full bg-grad px-10 py-5 text-2xl font-extrabold text-on-primary shadow-pop">
              <Store className="size-7" /> Tap to start the kiosk
            </span>
            <span className="mt-5 block text-muted">This turns on the order bell and keeps the screen awake.</span>
          </span>
        </button>
      )}

      {installOpen && (
        <InstallGuide
          target={installOpen}
          name={name}
          promptEvent={promptEvent}
          installed={installed}
          onChoose={setInstallChoice}
          onClose={() => setInstallChoice(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- PIN pad

function PinPad({ token, onDone }: { token: string; onDone: () => void }) {
  const [pin, setPin] = useState('');
  const [order, setOrder] = useState<PickupOrder | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = useCallback(() => { setPin(''); setOrder(null); setDone(null); setError(null); }, []);

  const lookup = useCallback(async (value: string) => {
    setBusy(true);
    const res = await kioskLookup(token, value);
    setBusy(false);
    if (!res.ok) { setError(res.error); setPin(''); return; }
    setError(null);
    setOrder(res.data);
  }, [token]);

  const press = useCallback((key: string) => {
    if (busy || order || done) return;
    setError(null);
    const next = key === 'back' ? pin.slice(0, -1) : key === 'clear' ? '' : (pin + key).slice(0, 4);
    setPin(next);
    if (next.length === 4 && pin.length === 3) lookup(next);
  }, [busy, order, done, lookup, pin]);

  // A keyboard or barcode scanner works too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('back');
      else if (e.key === 'Escape') reset();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [press, reset]);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(reset, 8000);
    return () => clearTimeout(t);
  }, [done, reset]);

  const handOver = async () => {
    if (!order) return;
    setBusy(true);
    const res = await kioskConfirm(token, pin, order.id);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setDone(res.data);
    setOrder(null);
    onDone();
  };

  return (
    <section className="flex min-h-0 flex-col rounded-card border border-line bg-surface p-5">
      {done ? (
        <div className="m-auto text-center">
          <div className="mx-auto grid size-28 place-items-center rounded-full bg-primary text-on-primary"><Check className="size-16" strokeWidth={3} /></div>
          <h2 className="mt-6 mb-2 font-heading text-4xl font-extrabold">Picked up!</h2>
          <p className="m-0 text-xl text-ink-2">{done.quantity} × {done.itemTitle} for <b>{done.customerUsername}</b></p>
          <p className="mt-2 text-lg text-primary-ink">
            {done.totalCents - done.creditAppliedCents > 0 ? `Card charged ${money(done.totalCents - done.creditAppliedCents)}` : 'Paid with Bite Wise credit'}
          </p>
          <button type="button" onClick={reset} className="mt-8 rounded-full bg-grad px-10 py-4 text-xl font-extrabold text-on-primary">Next pickup</button>
        </div>
      ) : order ? (
        <div className="flex flex-1 flex-col">
          <p className="m-0 text-sm font-bold tracking-wide text-muted uppercase">PIN {pin} matches</p>
          <div className="mt-3 flex items-center gap-4 rounded-2xl border border-line bg-surface-2 p-4">
            {order.imageUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={order.imageUrl} alt="" className="size-24 shrink-0 rounded-xl object-cover" />
              : <div className="grid size-24 shrink-0 place-items-center rounded-xl bg-bg text-5xl">🍽️</div>}
            <div className="min-w-0">
              <div className="font-heading text-3xl font-extrabold">{order.quantity} × {order.itemTitle}</div>
              <div className="mt-1 text-lg text-ink-2">for <b>{order.customerUsername}</b></div>
              <div className="mt-1 text-ink-2">Total {money(order.totalCents)}{order.creditAppliedCents > 0 && ` (${money(order.creditAppliedCents)} paid with credit)`}</div>
            </div>
          </div>
          <p className="text-ink-2">Check the order, then hand over the food. The customer&apos;s card is charged when you tap the button.</p>
          {error && <p className="rounded-xl bg-danger-soft px-4 py-3 font-bold text-danger">{error}</p>}
          <div className="mt-auto grid gap-3">
            <button type="button" disabled={busy} onClick={handOver} className="rounded-2xl bg-grad py-6 font-heading text-2xl font-extrabold text-on-primary disabled:opacity-60">
              {busy ? 'Charging…' : 'Hand over food & charge card'}
            </button>
            <button type="button" disabled={busy} onClick={reset} className="rounded-2xl border border-line py-4 text-lg font-bold text-ink-2">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col">
          <h2 className="m-0 text-center text-lg font-extrabold">Enter the customer&apos;s pickup PIN</h2>
          <div className="my-4 flex justify-center gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={cn('grid size-16 place-items-center rounded-2xl border-2 font-heading text-4xl font-extrabold', pin[i] ? 'border-primary bg-primary-soft' : 'border-line bg-bg')}>{pin[i] ?? ''}</div>
            ))}
          </div>
          <div className="min-h-12 text-center">
            {busy && <span className="text-muted">Checking…</span>}
            {error && <span className="inline-block rounded-xl bg-danger-soft px-4 py-2 font-bold text-danger">{error}</span>}
          </div>
          <div className="mt-auto grid grid-cols-3 gap-3">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'].map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => press(k)}
                aria-label={k === 'back' ? 'Delete' : k === 'clear' ? 'Clear' : k}
                className={cn('h-[clamp(56px,9vh,84px)] rounded-2xl border border-line font-heading text-3xl font-extrabold active:scale-95 active:bg-primary-soft', k.length > 1 ? 'bg-bg text-lg text-ink-2' : 'bg-surface-2')}
              >
                {k === 'back' ? <Delete className="mx-auto size-8" /> : k === 'clear' ? 'Clear' : k}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- "Add to home screen" guide

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return <li className="flex gap-4 rounded-2xl bg-surface-2 p-4 text-lg"><b className="grid size-9 shrink-0 place-items-center rounded-full bg-primary-soft text-primary-ink">{n}</b><span>{children}</span></li>;
}

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="mx-1 inline-flex items-center gap-1.5 rounded-lg bg-bg px-2 py-0.5 align-middle font-bold">{children}</span>;
}

function InstallGuide({ target, name, promptEvent, installed, onChoose, onClose }: {
  target: InstallTarget | 'choose'; name: string; promptEvent: InstallPrompt | null; installed: boolean;
  onChoose: (t: InstallTarget) => void; onClose: () => void;
}) {
  const [accepted, setAccepted] = useState(false);
  return (
    <div className="absolute inset-0 z-40 overflow-y-auto bg-bg/95 p-4">
      <div className="relative mx-auto mt-6 max-w-2xl rounded-card border border-line bg-surface p-7 shadow-pop">
        <button type="button" onClick={onClose} aria-label="Close" className="absolute top-4 right-4 rounded-full p-2 text-muted"><X className="size-6" /></button>
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/kiosk-icon-192.png" alt="" className="size-16 rounded-2xl" />
          <div>
            <h2 className="m-0 font-heading text-2xl font-extrabold">{target === 'windows' ? 'Install the kiosk on this computer' : 'Add the kiosk to this tablet\u2019s home screen'}</h2>
            <p className="m-0 text-ink-2">
              {target === 'windows'
                ? <>A <b>Bite Wise Kiosk</b> app for <b>{name}</b> appears in the Start menu and on the desktop. It opens in its own window.</>
                : <>An icon for <b>{name}</b> appears on the home screen. Tap it to open your kiosk full-screen.</>}
            </p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-1 rounded-full border border-line bg-bg-2 p-1">
          {(['android', 'apple', 'windows'] as const).map((t) => (
            <button key={t} type="button" onClick={() => onChoose(t)} className={cn('rounded-full px-2 py-2.5 text-sm font-bold text-muted sm:text-base', target === t && 'bg-primary-soft text-primary-ink')}>
              {t === 'android' ? 'Android tablet' : t === 'apple' ? 'iPad / iPhone' : 'Windows PC'}
            </button>
          ))}
        </div>

        {target === 'android' && (installed || accepted ? (
          <p className="mt-6 rounded-2xl bg-primary-soft p-5 text-lg font-bold text-primary-ink">✓ Done! The Bite Wise Kiosk icon is on your home screen. Tap it to open the kiosk.</p>
        ) : promptEvent ? (
          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={async () => { await promptEvent.prompt(); if ((await promptEvent.userChoice).outcome === 'accepted') setAccepted(true); }}
              className="rounded-full bg-grad px-10 py-5 text-xl font-extrabold text-on-primary"
            >
              <SquarePlus className="mr-2 inline size-6" />Add to home screen
            </button>
            <p className="mt-3 text-muted">Then tap <b>Install</b> in the box that appears.</p>
          </div>
        ) : (
          <ol className="mt-6 grid list-none gap-3 p-0">
            <Step n={1}>Open this page in <b>Chrome</b>. If you opened it from your email app, tap <Pill><MoreVertical className="size-4" /></Pill> and choose <b>Open in Chrome</b>.</Step>
            <Step n={2}>Tap Chrome&apos;s menu <Pill><MoreVertical className="size-4" /></Pill> at the top right.</Step>
            <Step n={3}>Tap <b>Add to Home screen</b> (or <b>Install app</b>), then <b>Install</b> / <b>Add</b>.</Step>
          </ol>
        ))}

        {target === 'apple' && (
          <ol className="mt-6 grid list-none gap-3 p-0">
            <Step n={1}>Open this page in <b>Safari</b>. If you opened it from your email app, tap <Pill><Share className="size-4" /></Pill> or <b>Open in Safari</b> first.</Step>
            <Step n={2}>Tap the Share button <Pill><Share className="size-4" /></Pill> at the top of the screen on an iPad (at the bottom on an iPhone).</Step>
            <Step n={3}>Scroll down and tap <Pill><SquarePlus className="size-4" />Add to Home Screen</Pill></Step>
            <Step n={4}>Tap <b>Add</b> at the top right. The <b>Bite Wise Kiosk</b> icon appears on your home screen.</Step>
          </ol>
        )}

        {target === 'windows' && (installed || accepted ? (
          <p className="mt-6 rounded-2xl bg-primary-soft p-5 text-lg font-bold text-primary-ink">✓ Done! Open <b>Bite Wise Kiosk</b> from the Start menu or the desktop. Right-click its taskbar icon and choose <b>Pin to taskbar</b> to keep it one click away.</p>
        ) : (
          <>
            {promptEvent && (
              <div className="mt-6 text-center">
                <button
                  type="button"
                  onClick={async () => { await promptEvent.prompt(); if ((await promptEvent.userChoice).outcome === 'accepted') setAccepted(true); }}
                  className="rounded-full bg-grad px-10 py-5 text-xl font-extrabold text-on-primary"
                >
                  <MonitorDown className="mr-2 inline size-6" />Install on this computer
                </button>
                <p className="mt-3 text-muted">Then click <b>Install</b> in the box that appears.</p>
              </div>
            )}
            <p className={cn('mb-0 font-bold text-ink-2', promptEvent ? 'mt-6' : 'mt-6')}>{promptEvent ? 'Or do it from the browser menu:' : 'Use Microsoft Edge or Google Chrome:'}</p>
            <ol className="mt-3 grid list-none gap-3 p-0">
              <Step n={1}><b>Microsoft Edge:</b> click the menu <Pill><MoreHorizontal className="size-4" /></Pill> at the top right, then <b>Apps</b> → <b>Install this site as an app</b> → <b>Install</b>.</Step>
              <Step n={2}><b>Google Chrome:</b> click the install icon <Pill><MonitorDown className="size-4" /></Pill> at the right end of the address bar (or the menu <Pill><MoreVertical className="size-4" /></Pill> → <b>Cast, save and share</b> → <b>Install page as app</b>), then <b>Install</b>.</Step>
              <Step n={3}>Tick <b>Pin to taskbar</b>, <b>Create desktop shortcut</b> and, for a counter computer, <b>Auto-start on device login</b> if your browser offers them. Then open <b>Bite Wise Kiosk</b> from the Start menu or the desktop.</Step>
            </ol>
            <p className="mt-3 mb-0 text-sm text-muted">Tip: press <b>F11</b> in the kiosk window for full screen; press it again to leave.</p>
          </>
        ))}

        {target === 'choose' && <p className="mt-6 text-center text-lg text-ink-2">Which device is this?</p>}
        <p className="mt-6 mb-0 text-sm text-muted">Keep this link private: anyone who has it can see your pickup orders. You can get a new link any time in your dashboard (Kiosk tab).</p>
      </div>
    </div>
  );
}
