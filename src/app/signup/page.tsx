import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth/auth-card';
import { SignupForm } from '@/components/auth/signup-form';
import { getViewer } from '@/lib/auth';
import { homeFor, SIGNUP_PATH } from '@/lib/constants';

export const metadata: Metadata = { title: 'Create your account' };

// Customers. Restaurants sign up at /restaurant/signup (old links with ?role=restaurant are sent there).
export default async function SignupPage({ searchParams }: PageProps<'/signup'>) {
  const { role } = await searchParams;
  if (role === 'restaurant') redirect(SIGNUP_PATH.restaurant);
  const viewer = await getViewer();
  if (viewer) redirect(homeFor(viewer.role));
  return (
    <AuthCard>
      <SignupForm role="customer" />
    </AuthCard>
  );
}
