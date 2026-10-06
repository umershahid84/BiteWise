import 'server-only';
import { SUSPENSION_DAYS } from '@/lib/constants';
import { AppError, check, maybe, must } from '@/lib/errors';
import * as orders from '@/lib/orders';
import { supabaseAdmin } from '@/lib/supabase/admin';

// Suspensions and bans, for accounts and restaurants. The owner console's actions (src/app/actions/admin.ts) check
// for an admin session and write the audit log; these do the work.
//
//   * Suspension: for a set number of days (SUSPENSION_DAYS). An account can't log in; a restaurant's offers are hidden
//     and it can't post. The sweep job lifts it when the time is up, or an admin lifts it sooner.
//   * Ban: permanent. The login is blocked for good, open orders are cancelled (no charge), and the email stays on the
//     account so it can't be used to sign up again. A banned restaurant is taken off the site and its owner is banned
//     too (and the other way round). An admin can lift a ban made by mistake.

const db = () => supabaseAdmin();
export const BAN = '876000h'; // Supabase Auth has no "forever": 100 years.
const until = (days?: number) => (days ? new Date(Date.now() + days * 86_400_000).toISOString() : null);

function checkDays(status: string, days: number | undefined) {
  if (status !== 'suspended') return;
  if (!days || !(SUSPENSION_DAYS as readonly number[]).includes(days)) throw new AppError(400, 'Choose how many days to suspend for.');
}

export async function setLoginBan(userId: string, duration: string) {
  const { error } = await db().auth.admin.updateUserById(userId, { ban_duration: duration });
  if (error) throw new AppError(500, error.message);
}

// Cancels a person's or a restaurant's open orders (no charge; card holds are voided). Returns how many.
export async function cancelOpenOrders(column: 'user_id' | 'restaurant_id', id: string | number) {
  const open = must(await db().from('orders').select('id, status').eq(column, id).in('status', ['reserved', 'pending_payment']));
  for (const o of open) await orders.release(o.id, o.status, 'cancelled', true);
  return open.length;
}

// Takes a restaurant off the site for good: its offers end, open orders are cancelled and its kiosk link stops working.
async function closeRestaurant(restaurantId: number) {
  must(await db().from('offers').update({ status: 'ended' }).eq('restaurant_id', restaurantId).neq('status', 'ended').select('id'));
  await cancelOpenOrders('restaurant_id', restaurantId);
  must(await db().from('restaurant_kiosks').delete().eq('restaurant_id', restaurantId).select('restaurant_id'));
}

type RestaurantStatus = 'approved' | 'suspended' | 'banned' | 'pending';

// Returns the restaurant's name.
export async function setRestaurantStatus(id: number, d: { status: RestaurantStatus; days?: number; note?: string }) {
  checkDays(d.status, d.days);
  const before = must(await db().from('restaurants').select('id, name, status, owner_id').eq('id', id).maybeSingle());
  must(await db().from('restaurants').update({ status: d.status, admin_note: d.note ?? '', suspended_until: d.status === 'suspended' ? until(d.days) : null }).eq('id', id).select('id'));
  if (d.status === 'banned') {
    await closeRestaurant(id);
    must(await db().from('profiles').update({ status: 'banned', suspended_until: null }).eq('id', before.owner_id).neq('status', 'deleted').select('id'));
    await setLoginBan(before.owner_id, BAN);
  } else if (before.status === 'banned') {
    // Lifting a restaurant's ban lifts its owner's too.
    const lifted = must(await db().from('profiles').update({ status: 'active' }).eq('id', before.owner_id).eq('status', 'banned').select('id'));
    if (lifted.length) await setLoginBan(before.owner_id, 'none');
  }
  return before.name;
}

// Returns the audit log action and details.
export async function setUserStatus(id: string, d: { status: 'active' | 'suspended' | 'banned'; days?: number; note?: string }) {
  checkDays(d.status, d.days);
  const before = must(await db().from('profiles').select('username, role, status').eq('id', id).neq('status', 'deleted').maybeSingle());
  if (before.role === 'admin' && d.status === 'banned') throw new AppError(400, 'Admins cannot be banned. Remove their admin role first.');
  // Lifting a suspension or ban also clears the customer's missed-pickup record (a fresh start).
  const forgive = d.status === 'active' && (before.status === 'suspended' || before.status === 'banned') ? { no_show_strikes: 0, no_show_probation: false } : {};
  must(await db().from('profiles').update({ status: d.status, suspended_until: d.status === 'suspended' ? until(d.days) : null, ...forgive }).eq('id', id).select('id'));
  await setLoginBan(id, d.status === 'suspended' ? `${d.days! * 24}h` : d.status === 'banned' ? BAN : 'none');

  let details = `${before.username} (${before.role})${d.days ? ` for ${d.days} days` : ''}`;
  if (d.status === 'banned') {
    const cancelled = await cancelOpenOrders('user_id', id);
    if (cancelled) details += `, ${cancelled} open order${cancelled === 1 ? '' : 's'} cancelled`;
  }
  if (before.role === 'restaurant') {
    const r = maybe(await db().from('restaurants').select('id, status').eq('owner_id', id).maybeSingle());
    if (r && d.status === 'banned') {
      must(await db().from('restaurants').update({ status: 'banned', suspended_until: null, admin_note: d.note || 'Owner banned' }).eq('id', r.id).select('id'));
      await closeRestaurant(r.id);
      details += ', restaurant removed';
    } else if (r?.status === 'banned' && before.status === 'banned' && d.status === 'active') {
      must(await db().from('restaurants').update({ status: 'approved', admin_note: '' }).eq('id', r.id).select('id'));
      details += ', restaurant reinstated';
    }
  }
  if (d.note) details += `: ${d.note}`;
  return { action: d.status === 'active' && before.status === 'banned' ? 'user.unban' : `user.${d.status}`, details };
}

// Deletes an account. First its open orders are cancelled (no charge) and, for a restaurant owner, the restaurant is
// taken off the site (offers end, its own open orders are cancelled, the kiosk stops, its plan stops renewing).
// An account with no history is then removed completely. One with orders, payouts, credit or plan payments can't be
// removed without losing sales and tax records, so it is closed for good instead: the login is erased, the name,
// email and saved cards are removed (past orders say "Deleted user"), and its restaurant gets status 'deleted'.
export async function deleteAccount(id: string) {
  const u = must(await db().from('profiles').select('username, role').eq('id', id).neq('status', 'deleted').maybeSingle());
  const cancelled = await cancelOpenOrders('user_id', id);
  const restaurants = u.role === 'restaurant' ? must(await db().from('restaurants').select('id, name').eq('owner_id', id)) : [];
  let restaurantOrders = 0;
  for (const r of restaurants) {
    restaurantOrders += await cancelOpenOrders('restaurant_id', r.id);
    await closeRestaurant(r.id);
    check(await db().from('restaurant_subscriptions').update({ status: 'expired', auto_renew: false, updated_at: new Date().toISOString() })
      .eq('restaurant_id', r.id).neq('plan', 'founding'));
  }
  const extra = [cancelled && `${cancelled} open order${cancelled === 1 ? '' : 's'} cancelled`, restaurantOrders && `${restaurantOrders} restaurant order${restaurantOrders === 1 ? '' : 's'} cancelled`]
    .filter(Boolean).join(', ');
  const note = (what: string) => `${u.username} (${u.role})${restaurants.length ? ` · ${restaurants.map((r) => r.name).join(', ')}` : ''}: ${what}${extra ? `; ${extra}` : ''}`;

  // Plan payments are financial records too; the database would delete them with the restaurant.
  const paidPlans = restaurants.length
    ? (await db().from('subscription_payments').select('id', { count: 'exact', head: true }).in('restaurant_id', restaurants.map((r) => r.id)).eq('status', 'paid')).count ?? 0
    : 0;
  if (!paidPlans) {
    const removed = await db().auth.admin.deleteUser(id);
    if (!removed.error) return { anonymized: false, details: note('removed completely') };
  }

  // Kept for its records: anonymize.
  const tag = `deleted_${id.slice(0, 8)}`;
  const closed = await db().auth.admin.updateUserById(id, {
    email: `${tag}@deleted.invalid`, email_confirm: true, password: crypto.randomUUID() + crypto.randomUUID(),
    user_metadata: {}, ban_duration: BAN,
  });
  if (closed.error) throw new AppError(500, closed.error.message);
  must(await db().from('profiles').update({ username: tag, email: `${tag}@deleted.invalid`, status: 'deleted', suspended_until: null, stripe_customer_id: null }).eq('id', id).select('id'));
  must(await db().from('payment_methods').delete().eq('user_id', id).select('id'));
  must(await db().from('orders').update({ customer_username: 'Deleted user' }).eq('user_id', id).select('id'));
  for (const r of restaurants) {
    must(await db().from('restaurants').update({ status: 'deleted', suspended_until: null, admin_note: 'Deleted' }).eq('id', r.id).select('id'));
  }
  return { anonymized: true, details: note('personal details erased, sales and tax records kept') };
}

// Deletes a restaurant together with its owner's account (see deleteAccount).
export async function deleteRestaurant(restaurantId: number) {
  const r = must(await db().from('restaurants').select('owner_id').eq('id', restaurantId).neq('status', 'deleted').maybeSingle());
  return deleteAccount(r.owner_id);
}
