import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime.js';
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime.js';
import { ToastProvider } from '../../src/components/Toast.tsx';
import { CreatorBootGate } from '../../src/components/CreatorBootGate.tsx';
import { loadBootstrap } from '../../src/lib/store.ts';

const router = {
  back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {}, bfcacheId: 'test',
};

function render(node: ReactNode): string {
  return renderToStaticMarkup(
    createElement(AppRouterContext.Provider, { value: router },
      createElement(PathnameContext.Provider, { value: '/creator' },
        createElement(SearchParamsContext.Provider, { value: new URLSearchParams() },
          createElement(ToastProvider, null, node)))),
  );
}

const CONTAINER = createElement('p', null, 'isi anak');

const ACCOUNT = {
  id: 'u_kreator_ui', display_name: 'Kreator Uji', email: 'kreator@svara.local',
  role: 'creator', status: 'active', organization_id: null,
};

test('NEW-UX-B sisa: bootstrap gagal tetap menampilkan navigasi creator dan tombol Keluar dari sesi /auth/me', async (t) => {
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/bootstrap')) throw new TypeError('fetch failed');
    if (url.endsWith('/auth/me')) return Response.json({ data: { account: ACCOUNT } });
    throw new Error(`Panggilan tak terduga: ${url}`);
  });
  await loadBootstrap();

  const html = render(createElement(CreatorBootGate, null, CONTAINER));
  assert.match(html, /<header\b/, 'Header harus tetap dirender saat bootstrap gagal');
  assert.match(html, /Daftar survei/, 'Navigasi creator tidak butuh data bootstrap dan harus tetap tampil');
  assert.match(html, /<button[^>]*>Keluar<\/button>/, 'Sesi masih valid lewat /auth/me, jadi tombol Keluar tetap ada');
  assert.doesNotMatch(html, /isi anak/, 'Konten layar tidak dirender saat bootstrap gagal');
  assert.doesNotMatch(html, /Pengalaman penggunaan alat bantu tugas/, 'Tidak boleh merender data contoh');
});
