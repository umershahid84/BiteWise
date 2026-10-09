'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { resendConfirmation } from '@/app/actions/auth';
import { Alert, ErrorText } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { AuthTitle } from './auth-card';

const WAIT_SECONDS = 60; // Supabase allows one confirmation email a minute per address

// Shown after sign-up when the account still needs its email confirmed.
export function CheckEmail({ email, loginPath = '/login' }: { email: string; loginPath?: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [wait, setWait] = useState(WAIT_SECONDS);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const resend = () => start(async () => {
    setError(null);
    setSent(false);
    const res = await resendConfirmation({ login: email });
    if (!res.ok) return setError(res.error);
    setSent(true);
    setWait(WAIT_SECONDS);
  });

  return (
    <div className="text-center">
      <AuthTitle>Check your email</AuthTitle>
      <p className="mt-0 mb-2 text-ink-2">We sent you a link to confirm your address and finish creating your account.</p>
      <p className="mt-0 mb-6 text-sm text-muted">Sent to <b className="text-ink">{email}</b>. It can take a minute to arrive; check your spam folder too.</p>
      {sent && <Alert tone="info" className="mb-4 text-left">We sent the link again.</Alert>}
      <ErrorText error={error} />
      <div className="grid gap-2.5">
        <Button block variant="ghost" disabled={pending || wait > 0} onClick={resend}>
          {pending ? 'Sending…' : wait > 0 ? `Resend confirmation email (${wait}s)` : 'Resend confirmation email'}
        </Button>
        <Link href={loginPath} className={buttonVariants({ block: true })}>Back to login</Link>
      </div>
    </div>
  );
}
