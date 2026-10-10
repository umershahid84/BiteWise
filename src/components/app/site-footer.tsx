import Link from 'next/link';
import { Logo } from './logo';

export function SiteFooter() {
  return (
    <footer className="no-print mt-16 border-t border-line py-8 text-sm text-muted">
      <div className="container-page flex flex-wrap items-center gap-4">
        <Logo className="h-11" />
        <span className="flex-1" />
        <nav className="flex flex-wrap gap-4">
          <Link href="/about" className="text-muted hover:text-ink">About us</Link>
          <Link href="/legal/customer-terms" className="text-muted hover:text-ink">Customer Terms</Link>
          <Link href="/legal/restaurant-agreement" className="text-muted hover:text-ink">Restaurant Partner Agreement</Link>
          <Link href="/legal/privacy" className="text-muted hover:text-ink">Privacy Policy</Link>
        </nav>
        <span>© Bite Wise · United States &amp; Canada</span>
      </div>
    </footer>
  );
}
