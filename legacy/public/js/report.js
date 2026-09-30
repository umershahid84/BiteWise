import { api, $, esc, money, renderHeader, requireRole, showError } from './common.js';

await requireRole('restaurant');
renderHeader('dash');

const input = $('#report-date');
const params = new URLSearchParams(location.search);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
input.value = params.get('date') || today;
input.max = today;
$('#print-btn').addEventListener('click', () => print());

async function load() {
  const date = input.value;
  history.replaceState(null, '', `?date=${date}`);
  $('#pdf-btn').href = `/api/restaurant/report.pdf?date=${date}`;
  $('#csv-btn').href = `/api/restaurant/report.csv?date=${date}`;
  try {
    const { report: r } = await api(`/restaurant/report?date=${encodeURIComponent(date)}`);
    showError($('#msg'), null);
    document.title = `Daily report ${r.date} · Rescue Bites`;
    const s = r.summary;
    $('#report').innerHTML = `
      <div class="p-head">
        <img src="/assets/logo.svg" alt="Rescue Bites">
        <div class="p-title"><h1>Daily sales report</h1>
          <div class="small"><b>${esc(r.restaurant.name)}</b> · ${esc(r.dateText)}</div>
          <div class="p-muted small">${esc(r.restaurant.address)}, ${esc(r.restaurant.city)}, WA ${esc(r.restaurant.zip)}${r.restaurant.phone ? ` · ${esc(r.restaurant.phone)}` : ''}</div></div>
      </div>
      <div class="p-kpis">
        <div><div class="p-label">Food sales</div><b>${money(s.foodSalesCents)}</b></div>
        <div><div class="p-label">Orders picked up</div><b>${s.ordersPickedUp}</b></div>
        <div><div class="p-label">Meals rescued</div><b>${s.mealsRescued}</b></div>
        <div><div class="p-label">Discounts given</div><b>${money(s.discountsCents)}</b></div>
        <div><div class="p-label">Sales tax</div><b>${money(s.salesTaxCents)}</b></div>
        <div><div class="p-label">Total charged</div><b>${money(s.totalChargedCents)}</b></div>
      </div>
      <p class="p-muted small" style="margin:0 0 16px">Menu value ${money(s.menuValueCents)} · Rescue Bites service fees paid by customers ${money(s.serviceFeesCents)} ·
        Awaiting pickup ${s.awaitingPickup} · Cancelled ${s.cancelled} · Not picked up ${s.notPickedUp}</p>
      <div class="table-scroll"><table class="report-table">
        <thead><tr><th>#</th><th>Ordered</th><th>Picked up</th><th style="text-align:left">Customer</th><th style="text-align:left">Item</th><th>Qty</th>
          <th>Original</th><th>Disc.</th><th>Price</th><th>Food</th><th>Tax</th><th>Total</th><th style="text-align:left">Card</th><th style="text-align:left">Status</th></tr></thead>
        <tbody>${r.orders.length ? r.orders.map((o) => `<tr>
          <td>${o.id}</td><td>${esc(o.orderedTime)}</td><td>${esc(o.pickedUpTime || '-')}</td><td style="text-align:left">${esc(o.customer)}</td>
          <td style="text-align:left"><b>${esc(o.item)}</b></td><td>${o.quantity}</td><td class="strike">${money(o.originalUnitCents)}</td>
          <td class="disc">${o.discountPct}%</td><td>${money(o.unitPriceCents)}</td><td>${money(o.subtotalCents)}</td><td>${money(o.taxCents)}</td>
          <td><b>${money(o.totalCents)}</b></td><td style="text-align:left;white-space:nowrap">${esc(o.card)}</td>
          <td style="text-align:left"><span class="st ${o.status}">${esc(o.statusLabel)}</span></td></tr>`).join('')
          : '<tr><td colspan="14" style="text-align:center;padding:24px" class="p-muted">No orders on this day.</td></tr>'}</tbody>
      </table></div>
      <p class="p-foot" style="margin-top:14px">Sales totals include orders picked up (and charged) on this day. Times in Pacific Time. Generated ${esc(r.generatedAtText)}.</p>`;
  } catch (err) {
    showError($('#msg'), err);
  }
}

input.addEventListener('change', load);
load();
