'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { issueCredit, setUserStatus } from '@/app/actions/admin';
import { ErrorText } from '@/components/ui/alert';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Spinner, Table } from '@/components/ui/misc';
import { money } from '@/lib/format';
import { day, run, useAdmin } from './shared';

type User = {
  id: string; email: string; username: string; role: string; status: 'active' | 'suspended'; createdAt: string; orders: number; spentCents: number;
  noShows: number; creditCents: number; termsAcceptedAt: string | null;
};

export function UsersPanel({ adminId }: { adminId: string }) {
  const queryClient = useQueryClient();
  const [role, setRole] = useState('customer');
  const [q, setQ] = useState('');
  const [creditFor, setCreditFor] = useState<User | null>(null);
  const { data, isLoading } = useAdmin<User[]>(['users', role, q], 'users', { role, q });
  const toggle = async (u: User) => {
    const next = u.status === 'active' ? 'suspended' : 'active';
    if (next === 'suspended' && !confirm(`Suspend ${u.username}? They will be signed out and can't log in.`)) return;
    if (await run(() => setUserStatus({ id: u.id, status: next }), `${u.username}: ${next}`)) queryClient.invalidateQueries({ queryKey: ['admin'] });
  };
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-3">
        <Input className="max-w-sm" placeholder="Search email or user name" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select className="max-w-52" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="customer">Customers</option><option value="restaurant">Restaurant owners</option><option value="admin">Admins</option>
        </Select>
      </div>
      <Card className="p-2">
        {isLoading ? <div className="grid place-items-center py-10"><Spinner /></div> : (
          <Table>
            <thead><tr><th>User</th><th>Orders</th><th>Spent</th><th>No-shows</th><th>Credit</th><th>Terms accepted</th><th>Status</th><th /></tr></thead>
            <tbody>
              {(data ?? []).map((u) => (
                <tr key={u.id}>
                  <td><b>{u.username}</b><div className="text-xs text-muted">{u.email} · joined {day(u.createdAt)}</div></td>
                  <td>{u.orders}</td><td>{money(u.spentCents)}</td><td>{u.noShows}</td>
                  <td className="text-accent-ink">{u.creditCents ? money(u.creditCents) : '–'}</td>
                  <td className="text-xs">{day(u.termsAcceptedAt) || '–'}</td>
                  <td><StatusBadge status={u.status} /></td>
                  <td className="whitespace-nowrap">
                    <div className="flex gap-1.5">
                      {u.role === 'customer' && <Button size="sm" variant="ghost" onClick={() => setCreditFor(u)}>+ Credit</Button>}
                      {u.id !== adminId && <Button size="sm" variant={u.status === 'active' ? 'danger' : 'green'} onClick={() => toggle(u)}>{u.status === 'active' ? 'Suspend' : 'Reactivate'}</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Dialog open={!!creditFor} onOpenChange={(o) => !o && setCreditFor(null)}>
        {creditFor && <CreditForm user={creditFor} onDone={() => { setCreditFor(null); queryClient.invalidateQueries({ queryKey: ['admin'] }); }} />}
      </Dialog>
    </>
  );
}

function CreditForm({ user, onDone }: { user: User; onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <DialogContent title={`Issue credit to ${user.username}`} description="Goodwill platform credit is funded by Rescue Bites. Restaurants are still paid in full when it's used.">
      <Field label="Amount ($)" htmlFor="c-amt"><Input id="c-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10.00" /></Field>
      <Field label="Reason (shown to the customer)" htmlFor="c-reason"><Input id="c-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Sorry about the wait on your last order" /></Field>
      <ErrorText error={error} />
      <Button block onClick={async () => {
        const res = await issueCredit({ userId: user.id, amount, reason });
        if (!res.ok) return setError(res.error);
        onDone();
      }}>Issue credit</Button>
    </DialogContent>
  );
}
