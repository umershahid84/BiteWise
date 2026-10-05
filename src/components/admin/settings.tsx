'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { updateSettings } from '@/app/actions/admin';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Checkbox, Field, Input } from '@/components/ui/field';
import { Spinner } from '@/components/ui/misc';
import { run, useAdmin } from './shared';

type S = {
  settings: { serviceFeePct: number; defaultTaxRatePct: number; requireRestaurantApproval: boolean; monthlyPrice: number; annualPrice: number; foundingSpots: number };
  paymentMode: 'stripe' | 'mock';
};

export function SettingsPanel() {
  const queryClient = useQueryClient();
  const { data } = useAdmin<S>(['settings'], 'settings');
  if (!data) return <Spinner />;
  return <SettingsForm key={JSON.stringify(data.settings)} data={data} onSaved={() => queryClient.invalidateQueries({ queryKey: ['admin'] })} />;
}

function SettingsForm({ data, onSaved }: { data: S; onSaved: () => void }) {
  const [f, setF] = useState({
    serviceFeePct: String(data.settings.serviceFeePct),
    defaultTaxRatePct: String(data.settings.defaultTaxRatePct),
    requireRestaurantApproval: data.settings.requireRestaurantApproval,
    monthlyPrice: String(data.settings.monthlyPrice),
    annualPrice: String(data.settings.annualPrice),
    foundingSpots: String(data.settings.foundingSpots),
  });
  const saving = Number(f.monthlyPrice) * 12 - Number(f.annualPrice);
  return (
    <div className="grid max-w-2xl gap-5">
      <Card>
        <CardTitle>Business settings</CardTitle>
        <Field label="Customer service fee (%)" htmlFor="s-fee" hint="Added to every new order. Existing orders keep the fee they were quoted. Shown in the Customer Terms."><Input id="s-fee" inputMode="decimal" className="max-w-40" value={f.serviceFeePct} onChange={(e) => setF({ ...f, serviceFeePct: e.target.value })} /></Field>
        <Field label="Default sales tax for new restaurants (%)" htmlFor="s-tax" hint="Restaurants can set their own rate in their profile."><Input id="s-tax" inputMode="decimal" className="max-w-40" value={f.defaultTaxRatePct} onChange={(e) => setF({ ...f, defaultTaxRatePct: e.target.value })} /></Field>
        <Checkbox className="mb-5" checked={f.requireRestaurantApproval} onChange={(e) => setF({ ...f, requireRestaurantApproval: e.target.checked })} label="New restaurants need my approval before their offers are visible" />
        <Button onClick={async () => { if (await run(() => updateSettings(f), 'Settings saved')) onSaved(); }}>Save settings</Button>
      </Card>
      <Card>
        <CardTitle>Restaurant plans</CardTitle>
        <p className="mt-0 text-sm text-muted">Approved restaurants need a plan to post offers. New prices apply to new plans and from each restaurant&apos;s next renewal; give partners 30 days&apos; notice (Restaurant Partner Agreement, section 5.6).</p>
        <div className="grid gap-x-4 sm:grid-cols-3">
          <Field label="Monthly plan ($)" htmlFor="s-monthly"><Input id="s-monthly" inputMode="decimal" value={f.monthlyPrice} onChange={(e) => setF({ ...f, monthlyPrice: e.target.value })} /></Field>
          <Field label="Annual plan ($)" htmlFor="s-annual" hint={saving > 0 ? `Saves $${saving.toFixed(saving % 1 ? 2 : 0)} a year` : undefined}><Input id="s-annual" inputMode="decimal" value={f.annualPrice} onChange={(e) => setF({ ...f, annualPrice: e.target.value })} /></Field>
          <Field label="Founding Partner spots" htmlFor="s-founding" hint="Free for life, first approved"><Input id="s-founding" inputMode="numeric" value={f.foundingSpots} onChange={(e) => setF({ ...f, foundingSpots: e.target.value })} /></Field>
        </div>
        <Button onClick={async () => { if (await run(() => updateSettings(f), 'Settings saved')) onSaved(); }}>Save settings</Button>
      </Card>
      <Card>
        <CardTitle>Payments</CardTitle>
        <p className="text-sm text-ink-2">
          Mode: {data.paymentMode === 'stripe' ? <Badge tone="green">Stripe (live keys configured)</Badge> : <Badge tone="amber">Test mode (no real charges)</Badge>}
        </p>
        <p className="text-sm text-muted">Set STRIPE_SECRET_KEY, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY and STRIPE_WEBHOOK_SECRET to take real payments and pay restaurants through Stripe Connect.</p>
      </Card>
    </div>
  );
}
