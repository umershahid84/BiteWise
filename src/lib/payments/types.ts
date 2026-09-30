// Payment processing. Cards are authorized (a hold is placed) when the customer orders and
// captured (actually charged) when the restaurant confirms pickup with the PIN.
//
// Restaurants are paid through Stripe Connect (Express accounts):
//   * When the restaurant's account can receive transfers at checkout, the card is authorized as a
//     *destination charge* (transfer_data.destination). At capture, Rescue Bites keeps a platform
//     application fee (service fee + sales tax Rescue Bites remits) and Stripe transfers the rest.
//   * Otherwise the charge stays on the platform and the restaurant's share is sent later with a
//     separate transfer (automatically at pickup if they have connected by then, or from the admin console).
//   * Platform credit is funded by Rescue Bites, so when credit covers part of the food, Rescue Bites tops
//     up the restaurant with a separate transfer from its own balance.

export class PaymentError extends Error {
  status = 402;
}

export type CardInfo = { ref: string; brand: string; last4: string; expMonth: number; expYear: number };

export type AuthorizeResult = { ref: string; status: 'authorized' | 'requires_action'; clientSecret?: string };

export type ConnectStatus = {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  bankSummary: string;
};

export interface PaymentProvider {
  mode: 'stripe' | 'mock';

  ensureCustomer(p: { email: string; username: string; existingId?: string | null }): Promise<string>;
  createSetupIntent(customerId: string): Promise<{ clientSecret: string | null }>;
  // token: a Stripe PaymentMethod id (pm_...) or, in mock mode, { brand, last4, expMonth, expYear }.
  resolvePaymentMethod(p: { customerId: string; token: unknown; save: boolean }): Promise<CardInfo>;
  detach(ref: string): Promise<void>;

  authorize(p: {
    amountCents: number;
    customerId: string | null;
    paymentRef: string;
    attached: boolean;
    description: string;
    metadata: Record<string, string>;
    destinationAccount: string | null;
    idempotencyKey: string;
  }): Promise<AuthorizeResult>;
  authorizationStatus(ref: string): Promise<'authorized' | 'requires_action' | 'failed'>;
  // Captures the hold. applicationFeeCents applies to destination charges only.
  // Returns the charge and (for destination charges) the automatic transfer to the restaurant.
  capture(ref: string, p: { applicationFeeCents: number | null; idempotencyKey: string }): Promise<{ chargeId: string | null; transferId: string | null }>;
  refund(ref: string, amountCents: number, idempotencyKey: string): Promise<{ id: string }>;
  void(ref: string): Promise<void>;

  // Stripe Connect
  createConnectedAccount(p: { email: string; businessName: string; restaurantId: number }): Promise<string>;
  onboardingLink(accountId: string, p: { returnUrl: string; refreshUrl: string }): Promise<string>;
  dashboardLink(accountId: string): Promise<string | null>;
  accountStatus(accountId: string): Promise<ConnectStatus>;
  transfer(p: {
    accountId: string;
    amountCents: number;
    sourceChargeId: string | null;
    description: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<{ id: string }>;
  reverseTransfer(transferId: string, amountCents: number, idempotencyKey: string): Promise<{ id: string }>;
}
