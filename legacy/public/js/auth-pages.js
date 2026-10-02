import { api, $, $$, renderHeader, showError, withBusy, getMe, homeFor } from './common.js';
import { askToAccept } from './agreement.js';

renderHeader('login');
const msg = $('#msg');
const params = new URLSearchParams(location.search);

// Only allow same-site relative redirects.
const safeNext = () => {
  const next = params.get('next') || '';
  return next.startsWith('/') && !next.startsWith('//') ? next : null;
};

getMe().then((user) => {
  if (user) location.replace(safeNext() || homeFor(user));
});

const loginForm = $('#login-form');
if (loginForm) {
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    withBusy($('button[type=submit]', loginForm), async () => {
      try {
        const { user } = await api('/auth/login', { method: 'POST', body: { login: $('#login').value, password: $('#password').value } });
        location.href = safeNext() || homeFor(user);
      } catch (err) {
        showError(msg, err);
      }
    });
  });
}

const signupForm = $('#signup-form');
if (signupForm) {
  let role = params.get('role') === 'restaurant' ? 'restaurant' : 'customer';
  const setRole = (r) => {
    role = r;
    $$('.segmented button').forEach((b) => b.classList.toggle('on', b.dataset.role === r));
    $('#restaurant-fields').classList.toggle('hidden', r !== 'restaurant');
    $('button[type=submit]', signupForm).textContent = r === 'restaurant' ? 'Create restaurant account' : 'Create account';
  };
  $$('.segmented button').forEach((b) => b.addEventListener('click', () => setRole(b.dataset.role)));
  setRole(role);

  signupForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const body = { role, email: $('#email').value, username: $('#username').value, password: $('#password').value };
    if (role === 'restaurant') {
      body.restaurant = {
        name: $('#r-name').value, address: $('#r-address').value, city: $('#r-city').value,
        zip: $('#r-zip').value, phone: $('#r-phone').value, cuisine: $('#r-cuisine').value,
      };
    }
    withBusy($('button[type=submit]', signupForm), async () => {
      try {
        // 1) Check the details first, so any problem is shown before the agreement.
        await api('/auth/signup', { method: 'POST', body: { ...body, dryRun: true } });
        showError(msg, null);
        // 2) Show the agreement. Declining creates nothing.
        const accepted = await askToAccept({
          role,
          title: role === 'restaurant' ? 'Restaurant Partner Agreement' : 'Terms of Service',
          intro: 'Please read and accept these terms to create your Bite Wise account. If you decline, no account will be created.',
          acceptLabel: 'Accept & create account',
        });
        if (!accepted) {
          msg.innerHTML = `<div class="alert alert-warn" role="status"><b>No account was created.</b> You declined the terms. You can review them any time
            (<a href="/legal/${role === 'restaurant' ? 'restaurant-agreement' : 'customer-terms'}" target="_blank" rel="noopener">${role === 'restaurant' ? 'Partner Agreement' : 'Terms'}</a>,
            <a href="/legal/privacy" target="_blank" rel="noopener">Privacy Policy</a>) and sign up when you're ready.</div>`;
          msg.scrollIntoView({ block: 'center', behavior: 'smooth' });
          return;
        }
        // 3) Create the account together with the acceptance record.
        const { user } = await api('/auth/signup', { method: 'POST', body: { ...body, acceptedTerms: accepted } });
        location.href = homeFor(user);
      } catch (err) {
        showError(msg, err);
        msg.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    });
  });
}
