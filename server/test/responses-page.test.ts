import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { after, before, test } from 'node:test';
import { closeTestDatabase, resetTestDatabase } from './test-db.ts';
import { answerQueries, recordQueries } from './query-log.ts';

const { app } = await import('../app.ts');
const { all, get } = await import('../db.ts');
const { seedDemoIfEmpty } = await import('../seed-data.ts');

let server: Server | undefined;
let base = '';
let ownerCookie = '';

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
  ownerCookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!;
});

after(async () => {
  if (server) {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    server.close((error) => (error ? reject(error) : resolve()));
    await promise;
  }
  await closeTestDatabase();
});

test('PERF-03: halaman jawaban individual hanya membaca jawaban respons di halaman itu', async () => {
  const ordered = await all<{ id: string }>(
    "SELECT id FROM responses WHERE survey_id = 's_demo1' AND version_id = 'v_demo1_1' ORDER BY submitted_at DESC",
  );
  assert.ok(ordered.length >= 3);
  const expectedId = ordered[1]!.id;
  const expectedAnswers = await all<{ question_code: string; option_id: string | null; text: string | null; skipped: number }>(
    'SELECT question_code, option_id, text, skipped FROM answers WHERE response_id = ?',
    expectedId,
  );
  const versionAnswers = await get<{ count: number }>(
    "SELECT COUNT(*) AS count FROM answers a JOIN responses r ON r.id = a.response_id WHERE r.version_id = 'v_demo1_1'",
  );
  assert.ok((versionAnswers?.count ?? 0) > expectedAnswers.length);

  const { result, queries } = await recordQueries(async () => {
    const response = await fetch(`${base}/surveys/s_demo1/responses?version=v_demo1_1&limit=1&offset=1`, {
      headers: { Cookie: ownerCookie, 'X-Svara-Client': 'web' },
    });
    assert.equal(response.status, 200);
    return ((await response.json()) as { data: Array<{ id: string; answers: Array<{ question_code: string; option_id: string | null; text: string | null; skipped: boolean }> }> }).data;
  });

  assert.deepEqual(result.map((row) => row.id), [expectedId]);
  const byCode = (a: { question_code: string }, b: { question_code: string }) => a.question_code.localeCompare(b.question_code);
  assert.deepEqual(
    result[0]!.answers.map(({ question_code, option_id, text, skipped }) => ({ question_code, option_id, text, skipped })).sort(byCode),
    expectedAnswers.map((answer) => ({ ...answer, skipped: answer.skipped === 1 })).sort(byCode),
  );
  const answerRows = answerQueries(queries).reduce((sum, query) => sum + query.rows, 0);
  assert.equal(answerRows, expectedAnswers.length, `baris jawaban dibaca ${answerRows}, versi punya ${versionAnswers?.count}`);
});
