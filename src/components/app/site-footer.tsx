import Link from 'next/link';

export function SiteFooter() {
  return (
    <footer className="no-print mt-16 border-t border-line py-8 text-sm text-muted">
      <div className="container-page flex flex-wrap items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/logo-dark.svg" alt="Rescue Bites" className="h-8" />
        <span className="flex-1" />
        <nav className="flex flex-wrap gap-4">
          <Link href="/legal/customer-terms" className="text-muted hover:text-ink">Customer Terms</Link>
          <Link href="/legal/restaurant-agreement" className="text-muted hover:text-ink">Restaurant Partner Agreement</Link>
          <Link href="/legal/privacy" className="text-muted hover:text-ink">Privacy Policy</Link>
        </nav>
        <span>© Rescue Bites · Greater Seattle, WA</span>
      </div>
    </footer>
  );
}
