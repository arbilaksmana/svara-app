import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';

import { closeTestDatabase, databaseUrl, resetTestDatabase } from './test-db.ts';

const PORT = '3192';
const BASE = `http://127.0.0.1:${PORT}/api/v1`;

interface Exported {
  data?: {
    survey?: { id?: string };
    version?: { id?: string };
    detail?: { versions?: Array<{ id: string }> };
  };
  code?: string;
}

interface Result {
  status: number;
  body: Exported | null;
  text: string;
  headers: Headers;
}

async function call(
  path: string,
  options: { method?: string; body?: unknown; cookie?: string } = {},
): Promise<Result> {
  const headers = new Headers({ 'X-Svara-Client': 'web', Accept: 'application/json' });
  if (options.cookie) headers.set('Cookie', options.cookie);
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let body: Exported | null = null;
  try {
    body = text ? (JSON.parse(text) as Exported) : null;
  } catch {
    body = null;
  }
  return { status: response.status, body, text, headers: response.headers };
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

let server: ChildProcess | undefined;

before(async () => {
  await resetTestDatabase();
  server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: { ...process.env, PORT, DATABASE_URL: databaseUrl, NODE_ENV: 'test', SEED_DEMO: '1', SEED_PASSWORD: 'SvaraDemo123!' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForServer(server);
});

after(async () => {
  server?.kill();
  await closeTestDatabase();
});

async function login(email: string): Promise<string> {
  const result = await call('/auth/login', { method: 'POST', body: { email, password: 'SvaraDemo123!' } });
  assert.equal(result.status, 200, `login ${email}: ${result.text}`);
  return (result.headers.get('set-cookie') ?? '').split(';')[0]!;
}

function csvRows(csv: string): string[][] {
  return csv
    .replace(/^\uFEFF/, '')
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(','));
}

function likert(code: string, label: string) {
  return {
    code,
    type: 'likert',
    required: true,
    section: 'Bagian 1',
    label,
    hint: null,
    group_code: null,
    dimension_code: null,
    direction: null,
    options: ['Sangat tidak setuju', 'Tidak setuju', 'Netral', 'Setuju', 'Sangat setuju'].map((option, index) => ({
      label: option,
      value: index + 1,
    })),
  };
}

test('Ekspor CSV dan codebook hanya memuat isi versi yang diminta', async () => {
  const creator = await login('creator.a@svara.local');

  const created = await call('/surveys', { method: 'POST', body: { title: 'Uji isolasi versi' }, cookie: creator });
  assert.equal(created.status, 201, created.text);
  const surveyId = created.body?.data?.survey?.id ?? '';
  assert.ok(surveyId, 'id survei harus ada');

  const save = (questions: unknown[]) =>
    call(`/surveys/${surveyId}`, {
      method: 'PUT',
      cookie: creator,
      body: { title: 'Uji isolasi versi', purpose: 'Menguji pemisahan versi', object_label: 'Karyawan', instructions: '', questions },
    });

  assert.equal((await save([likert('V1A', 'Pertanyaan versi satu')])).status, 200);
  const firstPublish = await call(`/surveys/${surveyId}/publish`, { method: 'POST', cookie: creator });
  assert.equal(firstPublish.status, 200, firstPublish.text);
  const firstVersion = firstPublish.body?.data?.version?.id ?? '';
  assert.ok(firstVersion.length > 0, 'versi pertama harus ada');

  assert.equal((await save([likert('V2A', 'Pertanyaan A'), likert('V2B', 'Pertanyaan B')])).status, 200);
  const secondPublish = await call(`/surveys/${surveyId}/publish`, { method: 'POST', cookie: creator });
  assert.equal(secondPublish.status, 200, secondPublish.text);
  const secondVersion = secondPublish.body?.data?.version?.id ?? '';
  assert.ok(secondVersion.length > 0 && secondVersion !== firstVersion, 'versi kedua harus berbeda');

  const v1Export = csvRows((await call(`/surveys/${surveyId}/export?version=${firstVersion}`, { cookie: creator })).text);
  const v1Header = v1Export[0]!;
  assert.deepEqual(v1Export.map((row) => row[0]), ['response_id'], 'versi 1 tidak boleh memuat baris respons versi lain');
  assert.ok(v1Header.includes('V1A'), `header versi 1 harus memuat V1A: ${v1Header.join(',')}`);
  assert.ok(!v1Header.includes('V2A') && !v1Header.includes('V2B'), `header versi 1 bocor: ${v1Header.join(',')}`);

  const v2Header = csvRows((await call(`/surveys/${surveyId}/export?version=${secondVersion}`, { cookie: creator })).text)[0]!;
  assert.ok(v2Header.includes('V2A') && v2Header.includes('V2B'), `header versi 2 kurang: ${v2Header.join(',')}`);

  const v1Codebook = await call(`/surveys/${surveyId}/export?format=codebook&version=${firstVersion}`, { cookie: creator });
  assert.deepEqual(new Set(csvRows(v1Codebook.text).slice(1).map((row) => row[1])).size, 1);
  assert.ok(csvRows(v1Codebook.text).slice(1).every((row) => row[1] === 'V1A'));

  const v2Codebook = await call(`/surveys/${surveyId}/export?format=codebook&version=${secondVersion}`, { cookie: creator });
  assert.deepEqual([...new Set(csvRows(v2Codebook.text).slice(1).map((row) => row[1]))].sort(), ['V2A', 'V2B']);

  // Tanpa filter versi, ekspor memakai versi terbit terbaru dan tidak mencampur versi lama.
  const latest = await call(`/surveys/${surveyId}/export`, { cookie: creator });
  assert.equal(latest.status, 200, latest.text);
  const latestRows = csvRows(latest.text);
  assert.ok(latestRows[0]!.includes('V2A') && !latestRows[0]!.includes('V1A'), `default harus versi terbaru: ${latestRows[0]!.join(',')}`);
  assert.deepEqual(latestRows.map((row) => row[0]), ['response_id']);

  const foreign = await call(`/surveys/${surveyId}/export?version=v_demo1_1`, { cookie: creator });
  assert.equal(foreign.status, 403, foreign.text);
  assert.equal(foreign.body?.code, 'forbidden_version');
});

test('SEC-03: izin ekspor grant tidak melewati allow_individual', async () => {
  const owner = await login('creator.a@svara.local');
  const admin = await login('admin@svara.local');
  const fullGrant = await login('officer@svara.local'); // g_02: can_read_individual=true, can_export=true
  const toggled = await call('/surveys/s_demo1/settings', {
    method: 'PUT',
    cookie: owner,
    body: { allowResults: true, allowIndividual: false },
  });
  assert.equal(toggled.status, 200, toggled.text);

  const denied = await call('/surveys/s_demo1/export?format=csv', { cookie: fullGrant });
  assert.equal(denied.status, 403, `CSV per-responden harus ditolak: ${denied.text}`);
  assert.equal(denied.body?.code, 'forbidden_export_individual');
  assert.ok(!denied.text.includes('respondent_id'), 'penolakan tidak boleh mengirim header CSV');

  assert.equal((await call('/surveys/s_demo1/export?format=csv', { cookie: owner })).status, 200, 'pemilik tidak terikat allow_individual');

  const codebook = await call('/surveys/s_demo1/export?format=codebook', { cookie: fullGrant });
  assert.equal(codebook.status, 200, codebook.text);
  assert.ok(codebook.text.includes('AD01'), 'kodebook memuat kode pertanyaan versi terbit terbaru');
  assert.ok(!/respondent_id|response_id|@svara\.local/.test(codebook.text), 'kodebook tidak boleh memuat identitas responden');

  // g_02 dimutasi test lain di api.test.ts; selalu dikembalikan penuh di finally.
  const denyCodebook = async (can_export: boolean) => {
    const set = await call('/admin/grants/u_petugas', {
      method: 'PUT',
      cookie: admin,
      body: { grants: [{ survey_id: 's_demo1', can_read_individual: true, can_export, can_read_free_text: true }] },
    });
    assert.equal(set.status, 200, set.text);
  };
  try {
    await denyCodebook(false);
    assert.equal((await call('/surveys/s_demo1/export?format=codebook', { cookie: fullGrant })).status, 403, 'kodebook butuh can_export');
    assert.equal((await call('/surveys/s_demo1/export', { cookie: fullGrant })).body?.code, 'forbidden_export');

    await denyCodebook(true);
    const individualDenied = await call('/surveys/s_demo1/export?format=csv', { cookie: fullGrant });
    assert.equal(individualDenied.status, 403, 'can_read_individual tanpa allow_individual tetap ditolak');
    assert.equal(individualDenied.body?.code, 'forbidden_export_individual');
  } finally {
    await denyCodebook(true);
  }

  const restoredSettings = await call('/surveys/s_demo1/settings', {
    method: 'PUT',
    cookie: owner,
    body: { allowResults: true, allowIndividual: true },
  });
  assert.equal(restoredSettings.status, 200, restoredSettings.text);
  const restored = await call('/surveys/s_demo1/export?format=csv', { cookie: fullGrant });
  assert.equal(restored.status, 200, restored.text);
  const header = csvRows(restored.text)[0]!;
  assert.ok(header.includes('respondent_id') && header.includes('identity_source'), `header CSV kurang: ${header.join(',')}`);
  assert.ok(csvRows(restored.text).length > 1, 'CSV harus memuat baris per-responden');

  const adminLogs = await call('/admin/audit', { cookie: admin });
  const logs = (adminLogs.body?.data ?? []) as unknown as Array<{
    action: string;
    outcome: string;
    object: string;
    metadata: string | null;
  }>;
  const rejection = logs.find((log) => log.action === 'Ekspor hasil' && log.outcome === 'ditolak' && log.object.startsWith('s_demo1'));
  assert.ok(rejection, 'penolakan ekspor harus tercatat di audit');
  assert.equal(JSON.parse(rejection.metadata ?? '{}').reason, 'forbidden_export_individual');
  const success = logs.find((log) => log.action === 'Ekspor CSV' && log.outcome === 'berhasil' && log.object.startsWith('s_demo1 · v1'));
  assert.ok(success, 'ekspor berhasil harus tercatat di audit');
  const meta = JSON.parse(success.metadata ?? '{}');
  assert.deepEqual(
    [meta.format, meta.filename, typeof meta.rows, meta.individual, 'columns' in meta, 'destination' in meta, 'accepts' in meta],
    ['csv', 'hasil-s_demo1-v1.csv', 'number', true, false, false, false],
  );
  // Kolom dan Accept dicatat sekali, di baris mulai yang ditulis sebelum byte pertama; baris itu tidak mengklaim selesai.
  const started = logs.find((log) => log.action === 'Mulai ekspor CSV' && log.object.startsWith('s_demo1 · v1'));
  assert.equal(started?.outcome, 'dimulai');
  const startedMeta = JSON.parse(started?.metadata ?? '{}');
  assert.deepEqual([startedMeta.columns.includes('respondent_id'), startedMeta.request_accept], [true, 'application/json']);
});
