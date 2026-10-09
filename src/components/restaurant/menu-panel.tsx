'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Plus, X } from 'lucide-react';
import { MenuImportDialog } from './menu-import';
import { toast } from 'sonner';
import { saveMenuItem } from '@/app/actions/restaurant';
import { ErrorText } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/field';
import { Spinner } from '@/components/ui/misc';
import { DIETARY_TAGS } from '@/lib/constants';
import { money } from '@/lib/format';
import { supabaseBrowser } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import type { MenuItem } from './types';

export function MenuPanel({ onDiscount }: { onDiscount: (menuItemId: number) => void }) {
  const supabase = supabaseBrowser();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<MenuItem | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['menu'],
    queryFn: async () => (await supabase.from('menu_items').select('*').eq('active', true).order('name')).data ?? [],
  });
  const remove = async (m: MenuItem) => {
    if (!confirm(`Remove "${m.name}" from your menu? Current offers stay live.`)) return;
    const { error } = await supabase.from('menu_items').update({ active: false }).eq('id', m.id);
    if (error) return toast.error(error.message);
    toast.success('Menu item removed');
    queryClient.invalidateQueries({ queryKey: ['menu'] });
  };
  if (isLoading) return <div className="grid place-items-center py-16"><Spinner /></div>;
  return (
    <>
      <div className="-mt-2 mb-4 flex flex-wrap items-center gap-3">
        <p className="m-0 flex-1 text-muted">Your menu, with photos. When you post surplus food, you pick the dish from here.</p>
        <Button variant="ghost" size="sm" onClick={() => setImporting(true)}><Download /> Import menu</Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <button type="button" onClick={() => setEditing('new')} className="grid min-h-64 place-items-center rounded-card border-2 border-dashed border-line text-muted transition hover:border-primary hover:text-primary-ink">
          <div className="text-center"><Plus className="mx-auto mb-2 size-8" />Add menu item</div>
        </button>
        {(data ?? []).map((m) => (
          <div key={m.id} className="flex flex-col overflow-hidden rounded-card border border-line bg-surface">
            <div className="relative grid h-36 place-items-center overflow-hidden bg-surface-2 text-4xl">
              {m.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.image_url} alt={m.name} loading="lazy" className="absolute inset-0 size-full object-cover" />
              ) : '📷'}
            </div>
            <div className="flex flex-1 flex-col p-4">
              <h3 className="m-0 font-bold">{m.name}</h3>
              <div className="font-heading text-lg font-extrabold">{money(m.price_cents)}</div>
              {m.dietary.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{m.dietary.map((d) => <Badge key={d} tone="diet">{d}</Badge>)}</div>}
              <div className="mt-auto flex gap-1.5 pt-3">
                <Button size="sm" onClick={() => onDiscount(m.id)}>Discount it</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(m)}>Edit</Button>
                <Button size="icon" variant="danger" className="size-9" aria-label={`Remove ${m.name}`} onClick={() => remove(m)}><X /></Button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <Dialog open={importing} onOpenChange={setImporting}>
        {importing && <MenuImportDialog onDone={() => { setImporting(false); queryClient.invalidateQueries({ queryKey: ['menu'] }); }} />}
      </Dialog>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && (
          <MenuItemForm
            key={editing === 'new' ? 'new' : editing.id}
            existing={editing === 'new' ? null : editing}
            onSaved={(isNew) => {
              setEditing(null);
              toast.success(isNew ? 'Added to your menu' : 'Menu item saved');
              queryClient.invalidateQueries({ queryKey: ['menu'] });
            }}
          />
        )}
      </Dialog>
    </>
  );
}

// Resizes a chosen photo in the browser so uploads stay small (max 1200px, JPEG).
function resizeImage(file: File, max = 1200): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return reject(new Error('Please choose a JPEG, PNG or WebP photo.'));
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => reject(new Error('Could not read that photo.'));
    img.src = url;
  });
}

function MenuItemForm({ existing, onSaved }: { existing: MenuItem | null; onSaved: (isNew: boolean) => void }) {
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [price, setPrice] = useState(existing ? (existing.price_cents / 100).toFixed(2) : '');
  const [dietary, setDietary] = useState<string[]>(existing?.dietary ?? []);
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const preview = image ?? existing?.image_url;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await saveMenuItem({ id: existing?.id, name, description, price, dietary, image: image ?? undefined });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onSaved(!existing);
  };

  return (
    <DialogContent title={existing ? 'Edit menu item' : 'Add menu item'}>
      <form onSubmit={submit} noValidate>
        <Field label="Photo">
          <div className="flex items-center gap-4">
            <div className="grid size-24 place-items-center overflow-hidden rounded-xl bg-surface-2 text-3xl">
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="" className="size-full object-cover" />
              ) : '📷'}
            </div>
            <div>
              <label className="inline-flex h-9 cursor-pointer items-center rounded-full border border-line bg-surface px-4 text-sm font-semibold hover:bg-surface-2">
                Choose photo
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      setImage(await resizeImage(file));
                      setError(null);
                    } catch (err) {
                      setError((err as Error).message);
                    }
                  }}
                />
              </label>
              <div className="mt-1 text-xs text-muted">A bright, close-up photo sells best. JPEG, PNG or WebP.</div>
            </div>
          </div>
        </Field>
        <Field label="Dish name" htmlFor="i-name"><Input id="i-name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Chicken Pad Thai" /></Field>
        <Field label="Description" htmlFor="i-desc"><Textarea id="i-desc" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ingredients, portion size, allergens…" /></Field>
        <Field label="Menu price ($)" htmlFor="i-price" className="max-w-48"><Input id="i-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="15.00" /></Field>
        <Field label="Dietary tags">
          <div className="flex flex-wrap gap-2">
            {DIETARY_TAGS.map((t) => {
              const on = dietary.includes(t);
              return (
                <button key={t} type="button" onClick={() => setDietary((d) => (on ? d.filter((x) => x !== t) : [...d, t]))}
                  className={cn('rounded-full border px-3 py-1 text-sm font-semibold', on ? 'border-primary bg-primary-soft text-primary-ink' : 'border-line text-ink-2')}>
                  {on ? '✓ ' : ''}{t}
                </button>
              );
            })}
          </div>
        </Field>
        <ErrorText error={error} />
        <Button block type="submit" disabled={busy}>{busy ? 'Saving…' : existing ? 'Save item' : 'Add to menu'}</Button>
      </form>
    </DialogContent>
  );
}
