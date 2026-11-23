import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime.js';
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime.js';
import { ToastProvider } from '../../src/components/Toast.tsx';
import { AdminRequestsPage } from '../../src/screens/Admin.tsx';
import * as store from '../../src/lib/store.ts';
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

function row(html: string, text: string): string {
  const match = [...html.matchAll(/<li\b[^>]*>[\s\S]*?<\/li>/g)].find(([markup]) => markup.includes(text));
  assert.ok(match, `Baris dengan ${text} harus dirender`);
  return match[0];
}

interface SelectOption { value: string; label: string; selected: boolean }

function labelledSelect(html: string, label: string): { attrs: string; options: SelectOption[] } {
  const forId = new RegExp(`<label\\b[^>]*for="([^"]+)"[^>]*>${label}\\b`).exec(html)?.[1];
  assert.ok(forId, `Label "${label}" harus merender select`);
  const select = new RegExp(`<select\\b([^>]*\\bid="${forId}"[^>]*)>([\\s\\S]*?)</select>`).exec(html);
  assert.ok(select, `Select dengan id ${forId} harus ada`);
  const options = [...select[2]!.matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)].map(([, attrs, text]) => ({
    value: /value="([^"]*)"/.exec(attrs!)?.[1] ?? text!,
    label: text!,
    selected: /\bselected=""/.test(attrs!),
  }));
  return { attrs: select[1]!, options };
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
  const html = render();
  const select = labelledSelect(row(html, 'dr_anon'), 'Kanal balasan');
  const selected = select.options.filter((option) => option.selected);
  assert.deepEqual(selected.map((option) => option.value), ['dianonimkan'], 'Nilai kanonis yang dikirim ke API tidak berubah');
  assert.equal(selected[0]?.label, 'Dianonimkan', 'Label select memakai teks manusiawi');
  assert.doesNotMatch(row(html, 'dr_anon').replace(/<[^>]+>/g, ' '), /\bdianonimkan\b/, 'Enum mentah tidak tampil sebagai teks');
});

test('NEW-UX-G: kanal balasan biasa tidak menawarkan nilai internal dianonimkan sebagai pilihan', async (t) => {
  await hydrate([request('dr_email', { response_channel: 'email', responded_by: 'u_admin', responded_at: '2026-11-16T02:00:00Z' })], t);
  const html = render();
  const select = labelledSelect(row(html, 'dr_email'), 'Kanal balasan');
  assert.equal(select.options.some((option) => option.value === 'dianonimkan'), false, 'Nilai retensi bukan pilihan balasan admin');
  assert.deepEqual(select.options.filter((option) => option.selected).map((option) => option.value), ['email']);
});
