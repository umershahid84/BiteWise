import { api, $, $$, esc, money, fmtDateTime, fmtTime, renderHeader, requireRole, showError, openModal, withBusy, toast } from './common.js';

await requireRole('admin');
renderHeader('admin');

const msg = $('#admin-msg');
const panels = { overview, restaurants, customers, orders, offers, payouts, tax, settings, audit };
let current = 'overview';

function showTab(name) {
  current = name;
  $$('#admin-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  $$('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== name));
  showError(msg, null);
  panels[name]($(`[data-panel="${name}"]`)).catch((err) => showError(msg, err));
  try { history.replaceState(null, '', `#${name}`); } catch { /* ignore */ }
}
$$('#admin-tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

const todayPT = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
const daysAgo = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(Date.now() - n * 86400000));
const dateRange = { from: daysAgo(29), to: todayPT() };
const rangeQs = () => `from=${dateRange.from}&to=${dateRange.to}`;

function rangePicker(onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'row range-pick';
  wrap.innerHTML = `
    <label class="date-pick">From <input type="date" data-k="from" value="${dateRange.from}" max="${todayPT()}"></label>
    <label class="date-pick">To <input type="date" data-k="to" value="${dateRange.to}" max="${todayPT()}"></label>
    ${[['7 days', 6], ['30 days', 29], ['90 days', 89]].map(([l, n]) => `<button type="button" class="btn btn-ghost btn-sm" data-n="${n}">${l}</button>`).join('')}`;
  wrap.addEventListener('change', (e) => {
    if (e.target.dataset.k) { dateRange[e.target.dataset.k] = e.target.value; onChange(); }
  });
  wrap.addEventListener('click', (e) => {
    const n = e.target.dataset?.n;
    if (n === undefined) return;
    dateRange.from = daysAgo(Number(n));
    dateRange.to = todayPT();
    onChange();
  });
  return wrap;
}

const statusLabel = { reserved: 'Awaiting pickup', picked_up: 'Picked up', cancelled: 'Cancelled', expired: 'Not picked up', pending_payment: 'Processing',
  approved: 'Approved', pending: 'Pending approval', suspended: 'Suspended', active: 'Active', paused: 'Paused' };
const pill = (s) => `<span class="status ${esc(s === 'approved' ? 'active' : s === 'pending' ? 'reserved' : s)}">${esc(statusLabel[s] || s)}</span>`;
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');

// ---------------- Overview ----------------
async function overview(panel) {
  const d = await api(`/admin/overview?${rangeQs()}`);
  const t = d.totals;
  const n = d.now;
  const pending = n.restaurants.pending || 0;
  setBadge(pending);
  panel.innerHTML = '';
  panel.append(rangePicker(() => overview(panel)));
  panel.insertAdjacentHTML('beforeend', `
    ${pending ? `<div class="alert alert-warn" style="margin-top:14px">🏪 <b>${pending} restaurant${pending > 1 ? 's are' : ' is'} waiting for approval.</b>
      <a href="#restaurants" data-go="restaurants">Review now →</a></div>` : ''}
    <div class="section-label">${esc(day(`${d.range.from}T12:00:00Z`))} – ${esc(day(`${d.range.to}T12:00:00Z`))} · completed orders</div>
    <div class="kpis kpis-4">
      <div class="kpi"><b>${money(t.serviceFeesCents)}</b><span>Bite Wise revenue (service fees)</span></div>
      <div class="kpi"><b>${money(t.gmvCents)}</b><span>Total charged to customers</span></div>
      <div class="kpi"><b>${money(t.foodSalesCents)}</b><span>Restaurant food sales</span></div>
      <div class="kpi"><b>${money(t.salesTaxCents)}</b><span>Sales tax collected</span></div>
      <div class="kpi"><b>${t.ordersPickedUp}</b><span>Orders picked up</span></div>
      <div class="kpi"><b>${t.mealsRescued}</b><span>Meals rescued from waste</span></div>
      <div class="kpi"><b>${money(t.discountsCents)}</b><span>Customer savings</span></div>
      <div class="kpi"><b>${money(t.refundsCents)}</b><span>Refunds to original payment</span></div>
      <div class="kpi"><b>${money(t.creditRefundsCents)}</b><span>Refunds as platform credit (your cost)</span></div>
      <div class="kpi"><b>${money(t.creditRedeemedCents)}</b><span>Platform credit used on orders</span></div>
      <div class="kpi"><b>${money(t.cardChargedCents)}</b><span>Charged to cards (net)</span></div>
      <div class="kpi"><b>${money(n.creditOutstandingCents)}</b><span>Platform credit outstanding</span></div>
    </div>
    <div class="card chart-card">
      <div class="row"><h3 style="margin:0">Daily total charged</h3><span class="spacer"></span><span class="muted small">Hover a bar for details</span></div>
      <div id="daily-chart"></div>
      <details class="small"><summary>Show as table</summary>
        <div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Orders</th><th>Meals</th><th>Total charged</th><th>Food sales</th><th>Service fees</th></tr></thead>
        <tbody>${d.daily.map((x) => `<tr><td>${esc(day(`${x.date}T12:00:00Z`))}</td><td>${x.orders}</td><td>${x.meals}</td><td>${money(x.gmvCents)}</td><td>${money(x.foodCents)}</td><td>${money(x.feesCents)}</td></tr>`).join('')}</tbody></table></div>
      </details>
    </div>
    <div class="split" style="margin-top:20px">
      <div class="card"><h3>Right now</h3>
        <table class="data"><tbody>
          <tr><td>Customers</td><td><b>${n.customers}</b></td></tr>
          <tr><td>Restaurants approved / pending / suspended</td><td><b>${n.restaurants.approved || 0}</b> / <b>${pending}</b> / <b>${n.restaurants.suspended || 0}</b></td></tr>
          <tr><td>Live offers</td><td><b>${n.activeOffers}</b></td></tr>
          <tr><td>Orders awaiting pickup</td><td><b>${n.awaitingPickup}</b></td></tr>
          <tr><td>Payouts owed to restaurants</td><td><b>${money(n.payoutsOwedCents)}</b> <a href="#payouts" data-go="payouts" class="small">Pay →</a></td></tr>
          <tr><td>Orders placed · cancelled · not picked up (period)</td><td><b>${Object.values(t.placed).reduce((a, b) => a + b, 0)}</b> · ${t.placed.cancelled || 0} · ${t.placed.expired || 0}</td></tr>
        </tbody></table></div>
      <div class="card"><h3>Top restaurants (period)</h3>
        ${d.topRestaurants.length ? `<table class="data"><thead><tr><th>Restaurant</th><th>Orders</th><th>Meals</th><th>Food sales</th></tr></thead><tbody>
          ${d.topRestaurants.map((r) => `<tr><td><b>${esc(r.name)}</b><div class="muted small">${esc(r.city)}</div></td><td>${r.orders}</td><td>${r.meals}</td><td>${money(r.food_cents)}</td></tr>`).join('')}</tbody></table>`
          : '<p class="muted">No completed orders in this period yet.</p>'}</div>
    </div>`);
  drawDaily($('#daily-chart', panel), d.daily);
  panel.onclick = (e) => { const go = e.target.closest('[data-go]'); if (go) { e.preventDefault(); showTab(go.dataset.go); } };
}

// Single-series bar chart (one hue, validated against the dark surface), with per-bar tooltip.
function drawDaily(el, rows) {
  const W = el.clientWidth || 900;
  const H = 240;
  const m = { t: 12, r: 12, b: 28, l: 56 };
  const max = Math.max(100, ...rows.map((r) => r.gmvCents));
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const bw = iw / rows.length;
  const barW = Math.max(2, Math.min(28, bw - 2));
  const y = (v) => m.t + ih - (v / top) * ih;
  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  const labelEvery = Math.ceil(rows.length / 10);
  el.innerHTML = `<svg width="100%" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily total charged, bar chart">
    ${ticks.map((v) => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/>
      <text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end" class="axis">${money(v).replace('.00', '')}</text>`).join('')}
    ${rows.map((r, i) => {
      const x = m.l + i * bw + (bw - barW) / 2;
      const h = Math.max(r.gmvCents ? 2 : 0, (r.gmvCents / top) * ih);
      const rad = Math.min(4, barW / 2, h);
      return `<g class="bar" data-i="${i}">
        <rect x="${m.l + i * bw}" y="${m.t}" width="${bw}" height="${ih}" fill="transparent"/>
        ${h ? `<path d="M${x},${m.t + ih} v${-(h - rad)} q0,${-rad} ${rad},${-rad} h${barW - 2 * rad} q${rad},0 ${rad},${rad} v${h - rad} z" fill="#0fa874"/>` : ''}
        ${i % labelEvery === 0 ? `<text x="${m.l + i * bw + bw / 2}" y="${H - 8}" text-anchor="middle" class="axis">${esc(new Date(`${r.date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }))}</text>` : ''}
      </g>`;
    }).join('')}
    <line x1="${m.l}" x2="${W - m.r}" y1="${m.t + ih}" y2="${m.t + ih}" stroke="var(--muted)" stroke-width="1"/>
  </svg><div class="chart-tip hidden"></div>`;
  const tip = $('.chart-tip', el);
  el.querySelectorAll('.bar').forEach((g) => {
    g.addEventListener('mouseenter', () => {
      const r = rows[Number(g.dataset.i)];
      tip.innerHTML = `<b>${esc(new Date(`${r.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }))}</b>
        <div>Total charged <b>${money(r.gmvCents)}</b></div><div>Orders ${r.orders} · Meals ${r.meals}</div><div>Service fees ${money(r.feesCents)}</div>`;
      tip.classList.remove('hidden');
      const box = g.getBoundingClientRect();
      const host = el.getBoundingClientRect();
      tip.style.left = `${Math.min(host.width - 190, Math.max(0, box.left - host.left + box.width / 2 - 90))}px`;
      g.classList.add('hover');
    });
    g.addEventListener('mouseleave', () => { tip.classList.add('hidden'); g.classList.remove('hover'); });
  });
}
function niceStep(x) {
  const p = 10 ** Math.floor(Math.log10(x));
  return [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => s >= x) || p * 10;
}

// ---------------- Restaurants ----------------
async function restaurants(panel) {
  panel.innerHTML = `
    <div class="row filters-row">
      <input type="search" id="r-q" placeholder="Search name, city, ZIP or owner email" style="max-width:340px">
      <select id="r-status" style="max-width:220px"><option value="">All statuses</option><option value="pending">Pending approval</option>
        <option value="approved">Approved</option><option value="suspended">Suspended</option></select>
    </div>
    <div id="r-list"></div>`;
  const load = async () => {
    const { restaurants: list } = await api(`/admin/restaurants?q=${encodeURIComponent($('#r-q', panel).value)}&status=${$('#r-status', panel).value}`);
    $('#r-list', panel).innerHTML = list.length ? `<div class="card table-wrap" style="padding:8px"><table class="data">
      <thead><tr><th>Restaurant</th><th>Owner</th><th>Status</th><th>Live offers</th><th>Orders</th><th>Food sales</th><th>Joined</th><th></th></tr></thead>
      <tbody>${list.map((r) => `<tr>
        <td><b>${esc(r.name)}</b><div class="muted small">${esc(r.cuisine || '')}${r.cuisine ? ' · ' : ''}${esc(r.address)}, ${esc(r.city)} ${esc(r.zip)}${r.phone ? ` · ${esc(r.phone)}` : ''}</div>
          ${r.admin_note ? `<div class="small" style="color:var(--accent-ink)">Note: ${esc(r.admin_note)}</div>` : ''}</td>
        <td class="small">${esc(r.owner_username)}<div class="muted">${esc(r.owner_email)}</div></td>
        <td>${pill(r.status)}</td><td>${r.active_offers}</td><td>${r.orders}</td><td>${money(r.food_cents)}</td><td class="small">${esc(day(r.created_at))}</td>
        <td style="white-space:nowrap">
          ${r.status !== 'approved' ? `<button class="btn btn-primary btn-sm" data-act="approved" data-id="${r.id}">${r.status === 'pending' ? 'Approve' : 'Reinstate'}</button>` : ''}
          ${r.status !== 'suspended' ? `<button class="btn btn-danger btn-sm" data-act="suspended" data-id="${r.id}">Suspend</button>` : ''}
        </td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><h3>No restaurants match</h3></div>';
  };
  panel.addEventListener('input', debounce(load));
  panel.onclick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const suspend = b.dataset.act === 'suspended';
    const note = suspend ? prompt('Reason for suspending (shown to your team in the audit log):', '') : '';
    if (suspend && note === null) return;
    try {
      await api(`/admin/restaurants/${b.dataset.id}/status`, { method: 'POST', body: { status: b.dataset.act, note: note || '' } });
      toast(suspend ? 'Restaurant suspended. Its offers are hidden.' : 'Restaurant approved. Its offers are now live.');
      load();
      refreshBadge();
    } catch (err) { toast(err.message); }
  };
  await load();
}

// ---------------- Customers ----------------
async function customers(panel) {
  panel.innerHTML = `
    <div class="row filters-row">
      <input type="search" id="c-q" placeholder="Search email or user name" style="max-width:340px">
      <select id="c-role" style="max-width:220px"><option value="customer">Customers</option><option value="restaurant">Restaurant owners</option><option value="admin">Admins</option></select>
    </div><div id="c-list"></div>`;
  const load = async () => {
    const { users } = await api(`/admin/users?role=${$('#c-role', panel).value}&q=${encodeURIComponent($('#c-q', panel).value)}`);
    $('#c-list', panel).innerHTML = users.length ? `<div class="card table-wrap" style="padding:8px"><table class="data">
      <thead><tr><th>User</th><th>Status</th><th>Completed orders</th><th>Spent</th><th>Platform credit</th><th>No-shows</th><th>Terms accepted</th><th>Joined</th><th></th></tr></thead>
      <tbody>${users.map((u) => `<tr>
        <td><b>${esc(u.username)}</b><div class="muted small">${esc(u.email)}</div></td>
        <td>${pill(u.status)}</td><td>${u.orders}</td><td>${money(u.spent_cents)}</td><td>${u.role === 'customer' ? `<b>${money(u.credit_cents)}</b>` : ''}</td><td>${u.no_shows}</td>
        <td class="small">${u.terms_accepted_at ? esc(day(u.terms_accepted_at)) : '<span class="muted">n/a</span>'}</td><td class="small">${esc(day(u.created_at))}</td>
        <td style="white-space:nowrap">${u.role === 'customer' ? `<button class="btn btn-ghost btn-sm" data-credit="${u.id}" data-name="${esc(u.username)}">+ Credit</button> ` : ''}${u.role === 'admin' ? '' : u.status === 'active'
          ? `<button class="btn btn-danger btn-sm" data-user="${u.id}" data-status="suspended">Suspend</button>`
          : `<button class="btn btn-ghost btn-sm" data-user="${u.id}" data-status="active">Reactivate</button>`}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty"><h3>No users match</h3></div>';
  };
  panel.addEventListener('input', debounce(load));
  panel.addEventListener('change', load);
  panel.onclick = async (e) => {
    const cr = e.target.closest('[data-credit]');
    if (cr) {
      const m = openModal(`Issue platform credit · ${cr.dataset.name}`, `
        <div class="field"><label for="gc-amt">Amount ($)</label><input id="gc-amt" inputmode="decimal" placeholder="5.00"></div>
        <div class="field"><label for="gc-reason">Reason</label><input id="gc-reason" maxlength="300" placeholder="e.g. Sorry for the wait"></div>
        <p class="small muted">Platform credit is paid by you (Bite Wise). Restaurants receive their full payment when it's used.</p>
        <div id="gc-msg"></div><button class="btn btn-primary btn-block" id="gc-go">Issue credit</button>`);
      $('#gc-go', m.body).addEventListener('click', (ev) => withBusy(ev.currentTarget, async () => {
        try {
          await api(`/admin/users/${cr.dataset.credit}/credit`, { method: 'POST', body: { amount: $('#gc-amt', m.body).value, reason: $('#gc-reason', m.body).value } });
          m.close(); toast('Credit issued'); load();
        } catch (err) { showError($('#gc-msg', m.body), err); }
      }));
      return;
    }
    const b = e.target.closest('[data-user]');
    if (!b) return;
    if (b.dataset.status === 'suspended' && !confirm('Suspend this account? They will be signed out and unable to log in.')) return;
    try {
      await api(`/admin/users/${b.dataset.user}/status`, { method: 'POST', body: { status: b.dataset.status } });
      toast(b.dataset.status === 'suspended' ? 'Account suspended' : 'Account reactivated');
      load();
    } catch (err) { toast(err.message); }
  };
  await load();
}

// ---------------- Orders ----------------
async function orders(panel) {
  panel.innerHTML = '';
  const load = async () => {
    const { orders: list } = await api(`/admin/orders?${rangeQs()}&status=${$('#o-status', panel).value}&q=${encodeURIComponent($('#o-q', panel).value)}`);
    $('#o-csv', panel).href = `/api/admin/orders.csv?${rangeQs()}`;
    $('#o-list', panel).innerHTML = list.length ? `<div class="card table-wrap" style="padding:8px"><table class="data">
      <thead><tr><th>#</th><th>Placed</th><th>Customer</th><th>Restaurant</th><th>Item</th><th>Total</th><th>Status</th><th>Card</th><th></th></tr></thead>
      <tbody>${list.map((o) => `<tr>
        <td>${o.id}</td><td class="small">${esc(fmtDateTime(o.createdAt))}</td>
        <td class="small">${esc(o.customer)}<div class="muted">${esc(o.customerEmail)}</div></td><td class="small">${esc(o.restaurant)}</td>
        <td class="small">${o.quantity} × ${esc(o.itemTitle)}<div class="muted">${money(o.unitPriceCents)} (${o.discountPct}% off ${money(o.originalUnitPriceCents)})</div></td>
        <td><b>${money(o.totalCents)}</b>${o.creditAppliedCents ? `<div class="small muted">${money(o.creditAppliedCents)} paid with credit</div>` : ''}
          ${o.refundedCents ? `<div class="small" style="color:var(--danger)">−${money(o.refundedCents)} refunded</div>` : ''}
          ${o.creditedCents ? `<div class="small" style="color:var(--accent-ink)">−${money(o.creditedCents)} as credit</div>` : ''}</td>
        <td>${pill(o.status)}</td><td class="small">${esc(o.card)}</td>
        <td style="white-space:nowrap">
          <a class="btn btn-ghost btn-sm" href="/api/admin/orders/${o.id}/receipt.pdf" title="Download receipt">🧾</a>
          ${o.status === 'reserved' ? `<button class="btn btn-danger btn-sm" data-cancel="${o.id}">Cancel</button>` : ''}
          ${o.status === 'picked_up' && o.refundableCents > 0 ? `<button class="btn btn-ghost btn-sm" data-refund="${o.id}">Refund</button>` : ''}
        </td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><h3>No orders in this period</h3></div>';
    panel.onclick = async (e) => {
      const c = e.target.closest('[data-cancel]');
      const r = e.target.closest('[data-refund]');
      if (c) {
        const reason = prompt('Reason for cancelling (the customer\'s card hold will be released):', '');
        if (reason === null) return;
        try { await api(`/admin/orders/${c.dataset.cancel}/cancel`, { method: 'POST', body: { reason } }); toast('Order cancelled, hold released'); load(); } catch (err) { toast(err.message); }
      }
      if (r) refundForm(list.find((o) => o.id === Number(r.dataset.refund)), load);
    };
  };
  panel.append(rangePicker(load));
  panel.insertAdjacentHTML('beforeend', `
    <div class="row filters-row">
      <input type="search" id="o-q" placeholder="Search order #, customer, restaurant or item" style="max-width:360px">
      <select id="o-status" style="max-width:200px"><option value="">All statuses</option><option value="reserved">Awaiting pickup</option>
        <option value="picked_up">Picked up</option><option value="cancelled">Cancelled</option><option value="expired">Not picked up</option></select>
      <span class="spacer"></span><a class="btn btn-ghost btn-sm" id="o-csv" href="#">⬇ Export CSV</a>
    </div><div id="o-list"></div>`);
  $('#o-q', panel).addEventListener('input', debounce(load));
  $('#o-status', panel).addEventListener('change', load);
  await load();
}

function refundForm(o, done) {
  const max = o.refundableCents;
  const cardPart = o.totalCents - o.creditAppliedCents;
  const paidWith = o.creditAppliedCents
    ? (cardPart > 0 ? `${esc(o.card)} (${money(cardPart)}) + platform credit (${money(o.creditAppliedCents)})` : `Platform credit (${money(o.creditAppliedCents)})`)
    : `${esc(o.card)} (${money(o.totalCents)})`;
  const modal = openModal(`Refund order #${o.id}`, `
    <p class="muted small" style="margin-top:0">${o.quantity} × ${esc(o.itemTitle)} · ${esc(o.restaurant)} · customer ${esc(o.customer)} · total ${money(o.totalCents)}
      ${o.refundedCents + o.creditedCents ? ` · already refunded ${money(o.refundedCents + o.creditedCents)}` : ''}</p>
    <div class="field"><label>Amount</label>
      <div class="timer-chips" id="rf-pcts">${[10, 25, 50, 75, 100].map((p) => `<button type="button" data-pct="${p}" class="${p === 100 ? 'on' : ''}">${p}%</button>`).join('')}
        <button type="button" data-pct="manual">Manual</button></div>
      <div class="timer-custom"><span class="muted">$</span><input id="rf-amt" inputmode="decimal" value="${(max / 100).toFixed(2)}" style="width:140px">
        <span class="muted small">of ${money(max)} refundable</span></div></div>
    <div class="field"><label>Refund to</label>
      <label class="pay-option"><input type="radio" name="rf-method" value="original" checked>
        <span><b>Original form of payment</b><br><span class="small muted">${paidWith}${o.creditAppliedCents && cardPart > 0 ? '. Refunded to the card first, then back to credit.' : ''}</span></span></label>
      <label class="pay-option"><input type="radio" name="rf-method" value="credit">
        <span><b>Bite Wise platform credit</b><br><span class="small muted">Added to ${esc(o.customer)}'s credit balance for future orders.</span></span></label>
      <div class="alert alert-info small" id="rf-effect"></div></div>
    <div class="field"><label for="rf-reason">Reason</label><input id="rf-reason" maxlength="300" placeholder="e.g. Item was missing from the bag"></div>
    <div id="rf-msg"></div>
    <button class="btn btn-primary btn-block" id="rf-go">Issue refund</button>`);
  const b = modal.body;
  let pct = 100;
  const amountCents = () => (pct === 'manual' ? Math.round(Number($('#rf-amt', b).value.replace(/[$,]/g, '')) * 100) : Math.max(1, Math.round((max * pct) / 100)));
  const method = () => b.querySelector('input[name=rf-method]:checked').value;
  const sync = () => {
    if (pct !== 'manual') $('#rf-amt', b).value = (amountCents() / 100).toFixed(2);
    const amt = amountCents();
    $('#rf-effect', b).innerHTML = method() === 'credit'
      ? `💳 <b>${money(amt)}</b> platform credit, <b>paid by you (Bite Wise)</b>. The restaurant still receives its full payment for this order.`
      : `↩️ <b>${money(amt)}</b> back to the customer's original payment. <b>Neither the restaurant nor Bite Wise keeps</b> the refunded share. It's deducted from the restaurant's payout and your service fee.`;
    $('#rf-go', b).textContent = `Refund ${money(amt)} ${method() === 'credit' ? 'as platform credit' : 'to original payment'}`;
  };
  $('#rf-pcts', b).addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pct]');
    if (!btn) return;
    pct = btn.dataset.pct === 'manual' ? 'manual' : Number(btn.dataset.pct);
    $$('#rf-pcts button', b).forEach((x) => x.classList.toggle('on', x === btn));
    if (pct === 'manual') $('#rf-amt', b).focus();
    sync();
  });
  $('#rf-amt', b).addEventListener('input', () => {
    pct = 'manual';
    $$('#rf-pcts button', b).forEach((x) => x.classList.toggle('on', x.dataset.pct === 'manual'));
    sync();
  });
  b.addEventListener('change', sync);
  sync();
  $('#rf-go', b).addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    try {
      const body = { method: method(), reason: $('#rf-reason', b).value };
      if (pct === 'manual') body.amount = $('#rf-amt', b).value; else body.percent = pct;
      await api(`/admin/orders/${o.id}/refund`, { method: 'POST', body });
      modal.close();
      toast(method() === 'credit' ? 'Platform credit issued' : 'Refund issued to original payment');
      done();
    } catch (err) { showError($('#rf-msg', b), err); }
  }));
}

// ---------------- Live offers ----------------
async function offers(panel) {
  const { offers: list } = await api('/admin/offers');
  panel.innerHTML = list.length ? `<div class="card table-wrap" style="padding:8px"><table class="data">
    <thead><tr><th>Offer</th><th>Restaurant</th><th>Price</th><th>Left</th><th>Discard at</th><th>Visible</th><th></th></tr></thead>
    <tbody>${list.map((o) => `<tr>
      <td><div class="row" style="flex-wrap:nowrap;gap:10px">${o.image_path ? `<img class="thumb sm" src="${esc(o.image_path)}" alt="">` : ''}<div><b>${esc(o.title)}</b>
        <div class="muted small">${esc(o.description || '').slice(0, 90)}</div></div></div></td>
      <td class="small">${esc(o.restaurant_name)}<div class="muted">${esc(o.city)}</div></td>
      <td>${money(Math.floor((o.original_price_cents * (100 - o.discount_pct)) / 100 + 0.5))} <span class="was small">${money(o.original_price_cents)}</span></td>
      <td>${o.quantity_available}/${o.quantity_total}</td><td class="small">${esc(fmtTime(o.pickup_end))}</td>
      <td>${o.status === 'active' && o.restaurant_status === 'approved' ? pill('active') : o.restaurant_status !== 'approved' ? `<span class="muted small">Hidden (restaurant ${esc(statusLabel[o.restaurant_status].toLowerCase())})</span>` : pill(o.status)}</td>
      <td><button class="btn btn-danger btn-sm" data-end="${o.id}">Remove</button></td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty"><h3>No live offers right now</h3></div>';
  panel.onclick = async (e) => {
    const b = e.target.closest('[data-end]');
    if (!b) return;
    const reason = prompt('Why are you removing this offer? (recorded in the audit log)', '');
    if (reason === null) return;
    try { await api(`/admin/offers/${b.dataset.end}/end`, { method: 'POST', body: { reason } }); toast('Offer removed'); offers(panel); } catch (err) { toast(err.message); }
  };
}

// ---------------- Payouts ----------------
async function payouts(panel) {
  const { balances, history } = await api('/admin/payouts');
  const owed = balances.reduce((n, b) => n + Math.max(0, b.balanceCents), 0);
  panel.innerHTML = `
    <div class="alert alert-info small">Restaurants earn the <b>food subtotal</b> of completed orders, minus the food share of any refunds. Bite Wise keeps the service fee and remits sales tax.
      Pay restaurants from your bank or payment processor, then record the payout here. (Automatic payouts need Stripe Connect.)</div>
    <div class="row" style="margin-bottom:14px"><h3 style="margin:0">Balances · ${money(owed)} owed</h3><span class="spacer"></span>
      <a class="btn btn-ghost btn-sm" href="/api/admin/payouts.csv">⬇ Export CSV</a></div>
    ${balances.length ? `<div class="card table-wrap" style="padding:8px"><table class="data">
      <thead><tr><th>Restaurant</th><th>Bank account</th><th>Completed orders</th><th>Earned</th><th>Paid</th><th>Balance owed</th><th>Last paid</th><th></th></tr></thead>
      <tbody>${balances.map((b) => `<tr><td><b>${esc(b.name)}</b><div class="muted small">${esc(b.city)} · ${esc(b.email)}</div></td>
        <td class="small">${b.bankDetails ? esc(b.bankDetails.split(' · ').slice(0, 2).join(' · ')) : '<span style="color:var(--accent-ink)">Not on file</span>'}</td>
        <td>${b.orders}</td><td>${money(b.earnedCents)}</td><td>${money(b.paidCents)}</td><td><b>${money(b.balanceCents)}</b></td><td class="small">${esc(day(b.lastPaidAt))}</td>
        <td>${b.balanceCents > 0 ? `<button class="btn btn-primary btn-sm" data-pay="${b.restaurantId}">Record payout</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty"><h3>No earnings yet</h3></div>'}
    <h3 style="margin-top:26px">Payout history</h3>
    ${history.length ? `<div class="card table-wrap" style="padding:8px"><table class="data"><thead><tr><th>Date</th><th>Invoice number</th><th>Restaurant</th><th>Amount</th><th>Bank / transaction details</th><th>Note</th><th>By</th></tr></thead>
      <tbody>${history.map((p) => `<tr><td class="small">${esc(fmtDateTime(p.paid_at))}</td><td><code>${esc(p.reference)}</code></td><td>${esc(p.restaurant_name)}</td><td><b>${money(p.amount_cents)}</b></td>
        <td class="small">${esc(p.bank_details || 'n/a')}${p.transaction_id ? `<div><code>${esc(p.transaction_id)}</code></div>` : ''}</td>
        <td class="small">${esc(p.note)}</td><td class="small">${esc(p.created_by_name || '')}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">No payouts recorded yet.</p>'}`;
  panel.onclick = (e) => {
    const b = e.target.closest('[data-pay]');
    if (!b) return;
    const r = balances.find((x) => x.restaurantId === Number(b.dataset.pay));
    if (!r.bankDetails) {
      openModal(`Record payout · ${r.name}`, `<div class="alert alert-warn">🏦 <b>No payout bank account on file.</b> Ask ${esc(r.name)} to add their bank account in their
        restaurant portal (<b>Payouts</b> tab). You can record this payout once it's on file.</div>`);
      return;
    }
    const modal = openModal(`Record payout · ${r.name}`, `
      <div class="field"><label for="p-inv">Invoice number 🔒</label><input id="p-inv" readonly aria-readonly="true" class="locked" value="Assigning…" tabindex="-1"></div>
      <div class="field"><label for="p-bank">Bank / transaction details 🔒</label>
        <textarea id="p-bank" readonly aria-readonly="true" class="locked" rows="3" tabindex="-1">Loading…</textarea>
        <div class="hint">Filled in automatically from the restaurant's bank account on file and can't be changed. Put the invoice number in the memo of your transfer.
          <a href="#" id="p-reveal">Show full account numbers</a> (recorded in the audit log).</div>
        <div id="p-full"></div></div>
      <div class="field"><label for="p-amt">Amount paid ($)</label><input id="p-amt" inputmode="decimal" value="${(r.balanceCents / 100).toFixed(2)}"></div>
      <div class="field"><label for="p-note">Internal note (optional)</label><input id="p-note" maxlength="300"></div>
      <div id="p-msg"></div><button class="btn btn-primary btn-block" id="p-go">Record payout</button>`);
    api(`/admin/payouts/next-invoice?restaurantId=${r.restaurantId}`).then((d) => {
      $('#p-inv', modal.body).value = d.invoiceNumber;
      $('#p-bank', modal.body).value = `${d.bankDetails}\nTransaction ID: ${d.transactionId}`;
    }).catch((err) => showError($('#p-msg', modal.body), err));
    $('#p-reveal', modal.body).addEventListener('click', async (ev) => {
      ev.preventDefault();
      try {
        const { bank } = await api(`/admin/restaurants/${r.restaurantId}/bank`);
        $('#p-full', modal.body).innerHTML = `<div class="alert alert-warn small" style="margin-top:8px">${esc(bank.bankName)} · ${esc(bank.accountType)} · ${esc(bank.holderName)}<br>
          Routing <code>${esc(bank.routingNumber)}</code> · Account <code>${esc(bank.accountNumber)}</code></div>`;
      } catch (err) { showError($('#p-msg', modal.body), err); }
    });
    $('#p-go', modal.body).addEventListener('click', (ev) => withBusy(ev.currentTarget, async () => {
      try {
        const { invoiceNumber } = await api('/admin/payouts', { method: 'POST', body: { restaurantId: r.restaurantId, amount: $('#p-amt', modal.body).value,
          note: $('#p-note', modal.body).value } });
        modal.close(); toast(`Payout ${invoiceNumber} recorded`); payouts(panel);
      } catch (err) { showError($('#p-msg', modal.body), err); }
    }));
  };
}

// ---------------- Sales tax ----------------
async function tax(panel) {
  panel.innerHTML = '';
  const load = async () => {
    const d = await api(`/admin/tax?${rangeQs()}`);
    $('#t-csv', panel).href = `/api/admin/tax.csv?${rangeQs()}`;
    $('#t-body', panel).innerHTML = `
      <div class="kpis kpis-2"><div class="kpi"><b>${money(d.totals.taxableCents)}</b><span>Taxable sales (food, completed orders)</span></div>
        <div class="kpi"><b>${money(d.totals.taxCents)}</b><span>Sales tax collected</span></div></div>
      ${d.rows.length ? `<div class="card table-wrap" style="padding:8px"><table class="data"><thead><tr><th>City</th><th>ZIP</th><th>Rate</th><th>Orders</th><th>Taxable sales</th><th>Tax collected</th></tr></thead>
        <tbody>${d.rows.map((x) => `<tr><td>${esc(x.city)}</td><td>${esc(x.zip)}</td><td>${(x.rateBps / 100).toFixed(2)}%</td><td>${x.orders}</td><td>${money(x.taxableCents)}</td><td><b>${money(x.taxCents)}</b></td></tr>`).join('')}</tbody></table></div>`
        : '<div class="empty"><h3>No taxable sales in this period</h3></div>'}
      <p class="muted small">Grouped by the restaurant's location so you can report by location code on your Washington excise tax return. Confirm location codes with the
        <a href="https://dor.wa.gov/taxes-rates/sales-use-tax-rates/lookup-tax-rate" target="_blank" rel="noopener">DOR rate lookup</a>.</p>`;
  };
  panel.append(rangePicker(load));
  panel.insertAdjacentHTML('beforeend', `<div class="row filters-row"><span class="spacer"></span><a class="btn btn-ghost btn-sm" id="t-csv" href="#">⬇ Export CSV</a></div><div id="t-body"></div>`);
  await load();
}

// ---------------- Settings ----------------
async function settings(panel) {
  const { settings: s, paymentMode } = await api('/admin/settings');
  panel.innerHTML = `
    <form class="card" id="s-form" style="max-width:640px" novalidate>
      <h3>Business settings</h3>
      <div class="grid-2">
        <div class="field"><label for="s-fee">Customer service fee (%)</label><input id="s-fee" inputmode="decimal" value="${s.serviceFeePct}">
          <div class="hint">Charged on the food subtotal of new orders. This is Bite Wise's revenue.</div></div>
        <div class="field"><label for="s-tax">Default sales tax for new restaurants (%)</label><input id="s-tax" inputmode="decimal" value="${s.defaultTaxRatePct}">
          <div class="hint">Each restaurant can have its own rate.</div></div>
      </div>
      <label class="check" style="margin:6px 0 16px"><input type="checkbox" id="s-approve" ${s.requireRestaurantApproval ? 'checked' : ''}>
        New restaurants need my approval before their offers go live</label>
      <div class="alert alert-info small">Payments: <b>${paymentMode === 'stripe' ? 'Stripe (live processing)' : 'Test mode (no real charges)'}</b>. Stripe keys are set on the server, not here.</div>
      <div id="s-msg"></div>
      <button class="btn btn-primary" type="submit">Save settings</button>
    </form>`;
  $('#s-form', panel).addEventListener('submit', (e) => {
    e.preventDefault();
    withBusy($('button[type=submit]', panel), async () => {
      try {
        const { changed } = await api('/admin/settings', { method: 'PUT', body: {
          serviceFeePct: $('#s-fee', panel).value, defaultTaxRatePct: $('#s-tax', panel).value, requireRestaurantApproval: $('#s-approve', panel).checked } });
        toast(changed.length ? 'Settings saved' : 'No changes');
      } catch (err) { showError($('#s-msg', panel), err); }
    });
  });
}

// ---------------- Audit log ----------------
async function audit(panel) {
  const { entries } = await api('/admin/audit');
  panel.innerHTML = entries.length ? `<div class="card table-wrap" style="padding:8px"><table class="data"><thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Details</th></tr></thead>
    <tbody>${entries.map((a) => `<tr><td class="small">${esc(fmtDateTime(a.created_at))}</td><td>${esc(a.admin || '')}</td><td><code>${esc(a.action)}</code></td><td class="small">${esc(a.details)}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty"><h3>No admin actions yet</h3><p>Approvals, suspensions, refunds, payouts and settings changes are recorded here.</p></div>';
}

function setBadge(n) {
  $('#pending-badge').textContent = n;
  $('#pending-badge').classList.toggle('hidden', !n);
}
async function refreshBadge() {
  try { setBadge((await api('/admin/restaurants?status=pending')).restaurants.length); } catch { /* ignore */ }
}

function debounce(fn, ms = 250) {
  let t;
  return () => { clearTimeout(t); t = setTimeout(fn, ms); };
}

// Payment mode chip + pending badge, then open the tab from the URL.
api('/admin/settings').then(({ paymentMode }) => {
  $('#pay-mode').textContent = paymentMode === 'stripe' ? 'Payments: Stripe' : 'Payments: test mode';
}).catch(() => {});
refreshBadge();
const start = location.hash.slice(1);
showTab(panels[start] ? start : 'overview');
