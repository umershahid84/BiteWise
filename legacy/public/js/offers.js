import { api, $, esc, money, pct, fmtTime, countdown, renderHeader, requireRole, showError, openModal, withBusy, cuisineEmoji, cuisineHue, pinTiles } from './common.js';
import { confetti } from './confetti.js';
import { createCardEntry, cardText, getConfig } from './cards.js';

await requireRole('customer');
renderHeader('offers');

const grid = $('#offers');
const msg = $('#msg');
let origin = null;
try {
  origin = JSON.parse(sessionStorage.getItem('rb-origin') || 'null');
} catch { /* storage unavailable */ }

const config = await getConfig();
for (const tag of config.dietaryTags) $('#f-diet').insertAdjacentHTML('beforeend', `<option value="${esc(tag)}">${esc(tag[0].toUpperCase() + tag.slice(1))}</option>`);

let offers = [];
let lastSearch = null;
let debounce;
let view = 'list';
try { view = sessionStorage.getItem('rb-view') === 'map' ? 'map' : 'list'; } catch { /* ignore */ }

// City / ZIP suggestions for the area box.
api('/auth/areas').then(({ cities, zips }) => {
  $('#area-list').innerHTML = cities.map((c) => `<option value="${esc(c.name)}">${esc(c.county)} County</option>`).join('')
    + zips.map((z) => `<option value="${z.zip}">${esc(z.city)}</option>`).join('');
}).catch(() => {});

async function load() {
  const params = new URLSearchParams();
  const set = (k, v) => v && params.set(k, v);
  set('q', $('#f-q').value.trim());
  set('area', $('#f-area').value.trim());
  set('dietary', $('#f-diet').value);
  set('sort', $('#f-sort').value);
  if (origin) {
    set('lat', origin.lat);
    set('lng', origin.lng);
  }
  set('radius', $('#f-radius').value);
  try {
    const res = await api(`/offers?${params}`);
    offers = res.offers;
    lastSearch = res;
    $('#area-note').textContent = res.place
      ? `Showing deals within ${res.radius} miles of ${res.place.label}. Change the distance filter to widen the search.`
      : '';
    showError(msg, null);
    render();
    renderMap(params.toString());
  } catch (err) {
    showError(msg, err);
  }
}

function render() {
  if (!offers.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><img src="/assets/logo-mark.svg" alt=""><h3>No deals match right now</h3>
      <p>New surplus food is posted throughout the day. Check back soon or widen your search.</p></div>`;
    return;
  }
  grid.innerHTML = offers.map((o) => `
    <article class="offer">
      <div class="offer-top ${o.imageUrl ? 'photo' : ''}" style="--h:${cuisineHue(o.restaurant.cuisine)}">${o.imageUrl
        ? `<img src="${esc(o.imageUrl)}" alt="${esc(o.title)}" loading="lazy">`
        : `<span class="emoji" aria-hidden="true">${cuisineEmoji(o.restaurant.cuisine)}</span>`}
        <span class="badge-off">-${o.discountPct}%</span>
        <span class="badge-left ${o.quantityAvailable <= 2 ? 'low' : ''}">${o.quantityAvailable} left</span>
        <span class="timer-pill">${countdown(o.pickupEnd)}</span>
      </div>
      <div class="offer-body">
        <h3>${esc(o.title)}</h3>
        <div class="offer-rest">${esc(o.restaurant.name)} · ${esc(o.restaurant.city)}</div>
        <div class="offer-meta">
          <span>🕒 Pick up by ${fmtTime(o.pickupEnd)}</span>
          ${o.distanceMiles != null ? `<span>📍 ${o.distanceMiles} mi</span>` : ''}
        </div>
        <div class="chips"><span class="chip reason">${esc(o.reasonLabel)}</span>${o.dietary.map((d) => `<span class="chip diet">${esc(d)}</span>`).join('')}</div>
        <div class="price-row"><span class="price">${money(o.priceCents)}</span><span class="was">${money(o.originalPriceCents)}</span>
          <span class="spacer"></span><button class="btn btn-primary btn-sm" data-id="${o.id}">Order</button></div>
      </div>
    </article>`).join('');
}

// When a deal's timer runs out while the page is open, grey it out.
grid.addEventListener('expired', (e) => {
  const card = e.target.closest('.offer');
  if (!card) return;
  card.classList.add('is-expired');
  const btn = card.querySelector('button[data-id]');
  if (btn) { btn.disabled = true; btn.textContent = 'Expired'; }
});

grid.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-id]');
  if (btn) openCheckout(offers.find((o) => o.id === Number(btn.dataset.id)));
});

$('#filters').addEventListener('input', () => {
  clearTimeout(debounce);
  debounce = setTimeout(load, 250);
});
$('#filters').addEventListener('submit', (e) => e.preventDefault());

$('#locate-btn').addEventListener('click', () => {
  if (!navigator.geolocation) return showError(msg, 'Location is not available in this browser.');
  $('#locate-btn').textContent = 'Locating…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      origin = { lat: pos.coords.latitude.toFixed(4), lng: pos.coords.longitude.toFixed(4) };
      try { sessionStorage.setItem('rb-origin', JSON.stringify(origin)); } catch { /* ignore */ }
      $('#locate-btn').textContent = '📍 Location on';
      load();
    },
    () => {
      $('#locate-btn').textContent = '📍 Use my location';
      showError(msg, 'We could not get your location. You can search by city or ZIP instead.');
    },
    { timeout: 10000, maximumAge: 600000 },
  );
});
if (origin) $('#locate-btn').textContent = '📍 Location on';

// ---------- Checkout ----------

async function openCheckout(offer) {
  const r = offer.restaurant;
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.name}, ${r.address}, ${r.city}, WA ${r.zip}`)}`;
  const modal = openModal(offer.title, `
    ${offer.imageUrl ? `<div class="checkout-photo"><img src="${esc(offer.imageUrl)}" alt="${esc(offer.title)}"><span class="badge-off">-${offer.discountPct}%</span></div>` : ''}
    <p style="margin:0 0 6px"><b>${esc(r.name)}</b>${r.cuisine ? ` · ${esc(r.cuisine)}` : ''}</p>
    <p class="small muted" style="margin:0 0 10px">${esc(r.address)}, ${esc(r.city)}, WA ${esc(r.zip)} · <a href="${mapUrl}" target="_blank" rel="noopener">Map</a>
      ${r.phone ? ` · <a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>` : ''}</p>
    ${offer.description ? `<p>${esc(offer.description)}</p>` : ''}
    <div class="chips" style="margin-bottom:10px"><span class="chip reason">Why it's discounted: ${esc(offer.reasonLabel)}</span>
      ${offer.dietary.map((d) => `<span class="chip diet">${esc(d)}</span>`).join('')}</div>
    <div class="alert alert-warn small">${countdown(offer.pickupEnd, { suffix: ' until this food is discarded' })}<br>
      Pick up by <b>${fmtTime(offer.pickupEnd)}</b>. If you don't make it, your order is released and you're not charged.</div>

    <div class="row"><span class="section-label" style="margin:0">Quantity</span><span class="spacer"></span>
      <div class="qty"><button type="button" data-q="-1" aria-label="Fewer">−</button><span id="qty">1</span><button type="button" data-q="1" aria-label="More">+</button></div></div>
    <div class="small muted" id="qty-note" style="text-align:right;margin-top:6px"></div>

    <div class="section-label">Order summary</div>
    <div class="summary-box"><table class="breakdown" id="breakdown"></table></div>

    <div class="section-label">Payment</div>
    <div id="credit-box" class="credit-box hidden">
      <label class="check"><input type="checkbox" id="use-credit" checked> <span>Use my Rescue Bites credit · <b id="credit-avail"></b> available</span></label>
      <div class="timer-custom" id="credit-amt-row"><span class="muted">Apply $</span><input id="credit-amt" inputmode="decimal" style="width:120px">
        <span class="muted small" id="credit-hint"></span></div>
    </div>
    <div id="card-section">
    <div id="pay-options"></div>
    <div id="new-card" class="card-entry hidden">
      <div id="card-mount"></div>
      <label class="check" style="margin-top:8px"><input type="checkbox" id="save-card" checked> Save this card for future orders</label>
    </div>
    </div>
    <p class="small muted" style="margin:12px 0">🔒 We'll place a temporary hold for the total now. <b>Your card is charged only when you pick up</b> and the restaurant enters your PIN.</p>
    <div id="co-msg"></div>
    <button class="btn btn-primary btn-block" id="place-btn">Place order</button>`);

  const body = modal.body;
  let quantity = 1;
  // The restaurant decides how many are available; customers can't order more than that.
  const max = offer.quantityAvailable;
  let lastTotal = 0;
  let creditBalance = 0;
  let creditTouched = false;

  // Platform credit: customers choose whether and how much to apply; the card covers the rest.
  const creditCents = () => {
    if (!creditBalance || !$('#use-credit', body).checked) return 0;
    const typed = Math.round(Number($('#credit-amt', body).value.replace(/[$,]/g, '')) * 100) || 0;
    return Math.max(0, Math.min(typed, creditBalance, lastTotal));
  };
  function syncCredit() {
    const credit = creditCents();
    const card = lastTotal - credit;
    $('#credit-amt-row', body).classList.toggle('hidden', !$('#use-credit', body).checked);
    $('#credit-hint', body).textContent = `up to ${money(Math.min(creditBalance, lastTotal))}`;
    $('#card-section', body).classList.toggle('hidden', card === 0);
    const rows = $('#credit-rows', body);
    if (rows) rows.innerHTML = credit
      ? `<tr><td class="save">Rescue Bites credit applied</td><td class="save">−${money(credit)}</td></tr>
         <tr class="total"><td>${card ? 'Card (charged at pickup)' : 'Due'}</td><td>${money(card)}</td></tr>` : '';
    $('#place-btn', body).textContent = card ? `Place order · ${money(card)}${credit ? ' + credit' : ''}` : 'Place order · paid with credit';
  }

  async function refreshQuote() {
    $('#qty', body).textContent = quantity;
    $('[data-q="-1"]', body).disabled = quantity <= 1;
    $('[data-q="1"]', body).disabled = quantity >= max;
    $('#qty-note', body).innerHTML = quantity >= max
      ? `<span style="color:var(--accent-ink)">That's all ${max === 1 ? 'there is' : `${max} available`}. The restaurant set this limit.</span>`
      : `${max} available`;
    try {
      const { quote: q } = await api('/quote', { method: 'POST', body: { offerId: offer.id, quantity } });
      $('#breakdown', body).innerHTML = `
        <tr><td>${q.quantity} × ${esc(offer.title)} <span class="was small">${money(q.originalUnitCents)}</span> ${money(q.unitPriceCents)}</td><td>${money(q.subtotalCents)}</td></tr>
        <tr><td colspan="2" class="save">You save ${money(q.savingsCents)} (${q.discountPct}% off)</td></tr>
        <tr><td>Service fee (${pct(q.serviceFeeBps)})</td><td>${money(q.serviceFeeCents)}</td></tr>
        <tr><td>WA sales tax (${pct(q.taxRateBps)})</td><td>${money(q.taxCents)}</td></tr>
        <tr class="total"><td>Total</td><td>${money(q.totalCents)}</td></tr>
        <tbody id="credit-rows"></tbody>`;
      lastTotal = q.totalCents;
      if (creditBalance && !creditTouched) $('#credit-amt', body).value = (Math.min(creditBalance, lastTotal) / 100).toFixed(2);
      syncCredit();
      showError($('#co-msg', body), null);
    } catch (err) {
      showError($('#co-msg', body), err);
    }
  }

  body.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => {
    quantity = Math.max(1, Math.min(max, quantity + Number(b.dataset.q)));
    refreshQuote();
  }));

  // Payment options: platform credit, saved cards, new card.
  const [{ cards }, credit] = await Promise.all([api('/cards'), api('/credit')]);
  creditBalance = credit.balanceCents;
  if (creditBalance > 0) {
    $('#credit-box', body).classList.remove('hidden');
    $('#credit-avail', body).textContent = money(creditBalance);
    $('#use-credit', body).addEventListener('change', syncCredit);
    $('#credit-amt', body).addEventListener('input', () => { creditTouched = true; syncCredit(); });
  }
  $('#pay-options', body).innerHTML = cards.map((c, i) => `
      <label class="pay-option"><input type="radio" name="pay" value="${c.id}" ${i === 0 ? 'checked' : ''}> 💳 ${cardText(c)}
        <span class="muted small">exp ${String(c.exp_month).padStart(2, '0')}/${String(c.exp_year).slice(-2)}</span></label>`).join('') +
    `<label class="pay-option"><input type="radio" name="pay" value="new" ${cards.length ? '' : 'checked'}> ➕ Use a new card</label>`;
  const cardEntry = await createCardEntry($('#card-mount', body));
  const syncPay = () => $('#new-card', body).classList.toggle('hidden', body.querySelector('input[name=pay]:checked').value !== 'new');
  body.querySelectorAll('input[name=pay]').forEach((i) => i.addEventListener('change', syncPay));
  syncPay();
  refreshQuote();

  $('#place-btn', body).addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    const coMsg = $('#co-msg', body);
    try {
      const choice = body.querySelector('input[name=pay]:checked').value;
      const payload = { offerId: offer.id, quantity, creditCents: creditCents() };
      const needsCard = payload.creditCents < lastTotal; // no card when credit covers the whole total
      if (needsCard && choice === 'new') payload.newCard = { token: await cardEntry.getToken(), save: $('#save-card', body).checked };
      else if (needsCard) payload.cardId = Number(choice);

      let { order, requiresAction, clientSecret } = await api('/orders', { method: 'POST', body: payload });
      if (requiresAction) {
        await cardEntry.handleAction(clientSecret);
        ({ order } = await api(`/orders/${order.id}/confirm-payment`, { method: 'POST' }));
      }
      showConfirmation(modal, order, offer);
      load();
    } catch (err) {
      showError(coMsg, err);
      if (err.status === 404 || err.status === 409) load();
    }
  }));
}

function showConfirmation(modal, order, offer) {
  const r = order.restaurant;
  modal.el.querySelector('.modal-head h2').textContent = '';
  modal.body.innerHTML = `
    <div class="celebrate">
      ${offer.imageUrl ? `<img class="photo" src="${esc(offer.imageUrl)}" alt="${esc(order.itemTitle)}">` : '<div class="burst" aria-hidden="true">🎉</div>'}
      <h2>🎉 Congratulations!</h2>
      <p class="muted" style="margin:0">Your food is secured. You just rescued ${order.quantity === 1 ? 'a meal' : `${order.quantity} meals`} from going to waste.</p>
      <div class="pin-panel">
        <small>Your pickup PIN</small>
        ${pinTiles(order.pin)}
        <div class="small" style="opacity:.9">Show this PIN at the counter</div>
      </div>
      <div class="details">
        <b>${order.quantity} × ${esc(order.itemTitle)}</b><br>
        <span class="muted">${esc(r.name)} · ${esc(r.address)}, ${esc(r.city)}</span><br>
        Pick up by <b>${fmtTime(order.pickupEnd)}</b> · ${countdown(order.pickupEnd)}<br>
        💳 ${esc(order.cardLabel)} will be charged <b>${money(order.totalCents)}</b> only when the restaurant enters your PIN.
      </div>
      <div class="row" style="justify-content:center;margin-top:18px">
        <a class="btn btn-primary" href="/orders">View my orders</a><a class="btn btn-ghost" href="/receipt?order=${order.id}">🧾 Receipt</a><button class="btn btn-ghost" id="keep-browsing">Keep browsing</button>
      </div>
    </div>`;
  $('#keep-browsing', modal.body).addEventListener('click', modal.close);
  confetti();
}

// ---------- Map view ----------
let map;
let markers;
let youMarker;
let lastFitKey = null;

function setView(v) {
  view = v;
  try { sessionStorage.setItem('rb-view', v); } catch { /* ignore */ }
  document.querySelectorAll('.view-toggle button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  $('#map-wrap').classList.toggle('hidden', v !== 'map');
  grid.classList.toggle('hidden', v === 'map');
  if (v === 'map') {
    ensureMap();
    setTimeout(() => { map.invalidateSize(); renderMap(null, true); }, 0);
  }
}
document.querySelectorAll('.view-toggle button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

function ensureMap() {
  if (map) return;
  const L = window.L;
  map = L.map('map', { zoomControl: true, scrollWheelZoom: true, minZoom: 7, maxZoom: 18 }).setView([47.45, -122.3], 9);
  L.tileLayer(config.map.tileUrl, { attribution: config.map.attribution, maxZoom: 19 }).addTo(map);
  if (config.map.darkFilter) $('#map').classList.add('dark-tiles');
  markers = L.layerGroup().addTo(map);
  map.on('popupopen', (e) => {
    e.popup.getElement().querySelectorAll('[data-open]').forEach((btn) => btn.addEventListener('click', () => {
      map.closePopup();
      openCheckout(offers.find((o) => o.id === Number(btn.dataset.open)));
    }));
  });
}

function renderMap(searchKey, forceFit = false) {
  if (!map || view !== 'map') return;
  const L = window.L;
  markers.clearLayers();
  // One pin per restaurant, listing all of its deals.
  const byRestaurant = new Map();
  for (const o of offers) {
    if (o.restaurant.lat == null || o.restaurant.lng == null) continue;
    if (!byRestaurant.has(o.restaurant.id)) byRestaurant.set(o.restaurant.id, { r: o.restaurant, list: [] });
    byRestaurant.get(o.restaurant.id).list.push(o);
  }
  const points = [];
  for (const { r, list } of byRestaurant.values()) {
    const best = Math.max(...list.map((o) => o.discountPct));
    const icon = L.divIcon({
      className: 'map-pin-wrap',
      html: `<div class="map-pin"><span>${cuisineEmoji(r.cuisine)}</span><b>-${best}%</b>${list.length > 1 ? `<i>${list.length}</i>` : ''}</div>`,
      iconSize: [74, 34], iconAnchor: [37, 40], popupAnchor: [0, -38],
    });
    const html = `
      <div class="map-popup">
        <div class="mp-head"><b>${esc(r.name)}</b><span>${esc(r.cuisine || '')}${r.cuisine ? ' · ' : ''}${esc(r.city)}</span>
          <small>${esc(r.address)}, ${esc(r.city)} ${esc(r.zip)}</small></div>
        ${list.map((o) => `
        <div class="mp-offer">
          ${o.imageUrl ? `<img src="${esc(o.imageUrl)}" alt="">` : `<div class="mp-emoji">${cuisineEmoji(r.cuisine)}</div>`}
          <div class="mp-info"><b>${esc(o.title)}</b>
            <div><span class="mp-price">${money(o.priceCents)}</span> <s>${money(o.originalPriceCents)}</s> <span class="mp-off">-${o.discountPct}%</span></div>
            <small>${o.quantityAvailable} left · ${countdown(o.pickupEnd, { prefix: '⏳', suffix: '' })}${o.distanceMiles != null ? ` · ${o.distanceMiles} mi` : ''}</small></div>
          <button class="btn btn-primary btn-sm" data-open="${o.id}">View</button>
        </div>`).join('')}
      </div>`;
    L.marker([r.lat, r.lng], { icon, title: r.name, riseOnHover: true }).bindPopup(html, { maxWidth: 340, minWidth: 260 }).addTo(markers);
    points.push([r.lat, r.lng]);
  }
  if (youMarker) youMarker.remove();
  const center = lastSearch?.origin;
  if (center) {
    youMarker = L.circleMarker([center.lat, center.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#3b82f6', fillOpacity: 1 })
      .bindTooltip(lastSearch.place ? lastSearch.place.label : 'You are here').addTo(map);
  }
  // Re-fit only when the search changes, so zooming and panning aren't undone by refreshes.
  const fitKey = searchKey ?? lastFitKey;
  if (forceFit || fitKey !== lastFitKey) {
    lastFitKey = fitKey;
    const all = center ? [...points, [center.lat, center.lng]] : points;
    if (all.length > 1) map.fitBounds(all, { padding: [40, 40], maxZoom: 14 });
    else if (all.length === 1) map.setView(all[0], 13);
  }
}

setView(view);
load();
