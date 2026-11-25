import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { migrate, migrationFiles, resetSchema } from '../migrate.ts';
import { closeTestDatabase, databaseUrl, resetTestDatabase } from './test-db.ts';

/**
 * Start-up (`migrate()`) harus membedakan instalasi baru dari basis data yang salah alamat.
 * Skema kosong = instalasi baru → migrasi otomatis. `schema_migrations` ada → dipakai sebagai
 * sumber kebenaran checksum. Tabel asing tanpa `schema_migrations` → ditolak sebelum apa pun diterapkan.
 */

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function publicTables(): Promise<string[]> {
  return withClient(async (client) => {
    const result = await client.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    return result.rows.map((row) => row.table_name);
  });
}

before(async () => {
  await resetTestDatabase();
});

after(async () => {
  await resetTestDatabase();
  await closeTestDatabase();
});

test('instalasi baru: skema kosong dimigrasi penuh saat start', async () => {
  await resetSchema();

  const applied = await migrate();
  assert.equal(applied.length, migrationFiles().length, 'semua file migrasi diterapkan pada DB kosong');

  const tables = await publicTables();
  assert.ok(tables.includes('schema_migrations'));
  assert.ok(tables.includes('accounts'));
});

test('checksum berbeda ditolak dan pesan menunjuk kemungkinan deployment lain', async () => {
  const version = '018_notice_survey_profile_backfill.sql';
  const file = migrationFiles().find((entry) => entry.version === version);
  assert.ok(file);

  await withClient(async (client) => {
    await client.query('UPDATE schema_migrations SET checksum = $1 WHERE version = $2', ['f'.repeat(64), version]);
  });

  await assert.rejects(
    () => migrate(),
    (error: Error) => {
      assert.match(error.message, /sudah diterapkan dengan isi berbeda|deployment lain/);
      assert.match(error.message, /deployment lain/, 'pesan menyebut kemungkinan DATABASE_URL salah alamat');
      return true;
    },
  );

  await withClient(async (client) => {
    await client.query('UPDATE schema_migrations SET checksum = $1 WHERE version = $2', [file.checksum, version]);
  });
});

test('skema berisi tabel asing tanpa schema_migrations ditolak sebelum migrasi diterapkan', async () => {
  await resetSchema();
  await withClient(async (client) => {
    await client.query('CREATE TABLE bukan_milik_svara (id INT PRIMARY KEY)');
  });

  await assert.rejects(
    () => migrate(),
    (error: Error) => {
      assert.match(error.message, /bukan_milik_svara/);
      assert.match(error.message, /DATABASE_URL/);
      return true;
    },
  );

  assert.deepEqual(await publicTables(), ['bukan_milik_svara'], 'tidak ada migrasi yang dipasang di atas tabel asing');
});

test('migrate({ to }) tetap menerapkan 9 migrasi pertama', async () => {
  await resetSchema();

  const applied = await migrate({ to: '009' });
  assert.equal(applied.length, 9);
  assert.equal(applied.at(-1), '009_organization_invitation_expiry_backfill.sql');

  const versions = await withClient(async (client) => {
    const result = await client.query('SELECT version FROM schema_migrations ORDER BY version');
    return result.rows.length;
  });
  assert.equal(versions, 9, 'hanya 9 migrasi tercatat');
});
