import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth';
import { homeFor, LOGIN_PATH, portalFor, SIGNUP_PATH, type Portal } from '@/lib/constants';
import { AuthCard } from './auth-card';
import { LoginForm, type LoginNotice } from './login-form';

// Only same-site relative redirects.
const safeNext = (next: unknown) => (typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : null);

const PAGES: Record<Portal, { tag?: string; title: string; footer: React.ReactNode }> = {
  customer: {
    title: 'Welcome back',
    footer: (
      <div className="mt-5 grid gap-1 text-center text-sm text-muted">
        <p className="m-0">New to Bite Wise? <Link href={SIGNUP_PATH.customer}>Create a free account</Link></p>
        <p className="m-0">Restaurant owner or staff? <Link href={LOGIN_PATH.restaurant}>Partner log-in</Link></p>
      </div>
    ),
  },
  restaurant: {
    tag: 'Restaurant partners',
    title: 'Partner log-in',
    footer: (
      <div className="mt-5 grid gap-1 text-center text-sm text-muted">
        <p className="m-0">Owners and staff log in here. Staff: your user name and password come from your restaurant&apos;s owner.</p>
        <p className="m-0">New restaurant? <Link href={SIGNUP_PATH.restaurant}>Join Bite Wise</Link> · Looking for food? <Link href={LOGIN_PATH.customer}>Customer log-in</Link></p>
      </div>
    ),
  },
  admin: { tag: 'Owner console', title: 'Admin log-in', footer: null },
};

// The log-in page of one kind of account (src/lib/constants.ts LOGIN_PATH).
export async function LoginPage({ portal, searchParams }: { portal: Portal; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { next, confirmed, error, idle } = await searchParams;
  const viewer = await getViewer();
  if (viewer) redirect(portalFor(viewer.role) === portal ? (safeNext(next) ?? homeFor(viewer.role)) : homeFor(viewer.role));
  const notice: LoginNotice = confirmed ? 'confirmed' : error === 'confirmation' ? 'confirmation-failed' : idle ? 'idle' : null;
  const page = PAGES[portal];
  return (
    <AuthCard tag={page.tag}>
      <LoginForm portal={portal} title={page.title} next={safeNext(next)} notice={notice} footer={page.footer} />
    </AuthCard>
  );
}
