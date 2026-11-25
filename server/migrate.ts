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

/** Checksum stabil lintas checkout Windows/Linux (CRLF vs LF). Dipakai juga oleh reparasi checksum. */
export function sqlChecksum(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n?/g, '\n')).digest('hex');
}

export function migrationFiles(): MigrationFile[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => {
      const path = `${MIGRATIONS_DIR}/${name}`;
      const sql = readFileSync(path, 'utf8');
      return { version: name, path, sql, checksum: sqlChecksum(sql) };
    });
}

const FOREIGN_SCHEMA_HINT =
  'Kemungkinan DATABASE_URL menunjuk basis data lain. Periksa DATABASE_URL; bila tabel di atas memang milik ' +
  'deployment ini, pulihkan database (restore backup) atau kosongkan skema sebelum start.';

/**
 * Tolak start bila basis data berisi tabel tetapi bukan milik Svara (tanpa `schema_migrations`).
 * Tanpa pemeriksaan ini, DB default Postgres atau DB aplikasi lain akan dipasangi migrasi di atasnya.
 * Skema kosong tetap dianggap instalasi baru dan dilanjutkan.
 */
async function assertDatabaseMatchesMigrationState(): Promise<void> {
  const tables = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  );
  const names = tables.rows.map((row) => row.table_name);
  if (names.includes('schema_migrations')) return;
  if (names.length === 0) return;
  const shown = names.slice(0, 10).map((name) => `"${name}"`).join(', ');
  const more = names.length > 10 ? ` dan ${names.length - 10} tabel lain` : '';
  throw new Error(
    `Basis data tidak memuat schema_migrations tetapi berisi ${names.length} tabel lain: ${shown}${more}. ` +
      'Migrasi tidak diterapkan agar data yang bukan milik Svara tidak ditimpa. ' +
      FOREIGN_SCHEMA_HINT,
  );
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
  await assertDatabaseMatchesMigrationState();
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
          throw new Error(
            `Migrasi ${file.version} sudah diterapkan dengan isi berbeda. Buat migrasi baru. Bila tidak ada file ` +
              'migrasi yang diedit, DATABASE_URL kemungkinan menunjuk deployment lain atau versi aplikasi yang berbeda.',
          );
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

/**
 * Kosongkan seluruh schema aplikasi untuk db:reset dan basis data uji. DDL perawatan ini bukan
 * query aplikasi: DROP SCHEMA CASCADE bisa melebihi statement_timeout pool yang kecil (PERF-08
 * memakai 200 ms) dan pembatalannya membuat reset gagal (57014). Satu transaksi dengan
 * SET LOCAL statement_timeout = 0: batas pool tetap berlaku untuk query lain, dan nilai sesi
 * kembali otomatis saat transaksi selesai sehingga koneksi pool tidak berubah permanen.
 */
export async function resetSchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL statement_timeout = 0');
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
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
