import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';

import { hashPassword } from '../security.ts';
import { all, get, run } from '../db.ts';
import { closeTestDatabase, databaseUrl, resetTestDatabase } from './test-db.ts';

const PORT = '3193';
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const PASSWORD = 'SvaraDemo123!';
const PURPOSE = 'Audit hasil pelatihan triwulan II';
const SURVEY_EXPORT = '/surveys/s_kp03/export?version=v_kp03_1&format=csv';
const OBJECT = 's_kp03 · v1';

let server: ChildProcess | undefined;

interface Result {
  status: number;
  text: string;
  headers: Headers;
}

before(async () => {
  await resetTestDatabase();
  const now = new Date().toISOString();
  await run(
    "INSERT INTO profiles (id, organization_name, organization_type, respondent_age_category, consent_mode, policy_url, terms_url, notice_version) VALUES ('p_kp03', 'Organisasi KP-03', 'organization', 'adult', 'self', 'https://contoh.local/privasi', 'https://contoh.local/ketentuan', '1')",
  );
  await run(
    "INSERT INTO accounts (id, email, display_name, role, status, password_hash, created_at) VALUES ('u_kp03', 'owner.kp03@svara.local', 'Pemilik KP-03', 'creator', 'active', ?, ?)",
    await hashPassword(PASSWORD),
    now,
  );
  await run(
    "INSERT INTO surveys (id, owner_id, profile_id, title, purpose, object_label, instructions, status, created_at, updated_at) VALUES ('s_kp03', 'u_kp03', 'p_kp03', 'Survei KP-03', 'Tujuan', 'Karyawan', '', 'published', ?, ?)",
    now,
    now,
  );
  await run(
    "INSERT INTO survey_versions (id, survey_id, number, status, notice_version, published_at) VALUES ('v_kp03_1', 's_kp03', 1, 'published', '1', ?)",
    now,
  );
  await run("UPDATE surveys SET current_version_id = 'v_kp03_1' WHERE id = 's_kp03'");
  await run(
    "INSERT INTO questions (id, version_id, code, ord, type, required, section, label) VALUES ('q_kp03', 'v_kp03_1', 'AD01', 1, 'likert', 1, 'Bagian 1', 'Saya puas')",
  );
  server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: { ...process.env, PORT, DATABASE_URL: databaseUrl, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForServer(server);
});

after(async () => {
  server?.kill();
  await closeTestDatabase();
});

async function call(path: string, cookie: string, headers: Headers): Promise<Result> {
  const merged = new Headers({ 'X-Svara-Client': 'web', Accept: 'application/json', Cookie: cookie });
  headers.forEach((value, key) => merged.set(key, value));
  const response = await fetch(`${BASE}${path}`, { headers: merged });
  return { status: response.status, text: await response.text(), headers: response.headers };
}

async function waitForServer(child: ChildProcess): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  let output = '';
  const onData = (chunk: unknown) => {
    output += String(chunk);
    if (output.includes('Svara berjalan')) resolve();
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
  child.once('exit', (code) => {
    if (!output.includes('Svara berjalan')) throw new Error(`server uji berhenti (kode ${code}): ${output}`);
  });
  await promise;
}

async function login(): Promise<string> {
  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'X-Svara-Client': 'web', 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner.kp03@svara.local', password: PASSWORD }),
  });
  assert.equal(response.status, 200, await response.text());
  return (response.headers.get('set-cookie') ?? '').split(';')[0]!;
}

function context(recipient: string | undefined, purpose: string | undefined): Headers {
  const headers = new Headers();
  if (recipient !== undefined) headers.set('X-Export-Recipient', recipient);
  if (purpose !== undefined) headers.set('X-Export-Purpose', purpose);
  return headers;
}

function payload(result: Result): { code?: string; error?: string } {
  try {
    return JSON.parse(result.text) as { code?: string; error?: string };
  } catch {
    return {};
  }
}

async function lastAudit(action: string, outcome: string): Promise<Record<string, unknown> | undefined> {
  const row = await get<{ metadata: string | null }>(
    'SELECT metadata FROM audit_logs WHERE action = ? AND object = ? AND outcome = ? ORDER BY at DESC LIMIT 1',
    action,
    OBJECT,
    outcome,
  );
  return row ? (JSON.parse(row.metadata ?? '{}') as Record<string, unknown>) : undefined;
}

async function auditCount(action: string, outcome: string): Promise<number> {
  const row = await get<{ count: number }>(
    'SELECT COUNT(*)::int AS count FROM audit_logs WHERE action = ? AND object = ? AND outcome = ?',
    action,
    OBJECT,
    outcome,
  );
  return row?.count ?? 0;
}

test('KP-03: CSV individual tanpa recipient/purpose ditolak 422 export_context_required tanpa header CSV', async () => {
  const cookie = await login();
  const result = await call(SURVEY_EXPORT, cookie, context(undefined, undefined));
  assert.equal(result.status, 422, result.text);
  const body = payload(result);
  assert.equal(body.code, 'export_context_required');
  assert.match(body.error ?? '', /recipient/);
  assert.match(body.error ?? '', /purpose/);
  assert.equal(result.headers.get('content-disposition'), null, 'penolakan tidak boleh mengirim header CSV');
  assert.ok(!result.text.includes('response_id'), 'penolakan tidak boleh memuat baris CSV');
  assert.ok(result.headers.get('content-type')?.startsWith('application/json'));

  for (const [label, headers] of [
    ['hanya recipient', context('Dinas Pendidikan', undefined)],
    ['hanya purpose', context(undefined, PURPOSE)],
    ['recipient spasi', context('   ', PURPOSE)],
  ] as Array<[string, Headers]>) {
    const partial = await call(SURVEY_EXPORT, cookie, headers);
    assert.equal(partial.status, 422, `${label}: ${partial.text}`);
    assert.equal(payload(partial).code, 'export_context_required', label);
    assert.equal(partial.headers.get('content-disposition'), null, label);
  }

  assert.equal(await auditCount('Ekspor CSV', 'berhasil'), 0, 'penolakan tidak mencatat ekspor berhasil');
  assert.equal(await auditCount('Mulai ekspor CSV', 'dimulai'), 0, 'penolakan tidak memulai aliran CSV');
});

test('KP-03: recipient/purpose lewat query dan header tercatat di metadata audit ekspor', async () => {
  const cookie = await login();
  const query = `?version=v_kp03_1&format=csv&recipient=${encodeURIComponent('Dinas Pendidikan Kota')}&purpose=${encodeURIComponent(PURPOSE)}`;
  const variants: Array<[string, () => Promise<Result>]> = [
    ['header konteks', () => call(SURVEY_EXPORT, cookie, context('Dinas Pendidikan Kota', PURPOSE))],
    ['query', () => call(`/surveys/s_kp03/export${query}`, cookie, new Headers())],
  ];
  for (const [label, send] of variants) {
    const result = await send();
    assert.equal(result.status, 200, `${label}: ${result.text}`);
    assert.ok(result.headers.get('content-type')?.startsWith('text/csv'), label);
    assert.match(result.headers.get('content-disposition') ?? '', /attachment; filename="hasil-s_kp03-v1\.csv"/, label);

    const finished = await lastAudit('Ekspor CSV', 'berhasil');
    assert.ok(finished, `${label}: baris audit ekspor berhasil harus ada`);
    assert.equal(finished.recipient, 'Dinas Pendidikan Kota', label);
    assert.equal(finished.purpose, PURPOSE, label);
    assert.deepEqual(
      [finished.format, finished.filename, finished.individual, finished.includeText],
      ['csv', 'hasil-s_kp03-v1.csv', true, true],
      `${label}: metadata lama tetap utuh`,
    );
    const started = await lastAudit('Mulai ekspor CSV', 'dimulai');
    assert.equal(started?.recipient, 'Dinas Pendidikan Kota', label);
    assert.equal(started?.purpose, PURPOSE, label);
  }
});

test('KP-03: konteks ekspor hanya tersimpan di audit_logs.metadata, bukan di surveys/responses', async () => {
  const cookie = await login();
  assert.equal((await call(SURVEY_EXPORT, cookie, context('Penerima X', 'Tujuan Y'))).status, 200);
  const survey = await get<{ purpose: string; instructions: string }>('SELECT purpose, instructions FROM surveys WHERE id = ?', 's_kp03');
  assert.deepEqual([survey?.purpose, survey?.instructions], ['Tujuan', ''], 'kolom survei tidak tertimpa konteks ekspor');
  const columns = await all<{ table_name: string; column_name: string }>(
    "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name IN ('recipient', 'purpose')",
  );
  assert.deepEqual(
    columns.map((column) => `${column.table_name}.${column.column_name}`).sort(),
    ['access_grants.purpose', 'notices.purpose', 'organization_notices.purpose', 'platform_notices.purpose', 'surveys.purpose'],
    'tidak ada kolom konteks ekspor baru di luar audit_logs.metadata',
  );
  const stored = await all<{ metadata: string | null }>(
    "SELECT metadata FROM audit_logs WHERE action IN ('Mulai ekspor CSV', 'Ekspor CSV') AND object = ?",
    OBJECT,
  );
  assert.ok(stored.length > 0);
  for (const row of stored) {
    const meta = JSON.parse(row.metadata ?? '{}') as Record<string, unknown>;
    assert.equal(typeof meta.recipient, 'string', 'setiap baris ekspor menyebut penerima');
    assert.equal(typeof meta.purpose, 'string', 'setiap baris ekspor menyebut tujuan');
  }
});

test('KP-03: kodebook tanpa recipient/purpose tetap 200 dan tidak mencatat konteks', async () => {
  const cookie = await login();
  const result = await call('/surveys/s_kp03/export?version=v_kp03_1&format=codebook', cookie, new Headers());
  assert.equal(result.status, 200, result.text);
  assert.match(result.headers.get('content-disposition') ?? '', /kodebook/);
  const meta = await lastAudit('Ekspor kodebook', 'berhasil');
  assert.ok(meta);
  assert.deepEqual([meta.individual, 'recipient' in meta, 'purpose' in meta], [false, false, false]);
});

test('KP-03: recipient/purpose lebih dari 200 karakter ditolak 422 tanpa header CSV', async () => {
  const cookie = await login();
  const cases: Array<[string, string, Headers, RegExp]> = [
    ['recipient 201 header', SURVEY_EXPORT, context('x'.repeat(201), PURPOSE), /recipient/],
    ['purpose 201 header', SURVEY_EXPORT, context('Dinas', 'y'.repeat(201)), /purpose/],
    ['purpose 201 query', `/surveys/s_kp03/export?version=v_kp03_1&format=csv&recipient=Dinas&purpose=${'y'.repeat(201)}`, new Headers(), /purpose/],
    ['recipient 201 query', `/surveys/s_kp03/export?version=v_kp03_1&format=csv&recipient=${'x'.repeat(201)}&purpose=${encodeURIComponent(PURPOSE)}`, new Headers(), /recipient/],
  ];
  for (const [label, path, headers, field] of cases) {
    const result = await call(path, cookie, headers);
    assert.equal(result.status, 422, `${label}: ${result.text}`);
    assert.equal(payload(result).code, 'validation_error', label);
    assert.match(payload(result).error ?? '', field, label);
    assert.equal(result.headers.get('content-disposition'), null, `${label}: penolakan tidak boleh mengirim header CSV`);
    assert.ok(!result.text.includes('response_id'), `${label}: penolakan tidak boleh memuat baris CSV`);
  }
  // Batas tepat 200 karakter diterima.
  const boundary = await call(SURVEY_EXPORT, cookie, context('x'.repeat(200), 'y'.repeat(200)));
  assert.equal(boundary.status, 200, boundary.text);
});
