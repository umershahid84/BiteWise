'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { MonitorDown, MoreHorizontal, MoreVertical, Share, SquarePlus } from 'lucide-react';
import { cn } from '@/lib/utils';

// Puts Bite Wise on a customer's home screen as an app (a web app: /app.webmanifest and /app-sw.js), like the
// restaurant kiosk. Android and Windows browsers can install it with one button; on an iPhone it's Safari's
// "Add to Home Screen". (Windows Phone is no longer made or supported by Microsoft; the Windows option covers
// Windows computers and tablets.)
export type Device = 'android' | 'iphone' | 'windows';
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

const LABELS: Record<Device, string> = { android: '🤖 Android', iphone: '📱 iPhone', windows: '🪟 Windows' };

function detectDevice(): Device | null {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iphone';
  if (/Android/.test(ua)) return 'android';
  if (/Windows/.test(ua)) return 'windows';
  return null;
}
const standaloneQuery = '(display-mode: standalone)';
const subscribeStandalone = (cb: () => void) => {
  const mq = matchMedia(standaloneQuery);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};
const isStandalone = () => matchMedia(standaloneQuery).matches || (navigator as { standalone?: boolean }).standalone === true;

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return <li className="flex gap-3 rounded-2xl bg-surface-2 p-4"><b className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft text-primary-ink">{n}</b><span>{children}</span></li>;
}
function Pill({ children }: { children: React.ReactNode }) {
  return <span className="mx-1 inline-flex items-center gap-1.5 rounded-lg bg-bg px-2 py-0.5 align-middle font-bold">{children}</span>;
}

export function AppInstall({ initial }: { initial: Device | null }) {
  const [device, setDevice] = useState<Device | null>(initial);
  const [promptEvent, setPromptEvent] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const standalone = useSyncExternalStore(subscribeStandalone, isStandalone, () => false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!initial) setDevice(detectDevice() ?? 'android');
    navigator.serviceWorker?.register('/app-sw.js', { scope: '/' }).catch(() => {});
    const onPrompt = (e: Event) => { e.preventDefault(); setPromptEvent(e as InstallPrompt); };
    const onInstalled = () => setInstalled(true);
    addEventListener('beforeinstallprompt', onPrompt);
    addEventListener('appinstalled', onInstalled);
    return () => { removeEventListener('beforeinstallprompt', onPrompt); removeEventListener('appinstalled', onInstalled); };
  }, [initial]);

  const install = async () => {
    if (!promptEvent) return;
    await promptEvent.prompt();
    if ((await promptEvent.userChoice).outcome === 'accepted') setInstalled(true);
  };
  const done = installed || standalone;

  return (
    <main className="container-page max-w-2xl py-10">
      <div className="rounded-card border border-line bg-surface p-6 shadow-pop sm:p-8">
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/app-icon-192.png" alt="" className="size-16 rounded-2xl" />
          <div>
            <h1 className="m-0 text-2xl font-extrabold sm:text-3xl">Get Bite Wise on your phone</h1>
            <p className="m-0 text-ink-2">A <b>Bite Wise</b> icon on your home screen: the best deals near you, one tap away.</p>
          </div>
        </div>
        <div role="tablist" className="mt-6 grid grid-cols-3 gap-1 rounded-full border border-line bg-bg-2 p-1">
          {(['android', 'iphone', 'windows'] as const).map((d) => (
            <button key={d} type="button" role="tab" aria-selected={device === d} onClick={() => setDevice(d)}
              className={cn('rounded-full px-2 py-2.5 text-sm font-bold text-muted sm:text-base', device === d && 'bg-primary-soft text-primary-ink')}>
              {LABELS[d]}
            </button>
          ))}
        </div>

        {done ? (
          <p className="mt-6 rounded-2xl bg-primary-soft p-5 text-lg font-bold text-primary-ink">
            ✓ Done! Open <b>Bite Wise</b> from your {device === 'windows' ? 'Start menu or desktop' : 'home screen'} any time.
          </p>
        ) : device === 'android' ? (
          promptEvent ? (
            <div className="mt-6 text-center">
              <button type="button" onClick={install} className="rounded-full bg-grad px-8 py-4 text-lg font-extrabold text-on-primary">
                <SquarePlus className="mr-2 inline size-6" />Add Bite Wise to my home screen
              </button>
              <p className="mt-3 text-muted">Then tap <b>Install</b> in the box that appears.</p>
            </div>
          ) : (
            <ol className="mt-6 grid list-none gap-3 p-0">
              <Step n={1}>Open this page in <b>Chrome</b> on your phone. If you opened it from your email app, tap <Pill><MoreVertical className="size-4" /></Pill> and choose <b>Open in Chrome</b>.</Step>
              <Step n={2}>Tap Chrome&apos;s menu <Pill><MoreVertical className="size-4" /></Pill> at the top right.</Step>
              <Step n={3}>Tap <b>Add to Home screen</b> (or <b>Install app</b>), then <b>Install</b>.</Step>
            </ol>
          )
        ) : device === 'iphone' ? (
          <ol className="mt-6 grid list-none gap-3 p-0">
            <Step n={1}>Open this page in <b>Safari</b> on your iPhone. If you opened it from your email app, tap <Pill><Share className="size-4" /></Pill> or <b>Open in Safari</b> first.</Step>
            <Step n={2}>Tap the Share button <Pill><Share className="size-4" /></Pill> at the bottom of the screen.</Step>
            <Step n={3}>Scroll down and tap <Pill><SquarePlus className="size-4" />Add to Home Screen</Pill></Step>
            <Step n={4}>Tap <b>Add</b> at the top right. The <b>Bite Wise</b> icon appears on your home screen.</Step>
          </ol>
        ) : device === 'windows' ? (
          <>
            {promptEvent && (
              <div className="mt-6 text-center">
                <button type="button" onClick={install} className="rounded-full bg-grad px-8 py-4 text-lg font-extrabold text-on-primary">
                  <MonitorDown className="mr-2 inline size-6" />Install Bite Wise
                </button>
                <p className="mt-3 text-muted">Then click <b>Install</b> in the box that appears.</p>
              </div>
            )}
            <ol className="mt-6 grid list-none gap-3 p-0">
              <Step n={1}><b>Microsoft Edge:</b> click the menu <Pill><MoreHorizontal className="size-4" /></Pill> at the top right, then <b>Apps</b> → <b>Install this site as an app</b> → <b>Install</b>.</Step>
              <Step n={2}><b>Google Chrome:</b> click the install icon <Pill><MonitorDown className="size-4" /></Pill> at the right end of the address bar, then <b>Install</b>.</Step>
              <Step n={3}>Open <b>Bite Wise</b> from the Start menu or the desktop. Right-click its taskbar icon and choose <b>Pin to taskbar</b>.</Step>
            </ol>
            <p className="mt-3 mb-0 text-sm text-muted">Windows Phone is no longer supported by Microsoft. On a Windows computer or tablet, the steps above put Bite Wise in the Start menu.</p>
          </>
        ) : null}

        <p className="mt-6 mb-0 text-center text-sm text-muted">
          Prefer the browser? <Link href="/offers">Find deals near me →</Link>
        </p>
      </div>
    </main>
  );
}
