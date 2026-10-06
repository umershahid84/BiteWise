import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PrintButton } from '@/components/app/print-button';
import { buttonVariants } from '@/components/ui/button';
import { requirePageViewer } from '@/lib/auth';
import { serverEnv } from '@/lib/env';
import { money } from '@/lib/format';
import { displayPhone } from '@/lib/phone';
import { supabaseServer } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Invoice' };

const NAMES = { founding: 'Pioneer', monthly: 'Monthly', annual: 'Annual' } as const;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: serverEnv.timeZone }) : '–');

// A plan invoice, printable. Read with the signed-in user's rights: restaurants see their own, admins all.
export default async function InvoicePage({ params }: PageProps<'/restaurant/invoices/[id]'>) {
  const { id } = await params;
  const viewer = await requirePageViewer();
  if (viewer.role === 'customer') notFound();
  const supabase = await supabaseServer();
  const { data: x } = await supabase.from('subscription_payments').select('*, restaurants(name, address, city, zip, phone)').eq('id', Number(id)).maybeSingle();
  if (!x || !x.invoice_number) notFound();
  const r = x.restaurants;
  const list = x.list_price_cents ?? x.amount_cents + x.discount_cents;
  const free = x.amount_cents === 0 && x.discount_cents > 0;
  return (
    <main className="container-page max-w-[680px] py-8">
      <div className="no-print mb-5 flex flex-wrap items-center gap-2">
        <Link href={viewer.role === 'admin' ? '/admin#plans' : '/restaurant?tab=plan'} className={buttonVariants({ variant: 'ghost', size: 'sm' })}><ArrowLeft /> Back</Link>
        <span className="flex-1" />
        <PrintButton />
      </div>
      <article className="rounded-2xl bg-white p-8 text-[#1E293B] shadow-pop print:shadow-none">
        <header className="mb-6 flex flex-wrap items-start gap-4 border-b border-[#E2E8F0] pb-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/logo.png" alt="Bite Wise" className="h-10 w-auto" />
          <div className="flex-1" />
          <div className="text-right">
            <p className="m-0 text-2xl font-extrabold text-[#14284B]">INVOICE</p>
            <p className="m-0 font-mono text-sm">{x.invoice_number}</p>
            <p className="m-0 text-sm text-[#64748B]">{day(x.created_at)}</p>
          </div>
        </header>
        <div className="mb-6 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <p className="m-0 text-xs font-bold tracking-wider text-[#64748B] uppercase">Billed to</p>
            <p className="m-0 font-bold">{r?.name}</p>
            <p className="m-0">{r?.address}<br />{r?.city}, WA {r?.zip}{r?.phone && <><br />{displayPhone(r.phone)}</>}</p>
          </div>
          <div className="sm:text-right">
            <p className="m-0 text-xs font-bold tracking-wider text-[#64748B] uppercase">From</p>
            <p className="m-0 font-bold">{serverEnv.legal.entity}</p>
            <p className="m-0">{serverEnv.legal.address}<br />{serverEnv.legal.email}</p>
          </div>
        </div>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[#E2E8F0] text-left text-xs tracking-wider text-[#64748B] uppercase"><th className="py-2">Description</th><th className="py-2 text-right">Amount</th></tr>
          </thead>
          <tbody>
            <tr className="border-b border-[#F1F5F9]">
              <td className="py-3">
                <b>Bite Wise {NAMES[x.plan].toLowerCase()} plan</b>
                <div className="text-xs text-[#64748B]">{day(x.period_start)} – {day(x.period_end)}</div>
              </td>
              <td className="py-3 text-right">{money(list)}</td>
            </tr>
            {x.discount_cents > 0 && (
              <tr className="border-b border-[#F1F5F9] text-[#3E8230]"><td className="py-3">{x.discount_label || 'Discount'}</td><td className="py-3 text-right">−{money(x.discount_cents)}</td></tr>
            )}
            <tr>
              <td className="pt-4 text-base font-extrabold">{free ? 'Total due' : 'Total paid'}</td>
              <td className="pt-4 text-right text-xl font-extrabold">{money(x.amount_cents)}{free && <span className="ml-2 text-sm text-[#3E8230]">FREE</span>}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-6 mb-0 text-xs text-[#64748B]">
          {free ? 'Pioneer membership: nothing to pay, no card on file.' : x.status === 'paid' ? `Paid with ${x.card_label}${x.transaction_id ? ` · transaction ${x.transaction_id}` : ''}.` : `Payment declined${x.error ? `: ${x.error}` : ''}.`}
        </p>
      </article>
    </main>
  );
}
