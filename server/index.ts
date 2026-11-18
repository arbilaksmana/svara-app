import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { app, attachStatic } from './app.ts';
import { DB_PATH, ensureSchema } from './db.ts';
import { seedIfEmpty } from './seed-data.ts';

ensureSchema();
seedIfEmpty();

const serveStatic = process.argv.includes('--serve') || process.env.SERVE_STATIC === '1';
const dist = resolve('dist');
if (serveStatic && existsSync(dist)) attachStatic(app, dist);

const port = Number(process.env.PORT ?? (serveStatic ? 3000 : 3001));
const host = process.env.HOST ?? '127.0.0.1';

app.listen(port, host, () => {
  console.log(`[api] Svara berjalan di http://${host}:${port}`);
  console.log(`[db] ${DB_PATH}`);
  console.log(`[static] ${serveStatic && existsSync(dist) ? dist : 'nonaktif (gunakan Vite di port 5173)'}`);
});
