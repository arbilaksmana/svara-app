import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime.js';
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime.js';
import * as storage from '../../src/lib/draft.ts';
import * as respondent from '../../src/screens/Respondent.tsx';
import { ToastProvider } from '../../src/components/Toast.tsx';
import { ApiError, type ConsentPayload, type PublicContextData, type ReceiptData } from '../../src/lib/api.ts';

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

const router = {
  back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {}, bfcacheId: 'test',
};

function render(node: ReactNode): string {
  return renderToStaticMarkup(
    createElement(AppRouterContext.Provider, { value: router },
      createElement(PathnameContext.Provider, { value: '/s/tok_a/receipt' },
        createElement(SearchParamsContext.Provider, { value: new URLSearchParams() },
          createElement(ToastProvider, null, node)))),
  );
}

const visibleText = (html: string) => html.replace(/<[^>]+>/g, ' ');

function consent(id: string): ConsentPayload {
  return {
    consent_id: id, respondent_click: true, basis: 'Persetujuan diri', notice_version: 'N-1',
    guardian_evidence_status: 'not_required', guardian_evidence_ref: null,
  };
}

function receipt(id: string, key: string): ReceiptData {
  return { response_id: id, survey_id: 's_demo', version_number: 1, submitted_at: '2026-11-22T01:00:00Z', status: 'submitted', idempotency_key: key };
}

function DraftProbe({ token, version }: { token: string; version: number }) {
  const { draft } = storage.useDraft(token, version, ['Q1']);
  return createElement('output', null, draft.Q1?.optionId ?? '');
}

const draftOption = (token: string, version = 1) =>
  renderToStaticMarkup(createElement(DraftProbe, { token, version })).replace(/<\/?output>/g, '');

const CTX: PublicContextData = {
  kind: 'public',
  isPublicLink: true,
  state: 'active',
  canSubmit: true,
  guardianRequired: false,
  survey: { title: 'Survei Kebiasaan Belajar', purpose: 'Uji', object_label: 'Siswa', instructions: '' },
  version: { number: 1, notice_version: 'N-1' },
  consent_version: 'djE',
  questions: [],
  options: [],
  profile: {
    id: 'platform', organization_name: 'Platform Uji', organization_type: 'organization',
    policy_url: '/privacy', terms_url: '/terms', retention_days: 365, data_request_contact: 'privasi@uji.test',
    cross_border_transfer: false, notice_version: 'N-1', synthetic_placeholder: false,
  },
  notice: {
    id: 'n1', profile_id: 'platform', version: 'N-1', effective_date: '2026-11-01', purpose: 'Uji', data_categories: 'Jawaban',
    module15_usage: 'Tidak ada', retention_text: '365 hari', recipients: 'Pengelola', contact: 'privasi@uji.test', rights: 'Akses',
    child_data_text: 'Tidak', cross_border_text: 'Tidak', synthetic_placeholder: false,
  },
  invitation: null,
};

/** Cari elemen tombol dengan teks tertentu di pohon elemen tanpa merender komponen anaknya. */
function findClickable(node: ReactNode, label: string): { onClick: () => void } | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findClickable(child, label);
      if (found) return found;
    }
    return undefined;
  }
  if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(node)) return undefined;
  if (node.props.onClick && node.props.children === label) return { onClick: node.props.onClick };
  return findClickable(node.props.children, label);
}

test('SEC-07/BF-08: bukti dan kunci idempotensi disimpan per token, bukan global', () => {
  const keyA = storage.submissionKey('tok_a', 1, false)!;
  const keyB = storage.submissionKey('tok_b', 1, false)!;
  assert.notEqual(keyA, keyB);

  storage.completeSubmission('tok_a', receipt('r_a', keyA), keyA);
  assert.deepEqual(storage.readReceipt('tok_a'), { receipt: receipt('r_a', keyA), key: keyA });
  assert.equal(storage.readReceipt('tok_b'), null, 'Bukti token A tidak boleh tampil pada token B');
  assert.equal(storage.submissionKey('tok_b', 1, true), keyB, 'Kunci retry token B tidak ikut terhapus oleh kiriman token A');

  storage.completeSubmission('tok_b', receipt('r_b', keyB), keyB);
  assert.equal(storage.readReceipt('tok_a')?.receipt.response_id, 'r_a', 'Bukti token B tidak menimpa bukti token A');
  assert.equal(storage.readReceipt('tok_a')?.key, keyA);
  assert.equal(storage.readReceipt('tok_b')?.receipt.response_id, 'r_b');
  assert.equal(storage.readReceipt('tok_b')?.key, keyB);
});

test('SEC-07/BF-08: kirim sukses menghapus consent, draft, dan kunci token itu; retry sebelumnya memakai kunci sama', () => {
  // Urutan alur nyata: persetujuan di pengantar lebih dulu, kunci kirim dibuat saat tombol kirim ditekan.
  storage.writeConsent('tok_a', consent('c_a'));
  storage.writeConsent('tok_b', consent('c_b'));
  const keyA = storage.submissionKey('tok_a', 1, false)!;
  assert.equal(storage.submissionKey('tok_a', 1, false), keyA, 'Retry identik sebelum bukti diterima memakai kunci yang sama');
  assert.equal(storage.submissionKey('tok_a', 1, true), keyA);
  const keyB = storage.submissionKey('tok_b', 1, false)!;

  sessionStorage.setItem('svara.draft.tok_a.1', JSON.stringify({ Q1: { optionId: 'o_a', text: '' } }));
  sessionStorage.setItem('svara.draft.tok_b.1', JSON.stringify({ Q1: { optionId: 'o_b', text: '' } }));
  assert.equal(storage.readConsent('tok_a')?.consent_id, 'c_a');
  assert.equal(draftOption('tok_a'), 'o_a');

  storage.completeSubmission('tok_a', receipt('r_a', keyA), keyA);

  assert.equal(storage.readConsent('tok_a'), null, 'Responden berikutnya wajib klik persetujuan lagi');
  assert.equal(draftOption('tok_a'), '', 'Draft responden sebelumnya tidak terbawa');
  assert.equal(storage.submissionKey('tok_a', 1, true), null, 'Tidak ada kunci retry yang diwariskan');
  const nextKey = storage.submissionKey('tok_a', 1, false);
  assert.ok(nextKey && nextKey !== keyA, 'Pengisian berikutnya memakai kunci idempotensi baru');

  assert.equal(storage.readConsent('tok_b')?.consent_id, 'c_b', 'Token lain tidak tersentuh');
  assert.equal(draftOption('tok_b'), 'o_b');
  assert.equal(storage.submissionKey('tok_b', 1, true), keyB);
});

test('SEC-07: persetujuan baru pada token yang sama tidak lagi menampilkan bukti responden sebelumnya', () => {
  storage.completeSubmission('tok_a', receipt('r_a', 'key-a-123'), 'key-a-123');
  storage.completeSubmission('tok_b', receipt('r_b', 'key-b-123'), 'key-b-123');
  storage.writeConsent('tok_a', consent('c_next'));
  assert.equal(storage.readReceipt('tok_a'), null);
  assert.equal(storage.readReceipt('tok_b')?.receipt.response_id, 'r_b');
});

const TRANSIENT = [
  new ApiError(0, { code: 'network_error', error: 'Server tidak dapat dijangkau. Periksa koneksi lalu coba lagi.' }),
  new ApiError(503, {}),
  new ApiError(500, { code: 'internal_error', error: 'connect ECONNREFUSED 127.0.0.1:5432' }),
];

test('UIX-07: gagal muat sementara menampilkan "Coba lagi" yang memanggil ulang pemuatan', () => {
  for (const error of TRANSIENT) {
    const html = render(createElement(respondent.PublicLoadError, { token: 'tok_a', error, onRetry: () => {} }));
    assert.match(html, /<button[^>]*>Coba lagi<\/button>/, `Galat ${error.status} harus menawarkan Coba lagi`);
    assert.doesNotMatch(html, /<button[^>]*\sdisabled=""[^>]*>Coba lagi/);
    assert.ok(!visibleText(html).includes('ECONNREFUSED'), 'Pesan teknis mentah tidak ditampilkan');

    let calls = 0;
    const tree = respondent.PublicLoadError({ token: 'tok_a', error, onRetry: () => { calls += 1; } });
    const retry = findClickable(tree, 'Coba lagi');
    assert.ok(retry, 'Tombol Coba lagi harus memegang aksi muat ulang');
    retry.onClick();
    assert.equal(calls, 1, 'Coba lagi memanggil ulang pemuatan konteks');
  }
});

test('UIX-07: galat permanen tanpa "Coba lagi" dan tanpa pesan teknis mentah', () => {
  const permanent = [
    new ApiError(404, { code: 'token_not_found', error: 'Tautan tidak dikenal.' }),
    new ApiError(409, { code: 'link_revoked', error: 'Tautan ini sudah tidak aktif.' }),
    new ApiError(409, { code: 'submission_expired', error: 'Formulir tidak dapat dibuka: expired.' }),
    new ApiError(409, { code: 'submission_closed', error: 'Formulir tidak dapat dibuka: closed.' }),
  ];
  for (const error of permanent) {
    const html = render(createElement(respondent.PublicLoadError, { token: 'tok_a', error, onRetry: () => {} }));
    const text = visibleText(html);
    assert.doesNotMatch(html, /Coba lagi/, `${error.code} tidak boleh menawarkan Coba lagi`);
    assert.ok(!text.includes(error.message), `${error.code} tidak boleh menampilkan pesan mentah "${error.message}"`);
    assert.doesNotMatch(text, /\b(closed|expired|revoked|token_not_found|link_revoked)\b/);
    assert.match(html, /href="\/"/, 'Tetap ada jalan kembali ke beranda');
  }
});

test('UIX-06: halaman bukti tanpa storage tidak merender tombol nonaktif tanpa alternatif', () => {
  const html = render(createElement(respondent.ReceiptView, { token: 'tok_a', ctx: CTX, stored: null }));
  assert.doesNotMatch(html, /<button[^>]*\sdisabled=""/, 'Tidak ada tombol nonaktif pada halaman bukti tanpa storage');
  assert.match(html, /<label[^>]*for="receipt-response-id"[^>]*>ID bukti/);
  assert.match(html, /<input[^>]*id="receipt-response-id"/);
  assert.match(html, /<label[^>]*for="receipt-key"[^>]*>Kunci pengiriman/);
  assert.match(html, /<input[^>]*id="receipt-key"/);
  assert.match(html, /<button type="submit"[^>]*>Pulihkan bukti<\/button>/);
  assert.match(html, /privasi@uji\.test/, 'Kontak pengelola dari pemberitahuan ditampilkan');
});

test('UIX-06: bukti tersimpan untuk token ini tetap tampil dan dapat dipulihkan ulang', () => {
  const stored = { receipt: receipt('r_a', 'key-a-123'), key: 'key-a-123' };
  const html = render(createElement(respondent.ReceiptView, { token: 'tok_a', ctx: CTX, stored }));
  assert.match(html, /r_a/);
  assert.doesNotMatch(html, /<button[^>]*\sdisabled=""/);
  assert.match(html, /<button[^>]*>Pulihkan bukti<\/button>/);
  assert.doesNotMatch(html, /id="receipt-response-id"/);
});
