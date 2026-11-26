import type { ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

/**
 * Tombol gaya shadcn yang diwarnai token Svara; dipakai chrome dasbor Ringkasan.
 * Komponen lama tetap memakai Button di src/components/ui.tsx.
 */
const buttonVariants = cva(
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md text-body-sm font-bold no-underline transition-colors duration-fast disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-[var(--ad-accent)] text-[var(--ad-accent-contrast)] hover:opacity-90',
        secondary: 'bg-[var(--ad-soft)] text-[var(--ad-text)] hover:bg-[var(--ad-border)]',
        outline: 'border border-[var(--ad-border)] bg-[var(--ad-surface)] text-[var(--ad-text)] hover:bg-[var(--ad-soft)]',
        ghost: 'text-[var(--ad-muted)] hover:bg-[var(--ad-soft)] hover:text-[var(--ad-text)]',
        danger: 'bg-[var(--ad-danger)] text-n0 hover:opacity-90',
      },
      size: {
        default: 'min-h-[40px] px-4 py-2',
        sm: 'min-h-[36px] px-3 text-caption',
        icon: 'size-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
