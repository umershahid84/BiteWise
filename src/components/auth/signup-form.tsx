'use client';

import { useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signUp, validateSignup } from '@/app/actions/auth';
import { AgreementDialog } from '@/components/app/agreement-dialog';
import { markActive } from '@/components/app/idle-logout';
import { Alert, ErrorText } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PhoneInput } from '@/components/ui/phone-input';
import { StateSelect } from '@/components/ui/state-select';
import { Field, Input } from '@/components/ui/field';
import { SectionLabel } from '@/components/ui/misc';
import { AuthTitle } from './auth-card';
import { CheckEmail } from './check-email';
import { LOGIN_PATH, SIGNUP_PATH } from '@/lib/constants';

type Role = 'customer' | 'restaurant';

// Customers sign up at /signup and restaurants at /restaurant/signup.
export function SignupForm({ role }: { role: Role }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<React.ReactNode>(null);
  const [agreementOpen, setAgreementOpen] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const values = () => {
    const f = new FormData(formRef.current!);
    const get = (k: string) => String(f.get(k) ?? '');
    return {
      role,
      email: get('email'),
      username: get('username'),
      password: get('password'),
      restaurant: role === 'restaurant'
        ? { name: get('r-name'), address: get('r-address'), city: get('r-city'), state: get('r-state'), zip: get('r-zip'), phone: get('r-phone'), cuisine: get('r-cuisine') }
        : undefined,
    };
  };

  // 1) Check the details first, so any problem is shown before the agreement.
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    start(async () => {
      const res = await validateSignup(values());
      if (!res.ok) return setError(res.error);
      setError(null);
      setAgreementOpen(true);
    });
  };

  // 2) Accept creates the account together with the acceptance record; decline creates nothing.
  const onAgreement = (accepted: Record<string, string> | null) => {
    if (!accepted) {
      setAgreementOpen(false);
      setNotice(
        <Alert tone="warn" className="mb-4">
          <b>No account was created.</b> You declined the terms. You can review them any time (
          <a href={`/legal/${role === 'restaurant' ? 'restaurant-agreement' : 'customer-terms'}`} target="_blank" rel="noopener">
            {role === 'restaurant' ? 'Partner Agreement' : 'Terms'}
          </a>
          , <a href="/legal/privacy" target="_blank" rel="noopener">Privacy Policy</a>) and sign up when you&apos;re ready.
        </Alert>,
      );
      return;
    }
    start(async () => {
      const res = await signUp({ ...values(), acceptedTerms: accepted });
      setAgreementOpen(false);
      if (!res.ok) return setError(res.error);
      if (res.data.needsConfirmation) {
        setSentTo(values().email.trim());
        return;
      }
      markActive();
      router.replace(res.data.next);
      router.refresh();
    });
  };

  if (sentTo) return <CheckEmail email={sentTo} loginPath={LOGIN_PATH.main} />;

  return (
    <>
      <AuthTitle>{role === 'restaurant' ? 'Join Bite Wise' : 'Create your free account'}</AuthTitle>
      {role === 'restaurant' && <p className="-mt-3 mb-5 text-center text-sm text-muted">Sell your surplus food to customers nearby, instead of throwing it away.</p>}
      {notice}
      <ErrorText error={error} />
      <form ref={formRef} onSubmit={onSubmit} noValidate>
        <Field label="Email" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
        <Field label="User name" htmlFor="username" hint="3–24 characters: letters, numbers, dots or underscores.">
          <Input id="username" name="username" autoComplete="username" required />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 8 characters, with a letter and a number.">
          <Input id="password" name="password" type="password" autoComplete="new-password" required />
        </Field>
        {role === 'restaurant' && (
          <>
            <SectionLabel>Restaurant details</SectionLabel>
            <Field label="Restaurant name" htmlFor="r-name"><Input id="r-name" name="r-name" /></Field>
            <Field label="Street address" htmlFor="r-address"><Input id="r-address" name="r-address" autoComplete="street-address" /></Field>
            <Field label="City" htmlFor="r-city"><Input id="r-city" name="r-city" autoComplete="address-level2" placeholder="City" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="State" htmlFor="r-state"><StateSelect id="r-state" name="r-state" defaultValue="" /></Field>
              <Field label="ZIP code" htmlFor="r-zip"><Input id="r-zip" name="r-zip" autoComplete="postal-code" inputMode="numeric" /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Phone" htmlFor="r-phone"><PhoneInput id="r-phone" name="r-phone" /></Field>
              <Field label="Cuisine" htmlFor="r-cuisine"><Input id="r-cuisine" name="r-cuisine" placeholder="e.g. Thai" /></Field>
            </div>
            <p className="mb-4 text-sm text-muted">Your sales tax rate is set automatically from your address. You can fine-tune your map pin in the portal after signing up.</p>
          </>
        )}
        <p className="mb-3 text-sm text-muted">Next, you&apos;ll be asked to review and accept our terms. Your account is created only if you accept.</p>
        <Button block type="submit" disabled={pending}>
          {pending ? 'Please wait…' : role === 'restaurant' ? 'Create restaurant account' : 'Create account'}
        </Button>
      </form>
      <div className="mt-4 grid gap-1 text-center text-sm text-muted">
        <p className="m-0">Already have an account? <Link href={LOGIN_PATH.main}>Log in</Link></p>
        <p className="m-0">
          {role === 'restaurant'
            ? <>Looking for food? <Link href={SIGNUP_PATH.customer}>Sign up as a customer</Link></>
            : <>Own a restaurant? <Link href={SIGNUP_PATH.restaurant}>Join as a restaurant partner</Link></>}
        </p>
      </div>
      <AgreementDialog
        open={agreementOpen}
        role={role}
        title={role === 'restaurant' ? 'Restaurant Partner Agreement' : 'Terms of Service'}
        intro="Please read and accept these terms to create your Bite Wise account. If you decline, no account will be created."
        acceptLabel="Accept & create account"
        busy={pending}
        onResult={onAgreement}
      />
    </>
  );
}
