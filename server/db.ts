import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';
import type { PoolClient } from 'pg';

/**
 * Satu pool Postgres untuk seluruh proses. Konfigurasi runtime hanya DATABASE_URL;
 * tidak ada fallback SQLite. Semua helper di bawah async — tidak ada akses sinkron palsu.
 */
const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  throw new Error('DATABASE_URL wajib diisi (contoh: postgres://user:pass@host:5432/svara).');
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

// COUNT(*) dan agregat lain kembali sebagai int8; kontrak API memakai number.
pg.types.setTypeParser(20, (value: string) => Number(value));

export const pool = new pg.Pool({
  connectionString,
  max: intEnv('PG_POOL_MAX', 10, 1, 50),
  idleTimeoutMillis: intEnv('PG_IDLE_TIMEOUT_MS', 10_000, 1_000, 120_000),
  connectionTimeoutMillis: intEnv('PG_CONNECTION_TIMEOUT_MS', 5_000, 500, 60_000),
  application_name: 'svara',
});

// Koneksi idle bisa putus (restart/failover DB); jangan biarkan error tak tertangani mematikan proses.
pool.on('error', (error) => {
  console.error('[db] koneksi idle gagal', error.message);
});

/** Permintaan di dalam `withTx` memakai client transaksi yang sama lewat AsyncLocalStorage. */
const txClient = new AsyncLocalStorage<PoolClient>();

export type SqlValue = string | number | boolean | null | Date | Buffer;

/** Ubah placeholder gaya `?` menjadi `$1..$n`; tanda tanya di dalam literal kutip diabaikan. */
export function toPgPlaceholders(sql: string): string {
  let out = '';
  let index = 1;
  let inString = false;
  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i]!;
    if (char === "'") {
      if (inString && sql[i + 1] === "'") {
        out += "''";
        i += 1;
        continue;
      }
      inString = !inString;
      out += char;
      continue;
    }
    out += char === '?' && !inString ? `$${index++}` : char;
  }
  return out;
}

function executor(): PoolClient | typeof pool {
  return txClient.getStore() ?? pool;
}

export async function all<T>(sql: string, ...params: SqlValue[]): Promise<T[]> {
  const result = await executor().query(toPgPlaceholders(sql), params);
  return result.rows as unknown as T[];
}

export async function get<T>(sql: string, ...params: SqlValue[]): Promise<T | undefined> {
  const result = await executor().query(toPgPlaceholders(sql), params);
  return result.rows[0] as unknown as T | undefined;
}

export async function run(sql: string, ...params: SqlValue[]): Promise<number> {
  const result = await executor().query(toPgPlaceholders(sql), params);
  return result.rowCount ?? 0;
}

/**
 * Satu transaksi pada satu client; rollback seluruh perubahan bila callback melempar.
 * Pemanggilan bertingkat memakai transaksi yang sama (tanpa savepoint).
 */
export async function withTx<T>(fn: () => Promise<T> | T): Promise<T> {
  if (txClient.getStore()) return fn();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await txClient.run(client, fn);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('[db] rollback gagal', rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export async function closePool(): Promise<void> {
  await pool.end();
}
