'use server';

import { z } from 'zod';
import { log } from '@/lib/admin';
import { requireActor } from '@/lib/auth';
import { action, AppError, check, must } from '@/lib/errors';
import * as feeChanges from '@/lib/fee-changes';
import * as moderation from '@/lib/moderation';
import * as subscriptions from '@/lib/subscriptions';
import { money } from '@/lib/format';
import * as orders from '@/lib/orders';
import { sendOnboardingEmails } from '@/lib/restaurant-onboarding';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { SUSPENSION_DAYS } from '@/lib/constants';
import { dollars, int, parse } from '@/lib/validate';

// Owner console actions. Every action checks for an admin session and is written to the audit log.
const db = () => supabaseAdmin();
const note = (field: string, min = 0) => z.string().trim().min(min, `${field} must be at least ${min} characters.`).max(300, `${field} must be at most 300 characters.`);

const days = z.number().int().refine((n) => (SUSPENSION_DAYS as readonly number[]).includes(n), 'Choose a suspension length.').optional();

// Approve, reinstate, suspend for a number of days, or ban a restaurant for good (see src/lib/moderation.ts).
export async function setRestaurantStatus(input: unknown) {
  return action(async () => {
    const me = await requireActor('admin');
    const d = parse(z.object({ id: z.number().int(), status: z.enum(['approved', 'suspended', 'banned', 'pending']), days, note: note('Note').default('') }), input);
    const name = await moderation.setRestaurantStatus(d.id, d);
    await log(me.id, `restaurant.${d.status}`, 'restaurant', d.id, `${name}${d.days ? ` for ${d.days} days` : ''}${d.note ? `: ${d.note}` : ''}`);
    if (d.status === 'approved') await sendOnboardingEmails(d.id); // welcome email: signed agreement + kiosk link
    return null;
  });
}

// Reactivate, suspend for a number of days, or ban an account for good (see src/lib/moderation.ts).
export async function setUserStatus(input: unknown) {
  return action(async () => {
    const me = await requireActor('admin');
    const d = parse(z.object({ id: z.string().uuid(), status: z.enum(['active', 'suspended', 'banned']), days, note: note('Reason').default('') }), input);
    if (d.id === me.id) throw new AppError(400, 'You cannot suspend or ban your own account.');
    const res = await moderation.setUserStatus(d.id, d);
    await log(me.id, res.action, 'user', d.id, res.details);
    return null;
  });
}

// Deletes an account (customer, restaurant owner or admin); see src/lib/moderation.ts.
export async function deleteUser(input: unknown) {
  return action(async () => {
    const me = await requireActor('admin');
    const d = parse(z.object({ id: z.string().uuid() }), input);
    if (d.id === me.id) throw new AppError(400, 'You cannot delete your own account.');
    const res = await moderation.deleteAccount(d.id);
    await log(me.id, 'user.delete', 'user', d.id, res.details);
    return { anonymized: res.anonymized };
  });
}

// Deletes a restaurant and its owner's account.
export async function deleteRestaurant(input: unknown) {
  return action(async () => {
    const me = await requireActor('admin');
    const d = parse(z.object({ id: z.number().int() }), input);
    const res = await moderation.deleteRestaurant(d.id);
    await log(me.id, 'restaurant.delete', 'restaurant', d.id, res.details);
    return { anonymized: res.anonymized };
  });
}

// Goodwill platform credit, funded by Bite Wise.
export async function issueCredit(input: unknown) {
  return action(async () => {
    const me = await requireActor('admin');
    const d = parse(z.object({ userId: z.string().uuid(), amount: dollars('Credit amount', 0.01, 1000), reason: note('Reason', 3) }), input);
    const balance = must(await db().rpc('issue_credit', { p_user: d.userId, p_amount_cents: d.amount, p_note: d.reason, p_by: me.id }));
    const u = must(await db().from('profiles').select('username').eq('id', d.userId).single());
    await log(me.id, 'credit.issue', 'user', d.userId, `${u.username}: ${money(d.amount)} - ${d.reason}`);
    return { balanceCents: balance };
  });
}

export async function adminCancelOrder(input: unknown) {
  return action(async () => {
    const me = await requireActor('admin');
    const d = parse(z.object({ id: int('Order', 1, Number.MAX_SAFE_INTEGER), reason: note('Reason').default('') }), input);
    const o = await orders.getOrder(d.id);
    if (o.status !== 'reserved' && o.status !== 'pending_payment') throw new AppError(409, 'Only orders awaiting pickup can be cancelled.');
    await orders.release(o.id, o.status, 'cancelled', true);
    await log(me.id, 'order.cancel', 'order', o.id, d.reason);
    return null;
  });
}

// Refund by percentage of what's left or by amount, to the original payment or as platform credit.
export async function refundOrder(input: unknown) {
  return action(async () => {
    const me = await requireActor('admin');
    const d = parse(
      z.object({
        id: int('Order', 1, Number.MAX_SAFE_INTEGER),
        percent: int('Percentage', 1, 100).optional(),
        amount: z.union([z.string(), z.number()]).optional(),
        method: z.enum(['original', 'credit']),
        reason: note('Reason', 3),
      }),
      input,
    );
    const o = await orders.getOrder(d.id);
    const refundable = o.total_cents - o.refunded_cents - o.credited_cents;
    const amountCents = d.percent !== undefined
      ? Math.max(1, Math.round((refundable * d.percent) / 100))
      : parse(dollars('Refund amount', 0.01, refundable / 100), d.amount ?? '');
    const res = await orders.refundOrder(d.id, { amountCents, method: d.method, reason: d.reason, adminId: me.id });
    await log(
      me.id, d.method === 'credit' ? 'order.refund_credit' : 'order.refund', 'order', d.id,
      `${money(amountCents)} to ${d.method === 'credit' ? 'platform credit' : [res.cardCents && `card ${money(res.cardCents)}`, res.creditCents && `credit ${money(res.creditCents)}`].filter(Boolean).join(' + ')} - ${d.reason}`,
    );
    return { amountCents };
  });
}

export async function endOffer(input: unknown) {
  return action(async () => {
    const me = await requireActor('admin');
    const d = parse(z.object({ id: z.number().int(), reason: note('Reason').default('') }), input);
    const o = must(await db().from('offers').update({ status: 'ended' }).eq('id', d.id).select('id, title, restaurants(name)').maybeSingle());
    await log(me.id, 'offer.remove', 'offer', o.id, `${o.title} (${o.restaurants?.name ?? ''})${d.reason ? `: ${d.reason}` : ''}`);
    return null;
  });
}

// Pays a restaurant its balance through Stripe Connect, or records a payout made outside Stripe.
// Invoice numbers and transaction details are assigned by the system and can't be edited.
export async function payRestaurant(input: unknown) {
  return action(async () => {
    const me = await requireActor('admin');
    const d = parse(z.object({ restaurantId: z.number().int(), amount: dollars('Amount', 0.01, 1_000_000), note: note('Note').default(''), manual: z.boolean() }), input);
    const r = must(await db().from('restaurants').select('name').eq('id', d.restaurantId).maybeSingle());
    const p = await orders.payRestaurant(d.restaurantId, d.amount, me.id, d.note, d.manual);
    await log(me.id, d.manual ? 'payout.record' : 'payout.transfer', 'restaurant', d.restaurantId, `${r.name}: ${money(d.amount)} (${p.invoice_number}, ${p.transaction_id})`);
    return { invoiceNumber: p.invoice_number, transactionId: p.transaction_id, bankDetails: p.bank_details };
  });
}

export async function updateSettings(input: unknown) {
  return action(async () => {
    const me = await requireActor('admin');
    const d = parse(
      z.object({
        serviceFeePct: z.coerce.number().min(0, 'Service fee must be 0% to 30%.').max(30, 'Service fee must be 0% to 30%.'),
        defaultTaxRatePct: z.coerce.number().min(0, 'Sales tax must be 0% to 20%.').max(20, 'Sales tax must be 0% to 20%.'),
        requireRestaurantApproval: z.boolean(),
      }),
      input,
    );
    const values = {
      service_fee_bps: Math.round(d.serviceFeePct * 100),
      default_tax_rate_bps: Math.round(d.defaultTaxRatePct * 100),
      require_restaurant_approval: d.requireRestaurantApproval,
    };
    const current = new Map(must(await db().from('settings').select('key, value')).map((r) => [r.key, r.value]));
    const changed = Object.entries(values).filter(([k, v]) => current.get(k) !== v);
    for (const [key, value] of changed) {
      check(await db().from('settings').upsert({ key, value, updated_at: new Date().toISOString() }));
    }
    if (changed.length) await log(me.id, 'settings.update', 'settings', null, changed.map(([k, v]) => `${k}=${v}`).join(', '));
    return { changed: changed.map(([k]) => k) };
  });
}

// Founding Partner spots and when renewal reminders go out. (Prices change through a scheduled fee change.)
export async function updatePlanSettings(input: unknown) {
  return action(async () => {
    const me = await requireActor('admin');
    const days = (what: string) => z.coerce.number().int(`${what} must be a whole number of days.`).min(1, `${what} must be 1 to 60 days.`).max(60, `${what} must be 1 to 60 days.`);
    const d = parse(
      z.object({
        foundingSpots: z.coerce.number().int('Founding spots must be a whole number.').min(0, 'Founding spots must be 0 to 10,000.').max(10000, 'Founding spots must be 0 to 10,000.'),
        reminderDaysAnnual: days('The annual reminder'),
        reminderDaysMonthly: days('The monthly reminder'),
      }),
      input,
    );
    const values = { founding_spots: d.foundingSpots, renewal_reminder_days_annual: d.reminderDaysAnnual, renewal_reminder_days_monthly: d.reminderDaysMonthly };
    const current = new Map(must(await db().from('settings').select('key, value')).map((r) => [r.key, r.value]));
    const changed = Object.entries(values).filter(([k, v]) => Number(current.get(k)) !== v);
    for (const [key, value] of changed) check(await db().from('settings').upsert({ key, value, updated_at: new Date().toISOString() }));
    if (changed.length) await log(me.id, 'plans.settings', 'settings', null, changed.map(([k, v]) => `${k}=${v}`).join(', '));
    return { changed: changed.map(([k]) => k) };
  });
}

const feeChangeSchema = z.object({
  monthlyPrice: z.coerce.number().min(0.5, 'Monthly price must be $0.50 to $1,000.').max(1000, 'Monthly price must be $0.50 to $1,000.'),
  annualPrice: z.coerce.number().min(0.5, 'Annual price must be $0.50 to $10,000.').max(10000, 'Annual price must be $0.50 to $10,000.'),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the date the new fees take effect.'),
  appliesToExisting: z.boolean(),
  templateName: z.string().trim().max(60).default(''),
  subject: z.string().trim().min(3, 'Write a subject for the email.').max(200, 'The subject must be at most 200 characters.'),
  body: z.string().trim().min(20, 'Write the email message.').max(5000, 'The message must be at most 5,000 characters.'),
  includeFounding: z.boolean().default(false),
});
const feeChange = (input: unknown) => {
  const d = parse(feeChangeSchema, input);
  return { ...d, monthlyCents: Math.round(d.monthlyPrice * 100), annualCents: Math.round(d.annualPrice * 100) };
};

// The fee-change email as one restaurant will see it.
export async function previewFeeChange(input: unknown) {
  return action(async () => {
    await requireActor('admin');
    return feeChanges.preview(feeChange(input));
  });
}

// Schedules new subscription fees (12:01 AM Pacific Time on the effective date) and emails every restaurant now.
export async function scheduleFeeChange(input: unknown) {
  return action(async () => {
    const me = await requireActor('admin');
    const d = feeChange(input);
    const res = await feeChanges.scheduleChange(d, me.id);
    await log(me.id, 'plans.fee_change', 'settings', res.id,
      `monthly ${money(d.monthlyCents)}, annual ${money(d.annualCents)} from ${d.effectiveDate} 12:01 AM PT; ` +
      `${d.appliesToExisting ? 'existing plans pay the new fees at renewal' : 'existing plans keep their fees'}; ${res.sent} emails sent${res.failed ? `, ${res.failed} not sent` : ''}`);
    return res;
  });
}

// Cancels a scheduled fee change before it takes effect (restaurants that were emailed aren't told automatically).
export async function cancelFeeChange(id: number) {
  return action(async () => {
    const me = await requireActor('admin');
    const c = await feeChanges.cancelChange(parse(z.number().int(), id));
    await log(me.id, 'plans.fee_change_cancel', 'settings', c.id, 'scheduled fee change cancelled');
    return null;
  });
}

const templateSchema = z.object({
  id: z.number().int().positive().nullish(),
  name: z.string().trim().min(2, 'Give the template a name.').max(60, 'The name must be at most 60 characters.'),
  subject: z.string().trim().min(2, 'Write a subject.').max(200, 'The subject must be at most 200 characters.'),
  body: z.string().trim().min(2, 'Write the message.').max(5000, 'The message must be at most 5,000 characters.'),
});

export async function saveFeeTemplate(input: unknown) {
  return action(async () => {
    const me = await requireActor('admin');
    const t = await feeChanges.saveTemplate(parse(templateSchema, input));
    await log(me.id, 'plans.template_save', 'settings', t.id, t.name);
    return t;
  });
}

export async function deleteFeeTemplate(id: number) {
  return action(async () => {
    const me = await requireActor('admin');
    await feeChanges.deleteTemplate(parse(z.number().int(), id));
    await log(me.id, 'plans.template_delete', 'settings', id, '');
    return null;
  });
}

// Charges a delinquent restaurant's plan to its default card on file (for example after it says it fixed its card).
export async function chargeDelinquentPlan(input: unknown) {
  return action(async () => {
    const me = await requireActor('admin');
    const d = parse(z.object({ restaurantId: z.number().int() }), input);
    const r = must(await db().from('restaurants').select('name').eq('id', d.restaurantId).maybeSingle());
    try {
      const res = await subscriptions.payNow(d.restaurantId);
      await log(me.id, 'plans.charge', 'restaurant', d.restaurantId, `${r.name}: paid, active until ${res.periodEnd}`);
      return res;
    } catch (err) {
      if (err instanceof AppError) await log(me.id, 'plans.charge_failed', 'restaurant', d.restaurantId, `${r.name}: ${err.message}`);
      throw err;
    }
  });
}
