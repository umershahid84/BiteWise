'use client';

import { useQuery, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

const tz = 'America/Los_Angeles';
export const todayPT = () => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
export const daysAgo = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(Date.now() - n * 86400000));
export type Range = { from: string; to: string };

export async function adminGet<T>(resource: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]));
  const res = await fetch(`/api/admin/${resource}?${qs}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Request failed');
  return data as T;
}

export function useAdmin<T>(key: QueryKey, resource: string, params: Record<string, string | number | undefined> = {}, o: { refetchInterval?: number } = {}) {
  return useQuery({ queryKey: ['admin', ...key], queryFn: () => adminGet<T>(resource, params), refetchInterval: o.refetchInterval });
}

// Runs a server action and shows the outcome. Returns true on success.
export async function run(fn: () => Promise<{ ok: boolean; error?: string }>, success?: string) {
  const res = await fn();
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
