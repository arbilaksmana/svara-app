import { randomBytes } from 'node:crypto';
import { closePool } from './db.ts';
import { migrate, resetSchema } from './migrate.ts';
import { seedDemoIfEmpty } from './seed-data.ts';
import { demoSeedEnabled } from './seed-policy.ts';

/** Reset hanya menyentuh schema Postgres lokal; tidak ada data nyata di repositori. */
async function main() {
  if (!demoSeedEnabled()) {
    console.error('[seed] SEED_DEMO=1 wajib untuk seed/reset data demo.');
    process.exitCode = 1;
    return;
  }
  const reset = process.argv.includes('--reset');
  if (reset) {
    await resetSchema();
    console.log('[db] schema public direset');
  }
  await migrate();
  const seeded = await seedDemoIfEmpty();
  console.log(seeded ? '[db] data sintetis dimuat' : '[db] data sudah ada, seed dilewati');
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/seed.ts')) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => closePool());
}

export function demoIds(prefix: string): string {
  return `${prefix}_${randomBytes(4).toString('hex')}`;
}
