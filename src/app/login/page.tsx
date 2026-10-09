import type { Metadata } from 'next';
import { LoginPage } from '@/components/auth/login-page';

export const metadata: Metadata = { title: 'Log in' };

// Customers. Restaurant partners use /restaurant/login and admins /admin/login.
export default function CustomerLoginPage({ searchParams }: PageProps<'/login'>) {
  return <LoginPage portal="customer" searchParams={searchParams} />;
}
