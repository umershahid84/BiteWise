const express = require('express');
const v = require('../validate');
const { HttpError, bad } = require('../errors');
const { requireRole } = require('../auth');
const { distanceMiles } = require('../geo');
const { transaction } = require('../db');
const { resolveArea } = require('../areas');

const cardLabel = (c) => `${c.brand.toUpperCase()} •••• ${c.last4}`;

module.exports = function customerRoutes({ db, payments, orders, receipts, terms }) {
  const router = express.Router();
  router.use(requireRole('customer'), terms.gate);

  const offerColumns = `
    o.id, o.title, o.image_path, o.description, o.reason, o.dietary, o.original_price_cents, o.discount_pct,
    o.quantity_total, o.quantity_available, o.pickup_start, o.pickup_end,
    r.id AS restaurant_id, r.name AS restaurant_name, r.cuisine, r.address, r.city, r.zip, r.phone, r.lat, r.lng, r.tax_rate_bps`;

  function presentOffer(row, origin) {
    const unit = Math.floor((row.original_price_cents * (100 - row.discount_pct)) / 100 + 0.5);
    const out = {
      id: row.id,
      title: row.title,
      imageUrl: row.image_path || null,
      description: row.description,
      reason: row.reason,
      reasonLabel: v.OFFER_REASONS[row.reason] || 'Other',
      dietary: row.dietary ? row.dietary.split(',') : [],
      originalPriceCents: row.original_price_cents,
      priceCents: unit,
      discountPct: row.discount_pct,
      quantityAvailable: row.quantity_available,
      quantityTotal: row.quantity_total,
      pickupStart: row.pickup_start,
      pickupEnd: row.pickup_end,
      taxRateBps: row.tax_rate_bps,
      restaurant: {
        id: row.restaurant_id, name: row.restaurant_name, cuisine: row.cuisine, address: row.address,
        city: row.city, zip: row.zip, phone: row.phone, lat: row.lat, lng: row.lng,
      },
      distanceMiles: null,
    };
    if (origin && row.lat != null && row.lng != null) {
      out.distanceMiles = Math.round(distanceMiles(origin.lat, origin.lng, row.lat, row.lng) * 10) / 10;
    }
    return out;
  }

  // ---- Offers ----

  router.get('/offers', (req, res) => {
    const lat = v.coord(req.query.lat, 'Latitude', 90);
    const lng = v.coord(req.query.lng, 'Longitude', 180);
    const q = String(req.query.q || '').trim().toLowerCase();
    const area = String(req.query.area || '').trim().toLowerCase();
    // A known city or ZIP ("Tacoma", "98198") searches around that place; the user's own
    // location (lat/lng) is used otherwise.
    const place = area ? resolveArea(area) : null;
    const origin = place ? { lat: place.lat, lng: place.lng } : lat != null && lng != null ? { lat, lng } : null;
    const radius = req.query.radius ? Number(req.query.radius) : place ? 10 : null;
    const dietary = String(req.query.dietary || '').trim().toLowerCase();

    let list = db.prepare(`
      SELECT ${offerColumns} FROM offers o JOIN restaurants r ON r.id = o.restaurant_id
      WHERE o.status = 'active' AND o.quantity_available > 0 AND o.pickup_end > ? AND r.status = 'approved'`)
      .all(new Date().toISOString())
      .map((row) => presentOffer(row, origin));

    if (q) {
      list = list.filter((o) => [o.title, o.description, o.restaurant.name, o.restaurant.cuisine].join(' ').toLowerCase().includes(q));
    }
    if (area && !place) list = list.filter((o) => o.restaurant.city.toLowerCase().includes(area) || o.restaurant.zip.startsWith(area));
    if (dietary) list = list.filter((o) => o.dietary.includes(dietary));
    if (origin && radius > 0) list = list.filter((o) => o.distanceMiles == null || o.distanceMiles <= radius);

    const sorters = {
      distance: (a, b) => (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity),
      discount: (a, b) => b.discountPct - a.discountPct,
      price: (a, b) => a.priceCents - b.priceCents,
      ending: (a, b) => a.pickupEnd.localeCompare(b.pickupEnd),
    };
    const sort = sorters[req.query.sort] ? req.query.sort : origin ? 'distance' : 'ending';
    list.sort(sorters[sort]);
    res.json({ offers: list, sort, origin, place, radius });
  });

  router.get('/offers/:id', (req, res) => {
    const row = db.prepare(`SELECT ${offerColumns}, o.status, r.status AS restaurant_status FROM offers o JOIN restaurants r ON r.id = o.restaurant_id WHERE o.id = ?`)
      .get(Number(req.params.id));
    if (!row || row.restaurant_status !== 'approved') throw new HttpError(404, 'Offer not found.');
    res.json({ offer: presentOffer(row), available: row.status === 'active' && row.pickup_end > new Date().toISOString() });
  });

  router.post('/quote', (req, res) => {
    const quantity = v.int(req.body?.quantity ?? 1, 'Quantity', { min: 1, max: 500 });
    const { quote } = orders.quoteOffer(Number(req.body?.offerId), quantity);
    res.json({ quote });
  });

  // ---- Platform credit ----

  router.get('/credit', (req, res) => {
    res.json({ balanceCents: orders.credits.balance(req.user.id), history: orders.credits.history(req.user.id) });
  });

  // ---- Saved cards ----

  const listCards = db.prepare(`SELECT id, brand, last4, exp_month, exp_year, is_default FROM payment_methods
                                WHERE user_id = ? ORDER BY is_default DESC, created_at DESC`);

  async function ensureCustomer(user) {
    if (user.payment_customer_id) return user.payment_customer_id;
    const id = await payments.ensureCustomer({ email: user.email, username: user.username });
    db.prepare('UPDATE users SET payment_customer_id = ? WHERE id = ?').run(id, user.id);
    user.payment_customer_id = id;
    return id;
  }

  function saveCard(userId, pm, makeDefault) {
    return transaction(db, () => {
      const hasCards = db.prepare('SELECT 1 FROM payment_methods WHERE user_id = ?').get(userId);
      const isDefault = makeDefault || !hasCards;
      if (isDefault) db.prepare('UPDATE payment_methods SET is_default = 0 WHERE user_id = ?').run(userId);
      const { lastInsertRowid } = db.prepare(`INSERT INTO payment_methods (user_id, provider_ref, brand, last4, exp_month, exp_year, is_default)
                                              VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(userId, pm.ref, pm.brand, pm.last4, pm.expMonth, pm.expYear, isDefault ? 1 : 0);
      return Number(lastInsertRowid);
    });
  }

  router.get('/cards', (req, res) => {
    res.json({ cards: listCards.all(req.user.id) });
  });

  router.post('/cards/setup-intent', async (req, res) => {
    const customerId = await ensureCustomer(req.user);
    res.json(await payments.createSetupIntent(customerId));
  });

  router.post('/cards', async (req, res) => {
    const customerId = await ensureCustomer(req.user);
    const pm = await payments.resolvePaymentMethod({ customerId, token: req.body?.token, save: true });
    const id = saveCard(req.user.id, pm, Boolean(req.body?.makeDefault));
    res.status(201).json({ card: listCards.all(req.user.id).find((c) => c.id === id) });
  });

  router.post('/cards/:id/default', (req, res) => {
    const card = db.prepare('SELECT id FROM payment_methods WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id);
    if (!card) throw new HttpError(404, 'Card not found.');
    transaction(db, () => {
      db.prepare('UPDATE payment_methods SET is_default = 0 WHERE user_id = ?').run(req.user.id);
      db.prepare('UPDATE payment_methods SET is_default = 1 WHERE id = ?').run(card.id);
    });
    res.json({ cards: listCards.all(req.user.id) });
  });

  router.delete('/cards/:id', async (req, res) => {
    const card = db.prepare('SELECT * FROM payment_methods WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id);
    if (!card) throw new HttpError(404, 'Card not found.');
    // An existing hold stays capturable after the card is removed, so no need to block on open orders.
    await payments.detach(card.provider_ref);
    transaction(db, () => {
      db.prepare('DELETE FROM payment_methods WHERE id = ?').run(card.id);
      if (card.is_default) {
        db.prepare(`UPDATE payment_methods SET is_default = 1 WHERE id = (
                      SELECT id FROM payment_methods WHERE user_id = ? ORDER BY created_at DESC LIMIT 1)`).run(req.user.id);
      }
    });
    res.json({ cards: listCards.all(req.user.id) });
  });

  // ---- Orders ----

  function presentOrder(o) {
    const r = db.prepare('SELECT name, address, city, zip, phone FROM restaurants WHERE id = ?').get(o.restaurant_id);
    const showPin = o.status === 'reserved';
    return {
      id: o.id,
      status: o.status,
      itemTitle: o.item_title,
      imageUrl: db.prepare('SELECT image_path FROM offers WHERE id = ?').get(o.offer_id)?.image_path || null,
      refundedCents: o.refunded_cents || 0,
      creditedCents: o.credited_cents || 0,
      creditAppliedCents: o.credit_applied_cents || 0,
      quantity: o.quantity,
      unitPriceCents: o.unit_price_cents,
      originalUnitPriceCents: o.original_unit_price_cents,
      discountPct: o.discount_pct,
      subtotalCents: o.subtotal_cents,
      serviceFeeCents: o.service_fee_cents,
      taxRateBps: o.tax_rate_bps,
      taxCents: o.tax_cents,
      totalCents: o.total_cents,
      pin: showPin ? o.pin : null,
      cardLabel: o.card_label,
      pickupEnd: o.pickup_end,
      createdAt: o.created_at,
      pickedUpAt: o.picked_up_at,
      closedAt: o.closed_at,
      restaurant: r,
    };
  }

  router.post('/orders', async (req, res) => {
    const body = req.body || {};
    const offerId = Number(body.offerId);
    const quantity = v.int(body.quantity ?? 1, 'Quantity', { min: 1, max: 500 });
    const { quote: q } = orders.quoteOffer(offerId, quantity); // validate before touching the payment provider
    // Platform credit the customer chose to apply (checked against their balance when reserving).
    const creditCents = body.creditCents ? v.int(Number(body.creditCents), 'Credit', { min: 0, max: q.totalCents }) : 0;
    const needsCard = q.totalCents - creditCents > 0;

    // Resolve which card to use (not needed when credit covers the whole total).
    let paymentRef = null;
    let label = null;
    let attached = false;
    if (needsCard && body.cardId) {
      const card = db.prepare('SELECT * FROM payment_methods WHERE id = ? AND user_id = ?').get(Number(body.cardId), req.user.id);
      if (!card) throw bad('Please choose a card.');
      paymentRef = card.provider_ref;
      label = cardLabel(card);
      attached = true;
    } else if (needsCard && body.newCard?.token) {
      const customerId = await ensureCustomer(req.user);
      const save = Boolean(body.newCard.save);
      const pm = await payments.resolvePaymentMethod({ customerId, token: body.newCard.token, save });
      if (save) saveCard(req.user.id, pm, false);
      paymentRef = pm.ref;
      label = cardLabel(pm);
      attached = save;
    } else if (needsCard) {
      throw bad('Please choose a card.');
    }

    const { order } = orders.reserve({ userId: req.user.id, offerId, quantity, cardLabel: label, creditCents });
    const auth = await orders.authorize(order, { customerId: req.user.payment_customer_id, paymentRef, attached });
    const fresh = orders.getOrder(order.id);
    res.status(201).json({
      order: presentOrder(fresh),
      requiresAction: auth.status === 'requires_action',
      clientSecret: auth.status === 'requires_action' ? auth.clientSecret : undefined,
    });
  });

  function ownOrder(req) {
    const order = orders.getOrder(Number(req.params.id));
    if (!order || order.user_id !== req.user.id) throw new HttpError(404, 'Order not found.');
    return order;
  }

  router.post('/orders/:id/confirm-payment', async (req, res) => {
    const order = await orders.confirmAuthorization(ownOrder(req));
    if (order.status === 'failed') throw new HttpError(402, 'Your card could not be authorized.');
    res.json({ order: presentOrder(order) });
  });

  router.get('/orders', (req, res) => {
    const list = db.prepare(`SELECT * FROM orders WHERE user_id = ? AND status != 'failed' ORDER BY created_at DESC LIMIT 100`).all(req.user.id);
    res.json({ orders: list.map(presentOrder) });
  });

  router.get('/orders/:id', (req, res) => {
    res.json({ order: presentOrder(ownOrder(req)) });
  });

  router.get('/orders/:id/receipt', (req, res) => {
    res.json({ receipt: receipts.receiptData(ownOrder(req)) });
  });

  router.get('/orders/:id/receipt.pdf', async (req, res) => {
    const rc = receipts.receiptData(ownOrder(req));
    const pdf = await receipts.receiptPdf(rc);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${req.query.inline ? 'inline' : 'attachment'}; filename="RescueBites-receipt-${rc.receiptNumber}.pdf"`);
    res.send(pdf);
  });

  router.post('/orders/:id/cancel', async (req, res) => {
    const order = ownOrder(req);
    if (order.status !== 'reserved') throw new HttpError(409, 'Only orders awaiting pickup can be cancelled.');
    await orders.release(order.id, 'reserved', 'cancelled', { restock: true });
    res.json({ order: presentOrder(orders.getOrder(order.id)) });
  });

  return router;
};
