import 'server-only';
import type { Database } from '@/lib/database.types';
import { AppError, check, maybe, must } from '@/lib/errors';
import { payments, PaymentError } from '@/lib/payments';
import { restaurantShareOfRefund, type Quote } from '@/lib/pricing';
import { supabaseAdmin } from '@/lib/supabase/admin';

// Order lifecycle and money movement. Database functions do the atomic bookkeeping (see
// supabase/migrations/*_functions.sql); this module talks to the payment provider around them.

type Order = Database['public']['Tables']['orders']['Row'];

const cardLabel = (c: { brand: string; last4: string }) => `${c.brand.toUpperCase()} •••• ${c.last4}`;
const db = () => supabaseAdmin();

export async function getOrder(id: number): Promise<Order> {
  const order = maybe(await db().from('orders').select('*').eq('id', id).maybeSingle());
  if (!order) throw new AppError(404, 'Order not found.');
  return order;
}

// ---------------------------------------------------------------- restaurant Connect accounts

async function paymentAccount(restaurantId: number) {
  return maybe(await db().from('restaurant_payment_accounts').select('*').eq('restaurant_id', restaurantId).maybeSingle());
}

// A restaurant can receive transfers once its Stripe Connect account is active.
async function transferAccount(restaurantId: number): Promise<{ id: string; bank: string } | null> {
  const acct = await paymentAccount(restaurantId);
  return acct?.stripe_account_id && acct.charges_enabled ? { id: acct.stripe_account_id, bank: acct.bank_summary } : null;
}

const bankDetails = (acct: { id: string; bank: string }) =>
  `Stripe Connect ${acct.id}${acct.bank ? ` · ${acct.bank}` : ''}`;

// ---------------------------------------------------------------- checkout

async function ensureCustomer(userId: string) {
  const profile = must(await db().from('profiles').select('email, username, stripe_customer_id').eq('id', userId).single());
  if (profile.stripe_customer_id) return profile.stripe_customer_id;
  const id = await payments().ensureCustomer({ email: profile.email, username: profile.username });
  check(await db().from('profiles').update({ stripe_customer_id: id }).eq('id', userId));
  return id;
}

export async function saveCard(userId: string, card: { ref: string; brand: string; last4: string; expMonth: number; expYear: number }, makeDefault: boolean) {
  const existing = must(await db().from('payment_methods').select('id').eq('user_id', userId).limit(1));
  const isDefault = makeDefault || existing.length === 0;
  if (isDefault) check(await db().from('payment_methods').update({ is_default: false }).eq('user_id', userId));
  return must(
    await db().from('payment_methods').insert({
      user_id: userId, provider_ref: card.ref, brand: card.brand, last4: card.last4,
      exp_month: card.expMonth, exp_year: card.expYear, is_default: isDefault,
    }).select('id, brand, last4, exp_month, exp_year, is_default').single(),
  );
}

export async function addCard(userId: string, token: unknown, makeDefault: boolean) {
  const customerId = await ensureCustomer(userId);
  const card = await payments().resolvePaymentMethod({ customerId, token, save: true });
  return saveCard(userId, card, makeDefault);
}

export async function removeCard(userId: string, cardId: number) {
  const card = maybe(await db().from('payment_methods').select('*').eq('id', cardId).eq('user_id', userId).maybeSingle());
  if (!card) throw new AppError(404, 'Card not found.');
  // An existing hold stays capturable after the card is removed, so open orders don't block this.
  await payments().detach(card.provider_ref);
  check(await db().from('payment_methods').delete().eq('id', card.id));
  if (card.is_default) {
    const next = must(await db().from('payment_methods').select('id').eq('user_id', userId).order('created_at', { ascending: false }).limit(1));
    if (next[0]) check(await db().from('payment_methods').update({ is_default: true }).eq('id', next[0].id));
  }
}

export async function setDefaultCard(userId: string, cardId: number) {
  const card = maybe(await db().from('payment_methods').select('id').eq('id', cardId).eq('user_id', userId).maybeSingle());
  if (!card) throw new AppError(404, 'Card not found.');
  check(await db().from('payment_methods').update({ is_default: false }).eq('user_id', userId));
  check(await db().from('payment_methods').update({ is_default: true }).eq('id', card.id));
}

export async function quoteOffer(offerId: number, quantity: number): Promise<Quote> {
  return must(await db().rpc('quote_offer', { p_offer_id: offerId, p_quantity: quantity })) as unknown as Quote;
}

export type CheckoutInput = {
  offerId: number;
  quantity: number;
  creditCents: number;
  cardId?: number | null;
  newCard?: { token: unknown; save: boolean } | null;
};

// Places an order: reserves the food, then places a hold on the card for whatever platform credit
// doesn't cover. Returns requiresAction + clientSecret when the card needs 3-D Secure.
export async function checkout(userId: string, input: CheckoutInput) {
  const q = await quoteOffer(input.offerId, input.quantity); // validates before touching the card
  if (!Number.isInteger(input.creditCents) || input.creditCents < 0 || input.creditCents > q.totalCents) {
    throw new AppError(400, 'Invalid credit amount.');
  }
  const needsCard = q.totalCents - input.creditCents > 0;

  let paymentRef: string | null = null;
  let label: string | null = null;
  let attached = false;
  let customerId: string | null = null;
  if (needsCard && input.cardId) {
    const card = maybe(await db().from('payment_methods').select('*').eq('id', input.cardId).eq('user_id', userId).maybeSingle());
    if (!card) throw new AppError(400, 'Please choose a card.');
    paymentRef = card.provider_ref;
    label = cardLabel(card);
    attached = true;
    customerId = await ensureCustomer(userId);
  } else if (needsCard && input.newCard?.token) {
    customerId = await ensureCustomer(userId);
    const card = await payments().resolvePaymentMethod({ customerId, token: input.newCard.token, save: input.newCard.save });
    if (input.newCard.save) await saveCard(userId, card, false);
    paymentRef = card.ref;
    label = cardLabel(card);
    attached = input.newCard.save;
  } else if (needsCard) {
    throw new AppError(400, 'Please choose a card.');
  }

  const order = must(
    await db().rpc('reserve_order', {
      p_user: userId, p_offer_id: input.offerId, p_quantity: input.quantity,
      p_card_label: label ?? '', p_credit_cents: input.creditCents,
    }),
  );

  const cardCents = order.total_cents - order.credit_applied_cents;
  if (cardCents === 0) {
    // Paid entirely with platform credit: nothing to authorize.
    check(await db().rpc('mark_order_reserved', { p_order_id: order.id }));
    return { orderId: order.id, requiresAction: false as const };
  }

  const destination = await transferAccount(order.restaurant_id);
  let result;
  try {
    result = await payments().authorize({
      amountCents: cardCents,
      customerId,
      paymentRef: paymentRef!,
      attached,
      description: `Bite Wise order #${order.id}: ${order.quantity} x ${order.item_title}`,
      metadata: { order_id: String(order.id), restaurant_id: String(order.restaurant_id) },
      destinationAccount: destination?.id ?? null,
      idempotencyKey: `authorize-${order.id}`,
    });
  } catch (err) {
    await db().rpc('release_order', { p_order_id: order.id, p_from: 'pending_payment', p_to: 'failed', p_restock: true });
    if (err instanceof PaymentError) throw new AppError(402, err.message);
    throw err;
  }
  check(await db().rpc('set_order_payment', { p_order_id: order.id, p_payment_ref: result.ref, p_destination: destination?.id ?? '' }));
  if (result.status === 'authorized') check(await db().rpc('mark_order_reserved', { p_order_id: order.id }));
  return result.status === 'requires_action'
    ? { orderId: order.id, requiresAction: true as const, clientSecret: result.clientSecret ?? '' }
    : { orderId: order.id, requiresAction: false as const };
}

// Called after the browser completes 3-D Secure.
export async function confirmAuthorization(userId: string, orderId: number) {
  const order = await getOrder(orderId);
  if (order.user_id !== userId) throw new AppError(404, 'Order not found.');
  if (order.status !== 'pending_payment' || !order.payment_ref) return order.status;
  const status = await payments().authorizationStatus(order.payment_ref);
  if (status === 'authorized') check(await db().rpc('mark_order_reserved', { p_order_id: order.id }));
  else if (status === 'failed') {
    await release(order.id, 'pending_payment', 'failed', true);
    throw new AppError(402, 'Your card could not be authorized.');
  }
  return (await getOrder(orderId)).status;
}

// ---------------------------------------------------------------- releasing orders

// Voids the card hold of an order that was released in the database.
async function voidHold(orderId: number, paymentRef: string | null | undefined) {
  if (paymentRef) await payments().void(paymentRef);
  await db().rpc('clear_void', { p_order_id: orderId });
}

// After an order was released by a database function called as the user (e.g. my_cancel_order).
export async function voidIfNeeded(orderId: number) {
  const o = await getOrder(orderId);
  if (o.needs_void) await voidHold(o.id, o.payment_ref);
}

export async function release(orderId: number, from: Order['status'], to: 'cancelled' | 'expired' | 'failed', restock: boolean) {
  const res = must(await db().rpc('release_order', { p_order_id: orderId, p_from: from, p_to: to, p_restock: restock })) as {
    changed: boolean;
    paymentRef?: string | null;
  };
  if (res.changed) await voidHold(orderId, res.paymentRef);
  return res.changed;
}

// Every minute: the database sweep releases stale orders; then card holds are voided here.
export async function sweep() {
  const counts = must(await db().rpc('sweep'));
  const pending = must(await db().from('orders').select('id, payment_ref').eq('needs_void', true).limit(200));
  for (const o of pending) await voidHold(o.id, o.payment_ref);
  return { ...(counts as object), voided: pending.length };
}

// ---------------------------------------------------------------- pickup

// Restaurant confirms pickup with the customer's PIN: the card is charged now and the restaurant
// is paid its food subtotal through Stripe Connect.
export async function completePickup(claimed: { id: number; paymentRef: string | null; destinationAccount: string | null }) {
  const order = await getOrder(claimed.id);
  const cardCents = order.total_cents - order.credit_applied_cents;
  const share = order.subtotal_cents;
  const destination = claimed.destinationAccount || null;
  let charge: { chargeId: string | null; transferId: string | null } = { chargeId: null, transferId: null };

  if (claimed.paymentRef) {
    try {
      // Destination charge: Bite Wise keeps the service fee and sales tax; Stripe sends the rest.
      const applicationFee = destination ? Math.max(0, cardCents - share) : null;
      charge = await payments().capture(claimed.paymentRef, { applicationFeeCents: applicationFee, idempotencyKey: `capture-${order.id}` });
    } catch (err) {
      await db().rpc('abort_pickup', { p_order_id: order.id });
      if (err instanceof PaymentError) throw new AppError(402, `The card could not be charged: ${err.message}`);
      throw err;
    }
  }
  const done = must(await db().rpc('finish_pickup', { p_order_id: order.id }));

  // Pay the restaurant. Failures here never undo the pickup: the amount stays owed and shows in
  // the admin console's Payouts tab.
  try {
    if (destination && charge.transferId) {
      const sent = Math.min(cardCents, share);
      must(await db().rpc('record_payout', {
        p_restaurant_id: order.restaurant_id, p_order_id: order.id, p_kind: 'transfer', p_amount_cents: sent,
        p_transaction_id: charge.transferId, p_bank_details: bankDetails({ id: destination, bank: (await paymentAccount(order.restaurant_id))?.bank_summary ?? '' }),
        p_note: `Order #${order.id} (destination charge)`, p_by: null as unknown as string,
      }));
      // Platform credit paid part of the food: Bite Wise tops up the restaurant from its own balance.
      if (share > sent) await sendTransfer(order.restaurant_id, share - sent, null, `Order #${order.id} (platform credit top-up)`, order.id, `topup-${order.id}`);
    } else if (await transferAccount(order.restaurant_id)) {
      await sendTransfer(order.restaurant_id, share, cardCents >= share ? charge.chargeId : null, `Order #${order.id}`, order.id, `transfer-${order.id}`);
    }
  } catch (err) {
    console.error(`Payout for order ${order.id} failed; it stays owed.`, err);
  }
  return done;
}

async function sendTransfer(restaurantId: number, amountCents: number, sourceChargeId: string | null, note: string, orderId: number | null, key: string, by: string | null = null) {
  const acct = await transferAccount(restaurantId);
  if (!acct) throw new AppError(409, 'This restaurant has not finished setting up Stripe payouts yet.');
  const t = await payments().transfer({
    accountId: acct.id, amountCents, sourceChargeId, description: `Bite Wise payout: ${note}`,
    metadata: { restaurant_id: String(restaurantId), ...(orderId ? { order_id: String(orderId) } : {}) }, idempotencyKey: key,
  });
  return must(await db().rpc('record_payout', {
    p_restaurant_id: restaurantId, p_order_id: orderId as number, p_kind: 'transfer', p_amount_cents: amountCents,
    p_transaction_id: t.id, p_bank_details: bankDetails(acct), p_note: note, p_by: by as string,
  }));
}

// Admin: pays a restaurant what it is owed (e.g. orders completed before it connected Stripe),
// or records a payout made outside Stripe.
export async function payRestaurant(restaurantId: number, amountCents: number, adminId: string, note: string, manual: boolean) {
  if (!manual) {
    return sendTransfer(restaurantId, amountCents, null, note || 'Balance payout', null, `payout-${restaurantId}-${Date.now()}`, adminId);
  }
  return must(await db().rpc('record_payout', {
    p_restaurant_id: restaurantId, p_order_id: null as unknown as number, p_kind: 'manual', p_amount_cents: amountCents,
    p_transaction_id: '', p_bank_details: 'Paid outside Stripe (recorded by Bite Wise)', p_note: note, p_by: adminId,
  }));
}

// ---------------------------------------------------------------- refunds

// Refunds a completed order, either to the ORIGINAL payment (card first, then any platform credit
// the customer used; the restaurant and Bite Wise give up their shares) or as PLATFORM CREDIT
// (funded by Bite Wise; the restaurant keeps its money).
export async function refundOrder(orderId: number, p: { amountCents: number; method: 'original' | 'credit'; reason: string; adminId: string }) {
  const o = await getOrder(orderId);
  if (o.status !== 'picked_up') throw new AppError(409, 'Only completed (charged) orders can be refunded. Cancel open orders instead.');
  const refundable = o.total_cents - o.refunded_cents - o.credited_cents;
  if (refundable <= 0) throw new AppError(409, 'This order has already been fully refunded.');
  if (p.amountCents < 1 || p.amountCents > refundable) throw new AppError(400, `The refund can be at most $${(refundable / 100).toFixed(2)}.`);

  let cardCents = 0;
  let creditCents = 0;
  let restaurantShare = 0;
  let providerRef: string | null = null;
  const refundNo = must(await db().from('refunds').select('id', { count: 'exact', head: false }).eq('order_id', o.id)).length + 1;

  if (p.method === 'credit') {
    creditCents = p.amountCents;
  } else {
    const cardRefundable = o.payment_ref ? o.total_cents - o.credit_applied_cents - o.card_refunded_cents : 0;
    cardCents = Math.min(p.amountCents, cardRefundable);
    creditCents = p.amountCents - cardCents; // back to the credit balance they paid with
    restaurantShare = restaurantShareOfRefund(p.amountCents, o.subtotal_cents, o.total_cents);
    if (cardCents > 0) providerRef = (await payments().refund(o.payment_ref!, cardCents, `refund-${o.id}-${refundNo}`)).id;
  }

  const updated = must(await db().rpc('apply_refund', {
    p_order_id: o.id, p_amount_cents: p.amountCents, p_method: p.method, p_card_cents: cardCents, p_credit_cents: creditCents,
    p_restaurant_share_cents: restaurantShare, p_reason: p.reason, p_provider_ref: providerRef ?? '', p_by: p.adminId,
  }));

  // Take the restaurant's share back from the transfers made for this order.
  if (restaurantShare > 0) await reverseOrderTransfers(o.id, o.restaurant_id, restaurantShare, `refund-${o.id}-${refundNo}`, p.adminId);
  return { order: updated, cardCents, creditCents };
}

async function reverseOrderTransfers(orderId: number, restaurantId: number, amountCents: number, key: string, adminId: string) {
  const rows = must(await db().from('payouts').select('*').eq('order_id', orderId).order('id'));
  const reversed = rows.filter((r) => r.kind === 'reversal').reduce((n, r) => n - r.amount_cents, 0);
  let left = amountCents;
  let alreadyReversed = reversed;
  for (const t of rows.filter((r) => r.kind === 'transfer' && r.transaction_id.startsWith('tr_'))) {
    // Skip what earlier refunds already took back from this transfer.
    const available = Math.max(0, t.amount_cents - alreadyReversed);
    alreadyReversed = Math.max(0, alreadyReversed - t.amount_cents);
    const take = Math.min(left, available);
    if (take <= 0) continue;
    try {
      const rev = await payments().reverseTransfer(t.transaction_id, take, `${key}-${t.id}`);
      must(await db().rpc('record_payout', {
        p_restaurant_id: restaurantId, p_order_id: orderId, p_kind: 'reversal', p_amount_cents: -take,
        p_transaction_id: rev.id, p_bank_details: t.bank_details, p_note: `Refund on order #${orderId}`, p_by: adminId,
      }));
      left -= take;
    } catch (err) {
      // Not enough balance on the connected account: the amount stays owed by the restaurant.
      console.error(`Transfer reversal for order ${orderId} failed`, err);
    }
    if (left <= 0) break;
  }
}

// ---------------------------------------------------------------- Connect onboarding

export async function refreshConnectStatus(restaurantId: number) {
  const acct = await paymentAccount(restaurantId);
  if (!acct?.stripe_account_id) return acct;
  const s = await payments().accountStatus(acct.stripe_account_id);
  return must(
    await db().from('restaurant_payment_accounts').update({
      charges_enabled: s.chargesEnabled, payouts_enabled: s.payoutsEnabled, details_submitted: s.detailsSubmitted,
      bank_summary: s.bankSummary, updated_at: new Date().toISOString(),
    }).eq('restaurant_id', restaurantId).select('*').single(),
  );
}

export async function connectOnboardingLink(restaurantId: number, email: string, businessName: string, siteUrl: string) {
  let acct = await paymentAccount(restaurantId);
  if (!acct) acct = must(await db().from('restaurant_payment_accounts').insert({ restaurant_id: restaurantId }).select('*').single());
  let accountId = acct.stripe_account_id;
  if (!accountId) {
    accountId = await payments().createConnectedAccount({ email, businessName, restaurantId });
    check(await db().from('restaurant_payment_accounts').update({ stripe_account_id: accountId }).eq('restaurant_id', restaurantId));
  }
  return payments().onboardingLink(accountId, {
    returnUrl: `${siteUrl}/restaurant?tab=payouts&stripe=return`,
    refreshUrl: `${siteUrl}/restaurant?tab=payouts&stripe=refresh`,
  });
}
