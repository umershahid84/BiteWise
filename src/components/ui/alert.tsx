import { cn } from '@/lib/utils';

const TONES = {
  error: 'border-danger/40 bg-danger-soft text-danger',
  warn: 'border-accent/40 bg-accent-soft text-accent-ink',
  info: 'border-primary/30 bg-primary-soft text-primary-ink',
};

export function Alert({ tone = 'info', className, ...props }: React.ComponentProps<'div'> & { tone?: keyof typeof TONES }) {
  return <div role={tone === 'error' ? 'alert' : 'status'} className={cn('rounded-field border px-4 py-3 text-sm', TONES[tone], className)} {...props} />;
}

export function ErrorText({ error }: { error?: string | null }) {
  return error ? <Alert tone="error" className="my-3">{error}</Alert> : null;
}
