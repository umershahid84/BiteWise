import 'server-only';
import { randomBytes } from 'node:crypto';
import { publicEnv } from '@/lib/env';
import { must } from '@/lib/errors';
import { supabaseAdmin } from '@/lib/supabase/admin';

// Restaurant kiosks: the counter tablet opens /kiosk/<token>. The token is the kiosk's only credential (no login),
// so it is long and random, kept server-side and owner-readable only, and can be replaced from the dashboard.

const db = () => supabaseAdmin();
const TOKEN = /^[A-Za-z0-9_-]{24,64}$/;

export type Kiosk = { restaurantId: number; name: string; status: 'pending' | 'approved' | 'suspended' };

export async function kioskByToken(token: string): Promise<Kiosk | null> {
  if (!TOKEN.test(token)) return null;
  const { data } = await db().from('restaurant_kiosks').select('restaurant_id, restaurants(name, status)').eq('token', token).maybeSingle();
  const r = data?.restaurants as { name: string; status: Kiosk['status'] } | null | undefined;
  return data && r ? { restaurantId: data.restaurant_id, name: r.name, status: r.status } : null;
}

const newToken = () => randomBytes(24).toString('base64url');

// The restaurant's kiosk token, created on first use.
export async function ensureKioskToken(restaurantId: number): Promise<string> {
  const { data } = await db().from('restaurant_kiosks').select('token').eq('restaurant_id', restaurantId).maybeSingle();
  if (data) return data.token;
  const row = must(await db().from('restaurant_kiosks').upsert({ restaurant_id: restaurantId, token: newToken() }, { onConflict: 'restaurant_id', ignoreDuplicates: true }).select('token').maybeSingle());
  return row?.token ?? (must(await db().from('restaurant_kiosks').select('token').eq('restaurant_id', restaurantId).single())).token;
}

// A new link; the old one stops working at once (e.g. a tablet was lost or the link was shared too widely).
export async function rotateKioskToken(restaurantId: number): Promise<string> {
  return must(await db().from('restaurant_kiosks').upsert({ restaurant_id: restaurantId, token: newToken(), created_at: new Date().toISOString() }).select('token').single()).token;
}

export function kioskUrls(token: string) {
  const kioskUrl = `${publicEnv.siteUrl}/kiosk/${token}`;
  return { kioskUrl, androidUrl: `${kioskUrl}?install=android`, appleUrl: `${kioskUrl}?install=apple` };
}
