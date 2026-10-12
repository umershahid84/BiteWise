'use server';

import { z } from 'zod';
import { log } from '@/lib/admin';
import { requireAdmin, type Viewer } from '@/lib/auth';
import { action, AppError, check, must } from '@/lib/errors';
import { updateAccount, updateRestaurantDetails } from '@/lib/admin-edit';
import { aiAvailable } from '@/lib/menu-import/ai';
import { importMenu, parseImportInput, parsePreviewInput, previewFor } from '@/lib/menu-import';
import { sendCustomerWelcome } from '@/lib/customer-welcome';
import * as coupons from '@/lib/coupons';
import * as feeChanges from '@/lib/fee-changes';
import * as moderation from '@/lib/moderation';
import * as subscriptions from '@/lib/subscriptions';
import { money } from '@/lib/format';
import * as orders from '@/lib/orders';
import { onboardingMessage, sendOnboardingEmails } from '@/lib/restaurant-onboarding';
import { refreshRestaurantTax, setManualTaxRate } from '@/lib/restaurant-tax';
import { addTeamMember, checkTeamRemoval, editTeamMember, sendTeamResetCode, setTeamPassword, temporaryPassword, updateTeamMember } from '@/lib/team';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { SUSPENSION_DAYS } from '@/lib/constants';
import { checkAddress, dollars, emailSchema, int, parse, passwordSchema, restaurantFieldsSchema, taxRateSchema, usernameSchema } from '@/lib/validate';

// Owner console actions. Every action checks for an admin session and is written to the audit log.
const db = () => supabaseAdmin();
const note = (field: string, min = 0) => z.string().trim().min(min, `${field} must be at least ${min} characters.`).max(300, `${field} must be at most 300 characters.`);


// Each admin and employee works in one country, their location (United States or Canada): they only see and act on that
// country's restaurants, customers, orders and offers. The admin team itself is managed by admins across both.
type Target = { restaurantId?: number; userId?: string; orderId?: number; offerId?: number; alertId?: number };
async function inMyLocation(me: Viewer, t: Target) {
  let country: string | null | undefined;
  if (t.restaurantId !== undefined) country = (await db().from('restaurants').select('country').eq('id', t.restaurantId).maybeSingle()).data?.country;
  else if (t.userId !== undefined) {
    const p = (await db().from('profiles').select('country, role').eq('id', t.userId).maybeSingle()).data;
    if (p?.role === 'admin' || p?.role === 'support') return; // team accounts: see checkTeamTarget
    country = p?.country;
  } else if (t.orderId !== undefined) country = (await db().from('orders').select('restaurants(country)').eq('id', t.orderId).maybeSingle()).data?.restaurants?.country;
  else if (t.offerId !== undefined) country = (await db().from('offers').select('restaurants(country)').eq('id', t.offerId).maybeSingle()).data?.restaurants?.country;
  else if (t.alertId !== undefined) country = (await db().from('admin_alerts').select('profiles!admin_alerts_user_id_fkey(country)').eq('id', t.alertId).maybeSingle()).data?.profiles?.country;
  if (country !== me.country) throw new AppError(404, `Not found in your location (${me.country === 'CA' ? 'Canada' : 'United States'}).`);
}

const days = z.number().int().refine((n) => (SUSPENSION_DAYS as readonly number[]).includes(n), 'Choose a suspension length.').optional();

// Approve, reinstate, suspend for a number of days, or ban a restaurant for good (see src/lib/moderation.ts).
export async function setRestaurantStatus(input: unknown) {
  return action(async () => {
    const me = await requireAdmin('support');
    const d = parse(z.object({ id: z.number().int(), status: z.enum(['approved', 'suspended', 'banned', 'pending']), days, note: note('Note').default('') }), input);
    await inMyLocation(me, { restaurantId: d.id });
    const name = await moderation.setRestaurantStatus(d.id, d);
    await log(me.id, `restaurant.${d.status}`, 'restaurant', d.id, `${name}${d.days ? ` for ${d.days} days` : ''}${d.note ? `: ${d.note}` : ''}`);
    // Welcome email (signed agreement + kiosk link); the console shows whether it went out, and why not.
    if (d.status === 'approved') return { email: onboardingMessage(await sendOnboardingEmails(d.id)) };
    return { email: null };
  });
}

// Sends an approved restaurant its welcome email (again), e.g. after email settings were fixed.
export async function sendWelcomeEmail(input: unknown) {
  return action(async () => {
    const me = await requireAdmin('support');
    const d = parse(z.object({ id: z.number().int() }), input);
    await inMyLocation(me, { restaurantId: d.id });
    const r = must(await db().from('restaurants').select('name, status').eq('id', d.id).single());
    if (r.status !== 'approved') throw new AppError(409, 'Only approved restaurants get the welcome email.');
    const res = await sendOnboardingEmails(d.id, { resend: true });
    if (res.sent) await log(me.id, 'restaurant.welcome_email', 'restaurant', d.id, `${r.name}: sent to ${res.to}`);
    return { email: onboardingMessage(res) };
  });
}

// Admin employees manage customers' and restaurants' accounts, not the admin team's.
async function checkTeamTarget(me: Viewer, userId: string) {
  if (me.role === 'admin') return;
  const { data } = await db().from('profiles').select('role').eq('id', userId).maybeSingle();
  if (data?.role === 'admin' || data?.role === 'support') throw new AppError(403, 'Only an admin can change admin team accounts.');
}

// Reactivate, suspend for a number of days, or ban an account for good (see src/lib/moderation.ts).
export async function setUserStatus(input: unknown) {
  return action(async () => {
    const me = await requireAdmin('support');
    const d = parse(z.object({ id: z.string().uuid(), status: z.enum(['active', 'suspended', 'banned']), days, note: note('Reason').default('') }), input);
    if (d.id === me.id) throw new AppError(400, 'You cannot suspend or ban your own account.');
    await checkTeamTarget(me, d.id);
    await inMyLocation(me, { userId: d.id });
    const res = await moderation.setUserStatus(d.id, d);
    await log(me.id, res.action, 'user', d.id, res.details);
    return null;
  });
}

// Deletes an account (customer, restaurant owner or admin); see src/lib/moderation.ts.
export async function deleteUser(input: unknown) {
  return action(async () => {
    const me = await requireAdmin();
    const d = parse(z.object({ id: z.string().uuid() }), input);
    if (d.id === me.id) throw new AppError(400, 'You cannot delete your own account.');
    await inMyLocation(me, { userId: d.id });
    const res = await moderation.deleteAccount(d.id);
    await log(me.id, 'user.delete', 'user', d.id, res.details);
    return { anonymized: res.anonymized };
  });
}

// Deletes a restaurant and its owner's account.
export async function deleteRestaurant(input: unknown) {
  return action(async () => {
    const me = await requireAdmin();
    const d = parse(z.object({ id: z.number().int() }), input);
    await inMyLocation(me, { restaurantId: d.id });
    const res = await moderation.deleteRestaurant(d.id);
    await log(me.id, 'restaurant.delete', 'restaurant', d.id, res.details);
    return { anonymized: res.anonymized };
  });
}

// Goodwill platform credit, funded by Bite Wise.
export async function issueCredit(input: unknown) {
  return action(async () => {
    const me = await requireAdmin('refund');
    const d = parse(z.object({ userId: z.string().uuid(), amount: dollars('Credit amount', 0.01, 1000), reason: note('Reason', 3) }), input);
    await inMyLocation(me, { userId: d.userId });
    const balance = must(await db().rpc('issue_credit', { p_user: d.userId, p_amount_cents: d.amount, p_note: d.reason, p_by: me.id }));
    const u = must(await db().from('profiles').select('username').eq('id', d.userId).single());
    await log(me.id, 'credit.issue', 'user', d.userId, `${u.username}: ${money(d.amount)} - ${d.reason}`);
    return { balanceCents: balance };
  });
}

export async function adminCancelOrder(input: unknown) {
  return action(async () => {
    const me = await requireAdmin('support');
    const d = parse(z.object({ id: int('Order', 1, Number.MAX_SAFE_INTEGER), reason: note('Reason').default('') }), input);
    await inMyLocation(me, { orderId: d.id });
    const o = await orders.getOrder(d.id);
    if (o.status !== 'reserved' && o.status !== 'pending_payment') throw new AppError(409, 'Only orders awaiting pickup can be cancelled.');
    await orders.release(o.id, o.status, 'cancelled', true);
    await log(me.id, 'order.cancel', 'order', o.id, d.reason);
    return null;
  });
}

// All sales are final: food is sold as is and customers have no right to a refund (Customer Terms, Section 6), so food
// isn't bought and returned over and over. Bite Wise may still refund case by case, as a courtesy or for loyalty
// (admins, and employees allowed to): as platform credit (paid by Bite Wise; the restaurant keeps its payout) or back
// to how the customer paid (the restaurant gives up the matching part of its payout). Never the service fee.
// By percentage of what's left (food and its tax) or by amount; the reason is recorded in the audit log.
export async function refundOrder(input: unknown) {
  return action(async () => {
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
    const me = await requireAdmin('refund');
    await inMyLocation(me, { orderId: d.id });
    const o = await orders.getOrder(d.id);
    const refundable = orders.refundableCents(o); // never the service fee
    const amountCents = d.percent !== undefined
      ? Math.max(1, Math.round((refundable * d.percent) / 100))
      : parse(dollars('Refund amount', 0.01, refundable / 100), d.amount ?? '');
    const res = await orders.refundOrder(d.id, { amountCents, method: d.method, reason: d.reason, adminId: me.id });
    await log(
      me.id, d.method === 'credit' ? 'order.refund_credit' : 'order.refund', 'order', d.id,
      `Courtesy refund: ${money(amountCents)} ${d.method === 'credit' ? 'as platform credit' : `to ${[res.cardCents && `card ${money(res.cardCents)}`, res.creditCents && `credit ${money(res.creditCents)}`].filter(Boolean).join(' + ')}`} - ${d.reason}`,
    );
    return { amountCents };
  });
}

export async function endOffer(input: unknown) {
  return action(async () => {
    const me = await requireAdmin('support');
    const d = parse(z.object({ id: z.number().int(), reason: note('Reason').default('') }), input);
    await inMyLocation(me, { offerId: d.id });
    const o = must(await db().from('offers').update({ status: 'ended' }).eq('id', d.id).select('id, title, restaurants(name)').maybeSingle());
    await log(me.id, 'offer.remove', 'offer', o.id, `${o.title} (${o.restaurants?.name ?? ''})${d.reason ? `: ${d.reason}` : ''}`);
    return null;
  });
}

// Pays a restaurant its balance through Stripe Connect, or records a payout made outside Stripe.
// Invoice numbers and transaction details are assigned by the system and can't be edited.
export async function payRestaurant(input: unknown) {
  return action(async () => {
    const me = await requireAdmin();
    const d = parse(z.object({ restaurantId: z.number().int(), amount: dollars('Amount', 0.01, 1_000_000), note: note('Note').default(''), manual: z.boolean() }), input);
    await inMyLocation(me, { restaurantId: d.restaurantId });
    const r = must(await db().from('restaurants').select('name').eq('id', d.restaurantId).maybeSingle());
    const p = await orders.payRestaurant(d.restaurantId, d.amount, me.id, d.note, d.manual);
    await log(me.id, d.manual ? 'payout.record' : 'payout.transfer', 'restaurant', d.restaurantId, `${r.name}: ${money(d.amount)} (${p.invoice_number}, ${p.transaction_id})`);
    return { invoiceNumber: p.invoice_number, transactionId: p.transaction_id, bankDetails: p.bank_details };
  });
}

export async function updateSettings(input: unknown) {
  return action(async () => {
    const me = await requireAdmin();
    const d = parse(
      z.object({
        // A percentage of the food subtotal, or a fixed amount per order (same number in USD and CAD).
        serviceFeeMode: z.enum(['percent', 'fixed']).optional(),
        serviceFeePct: z.coerce.number().min(0, 'Service fee must be 0% to 30%.').max(30, 'Service fee must be 0% to 30%.'),
        serviceFeeFixed: z.coerce.number().min(0, 'The fixed service fee must be $0 to $20.').max(20, 'The fixed service fee must be $0 to $20.').optional(),
        defaultTaxRatePct: z.coerce.number().min(0, 'Sales tax must be 0% to 20%.').max(20, 'Sales tax must be 0% to 20%.'),
        requireRestaurantApproval: z.boolean(),
        // true: restaurants get the sales tax on their food and remit it; false: Bite Wise keeps and remits it.
        orderTaxToRestaurant: z.boolean().optional(),
        // Sales tax on plan fees in the admin's location (Washington or Newfoundland and Labrador).
        platformTaxPct: z.coerce.number().min(0, 'Sales tax on plan fees must be 0% to 20%.').max(20, 'Sales tax on plan fees must be 0% to 20%.').optional(),
        platformTaxLabel: z.string().trim().min(2, 'Name the tax, e.g. Washington (Seattle).').max(80).optional(),
      }),
      input,
    );
    const k = me.country.toLowerCase();
    const values = {
      service_fee_bps: Math.round(d.serviceFeePct * 100),
      ...(d.serviceFeeMode ? { service_fee_mode: d.serviceFeeMode } : {}),
      ...(d.serviceFeeFixed !== undefined ? { service_fee_fixed_cents: Math.round(d.serviceFeeFixed * 100) } : {}),
      default_tax_rate_bps: Math.round(d.defaultTaxRatePct * 100),
      require_restaurant_approval: d.requireRestaurantApproval,
      ...(d.orderTaxToRestaurant !== undefined ? { order_tax_to_restaurant: d.orderTaxToRestaurant } : {}),
      ...(d.platformTaxPct !== undefined ? { [`platform_tax_rate_bps_${k}`]: Math.round(d.platformTaxPct * 100) } : {}),
      ...(d.platformTaxLabel !== undefined ? { [`platform_tax_label_${k}`]: d.platformTaxLabel } : {}),
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

// Pioneer Member spots and when renewal reminders go out. (Prices change through a scheduled fee change.)
export async function updatePlanSettings(input: unknown) {
  return action(async () => {
    const me = await requireAdmin();
    const days = (what: string) => z.coerce.number().int(`${what} must be a whole number of days.`).min(1, `${what} must be 1 to 60 days.`).max(60, `${what} must be 1 to 60 days.`);
    const d = parse(
      z.object({
        foundingSpots: z.coerce.number().int('Pioneer spots must be a whole number.').min(0, 'Pioneer spots must be 0 to 10,000.').max(10000, 'Pioneer spots must be 0 to 10,000.'),
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
    await requireAdmin();
    return feeChanges.preview(feeChange(input));
  });
}

// Schedules new subscription fees (12:01 AM Pacific Time on the effective date) and emails every restaurant now.
export async function scheduleFeeChange(input: unknown) {
  return action(async () => {
    const me = await requireAdmin();
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
    const me = await requireAdmin();
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
    const me = await requireAdmin();
    const t = await feeChanges.saveTemplate(parse(templateSchema, input));
    await log(me.id, 'plans.template_save', 'settings', t.id, t.name);
    return t;
  });
}

export async function deleteFeeTemplate(id: number) {
  return action(async () => {
    const me = await requireAdmin();
    await feeChanges.deleteTemplate(parse(z.number().int(), id));
    await log(me.id, 'plans.template_delete', 'settings', id, '');
    return null;
  });
}

// Charges a delinquent restaurant's plan to its default card on file (for example after it says it fixed its card).
export async function chargeDelinquentPlan(input: unknown) {
  return action(async () => {
    const me = await requireAdmin();
    const d = parse(z.object({ restaurantId: z.number().int() }), input);
    await inMyLocation(me, { restaurantId: d.restaurantId });
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

// Marks missed-pickup alerts as seen (one, or all of them).
export async function markAlertsRead(input: unknown) {
  return action(async () => {
    const me = await requireAdmin('support');
    const d = parse(z.object({ id: z.number().int().optional() }), input);
    let q = db().from('admin_alerts').update({ read_at: new Date().toISOString(), read_by: me.id }).is('read_at', null);
    if (d.id) {
      await inMyLocation(me, { alertId: d.id });
      q = q.eq('id', d.id);
    } else {
      // All of this location's alerts.
      const mine = must(await db().from('admin_alerts').select('id, profiles!admin_alerts_user_id_fkey!inner(country)').is('read_at', null).eq('profiles.country', me.country));
      q = q.in('id', mine.map((a) => a.id));
    }
    check(await q);
    return null;
  });
}

// ---------------------------------------------------------------- sales tax rates

// Looks a restaurant's sales tax rate up again from its address (also hands a hand-set rate back to the lookup).
export async function recheckRestaurantTax(input: unknown) {
  return action(async () => {
    const me = await requireAdmin();
    const { restaurantId } = parse(z.object({ restaurantId: z.coerce.number().int().positive() }), input);
    await inMyLocation(me, { restaurantId });
    const res = await refreshRestaurantTax(restaurantId, { force: true });
    if (!res) throw new AppError(404, 'Restaurant not found.');
    await log(me.id, 'restaurant.tax_lookup', 'restaurant', restaurantId, `${res.rateBps} bps · ${res.jurisdiction}${res.kept ? ' (kept)' : ''}`);
    return res;
  });
}

// Sets a restaurant's sales tax rate by hand. The automatic lookup then leaves it alone until "Look up again".
export async function setRestaurantTaxRate(input: unknown) {
  return action(async () => {
    const me = await requireAdmin();
    const d = parse(taxRateSchema, input);
    await inMyLocation(me, { restaurantId: d.restaurantId });
    if (d.mode === 'auto') {
      const res = await refreshRestaurantTax(d.restaurantId, { force: true });
      await log(me.id, 'restaurant.tax_auto', 'restaurant', d.restaurantId, `${res?.rateBps} bps`);
      return res;
    }
    if (d.ratePct === undefined) throw new AppError(400, 'Enter the sales tax rate.');
    const rateBps = Math.round(d.ratePct * 100);
    await setManualTaxRate(d.restaurantId, rateBps, d.jurisdiction);
    await log(me.id, 'restaurant.tax_manual', 'restaurant', d.restaurantId, `${rateBps} bps${d.jurisdiction ? ` · ${d.jurisdiction}` : ''}`);
    return null;
  });
}

// ---------------------------------------------------------------- editing account details (src/lib/admin-edit.ts)

export async function updateUserAccount(input: unknown) {
  return action(async () => {
    const me = await requireAdmin('support');
    const d = parse(z.object({ id: z.string().uuid(), email: emailSchema, username: usernameSchema }), input);
    await checkTeamTarget(me, d.id);
    await inMyLocation(me, { userId: d.id });
    const changed = await updateAccount(d.id, { email: d.email, username: d.username });
    if (changed.length) await log(me.id, 'user.update', 'user', d.id, changed.join('; '));
    return { changed: changed.length };
  });
}

// A restaurant's details and its owner's email and user name.
export async function updateRestaurant(input: unknown) {
  return action(async () => {
    const me = await requireAdmin('support');
    const d = checkAddress(parse(restaurantFieldsSchema.pick({ name: true, address: true, city: true, state: true, zip: true, country: true, phone: true, cuisine: true }).extend({
      id: z.number().int(), description: z.string().trim().max(400).default(''), ownerEmail: emailSchema, ownerUsername: usernameSchema,
    }), input));
    await inMyLocation(me, { restaurantId: d.id });
    if (d.country !== me.country) throw new AppError(403, 'A restaurant can\'t be moved to another country.');
    const r = must(await db().from('restaurants').select('owner_id').eq('id', d.id).single());
    const owner = await updateAccount(r.owner_id, { email: d.ownerEmail, username: d.ownerUsername });
    const details = await updateRestaurantDetails(d.id, {
      name: d.name, cuisine: d.cuisine, description: d.description, address: d.address, city: d.city, state: d.state, zip: d.zip, country: d.country, phone: d.phone,
    });
    const changed = [...details, ...owner];
    if (changed.length) await log(me.id, 'restaurant.update', 'restaurant', d.id, changed.join('; '));
    return { changed: changed.length };
  });
}

// The customer congratulations email with the phone app buttons (src/lib/customer-welcome.ts), sent again.
export async function sendCustomerWelcomeEmail(input: unknown) {
  return action(async () => {
    const me = await requireAdmin('support');
    const { id } = parse(z.object({ id: z.string().uuid() }), input);
    await inMyLocation(me, { userId: id });
    const res = await sendCustomerWelcome(id, { resend: true });
    if (!res.sent) {
      const why = { not_found: 'Account not found.', not_customer: 'Only customers get this email.', not_confirmed: `${res.to} hasn't confirmed their email yet. The welcome email is sent once they do.`, already_sent: '', failed: `The email to ${res.to} couldn't be sent. Check the email settings (SMTP).` };
      throw new AppError(409, why[res.reason]);
    }
    await log(me.id, 'user.welcome_email', 'user', id, `sent to ${res.to}`);
    return { to: res.to };
  });
}

// ---------------------------------------------------------------- menu import for a restaurant (src/lib/menu-import)

export async function adminPreviewMenuImport(input: unknown) {
  return action(async () => {
    await requireAdmin('support');
    const d = parsePreviewInput(input);
    return previewFor(d);
  });
}

export async function adminImportMenu(input: unknown) {
  return action(async () => {
    const me = await requireAdmin('support');
    const { restaurantId } = parse(z.object({ restaurantId: z.number().int() }), { restaurantId: (input as { restaurantId?: unknown })?.restaurantId });
    const d = parseImportInput(input);
    await inMyLocation(me, { restaurantId });
    const r = must(await db().from('restaurants').select('name').eq('id', restaurantId).neq('status', 'deleted').single());
    const res = await importMenu(restaurantId, d.items, { updateExisting: d.updateExisting });
    await log(me.id, 'restaurant.menu_import', 'restaurant', restaurantId, `${r.name}: ${res.added} added, ${res.updated} updated, ${res.skipped} skipped`);
    return res;
  });
}

// ---------------------------------------------------------------- the admin team (admins only; src/lib/team.ts)

export async function addTeamMemberAction(input: unknown) {
  return action(async () => {
    const me = await requireAdmin();
    const d = parse(z.object({ email: emailSchema, username: usernameSchema, password: passwordSchema, role: z.enum(['admin', 'support']), country: z.enum(['US', 'CA']), canRefund: z.boolean().default(false) }), input);
    const id = await addTeamMember(me.id, d);
    await log(me.id, 'team.add', 'user', id, `${d.username} (${d.role === 'admin' ? 'admin' : `employee${d.canRefund ? ', refunds' : ''}`}, ${d.country === 'CA' ? 'Canada' : 'United States'})`);
    return null;
  });
}

export async function updateTeamMemberAction(input: unknown) {
  return action(async () => {
    const me = await requireAdmin();
    const d = parse(z.object({ id: z.string().uuid(), role: z.enum(['admin', 'support']), canRefund: z.boolean(), country: z.enum(['US', 'CA']).optional() }), input);
    await updateTeamMember(me.id, d.id, d);
    await log(me.id, 'team.update', 'user', d.id, `${d.role === 'admin' ? 'admin' : `employee${d.canRefund ? ', refunds' : ', no refunds'}`}${d.country ? `, ${d.country === 'CA' ? 'Canada' : 'United States'}` : ''}`);
    return null;
  });
}

// A team member's email address and user name.
export async function editTeamMemberAction(input: unknown) {
  return action(async () => {
    const me = await requireAdmin();
    const d = parse(z.object({ id: z.string().uuid(), email: emailSchema, username: usernameSchema }), input);
    const changed = await editTeamMember(d.id, d);
    if (changed.length) await log(me.id, 'team.edit', 'user', d.id, changed.join('; '));
    return { changed: changed.length };
  });
}

// Sets a team member's password: one the admin chose, or a generated temporary one (returned once, so the admin can
// pass it on) that must be changed at the next log-in. Optionally emailed to them.
export async function setTeamPasswordAction(input: unknown) {
  return action(async () => {
    const me = await requireAdmin();
    const d = parse(z.object({
      id: z.string().uuid(), mode: z.enum(['set', 'temporary']), password: z.string().optional(), confirm: z.string().optional(), email: z.boolean().default(false),
    }), input);
    let password: string;
    if (d.mode === 'temporary') password = temporaryPassword();
    else {
      password = parse(passwordSchema, d.password ?? '');
      if (password !== d.confirm) throw new AppError(400, 'The two passwords don\'t match.');
    }
    const p = await setTeamPassword(d.id, password, { temporary: d.mode === 'temporary', email: d.email });
    await log(me.id, d.mode === 'temporary' ? 'team.temporary_password' : 'team.set_password', 'user', d.id, `${p.username}${d.email ? ' (emailed)' : ''}`);
    return { password: d.mode === 'temporary' ? password : null };
  });
}

// Emails a team member a code to choose their own new password.
export async function sendTeamResetCodeAction(input: unknown) {
  return action(async () => {
    const me = await requireAdmin();
    const { id } = parse(z.object({ id: z.string().uuid() }), input);
    const p = await sendTeamResetCode(id);
    await log(me.id, 'team.reset_code', 'user', id, p.username);
    return { email: p.email };
  });
}

export async function removeTeamMemberAction(input: unknown) {
  return action(async () => {
    const me = await requireAdmin();
    const { id } = parse(z.object({ id: z.string().uuid() }), input);
    await checkTeamRemoval(me.id, id);
    const res = await moderation.deleteAccount(id);
    await log(me.id, 'team.remove', 'user', id, JSON.stringify(res).slice(0, 200));
    return null;
  });
}

export async function adminMenuImportOptions() {
  return action(async () => {
    await requireAdmin('support');
    return { ai: aiAvailable() };
  });
}

// ---------------------------------------------------------------- coupons (admins; src/lib/coupons.ts)

export async function createCouponAction(input: unknown) {
  return action(async () => {
    const me = await requireAdmin();
    const d = parse(z.object({
      code: z.string().trim().max(24).optional(),
      kind: z.enum(['no_fee', 'fixed', 'percent'], { message: 'Choose the kind of coupon.' }),
      amount: z.union([z.string(), z.number()]).optional(),
      percent: z.coerce.number().int('Use a whole percentage.').min(1, 'Enter a percentage from 1 to 100.').max(100, 'Enter a percentage from 1 to 100.').optional(),
      description: z.string().trim().max(300).default(''),
      expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the expiration date.'),
    }), input);
    const amountCents = d.kind === 'fixed' ? parse(dollars('Amount off', 0.01, 1000), d.amount ?? '') : undefined;
    const c = await coupons.createCoupon(me.id, me.country, { ...d, amountCents, percent: d.kind === 'percent' ? d.percent : undefined });
    await log(me.id, 'coupon.create', 'coupon', c.id, `${c.code}: ${coupons.couponOffer(c)}, until ${d.expiresOn}`);
    return { id: c.id, code: c.code };
  });
}

export async function setCouponActiveAction(input: unknown) {
  return action(async () => {
    const me = await requireAdmin();
    const d = parse(z.object({ id: z.number().int(), active: z.boolean() }), input);
    const code = await coupons.setCouponActive(d.id, me.country, d.active);
    await log(me.id, d.active ? 'coupon.on' : 'coupon.off', 'coupon', d.id, code);
    return null;
  });
}

const couponEmailSchema = z.object({ id: z.number().int(), subject: z.string().trim().max(200), body: z.string().trim().max(5000) });

// The coupon email as customers will see it (with a sample name), and how many customers it goes to.
export async function previewCouponEmailAction(input: unknown) {
  return action(async () => {
    const me = await requireAdmin();
    const d = parse(couponEmailSchema, input);
    return coupons.previewCouponEmail(d.id, me.country, d);
  });
}

export async function emailCouponAction(input: unknown) {
  return action(async () => {
    const me = await requireAdmin();
    const d = parse(couponEmailSchema.extend({ templateName: z.string().trim().max(60).default('') }), input);
    const res = await coupons.emailCoupon(d.id, me.country, d);
    await log(me.id, 'coupon.email', 'coupon', d.id, `${res.code} to ${res.customers} customers${d.templateName ? ` (${d.templateName})` : ''}: ${d.subject}`);
    return res;
  });
}

const couponTemplateSchema = z.object({
  id: z.number().int().nullish(),
  name: z.string().trim().min(2, 'Name the template.').max(60),
  subject: z.string().trim().min(2, 'Write a subject.').max(200),
  body: z.string().trim().min(2, 'Write the message.').max(5000),
});

export async function saveCouponTemplateAction(input: unknown) {
  return action(async () => {
    const me = await requireAdmin();
    const t = await coupons.saveCouponTemplate(parse(couponTemplateSchema, input));
    await log(me.id, 'coupon.template_save', 'coupon_template', t.id, t.name);
    return t;
  });
}

export async function deleteCouponTemplateAction(id: number) {
  return action(async () => {
    const me = await requireAdmin();
    await coupons.deleteCouponTemplate(parse(z.number().int(), id));
    await log(me.id, 'coupon.template_delete', 'coupon_template', id, '');
    return null;
  });
}
