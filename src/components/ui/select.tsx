'use client';

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type SelectHTMLAttributes,
} from 'react';
import { ChevronDown } from 'runeicons-react/icons/ChevronDown';
import { cn } from '../../lib/utils';
import { withIconClass } from '../rune-icon';

const ChevronDownIcon = withIconClass(ChevronDown);

/**
 * Select gaya shadcn di atas `<select>` asli (tanpa Radix): bentuk dan fokus mengikuti token,
 * perilaku keyboard dan screen reader bawaan platform.
 *
 * Chevron menghadap naik selama daftar terbuka. `<select>` asli tidak memberi tahu buka/tutupnya,
 * jadi keadaannya dilacak: fokus membuka, lalu blur/nilai berubah/Escape/Enter menutup. Penutupan
 * yang dipicu pilihan ditahan 800 ms agar chevron tidak berbalik sebentar saat opsi dikonfirmasi
 * lewat keyboard dan focus tetap berada di trigger.
 */
const LINGER_AFTER_COMMIT_MS = 800;

export function Select({
  className,
  onFocus,
  onBlur,
  onChange,
  onKeyDown,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const [expanded, setExpanded] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const cancelClose = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
  };
  const collapse = () => {
    cancelClose();
    setExpanded(false);
  };
  const collapseAfterCommit = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setExpanded(false), LINGER_AFTER_COMMIT_MS);
  };

  return (
    <span className="relative inline-flex w-full min-w-0">
      <select
        className={cn(
          'min-h-[44px] w-full cursor-pointer appearance-none rounded-md border border-[var(--ad-control-border)] bg-[var(--ad-surface)] ps-3 pe-9 text-body-sm text-[color:var(--ad-text)] disabled:cursor-not-allowed disabled:opacity-60',
          'focus:border-[var(--ad-accent)] aria-invalid:border-2 aria-invalid:border-[var(--ad-danger)]',
          className,
        )}
        onFocus={(event) => {
          cancelClose();
          setExpanded(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          collapse();
          onBlur?.(event);
        }}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => {
          collapseAfterCommit();
          onChange?.(event);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') collapse();
          else if (event.key === 'Enter' || event.key === ' ') collapseAfterCommit();
          onKeyDown?.(event);
        }}
        {...props}
      />
      <ChevronDownIcon
        className={cn(
          'pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-[color:var(--ad-icon-low)] transition-transform duration-fast',
          expanded && 'rotate-180',
        )}
      />
    </span>
  );
}
