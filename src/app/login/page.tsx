import type { Metadata } from 'next';
import { LoginPage } from '@/components/auth/login-page';

export const metadata: Metadata = { title: 'Log in' };

// Customers and restaurants (owners and staff). The admin team logs in at /admin/login.
export default function CustomerLoginPage({ searchParams }: PageProps<'/login'>) {
  return <LoginPage portal="main" searchParams={searchParams} />;
}
