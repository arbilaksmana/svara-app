'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { ToastProvider } from './Toast';
import { loadBootstrap } from '../lib/store';

/** Membawa satu bootstrap sesi untuk seluruh halaman, sama seperti RouterProvider sebelumnya. */
export function AppProviders({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  useEffect(() => {
    void loadBootstrap();
  }, []);

  useEffect(() => {
    if (!window.location.hash) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    document.getElementById('konten-utama')?.focus({ preventScroll: true });
  }, [pathname]);

  return <ToastProvider>{children}</ToastProvider>;
}
