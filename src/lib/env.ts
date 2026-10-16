// Runtime configuration. NEXT_PUBLIC_* values are also available in the browser.

const int = (v: string | undefined, d: number) => (v === undefined || v === '' ? d : Number.parseInt(v, 10));

export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  stripePublishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '',
  // The Canadian Stripe account (payments in Canadian dollars for restaurants in Canada).
  stripePublishableKeyCa: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_CA ?? '',
  map: {
    tileUrl: process.env.NEXT_PUBLIC_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution:
      process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ||
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    darkFilter: process.env.NEXT_PUBLIC_MAP_DARK_FILTER !== 'false',
  },
};

// Server-only settings. Never import this object into client components.
export const serverEnv = {
  supabaseSecretKey: process.env.SUPABASE_SECRET_KEY ?? '',
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  stripeSecretKeyCa: process.env.STRIPE_SECRET_KEY_CA ?? '',
  stripeWebhookSecretCa: process.env.STRIPE_WEBHOOK_SECRET_CA ?? '',
  cronSecret: process.env.CRON_SECRET ?? '',
  timeZone: process.env.TIME_ZONE || 'America/Los_Angeles',
  legal: {
    entity: process.env.LEGAL_ENTITY_NAME || 'ResDish',
    email: process.env.SUPPORT_EMAIL || 'support@bite-wise.org',
    address: process.env.LEGAL_ADDRESS || 'Federal Way, Washington',
    // Shown instead in the Canadian documents (Customer Terms, Partner Agreement and Privacy Policy for Canada).
    addressCa: process.env.LEGAL_ADDRESS_CA || "St. John's, Newfoundland and Labrador",
  },
  // Emails the app sends itself (restaurant application pending, welcome with the signed agreement). Use the same
  // SMTP account as Supabase Auth (e.g. Gmail with an app password). Without SMTP_HOST, emails are only logged.
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: int(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER ?? '',
    // Gmail shows app passwords in groups of four ("abcd efgh ijkl mnop"); the spaces aren't part of it.
    password: (process.env.SMTP_PASSWORD || process.env.SMTP_PASS || '').replace(/\s+/g, ''),
    from: process.env.EMAIL_FROM || (process.env.SMTP_USER ? `ResDish <${process.env.SMTP_USER}>` : 'ResDish <no-reply@bite-wise.org>'),
  },
  // Orders not picked up are released (never charged) this long after the discard timer ends.
  pickupGraceMinutes: int(process.env.PICKUP_GRACE_MINUTES, 10),
};

// Payments in each country use that country's Stripe account: the US account (STRIPE_SECRET_KEY,
// NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) charges in US dollars, the Canadian one (STRIPE_SECRET_KEY_CA,
// NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_CA) in Canadian dollars.
//   'stripe': the country's keys are set.
//   'mock':   no Stripe keys at all (development and demos): the built-in test processor, nothing is charged.
//   'off':    Stripe is set up for the other country only, so payments in this one aren't available yet.
export type PaymentMode = 'stripe' | 'mock' | 'off';
export function paymentMode(country: 'US' | 'CA' = 'US'): PaymentMode {
  const us = !!(serverEnv.stripeSecretKey && publicEnv.stripePublishableKey);
  const ca = !!(serverEnv.stripeSecretKeyCa && publicEnv.stripePublishableKeyCa);
  if (country === 'CA' ? ca : us) return 'stripe';
  return us || ca ? 'off' : 'mock';
}
// What the browser needs to collect cards for a country's Stripe account.
export const paymentConfig = (country: 'US' | 'CA' = 'US') => ({
  country,
  mode: paymentMode(country),
  publishableKey: country === 'CA' ? publicEnv.stripePublishableKeyCa : publicEnv.stripePublishableKey,
});
export const paymentConfigs = () => ({ US: paymentConfig('US'), CA: paymentConfig('CA') });
