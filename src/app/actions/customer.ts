'use server';

import { z } from 'zod';
import { requireActor } from '@/lib/auth';
import { action, must } from '@/lib/errors';
import * as orders from '@/lib/orders';
import { payments } from '@/lib/payments';
import { supabaseServer } from '@/lib/supabase/server';
import { countrySchema, int, parse } from '@/lib/validate';
import { saveHomeArea } from '@/lib/home-area';
import { geocodePostal } from '@/lib/geocode';
import { normalizePostal } from '@/lib/regions';

const checkoutSchema = z.object({
  offerId: int('Offer', 1, Number.MAX_SAFE_INTEGER),
  quantity: int('Quantity', 1, 500),
  creditCents: int('Credit', 0, 10_000_000).default(0),
  cardId: z.number().int().positive().nullish(),
  newCard: z.object({ token: z.unknown(), save: z.boolean() }).nullish(),
});

// What the confirmation screen shows: the order, its PIN and the restaurant (read as the customer, so RLS applies).
async function confirmation(orderId: number) {
  const supabase = await supabaseServer();
  const order = must(await supabase.from('orders').select('*, restaurants(name, address, city, zip, phone), order_pins(pin)').eq('id', orderId).single());
  return {
    id: order.id,
    status: order.status,
    itemTitle: order.item_title,
    imageUrl: order.image_url,
    quantity: order.quantity,
    totalCents: order.total_cents,
    creditAppliedCents: order.credit_applied_cents,
    cardLabel: order.card_label,
    pickupEnd: order.pickup_end,
    pin: order.status === 'reserved' ? (order.order_pins?.pin ?? null) : null,
    restaurant: order.restaurants,
  };
}
export type OrderConfirmation = Awaited<ReturnType<typeof confirmation>>;

export async function placeOrder(input: unknown) {
  return action(async () => {
    const viewer = await requireActor('customer');
    const data = parse(checkoutSchema, input);
    const res = await orders.checkout(viewer.id, data);
    if (res.requiresAction) return { orderId: res.orderId, requiresAction: true as const, clientSecret: res.clientSecret, order: null };
    return { orderId: res.orderId, requiresAction: false as const, clientSecret: null, order: await confirmation(res.orderId) };
  });
}

// After 3-D Secure in the browser.
export async function confirmOrderPayment(orderId: number) {
  return action(async () => {
    const viewer = await requireActor('customer');
    await orders.confirmAuthorization(viewer.id, parse(int('Order', 1, Number.MAX_SAFE_INTEGER), orderId));
    return confirmation(orderId);
  });
}

export async function cancelOrder(orderId: number) {
  return action(async () => {
    await requireActor('customer');
    const supabase = await supabaseServer();
    // The service fee is not refundable: it's charged from the hold, and the rest of the hold is released.
    const res = must(await supabase.rpc('my_cancel_order', { p_order_id: orderId })) as { changed: boolean; keptCents?: number };
    if (res.changed) await orders.voidIfNeeded(orderId);
    return { keptCents: res.changed ? (res.keptCents ?? 0) : 0 };
  });
}

// ---- Saved cards

// Cards are saved with the Stripe account of a country (US dollars or Canadian dollars): the country of the
// restaurant being ordered from, or the one chosen on the account page.
export async function createCardSetupIntent(country: unknown = 'US') {
  return action(async () => {
    const viewer = await requireActor('customer');
    const c = parse(countrySchema, country);
    return payments(c).createSetupIntent(await orders.ensureCustomer(viewer.id, c));
  });
}

export async function addCard(token: unknown, makeDefault: boolean, country: unknown = 'US') {
  return action(async () => {
    const viewer = await requireActor('customer');
    return orders.addCard(viewer.id, token, makeDefault, parse(countrySchema, country));
  });
}

export async function removeCard(cardId: number) {
  return action(async () => {
    const viewer = await requireActor('customer');
    await orders.removeCard(viewer.id, cardId);
    return null;
  });
}

export async function setDefaultCard(cardId: number) {
  return action(async () => {
    const viewer = await requireActor('customer');
    await orders.setDefaultCard(viewer.id, cardId);
    return null;
  });
}


// ---- Home area (ZIP or postal code): the deals page opens around it.

export async function updateHomeArea(postal: unknown) {
  return action(async () => {
    const viewer = await requireActor('customer');
    return saveHomeArea(viewer.id, viewer.country, String(postal ?? ''));
  });
}

// Finds a ZIP or postal code typed in the deals search that the app's own ZIP list doesn't know.
export async function locatePostal(query: unknown) {
  return action(async () => {
    await requireActor('customer');
    const q = String(query ?? '').trim();
    const country = /^[A-Za-z]\d[A-Za-z]/.test(q) ? 'CA' : 'US';
    const code = normalizePostal(country, q);
    if (!code) return null;
    const spot = await geocodePostal(country, code);
    return spot ? { ...spot, label: code } : null;
  });
}
