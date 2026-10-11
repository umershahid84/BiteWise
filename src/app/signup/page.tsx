import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth/auth-card';
import { SignupForm } from '@/components/auth/signup-form';
import { getViewer } from '@/lib/auth';

export const metadata: Metadata = { title: 'Create your account' };

// Customers and restaurants sign up here, with the "I'm a customer / I'm a restaurant" slider (?role=restaurant
// starts on the restaurant side; so does /restaurant/signup).
export default async function SignupPage({ searchParams }: PageProps<'/signup'>) {
  const { role } = await searchParams;
  const viewer = await getViewer();
  // Someone else is logged in on this browser: log them out first (src/app/auth/switch/route.ts).
  if (viewer) redirect(`/auth/switch?next=${encodeURIComponent(role === 'restaurant' ? '/signup?role=restaurant' : '/signup')}`);
  return (
    <AuthCard>
      <SignupForm initialRole={role === 'restaurant' ? 'restaurant' : 'customer'} />
    </AuthCard>
  );
}
