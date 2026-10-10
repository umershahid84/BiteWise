'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import { cancelOrder } from '@/app/actions/customer';
import { Countdown } from '@/components/app/countdown';
import { PinTiles } from '@/components/app/pin-tiles';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, Spinner } from '@/components/ui/misc';
import { ORDER_STATUS_LABELS } from '@/lib/constants';
import { fmtDateTime, fmtTime, money } from '@/lib/format';
import { supabaseBrowser } from '@/lib/supabase/client';

export function OrdersList({ userId }: { userId: string }) {
  const supabase = supabaseBrowser();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { data, isLoading, error } = useQuery({
    queryKey: ['my-orders'],
    queryFn: async () => {
      const res = await supabase
        .from('orders')
        .select('*, restaurants(name, address, city), order_pins(pin)')
        .neq('status', 'failed')
        .order('created_at', { ascending: false })
        .limit(100);
      if (res.error) throw new Error(res.error.message);
      return res.data;
    },
  });

  // Live status: e.g. the order flips to "Picked up" the moment the restaurant enters the PIN.
  useEffect(() => {
    const channel = supabase
      .channel(`my-orders-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `user_id=eq.${userId}` }, () =>
        queryClient.invalidateQueries({ queryKey: ['my-orders'] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, queryClient, userId]);

  const cancel = useMutation({
    mutationFn: async (id: number) => {
      const res = await cancelOrder(id);
      if (!res.ok) throw new Error(res.error);
    },
    onSuccess: () => {
      toast.success('Order cancelled. You were not charged.');
      queryClient.invalidateQueries({ queryKey: ['my-orders'] });
      router.refresh();
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) return <div className="grid place-items-center py-20"><Spinner /></div>;
  if (error) return <p className="text-danger">{error.message}</p>;
  if (!data?.length) {
    return (
      <EmptyState title="No orders yet" action={<Link href="/offers" className={buttonVariants()}>Browse deals</Link>}>
        Grab a deal and your pickup PIN will show up here.
      </EmptyState>
    );
  }
  return (
    <div className="space-y-4">
      {data.map((o) => {
        const r = o.restaurants;
        const card = o.total_cents - o.credit_applied_cents;
        const payment =
          o.status === 'picked_up'
            ? `${o.credit_applied_cents ? `${money(o.credit_applied_cents)} paid with credit${card ? ` + ${money(card)} charged to ${o.card_label}` : ''}` : `Charged ${money(o.total_cents)} to ${o.card_label}`}${o.refunded_cents ? ` · Refunded ${money(o.refunded_cents)}` : ''}${o.credited_cents ? ` · ${money(o.credited_cents)} refunded as credit` : ''}`
            : o.status === 'reserved'
              ? o.credit_applied_cents >= o.total_cents
                ? `Paid with ${money(o.credit_applied_cents)} credit.`
                : `Hold of ${money(card)} on ${o.card_label}${o.credit_applied_cents ? ` + ${money(o.credit_applied_cents)} credit` : ''}. Charged at pickup.`
              : o.status === 'pending_payment'
                ? 'Waiting for your card to be authorized.'
                : 'Hold released. You were not charged.';
        return (
          <Card key={o.id} className="flex flex-col gap-5 md:flex-row md:items-start">
            <div className="flex flex-1 gap-4">
              {o.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={o.image_url} alt="" className="size-20 shrink-0 rounded-xl object-cover" />
              )}
              <div className="min-w-0">
                <StatusBadge status={o.status} label={ORDER_STATUS_LABELS[o.status]} />
                <h3 className="mt-2 mb-0.5 text-lg font-bold">{o.quantity} × {o.item_title}</h3>
                <div className="text-sm text-muted">{r?.name} · {r?.address}, {r?.city} · Ordered {fmtDateTime(o.created_at)}</div>
                {o.status === 'reserved' && (
                  <div className="mt-1.5 text-sm">Pick up by <b>{fmtTime(o.pickup_end)}</b> · <Countdown until={o.pickup_end} /></div>
                )}
                <div className="mt-2 text-sm">
                  {o.quantity} × <span className="text-muted line-through">{money(o.original_unit_price_cents)}</span> <b>{money(o.unit_price_cents)}</b>{' '}
                  <Badge tone="diet">-{o.discount_pct}%</Badge> · Total <b>{money(o.total_cents)}</b>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href={`/orders/${o.id}/receipt`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}><Receipt /> View receipt</Link>
                  <a href={`/api/orders/${o.id}/receipt`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}><Download /> Download PDF</a>
                </div>
                <div className="mt-2 text-sm text-muted">{payment}</div>
              </div>
            </div>
            {o.status === 'reserved' && o.order_pins?.pin && (
              <div className="rounded-card bg-grad p-4 text-center text-on-primary md:min-w-[230px]">
                <div className="mb-2 text-xs font-bold tracking-widest uppercase opacity-70">Pickup PIN</div>
                <PinTiles pin={o.order_pins.pin} />
                <Button
                  variant="danger"
                  size="sm"
                  className="mt-3 bg-white/90"
                  disabled={cancel.isPending}
                  onClick={() => confirm('Cancel this order? The hold on your card will be released.') && cancel.mutate(o.id)}
                >
                  Cancel order
                </Button>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
