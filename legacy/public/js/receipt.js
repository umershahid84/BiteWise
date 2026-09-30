import { api, $, esc, money, pct, renderHeader, requireRole, showError } from './common.js';

await requireRole('customer');
renderHeader('orders');

const id = Number(new URLSearchParams(location.search).get('order'));
$('#pdf-btn').href = `/api/orders/${id}/receipt.pdf`;
$('#print-btn').addEventListener('click', () => print());

// One receipt line: label on the left, amount on the right.
const row = (left, right = '', cls = '') => `<div class="pos-row ${cls}"><span>${left}</span><span>${right}</span></div>`;

// Code 128 bars (module widths: bar, space, bar, ...) as an SVG.
function barcodeSvg(bars) {
  let x = 0;
  const rects = bars.map((w, i) => {
    const r = i % 2 === 0 ? `<rect x="${x}" width="${w}" height="40"/>` : '';
    x += w;
    return r;
  }).join('');
  return `<svg class="pos-barcode" viewBox="0 0 ${x} 40" preserveAspectRatio="none" role="img" aria-label="Barcode">${rects}</svg>`;
}

try {
  const { receipt: r } = await api(`/orders/${id}/receipt`);
  document.title = `Receipt ${r.receiptNumber} · Rescue Bites`;
  const it = r.item;
  const rest = r.restaurant;
  const paidWith = r.creditAppliedCents
    ? (r.creditAppliedCents >= r.totalCents ? 'Platform credit' : `${r.card} + credit`)
    : r.card || 'n/a';
  $('#receipt').innerHTML = `
    <header class="pos-center">
      <img class="pos-logo" src="/assets/logo.svg" alt="Rescue Bites">
      <div class="pos-tag">Rescued food · Greater Seattle</div>
      <div class="pos-store">${esc(rest.name)}</div>
      <div>${esc(rest.address)}<br>${esc(rest.city)}, WA ${esc(rest.zip)}${rest.phone ? `<br>Tel ${esc(rest.phone)}` : ''}</div>
    </header>
    <hr class="pos-dash">
    ${row('Receipt', esc(r.receiptNumber))}
    ${row('Order #', r.orderId)}
    ${row('Ordered', esc(r.orderedAtText))}
    ${r.status === 'picked_up' ? row('Picked up', esc(r.pickedUpAtText)) : row('Pick up by', esc(r.pickupByText))}
    ${row('Customer', esc(r.customer.username))}
    ${row('Status', esc(r.statusLabel), 'b')}
    <hr class="pos-dash">
    ${row(`${it.quantity} x ${esc(it.title)}`, money(it.lineTotalCents), 'b item')}
    ${row(`@ ${money(it.unitPriceCents)} ea&nbsp; (-${it.discountPct}%)`, `<s>${money(it.lineOriginalCents)}</s>`, 'sub')}
    <div class="pos-note">Reg. ${money(it.originalUnitCents)} ea, you save ${money(it.savingsCents)}</div>
    <hr class="pos-dash">
    ${row('Menu value', money(it.lineOriginalCents))}
    ${row(`Discount ${it.discountPct}%`, `-${money(it.savingsCents)}`)}
    ${row('Subtotal', money(r.subtotalCents))}
    ${row(`Service fee ${r.serviceFeePct}%`, money(r.serviceFeeCents))}
    ${row(`WA sales tax ${pct(r.taxRateBps)}`, money(r.taxCents))}
    <hr class="pos-double">
    ${row('Total', money(r.totalCents), 'total')}
    ${r.creditAppliedCents ? row('Platform credit', `-${money(r.creditAppliedCents)}`) + row('Balance to card', money(r.totalCents - r.creditAppliedCents), 'b') : ''}
    <hr class="pos-dash">
    ${row('Paid with', esc(paidWith))}
    ${row('Charged', money(r.amountChargedCents), 'b')}
    <div class="pos-note flush">Payment: ${esc(r.paymentStatus)}</div>
    <div class="pos-note flush break">Txn ID: ${esc(r.paymentRef || 'n/a')}</div>
    ${r.refunds.length ? `<hr class="pos-dash"><div class="pos-center b">*** Refunds ***</div>
      ${r.refunds.map((f) => `${row('Refund', `-${money(f.amountCents)}`, 'b')}
        <div class="pos-note">To ${esc(f.to)}<br>${esc(f.atText)} · ${esc(f.reason)}</div>`).join('')}` : ''}
    <hr class="pos-dash">
    <div class="pos-saved">You saved ${money(it.savingsCents)} today!</div>
    <div class="pos-center small-print">${it.quantity === 1 ? '1 meal' : `${it.quantity} meals`} rescued from going to waste</div>
    ${r.pin ? `<hr class="pos-dash"><div class="pos-center">
      <div class="b pos-spaced">PICKUP PIN</div>
      <div class="pos-pin">${esc(r.pin)}</div>
      <div class="small-print">Show this PIN at the counter</div></div>` : ''}
    <hr class="pos-dash">
    <div class="pos-center">
      ${barcodeSvg(r.barcode)}
      <div class="pos-spaced small-print">${esc(r.receiptNumber)}</div>
      <div class="b pos-thanks">Thank you for rescuing food!</div>
      <p class="small-print">Your card is authorized when you order and charged only when the restaurant confirms pickup with your PIN.
        Orders not picked up are released without charge. Times in Pacific Time.</p>
      <div class="small-print">support@rescuebites.app</div>
    </div>`;
} catch (err) {
  showError($('#msg'), err);
  $('#receipt').classList.add('hidden');
}
