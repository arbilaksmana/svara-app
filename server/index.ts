import { createHash } from 'node:crypto';
import { app } from './app.ts';
import { closePool, run } from './db.ts';
import { migrate } from './migrate.ts';
import { productionWithoutHttpsWarning } from './security.ts';
import { seedDemoIfEmpty } from './seed-data.ts';
import { demoSeedEnabled } from './seed-policy.ts';
import { placeholderSecretsProblem } from './placeholder-secrets.ts';
import { abortRunningExports } from './routes/surveys.ts';

const placeholderSecrets = placeholderSecretsProblem(process.env);
if (placeholderSecrets) throw new Error(placeholderSecrets);
const demoSeed = demoSeedEnabled();
const httpsWarning = productionWithoutHttpsWarning();
if (httpsWarning) console.warn(httpsWarning);
await migrate();

if (demoSeed) {
  const seeded = await seedDemoIfEmpty();
  console.log(seeded ? '[seed] data demo dimuat' : '[seed] data demo sudah ada');
} else {
  console.log('[seed] demo nonaktif; gunakan SEED_DEMO=1 atau bootstrap admin untuk basis data kosong');
}

const integrationToken = process.env.INTEGRATION_TOKEN?.trim();
const integrationOrganizationId = process.env.INTEGRATION_ORGANIZATION_ID?.trim();
// BF-09c: kosong → NULL (tanpa kedaluwarsa, perilaku lama); terisi harus ISO-8601 agar salah ketik di
// startup tidak tiba-tiba membuat token berhenti berlaku.
const integrationTokenExpiresAt = process.env.INTEGRATION_TOKEN_EXPIRES_AT?.trim() || null;
if (integrationTokenExpiresAt !== null && Number.isNaN(Date.parse(integrationTokenExpiresAt))) {
  throw new Error('INTEGRATION_TOKEN_EXPIRES_AT harus ISO-8601 (mis. 2027-01-01T00:00:00Z) atau kosong.');
}
if (integrationToken && integrationOrganizationId) {
  await run(
    `INSERT INTO integration_token_scopes (token_hash, organization_id, expires_at, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (token_hash) DO UPDATE SET organization_id = EXCLUDED.organization_id, survey_id = NULL,
       expires_at = EXCLUDED.expires_at, created_at = EXCLUDED.created_at`,
    createHash('sha256').update(integrationToken).digest('hex'),
    integrationOrganizationId,
    integrationTokenExpiresAt,
    new Date().toISOString(),
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
    // PERF-12: `server.close` menunggu respons yang masih mengalir; ekspor CSV yang dipotong harus
    // dibatalkan dan dicatat 'gagal' lebih dulu agar shutdown selesai jauh di bawah batas paksa 5 s.
    void abortRunningExports()
      .catch((error) => console.error('[api] gagal mencatat ekspor yang terpotong', error))
      .then(() => {
        server.close(() => {
          closePool()
            .catch((error) => console.error('[db] gagal menutup pool', error))
            .finally(() => process.exit(0));
        });
        server.closeIdleConnections();
      });
    setTimeout(() => process.exit(1), 5_000).unref();
  });
}
