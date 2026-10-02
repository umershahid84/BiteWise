// Populates the database with demo accounts and offers around greater Seattle.
// Usage: npm run seed   (adds data; safe to re-run, existing demo accounts are reused)
process.env.TZ ||= 'America/Los_Angeles';

const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const { openDatabase, transaction } = require('./db');
const { hashPassword } = require('./auth');
const { lookupZip } = require('./areas');
const { createLegal } = require('./legal/documents');
const { quote } = require('./pricing');
const { createCipher } = require('./secure');

const DEMO_PASSWORD = 'BiteWise123';

const RESTAURANTS = [
  { user: 'harborpho', name: 'Harbor Pho House', cuisine: 'Vietnamese', address: '1410 2nd Ave', city: 'Seattle', zip: '98101', lat: 47.6087, lng: -122.3385, tax: 1035 },
  { user: 'ballardbread', name: 'Ballard Bread Co.', cuisine: 'Bakery', address: '5320 Ballard Ave NW', city: 'Seattle', zip: '98107', lat: 47.6665, lng: -122.3829, tax: 1035 },
  { user: 'caphilltacos', name: 'Capitol Hill Taqueria', cuisine: 'Mexican', address: '401 Broadway E', city: 'Seattle', zip: '98102', lat: 47.6224, lng: -122.3210, tax: 1035 },
  { user: 'fremontpizza', name: 'Fremont Pizza Works', cuisine: 'Pizza', address: '3510 Fremont Ave N', city: 'Seattle', zip: '98103', lat: 47.6510, lng: -122.3502, tax: 1035 },
  { user: 'bellevuecurry', name: 'Bellevue Curry Kitchen', cuisine: 'Indian', address: '10500 NE 8th St', city: 'Bellevue', zip: '98004', lat: 47.6170, lng: -122.2015, tax: 1030 },
  { user: 'redmondpoke', name: 'Redmond Poke Shack', cuisine: 'Hawaiian', address: '16500 NE 74th St', city: 'Redmond', zip: '98052', lat: 47.6710, lng: -122.1180, tax: 1030 },
  { user: 'kirklandsushi', name: 'Kirkland Sushi Bar', cuisine: 'Japanese', address: '120 Park Ln', city: 'Kirkland', zip: '98033', lat: 47.6760, lng: -122.2060, tax: 1030 },
];

// More demo restaurants around the region (all fictional). Pins start near the ZIP code's
// center; owners can drag their pin to the exact spot in the portal.
const REGIONAL = [
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

// [restaurant user, dish, description, dietary, price, reason, discount %, qty]
const REGIONAL_MENU = [
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

// Real photos for demo dishes can be dropped into public/assets/demo-food/<photo>.jpg (see README).
const PHOTO_DIR = path.join(__dirname, '..', 'public', 'assets', 'demo-food');
const photoPath = (name) => (fs.existsSync(path.join(PHOTO_DIR, `${name}.jpg`)) ? `/assets/demo-food/${name}.jpg` : null);

// Menus: [restaurant user, item name, description, dietary, price, demo photo file name]
const MENU = [
  ['harborpho', 'Large Beef Pho', 'Rare steak & brisket in 12-hour beef broth with rice noodles, herbs and lime.', '', 16.95, 'beef-pho'],
  ['harborpho', 'Lemongrass Tofu Banh Mi', 'Crispy lemongrass tofu, pickled carrot, cucumber and cilantro on a toasted baguette.', 'vegetarian,dairy-free', 11.5, 'tofu-banh-mi'],
  ['harborpho', 'Fresh Spring Rolls (3)', 'Shrimp, vermicelli and herbs with peanut sauce.', 'gluten-free', 8.5, 'spring-rolls'],
  ['ballardbread', 'Bakery Surprise Bag', 'Assorted croissants, scones and a loaf from today.', 'vegetarian', 24, 'surprise-bag'],
  ['ballardbread', 'Seeded Sourdough Loaf', 'Naturally leavened, baked this morning.', 'vegan', 9, 'sourdough'],
  ['ballardbread', 'Chocolate Croissant', 'All-butter croissant with dark chocolate.', 'vegetarian', 5, 'choc-croissant'],
  ['caphilltacos', 'Carnitas Burrito Plate', 'Slow-cooked pork, rice, beans and salsa verde.', 'gluten-free', 15.25, 'burrito-plate'],
  ['caphilltacos', 'Veggie Taco Trio', 'Roasted sweet potato, black bean and poblano tacos.', 'vegetarian', 12, 'veggie-tacos'],
  ['caphilltacos', 'Chips & Guacamole', 'House-made tortilla chips and fresh guacamole.', 'vegan,gluten-free', 7, 'chips-guac'],
  ['fremontpizza', 'Whole Margherita Pizza (16")', 'San Marzano tomato, fresh mozzarella and basil.', 'vegetarian', 24, 'margherita'],
  ['fremontpizza', 'Pepperoni Slices (2)', 'Two big New York-style slices.', '', 8, 'pepperoni'],
  ['fremontpizza', 'Caesar Salad', 'Romaine, parmesan, croutons and lemon Caesar dressing.', 'vegetarian', 10, 'caesar-salad'],
  ['bellevuecurry', 'Chicken Tikka Masala + Rice', 'Tandoori chicken in creamy tomato masala with basmati rice.', 'gluten-free', 17.5, 'tikka-masala'],
  ['bellevuecurry', 'Chana Masala Bowl', 'Chickpeas simmered with tomato, ginger and spices.', 'vegan,gluten-free', 13, 'chana-masala'],
  ['bellevuecurry', 'Garlic Naan', 'Fresh from the tandoor.', 'vegetarian', 4.5, 'garlic-naan'],
  ['redmondpoke', 'Ahi Poke Bowl (Regular)', 'Ahi tuna, avocado, cucumber and seaweed salad over rice.', 'dairy-free', 16, 'poke-bowl'],
  ['kirklandsushi', "Chef's Nigiri Set (8 pc)", "Chef's selection of seasonal nigiri.", 'gluten-free', 32, 'nigiri'],
  ['kirklandsushi', 'Veggie Roll Combo', 'Avocado, cucumber and sweet potato rolls.', 'vegan', 14, 'veggie-rolls'],
  ['kirklandsushi', 'Miso Soup', 'Tofu, wakame and scallion.', 'vegan', 4, 'miso-soup'],
];

// Offers: [restaurant user, menu item name, reason, note (optional), discount %, qty, starts in (h), window (h)]
const OFFERS = [
  ['harborpho', 'Large Beef Pho', 'wrong_order', 'Customer ordered chicken instead. Broth and noodles packed separately.', 50, 2, 0, 3],
  ['harborpho', 'Lemongrass Tofu Banh Mi', 'delayed_order', 'Freshly made, delivery driver never arrived.', 40, 3, 0, 2],
  ['ballardbread', 'Bakery Surprise Bag', 'end_of_day', '', 65, 6, 1, 3],
  ['ballardbread', 'Seeded Sourdough Loaf', 'overproduction', '', 45, 4, 0, 5],
  ['caphilltacos', 'Carnitas Burrito Plate', 'wrong_order', 'Order was placed twice by mistake.', 55, 1, 0, 2],
  ['caphilltacos', 'Veggie Taco Trio', 'unclaimed_order', '', 40, 2, 0, 4],
  ['fremontpizza', 'Whole Margherita Pizza (16")', 'unclaimed_order', 'Pickup order never collected. Still warm!', 60, 1, 0, 2],
  ['fremontpizza', 'Pepperoni Slices (2)', 'end_of_day', '', 50, 8, 0, 3],
  ['bellevuecurry', 'Chicken Tikka Masala + Rice', 'overproduction', 'Catering overage from a corporate lunch.', 50, 10, 0, 4],
  ['bellevuecurry', 'Chana Masala Bowl', 'delayed_order', '', 45, 2, 0, 3],
  ['redmondpoke', 'Ahi Poke Bowl (Regular)', 'wrong_order', 'Wrong base (white rice instead of brown).', 45, 1, 0, 2],
  ['kirklandsushi', "Chef's Nigiri Set (8 pc)", 'unclaimed_order', 'Prepared for a reservation that did not show.', 40, 2, 0, 3],
  ['kirklandsushi', 'Veggie Roll Combo', 'end_of_day', '', 50, 5, 1, 3],
];

function main() {
  const db = openDatabase(config.databasePath);
  const hash = hashPassword(DEMO_PASSWORD);
  const userId = (email, username, role) => {
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) return existing.id;
    return Number(db.prepare('INSERT INTO users (email, username, password_hash, role) VALUES (?, ?, ?, ?)').run(email, username, hash, role).lastInsertRowid);
  };

  transaction(db, () => {
    userId('demo@bitewise.test', 'demo', 'customer');
    userId('admin@bitewise.test', 'admin', 'admin'); // demo owner account for the admin console
    const ids = {};
    for (const r of RESTAURANTS) {
      const uid = userId(`${r.user}@bitewise.test`, r.user, 'restaurant');
      const existing = db.prepare('SELECT id FROM restaurants WHERE owner_user_id = ?').get(uid);
      ids[r.user] = existing ? existing.id : Number(db.prepare(`
        INSERT INTO restaurants (owner_user_id, name, cuisine, description, address, city, zip, phone, lat, lng, tax_rate_bps)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(uid, r.name, r.cuisine, `Neighborhood ${r.cuisine.toLowerCase()} spot in ${r.city}.`, r.address, r.city, r.zip,
          '(206) 555-01' + String(Object.keys(ids).length).padStart(2, '0'), r.lat, r.lng, r.tax).lastInsertRowid);
    }
    const menuIds = {};
    for (const [user, name, desc, dietary, price, photo] of MENU) {
      const existing = db.prepare('SELECT id FROM menu_items WHERE restaurant_id = ? AND name = ? AND active = 1').get(ids[user], name);
      menuIds[`${user}|${name}`] = existing ? existing.id : Number(db.prepare(`
        INSERT INTO menu_items (restaurant_id, name, description, price_cents, dietary, image_path) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(ids[user], name, desc, Math.round(price * 100), dietary, photoPath(photo)).lastInsertRowid);
    }
    const now = Date.now();
    const hour = 3600 * 1000;
    for (const [user, itemName, reason, note, pct, qty, startIn, windowH] of OFFERS) {
      const item = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(menuIds[`${user}|${itemName}`]);
      const start = new Date(now + startIn * hour - 10 * 60 * 1000);
      const end = new Date(start.getTime() + windowH * hour);
      db.prepare(`INSERT INTO offers (restaurant_id, menu_item_id, image_path, title, description, reason, dietary, original_price_cents,
                  discount_pct, quantity_total, quantity_available, pickup_start, pickup_end) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(ids[user], item.id, item.image_path, item.name, note || item.description, reason, item.dietary, item.price_cents,
          pct, qty, qty, start.toISOString(), end.toISOString());
    }

    REGIONAL.forEach(([user, name, cuisine, address, city, zip], i) => {
      const uid = userId(`${user}@bitewise.test`, user, 'restaurant');
      let rid = db.prepare('SELECT id FROM restaurants WHERE owner_user_id = ?').get(uid)?.id;
      if (!rid) {
        const z = lookupZip(zip);
        // Small, deterministic offset so restaurants in the same ZIP don't share one pin.
        const lat = z.lat + (((i * 37) % 11) - 5) * 0.0012;
        const lng = z.lng + (((i * 53) % 11) - 5) * 0.0016;
        rid = Number(db.prepare(`
          INSERT INTO restaurants (owner_user_id, name, cuisine, description, address, city, zip, phone, lat, lng, tax_rate_bps)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(uid, name, cuisine, `Neighborhood ${cuisine.toLowerCase()} spot in ${city}.`, address, city, zip,
            `(253) 555-${String(1000 + i).slice(-4)}`, lat, lng, config.defaultTaxRateBps).lastInsertRowid);
      }
      ids[user] = rid;
    });
    // One restaurant waiting for approval, to show the admin approval queue.
    db.prepare("UPDATE restaurants SET status = 'pending' WHERE id = ? AND status = 'approved'").run(ids.issaquahbakehouse);
    REGIONAL_MENU.forEach(([user, dish, desc, dietary, price, reason, pct, qty], i) => {
      let item = db.prepare('SELECT * FROM menu_items WHERE restaurant_id = ? AND name = ? AND active = 1').get(ids[user], dish);
      if (!item) {
        const id = db.prepare('INSERT INTO menu_items (restaurant_id, name, description, price_cents, dietary) VALUES (?, ?, ?, ?, ?)')
          .run(ids[user], dish, desc, Math.round(price * 100), dietary).lastInsertRowid;
        item = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(id);
      }
      const start = new Date(now - 10 * 60 * 1000);
      const end = new Date(start.getTime() + (2 + (i % 4)) * hour);
      db.prepare(`INSERT INTO offers (restaurant_id, menu_item_id, image_path, title, description, reason, dietary, original_price_cents,
                  discount_pct, quantity_total, quantity_available, pickup_start, pickup_end) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(ids[user], item.id, item.image_path, item.name, item.description, reason, item.dietary, item.price_cents,
          pct, qty, qty, start.toISOString(), end.toISOString());
    });

    // Two weeks of completed demo orders so the admin dashboard and reports have data.
    const demoId = db.prepare("SELECT id FROM users WHERE username = 'demo'").get().id;
    if (!db.prepare('SELECT 1 FROM orders WHERE user_id = ? AND status = ? LIMIT 1').get(demoId, 'picked_up')) {
      const items = db.prepare(`SELECT m.*, r.tax_rate_bps, (SELECT id FROM offers o WHERE o.menu_item_id = m.id LIMIT 1) AS offer_id
        FROM menu_items m JOIN restaurants r ON r.id = m.restaurant_id WHERE r.status = 'approved'`).all().filter((m) => m.offer_id);
      let seedN = 7;
      const rand = () => { seedN = (seedN * 16807) % 2147483647; return seedN / 2147483647; };
      for (let d = 14; d >= 1; d--) {
        const count = 2 + Math.floor(rand() * 5);
        for (let k = 0; k < count; k++) {
          const m = items[Math.floor(rand() * items.length)];
          const qty = 1 + Math.floor(rand() * 2);
          const pct = [40, 45, 50, 55, 60][Math.floor(rand() * 5)];
          const q = quote({ originalUnitCents: m.price_cents, discountPct: pct, quantity: qty, serviceFeeBps: config.serviceFeeBps, taxRateBps: m.tax_rate_bps });
          const created = new Date(now - d * 86400000 - Math.floor(rand() * 8 + 1) * 3600000);
          const picked = new Date(created.getTime() + (15 + Math.floor(rand() * 60)) * 60000);
          db.prepare(`INSERT INTO orders (user_id, offer_id, restaurant_id, item_title, quantity, unit_price_cents, original_unit_price_cents, discount_pct,
              subtotal_cents, service_fee_cents, service_fee_bps, tax_rate_bps, tax_cents, total_cents, pin, status, payment_ref, card_label, pickup_end, created_at, picked_up_at, closed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'picked_up', ?, 'VISA •••• 4242', ?, ?, ?, ?)`)
            .run(demoId, m.offer_id, m.restaurant_id, m.name, qty, q.unitPriceCents, q.originalUnitCents, pct, q.subtotalCents, q.serviceFeeCents,
              q.serviceFeeBps, q.taxRateBps, q.taxCents, q.totalCents, String(1000 + Math.floor(rand() * 9000)), `pi_mock_demo_${d}_${k}`,
              picked.toISOString(), created.toISOString(), picked.toISOString(), picked.toISOString());
        }
      }
    }

    // Demo payout bank accounts (test routing number 021000021) and some demo platform credit.
    const cipher = createCipher(config);
    for (const r of db.prepare('SELECT id, name FROM restaurants').all()) {
      if (db.prepare('SELECT 1 FROM bank_accounts WHERE restaurant_id = ?').get(r.id)) continue;
      const acct = String(100000000 + r.id * 7919).slice(0, 10);
      db.prepare(`INSERT INTO bank_accounts (restaurant_id, holder_name, bank_name, account_type, routing_enc, account_enc, routing_last4, account_last4)
                  VALUES (?, ?, 'Demo Bank', 'checking', ?, ?, '0021', ?)`).run(r.id, `${r.name} LLC`, cipher.encrypt('021000021'), cipher.encrypt(acct), acct.slice(-4));
    }
    if (!db.prepare('SELECT 1 FROM credit_ledger WHERE user_id = ?').get(demoId)) {
      db.prepare("INSERT INTO credit_ledger (user_id, amount_cents, kind, note) VALUES (?, 1000, 'goodwill', 'Welcome credit (demo)')").run(demoId);
    }

    // Demo accounts have accepted the current terms (recorded like a real sign-up).
    const legal = createLegal(config);
    for (const u of db.prepare('SELECT id, role FROM users').all()) {
      for (const d of legal.required(u.role)) {
        if (!db.prepare('SELECT 1 FROM terms_acceptances WHERE user_id = ? AND document = ? AND version = ?').get(u.id, d.id, d.version)) {
          db.prepare("INSERT INTO terms_acceptances (user_id, document, version, ip, user_agent) VALUES (?, ?, ?, 'seed', 'npm run seed')").run(u.id, d.id, d.version);
        }
      }
    }
  });

  console.log('Seeded demo data.');
  console.log(`  Customer login:   demo / ${DEMO_PASSWORD}`);
  console.log(`  Owner/admin login: admin / ${DEMO_PASSWORD}  (demo only: create your real one with npm run create-admin)`);
  console.log(`  Restaurant logins (password ${DEMO_PASSWORD}):`);
  console.log(`    Seattle/Eastside: ${RESTAURANTS.map((r) => r.user).join(', ')}`);
  console.log(`    Around the region: ${REGIONAL.map((r) => `${r[0]} (${r[4]})`).join(', ')}`);
}

main();
