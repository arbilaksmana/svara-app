import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime.js';
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime.js';
import { AdminSummaryPage } from '../../src/screens/Admin.tsx';
import { ToastProvider } from '../../src/components/Toast.tsx';
import * as store from '../../src/lib/store.ts';
import type { AdminStats } from '../../src/lib/api.ts';

const router = {
  back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {}, bfcacheId: 'test',
};

const GUEST_NAV = /Kemampuan|Persetujuan|Alur|FAQ/;

function render(): string {
  return renderToStaticMarkup(
    createElement(AppRouterContext.Provider, { value: router },
      createElement(PathnameContext.Provider, { value: '/admin' },
        createElement(SearchParamsContext.Provider, { value: new URLSearchParams() },
          createElement(ToastProvider, null, createElement(AdminSummaryPage))))),
  );
}

const READY_STATS: AdminStats = {
  accounts: 7,
  surveys: 12,
  responses: 345,
  pendingRequests: 2,
  perCreator: [{ id: 'u_petugas', display_name: 'Petugas Lapangan', surveys: 3, responses: 120 }],
  perSurvey: [{ id: 's_demo1', title: 'Survei Kebiasaan Belajar', owner: 'Petugas Lapangan', versions: 2, responses: 120 }],
};

const okStats = () => Response.json({ data: READY_STATS });

type DeferredResponse = { promise: Promise<Response>; resolve: (value: Response) => void; reject: (reason?: unknown) => void };

test('UIX-02: permintaan yang dibatalkan saat layar dilepas tidak membalik UI ke galat', async (t) => {
  const consoleErrors: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => { consoleErrors.push(args); });

  const pending: DeferredResponse[] = [];
  t.mock.method(globalThis, 'fetch', () => {
    const deferred: DeferredResponse = Promise.withResolvers<Response>();
    pending.push(deferred);
    return deferred.promise;
  });

  const request = store.loadAdminStats();
  store.cancelAdminStatsLoad();
  pending[0]!.reject(new TypeError('aborted'));
  await request;

  const html = render();
  assert.match(html, /Memuat ringkasan operasional/);
  assert.doesNotMatch(html, /gagal dimuat/);
  assert.deepEqual(consoleErrors, []);
});

test('UIX-02: bootstrap admin gagal menampilkan galat, bukan KPI palsu atau nav tamu', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('fetch failed'); });
  await store.loadBootstrap();

  const html = render();
  assert.match(html, /Ringkasan operasional gagal dimuat/);
  assert.match(html, /Coba lagi/);
  assert.doesNotMatch(html, /Jumlah survei/);
  assert.doesNotMatch(html, /Total respons final/);
  assert.doesNotMatch(html, /Akun pengelola/);
  assert.doesNotMatch(html, GUEST_NAV, 'Nav tamu tidak boleh tampil di halaman admin');
  assert.doesNotMatch(html, />Masuk</);
});

test('UIX-02: ringkasan berhasil hanya merender angka dari respons server', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => okStats());
  await store.loadAdminStats();

  const html = render();
  assert.doesNotMatch(html, /gagal dimuat/);
  assert.match(html, /Survei Kebiasaan Belajar/);
  for (const value of [READY_STATS.surveys, READY_STATS.responses, READY_STATS.accounts, READY_STATS.pendingRequests]) {
    assert.match(html, new RegExp(`>${value}<`), `KPI ${value} harus berasal dari respons server`);
  }
  // Kartu KPI sengaja hanya label + angka: tanpa lencana tren, teks keterangan, maupun tautan cepat.
  assert.doesNotMatch(html, /\+100%|>Baru<|Tren 30 hari|Termasuk draf|Buka permintaan/);
  assert.doesNotMatch(html, /NaN|Infinity|undefined/);
});
