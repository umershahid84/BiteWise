'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { addTeamMemberAction, removeTeamMemberAction, updateTeamMemberAction } from '@/app/actions/admin';
import { ErrorText } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Checkbox, Field, Input } from '@/components/ui/field';
import { Spinner, Table } from '@/components/ui/misc';
import { cn } from '@/lib/utils';
import { day, useAccess, useAdmin } from './shared';

type Member = { id: string; email: string; username: string; role: 'admin' | 'support'; canRefund: boolean; status: string; createdAt: string; lastSignInAt: string | null };

// The admin team (admins only): add admins with full access, or employees who look after accounts, and choose which
// employees may issue refunds and credit.
export function TeamPanel() {
  const me = useAccess();
  const queryClient = useQueryClient();
  const { data, isLoading } = useAdmin<Member[]>(['team'], 'team');
  const [adding, setAdding] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin'] });
  const change = async (m: Member, patch: Partial<Pick<Member, 'role' | 'canRefund'>>) => {
    const next = { role: m.role, canRefund: m.canRefund, ...patch };
    if (next.role === 'admin' && m.role !== 'admin' && !confirm(`Give ${m.username} full admin access (payouts, income, settings, the team)?`)) return;
    const res = await updateTeamMemberAction({ id: m.id, ...next });
    if (!res.ok) return toast.error(res.error);
    toast.success(`${m.username} is updated.`);
    refresh();
  };
  const remove = async (m: Member) => {
    if (!confirm(`Remove ${m.username} from the team? Their account is deleted and they can no longer log in.`)) return;
    const res = await removeTeamMemberAction({ id: m.id });
    if (!res.ok) return toast.error(res.error);
    toast.success(`${m.username} is removed.`);
    refresh();
  };

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <CardTitle className="m-0">Admin team</CardTitle>
        <span className="flex-1" />
        <Button variant="green" onClick={() => setAdding(true)}><UserPlus /> Add team member</Button>
      </div>
      <ul className="mt-0 mb-4 grid gap-1 pl-5 text-sm text-ink-2">
        <li><b>Admin:</b> full access to everything, including income, payouts, settings and this team.</li>
        <li><b>Employee:</b> sees Alerts, Restaurants, Customers, Orders and Live offers. Can approve, suspend, ban and reactivate accounts, update emails and details,
          and resend emails. Can&apos;t delete accounts. Issues refunds and credit only if you tick <b>Refunds</b>.</li>
      </ul>
      {isLoading || !data ? <div className="grid place-items-center py-8"><Spinner /></div> : (
        <Table>
          <thead><tr><th>Member</th><th>Access</th><th>Refunds &amp; credit</th><th>Last log-in</th><th /></tr></thead>
          <tbody>
            {data.map((m) => (
              <tr key={m.id}>
                <td><b>{m.username}</b>{m.id === me.id && <span className="text-muted"> (you)</span>}<div className="text-xs break-all text-muted">{m.email} · added {day(m.createdAt)}</div></td>
                <td>
                  <div className="inline-flex rounded-full border border-line bg-bg-2 p-0.5">
                    {(['admin', 'support'] as const).map((r) => (
                      <button key={r} type="button" disabled={m.id === me.id} onClick={() => m.role !== r && change(m, { role: r })}
                        className={cn('rounded-full px-3 py-1 text-xs font-bold text-muted disabled:cursor-not-allowed', m.role === r && 'bg-primary-soft text-primary-ink')}>
                        {r === 'admin' ? 'Admin' : 'Employee'}
                      </button>
                    ))}
                  </div>
                  {m.status !== 'active' && <div className="mt-1"><Badge tone="amber">{m.status}</Badge></div>}
                </td>
                <td>
                  {m.role === 'admin'
                    ? <span className="text-sm text-muted">Yes (admin)</span>
                    : <Checkbox checked={m.canRefund} onChange={(e) => change(m, { canRefund: e.target.checked })} label="Refunds" />}
                </td>
                <td className="text-sm">{m.lastSignInAt ? day(m.lastSignInAt) : 'never'}</td>
                <td>{m.id !== me.id && <Button size="sm" variant="ghost" className="text-danger" onClick={() => remove(m)} aria-label={`Remove ${m.username}`}><Trash2 /></Button>}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Dialog open={adding} onOpenChange={setAdding}>
        {adding && <AddMember onDone={() => { setAdding(false); refresh(); }} />}
      </Dialog>
    </Card>
  );
}

function AddMember({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ email: '', username: '', password: '', confirm: '', role: 'support' as 'admin' | 'support', canRefund: false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: 'email' | 'username' | 'password' | 'confirm') => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    if (f.password !== f.confirm) return setError('The two passwords don\'t match.');
    setBusy(true);
    const res = await addTeamMemberAction({ email: f.email, username: f.username, password: f.password, role: f.role, canRefund: f.canRefund });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    toast.success(`${f.username} is added. They log in at /admin/login; we emailed them a welcome (without the password).`);
    onDone();
  };
  return (
    <DialogContent title="Add a team member" description="They log in on the admin log-in page. Give them the password in person; they can change it with Forgot password.">
      <div role="radiogroup" className="mb-4 grid grid-cols-2 gap-2">
        {(['support', 'admin'] as const).map((r) => (
          <button key={r} type="button" role="radio" aria-checked={f.role === r} onClick={() => setF({ ...f, role: r })}
            className={cn('rounded-2xl border p-3 text-left', f.role === r ? 'border-primary bg-primary-soft/60' : 'border-line')}>
            <b className="flex items-center gap-1.5">{r === 'admin' && <ShieldCheck className="size-4" />}{r === 'admin' ? 'Admin' : 'Employee'}</b>
            <span className="text-xs text-muted">{r === 'admin' ? 'Full access to everything.' : 'Accounts, bans, emails, orders and live offers.'}</span>
          </button>
        ))}
      </div>
      <Field label="Email" htmlFor="tm-email"><Input id="tm-email" type="email" value={f.email} onChange={set('email')} /></Field>
      <Field label="User name" htmlFor="tm-user" hint="Letters, numbers, dots or underscores."><Input id="tm-user" value={f.username} onChange={set('username')} autoComplete="off" /></Field>
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label="Password" htmlFor="tm-pass" hint="At least 8 characters, with a letter and a number."><Input id="tm-pass" type="password" autoComplete="new-password" value={f.password} onChange={set('password')} /></Field>
        <Field label="Re-enter password" htmlFor="tm-confirm"><Input id="tm-confirm" type="password" autoComplete="new-password" value={f.confirm} onChange={set('confirm')} /></Field>
      </div>
      {f.role === 'support' && (
        <Checkbox className="mb-4" checked={f.canRefund} onChange={(e) => setF({ ...f, canRefund: e.target.checked })} label="Can issue refunds and credit to customers (Orders and Customers tabs)" />
      )}
      <ErrorText error={error} />
      <Button block disabled={busy} onClick={save}>{busy ? 'Adding…' : f.role === 'admin' ? 'Add admin' : 'Add employee'}</Button>
    </DialogContent>
  );
}
