import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

/** Kartu gaya shadcn bertoken Svara (scope chrome dasbor Ringkasan). */
export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn('flex flex-col gap-6 rounded-lg border border-[var(--ad-border)] bg-[var(--ad-surface)] py-6 text-[color:var(--ad-text)] shadow-raised', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn('grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-6 grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto]', className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-title" className={cn('text-body font-bold leading-none', className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-description" className={cn('text-body-sm text-[color:var(--ad-muted)]', className)} {...props} />;
}

/** Slot aksi header: di layar ≥sm sejajar judul di kanan; di layar kecil turun ke bawah deskripsi, rata kiri. */
export function CardAction({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-action" className={cn('col-start-1 row-start-3 justify-self-start sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:self-start sm:justify-self-end', className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('px-6', className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-footer" className={cn('flex items-center px-6', className)} {...props} />;
}
