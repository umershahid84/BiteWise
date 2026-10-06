import 'server-only';
import type { Database } from '@/lib/database.types';
import { sendEmail } from '@/lib/email/send';
import { feeChangeEmail } from '@/lib/email/templates';
import { publicEnv, serverEnv } from '@/lib/env';
import { AppError, check, maybe, must } from '@/lib/errors';
import { supabaseAdmin } from '@/lib/supabase/admin';

// Subscription fee changes (supabase/migrations/20261009000100_fee_changes.sql). An admin schedules new prices that
// take effect at 12:01 AM Pacific Time on a chosen date; every restaurant is emailed at once. When the change takes
// effect (applyDuePriceChanges, run by the scheduled jobs) the prices are switched, and either the existing plans
// keep their current prices (locked) or they pay the new prices from their next renewal.

export type PriceChange = Database['public']['Tables']['subscription_price_changes']['Row'];
export type FeeTemplate = Database['public']['Tables']['fee_email_templates']['Row'];
type Sub = Database['public']['Tables']['restaurant_subscriptions']['Row'];
type PaidPlan = 'monthly' | 'annual';
// Pioneer Members (and the old founding plan) pay nothing, so fee changes don't touch them.
const pioneer = (sub: Pick<Sub, 'plan' | 'founding_number'> | null | undefined) => !!sub && (sub.plan === 'founding' || sub.founding_number != null);

const db = () => supabaseAdmin();
export const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// ---------------------------------------------------------------- time

// Minutes the business time zone is ahead of UTC at that moment (e.g. -480 for PST, -420 for PDT).
function zoneOffsetMinutes(at: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: serverEnv.timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return Math.round((Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute')) - at.getTime()) / 60_000);
}

// 12:01 AM Pacific Time on a YYYY-MM-DD date.
export function effectiveInstant(date: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new AppError(400, 'Choose the date the new fees take effect.');
  const local = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 1);
  let t = local - zoneOffsetMinutes(new Date(local)) * 60_000;
  t = local - zoneOffsetMinutes(new Date(t)) * 60_000; // once more, in case the first guess crossed a DST switch
  return new Date(t);
}

// "Friday, November 6, 2026"
export function effectiveDay(at: Date | string) {
  return new Date(at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: serverEnv.timeZone });
}

// "Friday, November 6, 2026 at 12:01 AM PST"
export function effectiveLabel(at: Date | string) {
  const d = new Date(at);
  const day = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: serverEnv.timeZone });
  const zone = new Intl.DateTimeFormat('en-US', { timeZone: serverEnv.timeZone, timeZoneName: 'short' }).formatToParts(d).find((p) => p.type === 'timeZoneName')?.value ?? 'PT';
  return `${day} at 12:01 AM ${zone}`;
}

// ---------------------------------------------------------------- prices

export type PriceContext = { monthlyCents: number; annualCents: number; pending: PriceChange | null };

export async function priceContext(): Promise<PriceContext> {
  const [rows, pending] = await Promise.all([
    db().from('settings').select('key, value').in('key', ['subscription_monthly_cents', 'subscription_annual_cents']),
    pendingChange(),
  ]);
  const get = (key: string, fallback: number) => Number(must(rows).find((r) => r.key === key)?.value ?? fallback);
  return { monthlyCents: get('subscription_monthly_cents', 1500), annualCents: get('subscription_annual_cents', 15000), pending };
}

export async function pendingChange() {
  return maybe(await db().from('subscription_price_changes').select('*').is('applied_at', null).is('cancelled_at', null)
    .order('effective_at').limit(1).maybeSingle());
}

// What a plan costs when it is charged at `at`: a locked (grandfathered) price, else the price in effect then. A
// scheduled change counts from its effective time, for new plans always, and for existing plans only if it applies
// to them (otherwise they keep today's price, which gets locked when the change takes effect).
export function planPrice(ctx: PriceContext, sub: Pick<Sub, 'plan' | 'status' | 'founding_number' | 'locked_monthly_cents' | 'locked_annual_cents'> | null, plan: PaidPlan, at: Date) {
  if (pioneer(sub) && sub!.status === 'active') return 0;
  const locked = plan === 'annual' ? sub?.locked_annual_cents : sub?.locked_monthly_cents;
  if (locked) return locked;
  const current = plan === 'annual' ? ctx.annualCents : ctx.monthlyCents;
  const p = ctx.pending;
  if (!p || at < new Date(p.effective_at)) return current;
  const existing = sub && sub.plan !== 'founding' && sub.status !== 'expired';
  if (existing && !p.applies_to_existing) return current;
  return plan === 'annual' ? p.annual_cents : p.monthly_cents;
}

// ---------------------------------------------------------------- templates

export async function listTemplates() {
  return must(await db().from('fee_email_templates').select('*').order('id'));
}

export async function saveTemplate(t: { id?: number | null; name: string; subject: string; body: string }) {
  const row = { name: t.name, subject: t.subject, body: t.body, updated_at: new Date().toISOString() };
  return t.id
    ? must(await db().from('fee_email_templates').update(row).eq('id', t.id).select('*').maybeSingle())
    : must(await db().from('fee_email_templates').insert(row).select('*').single());
}

export async function deleteTemplate(id: number) {
  check(await db().from('fee_email_templates').delete().eq('id', id));
}

// ---------------------------------------------------------------- the email

export type FeeChangeInput = {
  monthlyCents: number; annualCents: number; effectiveDate: string; appliesToExisting: boolean;
  templateName: string; subject: string; body: string; includeFounding: boolean;
};

type Recipient = { restaurantId: number; name: string; email: string; sub: Sub | null };

// Restaurants that are told about a fee change: everyone still on Bite Wise (not banned or deleted), except Pioneer
// Partners unless asked (their plan stays free).
async function recipients(includeFounding: boolean): Promise<Recipient[]> {
  const rows = must(await db().from('restaurants').select('id, name, status, profiles!restaurants_owner_id_fkey(email, status), restaurant_subscriptions(*)')
    .in('status', ['pending', 'approved', 'suspended']));
  return rows
    .filter((r) => r.profiles && r.profiles.status !== 'deleted' && r.profiles.status !== 'banned')
    .map((r) => ({ restaurantId: r.id, name: r.name, email: r.profiles!.email, sub: (r.restaurant_subscriptions as Sub | null) ?? null }))
    .filter((r) => includeFounding || !pioneer(r.sub));
}

export async function recipientCounts() {
  const all = await recipients(true);
  const founding = all.filter((r) => pioneer(r.sub)).length;
  return { withoutFounding: all.length - founding, founding };
}

// What the change means for this restaurant ({{your_plan}}).
function yourPlan(r: Recipient, c: FeeChangeInput & { previousMonthlyCents: number; previousAnnualCents: number }, when: string) {
  const s = r.sub;
  if (pioneer(s)) return 'As a Pioneer Member, your plan stays FREE: nothing changes for you.';
  const paid = s && s.status !== 'expired';
  const per = (plan: PaidPlan) => (plan === 'annual' ? 'year' : 'month');
  if (!paid) return `If you choose a plan on or after ${when}, the new prices apply: ${usd(c.monthlyCents)} a month or ${usd(c.annualCents)} a year.`;
  const plan = ((s.renew_plan ?? s.plan) as PaidPlan);
  const locked = plan === 'annual' ? s.locked_annual_cents : s.locked_monthly_cents;
  // A change that applies to existing plans also ends any earlier lock.
  if (!c.appliesToExisting) {
    const keep = locked ?? (plan === 'annual' ? c.previousAnnualCents : c.previousMonthlyCents);
    return `Good news: as an existing partner, your restaurant keeps its current price of ${usd(keep)} per ${per(plan)} for as long as your plan stays active.`;
  }
  const newPrice = plan === 'annual' ? c.annualCents : c.monthlyCents;
  return `Your ${plan} plan will be charged the new price of ${usd(newPrice)} per ${per(plan)} from your first renewal on or after ${when}. You can turn off auto-renewal or switch plans any time in the Plan tab.`;
}

function fill(text: string, vars: Record<string, string>) {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (all, k: string) => vars[k] ?? all);
}

function render(r: Recipient, c: FeeChangeInput & { previousMonthlyCents: number; previousAnnualCents: number }) {
  const at = effectiveInstant(c.effectiveDate);
  const when = effectiveLabel(at);
  const vars = {
    // Just the date: the templates say "at 12:01 AM Pacific Time" themselves.
    restaurant: r.name, effective_date: effectiveDay(at),
    old_monthly: usd(c.previousMonthlyCents), new_monthly: usd(c.monthlyCents), old_annual: usd(c.previousAnnualCents), new_annual: usd(c.annualCents),
    your_plan: yourPlan(r, c, effectiveDay(at)),
  };
  return feeChangeEmail({
    subject: fill(c.subject, vars), body: fill(c.body, vars), effective: when,
    oldMonthlyCents: c.previousMonthlyCents, newMonthlyCents: c.monthlyCents, oldAnnualCents: c.previousAnnualCents, newAnnualCents: c.annualCents,
    planUrl: `${publicEnv.siteUrl}/restaurant?tab=plan`,
  });
}

function checkInput(c: FeeChangeInput) {
  if (c.subject.trim().length < 3) throw new AppError(400, 'Write a subject for the email.');
  if (c.body.trim().length < 20) throw new AppError(400, 'Write the email message.');
  effectiveInstant(c.effectiveDate);
}

// A preview of the email for one restaurant (an existing paid one if there is one).
export async function preview(c: FeeChangeInput) {
  checkInput(c);
  const ctx = await priceContext();
  const list = await recipients(c.includeFounding);
  const sample = list.find((r) => r.sub && !pioneer(r.sub) && r.sub.status !== 'expired') ?? list[0]
    ?? { restaurantId: 0, name: 'Your Restaurant', email: 'owner@example.com', sub: null };
  const email = render(sample, { ...c, previousMonthlyCents: ctx.monthlyCents, previousAnnualCents: ctx.annualCents });
  // In the browser the logo comes from the site (emails carry it as an attachment).
  const html = email.html.replace('cid:logo', `${publicEnv.siteUrl}/assets/email-logo.png`);
  return { to: sample.name, subject: email.subject, html, recipients: list.length };
}

// Schedules a fee change and emails every restaurant now. Only one change can be scheduled at a time.
export async function scheduleChange(c: FeeChangeInput, adminId: string) {
  checkInput(c);
  if (await pendingChange()) throw new AppError(409, 'A fee change is already scheduled. Cancel it first.');
  const ctx = await priceContext();
  const at = effectiveInstant(c.effectiveDate);
  const today = new Date(Date.now() - 24 * 3_600_000);
  if (at < today) throw new AppError(400, 'The effective date can\'t be in the past.');
  if (c.monthlyCents === ctx.monthlyCents && c.annualCents === ctx.annualCents) throw new AppError(400, 'The new prices are the same as the current ones.');
  const change = must(await db().from('subscription_price_changes').insert({
    monthly_cents: c.monthlyCents, annual_cents: c.annualCents, previous_monthly_cents: ctx.monthlyCents, previous_annual_cents: ctx.annualCents,
    effective_at: at.toISOString(), applies_to_existing: c.appliesToExisting, template_name: c.templateName, subject: c.subject, body: c.body,
    include_founding: c.includeFounding, created_by: adminId,
  }).select('*').single());

  const full = { ...c, previousMonthlyCents: ctx.monthlyCents, previousAnnualCents: ctx.annualCents };
  let sent = 0;
  let failed = 0;
  for (const r of await recipients(c.includeFounding)) {
    try {
      if (await sendEmail({ to: r.email, ...render(r, full) })) sent++;
      else failed++;
    } catch (err) {
      failed++;
      console.error(`fee change email to ${r.email}:`, err);
    }
  }
  check(await db().from('subscription_price_changes').update({ emails_sent: sent, emails_failed: failed }).eq('id', change.id));
  return { id: change.id, effectiveAt: change.effective_at, sent, failed };
}

export async function cancelChange(id: number) {
  const c = must(await db().from('subscription_price_changes').update({ cancelled_at: new Date().toISOString() })
    .eq('id', id).is('applied_at', null).is('cancelled_at', null).select('id').maybeSingle());
  return c;
}

export async function history() {
  return must(await db().from('subscription_price_changes').select('*, profiles(username)').order('id', { ascending: false }).limit(20));
}

// Scheduled job: switches to the new prices once a change takes effect. Existing paid plans either keep their
// current prices (locked) or lose any earlier lock so they pay the new prices from their next renewal.
export async function applyDuePriceChanges() {
  const due = must(await db().from('subscription_price_changes').select('*').is('applied_at', null).is('cancelled_at', null)
    .lte('effective_at', new Date().toISOString()).order('effective_at'));
  for (const c of due) {
    const existing = (patch: Partial<Sub>) =>
      db().from('restaurant_subscriptions').update(patch).neq('plan', 'founding').is('founding_number', null).in('status', ['active', 'past_due']);
    if (c.applies_to_existing) {
      check(await existing({ locked_monthly_cents: null, locked_annual_cents: null }));
    } else {
      check(await existing({ locked_monthly_cents: c.previous_monthly_cents }).is('locked_monthly_cents', null));
      check(await existing({ locked_annual_cents: c.previous_annual_cents }).is('locked_annual_cents', null));
    }
    for (const [key, value] of [['subscription_monthly_cents', c.monthly_cents], ['subscription_annual_cents', c.annual_cents]] as const) {
      check(await db().from('settings').upsert({ key, value, updated_at: new Date().toISOString() }));
    }
    check(await db().from('subscription_price_changes').update({ applied_at: new Date().toISOString() }).eq('id', c.id));
  }
  return due.length;
}
