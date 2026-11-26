import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface AdminFieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  /** Galat diumumkan sebagai alert. Matikan bila formulir sudah memakai ErrorSummary agar tidak ada banyak alert serentak. */
  announceError?: boolean;
  /** Kelas tambahan untuk pembungkus kolom. */
  className?: string;
  children: (aria: {
    'aria-describedby': string | undefined;
    'aria-invalid': boolean;
    'aria-required': true | undefined;
    id: string;
  }) => ReactNode;
}

/**
 * Field gaya shadcn bertoken Svara untuk formulir di chrome admin. Kontrak ARIA sama dengan
 * `Field` lama (id, aria-describedby, aria-invalid, aria-required, hint/error bertaut id),
 * jadi pemeriksaan aksesibilitas lama tetap berlaku; hanya tampilannya ikut token `--ad-*`.
 */
export function Field({ id, label, hint, error, required, announceError = true, className, children }: AdminFieldProps) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-body-sm font-bold text-[color:var(--ad-text)]">
        {label}
        {required && <span className="text-[color:var(--ad-danger)]"> *</span>}
        {required && <span className="sr-only"> (wajib)</span>}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': Boolean(error), 'aria-required': required || undefined })}
      {hint && <p id={`${id}-hint`} className="text-caption text-[color:var(--ad-muted)]">{hint}</p>}
      {error && (
        <p id={`${id}-error`} role={announceError ? 'alert' : undefined} className="text-caption font-bold text-[color:var(--ad-danger)]">
          {error}
        </p>
      )}
    </div>
  );
}
