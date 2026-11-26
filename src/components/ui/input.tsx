import type { InputHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

/**
 * Input gaya shadcn di atas <input> asli bertoken Svara; dipakai form admin di dalam kartu baru.
 * Kontrak aksesibilitas dari Field lama tetap berlaku: id, aria-describedby, aria-invalid,
 * aria-required diteruskan apa adanya karena atribut sisanya disebar ke <input>.
 */
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      data-slot="input"
      className={cn(
        'min-h-[44px] w-full rounded-md border border-[var(--ad-control-border)] bg-[var(--ad-surface)] px-3 text-body-sm text-[color:var(--ad-text)] placeholder:text-[color:var(--ad-muted)]',
        'focus:border-[var(--ad-accent)] aria-invalid:border-2 aria-invalid:border-[var(--ad-danger)]',
        'disabled:bg-[var(--ad-soft)] disabled:text-[color:var(--ad-muted)]',
        className,
      )}
      {...props}
    />
  );
}
