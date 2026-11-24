import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { closeTestDatabase, resetTestDatabase } from './test-db.ts';
import { recordQueries } from './query-log.ts';

// PERF-05: perjalanan responden 20 butir memuat opsi version-wide sekali per request, bukan per
// pertanyaan. Angka acuan terukur pada API 20 butir (`preload.mjs`, query pool+client): 168 per
// perjalanan (intro 27 + consent 32 + form 28 + submit 81) -> 72 sesudah perbaikan. `recordQueries`
// hanya menangkap `pool.query` di luar transaksi, jadi hitungan di bawah lebih kecil (111 -> 35);
// yang dijaga di sini bentuk query-nya: satu baca `question_options` per request.
process.env.NODE_ENV = 'test';
process.env.SEED_DEMO = '1';
process.env.COOKIE_SECURE = '0';
await resetTestDatabase();
const { app } = await import('../app.ts');
const { seedDemoIfEmpty } = await import('../seed-data.ts');
await seedDemoIfEmpty();

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

/** Query yang menyentuh tabel `question_options`; satu-satunya bentuknya ada di `publicQuestions`. */
const optionReads = (queries: Array<{ sql: string }>) => queries.filter((query) => /\bFROM question_options\b/iu.test(query.sql));

interface Journey {
  path: string;
  step: string;
  queries: number;
  optionReads: number;
}

let token = '';
const journeys: Journey[] = [];

/**
 * Satu perjalanan penuh: intro, consent, form, submit — tiap langkah diukur sendiri. Pelaksanaan
 * perjalanan (menyiapkan consent+form lebih dulu) sengaja tidak diukur; yang dihitung hanya keempat
 * request journey itu sendiri, sama seperti `journey.cjs` audit.
 */
async function runJourney(step: string): Promise<void> {
  const intro = expect(await call('GET', `/public/surveys/${token}`), 200, `${step} intro`);
  const consentVersion = (intro.data as { consent_version: string }).consent_version;
  const consent = expect(
    await call('POST', `/public/surveys/${token}/consent`, {
      respondent_click: true,
      eligibility: true,
      version_id: consentVersion,
      guardian_evidence_ref: 'wali:ujian-perf05',
    } as never),
    201,
    `${step} consent`,
  );
  const consentId = (consent.data as { consent_id: string }).consent_id;
  const form = expect(await call('GET', `/public/surveys/${token}/form?consent_id=${encodeURIComponent(consentId)}`), 200, `${step} form`);
  const formData = form.data as { questions: Array<{ code: string; option_ids: string[] }> };
  assert.equal(formData.questions.length, QUESTIONS);
  const answers = formData.questions.map((question) => ({ question_code: question.code, option_id: question.option_ids[0] }));

  let journeyQueries = 0;
  let journeyReads = 0;
  for (const stepName of ['intro', 'consent', 'form', 'submit']) {
    const recorded = await recordQueries(() => {
      if (stepName === 'intro') return call('GET', `/public/surveys/${token}`);
      if (stepName === 'consent') {
        return call('POST', `/public/surveys/${token}/consent`, {
          respondent_click: true,
          eligibility: true,
          version_id: consentVersion,
          guardian_evidence_ref: 'wali:ujian-perf05',
        } as never);
      }
      if (stepName === 'form') return call('GET', `/public/surveys/${token}/form?consent_id=${encodeURIComponent(consentId)}`);
      return call('POST', `/public/surveys/${token}/responses`, { consent_id: consentId, answers }, `perf05-${step}`);
    });
    assert.equal(recorded.result.status, stepName === 'intro' || stepName === 'form' ? 200 : 201, `${step} ${stepName}: ${JSON.stringify(recorded.result.json)}`);
    journeyQueries += recorded.queries.length;
    journeyReads += optionReads(recorded.queries).length;
  }
  journeys.push({ path: 'intro+consent+form+submit', step, queries: journeyQueries, optionReads: journeyReads });
}

before(async () => {
  expect(await call('POST', '/auth/login', { email: 'creator.a@svara.local', password: 'SvaraDemo123!' }), 200, 'login');
  // Survei baru, bukan seed demo (seed menarik persetujuan wali). Butir dibuat dari ID yang ada agar
  // sesuai urutan `code` versi, sehingga pemetaan opsi→butir tetap bisa diverifikasi.
  const created = expect(await call('POST', '/surveys', { title: 'Perjalanan PERF-05' }), 201, 'create').data as {
    survey: { id: string };
  };
  const survey = created.survey.id;
  const draft = expect(await call('GET', `/surveys/${survey}`), 200, 'detail').data as {
    questions: Array<{ id: string }>;
  };
  const likert = Array.from({ length: QUESTIONS }, (_value, index) => ({
    id: draft.questions[index]?.id,
    code: `Q${String(index + 1).padStart(2, '0')}`,
    type: 'likert',
    label: `Butir ${index + 1}`,
    section: 'Bagian 1',
    required: true,
    options: LIKERT.map((label, value) => ({ label, value: value + 1 })),
  }));
  expect(
    await call('PUT', `/surveys/${survey}`, { title: 'Perjalanan PERF-05', purpose: 'Uji jumlah query', questions: likert }),
    200,
    'put',
  );
  const published = expect(await call('POST', `/surveys/${survey}/publish`), 200, 'publish').data as {
    publicLink: { token: string };
  };
  token = published.publicLink.token;
  staff = '';
});

after(async () => {
  listener.close();
  await closeTestDatabase();
});

test('PERF-05: perjalanan 20 butir membaca question_options sekali per request', async () => {
  await runJourney('golden');
  const journey = journeys.at(-1)!;
  assert.equal(journey.queries, 35, `query per perjalanan: ${journey.queries}`);
  assert.equal(journey.optionReads, 4, 'satu baca question_options per request (intro, consent, form, submit)');
});
