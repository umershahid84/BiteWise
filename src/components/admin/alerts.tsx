'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCheck } from 'lucide-react';
import { markAlertsRead } from '@/app/actions/admin';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, Spinner, Table } from '@/components/ui/misc';
import { PagerBar, PagerFooter, usePager } from '@/components/ui/pager';
import { day, run, useAdmin } from './shared';

export type AlertsData = {
  unread: number;
  alerts: {
    id: number; kind: 'no_show' | 'no_show_suspension' | 'no_show_ban'; message: string; strikes: number; orderId: number | null; createdAt: string;
    readAt: string | null; userId: string | null; username: string; email: string; status: string; suspendedUntil: string | null; noShowsTotal: number;
  }[];
};

const KIND = {
  no_show: { label: 'Missed pickup', tone: 'amber' },
  no_show_suspension: { label: 'Suspended 30 days', tone: 'red' },
  no_show_ban: { label: 'Banned', tone: 'red' },
} as const;

const time = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// The unread count for the tab label (checked every minute).
export function useUnreadAlerts() {
  return useAdmin<AlertsData>(['alerts', 'badge'], 'alerts', {}, { refetchInterval: 60_000 }).data?.unread ?? 0;
}

// Customers the platform suspended or banned for missed pickups (and, optionally, every single missed pickup).
export function AlertsPanel({ go }: { go: (tab: string) => void }) {
  const queryClient = useQueryClient();
  const [all, setAll] = useState(false);
  const { data, isLoading } = useAdmin<AlertsData>(['alerts', all], 'alerts', { all: all ? 1 : undefined });
  const pager = usePager(data?.alerts ?? [], String(all));
  const read = async (id?: number) => {
    if (await run(() => markAlertsRead({ id }))) queryClient.invalidateQueries({ queryKey: ['admin', 'alerts'] });
  };
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <p className="m-0 max-w-3xl flex-1 text-sm text-muted">
          The platform acts on missed pickups by itself: <b>3 in a row</b> suspends a customer for <b>30 days</b> (reactivated automatically), and the
          <b> first missed pickup after that</b> bans the account permanently. You get an email and an alert here each time. To give someone a fresh
          start, reactivate them in <button type="button" className="font-bold text-primary-ink underline" onClick={() => go('customers')}>Customers</button>.
        </p>
        <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show every missed pickup</label>
        {!!data?.unread && <Button size="sm" variant="ghost" onClick={() => read()}><CheckCheck /> Mark all read</Button>}
      </div>
      {isLoading || !data ? <div className="grid place-items-center py-10"><Spinner /></div> : !data.alerts.length ? (
        <EmptyState title="No alerts">Nobody has been suspended or banned for missed pickups.</EmptyState>
      ) : (
        <Card className="p-2">
          <PagerBar pager={pager} label="alerts" />
          <Table>
            <thead><tr><th>When</th><th>Alert</th><th>Customer</th><th>What happened</th><th>Account now</th><th /></tr></thead>
            <tbody>
              {pager.rows.map((a) => (
                <tr key={a.id} className={a.readAt || a.kind === 'no_show' ? '' : 'bg-danger-soft/40'}>
                  <td className="text-sm whitespace-nowrap">{time(a.createdAt)}</td>
                  <td><Badge tone={KIND[a.kind].tone}>{KIND[a.kind].label}</Badge></td>
                  <td><b>{a.username}</b><div className="text-xs text-muted">{a.email}</div><div className="text-xs text-muted">{a.noShowsTotal} missed in total</div></td>
                  <td className="max-w-md text-sm">{a.message}</td>
                  <td>
                    <StatusBadge status={a.status} />
                    {a.status === 'suspended' && a.suspendedUntil && <div className="mt-1 text-xs text-muted">until {day(a.suspendedUntil)}</div>}
                  </td>
                  <td>{!a.readAt && a.kind !== 'no_show' && <Button size="sm" variant="ghost" onClick={() => read(a.id)}>Mark read</Button>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          <PagerFooter pager={pager} />
        </Card>
      )}
    </>
  );
}
