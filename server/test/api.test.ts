import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { anonymizeExpiredDataRequests, retentionDays } from '../data-request-retention.ts';
import { provisionOrganizationNotice } from '../notice-provisioning.ts';
import { hashPassword } from '../security.ts';
import { closeTestDatabase, databaseUrl, resetTestDatabase } from './test-db.ts';

const PORT = 3191;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const INTEGRATION_TOKEN = 'token-uji-integrasi';
/** Berkas bukti wali ditulis server uji ke direktori sementara yang dibersihkan setelah suite. */
const EVIDENCE_DIR = fileURLToPath(new URL('.tmp-guardian-evidence', import.meta.url));
const EVIDENCE_MAX_BYTES = 5 * 1024 * 1024;
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/Q842iQAAAABJRU5ErkJggg==',
  'base64',
);

let server: ChildProcess | undefined;
let stopping = false;

interface Result {
  status: number;
  json: Record<string, unknown> | null;
  text: string;
  bytes: Uint8Array;
  headers: Headers;
}

async function call(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    cookie?: string;
    idempotencyKey?: string;
    headers?: Record<string, string>;
    auth?: string;
    redirect?: RequestRedirect;
  } = {},
): Promise<Result> {
  const headers = new Headers({ 'X-Svara-Client': 'web', Accept: 'application/json' });
  if (options.cookie) headers.set('Cookie', options.cookie);
  if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey);
  if (options.auth) headers.set('Authorization', options.auth);
  for (const [key, value] of Object.entries(options.headers ?? {})) headers.set(key, value);
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: options.redirect,
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    json = null;
  }
  return { status: response.status, json, text, bytes, headers: response.headers };
}

async function login(email: string, password = 'SvaraDemo123!'): Promise<string> {
  const result = await call('/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(result.status, 200, `login ${email}: ${result.text}`);
  const raw = result.headers.get('set-cookie') ?? '';
  assert.ok(raw.startsWith('svara_session='), 'cookie sesi harus terpasang');
  return raw.split(';')[0]!;
}

function data<T = Record<string, unknown>>(result: Result): T {
  assert.equal(result.status < 400, true, result.text);
  return (result.json as { data: T }).data;
}

/** Sesi dipakai ulang: login dibatasi 8 percobaan per email per alamat IP. */
const sessions = new Map<string, Promise<string>>();

function session(email: string): Promise<string> {
  let cached = sessions.get(email);
  if (!cached) {
    cached = login(email);
    sessions.set(email, cached);
  }
  return cached;
}

function consentCookie(result: Result): string {
  const cookie = result.headers.get('set-cookie') ?? '';
  assert.match(cookie, /^svara_respondent=[A-Za-z0-9_-]{43};/u, 'penerbitan consent harus mengikat sesi responden');
  assert.match(cookie, /; HttpOnly/u);
  return cookie.split(';')[0]!;
}

/** Baca kolom status dan referensi bukti wali langsung dari basis data uji. */
async function storedGuardianEvidence(consentId: string): Promise<{ status: string; ref: string | null } | null> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query<{ guardian_evidence_status: string; guardian_evidence_ref: string | null }>(
      'SELECT guardian_evidence_status, guardian_evidence_ref FROM consent_records WHERE id = $1',
      [consentId],
    );
    const row = result.rows[0];
    return row ? { status: row.guardian_evidence_status, ref: row.guardian_evidence_ref } : null;
  } finally {
    await client.end();
  }
}

interface StoredEvidenceRow {
  guardian_evidence_status: string;
  guardian_evidence_file: string | null;
  guardian_evidence_mime: string | null;
  guardian_evidence_size: number | null;
  guardian_evidence_uploaded_at: string | null;
  guardian_evidence_reviewed_by: string | null;
  guardian_evidence_reviewed_at: string | null;
  guardian_evidence_review_note: string | null;
}

async function storedEvidenceRow(consentId: string): Promise<StoredEvidenceRow | undefined> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query<StoredEvidenceRow>(
      `SELECT guardian_evidence_status, guardian_evidence_file, guardian_evidence_mime, guardian_evidence_size,
              guardian_evidence_uploaded_at, guardian_evidence_reviewed_by, guardian_evidence_reviewed_at,
              guardian_evidence_review_note
         FROM consent_records WHERE id = $1`,
      [consentId],
    );
    return result.rows[0];
  } finally {
    await client.end();
  }
}

/** Nama berkas di disk adalah ID acak; direktori hanya berisi berkas bukti wali. */
function evidenceFiles(): string[] {
  try {
    return readdirSync(EVIDENCE_DIR).sort();
  } catch {
    return [];
  }
}

async function freshGuardianToken(label: string): Promise<string> {
  const creator = await session('creator.a@svara.local');
  const created = await call('/surveys/s_demo1/invitations', {
    method: 'POST',
    cookie: creator,
    body: { label, expires_at: '2027-01-01' },
  });
  return data<{ token: string }>(created).token;
}

async function consentVersionFor(token: string): Promise<string> {
  return data<{ consent_version: string }>(await call(`/public/surveys/${token}`)).consent_version;
}

/** Kode galat server untuk asersi; `json` sudah diurai oleh `call`. */
function errorCode(result: Result): string {
  const body = result.json;
  const code = body && typeof body.code === 'string' ? body.code : undefined;
  assert.ok(code, `respons tanpa kode galat: ${result.text}`);
  return code;
}

async function waitForServer(child: ChildProcess): Promise<void> {
  let ready!: () => void;
  const signal = new Promise<void>((resolveSignal) => {
    ready = resolveSignal;
  });
  let output = '';
  const onData = (chunk: unknown) => {
    output += String(chunk);
    if (output.includes('Svara berjalan')) ready();
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
  child.once('exit', (code) => {
    if (!stopping) throw new Error(`server uji berhenti (kode ${code}): ${output}`);
  });
  await signal;
}

before(async () => {
  await resetTestDatabase();
  rmSync(EVIDENCE_DIR, { recursive: true, force: true });
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DATABASE_URL: databaseUrl,
      INTEGRATION_ORGANIZATION_ID: 'org_smk',
      INTEGRATION_TOKEN,
      GUARDIAN_EVIDENCE_DIR: EVIDENCE_DIR,
      COOKIE_SECURE: '0',
      ENABLE_HSTS: '0',
      NODE_ENV: 'test',
      SEED_DEMO: '1',
      SEED_PASSWORD: 'SvaraDemo123!',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForServer(server);
});

after(async () => {
  stopping = true;
  server?.kill();
  await closeTestDatabase();
  rmSync(EVIDENCE_DIR, { recursive: true, force: true });
});

test('AC01/AC10: peran, kepemilikan, dan isolasi data creator', async () => {
  const wrong = await call('/auth/login', { method: 'POST', body: { email: 'creator.a@svara.local', password: 'salah' } });
  assert.equal(wrong.status, 401);

  const suspended = await call('/auth/login', {
    method: 'POST',
    body: { email: 'suspended@svara.local', password: 'SvaraDemo123!' },
  });
  assert.equal(suspended.status, 401);

  const creatorA = await session('creator.a@svara.local');
  const bootstrapA = data<{
    surveys: Array<{ id: string }>;
    accounts: Array<unknown>;
  }>(await call('/bootstrap', { cookie: creatorA }));
  const idsA = bootstrapA.surveys.map((survey) => survey.id).sort();
  assert.deepEqual(idsA, ['s_demo1', 's_demo2', 's_demo4']);
  assert.equal(bootstrapA.accounts.length, 0, 'creator tidak menerima daftar akun admin');

  const foreignSummary = await call('/surveys/s_demo3/summary', { cookie: creatorA });
  assert.ok([403, 404].includes(foreignSummary.status), 'survei creator B tidak boleh dibaca');

  const admin = await session('admin@svara.local');
  const bootstrapAdmin = data<{
    surveys: Array<unknown>;
    accounts: Array<unknown>;
    auditLogs: Array<unknown>;
  }>(await call('/bootstrap', { cookie: admin }));
  assert.equal(bootstrapAdmin.surveys.length, 4);
  assert.equal(bootstrapAdmin.accounts.length, 6, 'termasuk akun org_admin sintetis');
  assert.ok(bootstrapAdmin.auditLogs.length > 0);
  const adminSummary = await call('/surveys/s_demo1/summary', { cookie: admin });
  assert.equal(adminSummary.status, 403, 'administrator tanpa grant tidak membaca jawaban');
  const adminCsv = await call('/surveys/s_demo1/export?version=1', { cookie: admin });
  assert.equal(adminCsv.status, 403);
});

test('UIX-01/BR-01: creator melihat survei ber-grant tanpa memperoleh hak kelola', async () => {
  const officer = await session('officer@svara.local');
  const creator = await session('creator.a@svara.local');
  const other = await session('creator.b@svara.local');
  const orgAdmin = await session('orgadmin@svara.local');
  const admin = await session('admin@svara.local');
  interface Bootstrap {
    surveys: Array<{ id: string }>;
    versions: Array<{ survey_id: string }>;
    invitations: Array<{ survey_id: string }>;
    publicLinks: Array<{ survey_id: string }>;
    assignments: Array<{ survey_id: string }>;
    grants: Array<{
      account_id: string;
      survey_id: string;
      can_read_individual: boolean;
      can_export: boolean;
      can_read_free_text: boolean;
    }>;
  }
  const bootstrap = async (cookie: string) => data<Bootstrap>(await call('/bootstrap', { cookie }));
  const list = async (cookie: string) => data<Array<{ id: string }>>(await call('/surveys', { cookie })).map((s) => s.id);
  const granted = await bootstrap(officer);
  assert.deepEqual(granted.surveys.map((s) => s.id), ['s_demo1'], 'bootstrap harus menampilkan survei yang diberikan');
  assert.deepEqual(await list(officer), ['s_demo1'], 'daftar API harus sama dengan bootstrap');
  assert.ok(granted.versions.some((v) => v.survey_id === 's_demo1'));
  assert.deepEqual(granted.invitations, [], 'grant baca tidak membuka undangan');
  assert.deepEqual(granted.publicLinks, [], 'grant baca tidak membuka token tautan umum');
  assert.deepEqual(granted.assignments, [], 'grant baca tidak membuka identitas penugasan');
  assert.equal((await call('/surveys/s_demo1', { cookie: officer })).status, 200);
  assert.equal((await call('/surveys/s_demo1/summary', { cookie: officer })).status, 200);
  assert.equal((await call('/surveys/s_demo2', { cookie: officer })).status, 403);
  assert.deepEqual(await list(other), ['s_demo3'], 'grant akun lain tidak bocor');
  for (const [method, suffix] of [
    ['PUT', ''], ['POST', '/publish'], ['POST', '/duplicate'],
    ['POST', '/invitations'], ['PUT', '/settings'],
  ]) {
    assert.equal((await call(`/surveys/s_demo1${suffix}`, { method, cookie: officer, body: {} })).status, 403, `${method} ${suffix} tetap khusus pengelola`);
  }
  const owned = await bootstrap(creator);
  for (const key of ['invitations', 'publicLinks', 'assignments'] as const) {
    assert.ok(owned[key].some((row) => row.survey_id === 's_demo1'), `${key} tetap tersedia bagi pemilik`);
  }

  // BR-10/SEC-15: bootstrap super admin tidak lagi membawa grant akun lain; daftar awal dibaca dari
  // /admin/accounts (grant sebagai izin baca data tidak lagi disalin ke payload super admin).
  const original = data<{ grants: Array<{ account_id: string; survey_id: string | null; can_read_individual: boolean; can_export: boolean; can_read_free_text: boolean; purpose: string | null; expires_at: string | null }> }>(
    await call('/admin/accounts', { cookie: admin }),
  ).grants;
  const setGrants = async (accountId: string, surveyIds: string[]) => {
    const result = await call(`/admin/grants/${accountId}`, {
      // BR-06: setiap grant baru wajib menyebut tujuannya.
      method: 'PUT', cookie: admin, body: { grants: surveyIds.map((survey_id) => ({ survey_id, purpose: 'Uji izin akses' })) },
    });
    assert.equal(result.status, 200, result.text);
  };
  try {
    await setGrants('u_creator_a', ['s_demo1', 's_demo3']);
    const expected = ['s_demo3', 's_demo1', 's_demo2', 's_demo4'];
    assert.deepEqual(await list(creator), expected, 'gabungan milik + grant terurut tanpa duplikasi');
    assert.deepEqual((await bootstrap(creator)).surveys.map((s) => s.id), expected);
    await setGrants('u_orgadmin', ['s_demo3']);
    assert.deepEqual(await list(orgAdmin), ['s_demo1', 's_demo2', 's_demo4'], 'grant tidak melebarkan lingkup org_admin');
    assert.deepEqual(await list(admin), expected, 'super_admin tetap melihat seluruh survei');
    await setGrants('u_petugas', []);
    assert.deepEqual(await list(officer), [], 'pencabutan grant langsung menghapus visibilitas');
    assert.deepEqual((await bootstrap(officer)).surveys, []);
    assert.equal((await call('/surveys/s_demo1', { cookie: officer })).status, 403);
  } finally {
    for (const id of ['u_creator_a', 'u_orgadmin', 'u_petugas']) {
      const restored = await call(`/admin/grants/${id}`, {
        method: 'PUT',
        cookie: admin,
        body: {
          grants: original
            .filter((grant) => grant.account_id === id)
            .map((grant) => ({
              survey_id: grant.survey_id,
              can_read_individual: grant.can_read_individual,
              can_export: grant.can_export,
              can_read_free_text: grant.can_read_free_text,
              purpose: grant.purpose,
              // BR-06 menolak `expires_at` di masa lalu (grant dicabut dengan menghapusnya); grant seed
              // yang sudah kedaluwarsa dikembalikan tanpa batas waktu di uji ini.
              expires_at: grant.expires_at && Date.parse(grant.expires_at) > Date.now() ? grant.expires_at : null,
            })),
        },
      });
      assert.equal(restored.status, 200, restored.text);
    }
  }
});

test('Mutasi menerima origin web lokal dan menolak origin asing', async () => {
  const body = { type: 'akses', contact: 'qa@example.org', note: 'Uji origin' };
  const local = await call('/data-requests', {
    method: 'POST',
    body,
    headers: { Origin: 'http://127.0.0.1:3000' },
  });
  assert.equal(local.status < 400, true, `origin web lokal ditolak: ${local.text}`);

  const foreign = await call('/data-requests', {
    method: 'POST',
    body,
    headers: { Origin: 'http://evil.example' },
  });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.json?.code, 'origin_rejected');
});

test('Security headers: CSP dan hardening aktif pada API dan 404', async () => {
  const health = await call('/health');
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(health.headers.get('x-frame-options'), 'DENY');
  assert.equal(health.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(health.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()');
  const csp = health.headers.get('content-security-policy') ?? '';
  for (const directive of ["default-src 'self'", "script-src 'self'", "font-src 'self' data:", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'"]) {
    assert.ok(csp.includes(directive), `CSP harus memuat ${directive}`);
  }
  assert.equal(health.headers.get('strict-transport-security'), null, 'HSTS hanya dikirim saat ENABLE_HSTS=1');

  const missing = await fetch(`http://127.0.0.1:${PORT}/api/tidak-ada`, {
    headers: { 'X-Svara-Client': 'web' },
  });
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('x-content-type-options'), 'nosniff');
  assert.ok((missing.headers.get('content-security-policy') ?? '').includes("frame-ancestors 'none'"));
});

test('AC02: draf tidak lengkap tersimpan, blokir publikasi, salin konfigurasi tanpa respons', async () => {
  const cookie = await session('creator.a@svara.local');
  const created = data<{ survey: { id: string } }>(
    await call('/surveys', { method: 'POST', cookie, body: { title: 'Uji dua skala' } }),
  );
  const id = created.survey.id;

  const draft = {
    title: 'Uji dua skala',
    purpose: 'Menguji publikasi dua skala berbeda.',
    object_label: 'Objek uji',
    instructions: 'Isi semua item.',
    profile_id: 'p_perpus',
    questions: [
      {
        code: 'A01',
        type: 'likert',
        required: true,
        section: 'Bagian 1',
        label: 'Item pertama',
        hint: null,
        group_code: null,
        dimension_code: null,
        direction: null,
        options: [
          { label: 'Rendah', value: 1 },
          { label: 'Tinggi', value: 5 },
        ],
      },
      {
        code: 'A01',
        type: 'single_choice',
        required: true,
        section: 'Bagian 1',
        label: '',
        hint: null,
        group_code: null,
        dimension_code: null,
        direction: null,
        options: [{ label: '', value: 1 }],
      },
    ],
  };
  const saved = await call(`/surveys/${id}`, { method: 'PUT', cookie, body: draft });
  assert.equal(saved.status, 200, 'draf dengan duplikat tetap boleh disimpan');

  const blocked = await call(`/surveys/${id}/publish`, { method: 'POST', cookie });
  assert.equal(blocked.status, 422);
  const payload = blocked.json as { error: string; code: string; details?: { errors?: string[] } };
  assert.equal(payload.code, 'publish_blocked');
  assert.ok((payload.details?.errors ?? []).some((message) => message.includes('duplikat')));
  assert.ok((payload.details?.errors ?? []).some((message) => message.includes('dua opsi')));

  const fixed = {
    ...draft,
    questions: [
      draft.questions[0],
      {
        ...draft.questions[1],
        code: 'B01',
        label: 'Pilih satu',
        options: [
          { label: 'Ya', value: 1 },
          { label: 'Tidak', value: 0 },
        ],
      },
    ],
  };
  assert.equal((await call(`/surveys/${id}`, { method: 'PUT', cookie, body: fixed })).status, 200);
  const published = await call(`/surveys/${id}/publish`, { method: 'POST', cookie });
  assert.equal(published.status, 200, published.text);
  const link = data<{ publicLink: { token: string; version_id: string } }>(published).publicLink;
  assert.ok(link.token);

  const copy = data<{ survey: { id: string } }>(
    await call(`/surveys/${id}/duplicate`, { method: 'POST', cookie }),
  );
  const copyDetail = data<{ versions: Array<{ id: string; status: string }>; questions: Array<{ id: string }> }>(
    await call(`/surveys/${copy.survey.id}`, { cookie }),
  );
  assert.equal(copyDetail.versions[0]?.status, 'draft');
  const copyVersionId = copyDetail.versions[0]!.id;
  assert.equal(copyDetail.questions.length, 2);
  const publishCopy = await call(`/surveys/${copy.survey.id}/publish`, { method: 'POST', cookie });
  assert.equal(publishCopy.status, 200, publishCopy.text);
  const copySummary = await call(`/surveys/${copy.survey.id}/summary?version=${copyVersionId}`, { cookie });
  assert.equal(copySummary.status, 200);
  // SEC-16: versi tanpa respons tidak mengungkap angka nol; ambangnya dilaporkan.
  assert.deepEqual(
    { total: (copySummary.json as { data: { total: number | null; fewer_than: number | null } }).data.total },
    { total: null },
  );
});

test('AC02/AC04: draf baru tidak menggantikan versi yang masih terbit pada tautan umum', async () => {
  const cookie = await session('creator.a@svara.local');
  const detail = data<{
    survey: { id: string; current_version_id: string };
    versions: Array<{ id: string; number: number; status: string }>;
    questions: Array<{
      id: string;
      version_id: string;
      code: string;
      section: string;
      label: string;
      type: string;
      required: boolean;
      hint: string | null;
      group_code: string | null;
      dimension_code: string | null;
      options: Array<{ label: string; value: number }>;
    }>;
  }>(await call('/surveys/s_demo1', { cookie }));
  const published = detail.versions.find((version) => version.status === 'published');
  assert.ok(published);
  const currentQuestions = detail.questions.filter((question) => question.version_id === published.id);
  assert.ok(currentQuestions.length > 0);
  const input = {
    title: 'Pengalaman penggunaan alat bantu tugas (uji)',
    purpose: 'Tujuan diperbarui untuk versi baru.',
    object_label: 'Alat bantu tugas desain',
    instructions: 'Petunjuk baru.',
    profile_id: 'p_smk',
    questions: currentQuestions.slice(0, 3).map((question) => ({
      code: question.code,
      type: question.type,
      required: question.required,
      section: question.section,
      label: question.label,
      hint: question.hint,
      group_code: question.group_code,
      dimension_code: question.dimension_code,
      direction: null,
      options: question.options.map((option) => ({ label: option.label, value: option.value })),
    })),
  };
  const saved = await call('/surveys/s_demo1', { method: 'PUT', cookie, body: input });
  assert.equal(saved.status, 200, saved.text);
  const after = data<{
    versions: Array<{ id: string; number: number; status: string }>;
    survey: { current_version_id: string };
  }>(await call('/surveys/s_demo1', { cookie }));
  const draft = after.versions.find((version) => version.status === 'draft' && version.number >= 2);
  assert.ok(draft, 'versi draf baru dibuat');
  assert.equal(after.survey.current_version_id, draft.id);

  const legacy = await call('/public/surveys/pl_demoTautanUmum1A');
  assert.equal(legacy.status, 200);
  assert.equal(data<{ version: { number: number } }>(legacy).version.number, published.number);
  assert.ok(!legacy.text.includes(draft.id), 'ID draf tidak dikirim ke responden');
});

test('AC05/AC06/AC07: consent server-side, validasi, satu undangan satu respons, retry bukti sama', async () => {
  const creator = await session('creator.a@svara.local');
  const fresh = data<{ token: string }>(
    await call('/surveys/s_demo1/invitations', {
      method: 'POST',
      cookie: creator,
      body: { label: 'Uji consent', expires_at: '2027-01-01' },
    }),
  );
  const token = fresh.token;
  const base = await call(`/public/surveys/${token}`);
  const baseData = data<{ questions: unknown[]; guardianRequired: boolean; canSubmit: boolean; consent_version: string }>(base);
  assert.equal(baseData.questions.length, 0, 'metadata publik tidak membocorkan item sebelum consent');
  assert.equal(baseData.guardianRequired, true);

  const noConsentForm = await call(`/public/surveys/${token}/form`);
  assert.equal(noConsentForm.status, 403);
  assert.equal((noConsentForm.json as { code: string }).code, 'consent_required');

  const missingGuardian = await call(`/public/surveys/${token}/consent`, {
    method: 'POST',
    body: { respondent_click: true, eligibility: true },
  });
  assert.equal(missingGuardian.status, 422);

  const issuedConsent = await call(`/public/surveys/${token}/consent`, {
    method: 'POST',
    body: { version_id: baseData.consent_version, respondent_click: true, eligibility: true, guardian_evidence_ref: 'ref-wali-uji' },
  });
  const consent = data<{ consent_id: string }>(issuedConsent);
  const cookie = consentCookie(issuedConsent);
  const otherCookie = consentCookie(await call(`/public/surveys/${token}/consent`, {
    method: 'POST',
    body: { version_id: baseData.consent_version, respondent_click: true, eligibility: true, guardian_evidence_ref: 'ref-wali-sesi-lain' },
  }));
  const form = data<{
    questions: Array<{ code: string; type: string; required: boolean; option_ids: string[] }>;
    options: Array<{ id: string }>;
  }>(await call(`/public/surveys/${token}/form?consent_id=${consent.consent_id}`, { cookie }));
  assert.equal(form.questions.length, 3);

  const missingAnswers = await call(`/public/surveys/${token}/responses`, {
    method: 'POST',
    cookie,
    idempotencyKey: 'kunci-validasi-001',
    body: { consent_id: consent.consent_id, version_id: 'v_demo1_1', answers: [] },
  });
  assert.equal(missingAnswers.status, 422);
  const issues = (missingAnswers.json as { details: { fields: string[] } }).details.fields;
  assert.deepEqual(issues, ['AD01', 'TS01']);

  const body = {
    consent_id: consent.consent_id,
    version_id: 'v_demo1_1',
    answers: [
      { question_code: 'AD01', option_id: 'q_ad01_opt3' },
      { question_code: 'TS01', option_id: 'q_ts01_opt2' },
      { question_code: 'K02', text: 'Kendala kecil.' },
    ],
  };
  const noConsent = await call(`/public/surveys/${token}/responses`, {
    method: 'POST',
    idempotencyKey: 'kunci-validasi-002',
    body: { ...body, consent_id: '' },
  });
  assert.equal(noConsent.status, 403);

  const ambientCreator = `${creator}; ${cookie}`;
  const created = await call(`/public/surveys/${token}/responses`, {
    method: 'POST',
    idempotencyKey: 'kunci-undangan-0001',
    cookie: ambientCreator,
    body,
  });
  assert.equal(created.status, 201, created.text);
  const receipt = data<{ response_id: string }>(created);

  const auditRows = data<Array<{ action: string; actor: string; metadata: string | null }>>(
    await call('/admin/audit?limit=500', { cookie: await session('admin@svara.local') }),
  );
  const responseAudit = auditRows.find(
    (row) => row.action === 'Kirim respons' && row.metadata?.includes(receipt.response_id),
  );
  assert.equal(responseAudit?.actor, 'publik', 'submission publik tidak boleh memakai akun dari cookie ambient');
  assert.ok(
    auditRows.filter((row) => row.action === 'Kirim respons').every((row) => row.actor === 'publik'),
    'semua audit Kirim respons lewat route publik harus memakai aktor publik',
  );

  const reload = await call(`/public/surveys/${token}/review?consent_id=${consent.consent_id}`, { cookie });
  assert.equal(reload.status, 200, reload.text);
  const review = data<{ retryOnly: boolean; canSubmit: boolean; questions: unknown[] }>(reload);
  assert.equal(review.retryOnly, true);
  assert.equal(review.canSubmit, false);
  assert.deepEqual(review.questions, form.questions);
  assert.equal((await call(`/public/surveys/${token}/form?consent_id=${consent.consent_id}`, { cookie })).status, 409);
  assert.equal((await call(`/public/surveys/${token}/review?consent_id=${consent.consent_id}`, { cookie: otherCookie })).status, 409);

  const replay = await call(`/public/surveys/${token}/responses`, {
    method: 'POST',
    cookie,
    idempotencyKey: 'kunci-undangan-0001',
    body,
  });
  assert.equal(replay.status, 200, 'retry harus mengembalikan bukti yang sama');
  assert.equal(data<{ response_id: string }>(replay).response_id, receipt.response_id);

  const conflict = await call(`/public/surveys/${token}/responses`, {
    method: 'POST',
    cookie,
    idempotencyKey: 'kunci-undangan-0001',
    body: { ...body, answers: [] },
  });
  assert.equal(conflict.status, 422, 'isi berbeda dengan kunci sama tidak membuat respons baru');

  const second = await call(`/public/surveys/${token}/responses`, {
    method: 'POST',
    cookie,
    idempotencyKey: 'kunci-undangan-0002',
    body,
  });
  assert.equal(second.status, 409, 'undangan terpakai tidak menerima respons kedua');

  const receiptPath = `/public/surveys/${token}/receipt/${receipt.response_id}`;
  const receiptHeaders = { 'Idempotency-Key': 'kunci-undangan-0001' };
  const wrongReceipt = await call(receiptPath, { cookie, headers: { 'Idempotency-Key': 'kunci-lain-000000' } });
  assert.equal(wrongReceipt.status, 404);
  const anonymousReceipt = await call(receiptPath, { headers: receiptHeaders });
  assert.equal(anonymousReceipt.status, 404);
  const otherSessionReceipt = await call(receiptPath, { cookie: otherCookie, headers: receiptHeaders });
  assert.equal(otherSessionReceipt.status, 404);
  const rightReceipt = await call(receiptPath, { cookie, headers: receiptHeaders });
  assert.equal(rightReceipt.status, 200);
  assert.deepEqual(data(rightReceipt), receipt);
});

test('AC03: tautan umum, kedaluwarsa, pencabutan, dan kode undangan', async () => {
  const cookie = await session('creator.a@svara.local');
  const resolve = await call('/public/invitations/resolve', { method: 'POST', body: { code: 'UND-01-AKTIF' } });
  assert.equal(resolve.status, 200);
  // SEC-09: token undangan hanya tersimpan sebagai hash; penukaran kode mengembalikan URL formulir
  // berisi ID undangan, bukan token mentah.
  const resolvedInvite = (resolve.json as { data: { token?: string; url: string } }).data;
  assert.equal(resolvedInvite.token, undefined);
  // ID seed `inv_01` bukan bentuk `newId` yang dikenali pembaca publik; yang diuji adalah kontrak
  // resolver (URL formulir tanpa kredensial).
  assert.equal(resolvedInvite.url, '/s/inv_01');

  const past = await call('/surveys/s_demo1/invitations', {
    method: 'POST',
    cookie,
    body: { label: 'Kedaluwarsa', expires_at: '2020-01-01' },
  });
  assert.equal(past.status, 422);

  const created = data<{ invitation: { id: string; code: string }; token: string }>(
    await call('/surveys/s_demo1/invitations', {
      method: 'POST',
      cookie,
      body: { label: 'Kelas uji baru', expires_at: '2027-01-01' },
    }),
  );
  assert.ok(created.invitation.code.startsWith('UND-'));
  assert.ok(created.token.length >= 20);

  const revoked = await call(`/invitations/${created.invitation.id}/revoke`, { method: 'POST', cookie });
  assert.equal(revoked.status, 200);
  const context = await call(`/public/surveys/${created.token}`);
  assert.equal(context.status, 200);
  assert.equal((context.json as { data: { state: string; canSubmit: boolean } }).data.state, 'revoked');

  const secondRevoke = await call(`/invitations/${created.invitation.id}/revoke`, { method: 'POST', cookie });
  assert.equal(secondRevoke.status, 200);
  const stillRevoked = data<{ state: string }>(await call(`/public/surveys/${created.token}`));
  assert.equal(stillRevoked.state, 'revoked');
});

test('SEC-04/BF-03: referensi wali bebas tercatat self_attested, bukan verified', async () => {
  const token = 'pl_demoTautanUmum1A';
  const context = data<{ guardianRequired: boolean; consent_version: string }>(await call(`/public/surveys/${token}`));
  assert.equal(context.guardianRequired, true, 'tautan demo wajib bermode wali');

  const evidenceRef = `ref-acak-${Math.random().toString(36).slice(2)}`;
  const created = await call(`/public/surveys/${token}/consent`, {
    method: 'POST',
    body: { version_id: context.consent_version, respondent_click: true, eligibility: true, guardian_evidence_ref: evidenceRef },
  });
  assert.equal(created.status, 201, created.text);
  const consent = data<{ consent_id: string; guardian_evidence_status: string }>(created);
  assert.equal(consent.guardian_evidence_status, 'self_attested');

  const form = data<{ consent: { guardian_evidence_status: string } }>(
    await call(`/public/surveys/${token}/form?consent_id=${consent.consent_id}`, { cookie: consentCookie(created) }),
  );
  assert.equal(form.consent.guardian_evidence_status, 'self_attested');

  const stored = await storedGuardianEvidence(consent.consent_id);
  assert.deepEqual(stored, { status: 'self_attested', ref: evidenceRef }, 'referensi mentah tetap tersimpan');

  const missing = await call(`/public/surveys/${token}/consent`, {
    method: 'POST',
    body: { respondent_click: true, eligibility: true },
  });
  assert.equal(missing.status, 422);
  assert.equal((missing.json as { code: string }).code, 'guardian_evidence_required');
});

test('SEC-04 (a): MIME bukti wali di luar daftar ditolak tanpa menulis berkas', async () => {
  const token = await freshGuardianToken('Bukti wali MIME');
  const version = await consentVersionFor(token);
  const send = (file: string, mime: string, name: string) => call(`/public/surveys/${token}/consent`, {
    method: 'POST',
    body: {
      version_id: version,
      respondent_click: true,
      eligibility: true,
      guardian_evidence_file: file,
      guardian_evidence_mime: mime,
      guardian_evidence_name: name,
    },
  });
  const before = evidenceFiles();

  const declared = await send(PNG_BYTES.toString('base64'), 'text/plain', 'surat.txt');
  assert.equal(declared.status, 422, declared.text);
  assert.equal(errorCode(declared), 'invalid_evidence');
  assert.deepEqual(evidenceFiles(), before, 'MIME ditolak tidak boleh menulis berkas');

  // Isi bukan gambar meski klaim MIME sah: penanda berkas diperiksa setelah dekode.
  const disguised = await send(Buffer.from('bukan berkas gambar').toString('base64'), 'image/png', 'surat.png');
  assert.equal(disguised.status, 422, disguised.text);
  assert.equal(errorCode(disguised), 'invalid_evidence');
  assert.deepEqual(evidenceFiles(), before, 'isi yang tidak cocok tidak boleh menulis berkas');

  const accepted = await send(PNG_BYTES.toString('base64'), 'image/png', 'surat-wali.png');
  assert.equal(accepted.status, 201, accepted.text);
  const consentId = data<{ consent_id: string; guardian_evidence_status: string }>(accepted).consent_id;
  assert.equal(data<{ guardian_evidence_status: string }>(accepted).guardian_evidence_status, 'self_attested');

  const stored = await storedEvidenceRow(consentId);
  assert.ok(stored);
  assert.equal(stored.guardian_evidence_status, 'self_attested', 'unggahan belum diverifikasi operator');
  assert.equal(stored.guardian_evidence_file, 'surat-wali.png');
  assert.equal(stored.guardian_evidence_mime, 'image/png');
  assert.equal(stored.guardian_evidence_size, PNG_BYTES.length);
  assert.ok(stored.guardian_evidence_uploaded_at);

  const diskPath = join(EVIDENCE_DIR, `${consentId}.bin`);
  console.log(`[bukti wali] ${diskPath} (${statSync(diskPath).size} byte)`);
  assert.equal(statSync(diskPath).size, PNG_BYTES.length, 'berkas ditulis dengan ukuran asli');
  assert.deepEqual(evidenceFiles(), [...before, `${consentId}.bin`].sort());

  // Unduhan hanya lewat route ber-sesi dan ber-lingkup organisasi pemilik survei.
  const orgAdmin = await session('orgadmin@svara.local');
  const download = await call(`/org/guardian-evidence/${consentId}/file`, { cookie: orgAdmin });
  assert.equal(download.status, 200, download.text);
  assert.equal(download.headers.get('content-type'), 'image/png');
  assert.equal(Buffer.compare(Buffer.from(download.bytes), PNG_BYTES), 0, 'isi unduhan identik dengan unggahan');
});

test('SEC-04 (b): bukti wali lebih dari 5 MB ditolak sebelum dekode dan tanpa berkas', async () => {
  const token = await freshGuardianToken('Bukti wali besar');
  const version = await consentVersionFor(token);
  const before = evidenceFiles();
  const oversized = await call(`/public/surveys/${token}/consent`, {
    method: 'POST',
    body: {
      version_id: version,
      respondent_click: true,
      eligibility: true,
      guardian_evidence_file: Buffer.alloc(EVIDENCE_MAX_BYTES + 1).toString('base64'),
      guardian_evidence_mime: 'application/pdf',
      guardian_evidence_name: 'surat-besar.pdf',
    },
  });
  assert.equal(oversized.status, 422, oversized.text);
  assert.equal(errorCode(oversized), 'invalid_evidence');
  assert.deepEqual(evidenceFiles(), before, 'kiriman terlalu besar tidak boleh menulis berkas');
});

test('SEC-04 (c): org_admin tidak membaca atau memutus bukti organisasi lain', async () => {
  const foreignConsent = 'c_eviden_org_y';
  const stamp = '2026-11-12T01:00:00Z';
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(join(EVIDENCE_DIR, `${foreignConsent}.bin`), Buffer.from('PK\x03\x04 bukti org lain'));
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    // Prasyarat: survei terbit milik org_perpus (organisasi B) dengan bukti wali yang menunggu moderasi.
    await client.query(
      `INSERT INTO surveys (id, owner_id, profile_id, title, purpose, object_label, instructions, status,
         created_at, updated_at, current_version_id, organization_id)
       VALUES ('s_eviden_org_y', 'u_creator_b', 'p_perpus', 'Survei bukti org lain', 'Uji silang organisasi.',
         'Peserta', '', 'published', $1, $1, 'v_eviden_org_y', 'org_perpus')`,
      [stamp],
    );
    await client.query(
      `INSERT INTO survey_versions (id, survey_id, number, status, notice_version, published_at, closed_at)
       VALUES ('v_eviden_org_y', 's_eviden_org_y', 1, 'published', '1.0', $1, NULL)`,
      [stamp],
    );
    await client.query(
      `INSERT INTO consent_records (id, survey_id, version_id, notice_version, basis, status, recorded_at,
         respondent_click, guardian_evidence_status, guardian_evidence_ref, guardian_evidence_file,
         guardian_evidence_mime, guardian_evidence_size, guardian_evidence_uploaded_at)
       VALUES ($1, 's_eviden_org_y', 'v_eviden_org_y', '1.0', 'Persetujuan wali', 'granted', $2,
         1, 'self_attested', 'catatan org lain', 'surat-org-y.pdf',
         'application/pdf', 17, $2)`,
      [foreignConsent, stamp],
    );

    const orgAdmin = await session('orgadmin@svara.local');
    const listed = data<{ evidence: Array<{ consent_id: string }> }>(
      await call('/org/guardian-evidence?status=self_attested', { cookie: orgAdmin }),
    );
    assert.ok(!listed.evidence.some((row) => row.consent_id === foreignConsent), 'daftar hanya organisasi sesi');

    const file = await call(`/org/guardian-evidence/${foreignConsent}/file`, { cookie: orgAdmin });
    assert.equal(file.status, 404, file.text);
    assert.equal(errorCode(file), 'evidence_not_found');

    const patch = await call(`/org/guardian-evidence/${foreignConsent}`, {
      method: 'PATCH',
      cookie: orgAdmin,
      body: { decision: 'verified' },
    });
    assert.equal(patch.status, 404, patch.text);
    assert.equal((await storedEvidenceRow(foreignConsent))?.guardian_evidence_status, 'self_attested');

    const creator = await session('creator.a@svara.local');
    const forbidden = await call('/org/guardian-evidence', { cookie: creator });
    assert.equal(forbidden.status, 403);
    assert.equal(errorCode(forbidden), 'forbidden_role');
    assert.equal((await call('/org/guardian-evidence')).status, 401);
  } finally {
    await client.query('DELETE FROM consent_records WHERE id = $1', [foreignConsent]);
    await client.query("DELETE FROM survey_versions WHERE id = 'v_eviden_org_y'");
    await client.query("DELETE FROM surveys WHERE id = 's_eviden_org_y'");
    rmSync(join(EVIDENCE_DIR, `${foreignConsent}.bin`), { force: true });
    await client.end();
  }
});

test('SEC-04 (d): PATCH verified mengubah status, mencatat peninjau, dan menulis audit', async () => {
  const orgAdmin = await session('orgadmin@svara.local');
  const patched = await call('/org/guardian-evidence/c_demo01', {
    method: 'PATCH',
    cookie: orgAdmin,
    body: { decision: 'verified', note: 'Surat izin wali sesuai.' },
  });
  assert.equal(patched.status, 200, patched.text);
  const evidence = data<{ evidence: Record<string, unknown> }>(patched).evidence;
  assert.equal(evidence.guardian_evidence_status, 'verified');
  assert.equal(evidence.guardian_evidence_reviewed_by, 'u_orgadmin');
  assert.equal(evidence.guardian_evidence_review_note, 'Surat izin wali sesuai.');

  const stored = await storedEvidenceRow('c_demo01');
  assert.equal(stored?.guardian_evidence_status, 'verified');
  assert.equal(stored?.guardian_evidence_reviewed_by, 'u_orgadmin');
  assert.ok(stored?.guardian_evidence_reviewed_at);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const auditRow = await client.query<{ action: string; outcome: string; account_id: string | null; organization_id: string | null }>(
      `SELECT action, outcome, account_id, organization_id FROM audit_logs
        WHERE object = 'c_demo01' AND action = 'Verifikasi bukti wali'
        ORDER BY at DESC, id DESC LIMIT 1`,
    );
    assert.equal(auditRow.rows[0]?.outcome, 'berhasil');
    assert.equal(auditRow.rows[0]?.account_id, 'u_orgadmin');
    assert.equal(auditRow.rows[0]?.organization_id, 'org_smk');
  } finally {
    await client.end();
  }

  const verifiedList = data<{ evidence: Array<{ consent_id: string }> }>(
    await call('/org/guardian-evidence?status=verified', { cookie: orgAdmin }),
  );
  assert.ok(verifiedList.evidence.some((row) => row.consent_id === 'c_demo01'));
  const pendingList = data<{ evidence: Array<{ consent_id: string }> }>(
    await call('/org/guardian-evidence?status=self_attested', { cookie: orgAdmin }),
  );
  assert.ok(!pendingList.evidence.some((row) => row.consent_id === 'c_demo01'));

  const rejected = await call('/org/guardian-evidence/c_demo01', {
    method: 'PATCH',
    cookie: orgAdmin,
    body: { decision: 'rejected', note: 'Nama di surat tidak cocok.' },
  });
  assert.equal(rejected.status, 200, rejected.text);
  assert.equal(data<{ evidence: { guardian_evidence_status: string } }>(rejected).evidence.guardian_evidence_status, 'rejected');

  const invalid = await call('/org/guardian-evidence/c_demo01', {
    method: 'PATCH',
    cookie: orgAdmin,
    body: { decision: 'approved' },
  });
  assert.equal(invalid.status, 422);
});

test('SEC-04 (e): konsen tanpa guardianRequired tidak menerima berkas', async () => {
  // survei baru organisasi default 'tidak' (persetujuan diri); berkas bukti tidak diterima.
  const owner = await session('creator.b@svara.local');
  const created = data<{ survey: { id: string } }>(await call('/surveys', {
    method: 'POST', cookie: owner, body: { title: 'Survei tanpa wali', owner_scope: 'organization' },
  }));
  const saved = await call(`/surveys/${created.survey.id}`, {
    method: 'PUT', cookie: owner, body: {
      title: 'Survei tanpa wali',
      purpose: 'Menguji bahwa berkas bukti wali tidak diterima tanpa mode wali.',
      object_label: 'Peserta',
      instructions: '',
      questions: [{ code: 'Q1', type: 'short_text', required: true, section: 'Uji', label: 'Tanggapan' }],
    },
  });
  assert.equal(saved.status, 200, saved.text);
  const published = await call(`/surveys/${created.survey.id}/publish`, { method: 'POST', cookie: owner });
  assert.equal(published.status, 200, published.text);
  const token = data<{ publicLink: { token: string } }>(published).publicLink.token;
  const context = await call(`/public/surveys/${token}`);
  assert.equal(data<{ guardianRequired: boolean }>(context).guardianRequired, false);
  const version = data<{ consent_version: string }>(context).consent_version;
  const before = evidenceFiles();

  const withFile = await call(`/public/surveys/${token}/consent`, {
    method: 'POST',
    body: {
      version_id: version,
      respondent_click: true,
      eligibility: true,
      guardian_evidence_file: PNG_BYTES.toString('base64'),
      guardian_evidence_mime: 'image/png',
      guardian_evidence_name: 'bukti-tak-diminta.png',
    },
  });
  assert.equal(withFile.status, 422, withFile.text);
  assert.equal(errorCode(withFile), 'invalid_evidence');
  assert.deepEqual(evidenceFiles(), before);

  const accepted = await call(`/public/surveys/${token}/consent`, {
    method: 'POST',
    body: { version_id: version, respondent_click: true, eligibility: true },
  });
  assert.equal(accepted.status, 201, accepted.text);
  const consentId = data<{ consent_id: string }>(accepted).consent_id;
  assert.equal((await storedEvidenceRow(consentId))?.guardian_evidence_file, null);
  assert.deepEqual(evidenceFiles(), before, 'konsen tanpa wali tidak boleh menulis berkas');
});

test('Kebutuhan bukti persetujuan milik survei: organisasi boleh, personal ditolak 422', async () => {
  const owner = await session('creator.a@svara.local');
  const questions = [{ code: 'Q1', type: 'short_text', required: true, section: 'Uji', label: 'Tanggapan' }];

  const personal = data<{ survey: { id: string; organization_id: string | null; consent_required: string } }>(
    await call('/surveys', { method: 'POST', cookie: owner, body: { title: 'Survei personal', owner_scope: 'individual' } }),
  );
  assert.equal(personal.survey.organization_id, null);
  assert.equal(personal.survey.consent_required, 'tidak', 'survei personal selalu persetujuan diri');
  const personalRejected = await call('/surveys', {
    method: 'POST',
    cookie: owner,
    body: { title: 'Survei personal berbekal', owner_scope: 'individual', consent_required: 'wajib_upload' },
  });
  assert.equal(personalRejected.status, 422);
  assert.equal((personalRejected.json as { code?: string }).code, 'consent_required_personal');

  const organization = data<{ survey: { id: string } }>(
    await call('/surveys', {
      method: 'POST',
      cookie: owner,
      body: { title: 'Survei organisasi berbekal', owner_scope: 'organization', consent_required: 'wajib_upload' },
    }),
  );
  const created = data<{ survey: { consent_required: string } }>(await call(`/surveys/${organization.survey.id}`, { cookie: owner }));
  assert.equal(created.survey.consent_required, 'wajib_upload', 'survei organisasi menerima wajib_upload saat dibuat');

  const invalidValue = await call(`/surveys/${personal.survey.id}/settings`, {
    method: 'PUT',
    cookie: owner,
    body: { allowResults: true, allowIndividual: false, consent_required: 'wajib' },
  });
  assert.equal(invalidValue.status, 422);
  const personalSettings = await call(`/surveys/${personal.survey.id}/settings`, {
    method: 'PUT',
    cookie: owner,
    body: { allowResults: true, allowIndividual: false, consent_required: 'wajib_upload' },
  });
  assert.equal(personalSettings.status, 422);
  assert.equal((personalSettings.json as { code?: string }).code, 'consent_required_personal');

  const saveOrganization = await call(`/surveys/${organization.survey.id}/settings`, {
    method: 'PUT',
    cookie: owner,
    body: { allowResults: true, allowIndividual: false, consent_required: 'wajib_upload' },
  });
  assert.equal(saveOrganization.status, 200, saveOrganization.text);
  assert.equal(data<{ consentRequired: string }>(saveOrganization).consentRequired, 'wajib_upload');

  for (const survey of [personal.survey.id, organization.survey.id]) {
    const saved = await call(`/surveys/${survey}`, {
      method: 'PUT',
      cookie: owner,
      body: { title: 'Judul', purpose: 'Tujuan', object_label: 'Objek', instructions: '', questions },
    });
    assert.equal(saved.status, 200, saved.text);
    const published = await call(`/surveys/${survey}/publish`, { method: 'POST', cookie: owner });
    assert.equal(published.status, 200, published.text);
  }

  // Kewajiban bukti dibaca dari survei saat pengantar dibuka: organisasi wajib, personal tidak.
  const settings = data<{ allowResults: boolean; allowIndividual: boolean; consentRequired: string }>(
    await call(`/surveys/${organization.survey.id}/settings`, { cookie: owner }),
  );
  assert.deepEqual(settings, { allowResults: true, allowIndividual: false, consentRequired: 'wajib_upload' });
  const personalContext = data<{ guardianRequired: boolean; consent_version: string }>(
    await call(`/public/surveys/${(await publicTokenFor(personal.survey.id, owner))}`),
  );
  assert.equal(personalContext.guardianRequired, false);

  const organizationToken = await publicTokenFor(organization.survey.id, owner);
  const organizationContext = data<{ guardianRequired: boolean; consent_version: string }>(
    await call(`/public/surveys/${organizationToken}`),
  );
  assert.equal(organizationContext.guardianRequired, true, 'survei organisasi berbekal menuntut bukti pendukung');
  const withoutEvidence = await call(`/public/surveys/${organizationToken}/consent`, {
    method: 'POST',
    body: { version_id: organizationContext.consent_version, respondent_click: true, eligibility: true },
  });
  assert.equal(withoutEvidence.status, 422);
  assert.equal((withoutEvidence.json as { code?: string }).code, 'guardian_evidence_required');
  assert.equal(
    (withoutEvidence.json as { error?: string }).error,
    'Untuk survei ini, persetujuan perlu disertai bukti pendukung.',
    'notice generik tanpa umur/anak/wali',
  );
  const withEvidence = await call(`/public/surveys/${organizationToken}/consent`, {
    method: 'POST',
    body: {
      version_id: organizationContext.consent_version,
      respondent_click: true,
      eligibility: true,
      guardian_evidence_ref: 'surat-persetujuan-01',
    },
  });
  assert.equal(withEvidence.status, 201, withEvidence.text);
  assert.equal(data<{ guardian_evidence_status: string }>(withEvidence).guardian_evidence_status, 'self_attested');
});

async function publicTokenFor(surveyId: string, cookie: string): Promise<string> {
  const issued = await call(`/surveys/${surveyId}/public-link/token`, { method: 'POST', cookie });
  assert.equal(issued.status, 201, issued.text);
  return data<{ token: string }>(issued).token;
}

test('AC09/AC11: hasil, CSV, codebook, izin ekspor, dan audit akses', async () => {
  const creator = await session('creator.a@svara.local');
  const officer = await session('officer@svara.local');
  const creatorB = await session('creator.b@svara.local');

  const summary = data<{
    total: number;
    items: Array<{ code: string; answered: number; skipped: number; options: Array<{ value: number; count: number }> }>;
  }>(await call('/surveys/s_demo1/summary?version=v_demo1_1', { cookie: creator }));
  assert.ok(summary.total >= 5);
  const ad01 = summary.items.find((item) => item.code === 'AD01');
  assert.ok(ad01);
  assert.equal(ad01?.options.length, 5, 'opsi tanpa pemilih tetap tampil');
  // PRD §7 (AC08): lima respons final seed — AD01 = 2, 4, 4, 5, kosong; frekuensi opsi 1–5 = 0,1,0,2,1.
  const ad01Responses = data<Array<{
    id: string;
    answers: Array<{ question_code: string; option_id: string | null; value: number | null; skipped: boolean }>;
  }>>(await call('/surveys/s_demo1/responses?version=v_demo1_1', { cookie: officer }));
  const ad01ByResponse = ad01Responses.map((response) => ({
    seed: response.id.startsWith('r_demo'),
    answer: response.answers.find((answer) => answer.question_code === 'AD01'),
  }));
  const seedAd01 = ad01ByResponse.filter((row) => row.seed).map((row) => row.answer);
  const seedAnsweredAd01 = seedAd01.filter((answer) => answer && !answer.skipped).length;
  assert.equal(seedAnsweredAd01, 4, 'total pengisi AD01 seed empat (PRD §7)');
  assert.deepEqual(
    seedAd01.map((answer) => (answer?.skipped ? null : answer?.value)).sort((a, b) => (a ?? 0) - (b ?? 0)),
    [null, 2, 4, 4, 5],
    'AD01 seed harus 2, 4, 4, 5, kosong (PRD §7)',
  );
  assert.equal(
    seedAd01.filter((answer) => answer?.value === 4).length / seedAnsweredAd01,
    0.5,
    'opsi 4 = 50% dari yang menjawab AD01 (PRD §7)',
  );
  // Ringkasan hidup mencakup respons uji lain pada versi ini; selisihnya dihitung dari baris API,
  // bukan dari total statis.
  const otherAd01 = ad01ByResponse.filter((row) => !row.seed).map((row) => row.answer);
  assert.equal(
    ad01.answered,
    seedAnsweredAd01 + otherAd01.filter((answer) => answer && !answer.skipped).length,
    'ringkasan menjumlahkan pengisi AD01 seed dan respons uji lain',
  );
  assert.equal(ad01.skipped, 1, 'hanya respons seed r_demo05 yang melewati AD01');
  assert.deepEqual(
    [...ad01.options].sort((a, b) => a.value - b.value).map((option) => option.count),
    [1, 2, 3, 4, 5].map((value) =>
      [...seedAd01, ...otherAd01].filter((answer) => answer?.value === value).length,
    ),
    'frekuensi opsi: seed PRD §7 0,1,0,2,1 + respons uji lain',
  );

  const officerCsv = await call('/surveys/s_demo1/export?version=v_demo1_1&format=csv&recipient=Uji%20KP-03&purpose=Uji%20ekspor', { cookie: officer });
  assert.equal(officerCsv.status, 200);
  assert.ok(officerCsv.headers.get('content-type')?.startsWith('text/csv'));
  assert.equal(officerCsv.bytes[0], 0xef, 'CSV memakai BOM UTF-8');
  assert.equal(officerCsv.bytes[1], 0xbb);
  assert.equal(officerCsv.bytes[2], 0xbf);
  const header = officerCsv.text.replace('\uFEFF', '').split('\r\n')[0]!;
  assert.equal(
    header,
    'response_id,respondent_id,survey_id,survey_version,assignment_id,collection_mode,identity_source,submitted_at,organisasi,cara_masuk,AD01,TS01,K02',
  );
  // Kolom pembeda tetap di akhir daftar kolom tetap: organisasi pemilik atau `publik`, lalu asal kiriman.
  const dataRows = officerCsv.text.replace('\uFEFF', '').trim().split('\r\n').slice(1).map((line) => line.split(','));
  assert.ok(dataRows.length > 0);
  for (const row of dataRows) {
    assert.equal(row[8], 'org_smk', 'organisasi = id organisasi pemilik survei');
    assert.equal(row[9], row[4] ? 'undangan' : 'tautan_umum', 'cara_masuk mengikuti assignment_id');
  }
  assert.ok(!header.toLowerCase().includes('token'));
  assert.ok(!header.toLowerCase().includes('name'));
  assert.ok(officerCsv.text.includes('Perlu panduan singkat.'), 'teks bebas tampil untuk penerima berizin');

  // Pemilik kini berhak penuh (keputusan user): teks bebas ikut untuk pemilik.
  const creatorCsv = await call('/surveys/s_demo1/export?version=v_demo1_1&format=csv&recipient=Uji%20KP-03&purpose=Uji%20ekspor', {
    cookie: await session('creator.b@svara.local'),
  });
  assert.equal(creatorCsv.status, 403, 'creator bukan pemilik tanpa grant tidak boleh ekspor');

  const ownerCsv = await call('/surveys/s_demo4/export?version=v_demo4_1&format=csv&recipient=Uji%20KP-03&purpose=Uji%20ekspor', { cookie: creator });
  assert.equal(ownerCsv.status, 200, 'pemilik survei otomatis boleh ekspor tanpa grant');

  const denied = await call('/surveys/s_demo1/export?version=v_demo1_1&format=csv&recipient=Uji%20KP-03&purpose=Uji%20ekspor', { cookie: creatorB });
  assert.equal(denied.status, 403);

  const codebook = await call('/surveys/s_demo1/export?version=v_demo1_1&format=codebook', { cookie: officer });
  assert.equal(codebook.status, 200);
  assert.ok(codebook.text.includes('K02'));
  assert.ok(codebook.text.includes('Sangat tidak setuju'));
  const otherCodebook = await call('/surveys/s_demo1/export?version=v_demo1_1&format=codebook', {
    cookie: await session('creator.b@svara.local'),
  });
  assert.equal(otherCodebook.status, 403, 'creator tanpa grant tidak boleh codebook');

  // Pemilik kini membaca individual tanpa grant; penolakan berlaku untuk akun tanpa hak.
  const individualDenied = await call('/surveys/s_demo1/responses?version=v_demo1_1', {
    cookie: await session('creator.b@svara.local'),
  });
  assert.equal(individualDenied.status, 403);
  const individual = data<Array<{ answers: Array<{ question_code: string; text: string | null }> }>>(
    await call('/surveys/s_demo1/responses?version=v_demo1_1', { cookie: officer }),
  );
  assert.ok(individual.some((response) =>
    response.answers.some((answer) => answer.question_code === 'K02' && answer.text !== null),
  ));
  assert.ok(individual.length >= 5);

  const audit = data<Array<{ action: string; outcome: string }>>(
    await call('/admin/audit', { cookie: await session('admin@svara.local') }),
  );
  assert.ok(audit.some((log) => log.action === 'Ekspor hasil' && log.outcome === 'ditolak'));
  assert.ok(audit.some((log) => log.action === 'Baca jawaban individual' && log.outcome === 'berhasil'));

  const disabled = await call('/surveys/s_demo1/settings', {
    method: 'PUT',
    cookie: creator,
    body: { allowResults: true, allowIndividual: false },
  });
  assert.equal(disabled.status, 200);
  const settingsDenied = await call('/surveys/s_demo1/responses?version=v_demo1_1', { cookie: officer });
  assert.equal(settingsDenied.status, 403, 'pengaturan allow_individual=false menolak baca individual');
  const restored = await call('/surveys/s_demo1/settings', {
    method: 'PUT',
    cookie: creator,
    body: { allowResults: true, allowIndividual: true },
  });
  assert.equal(restored.status, 200);
});

test('AC09: formula, kutip, dan baris baru dinetralkan tanpa mengubah nilai tersimpan', async () => {
  const token = 'pl_demoTautanUmum1A';
  const context = data<{ guardianRequired: boolean; consent_version: string }>(await call(`/public/surveys/${token}`));
  assert.equal(context.guardianRequired, true);
  const issuedConsent = await call(`/public/surveys/${token}/consent`, {
    method: 'POST',
    body: { version_id: context.consent_version, respondent_click: true, eligibility: true, guardian_evidence_ref: 'ref-wali-formula' },
  });
  const consent = data<{ consent_id: string }>(issuedConsent);
  const text = '=SUM(1,2) "kutip", baris\nbaru';
  const created = await call(`/public/surveys/${token}/responses`, {
    method: 'POST',
    cookie: consentCookie(issuedConsent),
    idempotencyKey: 'kunci-formula-0001',
    body: {
      consent_id: consent.consent_id,
      answers: [
        { question_code: 'AD01', option_id: 'q_ad01_opt3' },
        { question_code: 'TS01', option_id: 'q_ts01_opt2' },
        { question_code: 'K02', text },
      ],
    },
  });
  assert.equal(created.status, 201);

  const cookie = await session('officer@svara.local');
  const csv = await call('/surveys/s_demo1/export?version=v_demo1_1&format=csv&recipient=Uji%20KP-03&purpose=Uji%20ekspor', { cookie });
  assert.equal(csv.status, 200);
  assert.ok(!csv.text.includes('\n=SUM'), 'formula diberi awalan kutip');
  assert.ok(csv.text.includes("'=SUM(1,2)"), 'nilai formula dinetralkan saat ekspor');
  assert.ok(csv.text.includes('""kutip""'), 'kutip ganda di-escape');
  assert.ok(csv.text.includes('baris\nbaru"'), 'baris baru dikutip');
});

test('SEC-01/SEC-02: notice publik berasal dari lingkup survei dan tidak jatuh ke versi lain', async () => {
  const context = data<{
    profile: { id: string; source: string };
    notice: { id: string; version: string };
    version: { notice_version: string };
    consent_version: string;
    guardianRequired: boolean;
  }>(await call('/public/surveys/pl_demoTautanUmum1A'));

  // s_demo1 milik org_smk, menetapkan consent_required 'wajib_upload' pada surveinya, notice versi 1.0.
  assert.equal(context.profile.source, 'organization');
  assert.equal(context.profile.id, 'org_smk');
  assert.equal('consent_mode' in context.profile, false, 'profil publik tidak lagi membawa mode persetujuan');
  assert.equal(context.guardianRequired, true);
  assert.equal(context.notice.id, 'on_org_smk_1_0');
  assert.equal(context.notice.version, context.version.notice_version);
  assert.equal(context.notice.version, '1.0');

  const consent = data<{ consent_id: string; notice_version: string; notice_source: string }>(
    await call('/public/surveys/pl_demoTautanUmum1A/consent', {
      method: 'POST',
      body: { version_id: context.consent_version, respondent_click: true, eligibility: true, guardian_evidence_ref: 'ref-wali-sumber' },
    }),
  );
  assert.equal(consent.notice_version, '1.0');
  assert.equal(consent.notice_source, 'organization');

  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const history = await db.query<{ source: string; source_id: string; notice_id: string; notice_version: string }>(
      'SELECT source, source_id, notice_id, notice_version FROM consent_notice_versions WHERE consent_id = $1',
      [consent.consent_id],
    );
    assert.deepEqual(history.rows, [
      { source: 'organization', source_id: 'org_smk', notice_id: 'on_org_smk_1_0', notice_version: '1.0' },
    ]);

    // Notice versi berbeda untuk organisasi yang sama tidak boleh menggantikan versi yang tercatat.
    await db.query("DELETE FROM organization_notices WHERE id = 'on_org_smk_1_0'");
  } finally {
    await db.end();
  }
  const failClosed = await call('/public/surveys/pl_demoTautanUmum1A');
  assert.equal(failClosed.status, 500);
  assert.equal((failClosed.json as { code: string }).code, 'notice_version_unavailable');

  const db2 = new Client({ connectionString: databaseUrl });
  await db2.connect();
  try {
    await db2.query(
      `INSERT INTO organization_notices (id, organization_id, version, effective_date, purpose, data_categories,
        module15_usage, retention_text, recipients, contact, rights, child_data_text, cross_border_text, created_at)
       VALUES ('on_org_smk_1_0', 'org_smk', '1.0', '2026-11-17', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x', '2026-11-17')`,
    );
  } finally {
    await db2.end();
  }
});

test('AC12: akun, izin terpisah, dan perubahan berlaku pada permintaan berikutnya', async () => {
  const admin = await session('admin@svara.local');
  const accounts = data<{ accounts: Array<{ id: string; role: string; status: string }> }>(
    await call('/admin/accounts', { cookie: admin }),
  );
  assert.ok(accounts.accounts.length >= 4);

  const patched = await call('/admin/accounts/u_creator_b', {
    method: 'PATCH',
    cookie: admin,
    body: { status: 'suspended' },
  });
  assert.equal(patched.status, 200);
  const blockedLogin = await call('/auth/login', {
    method: 'POST',
    body: { email: 'creator.b@svara.local', password: 'SvaraDemo123!' },
  });
  assert.equal(blockedLogin.status, 401);
  await call('/admin/accounts/u_creator_b', { method: 'PATCH', cookie: admin, body: { status: 'active' } });
  // L-04: penangguhan menghapus semua sesi akun, jadi cookie cache lama tidak berlaku lagi.
  sessions.delete('creator.b@svara.local');

  // BR-10/SEC-15: bootstrap super admin hanya membawa grant miliknya sendiri; grant akun lain dibaca
  // lewat /admin/accounts, diubah test lain.
  const before = data<{ grants: Array<{ account_id: string }> }>(await call('/bootstrap', { cookie: admin }));
  assert.deepEqual(before.grants, []);

  const setGrants = await call('/admin/grants/u_petugas', {
    method: 'PUT',
    cookie: admin,
    body: {
      grants: [
        {
          survey_id: 's_demo1',
          can_read_individual: true,
          can_export: true,
          can_read_free_text: false,
          purpose: 'Uji izin akses',
        },
      ],
    },
  });
  assert.equal(setGrants.status, 200);
  const officer = await session('officer@svara.local');
  // BR-06: endpoint grant mengganti seluruh daftar akun; grant seed dipulihkan di akhir uji agar test
  // berikutnya tetap menemukan izin teks penuh.
  const seededOfficerGrants = data<{ grants: Array<Record<string, unknown>> }>(
    await call('/admin/accounts', { cookie: admin }),
  ).grants.filter((grant) => grant.account_id === 'u_petugas');

  const officerAccount = accounts.accounts.find((row) => row.id === 'u_petugas');
  assert.equal(officerAccount?.role, 'creator', 'akun penerima izin kini berperan creator');

  const legacyRole = await call('/admin/accounts/u_petugas', {
    method: 'PATCH',
    cookie: admin,
    body: { role: 'authorized_officer' },
  });
  assert.equal(legacyRole.status, 422, 'peran authorized_officer sudah dihapus');
  assert.equal((legacyRole.json as { code?: string }).code, 'validation_error');

  for (const [label, cookie] of [['pemilik', await session('creator.a@svara.local')], ['penerima izin', officer]] as const) {
    for (const [method, path] of [
      ['GET', '/admin/accounts'],
      ['PATCH', '/admin/accounts/u_petugas'],
      ['PUT', '/admin/grants/u_petugas'],
      ['GET', '/admin/audit'],
    ] as const) {
      const body = method === 'PATCH' ? { role: 'super_admin' } : method === 'PUT' ? { grants: [] } : undefined;
      const denied = await call(path, { method, cookie, body });
      assert.equal(denied.status, 403, `${method} ${path} harus menolak creator (${label})`);
    }
  }

  // Dikembalikan pada akhir: test lain bergantung pada grant teks penuh milik u_petugas.
  const restoredOfficer = await call('/admin/grants/u_petugas', {
    method: 'PUT',
    cookie: admin,
    body: {
      grants: seededOfficerGrants.map((grant) => ({
        survey_id: grant.survey_id,
        can_read_individual: Boolean(grant.can_read_individual),
        can_export: Boolean(grant.can_export),
        can_read_free_text: Boolean(grant.can_read_free_text),
        purpose: String(grant.purpose),
        expires_at: grant.expires_at,
      })),
    },
  });
  assert.equal(restoredOfficer.status, 200, restoredOfficer.text);
  const withoutText = data<Array<{ answers: Array<{ question_code: string; text: string | null }> }>>(
    await call('/surveys/s_demo1/responses?version=v_demo1_1', { cookie: officer }),
  );
  assert.ok(withoutText.length > 0);
  assert.ok(withoutText.every((response) =>
    response.answers.every((answer) => answer.question_code !== 'K02' || answer.text === null),
  ));
});

test('Super admin menetapkan organisasi akun dan lingkupnya berlaku pada permintaan berikutnya', async () => {
  const admin = await session('admin@svara.local');

  const missing = await call('/admin/accounts/u_creator_b', {
    method: 'PATCH',
    cookie: admin,
    body: { organization_id: 'org_tidak_ada' },
  });
  assert.equal(missing.status, 422);
  const missingBody = missing.json as { code?: string } | null;
  assert.equal(missingBody?.code, 'unknown_organization');

  const stored = new Client({ connectionString: databaseUrl });
  await stored.connect();
  const snapshot = (
    await stored.query<{ role: string; organization_id: string | null }>(
      "SELECT role, organization_id FROM accounts WHERE id = 'u_creator_b'",
    )
  ).rows[0];
  assert.ok(snapshot, 'akun u_creator_b harus ada di data seed');

  // Semua langkah setelah ini mengubah u_creator_b; finally mengembalikannya agar
  // kegagalan assertion tidak meracuni tes berikutnya.
  try {
    const assigned = await call('/admin/accounts/u_creator_b', {
      method: 'PATCH',
      cookie: admin,
      body: { organization_id: 'org_perpus' },
    });
    assert.equal(assigned.status, 200);
    assert.equal(data<{ organization_id: string | null }>(assigned).organization_id, 'org_perpus');

    const audit = await stored.query("SELECT metadata FROM audit_logs WHERE object = 'u_creator_b' ORDER BY at DESC LIMIT 1");
    const metadata = JSON.parse(String(audit.rows[0]?.metadata ?? '{}')) as { organization_id?: string | null };
    assert.equal(metadata.organization_id, 'org_perpus');

    const bootstrap = data<{
      accounts: Array<{ id: string; organization_id: string | null }>;
      organizations: Array<{ id: string; name: string }>;
    }>(await call('/bootstrap', { cookie: admin }));
    assert.equal(bootstrap.accounts.find((row) => row.id === 'u_creator_b')?.organization_id, 'org_perpus');
    assert.ok(bootstrap.organizations.some((organization) => organization.id === 'org_smk'));

    const outsider = await session('creator.b@svara.local');
    const created = await call('/surveys', {
      method: 'POST',
      cookie: outsider,
      body: { title: 'Survei lingkup organisasi', owner_scope: 'organization' },
    });
    assert.equal(created.status, 201);
    assert.equal(
      data<{ survey: { organization_id: string | null } }>(created).survey.organization_id,
      'org_perpus',
    );

    const asOrgAdmin = await call('/admin/accounts/u_creator_b', {
      method: 'PATCH',
      cookie: admin,
      body: { role: 'org_admin', organization_id: 'org_smk' },
    });
    assert.equal(asOrgAdmin.status, 200);
    const profile = await call('/org/profile', { cookie: outsider });
    assert.equal(profile.status, 200);

    const detached = await call('/admin/accounts/u_creator_b', {
      method: 'PATCH',
      cookie: admin,
      body: { organization_id: null },
    });
    assert.equal(detached.status, 422);
    const detachedBody = detached.json as { code?: string } | null;
    assert.equal(detachedBody?.code, 'organization_required');

    const promoted = await call('/admin/accounts/u_creator_b', {
      method: 'PATCH',
      cookie: admin,
      body: { role: 'super_admin' },
    });
    assert.equal(promoted.status, 422);
    const promotedBody = promoted.json as { code?: string } | null;
    assert.equal(promotedBody?.code, 'super_admin_scope');

    const restored = await call('/admin/accounts/u_creator_b', {
      method: 'PATCH',
      cookie: admin,
      body: { role: 'creator', organization_id: null },
    });
    assert.equal(restored.status, 200);
    assert.equal(data<{ organization_id: string | null }>(restored).organization_id, null);
  } finally {
    await stored.query("UPDATE accounts SET role = $1, organization_id = $2 WHERE id = 'u_creator_b'", [
      snapshot.role,
      snapshot.organization_id,
    ]);
    await stored.end();
  }
});

test('Super admin membuat organisasi baru sekaligus admin pertamanya', async () => {
  const admin = await session('admin@svara.local');
  const email = 'admin.baru@svara.local';
  // Notice organisasi baru berasal dari profil deployment legacy bernama sama+tipe (aturan 013).
  const payload = {
    name: 'SMA Harapan Baru (sintetis)',
    notice_profile_name: 'SMK Nusantara (contoh)',
    organization_type: 'school',
    admin: { display_name: 'Dewi Lestari', email, password: 'SvaraBaru123!x' },
  };

  const forbidden = await call('/admin/organizations', {
    method: 'POST',
    cookie: await session('creator.a@svara.local'),
    body: payload,
  });
  assert.equal(forbidden.status, 403);

  const weak = await call('/admin/organizations', {
    method: 'POST',
    cookie: admin,
    body: { ...payload, admin: { ...payload.admin, email: 'lemah@svara.local', password: 'pendek' } },
  });
  assert.equal(weak.status, 422);
  assert.equal((weak.json as { code?: string } | null)?.code, 'weak_password');

  const taken = await call('/admin/organizations', {
    method: 'POST',
    cookie: admin,
    body: { ...payload, admin: { ...payload.admin, email: 'admin@svara.local' } },
  });
  assert.equal(taken.status, 409);
  assert.equal((taken.json as { code?: string } | null)?.code, 'email_taken');

  // Tanpa notice legacy yang cocok nama+tipe (aturan 013), organisasi ditolak alih-alih lahir tanpa notice.
  const noNoticeSource = await call('/admin/organizations', {
    method: 'POST',
    cookie: admin,
    body: { ...payload, admin: { ...payload.admin, email: 'tanpa.notice@svara.local' }, notice_profile_name: 'Tidak Ada' },
  });
  assert.equal(noNoticeSource.status, 422);
  assert.equal((noNoticeSource.json as { code?: string } | null)?.code, 'notice_version_unavailable');
  const rolledBack = new Client({ connectionString: databaseUrl });
  await rolledBack.connect();
  try {
    const orphan = await rolledBack.query("SELECT id FROM organizations WHERE name = $1", [payload.name]);
    assert.deepEqual(orphan.rows, [], 'penolakan tidak boleh meninggalkan organisasi tanpa notice');
  } finally {
    await rolledBack.end();
  }

  const created = await call('/admin/organizations', { method: 'POST', cookie: admin, body: payload });
  assert.equal(created.status, 201, created.text);
  const result = data<{
    organization: Record<string, unknown> & { id: string; name: string; organization_type: string };
    account: { id: string; role: string; status: string; organization_id: string | null; email: string };
  }>(created);
  assert.equal(result.organization.name, payload.name);
  assert.equal(result.organization.organization_type, 'school');
  // Kebutuhan bukti persetujuan milik survei, bukan profil organisasi: kolom profil itu sudah tidak ada.
  assert.equal('consent_mode' in result.organization, false);
  assert.equal(result.account.role, 'org_admin');
  assert.equal(result.account.status, 'active');
  assert.equal(result.account.organization_id, result.organization.id);
  assert.equal(result.account.email, email);

  const bootstrap = data<{
    accounts: Array<{ id: string; role: string; organization_id: string | null }>;
    organizations: Array<{ id: string; name: string }>;
  }>(await call('/bootstrap', { cookie: admin }));
  assert.ok(bootstrap.organizations.some((organization) => organization.id === result.organization.id));
  assert.equal(bootstrap.accounts.find((row) => row.id === result.account.id)?.role, 'org_admin');

  const fresh = await login(email, 'SvaraBaru123!x');
  const profile = data<{ source: string; profile: { organization_name: string } }>(
    await call('/org/profile', { cookie: fresh }),
  );
  assert.equal(profile.source, 'organization');
  assert.equal(profile.profile.organization_name, payload.name);

  const stored = new Client({ connectionString: databaseUrl });
  await stored.connect();
  try {
    const audit = await stored.query("SELECT metadata FROM audit_logs WHERE object = $1 ORDER BY at DESC LIMIT 1", [
      result.organization.id,
    ]);
    const metadata = JSON.parse(String(audit.rows[0]?.metadata ?? '{}')) as { admin_account_id?: string };
    assert.equal(metadata.admin_account_id, result.account.id);

    // Notice legacy dari profil pilihan ikut terprovision; provisioning ulang tidak menggandakan baris.
    const notices = await stored.query<{ version: string }>(
      'SELECT version FROM organization_notices WHERE organization_id = $1',
      [result.organization.id],
    );
    assert.deepEqual(notices.rows, [{ version: '1.0' }]);
    assert.equal(await provisionOrganizationNotice(result.organization.id, payload.notice_profile_name), 0);
    const again = await stored.query<{ count: number }>(
      'SELECT COUNT(*) AS count FROM organization_notices WHERE organization_id = $1',
      [result.organization.id],
    );
    assert.equal(again.rows[0]?.count, notices.rows.length);

    // End-to-end: creator milik organisasi baru menerbitkan survei, lalu pengantar publiknya harus 200
    // dengan notice yang baru diprovision (bukan notice_version_unavailable).
    const creatorEmail = 'creator.baru@svara.local';
    await stored.query(
      `INSERT INTO accounts (id, email, display_name, role, status, password_hash, created_at, organization_id)
       VALUES ('u_orgbaru_creator', $1, 'Kreator Baru', 'creator', 'active', $2, $3, $4)`,
      [creatorEmail, await hashPassword('SvaraDemo123!'), new Date().toISOString(), result.organization.id],
    );
    const creatorCookie = await login(creatorEmail);
    const ownSurvey = data<{ survey: { id: string } }>(await call('/surveys', {
      method: 'POST', cookie: creatorCookie, body: { title: 'Survei organisasi baru', owner_scope: 'organization' },
    }));
    const saved = await call(`/surveys/${ownSurvey.survey.id}`, {
      method: 'PUT', cookie: creatorCookie, body: {
        title: 'Survei organisasi baru',
        purpose: 'Menguji notice organisasi yang baru dibuat.',
        object_label: 'Peserta',
        instructions: '',
        questions: [{ code: 'Q1', type: 'short_text', required: true, section: 'Uji', label: 'Tanggapan' }],
      },
    });
    assert.equal(saved.status, 200, saved.text);
    const published = await call(`/surveys/${ownSurvey.survey.id}/publish`, { method: 'POST', cookie: creatorCookie });
    assert.equal(published.status, 200, published.text);
    const linkToken = data<{ publicLink: { token: string } }>(published).publicLink.token;
    const publicIntro = await call(`/public/surveys/${linkToken}`);
    assert.equal(publicIntro.status, 200, publicIntro.text);
    assert.equal(data<{ notice: { version: string } }>(publicIntro).notice.version, '1.0');
    await stored.query('UPDATE accounts SET status = $1 WHERE email = $2', ['suspended', creatorEmail]);
  } finally {
    try {
      // audit_logs menahan akun lewat account_id (login/admin), jadi bersihkan barisnya dulu.
      await stored.query('DELETE FROM audit_logs WHERE object = $1 OR object = $2 OR account_id = $2', [
        result.organization.id,
        result.account.id,
      ]);
      await stored.query(
        'DELETE FROM audit_logs WHERE account_id IN (SELECT id FROM accounts WHERE organization_id = $1)',
        [result.organization.id],
      );
      // Baris turunan survei organisasi uji (dibuat end-to-end di atas) harus pergi sebelum organisasi.
      const orgSurveys = 'SELECT id FROM surveys WHERE organization_id = $1';
      await stored.query(`DELETE FROM public_links WHERE survey_id IN (${orgSurveys})`, [result.organization.id]);
      await stored.query(
        `DELETE FROM question_options WHERE question_id IN (SELECT id FROM questions WHERE version_id IN (SELECT id FROM survey_versions WHERE survey_id IN (${orgSurveys})))`,
        [result.organization.id],
      );
      await stored.query(
        `DELETE FROM questions WHERE version_id IN (SELECT id FROM survey_versions WHERE survey_id IN (${orgSurveys}))`,
        [result.organization.id],
      );
      await stored.query(`DELETE FROM survey_versions WHERE survey_id IN (${orgSurveys})`, [result.organization.id]);
      await stored.query(`DELETE FROM survey_settings WHERE survey_id IN (${orgSurveys})`, [result.organization.id]);
      await stored.query('DELETE FROM surveys WHERE organization_id = $1', [result.organization.id]);
      await stored.query('DELETE FROM organization_notices WHERE organization_id = $1', [result.organization.id]);
      await stored.query('DELETE FROM accounts WHERE organization_id = $1', [result.organization.id]);
    } finally {
      await stored.end();
    }
  }
});

test('Postgres: statistik admin mengagregasi kreator dan survei', async () => {
  const admin = await session('admin@svara.local');
  const stats = data<{
    perCreator: Array<{ id: string; surveys: number; responses: number }>;
    perSurvey: Array<{ id: string; title: string; owner: string; versions: number; responses: number }>;
  }>(await call('/admin/stats', { cookie: admin }));
  assert.ok(stats.perCreator.length >= 1);
  assert.ok(stats.perSurvey.length >= 1);
  assert.ok(stats.perSurvey.every((row) => typeof row.owner === 'string'));
});

test('SEC-12: token integrasi tanpa cakupan ditolak', async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const tokenHash = createHash('sha256').update(INTEGRATION_TOKEN).digest('hex');
    await client.query('DELETE FROM integration_token_scopes WHERE token_hash = $1', [tokenHash]);
  } finally {
    await client.end();
  }

  const unscoped = await call('/integration/survey-data?survey_id=s_demo1&version=1', {
    auth: `Bearer ${INTEGRATION_TOKEN}`,
  });
  assert.equal(unscoped.status, 403, unscoped.text);
});

async function assignIntegrationTokenToOrganizationA(): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const tokenHash = createHash('sha256').update(INTEGRATION_TOKEN).digest('hex');
    await client.query(
      `INSERT INTO integration_token_scopes (token_hash, organization_id, survey_id)
       VALUES ($1, 'org_smk', NULL)
       ON CONFLICT (token_hash) DO UPDATE SET organization_id = EXCLUDED.organization_id, survey_id = NULL`,
      [tokenHash],
    );
    await client.query(
      `INSERT INTO survey_versions (id, survey_id, number, status, notice_version, published_at)
       VALUES ('v_sec12_org_b_published', 's_demo3', 1, 'published', '1.0', '2026-11-21T00:00:00Z')
       ON CONFLICT (id) DO NOTHING`,
    );
  } finally {
    await client.end();
  }
}

test('SEC-12: token organisasi A menolak survei organisasi B', async () => {
  await assignIntegrationTokenToOrganizationA();
  const crossOrganization = await call('/integration/survey-data?survey_id=s_demo3&version=v_sec12_org_b_published', {
    auth: `Bearer ${INTEGRATION_TOKEN}`,
  });
  assert.equal(crossOrganization.status, 404, crossOrganization.text);
});

test('SEC-12: token menolak versi draf tetapi tetap membaca versi terbit dalam cakupannya', async () => {
  await assignIntegrationTokenToOrganizationA();
  const draft = await call('/integration/survey-data?survey_id=s_demo1&version=v_demo1_2', {
    auth: `Bearer ${INTEGRATION_TOKEN}`,
  });
  assert.equal(draft.status, 404, draft.text);

  const published = await call('/integration/survey-data?survey_id=s_demo1&version=v_demo1_1', {
    auth: `Bearer ${INTEGRATION_TOKEN}`,
  });
  assert.equal(published.status, 200, published.text);
  assert.equal(published.json?.survey_version, 1);
});


test('AC14: event integrasi, retry tanpa status palsu, dan API layanan terbatas', async () => {
  const admin = await session('admin@svara.local');
  const events = data<Array<{ event_id: string; status: string; response_id: string | null }>>(
    await call('/admin/integration', { cookie: admin }),
  );
  const failed = events.find((event) => event.event_id === 'ev_demo03');
  assert.ok(failed);
  const retryFailed = await call(`/admin/integration/${failed.event_id}/retry`, { method: 'POST', cookie: admin });
  assert.equal(retryFailed.status, 409);
  const afterRetry = data<Array<{ event_id: string; status: string; attempts: number }>>(
    await call('/admin/integration', { cookie: admin }),
  );
  const stillFailed = afterRetry.find((event) => event.event_id === 'ev_demo03');
  assert.equal(stillFailed?.status, 'failed');
  assert.ok((stillFailed?.attempts ?? 0) > 0);

  const retryDelivered = await call('/admin/integration/ev_demo02/retry', { method: 'POST', cookie: admin });
  assert.equal(retryDelivered.status, 200);
  assert.equal((retryDelivered.json as { data: { status: string } }).data.status, 'delivered');

  const unauthorized = await call('/integration/survey-data?survey_id=s_demo1');
  assert.equal(unauthorized.status, 401);
  const scoped = await call('/integration/survey-data?survey_id=s_demo1&version=1&limit=2&offset=0', {
    auth: `Bearer ${INTEGRATION_TOKEN}`,
  });
  assert.equal(scoped.status, 200, scoped.text);
  const scopedData = scoped.json as {
    simulated: boolean;
    pagination: { total: number; limit: number };
    columns: string[];
    data: Array<{ answers: Array<{ question_code: string }> }>;
  };
  assert.equal(scopedData.simulated, true);
  assert.equal(scopedData.pagination.limit, 2);
  assert.ok(scopedData.data.length <= 2);
  assert.ok(!scopedData.columns.includes('text'));
  assert.ok(!JSON.stringify(scopedData.data).includes('Perlu panduan singkat.'));

  const byVersionId = await call('/integration/survey-data?survey_id=s_demo1&version=v_demo1_1&limit=1', {
    auth: `Bearer ${INTEGRATION_TOKEN}`,
  });
  assert.equal(byVersionId.status, 200, byVersionId.text);
  const byVersionJson = byVersionId.json;
  assert.ok(byVersionJson && typeof byVersionJson.survey_version === 'number');
  assert.equal(byVersionJson.survey_version, 1);

  const audit = data<Array<{ action: string; actor: string }>>(await call('/admin/audit', { cookie: admin }));
  assert.ok(audit.some((log) => log.actor === 'layanan-15'));
});

test('Retry identik setelah publish berikutnya tetap mengembalikan bukti yang sama', async () => {
  const creator = await session('creator.a@svara.local');
  const title = 'Survei retry setelah publish';
  const { survey } = data<{ survey: { id: string } }>(await call('/surveys', {
    method: 'POST', cookie: creator, body: { title, owner_scope: 'organization' },
  }));
  const surveyPath = `/surveys/${survey.id}`;
  // PERHATIAN fixture: profil org_smk mewajibkan wali, jadi setiap consent di bawah wajib membawa
  // guardian_evidence_ref. Tanpa itu baseline gagal 422 di setup, bukan di assertion retry.
  const save = async (questionCodes: string[]) => {
    const saved = await call(surveyPath, {
      method: 'PUT', cookie: creator, body: {
        title,
        purpose: 'Menguji retry idempoten setelah versi baru terbit.',
        object_label: 'Peserta',
        instructions: '',
        questions: questionCodes.map((code) => ({
          code, type: 'short_text', required: true, section: 'Uji', label: `Tanggapan ${code}`,
        })),
      },
    });
    assert.equal(saved.status, 200, saved.text);
    const published = await call(`${surveyPath}/publish`, { method: 'POST', cookie: creator });
    assert.equal(published.status, 200, published.text);
    return data<{ version: { id: string }; publicLink: { token: string } }>(published);
  };

  const v1 = await save(['Q1']);
  const token = v1.publicLink.token;
  const intro = data<{ consent_version: string }>(await call(`/public/surveys/${token}`));
  const consent = await call(`/public/surveys/${token}/consent`, {
    method: 'POST',
    body: {
      version_id: intro.consent_version,
      respondent_click: true,
      eligibility: true,
      guardian_evidence_ref: 'ref-wali-retry',
    },
  });
  assert.equal(consent.status, 201, consent.text);
  const consentId = data<{ consent_id: string }>(consent).consent_id;
  const respondent = consentCookie(consent);
  const key = 'retry-identik-publish-0001';
  const body = { consent_id: consentId, answers: [{ question_code: 'Q1', text: 'Jawaban tetap' }] };
  const first = await call(`/public/surveys/${token}/responses`, {
    method: 'POST', cookie: respondent, idempotencyKey: key, body,
  });
  assert.equal(first.status, 201, first.text);
  const receipt = data(first);

  const v2 = await save(['Q1', 'Q2']);
  assert.notEqual(v2.version.id, v1.version.id);

  const retry = await call(`/public/surveys/${token}/responses`, {
    method: 'POST', cookie: respondent, idempotencyKey: key, body,
  });
  assert.equal(retry.status, 200, retry.text);
  assert.deepEqual(data(retry), receipt, 'retry identik mengembalikan bukti yang sama');
  assert.equal(data<{ version_number: number }>(retry).version_number, 1, 'bukti tetap milik versi attempt');

  // Review historis untuk sesi pemilik attempt harus tetap terbuka (retryOnly), bukan ditolak.
  const review = await call(`/public/surveys/${token}/review?consent_id=${consentId}`, { cookie: respondent });
  assert.equal(review.status, 200, review.text);
  assert.equal(data<{ retryOnly?: boolean }>(review).retryOnly, true);

  // Sesi lain tidak boleh membuka review attempt orang lain.
  const otherSession = await call(`/public/surveys/${token}/consent`, {
    method: 'POST',
    body: {
      version_id: data<{ consent_version: string }>(await call(`/public/surveys/${token}`)).consent_version,
      respondent_click: true,
      eligibility: true,
      guardian_evidence_ref: 'ref-wali-sesi-lain',
    },
  });
  assert.equal(otherSession.status, 201, otherSession.text);
  const foreignReview = await call(`/public/surveys/${token}/review?consent_id=${consentId}`, {
    cookie: consentCookie(otherSession),
  });
  assert.equal(foreignReview.status, 409, foreignReview.text);
  assert.equal(foreignReview.json?.code, 'consent_context_mismatch');
});

test('AC13: 30 kiriman paralel pada satu tautan umum masing-masing menghasilkan satu respons', async () => {
  const token = 'pl_demoTautanPrps01';
  const { consent_version: consentVersion } = data<{ consent_version: string }>(await call(`/public/surveys/${token}`));
  const consents = await Promise.all(
    Array.from({ length: 30 }, () =>
      call(`/public/surveys/${token}/consent`, {
        method: 'POST',
        body: { version_id: consentVersion, respondent_click: true, eligibility: true, guardian_evidence_ref: 'ref-wali-beban' },
      }),
    ),
  );
  consents.forEach((consent) => assert.equal(consent.status, 201, consent.text));
  const responses = await Promise.all(
    consents.map((consent, index) => {
      const consentId = (consent.json as { data: { consent_id: string } }).data.consent_id;
      return call(`/public/surveys/${token}/responses`, {
        method: 'POST',
        cookie: consentCookie(consent),
        idempotencyKey: `beban-kunci-${index}-abcdef`,
        body: {
          consent_id: consentId,
          answers: [
            { question_code: 'P01', option_id: 'q_p01_opt3' },
            { question_code: 'P02', option_id: 'q_p02_opt2' },
          ],
        },
      });
    }),
  );
  const statuses = responses.map((result) => result.status);
  assert.deepEqual(statuses, Array.from({ length: 30 }, () => 201));
  const ids = new Set(
    responses.map((result) => (result.json as { data: { response_id: string } }).data.response_id),
  );
  assert.equal(ids.size, 30, 'tidak ada respons tergabung atau hilang');

  const summary = data<{ total: number }>(
    await call('/surveys/s_demo2/summary?version=v_demo2_1', { cookie: await session('creator.a@svara.local') }),
  );
  assert.ok(summary.total >= 30);
});

test('Permintaan data publik dapat ditindaklanjuti admin tanpa memuat jawaban', async () => {
  const created = await call('/data-requests', {
    method: 'POST',
    body: { type: 'access', contact: 'pemohon@contoh.test', note: 'Minta salinan data saya.' },
  });
  assert.equal(created.status, 201);
  const id = (created.json as { data: { id: string } }).data.id;
  const admin = await session('admin@svara.local');
  const withoutEvidence = await call(`/admin/data-requests/${id}`, {
    method: 'PATCH',
    cookie: admin,
    body: { status: 'handled', outcome_note: 'Sudah diverifikasi.' },
  });
  assert.equal(withoutEvidence.status, 422);
  assert.equal((withoutEvidence.json as { code?: string }).code, 'response_evidence_required');
  const patched = await call(`/admin/data-requests/${id}`, {
    method: 'PATCH',
    cookie: admin,
    body: { status: 'handled', outcome_note: 'Sudah diverifikasi.', response_channel: 'email' },
  });
  assert.equal(patched.status, 200);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const stored = await client.query<{ responded_at: string | null; responded_by: string | null; response_channel: string | null }>(
      'SELECT responded_at, responded_by, response_channel FROM data_requests WHERE id = $1',
      [id],
    );
    assert.ok(stored.rows[0]?.responded_at, 'responded_at harus terekam');
    assert.ok(stored.rows[0]?.responded_by, 'responded_by harus terekam');
    assert.equal(stored.rows[0]?.response_channel, 'email');
  } finally {
    await client.end();
  }
});

test('NEW-01: job retensi menganonimkan permintaan data >365 hari dan idempoten', async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    for (const [id, days] of [['dr_test_old', 400], ['dr_test_new', 100]] as const) {
      const createdAt = new Date(Date.now() - days * 86_400_000).toISOString();
      await client.query(
        `INSERT INTO data_requests (id, type, contact, note, status, created_at, updated_at)
         VALUES ($1, 'access', 'pemohon@contoh.test', 'Catatan identitas', 'pending', $2, $2)`,
        [id, createdAt],
      );
    }
    const first = await anonymizeExpiredDataRequests();
    assert.ok(first.anonymized >= 1);
    const rows = await client.query<{ id: string; contact: string; note: string | null; status: string; type: string; anonymized_at: string | null }>(
      'SELECT id, contact, note, status, type, anonymized_at FROM data_requests WHERE id = ANY($1) ORDER BY id',
      [['dr_test_old', 'dr_test_new']],
    );
    const [fresh, expired] = rows.rows;
    assert.match(expired!.contact, /^anon:[0-9a-f]{16}$/);
    assert.equal(expired!.note, null);
    assert.ok(expired!.anonymized_at, 'anonymized_at harus terisi');
    assert.equal(expired!.type, 'access');
    assert.equal(expired!.status, 'pending');
    assert.equal(fresh!.contact, 'pemohon@contoh.test');
    assert.equal(fresh!.note, 'Catatan identitas');
    assert.equal(fresh!.anonymized_at, null);
    const second = await anonymizeExpiredDataRequests();
    assert.equal(second.anonymized, 0);
    assert.equal(retentionDays('365'), 365);
    assert.equal(retentionDays(''), 365);
    assert.throws(() => retentionDays('abc'), /DATA_REQUEST_RETENTION_DAYS tidak valid/);
    assert.throws(() => retentionDays('0'), /DATA_REQUEST_RETENTION_DAYS tidak valid/);
  } finally {
    await client.end();
  }
});

test('Registrasi publik membuat creator baru dan langsung memberi sesi', async () => {
  const email = 'creator.baru@contoh.test';
  const password = 'SandiBaru123!';

  const weak = await call('/auth/register', {
    method: 'POST',
    body: { name: 'Creator Baru', email, password: 'pendek', acceptTerms: true },
  });
  assert.equal(weak.status, 422);
  assert.equal((weak.json as { code?: string }).code, 'weak_password');

  const withoutTerms = await call('/auth/register', {
    method: 'POST',
    body: { name: 'Creator Baru', email, password, acceptTerms: false },
  });
  assert.equal(withoutTerms.status, 422);
  assert.equal((withoutTerms.json as { code?: string }).code, 'terms_required');

  const created = await call('/auth/register', {
    method: 'POST',
    body: { name: 'Creator Baru', email, password, acceptTerms: true },
  });
  assert.equal(created.status, 201, created.text);
  const rawCookie = created.headers.get('set-cookie') ?? '';
  assert.ok(rawCookie.startsWith('svara_session='), 'registrasi harus memasang cookie sesi');
  const cookie = rawCookie.split(';')[0]!;
  const account = (created.json as {
    data: { account: { id: string; email: string; role: string; status: string } };
  }).data.account;
  assert.equal(account.email, email);
  assert.equal(account.role, 'creator');
  assert.equal(account.status, 'active');

  const stored = new Client({ connectionString: databaseUrl });
  await stored.connect();
  try {
    const row = await stored.query<{ consent_version: string | null; consent_accepted_at: string | null }>(
      'SELECT consent_version, consent_accepted_at FROM accounts WHERE id = $1',
      [account.id],
    );
    assert.equal(row.rows[0]?.consent_version, '2026-11-19');
    assert.ok(row.rows[0]?.consent_accepted_at, 'timestamp persetujuan harus tersimpan');
    const audit = await stored.query<{ metadata: string | null }>(
      "SELECT metadata FROM audit_logs WHERE actor = $1 AND action = 'Registrasi'",
      [account.id],
    );
    const metadata = JSON.parse(audit.rows[0]?.metadata ?? '{}') as {
      consentVersion?: string;
      acceptedAt?: string;
    };
    assert.equal(metadata.consentVersion, '2026-11-19');
    assert.equal(metadata.acceptedAt, row.rows[0]?.consent_accepted_at);
  } finally {
    await stored.end();
  }

  const bootstrap = data<{ account: { email: string }; surveys: unknown[]; accounts: unknown[] }>(
    await call('/bootstrap', { cookie }),
  );
  assert.equal(bootstrap.account.email, email);
  assert.deepEqual(bootstrap.surveys, []);
  assert.deepEqual(bootstrap.accounts, []);

  const duplicate = await call('/auth/register', {
    method: 'POST',
    body: { name: 'Creator Lain', email, password, acceptTerms: true },
  });
  assert.equal(duplicate.status, 409);
  assert.equal((duplicate.json as { code?: string }).code, 'email_taken');

  const login = await call('/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(login.status, 200, login.text);
});

test('PUT /admin/grants hanya mengganti izin akun yang disebut pada payload', async () => {
  const admin = await session('admin@svara.local');
  const grantsOf = async (accountId: string) => {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const result = await client.query<{ survey_id: string | null; can_export: number }>(
        'SELECT survey_id, can_export FROM access_grants WHERE account_id = $1 ORDER BY survey_id NULLS FIRST',
        [accountId],
      );
      return result.rows;
    } finally {
      await client.end();
    }
  };

  const officerBefore = await grantsOf('u_petugas');
  const creatorBefore = await grantsOf('u_creator_a');
  assert.ok(officerBefore.length > 0, 'seed harus memberi izin pada u_petugas');

  const updated = await call('/admin/grants', {
    method: 'PUT',
    cookie: admin,
    body: { grants: [{ account_id: 'u_creator_a', survey_id: 's_demo3', can_export: true, purpose: 'Tinjauan ekspor' }] },
  });
  assert.equal(updated.status, 200, updated.text);

  assert.deepEqual(await grantsOf('u_petugas'), officerBefore, 'izin u_petugas tidak boleh terhapus');
  assert.deepEqual(await grantsOf('u_creator_a'), [{ survey_id: 's_demo3', can_export: 1 }]);

  await call('/admin/grants', {
    method: 'PUT',
    cookie: admin,
    body: {
      grants: creatorBefore.map((grant) => ({
        account_id: 'u_creator_a',
        survey_id: grant.survey_id,
        can_export: grant.can_export === 1,
      })),
    },
  });

  const unknown = await call('/admin/grants', {
    method: 'PUT',
    cookie: admin,
    body: { grants: [{ account_id: 'u_tidak_ada', survey_id: 's_demo1', can_export: true }] },
  });
  assert.equal(unknown.status, 422);
  assert.deepEqual(await grantsOf('u_petugas'), officerBefore, 'payload ditolak tidak boleh menghapus izin');
});

test('Lingkup organisasi: pemilik, org_admin, dan isolasi antar organisasi', async () => {
  const orgAdmin = await session('orgadmin@svara.local');
  const otherOrgAdmin = await session('creator.b@svara.local');

  const accounts = data<{ accounts: Array<{ id: string; role: string }> }>(
    await call('/admin/accounts', { cookie: await session('admin@svara.local') }),
  );
  assert.equal(accounts.accounts.find((row) => row.id === 'u_orgadmin')?.role, 'org_admin');

  // Pemilik membaca penuh tanpa grant, termasuk teks bebas.
  const ownerResponses = data<Array<{ answers: Array<{ question_code: string; text: string | null }> }>>(
    await call('/surveys/s_demo1/responses?version=v_demo1_1', { cookie: await session('creator.a@svara.local') }),
  );
  assert.ok(ownerResponses.length >= 5);
  assert.ok(
    ownerResponses.some((response) =>
      response.answers.some((answer) => answer.question_code === 'K02' && answer.text !== null),
    ),
    'pemilik membaca teks bebas tanpa grant',
  );
  const ownerCsv = await call('/surveys/s_demo1/export?version=v_demo1_1&format=csv&recipient=Uji%20KP-03&purpose=Uji%20ekspor', {
    cookie: await session('creator.a@svara.local'),
  });
  assert.equal(ownerCsv.status, 200);
  assert.ok(ownerCsv.text.includes('Perlu panduan singkat.'), 'ekspor pemilik menyertakan teks bebas');

  // org_admin organisasi sama: detail, pengaturan, jawaban individual, ekspor.
  const adminDetail = await call('/surveys/s_demo1', { cookie: orgAdmin });
  assert.equal(adminDetail.status, 200, adminDetail.text);
  const adminSettings = await call('/surveys/s_demo1/settings', { cookie: orgAdmin });
  assert.equal(adminSettings.status, 200);
  const adminResponses = await call('/surveys/s_demo1/responses?version=v_demo1_1', { cookie: orgAdmin });
  assert.equal(adminResponses.status, 200, adminResponses.text);
  assert.ok(adminResponses.text.includes('Perlu panduan singkat.'), 'org_admin membaca teks bebas survei organisasinya');
  const adminExport = await call('/surveys/s_demo1/export?version=v_demo1_1&format=csv&recipient=Uji%20KP-03&purpose=Uji%20ekspor', { cookie: orgAdmin });
  assert.equal(adminExport.status, 200);

  // Organisasi lain (org_perpus via creator.b), creator org_smk lain tanpa grant, akun tanpa organisasi.
  // Tidak ada akun seed bersih di org_smk tanpa grant, jadi baris uji dibuat di sini.
  const outsiderEmail = 'luar.org@contoh.test';
  const registered = await call('/auth/register', {
    method: 'POST',
    body: { name: 'Creator Luar Org', email: outsiderEmail, password: 'SandiOrg123!', acceptTerms: true },
  });
  assert.equal(registered.status, 201, registered.text);
  const outsiderCookie = (registered.headers.get('set-cookie') ?? '').split(';')[0]!;
  const outsider = new Client({ connectionString: databaseUrl });
  await outsider.connect();
  try {
    await outsider.query("UPDATE accounts SET organization_id = 'org_smk' WHERE email = $1", [outsiderEmail]);
  } finally {
    await outsider.end();
  }
  for (const [label, cookie] of [
    ['org_perpus', otherOrgAdmin],
    ['creator org_smk tanpa grant', outsiderCookie],

  ] as const) {
    for (const [method, path, body] of [
      ['GET', '/surveys/s_demo1', undefined],
      ['PUT', '/surveys/s_demo1/settings', { allowResults: true, allowIndividual: true }],
      ['GET', '/surveys/s_demo1/responses?version=v_demo1_1', undefined],
      ['GET', '/surveys/s_demo1/export?version=v_demo1_1&format=csv&recipient=Uji%20KP-03&purpose=Uji%20ekspor', undefined],
    ] as const) {
      const denied = await call(path, { method, cookie, body });
      assert.equal(denied.status, 403, `${label}: ${method} ${path} harus 403`);
    }
  }

  // super_admin tidak otomatis membaca jawaban individual.
  const superAdmin = await session('admin@svara.local');
  const superResponses = await call('/surveys/s_demo1/responses?version=v_demo1_1', { cookie: superAdmin });
  assert.equal(superResponses.status, 403, 'super_admin tanpa grant tetap ditolak');

  // Audit: baris pemilik dan org_admin menyimpan account_id serta organization_id.
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const rows = await client.query<{ actor: string; account_id: string | null; organization_id: string | null }>(
      `SELECT actor, account_id, organization_id FROM audit_logs
        WHERE action = 'Baca jawaban individual' AND outcome = 'berhasil'`,
    );
    const byActor = new Map(rows.rows.map((row) => [row.actor, row]));
    for (const actor of ['u_creator_a', 'u_orgadmin']) {
      const row = byActor.get(actor);
      assert.ok(row, `audit baca individual untuk ${actor} harus tercatat`);
      assert.equal(row.account_id, actor);
      assert.equal(row.organization_id, 'org_smk');
    }
    const exports = await client.query<{ organization_id: string | null }>(
      "SELECT organization_id FROM audit_logs WHERE action = 'Ekspor CSV' AND actor = 'u_orgadmin'",
    );
    assert.equal(exports.rows[0]?.organization_id, 'org_smk', 'audit ekspor org_admin membawa organisasi');
    const denied = await client.query<{ organization_id: string | null }>(
      "SELECT organization_id FROM audit_logs WHERE action = 'Baca jawaban individual' AND outcome = 'ditolak' AND actor = 'u_admin'",
    );
    assert.equal(denied.rows.at(-1)?.organization_id, null, 'super_admin tanpa organisasi menulis organization_id NULL');
  } finally {
    await client.end();
  }
});

test('GET/PUT /org/profile menghormati lingkup organisasi; mode persetujuan bukan milik profil', async () => {
  const orgAdmin = await session('orgadmin@svara.local');

  const own = data<{ source: string; profile: Record<string, unknown> & { id: string } }>(
    await call('/org/profile', { cookie: orgAdmin }),
  );
  assert.equal(own.source, 'organization');
  assert.equal(own.profile.id, 'org_smk');
  // Profil organisasi hanya memuat kebijakan; kebutuhan bukti persetujuan hidup pada survei.
  assert.equal('consent_mode' in own.profile, false, 'profil tidak membawa mode persetujuan');
  assert.equal('respondent_age_category' in own.profile, false, 'profil tidak membawa kategori usia');

  const othersProfile = data<{ source: string; profile: { id: string } }>(
    await call('/org/profile', { cookie: await session('creator.a@svara.local') }),
  );
  assert.equal(othersProfile.profile.id, 'org_smk', 'creator membaca profil organisasinya');

  // PUT biasa tetap mengembalikan profil tanpa kedua kolom warisan.
  const saved = await call('/org/profile', {
    method: 'PUT',
    cookie: orgAdmin,
    body: { data_request_contact: 'privasi@smk.local' },
  });
  assert.equal(saved.status, 200, saved.text);
  const savedProfile = (saved.json as { data: { profile: Record<string, unknown> } }).data.profile;
  assert.equal('consent_mode' in savedProfile, false);
  assert.equal('respondent_age_category' in savedProfile, false);

  // Tipe organisasi adalah daftar tertutup: nilai bebas ditolak, tipe baru yang terdaftar diterima.
  const badType = await call('/org/profile', {
    method: 'PUT',
    cookie: orgAdmin,
    body: { organization_type: 'sekolah' },
  });
  assert.equal(badType.status, 422, 'tipe di luar daftar ditolak');
  const badTypeBody = badType.json as { code?: string } | null;
  assert.equal(badTypeBody?.code, 'validation_error');
  const newType = await call('/org/profile', {
    method: 'PUT',
    cookie: orgAdmin,
    body: { organization_type: 'company' },
  });
  assert.equal(newType.status, 200, newType.text);
  const newTypeProfile = (newType.json as { data: { profile: { organization_type: string } } }).data.profile;
  assert.equal(newTypeProfile.organization_type, 'company');
  const restoredType = await call('/org/profile', {
    method: 'PUT',
    cookie: orgAdmin,
    body: { organization_type: 'school' },
  });
  assert.equal(restoredType.status, 200, restoredType.text);

  // BF-06: memperpendek retention_days menghapus data pada run retensi berikutnya -> wajib konfirmasi.
  await call('/org/profile', { method: 'PUT', cookie: orgAdmin, body: { retention_days: 365 } });
  const shrink = await call('/org/profile', {
    method: 'PUT',
    cookie: orgAdmin,
    body: { retention_days: 30 },
  });
  assert.equal(shrink.status, 409);
  assert.equal((shrink.json as { code?: string }).code, 'retention_shrink_confirmation_required');
  const confirmed = await call('/org/profile', {
    method: 'PUT',
    cookie: orgAdmin,
    body: { retention_days: 30, confirm_retention_shrink: true },
  });
  assert.equal(confirmed.status, 200, 'konfirmasi eksplisit diterima');
  const lengthen = await call('/org/profile', {
    method: 'PUT',
    cookie: orgAdmin,
    body: { retention_days: 90 },
  });
  assert.equal(lengthen.status, 200, 'memperpanjang tidak perlu konfirmasi');
  const updated = await call('/org/profile', {
    method: 'PUT',
    cookie: orgAdmin,
    body: { data_request_contact: 'privasi.smk@contoh.test', retention_days: 180 },
  });
  assert.equal(updated.status, 200, updated.text);
  const updatedProfile = (updated.json as { data: { profile: { id: string; data_request_contact: string; retention_days: number } } })
    .data.profile;
  assert.equal(updatedProfile.id, 'org_smk');
  assert.equal(updatedProfile.data_request_contact, 'privasi.smk@contoh.test');
  assert.equal(updatedProfile.retention_days, 180);

  const outsider = await call('/org/profile', {
    method: 'PUT',
    cookie: await session('creator.a@svara.local'),
    body: { organization_name: 'Penyusup' },
  });
  assert.equal(outsider.status, 403, 'creator tidak boleh mengubah profil organisasi');

  const superAdmin = await session('admin@svara.local');
  const platform = data<{ source: string; profile: { id: string } }>(
    await call('/org/profile', { cookie: superAdmin }),
  );
  assert.equal(platform.source, 'platform', 'akun tanpa organisasi mendapat platform_profile');
  assert.equal(platform.profile.id, 'platform');
  const platformPut = await call('/org/profile', {
    method: 'PUT',
    cookie: superAdmin,
    body: { organization_name: 'Bukan' },
  });
  assert.equal(platformPut.status, 403);
});

test('Super admin mengubah profil platform tanpa menyentuh profil organisasi', async () => {
  const admin = await session('admin@svara.local');

  const creatorRead = await call('/admin/platform-profile', { cookie: await session('creator.a@svara.local') });
  assert.equal(creatorRead.status, 403, 'creator tidak boleh membaca profil platform admin');
  const orgAdminWrite = await call('/admin/platform-profile', {
    method: 'PUT',
    cookie: await session('orgadmin@svara.local'),
    body: { organization_name: 'Penyusup' },
  });
  assert.equal(orgAdminWrite.status, 403, 'org_admin tidak boleh mengubah profil platform');

  const read = await call('/admin/platform-profile', { cookie: admin });
  assert.equal(read.status, 200, read.text);
  const before = data<{
    profile: {
      id: string;
      organization_name: string;
      organization_type: string;
      policy_url: string;
      terms_url: string;
      retention_days: number | null;
      data_request_contact: string | null;
      cross_border_transfer: number | null;
      notice_version: string;
    };
  }>(read).profile;
  assert.equal(before.id, 'platform');

  const emptyName = await call('/admin/platform-profile', {
    method: 'PUT',
    cookie: admin,
    body: { organization_name: '   ' },
  });
  assert.equal(emptyName.status, 422);
  const negativeRetention = await call('/admin/platform-profile', {
    method: 'PUT',
    cookie: admin,
    body: { retention_days: -1 },
  });
  assert.equal(negativeRetention.status, 422);
  const wrongCrossBorder = await call('/admin/platform-profile', {
    method: 'PUT',
    cookie: admin,
    body: { cross_border_transfer: 'ya' },
  });
  assert.equal(wrongCrossBorder.status, 422);
  const nullCrossBorder = await call('/admin/platform-profile', {
    method: 'PUT',
    cookie: admin,
    body: { cross_border_transfer: null },
  });
  assert.equal(nullCrossBorder.status, 422, 'null "belum diputuskan" tidak dapat dipilih lewat API');

  const updated = await call('/admin/platform-profile', {
    method: 'PUT',
    cookie: admin,
    body: {
      organization_name: 'Svara Uji Platform',
      organization_type: 'organization',
      retention_days: 90,
      data_request_contact: 'dpo@uji.test',
      cross_border_transfer: true,
    },
  });
  assert.equal(updated.status, 200, updated.text);
  const changed = data<{
    profile: {
      organization_name: string;
      organization_type: string;
      retention_days: number;
      data_request_contact: string;
      cross_border_transfer: number;
      notice_version: string;
      policy_url: string;
      terms_url: string;
    };
  }>(updated).profile;
  assert.equal(changed.organization_name, 'Svara Uji Platform');
  assert.equal(changed.organization_type, 'organization');
  assert.equal(changed.retention_days, 90);
  assert.equal(changed.data_request_contact, 'dpo@uji.test');
  assert.equal(changed.cross_border_transfer, 1);
  assert.equal(changed.notice_version, before.notice_version, 'notice_version tidak ikut berubah');

  const platformAsAdmin = data<{ source: string; profile: { organization_name: string; policy_url: string } }>(
    await call('/org/profile', { cookie: admin }),
  );
  assert.equal(platformAsAdmin.source, 'platform');
  assert.equal(platformAsAdmin.profile.organization_name, 'Svara Uji Platform');
  assert.equal(platformAsAdmin.profile.policy_url, changed.policy_url);

  const orgUntouched = data<{ source: string; profile: { organization_name: string } }>(
    await call('/org/profile', { cookie: await session('orgadmin@svara.local') }),
  );
  assert.equal(orgUntouched.source, 'organization');
  assert.equal(orgUntouched.profile.organization_name, 'SMK Nusantara (contoh)');

  const stored = new Client({ connectionString: databaseUrl });
  await stored.connect();
  try {
    const audit = await stored.query("SELECT metadata FROM audit_logs WHERE object = 'platform' ORDER BY at DESC LIMIT 1");
    const metadata = JSON.parse(String(audit.rows[0]?.metadata ?? '{}')) as { organization_type?: string };
    assert.equal(metadata.organization_type, 'organization');
  } finally {
    await stored.end();
  }

  const restored = await call('/admin/platform-profile', {
    method: 'PUT',
    cookie: admin,
    body: {
      organization_name: before.organization_name,
      organization_type: before.organization_type,
      policy_url: before.policy_url,
      terms_url: before.terms_url,
      retention_days: before.retention_days,
      data_request_contact: before.data_request_contact,
      cross_border_transfer: before.cross_border_transfer === null ? null : Boolean(before.cross_border_transfer),
    },
  });
  assert.equal(restored.status, 200, restored.text);
  assert.equal(
    data<{ profile: { organization_name: string } }>(restored).profile.organization_name,
    before.organization_name,
  );
});

test('POST /surveys: owner_scope menentukan lingkup, visibilitas, dan sumber notice', async () => {
  const owner = await session('creator.a@svara.local');
  const orgAdmin = await session('orgadmin@svara.local');
  const peer = await session('officer@svara.local');

  const orgCreated = await call('/surveys', {
    method: 'POST',
    cookie: owner,
    body: { title: 'Survei lingkup organisasi', owner_scope: 'organization' },
  });
  assert.equal(orgCreated.status, 201, orgCreated.text);
  const orgSurvey = (orgCreated.json as { data: { survey: { id: string; organization_id: string | null; profile_id: string } } })
    .data.survey;
  assert.equal(orgSurvey.organization_id, 'org_smk');
  assert.ok(orgSurvey.profile_id, 'profile_id tetap wajib dan terisi');

  const individualCreated = await call('/surveys', {
    method: 'POST',
    cookie: owner,
    body: { title: 'Survei lingkup pribadi', owner_scope: 'individual' },
  });
  assert.equal(individualCreated.status, 201, individualCreated.text);
  const individualSurvey = (individualCreated.json as {
    data: { survey: { id: string; organization_id: string | null } };
  }).data.survey;
  assert.equal(individualSurvey.organization_id, null);

  const defaulted = await call('/surveys', { method: 'POST', cookie: owner, body: { title: 'Tanpa scope' } });
  assert.equal(defaulted.status, 201);
  assert.equal(
    (defaulted.json as { data: { survey: { organization_id: string | null } } }).data.survey.organization_id,
    null,
    'owner_scope default individual',
  );

  const listed = async (cookie: string) =>
    data<Array<{ id: string }>>(await call('/surveys', { cookie })).map((row) => row.id);
  assert.ok((await listed(orgAdmin)).includes(orgSurvey.id), 'org_admin melihat survei organisasinya');
  assert.ok(!(await listed(orgAdmin)).includes(individualSurvey.id), 'org_admin tidak melihat survei individual');
  assert.ok((await listed(owner)).includes(individualSurvey.id), 'pemilik melihat survei individualnya');
  assert.ok(!(await listed(peer)).includes(orgSurvey.id), 'creator satu organisasi tidak melihat survei rekan');
  assert.ok(!(await listed(peer)).includes(individualSurvey.id));

  const peerDetail = await call(`/surveys/${orgSurvey.id}`, { cookie: peer });
  assert.equal(peerDetail.status, 403, 'rekan satu organisasi tidak bisa membuka detail');
  const orgAdminIndividual = await call(`/surveys/${individualSurvey.id}`, { cookie: orgAdmin });
  assert.equal(orgAdminIndividual.status, 403, 'org_admin tidak bisa membuka survei individual anggota');

  // Sumber notice dibuktikan dari nilai yang berbeda antar sumber (org 1.2, platform 2.0).
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const versions = await db.query<{ survey_id: string; notice_version: string | null }>(
      'SELECT survey_id, notice_version FROM survey_versions WHERE survey_id = ANY($1::text[]) ORDER BY survey_id',
      [[orgSurvey.id, individualSurvey.id]],
    );
    const byId = new Map(versions.rows.map((row) => [row.survey_id, row.notice_version]));
    const sources = await db.query<{ platform: string | null; org: string | null }>(
      `SELECT (SELECT notice_version FROM platform_profile WHERE id = 'platform') AS platform,
              (SELECT notice_version FROM organizations WHERE id = 'org_smk') AS org`,
    );
    const { platform, org } = sources.rows[0]!;
    assert.notEqual(platform, org, 'seed harus membedakan kedua sumber notice');
    assert.equal(byId.get(orgSurvey.id), org, 'survei organisasi memakai organizations.notice_version');
    assert.equal(byId.get(individualSurvey.id), platform, 'survei individual memakai platform_profile.notice_version');
  } finally {
    await db.end();
  }

  // PUT menyimpan draf tanpa notice: versi baru memakai sumber yang sama dengan scope survei.
  const edited = await call(`/surveys/${individualSurvey.id}`, {
    method: 'PUT',
    cookie: owner,
    body: { title: 'Survei lingkup pribadi (uji)', purpose: 'Tujuan.', object_label: 'Objek', instructions: '', questions: [] },
  });
  assert.equal(edited.status, 200, edited.text);

  // Lingkup tidak sah dan akun tanpa organisasi.
  const nonsense = await call('/surveys', { method: 'POST', cookie: owner, body: { owner_scope: 'ngawur' } });
  assert.equal(nonsense.status, 422);
  assert.equal((nonsense.json as { code?: string }).code, 'validation_error');
});

test('Profil kebijakan survei berasal dari server sesuai lingkup, tanpa fallback SMK', async () => {
  const owner = await session('creator.a@svara.local');

  const create = async (scope: 'organization' | 'individual') => {
    const created = await call('/surveys', { method: 'POST', cookie: owner, body: { title: `Profil ${scope}`, owner_scope: scope } });
    assert.equal(created.status, 201, created.text);
    return (created.json as { data: { survey: { id: string } } }).data.survey.id;
  };
  const orgId = await create('organization');
  const individualId = await create('individual');

  interface DetailProfile {
    source: string;
    id: string;
    organization_name: string;
    organization_type: string;
  }
  const detail = async (id: string) =>
    (await call(`/surveys/${id}`, { cookie: owner })).json as { data: { profile: DetailProfile } };

  const individual = (await detail(individualId)).data.profile;
  assert.equal(individual.source, 'platform', 'survei individual memakai profil platform');
  assert.equal(individual.id, 'platform');

  const org = (await detail(orgId)).data.profile;
  assert.equal(org.source, 'organization', 'survei organisasi memakai profil organisasi');
  assert.equal(org.id, 'org_smk');
  assert.equal(org.organization_type, 'school');

  // Nilai pembanding dibaca dari basis data, bukan dari fixture.
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const sources = await db.query<{ platform_name: string; org_name: string }>(
      `SELECT (SELECT organization_name FROM platform_profile WHERE id = 'platform') AS platform_name,
              (SELECT name FROM organizations WHERE id = 'org_smk') AS org_name`,
    );
    const expected = sources.rows[0]!;
    assert.equal(individual.organization_name, expected.platform_name);
    assert.equal(org.organization_name, expected.org_name);
    assert.ok(!/SMK Nusantara/i.test(individual.organization_name), 'regresi: nama organisasi bocor ke survei individual');
  } finally {
    await db.end();
  }

  // Bootstrap membawa profil yang sama agar panel UI tidak menyusunnya sendiri.
  const bootstrap = data<{ surveyProfiles: Record<string, { source: string }> }>(await call('/bootstrap', { cookie: owner }));
  assert.equal(bootstrap.surveyProfiles[orgId]?.source, 'organization');
  assert.equal(bootstrap.surveyProfiles[individualId]?.source, 'platform');
});

test('Lingkup /org/*: anggota, undangan, dan audit tidak pernah melintasi organisasi', async () => {
  const orgAdmin = await session('orgadmin@svara.local');
  const members = data<{ members: Array<{ id: string; role: string; email: string }> }>(
    await call('/org/members', { cookie: orgAdmin }),
  );
  assert.ok(members.members.some((row) => row.id === 'u_creator_a'));
  assert.ok(members.members.every((row) => row.id !== 'u_creator_b'), 'org_perpus tidak boleh terlihat');

  // Database: akun org_perpus (creator.b) sebagai organisasi B untuk uji silang.
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  const orgBCreatorId = 'u_creator_b';
  try {
    // org_admin A mencoba mengubah anggota organisasi B: tidak ditemukan, tidak berubah.
    const crossPatch = await call(`/org/members/${orgBCreatorId}`, {
      method: 'PATCH',
      cookie: orgAdmin,
      body: { status: 'suspended' },
    });
    assert.equal(crossPatch.status, 404, 'anggota organisasi lain tidak terlihat');
    const untouched = await db.query<{ status: string }>('SELECT status FROM accounts WHERE id = $1', [orgBCreatorId]);
    assert.equal(untouched.rows[0]?.status, 'active', 'status organisasi lain tidak berubah');
    // Peran tidak dapat diubah lewat endpoint ini, bahkan untuk anggota sendiri.
    const roleChange = await call('/org/members/u_creator_a', {
      method: 'PATCH',
      cookie: orgAdmin,
      body: { status: 'active', role: 'super_admin' },
    });
    assert.equal(roleChange.status, 200);
    const roleRow = await db.query<{ role: string }>('SELECT role FROM accounts WHERE id = $1', ['u_creator_a']);
    assert.equal(roleRow.rows[0]?.role, 'creator', 'role hanya bisa dibaca, tidak diubah');
  } finally {
    await db.end();
  }

  // Aksi status untuk anggota sendiri.
  const suspended = await call('/org/members/u_creator_a', {
    method: 'PATCH',
    cookie: orgAdmin,
    body: { status: 'suspended' },
  });
  assert.equal(suspended.status, 200, suspended.text);
  const blocked = await call('/auth/login', { method: 'POST', body: { email: 'creator.a@svara.local', password: 'SvaraDemo123!' } });
  assert.equal(blocked.status, 401, 'akun suspended tidak bisa masuk');
  const reactivated = await call('/org/members/u_creator_a', {
    method: 'PATCH',
    cookie: orgAdmin,
    body: { status: 'active' },
  });
  assert.equal(reactivated.status, 200);
  // L-04: penangguhan menghapus semua sesi akun, jadi cookie cache lama tidak berlaku lagi.
  sessions.delete('creator.a@svara.local');

  // org_admin lain (org_perpus) membuat undangan; kode itu mengikat ke org_perpus, bukan org_smk.
  const orgBCode = await call('/org/invitations', { method: 'POST', cookie: await session('creator.b@svara.local') });
  assert.equal(orgBCode.status, 403, 'creator bukan org_admin tidak boleh membuat undangan');

  const invitation = data<{ invitation: { id: string; code: string; organization_id: string } }>(
    await call('/org/invitations', { method: 'POST', cookie: orgAdmin }),
  );
  assert.equal(invitation.invitation.organization_id, 'org_smk');
  assert.match(invitation.invitation.code, /^ORG-[A-Z0-9_-]{6,}$/);

  const invitedEmail = 'anggota.baru@contoh.test';
  const registered = await call('/auth/register', {
    method: 'POST',
    body: {
      name: 'Anggota Baru',
      email: invitedEmail,
      password: 'SandiAnggota123!',
      acceptTerms: true,
      invite_code: invitation.invitation.code,
    },
  });
  assert.equal(registered.status, 201, registered.text);
  const newAccountId = (registered.json as { data: { account: { id: string } } }).data.account.id;
  const verify = new Client({ connectionString: databaseUrl });
  await verify.connect();
  try {
    const row = await verify.query<{ organization_id: string | null }>(
      'SELECT organization_id FROM accounts WHERE id = $1',
      [newAccountId],
    );
    assert.equal(row.rows[0]?.organization_id, 'org_smk', 'invite_code mengikat akun ke organisasi pengundang');
    const used = await verify.query<{ used_by: string | null }>(
      'SELECT used_by FROM organization_invitations WHERE id = $1',
      [invitation.invitation.id],
    );
    assert.equal(used.rows[0]?.used_by, newAccountId, 'kode ditandai terpakai');
  } finally {
    await verify.end();
  }

  // Kode yang sudah dipakai ditolak: dibuktikan lewat used_at di DB agar tidak menghabiskan
  // jatah rate limit register (limit 5 per IP). Satu percobaan register tersisa untuk kode asing.
  const spent = new Client({ connectionString: databaseUrl });
  await spent.connect();
  try {
    const row = await spent.query<{ used_at: string | null; used_by: string | null }>(
      'SELECT used_at, used_by FROM organization_invitations WHERE id = $1',
      [invitation.invitation.id],
    );
    assert.ok(row.rows[0]?.used_at, 'kode yang sudah dipakai tidak lagi eligible untuk register');
  } finally {
    await spent.end();
  }

  const bogus = await call('/auth/register', {
    method: 'POST',
    body: { name: 'Anggota Ketiga', email: 'anggota.ketiga@contoh.test', password: 'SandiAnggota123!', acceptTerms: true, invite_code: 'ORG-TIDAKADA' },
  });
  assert.equal(bogus.status, 422, bogus.text);
  assert.equal((bogus.json as { code?: string }).code, 'invalid_invite_code');

  // Audit hanya baris organisasi sendiri, tanpa metadata mentah.
  const audit = data<{ rows: Array<Record<string, unknown>> }>(await call('/org/audit', { cookie: orgAdmin }));
  assert.ok(audit.rows.length > 0);
  assert.ok(audit.rows.every((row) => !('metadata' in row) && !('organization_id' in row)), 'tanpa metadata mentah');
  const auditDb = new Client({ connectionString: databaseUrl });
  await auditDb.connect();
  try {
    const returnedIds = new Set(audit.rows.map((row) => row.id as string));
    const foreignIds = await auditDb.query<{ id: string }>(
      "SELECT id FROM audit_logs WHERE organization_id = 'org_perpus'",
    );
    assert.ok(foreignIds.rows.length > 0, 'org_perpus punya baris audit pembanding');
    assert.ok(foreignIds.rows.every((row) => !returnedIds.has(row.id)), 'baris organisasi lain tidak pernah tampil');
  } finally {
    await auditDb.end();
  }

  // Creator dan org_perpus ditolak di ketiga endpoint.
  for (const [label, cookie] of [['creator', await session('creator.a@svara.local')], ['org lain', await session('creator.b@svara.local')]] as const) {
    for (const [method, path, body] of [
      ['GET', '/org/members', undefined],
      ['PATCH', '/org/members/u_creator_a', { status: 'active' }],
      ['POST', '/org/invitations', undefined],
      ['GET', '/org/audit', undefined],
    ] as const) {
      const denied = await call(path, { method, cookie, body });
      assert.equal(denied.status, 403, `${label}: ${method} ${path} harus 403`);
    }
  }
});

interface OrgInvitationRow {
  id: string;
  organization_id: string;
  code: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  used_at: string | null;
  used_by: string | null;
  status: 'active' | 'used' | 'revoked' | 'expired';
}

test('Kode undangan organisasi: masa berlaku, pencabutan, dan penolakan pemakaian', async () => {
  const orgAdmin = await session('orgadmin@svara.local');
  const creator = await session('creator.a@svara.local');
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  const createdIds: string[] = [];
  try {
    const forbidden = await call('/org/invitations', { cookie: creator });
    assert.equal(forbidden.status, 403, 'creator tidak boleh melihat kode undangan organisasi');

    const created = data<{ invitation: OrgInvitationRow }>(await call('/org/invitations', { method: 'POST', cookie: orgAdmin }));
    createdIds.push(created.invitation.id);
    assert.equal(created.invitation.status, 'active');
    assert.equal(created.invitation.organization_id, 'org_smk');
    assert.ok(created.invitation.expires_at, 'kode baru wajib punya masa berlaku');
    const ttl = Date.parse(created.invitation.expires_at) - Date.parse(created.invitation.created_at);
    assert.ok(ttl > 13 * 86_400_000 && ttl < 15 * 86_400_000, 'masa berlaku 14 hari');

    const listed = data<{ invitations: OrgInvitationRow[]; ttl_days: number }>(await call('/org/invitations', { cookie: orgAdmin }));
    assert.equal(listed.ttl_days, 14);
    assert.equal(listed.invitations.find((row) => row.id === created.invitation.id)?.status, 'active');
    assert.ok(listed.invitations.every((row) => row.organization_id === 'org_smk'));

    const revoked = await call(`/org/invitations/${created.invitation.id}`, { method: 'DELETE', cookie: orgAdmin });
    assert.equal(revoked.status, 200, revoked.text);
    const revokedRow = data<{ invitation: OrgInvitationRow }>(revoked).invitation;
    assert.equal(revokedRow.status, 'revoked');

    const alreadyRevoked = await call(`/org/invitations/${created.invitation.id}`, { method: 'DELETE', cookie: orgAdmin });
    assert.equal(alreadyRevoked.status, 200, 'mencabut dua kali tetap 200 dan tidak mengubah data');
    assert.equal(data<{ invitation: OrgInvitationRow }>(alreadyRevoked).invitation.revoked_at, revokedRow.revoked_at);

    const registerAfterRevoke = await call('/auth/register', {
      method: 'POST',
      body: {
        name: 'Pendaftar Ditolak',
        email: 'ditolak.cabut@contoh.test',
        password: 'SandiAnggota123!',
        acceptTerms: true,
        invite_code: created.invitation.code,
      },
    });
    assert.equal(registerAfterRevoke.status, 422, registerAfterRevoke.text);
    assert.equal((registerAfterRevoke.json as { code?: string }).code, 'invalid_invite_code', 'kode dicabut tidak dapat dipakai');

    // Kedaluwarsa: status dihitung dari expires_at, bukan kolom tersimpan.
    const expiring = data<{ invitation: OrgInvitationRow }>(await call('/org/invitations', { method: 'POST', cookie: orgAdmin }));
    createdIds.push(expiring.invitation.id);
    await db.query('UPDATE organization_invitations SET expires_at = $1 WHERE id = $2', ['2000-01-01T00:00:00.000Z', expiring.invitation.id]);
    const afterExpiry = data<{ invitations: OrgInvitationRow[] }>(await call('/org/invitations', { cookie: orgAdmin }));
    assert.equal(afterExpiry.invitations.find((row) => row.id === expiring.invitation.id)?.status, 'expired');

    const registerAfterExpiry = await call('/auth/register', {
      method: 'POST',
      body: {
        name: 'Pendaftar Kedaluwarsa',
        email: 'ditolak.kadaluarsa@contoh.test',
        password: 'SandiAnggota123!',
        acceptTerms: true,
        invite_code: expiring.invitation.code,
      },
    });
    assert.equal(registerAfterExpiry.status, 422, registerAfterExpiry.text);
    assert.equal((registerAfterExpiry.json as { code?: string }).code, 'invalid_invite_code', 'kode kedaluwarsa tidak dapat dipakai');

    // Kode terpakai tidak dapat dicabut.
    const used = data<{ invitation: OrgInvitationRow }>(await call('/org/invitations', { method: 'POST', cookie: orgAdmin }));
    createdIds.push(used.invitation.id);
    await db.query('UPDATE organization_invitations SET used_at = $1, used_by = $2 WHERE id = $3', [
      new Date().toISOString(),
      'u_admin',
      used.invitation.id,
    ]);
    const revokeUsed = await call(`/org/invitations/${used.invitation.id}`, { method: 'DELETE', cookie: orgAdmin });
    assert.equal(revokeUsed.status, 409);
    assert.equal((revokeUsed.json as { code?: string }).code, 'invitation_used');

    // Kode organisasi lain tidak terlihat dan tidak dapat dicabut (404, bukan 403).
    const foreignId = 'oi_uji_organisasi_lain';
    await db.query('DELETE FROM organization_invitations WHERE id = $1', [foreignId]);
    await db.query(
      `INSERT INTO organization_invitations (id, organization_id, code, created_by, created_at, expires_at)
       VALUES ($1, 'org_perpus', 'ORG-UJILAINORGANISASI', 'u_admin', $2, $3)`,
      [foreignId, new Date().toISOString(), new Date(Date.now() + 86_400_000).toISOString()],
    );
    const foreignList = data<{ invitations: OrgInvitationRow[] }>(await call('/org/invitations', { cookie: orgAdmin }));
    assert.ok(foreignList.invitations.every((row) => row.id !== foreignId), 'kode organisasi lain tidak muncul');
    const revokeForeign = await call(`/org/invitations/${foreignId}`, { method: 'DELETE', cookie: orgAdmin });
    assert.equal(revokeForeign.status, 404);
    assert.equal((revokeForeign.json as { code?: string }).code, 'invitation_not_found');
    await db.query('DELETE FROM organization_invitations WHERE id = $1', [foreignId]);

    const revocationAudit = await db.query<{ id: string }>(
      "SELECT id FROM audit_logs WHERE object = $1 AND action = 'Cabut undangan organisasi'",
      [created.invitation.id],
    );
    assert.ok(revocationAudit.rows.length > 0, 'pencabutan tercatat pada audit');
  } finally {
    if (createdIds.length > 0) {
      await db.query('DELETE FROM organization_invitations WHERE id = ANY($1::text[])', [createdIds]);
    }
    await db.query('DELETE FROM organization_invitations WHERE id = $1', ['oi_uji_organisasi_lain']);
    await db.end();
  }
});

test('SEC-02: consent menolak notice yang berubah sejak intro dan mencatat notice yang dirender', async () => {
  const creator = await session('creator.a@svara.local');
  const title = 'Survei notice berganti';
  const { survey } = data<{ survey: { id: string } }>(await call('/surveys', {
    method: 'POST', cookie: creator, body: { title },
  }));
  const surveyPath = `/surveys/${survey.id}`;
  const save = async (questionCode: string) => {
    const saved = await call(surveyPath, {
      method: 'PUT', cookie: creator, body: {
        title,
        purpose: 'Menguji pemberitahuan yang berubah di antara intro dan persetujuan.',
        object_label: 'Peserta',
        instructions: '',
        questions: [{ code: questionCode, type: 'short_text', required: true, section: 'Uji', label: 'Tanggapan' }],
      },
    });
    assert.equal(saved.status, 200, saved.text);
    const published = await call(`${surveyPath}/publish`, { method: 'POST', cookie: creator });
    assert.equal(published.status, 200, published.text);
    return data<{ version: { id: string }; publicLink: { token: string } }>(published);
  };

  const v1 = await save('Q1');
  const introToken = v1.publicLink.token;
  const intro = data<{ consent_version: string; version: { notice_version: string } }>(await call(`/public/surveys/${introToken}`));

  const countConsents = async () => {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const result = await client.query<{ count: string }>('SELECT COUNT(*) AS count FROM consent_records WHERE survey_id = $1', [survey.id]);
      return Number(result.rows[0]!.count);
    } finally {
      await client.end();
    }
  };
  const before = await countConsents();

  const v2 = await save('Q2');
  assert.notEqual(v2.version.id, v1.version.id);
  // Versi v2 memakai notice platform aktif yang sama dengan v1, jadi cacatnya hanya terlihat dari version_id:
  // klien tidak boleh menyetujui versi lain yang tidak pernah ia render.
  const stale = await call(`/public/surveys/${introToken}/consent`, {
    method: 'POST', body: { version_id: intro.consent_version, respondent_click: true, eligibility: true, guardian_evidence_ref: 'ref-wali-notice' },
  });
  assert.equal(stale.status, 409, stale.text);
  assert.equal((stale.json as { code: string }).code, 'notice_changed');
  assert.equal(await countConsents(), before, 'consent basi tidak boleh tercatat');

  const withoutVersion = await call(`/public/surveys/${introToken}/consent`, {
    method: 'POST', body: { respondent_click: true, eligibility: true, guardian_evidence_ref: 'ref-wali-notice' },
  });
  assert.equal(withoutVersion.status, 422, withoutVersion.text);
  assert.equal((withoutVersion.json as { code: string }).code, 'version_id_required');
  assert.equal(await countConsents(), before);

  const reloaded = data<{ consent_version: string }>(await call(`/public/surveys/${introToken}`));
  assert.notEqual(reloaded.consent_version, intro.consent_version, 'token lama meremap ke versi terbit terbaru');
  const fresh = await call(`/public/surveys/${introToken}/consent`, {
    method: 'POST', body: { version_id: reloaded.consent_version, respondent_click: true, eligibility: true, guardian_evidence_ref: 'ref-wali-notice' },
  });
  assert.equal(fresh.status, 201, fresh.text);
  const consentId = data<{ consent_id: string }>(fresh).consent_id;

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const recorded = await client.query<{ version_id: string; notice_id: string; notice_version: string }>(
      'SELECT c.version_id, n.notice_id, n.notice_version FROM consent_records c JOIN consent_notice_versions n ON n.consent_id = c.id WHERE c.id = $1',
      [consentId],
    );
    assert.equal(recorded.rows[0]?.version_id, v2.version.id);
    const noticeVersion = recorded.rows[0]?.notice_version;
    assert.match(noticeVersion ?? '', /^\d+\.\d+$/u);
    assert.equal(recorded.rows[0]?.notice_id, `pn_${noticeVersion.replace(".", "_")}`);
    const { notice } = data<{ notice: { id: string; version: string } }>(await call(`/public/surveys/${introToken}`));
    assert.deepEqual(
      { id: recorded.rows[0]?.notice_id, version: noticeVersion },
      { id: notice.id, version: notice.version },
    );
  } finally {
    await client.end();
  }
});

test('Tautan umum v1 menyajikan v2 dan menyimpan respons pada v2', async (t) => {
  const cookie = await session('creator.a@svara.local');
  async function createSurvey(title: string) {
    const { survey } = data<{ survey: { id: string } }>(await call('/surveys', {
      method: 'POST', cookie, body: { title },
    }));
    return `/surveys/${survey.id}`;
  }

  async function publish(path: string, title: string, questionCode: string) {
    const saved = await call(path, {
      method: 'PUT', cookie, body: {
        title,
        purpose: 'Menguji perubahan instrumen.',
        questions: [{ code: questionCode, type: 'short_text', required: true, section: 'Uji', label: 'Tanggapan' }],
      },
    });
    assert.equal(saved.status, 200, saved.text);
    return data<{ version: { id: string }; publicLink: { token: string } }>(await call(`${path}/publish`, {
      method: 'POST', cookie,
    }));
  }

  const title = 'Survei riwayat tautan';
  const path = await createSurvey(title);
  const v1 = await publish(path, title, 'Q1');
  const v1Intro = data<{ consent_version: string }>(await call(`/public/surveys/${v1.publicLink.token}`));
  // Referensi wali wajib dikirim: tanpa itu fixture gagal 422 di setup (bukan di assertion remap) pada
  // profil yang mewajibkan wali, sehingga bukti merah tidak pernah mencapai perilaku yang diuji.
  const oldConsent = await call(`/public/surveys/${v1.publicLink.token}/consent`, {
    method: 'POST',
    body: {
      version_id: v1Intro.consent_version,
      respondent_click: true,
      eligibility: true,
      guardian_evidence_ref: 'ref-wali-riwayat',
    },
  });
  assert.equal(oldConsent.status, 201, oldConsent.text);
  const otherTitle = 'Survei kedua';
  const otherSurvey = await createSurvey(otherTitle);
  await publish(otherSurvey, otherTitle, 'OTHER1');
  await publish(otherSurvey, otherTitle, 'OTHER2');
  const other = await publish(otherSurvey, otherTitle, 'OTHER3');
  const otherPath = `/public/surveys/${other.publicLink.token}`;
  const v2 = await publish(path, title, 'Q2');
  const oldPath = `/public/surveys/${v1.publicLink.token}`;
  const currentPath = `/public/surveys/${v2.publicLink.token}`;
  const key = 'kiriman-tautan-v1-0001';
  let receiptRequest: { path: string; cookie: string } | undefined;
  type LinkContext = { state: string; canSubmit: boolean; consent_version: string; version: { number: number } };

  await t.test('token v1 menyajikan v2 tanpa redirect HTTP dan dapat dipakai mengirim', async () => {
    const response = await call(oldPath, { redirect: 'manual' });
    assert.equal(response.status, 200, response.text);
    const context = data<LinkContext>(response);
    assert.equal(context.version.number, 2, 'token v1 harus menyajikan konteks v2');
    assert.equal(context.state, 'active');
    assert.equal(context.canSubmit, true);
    assert.ok(!response.text.includes(v1.version.id) && !response.text.includes(v2.version.id));
    const { consent_id: oldConsentId } = data<{ consent_id: string }>(oldConsent);
    const stale = await call(`${oldPath}/form?consent_id=${oldConsentId}`, { cookie: consentCookie(oldConsent) });
    assert.equal(stale.status, 409, stale.text);
    assert.equal(stale.json?.code, 'consent_context_mismatch');

    const issued = await call(`${oldPath}/consent`, {
      method: 'POST', body: { version_id: context.consent_version, respondent_click: true, eligibility: true, guardian_evidence_ref: 'ref-wali-versi' },
    });
    assert.equal(issued.status, 201, issued.text);
    const { consent_id } = data<{ consent_id: string }>(issued);
    const respondent = consentCookie(issued);
    const formResponse = await call(`${oldPath}/form?consent_id=${consent_id}`, { cookie: respondent });
    assert.ok(!formResponse.text.includes(v2.version.id));
    const form = data<{ questions: Array<{ code: string }> }>(formResponse);
    assert.deepEqual(form.questions.map(({ code }) => code), ['Q2']);

    const submitted = await call(`${oldPath}/responses`, {
      method: 'POST', cookie: respondent, idempotencyKey: key,
      body: { consent_id, answers: [{ question_code: 'Q2', text: 'Jawaban versi dua' }] },
    });
    assert.equal(submitted.status, 201, submitted.text);
    const { response_id } = data<{ response_id: string }>(submitted);
    assert.ok(!submitted.text.includes(v2.version.id));
    receiptRequest = { path: `${oldPath}/receipt/${response_id}`, cookie: respondent };
    const db = new Client({ connectionString: databaseUrl });
    await db.connect();
    try {
      const stored = await db.query<{ version_id: string }>('SELECT version_id FROM responses WHERE id = $1', [response_id]);
      assert.deepEqual(stored.rows, [{ version_id: v2.version.id }]);
    } finally {
      await db.end();
    }
  });

  await t.test('token versi aktif tetap melayani versi miliknya', async () => {
    const current = data<LinkContext>(await call(currentPath, { redirect: 'manual' }));
    assert.equal(current.state, 'active');
    assert.equal(current.canSubmit, true);
    assert.equal(current.version.number, 2);
  });

  await t.test('token v1 langsung menyajikan v3 setelah publikasi ketiga', async () => {
    const v3 = await publish(path, title, 'Q3');
    const latest = data<LinkContext>(await call(`/public/surveys/${v3.publicLink.token}`));
    assert.equal(latest.version.number, 3);
    assert.deepEqual(data(await call(oldPath)), latest);
    assert.deepEqual(data(await call(currentPath)), latest);
  });

  await t.test('bukti v2 tetap bisa dipulihkan melalui token v1 setelah v3 terbit', async () => {
    assert.ok(receiptRequest);
    const receipt = await call(receiptRequest.path, { cookie: receiptRequest.cookie, idempotencyKey: key });
    assert.equal(receipt.status, 200, receipt.text);
    assert.equal(data<{ version_number: number }>(receipt).version_number, 2);
    assert.ok(!receipt.text.includes(v2.version.id));
  });

  await t.test('setelah penutupan, token tetap closed meski survei lain masih terbit', async () => {
    const otherContext = data<LinkContext & { survey: { title: string } }>(await call(otherPath));
    assert.equal(otherContext.state, 'active');
    assert.equal(otherContext.survey.title, otherTitle);
    assert.equal(otherContext.version.number, 3);

    const closed = await call(`${path}/close`, { method: 'POST', cookie });
    assert.equal(closed.status, 200, closed.text);
    for (const tokenPath of [oldPath, currentPath]) {
      const context = data<{ state: string; canSubmit: boolean; survey: { title: string } }>(await call(tokenPath));
      assert.equal(context.state, 'closed');
      assert.equal(context.canSubmit, false);
      assert.equal(context.survey.title, title);
    }
    assert.deepEqual(data(await call(otherPath)), otherContext);
  });
});
