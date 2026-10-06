'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  cancelFeeChange, chargeDelinquentPlan, deleteFeeTemplate, previewFeeChange, saveFeeTemplate, scheduleFeeChange, updatePlanSettings,
} from '@/app/actions/admin';
import { Alert, ErrorText } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/field';
import { Kpi, Spinner, Table } from '@/components/ui/misc';
import { PagerBar, PagerFooter, usePager } from '@/components/ui/pager';
import { money } from '@/lib/format';
import { cn } from '@/lib/utils';
import { day, run, useAdmin } from './shared';

type Row = {
  restaurantId: number; name: string; city: string; restaurantStatus: string; ownerEmail: string;
  plan: 'founding' | 'monthly' | 'annual' | null; status: 'active' | 'past_due' | 'expired' | null; foundingNumber: number | null; autoRenew: boolean;
  priceCents: number; periodEnd: string | null; lockedCents: number | null; cardLabel: string; lastPaymentError: string; paid12mCents: number;
};
type Template = { id: number; name: string; subject: string; body: string };
type Change = {
  id: number; monthly_cents: number; annual_cents: number; previous_monthly_cents: number; previous_annual_cents: number; effective_at: string;
  effectiveLabel: string; applies_to_existing: boolean; template_name: string; emails_sent: number; emails_failed: number; created_at: string;
  applied_at: string | null; cancelled_at: string | null; profiles: { username: string } | null;
};
type Data = {
  prices: {
    monthlyCents: number; annualCents: number; foundingSpots: number; foundingTaken: number; foundingLeft: number; reminderDaysAnnual: number; reminderDaysMonthly: number;
  };
  summary: { founding: number; monthly: number; annual: number; delinquent: number; noPlan: number; mrrCents: number; paid12mCents: number };
  templates: Template[];
  pendingChange: Change | null;
  changes: Change[];
  audience: { withoutFounding: number; founding: number };
  rows: Row[];
};

const FILTERS = { all: 'All restaurants', past_due: 'Delinquent', founding: 'Pioneer Members', monthly: 'Monthly', annual: 'Annual', none: 'No plan', expired: 'Ended' } as const;
// Pioneer Members (and the old founding plan) pay nothing.
const pioneer = (r: Pick<Row, 'plan' | 'foundingNumber'>) => r.plan === 'founding' || r.foundingNumber != null;

const PLACEHOLDERS = ['{{restaurant}}', '{{effective_date}}', '{{old_monthly}}', '{{new_monthly}}', '{{old_annual}}', '{{new_annual}}', '{{your_plan}}'];

function PlanCell({ r }: { r: Row }) {
  if (!r.plan) return <Badge tone="neutral">No plan</Badge>;
  if (r.plan === 'founding' || r.foundingNumber) return <Badge tone="green">🎉 Pioneer #{r.foundingNumber ?? '–'}{r.plan !== 'founding' && ` · ${r.plan === 'annual' ? 'annual' : 'monthly'}`}</Badge>;
  const name = r.plan === 'annual' ? 'Annual' : 'Monthly';
  if (r.status === 'past_due') return <Badge tone="red">{name}: delinquent</Badge>;
  if (r.status === 'expired') return <Badge tone="neutral">{name}: ended</Badge>;
  return <Badge tone="green">{name}</Badge>;
}

// Restaurant plans: fee changes (announced by email, with a choice of who pays the new fees), plan settings, and every
// restaurant's plan, with delinquent ones first.
export function PlansPanel() {
  const queryClient = useQueryClient();
  const { data } = useAdmin<Data>(['plans'], 'plans');
  const [filter, setFilter] = useState<keyof typeof FILTERS>('all');
  const rows = (data?.rows ?? []).filter((r) =>
    filter === 'all' ? true : filter === 'none' ? !r.plan : filter === 'past_due' || filter === 'expired' ? r.status === filter
      : filter === 'founding' ? pioneer(r) : r.plan === filter && r.status === 'active' && !pioneer(r));
  const pager = usePager(rows, filter);
  if (!data) return <Spinner />;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin'] });
  const s = data.summary;
  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi value={money(s.mrrCents)} label="Monthly recurring revenue" />
        <Kpi value={money(s.paid12mCents)} label="Plan payments, last 12 months" />
        <Kpi value={`${s.monthly} · ${s.annual}`} label="Paying: monthly · annual" />
        <Kpi value={`${data.prices.foundingTaken} / ${data.prices.foundingSpots}`} label="Pioneer Member spots used" />
        <Kpi value={<span className={s.delinquent ? 'text-danger' : undefined}>{s.delinquent}</span>} label={`Delinquent · ${s.noPlan} without a plan`} />
      </div>

      {data.pendingChange ? <PendingChange change={data.pendingChange} onChanged={refresh} /> : <FeeChangeForm data={data} onChanged={refresh} />}

      <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <PlanSettings key={JSON.stringify(data.prices)} prices={data.prices} onSaved={refresh} />
        <Card className="p-2">
          <CardTitle className="m-0 p-3">Fee change history</CardTitle>
          <Table>
            <thead><tr><th>Effective</th><th>Monthly</th><th>Annual</th><th>Existing plans</th><th>Emails</th><th>Status</th></tr></thead>
            <tbody>
              {data.changes.map((c) => (
                <tr key={c.id}>
                  <td className="text-sm">{day(c.effective_at)}<div className="text-xs text-muted">by {c.profiles?.username ?? '–'} · {c.template_name || 'custom email'}</div></td>
                  <td className="text-sm">{money(c.previous_monthly_cents)} → <b>{money(c.monthly_cents)}</b></td>
                  <td className="text-sm">{money(c.previous_annual_cents)} → <b>{money(c.annual_cents)}</b></td>
                  <td className="text-sm">{c.applies_to_existing ? 'New fees at renewal' : 'Keep their fees'}</td>
                  <td className="text-sm">{c.emails_sent}{c.emails_failed ? <span className="text-danger"> · {c.emails_failed} not sent</span> : ''}</td>
                  <td>{c.cancelled_at ? <Badge tone="neutral">Cancelled</Badge> : c.applied_at ? <Badge tone="green">In effect</Badge> : <Badge tone="amber">Scheduled</Badge>}</td>
                </tr>
              ))}
              {!data.changes.length && <tr><td colSpan={6} className="py-6 text-center text-muted">No fee changes yet.</td></tr>}
            </tbody>
          </Table>
        </Card>
      </div>

      <Card className="p-2">
        <div className="flex flex-wrap items-center gap-3 p-3">
          <CardTitle className="m-0 flex-1">Restaurant plans</CardTitle>
          <Select className="max-w-56" value={filter} onChange={(e) => setFilter(e.target.value as keyof typeof FILTERS)}>
            {Object.entries(FILTERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
        <PagerBar pager={pager} label="restaurants" />
        <Table>
          <thead><tr><th>Restaurant</th><th>Plan</th><th>Price</th><th>Paid through</th><th>Card</th><th className="text-right">Paid (12 mo)</th><th /></tr></thead>
          <tbody>
            {pager.rows.map((r) => (
              <tr key={r.restaurantId}>
                <td><b>{r.name}</b><div className="text-xs text-muted">{r.city} · {r.ownerEmail}{r.restaurantStatus !== 'approved' && ` · ${r.restaurantStatus}`}</div></td>
                <td><PlanCell r={r} />{r.status === 'past_due' && r.lastPaymentError && <div className="mt-1 max-w-56 text-xs text-danger">{r.lastPaymentError}</div>}</td>
                <td className="text-sm">
                  {pioneer(r) ? 'FREE' : r.plan ? `${money(r.priceCents)} / ${r.plan === 'annual' ? 'yr' : 'mo'}` : '–'}
                  {r.lockedCents && <div className="text-xs text-primary-ink">locked at {money(r.lockedCents)}</div>}
                </td>
                <td className="text-sm">{r.periodEnd ? day(r.periodEnd) : '–'}{r.plan && r.status === 'active' && <div className="text-xs text-muted">{pioneer(r) ? '$0.00 invoices' : r.autoRenew ? 'auto-renews' : 'ends'}</div>}</td>
                <td className="text-sm">{r.cardLabel || '–'}</td>
                <td className="text-right text-sm">{r.paid12mCents ? money(r.paid12mCents) : '–'}</td>
                <td className="whitespace-nowrap">
                  {r.status === 'past_due' && (
                    <Button size="sm" variant="green" onClick={async () => {
                      await run(() => chargeDelinquentPlan({ restaurantId: r.restaurantId }), `${r.name}: paid and active again`);
                      refresh();
                    }}>Charge default card</Button>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} className="py-8 text-center text-muted">No restaurants here.</td></tr>}
          </tbody>
        </Table>
        <PagerFooter pager={pager} />
      </Card>
    </div>
  );
}

function PendingChange({ change, onChanged }: { change: Change; onChanged: () => void }) {
  return (
    <Card className="border-2 border-accent/50">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex-1">
          <p className="m-0 text-sm font-bold tracking-wide text-accent-ink uppercase">Fee change scheduled</p>
          <h2 className="m-0 text-xl font-extrabold">From {change.effectiveLabel}</h2>
          <p className="m-0 mt-2 text-ink-2">
            Monthly {money(change.previous_monthly_cents)} → <b>{money(change.monthly_cents)}</b> · Annual {money(change.previous_annual_cents)} → <b>{money(change.annual_cents)}</b>
          </p>
          <p className="m-0 mt-1 text-sm text-muted">
            {change.applies_to_existing ? 'Existing restaurants pay the new fees from their first renewal on or after that date.' : 'Existing restaurants keep their current fees; only new plans pay the new fees.'}{' '}
            {change.emails_sent} restaurants were emailed{change.emails_failed ? `, ${change.emails_failed} emails could not be sent (check SMTP in .env.local)` : ''}.
          </p>
        </div>
        <Button variant="ghost" className="text-danger" onClick={async () => {
          if (!confirm('Cancel this fee change? The current fees stay. Restaurants that were emailed are not told automatically.')) return;
          if (await run(() => cancelFeeChange(change.id), 'Fee change cancelled')) onChanged();
        }}>Cancel change</Button>
      </div>
    </Card>
  );
}

const inDays = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(Date.now() + n * 86_400_000));

function FeeChangeForm({ data, onChanged }: { data: Data; onChanged: () => void }) {
  const first = data.templates[0];
  const [f, setF] = useState({
    monthlyPrice: String(data.prices.monthlyCents / 100),
    annualPrice: String(data.prices.annualCents / 100),
    effectiveDate: inDays(30),
    appliesToExisting: true,
    includeFounding: false,
  });
  const [templateId, setTemplateId] = useState<number | null>(first?.id ?? null);
  const [email, setEmail] = useState({ name: first?.name ?? '', subject: first?.subject ?? '', body: first?.body ?? '' });
  const [preview, setPreview] = useState<{ to: string; subject: string; html: string; recipients: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = (id: string) => {
    const t = data.templates.find((x) => x.id === Number(id));
    setTemplateId(t?.id ?? null);
    setEmail(t ? { name: t.name, subject: t.subject, body: t.body } : { name: '', subject: '', body: '' });
  };
  const input = { ...f, templateName: email.name, subject: email.subject, body: email.body };
  const saving = Number(f.monthlyPrice) * 12 - Number(f.annualPrice);
  const shortNotice = f.effectiveDate < inDays(30);
  const audience = data.audience.withoutFounding + (f.includeFounding ? data.audience.founding : 0);

  const showPreview = async () => {
    setError(null);
    const res = await previewFeeChange(input);
    if (!res.ok) return setError(res.error);
    setPreview(res.data);
  };
  const send = async () => {
    setBusy(true);
    setError(null);
    const res = await scheduleFeeChange(input);
    setBusy(false);
    setPreview(null);
    if (!res.ok) return setError(res.error);
    toast.success(`Fee change scheduled. ${res.data.sent} restaurants emailed${res.data.failed ? `, ${res.data.failed} emails not sent` : ''}.`);
    onChanged();
  };
  const saveTemplate = async (asNew: boolean) => {
    const res = await saveFeeTemplate({ id: asNew ? null : templateId, ...email });
    if (!res.ok) return toast.error(res.error);
    setTemplateId(res.data.id);
    toast.success(asNew ? 'Saved as a new template' : 'Template saved');
    onChanged();
  };

  return (
    <Card>
      <CardTitle>Change subscription fees</CardTitle>
      <p className="mt-0 text-sm text-muted">
        Current fees: <b>{money(data.prices.monthlyCents)}</b> a month · <b>{money(data.prices.annualCents)}</b> a year. New fees take effect at <b>12:01 AM Pacific Time</b> on
        the date you choose, and every restaurant is emailed as soon as you schedule the change.
      </p>
      <div className="grid gap-x-4 sm:grid-cols-3">
        <Field label="New monthly fee ($ / month)" htmlFor="fc-monthly"><Input id="fc-monthly" inputMode="decimal" value={f.monthlyPrice} onChange={(e) => setF({ ...f, monthlyPrice: e.target.value })} /></Field>
        <Field label="New annual fee ($ / year)" htmlFor="fc-annual" hint={saving > 0 ? `Saves $${saving.toFixed(2)} a year vs monthly` : 'Not cheaper than 12 monthly payments'}>
          <Input id="fc-annual" inputMode="decimal" value={f.annualPrice} onChange={(e) => setF({ ...f, annualPrice: e.target.value })} />
        </Field>
        <Field label="Effective date (12:01 AM Pacific)" htmlFor="fc-date">
          <Input id="fc-date" type="date" min={inDays(0)} value={f.effectiveDate} onChange={(e) => setF({ ...f, effectiveDate: e.target.value })} />
        </Field>
      </div>
      {shortNotice && (
        <Alert tone="warn" className="mb-4">The Restaurant Partner Agreement (section 5.6) promises partners at least 30 days&apos; notice of a price change. This date gives less.</Alert>
      )}

      <p className="mb-2 text-sm font-bold">Who pays the new fees?</p>
      <div className="mb-5 grid gap-2 md:grid-cols-2" role="radiogroup">
        {[
          { v: false, title: 'Keep existing restaurants at their current fees', text: 'Restaurants with a plan keep paying what they pay now (locked in). Only restaurants that start a plan on or after the effective date pay the new fees.' },
          { v: true, title: 'Existing restaurants also pay the new fees', text: 'Restaurants with a plan pay the new fees from their first renewal on or after the effective date. New plans pay them from that date too.' },
        ].map((o) => (
          <label key={String(o.v)} className={cn('flex cursor-pointer gap-3 rounded-xl border px-4 py-3', f.appliesToExisting === o.v ? 'border-primary bg-primary-soft/40' : 'border-line')}>
            <input type="radio" name="fc-who" className="mt-1" checked={f.appliesToExisting === o.v} onChange={() => setF({ ...f, appliesToExisting: o.v })} />
            <span><b className="block">{o.title}</b><span className="text-sm text-muted">{o.text}</span></span>
          </label>
        ))}
      </div>

      <div className="rounded-2xl border border-line p-4">
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <Field label="Email: reason for the change" htmlFor="fc-template" className="mb-0 min-w-64 flex-1">
            <Select id="fc-template" value={templateId ?? ''} onChange={(e) => pick(e.target.value)}>
              {data.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              <option value="">Write a new message…</option>
            </Select>
          </Field>
          <Field label="Template name" htmlFor="fc-tname" className="mb-0 min-w-56 flex-1"><Input id="fc-tname" value={email.name} onChange={(e) => setEmail({ ...email, name: e.target.value })} /></Field>
        </div>
        <Field label="Subject" htmlFor="fc-subject"><Input id="fc-subject" value={email.subject} onChange={(e) => setEmail({ ...email, subject: e.target.value })} /></Field>
        <Field label="Message" htmlFor="fc-body" hint={<>Placeholders: {PLACEHOLDERS.map((p) => <code key={p} className="mr-1.5 rounded bg-surface-2 px-1">{p}</code>)}. <b>{'{{your_plan}}'}</b> explains what the change means for each restaurant. The old and new fees are shown in a table below the message.</>}>
          <Textarea id="fc-body" rows={12} value={email.body} onChange={(e) => setEmail({ ...email, body: e.target.value })} />
        </Field>
        <div className="flex flex-wrap gap-2">
          {templateId && <Button size="sm" variant="ghost" onClick={() => saveTemplate(false)}>Save changes to template</Button>}
          <Button size="sm" variant="ghost" onClick={() => saveTemplate(true)}>Save as new template</Button>
          {templateId && (
            <Button size="sm" variant="ghost" className="text-danger" onClick={async () => {
              if (!confirm(`Delete the template "${email.name}"?`)) return;
              if (await run(() => deleteFeeTemplate(templateId), 'Template deleted')) { pick(String(data.templates.find((t) => t.id !== templateId)?.id ?? '')); onChanged(); }
            }}>Delete template</Button>
          )}
        </div>
      </div>

      <Checkbox className="my-4" checked={f.includeFounding} onChange={(e) => setF({ ...f, includeFounding: e.target.checked })}
        label={`Also email the ${data.audience.founding} Pioneer Members (their plan stays free)`} />
      <ErrorText error={error} />
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" onClick={showPreview}>Preview email</Button>
        <Button onClick={showPreview}>Schedule change &amp; email {audience} restaurants</Button>
      </div>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        {preview && (
          <DialogContent title="Check the email before sending" description={`Example for ${preview.to.replace(/\.$/, '')}. Each restaurant gets its own version. ${preview.recipients} restaurants will be emailed now.`} className="max-w-3xl">
            <p className="mt-0 mb-2 text-sm"><b>Subject:</b> {preview.subject}</p>
            <iframe title="Email preview" srcDoc={preview.html} className="h-[60vh] w-full rounded-xl border border-line bg-white" sandbox="" />
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => setPreview(null)}>Keep editing</Button>
              <Button disabled={busy} onClick={send}>{busy ? 'Sending…' : `Schedule & send to ${preview.recipients} restaurants`}</Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </Card>
  );
}

function PlanSettings({ prices, onSaved }: { prices: Data['prices']; onSaved: () => void }) {
  const [f, setF] = useState({
    foundingSpots: String(prices.foundingSpots),
    reminderDaysAnnual: String(prices.reminderDaysAnnual),
    reminderDaysMonthly: String(prices.reminderDaysMonthly),
  });
  return (
    <Card>
      <CardTitle>Plan settings</CardTitle>
      <Field label="Pioneer Member spots (free plan)" htmlFor="ps-founding" hint={`${prices.foundingTaken} used · given to the first restaurants to choose a plan`}>
        <Input id="ps-founding" inputMode="numeric" className="max-w-40" value={f.foundingSpots} onChange={(e) => setF({ ...f, foundingSpots: e.target.value })} />
      </Field>
      <p className="mb-2 text-sm font-bold">Renewal reminder email (card on file, amount and date)</p>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Annual plans: days before" htmlFor="ps-ra"><Input id="ps-ra" inputMode="numeric" value={f.reminderDaysAnnual} onChange={(e) => setF({ ...f, reminderDaysAnnual: e.target.value })} /></Field>
        <Field label="Monthly plans: days before" htmlFor="ps-rm"><Input id="ps-rm" inputMode="numeric" value={f.reminderDaysMonthly} onChange={(e) => setF({ ...f, reminderDaysMonthly: e.target.value })} /></Field>
      </div>
      <Button onClick={async () => { if (await run(() => updatePlanSettings(f), 'Plan settings saved')) onSaved(); }}>Save settings</Button>
    </Card>
  );
}
