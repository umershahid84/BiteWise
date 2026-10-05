import { randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { LEGAL_VERSION } from '@/lib/legal/documents';

export type Db = SupabaseClient<Database>;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
const secretKey = process.env.SUPABASE_SECRET_KEY ?? '';

// Integration tests need the local Supabase stack (npm run db:start) and .env.local. They create throwaway
// users and orders, so they never run against a hosted project (*.supabase.co): there they are skipped.
export const isLocalDb = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/.test(url);
let warned = false;
export async function supabaseAvailable() {
  if (url && !isLocalDb) {
    if (!warned) console.warn(`Skipping the integration tests: .env.local points at ${new URL(url).host}, not a local Supabase (npm run db:start).`);
    warned = true;
  }
  if (!url || !secretKey || !isLocalDb) return false;
  try {
    const res = await fetch(`${url}/rest/v1/`, { headers: { apikey: anonKey } });
    return res.status < 500;
  } catch {
    return false;
  }
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
export const admin = () => createClient<Database>(url, secretKey, opts);
export const anon = () => createClient<Database>(url, anonKey, opts);

export const uid = () => randomBytes(4).toString('hex');
export const PASSWORD = 'testpass123';

export const accepted = (role: 'customer' | 'restaurant') =>
  role === 'customer'
    ? { 'customer-terms': LEGAL_VERSION, privacy: LEGAL_VERSION }
    : { 'restaurant-agreement': LEGAL_VERSION, privacy: LEGAL_VERSION };

// Signs up through Supabase Auth (the public API, like the website) and returns a signed-in client.
export async function signUp(role: 'customer' | 'restaurant', extra: Record<string, unknown> = {}) {
  const username = `t_${uid()}`;
  const email = `${username}@example.com`;
  const client = anon();
  const { data, error } = await client.auth.signUp({
    email,
    password: PASSWORD,
    options: {
      data: {
        username, role, accepted_terms: accepted(role),
        restaurant: role === 'restaurant' ? { name: `Test Kitchen ${username}`, address: '1 Test St', city: 'Seattle', zip: '98101' } : undefined,
        ...extra,
      },
    },
  });
  if (error || !data.user) throw new Error(`sign up failed: ${error?.message}`);
  return { client, id: data.user.id, username, email };
}

// A restaurant that is approved, connected to (mock) Stripe, with one menu item and one live offer.
export async function restaurantWithOffer({ quantity = 3, price = 1000, discount = 50, connected = true } = {}) {
  const owner = await signUp('restaurant');
  const db = admin();
  const r = (await db.from('restaurants').select('*').eq('owner_id', owner.id).single()).data!;
  await db.from('restaurants').update({ status: 'approved' }).eq('id', r.id);
  if (connected) {
    await db.from('restaurant_payment_accounts').update({
      stripe_account_id: `acct_mock_${r.id}_${uid()}`, charges_enabled: true, payouts_enabled: true, bank_summary: 'TEST BANK ••••6789',
    }).eq('restaurant_id', r.id);
  }
  const item = (await owner.client.from('menu_items').insert({ restaurant_id: r.id, name: 'Test Bowl', price_cents: price }).select('*').single()).data!;
  const offer = await owner.client.rpc('restaurant_save_offer', {
    p_offer_id: null as unknown as number, p_menu_item_id: item.id, p_reason: 'end_of_day', p_description: '',
    p_discount_pct: discount, p_quantity: quantity, p_expires_in_minutes: 60,
  });
  if (offer.error) throw new Error(offer.error.message);
  return { owner, restaurant: r, item, offer: offer.data };
}

export const visa = { token: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 }, save: false };
