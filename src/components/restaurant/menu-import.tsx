'use client';

import { useMemo, useState } from 'react';
import { FileSpreadsheet, Globe, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { adminImportMenu, adminPreviewMenuImport } from '@/app/actions/admin';
import { importMenuItems, previewMenuImport } from '@/app/actions/restaurant';
import { Alert, ErrorText } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DialogContent } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Textarea } from '@/components/ui/field';
import { cn } from '@/lib/utils';

type Item = { name: string; description: string; priceCents: number; imageUrl: string | null; dietary: string[] };
type Preview = { items: Item[]; source: 'ai' | 'page' | 'spreadsheet'; problems: string[] };
type Row = Item & { key: number; chosen: boolean; price: string };

const TEMPLATE = 'Name,Description,Price,Photo,Dietary\nPad Thai,"Rice noodles, tamarind, peanuts",14.50,https://example.com/pad-thai.jpg,\nGreen Curry,Coconut curry with Thai basil,15.00,,"vegan, spicy"\n';

// Imports a menu from the restaurant's website or a spreadsheet: find the items, review and edit them, then save.
// Restaurants (owners and staff) import into their own menu; admins pass `restaurantId`.
export function MenuImportDialog({ restaurantId, restaurantName, onDone }: { restaurantId?: number; restaurantName?: string; onDone: () => void }) {
  const admin = restaurantId !== undefined;
  const [source, setSource] = useState<'website' | 'spreadsheet'>('website');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [found, setFound] = useState<Preview | null>(null);
  const [updateExisting, setUpdateExisting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = useMemo(() => rows?.filter((r) => r.chosen) ?? [], [rows]);

  const find = async () => {
    setBusy(true);
    setError(null);
    const input = source === 'website' ? { kind: 'website' as const, url } : { kind: 'spreadsheet' as const, text };
    const res = admin ? await adminPreviewMenuImport(input) : await previewMenuImport(input);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setFound(res.data);
    setRows(res.data.items.map((x, key) => ({ ...x, key, chosen: true, price: (x.priceCents / 100).toFixed(2) })));
  };
  const save = async () => {
    const items = chosen.map((r) => ({ name: r.name, description: r.description, priceCents: Math.round(Number(r.price.replace(/[$,\s]/g, '')) * 100), imageUrl: r.imageUrl, dietary: r.dietary }));
    const bad = items.find((x) => !Number.isFinite(x.priceCents) || x.priceCents < 50);
    if (bad) return setError(`Check the price of "${bad.name}".`);
    setBusy(true);
    setError(null);
    const res = admin ? await adminImportMenu({ restaurantId, items, updateExisting }) : await importMenuItems({ items, updateExisting });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    const r = res.data;
    toast.success(`Menu imported: ${r.added} added${r.updated ? `, ${r.updated} updated` : ''}${r.skipped ? `, ${r.skipped} already on the menu` : ''}. ${r.photos} photo${r.photos === 1 ? '' : 's'} copied.`);
    if (r.photosFailed) toast.warning(`${r.photosFailed} photo${r.photosFailed === 1 ? '' : 's'} couldn't be copied (only JPEG, PNG or WebP up to 3 MB). You can add them in the Menu tab.`);
    onDone();
  };
  const edit = (key: number, patch: Partial<Row>) => setRows((rs) => rs?.map((r) => (r.key === key ? { ...r, ...patch } : r)) ?? null);
  const readFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2_000_000) return setError('That file is too large (max 2 MB).');
    if (/\.(xlsx?|numbers|ods)$/i.test(file.name)) return setError('Save the spreadsheet as CSV first (File → Save as / Download → CSV), or copy the cells and paste them below.');
    setText(await file.text());
  };

  return (
    <DialogContent
      title={admin ? `Import a menu for ${restaurantName ?? 'this restaurant'}` : 'Import your menu'}
      description="We find the dishes, prices and photos; you check them before anything is added."
      className="w-[min(920px,calc(100%-24px))]"
    >
      {!rows ? (
        <>
          <div role="tablist" className="mb-4 grid grid-cols-2 gap-1 rounded-full border border-line bg-bg-2 p-1">
            {(['website', 'spreadsheet'] as const).map((s) => (
              <button key={s} type="button" role="tab" aria-selected={source === s} onClick={() => setSource(s)}
                className={cn('inline-flex items-center justify-center gap-2 rounded-full py-2 text-sm font-bold text-muted', source === s && 'bg-primary-soft text-primary-ink')}>
                {s === 'website' ? <><Globe className="size-4" /> From a website</> : <><FileSpreadsheet className="size-4" /> From a spreadsheet</>}
              </button>
            ))}
          </div>
          {source === 'website' ? (
            <Field label="Web address of the menu" htmlFor="mi-url" hint="The page that lists your dishes and prices, on your own website or an online menu.">
              <Input id="mi-url" type="url" inputMode="url" placeholder="https://www.myrestaurant.com/menu" value={url} onChange={(e) => setUrl(e.target.value)} />
            </Field>
          ) : (
            <>
              <p className="mt-0 text-sm text-ink-2">
                Columns: <b>Name</b>, <b>Price</b>, and if you have them <b>Description</b>, <b>Photo</b> (a web address of the picture) and <b>Dietary</b>.
                Choose a CSV file (in Excel or Google Sheets: Save as / Download → CSV), or copy the cells and paste them here.{' '}
                <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} download="bite-wise-menu-template.csv">Download a template</a>
              </p>
              <Field label="CSV file" htmlFor="mi-file"><Input id="mi-file" type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" onChange={(e) => readFile(e.target.files?.[0])} /></Field>
              <Field label="…or paste here" htmlFor="mi-text"><Textarea id="mi-text" rows={6} className="font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} placeholder={TEMPLATE} /></Field>
            </>
          )}
          <ErrorText error={error} />
          <Button block disabled={busy || (source === 'website' ? !url.trim() : !text.trim())} onClick={find}>{busy ? 'Looking for your menu…' : 'Find menu items'}</Button>
        </>
      ) : (
        <>
          <Alert tone="info" className="mb-3">
            {found?.source === 'ai' && <Sparkles className="mr-1 inline size-4" />}
            Found <b>{rows.length}</b> item{rows.length === 1 ? '' : 's'}. Untick anything that shouldn&apos;t be on your menu and fix names or prices. Photos are copied into Bite Wise.
          </Alert>
          {found?.problems.length ? <Alert tone="warn" className="mb-3">{found.problems.join(' ')}</Alert> : null}
          <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
            <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setRows(rows.map((r) => ({ ...r, chosen: true })))}>Select all</button>
            <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setRows(rows.map((r) => ({ ...r, chosen: false })))}>Select none</button>
            <span className="flex-1" />
            <Checkbox checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)} label="Update items already on the menu (same name)" />
          </div>
          <div className="max-h-[48vh] overflow-y-auto rounded-xl border border-line">
            {rows.map((r) => (
              <div key={r.key} className={cn('grid grid-cols-[auto_56px_1fr_7rem] items-start gap-3 border-b border-line p-3 last:border-b-0', !r.chosen && 'opacity-50')}>
                <input type="checkbox" className="mt-2 size-4" checked={r.chosen} onChange={(e) => edit(r.key, { chosen: e.target.checked })} aria-label={`Import ${r.name}`} />
                {r.imageUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={r.imageUrl} alt="" className="size-14 rounded-lg object-cover" referrerPolicy="no-referrer" />
                  : <div className="grid size-14 place-items-center rounded-lg bg-bg-2 text-xs text-muted">no photo</div>}
                <div className="min-w-0">
                  <Input value={r.name} onChange={(e) => edit(r.key, { name: e.target.value })} aria-label="Name" className="h-9 font-bold" />
                  <Input value={r.description} onChange={(e) => edit(r.key, { description: e.target.value })} aria-label="Description" placeholder="Description" className="mt-1 h-9 text-sm" />
                  {r.dietary.length > 0 && <div className="mt-1 text-xs text-muted">{r.dietary.join(' · ')}</div>}
                </div>
                <Input value={r.price} onChange={(e) => edit(r.key, { price: e.target.value })} aria-label="Price" inputMode="decimal" className="h-9 text-right" />
              </div>
            ))}
          </div>
          <ErrorText error={error} />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => { setRows(null); setError(null); }}>Back</Button>
            <span className="flex-1" />
            <Button variant="green" disabled={busy || !chosen.length} onClick={save}>
              {busy ? 'Importing…' : `Import ${chosen.length} item${chosen.length === 1 ? '' : 's'}`}
            </Button>
          </div>
        </>
      )}
    </DialogContent>
  );
}
