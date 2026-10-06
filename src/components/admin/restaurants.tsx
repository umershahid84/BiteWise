'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { deleteRestaurant, setRestaurantStatus } from '@/app/actions/admin';
import { ErrorText } from '@/components/ui/alert';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Spinner, Table } from '@/components/ui/misc';
import { SUSPENSION_DAYS } from '@/lib/constants';
import { money, pct } from '@/lib/format';
import { day, run, useAdmin } from './shared';
import { DaysPicker } from './users';

type Plan = { plan: 'founding' | 'monthly' | 'annual'; status: 'active' | 'past_due' | 'expired'; foundingNumber: number | null; autoRenew: boolean; periodEnd: string | null };
type Row = {
  id: number; name: string; cuisine: string; address: string; city: string; zip: string; phone: string; status: 'pending' | 'approved' | 'suspended' | 'banned' | 'deleted';
  adminNote: string; taxRateBps: number; createdAt: string; suspendedUntil: string | null; ownerEmail: string; ownerUsername: string; activeOffers: number; orders: number;
  foodCents: number; stripeReady: boolean; stripeAccount: string | null; plan: Plan | null;
};

function PlanBadge({ plan }: { plan: Plan | null }) {
  if (!plan) return <Badge tone="neutral">No plan</Badge>;
  if (plan.plan === 'founding' || plan.foundingNumber) return <Badge tone="green">🎉 Pioneer #{plan.foundingNumber ?? '–'}{plan.plan !== 'founding' && ` · ${plan.plan === 'annual' ? 'annual' : 'monthly'}`}</Badge>;
  const name = plan.plan === 'annual' ? 'Annual' : 'Monthly';
  if (plan.status === 'expired') return <Badge tone="red">{name}: lapsed</Badge>;
  if (plan.status === 'past_due') return <Badge tone="red">{name}: delinquent</Badge>;
  return (
    <span>
      <Badge tone="green">{name}</Badge>
      <div className="mt-1 text-xs text-muted">{plan.autoRenew ? 'renews' : 'ends'} {day(plan.periodEnd)}</div>
    </span>
  );
}

export function RestaurantsPanel() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [suspendFor, setSuspendFor] = useState<Row | null>(null);
  const [banFor, setBanFor] = useState<Row | null>(null);
  const [deleteFor, setDeleteFor] = useState<Row | null>(null);
  const { data, isLoading } = useAdmin<Row[]>(['restaurants', status, q], 'restaurants', { status, q });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin'] });
  const approve = async (r: Row) => {
    const label = r.status === 'pending' ? 'approved' : r.status === 'banned' ? 'unbanned and reinstated' : 'reinstated';
    if (r.status === 'banned' && !confirm(`Lift the ban on ${r.name}? The restaurant and its owner's login are reinstated.`)) return;
    if (await run(() => setRestaurantStatus({ id: r.id, status: 'approved' }), `${r.name} is ${label}`)) refresh();
  };
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-3">
        <Input className="max-w-sm" placeholder="Search name, city, ZIP or owner email" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select className="max-w-52" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option><option value="pending">Pending approval</option><option value="approved">Approved</option>
          <option value="suspended">Suspended</option><option value="banned">Banned</option><option value="deleted">Deleted</option>
        </Select>
      </div>
      <Card className="p-2">
        {isLoading ? <div className="grid place-items-center py-10"><Spinner /></div> : (
          <Table>
            <thead><tr><th>Restaurant</th><th>Owner</th><th>Activity</th><th>Plan</th><th>Status</th><th /></tr></thead>
            <tbody>
              {(data ?? []).map((r) => (
                <tr key={r.id} className={r.status === 'banned' || r.status === 'deleted' ? 'opacity-70' : undefined}>
                  <td><b>{r.name}</b><div className="text-xs text-muted">{r.cuisine} · {r.address}, {r.city} {r.zip} · tax {pct(r.taxRateBps)}</div>{r.adminNote && <div className="text-xs text-accent-ink">Note: {r.adminNote}</div>}</td>
                  <td className="text-sm">{r.ownerUsername}<div className="text-xs break-all text-muted">{r.ownerEmail}</div><div className="text-xs text-muted">joined {day(r.createdAt)}</div></td>
                  <td className="text-sm">{r.activeOffers} live offers<div className="text-xs text-muted">{r.orders} orders · {money(r.foodCents)}</div></td>
                  <td><PlanBadge plan={r.plan} /></td>
                  <td>
                    <StatusBadge status={r.status} label={r.status === 'pending' ? 'Pending approval' : undefined} />
                    <div className="mt-1">{r.stripeReady ? <Badge tone="green">Stripe ready</Badge> : <Badge tone="neutral">Stripe not connected</Badge>}</div>
                    {r.status === 'suspended' && <div className="mt-1 text-xs text-muted">{r.suspendedUntil ? `until ${day(r.suspendedUntil)}` : 'until reinstated'}</div>}
                  </td>
                  <td className="w-[210px] min-w-[210px]">
                    {/* Two buttons per row at most, so every action stays visible without scrolling sideways. */}
                    <div className="grid grid-cols-2 gap-1.5 [&>*]:w-full">
                      {r.status !== 'approved' && r.status !== 'deleted' && <Button size="sm" variant="green" onClick={() => approve(r)}>{r.status === 'pending' ? 'Approve' : r.status === 'banned' ? 'Lift ban' : 'Reinstate'}</Button>}
                      {(r.status === 'approved' || r.status === 'pending') && <Button size="sm" variant="danger" onClick={() => setSuspendFor(r)}>Suspend</Button>}
                      {r.status !== 'banned' && r.status !== 'deleted' && <Button size="sm" variant="ghost" className="text-danger" onClick={() => setBanFor(r)}>Ban</Button>}
                      {r.status !== 'deleted' && <Button size="sm" variant="ghost" className="text-danger" onClick={() => setDeleteFor(r)}>Delete</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Dialog open={!!suspendFor} onOpenChange={(o) => !o && setSuspendFor(null)}>
        {suspendFor && <SuspendRestaurant restaurant={suspendFor} onDone={() => { setSuspendFor(null); refresh(); }} />}
      </Dialog>
      <Dialog open={!!deleteFor} onOpenChange={(o) => !o && setDeleteFor(null)}>
        {deleteFor && <DeleteRestaurant restaurant={deleteFor} onDone={() => { setDeleteFor(null); refresh(); }} />}
      </Dialog>
      <Dialog open={!!banFor} onOpenChange={(o) => !o && setBanFor(null)}>
        {banFor && <BanRestaurant restaurant={banFor} onDone={() => { setBanFor(null); refresh(); }} />}
      </Dialog>
    </>
  );
}

function SuspendRestaurant({ restaurant, onDone }: { restaurant: Row; onDone: () => void }) {
  const [days, setDays] = useState<number>(SUSPENSION_DAYS[0]);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <DialogContent title={`Suspend ${restaurant.name}`} description="Its offers are hidden and it can't post new ones until the suspension ends; staff can still hand over orders already placed. It is reinstated by itself afterwards, or you can reinstate it sooner.">
      <DaysPicker days={days} onChange={setDays} />
      <Field label="Reason (shown to the restaurant)" htmlFor="rs-reason"><Input id="rs-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Customer complaints about food temperature" /></Field>
      <ErrorText error={error} />
      <Button block variant="danger" disabled={busy} onClick={async () => {
        setBusy(true);
        const res = await setRestaurantStatus({ id: restaurant.id, status: 'suspended', days, note: reason });
        setBusy(false);
        if (!res.ok) return setError(res.error);
        toast.success(`${restaurant.name} is suspended for ${days} days`);
        onDone();
      }}>Suspend for {days} days</Button>
    </DialogContent>
  );
}

function BanRestaurant({ restaurant, onDone }: { restaurant: Row; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <DialogContent title={`Ban ${restaurant.name}?`} description="A permanent removal from Bite Wise.">
      <ul className="mt-0 mb-4 list-disc pl-5 text-sm text-ink-2">
        <li>All its offers end and open orders are cancelled (customers aren&apos;t charged).</li>
        <li>Its kiosk link stops working, and the owner ({restaurant.ownerUsername}) can no longer log in.</li>
        <li>The owner&apos;s email can&apos;t be used to sign up again. Sales, payout and tax records are kept.</li>
      </ul>
      <Field label="Reason (kept in the audit log)" htmlFor="rb-reason"><Input id="rb-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <Field label={`Type ${restaurant.name} to confirm`} htmlFor="rb-confirm"><Input id="rb-confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" /></Field>
      <ErrorText error={error} />
      <Button block variant="danger" disabled={busy || confirmText.trim().toLowerCase() !== restaurant.name.toLowerCase()} onClick={async () => {
        setBusy(true);
        const res = await setRestaurantStatus({ id: restaurant.id, status: 'banned', note: reason });
        setBusy(false);
        if (!res.ok) return setError(res.error);
        toast.success(`${restaurant.name} is banned`);
        onDone();
      }}>Ban permanently</Button>
    </DialogContent>
  );
}

function DeleteRestaurant({ restaurant, onDone }: { restaurant: Row; onDone: () => void }) {
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hasHistory = restaurant.orders > 0 || (!!restaurant.plan && restaurant.plan.plan !== 'founding' && !restaurant.plan.foundingNumber);
  return (
    <DialogContent title={`Delete ${restaurant.name}?`} description="This can't be undone.">
      <ul className="mt-0 mb-4 list-disc pl-5 text-sm text-ink-2">
        <li>The restaurant is taken off Bite Wise: its offers end, open orders are cancelled (customers aren&apos;t charged) and its kiosk link stops working.</li>
        <li>The owner&apos;s account ({restaurant.ownerUsername}, {restaurant.ownerEmail}) is deleted too, with its saved cards. A paid plan stops renewing.</li>
        <li>
          {hasHistory
            ? <>It has sales or plan payments, which are kept for sales and tax records: the restaurant moves to <b>Deleted</b> (see the status filter) and the owner&apos;s name and email are erased.</>
            : <>It has no sales history, so the restaurant, its menu and its offers are removed completely.</>}
        </li>
      </ul>
      <Field label={`Type ${restaurant.name} to confirm`} htmlFor="rd-confirm"><Input id="rd-confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" /></Field>
      <ErrorText error={error} />
      <Button block variant="danger" disabled={busy || confirmText.trim().toLowerCase() !== restaurant.name.toLowerCase()} onClick={async () => {
        setBusy(true);
        const res = await deleteRestaurant({ id: restaurant.id });
        setBusy(false);
        if (!res.ok) return setError(res.error);
        toast.success(res.data.anonymized ? `${restaurant.name} is deleted (sales records kept)` : `${restaurant.name} is deleted`);
        onDone();
      }}>Delete restaurant</Button>
    </DialogContent>
  );
}
