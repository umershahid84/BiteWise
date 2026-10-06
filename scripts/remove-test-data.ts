// Removes the throwaway accounts the automated tests create (t_xxxxxxxx@example.com, restaurants called
// "Test Kitchen t_xxxxxxxx") from the database in .env.local, with everything that belongs to them: their orders,
// refunds, credit, payouts, offers, menus, plans and kiosks.
//
//   npm run remove-test-data            lists what would be removed (nothing is changed)
//   npm run remove-test-data -- --yes   removes it
//
// Only accounts that match the test pattern exactly are touched; demo accounts (@bitewise.test) and real accounts
// are left alone.
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../src/lib/database.types';

config({ path: '.env.local' });
config();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (see .env.example).');
const db = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const apply = process.argv.includes('--yes');

const TEST_EMAIL = /^t_[0-9a-f]{8}@example\.com$/i;
const TEST_USERNAME = /^t_[0-9a-f]{8}$/i;
const TEST_RESTAURANT = /^Test Kitchen t_[0-9a-f]{8}$/;

function must<T>(res: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return (res.data ?? []) as NonNullable<T>;
}

async function all<T>(what: string, query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const rows = must(await query(from, from + 999), what);
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

// Runs a delete in chunks (long id lists don't fit in one request).
async function remove(table: string, column: string, ids: (string | number)[]) {
  let n = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const res = await db.from(table as 'orders').delete({ count: 'exact' }).in(column as 'id', ids.slice(i, i + 100) as number[]);
    if (res.error) throw new Error(`delete from ${table}: ${res.error.message}`);
    n += res.count ?? 0;
  }
  return n;
}

async function main() {
  const profiles = (await all('profiles', (a, b) => db.from('profiles').select('id, email, username, role').range(a, b)))
    .filter((p) => TEST_EMAIL.test(p.email) || (TEST_USERNAME.test(p.username) && /@example\.com$/i.test(p.email)));
  const userIds = profiles.map((p) => p.id);
  const restaurants = (await all('restaurants', (a, b) => db.from('restaurants').select('id, name, owner_id').range(a, b)))
    .filter((r) => userIds.includes(r.owner_id) || TEST_RESTAURANT.test(r.name));
  const restaurantIds = restaurants.map((r) => r.id);
  // Owners of test restaurants (e.g. accounts the tests deleted and anonymized) go too.
  for (const r of restaurants) if (!userIds.includes(r.owner_id)) userIds.push(r.owner_id);

  const orderIds = new Set<number>();
  for (const [column, ids] of [['user_id', userIds], ['restaurant_id', restaurantIds]] as const) {
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100) as string[];
      const rows = await all('orders', (a, b) => db.from('orders').select('id').in(column, chunk).range(a, b));
      for (const o of rows) orderIds.add(o.id);
    }
  }

  console.log(`Test data in ${url}:`);
  console.log(`  ${userIds.length} test accounts (t_xxxxxxxx@example.com and owners of test restaurants)`);
  console.log(`  ${restaurantIds.length} test restaurants ("Test Kitchen t_xxxxxxxx")`);
  console.log(`  ${orderIds.size} orders placed by or at them`);
  if (!userIds.length && !restaurantIds.length) {
    console.log('Nothing to remove.');
    return;
  }
  if (!apply) {
    console.log('\nNothing was changed. To remove all of it, run:  npm run remove-test-data -- --yes');
    return;
  }

  // Rows that point at the orders, then the orders; the rest goes with the accounts (on delete cascade).
  const counts: Record<string, number> = {};
  const orderList = [...orderIds];
  counts.refunds = await remove('refunds', 'order_id', orderList);
  counts.credit = (await remove('credit_ledger', 'order_id', orderList)) + (await remove('credit_ledger', 'user_id', userIds));
  counts.payouts = (await remove('payouts', 'order_id', orderList)) + (await remove('payouts', 'restaurant_id', restaurantIds));
  counts.pins = (await remove('order_pins', 'order_id', orderList)) + (await remove('order_pins', 'restaurant_id', restaurantIds));
  counts.orders = await remove('orders', 'id', orderList);
  counts.offers = await remove('offers', 'restaurant_id', restaurantIds);
  counts.restaurants = await remove('restaurants', 'id', restaurantIds);

  let accounts = 0;
  for (const id of userIds) {
    const res = await db.auth.admin.deleteUser(id);
    if (res.error && !/not found/i.test(res.error.message)) {
      // A login that is already gone leaves a profile behind; remove it directly.
      const p = await db.from('profiles').delete().eq('id', id);
      if (p.error) throw new Error(`delete account ${id}: ${res.error.message}`);
    }
    accounts++;
  }
  console.log(`\nRemoved ${accounts} accounts, ${counts.restaurants} restaurants, ${counts.orders} orders, ${counts.offers} offers, ` +
    `${counts.payouts} payouts, ${counts.refunds} refunds and ${counts.credit} credit entries.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
