import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime.js';
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime.js';
import { CreatorListPage, EditorPage, PublishPage, SurveyNav } from '../../src/screens/CreatorCore.tsx';
import { HistoryPage, ResultsPage, SettingsPage, SharePage } from '../../src/screens/CreatorData.tsx';
import { OrgSurveysPage } from '../../src/screens/OrgSurveys.tsx';
import { ToastProvider } from '../../src/components/Toast.tsx';
import * as store from '../../src/lib/store.ts';
import type { BootstrapData } from '../../src/lib/api.ts';
import type { Account } from '../../src/lib/types.ts';
import { surveys, versions } from '../../src/lib/fixtures/surveys.ts';

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

const ORG_X_ADMIN = {
  id: 'u_admin_x', display_name: 'Admin Org X', email: 'adminx@svara.local',
  role: 'org_admin', status: 'active', organization_id: 'org_x',
} as const satisfies Account & { email: string };
const ORG_LESS_ADMIN = {
  id: 'u_admin_none', display_name: 'Admin Tanpa Org', email: 'adminnone@svara.local',
  role: 'org_admin', status: 'active', organization_id: null,
} as const satisfies Account & { email: string };
const CREATOR = {
  id: 'u_petugas', display_name: 'Petugas', email: 'petugas@svara.local',
  role: 'creator', status: 'active', organization_id: 'org_x',
} as const satisfies Account & { email: string };

const baseSurvey = { ...surveys[0]! };
const baseVersion = { ...versions[0]! };

const IN_ORG_X = { ...baseSurvey, id: 's_org_x', owner_id: 'u_lain', organization_id: 'org_x', title: 'Survei Org X', status: 'published' as const };
const IN_ORG_Y = { ...baseSurvey, id: 's_org_y', owner_id: 'u_lain', organization_id: 'org_y', title: 'Survei Org Y', status: 'published' as const };
const NO_ORG = { ...baseSurvey, id: 's_none', owner_id: 'u_lain', organization_id: null, title: 'Survei Individu', status: 'published' as const };
const OWN_GRANTED = { ...baseSurvey, id: 's_owned', owner_id: CREATOR.id, organization_id: 'org_x', title: 'Survei Milik Creator', status: 'published' as const };
const GRANTED = { ...baseSurvey, id: 's_granted', owner_id: 'u_lain', organization_id: 'org_x', title: 'Survei Ber-Grant', status: 'published' as const };

const ALL_SURVEYS = [IN_ORG_X, IN_ORG_Y, NO_ORG, OWN_GRANTED, GRANTED];

async function hydrate(account: Account & { email: string }, mock: TestContext['mock']): Promise<void> {
  const data: BootstrapData = {
    account,
    surveys: ALL_SURVEYS,
    versions: ALL_SURVEYS.map((s) => ({ ...baseVersion, id: `v_${s.id}`, survey_id: s.id, status: 'published' as const })),
    profiles: [], notices: [], surveyProfiles: {}, questions: [], options: [], invitations: [], publicLinks: [], assignments: [],
    settings: {}, grants: [], accounts: [], organizations: [], auditLogs: [], integrationEvents: [], dataRequests: [],
    serverTime: '2026-11-21T00:00:00Z',
  };
  mock.method(globalThis, 'fetch', async () => Response.json({ data }));
  await store.refreshBootstrap();
}

function row(html: string, title: string): string {
  const match = [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)].find(([markup]) => markup.includes(title));
  assert.ok(match, `Daftar harus menampilkan ${title}`);
  return match[0];
}

const manageLinks = /href="\/creator\/surveys\/[^"]+\/(edit|preview|publish|share|settings|history)"/;
const navManageLabels = /Editor|Pratinjau|Publikasi|Bagikan|Pengaturan|Riwayat/;

function assertManages(surveyId: string): void {
  const html = render(createElement(SurveyNav, { id: surveyId }));
  assert.match(html, /href="\/creator\/surveys\/[^"]+\/edit"/, 'Navigasi harus menawarkan Editor');
  for (const label of ['Editor', 'Pratinjau', 'Publikasi', 'Bagikan', 'Pengaturan', 'Riwayat']) {
    assert.ok(html.includes(label), `Navigasi harus menawarkan ${label}`);
  }
}

function assertReadsOnly(surveyId: string): void {
  const html = render(createElement(SurveyNav, { id: surveyId }));
  assert.doesNotMatch(html, navManageLabels, 'Hanya hasil yang boleh ditawarkan');
  assert.match(html, new RegExp(`href="/creator/surveys/${surveyId}/results"`));
}

test('ORS-01: org_admin membaca jawaban individual dan ekspor pada survei organisasinya', async (t) => {
  await hydrate(ORG_X_ADMIN, t.mock);
  const html = render(createElement(ResultsPage, { id: IN_ORG_X.id }));
  assert.match(html, /Muat jawaban individual/);
  assert.doesNotMatch(html, /Izin baca individual diperlukan/);
  assert.match(html, /Ekspor diizinkan/);
});

test('ORS-01: creator memegang survei sendiri tetapi tidak mendapat hak kelola survei organisasi lain', async (t) => {
  await hydrate(CREATOR, t.mock);
  assertReadsOnly(IN_ORG_X.id);
  const results = render(createElement(ResultsPage, { id: IN_ORG_X.id }));
  assert.match(results, /Izin baca individual diperlukan/);
});

test('ORS-02a: org_admin organisasi X mendapat tombol kelola di survei organisasi X', async (t) => {
  await hydrate(ORG_X_ADMIN, t.mock);
  const html = render(createElement(CreatorListPage));
  const orgRow = row(html, IN_ORG_X.title);
  assert.match(orgRow, /Buka editor/);
  assert.match(orgRow, /Salin survei/);
  assert.doesNotMatch(orgRow, /Diberikan akses/);
  assertManages(IN_ORG_X.id);
  for (const screen of [
    render(createElement(EditorPage, { id: IN_ORG_X.id })),
    render(createElement(PublishPage, { id: IN_ORG_X.id })),
    render(createElement(SharePage, { id: IN_ORG_X.id })),
    render(createElement(SettingsPage, { id: IN_ORG_X.id })),
    render(createElement(HistoryPage, { id: IN_ORG_X.id })),
  ]) {
    assert.doesNotMatch(screen, /Survei tidak ditemukan/, 'Layar kelola tidak boleh menolak org_admin organisasi pemilik survei');
  }
});

test('ORS-02e: daftar survei org_admin menawarkan salin tanpa kontrol pembuatan draf creator', async (t) => {
  await hydrate(ORG_X_ADMIN, t.mock);
  const html = render(createElement(OrgSurveysPage));
  const orgRow = row(html, IN_ORG_X.title);
  assert.match(orgRow, /Buka editor/);
  assert.match(orgRow, /Salin survei/);
  assert.doesNotMatch(html, /Lingkup draf baru|Buat draf baru|Hanya creator dapat membuat survei/);
});

test('ORS-02b: org_admin organisasi X tidak mendapat tombol kelola di survei organisasi Y', async (t) => {
  await hydrate(ORG_X_ADMIN, t.mock);
  const html = render(createElement(CreatorListPage));
  const otherRow = row(html, IN_ORG_Y.title);
  assert.doesNotMatch(otherRow, manageLinks);
  assert.match(otherRow, /Lihat hasil/);
  assertReadsOnly(IN_ORG_Y.id);
  assert.match(render(createElement(EditorPage, { id: IN_ORG_Y.id })), /Survei tidak ditemukan/);
});

test('ORS-02c: org_admin tanpa organisasi tidak mendapat tombol kelola pada survei organization_id NULL', async (t) => {
  await hydrate(ORG_LESS_ADMIN, t.mock);
  const html = render(createElement(CreatorListPage));
  const noneRow = row(html, NO_ORG.title);
  assert.doesNotMatch(noneRow, manageLinks);
  assertReadsOnly(NO_ORG.id);
  assert.match(render(createElement(SettingsPage, { id: NO_ORG.id })), /Survei tidak ditemukan/);
});

test('ORS-02d: creator tetap mengelola survei miliknya, survei ber-grant hanya "Lihat hasil"', async (t) => {
  await hydrate(CREATOR, t.mock);
  const html = render(createElement(CreatorListPage));
  const owned = row(html, OWN_GRANTED.title);
  assert.match(owned, /Buka editor/);
  assert.match(owned, /Salin survei/);
  assert.doesNotMatch(owned, /Diberikan akses/);
  assertManages(OWN_GRANTED.id);

  const granted = row(html, GRANTED.title);
  assert.match(granted, /Diberikan akses/);
  assert.match(granted, /Lihat hasil/);
  assert.doesNotMatch(granted, manageLinks);
  assertReadsOnly(GRANTED.id);
});

test('ORS-01: super admin melihat semua survei tetapi tidak berhak kelola dalam lingkup BR-02', async (t) => {
  const superAdmin = { id: 'u_super', display_name: 'Super', email: 'super@svara.local', role: 'super_admin', status: 'active', organization_id: null } as const;
  await hydrate(superAdmin, t.mock);
  assertReadsOnly(IN_ORG_X.id);
});
