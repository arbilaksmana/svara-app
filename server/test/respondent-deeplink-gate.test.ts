import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import * as storage from '../../src/lib/draft.ts';
import type { ConsentPayload } from '../../src/lib/api.ts';

class MemoryStorage implements Storage {
  #items = new Map<string, string>();
  get length() { return this.#items.size; }
  clear() { this.#items.clear(); }
  getItem(key: string) { return this.#items.get(key) ?? null; }
  key(index: number) { return [...this.#items.keys()][index] ?? null; }
  removeItem(key: string) { this.#items.delete(key); }
  setItem(key: string, value: string) { this.#items.set(key, String(value)); }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'sessionStorage', { value: new MemoryStorage(), configurable: true, writable: true });
});

const TOKEN = 'tok_a';

function consent(id: string): ConsentPayload {
  return {
    consent_id: id, respondent_click: true, basis: 'Persetujuan diri', notice_version: 'N-1',
    guardian_evidence_status: 'not_required', guardian_evidence_ref: null,
  };
}

/** Responden sebelumnya meninggalkan persetujuan dan draf di tab ini tanpa bukti kirim. */
function abandonWithDraft(): void {
  storage.writeConsent(TOKEN, consent('c_sebelumnya'));
  sessionStorage.setItem(`svara.draft.${TOKEN}.1`, JSON.stringify({
    Q1: { optionId: 'o_sering', text: '' },
    Q2: { optionId: null, text: 'Jawaban teks orang sebelumnya' },
  }));
}

test('NR-08: masuk langsung ke /form atau /review dengan isian tertinggal wajib lewat gerbang pilihan', () => {
  abandonWithDraft();
  assert.equal(storage.attemptGateNeeded(TOKEN), true, 'Deep link tanpa tanda alur harus meminta pilihan responden');

  // Pengantar/form menandai navigasinya sendiri sebelum pindah halaman.
  storage.markFlowEntry(TOKEN);
  assert.equal(storage.attemptGateNeeded(TOKEN), false, 'Navigasi dari alur yang sama tidak digerbangi lagi');

  // Muat ulang halaman atau masuk langsung berikutnya setelah tanda sekali pakai dikonsumsi.
  storage.clearFlowEntry(TOKEN);
  assert.equal(storage.attemptGateNeeded(TOKEN), true, 'Reload/deep link kembali menawarkan pilihan');
  assert.equal(storage.attemptGateNeeded('tok_lain'), false, 'Token tanpa isian tertinggal tidak digerbangi');
});

test('NR-08: memilih responden baru menghapus tanda alur sehingga isian berikutnya tetap digerbangi', () => {
  abandonWithDraft();
  storage.markFlowEntry(TOKEN);
  storage.discardAttempt(TOKEN);
  assert.equal(storage.hasUnsentAttempt(TOKEN), false, 'Persetujuan, draf, dan kunci kirim dihapus');
  assert.equal(storage.attemptGateNeeded(TOKEN), false, 'Tidak ada isian untuk digerbangi');

  abandonWithDraft();
  assert.equal(storage.attemptGateNeeded(TOKEN), true, 'Isian baru tanpa tanda alur tetap digerbangi');
});

test('NR-08: gerbang hanya membaca token itu dan tidak menyentuh token lain', () => {
  abandonWithDraft();
  storage.writeConsent('tok_b', consent('c_b'));
  assert.equal(storage.attemptGateNeeded(TOKEN), true);
  assert.equal(storage.attemptGateNeeded('tok_b'), true, 'Token B punya persetujuan tanpa tanda alur');
  storage.markFlowEntry('tok_b');
  assert.equal(storage.attemptGateNeeded(TOKEN), true);
  assert.equal(storage.attemptGateNeeded('tok_b'), false, 'Tanda alur token B tidak membuka gerbang token A');
});
