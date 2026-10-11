'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { changeMyPassword, signOut } from '@/app/actions/auth';
import { ErrorText } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { PasswordInput } from '@/components/ui/password-input';

// Choosing a new password for your own account. `forced`: after logging in with a temporary password an admin set
// (the current password isn't asked for).
function ChangePasswordForm({ forced, onDone }: { forced: boolean; onDone: () => void }) {
  const [f, setF] = useState({ current: '', password: '', confirm: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await changeMyPassword(forced ? { password: f.password, confirm: f.confirm } : f)
      .catch(() => ({ ok: false as const, error: 'Bite Wise didn\'t answer. Check your connection and try again.' }))
      .finally(() => setBusy(false));
    if (!res.ok) return setError(res.error);
    toast.success('Your password is changed.');
    onDone();
  };
  return (
    <form onSubmit={save} noValidate>
      {!forced && (
        <Field label="Current password" htmlFor="cp-current">
          <PasswordInput id="cp-current" autoComplete="current-password" value={f.current} onChange={set('current')} />
        </Field>
      )}
      <Field label="New password" htmlFor="cp-new" hint="At least 8 characters, with a letter and a number.">
        <PasswordInput id="cp-new" autoComplete="new-password" value={f.password} onChange={set('password')} />
      </Field>
      <Field label="Re-enter new password" htmlFor="cp-confirm">
        <PasswordInput id="cp-confirm" autoComplete="new-password" value={f.confirm} onChange={set('confirm')} />
      </Field>
      <ErrorText error={error} />
      <Button block type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save new password'}</Button>
    </form>
  );
}

// Shown over every page after logging in with a temporary password, until a new one is chosen.
export function PasswordGate() {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  return (
    <Dialog open={open}>
      <DialogContent
        title="Choose your own password"
        description="You logged in with a temporary password from an admin. Choose a new password to continue."
        className="[&>button[aria-label=Close]]:hidden"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <ChangePasswordForm forced onDone={() => { setOpen(false); router.refresh(); }} />
        <form action={signOut} className="mt-3 text-center">
          <button className="text-sm font-semibold text-muted hover:text-ink">Log out instead</button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// "Change my password" (the owner console, for admins and employees).
export function ChangePasswordButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}><KeyRound /> Change my password</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        {open && (
          <DialogContent title="Change your password" description="Enter your current password, then your new one.">
            <ChangePasswordForm forced={false} onDone={() => setOpen(false)} />
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
