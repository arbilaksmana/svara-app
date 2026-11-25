import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime.js';
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime.js';
import { CreatorListPage, PublishPage } from '../../src/screens/CreatorCore.tsx';
import { HistoryPage, ResultsPage, SharePage } from '../../src/screens/CreatorData.tsx';
import { AdminAccountsPage, AdminAuditPage, AdminIntegrationPage, AdminRequestsPage } from '../../src/screens/Admin.tsx';
import { AdminOrgPage } from '../../src/screens/Org.tsx';
import { ToastProvider } from '../../src/components/Toast.tsx';
import * as store from '../../src/lib/store.ts';
import type { BootstrapData, DataRequest } from '../../src/lib/api.ts';
import type { Account, OrgAuditRow, OrgInvitation, OrgMember, OrgProfile, PublicLink, Survey, SurveyVersion } from '../../src/lib/types.ts';
import { surveys, versions } from '../../src/lib/fixtures/surveys.ts';

const unexpectedNavigation = () => { throw new Error('Render tidak boleh melakukan navigasi'); };
const router = {
  back: unexpectedNavigation, forward: unexpectedNavigation, refresh: unexpectedNavigation,
  hmrRefresh: unexpectedNavigation, push: unexpectedNavigation, replace: unexpectedNavigation,
  prefetch: unexpectedNavigation, bfcacheId: 'test',
};

function render(node: ReactNode, pathname: string): string {
  return renderToStaticMarkup(
    createElement(AppRouterContext.Provider, { value: router },
      createElement(PathnameContext.Provider, { value: pathname },
        createElement(SearchParamsContext.Provider, { value: new URLSearchParams() },
          createElement(ToastProvider, null, node)))),
  );
}

/* Salinan dibuat saat impor, sebelum hydrate mengganti isi array fixture. */
const baseSurvey: Survey = { ...surveys[0]! };
const baseVersion: SurveyVersion = { ...versions[0]! };

const OWNER = {
  id: 'u_pemilik', display_name: 'Pemilik Survei', email: 'pemilik@svara.local',
  role: 'creator', status: 'active', organization_id: 'org_smk',
} as const satisfies Account & { email: string };
const SUPER_ADMIN = {
  id: 'u_super', display_name: 'Super Admin', email: 'admin@svara.local',
  role: 'super_admin', status: 'active', organization_id: null,
} as const satisfies Account & { email: string };

function survey(id: string, overrides: Partial<Survey> = {}): Survey {
  return { ...baseSurvey, id, owner_id: OWNER.id, title: `Survei ${id}`, ...overrides };
}

function version(id: string, surveyId: string, overrides: Partial<SurveyVersion> = {}): SurveyVersion {
  return { ...baseVersion, id, survey_id: surveyId, question_ids: [], ...overrides };
}

async function hydrate(mock: TestContext['mock'], data: Partial<BootstrapData>): Promise<void> {
  const payload: BootstrapData = {
    account: OWNER, surveys: [], versions: [], profiles: [], notices: [], surveyProfiles: {}, questions: [], options: [],
    invitations: [], publicLinks: [], assignments: [], settings: {}, grants: [], accounts: [], organizations: [],
    auditLogs: [], integrationEvents: [], dataRequests: [], serverTime: '2026-11-21T00:00:00Z',
    ...data,
  };
  mock.method(globalThis, 'fetch', async () => Response.json({ data: payload }));
  await store.refreshBootstrap();
}

function failFetch(mock: TestContext['mock']): void {
  mock.method(globalThis, 'fetch', async () => { throw new TypeError('fetch failed'); });
}

/** Elemen pertama yang teksnya persis `label`, beserta nama tag dan atributnya. */
function control(html: string, label: string): { tag: string; attrs: string } {
  const match = new RegExp(`<(a|span|button)\\b([^>]*)>\\s*${label}\\s*</\\1>`).exec(html);
  assert.ok(match, `Kontrol "${label}" harus dirender`);
  return { tag: match[1]!, attrs: match[2]! };
}

function row(html: string, text: string): string {
  const match = [...html.matchAll(/<(tr|li)\b[^>]*>[\s\S]*?<\/\1>/g)].find(([markup]) => markup.includes(text));
  assert.ok(match, `Baris dengan ${text} harus dirender`);
  return match[0];
}

const ISO_DATE = /\d{4}-\d{2}-\d{2}/;

/* ---------- UIX-18: organisasi (dijalankan pertama agar store organisasi masih kosong) ---------- */

const ORG_EMPTY_COPY = /Belum ada anggota|Belum ada kode undangan|Belum ada aktivitas organisasi|Profil organisasi belum dimuat/;

const ORG_PROFILE: OrgProfile = {
  id: 'org_smk', organization_name: 'SMK Contoh', organization_type: 'school', respondent_age_category: 'adult',
  consent_mode: 'self', policy_url: 'https://contoh.test/privasi', terms_url: 'https://contoh.test/ketentuan',
  retention_days: 365, data_request_contact: 'dpo@contoh.test', cross_border_transfer: 0, notice_version: '1.0',
};
const ORG_MEMBERS: OrgMember[] = [
  { id: 'u_anggota', email: 'anggota@contoh.test', display_name: 'Anggota Creator', role: 'creator', status: 'active', created_at: '2026-11-01T01:00:00Z' },
  { id: 'u_orgadmin', email: 'orgadmin@contoh.test', display_name: 'Admin Sekolah', role: 'org_admin', status: 'suspended', created_at: '2026-11-01T01:00:00Z' },
];
const ORG_INVITATIONS: OrgInvitation[] = [
  { id: 'oi_1', organization_id: 'org_smk', code: 'ORG-KODE-1', created_at: '2026-11-10T02:00:00Z', expires_at: '2026-11-24T02:00:00Z', revoked_at: null, used_at: null, used_by: null, status: 'active' },
];
const ORG_AUDIT: OrgAuditRow[] = [
  { id: 'oa_1', at: '2026-11-12T03:00:00Z', actor: 'Admin Sekolah', action: 'Ubah profil', object: 'org_smk', outcome: 'berhasil' },
];

function orgFetch(mock: TestContext['mock']): void {
  mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/org/profile')) return Response.json({ data: { source: 'organization', profile: ORG_PROFILE } });
    if (url.includes('/org/members')) return Response.json({ data: { members: ORG_MEMBERS } });
    if (url.includes('/org/invitations')) return Response.json({ data: { invitations: ORG_INVITATIONS, ttl_days: 14 } });
    if (url.includes('/org/audit')) return Response.json({ data: { rows: ORG_AUDIT } });
    throw new Error(`Permintaan tak terduga: ${url}`);
  });
}

const renderOrg = () => render(createElement(AdminOrgPage), '/admin/org');

test('UIX-18: halaman organisasi yang masih memuat tidak tampil sebagai organisasi kosong', () => {
  const html = renderOrg();
  assert.doesNotMatch(html, ORG_EMPTY_COPY, 'Keadaan memuat tidak boleh merender daftar kosong');
  assert.match(html, /Memuat data organisasi/);
});

test('UIX-18: galat memuat organisasi menampilkan pesan galat dan Coba lagi, bukan daftar kosong', async (t) => {
  failFetch(t.mock);
  await store.loadOrgWorkspace();

  const html = renderOrg();
  assert.match(html, /Data organisasi gagal dimuat/);
  assert.match(html, /Server tidak dapat dijangkau/);
  assert.match(html, /<button\b[^>]*>Coba lagi<\/button>/);
  assert.doesNotMatch(html, ORG_EMPTY_COPY, 'Galat tidak boleh dirender bersama keadaan kosong');
  assert.doesNotMatch(html, /Simpan profil/);
});

test('UIX-18/UIX-20: Coba lagi yang berhasil memulihkan data dan peran anggota memakai label manusiawi', async (t) => {
  orgFetch(t.mock);
  await store.loadOrgWorkspace();

  const html = renderOrg();
  assert.doesNotMatch(html, /gagal dimuat/);
  assert.match(html, /Simpan profil/);
  assert.match(row(html, 'Anggota Creator'), /<td\b[^>]*>Creator<\/td>/);
  assert.match(row(html, 'Admin Sekolah'), /<td\b[^>]*>Admin organisasi<\/td>/);
  assert.match(row(html, 'Admin Sekolah'), /Dinonaktifkan/);
  assert.doesNotMatch(html, /<td\b[^>]*>(creator|org_admin|super_admin)<\/td>/, 'Enum peran mentah tidak boleh tampil');
  assert.doesNotMatch(html, ORG_EMPTY_COPY);
});

test('UIX-18: respons organisasi yang tiba setelah layar dilepas tidak membalik UI ke galat', async (t) => {
  const pending: Array<PromiseWithResolvers<Response>> = [];
  t.mock.method(globalThis, 'fetch', () => {
    const deferred = Promise.withResolvers<Response>();
    pending.push(deferred);
    return deferred.promise;
  });

  const request = store.loadOrgWorkspace();
  store.cancelOrgWorkspaceLoad();
  for (const deferred of pending) deferred.reject(new TypeError('aborted'));
  await request;

  assert.doesNotMatch(renderOrg(), /gagal dimuat/);
});

/* ---------- UIX-18 / UIX-20: permintaan data admin ---------- */

const REQUEST_EMPTY_COPY = /Belum ada permintaan data/;
const renderRequests = () => render(createElement(AdminRequestsPage), '/admin/requests');

test('UIX-18: galat memuat permintaan data menampilkan Coba lagi tanpa keadaan kosong', async (t) => {
  failFetch(t.mock);
  await store.loadDataRequests();

  const html = renderRequests();
  assert.match(html, /Daftar permintaan gagal dimuat/);
  assert.match(html, /<button\b[^>]*>Coba lagi<\/button>/);
  assert.doesNotMatch(html, REQUEST_EMPTY_COPY, 'Galat tidak boleh dirender bersama keadaan kosong');
});

test('UIX-18/UIX-20: permintaan data berhasil dimuat memakai label jenis dan status', async (t) => {
  const request: DataRequest = {
    id: 'dr_hapus', type: 'deletion', contact: 'pemohon@contoh.test', note: null, status: 'in_progress',
    outcome_note: null, handled_by: null, created_at: '2026-11-15T04:00:00Z', updated_at: '2026-11-15T04:00:00Z',
  };
  t.mock.method(globalThis, 'fetch', async () => Response.json({ data: [request] }));
  await store.loadDataRequests();

  const html = renderRequests();
  assert.doesNotMatch(html, /gagal dimuat/);
  assert.doesNotMatch(html, REQUEST_EMPTY_COPY);
  const item = row(html, 'dr_hapus');
  assert.match(item, /<dd\b[^>]*>Penghapusan data<\/dd>/);
  assert.doesNotMatch(item, />deletion</, 'Jenis permintaan mentah tidak boleh tampil');
  assert.doesNotMatch(item, ISO_DATE);
});

test('UIX-18: daftar permintaan yang benar-benar kosong tetap menampilkan keadaan kosong', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ data: [] }));
  await store.loadDataRequests();

  const html = renderRequests();
  assert.match(html, REQUEST_EMPTY_COPY);
  assert.doesNotMatch(html, /gagal dimuat|Coba lagi/);
});

/* ---------- UIX-05 ---------- */

test('UIX-05: kontrol Kelola tautan tetap tautan aktif saat versi terbit dimuat ulang dari bootstrap', async (t) => {
  const link: PublicLink = {
    id: 'pl_terbit', survey_id: 's_terbit', version_id: 'v_terbit_1', token: 'pl_token_terbit',
    url: '/s/pl_token_terbit', label: 'Tautan umum', status: 'active', expires_at: null,
  };
  await hydrate(t.mock, {
    surveys: [survey('s_terbit', { status: 'published', current_version_id: 'v_terbit_1' })],
    versions: [version('v_terbit_1', 's_terbit', { status: 'published', published_at: '2026-11-03T03:00:00Z' })],
    publicLinks: [link],
  });

  const html = render(createElement(PublishPage, { id: 's_terbit' }), '/creator/surveys/s_terbit/publish');
  const manage = control(html, 'Kelola tautan');
  assert.equal(manage.tag, 'a', 'Kelola tautan harus berupa tautan, bukan span nonaktif');
  assert.match(manage.attrs, /href="\/creator\/surveys\/s_terbit\/share"/);
  assert.doesNotMatch(manage.attrs, /aria-disabled/);
  // SEC-10: token tidak lagi disalin di bootstrap, jadi halaman publikasi menunjuk halaman pembagian untuk
  // mencetak ulang token, bukan merender tautan `/s/<token>`.
  assert.doesNotMatch(html, /href="\/s\/pl_token_terbit"/, 'token tidak dirender dari bootstrap');
  assert.match(html, /href="\/creator\/surveys\/s_terbit\/share"/, 'halaman pembagian ditawarkan');
});

/* ---------- UIX-17 ---------- */

test('UIX-17: survei tanpa versi terbit menampilkan keadaan kosong, bukan selector kosong atau banner ekspor', async (t) => {
  await hydrate(t.mock, { surveys: [survey('s_tanpa_versi', { status: 'draft', current_version_id: null })] });

  const html = render(createElement(ResultsPage, { id: 's_tanpa_versi' }), '/creator/surveys/s_tanpa_versi/results');
  assert.doesNotMatch(html, /id="pilih-versi"/, 'Selector versi tanpa opsi tidak boleh dirender');
  assert.doesNotMatch(html, /Ekspor diizinkan/, 'Banner ekspor tidak boleh bertentangan dengan tombol nonaktif');
  assert.doesNotMatch(html, /Unduh CSV/);
  assert.match(html, /Belum ada versi diterbitkan/);
  const next = control(html, 'Lanjut ke publikasi');
  assert.equal(next.tag, 'a');
  assert.match(next.attrs, /href="\/creator\/surveys\/s_tanpa_versi\/publish"/);
});

/* ---------- UIX-19 ---------- */

test('UIX-19: tautan di log audit dan integrasi super admin tidak menuju rute creator', async (t) => {
  await hydrate(t.mock, { account: SUPER_ADMIN });
  for (const [page, pathname] of [[AdminAuditPage, '/admin/audit'], [AdminIntegrationPage, '/admin/integration']] as const) {
    const html = render(createElement(page), pathname);
    assert.doesNotMatch(html, /href="\/creator/, `${pathname} tidak boleh menautkan rute creator yang ditolak untuk super admin`);
    assert.match(html, /href="\/admin"/, `${pathname} menautkan ringkasan operasional admin`);
  }
});

/* ---------- UIX-20 ---------- */

test('UIX-20: pemilih peran akun memakai label manusiawi, bukan enum mentah', async (t) => {
  await hydrate(t.mock, {
    account: SUPER_ADMIN,
    accounts: [
      SUPER_ADMIN,
      { id: 'u_creator', display_name: 'Creator Lapangan', role: 'creator', status: 'active', organization_id: 'org_smk' },
      { id: 'u_admin_org', display_name: 'Admin Sekolah', role: 'org_admin', status: 'suspended', organization_id: 'org_smk' },
    ],
  });

  const html = render(createElement(AdminAccountsPage), '/admin/accounts');
  for (const label of ['Creator', 'Admin organisasi', 'Super admin']) {
    assert.match(html, new RegExp(`<option\\b[^>]*>${label}</option>`), `Opsi peran "${label}" harus tersedia`);
  }
  assert.doesNotMatch(html, /<option\b[^>]*>(creator|org_admin|admin|super_admin)<\/option>/, 'Enum peran mentah tidak boleh tampil');
  assert.match(html, /<option value="admin" selected="">Super admin<\/option>/, 'Nilai yang dikirim ke server tidak berubah');
});

test('UIX-20: daftar survei, undangan, dan riwayat versi memakai tanggal WIB, bukan ISO', async (t) => {
  await hydrate(t.mock, {
    surveys: [survey('s_tanggal', { status: 'published', updated_at: '2026-11-14T09:00:00Z', current_version_id: 'v_tanggal_2' })],
    versions: [
      version('v_tanggal_1', 's_tanggal', { number: 1, status: 'closed', published_at: '2026-11-03T03:00:00Z', closed_at: '2026-11-10T05:30:00Z' }),
      version('v_tanggal_2', 's_tanggal', { number: 2, status: 'published', published_at: '2026-11-10T05:30:00Z' }),
    ],
    assignments: [{ id: 'as_1', survey_id: 's_tanggal', version_id: 'v_tanggal_2', label: 'Kelas XI', participant_ref: 'P-01' }],
    invitations: [{
      id: 'inv_tanggal', assignment_id: 'as_1', survey_id: 's_tanggal', version_id: 'v_tanggal_2', code: 'UND-TANGGAL',
      status: 'used', expires_at: '2026-12-31T23:59:59.000Z', used_at: '2026-11-12T02:15:00Z', revoked_at: null, token_hash: '',
    }],
  });

  const list = row(render(createElement(CreatorListPage), '/creator'), 'Survei s_tanggal');
  assert.doesNotMatch(list, ISO_DATE, 'Daftar survei tidak boleh menampilkan tanggal ISO');
  assert.match(list, /14 November 2026 pukul 16\.00 WIB/);

  const invitation = row(render(createElement(SharePage, { id: 's_tanggal' }), '/creator/surveys/s_tanggal/share'), 'UND-TANGGAL');
  assert.doesNotMatch(invitation, ISO_DATE, 'Tabel undangan tidak boleh menampilkan tanggal ISO');
  assert.match(invitation, /12 November 2026 pukul 09\.15 WIB/);
  // Batas waktu diisi tanggal saja; server menyimpannya sebagai akhir hari UTC. Tabel harus
  // menampilkan tanggal pilihan pengguna, bukan geseran WIB ke 1 Januari 2027.
  assert.match(invitation, /31 Desember 2026 \(akhir hari\)/, 'Batas waktu undangan harus tanggal yang dipilih');
  assert.doesNotMatch(invitation, /1 Januari 2027/, 'Batas waktu tidak boleh bergeser sehari karena konversi WIB');

  const history = render(createElement(HistoryPage, { id: 's_tanggal' }), '/creator/surveys/s_tanggal/history');
  const first = row(history, '>v1<');
  assert.doesNotMatch(first, ISO_DATE, 'Riwayat versi tidak boleh menampilkan tanggal ISO');
  assert.match(first, /3 November 2026 pukul 10\.00 WIB/);
  assert.match(first, /10 November 2026 pukul 12\.30 WIB/);
});
