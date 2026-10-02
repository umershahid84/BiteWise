// Accept/decline dialog for Bite Wise's legal documents.
import { api, $, esc, openModal } from './common.js';

// Shows the documents. Resolves to { docId: version } when accepted, or null when declined/closed.
export async function askToAccept({ role, title, intro, acceptLabel = 'Accept', declineLabel = 'Decline' }) {
  const { documents } = await api(`/legal/required?role=${role === 'restaurant' ? 'restaurant' : 'customer'}`);
  const names = documents.map((d) => d.title).join(' and ');
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      modal.close();
      resolve(ok ? Object.fromEntries(documents.map((d) => [d.id, d.version])) : null);
    };
    const modal = openModal(title, `
      <p class="muted small" style="margin-top:-4px">${intro}</p>
      <div class="doc-tabs">${documents.map((d, i) => `<a href="#doc-${esc(d.id)}" class="${i ? '' : 'on'}">${esc(d.title)}</a>`).join('')}
        <span class="spacer"></span>${documents.map((d) => `<a class="muted small" href="/legal/${esc(d.id)}" target="_blank" rel="noopener">Open ${esc(d.title)} ↗</a>`).join(' ')}</div>
      <div class="agreement-scroll" tabindex="0" aria-label="Agreement text">
        ${documents.map((d) => `<section class="paper legal compact" id="doc-${esc(d.id)}">
          <h1>${esc(d.title)}</h1><div class="p-muted small" style="margin-bottom:12px">Effective ${esc(d.effective)} · Version ${esc(d.version)}</div>
          ${d.html}</section>`).join('')}
      </div>
      <div class="scroll-hint small" id="scroll-hint">↓ Scroll to the end to continue</div>
      <label class="check agree-check"><input type="checkbox" id="agree" disabled>
        <span>I have read and agree to the ${esc(names)}. I understand this is a legally binding agreement.</span></label>
      <div class="row" style="justify-content:flex-end;margin-top:14px">
        <button class="btn btn-danger" type="button" id="decline-btn">${esc(declineLabel)}</button>
        <button class="btn btn-primary" type="button" id="accept-btn" disabled>${esc(acceptLabel)}</button>
      </div>`, { onClose: () => { if (!settled) { settled = true; resolve(null); } } });
    modal.el.querySelector('.modal').classList.add('modal-wide');
    const box = $('.agreement-scroll', modal.body);
    const agree = $('#agree', modal.body);
    const accept = $('#accept-btn', modal.body);
    const unlock = () => {
      if (box.scrollTop + box.clientHeight >= box.scrollHeight - 24) {
        agree.disabled = false;
        $('#scroll-hint', modal.body).textContent = '✓ You have reached the end';
        $('#scroll-hint', modal.body).classList.add('done');
      }
    };
    box.addEventListener('scroll', unlock);
    unlock();
    modal.body.querySelectorAll('.doc-tabs a[href^="#doc-"]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      modal.body.querySelectorAll('.doc-tabs a[href^="#doc-"]').forEach((x) => x.classList.toggle('on', x === a));
      box.scrollTo({ top: $(a.getAttribute('href'), box).offsetTop - box.offsetTop, behavior: 'smooth' });
    }));
    agree.addEventListener('change', () => { accept.disabled = !agree.checked; });
    $('#decline-btn', modal.body).addEventListener('click', () => done(false));
    accept.addEventListener('click', () => done(true));
  });
}
