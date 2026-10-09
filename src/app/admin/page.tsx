import type { Metadata } from 'next';
import { AdminConsole } from '@/components/admin/console';
import { requirePageViewer } from '@/lib/auth';

export const metadata: Metadata = { title: 'Owner console' };

export default async function AdminPage() {
  const viewer = await requirePageViewer(['admin', 'support']);
  return <AdminConsole access={{ id: viewer.id, role: viewer.role === 'admin' ? 'admin' : 'support', canRefund: viewer.canRefund }} />;
}
