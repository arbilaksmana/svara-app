import type { ComponentProps, Ref } from 'react';
import { cn } from '../../lib/utils';

/** Primitif tabel gaya shadcn bertoken Svara; perilaku (sorting, pagination) ada di data-table. */
export function Table({
  className,
  scrollRegionLabel,
  viewportRef,
  measureKey,
  ...props
}: ComponentProps<'table'> & {
  /**
   * Bila diisi, kontainer geser menjadi region berfokus dan berlabel, sehingga pengguna keyboard
   * bisa menggeser kolom yang berada di luar viewport.
   */
  scrollRegionLabel?: string;
  /** Kontainer geser; pemanggil mengukurnya untuk tahu isi tabel melebihi lebar. */
  viewportRef?: Ref<HTMLDivElement>;
  /**
   * Dipakai sebagai dependency effect pengukuran: visibilitas kolom, jumlah baris, dan lebar
   * sel berubah tanpa mengubah ukuran kontainer, jadi ResizeObserver saja akan basi.
   */
  measureKey?: unknown;
}) {
  void measureKey; // dependency effect di pemanggil (`useOverflowX`), bukan sisi DOM
  return (
    <div
      ref={viewportRef}
      data-slot="table-container"
      className="relative w-full overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ad-accent)]"
      {...(scrollRegionLabel
        ? { role: 'region', 'aria-label': scrollRegionLabel, tabIndex: 0 }
        : {})}
    >
      <table data-slot="table" className={cn('w-full caption-top text-body-sm', className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return <thead data-slot="table-header" className={cn('[&_tr]:border-b [&_tr]:border-[var(--ad-border)]', className)} {...props} />;
}

export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return <tbody data-slot="table-body" className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

export function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn('border-b border-[var(--ad-border)] transition-colors duration-fast hover:bg-[var(--ad-soft)] data-[state=selected]:bg-[var(--ad-soft)]', className)}
      {...props}
    />
  );
}

export function TableHead({ className, scope = 'col', ...props }: ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      scope={scope}
      className={cn('h-11 px-3 text-start align-middle text-caption font-bold whitespace-nowrap text-[color:var(--ad-muted)]', className)}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return <td data-slot="table-cell" className={cn('px-3 py-2.5 align-middle text-[color:var(--ad-text)]', className)} {...props} />;
}

export function TableCaption({ className, ...props }: ComponentProps<'caption'>) {
  return <caption data-slot="table-caption" className={cn('sr-only', className)} {...props} />;
}
