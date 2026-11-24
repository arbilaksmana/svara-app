import { Client } from 'pg';

/**
 * Basis data uji wajib terpisah. `TEST_DATABASE_URL` menang atas DATABASE_URL,
 * dan nama basis data harus memuat "test" agar reset schema tidak menyentuh data nyata.
 */
const url = process.env.TEST_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!url) {
  throw new Error('TEST_DATABASE_URL (atau DATABASE_URL) wajib menunjuk basis data uji Postgres.');
}
if (!process.env.TEST_DATABASE_URL && !/test/i.test(new URL(url).pathname)) {
  throw new Error('Basis data uji wajib diberi nama yang memuat "test", atau set TEST_DATABASE_URL.');
}
process.env.DATABASE_URL = url;

export const databaseUrl = url;

export async function resetTestDatabase(): Promise<void> {
  const { resetSchema, migrate } = await import('../migrate.ts');
  await resetSchema();
  await migrate();
}

export async function closeTestDatabase(): Promise<void> {
  const { closePool } = await import('../db.ts');
  await closePool();
}

/**
 * Sama seperti `resetTestDatabase`, tetapi `search_path` sesi pengujian tetap menunjuk skema yang baru
 * dibuat. `resetSchema` mengganti schema `public`, jadi path berbasis OID di sesi lama menjadi tidak sah
 * ("no schema has been selected") bagi pengujian yang memakai jaring koneksi bersama, bukan request server.
 */
export async function resetAndAttachTestDatabase(): Promise<void> {
  const { resetSchema, migrate } = await import('../migrate.ts');
  await resetSchema();
  await migrate();
  const { pool } = await import('../db.ts');
  await pool.query("SELECT set_config('search_path', 'public', false)");
}

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function accountCount(): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM accounts');
    return result.rows[0]?.count ?? 0;
  });
}

export async function tableCount(): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_name <> 'schema_migrations'",
    );
    return result.rows[0]?.count ?? 0;
  });
}

export async function indexExists(name: string): Promise<boolean> {
  return withClient(async (client) => {
    const result = await client.query('SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = $2', ['public', name]);
    return result.rowCount === 1;
  });
}
