// Starting a restaurant's Stripe payout setup: which Stripe errors mean "make a new account", and what the restaurant
// is told when Stripe refuses.
import { describe, expect, it } from 'vitest';
import { isMissingStripeAccount, stripeSetupMessage } from '@/lib/orders';

describe('Stripe payout setup errors', () => {
  it('recognizes an account Stripe no longer knows', () => {
    expect(isMissingStripeAccount({ code: 'resource_missing', message: "No such account: 'acct_123'" })).toBe(true);
    expect(isMissingStripeAccount({ code: 'account_invalid', message: 'x' })).toBe(true);
    expect(isMissingStripeAccount({ message: "The provided key 'sk_test_…' does not have access to account 'acct_123' (or that account does not exist)." })).toBe(true);
    expect(isMissingStripeAccount({ code: 'rate_limit', message: 'Too many requests' })).toBe(false);
    expect(isMissingStripeAccount(null)).toBe(false);
  });

  it('explains when ResDish has not finished turning on Stripe Connect', () => {
    expect(stripeSetupMessage({ message: "You can only create new accounts if you've signed up for Connect, which you can learn how to do at https://stripe.com/docs/connect." }))
      .toMatch(/still finishing its Stripe Connect setup\. .*\(Stripe says: You can only create new accounts if you've signed up for Connect/);
    expect(stripeSetupMessage({ message: 'Please review the responsibilities of managing losses for connected accounts at https://dashboard.stripe.com/settings/connect/platform-profile.' }))
      .toMatch(/still finishing its Stripe Connect setup/);
  });

  it("passes on Stripe's own reason otherwise", () => {
    expect(stripeSetupMessage({ message: 'Invalid email address: x' })).toBe("Stripe couldn't start your payout setup: Invalid email address: x Please try again, or contact ResDish support.");
    expect(stripeSetupMessage(new Error(''))).toBe("Stripe couldn't start your payout setup. Please try again, or contact ResDish support.");
  });
});
