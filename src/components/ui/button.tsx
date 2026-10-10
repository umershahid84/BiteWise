import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap no-underline transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-grad text-on-primary shadow-[0_8px_24px_-8px_var(--grad-glow)] hover:brightness-110',
        green: 'bg-ok text-white hover:brightness-110',
        ghost: 'border border-line bg-surface text-ink hover:bg-surface-2',
        danger: 'border border-danger/40 bg-danger-soft text-danger hover:bg-danger/20',
        warm: 'bg-grad-warm text-[#1c1300] hover:brightness-105',
        link: 'rounded-none px-0 text-primary underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-9 px-4 text-sm',
        md: 'h-11 px-5 text-[0.95rem]',
        lg: 'h-13 px-7 text-base',
        icon: 'size-10',
      },
      block: { true: 'w-full' },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonProps = React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, block, asChild, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';
  return <Comp className={cn(buttonVariants({ variant, size, block }), className)} {...props} />;
}
