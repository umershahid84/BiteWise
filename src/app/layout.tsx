import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { IdleLogout } from '@/components/app/idle-logout';
import { Providers } from '@/components/app/providers';
import { SiteFooter } from '@/components/app/site-footer';
import { SiteHeader } from '@/components/app/site-header';
import { TermsGate } from '@/components/app/terms-gate';
import { getViewer } from '@/lib/auth';
import './globals.css';

const inter = localFont({
  src: [
    { path: '../fonts/inter-latin-400-normal.woff2', weight: '400' },
    { path: '../fonts/inter-latin-500-normal.woff2', weight: '500' },
    { path: '../fonts/inter-latin-600-normal.woff2', weight: '600' },
    { path: '../fonts/inter-latin-700-normal.woff2', weight: '700' },
  ],
  variable: '--font-inter',
  display: 'swap',
});
const jakarta = localFont({
  src: [
    { path: '../fonts/plus-jakarta-sans-latin-600-normal.woff2', weight: '600' },
    { path: '../fonts/plus-jakarta-sans-latin-700-normal.woff2', weight: '700' },
    { path: '../fonts/plus-jakarta-sans-latin-800-normal.woff2', weight: '800' },
  ],
  variable: '--font-jakarta',
  display: 'swap',
});
const plexMono = localFont({
  src: [
    { path: '../fonts/IBMPlexMono-Regular.woff2', weight: '400' },
    { path: '../fonts/IBMPlexMono-SemiBold.woff2', weight: '600' },
    { path: '../fonts/IBMPlexMono-Bold.woff2', weight: '700' },
  ],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'Bite Wise: Rescue good food, save money', template: '%s · Bite Wise' },
  description: 'Bite Wise: rescue good restaurant food at a discount near you, across the United States and Canada.',
  // Lets customers put Bite Wise on their phone's home screen (/app). The kiosk has its own manifest.
  manifest: '/app.webmanifest',
  appleWebApp: { capable: true, title: 'Bite Wise', statusBarStyle: 'black-translucent' },
  icons: { apple: '/assets/apple-touch-icon.png' },
};

export const viewport: Viewport = { themeColor: '#07110d' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  return (
    <html lang="en" className={`${inter.variable} ${jakarta.variable} ${plexMono.variable}`}>
      <body className="flex min-h-dvh flex-col font-sans">
        <Providers>
          <SiteHeader viewer={viewer && { username: viewer.username, role: viewer.role, restaurantName: viewer.restaurant?.name ?? null, creditCents: viewer.creditCents }} />
          <div className="flex-1">{children}</div>
          <SiteFooter />
          {viewer && <IdleLogout />}
          {viewer && (viewer.role === 'customer' || viewer.role === 'restaurant') && viewer.pendingTerms.length > 0 && <TermsGate role={viewer.role} />}
        </Providers>
      </body>
    </html>
  );
}
