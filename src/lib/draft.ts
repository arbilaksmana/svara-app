import { useCallback, useEffect, useState } from 'react';
import type { ConsentPayload, ReceiptData } from './api';

export type DraftValue = { optionId: string | null; text: string };

export interface StoredReceipt {
  receipt: ReceiptData;
  key: string;
}

const DRAFT_PREFIX = 'svara.draft.';
const CONSENT_PREFIX = 'svara.consent.';
const IDEMPOTENCY_PREFIX = 'svara.idempotency.';
const RECEIPT_PREFIX = 'svara.receipt.';

function readJson(key: string): unknown {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    // Penyimpanan lokal rusak diabaikan; draft dimulai kosong.
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Kuota atau mode privat: draft tetap hidup di memori selama halaman terbuka.
  }
}

function removeKey(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Tanpa akses penyimpanan tidak ada data token yang tertinggal di perangkat.
  }
}

/** Hapus semua kunci `prefix + token + '.' + nomor versi` milik satu token tanpa menyentuh token lain. */
function removeVersions(prefix: string, token: string): void {
  const base = `${prefix}${token}.`;
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(base) && /^\d+$/.test(key.slice(base.length))) keys.push(key);
    }
    for (const key of keys) sessionStorage.removeItem(key);
  } catch {
    // Tanpa akses penyimpanan tidak ada data token yang tertinggal di perangkat.
  }
}

export function readConsent(token: string): ConsentPayload | null {
  const consent = readJson(CONSENT_PREFIX + token) as Partial<ConsentPayload> | null;
  return consent?.respondent_click && consent.consent_id ? (consent as ConsentPayload) : null;
}

/**
 * Persetujuan baru menandai pengisian baru pada token ini, jadi bukti pengisian sebelumnya tidak ikut tampil.
 * Persetujuan tetap divalidasi server saat pengiriman.
 */
export function writeConsent(token: string, consent: ConsentPayload): void {
  removeKey(RECEIPT_PREFIX + token);
  writeJson(CONSENT_PREFIX + token, consent);
}

/** Kunci idempotensi per token dan versi; retry dipakai ulang dengan kunci yang sama sampai bukti diterima. */
export function submissionKey(token: string, versionNumber: number, retryOnly: boolean): string | null {
  const key = `${IDEMPOTENCY_PREFIX}${token}.${versionNumber}`;
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    if (retryOnly) return null;
    const created = crypto.randomUUID();
    sessionStorage.setItem(key, created);
    return created;
  } catch {
    return retryOnly ? null : crypto.randomUUID();
  }
}

export function readReceipt(token: string): StoredReceipt | null {
  const stored = readJson(RECEIPT_PREFIX + token) as Partial<StoredReceipt> | null;
  return stored?.receipt?.response_id && stored.key ? (stored as StoredReceipt) : null;
}

export function saveReceipt(token: string, receipt: ReceiptData, key: string): void {
  writeJson(RECEIPT_PREFIX + token, { receipt, key });
}

/**
 * Respons final diterima: bukti disimpan untuk token ini, lalu persetujuan, draft, dan kunci idempotensi
 * token itu dihapus agar responden berikutnya di tab yang sama mulai dari pengantar dengan kunci baru.
 */
export function completeSubmission(token: string, receipt: ReceiptData, key: string): void {
  saveReceipt(token, receipt, key);
  removeKey(CONSENT_PREFIX + token);
  removeVersions(DRAFT_PREFIX, token);
  removeVersions(IDEMPOTENCY_PREFIX, token);
}

function readDraft(key: string | null): Record<string, DraftValue> {
  const parsed = key ? readJson(key) : null;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, DraftValue>) : {};
}

/**
 * Draft lokal untuk mengikuti alur intro → form → tinjau → bukti.
 * Ini bukan penyimpanan server dan tidak menggantikan transaksi PRD §6.1.
 */
export function useDraft(token: string, version: number | null, questionCodes: string[]) {
  const key = version === null ? null : `${DRAFT_PREFIX}${token}.${version}`;
  const [draft, setDraft] = useState<Record<string, DraftValue>>(() => {
    const stored = readDraft(key);
    const base: Record<string, DraftValue> = {};
    for (const code of questionCodes) {
      base[code] = stored[code] ?? { optionId: null, text: '' };
    }
    return base;
  });

  useEffect(() => {
    setDraft((prev) => {
      const stored = readDraft(key);
      const next = { ...prev };
      let changed = false;
      for (const code of questionCodes) {
        if (!(code in next)) {
          next[code] = stored[code] ?? { optionId: null, text: '' };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // Kode pertanyaan berubah setelah konteks server selesai dimuat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, questionCodes.join('|')]);

  const setOption = useCallback((code: string, optionId: string) => {
    setDraft((prev) => {
      const next = { ...prev, [code]: { ...prev[code], optionId } };
      if (key) writeJson(key, { ...readDraft(key), ...next });
      return next;
    });
  }, [key]);

  const setText = useCallback((code: string, text: string) => {
    setDraft((prev) => {
      const next = { ...prev, [code]: { ...prev[code], text } };
      if (key) writeJson(key, { ...readDraft(key), ...next });
      return next;
    });
  }, [key]);

  return { draft, setOption, setText };
}
