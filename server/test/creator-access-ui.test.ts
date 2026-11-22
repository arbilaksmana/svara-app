import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime.js';
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime.js';
import { CreatorListPage, SurveyNav } from '../../src/screens/CreatorCore.tsx';
import { ToastProvider } from '../../src/components/Toast.tsx';
import { refreshBootstrap } from '../../src/lib/store.ts';
import type { BootstrapData } from '../../src/lib/api.ts';
import { surveys, versions } from '../../src/lib/fixtures/surveys.ts';

const grantedSurvey = { ...surveys[0]!, id: 's_granted', title: 'Survei yang diberikan' };
const ownedSurvey = { ...surveys[0]!, id: 's_owned', owner_id: 'u_petugas', title: 'Survei milik sendiri' };
const version = { ...versions[0]! };
const unexpectedNavigation = () => { throw new Error('Render tidak boleh melakukan navigasi'); };
const router = {
  back: unexpectedNavigation, forward: unexpectedNavigation, refresh: unexpectedNavigation,
  hmrRefresh: unexpectedNavigation, push: unexpectedNavigation, replace: unexpectedNavigation,
  prefetch: unexpectedNavigation, bfcacheId: 'test',
};

function render(node: ReactNode): string {
  return renderToStaticMarkup(
    createElement(AppRouterContext.Provider, { value: router },
      createElement(PathnameContext.Provider, { value: '/creator' },
        createElement(SearchParamsContext.Provider, { value: new URLSearchParams() },
          createElement(ToastProvider, null, node)))),
  );
}

async function hydrate(surveyList: BootstrapData['surveys'], mock: TestContext['mock']) {
  const data: BootstrapData = {
    account: { id: 'u_petugas', display_name: 'Petugas', email: 'officer@svara.local', role: 'creator', status: 'active', organization_id: 'org_smk' },
    surveys: surveyList,
    versions: surveyList.map((s) => ({ ...version, id: `v_${s.id}`, survey_id: s.id })),
    profiles: [], notices: [], surveyProfiles: {}, questions: [], options: [], invitations: [], publicLinks: [], assignments: [],
    settings: {}, grants: [], accounts: [], organizations: [], auditLogs: [], integrationEvents: [], dataRequests: [], serverTime: '2026-11-21T00:00:00Z',
  };
  mock.method(globalThis, 'fetch', async () => Response.json({ data }));
  await refreshBootstrap();
}

function row(html: string, title: string): string {
  const match = [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)].find(([markup]) => markup.includes(title));
  assert.ok(match, `Daftar harus menampilkan ${title}`);
  return match[0];
}

const ownerActions = /Buka editor|Salin survei|Publikasi|Bagikan|Pengaturan|Riwayat|Pratinjau/;

test('UIX-01: daftar grant tetap terlihat dan membedakan akses dari kepemilikan', async (t) => {
  await hydrate([grantedSurvey, ownedSurvey], t.mock);
  const html = render(createElement(CreatorListPage));
  const granted = row(html, grantedSurvey.title);
  assert.match(granted, /Diberikan akses/, 'Survei ber-grant harus memiliki label akses');
  assert.match(granted, /href="\/creator\/surveys\/s_granted\/results"/);
  assert.doesNotMatch(granted, ownerActions, 'Bukan pemilik tidak mendapat aksi pengelolaan');
  const owned = row(html, ownedSurvey.title);
  assert.match(owned, /Buka editor/);
  assert.match(owned, /Salin survei/);
  assert.doesNotMatch(owned, /Diberikan akses/);
});

test('UIX-01: petugas yang hanya memegang grant tidak melihat keadaan daftar kosong', async (t) => {
  await hydrate([grantedSurvey], t.mock);
  const html = render(createElement(CreatorListPage));
  assert.match(row(html, grantedSurvey.title), /Lihat hasil/);
  assert.doesNotMatch(html, /Belum memiliki survei/);
  assert.doesNotMatch(html, ownerActions);
});

test('UIX-01: navigasi survei ber-grant hanya menawarkan hasil, navigasi pemilik tetap lengkap', async (t) => {
  await hydrate([grantedSurvey, ownedSurvey], t.mock);
  const granted = render(createElement(SurveyNav, { id: grantedSurvey.id }));
  assert.match(granted, /href="\/creator\/surveys\/s_granted\/results"/);
  assert.doesNotMatch(granted, /Editor|Pratinjau|Publikasi|Bagikan|Pengaturan|Riwayat/);
  const owned = render(createElement(SurveyNav, { id: ownedSurvey.id }));
  for (const label of ['Editor', 'Pratinjau', 'Publikasi', 'Bagikan', 'Hasil', 'Pengaturan', 'Riwayat']) {
    assert.ok(owned.includes(label), `Pemilik tetap dapat membuka ${label}`);
  }
});
