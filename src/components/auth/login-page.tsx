import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth';
import { homeFor, portalFor, SIGNUP_PATH, type Portal } from '@/lib/constants';
import { AuthCard } from './auth-card';
import { LoginForm, type LoginNotice } from './login-form';

// Only same-site relative redirects.
const safeNext = (next: unknown) => (typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : null);

const PAGES: Record<Portal, { tag?: string; title: string; footer: React.ReactNode }> = {
  main: {
    title: 'Welcome back',
    footer: (
      <div className="mt-5 grid gap-1 text-center text-sm text-muted">
        <p className="m-0">New to Bite Wise? <Link href={SIGNUP_PATH.customer}>Create a free account</Link></p>
      </div>
    ),
  },
  admin: { tag: 'Owner console', title: 'Admin log-in', footer: null },
};

// The log-in page of one kind of account (src/lib/constants.ts LOGIN_PATH).
export async function LoginPage({ portal, searchParams }: { portal: Portal; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { next, confirmed, error, idle, as } = await searchParams;
  const viewer = await getViewer();
  if (viewer) redirect(portalFor(viewer.role) === portal ? (safeNext(next) ?? homeFor(viewer.role)) : homeFor(viewer.role));
  const notice: LoginNotice = confirmed ? 'confirmed' : error === 'confirmation' ? 'confirmation-failed' : idle ? 'idle' : null;
  const page = PAGES[portal];
  return (
    <AuthCard tag={page.tag}>
      <LoginForm portal={portal} title={page.title} next={safeNext(next)} notice={notice} footer={page.footer}
        initialAudience={as === 'restaurant' || safeNext(next)?.startsWith('/restaurant') ? 'restaurant' : 'customer'} />
    </AuthCard>
  );
}
