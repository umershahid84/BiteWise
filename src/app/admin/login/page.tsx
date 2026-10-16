import type { Metadata } from 'next';
import { LoginPage } from '@/components/auth/login-page';

export const metadata: Metadata = { title: 'Admin log-in', robots: { index: false } };

// ResDish admins (the owner console).
export default function AdminLoginPage({ searchParams }: PageProps<'/admin/login'>) {
  return <LoginPage portal="admin" searchParams={searchParams} />;
}
