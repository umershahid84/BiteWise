'use client';

import { Card } from '@/components/ui/card';
import { Spinner, Table } from '@/components/ui/misc';
import { PagerBar, PagerFooter, usePager } from '@/components/ui/pager';
import { fmtDateTime } from '@/lib/format';
import { useAdmin } from './shared';

type Entry = { id: number; action: string; target_type: string; target_id: string | null; details: string; created_at: string; profiles: { username: string } | null };

export function AuditPanel() {
  const { data, isLoading } = useAdmin<Entry[]>(['audit'], 'audit');
  const pager = usePager(data ?? []);
  if (isLoading) return <Spinner />;
  return (
    <Card className="p-2">
      <PagerBar pager={pager} label="actions" />
      <Table>
        <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Details</th></tr></thead>
        <tbody>
          {pager.rows.map((e) => (
            <tr key={e.id}>
              <td className="text-xs whitespace-nowrap">{fmtDateTime(e.created_at)}</td>
              <td>{e.profiles?.username ?? '–'}</td>
              <td><code className="text-xs">{e.action}</code><div className="text-xs text-muted">{e.target_type}{e.target_id ? ` #${e.target_id.slice(0, 8)}` : ''}</div></td>
              <td className="text-sm">{e.details}</td>
            </tr>
          ))}
          {!data?.length && <tr><td colSpan={4} className="py-6 text-center text-muted">No admin actions yet.</td></tr>}
        </tbody>
      </Table>
      <PagerFooter pager={pager} />
    </Card>
  );
}
