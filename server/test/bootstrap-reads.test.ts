import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { after, before, test } from 'node:test';
import { closeTestDatabase, resetTestDatabase } from './test-db.ts';
import type { AccountRow } from '../security.ts';
import type { SurveyProfile } from '../http.ts';
import { answerQueries, recordQueries } from './query-log.ts';

const { app } = await import('../app.ts');
const { get, nowIso, run } = await import('../db.ts');
const { buildBootstrap } = await import('../bootstrap.ts');
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
  process.env.API_INTERNAL_URL = `http://127.0.0.1:${address.port}`;
  base = `${process.env.API_INTERNAL_URL}/api/v1`;
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

test('PERF-01: bootstrap tidak menghitung ringkasan dan tidak membaca tabel jawaban', async () => {
  const account = await get<AccountRow>(
    "SELECT id, email, display_name, role, status, organization_id FROM accounts WHERE email = 'creator.a@svara.local'",
  );
  assert.ok(account);
  const { result, queries } = await recordQueries(() => buildBootstrap(account));
  assert.ok(result.surveys.length > 0);
  assert.equal('summaries' in result, false, 'bootstrap tidak lagi membawa ringkasan');
  assert.deepEqual(answerQueries(queries).map((query) => query.sql), []);
});

test('PERF-01: gerbang server membaca akun dari /auth/me tanpa bootstrap', async () => {
  const { accountForCookie } = await import('../../src/lib/server/guards.ts');
  const { result: account, queries } = await recordQueries(() => accountForCookie(ownerCookie));
  assert.equal(account?.email, 'creator.a@svara.local');
  assert.equal(account?.role, 'creator');
  assert.equal(queries.some((query) => /\bFROM (surveys|survey_versions|answers)\b/i.test(query.sql)), false);
  assert.equal(await accountForCookie(''), null);
  assert.equal(await accountForCookie('svara_session=tidak-valid'), null);
});

test('PERF-10: jumlah query bootstrap tidak bertambah per survei', async () => {
  const account = await get<AccountRow>(
    "SELECT id, email, display_name, role, status, organization_id FROM accounts WHERE email = 'creator.a@svara.local'",
  );
  assert.ok(account);
  const baselineProfile = (
    await get<{ profile_id: string }>(
      'SELECT profile_id FROM surveys WHERE owner_id = ? ORDER BY id LIMIT 1',
      account.id,
    )
  )?.profile_id;
  assert.ok(baselineProfile, 'survei contoh creator tersedia');

  const added: string[] = [];
  const timestamp = nowIso();
  const insertSurvey = async (index: number) => {
    const id = `s_perf10_${index}`;
    added.push(id);
    await run(
      `INSERT INTO surveys (id, owner_id, profile_id, title, purpose, object_label, instructions, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
      id,
      account.id,
      baselineProfile,
      `Survei perf 10 ${index}`,
      'Uji jumlah query',
      'Objek',
      'Isi.',
      timestamp,
      timestamp,
    );
  };

  try {
    await insertSurvey(0);
    const small = await recordQueries(() => buildBootstrap(account));
    for (let index = 1; index < 20; index += 1) await insertSurvey(index);
    const grown = await recordQueries(() => buildBootstrap(account));

    assert.equal(
      grown.queries.length,
      small.queries.length,
      `query bootstrap bertambah dari ${small.queries.length} menjadi ${grown.queries.length} saat survei bertambah`,
    );
    assert.equal(
      grown.queries.filter((query) => /FROM platform_profile/i.test(query.sql)).length,
      1,
      'profil platform dibaca satu kali untuk semua survei',
    );
    assert.equal(
      grown.queries.filter((query) => /FROM organizations\b/i.test(query.sql)).length,
      small.queries.filter((query) => /FROM organizations\b/i.test(query.sql)).length,
    );
    assert.equal(grown.result.surveys.length, small.result.surveys.length + 19);
    const surveyIds = grown.result.surveys.map((survey) => (survey as { id: string }).id).sort();
    assert.deepEqual(Object.keys(grown.result.surveyProfiles).sort(), surveyIds);
    const sample: SurveyProfile = grown.result.surveyProfiles[added[0]!]!;
    assert.equal(sample.source, 'platform');
    assert.equal(
      sample.organization_name,
      grown.result.surveyProfiles[added[1]!]!.organization_name,
      'survei platform berbagi profil yang sama tanpa query per survei',
    );
  } finally {
    await run(`DELETE FROM surveys WHERE id IN (${added.map(() => '?').join(',')})`, ...added);
  }
});
