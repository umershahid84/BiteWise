'use server';

import { z } from 'zod';
import { action, AppError, maybe, must } from '@/lib/errors';
import { kioskByToken } from '@/lib/kiosk';
import * as orders from '@/lib/orders';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { parse } from '@/lib/validate';
import type { PickupOrder } from './restaurant';

// The restaurant kiosk (/kiosk/<token>). There is no login: every action checks the kiosk token and works only on
// that restaurant's orders, through the same PIN rules as the dashboard (15 wrong PINs in 10 minutes lock lookups).

const pinSchema = z.string().trim().regex(/^\d{4}$/, 'Enter the 4-digit PIN.');

async function kiosk(token: unknown) {
  const k = typeof token === 'string' ? await kioskByToken(token) : null;
  if (!k) throw new AppError(404, 'This kiosk link is no longer valid. Open the new link from your dashboard.');
  return k;
}

export type KioskOrder = { id: number; itemTitle: string; quantity: number; customerUsername: string; createdAt: string; pickupEnd: string; totalCents: number };

// Orders waiting to be picked up, and how many were handed over today.
export async function kioskOrders(token: string) {
  return action(async () => {
    const k = await kiosk(token);
    const db = supabaseAdmin();
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const [open, done] = await Promise.all([
      db.from('orders').select('id, item_title, quantity, customer_username, created_at, pickup_end, total_cents')
        .eq('restaurant_id', k.restaurantId).eq('status', 'reserved').order('created_at', { ascending: false }).limit(60),
      db.from('orders').select('id', { count: 'exact', head: true }).eq('restaurant_id', k.restaurantId).eq('status', 'picked_up').gte('picked_up_at', since),
    ]);
    return {
      status: k.status,
      pickedUpToday: done.count ?? 0,
      orders: must(open).map((o): KioskOrder => ({
        id: o.id, itemTitle: o.item_title, quantity: o.quantity, customerUsername: o.customer_username,
        createdAt: o.created_at, pickupEnd: o.pickup_end, totalCents: o.total_cents,
      })),
    };
  });
}

export async function kioskLookup(token: string, pin: string) {
  return action(async () => {
    const k = await kiosk(token);
    const order = maybe(await supabaseAdmin().rpc('find_pickup_for', { p_restaurant_id: k.restaurantId, p_pin: parse(pinSchema, pin) }));
    if (!order) throw new AppError(404, 'No order awaiting pickup matches that PIN.');
    return order as unknown as PickupOrder;
  });
}

// Hands over the food: the customer's card is charged now and the restaurant is paid.
export async function kioskConfirm(token: string, pin: string, orderId: number) {
  return action(async () => {
    const k = await kiosk(token);
    const claimed = must(await supabaseAdmin().rpc('begin_pickup_for', { p_restaurant_id: k.restaurantId, p_pin: parse(pinSchema, pin), p_order_id: orderId })) as unknown as {
      id: number; paymentRef: string | null; destinationAccount: string | null;
    };
    const done = await orders.completePickup(claimed);
    return { id: done.id, quantity: done.quantity, itemTitle: done.item_title, customerUsername: done.customer_username, totalCents: done.total_cents, creditAppliedCents: done.credit_applied_cents };
  });
}
