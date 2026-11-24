import { execFileSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

/**
 * Pilih URL demo dan tolak basis data yang namanya tidak menandakan demo/uji,
 * supaya `resetSchema()` tidak pernah menyentuh data nyata.
 */
export function demoDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) throw new Error('DATABASE_URL wajib diisi untuk demo ini.');
  const url = new URL(raw);
  if (!/(test|demo|ac13|ac15|ac16)/i.test(url.pathname)) {
    throw new Error('Demo hanya boleh dijalankan pada basis data bernama test/demo/AC13/AC15/AC16.');
  }
  return raw;
}

export interface SourceBaseline {
  commit: string | null;
  dirty: boolean | null;
}

/**
 * NEW-PO-05: artefak demo harus bisa dikaitkan ke sumber yang menghasilkannya. `dirty` menandai
 * artefak yang dibuat dari working tree dengan perubahan belum commit. Repo tanpa git (arsip
 * sumber) menghasilkan `null`, bukan menggagalkan demo.
 */
export function sourceBaseline(): SourceBaseline {
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() || null;
    const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
    return { commit, dirty };
  } catch {
    return { commit: null, dirty: null };
  }
}

export interface DemoDatabase {
  databaseUrl: string;
  serverVersion: string;
}

/** Reset schema + migrasi memakai pool sementara, lalu menutupnya sebelum server demo dijalankan. */
export async function resetDemoDatabase(): Promise<DemoDatabase> {
  const databaseUrl = demoDatabaseUrl();
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = databaseUrl;
  try {
    const { resetSchema, migrate } = await import('../migrate.ts');
    const { closePool, pool } = await import('../db.ts');
    await resetSchema();
    await migrate();
    const version = await pool.query<{ server_version: string }>('SHOW server_version');
    await closePool();
    return { databaseUrl, serverVersion: version.rows[0]?.server_version ?? 'unknown' };
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
}

export function waitForServer(child: ChildProcess, label: string): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  let output = '';
  const onData = (chunk: unknown) => {
    output += String(chunk);
    if (output.includes('Svara berjalan')) resolve();
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
  child.once('exit', (code) => reject(new Error(`${label} berhenti (kode ${code}): ${output}`)));
  return promise;
}

export async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = Promise.withResolvers<void>();
  child.once('exit', () => exited.resolve());
  child.kill();
  await exited.promise;
}
