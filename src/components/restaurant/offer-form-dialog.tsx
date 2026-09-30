'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Alert, ErrorText } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { useNow } from '@/hooks/use-now';
import { OFFER_REASONS, type OfferReason } from '@/lib/constants';
import { fmtTime, money, pct, timeLeft } from '@/lib/format';
import { discountedUnitPrice } from '@/lib/pricing';
import { supabaseBrowser } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import type { Ctx } from './types';

const TIMERS: [number, string][] = [[30, '30 min'], [60, '1 hour'], [90, '1½ hours'], [120, '2 hours'], [180, '3 hours'], [240, '4 hours']];

// Post surplus food: pick a dish from the menu, set why, the discount, how many and the discard timer.
export function OfferFormDialog({ ctx, state, onClose, onGoToMenu, onSaved }: {
  ctx: Ctx;
  state: { open: boolean; offerId?: number; menuItemId?: number };
  onClose: () => void;
  onGoToMenu: () => void;
  onSaved: () => void;
}) {
  const supabase = supabaseBrowser();
  const menu = useQuery({
    queryKey: ['menu'],
    enabled: state.open,
    queryFn: async () => (await supabase.from('menu_items').select('*').eq('restaurant_id', ctx.restaurant.id).eq('active', true).order('name')).data ?? [],
  });
  const existing = useQuery({
    queryKey: ['offer', state.offerId],
    enabled: state.open && !!state.offerId,
    queryFn: async () => (await supabase.from('offers').select('*').eq('id', state.offerId!).single()).data,
  });
  const ready = state.open && menu.data && (!state.offerId || existing.data);
  return (
    <Dialog open={state.open} onOpenChange={(o) => !o && onClose()}>
      {ready && (
        menu.data!.length ? (
          <OfferForm key={`${state.offerId}-${state.menuItemId}`} ctx={ctx} menu={menu.data!} existing={existing.data ?? null} preselect={state.menuItemId} onClose={onClose} onSaved={onSaved} onGoToMenu={onGoToMenu} />
        ) : (
          <DialogContent title="Post surplus food">
            <div className="py-4 text-center">
              <div className="text-5xl">📋</div>
              <h3 className="mt-2 text-lg font-bold">Add your menu first</h3>
              <p className="text-muted">Offers are picked from your menu, so customers see the real dish name, price and photo.</p>
              <Button onClick={onGoToMenu}>Add menu items</Button>
            </div>
          </DialogContent>
        )
      )}
    </Dialog>
  );
}

type MenuRow = { id: number; name: string; description: string; price_cents: number; dietary: string[]; image_url: string | null };
type OfferRow = { id: number; menu_item_id: number | null; reason: OfferReason; description: string; discount_pct: number; quantity_total: number; pickup_end: string };

function OfferForm({ ctx, menu, existing, preselect, onClose, onSaved, onGoToMenu }: {
  ctx: Ctx; menu: MenuRow[]; existing: OfferRow | null; preselect?: number; onClose: () => void; onSaved: () => void; onGoToMenu: () => void;
}) {
  const supabase = supabaseBrowser();
  const queryClient = useQueryClient();
  const now = useNow();
  // Decided once when the form opens, so the chips don't change while editing.
  const [running] = useState(() => !!existing && Date.parse(existing.pickup_end) > Date.now());
  const [itemId, setItemId] = useState(existing?.menu_item_id ?? preselect ?? menu[0].id);
  const item = menu.find((m) => m.id === itemId) ?? menu[0];
  const [reason, setReason] = useState<OfferReason>(existing?.reason ?? 'wrong_order');
  const [note, setNote] = useState(existing && existing.description !== item.description ? existing.description : '');
  const [discount, setDiscount] = useState(String(existing?.discount_pct ?? 50));
  const [quantity, setQuantity] = useState(String(existing?.quantity_total ?? 1));
  const [timer, setTimer] = useState<string>(running ? 'keep' : '120');
  const [custom, setCustom] = useState('45');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const minutes = timer === 'keep' ? null : timer === 'custom' ? Number(custom) : Number(timer);
  const disc = Number(discount);
  const endsAt = minutes == null ? existing?.pickup_end : now ? new Date(now + minutes * 60000).toISOString() : null;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error: err } = await supabase.rpc('restaurant_save_offer', {
      // null (not undefined) so PostgREST still matches the function's full signature.
      p_offer_id: (existing?.id ?? null) as number, p_menu_item_id: itemId, p_reason: reason, p_description: note,
      p_discount_pct: Math.round(disc), p_quantity: Math.round(Number(quantity)), p_expires_in_minutes: (minutes ?? null) as number,
    });
    setBusy(false);
    if (err) return setError(err.message);
    toast.success(existing ? 'Offer updated' : 'Offer posted! Customers nearby can see it now.');
    queryClient.invalidateQueries({ queryKey: ['restaurant-offers'] });
    queryClient.invalidateQueries({ queryKey: ['restaurant-stats'] });
    onClose();
    onSaved();
  };

  return (
    <DialogContent title={existing ? 'Edit offer' : 'Post surplus food'}>
      <form onSubmit={save} noValidate>
        <Field label="Menu item" htmlFor="o-item" hint={<>Not listed? <button type="button" className="text-primary underline" onClick={onGoToMenu}>Add it to your menu</button>.</>}>
          <Select id="o-item" value={itemId} onChange={(e) => setItemId(Number(e.target.value))}>
            {menu.map((m) => <option key={m.id} value={m.id}>{m.name} ({money(m.price_cents)})</option>)}
          </Select>
        </Field>
        <div className="mb-4 flex gap-3 rounded-xl border border-line bg-bg-2 p-3">
          {item.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.image_url} alt="" className="size-16 rounded-lg object-cover" />
          ) : <div className="grid size-16 place-items-center rounded-lg bg-surface-2 text-3xl">🍽️</div>}
          <div>
            <b>{item.name}</b>
            <div className="text-sm text-muted">{item.description || 'No description'}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm">Menu price <b>{money(item.price_cents)}</b>{item.dietary.map((d) => <Badge key={d} tone="diet">{d}</Badge>)}</div>
          </div>
        </div>
        <Field label="Why is it available?" htmlFor="o-reason">
          <Select id="o-reason" value={reason} onChange={(e) => setReason(e.target.value as OfferReason)}>
            {Object.entries(OFFER_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label={<>Note for customers <span className="text-muted">(optional)</span></>} htmlFor="o-desc">
          <Textarea id="o-desc" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Customer ordered chicken instead. Broth packed separately." />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Discount (%)" htmlFor="o-disc"><Input id="o-disc" type="number" min={1} max={90} value={discount} onChange={(e) => setDiscount(e.target.value)} /></Field>
          <Field label="Quantity available" htmlFor="o-qty"><Input id="o-qty" type="number" min={1} max={500} value={quantity} onChange={(e) => setQuantity(e.target.value)} /></Field>
        </div>
        <Alert tone="info" className="mb-4">
          {disc >= 1 && disc <= 90 ? (
            <>Customers pay <b>{money(discountedUnitPrice(item.price_cents, disc))}</b> <span className="line-through opacity-70">{money(item.price_cents)}</span> per item, plus {pct(ctx.serviceFeeBps)} Rescue Bites service fee and {pct(ctx.restaurant.tax_rate_bps)} sales tax.</>
          ) : 'Enter a discount from 1% to 90%.'}
        </Alert>
        <Field label="⏳ Discard timer">
          <div className="flex flex-wrap gap-2">
            {running && (
              <TimerChip on={timer === 'keep'} onClick={() => setTimer('keep')}>Keep current ({timeLeft(existing!.pickup_end)})</TimerChip>
            )}
            {TIMERS.map(([m, l]) => <TimerChip key={m} on={timer === String(m)} onClick={() => setTimer(String(m))}>{l}</TimerChip>)}
            <TimerChip on={timer === 'custom'} onClick={() => setTimer('custom')}>Custom</TimerChip>
          </div>
          {timer === 'custom' && (
            <div className="mt-2 flex items-center gap-2">
              <Input className="w-28" type="number" min={5} max={4320} step={5} value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Minutes" />
              <span className="text-muted">minutes</span>
            </div>
          )}
          <div className="mt-2 text-xs text-muted">
            {minutes != null && !(minutes >= 5 && minutes <= 4320)
              ? 'Enter 5 to 4320 minutes.'
              : endsAt && <>Available now until <b>{fmtTime(endsAt)}</b>. Customers see a live countdown; when it ends, the offer disappears and anything unsold can be discarded.</>}
          </div>
        </Field>
        <ErrorText error={error} />
        <Button block type="submit" disabled={busy}>{busy ? 'Saving…' : existing ? 'Save changes' : 'Post offer'}</Button>
      </form>
    </DialogContent>
  );
}

function TimerChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn('rounded-full border px-3 py-1.5 text-sm font-semibold', on ? 'border-primary bg-primary-soft text-primary-ink' : 'border-line text-ink-2 hover:bg-surface-2')}>
      {children}
    </button>
  );
}
