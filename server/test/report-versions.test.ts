import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { Client } from 'pg';

import { closeTestDatabase, databaseUrl, resetTestDatabase } from './test-db.ts';

const PORT = '3193';
const BASE = `http://127.0.0.1:${PORT}/api/v1`;

interface Result {
  status: number;
  body: Record<string, unknown> | null;
  text: string;
  headers: Headers;
}

async function call(
  path: string,
  options: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {},
): Promise<Result> {
  const headers = new Headers({ 'X-Svara-Client': 'web', Accept: 'application/json' });
  if (options.cookie) headers.set('Cookie', options.cookie);
  for (const [key, value] of Object.entries(options.headers ?? {})) headers.set(key, value);
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let body: Record<string, unknown> | null = null;
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : null;
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
  await promise;
}

async function login(email: string): Promise<string> {
  const result = await call('/auth/login', { method: 'POST', body: { email, password: 'SvaraDemo123!' } });
  assert.equal(result.status, 200, `login ${email}: ${result.text}`);
  return (result.headers.get('set-cookie') ?? '').split(';')[0]!;
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

interface SurveyDetail {
  versions: Array<{ number: number; status: string }>;
}

interface Payload {
  data?: {
    survey?: { id?: string };
    version?: { id?: string; number?: number };
    detail?: SurveyDetail;
    publicLink?: { token?: string };
    total?: number;
    items?: Array<{ code: string }>;
  };
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

test('Ringkasan per versi tidak memuat kiriman atau pertanyaan versi lain', async (t) => {
  const creator = await login('creator.a@svara.local');
  const created = await call('/surveys', { method: 'POST', body: { title: 'Uji ringkasan versi' }, cookie: creator });
  assert.equal(created.status, 201, created.text);
  const surveyId = (created.body as Payload).data?.survey?.id ?? '';
  assert.ok(surveyId, 'id survei harus ada');

  const save = (questions: unknown[]) =>
    call(`/surveys/${surveyId}`, {
      method: 'PUT',
      cookie: creator,
      body: { title: 'Uji ringkasan versi', purpose: 'Uji ringkasan', object_label: 'Karyawan', instructions: '', questions },
    });
  const publish = async () => {
    const result = await call(`/surveys/${surveyId}/publish`, { method: 'POST', cookie: creator });
    assert.equal(result.status, 200, result.text);
    return (result.body as Payload).data!;
  };
  const prepareSubmission = async (token: string, answers: Record<string, number>, key: string) => {
    const consent = await call(`/public/surveys/${token}/consent`, {
      method: 'POST',
      body: { respondent_click: true, eligibility: true, guardian_evidence_ref: 'Wali kelas 9A' },
    });
    assert.equal(consent.status < 300, true, consent.text);
    const consentId = (consent.body as { data?: { consent_id?: string } }).data?.consent_id ?? '';
    return () => call(`/public/surveys/${token}/responses`, {
      method: 'POST',
      cookie: consent.headers.get('set-cookie')?.split(';')[0],
      headers: { 'Idempotency-Key': key },
      body: { consent_id: consentId, answers: Object.entries(answers).map(([code, value]) => ({ question_code: code, text: String(value) })) },
    });
  };

  assert.equal((await save([likert('OLD1', 'Pertanyaan versi satu')])).status, 200);
  const first = await publish();
  const submitFirst = await prepareSubmission(first.publicLink!.token!, { OLD1: 4 }, 'kunci-versi-satu');
  assert.equal((await submitFirst()).status, 201);
  const lateFirst = await prepareSubmission(first.publicLink!.token!, { OLD1: 3 }, 'terlambat-versi-satu');

  assert.equal((await save([likert('NEW1', 'Pertanyaan versi dua'), likert('NEW2', 'Pertanyaan lainnya')])).status, 200);
  const second = await publish();
  const submitSecond = await prepareSubmission(second.publicLink!.token!, { NEW1: 5, NEW2: 2 }, 'kunci-versi-dua');
  assert.equal((await submitSecond()).status, 201);
  const lateSecond = await prepareSubmission(second.publicLink!.token!, { NEW1: 2, NEW2: 4 }, 'terlambat-versi-dua');

  await t.test('BF-04: publikasi versi kedua hanya menyisakan satu versi terbit', async () => {
    assert.deepEqual(second.detail?.versions.map(({ number, status }) => ({ number, status })), [
      { number: 1, status: 'closed' },
      { number: 2, status: 'published' },
    ]);
    const oldLink = await call(`/public/surveys/${first.publicLink!.token!}`);
    assert.equal(oldLink.status, 200, oldLink.text);
    assert.equal((oldLink.body as Payload).data?.version?.number, 2, 'tautan umum lama melayani versi terbit');
  });

  await t.test('BF-04: setelah penutupan, kedua tautan menolak kiriman baru', async () => {
    const closed = await call(`/surveys/${surveyId}/close`, { method: 'POST', cookie: creator });
    assert.equal(closed.status, 200, closed.text);
    const submissions = await Promise.all([lateFirst(), lateSecond()]);
    assert.deepEqual(submissions.map(({ status }) => status), [409, 409]);
    assert.deepEqual(submissions.map(({ body }) => body?.code), ['submission_closed', 'submission_closed']);
    const detail = closed.body?.data as SurveyDetail | undefined;
    assert.deepEqual(detail?.versions.map(({ status }) => status), ['closed', 'closed']);
    assert.equal((await submitFirst()).status, 200, 'retry idempoten tetap memulihkan bukti versi lama');
  });

  const emptyFor = async (versionId: string) => {
    const result = await call(`/surveys/${surveyId}/summary?version=${versionId}`, { cookie: creator });
    assert.equal(result.status, 200, result.text);
    return (result.body as { data: Payload['data'] }).data;
  };

  const v1 = await emptyFor(first.version!.id!);
  assert.equal(v1?.total, 1, 'versi 1 harus punya tepat satu kiriman');
  assert.deepEqual(v1?.items?.map((item) => item.code), ['OLD1']);

  const v2 = await emptyFor(second.version!.id!);
  assert.equal(v2?.total, 1, 'versi 2 harus punya tepat satu kiriman');
  assert.deepEqual(v2?.items?.map((item) => item.code).sort(), ['NEW1', 'NEW2']);

  const mismatched = await call(`/surveys/${surveyId}/summary?version=v_demo1_1`, { cookie: creator });
  assert.equal(mismatched.status, 403, mismatched.text);
  assert.equal((mismatched.body as { code?: string }).code, 'forbidden_version');
});

test('BF-04: penutupan memperbaiki beberapa versi terbit lama tanpa mengaktifkan tautan yang dicabut', async () => {
  const creator = await login('creator.a@svara.local');
  const published = await call('/surveys/s_demo1/publish', { method: 'POST', cookie: creator });
  assert.equal(published.status, 200, published.text);
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    // Modelkan data lama yang sudah memiliki dua versi berstatus terbit.
    await db.query("UPDATE survey_versions SET status = 'published', closed_at = NULL WHERE id = 'v_demo1_1'");
    await db.query("UPDATE public_links SET status = 'active' WHERE version_id = 'v_demo1_1'");
    await db.query("UPDATE public_links SET status = 'revoked' WHERE version_id = 'v_demo1_2'");

    const closed = await call('/surveys/s_demo1/close', { method: 'POST', cookie: creator });
    assert.equal(closed.status, 200, closed.text);
    const detail = closed.body?.data as SurveyDetail | undefined;
    assert.deepEqual(detail?.versions.map(({ status }) => status), ['closed', 'closed']);
    const links = await db.query<{ status: string }>("SELECT status FROM public_links WHERE survey_id = 's_demo1' ORDER BY version_id");
    assert.deepEqual(links.rows.map(({ status }) => status), ['closed', 'revoked']);
  } finally {
    await db.end();
  }
});
