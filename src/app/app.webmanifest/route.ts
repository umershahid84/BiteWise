import { NextResponse } from 'next/server';

// The web app manifest for Bite Wise on a customer's phone (or computer): "Add to Home screen" / "Install app" puts a
// Bite Wise icon on the home screen that opens the deals near them, full-screen. Linked from every page except the
// restaurant kiosk, which has its own (src/app/kiosk/[token]/manifest.webmanifest).
export function GET() {
  return NextResponse.json({
    id: '/offers',
    name: 'Bite Wise: rescued food near you',
    short_name: 'Bite Wise',
    description: 'Discounted surplus food from restaurants near you. Eat well, waste less.',
    start_url: '/offers?source=app',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#07110d',
    theme_color: '#07110d',
    categories: ['food', 'shopping'],
    icons: [
      { src: '/assets/app-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/assets/app-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/assets/app-icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }, { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=3600' } });
}
