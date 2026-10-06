import 'server-only';
import type { Database } from '@/lib/database.types';
import { serverEnv } from '@/lib/env';
import { must } from '@/lib/errors';
import { supabaseAdmin } from '@/lib/supabase/admin';

// A restaurant plan invoice (one row of subscription_payments): the plan price, any discount (e.g. the Pioneer
// Members Discount) and the total. Shown at /restaurant/invoices/[id], emailed, and as a PDF.

type Payment = Database['public']['Tables']['subscription_payments']['Row'];
type Restaurant = Pick<Database['public']['Tables']['restaurants']['Row'], 'name' | 'address' | 'city' | 'zip' | 'phone'>;

const NAMES = { founding: 'Pioneer', monthly: 'Monthly', annual: 'Annual' } as const;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: serverEnv.timeZone }) : '–');

export type PlanInvoice = ReturnType<typeof planInvoice>;

export function planInvoice(x: Payment, restaurant: Restaurant) {
  const free = x.amount_cents === 0 && x.discount_cents > 0;
  return {
    id: x.id,
    number: x.invoice_number ?? '',
    dateText: day(x.created_at),
    restaurant,
    from: serverEnv.legal,
    description: `Bite Wise ${NAMES[x.plan].toLowerCase()} plan`,
    periodText: `${day(x.period_start)} – ${day(x.period_end)}`,
    listCents: x.list_price_cents ?? x.amount_cents + x.discount_cents,
    discountCents: x.discount_cents,
    discountLabel: x.discount_label || 'Discount',
    totalCents: x.amount_cents,
    free,
    paid: x.status === 'paid',
    note: free
      ? 'Pioneer membership: nothing to pay, no card on file.'
      : x.status === 'paid'
        ? `Paid with ${x.card_label}${x.transaction_id ? ` · transaction ${x.transaction_id}` : ''}.`
        : `Payment declined${x.error ? `: ${x.error}` : ''}.`,
  };
}

// By invoice number, read with full rights (for emails).
export async function planInvoiceByNumber(invoiceNumber: string) {
  const x = must(await supabaseAdmin().from('subscription_payments').select('*, restaurants(name, address, city, zip, phone)').eq('invoice_number', invoiceNumber).single());
  return planInvoice(x, x.restaurants!);
}
