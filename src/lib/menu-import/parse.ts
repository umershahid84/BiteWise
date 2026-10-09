import { parse, type HTMLElement } from 'node-html-parser';
import { DIETARY_TAGS } from '@/lib/constants';

// Finds menu items (name, description, price, photo) in a restaurant's web page or in a spreadsheet. Used by the
// menu import (src/lib/menu-import/index.ts); the owner reviews what was found before anything is saved.
export type ImportItem = { name: string; description: string; priceCents: number; imageUrl: string | null; dietary: string[] };

const PRICE = /(?:\$|US\$|USD\s?)\s?(\d{1,4}(?:[.,]\d{2})?)|(\d{1,4}[.,]\d{2})(?=\s*(?:$|\$|USD|\n|\s{2}|\/|\|))/g;
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const cents = (v: unknown) => {
  const n = Number(String(v ?? '').replace(/[^0-9.,]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
const validItem = (x: ImportItem) => x.name.length >= 2 && x.name.length <= 80 && x.priceCents >= 50 && x.priceCents <= 100000;

// Dietary tags mentioned in the name or description ("vegan", "GF", "halal"...).
export function dietaryFrom(text: string): string[] {
  const t = ` ${text.toLowerCase()} `;
  const found = new Set<string>();
  for (const tag of DIETARY_TAGS) if (t.includes(tag)) found.add(tag);
  if (/\b(gf|gluten free)\b/.test(t)) found.add('gluten-free');
  if (/\b(veg|vegetarian)\b|\(v\)/.test(t) && !found.has('vegan')) found.add('vegetarian');
  if (/\b(df|dairy free)\b/.test(t)) found.add('dairy-free');
  if (/🌶|\bhot\b|\bspicy\b/.test(t)) found.add('spicy');
  return [...found];
}

export function dedupe(items: ImportItem[]) {
  const seen = new Set<string>();
  return items.filter((x) => {
    const k = x.name.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const absolute = (src: string | undefined | null, base?: string) => {
  if (!src || src.startsWith('data:')) return null;
  try {
    const u = new URL(src.trim().split(/\s+/)[0], base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
};
const imgSrc = (img: HTMLElement | null, base: string) =>
  img ? absolute(img.getAttribute('src') ?? img.getAttribute('data-src') ?? img.getAttribute('data-lazy-src') ?? img.getAttribute('srcset'), base) : null;

// 1. schema.org menus (JSON-LD): many restaurant website builders publish their menu this way.
function fromJsonLd(root: HTMLElement, base: string): ImportItem[] {
  const items: ImportItem[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    const type = ([] as unknown[]).concat(o['@type'] ?? []).map(String);
    if (type.includes('MenuItem')) {
      const offer = ([] as unknown[]).concat(o.offers ?? [])[0] as Record<string, unknown> | undefined;
      const image = ([] as unknown[]).concat(o.image ?? [])[0];
      const name = clean(String(o.name ?? ''));
      const description = clean(String(o.description ?? '')).slice(0, 500);
      items.push({
        name, description, priceCents: cents(offer?.price ?? o.price),
        imageUrl: absolute(typeof image === 'string' ? image : (image as { url?: string } | undefined)?.url, base),
        dietary: dietaryFrom(`${name} ${description} ${String(o.suitableForDiet ?? '')}`),
      });
    }
    for (const v of Object.values(o)) if (v && typeof v === 'object') visit(v);
  };
  for (const s of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      visit(JSON.parse(s.text));
    } catch {
      // not valid JSON
    }
  }
  return items.filter(validItem);
}

// 2. The page itself: the biggest blocks that hold exactly one price are menu items (name, description, price,
// maybe a photo).
function fromBlocks(root: HTMLElement, base: string): ImportItem[] {
  const prices = (t: string) => [...t.matchAll(PRICE)];
  const blocks = new Set<HTMLElement>();
  for (const el of root.querySelectorAll('li, article, div, section, tr, p, dd, dl')) {
    const text = clean(el.text);
    if (text.length > 400 || text.length < 4) continue;
    if (prices(text).length === 1) blocks.add(el);
  }
  const items: ImportItem[] = [];
  for (const el of blocks) {
    if (el.parentNode && blocks.has(el.parentNode as HTMLElement)) continue; // keep the largest block
    const text = clean(el.text);
    const [match] = prices(text);
    const priceCents = cents(match[1] ?? match[2]);
    const heading = el.querySelector('h1, h2, h3, h4, h5, h6, strong, b, [class*="name" i], [class*="title" i]');
    let name = clean(heading?.text ?? '');
    if (!name || PRICE.test(name)) name = clean(text.slice(0, match.index).split(/[.:–—|•]/)[0]);
    PRICE.lastIndex = 0;
    name = name.replace(PRICE, '').replace(/[\s.…:–—-]+$/, '').trim();
    PRICE.lastIndex = 0;
    const description = clean(text.replace(match[0], '').replace(name, '')).replace(/^[\s.…:–—|•-]+/, '').slice(0, 500);
    items.push({ name, description, priceCents, imageUrl: imgSrc(el.querySelector('img'), base), dietary: dietaryFrom(`${name} ${description}`) });
  }
  return items.filter(validItem);
}

export function itemsFromHtml(html: string, base: string): ImportItem[] {
  const root = parse(html);
  root.querySelectorAll('script:not([type="application/ld+json"]), style, noscript, svg, nav, footer, header form').forEach((n) => n.remove());
  const ld = fromJsonLd(root, base);
  return dedupe(ld.length ? ld : fromBlocks(root, base)).slice(0, 300);
}

// The page's readable text and its pictures, for the AI extraction (src/lib/menu-import/ai.ts).
export function pageForAi(html: string, base: string) {
  const root = parse(html);
  root.querySelectorAll('script:not([type="application/ld+json"]), style, noscript, svg').forEach((n) => n.remove());
  const images = root.querySelectorAll('img')
    .map((img) => ({ url: imgSrc(img, base), alt: clean(img.getAttribute('alt') ?? '') }))
    .filter((x): x is { url: string; alt: string } => !!x.url)
    .slice(0, 200);
  const text = root.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, td, th, span, div, dt, dd, strong, b, a')
    .filter((el) => !el.querySelector('h1, h2, h3, h4, h5, h6, p, li, td, div, dd'))
    .map((el) => clean(el.text)).filter(Boolean);
  return { text: [...new Set(text)].join('\n').slice(0, 120_000), images, jsonLd: root.querySelectorAll('script[type="application/ld+json"]').map((s) => s.text).join('\n').slice(0, 40_000) };
}

// 3. A spreadsheet: CSV saved from Excel or Google Sheets, or cells copied and pasted (tab-separated).
// Columns are found by their header: name, description, price, photo/image, dietary/tags.
export function itemsFromSpreadsheet(text: string): { items: ImportItem[]; problems: string[] } {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delim = firstLine.includes('\t') ? '\t' : (firstLine.split(';').length > firstLine.split(',').length ? ';' : ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"' && !cell) quoted = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const data = rows.filter((r) => r.some((c) => c.trim()));
  if (data.length < 2) return { items: [], problems: ['Add a header row (Name, Description, Price, Photo) and at least one item.'] };
  const header = data[0].map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h === n || h.includes(n)));
  const c = {
    name: col('name', 'item', 'dish', 'title'), description: col('description', 'desc', 'details'), price: col('price', 'cost', 'amount'),
    image: col('photo', 'image', 'picture', 'img'), dietary: col('dietary', 'diet', 'tags'),
  };
  if (c.name < 0 || c.price < 0) return { items: [], problems: ['The first row needs "Name" and "Price" columns (also "Description" and "Photo" if you have them).'] };
  const problems: string[] = [];
  const items: ImportItem[] = [];
  data.slice(1).forEach((r, i) => {
    const name = clean(r[c.name] ?? '');
    const description = c.description >= 0 ? clean(r[c.description] ?? '').slice(0, 500) : '';
    const item: ImportItem = {
      name, description, priceCents: cents(r[c.price]),
      imageUrl: c.image >= 0 ? absolute(r[c.image]) : null, // full web addresses only
      dietary: [...new Set([...(c.dietary >= 0 ? dietaryFrom(r[c.dietary] ?? '') : []), ...dietaryFrom(`${name} ${description}`)])],
    };
    if (validItem(item)) items.push(item);
    else problems.push(`Row ${i + 2}: ${name ? `"${name}" needs a price between $0.50 and $1,000` : 'no name'}.`);
  });
  return { items: dedupe(items), problems: problems.slice(0, 20) };
}
