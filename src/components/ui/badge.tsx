import type { ComponentProps } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

/** Lencana gaya shadcn bertoken Svara; varian success/warning/danger dipakai status kartu dan tabel Ringkasan. */
const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-caption font-bold whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'bg-[var(--ad-accent-soft)] text-[color:var(--ad-accent)]',
        secondary: 'bg-[var(--ad-soft)] text-[color:var(--ad-muted)]',
        success: 'bg-[var(--ad-success-soft)] text-[color:var(--ad-success)]',
        warning: 'bg-[var(--ad-warning-soft)] text-[color:var(--ad-text)]',
        danger: 'bg-[var(--ad-danger-soft)] text-[color:var(--ad-danger)]',
        outline: 'border border-[var(--ad-border)] text-[color:var(--ad-muted)]',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps extends ComponentProps<'span'>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}
