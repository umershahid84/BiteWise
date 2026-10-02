import 'server-only';
import { code128 } from '@/lib/code128';
import type { Database } from '@/lib/database.types';
import { ORDER_STATUS_LABELS } from '@/lib/constants';
import { serverEnv } from '@/lib/env';
import { must } from '@/lib/errors';
import { money } from '@/lib/format';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { dayRange, formatDateTime, formatTime } from './time';

type Order = Database['public']['Tables']['orders']['Row'];

const PAYMENT_STATUS: Record<Order['status'], string> = {
  pending_payment: 'Awaiting card authorization',
  reserved: 'Authorized: hold placed, charged at pickup',
  picked_up: 'Paid (charged at pickup)',
  cancelled: 'Hold released, not charged',
  expired: 'Hold released, not charged',
  failed: 'Card authorization failed',
};

export const receiptNumber = (order: { id: number; created_at: string }) => {
  const d = new Date(order.created_at);
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `BW-${ymd}-${String(order.id).padStart(6, '0')}`;
};

export type Receipt = Awaited<ReturnType<typeof receiptData>>;

// Everything shown on a customer receipt (web page and PDF).
export async function receiptData(order: Order) {
  const tz = serverEnv.timeZone;
  const db = supabaseAdmin();
  const [restaurant, customer, refunds, pin] = await Promise.all([
    db.from('restaurants').select('name, address, city, zip, phone').eq('id', order.restaurant_id).single(),
    db.from('profiles').select('username, email').eq('id', order.user_id).single(),
    db.from('refunds').select('*').eq('order_id', order.id).order('id'),
    order.status === 'reserved' ? db.from('order_pins').select('pin').eq('order_id', order.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const lineOriginal = order.original_unit_price_cents * order.quantity;
  const number = receiptNumber(order);
  const refundedTotal = order.refunded_cents + order.credited_cents;
  return {
    receiptNumber: number,
    orderId: order.id,
    status: order.status,
    statusLabel: ORDER_STATUS_LABELS[order.status],
    paymentStatus:
      refundedTotal >= order.total_cents && order.status === 'picked_up'
        ? 'Refunded in full'
        : refundedTotal
          ? `Paid, partially refunded (${money(refundedTotal)})`
          : PAYMENT_STATUS[order.status],
    orderedAtText: formatDateTime(order.created_at, tz),
    pickedUpAtText: formatDateTime(order.picked_up_at, tz),
    pickupByText: formatDateTime(order.pickup_end, tz),
    customer: { username: customer.data?.username ?? order.customer_username, email: customer.data?.email ?? '' },
    restaurant: must(restaurant),
    item: {
      title: order.item_title,
      imageUrl: order.image_url,
      quantity: order.quantity,
      originalUnitCents: order.original_unit_price_cents,
      discountPct: order.discount_pct,
      unitPriceCents: order.unit_price_cents,
      lineOriginalCents: lineOriginal,
      lineTotalCents: order.subtotal_cents,
      savingsCents: lineOriginal - order.subtotal_cents,
    },
    subtotalCents: order.subtotal_cents,
    serviceFeeCents: order.service_fee_cents,
    serviceFeePct: order.service_fee_bps / 100,
    taxRateBps: order.tax_rate_bps,
    taxCents: order.tax_cents,
    totalCents: order.total_cents,
    creditAppliedCents: order.credit_applied_cents,
    amountChargedCents: order.status === 'picked_up' ? order.total_cents - order.credit_applied_cents : 0,
    refundedCents: refundedTotal,
    refunds: (refunds.data ?? []).map((f) => ({
      amountCents: f.amount_cents,
      to:
        f.method === 'credit'
          ? 'Bite Wise platform credit'
          : [f.card_cents && `${order.card_label} (${money(f.card_cents)})`, f.credit_cents && `platform credit (${money(f.credit_cents)})`]
              .filter(Boolean).join(' + '),
      reason: f.reason,
      atText: formatDateTime(f.created_at, tz),
    })),
    card: order.card_label,
    paymentRef: order.payment_ref ?? '',
    pin: pin.data?.pin ?? null,
    // Code 128 module widths (bar, space, ...) for the receipt number barcode.
    barcode: code128(number),
  };
}

// ---------------------------------------------------------------- restaurant daily report

export type Report = Awaited<ReturnType<typeof reportData>>;

export async function reportData(restaurantId: number, date: string) {
  const tz = serverEnv.timeZone;
  const { start, end } = dayRange(date, tz);
  const db = supabaseAdmin();
  const restaurant = must(await db.from('restaurants').select('name, address, city, zip, phone').eq('id', restaurantId).single());
  const rows = must(
    await db.from('orders').select('*').eq('restaurant_id', restaurantId)
      .not('status', 'in', '(pending_payment,failed)')
      .or(`and(created_at.gte.${start},created_at.lt.${end}),and(picked_up_at.gte.${start},picked_up_at.lt.${end})`)
      .order('created_at'),
  );
  const sold = rows.filter((o) => o.status === 'picked_up' && o.picked_up_at! >= start && o.picked_up_at! < end);
  const sum = (list: Order[], f: (o: Order) => number) => list.reduce((n, o) => n + f(o), 0);
  const count = (s: Order['status']) => rows.filter((o) => o.status === s).length;
  return {
    date,
    dateText: new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }),
    generatedAtText: formatDateTime(new Date().toISOString(), tz),
    restaurant,
    summary: {
      ordersPickedUp: sold.length,
      mealsRescued: sum(sold, (o) => o.quantity),
      menuValueCents: sum(sold, (o) => o.original_unit_price_cents * o.quantity),
      discountsCents: sum(sold, (o) => (o.original_unit_price_cents - o.unit_price_cents) * o.quantity),
      foodSalesCents: sum(sold, (o) => o.subtotal_cents),
      salesTaxCents: sum(sold, (o) => o.tax_cents),
      serviceFeesCents: sum(sold, (o) => o.service_fee_cents),
      totalChargedCents: sum(sold, (o) => o.total_cents),
      awaitingPickup: count('reserved'),
      cancelled: count('cancelled'),
      notPickedUp: count('expired'),
    },
    orders: rows.map((o) => ({
      id: o.id,
      orderedTime: formatTime(o.created_at, tz),
      pickedUpTime: o.picked_up_at ? formatTime(o.picked_up_at, tz) : '',
      customer: o.customer_username,
      item: o.item_title,
      imageUrl: o.image_url,
      quantity: o.quantity,
      originalUnitCents: o.original_unit_price_cents,
      discountPct: o.discount_pct,
      unitPriceCents: o.unit_price_cents,
      subtotalCents: o.subtotal_cents,
      taxCents: o.tax_cents,
      serviceFeeCents: o.service_fee_cents,
      totalCents: o.total_cents,
      card: o.card_label,
      status: o.status,
      statusLabel: ORDER_STATUS_LABELS[o.status],
    })),
  };
}

const csvEscape = (v: unknown) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
export const toCsv = (rows: unknown[][]) => `${rows.map((r) => r.map(csvEscape).join(',')).join('\n')}\n`;
export const dollars = (c: number) => (c / 100).toFixed(2);

export function reportCsv(rep: Report) {
  const s = rep.summary;
  return toCsv([
    ['Order #', 'Ordered', 'Picked up', 'Customer', 'Item', 'Qty', 'Original unit price', 'Discount %', 'Unit price',
      'Food subtotal', 'Sales tax', 'Service fee', 'Total', 'Card', 'Status'],
    ...rep.orders.map((o) => [o.id, o.orderedTime, o.pickedUpTime, o.customer, o.item, o.quantity, dollars(o.originalUnitCents), o.discountPct,
      dollars(o.unitPriceCents), dollars(o.subtotalCents), dollars(o.taxCents), dollars(o.serviceFeeCents), dollars(o.totalCents), o.card, o.statusLabel]),
    [],
    ['Summary (picked-up orders)'],
    ['Orders picked up', s.ordersPickedUp],
    ['Meals rescued', s.mealsRescued],
    ['Menu value', dollars(s.menuValueCents)],
    ['Discounts given', dollars(s.discountsCents)],
    ['Food sales', dollars(s.foodSalesCents)],
    ['Sales tax collected', dollars(s.salesTaxCents)],
    ['Bite Wise service fees (paid by customers)', dollars(s.serviceFeesCents)],
    ['Total charged to customers', dollars(s.totalChargedCents)],
    ['Awaiting pickup', s.awaitingPickup],
    ['Cancelled', s.cancelled],
    ['Not picked up', s.notPickedUp],
  ]);
}
