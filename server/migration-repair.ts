import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { get, nowIso, run, withTx } from './db.ts';
import { migrationFiles } from './migrate.ts';

/**
 * Reparasi checksum hanya untuk migrasi yang isinya sudah diverifikasi dan berubah setelah sempat
 * diterapkan di DB lama. Tidak ada jalur otomatis: setiap entri menyebut checksum lama yang boleh
 * diganti, salinan isi lama untuk diff audit, dan alasannya. Migrasi lain yang checksum-nya berbeda
 * tetap ditolak `migrate()` sampai isinya dikembalikan atau migrasi baru dibuat.
 */
export interface ChecksumRepairEntry {
  version: string;
  supersededChecksums: string[];
  previousFile: string;
  reason: string;
}

const REPAIRS_DIR = fileURLToPath(new URL('./migrations/repairs', import.meta.url));

export const CHECKSUM_REPAIRS: ChecksumRepairEntry[] = [
  {
    version: '019_close_superseded_published_versions.sql',
    // Isi lama yang ditulis 740d9d8 lalu diterapkan ke DB dev/uji sebelum perbaikan cast expires_at.
    supersededChecksums: ['2fb61d46618321c3d558881cea7031ef552d70ecdd4a380fa5e812de28e3bcab'],
    previousFile: `${REPAIRS_DIR}/019_close_superseded_published_versions@2fb61d46.sql`,
    reason:
      'Cast expires_at dilindungi CASE agar satu baris public_links yang diedit manual tidak menggagalkan upgrade; ' +
      'perubahan hanya menyentuh baris kondisional, bukan efek migrasi untuk data yang valid.',
  },
];

export interface ChecksumRepair {
  version: string;
  previousChecksum: string | null;
  checksum: string;
  changed: boolean;
  diff: string;
  auditId: string | null;
}

interface StoredChecksum {
  checksum: string;
}

/** Diff unified berkonteks 2 baris; cukup untuk audit isi migrasi yang berukuran puluhan baris. */
export function unifiedDiff(previous: string, next: string, previousLabel: string, nextLabel: string): string {
  const before = previous.replace(/\r\n?/g, '\n').split('\n');
  const after = next.replace(/\r\n?/g, '\n').split('\n');
  const rows = before.length + 1;
  const cols = after.length + 1;
  // lcs[i][j] = panjang LCS dari before[i..] dan after[j..].
  const lcs = Array.from({ length: rows }, () => new Uint32Array(cols));
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      lcs[i]![j] = before[i] === after[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  type Op = { kind: ' ' | '-' | '+'; text: string };
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      ops.push({ kind: ' ', text: before[i]! });
      i += 1;
      j += 1;
    } else if (j < after.length && (i >= before.length || lcs[i]![j + 1]! > lcs[i + 1]![j]!)) {
      ops.push({ kind: '+', text: after[j]! });
      j += 1;
    } else {
      ops.push({ kind: '-', text: before[i]! });
      i += 1;
    }
  }

  const context = 2;
  const changed = ops.map((op, index) => (op.kind === ' ' ? -1 : index)).filter((index) => index >= 0);
  if (changed.length === 0) return '';
  const hunks: Array<[number, number]> = [];
  for (const index of changed) {
    const start = Math.max(0, index - context);
    const end = Math.min(ops.length - 1, index + context);
    const last = hunks[hunks.length - 1];
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else hunks.push([start, end]);
  }

  const lines = [`--- ${previousLabel}`, `+++ ${nextLabel}`];
  for (const [start, end] of hunks) {
    const slice = ops.slice(start, end + 1);
    const beforeStart = ops.slice(0, start).filter((op) => op.kind !== '+').length;
    const afterStart = ops.slice(0, start).filter((op) => op.kind !== '-').length;
    const beforeCount = slice.filter((op) => op.kind !== '+').length;
    const afterCount = slice.filter((op) => op.kind !== '-').length;
    lines.push(
      `@@ -${beforeCount === 0 ? beforeStart : beforeStart + 1},${beforeCount} +${afterCount === 0 ? afterStart : afterStart + 1},${afterCount} @@`,
    );
    for (const op of slice) lines.push(`${op.kind}${op.text}`);
  }
  return lines.join('\n');
}

/**
 * Tulis ulang checksum tersimpan satu versi setelah pemanggil menyebut checksum lama (`acceptChecksum`)
 * dan diff isi lama vs baru dicetak oleh CLI. Menolak versi yang tidak terdaftar, belum diterapkan,
 * atau yang checksum tersimpannya bukan checksum lama yang dikenal. Perubahan + audit satu transaksi.
 */
export async function repairChecksum(options: { version: string; acceptChecksum: string }): Promise<ChecksumRepair> {
  const file = migrationFiles().find((candidate) => candidate.version === options.version);
  if (!file) throw new Error(`Migrasi ${options.version} tidak ditemukan di server/migrations.`);
  const entry = CHECKSUM_REPAIRS.find((candidate) => candidate.version === options.version);
  if (!entry) {
    throw new Error(
      `Reparasi checksum ${options.version} tidak terdaftar. Kembalikan isi migrasi atau buat migrasi baru; ` +
        'jalur reparasi hanya untuk perubahan yang sudah diverifikasi dan dicatat di server/migration-repair.ts.',
    );
  }
  const stored = await get<StoredChecksum>('SELECT checksum FROM schema_migrations WHERE version = ?', options.version);
  if (!stored) throw new Error(`Migrasi ${options.version} belum diterapkan di basis data ini.`);
  if (stored.checksum === file.checksum) {
    return { version: options.version, previousChecksum: stored.checksum, checksum: file.checksum, changed: false, diff: '', auditId: null };
  }
  if (options.acceptChecksum !== stored.checksum) {
    throw new Error(
      `--accept ${options.acceptChecksum} tidak sama dengan checksum tersimpan ${stored.checksum}. ` +
        'Periksa diff isi lama vs baru, lalu ulangi dengan checksum tersimpan yang tercetak.',
    );
  }
  if (!entry.supersededChecksums.includes(stored.checksum)) {
    throw new Error(
      `Checksum tersimpan ${stored.checksum} bukan checksum lama yang dikenal untuk ${options.version}. ` +
        'Perubahan isi migrasi tidak boleh ditambal tanpa bukti bahwa isinya sudah diverifikasi.',
    );
  }

  const previousSql = readFileSync(entry.previousFile, 'utf8');
  const diff = unifiedDiff(
    previousSql,
    file.sql,
    `${options.version}@${stored.checksum.slice(0, 8)} (isi pertama diterapkan)`,
    `${options.version} (isi sekarang)`,
  );
  const auditId = `aud_${randomBytes(8).toString('hex')}`;
  await withTx(async () => {
    await run('UPDATE schema_migrations SET checksum = ? WHERE version = ?', file.checksum, options.version);
    await run(
      `INSERT INTO audit_logs (id, actor, action, object, outcome, at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      auditId,
      'operator:db-repair-checksum',
      'Reparasi checksum migrasi',
      options.version,
      'berhasil',
      nowIso(),
      JSON.stringify({ previous_checksum: stored.checksum, checksum: file.checksum, reason: entry.reason }),
    );
  });

  return { version: options.version, previousChecksum: stored.checksum, checksum: file.checksum, changed: true, diff, auditId };
}
