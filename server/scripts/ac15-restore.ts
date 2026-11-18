/**
 * DEMO ONLY — uji cadangan/pulihkan lokal pada basis data sintetis.
 * Bukan bukti kelayakan operasional, RPO/RTO, atau audit produksi.
 */
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const workDir = mkdtempSync(resolve(tmpdir(), 'svara-ac15-'));
const dbPath = resolve(workDir, 'source.sqlite');
const backupPath = resolve(workDir, 'backup.sqlite');
const evidencePath = resolve('docs/test-evidence/ac15-restore.json');

function open(path: string): DatabaseSync {
  return new DatabaseSync(path);
}

function count(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
  return Number(row.count);
}

function audit(db: DatabaseSync, actor: string, action: string, object: string): void {
  db.prepare(
    'INSERT INTO audit_logs (id, actor, action, object, outcome, at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(`audit_ac15_${randomUUID()}`, actor, action, object, 'berhasil', new Date().toISOString());
}

try {
  const seeded = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'server/seed.ts', '--reset'],
    { env: { ...process.env, DB_PATH: dbPath }, encoding: 'utf8' },
  );
  if (seeded.status !== 0) {
    throw new Error(`seed gagal: ${seeded.stderr || seeded.stdout}`);
  }

  let db = open(dbPath);
  const beforeResponses = count(db, 'responses');
  const beforeAnswers = count(db, 'answers');
  const beforeAudit = count(db, 'audit_logs');
  const target = db.prepare('SELECT id FROM responses ORDER BY submitted_at LIMIT 1').get() as
    | { id: string }
    | undefined;
  if (!target) throw new Error('tidak ada respons sintetis untuk diuji');
  const targetId = target.id;

  db.exec(`VACUUM INTO '${backupPath.replaceAll('\\', '/').replaceAll("'", "''")}'`);
  const backupSize = existsSync(backupPath);

  db.exec('BEGIN');
  db.prepare('DELETE FROM responses WHERE id = ?').run(targetId);
  audit(db, 'demo-ac15', 'Penghapusan sintetis', targetId);
  db.exec('COMMIT');
  const afterDeleteResponse = db.prepare('SELECT COUNT(*) AS count FROM responses WHERE id = ?').get(targetId) as { count: number };
  const afterDeleteResponses = count(db, 'responses');
  const afterDeleteAnswers = count(db, 'answers');
  db.close();

  copyFileSync(backupPath, dbPath);
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });

  db = open(dbPath);
  const restored = db.prepare('SELECT id FROM responses WHERE id = ?').get(targetId) as { id: string } | undefined;
  audit(db, 'demo-ac15', 'Pemulihan sintetis', targetId);
  const afterRestoreResponses = count(db, 'responses');
  const afterRestoreAnswers = count(db, 'answers');
  const afterRestoreAudit = count(db, 'audit_logs');
  const deleteUndone = afterRestoreResponses === beforeResponses && restored?.id === targetId;
  db.close();

  if (afterDeleteResponse.count !== 0) throw new Error('penghapusan sintetis tidak berlaku');
  if (!deleteUndone) throw new Error('pemulihan tidak mengembalikan respons yang dihapus');

  const report = {
    label: 'DEMO ONLY — uji cadangan/pulihkan lokal, bukan bukti audit atau kesiapan produksi',
    generated_at: new Date().toISOString(),
    environment: { node: process.version, platform: `${process.platform} ${process.arch}`, storage: 'SQLite node:sqlite' },
    steps: [
      'Seed basis data sintetis.',
      'VACUUM INTO untuk membuat cadangan.',
      'Hapus satu respons sintetis dan catat audit.',
      'Pulihkan cadangan, buka ulang, dan verifikasi respons kembali.',
      'Catat audit pemulihan setelah restore.',
    ],
    before: { responses: beforeResponses, answers: beforeAnswers, audit_logs: beforeAudit, backup_created: backupSize },
    after_delete: { responses: afterDeleteResponses, answers: afterDeleteAnswers, target_present: afterDeleteResponse.count !== 0 },
    after_restore: { responses: afterRestoreResponses, answers: afterRestoreAnswers, audit_logs: afterRestoreAudit, target_present: restored?.id === targetId },
    interpretation: {
      deletion_is_undone_by_restore: deleteUndone,
      note: 'Pemulihan mengembalikan keadaan cadangan. Penghapusan permintaan data setelah restore harus diulang dan dicatat; jangan mengklaim bahwa restore menghapus data secara permanen.',
    },
    limitations: [
      'Tidak menguji cadangan terenkripsi, penyimpanan off-site, atau RPO/RTO.',
      'Tidak menggantikan prosedur operasional dan persetujuan pengendali data.',
      'File bukti hanya ringkasan lokal, bukan audit pihak ketiga.',
    ],
  };

  mkdirSync(resolve('docs/test-evidence'), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nBukti ditulis ke ${evidencePath}`);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
