'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { resendConfirmation, signIn } from '@/app/actions/auth';
import { markActive } from '@/components/app/idle-logout';
import { Alert, ErrorText } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input } from '@/components/ui/field';
import { LOGIN_PATH, PORTAL_NAMES, type Portal } from '@/lib/constants';
import { AuthTitle } from './auth-card';
import { PasswordReset } from './password-reset';

export type LoginNotice = 'confirmed' | 'confirmation-failed' | 'idle' | null;

// "Remember me": the user name is kept in this browser, and the browser's own password manager is asked to save the
// password (Bite Wise never stores passwords itself). Each log-in page remembers its own account.
const rememberKey = (portal: Portal) => `bitewise.remember.${portal}`;
const readRemembered = (portal: Portal) => {
  try {
    return localStorage.getItem(rememberKey(portal));
  } catch {
    return null;
  }
};
const writeRemembered = (portal: Portal, login: string | null) => {
  try {
    if (login) localStorage.setItem(rememberKey(portal), login);
    else localStorage.removeItem(rememberKey(portal));
  } catch {
    // storage unavailable (private window)
  }
};
// Chrome and Edge: offer to save the password in the browser's password manager (Safari and Firefox offer by themselves).
const savePassword = async (form: HTMLFormElement) => {
  const PasswordCredential = (window as unknown as { PasswordCredential?: new (f: HTMLFormElement) => Credential }).PasswordCredential;
  if (!PasswordCredential || !navigator.credentials) return;
  try {
    await navigator.credentials.store(new PasswordCredential(form));
  } catch {
    // the browser declined
  }
};

export function LoginForm({ portal, title, next, notice, footer }: {
  portal: Portal; title: string; next: string | null; notice: LoginNotice; footer?: React.ReactNode;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<{ text: string; portal?: Portal } | null>(null);
  const [unconfirmed, setUnconfirmed] = useState<string | null>(null); // the login that still needs its email confirmed
  const [resent, setResent] = useState(false);
  const [login, setLogin] = useState('');
  const [remember, setRemember] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    const saved = readRemembered(portal);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) { setLogin(saved); setRemember(true); }
  }, [portal]);

  const resend = () => start(async () => {
    const res = await resendConfirmation({ login: unconfirmed });
    if (!res.ok) return setError({ text: res.error });
    setError(null);
    setResent(true);
  });

  if (resetting) {
    return (
      <PasswordReset
        initialLogin={login}
        onCancel={() => setResetting(false)}
        onDone={(email) => { setResetting(false); setResetDone(true); setError(null); if (!login) setLogin(email); }}
      />
    );
  }
  return (
    <>
      <AuthTitle>{title}</AuthTitle>
      {resetDone && <Alert tone="info" className="mb-4"><b>Your password is changed.</b> Log in with your new password.</Alert>}
      {notice === 'confirmed' && <Alert tone="info" className="mb-4"><b>Your email is confirmed.</b> Log in to get started.</Alert>}
      {notice === 'idle' && <Alert tone="info" className="mb-4">You were logged out after 10 minutes without activity, to keep your account safe. Please log in again.</Alert>}
      {notice === 'confirmation-failed' && (
        <Alert tone="warn" className="mb-4">
          <b>That confirmation link has expired or was already used.</b> If you already confirmed, just log in. Otherwise, log in below and we&apos;ll offer to send a new link.
        </Alert>
      )}
      <ErrorText error={error?.text ?? null} />
      {error?.portal && (
        <Link href={LOGIN_PATH[error.portal]} className="mb-4 block text-center text-sm font-semibold">Go to the {PORTAL_NAMES[error.portal]} log-in →</Link>
      )}
      {unconfirmed && !error && resent && <Alert tone="info" className="my-3">We sent a new confirmation link. Check your email.</Alert>}
      {unconfirmed && !resent && (
        <Button block variant="ghost" className="mb-4" disabled={pending} onClick={resend}>Resend confirmation email</Button>
      )}
      <form
        ref={formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          start(async () => {
            const res = await signIn({ login: form.get('login'), password: form.get('password'), portal });
            if (!res.ok) {
              setUnconfirmed(/confirm your email/i.test(res.error) ? String(form.get('login') ?? '') : null);
              setResent(false);
              const other = res.code?.startsWith('portal:') ? (res.code.slice(7) as Portal) : undefined;
              return setError({ text: res.error, portal: other });
            }
            markActive();
            writeRemembered(portal, remember ? String(form.get('login') ?? '').trim() : null);
            if (remember && formRef.current) await savePassword(formRef.current);
            router.replace(next ?? res.data.next);
            router.refresh();
          });
        }}
      >
        <Field label="Email or user name" htmlFor="login">
          <Input id="login" name="login" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} required />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
          <Checkbox checked={remember} onChange={(e) => setRemember(e.target.checked)} label="Remember me" />
          <button type="button" className="text-sm font-semibold text-primary hover:underline" onClick={() => setResetting(true)}>Forgot password?</button>
        </div>
        <Button block type="submit" disabled={pending}>{pending ? 'Please wait…' : 'Log in'}</Button>
      </form>
      {remember && <p className="mt-2 mb-0 text-center text-xs text-muted">Your browser may offer to save your password. Only use this on your own device.</p>}
      {footer}
    </>
  );
}
