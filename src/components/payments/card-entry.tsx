'use client';

import { useImperativeHandle, useState } from 'react';
import { CardElement, Elements, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { Field, Input } from '@/components/ui/field';

// Card entry. With Stripe, card numbers go straight from the browser to Stripe (Stripe Elements)
// and never reach Bite Wise. In mock mode (no Stripe keys), only brand, last 4 digits and expiry
// leave the browser.

export type PaymentConfig = { mode: 'stripe' | 'mock'; publishableKey: string };

export type CardEntryHandle = {
  // A Stripe PaymentMethod id (pm_...) or, in mock mode, { brand, last4, expMonth, expYear }.
  getToken(): Promise<unknown>;
  // Completes 3-D Secure for an order.
  handleAction(clientSecret: string): Promise<void>;
  // Saves the card to the customer (SetupIntent). Returns the token to store.
  confirmSetup(clientSecret: string | null): Promise<unknown>;
};

let stripePromise: Promise<Stripe | null> | null = null;
const getStripe = (key: string) => (stripePromise ??= loadStripe(key));

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

function MockCardEntry({ ref }: { ref: React.Ref<CardEntryHandle> }) {
  const [num, setNum] = useState('');
  const [exp, setExp] = useState('');
  const [cvc, setCvc] = useState('');
  const token = () => {
    const digits = num.replace(/\D/g, '');
    if (digits.length < 13 || !luhn(digits)) throw new Error('Please enter a valid card number.');
    const [mm, yy] = exp.split('/').map((s) => Number(s.trim()));
    if (!(mm >= 1 && mm <= 12) || !(yy >= 0)) throw new Error('Please enter the expiry as MM / YY.');
    if (!/^\d{3,4}$/.test(cvc.trim())) throw new Error('Please enter the CVC.');
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
        <Field label="ZIP" htmlFor="cc-zip"><Input id="cc-zip" inputMode="numeric" autoComplete="postal-code" placeholder="98101" maxLength={10} /></Field>
      </div>
      <div className="rounded-xl border border-dashed border-line px-3 py-2 text-xs text-muted">
        🧪 <b>Test mode</b>: no real charges. Use <code>4242 4242 4242 4242</code>, any future date and any CVC.{' '}
        <code>4000 0000 0000 0002</code> simulates a decline.
      </div>
    </div>
  );
}

function StripeFields({ ref }: { ref: React.Ref<CardEntryHandle> }) {
  const stripe = useStripe();
  const elements = useElements();
  const card = () => {
    const el = elements?.getElement(CardElement);
    if (!stripe || !el) throw new Error('The secure card form is still loading. Try again in a moment.');
    return { stripe, el };
  };
  useImperativeHandle(ref, () => ({
    async getToken() {
      const { stripe: s, el } = card();
      const { paymentMethod, error } = await s.createPaymentMethod({ type: 'card', card: el });
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
      const { setupIntent, error } = await s.confirmCardSetup(clientSecret ?? '', { payment_method: { card: el } });
      if (error) throw new Error(error.message);
      return setupIntent.payment_method;
    },
  }));
  return (
    <div>
      <div className="rounded-field border border-line bg-bg-2 px-3.5 py-3.5">
        <CardElement options={{ style: { base: { fontSize: '16px', color: '#ecfdf5', '::placeholder': { color: '#86998f' } } } }} />
      </div>
      <div className="mt-2 text-xs text-muted">🔒 Card details are sent securely to Stripe and never stored on Bite Wise servers.</div>
    </div>
  );
}

export function CardEntry({ config, ref }: { config: PaymentConfig; ref: React.Ref<CardEntryHandle> }) {
  if (config.mode === 'mock') return <MockCardEntry ref={ref} />;
  return (
    <Elements stripe={getStripe(config.publishableKey)}>
      <StripeFields ref={ref} />
    </Elements>
  );
}

export const cardText = (c: { brand: string; last4: string }) => `${c.brand[0].toUpperCase()}${c.brand.slice(1)} •••• ${c.last4}`;
