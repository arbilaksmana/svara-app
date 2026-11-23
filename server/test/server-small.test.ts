import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { after, before, mock, test } from 'node:test';
import { closeTestDatabase, resetTestDatabase } from './test-db.ts';
import type { QuestionPayload, SurveyPayload } from '../../src/lib/api.ts';

process.env.NODE_ENV = 'test';
process.env.SEED_DEMO = '1';
process.env.SEED_PASSWORD = 'SvaraDemo123!';

const { app } = await import('../app.ts');
const { all, get, run } = await import('../db.ts');
const { seedDemoIfEmpty } = await import('../seed-data.ts');
const { rateLimit, rateLimitBucketCount, trustProxySetting } = await import('../security.ts');
const { anonymizeExpiredDataRequests } = await import('../data-request-retention.ts');

const DEMO_PASSWORD = 'SvaraDemo123!';
const ACTIVE_ACCOUNTS = ['admin@svara.local', 'creator.a@svara.local', 'creator.b@svara.local', 'officer@svara.local', 'orgadmin@svara.local'];
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
/** Batas terdokumentasi di README: pengaman kasar kegagalan login per alamat klien per 15 menit. */
const LOGIN_FAILURES_PER_IP = 200;
/** Batas terdokumentasi di README: kegagalan login per alamat klien + email per 15 menit. */
const LOGIN_FAILURES_PER_EMAIL = 8;
/** Batas terdokumentasi di README: kunci aktif per jenis limiter (awalan kunci). */
const KEYS_PER_KIND = 50_000;
const DAY_MS = 86_400_000;

let server: Server | undefined;
let base = '';
let creatorA = '';
let creatorB = '';

interface Result {
  status: number;
  json: { data?: unknown; error?: string; code?: string } & Record<string, unknown>;
  text: string;
  headers: Headers;
}

async function request(
  path: string,
  options: { method?: string; body?: unknown; rawBody?: string; cookie?: string; headers?: Record<string, string> } = {},
): Promise<Result> {
  const hasBody = options.body !== undefined || options.rawBody !== undefined;
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? (hasBody ? 'POST' : 'GET'),
    headers: {
      Accept: 'application/json',
      'X-Svara-Client': 'web',
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...options.headers,
    },
    body: options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
  });
  const text = await response.text();
  let json: Result['json'] = {};
  try {
    json = text ? (JSON.parse(text) as Result['json']) : {};
  } catch {
    json = {};
  }
  return { status: response.status, json, text, headers: response.headers };
}

function login(email: string, password: string, headers: Record<string, string> = {}): Promise<Result> {
  // Payload sama dengan `login()` di src/lib/api.ts.
  return request('/auth/login', { body: { email, password }, headers });
}

async function session(email: string): Promise<string> {
  const result = await login(email, DEMO_PASSWORD);
  assert.equal(result.status, 200, `login ${email}: ${result.text}`);
  return result.headers.get('set-cookie')!.split(';')[0]!;
}

async function data<T>(cookie: string, path: string, method = 'GET', body?: unknown): Promise<T> {
  const result = await request(path, { method, body, cookie });
  assert.ok(result.status < 400, `${method} ${path}: ${result.status} ${result.text.slice(0, 300)}`);
  return result.json.data as T;
}

async function failedLoginAudits(): Promise<number> {
  const row = await get<{ count: number }>("SELECT COUNT(*)::int AS count FROM audit_logs WHERE action = 'Masuk' AND outcome = 'gagal'");
  return row?.count ?? 0;
}

function likert(code: string, label: string): QuestionPayload {
  return {
    code, type: 'likert', required: true, section: 'Layanan', label, hint: null,
    group_code: null, dimension_code: null, direction: null,
    options: ['Sangat tidak setuju', 'Tidak setuju', 'Netral', 'Setuju', 'Sangat setuju'].map((option, index) => ({ label: option, value: index + 1 })),
  };
}

function surveyPayload(title: string, firstLabel: string): SurveyPayload {
  return {
    title,
    purpose: 'Mengetahui pengalaman warga sekolah terhadap layanan yang tersedia.',
    object_label: 'Layanan sekolah',
    instructions: 'Pilih satu jawaban untuk setiap pernyataan.',
    questions: [likert('LY01', firstLabel), likert('LY02', 'Petugas membantu dengan ramah.')],
  };
}

interface Published {
  version: { id: string; number: number };
  publicLink: { token: string };
}

/** Survei terbit lewat alur pengelola (buat, simpan, terbitkan); `revise` mengubah instrumen lalu terbit ulang. */
async function publishedSurvey(cookie: string, title: string) {
  const created = await data<{ survey: { id: string } }>(cookie, '/surveys', 'POST', { title, owner_scope: 'organization' });
  const id = created.survey.id;
  await data(cookie, `/surveys/${id}`, 'PUT', surveyPayload(title, 'Koleksi buku sesuai kebutuhan belajar.'));
  const first = await data<Published>(cookie, `/surveys/${id}/publish`, 'POST');
  const save = (label: string) => data(cookie, `/surveys/${id}`, 'PUT', surveyPayload(title, label));
  const revise = async (label: string) => {
    await save(label);
    return data<Published>(cookie, `/surveys/${id}/publish`, 'POST');
  };
  return { id, first, save, revise };
}

/** Alur responden lengkap: pengantar → persetujuan → kirim. */
async function respond(token: string, key: string, answers: [string, string]): Promise<void> {
  const intro = await request(`/public/surveys/${token}`);
  const consent = await request(`/public/surveys/${token}/consent`, {
    body: {
      version_id: (intro.json.data as { consent_version: string }).consent_version,
      respondent_click: true,
      eligibility: true,
      guardian_evidence_ref: 'Surat izin wali kelas 8A',
    },
  });
  assert.equal(consent.status, 201, consent.text);
  const sent = await request(`/public/surveys/${token}/responses`, {
    body: {
      consent_id: (consent.json.data as { consent_id: string }).consent_id,
      answers: [{ question_code: 'LY01', text: answers[0] }, { question_code: 'LY02', text: answers[1] }],
    },
    headers: { Cookie: consent.headers.get('set-cookie')!.split(';')[0]!, 'Idempotency-Key': key },
  });
  assert.equal(sent.status, 201, sent.text);
}

before(async () => {
  await resetTestDatabase();
  await seedDemoIfEmpty();
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}/api/v1`;
  creatorA = await session('creator.a@svara.local');
  creatorB = await session('creator.b@svara.local');
});

after(async () => {
  if (server) {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
    await promise;
  }
  await closeTestDatabase();
});

/* ---------------- NR-02: galat body-parser ---------------- */

test('NR-02: body > 512 KB → 413 dan JSON rusak → 400, tanpa console.error/stack', async () => {
  const errors = mock.method(console, 'error', () => {});
  const warnings = mock.method(console, 'warn', () => {});
  try {
    const big = await request('/data-requests', { body: { type: 'access', contact: 'wali@contoh.test', note: 'N'.repeat(600_000) } });
    const broken = await request('/auth/login', { rawBody: '{"email":"creator.a@svara.local","password":' });
    const truncated = await request('/data-requests', { rawBody: '{"type":"access","contact":"wali@contoh.test"' });
    const observed = [big, broken, truncated].map((result) => ({
      status: result.status,
      code: result.json.code,
      error: typeof result.json.error,
      noStore: result.headers.get('cache-control'),
    }));
    assert.deepEqual(observed, [
      { status: 413, code: 'payload_too_large', error: 'string', noStore: 'no-store' },
      { status: 400, code: 'invalid_json', error: 'string', noStore: 'no-store' },
      { status: 400, code: 'invalid_json', error: 'string', noStore: 'no-store' },
    ]);
    assert.equal(errors.mock.callCount(), 0, `console.error: ${JSON.stringify(errors.mock.calls.map((call) => String(call.arguments[0])))}`);
    for (const call of warnings.mock.calls) {
      const line = call.arguments.map(String).join(' ');
      assert.doesNotMatch(line, /\n\s+at /, `peringatan tanpa stack: ${line}`);
    }
  } finally {
    errors.mock.restore();
    warnings.mock.restore();
  }
  // Body di bawah batas tetap sampai ke validasi route.
  const nearLimit = await login(`${'a'.repeat(400_000)}@x.test`, 'x');
  assert.equal(nearLimit.status, 422, nearLimit.text);
  assert.equal(nearLimit.json.code, 'validation_error');
});

/* ---------------- NR-03: retensi permintaan data ---------------- */

test('NR-03: retensi menganonimkan outcome_note dan kanal balasan berisi kontak; anonymized_at = waktu job', async () => {
  const ago = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();
  const insert = (id: string, days: number, fields: Record<string, string | null>) =>
    run(
      `INSERT INTO data_requests (id, type, contact, note, status, created_at, updated_at, handled_by, outcome_note,
                                  responded_at, responded_by, response_channel, anonymized_at)
       VALUES (?, 'access', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      fields.contact ?? 'pemohon@contoh.test',
      fields.note ?? null,
      fields.status ?? 'handled',
      ago(days),
      ago(days - 3),
      fields.handled_by ?? 'u_admin',
      fields.outcome_note ?? null,
      fields.responded_at ?? ago(days - 3),
      fields.responded_by ?? 'u_admin',
      fields.response_channel ?? null,
      fields.anonymized_at ?? null,
    );
  await insert('dr_nr03_bebas', 400, {
    contact: 'tua@contoh.test',
    note: 'Nama saya Budi, NIS 12345',
    outcome_note: 'Salinan data dikirim ke tua@contoh.test',
    response_channel: 'email tua@contoh.test',
  });
  await insert('dr_nr03_kode', 500, {
    contact: '0812-3456-7890',
    outcome_note: 'Ditelepon ke 0812-3456-7890, pemohon menerima penjelasan',
    response_channel: 'phone',
  });
  // Baris yang ditandai job versi sebelumnya: kontak sudah anon, tetapi catatan dan kanal masih memuat kontak.
  const previousCutoff = ago(400 + 365);
  await insert('dr_nr03_parsial', 800, {
    contact: 'anon:0000000000000000',
    outcome_note: 'Dibalas lewat WhatsApp 0813-1111-2222',
    response_channel: 'WA 0813-1111-2222',
    anonymized_at: previousCutoff,
  });
  await insert('dr_nr03_baru', 100, {
    contact: 'baru@contoh.test',
    note: 'Mohon hapus data anak saya',
    outcome_note: 'Dibalas ke baru@contoh.test',
    response_channel: 'email',
  });

  const startedAt = Date.now();
  const first = await anonymizeExpiredDataRequests();
  const finishedAt = Date.now();
  assert.equal(first.anonymized, 3, JSON.stringify(first));

  const rows = await all<Record<string, string | null>>(
    "SELECT * FROM data_requests WHERE id LIKE 'dr_nr03_%' ORDER BY id",
  );
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
  const ranAt = (value: string | null | undefined) => {
    const time = value ? Date.parse(value) : NaN;
    return time >= startedAt - 1 && time <= finishedAt + 1;
  };
  for (const id of ['dr_nr03_bebas', 'dr_nr03_kode', 'dr_nr03_parsial']) {
    const row = byId[id]!;
    const contacts = JSON.stringify([row.contact, row.note, row.outcome_note, row.response_channel]);
    assert.doesNotMatch(contacts, /@contoh\.test|0812|0813/, `${id} masih memuat kontak: ${contacts}`);
    assert.match(row.contact ?? '', /^anon:[0-9a-f]{16}$/, id);
    assert.equal(row.note, null, id);
    assert.equal(row.outcome_note, null, id);
    assert.ok(ranAt(row.anonymized_at), `${id} anonymized_at = waktu job, bukan cutoff: ${row.anonymized_at}`);
    assert.ok(ranAt(row.updated_at), `${id} updated_at = waktu job: ${row.updated_at}`);
    // Jejak balasan dan identitas baris tetap.
    assert.equal(row.status, 'handled', id);
    assert.equal(row.type, 'access', id);
    assert.equal(row.responded_by, 'u_admin', id);
    assert.ok(row.responded_at, id);
    assert.ok(row.response_channel, `${id} kanal balasan tetap tercatat sebagai bukti balasan`);
  }
  assert.equal(byId.dr_nr03_kode!.response_channel, 'phone', 'kode kanal dari UI tidak memuat kontak dan dipertahankan');
  const fresh = byId.dr_nr03_baru!;
  assert.deepEqual(
    [fresh.contact, fresh.note, fresh.outcome_note, fresh.response_channel, fresh.anonymized_at],
    ['baru@contoh.test', 'Mohon hapus data anak saya', 'Dibalas ke baru@contoh.test', 'email', null],
  );

  const second = await anonymizeExpiredDataRequests();
  assert.equal(second.anonymized, 0, 'putaran kedua tidak menyentuh apa pun');
  const again = await all<{ id: string; anonymized_at: string; updated_at: string }>(
    "SELECT id, anonymized_at, updated_at FROM data_requests WHERE id LIKE 'dr_nr03_%' AND anonymized_at IS NOT NULL ORDER BY id",
  );
  assert.deepEqual(
    again,
    rows.filter((row) => row.anonymized_at).map((row) => ({ id: row.id, anonymized_at: row.anonymized_at, updated_at: row.updated_at })),
  );
});

/* ---------------- NR-07: versi default ringkasan/jawaban/ekspor ---------------- */

test('NR-07: survei tertutup tanpa ?version memakai versi terakhir yang pernah terbit', async () => {
  const survey = await publishedSurvey(creatorA, 'Evaluasi layanan perpustakaan sekolah');
  await respond(survey.first.publicLink.token, 'nr07-perpus-v1-0001', ['4', '5']);
  const second = await survey.revise('Jam buka perpustakaan sesuai jadwal belajar.');
  assert.equal(second.version.number, 2);
  await respond(second.publicLink.token, 'nr07-perpus-v2-0001', ['3', '4']);
  await respond(second.publicLink.token, 'nr07-perpus-v2-0002', ['5', '5']);
  await data(creatorA, `/surveys/${survey.id}/close`, 'POST');

  const summary = await request(`/surveys/${survey.id}/summary`, { cookie: creatorA });
  assert.equal(summary.status, 200, summary.text);
  const summaryData = summary.json.data as { version_id: string; number: number; total: number };
  assert.deepEqual([summaryData.version_id, summaryData.number, summaryData.total], [second.version.id, 2, 2]);

  const responses = await request(`/surveys/${survey.id}/responses`, { cookie: creatorA });
  assert.equal(responses.status, 200, responses.text);
  const rows = responses.json.data as Array<{ version_id: string }>;
  assert.deepEqual(rows.map((row) => row.version_id), [second.version.id, second.version.id]);

  const csv = await fetch(`${base}/surveys/${survey.id}/export?format=csv`, { headers: { Cookie: creatorA } });
  const csvText = await csv.text();
  assert.equal(csv.status, 200, csvText.slice(0, 300));
  assert.match(csv.headers.get('content-disposition') ?? '', new RegExp(`hasil-${survey.id}-v2\\.csv`));
  assert.equal(csvText.trim().split('\r\n').length, 3, 'header + 2 respons v2');
  const codebook = await fetch(`${base}/surveys/${survey.id}/export?format=codebook`, { headers: { Cookie: creatorA } });
  assert.equal(codebook.status, 200);
  assert.match(codebook.headers.get('content-disposition') ?? '', new RegExp(`kodebook-${survey.id}-v2\\.csv`));
  await codebook.arrayBuffer();

  const v1 = await request(`/surveys/${survey.id}/summary?version=${survey.first.version.id}`, { cookie: creatorA });
  assert.equal(v1.status, 200, v1.text);
  assert.deepEqual([(v1.json.data as { number: number }).number, (v1.json.data as { total: number }).total], [1, 1]);

  // Izin tidak berubah: akun organisasi lain tetap ditolak di ketiga endpoint.
  const denied = await Promise.all(
    ['summary', 'responses', 'export?format=csv'].map(async (path) => {
      const result = await request(`/surveys/${survey.id}/${path}`, { cookie: creatorB });
      return [result.status, result.json.code];
    }),
  );
  assert.deepEqual(denied, [[403, 'forbidden_summary'], [403, 'forbidden_individual'], [403, 'forbidden_export']]);
});

test('NR-07: survei diarsipkan memakai versi terbit terakhir, bukan draf yang ikut ditutup; belum pernah terbit tetap 409', async () => {
  const survey = await publishedSurvey(creatorA, 'Survei kepuasan kantin sekolah');
  await respond(survey.first.publicLink.token, 'nr07-kantin-v1-0001', ['2', '3']);
  await survey.save('Menu kantin bergizi dan bervariasi.');
  await data(creatorA, `/surveys/${survey.id}/archive`, 'POST');
  const versions = await all<{ number: number; status: string; published: boolean }>(
    'SELECT number, status, published_at IS NOT NULL AS published FROM survey_versions WHERE survey_id = ? ORDER BY number',
    survey.id,
  );
  assert.deepEqual(versions, [
    { number: 1, status: 'closed', published: true },
    { number: 2, status: 'closed', published: false },
  ]);
  const summary = await request(`/surveys/${survey.id}/summary`, { cookie: creatorA });
  assert.equal(summary.status, 200, summary.text);
  assert.deepEqual(
    [(summary.json.data as { number: number }).number, (summary.json.data as { total: number }).total],
    [1, 1],
  );

  const draft = await data<{ survey: { id: string } }>(creatorA, '/surveys', 'POST', { title: 'Draf angket ekstrakurikuler', owner_scope: 'organization' });
  await data(creatorA, `/surveys/${draft.survey.id}`, 'PUT', surveyPayload('Draf angket ekstrakurikuler', 'Pilihan ekskul beragam.'));
  for (const path of ['summary', 'responses', 'export?format=csv']) {
    const result = await request(`/surveys/${draft.survey.id}/${path}`, { cookie: creatorA });
    assert.deepEqual([result.status, result.json.code], [409, 'no_published_version'], path);
  }
});

/* ---------------- SEC-05 (sisa): batas login per alamat klien ---------------- */

test('SEC-05: login dibatasi per alamat + akun; login berhasil dan percobaan yang sudah ditolak per email tidak menghabiskan kuota', async () => {
  const trustProxy = app.get('trust proxy');
  // Ingress tepercaya di host yang sama (TRUST_PROXY=loopback) memberi tiap klien alamatnya sendiri.
  app.set('trust proxy', trustProxySetting('loopback'));
  try {
    const office = { 'X-Forwarded-For': '198.51.100.40' };
    const successes: number[] = [];
    for (let round = 0; round < 7; round += 1) {
      for (const email of ACTIVE_ACCOUNTS) successes.push((await login(email, DEMO_PASSWORD, office)).status);
    }
    assert.deepEqual(successes, Array(35).fill(200), '35 login berhasil dari satu kantor');

    const auditBefore = await failedLoginAudits();
    // 24 email berbeda, masing-masing di bawah batas 8 per alamat+email; kegagalan ke-25 kena pengaman kasar per alamat.
    const statuses: number[] = [];
    for (let i = 0; i < 24; i += 1) {
      for (let round = 0; round < LOGIN_FAILURES_PER_EMAIL; round += 1) {
        statuses.push((await login(`staf.${i}@sekolah.contoh`, 'Salah-Sekali-2026!', office)).status);
      }
    }
    assert.deepEqual(statuses, Array(24 * LOGIN_FAILURES_PER_EMAIL).fill(401), 'kegagalan email berbeda tidak saling mengunci');
    assert.equal(await failedLoginAudits(), auditBefore + 24 * LOGIN_FAILURES_PER_EMAIL);
    const correct = await login('creator.a@svara.local', DEMO_PASSWORD, office);
    assert.equal(correct.status, 200, 'akun lain dari alamat yang sama tidak ikut terkunci oleh kegagalan email lain');

    const lab = { 'X-Forwarded-For': '198.51.100.41' };
    const target: number[] = [];
    for (let i = 0; i < 20; i += 1) target.push((await login('kepala.lab@sekolah.contoh', 'Tebak-Sandi-2026!', lab)).status);
    assert.deepEqual(target, [...Array(LOGIN_FAILURES_PER_EMAIL).fill(401), ...Array(20 - LOGIN_FAILURES_PER_EMAIL).fill(429)], 'batas per email 8');
    const perEmail = await login('kepala.lab@sekolah.contoh', 'Tebak-Sandi-2026!', lab);
    assert.deepEqual([perEmail.status, perEmail.json.code], [429, 'rate_limited']);

    const rest: number[] = [];
    for (let i = 0; i <= LOGIN_FAILURES_PER_IP - LOGIN_FAILURES_PER_EMAIL; i += 1) {
      rest.push((await login(`guru.${i}@sekolah.contoh`, 'Tebak-Sandi-2026!', lab)).status);
    }
    assert.deepEqual(rest, [...Array(LOGIN_FAILURES_PER_IP - LOGIN_FAILURES_PER_EMAIL).fill(401), 429], 'hanya kegagalan kredensial yang dihitung per alamat');
    const perIp = await login('guru.baru@sekolah.contoh', 'Tebak-Sandi-2026!', lab);
    assert.deepEqual(
      { status: perIp.status, error: perIp.json.error, code: perIp.json.code },
      { status: 429, error: perEmail.json.error, code: perEmail.json.code },
      'respons batas kasar per alamat sama dengan batas per email',
    );

    assert.equal((await login('orgadmin@svara.local', DEMO_PASSWORD, { 'X-Forwarded-For': '198.51.100.42' })).status, 200, 'klien lain tidak terdampak');
  } finally {
    app.set('trust proxy', trustProxy);
  }
});

test('SEC-05: 300 email unik dari satu koneksi langsung berhenti di pengaman kasar per alamat; audit dan kunci limiter terbatas', async () => {
  const auditBefore = await failedLoginAudits();
  const keysBefore = rateLimitBucketCount();
  const statuses: Record<number, number> = {};
  for (let i = 0; i < 300; i += 1) {
    const result = await login(`u${i}-${'z'.repeat(200)}@x.test`, 'salah', {});
    statuses[result.status] = (statuses[result.status] ?? 0) + 1;
  }
  assert.deepEqual(statuses, { 401: LOGIN_FAILURES_PER_IP, 429: 300 - LOGIN_FAILURES_PER_IP });
  assert.equal(await failedLoginAudits() - auditBefore, LOGIN_FAILURES_PER_IP);
  const keysAdded = rateLimitBucketCount() - keysBefore;
  assert.ok(keysAdded <= LOGIN_FAILURES_PER_IP + 1, `kunci limiter bertambah ${keysAdded}`);
});

/* ---------------- NEW-PO-01: kerja limiter per panggilan dan batas kunci ---------------- */

/** Banjir terjadi dalam satu saat jam limiter, seperti klien cepat; tidak ada entri yang sempat kedaluwarsa. */
function atFrozenClock(fn: () => void): void {
  const dateNow = Date.now;
  const frozen = dateNow();
  Date.now = () => frozen;
  try {
    fn();
  } finally {
    Date.now = dateNow;
  }
}

test('NEW-PO-01: biaya rateLimit per panggilan tidak tumbuh dengan 20.000 kunci login aktif', () => {
  const calls = 2_000;
  const sample = (label: string) => {
    const started = performance.now();
    for (let i = 0; i < calls; i += 1) {
      rateLimit({ key: `login:198.18.200.${i % 250}:${label}-${i}@peserta.contoh`, limit: 8, windowMs: LOGIN_WINDOW_MS });
    }
    return (performance.now() - started) / calls;
  };
  const start = rateLimitBucketCount();
  const small = sample('awal');
  for (let i = rateLimitBucketCount() - start; i < 20_000; i += 1) {
    rateLimit({ key: `login:198.18.${(i >> 8) & 255}.${i & 255}:guru.${i}@sekolah.contoh`, limit: 8, windowMs: LOGIN_WINDOW_MS });
  }
  const active = rateLimitBucketCount();
  assert.ok(active - start >= 20_000, `kunci aktif: ${active - start}`);
  const loaded = sample('penuh');
  assert.ok(
    loaded <= 0.03,
    `rata-rata per panggilan dengan ${active} kunci aktif ${loaded.toFixed(4)} ms (dengan ${start + calls} kunci: ${small.toFixed(4)} ms)`,
  );
});

test('NEW-PO-01: banjir token consent dibatasi per jenis kunci dan tidak mereset bucket login', () => {
  const victim = 'login:198.51.100.60:bendahara@sekolah.contoh';
  for (let i = 0; i < 7; i += 1) assert.equal(rateLimit({ key: victim, limit: 8, windowMs: LOGIN_WINDOW_MS }), true);
  const start = rateLimitBucketCount();
  // Token dari path URL dipilih klien; tiap token baru adalah kunci baru (POST /public/surveys/:token/consent).
  atFrozenClock(() => {
    for (let i = 0; i < KEYS_PER_KIND + 5_000; i += 1) {
      rateLimit({ key: `consent:203.0.113.9:pl_${i.toString(36).padStart(16, 'q')}`, limit: 30, windowMs: 60_000 });
    }
  });
  const added = rateLimitBucketCount() - start;
  assert.ok(added <= KEYS_PER_KIND, `kunci consent bertambah ${added}, batas ${KEYS_PER_KIND}`);
  assert.equal(rateLimit({ key: victim, limit: 8, windowMs: LOGIN_WINDOW_MS }), true, 'percobaan ke-8 korban tetap dihitung dari 7');
  assert.equal(rateLimit({ key: victim, limit: 8, windowMs: LOGIN_WINDOW_MS }), false, 'percobaan ke-9 korban ditolak');
});

test('NEW-PO-01: banjir kunci login baru tidak membuka ulang bucket yang sudah mencapai batas', () => {
  const blocked = 'login:198.51.100.61:kepala.sekolah@sekolah.contoh';
  for (let i = 0; i < 8; i += 1) assert.equal(rateLimit({ key: blocked, limit: 8, windowMs: LOGIN_WINDOW_MS }), true);
  assert.equal(rateLimit({ key: blocked, limit: 8, windowMs: LOGIN_WINDOW_MS }), false);
  atFrozenClock(() => {
    for (let i = 0; i < KEYS_PER_KIND + 5_000; i += 1) {
      rateLimit({ key: `login:198.51.${(i >> 8) & 255}.${i & 255}:tebakan${i}@contoh.test`, limit: 8, windowMs: LOGIN_WINDOW_MS });
    }
  });
  assert.equal(rateLimit({ key: blocked, limit: 8, windowMs: LOGIN_WINDOW_MS }), false, 'bucket yang terblokir tetap terblokir');
});

test('NEW-PO-01: kunci panjang dengan awalan sama tetap bucket terpisah', () => {
  const prefix = `consent:203.0.113.10:pl_${'x'.repeat(4_000)}`;
  for (let i = 0; i < 30; i += 1) assert.equal(rateLimit({ key: `${prefix}-a`, limit: 30, windowMs: 60_000 }), true);
  assert.equal(rateLimit({ key: `${prefix}-a`, limit: 30, windowMs: 60_000 }), false);
  assert.equal(rateLimit({ key: `${prefix}-b`, limit: 30, windowMs: 60_000 }), true, 'akhiran berbeda tidak berbagi penghitung');
});

/* ---------------- Jalur upgrade dari main (95eafa3, skema 009) ---------------- */

test('Upgrade main → kini: survei yang ditutup/diarsipkan main dan permintaan data main mengikuti versi default dan retensi baru', async () => {
  const { migrate, resetSchema } = await import('../migrate.ts');
  await resetSchema();
  await migrate({ to: '009' });
  // Bentuk data yang ditulis kode main; nama dan teks sengaja tidak sama dengan seed demo.
  const org = 'org_3b8e1d0c5a7f4926';
  await run(
    `INSERT INTO organizations (id, name, organization_type, policy_url, terms_url, retention_days, data_request_contact,
       cross_border_transfer, notice_version, created_at, respondent_age_category, consent_mode)
     VALUES (?, 'Yayasan Pendidikan Lembah Hijau', 'school', '/kebijakan', '/ketentuan', NULL, NULL, NULL, '1.0',
             '2026-08-01T01:00:00.000Z', 'adult', 'self')`,
    org,
  );
  await run(
    `INSERT INTO accounts (id, email, display_name, role, status, password_hash, created_at, organization_id)
     VALUES ('u_wakasek', 'wakasek@lembahhijau.example.org', 'Wakasek Kurikulum', 'creator', 'active', 'scrypt$x$y',
             '2026-08-02T01:00:00.000Z', ?)`,
    org,
  );
  await run(
    `INSERT INTO profiles (id, organization_name, organization_type, respondent_age_category, consent_mode, policy_url,
       terms_url, retention_days, data_request_contact, cross_border_transfer, notice_version, synthetic_placeholder)
     VALUES ('p_lembah', 'Yayasan Pendidikan Lembah Hijau', 'school', 'adult', 'self', '/kebijakan', '/ketentuan', 365,
             'dpo@lembahhijau.example.org', 0, '1.0', 0)`,
  );
  const surveys = [
    // Ditutup oleh close main: satu-satunya versi terbit menjadi 'closed' dengan published_at terisi.
    { id: 's_c1a7e3f905b2d846', title: 'Angket kepuasan layanan tata usaha', status: 'closed', versions: [
      { number: 1, status: 'closed', published_at: '2026-08-10T02:00:00.000Z', closed_at: '2026-09-30T02:00:00.000Z' },
    ] },
    // Diarsipkan main setelah diedit: v1 pernah terbit, draf v2 ikut 'closed' tanpa published_at.
    { id: 's_8d4b2f6a1e9c0357', title: 'Survei minat ekstrakurikuler', status: 'archived', versions: [
      { number: 1, status: 'closed', published_at: '2026-08-12T02:00:00.000Z', closed_at: '2026-10-01T02:00:00.000Z' },
      { number: 2, status: 'closed', published_at: null, closed_at: '2026-10-01T02:00:00.000Z' },
    ] },
  ];
  for (const survey of surveys) {
    await run(
      `INSERT INTO surveys (id, owner_id, profile_id, title, purpose, object_label, instructions, status, created_at,
         updated_at, current_version_id, organization_id)
       VALUES (?, 'u_wakasek', 'p_lembah', ?, 'Evaluasi layanan', 'Warga sekolah', '', ?, '2026-08-05T00:00:00.000Z',
               '2026-10-01T02:00:00.000Z', NULL, ?)`,
      survey.id, survey.title, survey.status, org,
    );
    await run('INSERT INTO survey_settings (survey_id, allow_results, allow_individual) VALUES (?, 1, 1)', survey.id);
    for (const version of survey.versions) {
      const id = `v_${survey.id}_${version.number}`;
      await run(
        `INSERT INTO survey_versions (id, survey_id, number, status, notice_version, published_at, closed_at)
         VALUES (?, ?, ?, ?, '1.0', ?, ?)`,
        id, survey.id, version.number, version.status, version.published_at, version.closed_at,
      );
      await run(
        `INSERT INTO questions (id, version_id, code, ord, type, required, section, label, hint, group_code, dimension_code, direction)
         VALUES (?, ?, 'TU1', 1, 'likert', 1, 'Layanan', ?, NULL, NULL, NULL, NULL)`,
        `q_${id}`, id, version.number === 1 ? 'Pelayanan cepat dan jelas' : 'Pelayanan cepat, jelas, dan ramah',
      );
      await run(
        `INSERT INTO question_options (id, question_id, ord, label, value) VALUES (?, ?, 1, 'Kurang', 1), (?, ?, 2, 'Baik', 2)`,
        `q_${id}_1`, `q_${id}`, `q_${id}_2`, `q_${id}`,
      );
    }
    const v1 = `v_${survey.id}_1`;
    await run("INSERT INTO respondents (id, source, external_ref, created_at) VALUES (?, 'public_link', NULL, '2026-08-20T03:00:00.000Z')", `rsp_${survey.id}`);
    await run(
      `INSERT INTO responses (id, survey_id, version_id, assignment_id, respondent_id, collection_mode, identity_source, submitted_at, idempotency_key)
       VALUES (?, ?, ?, NULL, ?, 'standalone', 'local', '2026-08-20T03:00:00.000Z', ?)`,
      `r_${survey.id}`, survey.id, v1, `rsp_${survey.id}`, `idem-main-${survey.id}`,
    );
    await run(
      `INSERT INTO answers (id, response_id, question_id, question_code, option_id, value, text, skipped)
       VALUES (?, ?, ?, 'TU1', ?, 2, NULL, 0)`,
      `ans_${survey.id}`, `r_${survey.id}`, `q_${v1}`, `q_${v1}_2`,
    );
    await run('UPDATE surveys SET current_version_id = ? WHERE id = ?', `v_${survey.id}_${survey.versions.length}`, survey.id);
  }
  // Permintaan data yang ditangani admin main: catatan hasil memuat kontak pemohon; kolom kanal/anonimisasi belum ada.
  const old = new Date(Date.now() - 500 * DAY_MS).toISOString();
  const recent = new Date(Date.now() - 30 * DAY_MS).toISOString();
  await run(
    `INSERT INTO data_requests (id, type, contact, note, status, created_at, updated_at, handled_by, outcome_note)
     VALUES ('dr_7e2c9a', 'deletion', 'ortu.rahma@example.org', 'Hapus data anak saya, kelas 9B', 'handled', ?, ?, 'u_wakasek',
             'Sudah dibalas ke ortu.rahma@example.org'),
            ('dr_1f5b8d', 'access', 'guru.tamu@example.org', NULL, 'pending', ?, ?, NULL, NULL)`,
    old, old, recent, recent,
  );
  const token = 'sesi-main-wakasek-4c8e1a7b';
  await run(
    "INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?, 'u_wakasek', ?, ?)",
    createHash('sha256').update(token).digest('hex'),
    new Date().toISOString(),
    new Date(Date.now() + 3_600_000).toISOString(),
  );
  await migrate();

  const cookie = `svara_session=${token}`;
  for (const [survey, versionNumber] of [[surveys[0]!, 1], [surveys[1]!, 1]] as const) {
    const summary = await request(`/surveys/${survey.id}/summary`, { cookie });
    assert.equal(summary.status, 200, `${survey.title}: ${summary.text}`);
    assert.deepEqual(
      [(summary.json.data as { number: number }).number, (summary.json.data as { total: number }).total],
      [versionNumber, 1],
      survey.title,
    );
    const responses = await request(`/surveys/${survey.id}/responses`, { cookie });
    assert.equal(responses.status, 200, responses.text);
    assert.deepEqual((responses.json.data as Array<{ id: string }>).map((row) => row.id), [`r_${survey.id}`]);
    const csv = await fetch(`${base}/surveys/${survey.id}/export?format=csv`, { headers: { Cookie: cookie } });
    assert.equal(csv.status, 200, await csv.clone().text());
    assert.match(csv.headers.get('content-disposition') ?? '', new RegExp(`hasil-${survey.id}-v1\\.csv`));
    await csv.arrayBuffer();
  }

  const startedAt = Date.now();
  assert.equal((await anonymizeExpiredDataRequests()).anonymized, 1);
  const rows = await all<Record<string, string | null>>("SELECT * FROM data_requests WHERE id IN ('dr_7e2c9a', 'dr_1f5b8d') ORDER BY id");
  const [fresh, expired] = rows;
  assert.match(expired!.contact ?? '', /^anon:[0-9a-f]{16}$/);
  assert.deepEqual([expired!.note, expired!.outcome_note, expired!.response_channel], [null, null, null]);
  assert.ok(Date.parse(expired!.anonymized_at ?? '') >= startedAt - 1, `anonymized_at = waktu job: ${expired!.anonymized_at}`);
  assert.deepEqual([expired!.status, expired!.handled_by, expired!.created_at], ['handled', 'u_wakasek', old]);
  assert.deepEqual([fresh!.contact, fresh!.anonymized_at], ['guru.tamu@example.org', null]);
  assert.equal((await anonymizeExpiredDataRequests()).anonymized, 0, 'idempoten pada data hasil upgrade');
});
