import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { closeTestDatabase, resetTestDatabase } from './test-db.ts';
import { recordQueries } from './query-log.ts';
import { app } from '../app.ts';
import { buildBootstrap } from '../bootstrap.ts';
import { get, nowIso, run } from '../db.ts';
import { seedDemoIfEmpty } from '../seed-data.ts';
import type { AccountRow } from '../security.ts';

// PERF-13: anggaran performa yang menggagalkan CI bila angka Wave 6 (bootstrap 112 query,
// perjalanan 168 query) kembali. Angka dibaca dari merged `6191743`: bootstrap 15 query, perjalanan
// responden 31 query (`journey-queries.test.ts`). Durasi suite penuh sengaja tidak diukur di sini:
// suite tidak bisa mengukur dirinya sendiri, batas runner CI sudah menutupnya.
process.env.NODE_ENV = 'test';
process.env.SEED_DEMO = '1';
process.env.COOKIE_SECURE = '0';
await resetTestDatabase();
await seedDemoIfEmpty();

const BOOTSTRAP_P95_MS = 300;
const JOURNEY_QUERIES = 40;
const SURVEYS = 100;
const ITERATIONS = 20;
const QUESTIONS = 20;
const LIKERT = ['Sangat tidak setuju', 'Tidak setuju', 'Netral', 'Setuju', 'Sangat setuju'];

interface Envelope {
  data?: Record<string, unknown>;
  code?: string;
}

const listener = app.listen(0, '127.0.0.1');
const { promise: listening, resolve: onListening } = Promise.withResolvers<void>();
listener.once('listening', onListening);
await listening;
const address = listener.address();
const port = typeof address === 'object' && address ? address.port : 0;
const base = `http://127.0.0.1:${port}/api/v1`;

/** p95 dedekat (indeks ⌈0,95·n⌉-1 pada sampel terurut), bukan satu sampel tunggal. */
function p95(samples: number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.ceil(0.95 * sorted.length) - 1]!;
}

/** Bentuk balasan perjalanan responden; hanya medan yang dipakai anggaran ini. */
type Intro = { consent_version: string };
type Consent = { consent_id: string };
type Form = { questions: Array<{ code: string; option_ids: string[] }> };

let staff = '';
let respondent = '';

async function call(method: string, path: string, body?: unknown, key?: string): Promise<{ status: number; json: Envelope }> {
  const headers: Record<string, string> = { 'X-Svara-Client': 'web', Accept: 'application/json' };
  const cookie = [staff, respondent].filter(Boolean).join('; ');
  if (cookie) headers.Cookie = cookie;
  if (key) headers['Idempotency-Key'] = key;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie?.startsWith('svara_session=')) staff = setCookie.split(';')[0]!;
  if (setCookie?.startsWith('svara_respondent=')) respondent = setCookie.split(';')[0]!;
  return { status: response.status, json: (await response.json()) as Envelope };
}

function expect(result: { status: number; json: Envelope }, status: number, step: string): Envelope {
  assert.equal(result.status, status, `${step}: ${JSON.stringify(result.json)}`);
  return result.json;
}

async function consent(version: string) {
  return call('POST', `/public/surveys/${token}/consent`, {
    respondent_click: true,
    eligibility: true,
    version_id: version,
    guardian_evidence_ref: 'wali:anggaran-perf13',
  } as never);
}

const added: string[] = [];
let account: AccountRow;
let token = '';
let consentVersion = '';
let answers: Array<{ question_code: string; option_id: string }> = [];
/** Jumlah survei akun sebelum dataset anggaran ditambahkan; survei perjalanan ikut terhitung. */
let baselineSurveys = 0;

before(async () => {
  const seeded = await get<AccountRow>(
    "SELECT id, email, display_name, role, status, organization_id FROM accounts WHERE email = 'creator.a@svara.local'",
  );
  assert.ok(seeded, 'akun creator seed tersedia');
  account = seeded;

  // 100 survei milik akun yang bootstrap-nya diukur: dataset anggaran, bukan seed demo.
  const profile = (
    await get<{ profile_id: string }>('SELECT profile_id FROM surveys WHERE owner_id = ? ORDER BY id LIMIT 1', account.id)
  )?.profile_id;
  assert.ok(profile, 'survei contoh creator tersedia');
  const timestamp = nowIso();
  for (let index = 0; index < SURVEYS; index += 1) {
    const id = `s_perf13_${index}`;
    added.push(id);
    await run(
      `INSERT INTO surveys (id, owner_id, profile_id, title, purpose, object_label, instructions, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
      id,
      account.id,
      profile,
      `Survei anggaran ${index}`,
      'Uji anggaran performa',
      'Objek',
      'Isi.',
      timestamp,
      timestamp,
    );
  }

  // Perjalanan responden, disiapkan persis seperti PERF-05 (survei baru dari butir kerangka agar
  // urutan `code` versi cocok dengan pemetaan opsi→butir).
  expect(await call('POST', '/auth/login', { email: 'creator.a@svara.local', password: 'SvaraDemo123!' }), 200, 'login');
  const created = expect(await call('POST', '/surveys', { title: 'Anggaran PERF-13' }), 201, 'create').data as {
    survey: { id: string };
  };
  const survey = created.survey.id;
  const draft = expect(await call('GET', `/surveys/${survey}`), 200, 'detail').data as {
    questions: Array<{ id: string }>;
  };
  const questions = Array.from({ length: QUESTIONS }, (_value, index) => ({
    id: draft.questions[index]?.id,
    code: `Q${String(index + 1).padStart(2, '0')}`,
    type: 'likert',
    label: `Butir ${index + 1}`,
    section: 'Bagian 1',
    required: true,
    options: LIKERT.map((label, value) => ({ label, value: value + 1 })),
  }));
  expect(
    await call('PUT', `/surveys/${survey}`, { title: 'Anggaran PERF-13', purpose: 'Uji anggaran performa', questions }),
    200,
    'put',
  );
  const published = expect(await call('POST', `/surveys/${survey}/publish`), 200, 'publish').data as {
    publicLink: { token: string };
  };
  token = published.publicLink.token;
  staff = '';

  const intro = expect(await call('GET', `/public/surveys/${token}`), 200, 'intro');
  consentVersion = (intro.data as Intro).consent_version;
  const opened = expect(await consent(consentVersion), 201, 'consent');
  const consentId = (opened.data as Consent).consent_id;
  const form = expect(await call('GET', `/public/surveys/${token}/form?consent_id=${encodeURIComponent(consentId)}`), 200, 'form');
  const formData = form.data as Form;
  assert.equal(formData.questions.length, QUESTIONS);
  baselineSurveys = (await buildBootstrap(account)).surveys.length;
  answers = formData.questions.map((question) => ({ question_code: question.code, option_id: question.option_ids[0]! }));
});

after(async () => {
  // Submit perjalanan menyisakan respons, jadi grant pada survei itu harus dilepas lebih dulu.
  for (const id of added) await run('DELETE FROM access_grants WHERE survey_id = ?', id);
  if (added.length > 0) await run(`DELETE FROM surveys WHERE id IN (${added.map(() => '?').join(',')})`, ...added);
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  listener.close((error) => (error ? reject(error) : resolve()));
  await promise;
  await closeTestDatabase();
});

test('PERF-13: p95 bootstrap 100 survei di bawah anggaran', async () => {
  const first = await recordQueries(() => buildBootstrap(account));
  assert.equal(first.result.surveys.length, baselineSurveys, `survei terbaca: ${first.result.surveys.length}, dataset hanyalah penggeser skala`);

  const samples: number[] = [];
  for (let index = 0; index < ITERATIONS; index += 1) {
    const started = performance.now();
    await buildBootstrap(account);
    samples.push(performance.now() - started);
  }
  const measured = p95(samples);
  console.log(`PERF-13 bootstrap p95 ${measured.toFixed(1)} ms dari ${ITERATIONS} iterasi, anggaran ${BOOTSTRAP_P95_MS} ms`);
  assert.ok(
    measured <= BOOTSTRAP_P95_MS,
    `p95 bootstrap ${measured.toFixed(1)} ms melewati anggaran ${BOOTSTRAP_P95_MS} ms (sampel: ${samples.map((value) => value.toFixed(1)).join(', ')})`,
  );
});

test('PERF-13: query per perjalanan responden di bawah anggaran', async () => {
  const intro = expect(await call('GET', `/public/surveys/${token}`), 200, 'intro');
  const version = (intro.data as Intro).consent_version;
  const opening = expect(await consent(version), 201, 'consent');
  const consentId = (opening.data as Consent).consent_id;

  let queries = 0;
  for (const step of ['intro', 'consent', 'form', 'submit']) {
    const recorded = await recordQueries(() => {
      if (step === 'intro') return call('GET', `/public/surveys/${token}`);
      if (step === 'consent') return consent(version);
      if (step === 'form') return call('GET', `/public/surveys/${token}/form?consent_id=${encodeURIComponent(consentId)}`);
      return call('POST', `/public/surveys/${token}/responses`, { consent_id: consentId, answers }, 'perf13-submit');
    });
    assert.equal(recorded.result.status, step === 'consent' || step === 'submit' ? 201 : 200, `${step}: ${JSON.stringify(recorded.result.json)}`);
    queries += recorded.queries.length;
  }
  console.log(`PERF-13 perjalanan responden ${queries} query, anggaran ${JOURNEY_QUERIES}`);
  assert.ok(queries <= JOURNEY_QUERIES, `query per perjalanan ${queries} melewati anggaran ${JOURNEY_QUERIES}`);
});
