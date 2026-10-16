'use client';

import { useEffect, useImperativeHandle, useState } from 'react';
import { CardElement, Elements, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { Field, Input } from '@/components/ui/field';
import { formatPostalInput, normalizePostal, type Country } from '@/lib/regions';

// Card entry. With Stripe, card numbers go straight from the browser to Stripe (Stripe Elements)
// and never reach ResDish. In mock mode (no Stripe keys), only brand, last 4 digits and expiry
// leave the browser.

// One per country: US cards are saved with the US Stripe account (US dollars), Canadian ones with the Canadian
// account (Canadian dollars). 'off': that country's Stripe account isn't set up yet.
export type PaymentConfig = { country: Country; mode: 'stripe' | 'mock' | 'off'; publishableKey: string };
export type PaymentConfigs = { US: PaymentConfig; CA: PaymentConfig };
export const PAYMENTS_OFF = 'Card payments for this country aren\'t available yet. Please try again later.';

export type CardEntryHandle = {
  // A Stripe PaymentMethod id (pm_...) or, in mock mode, { brand, last4, expMonth, expYear }.
  getToken(): Promise<unknown>;
  // Completes 3-D Secure for an order.
  handleAction(clientSecret: string): Promise<void>;
  // Saves the card to the customer (SetupIntent). Returns the token to store.
  confirmSetup(clientSecret: string | null): Promise<unknown>;
};

const stripes = new Map<string, Promise<Stripe | null>>();
const getStripe = (key: string) => {
  if (!stripes.has(key)) stripes.set(key, loadStripe(key));
  return stripes.get(key)!;
};

function PaymentsOff({ ref }: { ref: React.Ref<CardEntryHandle> }) {
  const fail = async (): Promise<never> => { throw new Error(PAYMENTS_OFF); };
  useImperativeHandle(ref, () => ({ getToken: fail, handleAction: fail, confirmSetup: fail }));
  return <div className="rounded-xl border border-dashed border-line px-3 py-2 text-sm text-muted">{PAYMENTS_OFF}</div>;
}

// The card's billing ZIP or postal code. Stripe's own box asks for a 5-digit "ZIP" whenever the card is a US one (all
// the common test cards are), so for Canadian purchases we ask for the postal code ourselves (a US ZIP still works,
// for visitors paying with a US card).
function PostalField({ country, value, onChange }: { country: Country; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={country === 'CA' ? 'Postal code' : 'ZIP code'} htmlFor="cc-zip">
      <Input
        id="cc-zip" autoComplete="postal-code" inputMode={country === 'CA' ? 'text' : 'numeric'} maxLength={country === 'CA' ? 7 : 10}
        placeholder={country === 'CA' ? 'A1H 0G5' : '98101'} className={country === 'CA' ? 'uppercase' : undefined} value={value}
        onChange={(e) => onChange(/\d{3}/.test(e.target.value) ? e.target.value : formatPostalInput(country, e.target.value))}
      />
    </Field>
  );
}
const billingPostal = (country: Country, v: string) => {
  const ok = normalizePostal(country, v) ?? (country === 'CA' ? normalizePostal('US', v) : null);
  if (!ok) throw new Error(country === 'CA' ? 'Please enter your card\'s postal code, like A1H 0G5.' : 'Please enter your card\'s 5-digit ZIP code.');
  return ok;
};

function luhn(num: string) {
  let sum = 0;
  for (let i = 0; i < num.length; i++) {
    let d = Number(num[num.length - 1 - i]);
    if (i % 2) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function brandOf(num: string) {
  if (/^4/.test(num)) return 'visa';
  if (/^(5[1-5]|2[2-7])/.test(num)) return 'mastercard';
  if (/^3[47]/.test(num)) return 'amex';
  if (/^6(011|5)/.test(num)) return 'discover';
  return 'card';
}

function MockCardEntry({ country, ref }: { country: Country; ref: React.Ref<CardEntryHandle> }) {
  const [num, setNum] = useState('');
  const [postal, setPostal] = useState('');
  const [exp, setExp] = useState('');
  const [cvc, setCvc] = useState('');
  const token = () => {
    const digits = num.replace(/\D/g, '');
    if (digits.length < 13 || !luhn(digits)) throw new Error('Please enter a valid card number.');
    const [mm, yy] = exp.split('/').map((s) => Number(s.trim()));
    if (!(mm >= 1 && mm <= 12) || !(yy >= 0)) throw new Error('Please enter the expiry as MM / YY.');
    if (!/^\d{3,4}$/.test(cvc.trim())) throw new Error('Please enter the CVC.');
    billingPostal(country, postal);
    return { brand: brandOf(digits), last4: digits.slice(-4), expMonth: mm, expYear: 2000 + yy };
  };
  useImperativeHandle(ref, () => ({
    getToken: async () => token(),
    handleAction: async () => {},
    confirmSetup: async () => token(),
  }));
  return (
    <div>
      <Field label="Card number" htmlFor="cc-num">
        <Input
          id="cc-num" inputMode="numeric" autoComplete="cc-number" placeholder="1234 1234 1234 1234" maxLength={23} value={num}
          onChange={(e) => setNum(e.target.value.replace(/\D/g, '').slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 '))}
        />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Expiry" htmlFor="cc-exp">
          <Input
            id="cc-exp" inputMode="numeric" autoComplete="cc-exp" placeholder="MM / YY" maxLength={7} value={exp}
            onChange={(e) => {
              const d = e.target.value.replace(/\D/g, '').slice(0, 4);
              setExp(d.length > 2 ? `${d.slice(0, 2)} / ${d.slice(2)}` : d);
            }}
          />
        </Field>
        <Field label="CVC" htmlFor="cc-cvc">
          <Input id="cc-cvc" inputMode="numeric" autoComplete="cc-csc" placeholder="123" maxLength={4} value={cvc} onChange={(e) => setCvc(e.target.value)} />
        </Field>
        <PostalField country={country} value={postal} onChange={setPostal} />
      </div>
      <div className="rounded-xl border border-dashed border-line px-3 py-2 text-xs text-muted">
        🧪 <b>Test mode</b>: no real charges. Use <code>4242 4242 4242 4242</code>, any future date and any CVC.{' '}
        <code>4000 0000 0000 0002</code> simulates a decline.
      </div>
    </div>
  );
}

function StripeFields({ country, ref }: { country: Country; ref: React.Ref<CardEntryHandle> }) {
  const stripe = useStripe();
  const elements = useElements();
  const [postal, setPostal] = useState('');
  // Canada: our own postal code box instead of Stripe's "ZIP" one.
  const ownPostal = country === 'CA';
  const billing = () => (ownPostal ? { billing_details: { address: { postal_code: billingPostal(country, postal) } } } : {});
  const card = () => {
    const el = elements?.getElement(CardElement);
    if (!stripe || !el) throw new Error('The secure card form is still loading. Try again in a moment.');
    return { stripe, el };
  };
  useImperativeHandle(ref, () => ({
    async getToken() {
      const { stripe: s, el } = card();
      const { paymentMethod, error } = await s.createPaymentMethod({ type: 'card', card: el, ...billing() });
      if (error) throw new Error(error.message);
      return paymentMethod.id;
    },
    async handleAction(clientSecret) {
      const { stripe: s } = card();
      const { error } = await s.handleNextAction({ clientSecret });
      if (error) throw new Error(error.message);
    },
    async confirmSetup(clientSecret) {
      const { stripe: s, el } = card();
      const { setupIntent, error } = await s.confirmCardSetup(clientSecret ?? '', { payment_method: { card: el, ...billing() } });
      if (error) throw new Error(error.message);
      return setupIntent.payment_method;
    },
  }));
  const colors = useThemeColors();
  return (
    <div>
      <div className="rounded-field border border-line bg-bg-2 px-3.5 py-3.5">
        <CardElement options={{ hidePostalCode: ownPostal, style: { base: { fontSize: '16px', color: colors.ink, iconColor: colors.muted, '::placeholder': { color: colors.muted } }, invalid: { color: colors.danger } } }} />
      </div>
      {ownPostal && <div className="mt-3"><PostalField country={country} value={postal} onChange={setPostal} /></div>}
      <div className="mt-2 text-xs text-muted">🔒 Card details are sent securely to Stripe and never stored on ResDish servers.</div>
    </div>
  );
}

// Stripe's card field lives in its own frame and can't see our styles, so it gets the current theme's text colors,
// updated when the look or light/dark mode changes.
function useThemeColors() {
  const read = () => {
    if (typeof document === 'undefined') return { ink: '#1c1917', muted: '#78716c', danger: '#dc2626' };
    const css = getComputedStyle(document.documentElement);
    const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    return { ink: v('--color-ink', '#1c1917'), muted: v('--color-muted', '#78716c'), danger: v('--color-danger', '#dc2626') };
  };
  const [colors, setColors] = useState(read);
  useEffect(() => {
    const update = () => setColors(read());
    update();
    const watch = new MutationObserver(update);
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode', 'data-theme'] });
    return () => watch.disconnect();
  }, []);
  return colors;
}

export function CardEntry({ config, ref }: { config: PaymentConfig; ref: React.Ref<CardEntryHandle> }) {
  if (config.mode === 'mock') return <MockCardEntry country={config.country} ref={ref} />;
  if (config.mode === 'off') return <PaymentsOff ref={ref} />;
  return (
    <Elements key={config.publishableKey} stripe={getStripe(config.publishableKey)} options={{ locale: config.country === 'CA' ? 'en-CA' : 'en' }}>
      <StripeFields country={config.country} ref={ref} />
    </Elements>
  );
}

export const cardText = (c: { brand: string; last4: string }) => `${c.brand[0].toUpperCase()}${c.brand.slice(1)} •••• ${c.last4}`;
