import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime.js';
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime.js';
import { AdminSummaryPage } from '../../src/screens/Admin.tsx';
import { ToastProvider } from '../../src/components/Toast.tsx';
import * as store from '../../src/lib/store.ts';
import * as api from '../../src/lib/api.ts';
import type { AdminStats, ChartRange } from '../../src/lib/api.ts';

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
  chart: [
    { point: '2026-11-26', responses: 300 },
    { point: '2026-11-27', responses: 45 },
  ],
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
  // Deret `chart` dari server mengisi kartu tren: ringkasan label memuat total dan titiknya.
  assert.match(html, /Respons 30 hari terakhir \(total 345\): 26\/11 300, 27\/11 45\./);
  assert.doesNotMatch(html, /Belum ada data respons/);
});

test('chart: adminStats mengirim rentang yang dipilih di query', async (t) => {
  const urls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    urls.push(String(input));
    return okStats();
  });

  await api.adminStats('7d');
  await api.adminStats();
  assert.deepEqual(urls, ['/api/v1/admin/stats?range=7d', '/api/v1/admin/stats?range=30d']);
});

test('chart: mengganti rentang memuat ulang deret dengan nilai baru', async (t) => {
  const urls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    const range = new URL(url, 'http://localhost').searchParams.get('range');
    if (range === 'today') {
      const chart = Array.from({ length: 24 }, (_, hour) => ({
        point: `2026-11-27T${String(hour).padStart(2, '0')}`,
        responses: 1,
      }));
      return Response.json({ data: { ...READY_STATS, chart } });
    }
    const chart = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'].map((point) => ({ point, responses: 1 }));
    return Response.json({ data: { ...READY_STATS, chart } });
  });

  const load = async (range: ChartRange) => {
    await store.loadAdminStats(range);
    return render();
  };

  // Layar SSR memakai state rentang awalnya (30d); yang diuji adalah deret yang masuk ke store
  // setelah tiap pemuatan, bukan label pemilih.
  const today = await load('today');
  assert.match(today, /Respons 30 hari terakhir \(total 24\)/);
  assert.doesNotMatch(today, /Belum ada data respons/);

  const sixMonths = await load('6m');
  assert.match(sixMonths, /Respons 30 hari terakhir \(total 6\)/);
  assert.doesNotMatch(sixMonths, /Belum ada data respons/);
  assert.deepEqual(urls, ['/api/v1/admin/stats?range=today', '/api/v1/admin/stats?range=6m']);
});
