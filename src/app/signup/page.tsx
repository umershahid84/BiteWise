import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth/auth-card';
import { SignupForm } from '@/components/auth/signup-form';
import { getViewer } from '@/lib/auth';
import { homeFor } from '@/lib/constants';

export const metadata: Metadata = { title: 'Create your account' };

export default async function SignupPage({ searchParams }: PageProps<'/signup'>) {
  const { role } = await searchParams;
  const viewer = await getViewer();
  if (viewer) redirect(homeFor(viewer.role));
  return (
    <AuthCard>
      <SignupForm initialRole={role === 'restaurant' ? 'restaurant' : 'customer'} />
    </AuthCard>
  );
}
