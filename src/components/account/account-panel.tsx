'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, Gift, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { addCard, createCardSetupIntent, removeCard, setDefaultCard, updateHomeArea } from '@/app/actions/customer';
import { CardEntry, cardText, type CardEntryHandle, type PaymentConfigs } from '@/components/payments/card-entry';
import { ErrorText } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Checkbox, Field, Input } from '@/components/ui/field';
import { Table } from '@/components/ui/misc';
import { fmtDateTime, money } from '@/lib/format';
import { countryInfo, formatPostalInput, type Country } from '@/lib/regions';
import { supabaseBrowser } from '@/lib/supabase/client';

const KIND: Record<string, string> = {
  refund: 'Refund issued as credit',
  goodwill: 'Credit from Bite Wise',
  redeem: 'Used on order',
  restore: 'Returned to your credit',
  adjustment: 'Adjustment',
};

export function AccountPanel({ username, email, country, postalCode, payments }: {
  username: string; email: string; country: Country; postalCode: string; payments: PaymentConfigs;
}) {
  const supabase = supabaseBrowser();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const cards = useQuery({
    queryKey: ['cards'],
    queryFn: async () => (await supabase.from('payment_methods').select('*').order('is_default', { ascending: false }).order('created_at', { ascending: false })).data ?? [],
  });
  const credit = useQuery({
    queryKey: ['credit-history'],
    queryFn: async () => (await supabase.from('credit_ledger').select('*').order('id', { ascending: false }).limit(100)).data ?? [],
  });
  const balance = (credit.data ?? []).reduce((n, c) => n + c.amount_cents, 0);

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) => {
    const res = await fn();
    if (!res.ok) return toast.error(res.error);
    toast.success(success);
    queryClient.invalidateQueries({ queryKey: ['cards'] });
  };

  return (
    <div className="grid gap-5">
      <Card>
        <CardTitle>Profile</CardTitle>
        <div className="grid gap-1 text-sm">
          <div><span className="text-muted">User name:</span> <b>{username}</b></div>
          <div><span className="text-muted">Email:</span> <b>{email}</b></div>
        </div>
        <HomeArea country={country} postalCode={postalCode} />
      </Card>

      <Card id="credit" className="scroll-mt-24">
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle className="m-0 flex items-center gap-2"><Gift className="size-5 text-accent-ink" /> Bite Wise credit</CardTitle>
          <span className="flex-1" />
          <b className="font-heading text-3xl font-extrabold text-accent-ink">{money(balance)}</b>
        </div>
        <p className="mt-2 text-sm text-muted">
          Use your credit at checkout: you choose how much to apply, and your card covers the rest. Credit on orders that are cancelled or not
          picked up comes back here. <Link href="/legal/customer-terms">Terms</Link>
        </p>
        {credit.data?.length ? (
          <Table>
            <tbody>
              {credit.data.map((h) => (
                <tr key={h.id}>
                  <td className="text-xs whitespace-nowrap text-muted">{fmtDateTime(h.created_at)}</td>
                  <td className="text-sm">
                    {KIND[h.kind] ?? h.kind}
                    {h.order_id && <> · <Link href={`/orders/${h.order_id}/receipt`}>order #{h.order_id}</Link></>}
                    {h.note && <div className="text-muted">{h.note}</div>}
                  </td>
                  <td className={`text-right font-bold ${h.amount_cents < 0 ? 'text-ink-2' : 'text-primary-ink'}`}>
                    {h.amount_cents < 0 ? '−' : '+'}{money(Math.abs(h.amount_cents))}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <p className="mt-3 text-sm text-muted">No credit activity yet.</p>
        )}
      </Card>

      <Card>
        <div className="flex items-center gap-3">
          <CardTitle className="m-0 flex items-center gap-2"><CreditCard className="size-5" /> Saved cards</CardTitle>
          <span className="flex-1" />
          <Button size="sm" onClick={() => setAdding(true)}><Plus /> Add a card</Button>
        </div>
        <div className="mt-4 space-y-2">
          {cards.data?.length ? (
            cards.data.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line px-4 py-3">
                <span className="rounded-md bg-surface-2 px-2 py-1 text-xs font-bold uppercase">{c.brand}</span>
                <div>
                  <b>{cardText(c)}</b>
                  <div className="text-xs text-muted">
                    Expires {String(c.exp_month).padStart(2, '0')}/{c.exp_year}
                    {c.country !== country && ` · used at restaurants in ${c.country === 'CA' ? 'Canada' : 'the US'}`}
                  </div>
                </div>
                <span className="flex-1" />
                {c.is_default ? <Badge tone="green">Default</Badge> : (
                  <Button variant="ghost" size="sm" onClick={() => run(() => setDefaultCard(c.id), 'Default card updated')}>Make default</Button>
                )}
                <Button variant="danger" size="sm" onClick={() => confirm('Remove this card?') && run(() => removeCard(c.id), 'Card removed')}>Remove</Button>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted">No saved cards yet.</p>
          )}
        </div>
      </Card>

      <AddCardDialog
        open={adding}
        payments={payments}
        country={country}
        onClose={() => setAdding(false)}
        onSaved={() => {
          setAdding(false);
          toast.success('Card saved');
          queryClient.invalidateQueries({ queryKey: ['cards'] });
          router.refresh();
        }}
      />
    </div>
  );
}

// A card added here is saved for the customer's own country (US dollars in the US, Canadian dollars in Canada). An order
// at a restaurant in the other country is paid in that country's currency, with a card entered at checkout.
function AddCardDialog({ open, payments, country, onClose, onSaved }: {
  open: boolean; payments: PaymentConfigs; country: Country; onClose: () => void; onSaved: () => void;
}) {
  const ref = useRef<CardEntryHandle>(null);
  const payment = payments[country];
  const [makeDefault, setMakeDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      // With Stripe the card is confirmed through a SetupIntent so it can be charged later.
      let secret: string | null = null;
      if (payment.mode === 'stripe') {
        const setup = await createCardSetupIntent(country);
        if (!setup.ok) throw new Error(setup.error);
        secret = setup.data.clientSecret;
      }
      const token = await ref.current!.confirmSetup(secret);
      const res = await addCard(token, makeDefault, country);
      if (!res.ok) throw new Error(res.error);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {open && (
        <DialogContent title="Add a card">
          <CardEntry config={payment} ref={ref} />
          <Checkbox className="my-3" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} label="Make this my default card" />
          <ErrorText error={error} />
          <Button variant="green" block disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save card'}</Button>
        </DialogContent>
      )}
    </Dialog>
  );
}

// The customer's ZIP code (US) or postal code (Canada): the deals page opens around it, nearest deals first.
function HomeArea({ country, postalCode }: { country: Country; postalCode: string }) {
  const router = useRouter();
  const label = countryInfo(country).postalLabel;
  const [value, setValue] = useState(postalCode);
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await updateHomeArea(value);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    setValue(res.data.postalCode);
    try {
      sessionStorage.removeItem('bw-origin'); // the deals page starts again from the new area
    } catch {
      // storage unavailable
    }
    toast.success(res.data.located ? `${label} saved: deals near ${res.data.postalCode} show first.` : `${label} saved.`);
    router.refresh();
  };
  return (
    <form onSubmit={save} className="mt-4 flex flex-wrap items-start gap-3">
      <Field label={`Your ${label}`} htmlFor="home-postal" hint="Deals closest to it show first when you log in." className="m-0">
        <Input
          id="home-postal" value={value} onChange={(e) => setValue(formatPostalInput(country, e.target.value))} autoComplete="postal-code" required
          inputMode={country === 'US' ? 'numeric' : 'text'} maxLength={country === 'US' ? 10 : 7} placeholder={country === 'US' ? '98101' : 'M5V 3L9'}
          className={country === 'CA' ? 'w-40 uppercase' : 'w-40'}
        />
      </Field>
      <Button type="submit" size="sm" variant="ghost" className="mt-7" disabled={busy || !value.trim()}>{busy ? 'Saving…' : 'Save'}</Button>
    </form>
  );
}
