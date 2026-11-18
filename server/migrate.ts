import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { nowIso, pool } from './db.ts';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations', import.meta.url));
const LOCK_KEY = 721_364_001;

export interface MigrationFile {
  version: string;
  path: string;
  sql: string;
  checksum: string;
}

export function migrationFiles(): MigrationFile[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => {
      const path = `${MIGRATIONS_DIR}/${name}`;
      const sql = readFileSync(path, 'utf8');
      // Checksum harus stabil lintas checkout Windows/Linux (CRLF vs LF).
      const canonical = sql.replace(/\r\n?/g, '\n');
      return { version: name, path, sql, checksum: createHash('sha256').update(canonical).digest('hex') };
    });
}

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
}

/**
 * Jalankan migrasi berurutan di bawah advisory lock.
 * Setiap file diterapkan dalam satu transaksi bersama pencatatannya.
 */
export async function migrate(options: { to?: string } = {}): Promise<string[]> {
  const files = migrationFiles();
  const targetIndex = options.to ? files.findIndex((file) => file.version.startsWith(options.to!)) : files.length - 1;
  if (targetIndex < 0) {
    throw new Error(`Migrasi target ${options.to} tidak ditemukan.`);
  }
  const selected = files.slice(0, targetIndex + 1);
  await ensureMigrationsTable();
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    const existing = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations',
    );
    const known = new Map(existing.rows.map((row) => [row.version, row.checksum]));
    for (const file of selected) {
      const previous = known.get(file.version);
      if (previous) {
        if (previous !== file.checksum) {
          throw new Error(`Migrasi ${file.version} sudah diterapkan dengan isi berbeda. Buat migrasi baru.`);
        }
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(file.sql);
        await client.query('INSERT INTO schema_migrations (version, checksum, applied_at) VALUES ($1, $2, $3)', [
          file.version,
          file.checksum,
          nowIso(),
        ]);
        await client.query('COMMIT');
        applied.push(file.version);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
    } catch (error) {
      console.error('[db] gagal melepas advisory lock', error);
    }
    client.release();
  }
  return applied;
}

/** Kosongkan seluruh schema aplikasi untuk db:reset dan basis data uji. */
export async function resetSchema(): Promise<void> {
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA public');
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/migrate.ts')) {
  migrate()
    .then((applied) => {
      console.log(applied.length ? `[db] migrasi diterapkan: ${applied.join(', ')}` : '[db] skema sudah terbaru');
    })
    .catch((error) => {
      console.error('[db]', error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
