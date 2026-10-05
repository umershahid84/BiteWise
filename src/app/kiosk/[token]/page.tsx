import type { Metadata, Viewport } from 'next';
import { KioskApp } from '@/components/kiosk/kiosk-app';
import { kioskByToken } from '@/lib/kiosk';

// A restaurant's counter kiosk. The secret token in the link is its only credential (see src/lib/kiosk.ts).

export const viewport: Viewport = { themeColor: '#07110d', width: 'device-width', initialScale: 1, maximumScale: 1, userScalable: false };

export async function generateMetadata({ params }: PageProps<'/kiosk/[token]'>): Promise<Metadata> {
  const { token } = await params;
  const k = await kioskByToken(token);
  return {
    title: k ? `${k.name} kiosk` : 'Kiosk',
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
    ...(k && {
      manifest: `/kiosk/${token}/manifest.webmanifest`,
      appleWebApp: { capable: true, title: 'Bite Wise Kiosk', statusBarStyle: 'black-translucent' },
    }),
  };
}

export default async function KioskPage({ params, searchParams }: PageProps<'/kiosk/[token]'>) {
  const { token } = await params;
  const { install } = await searchParams;
  const k = await kioskByToken(token);
  if (!k) {
    return (
      <div className="fixed inset-0 z-[2000] grid place-items-center bg-bg p-6 text-center text-ink">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/logo-dark.svg" alt="Bite Wise" className="mx-auto mb-8 h-20" />
          <h1 className="font-heading text-3xl font-extrabold">This kiosk link isn&apos;t valid any more</h1>
          <p className="mx-auto max-w-lg text-ink-2">The restaurant may have replaced it. Open the current kiosk link from the restaurant dashboard (Kiosk tab).</p>
        </div>
      </div>
    );
  }
  return <KioskApp token={token} name={k.name} initialStatus={k.status} install={install === 'android' || install === 'apple' ? install : null} />;
}
