const express = require('express');
const v = require('../validate');
const { HttpError, bad } = require('../errors');
const { requireRole, createLimiter } = require('../auth');
const { lookupZip } = require('../areas');
const { validRouting } = require('../secure');

module.exports = function restaurantRoutes({ db, orders, images, receipts, terms, cipher }) {
  const router = express.Router();
  router.use(requireRole('restaurant'), terms.gate);

  // 4-digit PINs are guessable by brute force, so cap failed lookups per restaurant.
  const pinLimiter = createLimiter({ max: 15, windowMs: 10 * 60 * 1000 });

  router.use((req, _res, next) => {
    req.restaurant = db.prepare('SELECT * FROM restaurants WHERE owner_user_id = ?').get(req.user.id);
    if (!req.restaurant) return next(new HttpError(404, 'Restaurant profile not found.'));
    next();
  });

  // ---- Profile ----

  router.get('/profile', (req, res) => res.json({ restaurant: req.restaurant }));

  router.put('/profile', (req, res) => {
    const b = req.body || {};
    const r = {
      name: v.str(b.name, 'Restaurant name', { min: 2, max: 80 }),
      description: v.str(b.description, 'Description', { max: 400, optional: true }),
      cuisine: v.str(b.cuisine, 'Cuisine', { max: 40, optional: true }),
      address: v.str(b.address, 'Street address', { min: 3, max: 120 }),
      city: v.str(b.city, 'City', { min: 2, max: 60 }),
      zip: v.zip(b.zip),
      phone: v.str(b.phone, 'Phone', { max: 30, optional: true }),
      lat: v.coord(b.lat, 'Latitude', 90),
      lng: v.coord(b.lng, 'Longitude', 180),
      taxRateBps: Math.round(Number(b.taxRatePct) * 100),
    };
    if (!(r.taxRateBps >= 0 && r.taxRateBps <= 2000)) throw bad('Sales tax rate must be between 0% and 20%.');
    const z = lookupZip(r.zip);
    if ((r.lat == null || r.lng == null) && z) Object.assign(r, { lat: z.lat, lng: z.lng });
    db.prepare(`UPDATE restaurants SET name = ?, description = ?, cuisine = ?, address = ?, city = ?, zip = ?, phone = ?,
                lat = ?, lng = ?, tax_rate_bps = ? WHERE id = ?`)
      .run(r.name, r.description, r.cuisine, r.address, r.city, r.zip, r.phone, r.lat, r.lng, r.taxRateBps, req.restaurant.id);
    res.json({ restaurant: db.prepare('SELECT * FROM restaurants WHERE id = ?').get(req.restaurant.id) });
  });

  // ---- Menu ----

  const listMenu = db.prepare('SELECT * FROM menu_items WHERE restaurant_id = ? AND active = 1 ORDER BY name COLLATE NOCASE');

  function parseMenuItem(b) {
    return {
      name: v.str(b.name, 'Item name', { min: 2, max: 80 }),
      description: v.str(b.description, 'Description', { max: 500, optional: true }),
      priceCents: v.dollarsToCents(b.price, 'Menu price', { min: 0.5, max: 1000 }),
      dietary: v.dietary(b.dietary),
    };
  }

  function ownMenuItem(req, id = req.params.id) {
    const item = db.prepare('SELECT * FROM menu_items WHERE id = ? AND restaurant_id = ? AND active = 1').get(Number(id), req.restaurant.id);
    if (!item) throw new HttpError(404, 'Menu item not found.');
    return item;
  }

  router.get('/menu', (req, res) => res.json({ items: listMenu.all(req.restaurant.id) }));

  router.post('/menu', (req, res) => {
    const m = parseMenuItem(req.body || {});
    const image = req.body?.image ? images.saveDataUrl(req.body.image) : null;
    const { lastInsertRowid } = db.prepare(`INSERT INTO menu_items (restaurant_id, name, description, price_cents, dietary, image_path)
                                            VALUES (?, ?, ?, ?, ?, ?)`)
      .run(req.restaurant.id, m.name, m.description, m.priceCents, m.dietary, image);
    res.status(201).json({ item: db.prepare('SELECT * FROM menu_items WHERE id = ?').get(lastInsertRowid) });
  });

  router.put('/menu/:id', (req, res) => {
    const item = ownMenuItem(req);
    const m = parseMenuItem(req.body || {});
    // Old photos are kept on disk because existing offers and orders may still show them.
    const image = req.body?.image ? images.saveDataUrl(req.body.image) : req.body?.removeImage ? null : item.image_path;
    db.prepare('UPDATE menu_items SET name = ?, description = ?, price_cents = ?, dietary = ?, image_path = ? WHERE id = ?')
      .run(m.name, m.description, m.priceCents, m.dietary, image, item.id);
    res.json({ item: db.prepare('SELECT * FROM menu_items WHERE id = ?').get(item.id) });
  });

  router.delete('/menu/:id', (req, res) => {
    const item = ownMenuItem(req);
    db.prepare('UPDATE menu_items SET active = 0 WHERE id = ?').run(item.id);
    res.json({ items: listMenu.all(req.restaurant.id) });
  });

  // ---- Offers ----

  const MIN_TIMER = 5;
  const MAX_TIMER = 72 * 60;

  // An offer is a discounted menu item: name, menu price, dietary tags and photo come from the menu.
  function parseOffer(req, existing) {
    const b = req.body || {};
    const item = ownMenuItem(req, b.menuItemId);
    // Discard timer: the offer is available now and expires after N minutes, when the restaurant
    // discards whatever is left. (An exact pickupStart/pickupEnd is also accepted.)
    let pickupStart;
    let pickupEnd;
    const now = new Date();
    if (b.expiresInMinutes !== undefined && b.expiresInMinutes !== null && b.expiresInMinutes !== '') {
      const minutes = v.int(Number(b.expiresInMinutes), 'Discard timer (minutes)', { min: MIN_TIMER, max: MAX_TIMER });
      pickupStart = existing && new Date(existing.pickup_start) < now ? new Date(existing.pickup_start) : now;
      pickupEnd = new Date(now.getTime() + minutes * 60000);
    } else if (b.pickupEnd) {
      pickupStart = b.pickupStart ? v.isoDate(b.pickupStart, 'Pickup start') : now;
      pickupEnd = v.isoDate(b.pickupEnd, 'Pickup end');
    } else if (existing) {
      pickupStart = new Date(existing.pickup_start);
      pickupEnd = new Date(existing.pickup_end);
    } else {
      throw bad('Please set the discard timer.');
    }
    if (pickupEnd <= pickupStart) throw bad('The timer must end after pickup starts.');
    if (!existing && pickupEnd <= now) throw bad('The timer must end in the future.');
    if (pickupEnd - now > MAX_TIMER * 60000) throw bad('The timer can be at most 3 days.');
    const reason = String(b.reason || '');
    if (!v.OFFER_REASONS[reason]) throw bad('Please choose why this food is available.');
    return {
      menuItemId: item.id,
      imagePath: item.image_path,
      title: item.name,
      description: v.str(b.description, 'Description', { max: 500, optional: true }) || item.description,
      reason,
      dietary: item.dietary,
      originalPriceCents: item.price_cents,
      discountPct: v.int(Number(b.discountPct), 'Discount', { min: 1, max: 90 }),
      quantityTotal: v.int(Number(b.quantity), 'Quantity', { min: 1, max: 500 }),
      pickupStart: pickupStart.toISOString(),
      pickupEnd: pickupEnd.toISOString(),
    };
  }

  function ownOffer(req) {
    const offer = db.prepare('SELECT * FROM offers WHERE id = ? AND restaurant_id = ?').get(Number(req.params.id), req.restaurant.id);
    if (!offer) throw new HttpError(404, 'Offer not found.');
    return offer;
  }

  const offerStats = `
    (SELECT COUNT(*) FROM orders x WHERE x.offer_id = o.id AND x.status = 'reserved') AS awaiting_pickup,
    (SELECT COALESCE(SUM(quantity), 0) FROM orders x WHERE x.offer_id = o.id AND x.status = 'picked_up') AS picked_up`;

  router.get('/offers', (req, res) => {
    const offers = db.prepare(`SELECT o.*, ${offerStats} FROM offers o WHERE o.restaurant_id = ?
                               ORDER BY CASE o.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, o.pickup_end DESC LIMIT 200`)
      .all(req.restaurant.id);
    res.json({ offers });
  });

  const notSuspended = (req) => {
    if (req.restaurant.status === 'suspended') {
      throw new HttpError(403, 'Your restaurant is suspended, so you cannot post offers. Please contact Rescue Bites support.');
    }
  };

  router.post('/offers', (req, res) => {
    notSuspended(req);
    const o = parseOffer(req);
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO offers (restaurant_id, menu_item_id, image_path, title, description, reason, dietary, original_price_cents, discount_pct,
                          quantity_total, quantity_available, pickup_start, pickup_end)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(req.restaurant.id, o.menuItemId, o.imagePath, o.title, o.description, o.reason, o.dietary, o.originalPriceCents, o.discountPct,
        o.quantityTotal, o.quantityTotal, o.pickupStart, o.pickupEnd);
    res.status(201).json({ offer: db.prepare('SELECT * FROM offers WHERE id = ?').get(lastInsertRowid) });
  });

  router.put('/offers/:id', (req, res) => {
    const existing = ownOffer(req);
    if (existing.status === 'ended') throw new HttpError(409, 'Ended offers cannot be edited.');
    const o = parseOffer(req, existing);
    // Price changes only affect new orders; existing orders keep the price they were quoted.
    const committed = existing.quantity_total - existing.quantity_available;
    if (o.quantityTotal < committed) throw bad(`${committed} already ordered, so quantity cannot be lower than that.`);
    db.prepare(`UPDATE offers SET menu_item_id = ?, image_path = ?, title = ?, description = ?, reason = ?, dietary = ?, original_price_cents = ?, discount_pct = ?,
                quantity_total = ?, quantity_available = ?, pickup_start = ?, pickup_end = ? WHERE id = ?`)
      .run(o.menuItemId, o.imagePath, o.title, o.description, o.reason, o.dietary, o.originalPriceCents, o.discountPct, o.quantityTotal,
        o.quantityTotal - committed, o.pickupStart, o.pickupEnd, existing.id);
    db.prepare(`UPDATE orders SET pickup_end = ? WHERE offer_id = ? AND status IN ('pending_payment', 'reserved')`).run(o.pickupEnd, existing.id);
    res.json({ offer: db.prepare('SELECT * FROM offers WHERE id = ?').get(existing.id) });
  });

  // Adds time to a running discard timer (e.g. "+30 min").
  router.post('/offers/:id/extend', (req, res) => {
    const existing = ownOffer(req);
    if (existing.status === 'ended') throw new HttpError(409, 'This offer has already ended. Post it again to restart the timer.');
    const minutes = v.int(Number(req.body?.minutes), 'Minutes', { min: 5, max: 12 * 60 });
    const base = Math.max(Date.now(), Date.parse(existing.pickup_end));
    const end = new Date(base + minutes * 60000);
    if (end - Date.now() > MAX_TIMER * 60000) throw bad('The timer can be at most 3 days.');
    db.prepare('UPDATE offers SET pickup_end = ? WHERE id = ?').run(end.toISOString(), existing.id);
    db.prepare(`UPDATE orders SET pickup_end = ? WHERE offer_id = ? AND status IN ('pending_payment', 'reserved')`).run(end.toISOString(), existing.id);
    res.json({ offer: db.prepare('SELECT * FROM offers WHERE id = ?').get(existing.id) });
  });

  router.post('/offers/:id/status', (req, res) => {
    const existing = ownOffer(req);
    const status = req.body?.status;
    if (!['active', 'paused', 'ended'].includes(status)) throw bad('Invalid status.');
    if (existing.status === 'ended') throw new HttpError(409, 'This offer has already ended.');
    if (status === 'active' && existing.pickup_end <= new Date().toISOString()) throw bad('The pickup window has passed. Create a new offer.');
    if (status === 'active') notSuspended(req);
    db.prepare('UPDATE offers SET status = ? WHERE id = ?').run(status, existing.id);
    res.json({ offer: db.prepare('SELECT * FROM offers WHERE id = ?').get(existing.id) });
  });

  // ---- Orders & pickup ----

  function presentOrder(o, { withPin = false } = {}) {
    const customer = db.prepare('SELECT username FROM users WHERE id = ?').get(o.user_id);
    return {
      id: o.id,
      imageUrl: db.prepare('SELECT image_path FROM offers WHERE id = ?').get(o.offer_id)?.image_path || null,
      status: o.status,
      itemTitle: o.item_title,
      quantity: o.quantity,
      unitPriceCents: o.unit_price_cents,
      subtotalCents: o.subtotal_cents,
      serviceFeeCents: o.service_fee_cents,
      taxCents: o.tax_cents,
      totalCents: o.total_cents,
      customerUsername: customer?.username,
      pickupEnd: o.pickup_end,
      createdAt: o.created_at,
      pickedUpAt: o.picked_up_at,
      pin: withPin ? o.pin : undefined,
    };
  }

  router.get('/orders', (req, res) => {
    const status = String(req.query.status || '');
    const rows = status
      ? db.prepare('SELECT * FROM orders WHERE restaurant_id = ? AND status = ? ORDER BY created_at DESC LIMIT 200').all(req.restaurant.id, status)
      : db.prepare(`SELECT * FROM orders WHERE restaurant_id = ? AND status NOT IN ('pending_payment', 'failed')
                    ORDER BY created_at DESC LIMIT 200`).all(req.restaurant.id);
    res.json({ orders: rows.map((o) => presentOrder(o)) });
  });

  function findByPin(req) {
    const key = String(req.restaurant.id);
    if (!pinLimiter.check(key)) throw new HttpError(429, 'Too many incorrect PINs. Please wait 10 minutes.');
    const pin = String(req.body?.pin || '').trim();
    if (!/^\d{4}$/.test(pin)) throw bad('Enter the 4-digit PIN.');
    const order = db.prepare(`SELECT * FROM orders WHERE restaurant_id = ? AND pin = ? AND status = 'reserved'`).get(req.restaurant.id, pin);
    if (!order) {
      pinLimiter.fail(key);
      throw new HttpError(404, 'No order awaiting pickup matches that PIN.');
    }
    return order;
  }

  router.post('/pickup/lookup', (req, res) => {
    res.json({ order: presentOrder(findByPin(req)) });
  });

  router.post('/pickup/confirm', async (req, res) => {
    const order = findByPin(req);
    if (req.body?.orderId && Number(req.body.orderId) !== order.id) throw new HttpError(409, 'PIN does not match this order.');
    const done = await orders.completePickup(order);
    res.json({ order: presentOrder(done) });
  });

  // Live stream of new orders (Server-Sent Events) so the portal can ring a bell.
  router.get('/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 5000\n\n');
    const restaurantId = req.restaurant.id;
    const onReserved = (order) => {
      if (order.restaurant_id === restaurantId) res.write(`event: order\ndata: ${JSON.stringify(presentOrder(order))}\n\n`);
    };
    orders.events.on('reserved', onReserved);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      orders.events.off('reserved', onReserved);
    });
  });

  // ---- Payout bank account & payouts ----

  const maskedBank = (b) => (b ? { holderName: b.holder_name, bankName: b.bank_name, accountType: b.account_type,
    routingLast4: b.routing_last4, accountLast4: b.account_last4, updatedAt: b.updated_at } : null);

  router.get('/bank', (req, res) => {
    res.json({ bank: maskedBank(db.prepare('SELECT * FROM bank_accounts WHERE restaurant_id = ?').get(req.restaurant.id)) });
  });

  router.put('/bank', (req, res) => {
    const b = req.body || {};
    const holder = v.str(b.holderName, 'Account holder name', { min: 2, max: 100 });
    const bankName = v.str(b.bankName, 'Bank name', { min: 2, max: 80 });
    const type = b.accountType === 'savings' ? 'savings' : 'checking';
    const routing = String(b.routingNumber || '').replace(/\D/g, '');
    const account = String(b.accountNumber || '').replace(/\D/g, '');
    if (!validRouting(routing)) throw bad('Please enter a valid 9-digit ABA routing number.');
    if (!/^\d{4,17}$/.test(account)) throw bad('Account number must be 4 to 17 digits.');
    if (String(b.accountNumberConfirm || '').replace(/\D/g, '') !== account) throw bad('The account numbers do not match.');
    db.prepare(`INSERT INTO bank_accounts (restaurant_id, holder_name, bank_name, account_type, routing_enc, account_enc, routing_last4, account_last4, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(restaurant_id) DO UPDATE SET holder_name = excluded.holder_name, bank_name = excluded.bank_name,
                  account_type = excluded.account_type, routing_enc = excluded.routing_enc, account_enc = excluded.account_enc,
                  routing_last4 = excluded.routing_last4, account_last4 = excluded.account_last4, updated_at = excluded.updated_at`)
      .run(req.restaurant.id, holder, bankName, type, cipher.encrypt(routing), cipher.encrypt(account), routing.slice(-4), account.slice(-4), new Date().toISOString());
    res.json({ bank: maskedBank(db.prepare('SELECT * FROM bank_accounts WHERE restaurant_id = ?').get(req.restaurant.id)) });
  });

  router.get('/payouts', (req, res) => {
    const id = req.restaurant.id;
    let earned = 0;
    for (const o of db.prepare("SELECT subtotal_cents, total_cents, refunded_cents FROM orders WHERE restaurant_id = ? AND status = 'picked_up'").all(id)) {
      // Refunds to the customer's original payment reduce earnings; platform-credit refunds don't.
      earned += o.subtotal_cents - (o.refunded_cents && o.total_cents ? Math.round((o.refunded_cents * o.subtotal_cents) / o.total_cents) : 0);
    }
    const history = db.prepare(`SELECT reference AS invoice_number, amount_cents, bank_details, transaction_id, paid_at FROM payouts
      WHERE restaurant_id = ? ORDER BY paid_at DESC`).all(id);
    const paid = history.reduce((n, p) => n + p.amount_cents, 0);
    res.json({ earnedCents: earned, paidCents: paid, balanceCents: earned - paid, history });
  });

  // ---- Daily report ----

  function reportDate(req) {
    const date = String(req.query.date || receipts.todayIn());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw bad('Please choose a valid date.');
    return date;
  }

  router.get('/report', (req, res) => {
    res.json({ report: receipts.reportData(req.restaurant.id, reportDate(req)) });
  });

  router.get('/report.csv', (req, res) => {
    const rep = receipts.reportData(req.restaurant.id, reportDate(req));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="RescueBites-report-${rep.date}.csv"`);
    res.send(receipts.reportCsv(rep));
  });

  router.get('/report.pdf', async (req, res) => {
    const rep = receipts.reportData(req.restaurant.id, reportDate(req));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${req.query.inline ? 'inline' : 'attachment'}; filename="RescueBites-report-${rep.date}.pdf"`);
    res.send(await receipts.reportPdf(rep));
  });

  router.get('/stats', (req, res) => {
    const id = req.restaurant.id;
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const agg = (where, ...args) => db.prepare(`
      SELECT COUNT(*) AS orders, COALESCE(SUM(quantity), 0) AS meals, COALESCE(SUM(subtotal_cents), 0) AS sales_cents,
             COALESCE(SUM((original_unit_price_cents - unit_price_cents) * quantity), 0) AS customer_savings_cents
      FROM orders WHERE restaurant_id = ? AND ${where}`).get(id, ...args);
    res.json({
      today: agg(`status = 'picked_up' AND picked_up_at >= ?`, since.toISOString()),
      allTime: agg(`status = 'picked_up'`),
      awaitingPickup: db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE restaurant_id = ? AND status = 'reserved'`).get(id).n,
      activeOffers: db.prepare(`SELECT COUNT(*) AS n FROM offers WHERE restaurant_id = ? AND status = 'active'`).get(id).n,
    });
  });

  return router;
};
