'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Gift, LogOut, Menu } from 'lucide-react';
import { signOut } from '@/app/actions/auth';
import { buttonVariants } from '@/components/ui/button';
import { homeFor, type Role } from '@/lib/constants';
import { money } from '@/lib/format';
import { cn } from '@/lib/utils';

type HeaderViewer = { username: string; role: Role; restaurantName: string | null; creditCents: number } | null;

function NavLink({ href, children, onClick, exact }: { href: string; children: React.ReactNode; onClick?: () => void; exact?: boolean }) {
  const path = usePathname();
  const active = href !== '/' && !href.includes('#') && (path === href || (!exact && path.startsWith(`${href}/`)));
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        'rounded-full px-3.5 py-2 text-[0.94rem] font-semibold text-ink-2 no-underline transition-colors hover:bg-surface-2 hover:text-ink',
        active && 'bg-primary-soft text-primary-ink',
      )}
    >
      {children}
    </Link>
  );
}

export function SiteHeader({ viewer }: { viewer: HeaderViewer }) {
  const [open, setOpen] = useState(false);
  const wide = usePathname().startsWith('/admin'); // the owner console uses a wider page
  const close = () => setOpen(false);
  let links: React.ReactNode;
  if (!viewer) {
    links = (
      <>
        <NavLink href="/#how" onClick={close}>How it works</NavLink>
        <NavLink href="/#restaurants" onClick={close}>For restaurants</NavLink>
        <NavLink href="/about" onClick={close}>About us</NavLink>
        <NavLink href="/login" onClick={close}>Log in</NavLink>
        <Link href="/signup" onClick={close} className={cn(buttonVariants({ size: 'sm' }), 'ml-1')}>Sign up free</Link>
      </>
    );
  } else if (viewer.role === 'admin' || viewer.role === 'support') {
    links = (
      <>
        <NavLink href="/admin" onClick={close}>Admin console</NavLink>
        <NavLink href="/" onClick={close}>Public site</NavLink>
        <span className="px-2 text-sm text-muted">{viewer.role === 'admin' ? 'Owner' : 'Support'} · {viewer.username}</span>
      </>
    );
  } else if (viewer.role === 'restaurant' || viewer.role === 'staff') {
    // Staff (managers, supervisors) don't see sales reports.
    links = (
      <>
        <NavLink href="/restaurant" onClick={close} exact>Dashboard</NavLink>
        {viewer.role === 'restaurant' && <NavLink href="/restaurant/report" onClick={close}>Daily report</NavLink>}
        <span className="px-2 text-sm text-muted">{viewer.restaurantName ?? viewer.username}{viewer.role === 'staff' && ` · ${viewer.username}`}</span>
      </>
    );
  } else {
    links = (
      <>
        <NavLink href="/offers" onClick={close}>Browse deals</NavLink>
        <NavLink href="/orders" onClick={close}>My orders</NavLink>
        <NavLink href="/account" onClick={close}>Account</NavLink>
        <NavLink href="/app" onClick={close}>Get the app</NavLink>
        {viewer.creditCents > 0 && (
          <Link
            href="/account#credit"
            onClick={close}
            title="Your Bite Wise platform credit"
            className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3.5 py-2 text-sm font-bold text-accent-ink no-underline"
          >
            <Gift className="size-4" /> {money(viewer.creditCents)} credit
          </Link>
        )}
      </>
    );
  }
  return (
    <header className="no-print sticky top-0 z-[500] border-b border-line/70 bg-bg/75 backdrop-blur-md backdrop-saturate-150">
      <div className={cn(wide ? 'container-wide' : 'container-page', 'flex h-[72px] items-center gap-4')}>
        <Link href={viewer ? homeFor(viewer.role) : '/'} aria-label="Bite Wise home" className="shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/logo-dark-compact.svg" alt="Bite Wise" className="block h-[46px] md:h-[54px]" />
        </Link>
        <button
          className="ml-auto rounded-xl border border-line bg-surface p-2 md:hidden"
          aria-label="Menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <Menu className="size-5" />
        </button>
        <nav
          className={cn(
            'ml-auto hidden items-center gap-0.5 md:flex',
            open && 'absolute top-[72px] right-0 left-0 flex flex-col items-stretch border-b border-line bg-surface px-4 pt-2 pb-4 shadow-card md:static md:flex-row md:items-center md:border-0 md:bg-transparent md:p-0 md:shadow-none',
          )}
        >
          {links}
          {viewer && (
            <form action={signOut}>
              <button className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[0.94rem] font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink">
                <LogOut className="size-4" /> Log out
              </button>
            </form>
          )}
        </nav>
      </div>
    </header>
  );
}
