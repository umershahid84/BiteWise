import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PrintButton } from '@/components/app/print-button';
import { buttonVariants } from '@/components/ui/button';
import { requirePageViewer } from '@/lib/auth';
import { money } from '@/lib/format';
import { displayPhone } from '@/lib/phone';
import { planInvoice } from '@/lib/receipts/plan-invoice';
import { supabaseServer } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Invoice' };


// A plan invoice, printable. Read with the signed-in user's rights: restaurants see their own, admins all.
export default async function InvoicePage({ params }: PageProps<'/restaurant/invoices/[id]'>) {
  const { id } = await params;
  const viewer = await requirePageViewer();
  if (viewer.role === 'customer') notFound();
  const supabase = await supabaseServer();
  const { data: x } = await supabase.from('subscription_payments').select('*, restaurants(name, address, city, zip, phone)').eq('id', Number(id)).maybeSingle();
  if (!x || !x.invoice_number || !x.restaurants) notFound();
  const inv = planInvoice(x, x.restaurants);
  const r = inv.restaurant;
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
            <p className="m-0 font-mono text-sm">{inv.number}</p>
            <p className="m-0 text-sm text-[#64748B]">{inv.dateText}</p>
          </div>
        </header>
        <div className="mb-6 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <p className="m-0 text-xs font-bold tracking-wider text-[#64748B] uppercase">Billed to</p>
            <p className="m-0 font-bold">{r.name}</p>
            <p className="m-0">{r.address}<br />{r.city}, WA {r.zip}{r.phone && <><br />{displayPhone(r.phone)}</>}</p>
          </div>
          <div className="sm:text-right">
            <p className="m-0 text-xs font-bold tracking-wider text-[#64748B] uppercase">From</p>
            <p className="m-0 font-bold">{inv.from.entity}</p>
            <p className="m-0">{inv.from.address}<br />{inv.from.email}</p>
          </div>
        </div>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[#E2E8F0] text-left text-xs tracking-wider text-[#64748B] uppercase"><th className="py-2">Description</th><th className="py-2 text-right">Amount</th></tr>
          </thead>
          <tbody>
            <tr className="border-b border-[#F1F5F9]">
              <td className="py-3">
                <b>{inv.description}</b>
                <div className="text-xs text-[#64748B]">{inv.periodText}</div>
              </td>
              <td className="py-3 text-right">{money(inv.listCents)}</td>
            </tr>
            {inv.discountCents > 0 && (
              <tr className="border-b border-[#F1F5F9] text-[#3E8230]"><td className="py-3">{inv.discountLabel}</td><td className="py-3 text-right">−{money(inv.discountCents)}</td></tr>
            )}
            <tr>
              <td className="pt-4 text-base font-extrabold">{inv.free || !inv.paid ? 'Total due' : 'Total paid'}</td>
              <td className="pt-4 text-right text-xl font-extrabold">{money(inv.totalCents)}{inv.free && <span className="ml-2 text-sm text-[#3E8230]">FREE</span>}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-6 mb-0 text-xs text-[#64748B]">
          {inv.note}
        </p>
      </article>
    </main>
  );
}
