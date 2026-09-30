const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../server/db');
const { createApp } = require('../server/app');
const { createPaymentProvider } = require('../server/payments');

const config = {
  serviceFeeBps: 500, defaultTaxRateBps: 1035, taxServiceFee: false, stripeSecretKey: '', cookieSecure: false,
  sessionDays: 1, pendingPaymentMinutes: 15, pickupGraceMinutes: 30,
};

async function setup() {
  const db = openDatabase(':memory:');
  const payments = createPaymentProvider(config);
  const captured = [];
  const voided = [];
  const capture = payments.capture.bind(payments);
  const voidFn = payments.void.bind(payments);
  payments.capture = (ref) => { captured.push(ref); return capture(ref); };
  payments.void = (ref) => { voided.push(ref); return voidFn(ref); };
  const uploadsDir = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'rb-uploads-'));
  const { app, orders } = createApp({ db, config: { ...config, uploadsDir }, payments });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;

  function client() {
    let cookie = '';
    return async (path, { method = 'GET', body, csrf = true } = {}) => {
      // Sign-ups accept the current terms unless a test says otherwise.
      if (path === '/auth/signup' && body && !('acceptedTerms' in body)) body = { ...body, acceptedTerms: termsFor(body.role) };
      const res = await fetch(base + path, {
        method,
        headers: { 'content-type': 'application/json', cookie, ...(csrf ? { 'x-requested-with': 'Rescue Bites' } : {}) },
        body: body && JSON.stringify(body),
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, body: await res.json() };
    };
  }
  return { db, orders, server, client, captured, voided, base };
}

// 1x1 PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function menuItem(shop, name, price, extra = {}) {
  const r = await shop('/restaurant/menu', { method: 'POST', body: { name, price, ...extra } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.item.id;
}

const { REQUIRED, VERSION } = require('../server/legal/documents');
const termsFor = (role) => Object.fromEntries(REQUIRED[role === 'restaurant' ? 'restaurant' : 'customer'].map((d) => [d, VERSION]));

const card = (last4 = '4242') => ({ brand: 'visa', last4, expMonth: 12, expYear: new Date().getFullYear() + 2 });

test('full flow: sign up, post offer, order, verify PIN, charge at pickup', async (t) => {
  const env = await setup();
  t.after(() => env.server.close());

  const shop = env.client();
  let r = await shop('/auth/signup', { method: 'POST', body: {
    role: 'restaurant', email: 'owner@example.com', username: 'thai_place', password: 'secret123',
    restaurant: { name: 'Thai Place', address: '1 Pine St', city: 'Seattle', zip: '98101' },
  } });
  assert.equal(r.status, 201, JSON.stringify(r.body));

  const start = new Date(Date.now() - 60000).toISOString();
  const end = new Date(Date.now() + 3 * 3600000).toISOString();
  const padThai = await menuItem(shop, 'Pad Thai', '20.00', { dietary: ['spicy'], image: PNG });
  r = await shop('/restaurant/offers', { method: 'POST', body: {
    menuItemId: padThai, reason: 'wrong_order', discountPct: 50, quantity: 3, pickupStart: start, pickupEnd: end,
  } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const offerId = r.body.offer.id;

  const alice = env.client();
  r = await alice('/offers');
  assert.equal(r.status, 401, 'offers require an account');
  r = await alice('/auth/signup', { method: 'POST', body: { email: 'alice@example.com', username: 'alice', password: 'hunter22x' } });
  assert.equal(r.status, 201);

  r = await alice('/auth/signup', { method: 'POST', body: { email: 'ALICE@example.com', username: 'alice2', password: 'hunter22x' } });
  assert.equal(r.status, 409, 'duplicate email rejected');

  r = await alice('/offers');
  assert.equal(r.body.offers.length, 1);
  assert.equal(r.body.offers[0].title, 'Pad Thai');
  assert.equal(r.body.offers[0].priceCents, 1000);
  assert.deepEqual(r.body.offers[0].dietary, ['spicy']);
  assert.match(r.body.offers[0].imageUrl, /^\/uploads\/[0-9a-f]+\.png$/);
  const photo = await fetch(env.base.replace('/api', '') + r.body.offers[0].imageUrl);
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get('content-type'), 'image/png');

  r = await alice('/quote', { method: 'POST', body: { offerId, quantity: 2 } });
  assert.deepEqual(
    [r.body.quote.subtotalCents, r.body.quote.serviceFeeCents, r.body.quote.taxCents, r.body.quote.totalCents],
    [2000, 100, 207, 2307],
  );

  // Order with a new card and save it.
  r = await alice('/orders', { method: 'POST', body: { offerId, quantity: 2, newCard: { token: card(), save: true } } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const order = r.body.order;
  assert.equal(order.status, 'reserved');
  assert.match(order.pin, /^\d{4}$/);
  assert.equal(order.totalCents, 2307);
  assert.equal(env.captured.length, 0, 'not charged at order time');

  r = await alice('/cards');
  assert.equal(r.body.cards.length, 1);
  assert.equal(r.body.cards[0].is_default, 1);

  r = await alice('/offers');
  assert.equal(r.body.offers[0].quantityAvailable, 1);

  // Cannot oversell.
  r = await alice('/orders', { method: 'POST', body: { offerId, quantity: 2, cardId: 1 } });
  assert.equal(r.status, 409);

  // Restaurant verifies PIN; wrong PIN first.
  const wrong = order.pin === '0000' ? '0001' : '0000';
  r = await shop('/restaurant/pickup/lookup', { method: 'POST', body: { pin: wrong } });
  assert.equal(r.status, 404);
  r = await shop('/restaurant/pickup/lookup', { method: 'POST', body: { pin: order.pin } });
  assert.equal(r.status, 200);
  assert.equal(r.body.order.customerUsername, 'alice');

  r = await shop('/restaurant/pickup/confirm', { method: 'POST', body: { pin: order.pin, orderId: order.id } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.order.status, 'picked_up');
  assert.equal(env.captured.length, 1, 'charged at pickup');

  // PIN cannot be reused.
  r = await shop('/restaurant/pickup/confirm', { method: 'POST', body: { pin: order.pin } });
  assert.equal(r.status, 404);

  r = await alice('/orders');
  assert.equal(r.body.orders[0].status, 'picked_up');
  assert.equal(r.body.orders[0].pin, null, 'PIN hidden after pickup');

  r = await shop('/restaurant/stats');
  assert.equal(r.body.allTime.meals, 2);
  assert.equal(r.body.allTime.sales_cents, 2000);
});

test('declined card releases the reserved food', async (t) => {
  const env = await setup();
  t.after(() => env.server.close());
  const shop = env.client();
  await shop('/auth/signup', { method: 'POST', body: {
    role: 'restaurant', email: 'o@example.com', username: 'shop', password: 'secret123',
    restaurant: { name: 'Shop', address: '1 Main', city: 'Bellevue', zip: '98004' },
  } });
  const curry = await menuItem(shop, 'Curry', 10);
  const { body } = await shop('/restaurant/offers', { method: 'POST', body: {
    menuItemId: curry, reason: 'overproduction', discountPct: 40, quantity: 1,
    pickupStart: new Date().toISOString(), pickupEnd: new Date(Date.now() + 3600000).toISOString(),
  } });

  const bob = env.client();
  await bob('/auth/signup', { method: 'POST', body: { email: 'bob@example.com', username: 'bob', password: 'password1' } });
  let r = await bob('/orders', { method: 'POST', body: { offerId: body.offer.id, quantity: 1, newCard: { token: card('0002') } } });
  assert.equal(r.status, 402);
  r = await bob('/offers');
  assert.equal(r.body.offers[0].quantityAvailable, 1);
  r = await bob('/orders');
  assert.equal(r.body.orders.length, 0);
});

test('cancel releases hold; missed pickups expire without charge', async (t) => {
  const env = await setup();
  t.after(() => env.server.close());
  const shop = env.client();
  await shop('/auth/signup', { method: 'POST', body: {
    role: 'restaurant', email: 'o@example.com', username: 'shop', password: 'secret123',
    restaurant: { name: 'Shop', address: '1 Main', city: 'Redmond', zip: '98052' },
  } });
  const poke = await menuItem(shop, 'Poke', 16);
  const { body } = await shop('/restaurant/offers', { method: 'POST', body: {
    menuItemId: poke, reason: 'end_of_day', discountPct: 45, quantity: 5,
    pickupStart: new Date().toISOString(), pickupEnd: new Date(Date.now() + 3600000).toISOString(),
  } });
  const offerId = body.offer.id;

  const c = env.client();
  await c('/auth/signup', { method: 'POST', body: { email: 'c@example.com', username: 'carol', password: 'password1' } });
  await c('/cards', { method: 'POST', body: { token: card() } });
  let r = await c('/orders', { method: 'POST', body: { offerId, quantity: 2, cardId: 1 } });
  const first = r.body.order;
  r = await c(`/orders/${first.id}/cancel`, { method: 'POST' });
  assert.equal(r.body.order.status, 'cancelled');
  assert.equal(env.voided.length, 1);
  r = await c('/offers');
  assert.equal(r.body.offers[0].quantityAvailable, 5, 'cancelled quantity restocked');

  r = await c('/orders', { method: 'POST', body: { offerId, quantity: 1, cardId: 1 } });
  const second = r.body.order;
  await env.orders.sweep(new Date(Date.now() + 2 * 3600000));
  r = await c(`/orders/${second.id}`);
  assert.equal(r.body.order.status, 'expired');
  assert.equal(env.voided.length, 2);
  assert.equal(env.captured.length, 0);
});

test('security: CSRF header required, roles enforced, PIN brute force limited', async (t) => {
  const env = await setup();
  t.after(() => env.server.close());
  const c = env.client();
  let r = await c('/auth/signup', { method: 'POST', csrf: false, body: { email: 'x@example.com', username: 'xx_x', password: 'password1' } });
  assert.equal(r.status, 403);
  r = await c('/auth/signup', { method: 'POST', body: { email: 'x@example.com', username: 'xx_x', password: 'password1' } });
  assert.equal(r.status, 201);
  r = await c('/restaurant/offers');
  assert.equal(r.status, 403);

  const shop = env.client();
  await shop('/auth/signup', { method: 'POST', body: {
    role: 'restaurant', email: 'o@example.com', username: 'shop', password: 'secret123',
    restaurant: { name: 'Shop', address: '1 Main', city: 'Kirkland', zip: '98033' },
  } });
  r = await shop('/offers');
  assert.equal(r.status, 403);
  let last;
  for (let i = 0; i < 16; i++) last = await shop('/restaurant/pickup/lookup', { method: 'POST', body: { pin: String(i).padStart(4, '0') } });
  assert.equal(last.status, 429);
});

test('menu: offers must come from the restaurant\'s own menu; bad photos rejected', async (t) => {
  const env = await setup();
  t.after(() => env.server.close());
  const a = env.client();
  const b = env.client();
  for (const [c, u] of [[a, 'shop_a'], [b, 'shop_b']]) {
    await c('/auth/signup', { method: 'POST', body: {
      role: 'restaurant', email: `${u}@example.com`, username: u, password: 'secret123',
      restaurant: { name: u, address: '1 Main', city: 'Seattle', zip: '98101' },
    } });
  }
  let r = await a('/restaurant/menu', { method: 'POST', body: { name: 'Soup', price: 5, image: 'data:image/png;base64,SGVsbG8=' } });
  assert.equal(r.status, 400, 'non-image bytes rejected');
  const soup = await menuItem(a, 'Soup', 5);
  const times = { pickupStart: new Date().toISOString(), pickupEnd: new Date(Date.now() + 3600000).toISOString() };
  r = await b('/restaurant/offers', { method: 'POST', body: { menuItemId: soup, reason: 'other', discountPct: 30, quantity: 1, ...times } });
  assert.equal(r.status, 404, 'cannot offer another restaurant\'s menu item');
  r = await a('/restaurant/offers', { method: 'POST', body: { reason: 'other', discountPct: 30, quantity: 1, ...times } });
  assert.equal(r.status, 404, 'menu item required');
  r = await a('/restaurant/menu');
  assert.equal(r.body.items.length, 1);
  r = await a(`/restaurant/menu/${soup}`, { method: 'DELETE' });
  assert.equal(r.body.items.length, 0);
});

test('restaurant gets a live event when an order is placed', async (t) => {
  const env = await setup();
  t.after(() => env.server.close());
  const shop = env.client();
  let r = await shop('/auth/signup', { method: 'POST', body: {
    role: 'restaurant', email: 'o@example.com', username: 'shop', password: 'secret123',
    restaurant: { name: 'Shop', address: '1 Main', city: 'Seattle', zip: '98101' },
  } });
  const item = await menuItem(shop, 'Noodles', 12);
  r = await shop('/restaurant/offers', { method: 'POST', body: {
    menuItemId: item, reason: 'other', discountPct: 50, quantity: 2,
    pickupStart: new Date().toISOString(), pickupEnd: new Date(Date.now() + 3600000).toISOString(),
  } });
  const offerId = r.body.offer.id;

  // Open the event stream with the restaurant's session cookie.
  const login = await fetch(`${env.base}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'Rescue Bites' },
    body: JSON.stringify({ login: 'shop', password: 'secret123' }),
  });
  const ctrl = new AbortController();
  const stream = await fetch(`${env.base}/restaurant/events`, { headers: { cookie: login.headers.get('set-cookie').split(';')[0] }, signal: ctrl.signal });
  assert.equal(stream.headers.get('content-type'), 'text/event-stream');
  const reader = stream.body.getReader();
  const received = (async () => {
    let text = '';
    while (!text.includes('event: order')) text += new TextDecoder().decode((await reader.read()).value);
    return text;
  })();

  const c = env.client();
  await c('/auth/signup', { method: 'POST', body: { email: 'c@example.com', username: 'carol', password: 'password1' } });
  r = await c('/orders', { method: 'POST', body: { offerId, quantity: 2, newCard: { token: card() } } });
  assert.equal(r.status, 201);
  const text = await received;
  const data = JSON.parse(text.split('event: order\ndata: ')[1].split('\n')[0]);
  assert.equal(data.itemTitle, 'Noodles');
  assert.equal(data.quantity, 2);
  assert.equal(data.pin, undefined, 'PIN is never sent to the restaurant');
  ctrl.abort();
});

test('receipt shows full order details; restaurant daily report as JSON, PDF and CSV', async (t) => {
  const env = await setup();
  t.after(() => env.server.close());
  const shop = env.client();
  await shop('/auth/signup', { method: 'POST', body: {
    role: 'restaurant', email: 'o@example.com', username: 'shop', password: 'secret123',
    restaurant: { name: 'Pho Place', address: '1 Pine St', city: 'Seattle', zip: '98101', phone: '(206) 555-0199' },
  } });
  const item = await menuItem(shop, 'Beef Pho', '16.00');
  let r = await shop('/restaurant/offers', { method: 'POST', body: {
    menuItemId: item, reason: 'wrong_order', discountPct: 50, quantity: 3,
    pickupStart: new Date().toISOString(), pickupEnd: new Date(Date.now() + 3600000).toISOString(),
  } });
  const offerId = r.body.offer.id;

  const c = env.client();
  await c('/auth/signup', { method: 'POST', body: { email: 'dana@example.com', username: 'dana', password: 'password1' } });
  r = await c('/orders', { method: 'POST', body: { offerId, quantity: 2, newCard: { token: card() } } });
  const order = r.body.order;

  r = await c(`/orders/${order.id}/receipt`);
  const rc = r.body.receipt;
  assert.match(rc.receiptNumber, /^RB-\d{8}-\d{6}$/);
  assert.equal(rc.restaurant.name, 'Pho Place');
  assert.equal(rc.customer.email, 'dana@example.com');
  assert.equal(rc.item.title, 'Beef Pho');
  assert.equal(rc.item.originalUnitCents, 1600);
  assert.equal(rc.item.discountPct, 50);
  assert.equal(rc.item.unitPriceCents, 800);
  assert.equal(rc.item.savingsCents, 1600);
  assert.equal(rc.card, 'VISA •••• 4242');
  assert.match(rc.paymentRef, /^pi_/);
  assert.equal(rc.amountChargedCents, 0, 'not charged before pickup');
  assert.equal(rc.pin, order.pin);

  await shop('/restaurant/pickup/confirm', { method: 'POST', body: { pin: order.pin } });
  r = await c(`/orders/${order.id}/receipt`);
  assert.equal(r.body.receipt.amountChargedCents, order.totalCents);
  assert.equal(r.body.receipt.pin, null);

  const base = env.base;
  const getRaw = async (client, path) => {
    // reuse the client's cookie by calling through it once, then fetch raw bytes
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'Rescue Bites' },
      body: JSON.stringify(client) });
    return fetch(base + path, { headers: { cookie: login.headers.get('set-cookie').split(';')[0] } });
  };
  let res = await getRaw({ login: 'dana', password: 'password1' }, `/orders/${order.id}/receipt.pdf`);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.match(res.headers.get('content-disposition'), /attachment; filename="RescueBites-receipt-RB-/);
  assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');

  res = await getRaw({ login: 'shop', password: 'secret123' }, `/orders/${order.id}/receipt.pdf`);
  assert.equal(res.status, 403, 'restaurants cannot open customer receipts');

  r = await shop('/restaurant/report');
  const rep = r.body.report;
  assert.equal(rep.summary.ordersPickedUp, 1);
  assert.equal(rep.summary.mealsRescued, 2);
  assert.equal(rep.summary.foodSalesCents, 1600);
  assert.equal(rep.summary.discountsCents, 1600);
  assert.equal(rep.orders[0].item, 'Beef Pho');

  res = await getRaw({ login: 'shop', password: 'secret123' }, `/restaurant/report.pdf?date=${rep.date}`);
  assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  res = await getRaw({ login: 'shop', password: 'secret123' }, `/restaurant/report.csv?date=${rep.date}`);
  const csv = await res.text();
  assert.match(csv, /^Order #,Ordered,Picked up,Customer,Item/);
  assert.match(csv, /Beef Pho,2,16\.00,50,8\.00,16\.00/);

  r = await shop('/restaurant/report?date=2020-01-01');
  assert.equal(r.body.report.orders.length, 0);
  r = await shop('/restaurant/report?date=nope');
  assert.equal(r.status, 400);
});

test('dayRange handles Pacific time and DST', () => {
  const { dayRange } = require('../server/receipts');
  assert.deepEqual(dayRange('2026-01-15', 'America/Los_Angeles'), { start: '2026-01-15T08:00:00.000Z', end: '2026-01-16T08:00:00.000Z' });
  assert.deepEqual(dayRange('2026-07-04', 'America/Los_Angeles'), { start: '2026-07-04T07:00:00.000Z', end: '2026-07-05T07:00:00.000Z' });
  assert.deepEqual(dayRange('2026-03-08', 'America/Los_Angeles'), { start: '2026-03-08T08:00:00.000Z', end: '2026-03-09T07:00:00.000Z' });
});

test('quantity is limited only by what the restaurant made available; area search and auto map pins', async (t) => {
  const env = await setup();
  t.after(() => env.server.close());
  const signupShop = async (u, city, zip) => {
    const c = env.client();
    const r = await c('/auth/signup', { method: 'POST', body: {
      role: 'restaurant', email: `${u}@example.com`, username: u, password: 'secret123',
      restaurant: { name: u, address: '1 Main St', city, zip },
    } });
    assert.equal(r.status, 201);
    assert.ok(r.body.user.restaurant.lat, 'pinned from ZIP code');
    return c;
  };
  const tacoma = await signupShop('tacoma_shop', 'Tacoma', '98402');
  const oly = await signupShop('oly_shop', 'Olympia', '98501');
  const times = { pickupStart: new Date().toISOString(), pickupEnd: new Date(Date.now() + 3600000).toISOString() };
  let r = await tacoma('/restaurant/offers', { method: 'POST', body: { menuItemId: await menuItem(tacoma, 'Tacos', 12), reason: 'other', discountPct: 50, quantity: 15, ...times } });
  const tacos = r.body.offer.id;
  await oly('/restaurant/offers', { method: 'POST', body: { menuItemId: await menuItem(oly, 'Pizza', 20), reason: 'other', discountPct: 50, quantity: 2, ...times } });

  const c = env.client();
  await c('/auth/signup', { method: 'POST', body: { email: 'eve@example.com', username: 'eve', password: 'password1' } });

  r = await c('/offers?area=Tacoma');
  assert.equal(r.body.place.label, 'Tacoma, WA');
  assert.deepEqual(r.body.offers.map((o) => o.title), ['Tacos'], 'Olympia is outside 10 miles of Tacoma');
  r = await c('/offers?area=Tacoma&radius=50');
  assert.equal(r.body.offers.length, 2);
  r = await c('/offers?area=98501');
  assert.deepEqual(r.body.offers.map((o) => o.title), ['Pizza']);

  r = await c('/quote', { method: 'POST', body: { offerId: tacos, quantity: 16 } });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /Only 15 available/);
  r = await c('/orders', { method: 'POST', body: { offerId: tacos, quantity: 12, newCard: { token: card() } } });
  assert.equal(r.status, 201, 'more than 10 is fine when the restaurant has them');
  r = await c('/orders', { method: 'POST', body: { offerId: tacos, quantity: 4, newCard: { token: card() } } });
  assert.equal(r.status, 409, 'only 3 left');

  const areas = await (await fetch(`${env.base}/auth/areas`)).json();
  for (const city of ['Des Moines', 'Kent', 'Federal Way', 'Tacoma', 'Fife', 'Olympia']) {
    assert.ok(areas.cities.some((x) => x.name === city), city);
  }
});

test('restaurant sets a discard timer; it can be extended; offer disappears when it runs out', async (t) => {
  const env = await setup();
  t.after(() => env.server.close());
  const shop = env.client();
  await shop('/auth/signup', { method: 'POST', body: {
    role: 'restaurant', email: 'o@example.com', username: 'shop', password: 'secret123',
    restaurant: { name: 'Shop', address: '1 Main St', city: 'Kent', zip: '98032' },
  } });
  const item = await menuItem(shop, 'Teriyaki', 13);
  let r = await shop('/restaurant/offers', { method: 'POST', body: { menuItemId: item, reason: 'overproduction', discountPct: 40, quantity: 3 } });
  assert.equal(r.status, 400, 'timer required');
  r = await shop('/restaurant/offers', { method: 'POST', body: { menuItemId: item, reason: 'overproduction', discountPct: 40, quantity: 3, expiresInMinutes: 2 } });
  assert.equal(r.status, 400, 'at least 5 minutes');

  const before = Date.now();
  r = await shop('/restaurant/offers', { method: 'POST', body: { menuItemId: item, reason: 'overproduction', discountPct: 40, quantity: 3, expiresInMinutes: 90 } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const offer = r.body.offer;
  const mins = (Date.parse(offer.pickup_end) - before) / 60000;
  assert.ok(mins > 89.9 && mins < 90.1, `ends in ~90 min, got ${mins}`);
  assert.ok(Date.parse(offer.pickup_start) <= Date.now(), 'available immediately');

  r = await shop(`/restaurant/offers/${offer.id}/extend`, { method: 'POST', body: { minutes: 30 } });
  assert.equal(Date.parse(r.body.offer.pickup_end) - Date.parse(offer.pickup_end), 30 * 60000);

  // Editing without touching the timer keeps it.
  r = await shop(`/restaurant/offers/${offer.id}`, { method: 'PUT', body: { menuItemId: item, reason: 'overproduction', discountPct: 50, quantity: 3 } });
  assert.equal(r.status, 200);
  assert.equal(Date.parse(r.body.offer.pickup_end) - Date.parse(offer.pickup_end), 30 * 60000);

  const c = env.client();
  await c('/auth/signup', { method: 'POST', body: { email: 'c@example.com', username: 'cust', password: 'password1' } });
  r = await c('/offers');
  assert.equal(r.body.offers.length, 1);

  await env.orders.sweep(new Date(Date.now() + 3 * 3600000));
  r = await c('/offers');
  assert.equal(r.body.offers.length, 0, 'gone after the timer');
  r = await shop(`/restaurant/offers/${offer.id}/extend`, { method: 'POST', body: { minutes: 30 } });
  assert.equal(r.status, 409, 'cannot extend an ended offer');
});

test('sign-up requires accepting the terms; declining creates no account; updated terms must be re-accepted', async (t) => {
  const env = await setup();
  t.after(() => env.server.close());
  const count = () => env.db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const c = env.client();
  const base = { email: 'zoe@example.com', username: 'zoe', password: 'password1' };

  let r = await c('/auth/signup', { method: 'POST', body: { ...base, dryRun: true, acceptedTerms: undefined } });
  assert.equal(r.status, 200, 'form check passes');
  assert.equal(count(), 0, 'form check creates nothing');

  r = await c('/auth/signup', { method: 'POST', body: { ...base, acceptedTerms: null } });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'terms_required');
  assert.match(r.body.error, /Customer Terms of Service and Privacy Policy/);
  assert.equal(count(), 0, 'declined: no account');

  r = await c('/auth/signup', { method: 'POST', body: { ...base, acceptedTerms: { 'customer-terms': '1999-01-01', privacy: VERSION } } });
  assert.equal(r.status, 400, 'old version not accepted');
  r = await c('/auth/signup', { method: 'POST', body: { ...base, role: 'restaurant', acceptedTerms: termsFor('customer'),
    restaurant: { name: 'Zoe Cafe', address: '1 Main St', city: 'Kent', zip: '98032' } } });
  assert.equal(r.status, 400, 'restaurants must accept the Partner Agreement');
  assert.match(r.body.error, /Restaurant Partner Agreement/);
  assert.equal(count(), 0);

  r = await c('/auth/signup', { method: 'POST', body: base });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.user.pendingTerms, []);
  const rows = env.db.prepare('SELECT document, version, ip, user_agent FROM terms_acceptances').all();
  assert.deepEqual(rows.map((x) => x.document).sort(), ['customer-terms', 'privacy']);
  assert.ok(rows.every((x) => x.version === VERSION && x.ip));

  // Simulate a new terms version: the user is blocked until they accept it.
  env.db.prepare("UPDATE terms_acceptances SET version = '2000-01-01'").run();
  r = await c('/offers');
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'terms_required');
  r = await c('/auth/me');
  assert.equal(r.body.user.pendingTerms.length, 2);
  r = await c('/auth/accept-terms', { method: 'POST', body: { acceptedTerms: termsFor('customer') } });
  assert.equal(r.status, 200);
  r = await c('/offers');
  assert.equal(r.status, 200);

  const page = await fetch(env.base.replace('/api', '') + '/legal/restaurant-agreement');
  assert.match(await page.text(), /Restaurant Partner Agreement[\s\S]*Verify the PIN before handing over food/);
});

test('admin console: approvals, suspensions, refunds, payouts, tax, settings and audit log', async (t) => {
  const env = await setup();
  t.after(() => env.server.close());
  const { hashPassword } = require('../server/auth');
  env.db.prepare("INSERT INTO users (email, username, password_hash, role) VALUES ('owner@example.com', 'owner', ?, 'admin')").run(hashPassword('ownerpass1'));
  const admin = env.client();
  let r = await admin('/auth/login', { method: 'POST', body: { login: 'owner', password: 'ownerpass1' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.role, 'admin');

  // Non-admins are locked out; admins cannot be created by sign-up.
  const cust = env.client();
  await cust('/auth/signup', { method: 'POST', body: { email: 'c@example.com', username: 'cust', password: 'password1', role: 'admin' } });
  r = await cust('/auth/me');
  assert.equal(r.body.user.role, 'customer');
  r = await cust('/admin/overview');
  assert.equal(r.status, 403);

  // Approval required: new restaurant's offers stay hidden until approved.
  r = await admin('/admin/settings', { method: 'PUT', body: { requireRestaurantApproval: true, serviceFeePct: 6 } });
  assert.deepEqual(r.body.changed.sort(), ['requireRestaurantApproval', 'serviceFeeBps']);
  const shop = env.client();
  r = await shop('/auth/signup', { method: 'POST', body: { role: 'restaurant', email: 's@example.com', username: 'shop', password: 'secret123',
    restaurant: { name: 'Shop', address: '1 Main St', city: 'Tacoma', zip: '98402' } } });
  assert.equal(r.body.user.restaurant.status, 'pending');
  const item = await menuItem(shop, 'Tacos', 20);
  r = await shop('/restaurant/offers', { method: 'POST', body: { menuItemId: item, reason: 'other', discountPct: 50, quantity: 5, expiresInMinutes: 120 } });
  const offerId = r.body.offer.id;
  r = await cust('/offers');
  assert.equal(r.body.offers.length, 0, 'hidden while pending');
  const rid = (await admin('/admin/restaurants?status=pending')).body.restaurants[0].id;
  await admin(`/admin/restaurants/${rid}/status`, { method: 'POST', body: { status: 'approved' } });
  r = await cust('/offers');
  assert.equal(r.body.offers.length, 1, 'visible after approval');

  // New service fee (6%) applies to quotes.
  r = await cust('/quote', { method: 'POST', body: { offerId, quantity: 2 } });
  assert.equal(r.body.quote.serviceFeeCents, 120);

  // Order, pickup, refund.
  r = await cust('/orders', { method: 'POST', body: { offerId, quantity: 2, newCard: { token: card() } } });
  const order = r.body.order;
  await shop('/restaurant/pickup/confirm', { method: 'POST', body: { pin: order.pin } });
  r = await admin(`/admin/orders/${order.id}/refund`, { method: 'POST', body: { amount: '5.00', reason: 'Missing item' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.order.refundedCents, 500);
  r = await admin(`/admin/orders/${order.id}/refund`, { method: 'POST', body: { amount: '999', reason: 'too much' } });
  assert.equal(r.status, 400, 'cannot refund more than was charged');
  r = await cust(`/orders/${order.id}/receipt`);
  assert.equal(r.body.receipt.refundedCents, 500);

  // Overview and payouts reflect the refund.
  r = await admin('/admin/overview');
  assert.equal(r.body.totals.ordersPickedUp, 1);
  assert.equal(r.body.totals.refundsCents, 500);
  assert.equal(r.body.totals.gmvCents, order.totalCents - 500);
  r = await admin('/admin/payouts');
  const bal = r.body.balances.find((b) => b.restaurantId === rid);
  const foodRefund = Math.round((500 * order.subtotalCents) / order.totalCents);
  assert.equal(bal.earnedCents, order.subtotalCents - foodRefund);
  r = await admin('/admin/payouts', { method: 'POST', body: { restaurantId: rid, amount: '1.00' } });
  assert.equal(r.status, 409, 'bank account required before paying');
  await shop('/restaurant/bank', { method: 'PUT', body: { holderName: 'Shop LLC', bankName: 'Chase', accountType: 'checking',
    routingNumber: '021000021', accountNumber: '000123456789', accountNumberConfirm: '000123456789' } });
  const preview = (await admin(`/admin/payouts/next-invoice?restaurantId=${rid}`)).body;
  assert.match(preview.invoiceNumber, /^INV-\d{8}-000001$/);
  assert.match(preview.bankDetails, /Chase · Checking ••••6789 · Routing ••••0021 · Shop LLC/);
  r = await admin('/admin/payouts', { method: 'POST', body: { restaurantId: rid, amount: (bal.earnedCents / 100).toFixed(2),
    invoiceNumber: 'MINE', reference: 'MINE', bankDetails: 'fake', transactionId: 'fake' } });
  assert.equal(r.status, 201);
  assert.equal(r.body.invoiceNumber, preview.invoiceNumber, 'system-assigned invoice number, client value ignored');
  assert.equal(r.body.transactionId, preview.transactionId);
  assert.equal(r.body.bankDetails, preview.bankDetails);
  const hist = (await admin('/admin/payouts')).body.history[0];
  assert.deepEqual([hist.reference, hist.transaction_id, hist.bank_details], [preview.invoiceNumber, preview.transactionId, preview.bankDetails]);
  r = await shop('/restaurant/payouts');
  assert.equal(r.body.history[0].invoice_number, preview.invoiceNumber);
  assert.equal(r.body.balanceCents, 0);
  r = await admin('/admin/payouts');
  assert.equal(r.body.balances.find((b) => b.restaurantId === rid).balanceCents, 0);

  r = await admin('/admin/tax');
  assert.equal(r.body.rows[0].city, 'Tacoma');
  assert.ok(r.body.totals.taxCents > 0);

  // Suspensions.
  const custId = env.db.prepare("SELECT id FROM users WHERE username = 'cust'").get().id;
  await admin(`/admin/users/${custId}/status`, { method: 'POST', body: { status: 'suspended' } });
  r = await cust('/offers');
  assert.equal(r.status, 401, 'suspended user signed out');
  r = await cust('/auth/login', { method: 'POST', body: { login: 'cust', password: 'password1' } });
  assert.equal(r.status, 403);
  await admin(`/admin/restaurants/${rid}/status`, { method: 'POST', body: { status: 'suspended', note: 'Health permit expired' } });
  r = await shop('/restaurant/offers', { method: 'POST', body: { menuItemId: item, reason: 'other', discountPct: 50, quantity: 5, expiresInMinutes: 60 } });
  assert.equal(r.status, 403, 'suspended restaurant cannot post');

  r = await admin('/admin/audit');
  const actions = r.body.entries.map((e) => e.action);
  for (const a of ['settings.update', 'restaurant.approved', 'order.refund', 'payout.record', 'user.suspended', 'restaurant.suspended']) assert.ok(actions.includes(a), a);
});

test('refund methods, platform credit, and restaurant bank accounts', async (t) => {
  const env = await setup();
  t.after(() => env.server.close());
  const { hashPassword } = require('../server/auth');
  env.db.prepare("INSERT INTO users (email, username, password_hash, role) VALUES ('o@x.com', 'owner', ?, 'admin')").run(hashPassword('ownerpass1'));
  const admin = env.client();
  await admin('/auth/login', { method: 'POST', body: { login: 'owner', password: 'ownerpass1' } });
  const shop = env.client();
  await shop('/auth/signup', { method: 'POST', body: { role: 'restaurant', email: 's@x.com', username: 'shop', password: 'secret123',
    restaurant: { name: 'Shop', address: '1 Main St', city: 'Kent', zip: '98032' } } });
  const rid = env.db.prepare('SELECT id FROM restaurants').get().id;
  const item = await menuItem(shop, 'Bowl', 20);
  const offerId = (await shop('/restaurant/offers', { method: 'POST', body: { menuItemId: item, reason: 'other', discountPct: 50, quantity: 20, expiresInMinutes: 120 } })).body.offer.id;
  const c = env.client();
  await c('/auth/signup', { method: 'POST', body: { email: 'c@x.com', username: 'cust', password: 'password1' } });
  const custId = env.db.prepare("SELECT id FROM users WHERE username = 'cust'").get().id;
  const pickup = async (pin) => shop('/restaurant/pickup/confirm', { method: 'POST', body: { pin } });
  const earned = async () => (await admin('/admin/payouts')).body.balances.find((b) => b.restaurantId === rid)?.earnedCents || 0;

  // 1) Card order, refunded 50% as PLATFORM CREDIT: customer gets credit, restaurant keeps full sale.
  let r = await c('/orders', { method: 'POST', body: { offerId, quantity: 2, newCard: { token: card(), save: true } } });
  const o1 = r.body.order;
  await pickup(o1.pin);
  const fullEarn = await earned();
  assert.equal(fullEarn, o1.subtotalCents);
  r = await admin(`/admin/orders/${o1.id}/refund`, { method: 'POST', body: { percent: 50, method: 'credit', reason: 'Late pickup goodwill' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const credit1 = Math.round(o1.totalCents / 2);
  assert.equal(r.body.order.creditedCents, credit1);
  assert.equal((await c('/credit')).body.balanceCents, credit1);
  assert.equal((await c('/auth/me')).body.user.creditCents, credit1, 'balance visible to the customer');
  assert.equal(await earned(), fullEarn, 'credit refund does not reduce restaurant earnings');
  assert.equal(env.captured.length, 1);

  // 2) Refund the rest to the ORIGINAL card: restaurant loses that share.
  r = await admin(`/admin/orders/${o1.id}/refund`, { method: 'POST', body: { percent: 100, method: 'original', reason: 'Wrong item' } });
  const cardBack = o1.totalCents - credit1;
  assert.equal(r.body.order.cardRefundedCents, cardBack);
  assert.equal(await earned(), fullEarn - Math.round((cardBack * o1.subtotalCents) / o1.totalCents));
  r = await admin(`/admin/orders/${o1.id}/refund`, { method: 'POST', body: { amount: '1', reason: 'again' } });
  assert.equal(r.status, 409, 'nothing left to refund');
  r = await c(`/orders/${o1.id}/receipt`);
  assert.equal(r.body.receipt.refunds.length, 2);
  assert.match(r.body.receipt.refunds[0].to, /platform credit/);
  assert.match(r.body.receipt.refunds[1].to, /VISA •••• 4242/);

  // 3) Use part of the credit on a new order; the card is charged the rest. Cancel returns the credit.
  r = await c('/orders', { method: 'POST', body: { offerId, quantity: 1, creditCents: 500, cardId: 1 } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const o2 = r.body.order;
  assert.equal(o2.creditAppliedCents, 500);
  assert.equal((await c('/credit')).body.balanceCents, credit1 - 500);
  await c(`/orders/${o2.id}/cancel`, { method: 'POST' });
  assert.equal((await c('/credit')).body.balanceCents, credit1, 'credit restored on cancel');

  // 4) Too much credit / tiny card remainder are rejected.
  r = await c('/orders', { method: 'POST', body: { offerId, quantity: 1, creditCents: credit1 + 1, cardId: 1 } });
  assert.ok([400, 409].includes(r.status));
  const q = (await c('/quote', { method: 'POST', body: { offerId, quantity: 1 } })).body.quote;
  env.db.prepare("INSERT INTO credit_ledger (user_id, amount_cents, kind) VALUES (?, 5000, 'goodwill')").run(custId);
  r = await c('/orders', { method: 'POST', body: { offerId, quantity: 1, creditCents: q.totalCents - 10, cardId: 1 } });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /at least \$0\.50/);

  // 5) Order paid entirely with credit: no card needed, nothing captured; restaurant still earns the full subtotal.
  const captures = env.captured.length;
  r = await c('/orders', { method: 'POST', body: { offerId, quantity: 1, creditCents: q.totalCents } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const o3 = r.body.order;
  assert.equal(o3.cardLabel, 'Platform credit');
  const beforeEarn = await earned();
  await pickup(o3.pin);
  assert.equal(env.captured.length, captures, 'no card capture');
  assert.equal(await earned(), beforeEarn + o3.subtotalCents);
  // Refund to original payment = back to credit, and the restaurant loses the sale.
  const bal = (await c('/credit')).body.balanceCents;
  r = await admin(`/admin/orders/${o3.id}/refund`, { method: 'POST', body: { percent: 100, method: 'original', reason: 'Spoiled' } });
  assert.equal(r.body.order.cardRefundedCents, 0);
  assert.equal((await c('/credit')).body.balanceCents, bal + o3.totalCents);
  assert.equal(await earned(), beforeEarn);

  // 6) Goodwill credit from the owner.
  r = await admin(`/admin/users/${custId}/credit`, { method: 'POST', body: { amount: '7.50', reason: 'Sorry for the wait' } });
  assert.equal(r.body.balanceCents, bal + o3.totalCents + 750);

  // 7) Bank account: validation, masking, owner-only reveal (audited).
  r = await shop('/restaurant/bank', { method: 'PUT', body: { holderName: 'Shop LLC', bankName: 'Chase', routingNumber: '123456789', accountNumber: '12345678', accountNumberConfirm: '12345678' } });
  assert.equal(r.status, 400, 'bad routing checksum');
  r = await shop('/restaurant/bank', { method: 'PUT', body: { holderName: 'Shop LLC', bankName: 'Chase', routingNumber: '021000021', accountNumber: '12345678', accountNumberConfirm: '12345679' } });
  assert.equal(r.status, 400, 'confirmation mismatch');
  r = await shop('/restaurant/bank', { method: 'PUT', body: { holderName: 'Shop LLC', bankName: 'Chase', accountType: 'savings', routingNumber: '021000021', accountNumber: '12345678', accountNumberConfirm: '12345678' } });
  assert.deepEqual([r.body.bank.accountLast4, r.body.bank.routingLast4, r.body.bank.accountNumber], ['5678', '0021', undefined]);
  const stored = env.db.prepare('SELECT * FROM bank_accounts').get();
  assert.ok(!JSON.stringify(stored).includes('12345678'), 'stored encrypted');
  r = await c(`/admin/restaurants/${rid}/bank`);
  assert.equal(r.status, 403);
  r = await admin(`/admin/restaurants/${rid}/bank`);
  assert.equal(r.body.bank.accountNumber, '12345678');
  assert.ok((await admin('/admin/audit')).body.entries.some((e) => e.action === 'bank.reveal'));
});
