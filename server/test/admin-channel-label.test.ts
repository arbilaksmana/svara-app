import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime.js';
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime.js';
import { ToastProvider } from '../../src/components/Toast.tsx';
import { AdminRequestsPage } from '../../src/screens/Admin.tsx';
import * as store from '../../src/lib/store.ts';
import { channelLabel, requestChannelOptions } from '../../src/lib/request-channels.ts';
import type { DataRequest } from '../../src/lib/api.ts';

const router = {
  back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {}, bfcacheId: 'test',
};

function render(): string {
  return renderToStaticMarkup(
    createElement(AppRouterContext.Provider, { value: router },
      createElement(PathnameContext.Provider, { value: '/admin/requests' },
        createElement(SearchParamsContext.Provider, { value: new URLSearchParams() },
          createElement(ToastProvider, null, createElement(AdminRequestsPage))))),
  );
}

function request(id: string, overrides: Partial<DataRequest> = {}): DataRequest {
  return {
    id, type: 'access', contact: 'pemohon@contoh.test', note: null, status: 'handled', outcome_note: 'Ditangani.',
    handled_by: 'u_admin', created_at: '2026-11-15T04:00:00Z', updated_at: '2026-11-15T04:00:00Z', ...overrides,
  };
}

async function hydrate(rows: DataRequest[], t: TestContext): Promise<void> {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ data: rows }));
  await store.loadDataRequests();
}

test('NEW-UX-G: kanal dianonimkan tampil dengan label manusiawi, bukan enum mentah', async (t) => {
  await hydrate([request('dr_anon', { response_channel: 'dianonimkan', responded_by: 'u_admin', responded_at: '2026-11-16T02:00:00Z' })], t);
  const page = render().replace(/<[^>]+>/g, ' ');
  assert.match(page, /Dianonimkan/, 'Kanal tersimpan tampil sebagai label manusiawi');
  assert.doesNotMatch(page, /\bdianonimkan\b/, 'Enum mentah tidak tampil sebagai teks halaman');
});

test('NEW-UX-G: kanal balasan biasa tidak menawarkan nilai internal dianonimkan sebagai pilihan', () => {
  const offered = requestChannelOptions('email').map(([value]) => value);
  assert.deepEqual(offered, ['email', 'phone', 'messaging', 'letter', 'in_person'], 'Kanal balasan hanya menawarkan lima kanal balasan');
  assert.equal(offered.includes('dianonimkan'), false, 'Nilai retensi bukan pilihan balasan admin');

  // Kanal teks bebas lewat API tetap terpilih supaya simpan ulang tidak menggantinya.
  assert.deepEqual(requestChannelOptions('Telepon kantor TU')[0], ['Telepon kantor TU', 'Telepon kantor TU']);

  // Nilai sistem tetap terbaca di luar dialog walau tidak pernah menjadi pilihan.
  assert.equal(channelLabel('dianonimkan'), 'Dianonimkan');
  assert.equal(channelLabel('email'), 'Email');
});
