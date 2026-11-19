import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { ReactNode } from 'react';

type ToastTone = 'success' | 'info' | 'danger';

interface ToastEntry {
  id: number;
  message: string;
  tone: ToastTone;
}

const ToastContext = createContext<((message: string, tone?: ToastTone) => void) | null>(null);

/** Umpan balik nyata untuk setiap aksi, tanpa kontrol debug di permukaan. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<ToastEntry[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setEntries((prev) => prev.filter((entry) => entry.id !== id));
  }, []);

  const notify = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = ++nextId.current;
    setEntries((prev) => [...prev, { id, message, tone }]);
    // Error perlu bertahan sampai ditutup; pengguna bisa saja sedang membaca halaman lain.
    if (tone !== 'danger') {
      window.setTimeout(() => dismiss(id), 4200);
    }
  }, [dismiss]);

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-toast flex flex-col items-end gap-2 sm:inset-x-auto sm:end-6 sm:max-w-sm"
      >
        {entries.map((e) => (
          <div
            key={e.id}
            role={e.tone === 'danger' ? 'alert' : 'status'}
            aria-atomic="true"
            className={`pointer-events-auto flex w-full items-start gap-3 rounded-md border px-4 py-3 shadow-overlay ${
              e.tone === 'success' ? 'border-success-soft bg-success-soft text-success'
                : e.tone === 'danger' ? 'border-danger-soft bg-danger-soft text-danger'
                  : 'border-action-subtle bg-action-soft text-action'
            }`}
          >
            <p className="min-w-0 flex-1 text-body-sm font-bold">{e.message}</p>
            {e.tone === 'danger' && (
              <button
                type="button"
                onClick={() => dismiss(e.id)}
                aria-label="Tutup pesan"
                className="min-h-[24px] min-w-[24px] shrink-0 text-body-sm font-bold leading-none"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): (message: string, tone?: ToastTone) => void {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('ToastProvider belum dipasang');
  return ctx;
}
