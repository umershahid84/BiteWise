'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, Pencil, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { sendToLogin } from '@/components/app/session-watch';
import { addTeamMemberAction, editTeamMemberAction, removeTeamMemberAction, sendTeamResetCodeAction, setTeamPasswordAction, updateTeamMemberAction } from '@/app/actions/admin';
import { Alert, ErrorText } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Checkbox, Field, Input } from '@/components/ui/field';
import { PasswordInput } from '@/components/ui/password-input';
import { Spinner, Table } from '@/components/ui/misc';
import { cn } from '@/lib/utils';
import { day, useAccess, useAdmin, LoadError } from './shared';

type Member = { id: string; email: string; username: string; role: 'admin' | 'support'; canRefund: boolean; status: string; createdAt: string; lastSignInAt: string | null };

// The admin team (admins only): add admins with full access, or employees who look after accounts, and choose which
// employees may give customers platform credit (courtesy refunds and goodwill).
export function TeamPanel() {
  const me = useAccess();
  const queryClient = useQueryClient();
  const { error: loadError, data, isLoading } = useAdmin<Member[]>(['team'], 'team');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
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

  if (loadError && !data) return <LoadError error={loadError} />;
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
          and resend emails. Can&apos;t delete accounts. Gives customers courtesy refunds and goodwill as platform credit only if you tick <b>Credit</b>. (All sales are final: nothing is refunded to the card.)</li>
      </ul>
      {isLoading || !data ? <div className="grid place-items-center py-8"><Spinner /></div> : (
        <Table>
          <thead><tr><th>Member</th><th>Access</th><th>Platform credit</th><th>Last log-in</th><th /></tr></thead>
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
                    : <Checkbox checked={m.canRefund} onChange={(e) => change(m, { canRefund: e.target.checked })} label="Credit" />}
                </td>
                <td className="text-sm">{m.lastSignInAt ? day(m.lastSignInAt) : 'never'}</td>
                <td className="whitespace-nowrap">
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(m)}><Pencil /> Edit / password</Button>
                    {m.id !== me.id && <Button size="sm" variant="ghost" className="text-danger" onClick={() => remove(m)} aria-label={`Remove ${m.username}`}><Trash2 /></Button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && <EditMember member={editing} self={editing.id === me.id} onSaved={refresh} />}
      </Dialog>
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
    setError(null);
    // Never leave the button stuck on "Adding…", whatever happens to the request.
    const res = await addTeamMemberAction({ email: f.email, username: f.username, password: f.password, role: f.role, canRefund: f.canRefund })
      .catch(() => ({ ok: false as const, error: 'Bite Wise didn\'t answer. Check your connection and try again.', status: 0 }))
      .finally(() => setBusy(false));
    if (!res.ok && res.status === 401) return sendToLogin();
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
        <Field label="Password" htmlFor="tm-pass" hint="At least 8 characters, with a letter and a number."><PasswordInput id="tm-pass" autoComplete="new-password" value={f.password} onChange={set('password')} /></Field>
        <Field label="Re-enter password" htmlFor="tm-confirm"><PasswordInput id="tm-confirm" autoComplete="new-password" value={f.confirm} onChange={set('confirm')} /></Field>
      </div>
      {f.role === 'support' && (
        <Checkbox className="mb-4" checked={f.canRefund} onChange={(e) => setF({ ...f, canRefund: e.target.checked })} label="Can give customers platform credit: courtesy refunds (Orders) and goodwill (Customers)" />
      )}
      <ErrorText error={error} />
      <Button block disabled={busy} onClick={save}>{busy ? 'Adding…' : f.role === 'admin' ? 'Add admin' : 'Add employee'}</Button>
    </DialogContent>
  );
}

// Edit a team member: their email and user name, and their password (set one, give a temporary one they must change
// at their next log-in, or email them a code to choose their own).
function EditMember({ member: m, self, onSaved }: { member: Member; self: boolean; onSaved: () => void }) {
  const [f, setF] = useState({ email: m.email, username: m.username });
  const [pw, setPw] = useState({ password: '', confirm: '', email: false });
  const [temp, setTemp] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const call = async <T,>(what: string, fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string; status?: number }>) => {
    setBusy(what);
    setError(null);
    const res = await fn()
      .catch(() => ({ ok: false as const, error: 'Bite Wise didn\'t answer. Check your connection and try again.' }))
      .finally(() => setBusy(null));
    if (!res.ok && 'status' in res && res.status === 401) return sendToLogin();
    if (!res.ok) return void setError(res.error);
    return res.data;
  };
  const saveDetails = async () => {
    const d = await call('details', () => editTeamMemberAction({ id: m.id, ...f }));
    if (d === undefined) return;
    toast.success(d.changed ? `${f.username} is updated.` : 'Nothing to change.');
    onSaved();
  };
  const setPassword = async (mode: 'set' | 'temporary') => {
    if (mode === 'temporary' && !confirm(`Give ${m.username} a temporary password? Their current password stops working, and they must choose a new one when they log in.`)) return;
    const d = await call(mode, () => setTeamPasswordAction({ id: m.id, mode, ...pw }));
    if (d === undefined) return;
    if (d.password) setTemp(d.password);
    else toast.success(`${m.username}'s password is changed.${pw.email ? ' We emailed it to them.' : ' Give it to them in person.'}`);
    setPw({ password: '', confirm: '', email: pw.email });
  };
  const sendCode = async () => {
    const d = await call('code', () => sendTeamResetCodeAction({ id: m.id }));
    if (d) toast.success(`We emailed a code to ${d.email}. They enter it with "Forgot password" on the admin log-in page.`);
  };
  return (
    <DialogContent title={`Edit ${m.username}`} description={self ? 'Your own team account.' : `${m.role === 'admin' ? 'Admin' : 'Employee'} · added ${day(m.createdAt)}`}>
      <SectionTitle>Details</SectionTitle>
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label="Email" htmlFor="em-email"><Input id="em-email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="User name" htmlFor="em-user" hint="Letters, numbers, dots or underscores."><Input id="em-user" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></Field>
      </div>
      <Button size="sm" disabled={!!busy} onClick={saveDetails}>{busy === 'details' ? 'Saving…' : 'Save details'}</Button>

      <SectionTitle>Password</SectionTitle>
      {temp ? (
        <Alert tone="info" className="mb-3">
          <b>Temporary password for {m.username}:</b>
          <div className="my-2 flex items-center gap-2">
            <code className="rounded-lg bg-surface px-2.5 py-1.5 font-mono text-base font-bold">{temp}</code>
            <Button size="sm" variant="ghost" onClick={() => { void navigator.clipboard?.writeText(temp); toast.success('Copied.'); }}><Copy /> Copy</Button>
          </div>
          Give it to them{pw.email ? ' (we also emailed it)' : ''}. It works once: they must choose their own password when they log in. It won&apos;t be shown again.
        </Alert>
      ) : null}
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label="New password" htmlFor="em-pass" hint="At least 8 characters, with a letter and a number.">
          <PasswordInput id="em-pass" autoComplete="new-password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} />
        </Field>
        <Field label="Re-enter new password" htmlFor="em-confirm">
          <PasswordInput id="em-confirm" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
        </Field>
      </div>
      {!self && <Checkbox checked={pw.email} onChange={(e) => setPw({ ...pw, email: e.target.checked })} label={`Email the new or temporary password to ${m.email}`} />}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" disabled={!!busy} onClick={() => setPassword('set')}>{busy === 'set' ? 'Saving…' : 'Update password'}</Button>
        {!self && <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setPassword('temporary')}>{busy === 'temporary' ? 'Creating…' : 'Create temporary password'}</Button>}
        {!self && <Button size="sm" variant="ghost" disabled={!!busy} onClick={sendCode}>{busy === 'code' ? 'Sending…' : 'Email a reset code'}</Button>}
      </div>
      <p className="mt-2 mb-0 text-xs text-muted">
        <b>Update password</b> sets the password you typed. <b>Temporary password</b> makes one up; they must change it when they log in. <b>Reset code</b> emails them a
        code to choose their own password with &quot;Forgot password&quot;.
      </p>
      <ErrorText error={error} />
    </DialogContent>
  );
}

const SectionTitle = ({ children }: { children: React.ReactNode }) => <h3 className="mt-5 mb-2 text-sm font-extrabold tracking-wide text-muted uppercase first:mt-0">{children}</h3>;
