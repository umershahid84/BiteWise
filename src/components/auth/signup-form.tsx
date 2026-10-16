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
import { CountrySelect, StateSelect } from '@/components/ui/state-select';
import { countryInfo, formatPostalInput, type Country } from '@/lib/regions';
import { Field, Input } from '@/components/ui/field';
import { PasswordInput } from '@/components/ui/password-input';
import { SectionLabel } from '@/components/ui/misc';
import { AuthTitle } from './auth-card';
import { CheckEmail } from './check-email';
import { LOGIN_PATH } from '@/lib/constants';
import { RoleSwitch, type Audience } from './role-switch';

type Role = Audience;

// One sign-up page with a "I'm a customer / I'm a restaurant" slider (/signup, /signup?role=restaurant or
// /restaurant/signup start on the matching side).
export function SignupForm({ initialRole }: { initialRole: Role }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [role, setRole] = useState<Role>(initialRole);
  // Where the customer lives, or where the restaurant is: decides the terms and the sales tax rules.
  const [country, setCountry] = useState<Country>('US');
  const c = countryInfo(country);
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
      country,
      region: role === 'restaurant' ? get('r-state') : get('region'),
      city: role === 'restaurant' ? get('r-city') : '',
      postal: role === 'restaurant' ? '' : get('postal'),
      restaurant: role === 'restaurant'
        ? { name: get('r-name'), address: get('r-address'), city: get('r-city'), state: get('r-state'), zip: get('r-zip'), country, phone: get('r-phone'), cuisine: get('r-cuisine') }
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
          <a href={`/legal/${role === 'restaurant' ? 'restaurant-agreement' : 'customer-terms'}${country === 'CA' ? '-ca' : ''}`} target="_blank" rel="noopener">
            {role === 'restaurant' ? 'Partner Agreement' : 'Terms'}
          </a>
          , <a href={`/legal/privacy${country === 'CA' ? '-ca' : ''}`} target="_blank" rel="noopener">Privacy Policy</a>) and sign up when you&apos;re ready.
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
      <AuthTitle>{role === 'restaurant' ? 'Join ResDish' : 'Create your free account'}</AuthTitle>
      <RoleSwitch value={role} onChange={(r) => { setRole(r); setError(null); }} labels={{ customer: 'I\'m a customer', restaurant: 'I\'m a restaurant' }} />
      {role === 'restaurant' && <p className="-mt-2 mb-5 text-center text-sm text-muted">Sell your surplus food to customers nearby, instead of throwing it away.</p>}
      {notice}
      <ErrorText error={error} />
      <form ref={formRef} onSubmit={onSubmit} noValidate>
        <Field label="Email" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
        <Field label="User name" htmlFor="username" hint="3–24 characters: letters, numbers, dots or underscores.">
          <Input id="username" name="username" autoComplete="username" required />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 8 characters, with a letter and a number.">
          <PasswordInput id="password" name="password" autoComplete="new-password" required />
        </Field>
        <Field label="Country" htmlFor="country" hint={role === 'restaurant' ? 'Where your restaurant is. It decides your agreement and sales tax.' : 'Where you live. It decides which terms apply to you.'}>
          <CountrySelect id="country" value={country} onChange={(e) => setCountry(e.target.value as Country)} />
        </Field>
        {role === 'customer' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label={c.regionLabel} htmlFor="region"><StateSelect key={country} id="region" name="region" country={country} defaultValue="" /></Field>
              <Field label={c.postalLabel} htmlFor="postal">
                <Input
                  key={country} id="postal" name="postal" autoComplete="postal-code" required
                  inputMode={country === 'US' ? 'numeric' : 'text'} maxLength={country === 'US' ? 10 : 7}
                  placeholder={country === 'US' ? '98101' : 'M5V 3L9'} className={country === 'CA' ? 'uppercase' : undefined}
                  onChange={(e) => { e.currentTarget.value = formatPostalInput(country, e.currentTarget.value); }}
                />
              </Field>
            </div>
            <p className="-mt-1 text-xs text-muted">
              {country === 'CA'
                ? 'Your own postal code, like M5V 3L9 (or just its first 3 characters).'
                : 'Your 5-digit ZIP code, like 98101.'}{' '}
              We show the deals closest to it first. You can change it any time in your account.
            </p>
          </>
        )}
        {role === 'restaurant' && (
          <>
            <SectionLabel>Restaurant details</SectionLabel>
            <Field label="Restaurant name" htmlFor="r-name"><Input id="r-name" name="r-name" /></Field>
            <Field label="Street address" htmlFor="r-address"><Input id="r-address" name="r-address" autoComplete="street-address" /></Field>
            <Field label="City" htmlFor="r-city"><Input id="r-city" name="r-city" autoComplete="address-level2" placeholder="City" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={c.regionLabel} htmlFor="r-state"><StateSelect key={country} id="r-state" name="r-state" country={country} defaultValue="" /></Field>
              <Field label={c.postalLabel} htmlFor="r-zip">
                <Input id="r-zip" name="r-zip" autoComplete="postal-code" inputMode={country === 'CA' ? 'text' : 'numeric'} placeholder={country === 'CA' ? 'M5V 3L9' : '98101'} className={country === 'CA' ? 'uppercase' : undefined}
                  maxLength={country === 'CA' ? 7 : 10} onChange={(e) => { e.currentTarget.value = formatPostalInput(country, e.currentTarget.value); }} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Phone" htmlFor="r-phone"><PhoneInput id="r-phone" name="r-phone" /></Field>
              <Field label="Cuisine" htmlFor="r-cuisine"><Input id="r-cuisine" name="r-cuisine" placeholder="e.g. Thai" /></Field>
            </div>
            <p className="mb-4 text-sm text-muted">Your sales tax rate is set automatically from your address. You can fine-tune your map pin in the portal after signing up.</p>
          </>
        )}
        <p className="mb-3 text-sm text-muted">Next, you&apos;ll be asked to review and accept our terms for {country === 'CA' ? 'Canada' : 'the United States'}. Your account is created only if you accept.</p>
        <Button block type="submit" disabled={pending}>
          {pending ? 'Please wait…' : role === 'restaurant' ? 'Create restaurant account' : 'Create account'}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-muted">Already have an account? <Link href={`${LOGIN_PATH.main}${role === 'restaurant' ? '?as=restaurant' : ''}`}>Log in</Link></p>
      <AgreementDialog
        open={agreementOpen}
        role={role}
        country={country}
        title={role === 'restaurant' ? 'Restaurant Partner Agreement' : 'Terms of Service'}
        intro="Please read and accept these terms to create your ResDish account. If you decline, no account will be created."
        acceptLabel="Accept & create account"
        busy={pending}
        onResult={onAgreement}
      />
    </>
  );
}
