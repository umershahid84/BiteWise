// Populates Supabase with demo accounts, menus, live offers and two weeks of order history around
// greater Seattle. Usage: npm run seed   (run `npm run db:reset` first for a clean database).
// Existing demo accounts are reused; each run posts a fresh set of live offers.
import { randomBytes } from 'node:crypto';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../src/lib/database.types';
import { LEGAL_VERSION, REQUIRED } from '../src/lib/legal/documents';
import { quote } from '../src/lib/pricing';

config({ path: '.env.local' });
config();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (see .env.example).');
const db = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const DEMO_PASSWORD = 'BiteWise123';
type Reason = Database['public']['Enums']['offer_reason'];

const RESTAURANTS = [
  { user: 'harborpho', name: 'Harbor Pho House', cuisine: 'Vietnamese', address: '1410 2nd Ave', city: 'Seattle', zip: '98101', lat: 47.6087, lng: -122.3385, tax: 1035 },
  { user: 'ballardbread', name: 'Ballard Bread Co.', cuisine: 'Bakery', address: '5320 Ballard Ave NW', city: 'Seattle', zip: '98107', lat: 47.6665, lng: -122.3829, tax: 1035 },
  { user: 'caphilltacos', name: 'Capitol Hill Taqueria', cuisine: 'Mexican', address: '401 Broadway E', city: 'Seattle', zip: '98102', lat: 47.6224, lng: -122.321, tax: 1035 },
  { user: 'fremontpizza', name: 'Fremont Pizza Works', cuisine: 'Pizza', address: '3510 Fremont Ave N', city: 'Seattle', zip: '98103', lat: 47.651, lng: -122.3502, tax: 1035 },
  { user: 'bellevuecurry', name: 'Bellevue Curry Kitchen', cuisine: 'Indian', address: '10500 NE 8th St', city: 'Bellevue', zip: '98004', lat: 47.617, lng: -122.2015, tax: 1030 },
  { user: 'redmondpoke', name: 'Redmond Poke Shack', cuisine: 'Hawaiian', address: '16500 NE 74th St', city: 'Redmond', zip: '98052', lat: 47.671, lng: -122.118, tax: 1030 },
  { user: 'kirklandsushi', name: 'Kirkland Sushi Bar', cuisine: 'Japanese', address: '120 Park Ln', city: 'Kirkland', zip: '98033', lat: 47.676, lng: -122.206, tax: 1030 },
];

// More demo restaurants around the region (all fictional). Pins start near the ZIP code's center.
const REGIONAL: [string, string, string, string, string, string][] = [
  ['desmoinesfish', 'Marina Fish & Chips', 'Seafood', '22300 Marine View Dr S', 'Des Moines', '98198'],
  ['kentteriyaki', 'Kent Station Teriyaki', 'Japanese', '417 Ramsay Way', 'Kent', '98032'],
  ['kentpupusas', 'El Comal Pupuseria', 'Salvadoran', '25600 104th Ave SE', 'Kent', '98030'],
  ['fedwaykbbq', 'Federal Way K-BBQ House', 'Korean', '31500 Pacific Hwy S', 'Federal Way', '98003'],
  ['fedwaybakery', 'Twin Lakes Bakery', 'Bakery', '2100 SW 336th St', 'Federal Way', '98023'],
  ['tacomathai', '6th Ave Thai Kitchen', 'Thai', '2700 6th Ave', 'Tacoma', '98406'],
  ['tacomaburger', 'Stadium Burger Co.', 'Burgers', '400 N Tacoma Ave', 'Tacoma', '98403'],
  ['tacomatamales', 'Hilltop Tamaleria', 'Mexican', '1100 MLK Jr Way', 'Tacoma', '98405'],
  ['fifepho', 'Fife Pho & Grill', 'Vietnamese', '5400 Pacific Hwy E', 'Fife', '98424'],
  ['olympiacafe', 'Capitol Lake Cafe', 'Cafe', '500 Capitol Way S', 'Olympia', '98501'],
  ['olympiapizza', 'Olympia Brick Oven', 'Pizza', '3500 Pacific Ave SE', 'Olympia', '98501'],
  ['laceycurry', 'Lacey Spice Route', 'Indian', '5800 Martin Way E', 'Lacey', '98516'],
  ['puyallupdeli', 'Meridian Deli', 'American', '300 S Meridian', 'Puyallup', '98371'],
  ['auburnnoodle', 'Main Street Noodle Bar', 'Chinese', '200 E Main St', 'Auburn', '98002'],
  ['rentontacos', 'Renton Landing Tacos', 'Mexican', '800 N 10th St', 'Renton', '98057'],
  ['burienmed', 'Burien Mediterranean Grill', 'Mediterranean', '15100 Ambaum Blvd SW', 'Burien', '98166'],
  ['tukwilasushi', 'Southcenter Sushi', 'Japanese', '17000 Southcenter Pkwy', 'Tukwila', '98188'],
  ['lakewoodsoul', 'Lakewood Soul Kitchen', 'American', '6100 Mt Tacoma Dr SW', 'Lakewood', '98499'],
  ['everettbbq', 'Everett Waterfront BBQ', 'BBQ', '1700 W Marine View Dr', 'Everett', '98201'],
  ['lynnwoodgreens', 'Alderwood Greens', 'Salad', '3000 184th St SW', 'Lynnwood', '98037'],
  ['bremertonchowder', 'Ferry Dock Chowder', 'Seafood', '200 Washington Ave', 'Bremerton', '98337'],
  ['issaquahbakehouse', 'Front Street Bakehouse', 'Bakery', '100 Front St N', 'Issaquah', '98027'],
];

// Menus: [restaurant user, item name, description, dietary, price]
const MENU: [string, string, string, string, number][] = [
  ['harborpho', 'Large Beef Pho', 'Rare steak & brisket in 12-hour beef broth with rice noodles, herbs and lime.', '', 16.95],
  ['harborpho', 'Lemongrass Tofu Banh Mi', 'Crispy lemongrass tofu, pickled carrot, cucumber and cilantro on a toasted baguette.', 'vegetarian,dairy-free', 11.5],
  ['harborpho', 'Fresh Spring Rolls (3)', 'Shrimp, vermicelli and herbs with peanut sauce.', 'gluten-free', 8.5],
  ['ballardbread', 'Bakery Surprise Bag', 'Assorted croissants, scones and a loaf from today.', 'vegetarian', 24],
  ['ballardbread', 'Seeded Sourdough Loaf', 'Naturally leavened, baked this morning.', 'vegan', 9],
  ['ballardbread', 'Chocolate Croissant', 'All-butter croissant with dark chocolate.', 'vegetarian', 5],
  ['caphilltacos', 'Carnitas Burrito Plate', 'Slow-cooked pork, rice, beans and salsa verde.', 'gluten-free', 15.25],
  ['caphilltacos', 'Veggie Taco Trio', 'Roasted sweet potato, black bean and poblano tacos.', 'vegetarian', 12],
  ['caphilltacos', 'Chips & Guacamole', 'House-made tortilla chips and fresh guacamole.', 'vegan,gluten-free', 7],
  ['fremontpizza', 'Whole Margherita Pizza (16")', 'San Marzano tomato, fresh mozzarella and basil.', 'vegetarian', 24],
  ['fremontpizza', 'Pepperoni Slices (2)', 'Two big New York-style slices.', '', 8],
  ['fremontpizza', 'Caesar Salad', 'Romaine, parmesan, croutons and lemon Caesar dressing.', 'vegetarian', 10],
  ['bellevuecurry', 'Chicken Tikka Masala + Rice', 'Tandoori chicken in creamy tomato masala with basmati rice.', 'gluten-free', 17.5],
  ['bellevuecurry', 'Chana Masala Bowl', 'Chickpeas simmered with tomato, ginger and spices.', 'vegan,gluten-free', 13],
  ['bellevuecurry', 'Garlic Naan', 'Fresh from the tandoor.', 'vegetarian', 4.5],
  ['redmondpoke', 'Ahi Poke Bowl (Regular)', 'Ahi tuna, avocado, cucumber and seaweed salad over rice.', 'dairy-free', 16],
  ['kirklandsushi', "Chef's Nigiri Set (8 pc)", "Chef's selection of seasonal nigiri.", 'gluten-free', 32],
  ['kirklandsushi', 'Veggie Roll Combo', 'Avocado, cucumber and sweet potato rolls.', 'vegan', 14],
  ['kirklandsushi', 'Miso Soup', 'Tofu, wakame and scallion.', 'vegan', 4],
];

// Offers: [restaurant user, menu item, reason, note, discount %, qty, discard timer (hours)]
const OFFERS: [string, string, Reason, string, number, number, number][] = [
  ['harborpho', 'Large Beef Pho', 'wrong_order', 'Customer ordered chicken instead. Broth and noodles packed separately.', 50, 2, 3],
  ['harborpho', 'Lemongrass Tofu Banh Mi', 'delayed_order', 'Freshly made, delivery driver never arrived.', 40, 3, 2],
  ['ballardbread', 'Bakery Surprise Bag', 'end_of_day', '', 65, 6, 4],
  ['ballardbread', 'Seeded Sourdough Loaf', 'overproduction', '', 45, 4, 5],
  ['caphilltacos', 'Carnitas Burrito Plate', 'wrong_order', 'Order was placed twice by mistake.', 55, 1, 2],
  ['caphilltacos', 'Veggie Taco Trio', 'unclaimed_order', '', 40, 2, 4],
  ['fremontpizza', 'Whole Margherita Pizza (16")', 'unclaimed_order', 'Pickup order never collected. Still warm!', 60, 1, 2],
  ['fremontpizza', 'Pepperoni Slices (2)', 'end_of_day', '', 50, 8, 3],
  ['bellevuecurry', 'Chicken Tikka Masala + Rice', 'overproduction', 'Catering overage from a corporate lunch.', 50, 10, 4],
  ['bellevuecurry', 'Chana Masala Bowl', 'delayed_order', '', 45, 2, 3],
  ['redmondpoke', 'Ahi Poke Bowl (Regular)', 'wrong_order', 'Wrong base (white rice instead of brown).', 45, 1, 2],
  ['kirklandsushi', "Chef's Nigiri Set (8 pc)", 'unclaimed_order', 'Prepared for a reservation that did not show.', 40, 2, 3],
  ['kirklandsushi', 'Veggie Roll Combo', 'end_of_day', '', 50, 5, 4],
];

// [restaurant user, dish, description, dietary, price, reason, discount %, qty]
const REGIONAL_MENU: [string, string, string, string, number, Reason, number, number][] = [
  ['desmoinesfish', 'Halibut Fish & Chips', 'Beer-battered halibut, fries and slaw.', '', 18.5, 'wrong_order', 45, 3],
  ['desmoinesfish', 'Clam Chowder Bowl', 'New England style with oyster crackers.', 'gluten-free', 9, 'end_of_day', 50, 6],
  ['kentteriyaki', 'Chicken Teriyaki Plate', 'Grilled chicken, rice and salad.', 'dairy-free', 13.5, 'overproduction', 40, 8],
  ['kentpupusas', 'Pupusa Combo (3)', 'Cheese, bean and revuelta pupusas with curtido.', 'gluten-free', 12, 'unclaimed_order', 50, 2],
  ['fedwaykbbq', 'Bulgogi Lunch Box', 'Marinated beef, rice and banchan.', 'dairy-free', 17, 'delayed_order', 45, 2],
  ['fedwaybakery', 'Pastry Rescue Box', "Today's croissants, danishes and muffins.", 'vegetarian', 20, 'end_of_day', 60, 5],
  ['tacomathai', 'Pad Thai with Chicken', 'Rice noodles, egg, peanuts and lime.', 'dairy-free', 15, 'wrong_order', 50, 1],
  ['tacomathai', 'Green Curry with Tofu', 'Coconut green curry with jasmine rice.', 'vegan,gluten-free', 14, 'overproduction', 40, 4],
  ['tacomaburger', 'Double Smash Burger + Fries', 'Two patties, cheese and house sauce.', '', 16, 'unclaimed_order', 50, 2],
  ['tacomatamales', 'Pork Tamales (half dozen)', 'Red chile pork tamales.', 'gluten-free', 18, 'end_of_day', 45, 4],
  ['fifepho', 'Brisket Pho', 'Slow-simmered broth with brisket and herbs.', 'dairy-free', 14.5, 'delayed_order', 40, 3],
  ['olympiacafe', 'Sandwich & Soup Combo', "Half sandwich and today's soup.", 'vegetarian', 13, 'end_of_day', 50, 5],
  ['olympiapizza', 'Wood-Fired Pepperoni Pizza', '12-inch pizza from our brick oven.', '', 19, 'unclaimed_order', 55, 1],
  ['laceycurry', 'Butter Chicken + Naan', 'Creamy tomato curry with garlic naan.', '', 17, 'overproduction', 45, 6],
  ['puyallupdeli', 'Turkey Club Sandwich', 'Roast turkey, bacon, lettuce and tomato on sourdough.', '', 12.5, 'wrong_order', 40, 2],
  ['auburnnoodle', 'Beef Chow Fun', 'Wok-tossed wide rice noodles with beef.', 'dairy-free', 14, 'delayed_order', 50, 2],
  ['rentontacos', 'Al Pastor Taco Plate', 'Four tacos with rice and beans.', 'gluten-free', 13, 'end_of_day', 45, 4],
  ['burienmed', 'Chicken Shawarma Plate', 'Rice, salad, hummus and garlic sauce.', 'halal', 16, 'overproduction', 50, 5],
  ['tukwilasushi', 'Salmon Poke Bowl', 'Salmon, avocado and cucumber over rice.', 'dairy-free', 17, 'wrong_order', 45, 1],
  ['lakewoodsoul', 'Fried Chicken Dinner', 'Three pieces, mac & cheese and greens.', '', 18, 'unclaimed_order', 50, 2],
  ['everettbbq', 'Brisket Sandwich + Side', 'Smoked brisket on a brioche bun.', '', 16.5, 'end_of_day', 40, 6],
  ['lynnwoodgreens', 'Harvest Grain Bowl', 'Farro, roasted squash, kale and tahini.', 'vegan', 13.5, 'overproduction', 50, 4],
  ['bremertonchowder', 'Seafood Chowder Bread Bowl', 'Clams, salmon and shrimp in a sourdough bowl.', '', 14, 'end_of_day', 45, 3],
  ['issaquahbakehouse', 'Cinnamon Roll 4-Pack', 'Baked this morning with cream cheese icing.', 'vegetarian', 16, 'end_of_day', 60, 3],
];

function must<T>(res: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as NonNullable<T>;
}

const tags = (s: string) => (s ? s.split(',') : []);

async function deleteLogin(email: string) {
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`list users: ${error.message}`);
    const found = data.users.find((u) => u.email === email);
    if (found) {
      const del = await db.auth.admin.deleteUser(found.id);
      if (del.error) throw new Error(`delete ${email}: ${del.error.message}`);
      return;
    }
    if (data.users.length < 1000) return;
  }
}

// Creates a user through Supabase Auth (the sign-up trigger creates the profile, restaurant and
// terms-acceptance records), or returns the existing one.
const demoUsers: { id: string; role: 'customer' | 'restaurant' | 'admin' }[] = [];

async function user(username: string, role: 'customer' | 'restaurant' | 'admin', restaurant?: Record<string, unknown>) {
  const id = await findOrCreateUser(username, role, restaurant);
  demoUsers.push({ id, role });
  return id;
}

async function findOrCreateUser(username: string, role: 'customer' | 'restaurant' | 'admin', restaurant?: Record<string, unknown>) {
  const existing = await db.from('profiles').select('id').eq('username', username).maybeSingle();
  if (existing.data) {
    // Demo accounts seeded under an earlier name of the business move to the new email and password.
    const { data } = await db.auth.admin.getUserById(existing.data.id);
    if (/@(biteback|rescuebites)\.test$/.test(data.user?.email ?? '')) {
      const res = await db.auth.admin.updateUserById(existing.data.id, { email: `${username}@bitewise.test`, password: DEMO_PASSWORD, email_confirm: true });
      if (res.error) throw new Error(`update ${username}: ${res.error.message}`);
    }
    return existing.data.id;
  }
  // Admins are created as customers and then promoted (like scripts/create-admin.ts does).
  const signupRole = role === 'admin' ? 'customer' : role;
  const accepted = Object.fromEntries(REQUIRED[signupRole].map((d) => [d, LEGAL_VERSION]));
  const email = `${username}@bitewise.test`;
  const create = () => db.auth.admin.createUser({
    email,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { username, role: signupRole, accepted_terms: accepted, restaurant, ip: 'seed', user_agent: 'npm run seed' },
  });
  let res = await create();
  if (res.error?.code === 'email_exists') {
    // A login without a profile, left by a seed run before the database tables existed: replace it.
    await deleteLogin(email);
    res = await create();
  }
  if (res.error || !res.data.user) throw new Error(`create ${username}: ${res.error?.message}`);
  const id = res.data.user.id;
  if (role === 'admin') must(await db.from('profiles').update({ role: 'admin' }).eq('id', id).select('id'), 'promote admin');
  return id;
}

async function restaurantId(ownerId: string) {
  return must(await db.from('restaurants').select('id').eq('owner_id', ownerId).single(), 'restaurant').id;
}

async function main() {
  const tables = await db.from('profiles').select('id').limit(1);
  if (tables.error?.code === 'PGRST205' || tables.error?.code === '42P01') {
    throw new Error(`The database doesn't have the Bite Wise tables yet (${tables.error.message}).
Create them first with: npx supabase db push   (see "Run it locally" in README.md), then run npm run seed again.`);
  }
  if (tables.error) throw new Error(`Can't reach the database at ${url}: ${tables.error.message}`);
  const { data: fee } = await db.from('settings').select('value').eq('key', 'service_fee_bps').single();
  const serviceFeeBps = Number(fee?.value ?? 500);

  const demoId = await user('demo', 'customer');
  await user('admin', 'admin');

  // Demo rates count as already looked up (fictional addresses; no lookups over the internet when seeding).
  const demoTax = (city: string) => ({
    state: 'WA', tax_source: 'auto', tax_accuracy: 'address', tax_jurisdiction: `${city}, WA (demo)`, tax_checked_at: new Date().toISOString(),
  } as const);
  const ids: Record<string, number> = {};
  for (const r of RESTAURANTS) {
    const owner = await user(r.user, 'restaurant', { name: r.name, address: r.address, city: r.city, zip: r.zip, cuisine: r.cuisine, lat: r.lat, lng: r.lng });
    ids[r.user] = await restaurantId(owner);
    must(await db.from('restaurants').update({
      status: 'approved', tax_rate_bps: r.tax, ...demoTax(r.city), description: `Neighborhood ${r.cuisine.toLowerCase()} spot in ${r.city}.`,
      phone: `(206) 555-01${String(Object.keys(ids).length).padStart(2, '0')}`,
    }).eq('id', ids[r.user]).select('id'), 'approve');
    // Seattle-area demo restaurants have finished Stripe Connect onboarding (mock accounts).
    must(await db.from('restaurant_payment_accounts').update({
      stripe_account_id: `acct_mock_${String(ids[r.user]).padStart(6, '0')}`, charges_enabled: true, payouts_enabled: true,
      details_submitted: true, bank_summary: 'MOCK BANK ••••6789',
    }).eq('restaurant_id', ids[r.user]).select('restaurant_id'), 'connect');
  }

  for (const [i, [u, name, cuisine, address, city, zip]] of REGIONAL.entries()) {
    const z = must(await db.rpc('resolve_area', { p_query: zip }), 'zip')[0];
    // Small, deterministic offset so restaurants in the same ZIP don't share one pin.
    const lat = z.lat + (((i * 37) % 11) - 5) * 0.0012;
    const lng = z.lng + (((i * 53) % 11) - 5) * 0.0016;
    const owner = await user(u, 'restaurant', { name, address, city, zip, cuisine, lat, lng });
    ids[u] = await restaurantId(owner);
    must(await db.from('restaurants').update({
      // One restaurant waits for approval, to show the admin approval queue.
      status: u === 'issaquahbakehouse' ? 'pending' : 'approved', ...demoTax(city),
      description: `Neighborhood ${cuisine.toLowerCase()} spot in ${city}.`, phone: `(253) 555-${String(1000 + i).slice(-4)}`,
    }).eq('id', ids[u]).select('id'), 'approve');
  }

  // An admin employee (support, no refunds): logs in at /admin/login as support.demo.
  if (!(await db.from('profiles').select('id').eq('username', 'support.demo').maybeSingle()).data) {
    const token = randomBytes(32).toString('hex');
    must(await db.from('team_invites').insert({ token, role: 'support', can_refund: false }).select('token'), 'team invite');
    const res = await db.auth.admin.createUser({
      email: 'support.demo@bitewise.test', password: DEMO_PASSWORD, email_confirm: true, user_metadata: { username: 'support.demo', team_invite: token },
    });
    if (res.error) throw new Error(`support: ${res.error.message}`);
  }

  // A staff account (a manager) for Harbor Pho House: logs in at /restaurant/login as harborpho.manager.
  if (!(await db.from('profiles').select('id').eq('username', 'harborpho.manager').maybeSingle()).data) {
    const token = randomBytes(32).toString('hex');
    must(await db.from('staff_invites').insert({ token, restaurant_id: ids.harborpho, full_name: 'Linh Tran', title: 'Manager' }).select('token'), 'staff invite');
    const res = await db.auth.admin.createUser({
      email: `harborpho.manager.${randomBytes(4).toString('hex')}@staff.bitewise.invalid`, password: DEMO_PASSWORD, email_confirm: true,
      user_metadata: { username: 'harborpho.manager', staff_invite: token },
    });
    if (res.error) throw new Error(`staff: ${res.error.message}`);
  }

  // Plans: the Seattle demo restaurants are on the annual plan and the others on the monthly plan (mock payments),
  // each with a test card on file.
  // Demo restaurants never take one of the free Pioneer Member spots, which are kept for real restaurants.
  for (const [u, rid] of Object.entries(ids)) {
    if (u === 'issaquahbakehouse') continue;
    // A test card on file (mock payments), which auto-renewal charges.
    const owner = must(await db.from('restaurants').select('owner_id').eq('id', rid).single(), 'owner').owner_id;
    const cards = must(await db.from('payment_methods').select('id').eq('user_id', owner).limit(1), 'cards');
    if (!cards.length) {
      must(await db.from('payment_methods').insert({ user_id: owner, provider_ref: 'pm_mock_demo_4242', brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030, is_default: true }).select('id'), 'card');
      await db.from('profiles').update({ stripe_customer_id: `cus_mock_demo_${rid}` }).eq('id', owner).is('stripe_customer_id', null);
    }
    const plan = RESTAURANTS.some((r) => r.user === u) ? 'annual' : 'monthly';
    const existing = await db.from('restaurant_subscriptions').select('plan, founding_number, current_period_end').eq('restaurant_id', rid).maybeSingle();
    if (existing.data && existing.data.founding_number === null && existing.data.plan === plan && Date.parse(existing.data.current_period_end ?? '') > Date.now()) continue;
    const start = new Date();
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + (plan === 'annual' ? 12 : 1));
    const price = plan === 'annual' ? 15000 : 1500;
    must(await db.from('restaurant_subscriptions').upsert({
      restaurant_id: rid, plan, renew_plan: null, status: 'active', founding_number: null, auto_renew: true, price_cents: price,
      current_period_start: start.toISOString(), current_period_end: end.toISOString(), customer_ref: 'cus_mock_demo',
      card_ref: 'pm_mock_demo_4242', card_label: 'VISA •••• 4242', last_payment_error: '', retry_at: null, renewing_at: null,
    }).select('restaurant_id'), 'plan');
    const invoice = must(await db.rpc('next_subscription_invoice'), 'invoice number');
    // Plus Washington sales tax at the restaurant's rate, like a real payment.
    const rate = must(await db.from('restaurants').select('tax_rate_bps').eq('id', rid).single(), 'tax rate').tax_rate_bps;
    const tax = Math.round((price * rate) / 10000);
    must(await db.from('subscription_payments').insert({
      restaurant_id: rid, plan, amount_cents: price + tax, list_price_cents: price, tax_rate_bps: rate, tax_cents: tax, status: 'paid', period_start: start.toISOString(), period_end: end.toISOString(),
      invoice_number: invoice, transaction_id: `pi_mock_demo_sub_${rid}`, card_label: 'VISA •••• 4242',
    }).select('id'), 'plan payment');
  }

  // Demo accounts accept the current terms, so they aren't asked again after the terms change.
  for (const u of demoUsers.filter((x) => x.role !== 'admin')) {
    for (const document of REQUIRED[u.role as 'customer' | 'restaurant']) {
      const has = await db.from('terms_acceptances').select('id').eq('user_id', u.id).eq('document', document).eq('version', LEGAL_VERSION).limit(1);
      if (!has.data?.length) must(await db.from('terms_acceptances').insert({ user_id: u.id, document, version: LEGAL_VERSION, ip: 'seed', user_agent: 'npm run seed' }).select('id'), 'terms');
    }
  }

  // Menus.
  const menuId: Record<string, { id: number; price: number; name: string; description: string; dietary: string[]; restaurant: number }> = {};
  const addItem = async (u: string, name: string, description: string, dietary: string, price: number) => {
    const found = await db.from('menu_items').select('*').eq('restaurant_id', ids[u]).eq('name', name).eq('active', true).maybeSingle();
    const row = found.data ?? must(await db.from('menu_items').insert({
      restaurant_id: ids[u], name, description, dietary: tags(dietary), price_cents: Math.round(price * 100),
    }).select('*').single(), 'menu item');
    menuId[`${u}|${name}`] = { id: row.id, price: row.price_cents, name: row.name, description: row.description, dietary: row.dietary, restaurant: ids[u] };
  };
  for (const [u, name, desc, dietary, price] of MENU) await addItem(u, name, desc, dietary, price);
  for (const [u, name, desc, dietary, price] of REGIONAL_MENU) await addItem(u, name, desc, dietary, price);

  // Live offers with discard timers.
  const now = Date.now();
  const hour = 3600_000;
  const offerRows = [
    ...OFFERS.map(([u, item, reason, note, pct, qty, h]) => ({ key: `${u}|${item}`, reason, note, pct, qty, h })),
    ...REGIONAL_MENU.map(([u, item, , , , reason, pct, qty], i) => ({ key: `${u}|${item}`, reason, note: '', pct, qty, h: 2 + (i % 4) })),
  ].map((o) => {
    const m = menuId[o.key];
    return {
      restaurant_id: m.restaurant, menu_item_id: m.id, title: m.name, description: o.note || m.description, reason: o.reason,
      dietary: m.dietary, original_price_cents: m.price, discount_pct: o.pct, quantity_total: o.qty, quantity_available: o.qty,
      pickup_start: new Date(now - 10 * 60_000).toISOString(), pickup_end: new Date(now + o.h * hour).toISOString(),
    };
  });
  must(await db.from('offers').insert(offerRows).select('id'), 'offers');

  // Two weeks of completed demo orders so the admin dashboard, reports and payouts have data.
  const hasHistory = must(await db.from('orders').select('id').eq('user_id', demoId).eq('status', 'picked_up').limit(1), 'orders');
  if (!hasHistory.length) {
    const approved = new Set(Object.entries(ids).filter(([u]) => u !== 'issaquahbakehouse').map(([, id]) => id));
    const offers = must(await db.from('offers').select('id, menu_item_id, restaurant_id'), 'offers');
    const taxes = new Map(must(await db.from('restaurants').select('id, tax_rate_bps'), 'restaurants').map((r) => [r.id, r.tax_rate_bps]));
    const items = Object.values(menuId).filter((m) => approved.has(m.restaurant))
      .map((m) => ({ ...m, offerId: offers.find((o) => o.menu_item_id === m.id)?.id })).filter((m) => m.offerId);
    let seedN = 7;
    const rand = () => {
      seedN = (seedN * 16807) % 2147483647;
      return seedN / 2147483647;
    };
    const rows: Database['public']['Tables']['orders']['Insert'][] = [];
    for (let d = 14; d >= 1; d--) {
      const count = 2 + Math.floor(rand() * 5);
      for (let k = 0; k < count; k++) {
        const m = items[Math.floor(rand() * items.length)];
        const qty = 1 + Math.floor(rand() * 2);
        const pct = [40, 45, 50, 55, 60][Math.floor(rand() * 5)];
        const q = quote({ originalUnitCents: m.price, discountPct: pct, quantity: qty, serviceFeeBps, taxRateBps: taxes.get(m.restaurant) ?? 1035 });
        const created = new Date(now - d * 86400000 - Math.floor(rand() * 8 + 1) * 3600000);
        const picked = new Date(created.getTime() + (15 + Math.floor(rand() * 60)) * 60000);
        rows.push({
          user_id: demoId, offer_id: m.offerId!, restaurant_id: m.restaurant, customer_username: 'demo', item_title: m.name, quantity: qty,
          unit_price_cents: q.unitPriceCents, original_unit_price_cents: q.originalUnitCents, discount_pct: pct, subtotal_cents: q.subtotalCents,
          service_fee_cents: q.serviceFeeCents, service_fee_bps: q.serviceFeeBps, tax_rate_bps: q.taxRateBps, tax_cents: q.taxCents,
          total_cents: q.totalCents, status: 'picked_up', payment_ref: `pi_mock_demo_${d}_${k}`, card_label: 'VISA •••• 4242',
          pickup_end: picked.toISOString(), created_at: created.toISOString(), picked_up_at: picked.toISOString(), closed_at: picked.toISOString(),
        });
      }
    }
    const inserted = must(await db.from('orders').insert(rows).select('id, restaurant_id, subtotal_cents'), 'history');
    // Connected (Seattle-area) restaurants were paid through Stripe Connect at pickup.
    const connected = new Set(RESTAURANTS.map((r) => ids[r.user]));
    for (const o of inserted.filter((x) => connected.has(x.restaurant_id))) {
      must(await db.rpc('record_payout', {
        p_restaurant_id: o.restaurant_id, p_order_id: o.id, p_kind: 'transfer', p_amount_cents: o.subtotal_cents,
        p_transaction_id: `tr_mock_demo_${o.id}`, p_bank_details: `Stripe Connect acct_mock_${String(o.restaurant_id).padStart(6, '0')} · MOCK BANK ••••6789`,
        p_note: `Order #${o.id}`, p_by: null as unknown as string,
      }), 'payout');
    }
    // Some welcome credit for the demo customer.
    must(await db.from('credit_ledger').insert({ user_id: demoId, amount_cents: 1000, kind: 'goodwill', note: 'Welcome credit (demo)' }).select('id'), 'credit');
  }

  console.log('Seeded demo data.');
  console.log(`  Customer login:    demo / ${DEMO_PASSWORD}`);
  console.log(`  Owner/admin login: admin / ${DEMO_PASSWORD}  (demo only: create your real one with npm run create-admin)`);
  console.log(`  Admin employee login (password ${DEMO_PASSWORD}, at /admin/login, no refunds): support.demo`);
  console.log(`  Restaurant staff login (password ${DEMO_PASSWORD}, at /restaurant/login): harborpho.manager`);
  console.log(`  Restaurant logins (password ${DEMO_PASSWORD}):`);
  console.log(`    Seattle/Eastside (Stripe connected): ${RESTAURANTS.map((r) => r.user).join(', ')}`);
  console.log(`    Around the region: ${REGIONAL.map((r) => `${r[0]} (${r[4]})`).join(', ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
