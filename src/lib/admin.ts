import 'server-only';
import type { Database } from '@/lib/database.types';
import { serverEnv } from '@/lib/env';
import { AppError, must } from '@/lib/errors';
import { dollars, toCsv } from '@/lib/receipts/data';
import { dayKey, dayRange, todayIn } from '@/lib/receipts/time';
import { prices } from '@/lib/subscriptions';
import { supabaseAdmin } from '@/lib/supabase/admin';

// Owner/admin console data. Callers must check that the user is an admin first (see requireActor('admin')).
//
// refunded_cents = refunds to the customer's ORIGINAL payment: the restaurant gives up its share of the
// food subtotal and Bite Wise gives up its fee share. credited_cents = refunds issued as PLATFORM CREDIT,
// funded by Bite Wise; the restaurant keeps its full food sales.

type Order = Database['public']['Tables']['orders']['Row'];
const db = () => supabaseAdmin();
const tz = () => serverEnv.timeZone;

const foodRefund = (o: Order) => (o.refunded_cents && o.total_cents ? Math.round((o.refunded_cents * o.subtotal_cents) / o.total_cents) : 0);
const feeRefund = (o: Order) => (o.refunded_cents && o.total_cents ? Math.round((o.refunded_cents * o.service_fee_cents) / o.total_cents) : 0);
const taxRefund = (o: Order) => (o.refunded_cents && o.total_cents ? o.refunded_cents - foodRefund(o) - feeRefund(o) : 0);

// Reads every row of a query in pages of 1000 (PostgREST's default row limit).
async function all<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query(from, from + 999);
    if (error) throw new AppError(500, error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

// Date range from ?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive, Pacific Time), default: last `days` days.
export function range(params: URLSearchParams, days = 30) {
  const valid = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
  const today = todayIn(tz());
  const to = params.get('to') || today;
  const from = params.get('from') || dayKey(new Date(Date.parse(`${to}T12:00:00Z`) - (days - 1) * 86400000).toISOString(), tz());
  if (!valid(from) || !valid(to) || from > to) throw new AppError(400, 'Please choose a valid date range.');
  return { from, to, start: dayRange(from, tz()).start, end: dayRange(to, tz()).end };
}

const pickedUpBetween = (start: string, end: string) =>
  all<Order>((a, b) => db().from('orders').select('*').eq('status', 'picked_up').gte('picked_up_at', start).lt('picked_up_at', end).range(a, b));

// ---------------------------------------------------------------- overview

export async function overview(params: URLSearchParams) {
  const r = range(params);
  const [sold, placed, restaurants, customers, liveOffers, awaiting, balances, credit] = await Promise.all([
    pickedUpBetween(r.start, r.end),
    all<{ status: Order['status'] }>((a, b) => db().from('orders').select('status').gte('created_at', r.start).lt('created_at', r.end).neq('status', 'failed').range(a, b)),
    all<{ id: number; name: string; city: string; status: string }>((a, b) => db().from('restaurants').select('id, name, city, status').range(a, b)),
    db().from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'customer'),
    db().from('offers').select('id', { count: 'exact', head: true }).eq('status', 'active').gt('pickup_end', new Date().toISOString()),
    db().from('orders').select('id', { count: 'exact', head: true }).eq('status', 'reserved'),
    db().from('restaurant_balances').select('balance_cents'),
    all<{ amount_cents: number }>((a, b) => db().from('credit_ledger').select('amount_cents').range(a, b)),
  ]);
  const sum = (f: (o: Order) => number) => sold.reduce((n, o) => n + f(o), 0);
  const byStatus: Record<string, number> = {};
  for (const p of placed) byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;

  const days: string[] = [];
  for (let t = Date.parse(`${r.from}T12:00:00Z`); t <= Date.parse(`${r.to}T12:00:00Z`); t += 86400000) days.push(new Date(t).toISOString().slice(0, 10));
  const daily = Object.fromEntries(days.map((d) => [d, { date: d, orders: 0, meals: 0, gmvCents: 0, feesCents: 0, foodCents: 0 }]));
  const top = new Map<number, { orders: number; meals: number; foodCents: number }>();
  for (const o of sold) {
    const d = daily[dayKey(o.picked_up_at!, tz())];
    if (d) {
      d.orders += 1;
      d.meals += o.quantity;
      d.gmvCents += o.total_cents - o.refunded_cents;
      d.feesCents += o.service_fee_cents - feeRefund(o);
      d.foodCents += o.subtotal_cents - foodRefund(o);
    }
    const t = top.get(o.restaurant_id) ?? { orders: 0, meals: 0, foodCents: 0 };
    t.orders += 1;
    t.meals += o.quantity;
    t.foodCents += o.subtotal_cents;
    top.set(o.restaurant_id, t);
  }
  const names = new Map(restaurants.map((x) => [x.id, x]));
  const restaurantCounts: Record<string, number> = {};
  for (const x of restaurants) restaurantCounts[x.status] = (restaurantCounts[x.status] ?? 0) + 1;

  return {
    range: { from: r.from, to: r.to },
    totals: {
      gmvCents: sum((o) => o.total_cents - o.refunded_cents),
      serviceFeesCents: sum((o) => o.service_fee_cents - feeRefund(o)),
      foodSalesCents: sum((o) => o.subtotal_cents - foodRefund(o)),
      salesTaxCents: sum((o) => o.tax_cents - taxRefund(o)),
      refundsCents: sum((o) => o.refunded_cents),
      creditRefundsCents: sum((o) => o.credited_cents),
      cardChargedCents: sum((o) => o.total_cents - o.credit_applied_cents - o.card_refunded_cents),
      creditRedeemedCents: sum((o) => o.credit_applied_cents),
      discountsCents: sum((o) => (o.original_unit_price_cents - o.unit_price_cents) * o.quantity),
      ordersPickedUp: sold.length,
      mealsRescued: sum((o) => o.quantity),
      placed: byStatus,
    },
    now: {
      customers: customers.count ?? 0,
      restaurants: restaurantCounts,
      activeOffers: liveOffers.count ?? 0,
      awaitingPickup: awaiting.count ?? 0,
      payoutsOwedCents: (balances.data ?? []).reduce((n, b) => n + Math.max(0, b.balance_cents ?? 0), 0),
      creditOutstandingCents: credit.reduce((n, c) => n + c.amount_cents, 0),
    },
    daily: Object.values(daily),
    topRestaurants: [...top.entries()]
      .sort((a, b) => b[1].foodCents - a[1].foodCents)
      .slice(0, 5)
      .map(([id, t]) => ({ id, name: names.get(id)?.name ?? '', city: names.get(id)?.city ?? '', ...t })),
  };
}

// ---------------------------------------------------------------- restaurants & users

export async function restaurants(params: URLSearchParams) {
  const status = params.get('status') ?? '';
  const q = (params.get('q') ?? '').trim().toLowerCase();
  const [rows, owners, offers, sold, accounts, subs] = await Promise.all([
    all<Database['public']['Tables']['restaurants']['Row']>((a, b) => db().from('restaurants').select('*').order('created_at', { ascending: false }).range(a, b)),
    all<{ id: string; email: string; username: string; status: string }>((a, b) => db().from('profiles').select('id, email, username, status').eq('role', 'restaurant').range(a, b)),
    all<{ restaurant_id: number }>((a, b) => db().from('offers').select('restaurant_id').eq('status', 'active').gt('pickup_end', new Date().toISOString()).range(a, b)),
    all<{ restaurant_id: number; subtotal_cents: number }>((a, b) => db().from('orders').select('restaurant_id, subtotal_cents').eq('status', 'picked_up').range(a, b)),
    all<{ restaurant_id: number; charges_enabled: boolean; stripe_account_id: string | null }>((a, b) => db().from('restaurant_payment_accounts').select('restaurant_id, charges_enabled, stripe_account_id').range(a, b)),
    all<Database['public']['Tables']['restaurant_subscriptions']['Row']>((a, b) => db().from('restaurant_subscriptions').select('*').range(a, b)),
  ]);
  const sub = new Map(subs.map((x) => [x.restaurant_id, x]));
  const owner = new Map(owners.map((o) => [o.id, o]));
  const acct = new Map(accounts.map((a) => [a.restaurant_id, a]));
  const count = <T extends { restaurant_id: number }>(list: T[], id: number, f: (x: T) => number = () => 1) =>
    list.filter((x) => x.restaurant_id === id).reduce((n, x) => n + f(x), 0);
  const rank = { pending: 0, suspended: 1, approved: 2, banned: 3, deleted: 4 };
  return rows
    .map((r) => ({
      id: r.id, name: r.name, cuisine: r.cuisine, address: r.address, city: r.city, zip: r.zip, phone: r.phone, status: r.status,
      adminNote: r.admin_note, taxRateBps: r.tax_rate_bps, createdAt: r.created_at, suspendedUntil: r.suspended_until,
      plan: sub.get(r.id) ? {
        plan: sub.get(r.id)!.plan, status: sub.get(r.id)!.status, foundingNumber: sub.get(r.id)!.founding_number,
        autoRenew: sub.get(r.id)!.auto_renew, periodEnd: sub.get(r.id)!.current_period_end,
      } : null,
      ownerEmail: owner.get(r.owner_id)?.email ?? '', ownerUsername: owner.get(r.owner_id)?.username ?? '',
      activeOffers: count(offers, r.id), orders: count(sold, r.id), foodCents: count(sold, r.id, (x) => x.subtotal_cents),
      stripeReady: !!acct.get(r.id)?.charges_enabled, stripeAccount: acct.get(r.id)?.stripe_account_id ?? null,
    }))
    // Deleted restaurants only show when asked for.
    .filter((r) => (status ? r.status === status : r.status !== 'deleted') && (!q || [r.name, r.city, r.zip, r.ownerEmail].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => rank[a.status] - rank[b.status]);
}

export async function users(params: URLSearchParams) {
  const role = (['customer', 'restaurant', 'admin'].includes(params.get('role') ?? '') ? params.get('role') : 'customer') as Database['public']['Enums']['user_role'];
  const q = (params.get('q') ?? '').trim().toLowerCase();
  const [profiles, orders, credit, terms] = await Promise.all([
    all<Database['public']['Tables']['profiles']['Row']>((a, b) => db().from('profiles').select('*').eq('role', role).neq('status', 'deleted').order('created_at', { ascending: false }).range(a, b)),
    all<{ user_id: string; status: string; total_cents: number; refunded_cents: number }>((a, b) => db().from('orders').select('user_id, status, total_cents, refunded_cents').in('status', ['picked_up', 'expired']).range(a, b)),
    all<{ user_id: string; amount_cents: number }>((a, b) => db().from('credit_ledger').select('user_id, amount_cents').range(a, b)),
    all<{ user_id: string; accepted_at: string }>((a, b) => db().from('terms_acceptances').select('user_id, accepted_at').range(a, b)),
  ]);
  return profiles
    .filter((u) => !q || `${u.email} ${u.username}`.toLowerCase().includes(q))
    .slice(0, 500)
    .map((u) => {
      const mine = orders.filter((o) => o.user_id === u.id);
      const done = mine.filter((o) => o.status === 'picked_up');
      return {
        id: u.id, email: u.email, username: u.username, role: u.role, status: u.status, suspendedUntil: u.suspended_until, createdAt: u.created_at,
        orders: done.length, spentCents: done.reduce((n, o) => n + o.total_cents - o.refunded_cents, 0), noShows: mine.length - done.length,
        creditCents: credit.filter((c) => c.user_id === u.id).reduce((n, c) => n + c.amount_cents, 0),
        termsAcceptedAt: terms.filter((t) => t.user_id === u.id).map((t) => t.accepted_at).sort().at(-1) ?? null,
      };
    });
}

// ---------------------------------------------------------------- orders

export function presentOrder(o: Order & { restaurants?: { name: string } | null; profiles?: { email: string } | null }) {
  return {
    id: o.id, status: o.status, itemTitle: o.item_title, quantity: o.quantity, customer: o.customer_username, customerEmail: o.profiles?.email ?? '',
    restaurant: o.restaurants?.name ?? '', restaurantId: o.restaurant_id, unitPriceCents: o.unit_price_cents,
    originalUnitPriceCents: o.original_unit_price_cents, discountPct: o.discount_pct, subtotalCents: o.subtotal_cents,
    serviceFeeCents: o.service_fee_cents, taxCents: o.tax_cents, totalCents: o.total_cents, refundedCents: o.refunded_cents,
    creditedCents: o.credited_cents, creditAppliedCents: o.credit_applied_cents, cardRefundedCents: o.card_refunded_cents,
    refundableCents: o.total_cents - o.refunded_cents - o.credited_cents,
    cardRefundableCents: o.payment_ref ? o.total_cents - o.credit_applied_cents - o.card_refunded_cents : 0,
    refundReason: o.refund_reason, card: o.card_label, paymentRef: o.payment_ref, createdAt: o.created_at, pickedUpAt: o.picked_up_at,
    pickupEnd: o.pickup_end,
  };
}
export type AdminOrder = ReturnType<typeof presentOrder>;

async function ordersInRange(params: URLSearchParams) {
  const r = range(params, 30);
  const rows = await all<Order & { restaurants: { name: string } | null; profiles: { email: string } | null }>((a, b) =>
    db().from('orders').select('*, restaurants(name), profiles(email)').gte('created_at', r.start).lt('created_at', r.end)
      .neq('status', 'failed').order('created_at', { ascending: false }).range(a, b),
  );
  return { r, rows };
}

export async function orders(params: URLSearchParams) {
  const { r, rows } = await ordersInRange(params);
  const status = params.get('status') ?? '';
  const q = (params.get('q') ?? '').trim().toLowerCase();
  const list = rows
    .filter((o) => !status || o.status === status)
    .filter((o) => !q || String(o.id) === q || [o.customer_username, o.profiles?.email, o.restaurants?.name, o.item_title].join(' ').toLowerCase().includes(q))
    .slice(0, 500)
    .map(presentOrder);
  return { orders: list, range: { from: r.from, to: r.to } };
}

export async function orderRefunds(orderId: number) {
  return must(await db().from('refunds').select('*, profiles(username)').eq('order_id', orderId).order('id'));
}

export async function ordersCsv(params: URLSearchParams) {
  const { r, rows } = await ordersInRange(params);
  return {
    name: `BiteWise-orders-${r.from}-to-${r.to}.csv`,
    csv: toCsv([
      ['Order #', 'Created', 'Picked up', 'Status', 'Customer', 'Restaurant', 'Item', 'Qty', 'Original unit', 'Discount %', 'Unit price', 'Food subtotal',
        'Service fee', 'Sales tax', 'Total', 'Credit applied', 'Refunded to original payment', 'Refunded as platform credit', 'Card', 'Transaction ID'],
      ...[...rows].reverse().map((o) => [o.id, o.created_at, o.picked_up_at ?? '', o.status, o.customer_username, o.restaurants?.name ?? '', o.item_title,
        o.quantity, dollars(o.original_unit_price_cents), o.discount_pct, dollars(o.unit_price_cents), dollars(o.subtotal_cents), dollars(o.service_fee_cents),
        dollars(o.tax_cents), dollars(o.total_cents), dollars(o.credit_applied_cents), dollars(o.refunded_cents), dollars(o.credited_cents), o.card_label,
        o.payment_ref ?? '']),
    ]),
  };
}

// ---------------------------------------------------------------- offers

export async function liveOffers() {
  return must(
    await db().from('offers').select('*, restaurants(name, city, status)').neq('status', 'ended').gt('pickup_end', new Date().toISOString()).order('pickup_end'),
  );
}

// ---------------------------------------------------------------- payouts

export async function payouts() {
  const [balances, accounts, owners, history] = await Promise.all([
    must(await db().from('restaurant_balances').select('*').order('name')),
    must(await db().from('restaurant_payment_accounts').select('*')),
    all<{ id: number; owner_id: string }>((a, b) => db().from('restaurants').select('id, owner_id').range(a, b)),
    must(await db().from('payouts').select('*, restaurants(name)').order('paid_at', { ascending: false }).limit(300)),
  ]);
  const emails = new Map(must(await db().from('profiles').select('id, email').eq('role', 'restaurant')).map((p) => [p.id, p.email]));
  const ownerOf = new Map(owners.map((o) => [o.id, o.owner_id]));
  const acct = new Map(accounts.map((a) => [a.restaurant_id, a]));
  return {
    balances: balances
      .filter((b) => (b.earned_cents ?? 0) || (b.paid_cents ?? 0))
      .map((b) => {
        const a = acct.get(b.restaurant_id!);
        return {
          restaurantId: b.restaurant_id!, name: b.name!, city: b.city!, status: b.status!, email: emails.get(ownerOf.get(b.restaurant_id!) ?? '') ?? '',
          orders: b.orders ?? 0, earnedCents: b.earned_cents ?? 0, paidCents: b.paid_cents ?? 0, balanceCents: b.balance_cents ?? 0, lastPaidAt: b.last_paid_at,
          stripeAccount: a?.stripe_account_id ?? null, stripeReady: !!a?.charges_enabled, bank: a?.bank_summary ?? '',
        };
      }),
    history,
  };
}

export async function payoutsCsv() {
  const p = await payouts();
  return toCsv([
    ['Restaurant', 'City', 'Owner email', 'Completed orders', 'Earned', 'Paid', 'Balance owed', 'Stripe account', 'Last paid'],
    ...p.balances.map((x) => [x.name, x.city, x.email, x.orders, dollars(x.earnedCents), dollars(x.paidCents), dollars(x.balanceCents), x.stripeAccount ?? '', x.lastPaidAt ?? '']),
    [],
    ['Payout history'],
    ['Date', 'Invoice number', 'Restaurant', 'Type', 'Amount', 'Bank/transaction details', 'Transaction ID', 'Note'],
    ...[...p.history].reverse().map((x) => [x.paid_at, x.invoice_number ?? '', x.restaurants?.name ?? '', x.kind, dollars(x.amount_cents), x.bank_details, x.transaction_id, x.note]),
  ]);
}

// ---------------------------------------------------------------- sales tax

// Retail sales tax collected on completed orders, by restaurant location (for the WA excise tax return).
export async function tax(params: URLSearchParams) {
  const r = range(params, 30);
  const [sold, rest] = await Promise.all([
    pickedUpBetween(r.start, r.end),
    all<{ id: number; city: string; zip: string }>((a, b) => db().from('restaurants').select('id, city, zip').range(a, b)),
  ]);
  const loc = new Map(rest.map((x) => [x.id, x]));
  const groups = new Map<string, { city: string; zip: string; rateBps: number; orders: number; taxableCents: number; taxCents: number }>();
  for (const o of sold) {
    const l = loc.get(o.restaurant_id)!;
    const key = `${l.city}|${l.zip}|${o.tax_rate_bps}`;
    const g = groups.get(key) ?? { city: l.city, zip: l.zip, rateBps: o.tax_rate_bps, orders: 0, taxableCents: 0, taxCents: 0 };
    g.orders += 1;
    g.taxableCents += o.subtotal_cents - foodRefund(o);
    g.taxCents += o.tax_cents - taxRefund(o);
    groups.set(key, g);
  }
  const rows = [...groups.values()].sort((a, b) => a.city.localeCompare(b.city) || a.zip.localeCompare(b.zip));
  return {
    range: { from: r.from, to: r.to },
    rows,
    totals: { taxableCents: rows.reduce((n, x) => n + x.taxableCents, 0), taxCents: rows.reduce((n, x) => n + x.taxCents, 0) },
  };
}

export async function taxCsv(params: URLSearchParams) {
  const t = await tax(params);
  return {
    name: `BiteWise-sales-tax-${t.range.from}-to-${t.range.to}.csv`,
    csv: toCsv([
      ['City', 'ZIP', 'Rate %', 'Orders', 'Taxable sales', 'Sales tax collected'],
      ...t.rows.map((x) => [x.city, x.zip, (x.rateBps / 100).toFixed(2), x.orders, dollars(x.taxableCents), dollars(x.taxCents)]),
    ]),
  };
}

// ---------------------------------------------------------------- restaurant plans

// The Plans tab: prices, a summary and every restaurant's plan (approved restaurants, plus any with a plan).
export async function plans() {
  const [p, rows, subs, owners, paid] = await Promise.all([
    prices(),
    all<{ id: number; name: string; city: string; status: string; owner_id: string; created_at: string }>((a, b) => db().from('restaurants').select('id, name, city, status, owner_id, created_at').range(a, b)),
    all<Database['public']['Tables']['restaurant_subscriptions']['Row']>((a, b) => db().from('restaurant_subscriptions').select('*').range(a, b)),
    all<{ id: string; email: string }>((a, b) => db().from('profiles').select('id, email').eq('role', 'restaurant').range(a, b)),
    all<{ restaurant_id: number; amount_cents: number; created_at: string }>((a, b) => db().from('subscription_payments').select('restaurant_id, amount_cents, created_at').eq('status', 'paid').range(a, b)),
  ]);
  const sub = new Map(subs.map((x) => [x.restaurant_id, x]));
  const email = new Map(owners.map((o) => [o.id, o.email]));
  const yearAgo = Date.now() - 365 * 86_400_000;
  const list = rows
    .filter((r) => r.status !== 'deleted' && (r.status === 'approved' || sub.has(r.id)))
    .map((r) => {
      const s = sub.get(r.id);
      return {
        restaurantId: r.id, name: r.name, city: r.city, restaurantStatus: r.status, ownerEmail: email.get(r.owner_id) ?? '',
        plan: s?.plan ?? null, status: s?.status ?? null, foundingNumber: s?.founding_number ?? null, autoRenew: s?.auto_renew ?? false,
        priceCents: s?.price_cents ?? 0, periodEnd: s?.current_period_end ?? null, cardLabel: s?.card_label ?? '', lastPaymentError: s?.last_payment_error ?? '',
        paid12mCents: paid.filter((x) => x.restaurant_id === r.id && Date.parse(x.created_at) >= yearAgo).reduce((n, x) => n + x.amount_cents, 0),
      };
    });
  const rank = (x: (typeof list)[number]) => (x.status === 'past_due' ? 0 : !x.plan ? 1 : x.status === 'expired' ? 2 : 3);
  list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const active = subs.filter((x) => x.plan !== 'founding' && x.status === 'active');
  return {
    prices: p,
    summary: {
      founding: subs.filter((x) => x.plan === 'founding').length,
      monthly: active.filter((x) => x.plan === 'monthly').length,
      annual: active.filter((x) => x.plan === 'annual').length,
      delinquent: subs.filter((x) => x.status === 'past_due').length,
      noPlan: list.filter((x) => !x.plan).length,
      // Monthly recurring revenue: monthly plans plus annual plans spread over 12 months.
      mrrCents: active.reduce((n, x) => n + (x.plan === 'annual' ? Math.round(x.price_cents / 12) : x.price_cents), 0),
      paid12mCents: paid.filter((x) => Date.parse(x.created_at) >= yearAgo).reduce((n, x) => n + x.amount_cents, 0),
    },
    rows: list,
  };
}

// ---------------------------------------------------------------- settings & audit

export async function settings() {
  const rows = must(await db().from('settings').select('key, value'));
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  return {
    serviceFeePct: Number(get('service_fee_bps') ?? 500) / 100,
    defaultTaxRatePct: Number(get('default_tax_rate_bps') ?? 1035) / 100,
    requireRestaurantApproval: get('require_restaurant_approval') !== false,
  };
}

export async function audit() {
  return must(await db().from('audit_log').select('*, profiles(username)').order('id', { ascending: false }).limit(300));
}

export async function log(adminId: string, action: string, targetType: string, targetId: string | number | null, details = '') {
  await db().from('audit_log').insert({ admin_id: adminId, action, target_type: targetType, target_id: targetId === null ? null : String(targetId), details: details.slice(0, 500) });
}
