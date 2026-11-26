'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { cn } from '../../lib/utils';

/**
 * Dropdown menu minimal gaya shadcn tanpa Radix (dependensi dibatasi): root menampung state buka,
 * trigger adalah <button>, konten menu absolute di dalam root. Escape atau klik di luar menutup
 * menu dan mengembalikan fokus ke trigger; item adalah tombol asli sehingga tetap keyboard-navigable.
 */
interface DropdownContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}

const DropdownContext = createContext<DropdownContextValue | null>(null);

function useDropdown(component: string): DropdownContextValue {
  const context = useContext(DropdownContext);
  if (!context) throw new Error(`${component} harus dipakai di dalam <DropdownMenu />`);
  return context;
}

export function DropdownMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  return (
    <DropdownContext.Provider value={{ open, setOpen, triggerRef }}>
      <div ref={rootRef} className="relative">
        {children}
      </div>
    </DropdownContext.Provider>
  );
}

export function DropdownMenuTrigger({ className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { open, setOpen, triggerRef } = useDropdown('DropdownMenuTrigger');
  return (
    <button
      ref={triggerRef}
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={() => setOpen(!open)}
      className={cn('cursor-pointer', className)}
      {...props}
    >
      {children}
    </button>
  );
}

export function DropdownMenuContent({
  className,
  align = 'end',
  side = 'bottom',
  children,
  ...props
}: {
  className?: string;
  align?: 'start' | 'end';
  /** 'top' untuk menu yang membuka ke atas (mis. footer sidebar). */
  side?: 'top' | 'bottom';
  children: ReactNode;
}) {
  const { open } = useDropdown('DropdownMenuContent');
  if (!open) return null;
  return (
    <div
      role="menu"
      className={cn(
        'absolute z-overlay min-w-[10rem] rounded-md border border-[var(--ad-border)] bg-[var(--ad-surface)] p-1 shadow-overlay',
        side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
        align === 'end' ? 'end-0' : 'start-0',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

const menuItemClass =
  'flex min-h-[36px] w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-start text-body-sm text-[var(--ad-text)] transition-colors duration-fast hover:bg-[var(--ad-soft)]';

export function DropdownMenuItem({
  className,
  onSelect,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { onSelect?: () => void }) {
  const { setOpen } = useDropdown('DropdownMenuItem');
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        setOpen(false);
        onSelect?.();
      }}
      className={cn(menuItemClass, className)}
      {...props}
    >
      {children}
    </button>
  );
}

/** Item dengan tanda centang; menu tetap terbuka agar beberapa kolom bisa diubah sekaligus. */
export function DropdownMenuCheckboxItem({
  className,
  checked,
  onCheckedChangeAction,
  children,
}: {
  className?: string;
  checked: boolean;
  /** Dinamai *Action sesuai aturan serialisasi prop pada file 'use client'. */
  onCheckedChangeAction: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={() => onCheckedChangeAction(!checked)}
      className={cn(menuItemClass, className)}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-[4px] border',
          checked ? 'border-[var(--ad-accent)] bg-[var(--ad-accent)] text-[var(--ad-accent-contrast)]' : 'border-[var(--ad-border)]',
        )}
      >
        {checked && (
          <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M2.5 6.5 5 9l4.5-6" />
          </svg>
        )}
      </span>
      {children}
    </button>
  );
}

export function DropdownMenuLabel({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={cn('px-2 py-1.5 text-caption font-bold text-[var(--ad-muted)]', className)}>{children}</p>;
}

export function DropdownMenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-[var(--ad-border)]" />;
}
