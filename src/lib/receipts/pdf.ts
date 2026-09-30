import 'server-only';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { code128 } from '@/lib/code128';
import { money, pct } from '@/lib/format';
import type { Receipt, Report } from './data';

// PDF receipts (80 mm point-of-sale roll) and daily reports (landscape letter).
// WOFF fonts (not WOFF2): pdfkit's font subsetter can fail on WOFF2 input.
const FONT_DIR = path.join(process.cwd(), 'assets', 'pdf-fonts');
const FONTS = {
  regular: 'inter-latin-400-normal.woff',
  medium: 'inter-latin-600-normal.woff',
  bold: 'inter-latin-700-normal.woff',
  head: 'plus-jakarta-sans-latin-800-normal.woff',
  mono: 'IBMPlexMono-Regular.woff',
  monoMedium: 'IBMPlexMono-SemiBold.woff',
  monoBold: 'IBMPlexMono-Bold.woff',
};
const LOGO = path.join(process.cwd(), 'public', 'assets', 'logo.png');
const LOGO_RATIO = 400 / 1654;
const GREEN = '#047857';
const INK = '#0b1b14';
const MUTED = '#6b7b73';
const LINE = '#dfe7e2';
const ROLL_WIDTH = 226.77; // 80 mm receipt roll
const ROLL_MARGIN = 14;

type Doc = PDFKit.PDFDocument;

function fonts(doc: Doc) {
  for (const [name, file] of Object.entries(FONTS)) doc.registerFont(name, path.join(FONT_DIR, file));
}

function finish(doc: Doc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

// ---------------------------------------------------------------- POS receipt

// Draws the thermal-style receipt in black ink and returns the y position where it ends.
function drawPosReceipt(doc: Doc, rc: Receipt) {
  const L = ROLL_MARGIN;
  const R = ROLL_WIDTH - ROLL_MARGIN;
  const W = R - L;
  const it = rc.item;
  let y = ROLL_MARGIN + 4;

  const center = (text: string, font: string, size: number, opts: { spacing?: number; after?: number } = {}) => {
    doc.font(font).fontSize(size).fillColor('#000');
    doc.text(text, L, y, { width: W, align: 'center', lineGap: 1, characterSpacing: opts.spacing ?? 0 });
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
  const row = (left: string, right: string, opts: { size?: number; bold?: boolean; indent?: number; strikeRight?: boolean; after?: number } = {}) => {
    const size = opts.size ?? 8;
    const indent = opts.indent ?? 0;
    doc.font(opts.bold ? 'monoBold' : 'mono').fontSize(size).fillColor('#000');
    const rw = right ? doc.widthOfString(right) : 0;
    doc.text(left, L + indent, y, { width: W - rw - 8 - indent, lineGap: 0.5 });
    const endY = doc.y;
    if (right) {
      doc.text(right, R - rw, y, { width: rw + 1, lineBreak: false });
      if (opts.strikeRight) doc.moveTo(R - rw, y + size * 0.62).lineTo(R, y + size * 0.62).lineWidth(0.7).strokeColor('#000').stroke();
    }
    y = Math.max(endY, y + size * 1.3) + (opts.after ?? 1.5);
  };
  const small = (text: string, opts: { size?: number; indent?: number; align?: 'left' | 'center'; after?: number } = {}) => {
    doc.font('mono').fontSize(opts.size ?? 6.8).fillColor('#000');
    doc.text(text, L + (opts.indent ?? 0), y, { width: W - (opts.indent ?? 0), align: opts.align ?? 'left', lineGap: 0.5 });
    y = doc.y + (opts.after ?? 1.5);
  };

  // Header: logo, restaurant, address.
  const logoW = 118;
  doc.image(LOGO, L + (W - logoW) / 2, y, { width: logoW });
  y += logoW * LOGO_RATIO + 4;
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
  row(`WA SALES TAX ${pct(rc.taxRateBps)}`, money(rc.taxCents));
  double();
  row('TOTAL', money(rc.totalCents), { bold: true, size: 11.5, after: 3 });
  if (rc.creditAppliedCents) {
    row('PLATFORM CREDIT', money(-rc.creditAppliedCents));
    row('BALANCE TO CARD', money(rc.totalCents - rc.creditAppliedCents), { bold: true });
  }
  dashes();

  // Payment.
  const paidWith = rc.creditAppliedCents
    ? rc.creditAppliedCents >= rc.totalCents ? 'Platform credit' : `${rc.card} + credit`
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
  doc.font('monoBold').fontSize(8).fillColor('#fff').text(`YOU SAVED ${money(it.savingsCents)} TODAY!`, L, y + 4.5, { width: W, align: 'center', lineBreak: false });
  y += 23;
  center(`${it.quantity === 1 ? '1 meal' : `${it.quantity} meals`} rescued from going to waste`, 'mono', 6.8, { after: 4 });

  if (rc.pin) {
    dashes();
    center('PICKUP PIN', 'monoBold', 7.5, { spacing: 1, after: 3 });
    doc.rect(L + W / 2 - 58, y, 116, 30).lineWidth(1.2).strokeColor('#000').stroke();
    doc.font('monoBold').fontSize(19).fillColor('#000').text(rc.pin.split('').join(' '), L, y + 6, { width: W, align: 'center', lineBreak: false });
    y += 36;
    center('Show this PIN at the counter', 'mono', 6.8, { after: 2 });
  }
  dashes();

  // Barcode of the receipt number.
  const bars = rc.barcode ?? code128(rc.receiptNumber);
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
  center('support@rescuebites.app', 'mono', 6.6, { after: 0 });
  return y;
}

// Point-of-sale style receipt: an 80 mm thermal roll, as tall as the content needs.
export function receiptPdf(rc: Receipt) {
  // First pass measures the height, second pass draws on a page cut to fit.
  const probe = new PDFDocument({ size: [ROLL_WIDTH, 5000], margin: 0 });
  fonts(probe);
  const height = Math.ceil(drawPosReceipt(probe, rc) + ROLL_MARGIN);
  const doc = new PDFDocument({ size: [ROLL_WIDTH, height], margin: 0, info: { Title: `Rescue Bites receipt ${rc.receiptNumber}`, Author: 'Rescue Bites' } });
  fonts(doc);
  drawPosReceipt(doc, rc);
  return finish(doc);
}

// ---------------------------------------------------------------- daily report

function label(doc: Doc, text: string, x: number, y: number, opts: PDFKit.Mixins.TextOptions = {}) {
  doc.font('bold').fontSize(7.5).fillColor(MUTED).text(text, x, y, { characterSpacing: 0.8, ...opts });
}

function rule(doc: Doc, x1: number, x2: number, y: number) {
  doc.moveTo(x1, y).lineTo(x2, y).lineWidth(1).strokeColor(LINE).stroke();
}

export function reportPdf(rep: Report) {
  const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 40, info: { Title: `Rescue Bites daily report ${rep.date}`, Author: 'Rescue Bites' } });
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
  const cards: [string, string][] = [
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
    `Menu value ${money(s.menuValueCents)} · Rescue Bites service fees paid by customers ${money(s.serviceFeesCents)} · `
      + `Awaiting pickup ${s.awaitingPickup} · Cancelled ${s.cancelled} · Not picked up ${s.notPickedUp}`,
    L, 168, { width: W },
  );

  const cols: [string, number, 'left' | 'right'][] = [
    ['#', 30, 'left'], ['Ordered', 52, 'left'], ['Picked up', 56, 'left'], ['Customer', 64, 'left'], ['Item', 128, 'left'], ['Qty', 28, 'right'],
    ['Original', 52, 'right'], ['Disc.', 36, 'right'], ['Price', 50, 'right'], ['Food', 54, 'right'], ['Tax', 46, 'right'], ['Total', 54, 'right'],
  ];
  cols.push(['Status', W - cols.reduce((n, c) => n + c[1], 0), 'left']);
  let y = 192;
  const header = () => {
    let x = L;
    doc.rect(L, y - 6, W, 20).fill('#0b1b14');
    for (const [h, w, a] of cols) {
      doc.font('bold').fontSize(8).fillColor('#ffffff').text(h.toUpperCase(), x + 3, y, { width: w - 6, align: a });
      x += w;
    }
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
