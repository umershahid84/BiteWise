'use server';

import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { z } from 'zod';
import { requireRestaurant } from '@/lib/auth';
import { publicEnv } from '@/lib/env';
import { ensureKioskToken, kioskUrls, rotateKioskToken } from '@/lib/kiosk';
import { action, AppError, check, maybe, must } from '@/lib/errors';
import { payments } from '@/lib/payments';
import * as orders from '@/lib/orders';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { menuItemSchema, parse, restaurantProfileSchema } from '@/lib/validate';

// ---------------------------------------------------------------- pickup

export type PickupOrder = {
  id: number; itemTitle: string; imageUrl: string | null; quantity: number; unitPriceCents: number; subtotalCents: number;
  serviceFeeCents: number; taxCents: number; totalCents: number; creditAppliedCents: number; customerUsername: string;
  createdAt: string; pickupEnd: string;
};

const pinSchema = z.string().trim().regex(/^\d{4}$/, 'Enter the 4-digit PIN.');

// Finds the open order for a PIN. Wrong PINs are counted (15 in 10 minutes locks lookups).
export async function lookupPickup(pin: string) {
  return action(async () => {
    await requireRestaurant();
    const supabase = await supabaseServer();
    const order = maybe(await supabase.rpc('restaurant_find_pickup', { p_pin: parse(pinSchema, pin) }));
    if (!order) throw new AppError(404, 'No order awaiting pickup matches that PIN.');
    return order as unknown as PickupOrder;
  });
}

// Hands over the food: the customer's card is charged now and the restaurant is paid through Stripe Connect.
export async function confirmPickup(pin: string, orderId: number) {
  return action(async () => {
    await requireRestaurant();
    const supabase = await supabaseServer();
    const claimed = must(await supabase.rpc('restaurant_begin_pickup', { p_pin: parse(pinSchema, pin), p_order_id: orderId })) as unknown as {
      id: number; paymentRef: string | null; destinationAccount: string | null;
    };
    const done = await orders.completePickup(claimed);
    return { id: done.id, quantity: done.quantity, itemTitle: done.item_title, customerUsername: done.customer_username, totalCents: done.total_cents, creditAppliedCents: done.credit_applied_cents };
  });
}

// ---------------------------------------------------------------- menu

const MAX_PHOTO = 3 * 1024 * 1024;

// Only JPEG, PNG or WebP, checked by file signature (not just the name or declared type).
function detectImage(buf: Buffer): { ext: string; type: string } | null {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', type: 'image/png' };
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return { ext: 'webp', type: 'image/webp' };
  return null;
}

async function uploadPhoto(restaurantId: number, dataUrl: string) {
  const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new AppError(400, 'Please choose a JPEG, PNG or WebP photo.');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > MAX_PHOTO) throw new AppError(400, 'Photo is too large (max 3 MB).');
  const kind = detectImage(buf);
  if (!kind) throw new AppError(400, 'Please choose a JPEG, PNG or WebP photo.');
  const path = `${restaurantId}/${randomBytes(12).toString('hex')}.${kind.ext}`;
  const storage = supabaseAdmin().storage.from('food-photos');
  const { error } = await storage.upload(path, buf, { contentType: kind.type, cacheControl: '31536000', upsert: false });
  if (error) throw new AppError(500, 'Could not save the photo. Please try again.');
  return storage.getPublicUrl(path).data.publicUrl;
}

const menuInput = menuItemSchema.extend({
  id: z.number().int().positive().optional(),
  image: z.string().optional(),
  removeImage: z.boolean().optional(),
});

export async function saveMenuItem(input: unknown) {
  return action(async () => {
    const { restaurant } = await requireRestaurant();
    const data = parse(menuInput, input);
    const supabase = await supabaseServer();
    // Old photos are kept because existing offers and orders may still show them.
    const image_url = data.image ? await uploadPhoto(restaurant.id, data.image) : data.removeImage ? null : undefined;
    const fields = { name: data.name, description: data.description, price_cents: data.price, dietary: data.dietary, ...(image_url !== undefined ? { image_url } : {}) };
    if (data.id) {
      return must(await supabase.from('menu_items').update(fields).eq('id', data.id).eq('active', true).select('*').single());
    }
    return must(await supabase.from('menu_items').insert({ restaurant_id: restaurant.id, ...fields }).select('*').single());
  });
}

// ---------------------------------------------------------------- profile

export async function saveRestaurantProfile(input: unknown) {
  return action(async () => {
    const { restaurant } = await requireRestaurant();
    const data = parse(restaurantProfileSchema, input);
    const supabase = await supabaseServer();
    let lat = data.lat;
    let lng = data.lng;
    // Until the owner pins the exact spot, use the ZIP code's center.
    if (lat === null || lng === null) {
      const area = maybe(await supabase.rpc('resolve_area', { p_query: data.zip.slice(0, 5) }))?.[0];
      if (area) ({ lat, lng } = area);
    }
    check(
      await supabase.from('restaurants').update({
        name: data.name, description: data.description, cuisine: data.cuisine, address: data.address, city: data.city, zip: data.zip,
        phone: data.phone, tax_rate_bps: Math.round(data.taxRatePct * 100),
        location: lat !== null && lng !== null ? `SRID=4326;POINT(${lng} ${lat})` : null,
      }).eq('id', restaurant.id),
    );
    return null;
  });
}

// ---------------------------------------------------------------- Stripe Connect payouts

// Starts (or resumes) Stripe Express onboarding. Returns the Stripe-hosted onboarding URL.
export async function startStripeOnboarding() {
  return action(async () => {
    const { viewer, restaurant } = await requireRestaurant();
    const url = await orders.connectOnboardingLink(restaurant.id, viewer.email, restaurant.name, publicEnv.siteUrl);
    if (payments().mode === 'mock') await orders.refreshConnectStatus(restaurant.id);
    return { url };
  });
}

export async function refreshStripeStatus() {
  return action(async () => {
    const { restaurant } = await requireRestaurant();
    await orders.refreshConnectStatus(restaurant.id);
    return null;
  });
}

export async function stripeDashboardLink() {
  return action(async () => {
    const { restaurant } = await requireRestaurant();
    const supabase = await supabaseServer();
    const acct = maybe(await supabase.from('restaurant_payment_accounts').select('stripe_account_id').eq('restaurant_id', restaurant.id).maybeSingle());
    if (!acct?.stripe_account_id) throw new AppError(409, 'Set up payouts with Stripe first.');
    const url = await payments().dashboardLink(acct.stripe_account_id);
    if (!url) throw new AppError(409, payments().mode === 'mock' ? 'The Stripe dashboard is not available in test mode.' : 'Finish Stripe onboarding to open your dashboard.');
    return { url };
  });
}

// ---------------------------------------------------------------- kiosk

async function kioskInfo(restaurantId: number, token: string) {
  const urls = kioskUrls(token);
  const qr = await QRCode.toString(urls.kioskUrl, { type: 'svg', margin: 1, color: { dark: '#14284B', light: '#FFFFFF' } });
  return { ...urls, qr };
}

// The restaurant's kiosk link (created on first use), with a QR code to open it on the tablet.
export async function getKiosk() {
  return action(async () => {
    const { restaurant } = await requireRestaurant();
    if (restaurant.status !== 'approved') return null;
    return kioskInfo(restaurant.id, await ensureKioskToken(restaurant.id));
  });
}

// A new kiosk link: the old one stops working at once.
export async function newKioskLink() {
  return action(async () => {
    const { restaurant } = await requireRestaurant();
    if (restaurant.status !== 'approved') throw new AppError(409, 'Your kiosk is available once your restaurant is approved.');
    return kioskInfo(restaurant.id, await rotateKioskToken(restaurant.id));
  });
}
