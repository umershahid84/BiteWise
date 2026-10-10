'use client';

import { Tabs as T } from 'radix-ui';
import { cn } from '@/lib/utils';

export const Tabs = T.Root;
export const TabsContent = T.Content;

// 'pills': a row of rounded tabs. 'sidebar': a menu down the left on wide screens (restaurant portal, owner
// console) in the theme's sidebar colors, and a scrolling row on phones. Use with <Tabs orientation="vertical">
// inside a two-column grid.
type Variant = 'pills' | 'sidebar';

export function TabsList({ className, variant = 'pills', ...props }: React.ComponentProps<typeof T.List> & { variant?: Variant }) {
  return (
    <T.List
      className={cn(
        variant === 'pills'
          // One scrolling row on phones; on wider screens the tabs wrap onto a second row instead of being cut off.
          ? 'no-print mb-6 flex gap-0.5 overflow-x-auto rounded-[1.75rem] border border-line bg-surface p-1 [scrollbar-width:none] md:flex-wrap md:justify-center md:overflow-visible'
          : 'no-print mb-6 flex gap-1 overflow-x-auto rounded-card bg-sidebar p-2 shadow-card [scrollbar-width:none] lg:sticky lg:top-24 lg:mb-0 lg:max-h-[calc(100dvh-7rem)] lg:flex-col lg:overflow-y-auto',
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, variant = 'pills', ...props }: React.ComponentProps<typeof T.Trigger> & { variant?: Variant }) {
  return (
    <T.Trigger
      className={cn(
        variant === 'pills'
          ? 'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-sm font-bold whitespace-nowrap text-muted transition-colors hover:text-ink data-[state=active]:bg-primary-soft data-[state=active]:text-primary-ink [&_svg]:size-4'
          : 'inline-flex shrink-0 items-center gap-2.5 rounded-[calc(var(--radius-card)-4px)] px-3.5 py-2.5 text-left text-sm font-bold whitespace-nowrap text-sidebar-ink transition-colors hover:bg-white/10 data-[state=active]:bg-sidebar-active data-[state=active]:text-sidebar-active-ink lg:w-full [&_svg]:size-[18px]',
        className,
      )}
      {...props}
    />
  );
}
