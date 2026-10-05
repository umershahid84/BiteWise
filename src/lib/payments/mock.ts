import { randomBytes } from 'node:crypto';
import { PaymentError, type PaymentProvider } from './types';

// Development/demo processor. It never sees a full card number: the browser sends only brand,
// last 4 digits and expiry. Cards ending in 0002 are declined, like Stripe's test card. It keeps no
// state, so it survives server restarts and hot reloads. Connect onboarding completes instantly.
const id = (prefix: string) => `${prefix}_mock_${randomBytes(8).toString('hex')}`;

export function createMockProvider(): PaymentProvider {
  return {
    mode: 'mock',

    async ensureCustomer({ existingId }) {
      return existingId || id('cus');
    },

    async createSetupIntent() {
      return { clientSecret: null };
    },

    async resolvePaymentMethod({ token }) {
      const t = (token ?? {}) as Record<string, unknown>;
      const brand = String(t.brand ?? '').slice(0, 20);
      const last4 = String(t.last4 ?? '');
      const expMonth = Number(t.expMonth);
      const expYear = Number(t.expYear);
      if (!/^\d{4}$/.test(last4) || !brand || !(expMonth >= 1 && expMonth <= 12) || !(expYear >= 2000)) {
        throw new PaymentError('Card details are incomplete.');
      }
      const now = new Date();
      if (expYear < now.getFullYear() || (expYear === now.getFullYear() && expMonth < now.getMonth() + 1)) {
        throw new PaymentError('This card has expired.');
      }
      return { ref: `${id('pm')}_${last4}`, brand, last4, expMonth, expYear };
    },

    async detach() {},

    async authorize({ paymentRef }) {
      if (paymentRef.endsWith('_0002')) throw new PaymentError('Your card was declined.');
      return { ref: id('pi'), status: 'authorized' };
    },

    async authorizationStatus(ref) {
      return ref.startsWith('pi_mock_') ? 'authorized' : 'failed';
    },

    async capture(_ref, { applicationFeeCents }) {
      return { chargeId: id('ch'), transferId: applicationFeeCents === null ? null : id('tr') };
    },

    async refund() {
      return { id: id('re') };
    },

    async charge({ paymentRef }) {
      if (paymentRef.endsWith('_0002')) throw new PaymentError('Your card was declined.');
      return { id: id('pi') };
    },

    async void() {},

    async createConnectedAccount({ restaurantId }) {
      return `acct_mock_${String(restaurantId).padStart(6, '0')}`;
    },

    // No real onboarding: the link goes straight back to the portal, where the account shows as ready.
    async onboardingLink(_accountId, { returnUrl }) {
      return returnUrl;
    },

    async dashboardLink() {
      return null;
    },

    async accountStatus() {
      return { chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, bankSummary: 'MOCK BANK ••••6789' };
    },

    async transfer() {
      return { id: id('tr') };
    },

    async reverseTransfer() {
      return { id: id('trr') };
    },
  };
}
