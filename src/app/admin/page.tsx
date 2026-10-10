import type { Metadata } from 'next';
import { AdminConsole } from '@/components/admin/console';
import { requirePageViewer } from '@/lib/auth';

// Menu imports from a website can take a while (several pages, or reading a PDF with the AI menu reader).
export const maxDuration = 60;

export const metadata: Metadata = { title: 'Owner console' };

export default async function AdminPage() {
  const viewer = await requirePageViewer(['admin', 'support']);
  return <AdminConsole access={{ id: viewer.id, role: viewer.role === 'admin' ? 'admin' : 'support', canRefund: viewer.canRefund }} />;
}
