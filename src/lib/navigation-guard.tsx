'use client';

import { createContext, useContext, useEffect, useMemo } from 'react';
import type { MouseEvent, ReactNode } from 'react';

interface NavigationGuardValue {
  dirty: boolean;
  message: string;
}

const NavigationGuardContext = createContext<NavigationGuardValue | null>(null);

const DEFAULT_MESSAGE = 'Perubahan belum disimpan. Tinggalkan halaman ini?';

/** Menahan navigasi klien dan reload saat ada perubahan yang belum disimpan. */
export function NavigationGuardProvider({
  dirty,
  message = DEFAULT_MESSAGE,
  children,
}: {
  dirty: boolean;
  message?: string;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ dirty, message }), [dirty, message]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  return <NavigationGuardContext.Provider value={value}>{children}</NavigationGuardContext.Provider>;
}

export function useNavigationGuard(): NavigationGuardValue | null {
  return useContext(NavigationGuardContext);
}

function sameDocument(href: string): boolean {
  try {
    const target = new URL(href, window.location.href);
    return target.pathname === window.location.pathname && target.search === window.location.search;
  } catch {
    return false;
  }
}

/** Mengembalikan true bila navigasi boleh dilanjutkan. */
export function allowNavigation(event: MouseEvent<HTMLAnchorElement>, guard: NavigationGuardValue | null): boolean {
  if (!guard?.dirty) return true;
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return true;
  const href = event.currentTarget.getAttribute('href');
  if (href && sameDocument(href)) return true;
  return window.confirm(guard.message);
}

/** Untuk tombol aksi yang meninggalkan halaman, mis. keluar. */
export function confirmIfDirty(guard: NavigationGuardValue | null): boolean {
  if (!guard?.dirty) return true;
  return window.confirm(guard.message);
}

