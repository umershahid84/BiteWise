'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Mail, Plus, Ticket } from 'lucide-react';
import { toast } from 'sonner';
import { createCouponAction, emailCouponAction, setCouponActiveAction } from '@/app/actions/admin';
import { ErrorText } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Checkbox, Field, Input } from '@/components/ui/field';
import { Spinner, Table } from '@/components/ui/misc';
import { cn } from '@/lib/utils';
import { day, daysAgo, LoadError, money, useAccess, useAdmin } from './shared';

type Kind = 'no_fee' | 'fixed' | 'percent';
type Coupon = {
  id: number; code: string; kind: Kind; offer: string; description: string; expiresAt: string; expired: boolean; active: boolean;
  createdAt: string; emailedAt: string | null; emailedCount: number; uses: number; restaurantCostCents: number; bitewiseCostCents: number;
};

const KINDS: [Kind, string, string][] = [
  ['no_fee', 'No service fee', 'Waives the Bite Wise service fee. Bite Wise pays for it; the restaurant gets its full amount.'],
  ['fixed', 'Dollar amount off', 'A set amount off the food. Paid by the restaurant: it comes off the restaurant’s payout for the order.'],
  ['percent', 'Percentage off', 'A percentage off the food. Paid by the restaurant: it comes off the restaurant’s payout for the order.'],
];

// Coupons for the admin's location: make one, email it to every customer there, see how it's used.
export function CouponsPanel() {
  const me = useAccess();
  const queryClient = useQueryClient();
  const { error: loadError, data, isLoading } = useAdmin<Coupon[]>(['coupons'], 'coupons');
  const [creating, setCreating] = useState(false);
  const where = me.country === 'CA' ? 'Canada' : 'the United States';
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'coupons'] });

  const email = async (c: Coupon) => {
    if (!confirm(`Email coupon ${c.code} to every customer in ${where}?${c.emailedAt ? ' It was emailed before; they will get it again.' : ''}`)) return;
    const res = await emailCouponAction({ id: c.id });
    if (!res.ok) return toast.error(res.error);
    toast.success(`Sending ${c.code} to ${res.data.customers} customers.`);
    refresh();
  };
  const toggle = async (c: Coupon) => {
    const res = await setCouponActiveAction({ id: c.id, active: !c.active });
    if (!res.ok) return toast.error(res.error);
    toast.success(c.active ? `${c.code} is turned off.` : `${c.code} is turned on.`);
    refresh();
  };

  if (loadError && !data) return <LoadError error={loadError} />;
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <CardTitle className="m-0 flex items-center gap-2"><Ticket className="size-5" /> Coupons · {me.country === 'CA' ? 'Canada' : 'United States'}</CardTitle>
        <span className="flex-1" />
        <Button variant="green" onClick={() => setCreating(true)}><Plus /> New coupon</Button>
      </div>
      <p className="mt-0 mb-4 text-sm text-muted">
        Customers enter the code at checkout: one coupon per order, and each coupon once per customer. Food discounts are paid by the restaurant
        (Restaurant Partner Agreement); a waived service fee is paid by Bite Wise. Coupons work at restaurants in {where} only.
      </p>
      {isLoading || !data ? <div className="grid place-items-center py-8"><Spinner /></div> : data.length === 0 ? (
        <p className="text-sm text-muted">No coupons yet.</p>
      ) : (
        <Table>
          <thead><tr><th>Code</th><th>Offer</th><th>Expires</th><th>Used</th><th>Paid by restaurants</th><th>Paid by Bite Wise</th><th>Emailed</th><th /></tr></thead>
          <tbody>
            {data.map((c) => (
              <tr key={c.id} className={cn(!c.active && 'opacity-60')}>
                <td>
                  <b className="font-mono tracking-wide">{c.code}</b>
                  <div className="mt-0.5">{c.expired ? <Badge tone="neutral">Expired</Badge> : c.active ? <Badge tone="green">Active</Badge> : <Badge tone="amber">Off</Badge>}</div>
                </td>
                <td className="text-sm"><b>{c.offer}</b>{c.description && <div className="text-xs text-muted">{c.description}</div>}</td>
                <td className="text-sm whitespace-nowrap">{day(c.expiresAt)}</td>
                <td>{c.uses}</td>
                <td>{money(c.restaurantCostCents)}</td>
                <td>{money(c.bitewiseCostCents)}</td>
                <td className="text-sm">{c.emailedAt ? <>{day(c.emailedAt)}<div className="text-xs text-muted">{c.emailedCount} sent</div></> : '–'}</td>
                <td className="whitespace-nowrap">
                  <div className="flex gap-1.5">
                    {c.active && !c.expired && <Button size="sm" variant="ghost" onClick={() => email(c)}><Mail /> Email all customers</Button>}
                    {!c.expired && <Button size="sm" variant="ghost" onClick={() => toggle(c)}>{c.active ? 'Turn off' : 'Turn on'}</Button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        {creating && <NewCoupon where={where} onDone={() => { setCreating(false); refresh(); }} />}
      </Dialog>
    </Card>
  );
}

function NewCoupon({ where, onDone }: { where: string; onDone: () => void }) {
  const inMonth = daysAgo(-30);
  const [f, setF] = useState({ kind: 'percent' as Kind, amount: '5.00', percent: '20', code: '', description: '', expiresOn: inMonth, email: true });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setError(null);
    const res = await createCouponAction(f);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    toast.success(res.data.emailedTo !== null ? `Coupon ${res.data.code} created and being emailed to ${res.data.emailedTo} customers.` : `Coupon ${res.data.code} created.`);
    onDone();
  };
  return (
    <DialogContent title="New coupon" description={`For customers ordering at restaurants in ${where}.`}>
      <div role="radiogroup" className="mb-4 grid gap-2">
        {KINDS.map(([k, label, hint]) => (
          <button key={k} type="button" role="radio" aria-checked={f.kind === k} onClick={() => setF({ ...f, kind: k })}
            className={cn('rounded-2xl border p-3 text-left', f.kind === k ? 'border-primary bg-primary-soft/60' : 'border-line')}>
            <b>{label}</b><span className="block text-xs text-muted">{hint}</span>
          </button>
        ))}
      </div>
      {f.kind === 'fixed' && (
        <Field label="Amount off the food ($)" htmlFor="cp-amount" hint="Never more than the food's price.">
          <Input id="cp-amount" inputMode="decimal" className="max-w-40" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        </Field>
      )}
      {f.kind === 'percent' && (
        <Field label="Percentage off the food" htmlFor="cp-percent">
          <Input id="cp-percent" inputMode="numeric" className="max-w-40" value={f.percent} onChange={(e) => setF({ ...f, percent: e.target.value })} />
        </Field>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Code" htmlFor="cp-code" hint="Leave empty for a random code.">
          <Input id="cp-code" className="uppercase" maxLength={24} placeholder="e.g. WELCOME20" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Expires after" htmlFor="cp-expires" hint="Valid through the end of this day.">
          <Input id="cp-expires" type="date" value={f.expiresOn} onChange={(e) => setF({ ...f, expiresOn: e.target.value })} />
        </Field>
      </div>
      <Field label="Message for customers (optional)" htmlFor="cp-desc">
        <Input id="cp-desc" maxLength={300} placeholder="Thanks for rescuing food with us!" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </Field>
      <Checkbox className="mb-4" checked={f.email} onChange={(e) => setF({ ...f, email: e.target.checked })} label={`Email it now to every customer in ${where}`} />
      <ErrorText error={error} />
      <Button block disabled={busy} onClick={save}>{busy ? 'Creating…' : 'Create coupon'}</Button>
    </DialogContent>
  );
}
