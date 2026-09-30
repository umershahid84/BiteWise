'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn } from '@/app/actions/auth';
import { ErrorText } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';

export function LoginForm({ next }: { next: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <ErrorText error={error} />
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          start(async () => {
            const res = await signIn({ login: form.get('login'), password: form.get('password') });
            if (!res.ok) return setError(res.error);
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
        New to Rescue Bites? <Link href="/signup">Create a free account</Link>
      </p>
    </>
  );
}
