import { api, $, esc, money, fmtDateTime, renderHeader, requireRole, showError, openModal, withBusy, toast } from './common.js';
import { createCardEntry, cardText } from './cards.js';

const user = await requireRole('customer');
renderHeader('account');
$('#acct-username').textContent = user.username;
$('#acct-email').textContent = user.email;

const msg = $('#cards-msg');

function render(cards) {
  $('#cards').innerHTML = cards.length
    ? cards.map((c) => `
      <div class="card-row">
        <div class="card-brand">${esc(c.brand)}</div>
        <div><b>${cardText(c)}</b><div class="small muted">Expires ${String(c.exp_month).padStart(2, '0')}/${c.exp_year}</div></div>
        <span class="spacer"></span>
        ${c.is_default ? '<span class="status active">Default</span>' : `<button class="btn btn-ghost btn-sm" data-default="${c.id}">Make default</button>`}
        <button class="btn btn-danger btn-sm" data-remove="${c.id}">Remove</button>
      </div>`).join('')
    : '<p class="muted" style="margin:16px 0 0">No saved cards yet.</p>';
}

async function load() {
  try {
    render((await api('/cards')).cards);
  } catch (err) {
    showError(msg, err);
  }
}

$('#cards').addEventListener('click', async (e) => {
  const def = e.target.closest('[data-default]')?.dataset.default;
  const rem = e.target.closest('[data-remove]')?.dataset.remove;
  try {
    if (def) render((await api(`/cards/${def}/default`, { method: 'POST' })).cards);
    if (rem && confirm('Remove this card?')) {
      render((await api(`/cards/${rem}`, { method: 'DELETE' })).cards);
      toast('Card removed');
    }
  } catch (err) {
    showError(msg, err);
  }
});

$('#add-card-btn').addEventListener('click', async () => {
  const modal = openModal('Add a card', `
    <div id="mount"></div>
    <label class="check" style="margin:12px 0"><input type="checkbox" id="make-default"> Make this my default card</label>
    <div id="add-msg"></div>
    <button class="btn btn-green btn-block" id="save-btn">Save card</button>`);
  const entry = await createCardEntry($('#mount', modal.body));
  $('#save-btn', modal.body).addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    try {
      await entry.saveToAccount($('#make-default', modal.body).checked);
      modal.close();
      toast('Card saved');
      load();
    } catch (err) {
      showError($('#add-msg', modal.body), err);
    }
  }));
});

load();

const KIND = { refund: 'Refund issued as credit', goodwill: 'Credit from Rescue Bites', redeem: 'Used on order', restore: 'Returned to your credit', adjustment: 'Adjustment' };
api('/credit').then(({ balanceCents, history }) => {
  $('#credit-balance').textContent = money(balanceCents);
  $('#credit-history').innerHTML = history.length ? `<table class="data" style="margin-top:12px"><tbody>${history.map((h) => `<tr>
    <td class="small">${esc(fmtDateTime(h.created_at))}</td>
    <td class="small">${esc(KIND[h.kind] || h.kind)}${h.order_id ? ` · <a href="/receipt?order=${h.order_id}">order #${h.order_id}</a>` : ''}${h.note ? `<div class="muted">${esc(h.note)}</div>` : ''}</td>
    <td style="text-align:right;font-weight:700;color:${h.amount_cents < 0 ? 'var(--ink-2)' : 'var(--primary-ink)'}">${h.amount_cents < 0 ? '−' : '+'}${money(Math.abs(h.amount_cents))}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted small" style="margin:12px 0 0">No credit activity yet.</p>';
}).catch(() => {});
