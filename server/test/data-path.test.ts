import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { after, before, test } from 'node:test';
import { closeTestDatabase, indexExists, resetTestDatabase } from './test-db.ts';

const { app } = await import('../app.ts');
const { all, pool, run, toPgPlaceholders } = await import('../db.ts');
const { csvCell } = await import('../http.ts');
const { seedDemoIfEmpty } = await import('../seed-data.ts');

let server: Server | undefined;
let base = '';
let cookie = '';

async function call(path: string, options: { method?: string; body?: unknown } = {}): Promise<{ status: number; text: string }> {
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Svara-Client': 'web', ...(cookie ? { Cookie: cookie } : {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { status: response.status, text: await response.text() };
}

/** Sel CSV per baris; nilai uji sengaja tanpa koma/kutip sehingga pemisahan sederhana cukup. */
function csvTable(csv: string): Array<Record<string, string>> {
  const [header, ...rows] = csv.replace(/^\uFEFF/, '').replace(/\r\n$/, '').split('\r\n').map((line) => line.split(','));
  return rows.map((cells) => Object.fromEntries(header!.map((name, index) => [name, cells[index] ?? ''])));
}

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
  const login = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Svara-Client': 'web' },
    body: JSON.stringify({ email: 'creator.a@svara.local', password: 'SvaraDemo123!' }),
  });
  assert.equal(login.status, 200, await login.clone().text());
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!;
});

after(async () => {
  if (server) {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    server.close((error) => (error ? reject(error) : resolve()));
    await promise;
  }
  await closeTestDatabase();
});

test('L-03: angka (negatif, desimal, eksponen) ditulis apa adanya; teks berawalan rumus tetap dinetralisasi', async () => {
  const created = await call('/surveys', { method: 'POST', body: { title: 'Uji angka CSV' } });
  assert.equal(created.status, 201, created.text);
  const surveyId = (JSON.parse(created.text) as { data: { survey: { id: string } } }).data.survey.id;
  const question = (code: string, type: 'single_choice' | 'short_text', values: number[]) => ({
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
  });
  const saved = await call(`/surveys/${surveyId}`, {
    method: 'PUT',
    body: {
      title: 'Uji angka CSV',
      purpose: 'Menguji netralisasi rumus CSV',
      object_label: 'Karyawan',
      instructions: '',
      questions: [question('C01', 'single_choice', [-1, -2.5, 1e21]), question('T01', 'short_text', [])],
    },
  });
  assert.equal(saved.status, 200, saved.text);
  const published = await call(`/surveys/${surveyId}/publish`, { method: 'POST' });
  assert.equal(published.status, 200, published.text);
  const versionId = (JSON.parse(published.text) as { data: { version: { id: string } } }).data.version.id;
  const questionIds = new Map(
    (await all<{ id: string; code: string }>('SELECT id, code FROM questions WHERE version_id = ?', versionId)).map((row) => [row.code, row.id]),
  );

  const cases: Array<[number, string]> = [
    [-1, '-1'],
    [-2.5, '=SUM(1)'],
    [1e21, '+1'],
    [-1e-7, '@x'],
  ];
  for (const [index, [value, text]] of cases.entries()) {
    const id = `r_l03_${index}`;
    await run(
      `INSERT INTO responses (id, survey_id, version_id, assignment_id, respondent_id, collection_mode, identity_source, submitted_at, idempotency_key)
       VALUES (?, ?, ?, NULL, ?, 'standalone', 'local', ?, ?)`,
      id,
      surveyId,
      versionId,
      `p_l03_${index}`,
      `2026-11-20T08:00:0${index}.000Z`,
      `key-l03-${index}`,
    );
    await run(
      `INSERT INTO answers (id, response_id, question_id, question_code, option_id, value, text, skipped)
       VALUES (?, ?, ?, 'C01', NULL, ?, NULL, 0), (?, ?, ?, 'T01', NULL, NULL, ?, 0)`,
      `ans_${id}_c`,
      id,
      questionIds.get('C01')!,
      value,
      `ans_${id}_t`,
      id,
      questionIds.get('T01')!,
      text,
    );
  }

  // BF-07: ekspor yang memuat baris per-responden wajib menyebut penerima dan tujuan.
  const csv = await call(`/surveys/${surveyId}/export?format=csv&version=${versionId}&recipient=Uji%20L-03&purpose=Uji%20netralisasi`);
  assert.equal(csv.status, 200, csv.text);
  const rows = csvTable(csv.text);
  assert.deepEqual(rows.map((row) => row.C01), ['-1', '-2.5', '1e+21', '-1e-7'], 'nilai number tidak diberi apostrof');
  assert.deepEqual(rows.map((row) => row.T01), ["'-1", "'=SUM(1)", "'+1", "'@x"], 'teks berawalan = + - @ tetap dinetralisasi');

  const codebook = await call(`/surveys/${surveyId}/export?format=codebook&version=${versionId}`);
  assert.equal(codebook.status, 200, codebook.text);
  assert.deepEqual(
    csvTable(codebook.text).filter((row) => row.code === 'C01').map((row) => [row.value, row.value_label]),
    [
      ['-1', 'Nilai -1'],
      ['-2.5', 'Nilai -2.5'],
      ['1e+21', 'Nilai 1e+21'],
    ],
    'nilai opsi negatif di kodebook tetap angka',
  );
});

test('L-03: csvCell hanya membebaskan number berhingga; string dan nilai non-berhingga tetap dinetralisasi', () => {
  assert.equal(csvCell(-3), '-3');
  assert.equal(csvCell(-0.5), '-0.5');
  assert.equal(csvCell(-1e21), '-1e+21');
  assert.equal(csvCell(-0), '0');
  assert.equal(csvCell('-3'), "'-3");
  assert.equal(csvCell('-1e21'), "'-1e21");
  assert.equal(csvCell('=1+2'), "'=1+2");
  assert.equal(csvCell('+62 812'), "'+62 812");
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvCell('\tx'), "'\tx");
  assert.equal(csvCell('\rx'), `"'\rx"`);
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell(-Infinity), "'-Infinity", 'number non-berhingga diperlakukan seperti teks');
  assert.equal(csvCell(-1, false), '-1');
  assert.equal(csvCell('-1', false), '-1', 'neutralizeFormula=false tetap menonaktifkan prefiks');
});

/** Indeks 017 beserta definisi kanonis Postgres; kolom dan urutan harus cocok dengan query jalur panas. */
const HOT_PATH_INDEXES: Record<string, string> = {
  ix_public_links_token_hash: 'CREATE INDEX ix_public_links_token_hash ON public.public_links USING btree (token_hash)',
  ix_invitations_token_hash: 'CREATE INDEX ix_invitations_token_hash ON public.invitations USING btree (token_hash)',
  ix_responses_version_submitted:
    'CREATE INDEX ix_responses_version_submitted ON public.responses USING btree (version_id, submitted_at, id)',
  ix_audit_org_at:
    'CREATE INDEX ix_audit_org_at ON public.audit_logs USING btree (organization_id, at DESC, id DESC) WHERE (organization_id IS NOT NULL)',
};

async function hotPathIndexDefs(): Promise<Record<string, string>> {
  const rows = await all<{ indexname: string; indexdef: string }>(
    `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname IN (${Object.keys(HOT_PATH_INDEXES).map(() => '?').join(',')})`,
    ...Object.keys(HOT_PATH_INDEXES),
  );
  return Object.fromEntries(rows.map((row) => [row.indexname, row.indexdef]));
}

/** Rencana query persis dari kode dengan seq scan, bitmap, dan sort dimahalkan: indeks yang cocok pasti dipilih. */
async function forcedPlan(sql: string, params: unknown[]): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const setting of ['enable_seqscan', 'enable_bitmapscan', 'enable_sort', 'enable_incremental_sort']) {
      await client.query(`SET LOCAL ${setting} = off`);
    }
    const result = await client.query(`EXPLAIN (FORMAT JSON) ${toPgPlaceholders(sql)}`, params);
    return JSON.stringify(result.rows[0]['QUERY PLAN']);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

test('PERF-07: migrasi membuat indeks jalur panas dengan kolom yang dipakai query', async () => {
  for (const name of Object.keys(HOT_PATH_INDEXES)) assert.equal(await indexExists(name), true, `${name} belum ada`);
  assert.deepEqual(await hotPathIndexDefs(), HOT_PATH_INDEXES);
});

test('PERF-07: query jalur panas dapat dilayani indeks 017 tanpa langkah Sort', async () => {
  const cases: Array<[string, string, unknown[]]> = [
    ['ix_public_links_token_hash', 'SELECT * FROM public_links WHERE token_hash = ?', ['a'.repeat(64)]],
    ['ix_invitations_token_hash', 'SELECT * FROM invitations WHERE token_hash = ?', ['a'.repeat(64)]],
    [
      'ix_responses_version_submitted',
      'SELECT * FROM responses WHERE survey_id = ? AND version_id = ? ORDER BY submitted_at, id LIMIT ?',
      ['s_x', 'v_x', 500],
    ],
    [
      'ix_responses_version_submitted',
      `SELECT * FROM responses
      WHERE survey_id = ? AND version_id = ? AND (submitted_at, id) > (?, ?)
      ORDER BY submitted_at, id LIMIT ?`,
      ['s_x', 'v_x', '2026-11-20T08:00:00.000Z', 'r_x', 500],
    ],
    [
      'ix_responses_version_submitted',
      'SELECT * FROM responses WHERE survey_id = ? AND version_id = ? ORDER BY submitted_at DESC LIMIT ? OFFSET ?',
      ['s_x', 'v_x', 100, 0],
    ],
    [
      'ix_audit_org_at',
      `SELECT id, at, actor, action, object, outcome FROM audit_logs
        WHERE organization_id = ? ORDER BY at DESC, id DESC LIMIT ?`,
      ['org_smk', 100],
    ],
  ];
  for (const [index, sql, params] of cases) {
    const plan = await forcedPlan(sql, params);
    assert.ok(plan.includes(`"Index Name":"${index}"`), `${index} tidak dipakai: ${plan}`);
    assert.ok(!/"Node Type":"(Incremental )?Sort"/.test(plan), `masih ada Sort: ${plan}`);
  }
});

test('PERF-07: migrasi 017 idempoten saat diterapkan ulang', async () => {
  const { migrate } = await import('../migrate.ts');
  assert.deepEqual(await migrate(), [], 'migrasi kedua tidak menerapkan apa pun');
  await run("DELETE FROM schema_migrations WHERE version = '017_hot_path_indexes.sql'");
  assert.deepEqual(await migrate(), ['017_hot_path_indexes.sql'], 'IF NOT EXISTS membuat penerapan ulang tidak galat');
  assert.deepEqual(await hotPathIndexDefs(), HOT_PATH_INDEXES, 'indeks tidak berubah atau berlipat');
});
