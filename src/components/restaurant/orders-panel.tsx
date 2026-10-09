'use client';

import { useQuery } from '@tanstack/react-query';
import { StatusBadge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState, Spinner, Table } from '@/components/ui/misc';
import { ORDER_STATUS_LABELS } from '@/lib/constants';
import { fmtDateTime, money } from '@/lib/format';
import { supabaseBrowser } from '@/lib/supabase/client';

// Staff (`showMoney` false) see the orders to hand over, without sales amounts.
export function OrdersPanel({ restaurantId, showMoney = true }: { restaurantId: number; showMoney?: boolean }) {
  const supabase = supabaseBrowser();
  const { data, isLoading } = useQuery({
    queryKey: ['restaurant-orders'],
    queryFn: async () =>
      (await supabase.from('orders').select('*').eq('restaurant_id', restaurantId).not('status', 'in', '(pending_payment,failed)').order('created_at', { ascending: false }).limit(200)).data ?? [],
  });
  if (isLoading) return <div className="grid place-items-center py-16"><Spinner /></div>;
  if (!data?.length) return <EmptyState title="No orders yet">Orders appear here as soon as customers reserve your food.</EmptyState>;
  return (
    <Card className="p-2">
      <Table>
        <thead><tr><th>#</th><th>Item</th><th>Customer</th>{showMoney && <><th>Food sales</th><th>Total charged</th></>}<th>Status</th><th>When</th></tr></thead>
        <tbody>
          {data.map((o) => (
            <tr key={o.id}>
              <td>{o.id}</td>
              <td>
                <div className="flex items-center gap-2.5">
                  {o.image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={o.image_url} alt="" className="size-9 rounded-md object-cover" />
                  )}
                  {o.quantity} × {o.item_title}
                </div>
              </td>
              <td>{o.customer_username}</td>
              {showMoney && <><td>{money(o.subtotal_cents)}</td><td>{money(o.total_cents)}</td></>}
              <td><StatusBadge status={o.status} label={ORDER_STATUS_LABELS[o.status]} /></td>
              <td className="text-xs whitespace-nowrap">{fmtDateTime(o.picked_up_at ?? o.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
