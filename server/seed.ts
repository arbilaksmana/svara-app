import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { demoSeedEnabled } from './seed-policy.ts';

/** Reset hanya menghapus berkas SQLite lokal; tidak ada data nyata di repositori. */
async function main() {
  if (!demoSeedEnabled()) {
    console.error('[seed] SEED_DEMO=1 wajib untuk seed/reset data demo.');
    process.exitCode = 1;
    return;
  }
  const reset = process.argv.includes('--reset');
  const dbPath = resolve(process.env.DB_PATH ?? 'data/svara.sqlite');
  if (reset) {
    for (const suffix of ['', '-wal', '-shm']) {
      const file = `${dbPath}${suffix}`;
      if (existsSync(file)) rmSync(file);
    }
    console.log(`[db] dihapus: ${dbPath}`);
  }
  // Dynamic import disengaja: `--reset` harus menghapus file sebelum modul db membuka koneksi.
  const { ensureSchema, db } = await import('./db.ts');
  ensureSchema();
  const { seedDemoIfEmpty } = await import('./seed-data.ts');
  const seeded = seedDemoIfEmpty();
  console.log(seeded ? '[db] data sintetis dimuat' : '[db] data sudah ada, seed dilewati');
  db.close();
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/seed.ts')) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export function demoIds(prefix: string): string {
  return `${prefix}_${randomBytes(4).toString('hex')}`;
}
