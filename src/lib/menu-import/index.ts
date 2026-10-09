import 'server-only';
import { z } from 'zod';
import { DIETARY_TAGS } from '@/lib/constants';
import { AppError, check, must } from '@/lib/errors';
import { storePhoto } from '@/lib/photos';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { parse } from '@/lib/validate';
import { aiAvailable, itemsWithAi } from './ai';
import { safeFetch } from './fetch';
import { itemsFromHtml, itemsFromSpreadsheet, pageForAi, type ImportItem } from './parse';

// Menu import, for restaurants (owners and staff) and admins: 1) find the items on the restaurant's website or in
// a spreadsheet and show them for review, 2) save the ones chosen, with their photos copied into Bite Wise.

export type Preview = { items: ImportItem[]; source: 'ai' | 'page' | 'spreadsheet'; problems: string[] };
const MAX_PAGE = 5 * 1024 * 1024;
const MAX_ITEMS = 300;

const NOTHING = 'We couldn\'t find menu items with prices on that page. Some online-ordering sites (like Toast, Square or DoorDash) only build '
  + 'their menu inside the browser. Try the page that lists your full menu, or use "From a spreadsheet" instead.';

export async function previewFromWebsite(url: string): Promise<Preview> {
  const page = await safeFetch(url.trim(), { maxBytes: MAX_PAGE, accept: 'text/html,application/xhtml+xml' });
  if (!/html|xml|text\/plain/i.test(page.type)) throw new AppError(400, 'That address isn\'t a web page. For a PDF or picture of your menu, type the items into a spreadsheet instead.');
  const html = page.body.toString('utf8');
  const found = itemsFromHtml(html, page.url);
  if (aiAvailable()) {
    try {
      const ai = await itemsWithAi({ url: page.url, ...pageForAi(html, page.url) });
      const good = ai.filter((x) => x.name.length >= 2 && x.priceCents >= 50 && x.priceCents <= 100000);
      if (good.length >= found.length) return { items: good.slice(0, MAX_ITEMS), source: 'ai', problems: [] };
    } catch (err) {
      console.warn('menu import (AI):', err instanceof Error ? err.message : err);
    }
  }
  if (!found.length) throw new AppError(404, NOTHING);
  return { items: found, source: 'page', problems: [] };
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
]);
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
