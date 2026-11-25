import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { closeTestDatabase, databaseUrl, resetTestDatabase } from './test-db.ts';
import { app } from '../app.ts';

/**
 * KP-02 / NR-01 / NEW-PO-04: instalasi tanpa seed yang menjalankan `pnpm admin:bootstrap` harus dapat membuat
 * survei langsung. Sebelum perbaikan, bootstrap hanya membuat profil platform sehingga POST /surveys 409
 * profile_missing karena tidak ada baris `profiles`. Tidak ada `profiles` yang dituntut: keputusan owner adalah
 * bootstrap membuat profil platform, bukan seed demo.
 */
process.env.NODE_ENV = 'test';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BOOTSTRAP_SCRIPT = fileURLToPath(new URL('../scripts/bootstrap-admin.ts', import.meta.url));
const PASSWORD = 'SvaraDemo123!';
const ADMIN_EMAIL = 'root@instalasi.example.org';
const ORGANIZATION = 'Yayasan Instalasi Mandiri';
const ORGANIZATION_ADMIN_EMAIL = 'orgadmin@instalasi.example.org';
const ORGANIZATION_ENV = {
  BOOTSTRAP_ORGANIZATION_NAME: ORGANIZATION,
  BOOTSTRAP_ORGANIZATION_ADMIN_EMAIL: ORGANIZATION_ADMIN_EMAIL,
  BOOTSTRAP_ORGANIZATION_ADMIN_PASSWORD: PASSWORD,
};

let server: Server;
let origin = '';

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server) {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    server.close((error) => (error ? reject(error) : resolve()));
    await promise;
  }
  await closeTestDatabase();
});

/** Bootstrap dijalankan sebagai proses terpisah: ia menjalankan migrate() dan menutup pool miliknya sendiri. */
function bootstrap(extra: Record<string, string | undefined> = {}) {
  const env: Record<string, string | undefined> = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    BOOTSTRAP_ADMIN_EMAIL: ADMIN_EMAIL,
    BOOTSTRAP_ADMIN_PASSWORD: PASSWORD,
    ...extra,
  };
  // Env opsional yang tidak dikirim untuk test ini harus benar-benar tidak ada, bukan sisa shell.
  for (const name of ['BOOTSTRAP_ORGANIZATION_NAME', 'BOOTSTRAP_ORGANIZATION_ADMIN_EMAIL', 'BOOTSTRAP_ORGANIZATION_ADMIN_PASSWORD', 'TEST_DATABASE_URL']) {
    if (!(name in extra)) delete env[name];
  }
  return spawnSync(process.execPath, ['--import', 'tsx', BOOTSTRAP_SCRIPT], { cwd: ROOT, env, encoding: 'utf8' });
}

async function sql<T extends Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return (await client.query<T>(text, params)).rows;
  } finally {
    await client.end();
  }
}

async function login(email: string, password = PASSWORD): Promise<string> {
  const response = await fetch(`${origin}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Svara-Client': 'web' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200, `login ${email}: ${await response.clone().text()}`);
  return (response.headers.get('set-cookie') ?? '').split(';')[0]!;
}

async function createSurvey(cookie: string, title: string) {
  const response = await fetch(`${origin}/api/v1/surveys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Svara-Client': 'web', Cookie: cookie },
    body: JSON.stringify({ title }),
  });
  return { status: response.status, json: (await response.json().catch(() => ({}))) as { code?: string; data?: unknown } };
}

test('NEW-PO-04: instalasi tanpa seed + bootstrap → survey organisasi dapat dibuat tanpa 409 profil', async () => {
  await resetTestDatabase();
  assert.deepEqual(await sql("SELECT table_name FROM information_schema.tables WHERE table_name = 'profiles'"), [
    { table_name: 'profiles' },
  ]);
  assert.deepEqual(await sql('SELECT id FROM profiles'), [], 'instalasi tanpa seed tidak punya profil legacy');
  assert.deepEqual(await sql('SELECT id FROM platform_profile'), []);

  const first = bootstrap(ORGANIZATION_ENV);
  assert.equal(first.status, 0, `admin:bootstrap: ${first.stderr}`);

  assert.deepEqual(
    await sql("SELECT id, organization_type, retention_days FROM platform_profile"),
    [{ id: 'platform', organization_type: 'platform', retention_days: null }],
    'profil platform dibuat dengan retention_days NULL',
  );
  const organizations = await sql<{ id: string; name: string; retention_days: number | null; notice_version: string }>(
    'SELECT id, name, retention_days, notice_version FROM organizations',
  );
  assert.equal(organizations.length, 1);
  assert.equal(organizations[0]!.name, ORGANIZATION);
  assert.equal(organizations[0]!.retention_days, null, 'BF-06: retention_days NULL, bukan angka bawaan');
  assert.deepEqual(
    await sql('SELECT version FROM platform_notices WHERE version = $1', [organizations[0]!.notice_version]),
    [{ version: organizations[0]!.notice_version }],
    'notice_version organisasi mengikuti notice platform yang dibuat bootstrap',
  );

  const orgAdmin = await login(ORGANIZATION_ADMIN_EMAIL);
  const survey = await createSurvey(orgAdmin, 'Survei tanpa seed');
  // Mungkin masih gagal sesudah gerbang profil (mis. preferensi notice responden); yang diuji adalah gerbang profil.
  assert.notEqual(survey.json.code, 'profile_missing', JSON.stringify(survey.json));
  assert.notEqual(survey.json.code, 'notice_source_missing', JSON.stringify(survey.json));
});

test('NEW-PO-04: bootstrap kedua tidak menambah baris, tidak melempar, dan tidak menggandakan audit', async () => {
  const snapshot = async () => ({
    platform: await sql('SELECT * FROM platform_profile'),
    organizations: await sql('SELECT * FROM organizations ORDER BY id'),
    accounts: await sql('SELECT id, email, role, organization_id FROM accounts ORDER BY id'),
    surveys: await sql('SELECT id FROM surveys ORDER BY id'),
    audit: await sql("SELECT action, object, actor FROM audit_logs WHERE action LIKE 'Bootstrap%' ORDER BY action, object"),
  });
  const before = await snapshot();

  const second = bootstrap(ORGANIZATION_ENV);
  assert.equal(second.status, 0, `admin:bootstrap ulang: ${second.stderr}`);
  assert.doesNotMatch(second.stderr, /error/i);
  assert.deepEqual(await snapshot(), before, 'bootstrap ulang tidak mengubah baris apa pun, termasuk audit');
});

test('NEW-PO-04: tanpa BOOTSTRAP_ORGANIZATION_NAME, admin platform saja — profil platform tetap dibuat', async () => {
  await resetTestDatabase();
  const result = bootstrap();
  assert.equal(result.status, 0, `admin:bootstrap: ${result.stderr}`);
  assert.equal((await sql('SELECT id FROM platform_profile')).length, 1);
  assert.deepEqual(await sql('SELECT id FROM organizations'), [], 'tanpa env organisasi, tidak ada organisasi dibuat');
  assert.deepEqual(
    await sql<{ action: string; actor: string }>("SELECT action, actor FROM audit_logs ORDER BY action"),
    [
      { action: 'Bootstrap admin', actor: 'system' },
      { action: 'Bootstrap profil platform', actor: 'system' },
    ],
    'audit satu baris untuk profil yang dibuat',
  );
  // audit_logs.metadata adalah TEXT berisi JSON.
  const audit = await sql<{ object: string; metadata: string }>(
    "SELECT object, metadata FROM audit_logs WHERE action = 'Bootstrap profil platform'",
  );
  assert.equal(audit[0]!.object, 'platform');
  const metadata: unknown = JSON.parse(audit[0]!.metadata);
  assert.ok(metadata && typeof metadata === 'object' && 'notice_version' in metadata);
  assert.equal(metadata.notice_version, '1.0');
});
