import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { app, attachStatic } from './app.ts';
import { closePool } from './db.ts';
import { migrate } from './migrate.ts';
import { seedDemoIfEmpty } from './seed-data.ts';
import { demoSeedEnabled } from './seed-policy.ts';

const demoSeed = demoSeedEnabled();
await migrate();

if (demoSeed) {
  const seeded = await seedDemoIfEmpty();
  console.log(seeded ? '[seed] data demo dimuat' : '[seed] data demo sudah ada');
} else {
  console.log('[seed] demo nonaktif; gunakan SEED_DEMO=1 atau bootstrap admin untuk basis data kosong');
}

const serveStatic = process.argv.includes('--serve') || process.env.SERVE_STATIC === '1';
const dist = resolve('dist');
if (serveStatic && existsSync(dist)) attachStatic(app, dist);

const port = Number(process.env.PORT ?? (serveStatic ? 3000 : 3001));
const host = process.env.HOST ?? '127.0.0.1';
const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
const databaseLabel = `${databaseUrl.host}${databaseUrl.pathname}`;

const server = app.listen(port, host, () => {
  console.log(`[api] Svara berjalan di http://${host}:${port}`);
  console.log(`[db] postgres ${databaseLabel}`);
  console.log(`[static] ${serveStatic && existsSync(dist) ? dist : 'nonaktif (gunakan Vite di port 5173)'}`);
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    server.close(() => {
      closePool()
        .catch((error) => console.error('[db] gagal menutup pool', error))
        .finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 5_000).unref();
  });
}
