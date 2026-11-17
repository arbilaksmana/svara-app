import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import { StateLink } from '../lib/state';

/* ---------- Tipografi ---------- */

export function PageTitle({ children, kicker }: { children: ReactNode; kicker?: string }) {
  return (
    <div className="flex flex-col gap-1">
      {kicker && <p className="font-mono text-caption font-bold tracking-mono text-n600">{kicker}</p>}
      <h1 className="text-h1 font-bold text-ink">{children}</h1>
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-h3 font-bold text-ink">{children}</h2>;
}

export function Label({ children }: { children: ReactNode }) {
  return <p className="font-mono text-caption font-bold tracking-mono text-n600">{children}</p>;
}

export function Muted({ children }: { children: ReactNode }) {
  return <p className="text-body-sm text-muted">{children}</p>;
}

/* ---------- Surface ---------- */

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-n200 bg-n0 p-4 sm:p-6 ${className}`}>{children}</div>;
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-md border border-n200 bg-n100 p-4 ${className}`}>{children}</div>;
}

export function Divider() {
  return <hr className="border-0 border-t border-n200" />;
}

/* ---------- Badge status ---------- */

type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-n100 text-ink border-n400',
  info: 'bg-action-soft text-action border-action-subtle',
  success: 'bg-success-soft text-success border-success-soft',
  warning: 'bg-warning-soft text-ink border-warning-soft',
  danger: 'bg-danger-soft text-danger border-danger-soft',
};

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: BadgeTone }) {
  return (
    <span className={`inline-flex min-h-[24px] items-center rounded-sm border px-2 text-caption font-bold ${BADGE_TONES[tone]}`}>
      {children}
    </span>
  );
}

/* ---------- Banner notifikasi ---------- */

type BannerTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

const BANNER_TONES: Record<BannerTone, string> = {
  info: 'bg-action-soft border-action-subtle',
  success: 'bg-success-soft border-success-soft',
  warning: 'bg-warning-soft border-warning-soft',
  danger: 'bg-danger-soft border-danger-soft',
  neutral: 'bg-n100 border-n200',
};

export function Banner({
  tone = 'info',
  title,
  children,
}: {
  tone?: BannerTone;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-md border p-4 ${BANNER_TONES[tone]}`} role="status">
      <p className="text-body font-bold text-ink">{title}</p>
      <div className="mt-1 text-body-sm text-ink">{children}</div>
    </div>
  );
}

/* ---------- Button ---------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-action text-n0 hover:bg-action-hover border border-action',
  secondary: 'bg-n0 text-action border border-n200 hover:bg-action-soft',
  ghost: 'bg-transparent text-n700 border border-transparent hover:bg-n100',
  danger: 'bg-n0 text-danger border border-danger-fill hover:bg-danger-soft',
};

const DISABLED = 'disabled:cursor-not-allowed disabled:bg-n200 disabled:text-n400 disabled:border-n200 disabled:opacity-100';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  block?: boolean;
}

export function Button({
  variant = 'primary',
  loading = false,
  block = false,
  disabled,
  children,
  className = '',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={rest.type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading}
      className={`inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-md px-5 text-body font-bold transition-colors duration-fast ${BUTTON_VARIANTS[variant]} ${DISABLED} ${block ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
    />
  );
}

/* ---------- Link bertindak sebagai tombol ---------- */

export function ActionLink({
  to,
  children,
  variant = 'primary',
  disabled = false,
  block = false,
  className = '',
}: {
  to: string;
  children: ReactNode;
  variant?: ButtonVariant;
  disabled?: boolean;
  block?: boolean;
  className?: string;
}) {
  const cls = `inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-md px-5 text-body font-bold transition-colors duration-fast ${BUTTON_VARIANTS[variant]} ${block ? 'w-full' : ''} ${className}`;
  if (disabled) {
    return (
      <span aria-disabled="true" className={`${cls} cursor-not-allowed border-n200 bg-n200 text-n400`}>
        {children}
      </span>
    );
  }
  return (
    <StateLink to={to} className={cls}>
      {children}
    </StateLink>
  );
}

export function TextLink({ to, children, className = '' }: { to: string; children: ReactNode; className?: string }) {
  return (
    <StateLink to={to} className={`inline-flex min-h-[24px] items-center text-body-sm font-bold text-action underline decoration-1 underline-offset-4 hover:text-action-hover ${className}`}>
      {children}
    </StateLink>
  );
}

/** Tautan ke rute absolut yang tidak perlu membawa state (mis. ke halaman kebijakan). */
export function PlainLink({ to, children, className = '' }: { to: string; children: ReactNode; className?: string }) {
  return (
    <Link to={to} className={`inline-flex min-h-[24px] items-center text-body-sm font-bold text-action underline decoration-1 underline-offset-4 hover:text-action-hover ${className}`}>
      {children}
    </Link>
  );
}

/* ---------- Form ---------- */

interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: (aria: { 'aria-describedby': string | undefined; 'aria-invalid': boolean; id: string }) => ReactNode;
}

export function Field({ id, label, hint, error, required, children }: FieldProps) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ') || undefined;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-body-sm font-bold text-ink">
        {label}
        {required && <span className="text-danger"> *</span>}
        {required && <span className="sr-only"> (wajib)</span>}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': Boolean(error) })}
      {hint && <p id={`${id}-hint`} className="text-caption text-muted">{hint}</p>}
      {error && <p id={`${id}-error`} role="alert" className="text-caption font-bold text-danger">{error}</p>}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`min-h-[52px] w-full rounded-md border border-n200 bg-n0 px-3 text-body-sm text-ink placeholder:text-n600 focus:border-action disabled:bg-n50 disabled:text-n400 ${props.className ?? ''}`}
    />
  );
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`min-h-[96px] w-full rounded-md border border-n200 bg-n0 px-3 py-2 text-body-sm text-ink placeholder:text-n600 focus:border-action ${props.className ?? ''}`}
    />
  );
}

export function Checkbox({
  id,
  label,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex min-h-[44px] items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 size-5 shrink-0 rounded-sm accent-action disabled:accent-n400"
      />
      <label htmlFor={id} className={`text-body-sm ${disabled ? 'text-n400' : 'text-ink'}`}>
        {label}
      </label>
    </div>
  );
}

/* ---------- State umum ---------- */

export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-n200 bg-n50 p-6">
      <p className="text-h3 font-bold text-ink">{title}</p>
      <div className="text-body-sm text-muted">{children}</div>
      {action}
    </div>
  );
}

export function ErrorState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-md border border-danger-fill bg-danger-soft p-4">
      <p className="text-body font-bold text-danger">{title}</p>
      <p className="text-body-sm text-ink">{detail}</p>
      {action}
    </div>
  );
}

export function LoadingState({ label = 'Memuat data contoh…', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-3">
      <p className="text-body-sm text-muted">{label}</p>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-md bg-n100 motion-reduce:animate-none" />
      ))}
    </div>
  );
}

export function PermissionDenied({ detail }: { detail: string }) {
  return (
    <Banner tone="danger" title="Akses ditolak">
      {detail} Peran super admin tidak otomatis memberi akses ke jawaban individual.
      <div className="mt-2"><PlainLink to="/admin/audit">Lihat log operasional</PlainLink></div>
    </Banner>
  );
}

export function BlockedNotice({ state }: { state: 'closed' | 'expired' | 'revoked' | 'conflict' }) {
  const copy: Record<typeof state, { title: string; detail: string }> = {
    closed: {
      title: 'Versi ini sudah ditutup',
      detail: 'Pengiriman baru untuk versi ini tidak diterima. Riwayat tetap dapat dibaca sesuai retensi.',
    },
    expired: {
      title: 'Tautan sudah kedaluwarsa',
      detail: 'Masa berlaku tautan berakhir. Kiriman baru tidak dapat dibuat.',
    },
    revoked: {
      title: 'Undangan telah dicabut',
      detail: 'Kode undangan ini tidak berlaku lagi. Kiriman baru ditolak.',
    },
    conflict: {
      title: 'Konflik pengiriman (409)',
      detail: 'Kunci retry yang sama sudah dipakai. Bukti lama dapat dipulihkan; isi yang berubah dengan kunci sama ditolak.',
    },
  };
  return (
    <Banner tone="danger" title={copy[state].title}>
      {copy[state].detail} Tombol kirim dinonaktifkan.
    </Banner>
  );
}

/* ---------- Tabel ---------- */

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-caption text-muted sm:hidden">Geser tabel ke samping untuk melihat semua kolom.</p>
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[480px] border-collapse text-left text-body-sm">
          <thead>
            <tr className="border-b border-n200">
              {head.map((h) => (
                <th key={h} scope="col" className="py-2 pr-4 font-bold text-muted">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

export function Td({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <td className={`border-b border-n100 py-3 pr-4 align-top text-ink ${className}`}>{children}</td>;
}

export function Th({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <th scope="row" className={`border-b border-n100 py-3 pr-4 text-left font-bold text-ink ${className}`}>{children}</th>;
}

/* ---------- Tautan kebijakan ---------- */

export function PolicyLinks({ className = '' }: { className?: string }) {
  return (
    <p className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-body-sm text-muted ${className}`}>
      <PlainLink to="/privacy">Kebijakan privasi</PlainLink>
      <PlainLink to="/terms">Ketentuan layanan</PlainLink>
    </p>
  );
}

/** Daftar kode item ditampilkan dalam mono, motif identitas produk. */
export function Code({ children }: { children: ReactNode }) {
  return <span className="font-mono text-caption font-bold tracking-mono text-n700">{children}</span>;
}
