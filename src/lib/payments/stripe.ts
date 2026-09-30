import Stripe from 'stripe';
import { PaymentError, type ConnectStatus, type PaymentProvider } from './types';

// Stripe processor. Card numbers are collected by Stripe.js in the browser and never reach our
// servers. Orders use PaymentIntents with capture_method=manual: the card is authorized at checkout
// and captured when the restaurant verifies the pickup PIN.
// `api` points the client at another Stripe-compatible host (tests use stripe-mock).
export function createStripeProvider(secretKey: string, api?: { host: string; port: number; protocol: 'http' | 'https' }): PaymentProvider {
  const stripe = new Stripe(secretKey, { appInfo: { name: 'Rescue Bites' }, ...api });

  const wrap = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Stripe.errors.StripeCardError) throw new PaymentError(err.message);
      throw err;
    }
  };

  const describe = (pm: Stripe.PaymentMethod) => ({
    ref: pm.id,
    brand: pm.card?.brand ?? 'card',
    last4: pm.card?.last4 ?? '0000',
    expMonth: pm.card?.exp_month ?? 1,
    expYear: pm.card?.exp_year ?? 2000,
  });

  return {
    mode: 'stripe',

    async ensureCustomer({ email, username, existingId }) {
      if (existingId) return existingId;
      const customer = await stripe.customers.create({ email, name: username, metadata: { app: 'rescuebites' } });
      return customer.id;
    },

    async createSetupIntent(customerId) {
      const intent = await stripe.setupIntents.create({ customer: customerId, payment_method_types: ['card'], usage: 'off_session' });
      return { clientSecret: intent.client_secret };
    },

    async resolvePaymentMethod({ customerId, token, save }) {
      if (typeof token !== 'string' || !token.startsWith('pm_')) throw new PaymentError('Invalid card reference.');
      return wrap(async () => {
        let pm = await stripe.paymentMethods.retrieve(token);
        if (pm.customer && pm.customer !== customerId) throw new PaymentError('Invalid card reference.');
        if (save && !pm.customer) pm = await stripe.paymentMethods.attach(token, { customer: customerId });
        return describe(pm);
      });
    },

    async detach(ref) {
      await stripe.paymentMethods.detach(ref).catch(() => {});
    },

    async authorize({ amountCents, customerId, paymentRef, attached, description, metadata, destinationAccount, idempotencyKey }) {
      return wrap(async () => {
        const intent = await stripe.paymentIntents.create(
          {
            amount: amountCents,
            currency: 'usd',
            capture_method: 'manual',
            payment_method_types: ['card'],
            customer: attached && customerId ? customerId : undefined,
            payment_method: paymentRef,
            confirm: true,
            description,
            metadata,
            // Destination charge: Stripe moves the restaurant's share to its Connect account at capture.
            transfer_data: destinationAccount ? { destination: destinationAccount } : undefined,
          },
          { idempotencyKey },
        );
        if (intent.status === 'requires_capture') return { ref: intent.id, status: 'authorized' as const };
        if (intent.status === 'requires_action') {
          return { ref: intent.id, status: 'requires_action' as const, clientSecret: intent.client_secret ?? undefined };
        }
        throw new PaymentError('Your card could not be authorized.');
      });
    },

    async authorizationStatus(ref) {
      const intent = await stripe.paymentIntents.retrieve(ref);
      if (intent.status === 'requires_capture') return 'authorized';
      if (intent.status === 'requires_action') return 'requires_action';
      return 'failed';
    },

    async capture(ref, { applicationFeeCents, idempotencyKey }) {
      const intent = await wrap(() =>
        stripe.paymentIntents.capture(
          ref,
          { application_fee_amount: applicationFeeCents ?? undefined, expand: ['latest_charge'] },
          { idempotencyKey },
        ),
      );
      const charge = intent.latest_charge as Stripe.Charge | null;
      const transfer = charge?.transfer;
      return { chargeId: charge?.id ?? null, transferId: typeof transfer === 'string' ? transfer : (transfer?.id ?? null) };
    },

    async refund(ref, amountCents, idempotencyKey) {
      const refund = await wrap(() => stripe.refunds.create({ payment_intent: ref, amount: amountCents }, { idempotencyKey }));
      return { id: refund.id };
    },

    async void(ref) {
      await stripe.paymentIntents.cancel(ref).catch(() => {});
    },

    // ---- Stripe Connect (Express accounts: Stripe hosts onboarding and the payout dashboard)

    async createConnectedAccount({ email, businessName, restaurantId }) {
      const account = await stripe.accounts.create({
        country: 'US',
        email,
        business_profile: { name: businessName, mcc: '5812', product_description: 'Surplus restaurant food sold through Rescue Bites' },
        capabilities: { transfers: { requested: true } },
        controller: {
          stripe_dashboard: { type: 'express' },
          fees: { payer: 'application' },
          losses: { payments: 'application' },
          requirement_collection: 'stripe',
        },
        metadata: { restaurant_id: String(restaurantId), app: 'rescuebites' },
      });
      return account.id;
    },

    async onboardingLink(accountId, { returnUrl, refreshUrl }) {
      const link = await stripe.accountLinks.create({
        account: accountId,
        type: 'account_onboarding',
        return_url: returnUrl,
        refresh_url: refreshUrl,
      });
      return link.url;
    },

    async dashboardLink(accountId) {
      try {
        return (await stripe.accounts.createLoginLink(accountId)).url;
      } catch {
        return null; // Only available once onboarding is complete.
      }
    },

    async accountStatus(accountId): Promise<ConnectStatus> {
      const account = await stripe.accounts.retrieve(accountId);
      let bankSummary = '';
      try {
        const ext = await stripe.accounts.listExternalAccounts(accountId, { limit: 1 });
        const bank = ext.data[0];
        if (bank?.object === 'bank_account') bankSummary = `${bank.bank_name ?? 'Bank'} ••••${bank.last4}`;
        else if (bank?.object === 'card') bankSummary = `${bank.brand} debit ••••${bank.last4}`;
      } catch {
        // Not readable until onboarding is complete.
      }
      return {
        chargesEnabled: account.capabilities?.transfers === 'active',
        payoutsEnabled: Boolean(account.payouts_enabled),
        detailsSubmitted: Boolean(account.details_submitted),
        bankSummary,
      };
    },

    async transfer({ accountId, amountCents, sourceChargeId, description, metadata, idempotencyKey }) {
      const transfer = await stripe.transfers.create(
        {
          amount: amountCents,
          currency: 'usd',
          destination: accountId,
          source_transaction: sourceChargeId ?? undefined,
          description,
          metadata,
        },
        { idempotencyKey },
      );
      return { id: transfer.id };
    },

    async reverseTransfer(transferId, amountCents, idempotencyKey) {
      const reversal = await stripe.transfers.createReversal(transferId, { amount: amountCents }, { idempotencyKey });
      return { id: reversal.id };
    },
  };
}

// Verifies a Stripe webhook signature and returns the event.
export function constructWebhookEvent(secretKey: string, payload: string, signature: string, webhookSecret: string) {
  return new Stripe(secretKey).webhooks.constructEvent(payload, signature, webhookSecret);
}
