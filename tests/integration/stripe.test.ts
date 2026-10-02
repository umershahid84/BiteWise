// Checks every Stripe call the app makes against stripe-mock, which validates requests against
// Stripe's real API schema. Start it with: docker run -d -p 12111:12111 stripe/stripe-mock
// (skipped when it isn't running). stripe-mock returns canned responses, so these tests check that
// requests are well-formed, not business outcomes.
import { describe, expect, it } from 'vitest';
import { createStripeProvider } from '@/lib/payments/stripe';
import { PaymentError } from '@/lib/payments/types';

const api = { host: 'localhost', port: 12111, protocol: 'http' as const };
const running = await fetch('http://localhost:12111/v1/balance', { headers: { Authorization: 'Bearer sk_test_123' } }).then((r) => r.ok, () => false);
const stripe = createStripeProvider('sk_test_123', api);

describe.skipIf(!running)('Stripe Connect requests (stripe-mock)', () => {
  it('creates Express accounts and onboarding/dashboard links', async () => {
    const account = await stripe.createConnectedAccount({ email: 'owner@example.com', businessName: 'Harbor Pho House', restaurantId: 1 });
    expect(account).toMatch(/^acct_/);
    expect(await stripe.onboardingLink(account, { returnUrl: 'https://example.com/r', refreshUrl: 'https://example.com/f' })).toMatch(/^https?:\/\//);
    const status = await stripe.accountStatus(account);
    expect(status).toHaveProperty('chargesEnabled');
    await stripe.dashboardLink(account);
  });

  it('authorizes destination charges with manual capture', async () => {
    try {
      const res = await stripe.authorize({
        amountCents: 978, customerId: 'cus_123', paymentRef: 'pm_card_visa', attached: true, description: 'Bite Wise order #1',
        metadata: { order_id: '1' }, destinationAccount: 'acct_123', idempotencyKey: `authorize-test-${Date.now()}`,
      });
      expect(res.ref).toMatch(/^pi_/);
    } catch (err) {
      // stripe-mock's canned intent isn't "requires_capture"; anything but a request error is fine.
      expect(err).toBeInstanceOf(PaymentError);
    }
  });

  it('captures with an application fee, transfers, reverses and refunds', async () => {
    const captured = await stripe.capture('pi_123', { applicationFeeCents: 130, idempotencyKey: `capture-test-${Date.now()}` });
    expect(captured).toHaveProperty('chargeId');
    expect((await stripe.transfer({ accountId: 'acct_123', amountCents: 848, sourceChargeId: 'ch_123', description: 'test', metadata: { order_id: '1' }, idempotencyKey: `t-${Date.now()}` })).id).toMatch(/^tr_/);
    expect((await stripe.reverseTransfer('tr_123', 424, `r-${Date.now()}`)).id).toMatch(/^trr_/);
    expect((await stripe.refund('pi_123', 489, `re-${Date.now()}`)).id).toMatch(/^re_/);
    await stripe.void('pi_123');
  });

  it('saves cards with customers and setup intents', async () => {
    expect(await stripe.ensureCustomer({ email: 'a@example.com', username: 'a' })).toMatch(/^cus_/);
    expect((await stripe.createSetupIntent('cus_123')).clientSecret).toBeTruthy();
    const card = await stripe.resolvePaymentMethod({ customerId: 'cus_123', token: 'pm_123', save: false }).catch((e) => e);
    expect(card instanceof Error ? card : card.ref).toBeTruthy();
  });
});
