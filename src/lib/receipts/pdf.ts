import 'server-only';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { code128 } from '@/lib/code128';
import { money, pct } from '@/lib/format';
import type { Receipt, Report } from './data';
import type { PlanInvoice } from './plan-invoice';
import type { Income } from '@/lib/admin';
import type { Cell, Report as ListReport } from '@/lib/exports';
import { displayPhone } from '@/lib/phone';

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
const LOGO_RATIO = 400 / 1428;
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
  const logoW = 140;
  doc.image(LOGO, L + (W - logoW) / 2, y, { width: logoW });
  y += logoW * LOGO_RATIO + 4;
  center('RESCUED FOOD · GREATER SEATTLE', 'mono', 6.2, { spacing: 0.4, after: 7 });
  center(rc.restaurant.name.toUpperCase(), 'monoBold', 9.5, { after: 1 });
  center(`${rc.restaurant.address}\n${rc.restaurant.city}, WA ${rc.restaurant.zip}${rc.restaurant.phone ? `\nTel ${displayPhone(rc.restaurant.phone)}` : ''}`, 'mono', 7.2, { after: 2 });
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
  center('support@bitewise.app', 'mono', 6.6, { after: 0 });
  return y;
}

// Point-of-sale style receipt: an 80 mm thermal roll, as tall as the content needs.
export function receiptPdf(rc: Receipt) {
  // First pass measures the height, second pass draws on a page cut to fit.
  const probe = new PDFDocument({ size: [ROLL_WIDTH, 5000], margin: 0 });
  fonts(probe);
  const height = Math.ceil(drawPosReceipt(probe, rc) + ROLL_MARGIN);
  const doc = new PDFDocument({ size: [ROLL_WIDTH, height], margin: 0, info: { Title: `Bite Wise receipt ${rc.receiptNumber}`, Author: 'Bite Wise' } });
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
  const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 40, info: { Title: `Bite Wise daily report ${rep.date}`, Author: 'Bite Wise' } });
  fonts(doc);
  const L = 40;
  const R = doc.page.width - 40;
  const W = R - L;
  doc.image(LOGO, L, 34, { height: 38 });
  doc.font('head').fontSize(18).fillColor(INK).text('Daily sales report', L, 36, { width: W, align: 'right' });
  doc.font('regular').fontSize(9.5).fillColor(MUTED).text(`${rep.restaurant.name} · ${rep.dateText}`, L, 60, { width: W, align: 'right' });
  doc.text(`${rep.restaurant.address}, ${rep.restaurant.city}, WA ${rep.restaurant.zip}${rep.restaurant.phone ? ` · ${displayPhone(rep.restaurant.phone)}` : ''}`, L, 74, { width: W, align: 'right' });
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
    `Menu value ${money(s.menuValueCents)} · Bite Wise service fees paid by customers ${money(s.serviceFeesCents)} · `
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

// ---------------------------------------------------------------- restaurant plan invoice

export function planInvoicePdf(inv: PlanInvoice) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 54, info: { Title: `Bite Wise invoice ${inv.number}`, Author: 'Bite Wise' } });
  fonts(doc);
  const L = 54;
  const R = doc.page.width - 54;
  const W = R - L;
  const NAVY = '#14284B';
  const SAVE = '#3E8230';

  doc.image(LOGO, L, 50, { height: 44 });
  doc.font('head').fontSize(24).fillColor(NAVY).text('INVOICE', L, 50, { width: W, align: 'right' });
  doc.font('mono').fontSize(10).fillColor(INK).text(inv.number, L, 80, { width: W, align: 'right' });
  doc.font('regular').fontSize(10).fillColor(MUTED).text(inv.dateText, L, 95, { width: W, align: 'right' });
  rule(doc, L, R, 122);

  const r = inv.restaurant;
  label(doc, 'BILLED TO', L, 140);
  doc.font('bold').fontSize(10.5).fillColor(INK).text(r.name, L, 154, { width: W / 2 });
  doc.font('regular').fontSize(10).text([r.address, `${r.city}, WA ${r.zip}`, r.phone ? displayPhone(r.phone) : ''].filter(Boolean).join('\n'), { width: W / 2, lineGap: 2 });
  label(doc, 'FROM', L, 140, { width: W, align: 'right' });
  doc.font('bold').fontSize(10.5).fillColor(INK).text(inv.from.entity, L, 154, { width: W, align: 'right' });
  doc.font('regular').fontSize(10).text(`${inv.from.address}\n${inv.from.email}`, L, doc.y, { width: W, align: 'right', lineGap: 2 });

  let y = 236;
  label(doc, 'DESCRIPTION', L, y);
  label(doc, 'AMOUNT', L, y, { width: W, align: 'right' });
  y += 16;
  rule(doc, L, R, y);
  y += 12;
  doc.font('bold').fontSize(11).fillColor(INK).text(inv.description, L, y, { width: W - 120 });
  doc.font('regular').fontSize(11).text(money(inv.listCents), L, y, { width: W, align: 'right' });
  doc.font('regular').fontSize(9).fillColor(MUTED).text(inv.periodText, L, y + 16, { width: W - 120 });
  y += 40;
  rule(doc, L, R, y);
  if (inv.discountCents > 0) {
    y += 12;
    doc.font('medium').fontSize(11).fillColor(SAVE).text(inv.discountLabel, L, y, { width: W - 120 });
    doc.text(`−${money(inv.discountCents)}`, L, y, { width: W, align: 'right' });
    y += 26;
    rule(doc, L, R, y);
  }
  if (inv.showTax) {
    for (const [k, v] of [['Subtotal', money(inv.subtotalCents)], [inv.taxLabel, money(inv.taxCents)]]) {
      y += 12;
      doc.font('regular').fontSize(11).fillColor(INK).text(k, L, y, { width: W - 120 });
      doc.text(v, L, y, { width: W, align: 'right' });
      y += 14;
    }
    y += 12;
    rule(doc, L, R, y);
  }
  y += 18;
  doc.font('head').fontSize(13).fillColor(INK).text(inv.free ? 'Total due' : inv.paid ? 'Total paid' : 'Total due', L, y + 4);
  const total = money(inv.totalCents);
  if (inv.free) {
    doc.font('head').fontSize(11).fillColor(SAVE).text('FREE', L, y + 6, { width: W, align: 'right' });
    doc.font('head').fontSize(20).fillColor(INK).text(total, L, y, { width: W - 44, align: 'right' });
  } else {
    doc.font('head').fontSize(20).fillColor(INK).text(total, L, y, { width: W, align: 'right' });
  }
  y += 46;
  doc.font('regular').fontSize(9.5).fillColor(MUTED).text(inv.note, L, y, { width: W });
  doc.font('regular').fontSize(8.5).fillColor(MUTED).text(
    `${inv.from.entity} · Eat well, waste less · ${inv.from.email}`, L, doc.page.height - 70, { width: W, align: 'center', lineBreak: false },
  );
  return finish(doc);
}

// ---------------------------------------------------------------- paged tables (owner console reports)

export type PdfCol = { h: string; w: number; a?: 'left' | 'right' };

// Draws a table at at.y that continues on new pages (newPage), repeating its header row. Widths are relative.
function pagedTable(doc: Doc, at: { y: number }, box: { L: number; R: number; bottom: number; newPage: () => void },
  heading: string | null, cols: PdfCol[], rows: string[][], total: string[] | undefined, empty: string) {
  const { L, R, bottom } = box;
  const W = R - L;
  const scale = W / cols.reduce((n, c) => n + c.w, 0);
  const ws = cols.map((c) => c.w * scale);
  const header = () => {
    doc.rect(L, at.y, W, 18).fill(INK);
    let cx = L;
    cols.forEach((c, i) => {
      doc.font('bold').fontSize(7.5).fillColor('#ffffff').text(c.h.toUpperCase(), cx + 5, at.y + 5, { width: ws[i] - 10, height: 9, align: c.a ?? 'right', ellipsis: true });
      cx += ws[i];
    });
    at.y += 20;
  };
  if (heading) {
    if (at.y > bottom - 80) box.newPage();
    doc.font('bold').fontSize(11).fillColor(INK).text(heading, L, at.y);
    at.y += 16;
  }
  header();
  const draw = (vals: string[], bold: boolean, shade: boolean) => {
    if (at.y > bottom - 16) {
      box.newPage();
      header();
    }
    if (shade) doc.rect(L, at.y - 3, W, 16).fill('#f6f9f7');
    let cx = L;
    vals.forEach((v, i) => {
      doc.font(bold ? 'bold' : i === 0 ? 'medium' : 'regular').fontSize(8.5).fillColor(INK)
        .text(v, cx + 5, at.y, { width: ws[i] - 10, height: 11, align: cols[i].a ?? 'right', ellipsis: true }); // one line, cut with …
      cx += ws[i];
    });
    at.y += 16;
  };
  if (!rows.length) {
    doc.font('regular').fontSize(9).fillColor(MUTED).text(empty, L + 5, at.y);
    at.y += 16;
  }
  rows.forEach((r, i) => draw(r, false, i % 2 === 1));
  if (total) {
    rule(doc, L, R, at.y - 2);
    at.y += 3;
    draw(total, true, false);
  }
  at.y += 14;
}

// A list from the owner console (Restaurants, Customers, Orders, Payouts, Sales tax, Audit log; see src/lib/exports.ts)
// as a landscape letter PDF: title, the tab's figures (whole tab only), then its tables. Columns with width 0 are
// CSV-only details.
export function listReportPdf(r: ListReport, o: { generatedAt: string; text: (c: Cell) => string }) {
  const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margins: { top: 36, left: 36, right: 36, bottom: 0 }, info: { Title: `Bite Wise ${r.title}`, Author: 'Bite Wise' } });
  fonts(doc);
  const L = 36;
  const R = doc.page.width - 36;
  const W = R - L;
  const bottom = doc.page.height - 50;
  const footer = () => {
    doc.font('regular').fontSize(7.5).fillColor(MUTED).text(`${r.note ? `${r.note} ` : ''}Generated ${o.generatedAt}.`, L, doc.page.height - 34, { width: W, lineBreak: false, ellipsis: true });
  };
  doc.image(LOGO, L, 30, { height: 34 });
  doc.font('head').fontSize(18).fillColor(INK).text(r.title, L, 30, { width: W, align: 'right' });
  doc.font('regular').fontSize(9.5).fillColor(MUTED).text(r.subtitle, L, 54, { width: W, align: 'right', lineBreak: false, ellipsis: true });
  rule(doc, L, R, 76);
  const at = { y: 90 };
  const newPage = () => {
    footer();
    doc.addPage();
    at.y = 40;
  };
  if (r.figures?.length) {
    const n = r.figures.length;
    const bw = (W - (n - 1) * 8) / n;
    r.figures.forEach(([k, v], i) => {
      const bx = L + i * (bw + 8);
      doc.roundedRect(bx, at.y, bw, 46, 8).fill('#f2f7f4');
      label(doc, k.toUpperCase(), bx + 10, at.y + 9, { width: bw - 20, lineBreak: false, ellipsis: true });
      doc.font('head').fontSize(15).fillColor(i === 0 ? GREEN : INK).text(v, bx + 10, at.y + 23, { width: bw - 20, lineBreak: false });
    });
    at.y += 62;
  }
  for (const t of r.tables) {
    const keep = t.columns.map((c, i) => [c, i] as const).filter(([c]) => c.w > 0);
    const pick = (row: Cell[]) => keep.map(([, i]) => o.text(row[i]));
    pagedTable(doc, at, { L, R, bottom, newPage }, r.tables.length > 1 ? t.title : null,
      keep.map(([c]) => ({ h: c.h, w: c.w, a: c.align })), t.rows.map(pick), t.total && pick(t.total), 'Nothing to show.');
  }
  footer();
  return finish(doc);
}

// ---------------------------------------------------------------- owner console: income report

type IncomeLineT = Income['totals'];
const FEES_COLOR = '#0fa874';
const PLANS_COLOR = '#5b8def';

const periodLabel = (key: string, by: Income['by'], short = false) =>
  by === 'year' ? key
    : by === 'month'
      ? new Date(`${key}-15T12:00:00Z`).toLocaleDateString('en-US', { month: short ? 'short' : 'long', year: short ? '2-digit' : 'numeric', timeZone: 'UTC' })
      : new Date(`${key}T12:00:00Z`).toLocaleDateString('en-US', short ? { month: 'numeric', day: 'numeric', timeZone: 'UTC' } : { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

// The Income tab as a PDF (landscape letter): `all` = the whole page (today / this month / this year, the range's
// figures, the chart and both tables); `periods` or `restaurants` = just that table.
export function incomePdf(x: Income, section: 'all' | 'periods' | 'restaurants', o: { generatedAt: string; note: string }) {
  // No bottom margin: page breaks are placed by hand, and the footer sits below the content area.
  const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margins: { top: 36, left: 36, right: 36, bottom: 0 }, info: { Title: `Bite Wise income ${x.range.from} to ${x.range.to}`, Author: 'Bite Wise' } });
  fonts(doc);
  const L = 36;
  const R = doc.page.width - 36;
  const W = R - L;
  const bottom = doc.page.height - 50;
  const per = x.by === 'day' ? 'day' : x.by === 'month' ? 'month' : 'year';
  const rangeText = `${periodLabel(x.range.from, 'day')} – ${periodLabel(x.range.to, 'day')}`;
  const title = section === 'periods' ? `Income per ${per}` : section === 'restaurants' ? 'Income by restaurant' : 'Income report';

  const footer = () => {
    doc.font('regular').fontSize(7.5).fillColor(MUTED).text(`${o.note} Generated ${o.generatedAt}.`, L, doc.page.height - 34, { width: W, lineBreak: false, ellipsis: true });
  };
  doc.image(LOGO, L, 30, { height: 34 });
  doc.font('head').fontSize(18).fillColor(INK).text(title, L, 30, { width: W, align: 'right' });
  doc.font('regular').fontSize(9.5).fillColor(MUTED).text(`${rangeText} · by ${per} · Pacific Time`, L, 54, { width: W, align: 'right' });
  rule(doc, L, R, 76);
  let y = 90;
  const newPage = () => {
    footer();
    doc.addPage();
    y = 40;
  };

  const box = (bx: number, by: number, bw: number, bh: number, k: string, v: string, color = INK) => {
    doc.roundedRect(bx, by, bw, bh, 8).fill('#f2f7f4');
    label(doc, k.toUpperCase(), bx + 10, by + 9, { width: bw - 20, lineBreak: false, ellipsis: true });
    doc.font('head').fontSize(15).fillColor(color).text(v, bx + 10, by + 23, { width: bw - 20, lineBreak: false });
  };

  if (section === 'all') {
    // Today / this month / this year.
    const qw = (W - 2 * 10) / 3;
    ([['Today', x.quick.today], ['This month', x.quick.month], ['This year', x.quick.year]] as const).forEach(([k, l], i) => {
      const bx = L + i * (qw + 10);
      doc.roundedRect(bx, y, qw, 86, 8).fill('#f2f7f4');
      label(doc, k.toUpperCase(), bx + 12, y + 10);
      doc.font('head').fontSize(18).fillColor(GREEN).text(money(l.netCents), bx + 12, y + 24, { lineBreak: false });
      const line = (t: string, v: string, ly: number) => {
        doc.font('regular').fontSize(8.5).fillColor(MUTED).text(t, bx + 12, ly, { width: qw - 100, lineBreak: false });
        doc.fillColor(INK).text(v, bx + 12, ly, { width: qw - 24, align: 'right', lineBreak: false });
      };
      line(`Service fees · ${l.orders} orders`, money(l.serviceFeesCents), y + 49);
      line(`Plan fees · ${l.planInvoices} invoices`, money(l.planFeesCents), y + 60);
      line('Platform credit funded', l.creditCostCents ? `−${money(l.creditCostCents)}` : money(0), y + 71);
    });
    y += 98;

    // The range's figures.
    const t = x.totals;
    const kw = (W - 3 * 8) / 4;
    const kpis: [string, string, string?][] = [
      ['Net income', money(t.netCents), GREEN], [`Service fees · ${t.orders} orders`, money(t.serviceFeesCents)],
      [`Plan fees · ${t.planInvoices} invoices`, money(t.planFeesCents)], ['Platform credit funded', t.creditCostCents ? `−${money(t.creditCostCents)}` : money(0)],
      ['Avg service fee per order', money(t.orders ? Math.round(t.serviceFeesCents / t.orders) : 0)], ['Charged to customers', money(t.gmvCents)],
      ['Pioneer discounts given', money(t.pioneerDiscountsCents)], ['Sales tax (owed to WA)', money(t.orderTaxCents + t.planTaxCents)],
    ];
    kpis.forEach(([k, v, c], i) => box(L + (i % 4) * (kw + 8), y + Math.floor(i / 4) * 52, kw, 46, k, v, c));
    y += 110;

    // Chart: stacked bars, service fees under plan fees.
    const ch = 150;
    const cl = L + 50;
    const cw = R - cl;
    doc.font('bold').fontSize(10).fillColor(INK).text(`Income per ${per}`, L, y);
    doc.rect(R - 190, y + 2, 8, 8).fill(FEES_COLOR);
    doc.font('regular').fontSize(8.5).fillColor(MUTED).text('Service fees', R - 178, y + 1);
    doc.rect(R - 100, y + 2, 8, 8).fill(PLANS_COLOR);
    doc.fillColor(MUTED).text('Plan fees', R - 88, y + 1);
    y += 18;
    const max = Math.max(100, ...x.periods.map((p) => p.serviceFeesCents + p.planFeesCents));
    const rough = max / 4;
    const pow = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 2.5, 5, 10].map((f) => f * pow).find((s) => s >= rough) ?? rough;
    const top = Math.ceil(max / step) * step;
    const yv = (v: number) => y + ch - (v / top) * ch;
    for (let v = 0; v <= top; v += step) {
      doc.moveTo(cl, yv(v)).lineTo(R, yv(v)).lineWidth(0.5).strokeColor(LINE).stroke();
      doc.font('regular').fontSize(7.5).fillColor(MUTED).text(money(v).replace('.00', ''), L, yv(v) - 4, { width: 44, align: 'right' });
    }
    const n = Math.max(1, x.periods.length);
    const bw = cw / n;
    const barW = Math.max(1, Math.min(36, bw - 2));
    const every = Math.ceil(n / 12);
    x.periods.forEach((p, i) => {
      const bx = cl + i * bw + (bw - barW) / 2;
      const fh = (Math.max(0, p.serviceFeesCents) / top) * ch;
      const ph = (Math.max(0, p.planFeesCents) / top) * ch;
      if (fh > 0) doc.rect(bx, y + ch - fh, barW, fh).fill(FEES_COLOR);
      if (ph > 0) doc.rect(bx, y + ch - fh - ph, barW, ph).fill(PLANS_COLOR);
      if (i % every === 0) doc.font('regular').fontSize(7).fillColor(MUTED).text(periodLabel(p.key, x.by, true), cl + i * bw - 10, y + ch + 4, { width: bw + 20, align: 'center', lineBreak: false });
    });
    doc.moveTo(cl, y + ch).lineTo(R, y + ch).lineWidth(0.8).strokeColor(MUTED).stroke();
    y += ch + 24;
  }

  const at = { get y() { return y; }, set y(v: number) { y = v; } };
  const table = (heading: string, cols: PdfCol[], rows: string[][], total?: string[]) =>
    pagedTable(doc, at, { L, R, bottom, newPage }, section === 'all' ? heading : null, cols, rows, total, 'Nothing in this period.');

  const lineVals = (l: IncomeLineT) => [String(l.orders), money(l.serviceFeesCents), money(l.planFeesCents),
    l.creditCostCents ? `−${money(l.creditCostCents)}` : '–', money(l.netCents), money(l.orderTaxCents + l.planTaxCents)];
  if (section !== 'restaurants') {
    table(`Income per ${per}`, [
      { h: per === 'day' ? 'Day' : per === 'month' ? 'Month' : 'Year', w: 150, a: 'left' }, { h: 'Orders', w: 60 }, { h: 'Service fees', w: 90 },
      { h: 'Plan fees', w: 90 }, { h: 'Credit cost', w: 90 }, { h: 'Net income', w: 90 }, { h: 'Sales tax collected', w: 110 },
    ], [...x.periods].reverse().map((p) => [periodLabel(p.key, x.by), ...lineVals(p)]), ['Total', ...lineVals(x.totals)]);
  }
  if (section !== 'periods') {
    table('Income by restaurant', [
      { h: 'Restaurant', w: 190, a: 'left' }, { h: 'City', w: 90, a: 'left' }, { h: 'Orders', w: 55 }, { h: 'Service fees', w: 85 },
      { h: 'Plan fees', w: 85 }, { h: 'Income', w: 85 }, { h: 'Sales charged', w: 90 },
    ], x.restaurants.map((r) => [r.name, r.city, String(r.orders), money(r.serviceFeesCents), money(r.planFeesCents), money(r.netCents), money(r.gmvCents)]));
  }
  footer();
  return finish(doc);
}
