// Stripe processor. Card numbers are collected by Stripe.js in the browser and never reach
// this server. Orders use PaymentIntents with capture_method=manual: the card is authorized
// at checkout and captured when the restaurant verifies the pickup PIN.
const Stripe = require('stripe');

module.exports = function createStripeProvider(config, PaymentError) {
  const stripe = new Stripe(config.stripeSecretKey);

  const wrap = async (fn) => {
    try {
      return await fn();
    } catch (err) {
      if (err?.type === 'StripeCardError') throw new PaymentError(err.message);
      throw err;
    }
  };

  const describe = (pm) => ({
    ref: pm.id,
    brand: pm.card?.brand || 'card',
    last4: pm.card?.last4 || '????',
    expMonth: pm.card?.exp_month || 0,
    expYear: pm.card?.exp_year || 0,
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

    async authorize({ amountCents, customerId, paymentRef, attached, description, metadata }) {
      return wrap(async () => {
        const intent = await stripe.paymentIntents.create({
          amount: amountCents,
          currency: 'usd',
          capture_method: 'manual',
          payment_method_types: ['card'],
          customer: attached ? customerId : undefined,
          payment_method: paymentRef,
          confirm: true,
          description,
          metadata,
        });
        if (intent.status === 'requires_capture') return { ref: intent.id, status: 'authorized' };
        if (intent.status === 'requires_action') return { ref: intent.id, status: 'requires_action', clientSecret: intent.client_secret };
        throw new PaymentError('Your card could not be authorized.');
      });
    },

    async authorizationStatus(ref) {
      const intent = await stripe.paymentIntents.retrieve(ref);
      if (intent.status === 'requires_capture') return 'authorized';
      if (intent.status === 'requires_action') return 'requires_action';
      return 'failed';
    },

    async capture(ref) {
      await wrap(() => stripe.paymentIntents.capture(ref));
    },

    async refund(ref, amountCents) {
      const refund = await wrap(() => stripe.refunds.create({ payment_intent: ref, amount: amountCents }));
      return { id: refund.id };
    },

    async void(ref) {
      await stripe.paymentIntents.cancel(ref).catch(() => {});
    },
  };
};
