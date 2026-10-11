'use client';

import { Tabs as T } from 'radix-ui';
import { cn } from '@/lib/utils';

export const Tabs = T.Root;
export const TabsContent = T.Content;

export function TabsList({ className, ...props }: React.ComponentProps<typeof T.List>) {
  return (
    <T.List
      // Always one row: centered when everything fits, scrolling sideways on smaller screens.
      className={cn('no-print mb-6 flex gap-0.5 overflow-x-auto rounded-[1.75rem] border border-line bg-surface p-1 [scrollbar-width:none] [&>:first-child]:ml-auto [&>:last-child]:mr-auto', className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-sm font-bold whitespace-nowrap text-muted transition-colors hover:text-ink data-[state=active]:bg-primary-soft data-[state=active]:text-primary-ink [&_svg]:size-4',
        className,
      )}
      {...props}
    />
  );
}
