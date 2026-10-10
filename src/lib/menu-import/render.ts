import 'server-only';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isPrivateAddress } from './fetch';

// Opens a restaurant's web page in a hidden Chrome browser, the way a visitor's browser would, so menus that the
// page builds with JavaScript (Wix, Squarespace, Toast, Square, DoorDash storefronts...) are there to read.
// On Vercel (Linux) it uses @sparticuz/chromium; elsewhere set CHROMIUM_PATH to a Chrome or Chromium program.
// The page can't reach addresses inside our own network, and pictures, videos and fonts aren't loaded.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const BUDGET_MS = 35_000;

export type Rendered = { url: string; html: string; frames: { url: string; html: string }[]; screenshots: Buffer[] };

async function browserPath(): Promise<{ path: string; args: string[] } | null> {
  if (process.env.CHROMIUM_PATH) return { path: process.env.CHROMIUM_PATH, args: [] };
  if (process.platform === 'linux' && process.arch === 'x64') {
    const chromium = (await import('@sparticuz/chromium')).default;
    return { path: await chromium.executablePath(), args: chromium.args };
  }
  return null;
}

// MENU_IMPORT_BROWSER=off turns it off (tests, or a server that can't run Chromium).
export const renderingAvailable = () => process.env.MENU_IMPORT_BROWSER !== 'off' && (!!process.env.CHROMIUM_PATH || (process.platform === 'linux' && process.arch === 'x64'));

// Hosts the page may load from: public internet only (checked once per host).
function hostGuard() {
  const cache = new Map<string, Promise<boolean>>();
  return (host: string) => {
    if (!cache.has(host)) {
      cache.set(host, (async () => {
        const h = host.replace(/^\[|\]$/g, '');
        if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return false;
        const ips = isIP(h) ? [h] : (await lookup(h, { all: true }).catch(() => [])).map((a) => a.address);
        return ips.length > 0 && !ips.some(isPrivateAddress);
      })());
    }
    return cache.get(host)!;
  };
}

// With `screenshot`, also pictures of the page, one screen at a time (at most 6), for the AI menu reader.
export async function renderPage(url: string, o: { screenshot: boolean }): Promise<Rendered | null> {
  const exe = renderingAvailable() ? await browserPath() : null;
  if (!exe) return null;
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: exe.path, args: exe.args, headless: true, timeout: 20_000 });
  const deadline = Date.now() + BUDGET_MS;
  const left = (cap: number) => Math.max(1000, Math.min(cap, deadline - Date.now()));
  try {
    const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 1600 }, locale: 'en-US', serviceWorkers: 'block' });
    const allowed = hostGuard();
    await context.route('**/*', async (route) => {
      const req = route.request();
      let host = '';
      try {
        const u = new URL(req.url());
        if (u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return route.abort();
        host = u.hostname;
      } catch {
        return route.abort();
      }
      if (['image', 'media', 'font'].includes(req.resourceType()) && !o.screenshot) return route.abort();
      if (['media', 'font'].includes(req.resourceType())) return route.abort();
      return (await allowed(host)) ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: left(20_000) });
    await page.waitForLoadState('networkidle', { timeout: left(8000) }).catch(() => undefined);
    // Scroll down the page so menus that load as you scroll appear.
    for (let i = 0; i < 8 && Date.now() < deadline - 4000; i++) {
      const more = await page.evaluate(() => { window.scrollBy(0, window.innerHeight); return window.scrollY + window.innerHeight < document.body.scrollHeight; });
      await page.waitForTimeout(400);
      if (!more) break;
    }
    await page.waitForLoadState('networkidle', { timeout: left(3000) }).catch(() => undefined);
    const html = await page.content();
    const frames: Rendered['frames'] = [];
    for (const f of page.frames()) {
      if (f === page.mainFrame() || frames.length >= 4) continue;
      const html = await f.content().catch(() => '');
      if (html) frames.push({ url: f.url(), html });
    }
    const screenshots: Buffer[] = [];
    if (o.screenshot) {
      await page.evaluate(() => window.scrollTo(0, 0));
      for (let i = 0; i < 6 && Date.now() < deadline - 2000; i++) {
        const shot = await page.screenshot({ type: 'jpeg', quality: 70, timeout: left(5000) }).catch(() => null);
        if (shot) screenshots.push(shot);
        const more = await page.evaluate(() => { window.scrollBy(0, window.innerHeight); return window.scrollY + window.innerHeight < document.body.scrollHeight; });
        if (!more) break;
        await page.waitForTimeout(300);
      }
    }
    return { url: page.url(), html, frames, screenshots };
  } finally {
    await browser.close().catch(() => undefined);
  }
}
