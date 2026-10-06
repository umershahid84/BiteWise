// Records the "See Bite Wise in action" tours (public/videos/), timed to the spoken narration.
// Full steps are in scripts/demo-video/README.md. This step needs the app running on fresh demo data
// and .video-tmp/voice/durations.json from voice.py; it writes .video-tmp/<tour>-raw.webm and <tour>-cues.json.
//
// The recording shows a visible pointer; the voice-over is mixed in afterwards by build.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.DEMO_URL ?? 'http://localhost:3000';
const OUT = path.resolve('.video-tmp');
const DURATIONS = JSON.parse(fs.readFileSync(path.join(OUT, 'voice/durations.json'), 'utf8'));
const LOGO = fs.readFileSync(new URL('../../public/assets/logo-dark.svg', import.meta.url), 'utf8');
const STORY = fs.readFileSync(new URL('./story.html', import.meta.url), 'utf8');
const SIZE = { width: 1280, height: 720 };
// The deals page asks for the customer's location; the demo browser allows it, at the demo restaurants' area.
const DEMO_LOCATION = { permissions: ['geolocation'], geolocation: { latitude: 47.6101, longitude: -122.3421 } };
const PASSWORD = 'BiteWise123';
fs.mkdirSync(OUT, { recursive: true });

// Pointer and click ripple, injected into every page.
const OVERLAY = () => {
  const css = `
    nextjs-portal { display: none !important; }
    #bw-cursor { position: fixed; z-index: 2147483647; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%;
      background: rgba(255,255,255,.9); border: 3px solid #10b981; box-shadow: 0 2px 10px rgba(0,0,0,.5); pointer-events: none;
      transition: transform .12s; left: -40px; top: -40px; }
    #bw-cursor.down { transform: scale(.7); }
    .bw-ripple { position: fixed; z-index: 2147483646; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%;
      border: 3px solid #34d399; pointer-events: none; animation: bw-rip .5s ease-out forwards; }
    @keyframes bw-rip { from { transform: scale(.3); opacity: 1 } to { transform: scale(1.4); opacity: 0 } }`;
  const add = () => {
    if (document.getElementById('bw-cursor')) return;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
    const cursor = Object.assign(document.createElement('div'), { id: 'bw-cursor' });
    document.body.append(cursor);
    const pos = JSON.parse(sessionStorage.getItem('bw-pos') ?? '[-40,-40]');
    cursor.style.left = `${pos[0]}px`;
    cursor.style.top = `${pos[1]}px`;
    addEventListener('mousemove', (e) => {
      cursor.style.left = `${e.clientX}px`;
      cursor.style.top = `${e.clientY}px`;
      sessionStorage.setItem('bw-pos', JSON.stringify([e.clientX, e.clientY]));
    }, true);
    addEventListener('mousedown', (e) => {
      cursor.classList.add('down');
      const r = Object.assign(document.createElement('div'), { className: 'bw-ripple' });
      r.style.left = `${e.clientX}px`;
      r.style.top = `${e.clientY}px`;
      document.body.append(r);
      setTimeout(() => r.remove(), 600);
    }, true);
    addEventListener('mouseup', () => cursor.classList.remove('down'), true);
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', add);
  else add();
  // Client-side navigation can replace <body> content; re-add if it disappears.
  setInterval(add, 300);
};

const wait = (p, ms) => p.waitForTimeout(ms);

// Keeps the recording in step with the voice-over: say() waits until the previous line has been spoken,
// then notes when the next one starts (seconds from the start of the video).
function narrator(tour) {
  const t0 = Date.now();
  let busyUntil = t0;
  const cues = [];
  const at = () => (Date.now() - t0) / 1000;
  return {
    cues,
    async idle(p, extra = 0) {
      const ms = busyUntil + extra - Date.now();
      if (ms > 0) await wait(p, ms);
    },
    async say(p, id, { gap = 300 } = {}) {
      const seconds = DURATIONS[`${tour}-${id}`];
      if (seconds == null) throw new Error(`No narration for ${tour}-${id}; run voice.py`);
      await this.idle(p, gap);
      cues.push({ id, at: at() });
      busyUntil = Date.now() + seconds * 1000;
    },
    sound(id) {
      cues.push({ id, at: at(), sound: true });
    },
    // A moment the music follows (e.g. the end screen), with no sound of its own.
    mark(id) {
      cues.push({ id, at: at(), marker: true });
    },
    save() {
      this.mark('finish');
      fs.writeFileSync(path.join(OUT, `${tour}-cues.json`), JSON.stringify(cues, null, 2));
    },
  };
}

// End screen: fades in over the last page, pops in the Bite Wise logo piece by piece and says goodbye.
const OUTRO = {
  customer: { headline: 'Happy rescuing!', line: 'Great food. Great prices. Less waste.', pill: 'Free to join' },
  restaurant: { headline: 'Happy selling!', line: 'Less waste. More revenue.', pill: 'Free to join · Paid through Stripe' },
};

// The illustrated "real life" scenes of the customer tour (story.html): ordering on the phone, driving over and the
// pickup at the counter. Each scene stays up for its narration line, and at least as long as its animation.
const STORY_SCENES = [['story-order', 6500], ['story-drive', 8200], ['story-pickup', 8800]];

async function showStory(p, n) {
  await p.evaluate((html) => document.body.insertAdjacentHTML('beforeend', html), STORY);
  for (const [i, [id, minMs]] of STORY_SCENES.entries()) {
    const start = Date.now();
    await p.evaluate((i) => document.querySelectorAll('#bw-story .scene').forEach((el, j) => el.classList.toggle('active', j === i)), i);
    await n.say(p, id, { gap: i === 0 ? 300 : 0 });
    await n.idle(p, 300);
    const left = minMs - (Date.now() - start);
    if (left > 0) await wait(p, left);
  }
}

async function showOutro(p, n, tour) {
  await p.evaluate(({ logo, text }) => {
    const css = `
      #bw-cursor { display: none !important; }
      #bw-outro { position: fixed; inset: 0; z-index: 2147483000; display: grid; place-items: center; overflow: hidden;
        background: radial-gradient(620px 420px at 18% 22%, rgba(52,211,153,.28), transparent 70%),
          radial-gradient(560px 380px at 85% 80%, rgba(253,224,71,.20), transparent 70%), #04130d;
        font-family: var(--font-jakarta), var(--font-inter), system-ui, sans-serif; color: #ecfdf5;
        animation: o-fade .7s ease-out both; }
      @keyframes o-fade { from { opacity: 0 } to { opacity: 1 } }
      #bw-outro .stage { position: relative; z-index: 1; display: grid; justify-items: center; text-align: center; }
      #bw-outro .logo { position: relative; width: 600px; animation: o-bob 3s ease-in-out 2.4s infinite; }
      #bw-outro .logo svg { display: block; width: 100%; height: auto; overflow: visible; }
      #bw-outro svg :is(.b, .leaf, .ileaf, .word1, .word2, .tagline) { transform-box: fill-box; }
      #bw-outro svg .b { transform-origin: 50% 100%; animation: o-pop .9s cubic-bezier(.34,1.56,.64,1) .35s both; }
      #bw-outro svg .leaf { transform-origin: 0% 100%; animation: o-leaf 1.1s cubic-bezier(.34,1.56,.64,1) .9s both; }
      #bw-outro svg .ileaf { transform-origin: 0% 100%; animation: o-drop .8s cubic-bezier(.34,1.56,.64,1) 1.5s both; }
      @keyframes o-drop { from { transform: translateY(-60px) rotate(-30deg); opacity: 0 } 60% { opacity: 1 } to { transform: none; opacity: 1 } }
      #bw-outro svg .word1 { animation: o-slide .6s cubic-bezier(.2,.8,.2,1) .95s both; }
      #bw-outro svg .word2 { animation: o-slide .6s cubic-bezier(.2,.8,.2,1) 1.1s both; }
      #bw-outro svg .tagline { animation: o-fadein .6s ease-out 1.45s both; }
      @keyframes o-beat { 0% { transform: scale(0) } 50% { transform: scale(1.25) } 70% { transform: scale(.92) } 100% { transform: scale(1) } }
      @keyframes o-pop { from { transform: scale(0) rotate(-30deg); opacity: 0 } 60% { opacity: 1 } to { transform: scale(1) rotate(0); opacity: 1 } }
      @keyframes o-in { from { transform: scale(.4); opacity: 0 } to { transform: scale(1); opacity: 1 } }
      @keyframes o-leaf { 0% { transform: scale(0) rotate(-40deg) } 55% { transform: scale(1.12) rotate(10deg) }
        75% { transform: scale(.96) rotate(-6deg) } 100% { transform: scale(1) rotate(0) } }
      @keyframes o-slide { from { transform: translateX(-40px); opacity: 0 } to { transform: none; opacity: 1 } }
      @keyframes o-fadein { from { opacity: 0 } to { opacity: 1 } }
      @keyframes o-bob { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-6px) } }
      #bw-outro .burst i { position: absolute; left: 85px; top: 84px; width: 10px; height: 10px; margin: -5px; border-radius: 50%;
        opacity: 0; animation: o-burst .9s ease-out .55s both; }
      @keyframes o-burst { 0% { opacity: 1; transform: rotate(var(--a)) translateX(0) scale(1) }
        100% { opacity: 0; transform: rotate(var(--a)) translateX(150px) scale(.4) } }
      #bw-outro h2 { margin: 40px 0 0; font-size: 76px; font-weight: 800; letter-spacing: -.03em; line-height: 1.05; padding-bottom: .12em;
        background: linear-gradient(90deg, #6ee7b7, #fde047); -webkit-background-clip: text; background-clip: text; color: transparent;
        animation: o-rise .8s cubic-bezier(.2,.8,.2,1) 1.7s both; }
      #bw-outro p { margin: 14px 0 0; font-size: 28px; font-weight: 600; color: #a7f3d0; animation: o-rise .7s cubic-bezier(.2,.8,.2,1) 2.1s both; }
      #bw-outro .pill { margin-top: 26px; padding: 10px 22px; border-radius: 999px; border: 1px solid rgba(110,231,183,.4);
        background: rgba(16,185,129,.12); font: 700 20px var(--font-inter), system-ui, sans-serif; color: #d1fae5;
        animation: o-rise .7s cubic-bezier(.2,.8,.2,1) 2.45s both; }
      @keyframes o-rise { from { transform: translateY(26px); opacity: 0 } to { transform: none; opacity: 1 } }
      #bw-outro .float { position: absolute; bottom: -60px; font-size: var(--s); opacity: 0; animation: o-float var(--d) linear var(--w) infinite; }
      @keyframes o-float { 0% { transform: translateY(0) rotate(0); opacity: 0 } 15% { opacity: .55 } 85% { opacity: .45 }
        100% { transform: translateY(-860px) rotate(var(--r)); opacity: 0 } }`;
    const el = document.createElement('div');
    el.id = 'bw-outro';
    const foods = ['🍜', '🥐', '🌮', '🍕', '🍣', '🥗', '🍱', '🌱', '🥟', '🍩', '🌱', '🥖', '🍛', '🌿'];
    // Down both sides, clear of the logo and text in the middle.
    const floats = foods.map((f, i) => `<span class="float" style="left:${i % 2 ? 80 + ((i * 5) % 17) : 2 + ((i * 5) % 17)}%;--s:${26 + ((i * 7) % 18)}px;--d:${6 + (i % 4)}s;--w:${(i * 0.37) % 2.2}s;--r:${i % 2 ? 40 : -40}deg">${f}</span>`).join('');
    const colors = ['#6cc24a', '#fde047', '#34d399', '#f1f5f9'];
    const burst = Array.from({ length: 12 }, (_, i) => `<i style="--a:${i * 30}deg;background:${colors[i % 4]}"></i>`).join('');
    el.innerHTML = `<style>${css}</style>${floats}<div class="stage"><div class="logo">${logo}<div class="burst">${burst}</div></div>
      <h2>${text.headline}</h2><p>${text.line}</p><div class="pill">${text.pill}</div></div>`;
    document.body.append(el);
  }, { logo: LOGO, text: OUTRO[tour] });
  n.mark('outro');
}

// Moves the visible pointer to an element (smoothly), then clicks it.
async function click(p, target, { pause = 350 } = {}) {
  const loc = typeof target === 'string' ? p.locator(target).first() : target;
  await loc.scrollIntoViewIfNeeded();
  const box = await loc.boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
  await wait(p, pause);
  await loc.click();
}

async function type(p, selector, text, delay = 55) {
  await click(p, selector, { pause: 150 });
  await p.locator(selector).first().pressSequentially(text, { delay });
}

async function scrollBy(p, dy, steps = 12) {
  for (let i = 0; i < steps; i++) {
    await p.mouse.wheel(0, dy / steps);
    await wait(p, 35);
  }
}

async function logIn(p, user) {
  await p.goto(`${BASE}/login`);
  await type(p, '#login', user);
  await type(p, '#password', PASSWORD, 30);
  await click(p, 'button[type=submit]');
  await p.waitForURL((u) => !u.pathname.startsWith('/login'));
}

async function recordingContext(browser) {
  const ctx = await browser.newContext({ viewport: SIZE, recordVideo: { dir: OUT, size: SIZE }, deviceScaleFactor: 1, timezoneId: 'America/Los_Angeles', ...DEMO_LOCATION });
  await ctx.addInitScript(OVERLAY);
  return ctx;
}

async function customerTour(browser) {
  const ctx = await recordingContext(browser);
  const p = await ctx.newPage();
  const n = narrator('customer');
  await p.goto(`${BASE}/`);
  await wait(p, 300);
  await n.say(p, 'welcome');
  await wait(p, 2800);
  await scrollBy(p, 620, 30);
  await wait(p, 1800);
  await scrollBy(p, -620, 20);
  await n.say(p, 'login');
  await logIn(p, 'demo');
  await p.waitForSelector('article');
  await n.say(p, 'deals');
  await wait(p, 1200);
  await scrollBy(p, 260);
  await n.say(p, 'search');
  await type(p, 'input[aria-label="Search"]', 'Beef Pho', 70);
  await wait(p, 900);
  await n.say(p, 'quantity');
  await click(p, 'article button:has-text("Order")');
  await p.waitForSelector('text=Order summary');
  for (let i = 0; i < 2; i++) {
    const more = p.locator('button[aria-label="More"]');
    if (await more.isEnabled()) await click(p, more, { pause: 200 });
    await wait(p, 350);
  }
  await n.say(p, 'total');
  await wait(p, 2600);
  await scrollBy(p, 360);
  await n.say(p, 'payment');
  const newCard = p.locator('label:has-text("Use a new card")');
  if (await newCard.count()) {
    await click(p, newCard.first());
    await type(p, '#cc-num', '4242424242424242', 25);
    await type(p, '#cc-exp', '1230', 60);
    await type(p, '#cc-cvc', '123', 60);
  }
  await n.say(p, 'hold');
  await n.idle(p, -900);
  await click(p, 'button:has-text("Place order")');
  await p.waitForSelector('text=Congratulations', { timeout: 20000 });
  await n.say(p, 'pin', { gap: 0 });
  await n.idle(p, 800);
  await click(p, 'a:has-text("View my orders")');
  await p.waitForSelector('text=Pickup PIN');
  await n.say(p, 'orders');
  await n.idle(p);
  await click(p, 'a:has-text("View receipt")');
  await p.waitForSelector('.pos');
  await n.say(p, 'receipt');
  await wait(p, 1000);
  await scrollBy(p, 600, 24);
  await n.idle(p, 400);
  await showStory(p, n);
  await showOutro(p, n, 'customer');
  await wait(p, 1400);
  await n.say(p, 'end', { gap: 0 });
  await n.idle(p, 2600);
  n.save();
  await ctx.close();
  return p;
}

async function restaurantTour(browser) {
  const ctx = await recordingContext(browser);
  const p = await ctx.newPage();
  const n = narrator('restaurant');
  await p.goto(`${BASE}/`);
  await wait(p, 300);
  await n.say(p, 'welcome');
  await wait(p, 1500);
  await scrollBy(p, 400, 20);
  await n.say(p, 'login');
  await logIn(p, 'harborpho');
  await p.waitForSelector('text=Verify a pickup');
  await p.mouse.click(1200, 690); // one click turns on the order bell
  await n.say(p, 'dashboard');
  await n.idle(p, -400);
  await click(p, 'button:has-text("Post surplus food")');
  await p.waitForSelector('#o-item');
  await n.say(p, 'post', { gap: 0 });
  await wait(p, 1200);
  await p.locator('#o-item').selectOption({ label: 'Fresh Spring Rolls (3) ($8.50)' });
  await wait(p, 1300);
  await p.locator('#o-reason').selectOption('overproduction');
  await wait(p, 1000);
  await click(p, '#o-disc', { pause: 150 });
  await p.locator('#o-disc').fill('50');
  await n.say(p, 'timer');
  await click(p, '#o-qty', { pause: 150 });
  await p.locator('#o-qty').fill('4');
  await p.locator('#o-qty').blur(); // a wheel scroll over a focused number field would change it
  await scrollBy(p, 300);
  await click(p, 'button:has-text("2 hours")');
  await n.idle(p, -300);
  await click(p, 'button:has-text("Post offer")');
  await p.waitForSelector('[role=tab][data-state=active]:has-text("Offers")');
  await n.say(p, 'live', { gap: 100 });

  // A customer orders (in another, unrecorded browser) and the bell rings live.
  const other = await browser.newContext({ viewport: SIZE, timezoneId: 'America/Los_Angeles', ...DEMO_LOCATION });
  const c = await other.newPage();
  await c.goto(`${BASE}/login`);
  await c.fill('#login', 'demo');
  await c.fill('#password', PASSWORD);
  await c.click('button[type=submit]');
  await c.waitForURL('**/offers');
  await c.fill('input[aria-label="Search"]', 'Spring Rolls');
  await c.waitForTimeout(1500);
  await c.click('article button:has-text("Order")');
  await c.waitForSelector('text=Order summary');
  await n.idle(p, 400);
  await c.click('button:has-text("Place order")');
  await p.waitForSelector('text=New order!', { timeout: 20000 });
  n.sound('bell');
  const rang = Date.now();
  await c.waitForSelector('text=Congratulations', { timeout: 20000 });
  const pin = (await c.locator('[aria-label^="PIN "]').first().getAttribute('aria-label')).replace(/\D/g, '');
  await other.close();
  await wait(p, Math.max(0, rang + 1200 - Date.now())); // let the bell ring before the voice comes in
  await n.say(p, 'bell', { gap: 0 });
  await n.idle(p, 200);

  await click(p, '[role=tab]:has-text("Verify pickup")');
  await n.say(p, 'pin', { gap: 0 });
  await wait(p, 500);
  for (const [i, d] of pin.split('').entries()) {
    await click(p, `input[data-i="${i}"]`, { pause: 120 });
    await p.keyboard.type(d, { delay: 150 });
  }
  await p.waitForSelector('text=Hand over food');
  await n.say(p, 'handover');
  await wait(p, 2600);
  await click(p, 'button:has-text("Hand over food")');
  await p.waitForSelector('text=Pickup confirmed');
  await n.idle(p);
  await click(p, '[role=tab]:has-text("Payouts")');
  await p.waitForSelector('text=Payout history');
  await n.say(p, 'payouts', { gap: 0 });
  await n.idle(p, -200);
  await click(p, 'a:has-text("Daily report")');
  await p.waitForSelector('text=Daily sales report');
  await n.say(p, 'report', { gap: 0 });
  await n.idle(p, 400);
  await showOutro(p, n, 'restaurant');
  await wait(p, 1400);
  await n.say(p, 'end', { gap: 0 });
  await n.idle(p, 2600);
  n.save();
  await ctx.close();
  return p;
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  for (const [name, tour] of [['customer', customerTour], ['restaurant', restaurantTour]]) {
    const video = (await tour(browser)).video();
    await video.saveAs(path.join(OUT, `${name}-raw.webm`));
    await video.delete();
    console.log(`Recorded ${OUT}/${name}-raw.webm`);
  }
} finally {
  await browser.close();
}
