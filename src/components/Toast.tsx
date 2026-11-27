import { useCallback } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { Toaster } from './ui/sonner';

type ToastTone = 'success' | 'info' | 'danger';

/** Umpan balik nyata untuk setiap aksi, dirender oleh Toaster shadcn (sonner). */
export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <Toaster position="bottom-right" />
    </>
  );
}

export function useToast(): (message: string, tone?: ToastTone) => void {
  return useCallback((message: string, tone: ToastTone = 'success') => {
    // Error lebih lama tampil supaya terbaca, tapi tetap menutup sendiri.
    if (tone === 'danger') {
      toast.error(message, { duration: 8000 });
      return;
    }
    if (tone === 'success') {
      toast.success(message);
      return;
    }
    toast.info(message);
  }, []);
}
