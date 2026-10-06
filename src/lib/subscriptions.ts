import 'server-only';
import type { Database } from '@/lib/database.types';
import { sendEmail } from '@/lib/email/send';
import { paymentFailedEmail, renewalReminderEmail, subscriptionReceiptEmail } from '@/lib/email/templates';
import { publicEnv } from '@/lib/env';
import { AppError, check, maybe, must } from '@/lib/errors';
import { planPrice, priceContext } from '@/lib/fee-changes';
import * as orders from '@/lib/orders';
import { PaymentError, payments } from '@/lib/payments';
import { supabaseAdmin } from '@/lib/supabase/admin';

// Restaurant subscriptions (supabase/migrations/20261006000200_bans_and_subscriptions.sql, 20261007000100_delinquent_plans.sql).
//   * Pioneer Members: the first `founding_spots` (50) restaurants to choose a plan get it free (choosePlan): a monthly
//     or annual plan with a pioneer number (founding_number) and no card. Every period they get a $0.00 invoice that
//     shows the plan price and the Pioneer Members Discount (renewDue renews them).
//   * Paid plans: monthly or annual, charged in advance. Prices are settings the admin can change at any time; a new
//     price applies to new plans and from each plan's next renewal.
//   * Cards on file: restaurant owners keep cards in payment_methods (like customers). Auto-renewal charges the
//     default card. renewDue() charges the renewals and is run by the scheduled jobs (src/lib/jobs.ts).
//   * A declined payment makes the plan delinquent (status past_due) at once: the restaurant can't post and its live
//     offers are paused until a payment succeeds. The default card is retried daily for 7 days; the restaurant (or an
//     admin) can pay at any time with payNow(). The new period starts when the payment succeeds.

export type Subscription = Database['public']['Tables']['restaurant_subscriptions']['Row'];
export type PaidPlan = 'monthly' | 'annual';
const RETRY_DAYS = 7;
export const PIONEER_DISCOUNT = 'Pioneer Members Discount';
export const isPioneer = (sub: Pick<Subscription, 'founding_number'> | null | undefined) => sub?.founding_number != null;
const DAY = 86_400_000;

const db = () => supabaseAdmin();
const planUrl = () => `${publicEnv.siteUrl}/restaurant?tab=plan`;

export async function prices() {
  const rows = must(await db().from('settings').select('key, value')
    .in('key', ['subscription_monthly_cents', 'subscription_annual_cents', 'founding_spots', 'renewal_reminder_days_annual', 'renewal_reminder_days_monthly']));
  const get = (key: string, fallback: number) => Number(rows.find((r) => r.key === key)?.value ?? fallback);
  const { count } = await db().from('restaurant_subscriptions').select('restaurant_id', { count: 'exact', head: true }).not('founding_number', 'is', null);
  const foundingSpots = get('founding_spots', 50);
  return {
    monthlyCents: get('subscription_monthly_cents', 1500),
    annualCents: get('subscription_annual_cents', 15000),
    foundingSpots,
    foundingTaken: count ?? 0,
    foundingLeft: Math.max(0, foundingSpots - (count ?? 0)),
    // How many days before a renewal the reminder email goes out.
    reminderDaysAnnual: get('renewal_reminder_days_annual', 30),
    reminderDaysMonthly: get('renewal_reminder_days_monthly', 7),
  };
}
export const priceOf = (p: Awaited<ReturnType<typeof prices>>, plan: PaidPlan) => (plan === 'annual' ? p.annualCents : p.monthlyCents);

// One month or one year later. Month ends stay month ends (Jan 31 -> Feb 28), instead of spilling into the next month.
export function addPeriod(start: Date, plan: PaidPlan) {
  const d = new Date(start);
  const months = plan === 'annual' ? 12 : 1;
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

export async function getSubscription(restaurantId: number) {
  return maybe(await db().from('restaurant_subscriptions').select('*').eq('restaurant_id', restaurantId).maybeSingle());
}

async function ownerOf(restaurantId: number) {
  const r = must(await db().from('restaurants').select('id, name, owner_id, profiles!restaurants_owner_id_fkey(id, email, username, stripe_customer_id)').eq('id', restaurantId).single());
  return { restaurant: r, owner: r.profiles! };
}

type Card = { id: number; brand: string; last4: string; exp_month: number; exp_year: number; is_default: boolean; provider_ref: string };
const label = (c: Pick<Card, 'brand' | 'last4'>) => `${c.brand.toUpperCase()} •••• ${c.last4}`;

export async function cardsOf(userId: string) {
  return must(await db().from('payment_methods').select('id, brand, last4, exp_month, exp_year, is_default, provider_ref').eq('user_id', userId)
    .order('is_default', { ascending: false }).order('created_at', { ascending: false })) as Card[];
}

// What the restaurant's Plan tab shows.
export async function planSummary(restaurantId: number) {
  const { owner } = await ownerOf(restaurantId);
  const [sub, p, history, ok, cards, ctx] = await Promise.all([
    getSubscription(restaurantId),
    prices(),
    db().from('subscription_payments').select('*').eq('restaurant_id', restaurantId).order('created_at', { ascending: false }).limit(24),
    db().rpc('restaurant_plan_ok', { p_restaurant_id: restaurantId }),
    cardsOf(owner.id),
    priceContext(),
  ]);
  const pioneer = isPioneer(sub);
  const nextPlan = sub && sub.plan !== 'founding' && !pioneer ? ((sub.renew_plan ?? sub.plan) as PaidPlan) : null;
  return {
    prices: p,
    canPost: Boolean(ok.data),
    cards: cards.map((c) => ({ id: c.id, brand: c.brand, last4: c.last4, expMonth: c.exp_month, expYear: c.exp_year, isDefault: c.is_default })),
    subscription: sub && {
      plan: sub.plan, renewPlan: sub.renew_plan, status: sub.status, foundingNumber: sub.founding_number, pioneer, autoRenew: sub.auto_renew,
      priceCents: sub.price_cents, periodStart: sub.current_period_start, periodEnd: sub.current_period_end, cardLabel: sub.card_label,
      lastPaymentError: sub.last_payment_error,
      // What the next payment will cost: a renewal on its date, or a delinquent plan paid now. Includes a locked
      // (grandfathered) price and a scheduled fee change.
      nextAmountCents: nextPlan
        ? planPrice(ctx, sub, nextPlan, sub.status === 'past_due' ? new Date() : new Date(sub.current_period_end ?? Date.now()))
        : 0,
      grandfathered: !!(sub.locked_monthly_cents || sub.locked_annual_cents),
      // What a Pioneer Member's plan would cost without the discount.
      listPriceCents: pioneer ? priceOf(p, (sub.renew_plan ?? sub.plan) as PaidPlan) : 0,
    },
    // A scheduled fee change, so the Plan tab can tell restaurants about it.
    upcomingChange: ctx.pending && {
      effectiveAt: ctx.pending.effective_at, monthlyCents: ctx.pending.monthly_cents, annualCents: ctx.pending.annual_cents,
      appliesToExisting: ctx.pending.applies_to_existing,
    },
    payments: must(history).map((x) => ({
      id: x.id, plan: x.plan, amountCents: x.amount_cents, status: x.status, invoiceNumber: x.invoice_number, cardLabel: x.card_label,
      periodEnd: x.period_end, error: x.error, createdAt: x.created_at,
      listPriceCents: x.list_price_cents, discountCents: x.discount_cents, discountLabel: x.discount_label,
    })),
  };
}
export type PlanSummary = Awaited<ReturnType<typeof planSummary>>;

// ---------------------------------------------------------------- cards on file

// Saves a card to the owner's cards on file. With Stripe the card was confirmed in the browser with a SetupIntent.
export async function addCard(restaurantId: number, token: unknown, makeDefault: boolean) {
  const { owner } = await ownerOf(restaurantId);
  try {
    return await orders.addCard(owner.id, token, makeDefault);
  } catch (err) {
    if (err instanceof PaymentError) throw new AppError(402, err.message);
    throw err;
  }
}

export async function setDefaultCard(restaurantId: number, cardId: number) {
  const { owner } = await ownerOf(restaurantId);
  await orders.setDefaultCard(owner.id, cardId);
}

// An auto-renewing paid plan needs a card on file, so its last card can't be removed.
export async function removeCard(restaurantId: number, cardId: number) {
  const { owner } = await ownerOf(restaurantId);
  const [sub, cards] = await Promise.all([getSubscription(restaurantId), cardsOf(owner.id)]);
  const renewing = sub && sub.plan !== 'founding' && !isPioneer(sub) && sub.status !== 'expired' && sub.auto_renew;
  if (renewing && cards.length <= 1 && cards.some((c) => c.id === cardId)) {
    throw new AppError(409, 'Your plan renews automatically with this card. Add another card first, or turn off auto-renewal.');
  }
  await orders.removeCard(owner.id, cardId);
}

// The card to charge: the one asked for, or the default card on file.
async function chargeCard(ownerId: string, cardId?: number | null) {
  const cards = await cardsOf(ownerId);
  const card = cardId ? cards.find((c) => c.id === cardId) : (cards.find((c) => c.is_default) ?? cards[0]);
  if (cardId && !card) throw new AppError(404, 'Card not found.');
  return card ?? null;
}

async function customerRef(owner: { id: string; email: string; username: string; stripe_customer_id: string | null }) {
  const id = await payments().ensureCustomer({ email: owner.email, username: owner.username, existingId: owner.stripe_customer_id });
  if (id !== owner.stripe_customer_id) check(await db().from('profiles').update({ stripe_customer_id: id }).eq('id', owner.id));
  return id;
}

// ---------------------------------------------------------------- charging

// Charges one period of a plan and records the payment (paid or failed).
async function chargePeriod(o: {
  restaurantId: number; name: string; plan: PaidPlan; amountCents: number; customerId: string; card: Card | null; start: Date; key: string;
}) {
  const end = addPeriod(o.start, o.plan);
  const record = async (row: { status: 'paid' | 'failed'; invoice_number?: string; transaction_id?: string; error?: string }) =>
    must(await db().from('subscription_payments').insert({
      restaurant_id: o.restaurantId, plan: o.plan, amount_cents: o.amountCents, period_start: o.start.toISOString(), period_end: end.toISOString(),
      card_label: o.card ? label(o.card) : '', ...row,
    }).select('id'));
  if (!o.card) {
    await record({ status: 'failed', error: 'No card on file.' });
    return { ok: false as const, error: 'No card on file.' };
  }
  try {
    const charge = await payments().charge({
      amountCents: o.amountCents, customerId: o.customerId, paymentRef: o.card.provider_ref,
      description: `Bite Wise ${o.plan} plan · ${o.name}`,
      metadata: { restaurant_id: String(o.restaurantId), plan: o.plan, period_start: o.start.toISOString() },
      idempotencyKey: o.key,
    });
    const invoice = must(await db().rpc('next_subscription_invoice')) as string;
    await record({ status: 'paid', invoice_number: invoice, transaction_id: charge.id });
    return { ok: true as const, end, invoice };
  } catch (err) {
    if (!(err instanceof PaymentError)) throw err;
    await record({ status: 'failed', error: err.message.slice(0, 300) });
    return { ok: false as const, error: err.message };
  }
}

async function receipt(o: {
  to: string; restaurant: string; plan: PaidPlan; amountCents: number; invoice: string; cardLabel: string; start?: Date; end: Date; autoRenew: boolean;
  renewal: boolean; listPriceCents?: number; discountCents?: number; discountLabel?: string;
}) {
  await sendEmail({
    to: o.to,
    ...subscriptionReceiptEmail({
      restaurant: o.restaurant, plan: o.plan, amountCents: o.amountCents, invoiceNumber: o.invoice, cardLabel: o.cardLabel,
      periodStart: o.start?.toISOString(), periodEnd: o.end.toISOString(), autoRenew: o.autoRenew, renewal: o.renewal, planUrl: planUrl(),
      listPriceCents: o.listPriceCents, discountCents: o.discountCents, discountLabel: o.discountLabel,
    }),
  }).catch((err) => console.error('subscription receipt email:', err));
}

// ---------------------------------------------------------------- Pioneer Members

// Records a Pioneer Member's $0.00 invoice for one period (the plan price minus the Pioneer Members Discount) and
// emails it.
async function pioneerInvoice(restaurantId: number, plan: PaidPlan, start: Date, end: Date, renewal: boolean) {
  const listPrice = priceOf(await prices(), plan);
  const invoice = must(await db().rpc('next_subscription_invoice')) as string;
  must(await db().from('subscription_payments').insert({
    restaurant_id: restaurantId, plan, amount_cents: 0, status: 'paid', period_start: start.toISOString(), period_end: end.toISOString(),
    invoice_number: invoice, transaction_id: 'pioneer', card_label: 'No charge',
    list_price_cents: listPrice, discount_cents: listPrice, discount_label: PIONEER_DISCOUNT,
  }).select('id'));
  const { restaurant, owner } = await ownerOf(restaurantId);
  await receipt({
    to: owner.email, restaurant: restaurant.name, plan, amountCents: 0, invoice, cardLabel: 'No charge', start, end, autoRenew: true, renewal,
    listPriceCents: listPrice, discountCents: listPrice, discountLabel: PIONEER_DISCOUNT,
  });
  return invoice;
}

// A restaurant chooses its plan. While Pioneer spots are left it becomes a Pioneer Member on that plan, free and
// without a card (returns its pioneer number). Otherwise it returns { pioneer: null } and the restaurant pays with a
// card (subscribe), which is only possible once the restaurant is approved.
export async function choosePlan(restaurantId: number, plan: PaidPlan) {
  const r = must(await db().from('restaurants').select('status').eq('id', restaurantId).single());
  if (r.status === 'banned' || r.status === 'deleted') throw new AppError(403, 'Your restaurant has been removed from Bite Wise.');
  const sub = await getSubscription(restaurantId);
  if (isPioneer(sub) && sub!.status === 'active') throw new AppError(409, 'You are already a Pioneer Member: your plan is free.');
  if (sub && sub.status !== 'expired') throw new AppError(409, 'You already have a plan. You can switch plans from your next renewal.');
  const number = maybe(await db().rpc('claim_pioneer_spot', { p_restaurant_id: restaurantId, p_plan: plan })) as number | null;
  if (!number) {
    return { pioneer: null, canPay: r.status === 'approved' };
  }
  const s = (await getSubscription(restaurantId))!;
  const invoice = await pioneerInvoice(restaurantId, plan, new Date(s.current_period_start!), new Date(s.current_period_end!), false);
  return { pioneer: number, invoiceNumber: invoice, periodEnd: s.current_period_end, canPay: true };
}

// Starts the next free period of every Pioneer membership whose period has ended, with its $0.00 invoice.
async function renewPioneers() {
  const due = must(await db().from('restaurant_subscriptions').select('*').not('founding_number', 'is', null).eq('status', 'active')
    .neq('plan', 'founding').lte('current_period_end', new Date().toISOString()).limit(200));
  let renewed = 0;
  for (const s of due) {
    try {
      const plan = (s.renew_plan ?? s.plan) as PaidPlan;
      const start = new Date(s.current_period_end!);
      const end = addPeriod(start, plan);
      // Claim it by its current end date, so two job runs never renew the same period twice.
      const claimed = maybe(await db().from('restaurant_subscriptions')
        .update({ plan, renew_plan: null, current_period_start: start.toISOString(), current_period_end: end.toISOString(), updated_at: new Date().toISOString() })
        .eq('restaurant_id', s.restaurant_id).eq('current_period_end', s.current_period_end!).select('restaurant_id').maybeSingle());
      if (!claimed) continue;
      await pioneerInvoice(s.restaurant_id, plan, start, end, true);
      renewed++;
    } catch (err) {
      console.error(`renewing the Pioneer membership of restaurant ${s.restaurant_id}:`, err);
    }
  }
  return renewed;
}

// Pauses the restaurant's live offers (its plan just became delinquent).
async function pauseOffers(restaurantId: number) {
  check(await db().from('offers').update({ status: 'paused' }).eq('restaurant_id', restaurantId).eq('status', 'active'));
}

// Starts a paid plan now (or restarts one that lapsed), charging the first period to a card on file or a new card
// (which is saved to the cards on file).
export async function subscribe(restaurantId: number, input: { plan: PaidPlan; cardId?: number | null; token?: unknown; autoRenew: boolean }) {
  const sub = await getSubscription(restaurantId);
  if (isPioneer(sub) && sub!.status === 'active') throw new AppError(409, 'You are a Pioneer Member: your plan is free.');
  const status = must(await db().from('restaurants').select('status').eq('id', restaurantId).single()).status;
  if (status !== 'approved') throw new AppError(409, 'Paid plans start once your restaurant is approved.');
  if (sub?.status === 'active') throw new AppError(409, 'You already have an active plan. You can switch plans from your next renewal.');
  if (sub?.status === 'past_due') throw new AppError(409, 'Your plan is delinquent: pay it to post offers again.');
  const { restaurant, owner } = await ownerOf(restaurantId);
  const customerId = await customerRef(owner);
  let cardId = input.cardId ?? null;
  const newCard = !cardId;
  if (!cardId) {
    if (input.token === undefined) throw new AppError(400, 'Choose a card.');
    cardId = (await addCard(restaurantId, input.token, true)).id;
  }
  const card = await chargeCard(owner.id, cardId);
  const start = new Date();
  // A lapsed plan restarts at the price new plans pay (any lock went with it).
  const amountCents = planPrice(await priceContext(), null, input.plan, start);
  const res = await chargePeriod({
    restaurantId, name: restaurant.name, plan: input.plan, amountCents, customerId, card, start,
    key: `sub-start-${restaurantId}-${cardId}-${Math.floor(start.getTime() / 60_000)}`,
  });
  if (!res.ok) {
    if (newCard) await orders.removeCard(owner.id, cardId); // a new card that was declined isn't kept on file
    throw new AppError(402, `Your card was declined: ${res.error} Please try another card.`);
  }
  must(await db().from('restaurant_subscriptions').upsert({
    restaurant_id: restaurantId, plan: input.plan, renew_plan: null, status: 'active', founding_number: null, auto_renew: input.autoRenew,
    price_cents: amountCents, current_period_start: start.toISOString(), current_period_end: res.end.toISOString(),
    customer_ref: customerId, card_ref: card!.provider_ref, card_label: label(card!), last_payment_error: '', retry_at: null, renewing_at: null,
    reminder_sent_for: null, locked_monthly_cents: null, locked_annual_cents: null, updated_at: new Date().toISOString(),
  }).select('restaurant_id'));
  await receipt({ to: owner.email, restaurant: restaurant.name, plan: input.plan, amountCents, invoice: res.invoice, cardLabel: label(card!), end: res.end, autoRenew: input.autoRenew, renewal: false });
  return { invoiceNumber: res.invoice, periodEnd: res.end.toISOString() };
}

async function paidSubscription(restaurantId: number) {
  const sub = await getSubscription(restaurantId);
  if (!sub || sub.plan === 'founding' || sub.status === 'expired') throw new AppError(409, 'You have no plan right now.');
  return sub;
}

export async function setAutoRenew(restaurantId: number, on: boolean) {
  const sub = await paidSubscription(restaurantId);
  if (isPioneer(sub)) throw new AppError(409, 'Pioneer memberships renew automatically, free.');
  if (on) {
    const { owner } = await ownerOf(restaurantId);
    if (!(await cardsOf(owner.id)).length) throw new AppError(409, 'Add a card on file first: auto-renewal charges your default card.');
  }
  must(await db().from('restaurant_subscriptions').update({ auto_renew: on, updated_at: new Date().toISOString() }).eq('restaurant_id', restaurantId).select('restaurant_id'));
}

// Switches between monthly and annual from the next renewal (or the next payment of a delinquent plan).
export async function setRenewPlan(restaurantId: number, plan: PaidPlan) {
  const sub = await paidSubscription(restaurantId);
  must(await db().from('restaurant_subscriptions').update({ renew_plan: plan === sub.plan ? null : plan, updated_at: new Date().toISOString() }).eq('restaurant_id', restaurantId).select('restaurant_id'));
}

// Claims a subscription for charging, so two job runs (or a job and the owner paying) never charge it twice.
async function claim(restaurantId: number) {
  const now = new Date();
  return maybe(await db().from('restaurant_subscriptions').update({ renewing_at: now.toISOString() })
    .eq('restaurant_id', restaurantId).neq('plan', 'founding').is('founding_number', null).in('status', ['active', 'past_due'])
    .or(`renewing_at.is.null,renewing_at.lt.${new Date(now.getTime() - 10 * 60_000).toISOString()}`)
    .select('*').maybeSingle());
}

// Charges the next period of a paid plan: a renewal that is due, a retry of a delinquent plan, or a delinquent plan
// paid now by the owner or an admin (`manual`, optionally with a chosen card).
async function charge(restaurantId: number, o: { manual: boolean; cardId?: number | null }): Promise<'renewed' | 'failed' | 'skipped'> {
  const now = new Date();
  const claimed = await claim(restaurantId);
  if (!claimed) {
    if (o.manual) throw new AppError(409, 'A payment for this plan is already being processed. Please try again in a minute.');
    return 'skipped';
  }
  const done = (patch: Partial<Subscription>) =>
    db().from('restaurant_subscriptions').update({ ...patch, renewing_at: null, updated_at: new Date().toISOString() }).eq('restaurant_id', restaurantId);
  try {
    const periodEnd = new Date(claimed.current_period_end!);
    const delinquent = claimed.status === 'past_due';
    const due = o.manual
      ? delinquent
      : claimed.auto_renew && periodEnd <= now && (!delinquent || (claimed.retry_at !== null && new Date(claimed.retry_at) <= now));
    if (!due) {
      await done({});
      if (o.manual) throw new AppError(409, 'Your plan is paid up: there is nothing to pay right now.');
      return 'skipped';
    }
    const plan = (claimed.renew_plan ?? claimed.plan) as PaidPlan;
    const amountCents = planPrice(await priceContext(), claimed, plan, now);
    const { restaurant, owner } = await ownerOf(restaurantId);
    const card = await chargeCard(owner.id, o.cardId);
    const customerId = claimed.customer_ref ?? (await customerRef(owner));
    // A renewal continues where the last period ended; a delinquent plan starts again from the day it is paid.
    const start = delinquent ? now : periodEnd;
    const res = await chargePeriod({
      restaurantId, name: restaurant.name, plan, amountCents, customerId, card, start,
      key: `sub-${restaurantId}-${periodEnd.toISOString()}-${card?.id ?? 0}-${o.manual ? now.toISOString().slice(0, 16) : now.toISOString().slice(0, 10)}`,
    });
    if (res.ok) {
      await done({
        plan, renew_plan: null, status: 'active', price_cents: amountCents, current_period_start: start.toISOString(),
        current_period_end: res.end.toISOString(), last_payment_error: '', retry_at: null, card_ref: card!.provider_ref, card_label: label(card!),
      });
      await receipt({ to: owner.email, restaurant: restaurant.name, plan, amountCents, invoice: res.invoice, cardLabel: label(card!), end: res.end, autoRenew: claimed.auto_renew, renewal: true });
      return 'renewed';
    }
    // Declined: the plan is delinquent at once. The default card is retried daily for RETRY_DAYS after the renewal date.
    const retry = new Date(now.getTime() + DAY);
    await done({
      status: 'past_due', last_payment_error: res.error.slice(0, 300),
      retry_at: retry.getTime() <= periodEnd.getTime() + RETRY_DAYS * DAY ? retry.toISOString() : null,
    });
    await pauseOffers(restaurantId);
    if (!delinquent) {
      await sendEmail({ to: owner.email, ...paymentFailedEmail({ restaurant: restaurant.name, amountCents, error: res.error, planUrl: planUrl() }) })
        .catch((err) => console.error('payment declined email:', err));
    }
    if (o.manual) throw new AppError(402, `The card was declined: ${res.error} Please try another card.`);
    return 'failed';
  } catch (err) {
    // Release the claim (a no-op if it was already released above).
    await done({}).then(() => undefined, () => undefined);
    throw err;
  }
}

// Pays a delinquent plan now (the restaurant, from its Plan tab, or an admin). The new period starts today.
export async function payNow(restaurantId: number, cardId?: number | null) {
  await charge(restaurantId, { manual: true, cardId });
  const sub = (await getSubscription(restaurantId))!;
  return { periodEnd: sub.current_period_end };
}

// Scheduled job: charges renewals that are due, retries delinquent plans once a day, and sends renewal reminders.
export async function renewDue() {
  const now = new Date();
  const pioneers = await renewPioneers();
  const due = must(await db().from('restaurant_subscriptions').select('restaurant_id')
    .neq('plan', 'founding').is('founding_number', null).eq('auto_renew', true).in('status', ['active', 'past_due']).lte('current_period_end', now.toISOString()).limit(200));
  const counts = { renewed: 0, failed: 0, reminded: 0, pioneers };
  for (const { restaurant_id } of due) {
    try {
      const res = await charge(restaurant_id, { manual: false });
      if (res !== 'skipped') counts[res]++;
    } catch (err) {
      console.error(`renewing the plan of restaurant ${restaurant_id}:`, err);
    }
  }

  // Renewal reminders: the card on file will be charged this amount on this date. Sent once per period, the set
  // number of days before it renews (30 for annual plans and 7 for monthly ones by default).
  const p = await prices();
  const lead = (plan: PaidPlan) => (plan === 'annual' ? p.reminderDaysAnnual : p.reminderDaysMonthly);
  const horizon = new Date(now.getTime() + Math.max(p.reminderDaysAnnual, p.reminderDaysMonthly) * DAY);
  const soon = must(await db().from('restaurant_subscriptions').select('*')
    .neq('plan', 'founding').is('founding_number', null).eq('auto_renew', true).eq('status', 'active')
    .gt('current_period_end', now.toISOString()).lte('current_period_end', horizon.toISOString()));
  const ctx = await priceContext();
  for (const s of soon) {
    const plan = (s.renew_plan ?? s.plan) as PaidPlan;
    const renewsOn = new Date(s.current_period_end!);
    if (s.reminder_sent_for === s.current_period_end || renewsOn.getTime() - now.getTime() > lead(plan) * DAY) continue;
    // A plan bought less than a day ago doesn't need a reminder right away (e.g. a monthly plan with a 30-day lead).
    if (s.current_period_start && now.getTime() - Date.parse(s.current_period_start) < DAY) continue;
    try {
      const { restaurant, owner } = await ownerOf(s.restaurant_id);
      const card = await chargeCard(owner.id);
      const sent = await sendEmail({
        to: owner.email,
        ...renewalReminderEmail({
          restaurant: restaurant.name, plan, amountCents: planPrice(ctx, s, plan, renewsOn), renewsOn: s.current_period_end!,
          cardLabel: card ? label(card) : 'your card on file', planUrl: planUrl(),
        }),
      });
      if (sent) {
        await db().from('restaurant_subscriptions').update({ reminder_sent_for: s.current_period_end }).eq('restaurant_id', s.restaurant_id);
        counts.reminded++;
      }
    } catch (err) {
      console.error(`renewal reminder for restaurant ${s.restaurant_id}:`, err);
    }
  }
  return counts;
}
