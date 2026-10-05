import 'server-only';
import type { Database } from '@/lib/database.types';
import { sendEmail } from '@/lib/email/send';
import { paymentFailedEmail, renewalReminderEmail, subscriptionReceiptEmail } from '@/lib/email/templates';
import { publicEnv } from '@/lib/env';
import { AppError, maybe, must } from '@/lib/errors';
import { PaymentError, payments } from '@/lib/payments';
import { supabaseAdmin } from '@/lib/supabase/admin';

// Restaurant subscriptions (see supabase/migrations/20261006000200_bans_and_subscriptions.sql).
//   * Founding Partners: the first `founding_spots` (50) approved restaurants, free for as long as they are partners.
//   * Paid plans: monthly or annual, charged in advance to the card saved with the plan. They renew automatically
//     unless auto-renewal is off; renewDue() charges the renewals and is run by the scheduled jobs (src/lib/jobs.ts).
//   * A failed renewal is retried daily; after 7 days the database's sweep lets the plan lapse and pauses the offers.

export type Subscription = Database['public']['Tables']['restaurant_subscriptions']['Row'];
export type PaidPlan = 'monthly' | 'annual';
export const GRACE_DAYS = 7;
const REMINDER_DAYS = 7;

const db = () => supabaseAdmin();
const planUrl = () => `${publicEnv.siteUrl}/restaurant?tab=plan`;

export async function prices() {
  const rows = must(await db().from('settings').select('key, value').in('key', ['subscription_monthly_cents', 'subscription_annual_cents', 'founding_spots']));
  const get = (key: string, fallback: number) => Number(rows.find((r) => r.key === key)?.value ?? fallback);
  const { count } = await db().from('restaurant_subscriptions').select('restaurant_id', { count: 'exact', head: true }).not('founding_number', 'is', null);
  const foundingSpots = get('founding_spots', 50);
  return {
    monthlyCents: get('subscription_monthly_cents', 1500),
    annualCents: get('subscription_annual_cents', 15000),
    foundingSpots,
    foundingLeft: Math.max(0, foundingSpots - (count ?? 0)),
  };
}
const priceOf = (p: Awaited<ReturnType<typeof prices>>, plan: PaidPlan) => (plan === 'annual' ? p.annualCents : p.monthlyCents);

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

// Makes the restaurant a Founding Partner if a free spot is left and it has no plan yet. Returns its number, or null.
export async function claimFounding(restaurantId: number) {
  return maybe(await db().rpc('claim_founding_spot', { p_restaurant_id: restaurantId })) as number | null;
}

export async function getSubscription(restaurantId: number) {
  return maybe(await db().from('restaurant_subscriptions').select('*').eq('restaurant_id', restaurantId).maybeSingle());
}

// What the restaurant's Plan tab shows.
export async function planSummary(restaurantId: number) {
  const [sub, p, history, ok] = await Promise.all([
    getSubscription(restaurantId),
    prices(),
    db().from('subscription_payments').select('*').eq('restaurant_id', restaurantId).order('created_at', { ascending: false }).limit(24),
    db().rpc('restaurant_plan_ok', { p_restaurant_id: restaurantId }),
  ]);
  return {
    prices: p,
    canPost: Boolean(ok.data),
    subscription: sub && {
      plan: sub.plan, renewPlan: sub.renew_plan, status: sub.status, foundingNumber: sub.founding_number, autoRenew: sub.auto_renew,
      priceCents: sub.price_cents, periodStart: sub.current_period_start, periodEnd: sub.current_period_end, cardLabel: sub.card_label,
      lastPaymentError: sub.last_payment_error,
      graceEnd: sub.current_period_end && new Date(Date.parse(sub.current_period_end) + GRACE_DAYS * 86_400_000).toISOString(),
    },
    payments: must(history).map((x) => ({
      id: x.id, plan: x.plan, amountCents: x.amount_cents, status: x.status, invoiceNumber: x.invoice_number, cardLabel: x.card_label,
      periodEnd: x.period_end, error: x.error, createdAt: x.created_at,
    })),
  };
}
export type PlanSummary = Awaited<ReturnType<typeof planSummary>>;

type Owner = { id: string; email: string; username: string };

async function ownerOf(restaurantId: number) {
  const r = must(await db().from('restaurants').select('id, name, owner_id, profiles!restaurants_owner_id_fkey(id, email, username, stripe_customer_id)').eq('id', restaurantId).single());
  return { restaurant: r, owner: r.profiles! };
}

async function customerFor(owner: Owner & { stripe_customer_id?: string | null }) {
  const existingId = owner.stripe_customer_id ?? maybe(await db().from('profiles').select('stripe_customer_id').eq('id', owner.id).maybeSingle())?.stripe_customer_id;
  const id = await payments().ensureCustomer({ email: owner.email, username: owner.username, existingId });
  if (id !== existingId) await db().from('profiles').update({ stripe_customer_id: id }).eq('id', owner.id);
  return id;
}

// Saves a card for the plan. With Stripe the card was confirmed in the browser with a SetupIntent of this customer.
async function saveCard(customerId: string, token: unknown) {
  try {
    const card = await payments().resolvePaymentMethod({ customerId, token, save: true });
    return { ref: card.ref, label: `${card.brand.toUpperCase()} •••• ${card.last4}` };
  } catch (err) {
    if (err instanceof PaymentError) throw new AppError(402, err.message);
    throw err;
  }
}

// Charges one period of a plan and records the payment (paid or failed). Returns the payment, or the error message.
async function chargePeriod(o: {
  restaurantId: number; name: string; plan: PaidPlan; amountCents: number; customerId: string; card: { ref: string; label: string };
  start: Date; key: string;
}) {
  const end = addPeriod(o.start, o.plan);
  try {
    const charge = await payments().charge({
      amountCents: o.amountCents, customerId: o.customerId, paymentRef: o.card.ref,
      description: `Bite Wise ${o.plan} plan · ${o.name}`,
      metadata: { restaurant_id: String(o.restaurantId), plan: o.plan, period_start: o.start.toISOString() },
      idempotencyKey: o.key,
    });
    const invoice = must(await db().rpc('next_subscription_invoice')) as string;
    must(await db().from('subscription_payments').insert({
      restaurant_id: o.restaurantId, plan: o.plan, amount_cents: o.amountCents, status: 'paid', period_start: o.start.toISOString(),
      period_end: end.toISOString(), invoice_number: invoice, transaction_id: charge.id, card_label: o.card.label,
    }).select('id'));
    return { ok: true as const, end, invoice };
  } catch (err) {
    if (!(err instanceof PaymentError)) throw err;
    must(await db().from('subscription_payments').insert({
      restaurant_id: o.restaurantId, plan: o.plan, amount_cents: o.amountCents, status: 'failed', period_start: o.start.toISOString(),
      period_end: end.toISOString(), card_label: o.card.label, error: err.message.slice(0, 300),
    }).select('id'));
    return { ok: false as const, error: err.message };
  }
}

async function receipt(o: { to: string; restaurant: string; plan: PaidPlan; amountCents: number; invoice: string; cardLabel: string; end: Date; autoRenew: boolean; renewal: boolean }) {
  await sendEmail({
    to: o.to,
    ...subscriptionReceiptEmail({
      restaurant: o.restaurant, plan: o.plan, amountCents: o.amountCents, invoiceNumber: o.invoice, cardLabel: o.cardLabel,
      periodEnd: o.end.toISOString(), autoRenew: o.autoRenew, renewal: o.renewal, planUrl: planUrl(),
    }),
  }).catch((err) => console.error('subscription receipt email:', err));
}

// Starts a paid plan now (or restarts one that lapsed or whose payment failed), charging the first period.
export async function subscribe(restaurantId: number, input: { plan: PaidPlan; token: unknown; autoRenew: boolean }) {
  const sub = await getSubscription(restaurantId);
  if (sub?.plan === 'founding') throw new AppError(409, 'You are a Founding Partner: Bite Wise is free for you.');
  if (sub?.status === 'active') throw new AppError(409, 'You already have an active plan. You can switch plans from your next renewal.');
  const { restaurant, owner } = await ownerOf(restaurantId);
  const customerId = await customerFor(owner);
  const card = await saveCard(customerId, input.token);
  const amountCents = priceOf(await prices(), input.plan);
  const start = new Date();
  const res = await chargePeriod({
    restaurantId, name: restaurant.name, plan: input.plan, amountCents, customerId, card, start,
    key: `sub-start-${restaurantId}-${Math.floor(start.getTime() / 60_000)}`,
  });
  if (!res.ok) throw new AppError(402, `Your card could not be charged: ${res.error}`);
  must(await db().from('restaurant_subscriptions').upsert({
    restaurant_id: restaurantId, plan: input.plan, renew_plan: null, status: 'active', founding_number: null, auto_renew: input.autoRenew,
    price_cents: amountCents, current_period_start: start.toISOString(), current_period_end: res.end.toISOString(),
    customer_ref: customerId, card_ref: card.ref, card_label: card.label, last_payment_error: '', retry_at: null, renewing_at: null,
    reminder_sent_for: null, updated_at: new Date().toISOString(),
  }).select('restaurant_id'));
  await receipt({ to: owner.email, restaurant: restaurant.name, plan: input.plan, amountCents, invoice: res.invoice, cardLabel: card.label, end: res.end, autoRenew: input.autoRenew, renewal: false });
  return { invoiceNumber: res.invoice, periodEnd: res.end.toISOString() };
}

async function paidSubscription(restaurantId: number) {
  const sub = await getSubscription(restaurantId);
  if (!sub || sub.plan === 'founding' || sub.status === 'expired') throw new AppError(409, 'You have no paid plan right now.');
  return sub;
}

export async function setAutoRenew(restaurantId: number, on: boolean) {
  await paidSubscription(restaurantId);
  must(await db().from('restaurant_subscriptions').update({ auto_renew: on, updated_at: new Date().toISOString() }).eq('restaurant_id', restaurantId).select('restaurant_id'));
}

// Switches between monthly and annual from the next renewal.
export async function setRenewPlan(restaurantId: number, plan: PaidPlan) {
  const sub = await paidSubscription(restaurantId);
  must(await db().from('restaurant_subscriptions').update({ renew_plan: plan === sub.plan ? null : plan, updated_at: new Date().toISOString() }).eq('restaurant_id', restaurantId).select('restaurant_id'));
}

// Replaces the plan's card. A plan whose renewal failed is charged again straight away.
export async function updateCard(restaurantId: number, token: unknown) {
  const sub = await paidSubscription(restaurantId);
  const { owner } = await ownerOf(restaurantId);
  const customerId = await customerFor(owner);
  const card = await saveCard(customerId, token);
  must(await db().from('restaurant_subscriptions').update({ card_ref: card.ref, card_label: card.label, customer_ref: customerId, retry_at: null, updated_at: new Date().toISOString() })
    .eq('restaurant_id', restaurantId).select('restaurant_id'));
  if (sub.status === 'past_due') {
    const res = await renewOne(restaurantId, { force: true });
    if (res === 'failed') throw new AppError(402, 'Your new card was saved, but the payment failed. Please try another card.');
  }
  return { cardLabel: card.label };
}

// Charges the renewal of one subscription whose period has ended. Returns what happened.
async function renewOne(restaurantId: number, { force = false } = {}): Promise<'renewed' | 'failed' | 'skipped'> {
  const now = new Date();
  // Claim it, so two job runs (or a job and the owner updating their card) never charge the same renewal twice.
  const claimed = maybe(await db().from('restaurant_subscriptions').update({ renewing_at: now.toISOString() })
    .eq('restaurant_id', restaurantId).neq('plan', 'founding').in('status', ['active', 'past_due'])
    .or(`renewing_at.is.null,renewing_at.lt.${new Date(now.getTime() - 10 * 60_000).toISOString()}`)
    .select('*').maybeSingle());
  if (!claimed) return 'skipped';
  const done = (patch: Partial<Subscription>) => db().from('restaurant_subscriptions').update({ ...patch, renewing_at: null, updated_at: new Date().toISOString() }).eq('restaurant_id', restaurantId);
  try {
    const periodEnd = new Date(claimed.current_period_end!);
    const due = periodEnd <= now && (force || claimed.status === 'active' || !claimed.retry_at || new Date(claimed.retry_at) <= now);
    if (!due || (!claimed.auto_renew && !force) || !claimed.card_ref || !claimed.customer_ref) {
      await done({});
      return 'skipped';
    }
    const plan = (claimed.renew_plan ?? claimed.plan) as PaidPlan;
    const amountCents = priceOf(await prices(), plan);
    const { restaurant, owner } = await ownerOf(restaurantId);
    const card = { ref: claimed.card_ref, label: claimed.card_label };
    const res = await chargePeriod({
      restaurantId, name: restaurant.name, plan, amountCents, customerId: claimed.customer_ref, card, start: periodEnd,
      key: `sub-renew-${restaurantId}-${periodEnd.toISOString()}-${now.toISOString().slice(0, force ? 16 : 10)}`,
    });
    if (res.ok) {
      await done({
        plan, renew_plan: null, status: 'active', price_cents: amountCents, current_period_start: periodEnd.toISOString(),
        current_period_end: res.end.toISOString(), last_payment_error: '', retry_at: null,
      });
      await receipt({ to: owner.email, restaurant: restaurant.name, plan, amountCents, invoice: res.invoice, cardLabel: card.label, end: res.end, autoRenew: claimed.auto_renew, renewal: true });
      return 'renewed';
    }
    await done({ status: 'past_due', last_payment_error: res.error.slice(0, 300), retry_at: new Date(now.getTime() + 86_400_000).toISOString() });
    if (claimed.status === 'active') {
      await sendEmail({
        to: owner.email,
        ...paymentFailedEmail({ restaurant: restaurant.name, amountCents, error: res.error, graceEnd: new Date(periodEnd.getTime() + GRACE_DAYS * 86_400_000).toISOString(), planUrl: planUrl() }),
      }).catch((err) => console.error('payment failed email:', err));
    }
    return 'failed';
  } catch (err) {
    await done({});
    throw err;
  }
}

// Scheduled job: charges renewals that are due, retries failed ones once a day, and reminds annual plans a week ahead.
export async function renewDue() {
  const now = new Date();
  const due = must(await db().from('restaurant_subscriptions').select('restaurant_id')
    .neq('plan', 'founding').eq('auto_renew', true).in('status', ['active', 'past_due']).lte('current_period_end', now.toISOString()).limit(200));
  const counts = { renewed: 0, failed: 0, reminded: 0 };
  for (const { restaurant_id } of due) {
    try {
      const res = await renewOne(restaurant_id);
      if (res !== 'skipped') counts[res]++;
    } catch (err) {
      console.error(`renewing the plan of restaurant ${restaurant_id}:`, err);
    }
  }

  const soon = must(await db().from('restaurant_subscriptions').select('*')
    .eq('plan', 'annual').eq('auto_renew', true).eq('status', 'active')
    .gt('current_period_end', now.toISOString()).lte('current_period_end', new Date(now.getTime() + REMINDER_DAYS * 86_400_000).toISOString()));
  for (const s of soon.filter((x) => x.reminder_sent_for !== x.current_period_end && (x.renew_plan ?? 'annual') === 'annual')) {
    try {
      const { restaurant, owner } = await ownerOf(s.restaurant_id);
      const sent = await sendEmail({
        to: owner.email,
        ...renewalReminderEmail({ restaurant: restaurant.name, amountCents: priceOf(await prices(), 'annual'), renewsOn: s.current_period_end!, cardLabel: s.card_label, planUrl: planUrl() }),
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
