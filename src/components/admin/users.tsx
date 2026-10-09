'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { deleteUser, issueCredit, sendCustomerWelcomeEmail, setUserStatus, updateUserAccount } from '@/app/actions/admin';
import { ErrorText } from '@/components/ui/alert';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Spinner, Table } from '@/components/ui/misc';
import { PagerBar, PagerFooter, usePager } from '@/components/ui/pager';
import { SUSPENSION_DAYS } from '@/lib/constants';
import { money } from '@/lib/format';
import { day, run, TableHead, useAdmin } from './shared';

type User = {
  id: string; email: string; username: string; role: string; status: 'active' | 'suspended' | 'banned' | 'deleted'; suspendedUntil: string | null; createdAt: string; orders: number; spentCents: number; noShowStreak: number; noShowProbation: boolean;
  noShows: number; creditCents: number; termsAcceptedAt: string | null; emailConfirmed: boolean; welcomeEmailSentAt: string | null;
};

export function UsersPanel({ adminId }: { adminId: string }) {
  const queryClient = useQueryClient();
  const [role, setRole] = useState('customer');
  const [q, setQ] = useState('');
  const [creditFor, setCreditFor] = useState<User | null>(null);
  const [suspendFor, setSuspendFor] = useState<User | null>(null);
  const [deleteFor, setDeleteFor] = useState<User | null>(null);
  const [banFor, setBanFor] = useState<User | null>(null);
  const [editFor, setEditFor] = useState<User | null>(null);
  const { data, isLoading } = useAdmin<User[]>(['users', role, q], 'users', { role, q });
  const pager = usePager(data ?? [], `${role}|${q}`);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin'] });
  const reactivate = async (u: User) => {
    if (u.status === 'banned' && !confirm(`Lift the permanent ban on ${u.username}? They will be able to log in again.`)) return;
    if (await run(() => setUserStatus({ id: u.id, status: 'active' }), `${u.username} is active again`)) refresh();
  };
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-3">
        <Input className="max-w-sm" placeholder="Search email or user name" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select className="max-w-52" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="customer">Customers</option><option value="restaurant">Restaurant owners</option><option value="staff">Restaurant staff</option><option value="admin">Admins</option>
        </Select>
      </div>
      <Card className="p-2">
        <TableHead title={role === 'restaurant' ? 'Restaurant owners' : role === 'staff' ? 'Restaurant staff' : role === 'admin' ? 'Admins' : 'Customers'} kind="users" params={{ role, q }} what="these accounts" />
        {isLoading ? <div className="grid place-items-center py-10"><Spinner /></div> : (
          <>
            <PagerBar pager={pager} label="accounts" />
            <Table>
              <thead><tr><th>User</th><th>Orders</th><th>Spent</th><th>No-shows</th><th>Credit</th><th>Terms accepted</th><th>Status</th><th /></tr></thead>
              <tbody>
                {pager.rows.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <b>{u.username}</b><div className="text-xs text-muted">{u.role === 'staff' ? 'staff account (no email)' : u.email} · joined {day(u.createdAt)}</div>
                      {u.role !== 'staff' && !u.emailConfirmed && <Badge tone="amber">Email not confirmed</Badge>}
                      {u.role === 'customer' && u.emailConfirmed && <div className="text-xs text-muted">{u.welcomeEmailSentAt ? `Welcome email sent ${day(u.welcomeEmailSentAt)}` : 'Welcome email not sent'}</div>}
                    </td>
                    <td>{u.orders}</td><td>{money(u.spentCents)}</td>
                    <td>
                      {u.noShows}
                      {u.noShowStreak > 0 && u.status === 'active' && <div className="text-xs text-accent-ink">{u.noShowStreak} in a row</div>}
                      {u.noShowProbation && u.status !== 'banned' && <div className="text-xs text-danger" title="Suspended before for missed pickups: the next one bans the account">final warning</div>}
                    </td>
                    <td className="text-accent-ink">{u.creditCents ? money(u.creditCents) : '–'}</td>
                    <td className="text-xs">{day(u.termsAcceptedAt) || '–'}</td>
                    <td>
                      <StatusBadge status={u.status} />
                      {u.status === 'suspended' && u.suspendedUntil && <div className="mt-1 text-xs text-muted">until {day(u.suspendedUntil)}</div>}
                    </td>
                    <td className="whitespace-nowrap">
                      <div className="flex gap-1.5">
                        {u.role !== 'staff' && <Button size="sm" variant="ghost" onClick={() => setEditFor(u)}>Edit</Button>}
                        {u.role === 'customer' && u.status !== 'banned' && <Button size="sm" variant="ghost" onClick={() => setCreditFor(u)}>+ Credit</Button>}
                        {u.id !== adminId && (u.status === 'active'
                          ? <Button size="sm" variant="danger" onClick={() => setSuspendFor(u)}>Suspend</Button>
                          : <Button size="sm" variant="green" onClick={() => reactivate(u)}>{u.status === 'banned' ? 'Lift ban' : 'Reactivate'}</Button>)}
                        {u.id !== adminId && u.role !== 'admin' && u.status !== 'banned' && <Button size="sm" variant="ghost" className="text-danger" onClick={() => setBanFor(u)}>Ban</Button>}
                        {u.id !== adminId && <Button size="sm" variant="ghost" className="text-danger" onClick={() => setDeleteFor(u)}>Delete</Button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <PagerFooter pager={pager} />
          </>
        )}
      </Card>
      <Dialog open={!!editFor} onOpenChange={(o) => !o && setEditFor(null)}>
        {editFor && <EditForm user={editFor} onDone={() => { setEditFor(null); refresh(); }} />}
      </Dialog>
      <Dialog open={!!creditFor} onOpenChange={(o) => !o && setCreditFor(null)}>
        {creditFor && <CreditForm user={creditFor} onDone={() => { setCreditFor(null); refresh(); }} />}
      </Dialog>
      <Dialog open={!!suspendFor} onOpenChange={(o) => !o && setSuspendFor(null)}>
        {suspendFor && <SuspendForm user={suspendFor} onDone={() => { setSuspendFor(null); refresh(); }} />}
      </Dialog>
      <Dialog open={!!banFor} onOpenChange={(o) => !o && setBanFor(null)}>
        {banFor && <BanForm user={banFor} onDone={() => { setBanFor(null); refresh(); }} />}
      </Dialog>
      <Dialog open={!!deleteFor} onOpenChange={(o) => !o && setDeleteFor(null)}>
        {deleteFor && <DeleteForm user={deleteFor} onDone={() => { setDeleteFor(null); refresh(); }} />}
      </Dialog>
    </>
  );
}

// Corrects an account's email address or user name, and sends a customer's welcome email again.
function EditForm({ user, onDone }: { user: User; onDone: () => void }) {
  const [email, setEmail] = useState(user.email);
  const [username, setUsername] = useState(user.username);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const res = await updateUserAccount({ id: user.id, email, username });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    toast.success(res.data.changed ? `${username} is updated.` : 'Nothing changed.');
    onDone();
  };
  const welcome = async () => {
    setBusy(true);
    const res = await sendCustomerWelcomeEmail({ id: user.id });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    toast.success(`Welcome email sent to ${res.data.to}.`);
    onDone();
  };
  return (
    <DialogContent title={`Edit ${user.username}`} description="A new email address counts as confirmed: you're vouching for it. The user logs in with the new email or user name from now on.">
      <Field label="Email address" htmlFor="e-email"><Input id="e-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label="User name" htmlFor="e-username" hint="3–24 characters: letters, numbers, dots or underscores."><Input id="e-username" value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
      <ErrorText error={error} />
      <Button block disabled={busy} onClick={save}>Save changes</Button>
      {user.role === 'customer' && (
        <Button block variant="ghost" className="mt-2" disabled={busy || email !== user.email} onClick={welcome}
          title={email !== user.email ? 'Save the new email address first' : undefined}>
          {user.welcomeEmailSentAt ? 'Resend welcome email' : 'Send welcome email'}
        </Button>
      )}
    </DialogContent>
  );
}

function CreditForm({ user, onDone }: { user: User; onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <DialogContent title={`Issue credit to ${user.username}`} description="Goodwill platform credit is funded by Bite Wise. Restaurants are still paid in full when it's used.">
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

// The suspension lengths (SUSPENSION_DAYS) as a row of buttons. Also used for restaurants.
export function DaysPicker({ days, onChange }: { days: number; onChange: (n: number) => void }) {
  return (
    <div className="mb-4 grid grid-cols-5 gap-2" role="radiogroup" aria-label="Suspension length">
      {SUSPENSION_DAYS.map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={days === n}
          onClick={() => onChange(n)}
          className={`rounded-xl border px-2 py-3 text-center font-bold transition outline-none focus-visible:ring-2 focus-visible:ring-primary ${days === n ? 'border-danger bg-danger-soft text-danger' : 'border-line bg-surface text-ink hover:border-ink-2'}`}
        >
          {n}<span className="block text-xs font-semibold opacity-80">days</span>
        </button>
      ))}
    </div>
  );
}

function SuspendForm({ user, onDone }: { user: User; onDone: () => void }) {
  const [days, setDays] = useState<number>(SUSPENSION_DAYS[0]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <DialogContent title={`Suspend ${user.username}`} description="They are signed out and can't log in until the suspension ends. The account reactivates by itself afterwards, or you can reactivate it sooner.">
      <DaysPicker days={days} onChange={setDays} />
      <ErrorText error={error} />
      <Button block variant="danger" disabled={busy} onClick={async () => {
        setBusy(true);
        const res = await setUserStatus({ id: user.id, status: 'suspended', days });
        setBusy(false);
        if (!res.ok) return setError(res.error);
        toast.success(`${user.username} is suspended for ${days} days`);
        onDone();
      }}>Suspend for {days} days</Button>
    </DialogContent>
  );
}

function BanForm({ user, onDone }: { user: User; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <DialogContent title={`Ban ${user.username} permanently?`} description="For serious or repeated abuse. Use Suspend for a time-out.">
      <ul className="mt-0 mb-4 list-disc pl-5 text-sm text-ink-2">
        <li>They are signed out and can never log in again.</li>
        <li>Their email ({user.email}) can&apos;t be used to create a new account.</li>
        {user.role === 'customer' && <li>Open orders are cancelled and their card holds released (no charge).</li>}
        {user.role === 'restaurant' && <li>Their restaurant is removed from Bite Wise: offers end, open orders are cancelled and the kiosk stops working.</li>}
        <li>Order history is kept. You can lift the ban later if it was a mistake.</li>
      </ul>
      <Field label="Reason (kept in the audit log)" htmlFor="b-reason"><Input id="b-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Repeated fraudulent chargebacks" /></Field>
      <Field label={`Type ${user.username} to confirm`} htmlFor="b-confirm"><Input id="b-confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" /></Field>
      <ErrorText error={error} />
      <Button block variant="danger" disabled={busy || confirmText.trim().toLowerCase() !== user.username.toLowerCase()} onClick={async () => {
        setBusy(true);
        const res = await setUserStatus({ id: user.id, status: 'banned', note: reason });
        setBusy(false);
        if (!res.ok) return setError(res.error);
        toast.success(`${user.username} is banned`);
        onDone();
      }}>Ban permanently</Button>
    </DialogContent>
  );
}

function DeleteForm({ user, onDone }: { user: User; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  return (
    <DialogContent title={`Delete ${user.username}?`} description="This can't be undone.">
      <p className="mt-0 mb-4 text-sm text-ink-2">
        {user.orders + user.noShows > 0
          ? <>This account has order history, which is kept for sales and tax records. Its login, name, email and saved cards are erased and it can never be used again; past orders will show <b>Deleted user</b>.</>
          : <>The account and everything in it (profile{user.role === 'restaurant' ? ', restaurant, menu and offers' : ''}) are removed for good.</>}
        {' '}Open orders are cancelled first (customers aren&apos;t charged).
        {user.role === 'restaurant' && ' The restaurant is taken off the site and its plan stops renewing.'}
      </p>
      <Field label={`Type ${user.username} to confirm`} htmlFor="d-confirm">
        <Input id="d-confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
      </Field>
      <ErrorText error={error} />
      <Button block variant="danger" disabled={busy || confirmText.trim().toLowerCase() !== user.username.toLowerCase()} onClick={async () => {
        setBusy(true);
        const res = await deleteUser({ id: user.id });
        setBusy(false);
        if (!res.ok) return setError(res.error);
        toast.success(res.data.anonymized ? `${user.username} is deleted (order history kept anonymously)` : `${user.username} is deleted`);
        onDone();
      }}>Delete account</Button>
    </DialogContent>
  );
}
