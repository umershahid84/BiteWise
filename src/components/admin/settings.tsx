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
  settings: { serviceFeePct: number; defaultTaxRatePct: number; requireRestaurantApproval: boolean };
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
  });
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
        <CardTitle>Payments</CardTitle>
        <p className="text-sm text-ink-2">
          Mode: {data.paymentMode === 'stripe' ? <Badge tone="green">Stripe (live keys configured)</Badge> : <Badge tone="amber">Test mode (no real charges)</Badge>}
        </p>
        <p className="text-sm text-muted">Set STRIPE_SECRET_KEY, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY and STRIPE_WEBHOOK_SECRET to take real payments and pay restaurants through Stripe Connect.</p>
      </Card>
    </div>
  );
}
