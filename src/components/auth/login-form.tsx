'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { resendConfirmation, signIn } from '@/app/actions/auth';
import { Alert, ErrorText } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';

export function LoginForm({ next, notice }: { next: string | null; notice: 'confirmed' | 'confirmation-failed' | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState<string | null>(null); // the login that still needs its email confirmed
  const [resent, setResent] = useState(false);
  const [pending, start] = useTransition();
  const resend = () => start(async () => {
    const res = await resendConfirmation({ login: unconfirmed });
    if (!res.ok) return setError(res.error);
    setError(null);
    setResent(true);
  });
  return (
    <>
      {notice === 'confirmed' && <Alert tone="info" className="mb-4"><b>Your email is confirmed.</b> Log in to get started.</Alert>}
      {notice === 'confirmation-failed' && (
        <Alert tone="warn" className="mb-4">
          <b>That confirmation link has expired or was already used.</b> If you already confirmed, just log in. Otherwise, log in below and we&apos;ll offer to send a new link.
        </Alert>
      )}
      <ErrorText error={error} />
      {unconfirmed && !error && resent && <Alert tone="info" className="my-3">We sent a new confirmation link. Check your email.</Alert>}
      {unconfirmed && !resent && (
        <Button block variant="ghost" className="mb-4" disabled={pending} onClick={resend}>Resend confirmation email</Button>
      )}
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          start(async () => {
            const res = await signIn({ login: form.get('login'), password: form.get('password') });
            if (!res.ok) {
              setUnconfirmed(/confirm your email/i.test(res.error) ? String(form.get('login') ?? '') : null);
              setResent(false);
              return setError(res.error);
            }
            router.replace(next ?? res.data.next);
            router.refresh();
          });
        }}
      >
        <Field label="Email or user name" htmlFor="login">
          <Input id="login" name="login" autoComplete="username" required />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <Button block type="submit" disabled={pending}>{pending ? 'Please wait…' : 'Log in'}</Button>
      </form>
      <p className="mt-4 text-center text-sm text-muted">
        New to Bite Wise? <Link href="/signup">Create a free account</Link>
      </p>
    </>
  );
}
