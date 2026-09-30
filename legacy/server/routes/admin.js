// Owner / admin console API. Every route requires an admin account.
const express = require('express');
const v = require('../validate');
const { HttpError, bad } = require('../errors');
const { requireRole } = require('../auth');
const { dayRange } = require('../receipts');
const { transaction } = require('../db');

const csvEscape = (x) => (/[",\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : String(x));
const toCsv = (rows) => `${rows.map((r) => r.map(csvEscape).join(',')).join('\n')}\n`;
const dollars = (c) => (c / 100).toFixed(2);

// refunded_cents = refunds to the customer's ORIGINAL payment (card and/or credit they used): the refunded
// share comes out of the restaurant's food sales and Rescue Bites' fee. Refunds issued as PLATFORM CREDIT
// (credited_cents) are funded by Rescue Bites; the restaurant keeps its full food sales.
// Portion of an original-payment refund that comes out of the restaurant's food sales (the rest is fee and tax).
const foodRefund = (o) => (o.refunded_cents && o.total_cents ? Math.round((o.refunded_cents * o.subtotal_cents) / o.total_cents) : 0);
const feeRefund = (o) => (o.refunded_cents && o.total_cents ? Math.round((o.refunded_cents * o.service_fee_cents) / o.total_cents) : 0);
const taxRefund = (o) => (o.refunded_cents && o.total_cents ? o.refunded_cents - foodRefund(o) - feeRefund(o) : 0);

module.exports = function adminRoutes({ db, config, payments, orders, receipts, settings, cipher }) {
  const { credits } = orders;
  const router = express.Router();
  router.use(requireRole('admin'));
  const timeZone = config.timeZone || 'America/Los_Angeles';

  const audit = (req, action, targetType, targetId, details = '') => {
    db.prepare('INSERT INTO audit_log (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)')
      .run(req.user.id, action, targetType, targetId ?? null, String(details).slice(0, 500));
  };

  const dayKey = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

  // Date range from ?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive), default: last `days` days.
  function range(req, days = 30) {
    const valid = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
    const today = receipts.todayIn();
    const to = req.query.to ? String(req.query.to) : today;
    const from = req.query.from ? String(req.query.from) : dayKey(new Date(Date.parse(`${to}T12:00:00Z`) - (days - 1) * 86400000).toISOString());
    if (!valid(from) || !valid(to) || from > to) throw bad('Please choose a valid date range.');
    return { from, to, start: dayRange(from, timeZone).start, end: dayRange(to, timeZone).end };
  }

  // ---------- Overview ----------
  router.get('/overview', (req, res) => {
    const r = range(req);
    const sold = db.prepare(`SELECT * FROM orders WHERE status = 'picked_up' AND picked_up_at >= ? AND picked_up_at < ?`).all(r.start, r.end);
    const placed = db.prepare(`SELECT status, COUNT(*) AS n FROM orders WHERE created_at >= ? AND created_at < ? AND status != 'failed' GROUP BY status`).all(r.start, r.end);
    const sum = (f) => sold.reduce((n, o) => n + f(o), 0);
    const byStatus = Object.fromEntries(placed.map((x) => [x.status, x.n]));

    const days = [];
    for (let t = Date.parse(`${r.from}T12:00:00Z`); t <= Date.parse(`${r.to}T12:00:00Z`); t += 86400000) days.push(new Date(t).toISOString().slice(0, 10));
    const daily = Object.fromEntries(days.map((d) => [d, { date: d, orders: 0, meals: 0, gmvCents: 0, feesCents: 0, foodCents: 0 }]));
    for (const o of sold) {
      const d = daily[dayKey(o.picked_up_at)];
      if (!d) continue;
      d.orders += 1;
      d.meals += o.quantity;
      d.gmvCents += o.total_cents - o.refunded_cents;
      d.feesCents += o.service_fee_cents - feeRefund(o);
      d.foodCents += o.subtotal_cents - foodRefund(o);
    }

    const top = db.prepare(`
      SELECT r.id, r.name, r.city, COUNT(o.id) AS orders, COALESCE(SUM(o.subtotal_cents), 0) AS food_cents, COALESCE(SUM(o.quantity), 0) AS meals
      FROM orders o JOIN restaurants r ON r.id = o.restaurant_id
      WHERE o.status = 'picked_up' AND o.picked_up_at >= ? AND o.picked_up_at < ?
      GROUP BY r.id ORDER BY food_cents DESC LIMIT 5`).all(r.start, r.end);
    const count = (sql, ...a) => db.prepare(sql).get(...a).n;

    res.json({
      range: { from: r.from, to: r.to },
      totals: {
        gmvCents: sum((o) => o.total_cents - o.refunded_cents),
        serviceFeesCents: sum((o) => o.service_fee_cents - feeRefund(o)),
        foodSalesCents: sum((o) => o.subtotal_cents - foodRefund(o)),
        salesTaxCents: sum((o) => o.tax_cents - taxRefund(o)),
        refundsCents: sum((o) => o.refunded_cents),
        creditRefundsCents: sum((o) => o.credited_cents),
        cardChargedCents: sum((o) => o.total_cents - o.credit_applied_cents - o.card_refunded_cents),
        creditRedeemedCents: sum((o) => o.credit_applied_cents),
        discountsCents: sum((o) => (o.original_unit_price_cents - o.unit_price_cents) * o.quantity),
        ordersPickedUp: sold.length,
        mealsRescued: sum((o) => o.quantity),
        placed: byStatus,
      },
      now: {
        customers: count("SELECT COUNT(*) AS n FROM users WHERE role = 'customer'"),
        restaurants: Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS n FROM restaurants GROUP BY status').all().map((x) => [x.status, x.n])),
        activeOffers: count("SELECT COUNT(*) AS n FROM offers WHERE status = 'active' AND pickup_end > ?", new Date().toISOString()),
        awaitingPickup: count("SELECT COUNT(*) AS n FROM orders WHERE status = 'reserved'"),
        payoutsOwedCents: payoutRows().reduce((n, p) => n + Math.max(0, p.balanceCents), 0),
        creditOutstandingCents: db.prepare('SELECT COALESCE(SUM(amount_cents), 0) AS n FROM credit_ledger').get().n,
      },
      daily: Object.values(daily),
      topRestaurants: top,
    });
  });

  // ---------- Restaurants ----------
  router.get('/restaurants', (req, res) => {
    const status = String(req.query.status || '');
    const q = `%${String(req.query.q || '').trim()}%`;
    const rows = db.prepare(`
      SELECT r.id, r.name, r.cuisine, r.address, r.city, r.zip, r.phone, r.status, r.admin_note, r.tax_rate_bps, r.created_at,
             u.id AS owner_id, u.email AS owner_email, u.username AS owner_username, u.status AS owner_status,
             (SELECT COUNT(*) FROM offers x WHERE x.restaurant_id = r.id AND x.status = 'active' AND x.pickup_end > ?) AS active_offers,
             (SELECT COUNT(*) FROM orders x WHERE x.restaurant_id = r.id AND x.status = 'picked_up') AS orders,
             (SELECT COALESCE(SUM(subtotal_cents), 0) FROM orders x WHERE x.restaurant_id = r.id AND x.status = 'picked_up') AS food_cents
      FROM restaurants r JOIN users u ON u.id = r.owner_user_id
      WHERE (? = '' OR r.status = ?) AND (r.name LIKE ? OR r.city LIKE ? OR r.zip LIKE ? OR u.email LIKE ?)
      ORDER BY CASE r.status WHEN 'pending' THEN 0 WHEN 'suspended' THEN 1 ELSE 2 END, r.created_at DESC`)
      .all(new Date().toISOString(), status, status, q, q, q, q);
    res.json({ restaurants: rows });
  });

  router.post('/restaurants/:id/status', (req, res) => {
    const r = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(Number(req.params.id));
    if (!r) throw new HttpError(404, 'Restaurant not found.');
    const status = String(req.body?.status || '');
    if (!['approved', 'suspended', 'pending'].includes(status)) throw bad('Invalid status.');
    const note = v.str(req.body?.note, 'Note', { max: 300, optional: true });
    db.prepare('UPDATE restaurants SET status = ?, admin_note = ? WHERE id = ?').run(status, note, r.id);
    audit(req, `restaurant.${status}`, 'restaurant', r.id, `${r.name}${note ? `: ${note}` : ''}`);
    res.json({ ok: true });
  });

  // ---------- Users ----------
  router.get('/users', (req, res) => {
    const role = ['customer', 'restaurant', 'admin'].includes(req.query.role) ? req.query.role : 'customer';
    const q = `%${String(req.query.q || '').trim()}%`;
    const rows = db.prepare(`
      SELECT u.id, u.email, u.username, u.role, u.status, u.created_at,
             (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND o.status = 'picked_up') AS orders,
             (SELECT COALESCE(SUM(total_cents - refunded_cents), 0) FROM orders o WHERE o.user_id = u.id AND o.status = 'picked_up') AS spent_cents,
             (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND o.status = 'expired') AS no_shows,
             (SELECT COALESCE(SUM(amount_cents), 0) FROM credit_ledger c WHERE c.user_id = u.id) AS credit_cents,
             (SELECT MAX(accepted_at) FROM terms_acceptances t WHERE t.user_id = u.id) AS terms_accepted_at
      FROM users u WHERE u.role = ? AND (u.email LIKE ? OR u.username LIKE ?)
      ORDER BY u.created_at DESC LIMIT 500`).all(role, q, q);
    res.json({ users: rows });
  });

  router.post('/users/:id/status', (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
    if (!u) throw new HttpError(404, 'User not found.');
    if (u.id === req.user.id) throw bad('You cannot suspend your own account.');
    const status = req.body?.status === 'suspended' ? 'suspended' : 'active';
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, u.id);
    if (status === 'suspended') db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    audit(req, `user.${status}`, 'user', u.id, `${u.username} (${u.role})`);
    res.json({ ok: true });
  });

  // Goodwill platform credit (funded by Rescue Bites).
  router.post('/users/:id/credit', (req, res) => {
    const u = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'customer'").get(Number(req.params.id));
    if (!u) throw new HttpError(404, 'Customer not found.');
    const amount = v.dollarsToCents(req.body?.amount, 'Credit amount', { min: 0.01, max: 1000 });
    const reason = v.str(req.body?.reason, 'Reason', { min: 3, max: 300 });
    credits.add(u.id, amount, 'goodwill', { note: reason, by: req.user.id });
    audit(req, 'credit.issue', 'user', u.id, `${u.username}: $${dollars(amount)} - ${reason}`);
    res.json({ balanceCents: credits.balance(u.id) });
  });

  // ---------- Orders ----------
  function presentOrder(o) {
    return {
      id: o.id, status: o.status, itemTitle: o.item_title, quantity: o.quantity, customer: o.username, customerEmail: o.email,
      restaurant: o.restaurant_name, restaurantId: o.restaurant_id, unitPriceCents: o.unit_price_cents,
      originalUnitPriceCents: o.original_unit_price_cents, discountPct: o.discount_pct, subtotalCents: o.subtotal_cents,
      serviceFeeCents: o.service_fee_cents, taxCents: o.tax_cents, totalCents: o.total_cents, refundedCents: o.refunded_cents,
      creditedCents: o.credited_cents, creditAppliedCents: o.credit_applied_cents, cardRefundedCents: o.card_refunded_cents,
      refundableCents: o.total_cents - o.refunded_cents - o.credited_cents,
      cardRefundableCents: o.payment_ref ? o.total_cents - o.credit_applied_cents - o.card_refunded_cents : 0,
      refundReason: o.refund_reason, card: o.card_label, paymentRef: o.payment_ref, createdAt: o.created_at, pickedUpAt: o.picked_up_at,
      pickupEnd: o.pickup_end,
    };
  }
  const orderQuery = `SELECT o.*, u.username, u.email, r.name AS restaurant_name FROM orders o
    JOIN users u ON u.id = o.user_id JOIN restaurants r ON r.id = o.restaurant_id`;

  router.get('/orders', (req, res) => {
    const r = range(req, 30);
    const status = String(req.query.status || '');
    const q = String(req.query.q || '').trim();
    const like = `%${q}%`;
    const rows = db.prepare(`${orderQuery}
      WHERE o.created_at >= ? AND o.created_at < ? AND o.status != 'failed' AND (? = '' OR o.status = ?)
        AND (? = '' OR u.username LIKE ? OR u.email LIKE ? OR r.name LIKE ? OR o.item_title LIKE ? OR CAST(o.id AS TEXT) = ?)
      ORDER BY o.created_at DESC LIMIT 500`).all(r.start, r.end, status, status, q, like, like, like, like, q);
    res.json({ orders: rows.map(presentOrder), range: { from: r.from, to: r.to } });
  });

  function getOrder(req) {
    const o = db.prepare(`${orderQuery} WHERE o.id = ?`).get(Number(req.params.id));
    if (!o) throw new HttpError(404, 'Order not found.');
    return o;
  }

  router.post('/orders/:id/cancel', async (req, res) => {
    const o = getOrder(req);
    if (!['reserved', 'pending_payment'].includes(o.status)) throw new HttpError(409, 'Only orders awaiting pickup can be cancelled.');
    await orders.release(o.id, o.status, 'cancelled', { restock: true });
    audit(req, 'order.cancel', 'order', o.id, v.str(req.body?.reason, 'Reason', { max: 300, optional: true }));
    res.json({ order: presentOrder(getOrder(req)) });
  });

  // Refund a completed order, by amount or percentage, either to the ORIGINAL payment method (card first,
  // then any platform credit the customer used) or as PLATFORM CREDIT.
  router.post('/orders/:id/refund', async (req, res) => {
    const o = getOrder(req);
    if (o.status !== 'picked_up') throw new HttpError(409, 'Only completed (charged) orders can be refunded. Cancel open orders instead.');
    const refundable = o.total_cents - o.refunded_cents - o.credited_cents;
    if (refundable <= 0) throw new HttpError(409, 'This order has already been fully refunded.');
    const b = req.body || {};
    let amount;
    if (b.percent !== undefined && b.percent !== '' && b.percent !== null) {
      const pct = v.int(Number(b.percent), 'Percentage', { min: 1, max: 100 });
      amount = Math.max(1, Math.round((refundable * pct) / 100));
    } else {
      amount = v.dollarsToCents(b.amount, 'Refund amount', { min: 0.01, max: refundable / 100 });
    }
    const method = b.method === 'credit' ? 'credit' : 'original';
    const reason = v.str(b.reason, 'Reason', { min: 3, max: 300 });

    let cardCents = 0;
    let creditCents = 0;
    let providerRef = null;
    if (method === 'credit') {
      creditCents = amount;
    } else {
      const cardRefundable = o.payment_ref ? o.total_cents - o.credit_applied_cents - o.card_refunded_cents : 0;
      cardCents = Math.min(amount, cardRefundable);
      creditCents = amount - cardCents; // back to the credit balance they paid with
      if (cardCents > 0) providerRef = (await payments.refund(o.payment_ref, cardCents))?.id || null;
    }
    transaction(db, () => {
      if (creditCents > 0) {
        credits.add(o.user_id, creditCents, method === 'credit' ? 'refund' : 'restore', { orderId: o.id, note: reason, by: req.user.id });
      }
      db.prepare(`UPDATE orders SET refunded_cents = refunded_cents + ?, card_refunded_cents = card_refunded_cents + ?,
                  credited_cents = credited_cents + ?, refunded_at = ?, refund_reason = ? WHERE id = ?`)
        .run(method === 'original' ? amount : 0, cardCents, method === 'credit' ? amount : 0, new Date().toISOString(), reason, o.id);
      db.prepare(`INSERT INTO refunds (order_id, amount_cents, method, card_cents, credit_cents, reason, provider_ref, created_by)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(o.id, amount, method, cardCents, creditCents, reason, providerRef, req.user.id);
    });
    audit(req, method === 'credit' ? 'order.refund_credit' : 'order.refund', 'order', o.id,
      `$${dollars(amount)} to ${method === 'credit' ? 'platform credit' : [cardCents && `card $${dollars(cardCents)}`, creditCents && `credit $${dollars(creditCents)}`].filter(Boolean).join(' + ')} - ${reason}`);
    res.json({ order: presentOrder(getOrder(req)) });
  });

  router.get('/orders/:id/refunds', (req, res) => {
    const o = getOrder(req);
    res.json({ refunds: db.prepare(`SELECT f.*, u.username AS by_name FROM refunds f LEFT JOIN users u ON u.id = f.created_by
      WHERE f.order_id = ? ORDER BY f.id`).all(o.id) });
  });

  router.get('/orders/:id/receipt.pdf', async (req, res) => {
    const rc = receipts.receiptData(getOrder(req));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="RescueBites-receipt-${rc.receiptNumber}.pdf"`);
    res.send(await receipts.receiptPdf(rc));
  });

  // ---------- Offers (moderation) ----------
  router.get('/offers', (req, res) => {
    const rows = db.prepare(`
      SELECT o.id, o.title, o.description, o.reason, o.discount_pct, o.original_price_cents, o.quantity_available, o.quantity_total,
             o.pickup_end, o.status, o.image_path, r.id AS restaurant_id, r.name AS restaurant_name, r.city, r.status AS restaurant_status
      FROM offers o JOIN restaurants r ON r.id = o.restaurant_id
      WHERE o.status != 'ended' AND o.pickup_end > ? ORDER BY o.pickup_end`).all(new Date().toISOString());
    res.json({ offers: rows });
  });

  router.post('/offers/:id/end', (req, res) => {
    const o = db.prepare('SELECT o.*, r.name AS restaurant_name FROM offers o JOIN restaurants r ON r.id = o.restaurant_id WHERE o.id = ?').get(Number(req.params.id));
    if (!o) throw new HttpError(404, 'Offer not found.');
    db.prepare("UPDATE offers SET status = 'ended' WHERE id = ?").run(o.id);
    audit(req, 'offer.remove', 'offer', o.id, `${o.title} (${o.restaurant_name})${req.body?.reason ? `: ${String(req.body.reason).slice(0, 200)}` : ''}`);
    res.json({ ok: true });
  });

  // ---------- Payouts ----------
  // Restaurants earn the food subtotal of completed orders (less the food share of refunds).
  // Until Stripe Connect payouts are built, the owner pays restaurants and records it here.
  function payoutRows() {
    const earned = new Map();
    for (const o of db.prepare("SELECT restaurant_id, subtotal_cents, service_fee_cents, total_cents, refunded_cents FROM orders WHERE status = 'picked_up'").all()) {
      const e = earned.get(o.restaurant_id) || { earned: 0, orders: 0 };
      e.earned += o.subtotal_cents - foodRefund(o);
      e.orders += 1;
      earned.set(o.restaurant_id, e);
    }
    const paid = new Map(db.prepare('SELECT restaurant_id, SUM(amount_cents) AS paid, MAX(paid_at) AS last FROM payouts GROUP BY restaurant_id').all()
      .map((p) => [p.restaurant_id, p]));
    return db.prepare('SELECT r.id, r.name, r.city, r.status, u.email FROM restaurants r JOIN users u ON u.id = r.owner_user_id ORDER BY r.name').all()
      .map((r) => {
        const e = earned.get(r.id) || { earned: 0, orders: 0 };
        const p = paid.get(r.id) || { paid: 0, last: null };
        return { restaurantId: r.id, name: r.name, city: r.city, email: r.email, status: r.status, orders: e.orders,
          earnedCents: e.earned, paidCents: p.paid || 0, balanceCents: e.earned - (p.paid || 0), lastPaidAt: p.last };
      })
      .filter((x) => x.earnedCents || x.paidCents);
  }

  // Invoice numbers, bank details and transaction IDs are assigned by the system and can't be edited.
  const pad = (n, w) => String(n).padStart(w, '0');
  const invoiceNumber = (id, at = new Date()) => `INV-${dayKey(at.toISOString()).replace(/-/g, '')}-${pad(id, 6)}`;
  const transactionId = (id, restaurantId) => `TXN-${pad(id, 6)}-${pad(restaurantId, 4)}`;
  const nextPayoutId = () => (db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM payouts').get().n);
  const bankRow = (restaurantId) => db.prepare('SELECT * FROM bank_accounts WHERE restaurant_id = ?').get(restaurantId);
  const bankSummary = (b) => (b ? `${b.bank_name} · ${b.account_type === 'savings' ? 'Savings' : 'Checking'} ••••${b.account_last4} · Routing ••••${b.routing_last4} · ${b.holder_name}` : null);

  router.get('/payouts/next-invoice', (req, res) => {
    const r = db.prepare('SELECT id FROM restaurants WHERE id = ?').get(Number(req.query.restaurantId));
    if (!r) throw new HttpError(404, 'Restaurant not found.');
    const id = nextPayoutId();
    res.json({ invoiceNumber: invoiceNumber(id), transactionId: transactionId(id, r.id), bankDetails: bankSummary(bankRow(r.id)) });
  });

  // Full bank numbers, for sending the transfer. Every view is recorded in the audit log.
  router.get('/restaurants/:id/bank', (req, res) => {
    const r = db.prepare('SELECT id, name FROM restaurants WHERE id = ?').get(Number(req.params.id));
    const b = r && bankRow(r.id);
    if (!b) throw new HttpError(404, 'No bank account on file for this restaurant.');
    audit(req, 'bank.reveal', 'restaurant', r.id, r.name);
    res.json({ bank: { holderName: b.holder_name, bankName: b.bank_name, accountType: b.account_type,
      routingNumber: cipher.decrypt(b.routing_enc), accountNumber: cipher.decrypt(b.account_enc), updatedAt: b.updated_at } });
  });

  router.get('/payouts', (req, res) => {
    const history = db.prepare(`SELECT p.*, r.name AS restaurant_name, u.username AS created_by_name FROM payouts p
      JOIN restaurants r ON r.id = p.restaurant_id LEFT JOIN users u ON u.id = p.created_by ORDER BY p.paid_at DESC LIMIT 200`).all();
    res.json({ balances: payoutRows().map((x) => ({ ...x, bankDetails: bankSummary(bankRow(x.restaurantId)) })), history });
  });

  router.post('/payouts', (req, res) => {
    const r = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(Number(req.body?.restaurantId));
    if (!r) throw new HttpError(404, 'Restaurant not found.');
    const bank = bankSummary(bankRow(r.id));
    if (!bank) throw new HttpError(409, 'This restaurant has no payout bank account on file. Ask them to add it in their portal (Payouts tab).');
    const amount = v.dollarsToCents(req.body?.amount, 'Amount', { min: 0.01, max: 1000000 });
    const note = v.str(req.body?.note, 'Note', { max: 300, optional: true });
    // Any invoice number or bank details sent by the client are ignored.
    const saved = transaction(db, () => {
      const { lastInsertRowid } = db.prepare('INSERT INTO payouts (restaurant_id, amount_cents, note, created_by) VALUES (?, ?, ?, ?)')
        .run(r.id, amount, note, req.user.id);
      const id = Number(lastInsertRowid);
      const out = { invoiceNumber: invoiceNumber(id), transactionId: transactionId(id, r.id), bankDetails: bank };
      db.prepare('UPDATE payouts SET reference = ?, transaction_id = ?, bank_details = ? WHERE id = ?').run(out.invoiceNumber, out.transactionId, bank, id);
      return out;
    });
    audit(req, 'payout.record', 'restaurant', r.id, `${r.name}: $${dollars(amount)} (${saved.invoiceNumber}, ${saved.transactionId})`);
    res.status(201).json({ ok: true, ...saved });
  });

  router.get('/payouts.csv', (req, res) => {
    const rows = payoutRows();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="RescueBites-payouts.csv"');
    const history = db.prepare(`SELECT p.*, r.name AS restaurant_name FROM payouts p JOIN restaurants r ON r.id = p.restaurant_id ORDER BY p.paid_at`).all();
    res.send(toCsv([['Restaurant', 'City', 'Owner email', 'Completed orders', 'Earned', 'Paid', 'Balance owed', 'Last paid'],
      ...rows.map((x) => [x.name, x.city, x.email, x.orders, dollars(x.earnedCents), dollars(x.paidCents), dollars(x.balanceCents), x.lastPaidAt || '']),
      [], ['Payout history'], ['Date', 'Invoice number', 'Restaurant', 'Amount', 'Bank details', 'Transaction ID', 'Note'],
      ...history.map((p) => [p.paid_at, p.reference, p.restaurant_name, dollars(p.amount_cents), p.bank_details, p.transaction_id, p.note])]));
  });

  // ---------- Sales tax ----------
  // Retail sales tax collected on completed orders, by restaurant location (for DOR filing).
  function taxRows(r) {
    const rows = db.prepare(`
      SELECT r.name, r.city, r.zip, o.tax_rate_bps, o.subtotal_cents, o.tax_cents, o.service_fee_cents, o.total_cents, o.refunded_cents
      FROM orders o JOIN restaurants r ON r.id = o.restaurant_id
      WHERE o.status = 'picked_up' AND o.picked_up_at >= ? AND o.picked_up_at < ?`).all(r.start, r.end);
    const groups = new Map();
    for (const o of rows) {
      const key = `${o.city}|${o.zip}|${o.tax_rate_bps}`;
      const g = groups.get(key) || { city: o.city, zip: o.zip, rateBps: o.tax_rate_bps, orders: 0, taxableCents: 0, taxCents: 0 };
      g.orders += 1;
      g.taxableCents += o.subtotal_cents - foodRefund(o);
      g.taxCents += o.tax_cents - taxRefund(o);
      groups.set(key, g);
    }
    return [...groups.values()].sort((a, b) => a.city.localeCompare(b.city) || a.zip.localeCompare(b.zip));
  }

  router.get('/tax', (req, res) => {
    const r = range(req, 30);
    const rows = taxRows(r);
    res.json({ range: { from: r.from, to: r.to }, rows,
      totals: { taxableCents: rows.reduce((n, x) => n + x.taxableCents, 0), taxCents: rows.reduce((n, x) => n + x.taxCents, 0) } });
  });

  router.get('/tax.csv', (req, res) => {
    const r = range(req, 30);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="RescueBites-sales-tax-${r.from}-to-${r.to}.csv"`);
    res.send(toCsv([['City', 'ZIP', 'Rate %', 'Orders', 'Taxable sales', 'Sales tax collected'],
      ...taxRows(r).map((x) => [x.city, x.zip, (x.rateBps / 100).toFixed(2), x.orders, dollars(x.taxableCents), dollars(x.taxCents)])]));
  });

  router.get('/orders.csv', (req, res) => {
    const r = range(req, 30);
    const rows = db.prepare(`${orderQuery} WHERE o.created_at >= ? AND o.created_at < ? AND o.status != 'failed' ORDER BY o.created_at`).all(r.start, r.end);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="RescueBites-orders-${r.from}-to-${r.to}.csv"`);
    res.send(toCsv([['Order #', 'Created', 'Picked up', 'Status', 'Customer', 'Restaurant', 'Item', 'Qty', 'Original unit', 'Discount %',
      'Unit price', 'Food subtotal', 'Service fee', 'Sales tax', 'Total', 'Credit applied', 'Refunded to original payment', 'Refunded as platform credit', 'Card', 'Transaction ID'],
    ...rows.map((o) => [o.id, o.created_at, o.picked_up_at || '', o.status, o.username, o.restaurant_name, o.item_title, o.quantity,
      dollars(o.original_unit_price_cents), o.discount_pct, dollars(o.unit_price_cents), dollars(o.subtotal_cents), dollars(o.service_fee_cents),
      dollars(o.tax_cents), dollars(o.total_cents), dollars(o.credit_applied_cents), dollars(o.refunded_cents), dollars(o.credited_cents), o.card_label, o.payment_ref || ''])]));
  });

  // ---------- Settings & audit ----------
  router.get('/settings', (req, res) => {
    const s = settings.get();
    res.json({ settings: { serviceFeePct: s.serviceFeeBps / 100, defaultTaxRatePct: s.defaultTaxRateBps / 100,
      requireRestaurantApproval: s.requireRestaurantApproval }, paymentMode: payments.mode });
  });

  router.put('/settings', (req, res) => {
    const b = req.body || {};
    const changed = settings.set({
      serviceFeeBps: b.serviceFeePct === undefined ? undefined : Number(b.serviceFeePct) * 100,
      defaultTaxRateBps: b.defaultTaxRatePct === undefined ? undefined : Number(b.defaultTaxRatePct) * 100,
      requireRestaurantApproval: b.requireRestaurantApproval,
    });
    if (changed.length) audit(req, 'settings.update', 'settings', null, changed.map((k) => `${k}=${config[k]}`).join(', '));
    res.json({ changed });
  });

  router.get('/audit', (req, res) => {
    res.json({ entries: db.prepare(`SELECT a.*, u.username AS admin FROM audit_log a LEFT JOIN users u ON u.id = a.admin_id
      ORDER BY a.id DESC LIMIT 300`).all() });
  });

  return router;
};
