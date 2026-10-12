'use client';

import { createContext, useContext } from 'react';
import { useQuery, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileSpreadsheet, FileText } from 'lucide-react';
import { sendToLogin } from '@/components/app/session-watch';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { money as fmtMoney } from '@/lib/format';

const tz = 'America/Los_Angeles';
export const todayPT = () => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
export const daysAgo = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(Date.now() - n * 86400000));
export type Range = { from: string; to: string };

// The money tabs show one country at a time: the United States in US dollars or Canada in Canadian dollars (the
// switch at the top of the console). Every request and download carries it as ?country=.
export type Market = 'US' | 'CA';
let market: Market = 'US';
export const currentMarket = () => market;
export const setMarket = (m: Market) => { market = m; };
export const MarketContext = createContext<Market>('US');
export const useMarket = () => useContext(MarketContext);
// Amounts in the console's currency: "$1,234.50" or "CA$1,234.50".
export const money = (cents: number) => fmtMoney(cents, market === 'CA' ? 'cad' : 'usd');

export async function adminGet<T>(resource: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const all: Record<string, string | number | undefined> = { country: market, ...params };
  const qs = new URLSearchParams(Object.entries(all).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]));
  const res = await fetch(`/api/admin/${resource}?${qs}`);
  const data = await res.json().catch(() => ({ error: `The server didn't answer properly (error ${res.status}). Please try again in a minute.` }));
  if (res.status === 401) sendToLogin(); // the session ended while the console was open
  if (!res.ok || data.error) throw new Error(data.error ?? 'Request failed');
  return data as T;
}

export function useAdmin<T>(key: QueryKey, resource: string, params: Record<string, string | number | undefined> = {}, o: { refetchInterval?: number } = {}) {
  const m = useMarket();
  return useQuery({ queryKey: ['admin', ...key, m], queryFn: () => adminGet<T>(resource, params), refetchInterval: o.refetchInterval });
}

// Shown instead of a tab's content when its data couldn't be loaded, so a tab never just spins.
export function LoadError({ error }: { error: Error }) {
  return <Alert tone="error"><b>This tab couldn&apos;t load.</b> {error.message}</Alert>;
}

// Runs a server action and shows the outcome. Returns true on success.
export async function run(fn: () => Promise<{ ok: boolean; error?: string }>, success?: string) {
  const res = await fn();
  if (!res.ok && (res as { status?: number }).status === 401) sendToLogin();
  if (!res.ok) {
    toast.error(res.error);
    return false;
  }
  if (success) toast.success(success);
  return true;
}

export function RangePicker({ range, onChange }: { range: Range; onChange: (r: Range) => void }) {
  const today = todayPT();
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted">
      <label className="flex items-center gap-2">From
        <input type="date" value={range.from} max={today} onChange={(e) => e.target.value && onChange({ ...range, from: e.target.value })} className="h-9 rounded-full border border-line bg-bg-2 px-3 text-ink" />
      </label>
      <label className="flex items-center gap-2">To
        <input type="date" value={range.to} max={today} onChange={(e) => e.target.value && onChange({ ...range, to: e.target.value })} className="h-9 rounded-full border border-line bg-bg-2 px-3 text-ink" />
      </label>
      {([['7 days', 6], ['30 days', 29], ['90 days', 89]] as const).map(([l, n]) => (
        <Button key={l} variant="ghost" size="sm" onClick={() => onChange({ from: daysAgo(n), to: today })}>{l}</Button>
      ))}
    </div>
  );
}

export const day = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

// Download buttons shown as file icons: a green spreadsheet for CSV and a red document for PDF.
export function DownloadIcons({ csv, pdf, what }: { csv?: string; pdf?: string; what: string }) {
  const cls = 'inline-flex h-9 items-center gap-1 rounded-full border border-line px-3 text-xs font-extrabold tracking-wide text-ink-2 no-underline transition-colors hover:bg-surface-2 hover:text-ink';
  return (
    <span className="no-print inline-flex items-center gap-1.5">
      {csv && (
        <a href={csv} className={cls} title={`Download ${what} as CSV (spreadsheet)`} aria-label={`Download ${what} as CSV`}>
          <FileSpreadsheet className="size-4 text-primary-ink" aria-hidden /> CSV
        </a>
      )}
      {pdf && (
        <a href={pdf} className={cls} title={`Download ${what} as PDF`} aria-label={`Download ${what} as PDF`}>
          <FileText className="size-4 text-danger" aria-hidden /> PDF
        </a>
      )}
    </span>
  );
}

// Link to a download from /api/admin/export/<kind> with the tab's current filters.
export function exportHref(kind: string, params: Record<string, string | number | undefined>, format: 'csv' | 'pdf', section?: string) {
  const all = { country: market, ...params, format, section };
  const qs = new URLSearchParams(Object.entries(all).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]));
  return `/api/admin/export/${kind}?${qs}`;
}

// The title row of a table card, with its CSV and PDF downloads on the right.
export function TableHead({ title, kind, params = {}, section, what }: {
  title: React.ReactNode; kind: string; params?: Record<string, string | number | undefined>; section?: string; what: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-2 pt-2 pb-1">
      <h3 className="m-0 flex-1 text-lg font-extrabold">{title}</h3>
      <DownloadIcons what={what} csv={exportHref(kind, params, 'csv', section)} pdf={exportHref(kind, params, 'pdf', section)} />
    </div>
  );
}

// Who is using the owner console: a full admin, or an admin employee ('support') who may or may not issue refunds.
// country: the location the signed-in admin or employee works in; the console shows only that country.
export type Access = { id: string; role: 'admin' | 'support'; canRefund: boolean; country: Market };
export const AccessContext = createContext<Access>({ id: '', role: 'support', canRefund: false, country: 'US' });
export const useAccess = () => useContext(AccessContext);
