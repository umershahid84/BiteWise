import { NextResponse } from 'next/server';
import { kioskByToken } from '@/lib/kiosk';

// The web app manifest for one restaurant's kiosk, so "Add to Home screen" installs an icon that opens straight
// into that restaurant's kiosk, full-screen.
export async function GET(_req: Request, { params }: RouteContext<'/kiosk/[token]/manifest.webmanifest'>) {
  const { token } = await params;
  const k = await kioskByToken(token);
  if (!k) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const start = `/kiosk/${token}`;
  return NextResponse.json({
    id: start,
    name: `${k.name} · Bite Wise Kiosk`,
    short_name: 'Bite Wise Kiosk',
    description: `Pickup kiosk for ${k.name}`,
    start_url: start,
    scope: start,
    display: 'standalone',
    orientation: 'any',
    background_color: '#07110d',
    theme_color: '#07110d',
    icons: [
      { src: '/assets/kiosk-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/assets/kiosk-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/assets/kiosk-icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }, { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'private, no-store' } });
}
