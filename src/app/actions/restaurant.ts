'use server';

import QRCode from 'qrcode';
import { z } from 'zod';
import { requireRestaurant } from '@/lib/auth';
import { isTestStripeAccount } from '@/lib/constants';
import { publicEnv } from '@/lib/env';
import { ensureKioskToken, kioskUrls, rotateKioskToken } from '@/lib/kiosk';
import { action, AppError, check, maybe, must } from '@/lib/errors';
import { payments } from '@/lib/payments';
import * as orders from '@/lib/orders';
import { locateRestaurant } from '@/lib/restaurant-location';
import { importMenu, parseImportInput, parsePreviewInput, previewFromSpreadsheet, previewFromWebsite } from '@/lib/menu-import';
import { storePhoto } from '@/lib/photos';
import { refreshRestaurantTax } from '@/lib/restaurant-tax';
import { createStaff, listStaff, removeStaff, updateStaff } from '@/lib/staff';
import * as subscriptions from '@/lib/subscriptions';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { menuItemSchema, parse, passwordSchema, restaurantProfileSchema, usernameSchema, zipSchema } from '@/lib/validate';

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
    await requireRestaurant({ staff: true });
    const supabase = await supabaseServer();
    const order = maybe(await supabase.rpc('restaurant_find_pickup', { p_pin: parse(pinSchema, pin) }));
    if (!order) throw new AppError(404, 'No order awaiting pickup matches that PIN.');
    return order as unknown as PickupOrder;
  });
}

// Hands over the food: the customer's card is charged now and the restaurant is paid through Stripe Connect.
export async function confirmPickup(pin: string, orderId: number) {
  return action(async () => {
    await requireRestaurant({ staff: true });
    const supabase = await supabaseServer();
    const claimed = must(await supabase.rpc('restaurant_begin_pickup', { p_pin: parse(pinSchema, pin), p_order_id: orderId })) as unknown as {
      id: number; paymentRef: string | null; destinationAccount: string | null;
    };
    const done = await orders.completePickup(claimed);
    orders.emailInvoiceAfterResponse(done.id); // the customer's invoice
    return { id: done.id, quantity: done.quantity, itemTitle: done.item_title, customerUsername: done.customer_username, totalCents: done.total_cents, creditAppliedCents: done.credit_applied_cents };
  });
}

// ---------------------------------------------------------------- menu

async function uploadPhoto(restaurantId: number, dataUrl: string) {
  const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new AppError(400, 'Please choose a JPEG, PNG or WebP photo.');
  return storePhoto(restaurantId, Buffer.from(m[1], 'base64'));
}

const menuInput = menuItemSchema.extend({
  id: z.number().int().positive().optional(),
  image: z.string().optional(),
  removeImage: z.boolean().optional(),
});

export async function saveMenuItem(input: unknown) {
  return action(async () => {
    const { restaurant } = await requireRestaurant({ staff: true });
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
    const before = must(await supabase.from('restaurants').select('address, city, state, zip, tax_checked_at').eq('id', restaurant.id).single());
    let lat = data.lat;
    let lng = data.lng;
    // Without a pin from the owner, look the street address up (or, failing that, use the ZIP code's center).
    if (lat === null || lng === null) {
      const spot = await locateRestaurant(data);
      if (spot) ({ lat, lng } = spot);
    }
    check(
      await supabase.from('restaurants').update({
        name: data.name, description: data.description, cuisine: data.cuisine, address: data.address, city: data.city, zip: data.zip,
        state: data.state, phone: data.phone,
        location: lat !== null && lng !== null ? `SRID=4326;POINT(${lng} ${lat})` : null,
      }).eq('id', restaurant.id),
    );
    // A new address can mean a new sales tax rate: look it up now, so the next order is taxed right.
    const moved = (['address', 'city', 'state', 'zip'] as const).some((k) => before[k] !== data[k]);
    if (moved || !before.tax_checked_at) {
      await refreshRestaurantTax(restaurant.id).catch((err) => console.warn('tax rate lookup failed:', err instanceof Error ? err.message : err));
    }
    return null;
  });
}

// Looks a street address up for the profile's map pin.
export async function locateAddress(input: unknown) {
  return action(async () => {
    await requireRestaurant();
    const a = parse(z.object({
      address: z.string().trim().min(3, 'Enter the street address.'), city: z.string().trim().min(2, 'Enter the city.'), zip: zipSchema,
      state: z.string().trim().length(2).optional(),
    }), input);
    const spot = await locateRestaurant(a);
    if (!spot) throw new AppError(404, 'We couldn\'t find that address. Check it, or drag the pin to your door.');
    return spot;
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
    if (payments().mode === 'mock') {
      throw new AppError(409, 'Payouts are in test mode on Bite Wise right now, so there is no real Stripe account or dashboard yet. Your earnings are recorded and will be paid once Bite Wise switches on live payments.');
    }
    const acct = maybe(await supabase.from('restaurant_payment_accounts').select('stripe_account_id').eq('restaurant_id', restaurant.id).maybeSingle());
    if (!acct?.stripe_account_id || isTestStripeAccount(acct.stripe_account_id)) throw new AppError(409, 'Set up payouts with Stripe first.');
    const url = await payments().dashboardLink(acct.stripe_account_id);
    if (!url) throw new AppError(409, 'Finish Stripe onboarding to open your dashboard.');
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

// ---------------------------------------------------------------- plan (subscription)

const paidPlan = z.enum(['monthly', 'annual'], { message: 'Choose the monthly or annual plan.' });

export async function getPlan() {
  return action(async () => {
    const { restaurant } = await requireRestaurant();
    return subscriptions.planSummary(restaurant.id);
  });
}

// With Stripe, the plan's card is confirmed in the browser first (SetupIntent), so renewals can charge it later.
export async function createPlanSetupIntent() {
  return action(async () => {
    const { viewer } = await requireRestaurant();
    const profile = maybe(await supabaseAdmin().from('profiles').select('stripe_customer_id').eq('id', viewer.id).maybeSingle());
    const customerId = await payments().ensureCustomer({ email: viewer.email, username: viewer.username, existingId: profile?.stripe_customer_id });
    if (customerId !== profile?.stripe_customer_id) await supabaseAdmin().from('profiles').update({ stripe_customer_id: customerId }).eq('id', viewer.id);
    return payments().createSetupIntent(customerId);
  });
}

// Chooses a plan: free (Pioneer Member) while spots are left, with no card; otherwise the restaurant pays with
// subscribePlan. Works while the restaurant waits for approval.
export async function choosePlan(plan: unknown) {
  return action(async () => {
    const { restaurant } = await requireRestaurant();
    return subscriptions.choosePlan(restaurant.id, parse(paidPlan, plan));
  });
}

// Starts a paid plan, paid with a card on file (cardId) or a new card (token, saved to the cards on file).
export async function subscribePlan(input: unknown) {
  return action(async () => {
    const { restaurant } = await requireRestaurant();
    if (restaurant.status === 'banned') throw new AppError(403, 'Your restaurant has been removed from Bite Wise.');
    const d = parse(z.object({ plan: paidPlan, cardId: z.number().int().positive().nullish(), token: z.unknown(), autoRenew: z.boolean().default(true) }), input);
    return subscriptions.subscribe(restaurant.id, d);
  });
}

export async function setPlanAutoRenew(on: boolean) {
  return action(async () => {
    const { restaurant } = await requireRestaurant();
    await subscriptions.setAutoRenew(restaurant.id, parse(z.boolean(), on));
    return null;
  });
}

export async function setPlanAtRenewal(plan: unknown) {
  return action(async () => {
    const { restaurant } = await requireRestaurant();
    await subscriptions.setRenewPlan(restaurant.id, parse(paidPlan, plan));
    return null;
  });
}

// Pays a delinquent plan now, with a card on file (or the default card).
export async function payPlanNow(cardId?: number | null) {
  return action(async () => {
    const { restaurant } = await requireRestaurant();
    return subscriptions.payNow(restaurant.id, parse(z.number().int().positive().nullish(), cardId));
  });
}

// ---- cards on file (auto-renewal charges the default card)

export async function addPlanCard(token: unknown, makeDefault: boolean) {
  return action(async () => {
    const { restaurant } = await requireRestaurant();
    const card = await subscriptions.addCard(restaurant.id, token, parse(z.boolean(), makeDefault));
    return { id: card.id };
  });
}

export async function setDefaultPlanCard(cardId: number) {
  return action(async () => {
    const { restaurant } = await requireRestaurant();
    await subscriptions.setDefaultCard(restaurant.id, parse(z.number().int().positive(), cardId));
    return null;
  });
}

export async function removePlanCard(cardId: number) {
  return action(async () => {
    const { restaurant } = await requireRestaurant();
    await subscriptions.removeCard(restaurant.id, parse(z.number().int().positive(), cardId));
    return null;
  });
}

// ---------------------------------------------------------------- staff accounts (owner only; src/lib/staff.ts)

const staffFields = z.object({
  fullName: z.string().trim().min(2, 'Enter their name.').max(80),
  title: z.enum(['Manager', 'Supervisor']),
});

export async function getStaff() {
  return action(async () => {
    const { restaurant } = await requireRestaurant();
    return listStaff(restaurant.id);
  });
}

export async function addStaff(input: unknown) {
  return action(async () => {
    const { viewer, restaurant } = await requireRestaurant();
    const d = parse(staffFields.extend({ username: usernameSchema, password: passwordSchema }), input);
    await createStaff(restaurant.id, viewer.id, d);
    return null;
  });
}

export async function editStaff(input: unknown) {
  return action(async () => {
    const { restaurant } = await requireRestaurant();
    const d = parse(staffFields.extend({
      userId: z.string().uuid(), password: z.union([z.literal(''), passwordSchema]).optional(), active: z.boolean().optional(),
    }), input);
    await updateStaff(restaurant.id, d.userId, { fullName: d.fullName, title: d.title, password: d.password || undefined, active: d.active });
    return null;
  });
}

export async function deleteStaff(userId: string) {
  return action(async () => {
    const { restaurant } = await requireRestaurant();
    await removeStaff(restaurant.id, parse(z.string().uuid(), userId));
    return null;
  });
}

// ---------------------------------------------------------------- menu import (src/lib/menu-import)

export async function previewMenuImport(input: unknown) {
  return action(async () => {
    await requireRestaurant({ staff: true });
    const d = parsePreviewInput(input);
    return d.kind === 'website' ? previewFromWebsite(d.url) : previewFromSpreadsheet(d.text);
  });
}

export async function importMenuItems(input: unknown) {
  return action(async () => {
    const { restaurant } = await requireRestaurant({ staff: true });
    const d = parseImportInput(input);
    return importMenu(restaurant.id, d.items, { updateExisting: d.updateExisting });
  });
}
