import 'server-only';
import { randomBytes } from 'node:crypto';
import { after } from 'next/server';
import { couponEmail } from '@/lib/email/templates';
import { sendEmail } from '@/lib/email/send';
import { publicEnv, serverEnv } from '@/lib/env';
import { AppError, check, must } from '@/lib/errors';
import { money } from '@/lib/format';
import { dayRange } from '@/lib/receipts/time';
import type { Country } from '@/lib/regions';
import { supabaseAdmin } from '@/lib/supabase/admin';

// Coupons (supabase/migrations/20261021000100_coupons.sql). An admin makes them for their location's customers and
// emails them out; customers enter the code at checkout.
//   no_fee:  the Bite Wise service fee is waived (Bite Wise pays for it).
//   fixed:   a set amount off the food; percent: a percentage off the food (the restaurant pays for these, as the
//            Restaurant Partner Agreement says).

const db = () => supabaseAdmin();
export type CouponKind = 'no_fee' | 'fixed' | 'percent';
type Row = { kind: CouponKind; amount_cents: number | null; percent: number | null; country: string };

// "No service fee", "$5.00 off your food", "20% off your food".
export const couponOffer = (c: Row) =>
  c.kind === 'no_fee' ? 'No service fee' : c.kind === 'fixed' ? `${money(c.amount_cents ?? 0, c.country === 'CA' ? 'cad' : 'usd')} off your food` : `${c.percent}% off your food`;

const expiryText = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: serverEnv.timeZone });

export function newCouponCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I
  return `BW-${[...randomBytes(6)].map((b) => abc[b % abc.length]).join('')}`;
}

export async function createCoupon(by: string, country: Country, o: {
  code?: string; kind: CouponKind; amountCents?: number; percent?: number; description: string; expiresOn: string;
}) {
  const code = (o.code?.trim() || newCouponCode()).toUpperCase();
  if (!/^[A-Z0-9-]{3,24}$/.test(code)) throw new AppError(400, 'Coupon codes are 3 to 24 letters, numbers or dashes.');
  // Valid through the end of the chosen day (Bite Wise's time zone).
  const expiresAt = dayRange(o.expiresOn, serverEnv.timeZone).end;
  if (Date.parse(expiresAt) <= Date.now()) throw new AppError(400, 'Choose an expiration date in the future.');
  if (o.kind === 'fixed' && !(o.amountCents && o.amountCents > 0)) throw new AppError(400, 'Enter the amount off.');
  if (o.kind === 'percent' && !(o.percent && o.percent >= 1 && o.percent <= 100)) throw new AppError(400, 'Enter a percentage from 1 to 100.');
  const { data, error } = await db().from('coupons').insert({
    code, kind: o.kind, country, description: o.description, expires_at: expiresAt, created_by: by,
    amount_cents: o.kind === 'fixed' ? o.amountCents! : null, percent: o.kind === 'percent' ? o.percent! : null,
  }).select('*').single();
  if (error?.code === '23505') throw new AppError(409, `The code ${code} is already used. Choose another.`);
  if (error) throw new AppError(400, error.message);
  return data;
}

// The coupons of a location, newest first, with how often they were used and what they took off.
export async function listCoupons(country: Country) {
  const [coupons, used] = await Promise.all([
    must(await db().from('coupons').select('*').eq('country', country).order('created_at', { ascending: false }).limit(500)),
    must(await db().from('orders').select('coupon_id, coupon_discount_cents, coupon_fee_waived_cents, status').not('coupon_id', 'is', null).not('status', 'in', '(cancelled,failed)')),
  ]);
  return coupons.map((c) => {
    const mine = used.filter((u) => u.coupon_id === c.id);
    return {
      id: c.id, code: c.code, kind: c.kind as CouponKind, offer: couponOffer(c), description: c.description, expiresAt: c.expires_at,
      expired: Date.parse(c.expires_at) <= Date.now(), active: c.active, createdAt: c.created_at, emailedAt: c.emailed_at, emailedCount: c.emailed_count, emailSubject: c.email_subject,
      uses: mine.length,
      // Paid by restaurants (food discounts) and by Bite Wise (waived fees).
      restaurantCostCents: mine.reduce((n, u) => n + u.coupon_discount_cents, 0),
      bitewiseCostCents: mine.reduce((n, u) => n + u.coupon_fee_waived_cents, 0),
    };
  });
}

async function couponOf(id: number, country: Country) {
  const c = must(await db().from('coupons').select('*').eq('id', id).maybeSingle());
  if (!c || c.country !== country) throw new AppError(404, 'Coupon not found.');
  return c;
}

export async function setCouponActive(id: number, country: Country, active: boolean) {
  const c = await couponOf(id, country);
  check(await db().from('coupons').update({ active }).eq('id', id));
  return c.code;
}

// ---------------------------------------------------------------- coupon emails

// Placeholders in coupon email templates.
export const COUPON_PLACEHOLDERS = ['name', 'code', 'offer', 'expires', 'message'] as const;
export type CouponEmailText = { subject: string; body: string };

export async function listCouponTemplates() {
  return must(await db().from('coupon_email_templates').select('*').order('id'));
}

export async function saveCouponTemplate(t: { id?: number | null; name: string; subject: string; body: string }) {
  const row = { name: t.name, subject: t.subject, body: t.body, updated_at: new Date().toISOString() };
  const saved = t.id
    ? must(await db().from('coupon_email_templates').update(row).eq('id', t.id).select('*').maybeSingle())
    : must(await db().from('coupon_email_templates').insert(row).select('*').single());
  if (!saved) throw new AppError(404, 'Template not found.');
  return saved;
}

export async function deleteCouponTemplate(id: number) {
  check(await db().from('coupon_email_templates').delete().eq('id', id));
}

type CouponRow = Awaited<ReturnType<typeof couponOf>>;
const fill = (text: string, vars: Record<string, string>) => text.replace(/\{\{\s*(\w+)\s*\}\}/g, (all, k: string) => vars[k] ?? all);
const dealsUrl = () => `${publicEnv.siteUrl.replace(/\/$/, '')}/offers`;

// The email one customer gets, with the placeholders filled in.
function couponMail(c: CouponRow, t: CouponEmailText, username: string) {
  const vars = { name: username, code: c.code, offer: couponOffer(c), expires: expiryText(c.expires_at), message: c.description };
  return couponEmail({ subject: fill(t.subject, vars), body: fill(t.body, vars), code: c.code, offer: vars.offer, expires: vars.expires, dealsUrl: dealsUrl() });
}

function checkText(t: CouponEmailText) {
  if (t.subject.trim().length < 2) throw new AppError(400, 'Write a subject for the email.');
  if (t.body.trim().length < 2) throw new AppError(400, 'Write the email message.');
}

// What customers will get (shown with a sample name before sending).
export async function previewCouponEmail(id: number, country: Country, t: CouponEmailText) {
  checkText(t);
  const c = await couponOf(id, country);
  const { count } = await db().from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'customer').eq('status', 'active').eq('country', country);
  const mail = couponMail(c, t, 'Alex');
  return { subject: mail.subject, html: mail.html, customers: count ?? 0 };
}

// Emails the coupon to every active customer in its country. The emails go out after the response (one at a time
// would take long for many customers); the count is recorded as they're sent.
export async function emailCoupon(id: number, country: Country, t: CouponEmailText) {
  checkText(t);
  const c = await couponOf(id, country);
  if (!c.active || Date.parse(c.expires_at) <= Date.now()) throw new AppError(409, 'This coupon is turned off or expired.');
  const customers = must(await db().from('profiles').select('email, username').eq('role', 'customer').eq('status', 'active').eq('country', country));
  check(await db().from('coupons').update({ emailed_at: new Date().toISOString(), email_subject: t.subject.slice(0, 200) }).eq('id', id));
  after(async () => {
    let sent = 0;
    for (let i = 0; i < customers.length; i += 10) {
      const batch = await Promise.all(customers.slice(i, i + 10).map((p) => sendEmail({ to: p.email, ...couponMail(c, t, p.username) }).catch(() => false)));
      sent += batch.filter(Boolean).length;
    }
    await db().from('coupons').update({ emailed_count: c.emailed_count + sent }).eq('id', id);
  });
  return { code: c.code, customers: customers.length };
}
