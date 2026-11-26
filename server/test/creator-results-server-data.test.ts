import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime.js';
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime.js';
import { ToastProvider } from '../../src/components/Toast.tsx';
import { ResultsPage } from '../../src/screens/CreatorData.tsx';
import { surveys, versions } from '../../src/lib/fixtures/surveys.ts';
import { refreshBootstrap } from '../../src/lib/store.ts';
import type { BootstrapData } from '../../src/lib/api.ts';

const router = {
  back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {}, bfcacheId: 'test',
};

function render(id: string): string {
  return renderToStaticMarkup(
    createElement(AppRouterContext.Provider, { value: router },
      createElement(PathnameContext.Provider, { value: `/creator/surveys/${id}/results` },
        createElement(SearchParamsContext.Provider, { value: new URLSearchParams() },
          createElement(ToastProvider, null, createElement(ResultsPage, { id }))))),
  );
}

const FIXTURE_TITLE = surveys[0]!.title;

test('NEW-UX-A sisa: halaman hasil tidak merender survei fixture sebelum bootstrap berhasil', () => {
  const html = render('s_demo1');
  assert.doesNotMatch(html, new RegExp(FIXTURE_TITLE), 'Judul survei fixture tidak boleh tampil sebagai data server');
  assert.doesNotMatch(html, /Unduh CSV|Unduh kodebook/, 'Kontrol ekspor tidak boleh muncul dari data contoh');
  assert.match(html.replace(/<[^>]+>/g, ' '), /Survei tidak ditemukan/, 'Tanpa data server, halaman menyatakan survei tidak diketahui');
});

const grantedSurvey = { ...surveys[0]!, id: 's_free_text', title: 'Survei izin teks bebas' };
const grantedVersion = { ...versions[0]!, id: 'v_s_free_text', survey_id: grantedSurvey.id };

async function hydrateOfficer(mock: TestContext['mock'], canReadFreeText: boolean) {
  const data: BootstrapData = {
    account: { id: 'u_petugas', display_name: 'Petugas', email: 'officer@svara.local', role: 'creator', status: 'active', organization_id: 'org_smk' },
    surveys: [grantedSurvey],
    versions: [grantedVersion],
    profiles: [], notices: [], surveyProfiles: {}, questions: [], options: [], invitations: [], publicLinks: [], assignments: [],
    settings: { [grantedSurvey.id]: { allowResults: true, allowIndividual: true, consentRequired: 'tidak' } },
    grants: [{
      id: 'g_free_text',
      account_id: 'u_petugas',
      survey_id: grantedSurvey.id,
      can_read_individual: true,
      can_export: false,
      can_read_free_text: canReadFreeText,
    }],
    accounts: [], organizations: [], auditLogs: [], integrationEvents: [], dataRequests: [], serverTime: '2026-11-21T00:00:00Z',
  };
  mock.method(globalThis, 'fetch', async () => Response.json({ data }));
  await refreshBootstrap();
}

test('T5: petugas berizin teks bebas tidak lagi melihat peringatan izin terpisah', async (t) => {
  await hydrateOfficer(t.mock, true);
  const html = render(grantedSurvey.id);
  assert.match(html, /Jawaban individual/, 'Kartu jawaban individual harus dirender untuk petugas ber-grant');
  assert.doesNotMatch(html, /Teks bebas hanya tampil dengan izin terpisah/, 'Izin teks bebas sudah ada; kalimat peringatan lama kontradiktif');
  assert.match(html, /teks bebas hanya untuk penerima berizin/i, 'Keterangan pengganti harus menyebut siapa yang boleh membaca teks bebas');
});

test('T5: tanpa izin teks bebas, peringatan izin terpisah tetap tampil', async (t) => {
  await hydrateOfficer(t.mock, false);
  const html = render(grantedSurvey.id);
  assert.match(html, /Teks bebas hanya tampil dengan izin terpisah/, 'Tanpa izin, peringatan tetap wajib tampil');
});
