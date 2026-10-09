'use client';

import { useState, useTransition } from 'react';
import { forgotPassword, resetPasswordWithCode } from '@/app/actions/auth';
import { Alert, ErrorText } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { AuthTitle } from './auth-card';

// Forgot password: 1) the email address, 2) the 6-digit code from the email with the new password typed twice.
export function PasswordReset({ initialLogin, onDone, onCancel }: { initialLogin: string; onDone: (login: string) => void; onCancel: () => void }) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [login, setLogin] = useState(initialLogin.includes('@') ? initialLogin : '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [pending, start] = useTransition();

  const send = () => start(async () => {
    const res = await forgotPassword({ login });
    if (!res.ok) return setError(res.error);
    setError(null);
    setLocked(false);
    setCode('');
    setNotice(`If an account uses ${login}, we've emailed it a 6-digit code. It can take a minute to arrive; check your spam folder too.`);
    setStep('code');
  });
  const reset = () => start(async () => {
    const res = await resetPasswordWithCode({ login, code, password, confirm });
    if (!res.ok) {
      setLocked(res.code === 'reset_locked');
      return setError(res.error);
    }
    onDone(login);
  });

  return (
    <>
      <AuthTitle>Reset your password</AuthTitle>
      {step === 'email' ? (
        <form noValidate onSubmit={(e) => { e.preventDefault(); send(); }}>
          <p className="mt-0 mb-4 text-center text-sm text-muted">Enter the email address of your account. We&apos;ll email you a 6-digit code.</p>
          <ErrorText error={error} />
          <Field label="Email address" htmlFor="reset-email">
            <Input id="reset-email" type="email" autoComplete="email" value={login} onChange={(e) => setLogin(e.target.value)} required autoFocus />
          </Field>
          <Button block type="submit" disabled={pending || !login.trim()}>{pending ? 'Sending…' : 'Email me a code'}</Button>
        </form>
      ) : (
        <form noValidate onSubmit={(e) => { e.preventDefault(); reset(); }}>
          {notice && <Alert tone="info" className="mb-4">{notice}</Alert>}
          <ErrorText error={error} />
          <Field label="6-digit code" htmlFor="reset-code">
            <Input
              id="reset-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus
              className="text-center font-mono text-2xl tracking-[0.5em]" value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="••••••"
            />
          </Field>
          <Field label="New password" htmlFor="reset-password" hint="At least 8 characters, with a letter and a number.">
            <Input id="reset-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="Re-enter new password" htmlFor="reset-confirm">
            <Input id="reset-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          {confirm && password !== confirm && <p className="-mt-2 mb-3 text-sm text-danger">The two passwords don&apos;t match.</p>}
          <Button block type="submit" disabled={pending || locked || code.length !== 6 || !password || password !== confirm}>
            {pending ? 'Please wait…' : 'Set new password'}
          </Button>
          <Button block variant="ghost" className="mt-2" disabled={pending} onClick={send}>Send a new code</Button>
        </form>
      )}
      <p className="mt-4 text-center text-sm text-muted"><button type="button" className="font-semibold text-primary hover:underline" onClick={onCancel}>Back to log in</button></p>
    </>
  );
}
