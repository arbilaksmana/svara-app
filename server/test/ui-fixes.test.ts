import { after, before, test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime.js';
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime.js';
import { closeTestDatabase, resetTestDatabase } from './test-db.ts';
import { AdminRequestsPage } from '../../src/screens/Admin.tsx';
import { ResultsPage } from '../../src/screens/CreatorData.tsx';
import { ToastProvider } from '../../src/components/Toast.tsx';
import * as store from '../../src/lib/store.ts';
import { ApiError, updateDataRequest, type BootstrapData, type DataRequest } from '../../src/lib/api.ts';
import type { AccessGrant, Account, Survey, SurveyVersion } from '../../src/lib/types.ts';
import { surveys, versions } from '../../src/lib/fixtures/surveys.ts';

const { app } = await import('../app.ts');
const { get } = await import('../db.ts');
const { seedDemoIfEmpty } = await import('../seed-data.ts');

/* fetch asli disimpan sebelum test mana pun memasang mock. */
const realFetch = globalThis.fetch;

let server: Server | undefined;
let origin = '';
let adminCookie = '';

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.SEED_DEMO = '1';
  await resetTestDatabase();
  await seedDemoIfEmpty();
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  origin = `http://127.0.0.1:${address.port}`;
  const login = await realFetch(`${origin}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Svara-Client': 'web' },
    body: JSON.stringify({ email: 'admin@svara.local', password: 'SvaraDemo123!' }),
  });
  assert.equal(login.status, 200, await login.clone().text());
  adminCookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!;
});

after(async () => {
  if (server) {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    server.close((error) => (error ? reject(error) : resolve()));
    await promise;
  }
  await closeTestDatabase();
});

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

function row(html: string, text: string): string {
  const match = [...html.matchAll(/<(tr|li)\b[^>]*>[\s\S]*?<\/\1>/g)].find(([markup]) => markup.includes(text));
  assert.ok(match, `Baris dengan ${text} harus dirender`);
  return match[0];
}

interface SelectOption { value: string; label: string; selected: boolean }

/** Select yang dilabeli `<label for>` berteks `label`; undefined bila tidak dirender. */
function labelledSelect(html: string, label: string): { attrs: string; options: SelectOption[] } | undefined {
  const forId = new RegExp(`<label\\b[^>]*for="([^"]+)"[^>]*>${label}\\b`).exec(html)?.[1];
  if (!forId) return undefined;
  const select = new RegExp(`<select\\b([^>]*\\bid="${forId}"[^>]*)>([\\s\\S]*?)</select>`).exec(html);
  assert.ok(select, `Label "${label}" harus menunjuk select dengan id ${forId}`);
  const options = [...select[2]!.matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)].map(([, attrs, text]) => ({
    value: /value="([^"]*)"/.exec(attrs!)?.[1] ?? text!,
    label: text!,
    selected: /\bselected=""/.test(attrs!),
  }));
  return { attrs: select[1]!, options };
}

function button(html: string, label: string): string {
  const match = new RegExp(`<button\\b([^>]*)>\\s*${label}\\s*</button>`).exec(html);
  assert.ok(match, `Tombol "${label}" harus dirender`);
  return match[1]!;
}

const describedBy = (attrs: string) => /aria-describedby="([^"]+)"/.exec(attrs)?.[1]?.split(' ') ?? [];

function textOf(html: string, id: string): string {
  const match = new RegExp(`<(\\w+)\\b[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</\\1>`).exec(html);
  assert.ok(match, `Elemen #${id} yang dirujuk aria-describedby harus ada`);
  return match[2]!.replace(/<[^>]+>/g, '');
}

/* ---------- M2: status Selesai pada permintaan data ---------- */

const renderRequests = () => render(createElement(AdminRequestsPage), '/admin/requests');

function request(id: string, overrides: Partial<DataRequest> = {}): DataRequest {
  return {
    id, type: 'access', contact: 'pemohon@contoh.test', note: null, status: 'pending', outcome_note: null,
    handled_by: null, created_at: '2026-11-15T04:00:00Z', updated_at: '2026-11-15T04:00:00Z', ...overrides,
  };
}

test('M2: kanal balasan wajib hanya muncul untuk permintaan berstatus Selesai, dan kanal tersimpan tidak hilang', async (t) => {
  const rows = [
    request('dr_menunggu'),
    request('dr_diproses', { status: 'in_progress' }),
    request('dr_ditolak', { status: 'rejected', outcome_note: 'Bukan data platform ini.' }),
    // Baris "handled" dari sebelum migrasi 016 (data main): belum ada jejak balasan.
    request('dr_selesai_lama', { status: 'handled', outcome_note: 'Ditangani lewat surat.' }),
    request('dr_selesai_email', { status: 'handled', response_channel: 'email', responded_by: 'u_admin', responded_at: '2026-11-16T02:00:00Z' }),
    // Kanal teks bebas yang dikirim lewat API langsung, bukan dari daftar pilihan UI.
    request('dr_selesai_lain', { status: 'handled', response_channel: 'Telepon kantor TU', responded_by: 'u_admin', responded_at: '2026-11-16T03:00:00Z' }),
  ];
  t.mock.method(globalThis, 'fetch', async () => Response.json({ data: rows }));
  await store.loadDataRequests();
  const html = renderRequests();

  for (const id of ['dr_menunggu', 'dr_diproses', 'dr_ditolak']) {
    assert.equal(labelledSelect(row(html, id), 'Kanal balasan'), undefined, `${id}: status selain Selesai tidak meminta kanal balasan`);
  }

  const legacy = labelledSelect(row(html, 'dr_selesai_lama'), 'Kanal balasan');
  assert.ok(legacy, 'Status Selesai harus meminta kanal balasan');
  assert.match(legacy.attrs, /aria-required="true"/, 'Kanal balasan wajib untuk status Selesai');
  const chosen = legacy.options.filter((option) => option.value !== '');
  assert.ok(chosen.length >= 2, 'Kanal balasan harus menawarkan pilihan kanal');
  assert.deepEqual(legacy.options.filter((option) => option.selected).map((option) => option.value), [''],
    'Baris lama tanpa jejak balasan tidak boleh diisi kanal otomatis');

  const email = labelledSelect(row(html, 'dr_selesai_email'), 'Kanal balasan');
  assert.deepEqual(email?.options.filter((option) => option.selected).map((option) => option.value), ['email']);

  const other = labelledSelect(row(html, 'dr_selesai_lain'), 'Kanal balasan');
  assert.deepEqual(other?.options.filter((option) => option.selected).map((option) => option.value), ['Telepon kantor TU'],
    'Kanal tersimpan di luar daftar pilihan tetap terpilih agar simpan ulang tidak menggantinya');
});

/** Meneruskan fetch klien (`/api/v1/...`) ke server in-process dengan sesi admin, sambil mencatat body yang dikirim. */
function routeToServer(mock: TestContext['mock'], sent: Array<{ method: string; path: string; body: unknown }>): void {
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
    const path = String(input);
    assert.ok(path.startsWith('/api/v1/'), `Klien harus memanggil API relatif, bukan ${path}`);
    const headers = new Headers(init.headers);
    headers.set('Cookie', adminCookie);
    sent.push({ method: init.method ?? 'GET', path, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
    return realFetch(`${origin}${path}`, { ...init, headers });
  });
}

async function storedRequest(id: string) {
  return get<{ status: string; outcome_note: string | null; responded_by: string | null; responded_at: string | null; response_channel: string | null }>(
    'SELECT status, outcome_note, responded_by, responded_at, response_channel FROM data_requests WHERE id = ?',
    id,
  );
}

async function rejection(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof ApiError ? `${error.status} ${error.code}: ${error.message}` : String(error);
  }
}

test('M2: body updateDataRequest untuk status Selesai diterima server dan tercatat sebagai jejak balasan', async (t) => {
  const created = await realFetch(`${origin}/api/v1/data-requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Svara-Client': 'web' },
    body: JSON.stringify({ type: 'deletion', contact: 'wali.siswa@contoh.test', note: 'Mohon hapus jawaban anak saya.' }),
  });
  assert.equal(created.status, 201, await created.clone().text());
  const { data: { id } } = await created.json() as { data: { id: string } };
  const admin = await get<{ id: string }>("SELECT id FROM accounts WHERE email = 'admin@svara.local'");

  const sent: Array<{ method: string; path: string; body: unknown }> = [];
  routeToServer(t.mock, sent);
  await store.loadDataRequests();
  assert.equal(labelledSelect(row(renderRequests(), id), 'Kanal balasan'), undefined, 'Permintaan baru (Menunggu) belum meminta kanal');

  const note = 'Data dihapus; konfirmasi dikirim ke email pemohon.';
  const failure = await rejection(updateDataRequest(id, { status: 'handled', outcome_note: note, response_channel: 'email' }));
  assert.equal(failure, null, `Server harus menerima body yang dikirim UI untuk status Selesai, bukan ${failure}`);
  const patch = sent.filter((entry) => entry.method === 'PATCH');
  assert.deepEqual(patch.at(-1), {
    method: 'PATCH',
    path: `/api/v1/admin/data-requests/${id}`,
    body: { status: 'handled', outcome_note: note, response_channel: 'email' },
  });
  const stored = await storedRequest(id);
  assert.equal(stored?.status, 'handled');
  assert.equal(stored?.outcome_note, note);
  assert.equal(stored?.response_channel, 'email');
  assert.equal(stored?.responded_by, admin?.id, 'responded_by mencatat akun pengelola yang membalas');
  assert.ok(stored?.responded_at, 'responded_at terisi');

  // Antrean dimuat ulang dari server: kanal tersimpan terbaca kembali oleh UI.
  await store.loadDataRequests();
  const saved = labelledSelect(row(renderRequests(), id), 'Kanal balasan');
  assert.ok(saved, 'Permintaan berstatus Selesai menampilkan kanal balasan');
  assert.deepEqual(saved.options.filter((option) => option.selected).map((option) => option.value), ['email']);

  // Setiap kanal yang ditawarkan UI diterima server apa adanya.
  for (const option of saved.options.filter((entry) => entry.value !== '')) {
    const rejected = await rejection(updateDataRequest(id, { status: 'handled', outcome_note: note, response_channel: option.value }));
    assert.equal(rejected, null, `Kanal "${option.label}" harus diterima server, bukan ${rejected}`);
    assert.equal((await storedRequest(id))?.response_channel, option.value);
  }

  // Status lain tidak mengirim kanal balasan.
  assert.equal(await rejection(updateDataRequest(id, { status: 'in_progress', outcome_note: 'Dibuka ulang untuk koreksi.' })), null);
  assert.equal('response_channel' in (sent.at(-1)!.body as Record<string, unknown>), false, 'Status selain Selesai tidak mengirim response_channel');
  assert.equal((await storedRequest(id))?.status, 'in_progress');
});

/* ---------- L5: tombol ekspor CSV mengikuti izin ekspor individual ---------- */

const baseSurvey: Survey = { ...surveys[0]! };
const baseVersion: SurveyVersion = { ...versions[0]! };

const OWNER = {
  id: 'u_pemilik', display_name: 'Pemilik Survei', email: 'pemilik@svara.local',
  role: 'creator', status: 'active', organization_id: 'org_smk',
} as const satisfies Account & { email: string };
const OFFICER = {
  id: 'u_petugas', display_name: 'Petugas Data', email: 'officer@svara.local',
  role: 'creator', status: 'active', organization_id: 'org_smk',
} as const satisfies Account & { email: string };

const SURVEY_ID = 's_hasil';

async function hydrateResults(
  mock: TestContext['mock'],
  account: typeof OWNER | typeof OFFICER,
  grant: Pick<AccessGrant, 'can_read_individual' | 'can_export'> | null,
  allowIndividual: boolean,
): Promise<void> {
  const grants: AccessGrant[] = grant
    ? [{ id: 'g_petugas', account_id: OFFICER.id, survey_id: SURVEY_ID, can_read_free_text: false, ...grant }]
    : [];
  const payload: BootstrapData = {
    account,
    surveys: [{ ...baseSurvey, id: SURVEY_ID, owner_id: OWNER.id, title: 'Survei hasil', status: 'published', current_version_id: 'v_hasil_1' }],
    versions: [{ ...baseVersion, id: 'v_hasil_1', survey_id: SURVEY_ID, number: 1, status: 'published', question_ids: [], published_at: '2026-11-03T03:00:00Z' }],
    profiles: [], notices: [], surveyProfiles: {}, questions: [], options: [], invitations: [], publicLinks: [], assignments: [],
    settings: { [SURVEY_ID]: { allowResults: true, allowIndividual } },
    grants, accounts: [], organizations: [], auditLogs: [], integrationEvents: [], dataRequests: [], serverTime: '2026-11-21T00:00:00Z',
  };
  mock.method(globalThis, 'fetch', async () => Response.json({ data: payload }));
  await store.refreshBootstrap();
}

const renderResults = () => render(createElement(ResultsPage, { id: SURVEY_ID }), `/creator/surveys/${SURVEY_ID}/results`);

/** Alasan nonaktif yang dirujuk tombol, atau null bila tombol tidak menyebut alasan. */
function disabledReason(html: string, label: string): string | null {
  const ids = describedBy(button(html, label));
  return ids.length ? ids.map((id) => textOf(html, id)).join(' ') : null;
}

test('L5: grantee ber-izin ekspor tanpa izin baca individual tidak bisa menekan Unduh CSV dan diberi alasan', async (t) => {
  await hydrateResults(t.mock, OFFICER, { can_export: true, can_read_individual: false }, true);
  const html = renderResults();

  assert.match(button(html, 'Unduh CSV'), /\bdisabled=""/);
  const reason = disabledReason(html, 'Unduh CSV');
  assert.ok(reason, 'Tombol CSV harus merujuk alasan nonaktif yang terbaca');
  assert.match(reason, /izin membaca jawaban individual/);
  assert.equal(disabledReason(html, 'Unduh kodebook'), null, 'Kodebook tetap tersedia dengan izin ekspor');
  assert.doesNotMatch(html, /CSV UTF-8 per versi dan kodebook/, 'Banner tidak boleh menjanjikan CSV yang ditolak server');
});

test('L5: allow_individual yang mati menonaktifkan Unduh CSV meski grantee memegang izin baca dan ekspor', async (t) => {
  await hydrateResults(t.mock, OFFICER, { can_export: true, can_read_individual: true }, false);
  const html = renderResults();

  assert.match(button(html, 'Unduh CSV'), /\bdisabled=""/);
  const reason = disabledReason(html, 'Unduh CSV');
  assert.ok(reason, 'Tombol CSV harus merujuk alasan nonaktif yang terbaca');
  assert.match(reason, /pengaturan survei/i);
  assert.equal(disabledReason(html, 'Unduh kodebook'), null, 'Kodebook tetap tersedia dengan izin ekspor');
});

test('L5: pemilik (meski allow_individual mati) dan grantee lengkap tidak diberi alasan nonaktif; CSV sama dengan kodebook', async (t) => {
  const cases = [
    ['pemilik', OWNER, null, false],
    ['grantee lengkap', OFFICER, { can_export: true, can_read_individual: true }, true],
  ] as const;
  for (const [name, account, grant, allowIndividual] of cases) {
    await hydrateResults(t.mock, account, grant, allowIndividual);
    const html = renderResults();
    assert.equal(disabledReason(html, 'Unduh CSV'), null, `${name}: CSV tidak boleh diberi alasan nonaktif`);
    assert.equal(disabledReason(html, 'Unduh kodebook'), null);
    // Sebelum ringkasan dimuat keduanya menunggu data; CSV tidak boleh lebih terkunci dari kodebook.
    assert.equal(/\bdisabled=""/.test(button(html, 'Unduh CSV')), /\bdisabled=""/.test(button(html, 'Unduh kodebook')), name);
    assert.match(html, /Ekspor diizinkan/, `${name}: banner ekspor tetap menyatakan izin`);
  }
});
