'use client';

import { useEffect } from 'react';
import { applyLook } from '@/lib/theme';
import { cn } from '@/lib/utils';

export type Audience = 'customer' | 'restaurant';

// The "customer / restaurant" slider on the sign-up and log-in pages. Switching also switches the page to that side's
// look (warm for customers, the dark kitchen look for restaurants).
export function RoleSwitch({ value, onChange, labels }: { value: Audience; onChange: (v: Audience) => void; labels: Record<Audience, string> }) {
  useEffect(() => {
    // Leaving the page resets the look from the next page's address (src/components/app/theme-sync.tsx).
    applyLook(value);
  }, [value]);
  return (
    <div role="tablist" className="relative mb-5 grid grid-cols-2 rounded-full border border-line bg-bg-2 p-1">
      {/* The sliding highlight behind the selected side. */}
      <span aria-hidden className={cn('absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-grad shadow-card transition-transform duration-300 ease-out', value === 'restaurant' && 'translate-x-full')} />
      {(['customer', 'restaurant'] as const).map((r) => (
        <button
          key={r}
          type="button"
          role="tab"
          aria-selected={value === r}
          onClick={() => onChange(r)}
          className={cn('relative z-10 rounded-full px-2 py-2.5 text-sm font-bold transition-colors', value === r ? 'text-on-primary' : 'text-muted hover:text-ink')}
        >
          {labels[r]}
        </button>
      ))}
    </div>
  );
}
