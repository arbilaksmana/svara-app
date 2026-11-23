import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request, type IncomingHttpHeaders, type IncomingMessage, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { after, before, mock, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { closeTestDatabase, resetTestDatabase } from './test-db.ts';
import { answerQueries, recordQueries } from './query-log.ts';

// Batch kecil agar dataset uji yang kecil tetap melewati banyak batch.
const BATCH = 4;
process.env.EXPORT_BATCH_SIZE = String(BATCH);

const { app } = await import('../app.ts');
const { all, get, pool, run } = await import('../db.ts');
const { seedDemoIfEmpty } = await import('../seed-data.ts');

const QUESTION_COUNT = 4;
const TEXTS = [
  '=SUM(A1:A9)',
  '+62 812',
  '-5 poin',
  '@cmd',
  '\tdiawali tab',
  '\rdiawali CR',
  'koma, di tengah',
  'kutip "ganda"',
  'baris\r\nbaru',
  'Unicode é ñ 漢字 😀',
  '',
  ' spasi ',
];
const LIKERT: Array<number | null> = [1, 2.5, -1, 0, null, 5];
const CHOICE = [-2, 10, 3.75, 0.1 + 0.2, 1e21];

let server: Server | undefined;
let base = '';
let ownerCookie = '';
let officerCookie = '';
let surveyId = '';
let versionId = '';
let exportPath = '';
let questionIds = new Map<string, string>();

interface Download {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

interface AnswerRow {
  response_id: string;
  question_code: string;
  value: number | null;
  text: string | null;
  skipped: number;
}

async function api<T>(path: string, options: { method?: string; body?: unknown; cookie?: string } = {}): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Svara-Client': 'web',
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  assert.ok(response.ok, `${options.method ?? 'GET'} ${path}: ${response.status} ${text}`);
  return JSON.parse(text) as T;
}

async function login(email: string): Promise<string> {
  const response = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Svara-Client': 'web' },
    body: JSON.stringify({ email, password: 'SvaraDemo123!' }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  return (response.headers.get('set-cookie') ?? '').split(';')[0]!;
}

function exportRequest(cookie: string, headers: Record<string, string> = {}, path = exportPath) {
  return request(`${base}${path}`, { headers: { Cookie: cookie, 'X-Svara-Client': 'web', ...headers }, agent: false });
}

/** Unduh lewat node:http agar byte mentah (termasuk BOM) dan header transfer terbaca apa adanya. */
function download(cookie: string, headers: Record<string, string> = {}, path = exportPath): Promise<Download> {
  const { promise, resolve, reject } = Promise.withResolvers<Download>();
  const req = exportRequest(cookie, headers, path);
  req.on('response', (res) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    res.on('error', reject);
  });
  req.on('error', reject);
  req.end();
  return promise;
}

async function withTimeout<T>(promise: Promise<T>, message: string, ms = 5000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new assert.AssertionError({ message })), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function question(code: string, type: 'likert' | 'single_choice' | 'short_text') {
  const values = type === 'likert' ? [1, 2, 3, 4, 5] : type === 'single_choice' ? [-2, 10, 3.75] : [];
  return {
    code,
    type,
    required: false,
    section: 'Bagian 1',
    label: `Pertanyaan ${code}`,
    hint: null,
    group_code: null,
    dimension_code: null,
    direction: null,
    options: values.map((value) => ({ label: `Nilai ${value}`, value })),
  };
}

/** Respons sintetis dengan seri waktu kembar, id lintas kolasi, sel formula/kutip/baris baru, dan jawaban hilang/dilewati. */
async function insertResponses(from: number, to: number): Promise<void> {
  for (let i = from; i < to; i += 1) {
    const id = `${['exp-', 'EXP_', 'exp'][i % 3]}${String(99 - i).padStart(2, '0')}`;
    await run(
      `INSERT INTO responses (id, survey_id, version_id, assignment_id, respondent_id, collection_mode, identity_source, submitted_at, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, 'local', ?, ?)`,
      id,
      surveyId,
      versionId,
      i % 2 ? null : `a_exp_${i}`,
      i % 5 === 0 ? `=resp${i}` : `p_${i}`,
      i % 2 ? 'standalone' : 'assignment',
      new Date(Date.UTC(2026, 10, 15, 8, 0) + Math.floor(i / 3) * 60_000).toISOString(),
      `key-exp-${i}`,
    );
    if (i % 7 === 6) continue;
    const answer = async (code: string, value: number | null, text: string | null, skipped: boolean) => {
      await run(
        `INSERT INTO answers (id, response_id, question_id, question_code, option_id, value, text, skipped)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`,
        `ans_${id}_${code}`,
        id,
        questionIds.get(code)!,
        code,
        value,
        text,
        skipped ? 1 : 0,
      );
    };
    await answer('L01', LIKERT[i % LIKERT.length]!, null, i % 4 === 3);
    if (i % 3 !== 1) await answer('C01', CHOICE[i % CHOICE.length]!, null, false);
    await answer('T01', null, i % 13 === 12 ? null : TEXTS[i % TEXTS.length]!, false);
    await answer('T02', null, i % 2 === 0 ? 'tidak boleh tampil' : `catatan ${i}`, i % 2 === 0);
  }
}

/**
 * Aturan sel acuan ditulis eksplisit, bukan memanggil csvCell yang sedang diuji.
 * L-03: number berhingga (negatif, desimal, eksponen) ditulis apa adanya; hanya teks berawalan
 * = + - @ tab CR yang diberi apostrof. Sebelum L-03 angka negatif juga diberi apostrof.
 */
function referenceCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const numeric = typeof value === 'number' && Number.isFinite(value);
  const text = !numeric && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Salinan perilaku ekspor sebelum PERF-04: seluruh respons + seluruh jawaban versi dibangun menjadi satu string. */
async function legacyCsv(includeText: boolean): Promise<string> {
  const version = await get<{ number: number }>('SELECT number FROM survey_versions WHERE id = ?', versionId);
  const questions = await all<{ code: string; type: string }>('SELECT * FROM questions WHERE version_id = ? ORDER BY ord, code', versionId);
  const responses = await all<Record<string, string | null>>(
    'SELECT * FROM responses WHERE survey_id = ? AND version_id = ? ORDER BY submitted_at, id',
    surveyId,
    versionId,
  );
  const answers = await all<AnswerRow>(
    `SELECT a.response_id, a.question_code, a.option_id, a.value, a.text, a.skipped
       FROM answers a JOIN responses r ON r.id = a.response_id
      WHERE r.version_id IN (?)`,
    versionId,
  );
  const answersByResponse = new Map<string, AnswerRow[]>();
  for (const answer of answers) answersByResponse.set(answer.response_id, [...(answersByResponse.get(answer.response_id) ?? []), answer]);
  const textQuestions = new Set(questions.filter((question) => question.type === 'short_text').map((question) => question.code));
  const exportQuestions = includeText ? questions : questions.filter((question) => !textQuestions.has(question.code));
  const header = [
    'response_id',
    'respondent_id',
    'survey_id',
    'survey_version',
    'assignment_id',
    'collection_mode',
    'identity_source',
    'submitted_at',
    ...exportQuestions.map((question) => question.code),
  ];
  const rows = responses.map((response) => {
    const byCode = new Map((answersByResponse.get(response.id!) ?? []).map((answer) => [answer.question_code, answer]));
    return [
      response.id,
      response.respondent_id,
      response.survey_id,
      version!.number,
      response.assignment_id ?? '',
      response.collection_mode,
      response.identity_source,
      response.submitted_at,
      ...exportQuestions.map((question) => {
        const answer = byCode.get(question.code);
        if (!answer || answer.skipped === 1) return '';
        if (question.type === 'short_text') return includeText ? answer.text ?? '' : '';
        return answer.value ?? '';
      }),
    ];
  });
  return `\uFEFF${[header, ...rows].map((row) => row.map((cell) => referenceCell(cell)).join(',')).join('\r\n')}\r\n`;
}

/** Kolom berkas CSV survei uji, ditulis eksplisit: kolom tetap lalu kode pertanyaan (teks bebas hanya dengan izin). */
function exportColumns(includeText: boolean): string[] {
  return [
    'response_id', 'respondent_id', 'survey_id', 'survey_version', 'assignment_id', 'collection_mode', 'identity_source', 'submitted_at',
    'L01', 'C01', ...(includeText ? ['T01', 'T02'] : []),
  ];
}

/** Metadata baris hasil akhir ekspor; kolom dan Accept hanya dicatat di baris 'Mulai ekspor CSV'. */
function auditMetadata(rows: number, includeText: boolean, reason?: string): string {
  return JSON.stringify({
    format: 'csv',
    rows,
    includeText,
    individual: true,
    filename: `hasil-${surveyId}-v1.csv`,
    ...(reason ? { reason } : {}),
  });
}

/** Hasil akhir audit ekspor CSV, bukan baris 'Mulai ekspor CSV' yang ditulis sebelum aliran dimulai. */
const isFinalExportAudit = (sql: string, params?: unknown[]) => /INSERT INTO audit_logs/i.test(sql) && params?.[2] === 'Ekspor CSV';

async function exportAudits(outcome: string): Promise<string[]> {
  const rows = await all<{ metadata: string | null }>(
    "SELECT metadata FROM audit_logs WHERE action = 'Ekspor CSV' AND outcome = ? AND object = ?",
    outcome,
    `${surveyId} · v1`,
  );
  return rows.map((row) => row.metadata ?? '');
}

const isResponseBatch = (sql: string) => /\bFROM responses\b/i.test(sql) && /ORDER BY submitted_at, id/i.test(sql);

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.SEED_DEMO = '1';
  await resetTestDatabase();
  await seedDemoIfEmpty();
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}/api/v1`;
  ownerCookie = await login('creator.a@svara.local');
  officerCookie = await login('officer@svara.local');

  const created = await api<{ data: { survey: { id: string } } }>('/surveys', {
    method: 'POST',
    cookie: ownerCookie,
    body: { title: 'Uji ekspor bertahap' },
  });
  surveyId = created.data.survey.id;
  await api(`/surveys/${surveyId}`, {
    method: 'PUT',
    cookie: ownerCookie,
    body: {
      title: 'Uji ekspor bertahap',
      purpose: 'Menguji ekspor CSV per batch',
      object_label: 'Karyawan',
      instructions: '',
      questions: [question('L01', 'likert'), question('C01', 'single_choice'), question('T01', 'short_text'), question('T02', 'short_text')],
    },
  });
  const published = await api<{ data: { version: { id: string } } }>(`/surveys/${surveyId}/publish`, { method: 'POST', cookie: ownerCookie });
  versionId = published.data.version.id;
  exportPath = `/surveys/${surveyId}/export?format=csv&version=${versionId}`;
  questionIds = new Map(
    (await all<{ id: string; code: string }>('SELECT id, code FROM questions WHERE version_id = ?', versionId)).map((row) => [row.code, row.id]),
  );
  assert.equal(questionIds.size, QUESTION_COUNT);

  // Pemegang grant tanpa can_read_free_text: kolom teks bebas dibuang dari ekspor.
  await run('UPDATE survey_settings SET allow_individual = 1 WHERE survey_id = ?', surveyId);
  await run(
    'INSERT INTO access_grants (id, account_id, survey_id, can_read_individual, can_export, can_read_free_text) VALUES (?, ?, ?, 1, 1, 0)',
    'g_export_stream',
    'u_petugas',
    surveyId,
  );
  await insertResponses(0, 22);
});

after(async () => {
  if (server) {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    server.close((error) => (error ? reject(error) : resolve()));
    await promise;
  }
  await closeTestDatabase();
});

test('PERF-04: CSV bertahap identik byte-per-byte dengan ekspor lama lintas banyak batch', async () => {
  // 22 = batch terakhir sebagian; 24 = kelipatan pas ukuran batch.
  for (const total of [22, 24]) {
    if (total === 24) await insertResponses(22, 24);
    assert.ok(total > BATCH * 3, 'dataset harus melewati beberapa batch');
    for (const [cookie, includeText] of [
      [ownerCookie, true],
      [officerCookie, false],
    ] as const) {
      const result = await download(cookie);
      assert.equal(result.status, 200, result.body.toString('utf8'));
      assert.equal(result.headers['content-type'], 'text/csv; charset=utf-8');
      assert.equal(result.headers['content-disposition'], `attachment; filename="hasil-${surveyId}-v1.csv"`);
      const expected = await legacyCsv(includeText);
      assert.equal(result.body.toString('utf8'), expected, `CSV berbeda (includeText=${includeText}, ${total} respons)`);
      assert.ok(result.body.equals(Buffer.from(expected, 'utf8')), 'byte CSV termasuk BOM harus identik');
      const csv = result.body.toString('utf8');
      assert.ok(/,-1(,|\r\n)/.test(csv) && /,-2(,|\r\n)/.test(csv), 'jawaban number negatif ditulis sebagai angka');
      assert.ok(!csv.includes("'-1") && !csv.includes("'-2"), 'number negatif tidak diberi apostrof (L-03)');
      assert.ok(csv.includes("'=resp0"), 'respondent_id teks berawalan = tetap dinetralisasi');
      if (includeText) assert.ok(csv.includes("'-5 poin") && csv.includes("'=SUM(A1:A9)"), 'teks berawalan - dan = tetap dinetralisasi');
      assert.ok((await exportAudits('berhasil')).includes(auditMetadata(total, includeText)), 'audit sukses mencatat jumlah baris yang ditulis');
    }
  }
});

test('PERF-04: query jawaban tidak pernah memuat lebih dari satu batch respons', async () => {
  const totals = await get<{ responses: number; answers: number }>(
    `SELECT (SELECT COUNT(*) FROM responses WHERE version_id = ?) AS responses,
            (SELECT COUNT(*) FROM answers a JOIN responses r ON r.id = a.response_id WHERE r.version_id = ?) AS answers`,
    versionId,
    versionId,
  );
  assert.ok(totals && totals.answers > BATCH * QUESTION_COUNT, 'jawaban versi harus melebihi satu batch');

  const { result, queries } = await recordQueries(() => download(ownerCookie));
  assert.equal(result.status, 200);
  const answers = answerQueries(queries);
  assert.ok(
    answers.every((query) => query.rows <= BATCH * QUESTION_COUNT),
    `baris jawaban per query ${answers.map((query) => query.rows).join(',')}; batas satu batch ${BATCH * QUESTION_COUNT} dari total ${totals.answers}`,
  );
  assert.equal(answers.reduce((sum, query) => sum + query.rows, 0), totals.answers, 'setiap jawaban dibaca tepat sekali');
  const batches = queries.filter((query) => isResponseBatch(query.sql));
  assert.ok(batches.length >= Math.ceil(totals.responses / BATCH), `respons dibaca dalam ${batches.length} query`);
  assert.ok(batches.every((query) => query.rows <= BATCH), `baris respons per query ${batches.map((query) => query.rows).join(',')}`);
  assert.equal(answers.length, batches.filter((query) => query.rows > 0).length, 'satu query jawaban per batch respons');
});

test('PERF-04: ekspor dikirim bertahap (chunked), bukan satu buffer ber-Content-Length', async () => {
  const result = await download(ownerCookie);
  assert.equal(result.status, 200);
  assert.equal(result.headers['content-length'], undefined, `Content-Length ${result.headers['content-length']} menandakan satu buffer`);
  assert.equal(result.headers['transfer-encoding'], 'chunked');
});

test('PERF-04: klien yang memutus koneksi menghentikan query batch berikutnya', async () => {
  const original = pool.query.bind(pool) as (sql: string, params?: unknown[]) => Promise<{ rowCount: number | null }>;
  const gate = Promise.withResolvers<void>();
  const secondBatch = Promise.withResolvers<void>();
  const audited = Promise.withResolvers<void>();
  const sqls: string[] = [];
  let answerCount = 0;
  const spy = mock.method(pool, 'query', async (sql: string, params?: unknown[]) => {
    sqls.push(sql);
    if (/\bFROM answers\b/i.test(sql) && ++answerCount === 2) {
      secondBatch.resolve();
      await gate.promise;
    }
    const result = await original(sql, params);
    if (isFinalExportAudit(sql, params)) audited.resolve();
    return result;
  });
  try {
    const serverSocket = once(server!, 'connection').then(([socket]) => socket as Socket);
    const req = exportRequest(ownerCookie);
    req.on('error', () => {});
    req.end();
    const [res] = (await withTimeout(once(req, 'response'), 'respons ekspor tidak dimulai')) as [IncomingMessage];
    res.on('error', () => {});
    const firstChunk = once(res, 'data');
    await withTimeout(secondBatch.promise, 'query jawaban batch kedua tidak pernah dimulai; ekspor tidak dibaca per batch');
    const [chunk] = (await withTimeout(firstChunk, 'batch pertama belum sampai ke klien saat batch kedua masih berjalan')) as [Buffer];
    assert.ok(chunk.toString('utf8').startsWith('\uFEFFresponse_id,'), 'potongan pertama memuat BOM dan header CSV');

    const socket = await serverSocket;
    const closed = once(socket, 'close');
    req.destroy();
    await withTimeout(closed, 'server tidak melihat koneksi klien tertutup');
    await delay(10);
    gate.resolve();
    await withTimeout(audited.promise, 'ekspor terputus tidak tercatat di audit');
    await delay(100);
  } finally {
    gate.resolve();
    spy.mock.restore();
  }
  assert.equal(sqls.filter(isResponseBatch).length, 2, 'tidak ada query respons setelah klien memutus koneksi');
  assert.equal(answerCount, 2);
  assert.ok((await exportAudits('gagal')).includes(auditMetadata(BATCH, true, 'client_closed')), 'audit mencatat baris yang sempat ditulis');
});

test('PERF-04: galat basis data di tengah aliran memutus koneksi, bukan berkas yang tampak lengkap', async () => {
  const original = pool.query.bind(pool) as (sql: string, params?: unknown[]) => Promise<{ rowCount: number | null }>;
  const audited = Promise.withResolvers<void>();
  let answerCount = 0;
  const spy = mock.method(pool, 'query', async (sql: string, params?: unknown[]) => {
    if (/\bFROM answers\b/i.test(sql) && ++answerCount === 2) throw new Error('simulasi koneksi basis data putus');
    const result = await original(sql, params);
    if (isFinalExportAudit(sql, params)) audited.resolve();
    return result;
  });
  const logged = mock.method(console, 'error', () => {});
  try {
    const { promise, resolve } = Promise.withResolvers<{ status: number; complete: boolean; body: string }>();
    const req = exportRequest(ownerCookie);
    req.on('response', (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      const settle = () => resolve({ status: res.statusCode ?? 0, complete: res.complete, body });
      res.on('end', settle);
      res.on('error', settle);
      res.on('close', settle);
    });
    req.on('error', () => resolve({ status: 0, complete: false, body: '' }));
    req.end();
    const outcome = await withTimeout(promise, 'unduhan tidak selesai maupun terputus');
    assert.equal(outcome.status, 200);
    assert.equal(outcome.complete, false, 'aliran harus diputus, bukan diakhiri seolah lengkap');
    assert.ok(outcome.body.startsWith('\uFEFFresponse_id,') && !outcome.body.includes('internal_error'), 'JSON galat tidak boleh tercampur ke CSV');
    await withTimeout(audited.promise, 'ekspor gagal tidak tercatat di audit');
    assert.ok(logged.mock.callCount() >= 1, 'galat dicatat di log server');
  } finally {
    spy.mock.restore();
    logged.mock.restore();
  }
  assert.ok((await exportAudits('gagal')).includes(auditMetadata(BATCH, true, 'stream_error')), 'audit mencatat galat aliran');
});

/** Unduhan yang selalu selesai: berakhir normal, galat, atau koneksi diputus server. */
function settledDownload(cookie: string): Promise<{ status: number; complete: boolean; body: string }> {
  const { promise, resolve } = Promise.withResolvers<{ status: number; complete: boolean; body: string }>();
  const req = exportRequest(cookie);
  req.on('response', (res) => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => (body += chunk));
    const settle = () => resolve({ status: res.statusCode ?? 0, complete: res.complete, body });
    res.on('end', settle);
    res.on('error', settle);
    res.on('close', settle);
  });
  req.on('error', () => resolve({ status: 0, complete: false, body: '' }));
  req.end();
  return promise;
}

test('M6: audit ekspor yang gagal ditulis menolak ekspor (500) tanpa byte CSV dan tanpa membaca respons', async () => {
  const original = pool.query.bind(pool) as (sql: string, params?: unknown[]) => Promise<{ rowCount: number | null }>;
  const sqls: string[] = [];
  const spy = mock.method(pool, 'query', async (sql: string, params?: unknown[]) => {
    sqls.push(sql);
    if (/INSERT INTO audit_logs/i.test(sql)) throw new Error('simulasi audit_logs tidak dapat ditulis');
    return original(sql, params);
  });
  const logged = mock.method(console, 'error', () => {});
  let outcome: { status: number; complete: boolean; body: string };
  try {
    outcome = await withTimeout(settledDownload(ownerCookie), 'unduhan tidak selesai maupun terputus');
  } finally {
    spy.mock.restore();
    logged.mock.restore();
  }
  assert.equal(outcome.status, 500, `ekspor tanpa jejak audit tidak boleh dikirim (${outcome.body.length} karakter diterima)`);
  assert.ok(!outcome.body.startsWith('\uFEFF') && !outcome.body.includes('response_id'), 'tidak ada byte CSV yang terkirim');
  assert.equal((JSON.parse(outcome.body) as { code?: string }).code, 'internal_error');
  assert.equal(sqls.filter(isResponseBatch).length, 0, 'data respons tidak dibaca sebelum audit tercatat');
});

test('M6: audit ekspor ditulis sebelum byte pertama dan hanya memuat yang diketahui server', async () => {
  const original = pool.query.bind(pool) as (sql: string, params?: unknown[]) => Promise<{ rowCount: number | null }>;
  const sqls: string[] = [];
  const spy = mock.method(pool, 'query', async (sql: string, params?: unknown[]) => {
    sqls.push(sql);
    return original(sql, params);
  });
  const accept = 'text/csv, application/json;q=0.5';
  try {
    for (const cookie of [ownerCookie, officerCookie]) {
      sqls.length = 0;
      const result = await download(cookie, { Accept: accept });
      assert.equal(result.status, 200, result.body.toString('utf8'));
      const firstAudit = sqls.findIndex((sql) => /INSERT INTO audit_logs/i.test(sql));
      const firstBatch = sqls.findIndex(isResponseBatch);
      assert.ok(firstAudit >= 0 && firstBatch >= 0 && firstAudit < firstBatch, `audit (query ke-${firstAudit}) harus mendahului batch respons (query ke-${firstBatch})`);
    }
  } finally {
    spy.mock.restore();
  }
  const object = `${surveyId} · v1`;
  const startedBy = async (actor: string) => {
    const row = await get<{ metadata: string }>(
      "SELECT metadata FROM audit_logs WHERE action = 'Mulai ekspor CSV' AND outcome = 'dimulai' AND actor = ? AND object = ? ORDER BY at DESC LIMIT 1",
      actor,
      object,
    );
    return JSON.parse(row?.metadata ?? '{}') as unknown;
  };
  const started = (includeText: boolean) => ({
    format: 'csv',
    includeText,
    individual: true,
    filename: `hasil-${surveyId}-v1.csv`,
    columns: exportColumns(includeText),
    request_accept: accept,
  });
  assert.deepEqual(await startedBy('u_creator_a'), started(true), 'pemilik: nama berkas, kolom lengkap, dan Accept permintaan');
  assert.deepEqual(await startedBy('u_petugas'), started(false), 'grant tanpa teks bebas: kolom teks tidak disertakan');

  const codebook = await download(officerCookie, { Accept: accept }, `/surveys/${surveyId}/export?format=codebook&version=${versionId}`);
  assert.equal(codebook.status, 200);
  const codebookAudit = await get<{ metadata: string }>(
    "SELECT metadata FROM audit_logs WHERE action = 'Ekspor kodebook' AND actor = 'u_petugas' AND object = ? ORDER BY at DESC LIMIT 1",
    object,
  );
  // L01 punya 5 opsi dan C01 3 opsi; T01/T02 dibuang karena grant tanpa teks bebas.
  assert.deepEqual(JSON.parse(codebookAudit?.metadata ?? '{}'), {
    format: 'codebook', rows: 8, includeText: false, individual: false,
    filename: `kodebook-${surveyId}-v1.csv`, questions: ['L01', 'C01'], request_accept: accept,
  });

  const outsider = await login('creator.b@svara.local');
  const denied = await download(outsider, { Accept: accept });
  assert.equal(denied.status, 403);
  const rejection = await get<{ metadata: string }>(
    "SELECT metadata FROM audit_logs WHERE action = 'Ekspor hasil' AND outcome = 'ditolak' AND actor = 'u_creator_b' AND object = ?",
    surveyId,
  );
  assert.deepEqual(JSON.parse(rejection?.metadata ?? '{}'), { format: 'csv', reason: 'forbidden_export', request_accept: accept });

  const exportLogs = await all<{ metadata: string | null }>(
    "SELECT metadata FROM audit_logs WHERE action IN ('Mulai ekspor CSV', 'Ekspor CSV', 'Ekspor kodebook', 'Ekspor hasil') AND object LIKE ?",
    `${surveyId}%`,
  );
  assert.ok(exportLogs.length >= 6);
  for (const { metadata } of exportLogs) {
    const keys = Object.keys(JSON.parse(metadata ?? '{}') as object);
    assert.ok(!keys.includes('destination') && !keys.includes('accepts'), `tujuan/penerima tidak diklaim: ${metadata}`);
  }
});

test('Std-3: ekspor CSV mencatat satu baris selesai; baris mulai berstatus dimulai, kolom dan Accept dicatat sekali', async () => {
  // Header Accept dari klien tidak tepercaya dan bisa sangat panjang; audit hanya menyimpan 200 karakter pertama.
  const accept = `text/csv;q=1.0, ${Array.from({ length: 12 }, (_, index) => `application/x-svara-tambahan-${index};q=0.${index % 9}`).join(', ')}`;
  assert.ok(accept.length > 300, `Accept uji harus melebihi batas (${accept.length} karakter)`);
  const admin = await login('admin@svara.local');
  const since = new Date().toISOString();
  const result = await download(ownerCookie, { Accept: accept });
  assert.equal(result.status, 200, result.body.toString('utf8'));
  const total = (await get<{ count: number }>('SELECT COUNT(*)::int AS count FROM responses WHERE version_id = ?', versionId))?.count;

  const audit = await api<{ data: Array<{ actor: string; action: string; object: string; outcome: string; at: string; metadata: string | null }> }>(
    '/admin/audit?limit=500',
    { cookie: admin },
  );
  const rows = audit.data
    .filter((row) => row.actor === 'u_creator_a' && row.object === `${surveyId} · v1` && row.at >= since)
    .map((row) => ({ action: row.action, outcome: row.outcome, metadata: JSON.parse(row.metadata ?? '{}') as Record<string, unknown> }));
  assert.deepEqual(
    rows.map(({ action, outcome }) => `${action}: ${outcome}`).sort(),
    ['Ekspor CSV: berhasil', 'Mulai ekspor CSV: dimulai'],
    'baris mulai tidak boleh mengklaim berhasil sebelum ekspor selesai; tepat satu baris berhasil',
  );
  const started = rows.find((row) => row.action === 'Mulai ekspor CSV')!.metadata;
  const finished = rows.find((row) => row.action === 'Ekspor CSV')!.metadata;
  // Kolom dan Accept dicatat di baris mulai, yang pasti ada sebelum byte pertama terkirim; baris akhir mencatat hasilnya.
  assert.deepEqual(started.columns, exportColumns(true));
  assert.equal(typeof started.request_accept, 'string');
  assert.equal((started.request_accept as string).length, 200, 'Accept dipotong pada 200 karakter');
  assert.ok(accept.startsWith(started.request_accept as string), 'potongan Accept adalah awal header asli');
  assert.deepEqual(finished, { format: 'csv', rows: total, includeText: true, individual: true, filename: `hasil-${surveyId}-v1.csv` });
});
