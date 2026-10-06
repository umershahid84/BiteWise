import 'server-only';
import { check, must } from '@/lib/errors';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { lookupTaxRate, type LookupOptions } from '@/lib/tax/lookup';

// Keeps each restaurant's sales tax rate right for its address (src/lib/tax/lookup.ts). Rates are looked up when a
// restaurant signs up or changes its address, and again every 30 days, since cities and counties change their rates
// (usually on January 1, April 1, July 1 or October 1). A rate an admin set by hand ('manual') is never changed.
// TAX_LOOKUP=off (tests, offline development) leaves rates alone unless an admin asks for a lookup.

const db = () => supabaseAdmin();
const REFRESH_DAYS = 30;
// After a lookup service fails, try again the next day (not every 5 minutes).
const RETRY_AFTER_FAILURE_DAYS = 1;
const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString();

export type TaxRefresh = { rateBps: number; jurisdiction: string; accuracy: string; note: string; changed: boolean; kept: boolean };

export async function refreshRestaurantTax(restaurantId: number, o: LookupOptions & { force?: boolean } = {}): Promise<TaxRefresh | null> {
  const r = must(await db().from('restaurants')
    .select('address, city, state, zip, tax_rate_bps, tax_source, tax_accuracy, tax_jurisdiction').eq('id', restaurantId).single());
  if ((r.tax_source === 'manual' || process.env.TAX_LOOKUP === 'off') && !o.force) return null;
  const found = await lookupTaxRate({ address: r.address, city: r.city, state: r.state, zip: r.zip }, o);
  // A lookup service was down and only the state estimate is left: keep the rate we have (unless there is none
  // yet) and try again tomorrow, rather than dropping a city's rate to the state's.
  if (found.failed && found.accuracy === 'state' && r.tax_rate_bps > 0) {
    check(await db().from('restaurants').update({
      tax_checked_at: daysAgo(REFRESH_DAYS - RETRY_AFTER_FAILURE_DAYS),
      tax_lookup_error: `Couldn't check the rate, so the current one was kept. ${found.note ?? ''}`.trim(),
    }).eq('id', restaurantId));
    return { rateBps: r.tax_rate_bps, jurisdiction: r.tax_jurisdiction, accuracy: r.tax_accuracy, note: found.note ?? '', changed: false, kept: true };
  }
  check(await db().from('restaurants').update({
    tax_rate_bps: found.rateBps, tax_jurisdiction: found.jurisdiction, tax_accuracy: found.accuracy, tax_source: 'auto',
    tax_checked_at: found.failed ? daysAgo(REFRESH_DAYS - RETRY_AFTER_FAILURE_DAYS) : new Date().toISOString(),
    tax_lookup_error: found.note ?? '',
  }).eq('id', restaurantId));
  return { rateBps: found.rateBps, jurisdiction: found.jurisdiction, accuracy: found.accuracy, note: found.note ?? '', changed: found.rateBps !== r.tax_rate_bps, kept: false };
}

// An admin sets the rate by hand (the app stops looking it up), or hands it back to the automatic lookup.
export async function setManualTaxRate(restaurantId: number, rateBps: number, jurisdiction: string) {
  check(await db().from('restaurants').update({
    tax_rate_bps: rateBps, tax_source: 'manual', tax_accuracy: 'manual', tax_jurisdiction: jurisdiction || 'Set by an admin',
    tax_checked_at: new Date().toISOString(), tax_lookup_error: '',
  }).eq('id', restaurantId));
}

// Scheduled: restaurants never looked up, or not for 30 days. A few per run, one at a time (the lookup services are
// free public services).
export async function refreshDueTaxRates(limit = 10) {
  if (process.env.TAX_LOOKUP === 'off') return { checked: 0, updated: 0 };
  const due = must(await db().from('restaurants').select('id')
    .eq('tax_source', 'auto').neq('status', 'deleted')
    .or(`tax_checked_at.is.null,tax_checked_at.lt.${daysAgo(REFRESH_DAYS)}`)
    .order('tax_checked_at', { ascending: true, nullsFirst: true }).limit(limit));
  let updated = 0;
  for (const { id } of due) {
    try {
      const res = await refreshRestaurantTax(id);
      if (res?.changed) updated++;
    } catch (err) {
      console.warn(`tax rate refresh failed for restaurant ${id}:`, err instanceof Error ? err.message : err);
    }
  }
  return { checked: due.length, updated };
}
