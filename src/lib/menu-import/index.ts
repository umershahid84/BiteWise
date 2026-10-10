import 'server-only';
import { z } from 'zod';
import { DIETARY_TAGS } from '@/lib/constants';
import { AppError, check, must } from '@/lib/errors';
import { storePhoto } from '@/lib/photos';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { parse } from '@/lib/validate';
import { parse as parseHtml } from 'node-html-parser';
import { aiAvailable, itemsFromFiles, itemsWithAi, type MenuFile } from './ai';
import { safeFetch } from './fetch';
import { renderingAvailable, renderPage } from './render';
import { dedupe, itemsFromHtml, itemsFromSpreadsheet, pageForAi, type ImportItem } from './parse';

// Menu import, for restaurants (owners and staff) and admins: 1) find the items on the restaurant's website (its menu
// page, an embedded menu, or a PDF or picture of the menu it links to), in a photo or PDF, or in a spreadsheet, and
// show them for review, 2) save the ones chosen, with their photos copied into Bite Wise.

export type Preview = { items: ImportItem[]; source: 'ai' | 'page' | 'spreadsheet' | 'file'; problems: string[] };
const MAX_PAGE = 5 * 1024 * 1024;
const MAX_FILE = 15 * 1024 * 1024;
const MAX_ITEMS = 300;
const valid = (x: ImportItem) => x.name.length >= 2 && x.priceCents >= 50 && x.priceCents <= 100000;

const NO_AI = 'To read a menu that is a picture or a PDF, Bite Wise needs its AI menu reader, which isn\'t switched on yet (the site owner adds '
  + 'ANTHROPIC_API_KEY). For now, type the items into a spreadsheet and use "From a spreadsheet".';
const BROWSER_ONLY = 'This website builds its menu inside the browser (common with Wix, Squarespace, Toast, Square and DoorDash pages), so the '
  + 'menu isn\'t in the page we receive. If the site has a PDF of the menu, paste that link instead, or use "From a photo or PDF" or "From a spreadsheet".';
const NOTHING = 'We opened the page but couldn\'t find dishes with prices on it. Check that it is the page that lists your dishes and prices '
  + '(open it in your browser and copy the address), or use "Photo or PDF" or "Spreadsheet" instead.';

const isPdf = (type: string, body: Buffer) => /pdf/i.test(type) || body.subarray(0, 5).toString('latin1') === '%PDF-';
const isImage = (type: string) => /^image\/(jpeg|png|gif|webp)/i.test(type);

// Pictures, PDFs and other pages a menu page points to: embedded menus (iframes), links to a PDF or to a page
// called "menu", and pictures that look like the menu itself.
function menuLinks(html: string, base: string) {
  const root = parseHtml(html);
  const abs = (href: string | undefined) => {
    try {
      const u = href ? new URL(href, base) : null;
      return u && /^https?:$/.test(u.protocol) ? u.toString().split('#')[0] : null;
    } catch {
      return null;
    }
  };
  const frames = root.querySelectorAll('iframe[src], embed[src], object[data]')
    .map((el) => abs(el.getAttribute('src') ?? el.getAttribute('data'))).filter((u): u is string => !!u && !/youtube|vimeo|google\.com\/maps|facebook|instagram|recaptcha/i.test(u));
  const links = root.querySelectorAll('a[href]')
    .filter((a) => /\.pdf(\?|$)/i.test(a.getAttribute('href') ?? '') || /menu/i.test(`${a.text} ${a.getAttribute('href')}`))
    .map((a) => abs(a.getAttribute('href'))).filter((u): u is string => !!u && u !== base.split('#')[0]);
  const pictures = root.querySelectorAll('img')
    .filter((img) => /menu/i.test(`${img.getAttribute('src')} ${img.getAttribute('alt')} ${img.getAttribute('title')}`))
    .map((img) => abs(img.getAttribute('src') ?? img.getAttribute('data-src'))).filter((u): u is string => !!u);
  const visibleText = root.querySelector('body')?.text.replace(/\s+/g, ' ').trim().length ?? 0;
  return { frames: [...new Set(frames)].slice(0, 3), links: [...new Set(links)].slice(0, 4), pictures: [...new Set(pictures)].slice(0, 4), scripts: root.querySelectorAll('script').length, visibleText };
}

async function fetchFile(url: string): Promise<MenuFile | { html: string; url: string } | null> {
  try {
    const f = await safeFetch(url, { maxBytes: MAX_FILE, accept: 'text/html,application/pdf,image/*' });
    if (isPdf(f.type, f.body)) return { kind: 'pdf', mime: 'application/pdf', data: f.body, name: new URL(f.url).pathname.split('/').pop() || 'menu.pdf' };
    if (isImage(f.type)) return { kind: 'image', mime: f.type.split(';')[0], data: f.body, name: 'menu' };
    if (/html/i.test(f.type)) return { html: f.body.toString('utf8'), url: f.url };
  } catch {
    // a link that doesn't open is skipped
  }
  return null;
}

async function readFiles(files: MenuFile[]): Promise<Preview> {
  if (!aiAvailable()) throw new AppError(400, NO_AI);
  const items = (await itemsFromFiles(files)).filter(valid);
  if (!items.length) throw new AppError(404, 'We couldn\'t read any dishes with prices from that menu. Try a clearer photo, or use "From a spreadsheet".');
  return { items: dedupe(items).slice(0, MAX_ITEMS), source: 'file', problems: [] };
}

// Menus a page embeds or links to: another page, a PDF or a picture of the menu.
async function followLinks(html: string, base: string, found: ImportItem[]) {
  const more = menuLinks(html, base);
  const files: MenuFile[] = [];
  let best = found;
  for (const link of [...more.frames, ...more.links, ...more.pictures]) {
    const got = await fetchFile(link);
    if (!got) continue;
    if ('html' in got) {
      const items = itemsFromHtml(got.html, got.url);
      if (items.length > best.length) best = items;
    } else if (files.length < 3) files.push(got);
  }
  return { found: best, files, more };
}

// The page's items with the AI menu reader when it's switched on (it copes with any layout), else the built-in one.
async function itemsOfPage(html: string, url: string): Promise<{ items: ImportItem[]; ai: boolean }> {
  const found = itemsFromHtml(html, url);
  if (!aiAvailable()) return { items: found, ai: false };
  try {
    const ai = (await itemsWithAi({ url, ...pageForAi(html, url) })).filter(valid);
    if (ai.length >= found.length) return { items: ai, ai: true };
  } catch (err) {
    console.warn('menu import (AI):', err instanceof Error ? err.message : err);
  }
  return { items: found, ai: false };
}

export async function previewFromWebsite(raw: string): Promise<Preview> {
  const url = raw.trim();
  // 1. The page as the server receives it. A site that turns away servers (403, bot protection) is opened in the
  // browser below instead.
  let page: Awaited<ReturnType<typeof safeFetch>> | null = null;
  let blocked: AppError | null = null;
  try {
    page = await safeFetch(url, { maxBytes: MAX_FILE, accept: 'text/html,application/xhtml+xml,application/pdf,image/*' });
  } catch (err) {
    if (!(err instanceof AppError) || err.status !== 502) throw err;
    blocked = err;
  }
  let found: ImportItem[] = [];
  let shape = { visibleText: 0, scripts: 0 };
  if (page) {
    // A link straight to a PDF or a picture of the menu.
    if (isPdf(page.type, page.body)) return readFiles([{ kind: 'pdf', mime: 'application/pdf', data: page.body, name: 'menu.pdf' }]);
    if (isImage(page.type)) return readFiles([{ kind: 'image', mime: page.type.split(';')[0], data: page.body, name: 'menu' }]);
    if (!/html|xml|text\/plain/i.test(page.type)) throw new AppError(400, 'That address isn\'t a web page, a PDF or a picture.');
    if (page.body.length > MAX_PAGE) throw new AppError(413, 'That page is too large to import.');
    const html = page.body.toString('utf8');
    const own = await itemsOfPage(html, page.url);
    if (own.items.length >= 3) return { items: own.items.slice(0, MAX_ITEMS), source: own.ai ? 'ai' : 'page', problems: [] };
    const linked = await followLinks(html, page.url, own.items);
    if (linked.found.length >= 3) return { items: linked.found.slice(0, MAX_ITEMS), source: 'page', problems: [] };
    if (linked.files.length) return readFiles(linked.files);
    found = linked.found;
    shape = linked.more;
  }

  // 2. The page opened in a real (hidden) browser, for menus built with JavaScript.
  if (renderingAvailable()) {
    const rendered = await renderPage(url, { screenshot: aiAvailable() }).catch((err) => {
      console.warn('menu import (browser):', err instanceof Error ? err.message : err);
      return null;
    });
    if (rendered) {
      const own = await itemsOfPage(rendered.html, rendered.url);
      let best = own;
      for (const f of rendered.frames) {
        const items = itemsFromHtml(f.html, f.url);
        if (items.length > best.items.length) best = { items, ai: false };
      }
      if (best.items.length >= 3) return { items: best.items.slice(0, MAX_ITEMS), source: best.ai ? 'ai' : 'page', problems: [] };
      const linked = await followLinks(rendered.html, rendered.url, best.items);
      if (linked.found.length >= 3) return { items: linked.found.slice(0, MAX_ITEMS), source: 'page', problems: [] };
      if (linked.files.length) return readFiles(linked.files);
      // The menu may be pictures on the page: the AI menu reader reads the page as the visitor sees it.
      if (rendered.screenshots.length) {
        const seen = (await itemsFromFiles(rendered.screenshots.map((data, i) => ({ kind: 'image' as const, mime: 'image/jpeg', data, name: `page-${i + 1}` })))).filter(valid);
        if (seen.length) return { items: dedupe(seen).slice(0, MAX_ITEMS), source: 'ai', problems: [] };
      }
      if (linked.found.length > found.length) found = linked.found;
    }
  }
  if (found.length) return { items: found, source: 'page', problems: [] };
  if (blocked) throw blocked;
  throw new AppError(404, renderingAvailable() || !(shape.visibleText < 400 && shape.scripts > 3) ? NOTHING : BROWSER_ONLY);
}

// A photo or PDF of the menu the owner uploads (a data URL).
export async function previewFromUpload(dataUrl: string, name: string): Promise<Preview> {
  const m = /^data:([a-z/+.-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl);
  if (!m) throw new AppError(400, 'Choose a PDF or a photo (JPEG, PNG or WebP) of your menu.');
  const data = Buffer.from(m[2], 'base64');
  if (data.length > MAX_FILE) throw new AppError(413, 'That file is too large (max 15 MB).');
  if (isPdf(m[1], data)) return readFiles([{ kind: 'pdf', mime: 'application/pdf', data, name }]);
  if (isImage(m[1])) return readFiles([{ kind: 'image', mime: m[1], data, name }]);
  throw new AppError(400, 'Choose a PDF or a photo (JPEG, PNG or WebP) of your menu.');
}

export function previewFromSpreadsheet(text: string): Preview {
  const { items, problems } = itemsFromSpreadsheet(text);
  if (!items.length) throw new AppError(400, problems[0] ?? 'No items with a name and a price were found.');
  return { items: items.slice(0, MAX_ITEMS), source: 'spreadsheet', problems };
}

export const importItemSchema = z.object({
  name: z.string().trim().min(2, 'Every item needs a name.').max(80),
  description: z.string().trim().max(500).default(''),
  priceCents: z.number().int().min(50, 'Prices must be at least $0.50.').max(100000, 'Prices must be at most $1,000.'),
  imageUrl: z.string().url().nullable().default(null),
  dietary: z.array(z.enum(DIETARY_TAGS)).default([]),
});

const previewInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('website'), url: z.string().trim().min(4, 'Enter your menu\'s web address.').max(2000) }),
  z.object({ kind: z.literal('spreadsheet'), text: z.string().min(1, 'Choose a file or paste your menu.').max(2_000_000) }),
  z.object({ kind: z.literal('file'), data: z.string().min(1, 'Choose a PDF or a photo of your menu.').max(21_000_000), name: z.string().max(200).default('menu') }),
]);
export const previewFor = (d: ReturnType<typeof parsePreviewInput>) =>
  d.kind === 'website' ? previewFromWebsite(d.url) : d.kind === 'file' ? previewFromUpload(d.data, d.name) : Promise.resolve(previewFromSpreadsheet(d.text));
export const parsePreviewInput = (input: unknown) => parse(previewInput, input);
export const parseImportInput = (input: unknown) =>
  parse(z.object({ items: z.array(importItemSchema).min(1, 'Choose at least one item to import.').max(MAX_ITEMS), updateExisting: z.boolean().default(false) }), input);

export type ImportResult = { added: number; updated: number; skipped: number; photos: number; photosFailed: number };

// Saves the chosen items. An item with the same name as one already on the menu is skipped, or updated (price,
// description, photo) with `updateExisting`.
export async function importMenu(restaurantId: number, items: z.infer<typeof importItemSchema>[], o: { updateExisting: boolean }): Promise<ImportResult> {
  if (!items.length) throw new AppError(400, 'Choose at least one item to import.');
  if (items.length > MAX_ITEMS) throw new AppError(400, `Import at most ${MAX_ITEMS} items at a time.`);
  const db = supabaseAdmin();
  const existing = new Map(must(await db.from('menu_items').select('id, name').eq('restaurant_id', restaurantId).eq('active', true))
    .map((m) => [m.name.toLowerCase(), m.id]));
  const res: ImportResult = { added: 0, updated: 0, skipped: 0, photos: 0, photosFailed: 0 };

  // Photos are copied a few at a time.
  const photo = async (url: string | null) => {
    if (!url) return null;
    try {
      const img = await safeFetch(url, { maxBytes: 3 * 1024 * 1024, accept: 'image/jpeg,image/png,image/webp' });
      const saved = await storePhoto(restaurantId, img.body);
      res.photos++;
      return saved;
    } catch {
      res.photosFailed++; // e.g. a GIF, SVG or a picture that's too large: the item is saved without it
      return null;
    }
  };
  const queue = [...items];
  const work = async () => {
    for (let x = queue.shift(); x; x = queue.shift()) {
      const id = existing.get(x.name.toLowerCase());
      if (id && !o.updateExisting) { res.skipped++; continue; }
      const image_url = await photo(x.imageUrl);
      const fields = { name: x.name, description: x.description, price_cents: x.priceCents, dietary: x.dietary, ...(image_url ? { image_url } : {}) };
      if (id) {
        check(await db.from('menu_items').update(fields).eq('id', id));
        res.updated++;
      } else {
        check(await db.from('menu_items').insert({ restaurant_id: restaurantId, ...fields }));
        existing.set(x.name.toLowerCase(), -1);
        res.added++;
      }
    }
  };
  await Promise.all([work(), work(), work(), work()]);
  return res;
}
