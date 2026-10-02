// Customer receipts and restaurant daily reports: JSON for the web pages, plus PDF and CSV downloads.
const path = require('node:path');
const PDFDocument = require('pdfkit');
const { code128 } = require('./code128');

const ROOT = path.join(__dirname, '..', 'public');
// WOFF (not WOFF2): pdfkit's font subsetter can fail on WOFF2 input.
const FONT_DIR = path.join(__dirname, 'fonts');
const FONTS = {
  regular: path.join(FONT_DIR, 'inter-latin-400-normal.woff'),
  medium: path.join(FONT_DIR, 'inter-latin-600-normal.woff'),
  bold: path.join(FONT_DIR, 'inter-latin-700-normal.woff'),
  head: path.join(FONT_DIR, 'plus-jakarta-sans-latin-800-normal.woff'),
  mono: path.join(FONT_DIR, 'IBMPlexMono-Regular.woff'),
  monoMedium: path.join(FONT_DIR, 'IBMPlexMono-SemiBold.woff'),
  monoBold: path.join(FONT_DIR, 'IBMPlexMono-Bold.woff'),
};
const LOGO = path.join(ROOT, 'assets', 'logo.png');
const GREEN = '#047857';
const INK = '#0b1b14';
const MUTED = '#6b7b73';
const LINE = '#dfe7e2';
const ROLL_WIDTH = 226.77; // 80 mm receipt roll
const ROLL_MARGIN = 14;

const money = (cents) => `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`;
const pctText = (bps) => `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`;

function formatDateTime(iso, timeZone) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', {
    timeZone, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}
const formatTime = (iso, timeZone) => new Date(iso).toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });

// UTC offset (ms) of a time zone at a given instant.
function tzOffset(ms, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - ms;
}

// Start/end instants of a calendar day (YYYY-MM-DD) in the given time zone.
function dayRange(date, timeZone) {
  const [y, m, d] = date.split('-').map(Number);
  const at = (day) => {
    const guess = Date.UTC(y, m - 1, day);
    return new Date(guess - tzOffset(guess - tzOffset(guess, timeZone), timeZone));
  };
  return { start: at(d).toISOString(), end: at(d + 1).toISOString() };
}

function todayIn(timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

const PAYMENT_STATUS = {
  picked_up: 'Paid (charged at pickup)',
  reserved: 'Authorized: hold placed, charged at pickup',
  pending_payment: 'Processing',
  cancelled: 'Hold released: not charged',
  expired: 'Hold released: not charged',
  failed: 'Declined: not charged',
};
const ORDER_STATUS = {
  picked_up: 'Picked up', reserved: 'Awaiting pickup', pending_payment: 'Processing',
  cancelled: 'Cancelled', expired: 'Not picked up', failed: 'Payment failed',
};

function createReceiptService({ db, config }) {
  const timeZone = config.timeZone || 'America/Los_Angeles';

  function receiptData(order) {
    const r = db.prepare('SELECT name, address, city, zip, phone FROM restaurants WHERE id = ?').get(order.restaurant_id);
    const u = db.prepare('SELECT username, email FROM users WHERE id = ?').get(order.user_id);
    const offer = db.prepare('SELECT reason, image_path FROM offers WHERE id = ?').get(order.offer_id);
    const created = new Date(order.created_at);
    const ymd = `${created.getUTCFullYear()}${String(created.getUTCMonth() + 1).padStart(2, '0')}${String(created.getUTCDate()).padStart(2, '0')}`;
    const lineOriginal = order.original_unit_price_cents * order.quantity;
    return {
      receiptNumber: `BW-${ymd}-${String(order.id).padStart(6, '0')}`,
      orderId: order.id,
      status: order.status,
      statusLabel: ORDER_STATUS[order.status] || order.status,
      paymentStatus: (order.refunded_cents || 0) + (order.credited_cents || 0) >= order.total_cents && order.status === 'picked_up'
        ? 'Refunded in full'
        : order.refunded_cents || order.credited_cents
          ? `Paid, partially refunded (${money((order.refunded_cents || 0) + (order.credited_cents || 0))})`
          : PAYMENT_STATUS[order.status] || order.status,
      orderedAt: order.created_at,
      pickedUpAt: order.picked_up_at,
      closedAt: order.closed_at,
      pickupBy: order.pickup_end,
      orderedAtText: formatDateTime(order.created_at, timeZone),
      pickedUpAtText: formatDateTime(order.picked_up_at, timeZone),
      closedAtText: formatDateTime(order.closed_at, timeZone),
      pickupByText: formatDateTime(order.pickup_end, timeZone),
      customer: { username: u?.username || '', email: u?.email || '' },
      restaurant: r,
      item: {
        title: order.item_title,
        imageUrl: offer?.image_path || null,
        quantity: order.quantity,
        originalUnitCents: order.original_unit_price_cents,
        discountPct: order.discount_pct,
        unitPriceCents: order.unit_price_cents,
        lineOriginalCents: lineOriginal,
        lineTotalCents: order.subtotal_cents,
        savingsCents: lineOriginal - order.subtotal_cents,
      },
      subtotalCents: order.subtotal_cents,
      serviceFeeCents: order.service_fee_cents,
      // Older orders didn't store the fee rate, so estimate it from the amounts.
      serviceFeePct: order.service_fee_bps != null ? order.service_fee_bps / 100
        : order.subtotal_cents ? Math.round((order.service_fee_cents * 1000) / order.subtotal_cents) / 10 : 0,
      taxRateBps: order.tax_rate_bps,
      taxCents: order.tax_cents,
      totalCents: order.total_cents,
      creditAppliedCents: order.credit_applied_cents || 0,
      amountChargedCents: order.status === 'picked_up' ? order.total_cents - (order.credit_applied_cents || 0) : 0,
      refundedCents: (order.refunded_cents || 0) + (order.credited_cents || 0),
      refunds: db.prepare('SELECT amount_cents, method, card_cents, credit_cents, reason, created_at FROM refunds WHERE order_id = ? ORDER BY id').all(order.id)
        .map((f) => ({
          amountCents: f.amount_cents,
          to: f.method === 'credit' ? 'Bite Wise platform credit'
            : [f.card_cents && `${order.card_label} (${money(f.card_cents)})`, f.credit_cents && `platform credit (${money(f.credit_cents)})`].filter(Boolean).join(' + '),
          reason: f.reason,
          atText: formatDateTime(f.created_at, timeZone),
        })),
      refundedAtText: formatDateTime(order.refunded_at, timeZone),
      card: order.card_label,
      paymentRef: order.payment_ref || '',
      pin: order.status === 'reserved' ? order.pin : null,
      // Code 128 module widths (bar, space, ...) for the receipt number barcode.
      barcode: code128(`BW-${ymd}-${String(order.id).padStart(6, '0')}`),
      timeZone,
    };
  }

  // Point-of-sale style receipt: an 80 mm thermal roll, as tall as the content needs.
  function receiptPdf(rc) {
    const info = { Title: `Bite Wise receipt ${rc.receiptNumber}`, Author: 'Bite Wise' };
    // First pass measures the height, second pass draws on a page cut to fit.
    const probe = new PDFDocument({ size: [ROLL_WIDTH, 5000], margin: 0, autoFirstPage: true });
    fonts(probe);
    const height = Math.ceil(drawPosReceipt(probe, rc) + ROLL_MARGIN);
    const doc = new PDFDocument({ size: [ROLL_WIDTH, height], margin: 0, info });
    fonts(doc);
    drawPosReceipt(doc, rc);
    return finish(doc);
  }

  // ----- Restaurant daily report -----

  function reportData(restaurantId, date) {
    const { start, end } = dayRange(date, timeZone);
    const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(restaurantId);
    const rows = db.prepare(`
      SELECT o.*, u.username FROM orders o JOIN users u ON u.id = o.user_id
      WHERE o.restaurant_id = ? AND o.status NOT IN ('pending_payment', 'failed')
        AND ((o.created_at >= ? AND o.created_at < ?) OR (o.picked_up_at >= ? AND o.picked_up_at < ?))
      ORDER BY o.created_at`).all(restaurantId, start, end, start, end);
    const sold = rows.filter((o) => o.status === 'picked_up' && o.picked_up_at >= start && o.picked_up_at < end);
    const sum = (list, f) => list.reduce((n, o) => n + f(o), 0);
    const count = (s) => rows.filter((o) => o.status === s).length;
    return {
      date,
      dateText: new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }),
      generatedAtText: formatDateTime(new Date().toISOString(), timeZone),
      restaurant: { name: restaurant.name, address: restaurant.address, city: restaurant.city, zip: restaurant.zip, phone: restaurant.phone },
      summary: {
        ordersPickedUp: sold.length,
        mealsRescued: sum(sold, (o) => o.quantity),
        menuValueCents: sum(sold, (o) => o.original_unit_price_cents * o.quantity),
        discountsCents: sum(sold, (o) => (o.original_unit_price_cents - o.unit_price_cents) * o.quantity),
        foodSalesCents: sum(sold, (o) => o.subtotal_cents),
        salesTaxCents: sum(sold, (o) => o.tax_cents),
        serviceFeesCents: sum(sold, (o) => o.service_fee_cents),
        totalChargedCents: sum(sold, (o) => o.total_cents),
        awaitingPickup: count('reserved'),
        cancelled: count('cancelled'),
        notPickedUp: count('expired'),
      },
      orders: rows.map((o) => ({
        id: o.id,
        orderedAt: o.created_at,
        orderedTime: formatTime(o.created_at, timeZone),
        pickedUpTime: o.picked_up_at ? formatTime(o.picked_up_at, timeZone) : '',
        customer: o.username,
        item: o.item_title,
        quantity: o.quantity,
        originalUnitCents: o.original_unit_price_cents,
        discountPct: o.discount_pct,
        unitPriceCents: o.unit_price_cents,
        subtotalCents: o.subtotal_cents,
        taxCents: o.tax_cents,
        serviceFeeCents: o.service_fee_cents,
        totalCents: o.total_cents,
        card: o.card_label,
        status: o.status,
        statusLabel: ORDER_STATUS[o.status] || o.status,
      })),
    };
  }

  function reportCsv(rep) {
    const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const d = (c) => (c / 100).toFixed(2);
    const lines = [
      ['Order #', 'Ordered', 'Picked up', 'Customer', 'Item', 'Qty', 'Original unit price', 'Discount %', 'Unit price',
        'Food subtotal', 'Sales tax', 'Service fee', 'Total', 'Card', 'Status'],
      ...rep.orders.map((o) => [o.id, o.orderedTime, o.pickedUpTime, o.customer, o.item, o.quantity, d(o.originalUnitCents), o.discountPct,
        d(o.unitPriceCents), d(o.subtotalCents), d(o.taxCents), d(o.serviceFeeCents), d(o.totalCents), o.card, o.statusLabel]),
      [],
      ['Summary (picked-up orders)'],
      ['Orders picked up', rep.summary.ordersPickedUp],
      ['Meals rescued', rep.summary.mealsRescued],
      ['Menu value', d(rep.summary.menuValueCents)],
      ['Discounts given', d(rep.summary.discountsCents)],
      ['Food sales', d(rep.summary.foodSalesCents)],
      ['Sales tax collected', d(rep.summary.salesTaxCents)],
      ['Bite Wise service fees (paid by customers)', d(rep.summary.serviceFeesCents)],
      ['Total charged to customers', d(rep.summary.totalChargedCents)],
      ['Awaiting pickup', rep.summary.awaitingPickup],
      ['Cancelled', rep.summary.cancelled],
      ['Not picked up', rep.summary.notPickedUp],
    ];
    return `${lines.map((l) => l.map(esc).join(',')).join('\n')}\n`;
  }

  function reportPdf(rep) {
    const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 40, info: { Title: `Bite Wise daily report ${rep.date}`, Author: 'Bite Wise' } });
    fonts(doc);
    const L = 40;
    const R = doc.page.width - 40;
    const W = R - L;
    doc.image(LOGO, L, 34, { height: 38 });
    doc.font('head').fontSize(18).fillColor(INK).text('Daily sales report', L, 36, { width: W, align: 'right' });
    doc.font('regular').fontSize(9.5).fillColor(MUTED).text(`${rep.restaurant.name} · ${rep.dateText}`, L, 60, { width: W, align: 'right' });
    doc.text(`${rep.restaurant.address}, ${rep.restaurant.city}, WA ${rep.restaurant.zip}${rep.restaurant.phone ? ` · ${rep.restaurant.phone}` : ''}`, L, 74, { width: W, align: 'right' });
    rule(doc, L, R, 96);

    const s = rep.summary;
    const cards = [
      ['Food sales', money(s.foodSalesCents)], ['Orders picked up', String(s.ordersPickedUp)], ['Meals rescued', String(s.mealsRescued)],
      ['Discounts given', money(s.discountsCents)], ['Sales tax', money(s.salesTaxCents)], ['Total charged', money(s.totalChargedCents)],
    ];
    const cw = (W - 5 * 8) / 6;
    cards.forEach(([k, v], i) => {
      const x = L + i * (cw + 8);
      doc.roundedRect(x, 108, cw, 50, 8).fill('#f2f7f4');
      label(doc, k.toUpperCase(), x + 10, 116, { width: cw - 16 });
      doc.font('head').fontSize(15).fillColor(i === 0 ? GREEN : INK).text(v, x + 10, 131, { width: cw - 16 });
    });
    doc.font('regular').fontSize(9).fillColor(MUTED).text(
      `Menu value ${money(s.menuValueCents)} · Bite Wise service fees paid by customers ${money(s.serviceFeesCents)} · `
      + `Awaiting pickup ${s.awaitingPickup} · Cancelled ${s.cancelled} · Not picked up ${s.notPickedUp}`, L, 168, { width: W },
    );

    const cols = [
      ['#', 30, 'left'], ['Ordered', 52, 'left'], ['Picked up', 56, 'left'], ['Customer', 64, 'left'], ['Item', 128, 'left'], ['Qty', 28, 'right'],
      ['Original', 52, 'right'], ['Disc.', 36, 'right'], ['Price', 50, 'right'], ['Food', 54, 'right'], ['Tax', 46, 'right'], ['Total', 54, 'right'],
    ];
    cols.push(['Status', W - cols.reduce((n, c) => n + c[1], 0), 'left']);
    let y = 192;
    const header = () => {
      let x = L;
      doc.rect(L, y - 6, W, 20).fill('#0b1b14');
      cols.forEach(([h, w, a]) => {
        doc.font('bold').fontSize(8).fillColor('#ffffff').text(h.toUpperCase(), x + 3, y, { width: w - 6, align: a });
        x += w;
      });
      y += 20;
    };
    header();
    if (!rep.orders.length) doc.font('regular').fontSize(10).fillColor(MUTED).text('No orders on this day.', L, y + 6);
    rep.orders.forEach((o, i) => {
      if (y > doc.page.height - 60) {
        doc.addPage();
        y = 40;
        header();
      }
      if (i % 2) doc.rect(L, y - 4, W, 18).fill('#f6f9f7');
      const vals = [String(o.id), o.orderedTime, o.pickedUpTime || '-', o.customer, o.item, String(o.quantity), money(o.originalUnitCents),
        `${o.discountPct}%`, money(o.unitPriceCents), money(o.subtotalCents), money(o.taxCents), money(o.totalCents), o.statusLabel];
      let x = L;
      cols.forEach(([, w, a], j) => {
        doc.font(j === 4 ? 'medium' : 'regular').fontSize(8.5).fillColor(o.status === 'picked_up' || j !== 12 ? INK : MUTED)
          .text(vals[j], x + 3, y, { width: w - 6, align: a, lineBreak: false, ellipsis: true });
        x += w;
      });
      y += 18;
    });
    doc.font('regular').fontSize(8).fillColor(MUTED).text(
      `Sales totals include orders picked up (and charged) on this day. Times in Pacific Time. Generated ${rep.generatedAtText}.`,
      L, doc.page.height - 50, { width: W, lineBreak: false },
    );
    return finish(doc);
  }

  return { receiptData, receiptPdf, reportData, reportCsv, reportPdf, todayIn: () => todayIn(timeZone) };
}

function fonts(doc) {
  doc.registerFont('regular', FONTS.regular);
  doc.registerFont('medium', FONTS.medium);
  doc.registerFont('bold', FONTS.bold);
  doc.registerFont('head', FONTS.head);
  doc.registerFont('mono', FONTS.mono);
  doc.registerFont('monoMedium', FONTS.monoMedium);
  doc.registerFont('monoBold', FONTS.monoBold);
}

function label(doc, text, x, y, opts = {}) {
  doc.font('bold').fontSize(7.5).fillColor(MUTED).text(text, x, y, { characterSpacing: 0.8, ...opts });
}

function rule(doc, x1, x2, y) {
  doc.moveTo(x1, y).lineTo(x2, y).lineWidth(1).strokeColor(LINE).stroke();
}

// Draws the thermal-style receipt in black ink and returns the y position where it ends.
function drawPosReceipt(doc, rc) {
  const L = ROLL_MARGIN;
  const R = ROLL_WIDTH - ROLL_MARGIN;
  const W = R - L;
  const it = rc.item;
  let y = ROLL_MARGIN + 4;

  const center = (text, font, size, opts = {}) => {
    doc.font(font).fontSize(size).fillColor(opts.color || '#000');
    doc.text(text, L, y, { width: W, align: 'center', lineGap: 1, characterSpacing: opts.spacing || 0 });
    y = doc.y + (opts.after ?? 2);
  };
  const dashes = (gap = 7) => {
    y += gap - 4;
    doc.moveTo(L, y).lineTo(R, y).lineWidth(0.7).dash(2.2, { space: 1.8 }).strokeColor('#000').stroke().undash();
    y += gap;
  };
  const double = () => {
    y += 3;
    doc.moveTo(L, y).lineTo(R, y).moveTo(L, y + 2).lineTo(R, y + 2).lineWidth(0.6).strokeColor('#000').stroke();
    y += 8;
  };
  // Label on the left (wraps), amount on the right.
  const row = (left, right, opts = {}) => {
    const size = opts.size || 8;
    doc.font(opts.bold ? 'monoBold' : 'mono').fontSize(size).fillColor('#000');
    const rw = right ? doc.widthOfString(right) : 0;
    const lw = W - rw - 8;
    doc.text(left, L + (opts.indent || 0), y, { width: lw - (opts.indent || 0), lineGap: 0.5 });
    const endY = doc.y;
    if (right) {
      doc.text(right, R - rw, y, { width: rw + 1, lineBreak: false });
      if (opts.strikeRight) doc.moveTo(R - rw, y + size * 0.62).lineTo(R, y + size * 0.62).lineWidth(0.7).strokeColor('#000').stroke();
    }
    y = Math.max(endY, y + size * 1.3) + (opts.after ?? 1.5);
  };
  const small = (text, opts = {}) => {
    doc.font('mono').fontSize(opts.size || 6.8).fillColor('#000');
    doc.text(text, L + (opts.indent || 0), y, { width: W - (opts.indent || 0), align: opts.align || 'left', lineGap: 0.5 });
    y = doc.y + (opts.after ?? 1.5);
  };

  // Header: logo, restaurant, address.
  const logoW = 118;
  doc.image(LOGO, L + (W - logoW) / 2, y, { width: logoW });
  y += logoW * (400 / 1366) + 4;
  center('RESCUED FOOD · GREATER SEATTLE', 'mono', 6.2, { spacing: 0.4, after: 7 });
  center(rc.restaurant.name.toUpperCase(), 'monoBold', 9.5, { after: 1 });
  center(`${rc.restaurant.address}\n${rc.restaurant.city}, WA ${rc.restaurant.zip}${rc.restaurant.phone ? `\nTel ${rc.restaurant.phone}` : ''}`, 'mono', 7.2, { after: 2 });
  dashes();

  // Order facts.
  row('RECEIPT', rc.receiptNumber);
  row('ORDER #', String(rc.orderId));
  row('ORDERED', rc.orderedAtText);
  if (rc.status === 'picked_up') row('PICKED UP', rc.pickedUpAtText);
  else row('PICK UP BY', rc.pickupByText);
  row('CUSTOMER', rc.customer.username);
  row('STATUS', rc.statusLabel.toUpperCase(), { bold: true });
  dashes();

  // Item line.
  row(`${it.quantity} x ${it.title}`, money(it.lineTotalCents), { bold: true, size: 8.4, after: 1 });
  row(`@ ${money(it.unitPriceCents)} ea  (-${it.discountPct}%)`, money(it.lineOriginalCents), { indent: 12, size: 7.2, strikeRight: true, after: 0 });
  small(`Reg. ${money(it.originalUnitCents)} ea, you save ${money(it.savingsCents)}`, { indent: 12, size: 6.6 });
  dashes();

  // Totals.
  row('MENU VALUE', money(it.lineOriginalCents));
  row(`DISCOUNT ${it.discountPct}%`, money(-it.savingsCents));
  row('SUBTOTAL', money(rc.subtotalCents));
  row(`SERVICE FEE ${rc.serviceFeePct}%`, money(rc.serviceFeeCents));
  row(`WA SALES TAX ${pctText(rc.taxRateBps)}`, money(rc.taxCents));
  double();
  row('TOTAL', money(rc.totalCents), { bold: true, size: 11.5, after: 3 });
  if (rc.creditAppliedCents) {
    row('PLATFORM CREDIT', money(-rc.creditAppliedCents));
    row('BALANCE TO CARD', money(rc.totalCents - rc.creditAppliedCents), { bold: true });
  }
  dashes();

  // Payment.
  const paidWith = rc.creditAppliedCents
    ? (rc.creditAppliedCents >= rc.totalCents ? 'Platform credit' : `${rc.card} + credit`)
    : rc.card || 'n/a';
  row('PAID WITH', paidWith);
  row('CHARGED', money(rc.amountChargedCents), { bold: true });
  small(`PAYMENT: ${rc.paymentStatus}`);
  small(`TXN ID: ${rc.paymentRef || 'n/a'}`);

  if (rc.refunds.length) {
    dashes();
    center('*** REFUNDS ***', 'monoBold', 8, { after: 3 });
    for (const f of rc.refunds) {
      row('REFUND', money(-f.amountCents), { bold: true, after: 0.5 });
      small(`To ${f.to}`, { indent: 8 });
      small(`${f.atText} · ${f.reason}`, { indent: 8, after: 3 });
    }
  }
  dashes();

  // Savings banner, printed white on black like a thermal "reverse" line.
  doc.rect(L, y, W, 17).fill('#000');
  doc.font('monoBold').fontSize(8).fillColor('#fff')
    .text(`YOU SAVED ${money(it.savingsCents)} TODAY!`, L, y + 4.5, { width: W, align: 'center', lineBreak: false });
  y += 23;
  center(`${it.quantity === 1 ? '1 meal' : `${it.quantity} meals`} rescued from going to waste`, 'mono', 6.8, { after: 4 });

  if (rc.pin) {
    dashes();
    center('PICKUP PIN', 'monoBold', 7.5, { spacing: 1, after: 3 });
    doc.rect(L + W / 2 - 58, y, 116, 30).lineWidth(1.2).strokeColor('#000').stroke();
    doc.font('monoBold').fontSize(19).fillColor('#000')
      .text(rc.pin.split('').join(' '), L, y + 6, { width: W, align: 'center', lineBreak: false });
    y += 36;
    center('Show this PIN at the counter', 'mono', 6.8, { after: 2 });
  }
  dashes();

  // Barcode of the receipt number.
  const bars = rc.barcode || code128(rc.receiptNumber);
  const modules = bars.reduce((a, b) => a + b, 0);
  const mw = Math.min(1.1, (W - 16) / modules);
  let bx = L + (W - modules * mw) / 2;
  bars.forEach((w, i) => {
    if (i % 2 === 0) doc.rect(bx, y, w * mw, 30).fill('#000');
    bx += w * mw;
  });
  y += 33;
  center(rc.receiptNumber, 'mono', 7, { spacing: 1.2, after: 8 });

  center('THANK YOU FOR RESCUING FOOD!', 'monoBold', 8, { after: 4 });
  small('Your card is authorized when you order and charged only when the restaurant confirms pickup with your PIN. '
    + 'Orders not picked up are released without charge. Times in Pacific Time.', { align: 'center', size: 6.2, after: 3 });
  center('support@bitewise.app', 'mono', 6.6, { after: 0 });
  return y;
}

function finish(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

module.exports = { createReceiptService, dayRange };
