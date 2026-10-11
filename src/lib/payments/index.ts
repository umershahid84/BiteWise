import 'server-only';
import { paymentMode, serverEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import type { Country } from '@/lib/regions';
import { createMockProvider } from './mock';
import { createStripeProvider } from './stripe';
import type { PaymentProvider } from './types';

export { PaymentError } from './types';
export type { PaymentProvider } from './types';

const providers = new Map<Country, PaymentProvider>();

// The payment processor for a country: its Stripe account (US dollars in the United States, Canadian dollars in
// Canada), or the mock processor when no Stripe keys are set. Throws when Stripe is only set up for the other country.
export function payments(country: Country = 'US'): PaymentProvider {
  const mode = paymentMode(country);
  if (mode === 'off') {
    throw new AppError(503, country === 'CA'
      ? 'Payments in Canada aren\'t set up yet (the Canadian Stripe account is missing). Please try again later.'
      : 'Payments in the United States aren\'t set up yet. Please try again later.');
  }
  let p = providers.get(country);
  if (!p) {
    const currency = country === 'CA' ? 'cad' : 'usd';
    p = mode === 'stripe'
      ? createStripeProvider(country === 'CA' ? serverEnv.stripeSecretKeyCa : serverEnv.stripeSecretKey, undefined, { country, currency })
      : createMockProvider(currency);
    providers.set(country, p);
  }
  return p;
}

// Orders, payouts and plan payments record their currency; this is the country whose Stripe account handled them.
export const countryOfCurrency = (currency: string | null | undefined): Country => (currency === 'cad' ? 'CA' : 'US');
