'use client';

import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Pause, Play, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { addStaff, deleteStaff, editStaff, getStaff } from '@/app/actions/restaurant';
import { Alert, ErrorText } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Spinner, Table } from '@/components/ui/misc';
import { fmtDay } from '@/lib/format';

type Title = 'Manager' | 'Supervisor';
type Member = { userId: string; username: string; fullName: string; title: Title; status: string; createdAt: string; lastSignInAt: string | null };

// The owner's staff accounts: managers and supervisors who log in with their own user name and password to post
// surplus food, manage the menu and hand orders over. They don't see payouts, billing, reports, the kiosk link,
// the profile or this tab.
export function StaffPanel() {
  const [staff, setStaff] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const load = useCallback(async () => {
    const res = await getStaff();
    if (res.ok) setStaff(res.data);
    else setError(res.error);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the list once
  useEffect(() => { void load(); }, [load]);

  const toggle = async (m: Member) => {
    const active = m.status !== 'active';
    const res = await editStaff({ userId: m.userId, fullName: m.fullName, title: m.title, active });
    if (!res.ok) return toast.error(res.error);
    toast.success(active ? `${m.fullName} can log in again.` : `${m.fullName}'s account is paused.`);
    void load();
  };
  const remove = async (m: Member) => {
    if (!confirm(`Delete ${m.fullName}'s account (${m.username})? They won't be able to log in. Offers they posted stay.`)) return;
    const res = await deleteStaff(m.userId);
    if (!res.ok) return toast.error(res.error);
    toast.success(`${m.fullName}'s account is deleted.`);
    void load();
  };

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <CardTitle className="m-0">Staff accounts</CardTitle>
        <span className="flex-1" />
        <Button variant="green" onClick={() => setAdding(true)}><UserPlus /> Add staff member</Button>
      </div>
      <p className="mt-0 text-sm text-ink-2">
        Give your managers and supervisors their own log-in, so they can <b>post surplus food</b>, <b>add menu items and change prices</b>, and <b>hand over orders</b> when
        you&apos;re not there. They log in on the <b>partner log-in page</b> with the user name and password you choose here. They can&apos;t see your sales, payouts, sales
        tax, plan and billing, or change your profile.
      </p>
      <ErrorText error={error} />
      {!staff ? <div className="grid place-items-center py-8"><Spinner /></div> : staff.length === 0 ? (
        <Alert tone="info">No staff accounts yet. Add one for each manager or supervisor; don&apos;t share your own password.</Alert>
      ) : (
        <Table>
          <thead><tr><th>Name</th><th>User name</th><th>Role</th><th>Last log-in</th><th>Status</th><th /></tr></thead>
          <tbody>
            {staff.map((m) => (
              <tr key={m.userId} className={m.status !== 'active' ? 'opacity-70' : undefined}>
                <td><b>{m.fullName}</b><div className="text-xs text-muted">added {fmtDay(m.createdAt)}</div></td>
                <td className="font-mono text-sm">{m.username}</td>
                <td>{m.title}</td>
                <td className="text-sm">{m.lastSignInAt ? fmtDay(m.lastSignInAt) : 'never'}</td>
                <td>{m.status === 'active' ? <Badge tone="green">Active</Badge> : <Badge tone="amber">Paused</Badge>}</td>
                <td className="whitespace-nowrap">
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(m)}><KeyRound /> Edit / password</Button>
                    <Button size="sm" variant="ghost" onClick={() => toggle(m)}>{m.status === 'active' ? <><Pause /> Pause</> : <><Play /> Turn on</>}</Button>
                    <Button size="sm" variant="ghost" className="text-danger" onClick={() => remove(m)} aria-label={`Delete ${m.fullName}`}><Trash2 /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Dialog open={adding} onOpenChange={setAdding}>
        {adding && <StaffForm onDone={() => { setAdding(false); void load(); }} />}
      </Dialog>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && <StaffForm member={editing} onDone={() => { setEditing(null); void load(); }} />}
      </Dialog>
    </Card>
  );
}

function StaffForm({ member, onDone }: { member?: Member; onDone: () => void }) {
  const [f, setF] = useState({ fullName: member?.fullName ?? '', username: member?.username ?? '', title: (member?.title ?? 'Manager') as Title, password: '', confirm: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    if (f.password !== f.confirm) return setError('The two passwords don\'t match.');
    setBusy(true);
    const res = member
      ? await editStaff({ userId: member.userId, fullName: f.fullName, title: f.title, password: f.password })
      : await addStaff({ fullName: f.fullName, username: f.username, title: f.title, password: f.password });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    toast.success(member
      ? `${f.fullName} is updated.${f.password ? ' Give them their new password.' : ''}`
      : `${f.fullName} can now log in as ${f.username} on the partner log-in page.`);
    onDone();
  };
  return (
    <DialogContent
      title={member ? `Edit ${member.fullName}` : 'Add a staff member'}
      description={member ? `User name: ${member.username}. Leave the password empty to keep their current one.` : 'Choose their user name and password, then give them to your staff member in person.'}
    >
      <Field label="Their name" htmlFor="sf-name"><Input id="sf-name" value={f.fullName} onChange={set('fullName')} placeholder="Maria Lopez" /></Field>
      <div className="grid gap-x-3 sm:grid-cols-2">
        {!member && (
          <Field label="User name" htmlFor="sf-user" hint="Letters, numbers, dots or underscores.">
            <Input id="sf-user" value={f.username} onChange={set('username')} autoComplete="off" placeholder="maria.harborpho" />
          </Field>
        )}
        <Field label="Role" htmlFor="sf-title">
          <Select id="sf-title" value={f.title} onChange={set('title')}><option>Manager</option><option>Supervisor</option></Select>
        </Field>
      </div>
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label={member ? 'New password' : 'Password'} htmlFor="sf-pass" hint="At least 8 characters, with a letter and a number.">
          <Input id="sf-pass" type="password" autoComplete="new-password" value={f.password} onChange={set('password')} />
        </Field>
        <Field label={member ? 'Re-enter new password' : 'Re-enter password'} htmlFor="sf-confirm">
          <Input id="sf-confirm" type="password" autoComplete="new-password" value={f.confirm} onChange={set('confirm')} />
        </Field>
      </div>
      <ErrorText error={error} />
      <Button block disabled={busy} onClick={save}>{busy ? 'Saving…' : member ? 'Save' : 'Create account'}</Button>
    </DialogContent>
  );
}
