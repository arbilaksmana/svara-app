/**
 * DEMO ONLY — uji pg_dump/pg_restore lokal pada basis data sintetis.
 * Bukan bukti kelayakan operasional, RPO/RTO, atau audit produksi.
 *
 * Skrip membuat basis data sementara sendiri, mengambil dump custom, menghapus
 * satu respons, menghapus lalu membuat ulang basis data, dan memulihkan dump.
 * Tidak pernah menyentuh basis data yang sudah ada selain membuat basis data baru.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { sourceBaseline } from './demo-db.ts';

const adminRaw = process.env.AC15_ADMIN_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!adminRaw) {
  throw new Error('AC15_ADMIN_DATABASE_URL atau DATABASE_URL wajib diisi (butuh izin CREATE DATABASE).');
}

const adminUrl = new URL(adminRaw);
const dbName = `svara_ac15_${randomBytes(4).toString('hex')}`;
const sourceUrl = new URL(adminRaw);
sourceUrl.pathname = `/${dbName}`;
const sourceUrlText = sourceUrl.toString();

const workDir = mkdtempSync(resolve(tmpdir(), 'svara-ac15-'));
const backupPath = resolve(workDir, 'backup.dump');
const evidencePath = resolve('docs/test-evidence/ac15-restore.json');
const dockerImage = process.env.AC15_PG_IMAGE ?? 'postgres:17-alpine';

interface PgTool {
  command: string;
  args: string[];
  mode: 'native' | 'docker';
  version: string;
}

const shellPath = resolve(workDir).replaceAll('\\', '/');

function dockerPrefix(): string[] {
  const args = ['run', '--rm', '-v', `${shellPath}:/backup`, '-e', `PGPASSWORD=${decodeURIComponent(sourceUrl.password)}`];
  if (process.platform === 'linux') {
    args.push('--network', 'host');
  } else {
    args.push('--add-host', 'host.docker.internal:host-gateway');
  }
  return [...args, dockerImage];
}

function dockerUrl(): string {
  if (process.platform === 'linux') return sourceUrlText;
  const url = new URL(sourceUrlText);
  url.hostname = 'host.docker.internal';
  return url.toString();
}

function resolveTool(tool: 'pg_dump' | 'pg_restore', nativeArgs: string[], dockerArgs: string[]): PgTool {
  const native = spawnSync(tool, ['--version'], { encoding: 'utf8' });
  if (native.status === 0) {
    return { command: tool, args: nativeArgs, mode: 'native', version: native.stdout.trim() };
  }
  const docker = spawnSync('docker', ['--version'], { encoding: 'utf8' });
  if (docker.status !== 0) {
    throw new Error(`${tool} tidak ada di PATH dan Docker tidak tersedia. Pasang klien PostgreSQL atau jalankan dengan Docker.`);
  }
  return { command: 'docker', args: [...dockerPrefix(), tool, ...dockerArgs], mode: 'docker', version: `${dockerImage}: ${tool}` };
}

function runTool(tool: PgTool, label: string): void {
  const result = spawnSync(tool.command, tool.args, { encoding: 'utf8', timeout: 180_000 });
  if (result.status !== 0) {
    throw new Error(`${label} gagal (kode ${result.status}): ${result.stderr || result.stdout}`);
  }
}

async function withClient<T>(url: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function counts(url: string): Promise<{ responses: number; answers: number; audit_logs: number; server_version: string }> {
  return withClient(url, async (client) => {
    const result = await client.query<{ responses: number; answers: number; audit_logs: number; server_version: string }>(
      `SELECT
         (SELECT COUNT(*)::int FROM responses) AS responses,
         (SELECT COUNT(*)::int FROM answers) AS answers,
         (SELECT COUNT(*)::int FROM audit_logs) AS audit_logs,
         current_setting('server_version') AS server_version`,
    );
    const row = result.rows[0];
    if (!row) throw new Error('gagal membaca jumlah baris.');
    return row;
  });
}

async function recreateDatabase(): Promise<void> {
  await withClient(adminUrl.toString(), async (client) => {
    await client.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [dbName]);
    await client.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    await client.query(`CREATE DATABASE "${dbName}"`);
  });
}

try {
  await withClient(adminUrl.toString(), async (client) => {
    await client.query(`CREATE DATABASE "${dbName}"`);
  });

  const seeded = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'server/seed.ts', '--reset'],
    { env: { ...process.env, DATABASE_URL: sourceUrlText, SEED_DEMO: '1' }, encoding: 'utf8', timeout: 120_000 },
  );
  if (seeded.status !== 0) throw new Error(`seed gagal: ${seeded.stderr || seeded.stdout}`);

  const before = await counts(sourceUrlText);
  const targetId = await withClient(sourceUrlText, async (client) => {
    const row = await client.query<{ id: string }>('SELECT id FROM responses ORDER BY submitted_at LIMIT 1');
    return row.rows[0]?.id;
  });
  if (!targetId) throw new Error('tidak ada respons sintetis untuk diuji');

  const dump = resolveTool(
    'pg_dump',
    ['--dbname', sourceUrlText, '--format=custom', '--file', backupPath],
    ['--dbname', dockerUrl(), '--format=custom', '--file', '/backup/backup.dump'],
  );
  runTool(dump, 'pg_dump');
  const backupSize = statSync(backupPath).size;

  await withClient(sourceUrlText, async (client) => {
    await client.query('BEGIN');
    await client.query('DELETE FROM responses WHERE id = $1', [targetId]);
    await client.query(
      'INSERT INTO audit_logs (id, actor, action, object, outcome, at) VALUES ($1, $2, $3, $4, $5, $6)',
      [`audit_ac15_${randomUUID()}`, 'demo-ac15', 'Penghapusan sintetis', targetId, 'berhasil', new Date().toISOString()],
    );
    await client.query('COMMIT');
  });

  const afterDelete = await counts(sourceUrlText);
  const deletedPresent = await withClient(sourceUrlText, async (client) => {
    const row = await client.query('SELECT 1 FROM responses WHERE id = $1', [targetId]);
    return row.rowCount !== 0;
  });

  await recreateDatabase();

  const restore = resolveTool(
    'pg_restore',
    ['--dbname', sourceUrlText, '--clean', '--if-exists', '--no-owner', '--no-privileges', backupPath],
    ['--dbname', dockerUrl(), '--clean', '--if-exists', '--no-owner', '--no-privileges', '/backup/backup.dump'],
  );
  runTool(restore, 'pg_restore');

  const restored = await withClient(sourceUrlText, async (client) => {
    const row = await client.query<{ id: string }>('SELECT id FROM responses WHERE id = $1', [targetId]);
    return row.rows[0]?.id;
  });
  await withClient(sourceUrlText, async (client) => {
    await client.query(
      'INSERT INTO audit_logs (id, actor, action, object, outcome, at) VALUES ($1, $2, $3, $4, $5, $6)',
      [`audit_ac15_${randomUUID()}`, 'demo-ac15', 'Pemulihan sintetis', targetId, 'berhasil', new Date().toISOString()],
    );
  });
  const afterRestore = await counts(sourceUrlText);

  const deleteUndone = afterRestore.responses === before.responses && restored === targetId;
  if (deletedPresent) throw new Error('penghapusan sintetis tidak berlaku');
  if (!deleteUndone) throw new Error('pemulihan tidak mengembalikan respons yang dihapus');

  const report = {
    label: 'DEMO ONLY — uji pg_dump/pg_restore lokal, bukan bukti audit atau kesiapan produksi',
    generated_at: new Date().toISOString(),
    environment: {
      node: process.version,
      baseline: sourceBaseline(),
      platform: `${process.platform} ${process.arch}`,
      storage: 'PostgreSQL via pg',
      postgres_server_version: before.server_version,
      database: dbName,
      tools: { pg_dump: dump.version, pg_restore: restore.version, mode: dump.mode },
    },
    commands: {
      dump: 'pg_dump --dbname="$DATABASE_URL" --format=custom --file=backup.dump',
      restore: 'pg_restore --dbname="$DATABASE_URL" --clean --if-exists --no-owner --no-privileges backup.dump',
      note: 'Di lingkungan tanpa klien PostgreSQL, skrip memakai image postgres resmi lewat Docker.',
    },
    steps: [
      'Buat basis data sementara baru dan seed data sintetis.',
      'pg_dump format custom ke file cadangan.',
      'Hapus satu respons sintetis dan catat audit.',
      'Hapus lalu buat ulang basis data (kosong).',
      'pg_restore memulihkan dump dan verifikasi respons kembali.',
      'Catat audit pemulihan setelah restore.',
    ],
    before: { ...before, backup_created: backupSize > 0, backup_bytes: backupSize },
    after_delete: { ...afterDelete, target_present: deletedPresent },
    after_restore: { ...afterRestore, target_present: restored === targetId },
    interpretation: {
      deletion_is_undone_by_restore: deleteUndone,
      note: 'Pemulihan mengembalikan keadaan cadangan. Penghapusan permintaan data setelah restore harus diulang dan dicatat; jangan mengklaim bahwa restore menghapus data secara permanen.',
    },
    limitations: [
      'Tidak menguji cadangan terenkripsi, penyimpanan off-site, atau RPO/RTO.',
      'Basis data, klien, dan alat cadangan berjalan di mesin yang sama.',
      'Tidak menggantikan prosedur operasional dan persetujuan pengendali data.',
      'File bukti hanya ringkasan lokal, bukan audit pihak ketiga.',
    ],
  };

  mkdirSync(resolve('docs/test-evidence'), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nBukti ditulis ke ${evidencePath}`);
} finally {
  try {
    await withClient(adminUrl.toString(), async (client) => {
      await client.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [dbName]);
      await client.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    });
  } catch (error) {
    console.error('[ac15] gagal membersihkan basis data sementara', error);
  }
  rmSync(workDir, { recursive: true, force: true });
}
