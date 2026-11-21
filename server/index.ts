import { createHash } from 'node:crypto';
import { app } from './app.ts';
import { closePool, run } from './db.ts';
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

const integrationToken = process.env.INTEGRATION_TOKEN?.trim();
const integrationOrganizationId = process.env.INTEGRATION_ORGANIZATION_ID?.trim();
if (integrationToken && integrationOrganizationId) {
  await run(
    `INSERT INTO integration_token_scopes (token_hash, organization_id)
     VALUES (?, ?)
     ON CONFLICT (token_hash) DO UPDATE SET organization_id = EXCLUDED.organization_id, survey_id = NULL`,
    createHash('sha256').update(integrationToken).digest('hex'),
    integrationOrganizationId,
  );
}

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '127.0.0.1';
const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
const databaseLabel = `${databaseUrl.host}${databaseUrl.pathname}`;

const server = app.listen(port, host, () => {
  console.log(`[api] Svara berjalan di http://${host}:${port}`);
  console.log(`[db] postgres ${databaseLabel}`);
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
