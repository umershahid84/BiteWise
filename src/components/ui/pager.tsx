'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { cn } from '@/lib/utils';

// Pages for long tables: 25 rows a page by default, with "Show 25 / 50 / 100 / 150 / 200 / All" and Previous / Next.
// The chosen page size is remembered in this browser (for every table); the page goes back to 1 when `resetKey`
// changes (e.g. a new filter or date range).
export const PAGE_SIZES = [25, 50, 100, 150, 200, 0] as const; // 0 = all rows
const STORE = 'bitewise.pageSize';

function savedSize() {
  try {
    const v = localStorage.getItem(STORE);
    const n = Number(v);
    return v !== null && v !== '' && (PAGE_SIZES as readonly number[]).includes(n) ? n : 25;
  } catch {
    return 25;
  }
}

export function usePager<T>(rows: readonly T[], resetKey = '') {
  const [size, setSizeState] = useState<number>(() => (typeof window === 'undefined' ? 25 : savedSize()));
  const [at, setAt] = useState({ page: 0, key: resetKey });
  const total = rows.length;
  const pages = size ? Math.max(1, Math.ceil(total / size)) : 1;
  const page = Math.min(at.key === resetKey ? at.page : 0, pages - 1);
  const start = size ? page * size : 0;
  const visible = size ? rows.slice(start, start + size) : rows;
  const setPage = (p: number) => setAt({ page: Math.max(0, Math.min(pages - 1, p)), key: resetKey });
  const setSize = (n: number) => {
    setSizeState(n);
    setAt({ page: 0, key: resetKey });
    try {
      localStorage.setItem(STORE, String(n));
    } catch {
      // Private windows may block storage: the size just isn't remembered.
    }
  };
  return { rows: visible, page, pages, size, total, from: total ? start + 1 : 0, to: start + visible.length, setPage, setSize };
}
export type PagerState = ReturnType<typeof usePager>;

// Above a table: rows per page, "1–25 of 312", and Previous / Next.
export function PagerBar({ pager, label = 'results', className }: { pager: PagerState; label?: string; className?: string }) {
  if (!pager.total) return null;
  return (
    <div className={cn('mb-2 flex flex-wrap items-center gap-3 px-2 pt-1 text-sm text-muted', className)}>
      <label className="flex items-center gap-2">
        Show
        <Select className="h-9 w-auto py-0 text-sm" value={pager.size} onChange={(e) => pager.setSize(Number(e.target.value))} aria-label="Rows per page">
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n ? `${n} per page` : 'All'}</option>)}
        </Select>
      </label>
      <span>{pager.from}–{pager.to} of {pager.total} {label}</span>
      <span className="flex-1" />
      <PagerButtons pager={pager} />
    </div>
  );
}

// Below a table: Previous / Next again, so long pages don't need scrolling back up.
export function PagerFooter({ pager }: { pager: PagerState }) {
  if (pager.pages <= 1) return null;
  return <div className="flex justify-end px-2 pt-2 pb-1"><PagerButtons pager={pager} /></div>;
}

function PagerButtons({ pager }: { pager: PagerState }) {
  if (pager.pages <= 1) return null;
  return (
    <div className="flex items-center gap-2 text-sm text-muted">
      <Button size="sm" variant="ghost" disabled={pager.page === 0} onClick={() => pager.setPage(pager.page - 1)}><ChevronLeft /> Previous</Button>
      <span className="whitespace-nowrap">Page {pager.page + 1} of {pager.pages}</span>
      <Button size="sm" variant="ghost" disabled={pager.page >= pager.pages - 1} onClick={() => pager.setPage(pager.page + 1)}>Next <ChevronRight /></Button>
    </div>
  );
}
