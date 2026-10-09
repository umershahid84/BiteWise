import 'server-only';
import * as admin from '@/lib/admin';
import { ORDER_STATUS_LABELS, type OrderStatus } from '@/lib/constants';
import { serverEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { money, pct } from '@/lib/format';
import { displayPhone } from '@/lib/phone';
import { dollars, toCsv } from '@/lib/receipts/data';
import { formatDateTime } from '@/lib/receipts/time';

// Downloads for the owner console's lists (Restaurants, Customers, Orders, Payouts, Sales tax, Audit log). Each tab
// is described once as a Report (figures and tables), and the same Report becomes a CSV or a PDF, so both always
// match what the tab shows, with its current filters. ?section=<table id> downloads one table; without it, the
// whole tab. Every row is included, not just the page on screen.

// A cell: text, a whole number, or an amount of money (cents: "12.34" in a CSV, "$12.34" in a PDF).
export type Cell = string | number | { cents: number };
export type Column = {
  h: string;
  // Relative width in the PDF; 0 = CSV only (a detail that doesn't fit on a page).
  w: number;
  align?: 'left' | 'right';
};
export type ReportTable = { id: string; title: string; columns: Column[]; rows: Cell[][]; total?: Cell[] };
export type Report = {
  file: string; // file name without extension
  title: string;
  subtitle: string;
  figures?: [string, string][]; // the boxes at the top of the tab (whole-tab PDF only)
  tables: ReportTable[];
  note?: string;
};

const usd = (c: { cents: number }) => money(c.cents);
export const cellText = (c: Cell, csv: boolean) => (typeof c === 'object' ? (csv ? dollars(c.cents) : usd(c)) : String(c));
const cents = (n: number) => ({ cents: n });
const tz = () => serverEnv.timeZone;
const when = (iso: string | null | undefined) => (iso ? formatDateTime(iso, tz()) : '');
const dateOnly = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: tz() }) : '';
const dayText = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const rangeText = (r: { from: string; to: string }) => `${dayText(r.from)} – ${dayText(r.to)}`;
const filters = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' · ');
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1).replace(/_/g, ' ') : s);

// ---------------------------------------------------------------- the tabs

async function restaurantsReport(p: URLSearchParams): Promise<Report> {
  const rows = await admin.restaurants(p);
  const planText = (r: (typeof rows)[number]) => {
    const x = r.plan;
    if (!x) return 'No plan';
    if (x.plan === 'founding' || x.foundingNumber) return `Pioneer #${x.foundingNumber ?? '–'}${x.plan !== 'founding' ? ` (${x.plan})` : ''}`;
    const name = cap(x.plan);
    return x.status === 'past_due' ? `${name}: delinquent` : x.status === 'expired' ? `${name}: ended` : `${name}, ${x.autoRenew ? 'renews' : 'ends'} ${dateOnly(x.periodEnd)}`;
  };
  return {
    file: 'restaurants',
    title: 'Restaurants',
    subtitle: filters(p.get('status') ? `Status: ${cap(p.get('status')!)}` : 'All statuses (not deleted)', p.get('q') && `Search: “${p.get('q')}”`, `${rows.length} restaurants`),
    tables: [{
      id: 'restaurants',
      title: 'Restaurants',
      columns: [
        { h: 'Restaurant', w: 130, align: 'left' }, { h: 'Cuisine', w: 0, align: 'left' }, { h: 'Address', w: 0, align: 'left' }, { h: 'City', w: 75, align: 'left' },
        { h: 'ZIP', w: 0, align: 'left' }, { h: 'Phone', w: 0, align: 'left' }, { h: 'Owner', w: 95, align: 'left' }, { h: 'Owner email', w: 0, align: 'left' },
        { h: 'Offers', w: 48 }, { h: 'Orders', w: 48 }, { h: 'Food sales', w: 68 }, { h: 'Plan', w: 165, align: 'left' }, { h: 'Status', w: 70, align: 'left' },
        { h: 'Stripe', w: 85, align: 'left' }, { h: 'Tax rate', w: 0 }, { h: 'Joined', w: 0, align: 'left' }, { h: 'Admin note', w: 0, align: 'left' },
      ],
      rows: rows.map((r) => [
        r.name, r.cuisine, `${r.address}, ${r.city} ${r.zip}`, r.city, r.zip, r.phone ? displayPhone(r.phone) : '', r.ownerUsername, r.ownerEmail,
        r.activeOffers, r.orders, cents(r.foodCents), planText(r),
        r.status === 'suspended' && r.suspendedUntil ? `Suspended until ${dateOnly(r.suspendedUntil)}` : cap(r.status),
        r.stripeReady ? 'Connected' : 'Not connected', pct(r.taxRateBps), dateOnly(r.createdAt), r.adminNote ?? '',
      ]),
    }],
  };
}

async function usersReport(p: URLSearchParams): Promise<Report> {
  const rows = await admin.users(p);
  const role = p.get('role') || 'customer';
  const who = role === 'restaurant' ? 'Restaurant owners' : role === 'staff' ? 'Restaurant staff' : role === 'admin' ? 'Admins' : 'Customers';
  return {
    file: who.toLowerCase().replace(/ /g, '-'),
    title: who,
    subtitle: filters(p.get('q') && `Search: “${p.get('q')}”`, `${rows.length} accounts`),
    tables: [{
      id: 'users',
      title: who,
      columns: [
        { h: 'User name', w: 100, align: 'left' }, { h: 'Email', w: 160, align: 'left' }, { h: 'Joined', w: 75, align: 'left' }, { h: 'Orders', w: 45 },
        { h: 'Spent', w: 65 }, { h: 'Missed pickups', w: 85 }, { h: 'Missed in a row', w: 0 }, { h: 'Credit', w: 60 },
        { h: 'Terms accepted', w: 90, align: 'left' }, { h: 'Status', w: 100, align: 'left' },
      ],
      rows: rows.map((u) => [
        u.username, u.email, dateOnly(u.createdAt), u.orders, cents(u.spentCents), u.noShows, u.noShowStreak, cents(u.creditCents), dateOnly(u.termsAcceptedAt),
        u.status === 'suspended' && u.suspendedUntil ? `Suspended until ${dateOnly(u.suspendedUntil)}` : `${cap(u.status)}${u.noShowProbation && u.status !== 'banned' ? ' (final warning)' : ''}`,
      ]),
    }],
  };
}

async function ordersReport(p: URLSearchParams): Promise<Report> {
  const { r, rows } = await admin.filteredOrders(p);
  const sum = (f: (o: (typeof rows)[number]) => number) => rows.reduce((n, o) => n + f(o), 0);
  const status = p.get('status') as OrderStatus | null;
  return {
    file: `orders-${r.from}-to-${r.to}`,
    title: 'Orders',
    subtitle: filters(rangeText(r), status && `Status: ${ORDER_STATUS_LABELS[status] ?? status}`, p.get('q') && `Search: “${p.get('q')}”`, `${rows.length} orders`),
    tables: [{
      id: 'orders',
      title: 'Orders',
      columns: [
        { h: 'Order #', w: 45, align: 'left' }, { h: 'Placed', w: 115, align: 'left' }, { h: 'Picked up', w: 0, align: 'left' }, { h: 'Status', w: 70, align: 'left' },
        { h: 'Customer', w: 80, align: 'left' }, { h: 'Customer email', w: 0, align: 'left' }, { h: 'Restaurant', w: 110, align: 'left' }, { h: 'Item', w: 120, align: 'left' },
        { h: 'Qty', w: 30 }, { h: 'Original unit', w: 0 }, { h: 'Discount %', w: 0 }, { h: 'Unit price', w: 0 }, { h: 'Food subtotal', w: 0 },
        { h: 'Service fee', w: 0 }, { h: 'Sales tax', w: 0 }, { h: 'Total', w: 65 }, { h: 'Credit applied', w: 0 },
        { h: 'Refunded to original payment', w: 0 }, { h: 'Refunded as platform credit', w: 0 }, { h: 'Card', w: 0, align: 'left' }, { h: 'Transaction ID', w: 0, align: 'left' },
        { h: 'Refunded', w: 65 },
      ],
      rows: rows.map((o) => [
        o.id, when(o.created_at), when(o.picked_up_at), ORDER_STATUS_LABELS[o.status], o.customer_username, o.profiles?.email ?? '', o.restaurants?.name ?? '', o.item_title,
        o.quantity, cents(o.original_unit_price_cents), o.discount_pct, cents(o.unit_price_cents), cents(o.subtotal_cents), cents(o.service_fee_cents), cents(o.tax_cents),
        cents(o.total_cents), cents(o.credit_applied_cents), cents(o.refunded_cents), cents(o.credited_cents), o.card_label, o.payment_ref ?? '',
        cents(o.refunded_cents + o.credited_cents),
      ]),
      total: ['Total', '', '', '', '', '', '', '', sum((o) => o.quantity), '', '', '', cents(sum((o) => o.subtotal_cents)), cents(sum((o) => o.service_fee_cents)),
        cents(sum((o) => o.tax_cents)), cents(sum((o) => o.total_cents)), cents(sum((o) => o.credit_applied_cents)), cents(sum((o) => o.refunded_cents)),
        cents(sum((o) => o.credited_cents)), '', '', cents(sum((o) => o.refunded_cents + o.credited_cents))],
    }],
  };
}

async function payoutsReport(): Promise<Report> {
  const x = await admin.payouts();
  const owed = x.balances.reduce((n, b) => n + Math.max(0, b.balanceCents), 0);
  const paid = x.history.reduce((n, h) => n + h.amount_cents, 0);
  return {
    file: 'payouts',
    title: 'Payouts',
    subtitle: `${x.balances.length} restaurants · ${x.history.length} payouts`,
    figures: [['Owed to restaurants', money(owed)], ['Paid out (history)', money(paid)], ['Restaurants', String(x.balances.length)], ['Payouts', String(x.history.length)]],
    tables: [
      {
        id: 'balances',
        title: 'Balances',
        columns: [
          { h: 'Restaurant', w: 150, align: 'left' }, { h: 'City', w: 80, align: 'left' }, { h: 'Owner email', w: 150, align: 'left' }, { h: 'Stripe', w: 80, align: 'left' },
          { h: 'Bank', w: 0, align: 'left' }, { h: 'Stripe account', w: 0, align: 'left' }, { h: 'Orders', w: 45 }, { h: 'Earned', w: 70 }, { h: 'Paid', w: 70 },
          { h: 'Owed', w: 70 }, { h: 'Last paid', w: 0, align: 'left' },
        ],
        rows: x.balances.map((b) => [b.name, b.city, b.email, b.stripeReady ? 'Connected' : 'Not connected', b.bank, b.stripeAccount ?? '', b.orders,
          cents(b.earnedCents), cents(b.paidCents), cents(b.balanceCents), when(b.lastPaidAt)]),
        total: ['Total', '', '', '', '', '', x.balances.reduce((n, b) => n + b.orders, 0), cents(x.balances.reduce((n, b) => n + b.earnedCents, 0)),
          cents(x.balances.reduce((n, b) => n + b.paidCents, 0)), cents(x.balances.reduce((n, b) => n + b.balanceCents, 0)), ''],
      },
      {
        id: 'history',
        title: 'Payout history',
        columns: [
          { h: 'Date', w: 95, align: 'left' }, { h: 'Invoice number', w: 95, align: 'left' }, { h: 'Restaurant', w: 130, align: 'left' }, { h: 'Type', w: 55, align: 'left' },
          { h: 'Bank / transaction details', w: 170, align: 'left' }, { h: 'Transaction ID', w: 0, align: 'left' }, { h: 'Note', w: 0, align: 'left' }, { h: 'Amount', w: 70 },
        ],
        rows: x.history.map((h) => [when(h.paid_at), h.invoice_number ?? '', h.restaurants?.name ?? '', cap(h.kind), h.bank_details, h.transaction_id, h.note, cents(h.amount_cents)]),
        total: ['Total', '', '', '', '', '', '', cents(paid)],
      },
    ],
  };
}

async function taxReport(p: URLSearchParams): Promise<Report> {
  const t = await admin.tax(p);
  const cols = (n: string): Column[] => [
    { h: 'City', w: 150, align: 'left' }, { h: 'ZIP', w: 70, align: 'left' }, { h: 'Rate', w: 70 }, { h: n, w: 70 }, { h: `Taxable ${n === 'Orders' ? 'sales' : 'fees'}`, w: 110 },
    { h: 'Sales tax collected', w: 110 },
  ];
  return {
    file: `sales-tax-${t.range.from}-to-${t.range.to}`,
    title: 'Sales tax',
    subtitle: `${rangeText(t.range)} · for the Washington excise tax return`,
    figures: [
      ['All sales tax collected', money(t.allTotals.taxCents)], ['On food orders', money(t.totals.taxCents)],
      ['On plan fees', money(t.planTotals.taxCents)], ['Taxable sales and fees', money(t.allTotals.taxableCents)],
    ],
    tables: [
      {
        id: 'orders', title: 'Food orders', columns: cols('Orders'),
        rows: t.rows.map((x) => [x.city, x.zip, pct(x.rateBps), x.orders, cents(x.taxableCents), cents(x.taxCents)]),
        total: ['Total', '', '', t.rows.reduce((n, x) => n + x.orders, 0), cents(t.totals.taxableCents), cents(t.totals.taxCents)],
      },
      {
        id: 'plans', title: 'Restaurant plan fees', columns: cols('Invoices'),
        rows: t.planRows.map((x) => [x.city, x.zip, pct(x.rateBps), x.invoices, cents(x.taxableCents), cents(x.taxCents)]),
        total: ['Total', '', '', t.planRows.reduce((n, x) => n + x.invoices, 0), cents(t.planTotals.taxableCents), cents(t.planTotals.taxCents)],
      },
    ],
    note: 'Retail sales tax collected on completed orders (less refunds to the original payment) and on restaurant plan fees, by restaurant location.',
  };
}

async function auditReport(): Promise<Report> {
  const rows = await admin.audit();
  return {
    file: 'audit-log',
    title: 'Audit log',
    subtitle: `${rows.length} admin actions`,
    tables: [{
      id: 'audit',
      title: 'Audit log',
      columns: [
        { h: 'When', w: 100, align: 'left' }, { h: 'Admin', w: 80, align: 'left' }, { h: 'Action', w: 110, align: 'left' }, { h: 'Target', w: 90, align: 'left' },
        { h: 'Details', w: 330, align: 'left' },
      ],
      rows: rows.map((e) => [when(e.created_at), e.profiles?.username ?? '', e.action, `${e.target_type}${e.target_id ? ` #${e.target_id}` : ''}`, e.details]),
    }],
  };
}

const REPORTS: Record<string, (p: URLSearchParams) => Promise<Report>> = {
  restaurants: restaurantsReport,
  users: usersReport,
  orders: ordersReport,
  payouts: () => payoutsReport(),
  tax: taxReport,
  audit: () => auditReport(),
};
export const hasReport = (kind: string) => kind in REPORTS;

// The report for a tab, narrowed to one table when ?section names one.
export async function report(kind: string, p: URLSearchParams): Promise<{ report: Report; whole: boolean }> {
  const build = REPORTS[kind];
  if (!build) throw new AppError(404, 'Not found.');
  const r = await build(p);
  const section = p.get('section');
  const table = section && section !== 'all' ? r.tables.find((t) => t.id === section) : null;
  if (section && section !== 'all' && !table) throw new AppError(404, 'Not found.');
  if (!table) return { report: r, whole: true };
  return {
    report: { ...r, file: r.tables.length > 1 ? `${r.file}-${table.id}` : r.file, title: r.tables.length > 1 ? table.title : r.title, figures: undefined, tables: [table] },
    whole: false,
  };
}

export function reportCsv(r: Report) {
  const block = (t: ReportTable) => [
    t.columns.map((c) => c.h),
    ...t.rows.map((row) => row.map((c) => cellText(c, true))),
    ...(t.total ? [t.total.map((c) => cellText(c, true))] : []),
  ];
  const rows: (string | number)[][] = [[`Bite Wise · ${r.title}`], [r.subtitle], []];
  r.tables.forEach((t, i) => {
    if (r.tables.length > 1) rows.push([t.title]);
    rows.push(...block(t));
    if (i < r.tables.length - 1) rows.push([]);
  });
  if (r.note) rows.push([], [r.note]);
  return toCsv(rows);
}
