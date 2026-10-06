import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badge = cva('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap', {
  variants: {
    tone: {
      neutral: 'bg-surface-2 text-ink-2',
      green: 'bg-primary-soft text-primary-ink',
      amber: 'bg-accent-soft text-accent-ink',
      red: 'bg-danger-soft text-danger',
      diet: 'border border-primary/30 text-primary-ink',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export function Badge({ className, tone, ...props }: React.ComponentProps<'span'> & VariantProps<typeof badge>) {
  return <span className={cn(badge({ tone }), className)} {...props} />;
}

const STATUS_TONES: Record<string, VariantProps<typeof badge>['tone']> = {
  reserved: 'amber', pending_payment: 'amber', pending: 'amber', paused: 'amber',
  picked_up: 'green', active: 'green', approved: 'green', sold_out: 'green',
  cancelled: 'neutral', ended: 'neutral', expired: 'red', failed: 'red', suspended: 'red', banned: 'red', past_due: 'red',
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const text = label ?? status.replace('_', ' ');
  return <Badge tone={STATUS_TONES[status] ?? 'neutral'}>{text[0].toUpperCase() + text.slice(1)}</Badge>;
}
