import { useCallback, useState } from 'react';

export type DraftValue = { optionId: string | null; text: string };

const KEY = 'modul14.preview.draft.v1';

function readAll(): Record<string, Record<string, DraftValue>> {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, Record<string, DraftValue>>;
    }
  } catch {
    // Penyimpanan lokal rusak diabaikan; draft dimulai kosong.
  }
  return {};
}

function writeAll(next: Record<string, Record<string, DraftValue>>): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Kuota atau mode privat: draft tetap hidup di memori selama halaman terbuka.
  }
}

/**
 * Draft lokal untuk mengikuti alur intro → form → tinjau → bukti.
 * Ini bukan penyimpanan server dan tidak menggantikan transaksi PRD §6.1.
 */
export function useDraft(token: string, questionCodes: string[]) {
  const [draft, setDraft] = useState<Record<string, DraftValue>>(() => {
    const all = readAll();
    const base: Record<string, DraftValue> = {};
    for (const code of questionCodes) {
      base[code] = all[token]?.[code] ?? { optionId: null, text: '' };
    }
    return base;
  });

  const setOption = useCallback((code: string, optionId: string) => {
    setDraft((prev) => {
      const next = { ...prev, [code]: { ...prev[code], optionId } };
      const all = readAll();
      all[token] = { ...all[token], ...next };
      writeAll(all);
      return next;
    });
  }, [token]);

  const setText = useCallback((code: string, text: string) => {
    setDraft((prev) => {
      const next = { ...prev, [code]: { ...prev[code], text } };
      const all = readAll();
      all[token] = { ...all[token], ...next };
      writeAll(all);
      return next;
    });
  }, [token]);

  const clear = useCallback(() => {
    const all = readAll();
    delete all[token];
    writeAll(all);
  }, [token]);

  return { draft, setOption, setText, clear };
}

export const RECEIPT_KEY = 'modul14.preview.receipt';
