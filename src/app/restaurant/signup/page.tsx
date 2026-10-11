import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth/auth-card';
import { SignupForm } from '@/components/auth/signup-form';
import { getViewer } from '@/lib/auth';

export const metadata: Metadata = { title: 'Join Bite Wise as a restaurant' };

export default async function RestaurantSignupPage() {
  const viewer = await getViewer();
  // Someone else is logged in on this browser: log them out first (src/app/auth/switch/route.ts).
  if (viewer) redirect('/auth/switch?next=%2Frestaurant%2Fsignup');
  return (
    <AuthCard>
      <SignupForm initialRole="restaurant" />
    </AuthCard>
  );
}
