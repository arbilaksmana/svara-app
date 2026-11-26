import type { SelectHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

/**
 * Select gaya shadcn di atas <select> asli (tanpa Radix): bentuk dan fokus mengikuti token,
 * perilaku keyboard dan screen reader bawaan platform.
 */
export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'min-h-[36px] cursor-pointer appearance-none rounded-md border border-[var(--ad-border)] bg-[var(--ad-surface)] ps-3 pe-8 text-body-sm text-[var(--ad-text)]',
        "bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23686b74%22 stroke-width=%222%22 stroke-linecap=%22round%22%3E%3Cpath d=%22m6 9 6 6 6-6%22/%3E%3C/svg%3E')] bg-[position:right_0.625rem_center] bg-no-repeat",
        className,
      )}
      {...props}
    />
  );
}
