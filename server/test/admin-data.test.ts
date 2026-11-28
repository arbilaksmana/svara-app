import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime.js';
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime.js';
import { AdminAccountsPage, AdminAuditPage, AdminIntegrationPage } from '../../src/screens/Admin.tsx';
import { AdminOrgPage } from '../../src/screens/Org.tsx';
import { ToastProvider } from '../../src/components/Toast.tsx';
import * as store from '../../src/lib/store.ts';
import type { BootstrapData } from '../../src/lib/api.ts';
import type { Account, AccessGrant, AuditLog, IntegrationEvent, OrgAuditRow, OrgMember, OrgProfile, Survey } from '../../src/lib/types.ts';
import { accounts, auditLogs, integrationEvents } from '../../src/lib/fixtures/records.ts';
import { surveys } from '../../src/lib/fixtures/surveys.ts';

/*
 * NEW-UX-A/B, sisa UIX-02, NEW-UX-D. Urutan test penting: store adalah singleton modul, jadi test
 * "belum bootstrap" dan "bootstrap gagal" berjalan sebelum bootstrap yang berhasil.
 */

const unexpectedNavigation = () => { throw new Error('Render tidak boleh melakukan navigasi'); };
const router = {
  back: unexpectedNavigation, forward: unexpectedNavigation, refresh: unexpectedNavigation,
  hmrRefresh: unexpectedNavigation, push: unexpectedNavigation, replace: unexpectedNavigation,
  prefetch: unexpectedNavigation, bfcacheId: 'test',
};

function render(page: ComponentType, pathname: string): string {
  return renderToStaticMarkup(
    createElement(AppRouterContext.Provider, { value: router },
      createElement(PathnameContext.Provider, { value: pathname },
        createElement(SearchParamsContext.Provider, { value: new URLSearchParams() },
          createElement(ToastProvider, null, createElement(page))))),
  );
}

const ADMIN_PAGES = [
  ['/admin/accounts', AdminAccountsPage],
  ['/admin/audit', AdminAuditPage],
  ['/admin/integration', AdminIntegrationPage],
] as const;

/* Nilai fixture klien diambil saat impor, sebelum bootstrap mana pun mengganti isi array modul. */
const FIXTURE_MARKERS = [
  ...new Set([
    ...auditLogs.map((log) => log.actor),
    ...accounts.flatMap((account) => [account.display_name, account.id]),
    ...integrationEvents.map((event) => event.event_id),
    ...surveys.map((survey) => survey.title),
  ]),
];
const baseSurvey: Survey = { ...surveys[0]! };

function assertNoFixture(html: string, where: string): void {
  const leaked = FIXTURE_MARKERS.filter((marker) => html.includes(marker));
  assert.deepEqual(leaked, [], `${where} merender data fixture klien sebagai data server`);
}

function main(html: string): string {
  const match = /<main\b[^>]*>([\s\S]*)<\/main>/.exec(html);
  assert.ok(match, 'Halaman harus merender <main>');
  return match[1]!;
}

function text(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

/** Teks tombol, select, dan input yang dapat dioperasikan di dalam <main>. */
function controls(html: string): string[] {
  const body = main(html);
  const buttons = [...body.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map(([, inner]) => `button:${text(inner!)}`);
  const fields = [...body.matchAll(/<(select|input|textarea)\b/g)].map(([, tag]) => tag!);
  // Radix Select: kontrolnya <button role="combobox">, bukan <select>.
  const comboboxes = [...body.matchAll(/<button\b[^>]*\brole="combobox"/g)].map(() => 'combobox');
  return [...buttons, ...fields, ...comboboxes];
}

function row(html: string, needle: string): string {
  const match = [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)].find(([markup]) => markup.includes(needle));
  assert.ok(match, `Baris dengan ${needle} harus dirender`);
  return match[0];
}

function cells(rowHtml: string): string[] {
  return [...rowHtml.matchAll(/<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/g)].map(([, , inner]) => inner!);
}

/* ---------- Data server yang realistis: ID acak, nama tidak sama dengan ID ---------- */

const ADMIN = {
  id: 'u_59b8298503cf8354', display_name: 'Lestari Wulandari', email: 'lestari.wulandari@dinas-pendidikan.example',
  role: 'super_admin', status: 'active', organization_id: null,
} as const satisfies Account & { email: string };
const ORG_ADMIN = {
  id: 'u_807f1f2f77770738', display_name: 'Yoga Prasetyo', role: 'org_admin', status: 'active', organization_id: 'org_ead8ad625f808fcc',
} as const satisfies Account;
const CREATOR = {
  id: 'u_ce6e3d6ad4e1cff8', display_name: 'Maya Kartika', role: 'creator', status: 'suspended', organization_id: 'org_ead8ad625f808fcc',
} as const satisfies Account;
/** Akun yang sudah dihapus: masih menjadi aktor audit, tetapi tidak ada di daftar akun bootstrap. */
const REMOVED_ACCOUNT_ID = 'u_3c9f00d1e2b4a5c6';

const SURVEY: Survey = { ...baseSurvey, id: 's_9627c9239055bedf', owner_id: CREATOR.id, title: 'Survei Iklim Kelas 2026' };
const GRANT: AccessGrant = {
  id: 'g_4b1d0c9e2a7f3e11', account_id: CREATOR.id, survey_id: SURVEY.id,
  can_read_individual: true, can_export: false, can_read_free_text: false,
};
const AUDIT: AuditLog[] = [
  { id: 'log_c0a1e2', actor: ADMIN.id, action: 'Masuk akun', object: ADMIN.id, outcome: 'berhasil', at: '2026-11-23T03:19:42.759Z' },
  { id: 'log_c0a1e3', actor: ORG_ADMIN.id, action: 'Ubah profil organisasi', object: 'org_ead8ad625f808fcc', outcome: 'berhasil', at: '2026-11-23T02:40:11.020Z' },
  { id: 'log_c0a1e4', actor: REMOVED_ACCOUNT_ID, action: 'Ekspor CSV', object: `${SURVEY.id} · v1`, outcome: 'ditolak', at: '2026-11-22T09:05:00.000Z' },
  { id: 'log_c0a1e5', actor: 'publik', action: 'Kirim respons', object: `${SURVEY.id} · v1`, outcome: 'berhasil', at: '2026-11-22T08:00:00.000Z' },
];
const EVENTS: IntegrationEvent[] = [
  { id: 'ie_be1784d2ac456f40', event_id: 'ev_8b75f080e96e18ec', type: 'survey.submitted', target: 'module_13', status: 'pending', attempts: 2, at: '2026-11-22T08:00:02.000Z', simulated: true },
];

const BOOTSTRAP: BootstrapData = {
  account: ADMIN, surveys: [SURVEY], versions: [], profiles: [], notices: [], surveyProfiles: {}, questions: [], options: [],
  invitations: [], publicLinks: [], assignments: [], settings: {}, grants: [GRANT],
  accounts: [CREATOR, ADMIN, ORG_ADMIN],
  organizations: [{ id: 'org_ead8ad625f808fcc', name: 'SMP Negeri 4 Sukamaju', organization_type: 'school' }],
  auditLogs: AUDIT, integrationEvents: EVENTS, dataRequests: [], serverTime: '2026-11-23T03:20:00.000Z',
};

function failFetch(mock: TestContext['mock']): void {
  mock.method(globalThis, 'fetch', async () => { throw new TypeError('fetch failed'); });
}

/* ---------- 1. Bootstrap belum selesai (SSR dan render pertama setelah muat langsung/reload) ---------- */

test('NEW-UX-A/B: sebelum bootstrap selesai, akun/audit/integrasi menampilkan keadaan memuat tanpa fixture dan tanpa kontrol', () => {
  assert.ok(FIXTURE_MARKERS.includes('creator-a') && FIXTURE_MARKERS.includes('Rani Wijaya'), 'Penanda fixture harus terbaca dari fixture klien');
  for (const [pathname, page] of ADMIN_PAGES) {
    const html = render(page, pathname);
    assertNoFixture(html, pathname);
    assert.match(main(html), /aria-busy="true"/, `${pathname} harus menampilkan keadaan memuat`);
    assert.match(text(main(html)), /Memuat/, `${pathname} harus menyebut bahwa data sedang dimuat`);
    assert.deepEqual(controls(html), [], `${pathname} tidak boleh merender kontrol aksi sebelum data server tersedia`);
  }
});

/* ---------- 2. Bootstrap gagal ---------- */

test('NEW-UX-B/UIX-02: bootstrap gagal menampilkan galat dan Coba lagi, tanpa fixture dan tanpa kontrol aksi', async (t) => {
  failFetch(t.mock);
  await store.loadBootstrap();

  for (const [pathname, page] of ADMIN_PAGES) {
    const html = render(page, pathname);
    assertNoFixture(html, pathname);
    assert.match(main(html), /role="alert"/, `${pathname} harus menampilkan galat`);
    assert.match(text(main(html)), /gagal dimuat/, `${pathname} harus menyatakan data gagal dimuat`);
    assert.match(text(main(html)), /Server tidak dapat dijangkau/, `${pathname} harus meneruskan pesan galat bootstrap`);
    assert.deepEqual(controls(html), ['button:Coba lagi'], `${pathname} hanya boleh menawarkan Coba lagi`);
  }
});

test('NEW-UX-B: menyimpan izin tanpa data server tidak mengirim grant fixture ke server', async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    calls.push(String(input));
    return Response.json({ data: null });
  });

  const outcome = await store.saveGrants({}).then(() => 'tersimpan', (error: unknown) => error);
  assert.deepEqual(
    calls.filter((url) => url.includes('/admin/grants/')),
    [],
    'Grant fixture (ID yang bisa sama dengan ID seed) tidak boleh dikirim ke server',
  );
  assert.ok(outcome instanceof Error, 'Penyimpanan tanpa data server harus ditolak');
});

/* ---------- 3. Bootstrap berhasil ---------- */

test('NEW-UX-A/D: bootstrap berhasil hanya merender baris server dan aktor audit tampil sebagai nama akun', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ data: BOOTSTRAP }));
  await store.loadBootstrap();

  const audit = render(AdminAuditPage, '/admin/audit');
  assertNoFixture(audit, '/admin/audit');
  assert.equal([...main(audit).matchAll(/<tr\b/g)].length - 1, AUDIT.length, 'Hanya baris audit dari server yang dirender');

  const known = cells(row(audit, 'Masuk akun'))[1]!;
  assert.match(text(known), /Lestari Wulandari/, 'Aktor yang dikenal tampil sebagai nama akun, bukan ID mentah');
  assert.ok(text(known).includes(ADMIN.id), 'ID akun tetap tersedia sebagai keterangan');
  assert.match(text(cells(row(audit, 'Ubah profil organisasi'))[1]!), /Yoga Prasetyo/);

  const removed = cells(row(audit, 'Ekspor CSV'))[1]!;
  assert.equal(text(removed), REMOVED_ACCOUNT_ID, 'Aktor yang tidak ada di daftar akun tampil sebagai ID');
  assert.match(removed, /font-mono/, 'ID cadangan ditandai sebagai kode, bukan nama');
  assert.equal(text(cells(row(audit, 'Kirim respons'))[1]!), 'publik');

  const accountsHtml = render(AdminAccountsPage, '/admin/accounts');
  assertNoFixture(accountsHtml, '/admin/accounts');
  for (const name of ['Lestari Wulandari', 'Yoga Prasetyo', 'Maya Kartika', 'SMP Negeri 4 Sukamaju', 'Survei Iklim Kelas 2026']) {
    assert.ok(accountsHtml.includes(name), `${name} dari bootstrap harus tampil di akun dan izin`);
  }
  const activate = /<button\b([^>]*aria-label="Aktifkan Maya Kartika"[^>]*)>/.exec(row(accountsHtml, 'Maya Kartika'));
  assert.ok(activate, 'Tombol Aktifkan harus dirender untuk akun nonaktif dari server');
  assert.doesNotMatch(activate[1]!, /\sdisabled=""/, 'Kontrol aksi aktif setelah data server tersedia');
  const own = row(accountsHtml, 'Lestari Wulandari');
  const ownRole = /<button\b([^>]*aria-label="Peran Lestari Wulandari"[^>]*)>/.exec(own)?.[1];
  assert.ok(ownRole, 'Pemilih peran akun sendiri dirender');
  assert.match(ownRole, /\sdisabled=""/, 'Peran akun sendiri tidak dapat diubah');
  const ownStatus = /<button\b([^>]*aria-label="Nonaktifkan Lestari Wulandari"[^>]*)>/.exec(own)?.[1];
  assert.ok(ownStatus, 'Tombol status akun sendiri dirender');
  assert.match(ownStatus, /\sdisabled=""/, 'Status akun sendiri tidak dapat diubah');

  const integration = render(AdminIntegrationPage, '/admin/integration');
  assertNoFixture(integration, '/admin/integration');
  assert.match(row(integration, 'ev_8b75f080e96e18ec'), /<button\b[^>]*>Ulangi<\/button>/);
  // Tabel desktop dan daftar mobile sama-sama dirender (disembunyikan via CSS), jadi tiap event muncul dua kali.
  const ulangi = [...main(integration).matchAll(/<button\b[^>]*>Ulangi<\/button>/g)].length;
  assert.equal(ulangi / EVENTS.length, 2, 'Hanya event server yang dirender');
});

/* ---------- 4. Log organisasi (NEW-UX-D) ---------- */

const ORG_PROFILE: OrgProfile = {
  id: 'org_ead8ad625f808fcc', organization_name: 'SMP Negeri 4 Sukamaju', organization_type: 'school',
  policy_url: 'https://smpn4.example/privasi', terms_url: 'https://smpn4.example/ketentuan',
  retention_days: 365, data_request_contact: 'privasi@smpn4.example', cross_border_transfer: 0, notice_version: '1.0',
};
const ORG_MEMBERS: OrgMember[] = [
  { id: ORG_ADMIN.id, email: 'yoga.prasetyo@smpn4.example', display_name: ORG_ADMIN.display_name, role: 'org_admin', status: 'active', created_at: '2026-11-01T01:00:00Z' },
  { id: CREATOR.id, email: 'maya.kartika@smpn4.example', display_name: CREATOR.display_name, role: 'creator', status: 'active', created_at: '2026-11-02T01:00:00Z' },
];
const ORG_AUDIT: OrgAuditRow[] = [
  { id: 'log_d1', at: '2026-11-23T02:40:11.020Z', actor: ORG_ADMIN.id, action: 'Ubah profil organisasi', object: ORG_PROFILE.id, outcome: 'berhasil' },
  { id: 'log_d2', at: '2026-11-22T07:00:00.000Z', actor: ADMIN.id, action: 'Ubah akun', object: CREATOR.id, outcome: 'berhasil' },
];

test('NEW-UX-D: kolom aktor log organisasi menampilkan nama anggota, ID untuk aktor di luar organisasi', async (t) => {
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/org/profile')) return Response.json({ data: { source: 'organization', profile: ORG_PROFILE } });
    if (url.includes('/org/members')) return Response.json({ data: { members: ORG_MEMBERS } });
    if (url.includes('/org/invitations')) return Response.json({ data: { invitations: [], ttl_days: 14 } });
    if (url.includes('/org/audit')) return Response.json({ data: { rows: ORG_AUDIT } });
    throw new Error(`Permintaan tak terduga: ${url}`);
  });
  await store.loadOrgWorkspace();

  const html = render(AdminOrgPage, '/admin/org');
  const member = cells(row(html, 'Ubah profil organisasi'))[1]!;
  assert.match(text(member), /^Yoga Prasetyo/, 'Aktor anggota organisasi tampil sebagai nama');
  assert.ok(text(member).includes(ORG_ADMIN.id), 'ID akun tetap tersedia sebagai keterangan');
  const outsider = cells(row(html, 'Ubah akun'))[1]!;
  assert.equal(text(outsider), ADMIN.id, 'Aktor di luar daftar anggota tampil sebagai ID');
  assert.match(outsider, /font-mono/);
});
