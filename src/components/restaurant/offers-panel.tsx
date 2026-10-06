'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNow } from '@/hooks/use-now';
import { toast } from 'sonner';
import { Countdown } from '@/components/app/countdown';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, Spinner, Table } from '@/components/ui/misc';
import { OFFER_REASONS, offerStatus } from '@/lib/constants';
import { fmtTime, money } from '@/lib/format';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { Ctx, Offer } from './types';

const STATUS_ORDER = { active: 0, paused: 1, ended: 2 };

export function OffersPanel({ ctx, onEdit, onNew }: { ctx: Ctx; onEdit: (id: number) => void; onNew: () => void }) {
  const supabase = supabaseBrowser();
  const queryClient = useQueryClient();
  const now = useNow();
  const { data, isLoading } = useQuery({
    queryKey: ['restaurant-offers'],
    queryFn: async () => {
      const [offers, orders] = await Promise.all([
        supabase.from('offers').select('*').eq('restaurant_id', ctx.restaurant.id).order('pickup_end', { ascending: false }).limit(200),
        supabase.from('orders').select('offer_id, status, quantity').eq('restaurant_id', ctx.restaurant.id).in('status', ['reserved', 'picked_up']),
      ]);
      const stats = new Map<number, { awaiting: number; picked: number }>();
      for (const o of orders.data ?? []) {
        const s = stats.get(o.offer_id) ?? { awaiting: 0, picked: 0 };
        if (o.status === 'reserved') s.awaiting += 1;
        else s.picked += o.quantity;
        stats.set(o.offer_id, s);
      }
      return (offers.data ?? [])
        .map((o) => ({ ...o, stats: stats.get(o.id) ?? { awaiting: 0, picked: 0 } }))
        .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['restaurant-offers'] });
    queryClient.invalidateQueries({ queryKey: ['restaurant-stats'] });
  };
  const extend = async (o: Offer, minutes: number) => {
    const { error } = await supabase.rpc('restaurant_extend_offer', { p_offer_id: o.id, p_minutes: minutes });
    if (error) return toast.error(error.message);
    toast.success(`Timer extended by ${minutes >= 60 ? `${minutes / 60} hour` : `${minutes} min`}`);
    refresh();
  };
  const setStatus = async (o: Offer, status: Offer['status']) => {
    if (status === 'ended' && !confirm('End this offer? It will no longer be visible to customers. Existing orders can still be picked up.')) return;
    const { error } = await supabase.rpc('restaurant_set_offer_status', { p_offer_id: o.id, p_status: status });
    if (error) return toast.error(error.message);
    refresh();
  };

  if (isLoading) return <div className="grid place-items-center py-16"><Spinner /></div>;
  if (!data?.length) {
    return (
      <EmptyState title="No offers yet" action={<Button onClick={onNew}>Post surplus food</Button>}>
        Have a wrong order or extra food? Post it and let nearby customers rescue it.
      </EmptyState>
    );
  }
  return (
    <Card className="p-2">
      <Table>
        <thead><tr><th>Item</th><th>Price</th><th>Left</th><th>Discard timer</th><th>Status</th><th /></tr></thead>
        <tbody>
          {data.map((o) => {
            const expired = now > 0 && Date.parse(o.pickup_end) <= now;
            return (
              <tr key={o.id}>
                <td>
                  <div className="flex items-center gap-3">
                    {o.image_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={o.image_url} alt="" className="size-11 rounded-lg object-cover" />
                    )}
                    <div>
                      <b>{o.title}</b>
                      <div className="text-xs text-muted">
                        {OFFER_REASONS[o.reason]}
                        {o.stats.awaiting > 0 && ` · ${o.stats.awaiting} awaiting pickup`}
                        {o.stats.picked > 0 && ` · ${o.stats.picked} picked up`}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="whitespace-nowrap">{money(o.price_cents ?? 0)} <span className="text-xs text-muted line-through">{money(o.original_price_cents)}</span><div className="text-xs text-muted">{o.discount_pct}% off</div></td>
                <td>{o.quantity_available} / {o.quantity_total}</td>
                <td className="text-sm">
                  {expired ? (
                    <>
                      <span className="font-semibold text-danger">⌛ Expired {fmtTime(o.pickup_end)}</span>
                      {o.quantity_available ? <div className="text-accent-ink">🗑️ Discard {o.quantity_available} unsold</div> : <div className="text-muted">All sold 🎉</div>}
                    </>
                  ) : o.status === 'ended' ? (
                    <>
                      <span className="text-muted">Ended early</span>
                      {o.quantity_available > 0 && <div className="text-accent-ink">🗑️ Discard {o.quantity_available} unsold</div>}
                    </>
                  ) : (
                    <>
                      <Countdown until={o.pickup_end} onExpire={refresh} />
                      <div className="text-xs text-muted">discard at {fmtTime(o.pickup_end)}</div>
                      <div className="mt-1.5 flex gap-1.5">
                        <Button variant="ghost" size="sm" className="h-7 px-2.5 text-xs" onClick={() => extend(o, 30)}>+30m</Button>
                        <Button variant="ghost" size="sm" className="h-7 px-2.5 text-xs" onClick={() => extend(o, 60)}>+1h</Button>
                      </div>
                    </>
                  )}
                </td>
                <td><StatusBadge status={offerStatus(o)} /></td>
                <td className="whitespace-nowrap">
                  {o.status !== 'ended' && (
                    <div className="flex gap-1.5">
                      <Button variant="ghost" size="sm" onClick={() => onEdit(o.id)}>Edit</Button>
                      <Button variant="ghost" size="sm" onClick={() => setStatus(o, o.status === 'active' ? 'paused' : 'active')}>{o.status === 'active' ? 'Pause' : 'Resume'}</Button>
                      <Button variant="danger" size="sm" onClick={() => setStatus(o, 'ended')}>End</Button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </Card>
  );
}
