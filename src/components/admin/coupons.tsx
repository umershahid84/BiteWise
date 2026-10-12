'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Mail, Plus, Ticket } from 'lucide-react';
import { toast } from 'sonner';
import {
  createCouponAction, deleteCouponTemplateAction, emailCouponAction, previewCouponEmailAction, saveCouponTemplateAction, setCouponActiveAction,
} from '@/app/actions/admin';
import { ErrorText } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/field';
import { Spinner, Table } from '@/components/ui/misc';
import { cn } from '@/lib/utils';
import { day, daysAgo, LoadError, money, useAccess, useAdmin } from './shared';

type Kind = 'no_fee' | 'fixed' | 'percent';
type Coupon = {
  id: number; code: string; kind: Kind; offer: string; description: string; expiresAt: string; expired: boolean; active: boolean;
  createdAt: string; emailedAt: string | null; emailedCount: number; emailSubject: string; uses: number; restaurantCostCents: number; bitewiseCostCents: number;
};
type Template = { id: number; name: string; subject: string; body: string };

const KINDS: [Kind, string, string][] = [
  ['no_fee', 'No service fee', 'Waives the Bite Wise service fee. Bite Wise pays for it; the restaurant gets its full amount.'],
  ['fixed', 'Dollar amount off', 'A set amount off the food. Paid by the restaurant: it comes off the restaurant’s payout for the order.'],
  ['percent', 'Percentage off', 'A percentage off the food. Paid by the restaurant: it comes off the restaurant’s payout for the order.'],
];

// Coupons for the admin's location: make one, email it to every customer there, see how it's used.
export function CouponsPanel() {
  const me = useAccess();
  const queryClient = useQueryClient();
  const { error: loadError, data, isLoading } = useAdmin<{ coupons: Coupon[]; templates: Template[] }>(['coupons'], 'coupons');
  const [creating, setCreating] = useState(false);
  const [emailing, setEmailing] = useState<{ id: number; code: string } | null>(null);
  const where = me.country === 'CA' ? 'Canada' : 'the United States';
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'coupons'] });

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
      {isLoading || !data ? <div className="grid place-items-center py-8"><Spinner /></div> : data.coupons.length === 0 ? (
        <p className="text-sm text-muted">No coupons yet.</p>
      ) : (
        <Table>
          <thead><tr><th>Code</th><th>Offer</th><th>Expires</th><th>Used</th><th>Paid by restaurants</th><th>Paid by Bite Wise</th><th>Emailed</th><th /></tr></thead>
          <tbody>
            {data.coupons.map((c) => (
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
                <td className="text-sm">{c.emailedAt ? <>{day(c.emailedAt)}<div className="text-xs text-muted">{c.emailedCount} sent{c.emailSubject && <> · “{c.emailSubject}”</>}</div></> : '–'}</td>
                <td className="whitespace-nowrap">
                  <div className="flex gap-1.5">
                    {c.active && !c.expired && <Button size="sm" variant="ghost" onClick={() => setEmailing({ id: c.id, code: c.code })}><Mail /> Email customers</Button>}
                    {!c.expired && <Button size="sm" variant="ghost" onClick={() => toggle(c)}>{c.active ? 'Turn off' : 'Turn on'}</Button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        {creating && <NewCoupon where={where} onDone={(created) => { setCreating(false); refresh(); if (created) setEmailing(created); }} />}
      </Dialog>
      <Dialog open={!!emailing} onOpenChange={(o) => !o && setEmailing(null)}>
        {emailing && data && <EmailCoupon coupon={emailing} templates={data.templates} where={where} onTemplates={refresh} onSent={() => { setEmailing(null); refresh(); }} />}
      </Dialog>
    </Card>
  );
}

function NewCoupon({ where, onDone }: { where: string; onDone: (emailNext: { id: number; code: string } | null) => void }) {
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
    toast.success(`Coupon ${res.data.code} created.`);
    onDone(f.email ? { id: res.data.id, code: res.data.code } : null);
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
      <Checkbox className="mb-4" checked={f.email} onChange={(e) => setF({ ...f, email: e.target.checked })} label={`Next, write the email to every customer in ${where}`} />
      <ErrorText error={error} />
      <Button block disabled={busy} onClick={save}>{busy ? 'Creating…' : 'Create coupon'}</Button>
    </DialogContent>
  );
}

const PLACEHOLDERS = ['{{name}}', '{{code}}', '{{offer}}', '{{expires}}', '{{message}}'];

// The email that sends a coupon to every customer in the location: start from a saved template, edit it, check the
// preview, send. Templates can be saved, saved as new or deleted for next time.
function EmailCoupon({ coupon, templates, where, onTemplates, onSent }: {
  coupon: { id: number; code: string }; templates: Template[]; where: string; onTemplates: () => void; onSent: () => void;
}) {
  const first = templates[0];
  const [templateId, setTemplateId] = useState<number | null>(first?.id ?? null);
  const [email, setEmail] = useState({ name: first?.name ?? '', subject: first?.subject ?? '', body: first?.body ?? '' });
  const [preview, setPreview] = useState<{ subject: string; html: string; customers: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pick = (id: string) => {
    const t = templates.find((x) => x.id === Number(id));
    setTemplateId(t?.id ?? null);
    setEmail(t ? { name: t.name, subject: t.subject, body: t.body } : { name: '', subject: '', body: '' });
    setPreview(null);
  };
  const edit = (patch: Partial<typeof email>) => {
    setEmail({ ...email, ...patch });
    setPreview(null);
  };
  const save = async (asNew: boolean) => {
    const res = await saveCouponTemplateAction({ id: asNew ? null : templateId, ...email });
    if (!res.ok) return toast.error(res.error);
    setTemplateId(res.data.id);
    toast.success(asNew ? 'Saved as a new template' : 'Template saved');
    onTemplates();
  };
  const remove = async () => {
    if (!templateId || !confirm(`Delete the template "${email.name}"?`)) return;
    const res = await deleteCouponTemplateAction(templateId);
    if (!res.ok) return toast.error(res.error);
    toast.success('Template deleted');
    pick(String(templates.find((t) => t.id !== templateId)?.id ?? ''));
    onTemplates();
  };
  const check = async () => {
    setBusy(true);
    setError(null);
    const res = await previewCouponEmailAction({ id: coupon.id, subject: email.subject, body: email.body });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setPreview(res.data);
  };
  const send = async () => {
    if (!preview || !confirm(`Send coupon ${coupon.code} to ${preview.customers} customers in ${where}?`)) return;
    setBusy(true);
    const res = await emailCouponAction({ id: coupon.id, subject: email.subject, body: email.body, templateName: email.name });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    toast.success(`Sending ${res.data.code} to ${res.data.customers} customers.`);
    onSent();
  };
  return (
    <DialogContent title={`Email coupon ${coupon.code}`} description={`To every customer in ${where}. Each customer gets their own copy with their name.`} className="max-w-3xl">
      {preview ? (
        <>
          <p className="mt-0 mb-2 text-sm"><b>Subject:</b> {preview.subject}</p>
          <iframe title="Email preview" srcDoc={preview.html} className="h-[55vh] w-full rounded-xl border border-line bg-white" sandbox="" />
          <p className="mb-3 text-xs text-muted">Example for a customer named Alex.</p>
          <ErrorText error={error} />
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setPreview(null)}>Back to editing</Button>
            <span className="flex-1" />
            <Button variant="green" disabled={busy || !preview.customers} onClick={send}><Mail /> {busy ? 'Sending…' : `Send to ${preview.customers} customers`}</Button>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Template" htmlFor="ce-template" className="mb-0 min-w-56 flex-1">
              <Select id="ce-template" value={templateId ?? ''} onChange={(e) => pick(e.target.value)}>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                <option value="">Blank email</option>
              </Select>
            </Field>
            <Field label="Template name" htmlFor="ce-name" className="mb-0 min-w-56 flex-1">
              <Input id="ce-name" value={email.name} onChange={(e) => edit({ name: e.target.value })} />
            </Field>
          </div>
          <Field label="Subject" htmlFor="ce-subject" className="mt-3">
            <Input id="ce-subject" value={email.subject} maxLength={200} onChange={(e) => edit({ subject: e.target.value })} />
          </Field>
          <Field label="Message" htmlFor="ce-body" hint={`Placeholders: ${PLACEHOLDERS.join(' ')}. The coupon code, its offer and expiry, and a Find deals button are added below the message.`}>
            <Textarea id="ce-body" rows={11} value={email.body} maxLength={5000} onChange={(e) => edit({ body: e.target.value })} />
          </Field>
          <div className="mb-4 flex flex-wrap gap-2">
            {templateId && <Button size="sm" variant="ghost" onClick={() => save(false)}>Save changes to template</Button>}
            <Button size="sm" variant="ghost" disabled={email.name.trim().length < 2} onClick={() => save(true)}>Save as new template</Button>
            {templateId && <Button size="sm" variant="ghost" className="text-danger" onClick={remove}>Delete template</Button>}
          </div>
          <ErrorText error={error} />
          <Button block disabled={busy} onClick={check}>{busy ? 'Preparing…' : 'Preview the email'}</Button>
        </>
      )}
    </DialogContent>
  );
}
