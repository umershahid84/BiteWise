'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { deleteRestaurant, recheckRestaurantTax, sendWelcomeEmail, setRestaurantStatus, setRestaurantTaxRate, updateRestaurant } from '@/app/actions/admin';
import { resendConfirmation } from '@/app/actions/auth';
import { ErrorText } from '@/components/ui/alert';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { MenuImportDialog } from '@/components/restaurant/menu-import';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Spinner, Table } from '@/components/ui/misc';
import { PagerBar, PagerFooter, usePager } from '@/components/ui/pager';
import { PhoneInput } from '@/components/ui/phone-input';
import { StateSelect } from '@/components/ui/state-select';
import { SUSPENSION_DAYS } from '@/lib/constants';
import { money, pct } from '@/lib/format';
import { day, run, TableHead, useAdmin } from './shared';
import { DaysPicker } from './users';

type Plan = { plan: 'founding' | 'monthly' | 'annual'; status: 'active' | 'past_due' | 'expired'; foundingNumber: number | null; autoRenew: boolean; periodEnd: string | null };
type Tax = { source: 'auto' | 'manual'; accuracy: '' | 'address' | 'zip' | 'state' | 'manual'; jurisdiction: string; checkedAt: string | null; problem: string };
type Row = {
  id: number; name: string; cuisine: string; description: string; address: string; city: string; state: string; zip: string; tax: Tax; phone: string; status: 'pending' | 'approved' | 'suspended' | 'banned' | 'deleted';
  adminNote: string; taxRateBps: number; createdAt: string; suspendedUntil: string | null; ownerEmail: string; ownerUsername: string; activeOffers: number; orders: number;
  foodCents: number; stripeReady: boolean; stripeAccount: string | null; plan: Plan | null; ownerConfirmed: boolean; welcomeEmailSentAt: string | null;
};

// Shows what happened to the welcome email: a success, or a longer warning that stays until dismissed.
function emailToast(email: { ok: boolean; text: string } | null) {
  if (!email) return;
  if (email.ok) toast.success(email.text);
  else toast.warning(email.text, { duration: 15_000 });
}

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
  const [taxFor, setTaxFor] = useState<Row | null>(null);
  const [editFor, setEditFor] = useState<Row | null>(null);
  const [menuFor, setMenuFor] = useState<Row | null>(null);
  const { data, isLoading } = useAdmin<Row[]>(['restaurants', status, q], 'restaurants', { status, q });
  const pager = usePager(data ?? [], `${status}|${q}`);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin'] });
  const approve = async (r: Row) => {
    const label = r.status === 'pending' ? 'approved' : r.status === 'banned' ? 'unbanned and reinstated' : 'reinstated';
    if (r.status === 'banned' && !confirm(`Lift the ban on ${r.name}? The restaurant and its owner's login are reinstated.`)) return;
    const res = await setRestaurantStatus({ id: r.id, status: 'approved' });
    if (!res.ok) return toast.error(res.error);
    toast.success(`${r.name} is ${label}.`);
    emailToast(res.data.email);
    refresh();
  };
  const welcome = async (r: Row) => {
    const res = await sendWelcomeEmail({ id: r.id });
    if (!res.ok) return toast.error(res.error);
    emailToast(res.data.email);
    refresh();
  };
  const reconfirm = async (r: Row) => {
    if (await run(() => resendConfirmation({ login: r.ownerEmail }), `Confirmation email sent again to ${r.ownerEmail}.`)) refresh();
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
        <TableHead title="Restaurants" kind="restaurants" params={{ status, q }} what="these restaurants" />
        {isLoading ? <div className="grid place-items-center py-10"><Spinner /></div> : (
          <>
            <PagerBar pager={pager} label="restaurants" />
            <Table>
              <thead><tr><th>Restaurant</th><th>Owner</th><th>Activity</th><th>Plan</th><th>Status</th><th /></tr></thead>
              <tbody>
                {pager.rows.map((r) => (
                  <tr key={r.id} className={r.status === 'banned' || r.status === 'deleted' ? 'opacity-70' : undefined}>
                    <td><b>{r.name}</b><div className="text-xs text-muted">{r.cuisine} · {r.address}, {r.city}, {r.state} {r.zip}</div>
                      <button type="button" className="mt-0.5 text-left text-xs text-muted underline decoration-dotted underline-offset-2 hover:text-ink" onClick={() => setTaxFor(r)}>
                        Sales tax {pct(r.taxRateBps)}{r.tax.jurisdiction && ` · ${r.tax.jurisdiction}`}
                      </button>
                      {taxWarning(r.tax) && <div className="mt-0.5"><Badge tone="amber" title={r.tax.problem}>{taxWarning(r.tax)}</Badge></div>}{r.adminNote && <div className="text-xs text-accent-ink">Note: {r.adminNote}</div>}</td>
                    <td className="text-sm">
                      {r.ownerUsername}<div className="text-xs break-all text-muted">{r.ownerEmail}</div><div className="text-xs text-muted">joined {day(r.createdAt)}</div>
                      {!r.ownerConfirmed && r.status !== 'deleted' && (
                        <div className="mt-1"><Badge tone="amber" title="The owner hasn't clicked the link in the confirmation email. The welcome email is sent once they do.">Email not confirmed</Badge></div>
                      )}
                      {r.status === 'approved' && r.ownerConfirmed && (
                        <div className="mt-1 text-xs text-muted">{r.welcomeEmailSentAt ? `Welcome email sent ${day(r.welcomeEmailSentAt)}` : <span className="text-accent-ink">Welcome email not sent</span>}</div>
                      )}
                    </td>
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
                        {r.status !== 'deleted' && <Button size="sm" variant="ghost" onClick={() => setEditFor(r)}>Edit details</Button>}
                        {r.status !== 'deleted' && r.status !== 'banned' && <Button size="sm" variant="ghost" onClick={() => setMenuFor(r)}>Import menu</Button>}
                        {!r.ownerConfirmed && r.status !== 'deleted' && r.status !== 'banned' && (
                          <Button size="sm" variant="ghost" className="col-span-2" onClick={() => reconfirm(r)}>Resend confirmation</Button>
                        )}
                        {r.status === 'approved' && r.ownerConfirmed && (
                          <Button size="sm" variant="ghost" className="col-span-2" onClick={() => welcome(r)}>{r.welcomeEmailSentAt ? 'Resend welcome email' : 'Send welcome email'}</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <PagerFooter pager={pager} />
          </>
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
      <Dialog open={!!menuFor} onOpenChange={(o) => !o && setMenuFor(null)}>
        {menuFor && <MenuImportDialog restaurantId={menuFor.id} restaurantName={menuFor.name} onDone={() => { setMenuFor(null); refresh(); }} />}
      </Dialog>
      <Dialog open={!!editFor} onOpenChange={(o) => !o && setEditFor(null)}>
        {editFor && <EditRestaurant restaurant={editFor} onDone={() => { setEditFor(null); refresh(); }} onWelcome={welcome} />}
      </Dialog>
      <Dialog open={!!taxFor} onOpenChange={(o) => !o && setTaxFor(null)}>
        {taxFor && <SalesTax restaurant={taxFor} onDone={() => { setTaxFor(null); refresh(); }} />}
      </Dialog>
    </>
  );
}

// Corrects a restaurant's details and its owner's email and user name; then the welcome email can be sent again.
function EditRestaurant({ restaurant: r, onDone, onWelcome }: { restaurant: Row; onDone: () => void; onWelcome: (r: Row) => Promise<unknown> }) {
  const [f, setF] = useState({
    name: r.name, cuisine: r.cuisine, description: r.description, address: r.address, city: r.city, state: r.state, zip: r.zip, phone: r.phone,
    ownerEmail: r.ownerEmail, ownerUsername: r.ownerUsername,
  });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setF({ ...f, [k]: e.target.value }); setSaved(false); };
  const save = async () => {
    setBusy(true);
    const res = await updateRestaurant({ id: r.id, ...f });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setError(null);
    setSaved(true);
    toast.success(res.data.changed ? `${f.name} is updated.` : 'Nothing changed.');
  };
  return (
    <DialogContent title={`Edit ${r.name}`} description="A new address moves the map pin and looks the sales tax rate up again. A new owner email counts as confirmed." className="w-[min(640px,calc(100%-24px))]">
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label="Restaurant name" htmlFor="er-name"><Input id="er-name" value={f.name} onChange={set('name')} /></Field>
        <Field label="Cuisine" htmlFor="er-cuisine"><Input id="er-cuisine" value={f.cuisine} onChange={set('cuisine')} /></Field>
      </div>
      <Field label="About" htmlFor="er-desc"><Input id="er-desc" value={f.description} onChange={set('description')} /></Field>
      <Field label="Street address" htmlFor="er-address"><Input id="er-address" value={f.address} onChange={set('address')} /></Field>
      <div className="grid gap-x-3 sm:grid-cols-3">
        <Field label="City" htmlFor="er-city"><Input id="er-city" value={f.city} onChange={set('city')} /></Field>
        <Field label="State" htmlFor="er-state"><StateSelect id="er-state" value={f.state} onChange={set('state')} /></Field>
        <Field label="ZIP" htmlFor="er-zip"><Input id="er-zip" value={f.zip} onChange={set('zip')} /></Field>
      </div>
      <Field label="Phone" htmlFor="er-phone"><PhoneInput id="er-phone" value={f.phone} onValueChange={(phone) => { setF({ ...f, phone }); setSaved(false); }} /></Field>
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label="Owner email" htmlFor="er-email"><Input id="er-email" type="email" value={f.ownerEmail} onChange={set('ownerEmail')} /></Field>
        <Field label="Owner user name" htmlFor="er-user"><Input id="er-user" value={f.ownerUsername} onChange={set('ownerUsername')} /></Field>
      </div>
      <ErrorText error={error} />
      <Button block disabled={busy} onClick={save}>Save changes</Button>
      {r.status === 'approved' && (
        <Button block variant="ghost" className="mt-2" disabled={busy || (f.ownerEmail !== r.ownerEmail && !saved)} onClick={async () => { await onWelcome({ ...r, ownerEmail: f.ownerEmail }); onDone(); }}>
          {r.welcomeEmailSentAt ? 'Resend welcome email' : 'Send welcome email'}{saved || f.ownerEmail === r.ownerEmail ? ` to ${f.ownerEmail}` : ''}
        </Button>
      )}
      {saved && <Button block variant="ghost" className="mt-2" onClick={onDone}>Close</Button>}
    </DialogContent>
  );
}

// What an admin should check about a restaurant's tax rate, if anything.
function taxWarning(t: Tax) {
  if (t.accuracy === 'state') return 'Tax: state rate only, check it';
  if (!t.accuracy && t.source === 'auto') return 'Tax: not looked up yet';
  if (t.problem) return 'Tax: check';
  return null;
}

const ACCURACY: Record<Tax['accuracy'], string> = {
  address: 'Exact rate for the street address.',
  zip: 'Rate for the ZIP code area (the street address wasn\'t matched exactly).',
  state: 'Only the state rate is known: county and city taxes may be missing.',
  manual: 'Set by hand by an admin. The app doesn\'t change it.',
  '': 'Not looked up yet (the scheduled jobs do it within a few minutes).',
};

// Sales tax for one restaurant: where the rate came from, look it up again, or set it by hand.
function SalesTax({ restaurant: r, onDone }: { restaurant: Row; onDone: () => void }) {
  const [rate, setRate] = useState((r.taxRateBps / 100).toFixed(2));
  const [place, setPlace] = useState(r.tax.source === 'manual' ? r.tax.jurisdiction : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const recheck = async () => {
    setBusy(true);
    const res = await recheckRestaurantTax({ restaurantId: r.id });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    const d = res.data;
    if (d.kept) toast.warning(`Couldn't reach the tax rate service, so ${pct(d.rateBps)} was kept. ${d.note}`, { duration: 15_000 });
    else if (d.accuracy === 'state') toast.warning(`Only the state rate was found: ${pct(d.rateBps)}. ${d.note}`, { duration: 15_000 });
    else toast.success(`Sales tax ${pct(d.rateBps)} · ${d.jurisdiction}`);
    onDone();
  };
  const save = async () => {
    setBusy(true);
    const res = await setRestaurantTaxRate({ restaurantId: r.id, mode: 'manual', ratePct: rate, jurisdiction: place });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    toast.success(`${r.name}: sales tax set to ${rate}%`);
    onDone();
  };
  return (
    <DialogContent title={`Sales tax · ${r.name}`} description={`Customers pick up at ${r.address}, ${r.city}, ${r.state} ${r.zip}, so that address sets the sales tax rate.`}>
      <div className="mb-4 rounded-xl border border-line p-3 text-sm">
        <p className="m-0"><b>{pct(r.taxRateBps)}</b>{r.tax.jurisdiction && <span className="text-muted"> · {r.tax.jurisdiction}</span>}</p>
        <p className="m-0 mt-1 text-muted">{ACCURACY[r.tax.accuracy]}{r.tax.checkedAt && ` Checked ${day(r.tax.checkedAt)}.`}</p>
        {r.tax.problem && <p className="m-0 mt-1 text-accent-ink">{r.tax.problem}</p>}
      </div>
      <Button block variant="ghost" disabled={busy} onClick={recheck}>{r.tax.source === 'manual' ? 'Switch back to automatic (look the rate up)' : 'Look the rate up again'}</Button>
      <p className="mt-5 mb-2 text-sm font-bold">Or set the rate by hand</p>
      <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
        <Field label="Rate (%)" htmlFor="tx-rate"><Input id="tx-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
        <Field label="Where (optional)" htmlFor="tx-place"><Input id="tx-place" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="e.g. Portland, ME (meals tax)" /></Field>
      </div>
      <p className="mt-0 mb-3 text-xs text-muted">A rate set by hand isn&apos;t looked up again, until you switch it back to automatic. New orders use the new rate straight away.</p>
      <ErrorText error={error} />
      <Button block disabled={busy} onClick={save}>Save rate</Button>
    </DialogContent>
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
