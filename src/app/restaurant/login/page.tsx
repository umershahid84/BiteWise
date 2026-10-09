import type { Metadata } from 'next';
import { LoginPage } from '@/components/auth/login-page';

export const metadata: Metadata = { title: 'Restaurant partner log-in' };

// Restaurant owners and their staff.
export default function RestaurantLoginPage({ searchParams }: PageProps<'/restaurant/login'>) {
  return <LoginPage portal="restaurant" searchParams={searchParams} />;
}
