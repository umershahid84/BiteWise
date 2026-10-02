'use client';

import { useQueryClient } from '@tanstack/react-query';
import { endOffer } from '@/app/actions/admin';
import { Countdown } from '@/components/app/countdown';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, Spinner, Table } from '@/components/ui/misc';
import { OFFER_REASONS, type OfferReason } from '@/lib/constants';
import { money } from '@/lib/format';
import { run, useAdmin } from './shared';

type Offer = {
  id: number; title: string; reason: OfferReason; discount_pct: number; price_cents: number; original_price_cents: number; quantity_available: number;
  quantity_total: number; pickup_end: string; status: string; image_url: string | null; restaurants: { name: string; city: string; status: string } | null;
};

export function OffersPanel() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useAdmin<Offer[]>(['offers'], 'offers');
  const remove = async (o: Offer) => {
    const reason = prompt(`Remove "${o.title}" from Bite Wise? Reason (optional):`);
    if (reason === null) return;
    if (await run(() => endOffer({ id: o.id, reason }), 'Offer removed')) queryClient.invalidateQueries({ queryKey: ['admin'] });
  };
  if (isLoading) return <div className="grid place-items-center py-10"><Spinner /></div>;
  if (!data?.length) return <EmptyState title="No live offers right now" />;
  return (
    <Card className="p-2">
      <Table>
        <thead><tr><th>Offer</th><th>Restaurant</th><th>Price</th><th>Left</th><th>Timer</th><th>Status</th><th /></tr></thead>
        <tbody>
          {data.map((o) => (
            <tr key={o.id}>
              <td><b>{o.title}</b><div className="text-xs text-muted">{OFFER_REASONS[o.reason]}</div></td>
              <td className="text-sm">{o.restaurants?.name}<div className="text-xs text-muted">{o.restaurants?.city}{o.restaurants?.status !== 'approved' && ` · restaurant ${o.restaurants?.status}`}</div></td>
              <td>{money(o.price_cents)} <span className="text-xs text-muted line-through">{money(o.original_price_cents)}</span></td>
              <td>{o.quantity_available} / {o.quantity_total}</td>
              <td className="text-sm"><Countdown until={o.pickup_end} /></td>
              <td><StatusBadge status={o.status} /></td>
              <td><Button size="sm" variant="danger" onClick={() => remove(o)}>Remove</Button></td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
