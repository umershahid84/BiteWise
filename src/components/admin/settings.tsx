'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { updateSettings } from '@/app/actions/admin';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Checkbox, Field, Input } from '@/components/ui/field';
import { Spinner } from '@/components/ui/misc';
import { run, useAdmin, LoadError } from './shared';

type S = {
  settings: { serviceFeeMode: 'percent' | 'fixed'; serviceFeeFixed: number; welcomeCredit: number; serviceFeePct: number; defaultTaxRatePct: number; requireRestaurantApproval: boolean; orderTaxToRestaurant: boolean; platformTaxPct: number; platformTaxLabel: string; country: 'US' | 'CA' };
  paymentMode: Mode;
  paymentModeCa: Mode;
};
type Mode = 'stripe' | 'mock' | 'off';
const modeBadge = (m: Mode) =>
  m === 'stripe' ? <Badge tone="green">Stripe (keys configured)</Badge> : m === 'off' ? <Badge tone="red">Not set up: card payments unavailable</Badge> : <Badge tone="amber">Test mode (no real charges)</Badge>;

export function SettingsPanel() {
  const queryClient = useQueryClient();
  const { error: loadError, data } = useAdmin<S>(['settings'], 'settings');
  if (loadError && !data) return <LoadError error={loadError} />;
  if (!data) return <Spinner />;
  return <SettingsForm key={JSON.stringify(data.settings)} data={data} onSaved={() => queryClient.invalidateQueries({ queryKey: ['admin'] })} />;
}

function SettingsForm({ data, onSaved }: { data: S; onSaved: () => void }) {
  const [f, setF] = useState({
    serviceFeeMode: data.settings.serviceFeeMode,
    serviceFeePct: String(data.settings.serviceFeePct),
    serviceFeeFixed: data.settings.serviceFeeFixed.toFixed(2),
    welcomeCredit: data.settings.welcomeCredit.toFixed(2),
    defaultTaxRatePct: String(data.settings.defaultTaxRatePct),
    requireRestaurantApproval: data.settings.requireRestaurantApproval,
    orderTaxToRestaurant: data.settings.orderTaxToRestaurant,
    platformTaxPct: String(data.settings.platformTaxPct),
    platformTaxLabel: data.settings.platformTaxLabel,
  });
  return (
    <div className="grid max-w-2xl gap-5">
      <Card>
        <CardTitle>Business settings</CardTitle>
        <fieldset className="mb-4 rounded-xl border border-line p-3">
          <legend className="px-1 text-sm font-bold">Customer service fee</legend>
          <label className="flex cursor-pointer flex-wrap items-center gap-2.5 py-1.5">
            <input type="radio" name="fee-mode" className="accent-[var(--color-primary)]" checked={f.serviceFeeMode === 'percent'} onChange={() => setF({ ...f, serviceFeeMode: 'percent' })} />
            <span className="text-sm"><b>Percentage</b> of the food subtotal</span>
            <Input aria-label="Service fee percentage" inputMode="decimal" className="h-9 w-24" value={f.serviceFeePct} disabled={f.serviceFeeMode !== 'percent'} onChange={(e) => setF({ ...f, serviceFeePct: e.target.value })} />
            <span className="text-sm text-muted">%</span>
          </label>
          <label className="flex cursor-pointer flex-wrap items-center gap-2.5 py-1.5">
            <input type="radio" name="fee-mode" className="accent-[var(--color-primary)]" checked={f.serviceFeeMode === 'fixed'} onChange={() => setF({ ...f, serviceFeeMode: 'fixed' })} />
            <span className="text-sm"><b>Fixed fee</b> per order</span>
            <span className="text-sm text-muted">$</span>
            <Input aria-label="Fixed service fee" inputMode="decimal" className="h-9 w-24" value={f.serviceFeeFixed} disabled={f.serviceFeeMode !== 'fixed'} onChange={(e) => setF({ ...f, serviceFeeFixed: e.target.value })} />
          </label>
          <p className="mt-1 mb-0 text-xs text-muted">
            The selected one is added to every new order (existing orders keep the fee they were quoted) and shown in the Customer Terms.
            A fixed fee is charged once per order, whatever the quantity: in US dollars in the US and the same amount in Canadian dollars in Canada.
          </p>
        </fieldset>
        <Field label="Welcome bonus for new customers ($)" htmlFor="s-welcome" hint="Platform credit each new customer gets once, when they confirm their email (the same number in Canadian dollars in Canada). Bite Wise pays for it; 0 turns it off.">
          <Input id="s-welcome" inputMode="decimal" className="max-w-40" value={f.welcomeCredit} onChange={(e) => setF({ ...f, welcomeCredit: e.target.value })} />
        </Field>
        <Field label="Starting sales tax for new restaurants (%)" htmlFor="s-tax" hint="Used only until a new restaurant's rate is looked up from its address (usually straight away). Set a restaurant's rate by hand in the Restaurants tab."><Input id="s-tax" inputMode="decimal" className="max-w-40" value={f.defaultTaxRatePct} onChange={(e) => setF({ ...f, defaultTaxRatePct: e.target.value })} /></Field>
        <Field
          label={`Tax on Bite Wise's fees (${data.settings.country === 'CA' ? 'Canada' : 'United States'})`} htmlFor="s-plan-tax"
          hint={data.settings.country === 'CA'
            ? 'Charged on the customer service fee of every order in Canada and on Canadian restaurants\' plan fees, at Bite Wise\'s Newfoundland and Labrador rate (HST 15%). New orders and plan payments use it.'
            : 'Charged on the customer service fee of every order in the US and on US restaurants\' plan fees, at the rate of Bite Wise\'s Washington location. New orders and plan payments use it.'}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Input id="s-plan-tax" inputMode="decimal" className="w-24" value={f.platformTaxPct} onChange={(e) => setF({ ...f, platformTaxPct: e.target.value })} />
            <span className="text-sm text-muted">%</span>
            <Input aria-label="Tax name" className="max-w-72" value={f.platformTaxLabel} onChange={(e) => setF({ ...f, platformTaxLabel: e.target.value })} />
          </div>
        </Field>
        <fieldset className="mb-4 rounded-xl border border-line p-3">
          <legend className="px-1 text-sm font-bold">Sales tax on orders</legend>
          {([
            [true, 'Paid to the restaurant (it reports and remits the tax)', 'The restaurant gets the food price plus its sales tax at pickup. Bite Wise keeps only the service fee.'],
            [false, 'Kept by Bite Wise (Bite Wise remits it as marketplace facilitator)', 'The restaurant gets the food price only; Bite Wise keeps the tax and files it. Use this once your accountant says Bite Wise must collect sales tax in your state.'],
          ] as const).map(([v, label, hint]) => (
            <label key={String(v)} className="flex cursor-pointer gap-2.5 py-1.5">
              <input type="radio" name="tax-to" className="mt-1 accent-[var(--color-primary)]" checked={f.orderTaxToRestaurant === v} onChange={() => setF({ ...f, orderTaxToRestaurant: v })} />
              <span className="text-sm"><b>{label}</b><span className="block text-xs text-muted">{hint}</span></span>
            </label>
          ))}
          <p className="mt-1 mb-0 text-xs text-muted">Applies to new orders. Orders already placed keep the split they were placed with.</p>
        </fieldset>
        <Checkbox className="mb-5" checked={f.requireRestaurantApproval} onChange={(e) => setF({ ...f, requireRestaurantApproval: e.target.checked })} label="New restaurants need my approval before their offers are visible" />
        <Button onClick={async () => { if (await run(() => updateSettings(f), 'Settings saved')) onSaved(); }}>Save settings</Button>
      </Card>
      <Card>
        <CardTitle>Payments</CardTitle>
        <p className="text-sm text-ink-2">
          United States (USD): {modeBadge(data.paymentMode)}
        </p>
        <p className="text-sm text-ink-2">
          Canada (CAD): {modeBadge(data.paymentModeCa)}
        </p>
        <p className="text-sm text-muted">
          Each country has its own Stripe account. United States: STRIPE_SECRET_KEY, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY and STRIPE_WEBHOOK_SECRET.
          Canada: STRIPE_SECRET_KEY_CA, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_CA and STRIPE_WEBHOOK_SECRET_CA. With no keys at all, payments run in test mode.
        </p>
      </Card>
    </div>
  );
}
