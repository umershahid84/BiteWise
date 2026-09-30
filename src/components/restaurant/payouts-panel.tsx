'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { refreshStripeStatus, startStripeOnboarding, stripeDashboardLink } from '@/app/actions/restaurant';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Kpi, Table } from '@/components/ui/misc';
import { fmtDateTime, money } from '@/lib/format';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { Ctx } from './types';

// Payouts through Stripe Connect (Express): onboarding, status, balance and transfer history.
export function PayoutsPanel({ ctx, stripeReturn }: { ctx: Ctx; stripeReturn: boolean }) {
  const supabase = supabaseBrowser();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const rid = ctx.restaurant.id;

  const data = useQuery({
    queryKey: ['payouts', rid],
    queryFn: async () => {
      const [acct, bal, history] = await Promise.all([
        supabase.from('restaurant_payment_accounts').select('*').eq('restaurant_id', rid).maybeSingle(),
        supabase.from('restaurant_balances').select('*').eq('restaurant_id', rid).maybeSingle(),
        supabase.from('payouts').select('*').eq('restaurant_id', rid).order('paid_at', { ascending: false }).limit(200),
      ]);
      return { acct: acct.data, bal: bal.data, history: history.data ?? [] };
    },
  });

  // Back from Stripe's hosted onboarding: refresh the account status.
  useEffect(() => {
    if (!stripeReturn) return;
    refreshStripeStatus().then(() => {
      queryClient.invalidateQueries({ queryKey: ['payouts', rid] });
      router.replace('/restaurant?tab=payouts', { scroll: false });
    });
  }, [stripeReturn, queryClient, rid, router]);

  const go = async (fn: typeof startStripeOnboarding) => {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    window.location.href = res.data.url;
  };

  const acct = data.data?.acct;
  const bal = data.data?.bal;
  const ready = !!acct?.charges_enabled;
  return (
    <div className="grid gap-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi value={money(bal?.earned_cents ?? 0)} label="Earned (completed orders)" />
        <Kpi value={money(bal?.paid_cents ?? 0)} label="Paid to you" />
        <Kpi value={money(bal?.balance_cents ?? 0)} label={ready ? 'Waiting to be transferred' : 'Held until you connect Stripe'} />
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
        <Card>
          <CardTitle>🏦 Payouts with Stripe</CardTitle>
          {ready ? (
            <>
              <p className="flex items-center gap-2 font-semibold text-primary-ink"><CheckCircle2 className="size-5" /> Your Stripe account is ready</p>
              <p className="text-sm text-ink-2">
                Your food sales are transferred to Stripe automatically when you confirm each pickup, and Stripe pays them to your bank.
                {acct?.bank_summary && <> Bank: <b>{acct.bank_summary}</b>.</>}
              </p>
              <div className="flex flex-wrap gap-2">
                <Badge tone={acct?.payouts_enabled ? 'green' : 'amber'}>{acct?.payouts_enabled ? 'Bank payouts on' : 'Bank payouts pending'}</Badge>
                <code className="text-xs">{acct?.stripe_account_id}</code>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => go(stripeDashboardLink)}><ExternalLink /> Open Stripe dashboard</Button>
                <Button variant="ghost" size="sm" onClick={async () => { await refreshStripeStatus(); queryClient.invalidateQueries({ queryKey: ['payouts', rid] }); }}><RefreshCw /> Refresh</Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-ink-2">
                Rescue Bites pays restaurants through <b>Stripe Connect</b>. Stripe verifies your business and bank account; Rescue Bites never sees your full bank
                details. It takes about 5 minutes.
              </p>
              {acct?.stripe_account_id && <Alert tone="warn" className="mb-3">Your Stripe setup isn&apos;t finished yet. Continue where you left off.</Alert>}
              <Button disabled={busy} onClick={() => go(startStripeOnboarding)}>
                {busy ? 'Opening Stripe…' : acct?.stripe_account_id ? 'Continue Stripe setup' : 'Set up payouts with Stripe'}
              </Button>
              {ctx.paymentMode === 'mock' && <p className="mt-2 text-xs text-muted">🧪 Test mode: setup completes instantly with a test bank account.</p>}
            </>
          )}
          <p className="mt-4 text-xs text-muted">See section 5 of the <a href="/legal/restaurant-agreement" target="_blank">Partner Agreement</a> for how payouts, refunds and platform credit work.</p>
        </Card>
        <Card>
          <CardTitle>Payout history</CardTitle>
          {data.data?.history.length ? (
            <Table>
              <thead><tr><th>Date</th><th>Invoice number</th><th className="text-right">Amount</th></tr></thead>
              <tbody>
                {data.data.history.map((x) => (
                  <tr key={x.id}>
                    <td className="text-xs whitespace-nowrap">{fmtDateTime(x.paid_at)}</td>
                    <td>
                      <code className="text-xs">{x.invoice_number}</code>
                      <div className="text-xs text-muted">{x.kind === 'reversal' ? 'Refund reversal · ' : ''}{x.note}</div>
                      <div className="text-xs text-muted">{x.bank_details} · {x.transaction_id}</div>
                    </td>
                    <td className={`text-right font-bold ${x.amount_cents < 0 ? 'text-danger' : ''}`}>{money(x.amount_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p className="text-sm text-muted">No payouts yet. Each payout shows an invoice number and the Stripe transaction ID, so you can match every deposit.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
