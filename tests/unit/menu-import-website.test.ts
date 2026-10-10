// Menu import from websites: embedded menus, linked PDFs, and clear messages. The internet is faked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]) }));
const { previewFromWebsite, previewFromUpload } = await import('@/lib/menu-import');

const pages: Record<string, { type: string; body: string | Buffer }> = {};
const html = (body: string) => ({ type: 'text/html; charset=utf-8', body: `<html><body>${body}</body></html>` });
const MENU = '<ul><li><h3>Pancakes</h3><p>Buttermilk stack</p><span>$9.50</span></li><li><h3>Omelet</h3><span>$12.00</span></li><li><h3>Hash Browns</h3><span>$4.25</span></li></ul>';

beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  vi.stubGlobal('fetch', vi.fn(async (url: URL | string) => {
    const page = pages[String(url)];
    if (!page) return new Response('not found', { status: 404 });
    return new Response(typeof page.body === 'string' ? page.body : new Uint8Array(page.body), { status: 200, headers: { 'content-type': page.type } });
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('menu import from websites', () => {
  it('reads the menu page itself', async () => {
    pages['https://diner.example/menu'] = html(MENU);
    const p = await previewFromWebsite('https://diner.example/menu');
    expect(p.items.map((x) => [x.name, x.priceCents])).toEqual([['Pancakes', 950], ['Omelet', 1200], ['Hash Browns', 425]]);
  });

  it('follows a menu embedded in an iframe, or a "Menu" link', async () => {
    pages['https://cafe.example/'] = html('<h1>Welcome</h1><iframe src="https://menus.example/cafe"></iframe>');
    pages['https://menus.example/cafe'] = html(MENU);
    expect((await previewFromWebsite('https://cafe.example/')).items).toHaveLength(3);
    pages['https://bistro.example/'] = html('<h1>Welcome</h1><a href="/our-menu">See our menu</a>');
    pages['https://bistro.example/our-menu'] = html(MENU);
    expect((await previewFromWebsite('https://bistro.example/')).items).toHaveLength(3);
  });

  it('explains PDF and picture menus when the AI reader is off, and browser-built pages', async () => {
    pages['https://pdf.example/menu'] = html('<h1>Menu</h1><a href="/files/menu.pdf">Download our menu</a>');
    pages['https://pdf.example/files/menu.pdf'] = { type: 'application/pdf', body: Buffer.from('%PDF-1.4 fake') };
    await expect(previewFromWebsite('https://pdf.example/menu')).rejects.toThrow(/AI menu reader/);
    await expect(previewFromWebsite('https://pdf.example/files/menu.pdf')).rejects.toThrow(/AI menu reader/);
    await expect(previewFromUpload(`data:image/png;base64,${Buffer.from('png').toString('base64')}`, 'menu.png')).rejects.toThrow(/AI menu reader/);
    pages['https://wix.example/menu'] = html(`<div id="root"></div>${'<script src="/a.js"></script>'.repeat(6)}`);
    await expect(previewFromWebsite('https://wix.example/menu')).rejects.toThrow(/builds its menu inside the browser/);
    pages['https://empty.example/menu'] = html(`<p>${'We love breakfast. '.repeat(40)}</p>`);
    await expect(previewFromWebsite('https://empty.example/menu')).rejects.toThrow(/couldn't find dishes with prices/);
  });
});
