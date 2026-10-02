const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('customer', 'restaurant', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  payment_customer_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS restaurants (
  id INTEGER PRIMARY KEY,
  owner_user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cuisine TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  zip TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  lat REAL,
  lng REAL,
  tax_rate_bps INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'suspended')),
  admin_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS payment_methods (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_ref TEXT NOT NULL,
  brand TEXT NOT NULL,
  last4 TEXT NOT NULL,
  exp_month INTEGER NOT NULL,
  exp_year INTEGER NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL CHECK (price_cents > 0),
  dietary TEXT NOT NULL DEFAULT '',
  image_path TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  menu_item_id INTEGER REFERENCES menu_items(id),
  image_path TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL,
  dietary TEXT NOT NULL DEFAULT '',
  original_price_cents INTEGER NOT NULL CHECK (original_price_cents > 0),
  discount_pct INTEGER NOT NULL CHECK (discount_pct BETWEEN 1 AND 90),
  quantity_total INTEGER NOT NULL CHECK (quantity_total > 0),
  quantity_available INTEGER NOT NULL CHECK (quantity_available >= 0),
  pickup_start TEXT NOT NULL,
  pickup_end TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  offer_id INTEGER NOT NULL REFERENCES offers(id),
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
  item_title TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  original_unit_price_cents INTEGER NOT NULL,
  discount_pct INTEGER NOT NULL,
  subtotal_cents INTEGER NOT NULL,
  service_fee_cents INTEGER NOT NULL,
  service_fee_bps INTEGER,
  tax_rate_bps INTEGER NOT NULL,
  tax_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  pin TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending_payment', 'reserved', 'picked_up', 'cancelled', 'expired', 'failed')),
  payment_ref TEXT,
  card_label TEXT NOT NULL DEFAULT '',
  pickup_end TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  picked_up_at TEXT,
  closed_at TEXT,
  refunded_cents INTEGER NOT NULL DEFAULT 0,
  refunded_at TEXT,
  refund_reason TEXT NOT NULL DEFAULT '',
  credit_applied_cents INTEGER NOT NULL DEFAULT 0,
  card_refunded_cents INTEGER NOT NULL DEFAULT 0,
  credited_cents INTEGER NOT NULL DEFAULT 0
);

-- Refunds: 'original' = back to how the customer paid (card and/or credit they used);
-- 'credit' = Bite Wise platform credit (funded by Bite Wise; the restaurant keeps its money).
CREATE TABLE IF NOT EXISTS refunds (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  method TEXT NOT NULL CHECK (method IN ('original', 'credit')),
  card_cents INTEGER NOT NULL DEFAULT 0,
  credit_cents INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  provider_ref TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Platform credit ledger. Balance = SUM(amount_cents). Positive = issued/restored, negative = used.
CREATE TABLE IF NOT EXISTS credit_ledger (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount_cents INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('refund', 'goodwill', 'redeem', 'restore', 'adjustment')),
  order_id INTEGER REFERENCES orders(id),
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Restaurant payout bank account. Routing/account numbers are encrypted (AES-256-GCM).
CREATE TABLE IF NOT EXISTS bank_accounts (
  restaurant_id INTEGER PRIMARY KEY REFERENCES restaurants(id) ON DELETE CASCADE,
  holder_name TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('checking', 'savings')),
  routing_enc TEXT NOT NULL,
  account_enc TEXT NOT NULL,
  routing_last4 TEXT NOT NULL,
  account_last4 TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payouts (
  id INTEGER PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  reference TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  paid_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by INTEGER REFERENCES users(id),
  bank_details TEXT NOT NULL DEFAULT '',
  transaction_id TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  admin_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id INTEGER,
  details TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS terms_acceptances (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document TEXT NOT NULL,
  version TEXT NOT NULL,
  accepted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ip TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payouts_invoice ON payouts(reference) WHERE reference LIKE 'INV-%';
CREATE INDEX IF NOT EXISTS idx_credit_user ON credit_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_refunds_order ON refunds(order_id);
CREATE INDEX IF NOT EXISTS idx_terms_user ON terms_acceptances(user_id, document, version);

CREATE INDEX IF NOT EXISTS idx_offers_status ON offers(status, pickup_end);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_restaurant ON orders(restaurant_id, status);
CREATE INDEX IF NOT EXISTS idx_pm_user ON payment_methods(user_id);
CREATE INDEX IF NOT EXISTS idx_menu_restaurant ON menu_items(restaurant_id, active);
`;

function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

// Adds columns introduced after a database was first created.
function migrate(db) {
  const has = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  // Older databases: allow the 'admin' role and add account status (SQLite can't alter a CHECK,
  // so the users table is rebuilt with the same data).
  const usersSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()?.sql || '';
  if (!usersSql.includes("'admin'")) {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      db.exec(`CREATE TABLE users_new (
        id INTEGER PRIMARY KEY,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('customer', 'restaurant', 'admin')),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
        payment_customer_id TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )`);
      db.exec(`INSERT INTO users_new (id, email, username, password_hash, role, payment_customer_id, created_at)
               SELECT id, email, username, password_hash, role, payment_customer_id, created_at FROM users`);
      db.exec('DROP TABLE users');
      db.exec('ALTER TABLE users_new RENAME TO users');
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }
  if (!has('restaurants', 'status')) {
    db.exec("ALTER TABLE restaurants ADD COLUMN status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'suspended'))");
    db.exec("ALTER TABLE restaurants ADD COLUMN admin_note TEXT NOT NULL DEFAULT ''");
  }
  for (const col of ['credit_applied_cents', 'card_refunded_cents', 'credited_cents']) {
    if (has('orders', 'refunded_cents') && !has('orders', col)) db.exec(`ALTER TABLE orders ADD COLUMN ${col} INTEGER NOT NULL DEFAULT 0`);
  }
  if (has('orders', 'refunded_cents') && has('orders', 'card_refunded_cents')) {
    // Refunds made before refund methods existed went to the card.
    db.exec('UPDATE orders SET card_refunded_cents = refunded_cents WHERE card_refunded_cents = 0 AND refunded_cents > 0');
  }
  for (const col of ['bank_details', 'transaction_id']) {
    if (!has('payouts', col)) db.exec(`ALTER TABLE payouts ADD COLUMN ${col} TEXT NOT NULL DEFAULT ''`);
  }
  if (!has('orders', 'refunded_cents')) {
    db.exec('ALTER TABLE orders ADD COLUMN refunded_cents INTEGER NOT NULL DEFAULT 0');
    db.exec('ALTER TABLE orders ADD COLUMN refunded_at TEXT');
    db.exec("ALTER TABLE orders ADD COLUMN refund_reason TEXT NOT NULL DEFAULT ''");
    for (const col of ['credit_applied_cents', 'card_refunded_cents', 'credited_cents']) db.exec(`ALTER TABLE orders ADD COLUMN ${col} INTEGER NOT NULL DEFAULT 0`);
  }
  if (!has('offers', 'menu_item_id')) db.exec('ALTER TABLE offers ADD COLUMN menu_item_id INTEGER REFERENCES menu_items(id)');
  // Service fee rate charged on the order (older orders leave it NULL).
  if (!has('orders', 'service_fee_bps')) db.exec('ALTER TABLE orders ADD COLUMN service_fee_bps INTEGER');
  if (!has('offers', 'image_path')) db.exec('ALTER TABLE offers ADD COLUMN image_path TEXT');
}

// Runs fn inside a transaction; rolls back if it throws.
function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { openDatabase, transaction };
