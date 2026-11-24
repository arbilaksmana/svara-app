import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { after, before, test } from 'node:test';
import { app } from '../app.ts';
import { all, run } from '../db.ts';
import { seedDemoIfEmpty } from '../seed-data.ts';
import { closeTestDatabase, databaseUrl, resetTestDatabase } from './test-db.ts';

/**
 * BF-09c: kredensial integrasi bertanggal kedaluwarsa. Percobaan 1 memakai proses `server/index.ts`
 * sungguhan (seeding dari env, seperti deployment); percobaan 2 memakai `app` in-process untuk
 * memvariasikan `expires_at` per kasus; percobaan 3 menjalankan ulang migrasi 023 agar idempoten.
 * Token tiap kasus diberi nama `kp01-*` dan dihapus sesudahnya, sehingga tidak bocor ke suite lain.
 */

process.env.NODE_ENV = 'test';
process.env.SEED_DEMO = '1';
process.env.SEED_PASSWORD = 'SvaraDemo123!';

const PAST = '2020-01-01T00:00:00Z';
const FUTURE = '2099-01-01T00:00:00Z';
const SERVER_TOKEN = 'kp01-server-token-0123456789abcdef';
const NO_EXPIRY_TOKEN = 'kp01-no-expiry-token-0123456789ab';
const PATH = '/integration/survey-data?survey_id=s_demo1&version=1';
/**
 * Kredensial `app` in-process. Dipasang sebelum panggilan basis data pertama: `server/db.ts`
 * memulihkan snapshot env sebelum `loadEnvFile('.env')`, sehingga nilai yang ditulis sesudahnya hilang.
 */
process.env.INTEGRATION_TOKEN = 'kp01-app-token-0123456789abcdefgh';

interface Result {
  status: number;
  json: { code?: string; error?: string } & Record<string, unknown>;
}

async function request(url: string, token: string): Promise<Result> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Svara-Client': 'web',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });
  const json = (await response.json().catch(() => ({}))) as Result['json'];
  return { status: response.status, json };
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function upsertScope(token: string, expiresAt: string | null): Promise<void> {
  await run(
    `INSERT INTO integration_token_scopes (token_hash, organization_id, survey_id, expires_at, created_at)
     VALUES (?, 'org_smk', NULL, ?, ?)
     ON CONFLICT (token_hash) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
    tokenHash(token),
    expiresAt,
    new Date().toISOString(),
  );
}

async function storedExpiry(token: string): Promise<string | null | undefined> {
  const row = await all<{ expires_at: string | null }>(
    'SELECT expires_at FROM integration_token_scopes WHERE token_hash = ?',
    tokenHash(token),
  );
  return row[0] ? row[0].expires_at : undefined;
}

/** Jalankan `server/index.ts` sungguhan, jalankan pemeriksaan, lalu matikan prosesnya. */
async function withServer<T>(env: Record<string, string>, check: (base: string) => Promise<T>): Promise<T> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      PORT: '3197',
      HOST: '127.0.0.1',
      SEED_DEMO: '1',
      SEED_PASSWORD: 'SvaraDemo123!',
      COOKIE_SECURE: '0',
      ENABLE_HSTS: '0',
      NODE_ENV: 'test',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const base = 'http://127.0.0.1:3197/api/v1';
  const ready = Promise.withResolvers<void>();
  let output = '';
  const onData = (chunk: unknown) => {
    output += String(chunk);
    if (output.includes('[api] Svara berjalan')) ready.resolve();
  };
  child.stdout?.setEncoding('utf8').on('data', onData);
  child.stderr?.setEncoding('utf8').on('data', onData);
  // Pengganti batas waktu: proses keluar sebelum siap = gagal, dengan log sebagai bukti.
  child.once('exit', (code) => ready.reject(new Error(`server keluar (kode ${code}): ${output}`)));
  ready.promise.catch(() => {});
  try {
    await ready.promise;
    return await check(base);
  } finally {
    child.removeAllListeners('exit');
    child.kill();
    if (child.exitCode === null) await once(child, 'exit');
  }
}

before(async () => {
  await resetTestDatabase();
  await seedDemoIfEmpty();
  await run(
    "INSERT INTO integration_token_scopes (token_hash, organization_id) VALUES (?, 'org_smk')",
    tokenHash(process.env.INTEGRATION_TOKEN!),
  );
});

after(async () => {
  await closeTestDatabase();
});

test('BF-09c: INTEGRATION_TOKEN_EXPIRES_AT saat start mengisi expires_at baris token', async () => {
  try {
    await withServer(
      { INTEGRATION_TOKEN: SERVER_TOKEN, INTEGRATION_ORGANIZATION_ID: 'org_smk', INTEGRATION_TOKEN_EXPIRES_AT: FUTURE },
      async () => {
        assert.equal(await storedExpiry(SERVER_TOKEN), FUTURE);
      },
    );
  } finally {
    await run('DELETE FROM integration_token_scopes WHERE token_hash = ?', tokenHash(SERVER_TOKEN));
  }
});

test('BF-09c: tanpa INTEGRATION_TOKEN_EXPIRES_AT baris token tetap tanpa kedaluwarsa dan tetap bekerja', async () => {
  try {
    const result = await withServer(
      { INTEGRATION_TOKEN: NO_EXPIRY_TOKEN, INTEGRATION_ORGANIZATION_ID: 'org_smk', INTEGRATION_TOKEN_EXPIRES_AT: '' },
      async (base) => {
        assert.equal(await storedExpiry(NO_EXPIRY_TOKEN), null);
        return request(`${base}${PATH}`, NO_EXPIRY_TOKEN);
      },
    );
    assert.equal(result.status, 200, JSON.stringify(result.json));
  } finally {
    await run('DELETE FROM integration_token_scopes WHERE token_hash = ?', tokenHash(NO_EXPIRY_TOKEN));
  }
});

test('BF-09c: token kedaluwarsa ditolak dengan pesan yang sama seperti cakupan tidak ada, dan diaudit', async () => {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  // `serviceToken` hanya menerima satu INTEGRATION_TOKEN dari env, jadi setiap kasus mengubah
  // `expires_at` baris token itu, bukan memakai token lain.
  const token = process.env.INTEGRATION_TOKEN!;
  try {
    await upsertScope(token, PAST);
    const expired = await request(`${base}${PATH}`, token);
    assert.equal(expired.status, 403, JSON.stringify(expired.json));
    assert.equal(expired.json.code, 'forbidden_service_scope');

    // Rujukan: cakupan tidak ada (baris token dihapus) — respons inilah yang tidak boleh dibedakan klien.
    await run('DELETE FROM integration_token_scopes WHERE token_hash = ?', tokenHash(token));
    const noScope = await request(`${base}${PATH}`, token);
    assert.equal(noScope.status, 403, JSON.stringify(noScope.json));
    assert.equal(noScope.json.code, 'forbidden_service_scope');
    assert.deepEqual(expired.json, noScope.json, 'klien tidak boleh membedakan kedaluwarsa dari cakupan tidak ada');

    const audits = await all<{
      actor: string;
      action: string;
      outcome: string;
      metadata: string | null;
      organization_id: string | null;
    }>(
      "SELECT actor, action, outcome, metadata, organization_id FROM audit_logs WHERE action = 'Kredensial integrasi kedaluwarsa'",
    );
    assert.equal(audits.length, 1, 'tepat satu audit untuk satu penolakan; cakupan tidak ada tidak diaudit');
    const [audit] = audits;
    assert.equal(audit.outcome, 'ditolak');
    assert.equal(audit.actor, 'layanan-15');
    assert.equal(audit.organization_id, 'org_smk');
    assert.equal(audit.metadata, null);
    assert.ok(!JSON.stringify(audit).includes(token), 'audit tidak boleh memuat token');
    assert.ok(!JSON.stringify(audit).includes(tokenHash(token)), 'audit tidak boleh memuat hash token');

    await upsertScope(token, FUTURE);
    const future = await request(`${base}${PATH}`, token);
    assert.equal(future.status, 200, JSON.stringify(future.json));

    await upsertScope(token, null);
    const withoutExpiry = await request(`${base}${PATH}`, token);
    assert.equal(withoutExpiry.status, 200, JSON.stringify(withoutExpiry.json));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await run('DELETE FROM integration_token_scopes WHERE token_hash = ?', tokenHash(token));
  }
});

test('BF-09c: migrasi 023 idempoten dan backfill created_at baris lama', async () => {
  const sql = readFileSync(new URL('../migrations/023_integration_token_expiry.sql', import.meta.url), 'utf8');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO integration_token_scopes (token_hash, organization_id) VALUES ($1, 'org_smk')`,
      [tokenHash('kp01-migration-probe-token')],
    );
    await client.query(sql);
    await client.query(sql);
    const result = await client.query<{ created_at: string | null; expires_at: string | null }>(
      'SELECT created_at, expires_at FROM integration_token_scopes WHERE token_hash = $1',
      [tokenHash('kp01-migration-probe-token')],
    );
    assert.equal(result.rows.length, 1);
    assert.match(result.rows[0]!.created_at ?? '', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(result.rows[0]!.expires_at, null);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});
