// The menu import's hidden browser: a menu built with JavaScript after the page loads (like Wix or Toast pages).
// Runs only where a Chromium is available (CHROMIUM_PATH, or Linux with @sparticuz/chromium).
import { describe, expect, it } from 'vitest';

process.env.MENU_IMPORT_BROWSER = 'on';
const { renderPage, renderingAvailable } = await import('@/lib/menu-import/render');
const { itemsFromHtml } = await import('@/lib/menu-import/parse');
process.env.MENU_IMPORT_BROWSER = 'off';

const PAGE = `<html><body><div id="app">Loading…</div><script>
  setTimeout(() => {
    document.getElementById('app').innerHTML = [['Pancakes', '$9.50'], ['Omelet', '$12.00'], ['Hash Browns', '$4.25']]
      .map(([n, p]) => '<div class="item"><h3>' + n + '</h3><span>' + p + '</span></div>').join('');
  }, 300);
</script></body></html>`;

describe.skipIf(!process.env.CHROMIUM_PATH)('menu import browser', () => {
  it('reads a menu that the page builds with JavaScript', async () => {
    process.env.MENU_IMPORT_BROWSER = 'on';
    try {
      expect(renderingAvailable()).toBe(true);
      const r = await renderPage(`data:text/html,${encodeURIComponent(PAGE)}`, { screenshot: true });
      expect(r).not.toBeNull();
      expect(itemsFromHtml(r!.html, 'https://diner.example/').map((x) => [x.name, x.priceCents])).toEqual([['Pancakes', 950], ['Omelet', 1200], ['Hash Browns', 425]]);
      expect(r!.screenshots.length).toBeGreaterThan(0);
    } finally {
      process.env.MENU_IMPORT_BROWSER = 'off';
    }
  }, 60_000);
});
