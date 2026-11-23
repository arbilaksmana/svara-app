import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, isValidElement, type ElementType, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime.js';
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime.js';
import { ToastProvider } from '../../src/components/Toast.tsx';
import { ConfirmDialog } from '../../src/components/ui.tsx';
import { UnsentAttemptChoiceView } from '../../src/screens/Respondent.tsx';
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

const router = {
  back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {}, bfcacheId: 'test',
};

function render(node: ReactNode): string {
  return renderToStaticMarkup(
    createElement(AppRouterContext.Provider, { value: router },
      createElement(PathnameContext.Provider, { value: '/s/tok_a' },
        createElement(SearchParamsContext.Provider, { value: new URLSearchParams() },
          createElement(ToastProvider, null, node)))),
  );
}

function view(confirming: boolean, handlers: Partial<{
  onResume: () => void;
  onRequestRestart: () => void;
  onCancelRestart: () => void;
  onConfirmRestart: () => void;
}> = {}) {
  const calls = { resume: 0, request: 0, cancel: 0, confirm: 0 };
  return {
    calls,
    tree: UnsentAttemptChoiceView({
      confirming,
      onResume: handlers.onResume ?? (() => { calls.resume += 1; }),
      onRequestRestart: handlers.onRequestRestart ?? (() => { calls.request += 1; }),
      onCancelRestart: handlers.onCancelRestart ?? (() => { calls.cancel += 1; }),
      onConfirmRestart: handlers.onConfirmRestart ?? (() => { calls.confirm += 1; }),
    }),
  };
}

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

function findByType<P>(node: ReactNode, type: ElementType): { props: P } | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByType<P>(child, type);
      if (found) return found;
    }
    return undefined;
  }
  if (!isValidElement<{ children?: ReactNode }>(node)) return undefined;
  if (node.type === type) return { props: node.props as P };
  return findByType<P>(node.props.children, type);
}

interface DialogProps { open: boolean; title: string; detail: string; confirmLabel?: string; onConfirm: () => void; onClose: () => void }

const DRAFT = JSON.stringify({
  Q1: { optionId: 'o_sering', text: '' },
  Q2: { optionId: null, text: 'Jawaban teks orang sebelumnya' },
});

test('NEW-UX-F: konfirmasi hanya diminta saat draf berisi jawaban', () => {
  storage.writeConsent(TOKEN, consent('c_persetujuan_saja'));
  assert.equal(storage.hasDraft(TOKEN), false, 'Persetujuan tanpa jawaban bukan draf berisi');

  sessionStorage.setItem(`svara.draft.${TOKEN}.1`, DRAFT);
  assert.equal(storage.hasDraft(TOKEN), true, 'Draf dengan pilihan atau teks harus dikonfirmasi');

  sessionStorage.setItem(`svara.draft.${TOKEN}.1`, JSON.stringify({ Q1: { optionId: null, text: '   ' } }));
  assert.equal(storage.hasDraft(TOKEN), false, 'Draf kosong tidak perlu konfirmasi');
});

test('NEW-UX-F: tombol responden baru meminta konfirmasi, bukan langsung menghapus', () => {
  const { tree, calls } = view(false);
  findClickable(tree, 'Mulai sebagai responden baru')!.onClick();
  assert.deepEqual(calls, { resume: 0, request: 1, cancel: 0, confirm: 0 }, 'Klik pertama hanya meminta konfirmasi');

  const dialog = findByType<DialogProps>(tree, ConfirmDialog)!;
  assert.equal(dialog.props.open, false, 'Dialog belum terbuka sebelum dikonfirmasi');
});

test('NEW-UX-F: dialog konfirmasi memakai ConfirmDialog dengan judul, akibat, dan label aksi yang jelas', () => {
  const tree = UnsentAttemptChoiceView({
    confirming: true, onResume() {}, onRequestRestart() {}, onCancelRestart() {}, onConfirmRestart() {},
  });
  const dialog = findByType<DialogProps>(tree, ConfirmDialog)!;
  assert.equal(dialog.props.open, true, 'Dialog terbuka saat menunggu konfirmasi');

  const html = render(tree);
  assert.match(html, /<dialog\b/, 'Konfirmasi memakai elemen dialog native dari ConfirmDialog');
  assert.match(html, /Hapus isian yang belum dikirim\?/);
  assert.match(html, /Persetujuan, jawaban, dan kunci kirim yang tersimpan di tab ini akan dihapus/);
  assert.match(html, /<button[^>]*>Hapus isian<\/button>/);
  assert.match(html, /<button[^>]*>Batal<\/button>/);
  assert.doesNotMatch(html, /Jawaban teks orang sebelumnya|o_sering/, 'Isi draf tidak ditampilkan di dialog');
});

test('NEW-UX-F: konfirmasi dan batal diteruskan ke handler yang benar', () => {
  const { tree, calls } = view(true);
  const dialog = findByType<DialogProps>(tree, ConfirmDialog)!;
  dialog.props.onConfirm();
  dialog.props.onClose();
  assert.deepEqual(calls, { resume: 0, request: 0, cancel: 1, confirm: 1 });
});
