import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth/auth-card';
import { LoginForm } from '@/components/auth/login-form';
import { getViewer } from '@/lib/auth';
import { homeFor } from '@/lib/constants';

export const metadata: Metadata = { title: 'Log in' };

// Only same-site relative redirects.
const safeNext = (next: unknown) => (typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : null);

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const { next, confirmed, error } = await searchParams;
  const viewer = await getViewer();
  if (viewer) redirect(safeNext(next) ?? homeFor(viewer.role));
  return (
    <AuthCard title="Welcome back">
      <LoginForm next={safeNext(next)} notice={confirmed ? 'confirmed' : error === 'confirmation' ? 'confirmation-failed' : null} />
    </AuthCard>
  );
}
