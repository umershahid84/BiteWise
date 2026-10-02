// Card entry. In Stripe mode, card numbers go straight from the browser to Stripe (Stripe Elements).
// In mock mode (no Stripe keys configured), only brand, last 4 digits and expiry leave the browser.
import { api, $, esc } from './common.js';

let configPromise;
export const getConfig = () => (configPromise ||= api('/auth/config'));

let stripePromise;
function loadStripe(key) {
  stripePromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://js.stripe.com/v3/';
    s.onload = () => resolve(window.Stripe(key));
    s.onerror = () => reject(new Error('Could not load the secure card form. Check your connection.'));
    document.head.append(s);
  });
  return stripePromise;
}

function luhn(num) {
  let sum = 0;
  for (let i = 0; i < num.length; i++) {
    let d = Number(num[num.length - 1 - i]);
    if (i % 2) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

function brandOf(num) {
  if (/^4/.test(num)) return 'visa';
  if (/^(5[1-5]|2[2-7])/.test(num)) return 'mastercard';
  if (/^3[47]/.test(num)) return 'amex';
  if (/^6(011|5)/.test(num)) return 'discover';
  return 'card';
}

export async function createCardEntry(container) {
  const config = await getConfig();

  if (config.paymentMode === 'stripe') {
    const stripe = await loadStripe(config.stripePublishableKey);
    container.innerHTML = '<div class="stripe-el"></div><div class="test-note">🔒 Card details are sent securely to Stripe and never stored on Bite Wise servers.</div>';
    const card = stripe.elements().create('card', {
      style: { base: { fontSize: '16px', color: '#ecfdf5', '::placeholder': { color: '#86998f' } } },
    });
    card.mount($('.stripe-el', container));
    return {
      async getToken() {
        const { paymentMethod, error } = await stripe.createPaymentMethod({ type: 'card', card });
        if (error) throw new Error(error.message);
        return paymentMethod.id;
      },
      async saveToAccount(makeDefault) {
        const { clientSecret } = await api('/cards/setup-intent', { method: 'POST' });
        const { setupIntent, error } = await stripe.confirmCardSetup(clientSecret, { payment_method: { card } });
        if (error) throw new Error(error.message);
        return api('/cards', { method: 'POST', body: { token: setupIntent.payment_method, makeDefault } });
      },
      async handleAction(clientSecret) {
        const { error } = await stripe.handleNextAction({ clientSecret });
        if (error) throw new Error(error.message);
      },
    };
  }

  container.innerHTML = `
    <div class="field"><label for="cc-num">Card number</label>
      <input id="cc-num" inputmode="numeric" autocomplete="cc-number" placeholder="1234 1234 1234 1234" maxlength="23"></div>
    <div class="grid-3">
      <div class="field"><label for="cc-exp">Expiry</label><input id="cc-exp" inputmode="numeric" autocomplete="cc-exp" placeholder="MM / YY" maxlength="7"></div>
      <div class="field"><label for="cc-cvc">CVC</label><input id="cc-cvc" inputmode="numeric" autocomplete="cc-csc" placeholder="123" maxlength="4"></div>
      <div class="field"><label for="cc-zip">ZIP</label><input id="cc-zip" inputmode="numeric" autocomplete="postal-code" placeholder="98101" maxlength="10"></div>
    </div>
    <div class="test-note">🧪 <b>Test mode</b> — no real charges. Use <code>4242 4242 4242 4242</code>, any future date and any CVC.
      <code>4000 0000 0000 0002</code> simulates a decline.</div>`;
  const num = $('#cc-num', container);
  const exp = $('#cc-exp', container);
  num.addEventListener('input', () => {
    num.value = num.value.replace(/\D/g, '').slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ');
  });
  exp.addEventListener('input', () => {
    const d = exp.value.replace(/\D/g, '').slice(0, 4);
    exp.value = d.length > 2 ? `${d.slice(0, 2)} / ${d.slice(2)}` : d;
  });

  function getToken() {
    const digits = num.value.replace(/\D/g, '');
    if (digits.length < 13 || !luhn(digits)) throw new Error('Please enter a valid card number.');
    const [mm, yy] = exp.value.split('/').map((s) => Number(s.trim()));
    if (!(mm >= 1 && mm <= 12) || !(yy >= 0)) throw new Error('Please enter the expiry as MM / YY.');
    if (!/^\d{3,4}$/.test($('#cc-cvc', container).value.trim())) throw new Error('Please enter the CVC.');
    return { brand: brandOf(digits), last4: digits.slice(-4), expMonth: mm, expYear: 2000 + yy };
  }

  return {
    async getToken() {
      return getToken();
    },
    async saveToAccount(makeDefault) {
      return api('/cards', { method: 'POST', body: { token: getToken(), makeDefault } });
    },
    async handleAction() {},
  };
}

export const cardText = (c) => `${esc(c.brand[0].toUpperCase() + c.brand.slice(1))} •••• ${esc(c.last4)}`;
