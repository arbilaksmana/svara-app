import { mock } from 'node:test';
import './test-db.ts';

const { pool } = await import('../db.ts');

export interface QueryLog {
  sql: string;
  rows: number;
}

/** Catat setiap query lewat pool selama `fn` berjalan, berikut jumlah baris yang dikembalikan. */
export async function recordQueries<T>(fn: () => Promise<T>): Promise<{ result: T; queries: QueryLog[] }> {
  const queries: QueryLog[] = [];
  const original = pool.query.bind(pool) as (sql: string, params?: unknown[]) => Promise<{ rowCount: number | null }>;
  const spy = mock.method(pool, 'query', async (sql: string, params?: unknown[]) => {
    const result = await original(sql, params);
    queries.push({ sql, rows: result.rowCount ?? 0 });
    return result;
  });
  try {
    return { result: await fn(), queries };
  } finally {
    spy.mock.restore();
  }
}

export const answerQueries = (queries: QueryLog[]) => queries.filter((query) => /\bFROM answers\b/i.test(query.sql));
