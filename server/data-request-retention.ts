/**
 * NEW-01: job retensi permintaan data — anonimkan baris yang melewati masa simpan.
 * Aman dijalankan berulang: anonimized_at menandai baris yang sudah diproses.
 */
import { createHash } from 'node:crypto';
import { all, closePool, run } from './db.ts';

export const DEFAULT_RETENTION_DAYS = 365;
const MS_PER_DAY = 86_400_000;

export function retentionDays(raw = process.env.DATA_REQUEST_RETENTION_DAYS): number {
  const value = raw?.trim();
  if (!value) return DEFAULT_RETENTION_DAYS;
  const days = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(days) || days < 1) {
    throw new Error(`DATA_REQUEST_RETENTION_DAYS tidak valid: "${raw}". Isi bilangan bulat >= 1 (hari).`);
  }
  return days;
}

export function anonymizedContact(id: string): string {
  return `anon:${createHash('sha256').update(id).digest('hex').slice(0, 16)}`;
}

/** Pengganti kanal balasan teks bebas, yang bisa memuat kontak pemohon; jejak bahwa pemohon sudah dibalas tetap ada. */
const ANONYMIZED_CHANNEL = 'dianonimkan';

/** Kode kanal balasan dari UI admin (`src/screens/Admin.tsx`) tidak memuat kontak sehingga dipertahankan. */
const KEPT_CHANNELS = `'email', 'phone', 'messaging', 'letter', 'in_person', '${ANONYMIZED_CHANNEL}'`;

/**
 * Baris lewat masa simpan yang belum dianonimkan, ditambah baris yang ditandai versi job sebelumnya tanpa
 * mengosongkan `outcome_note` dan kanal balasan teks bebas.
 */
const NEEDS_ANONYMIZATION = `(anonymized_at IS NULL AND created_at < ?)
   OR (anonymized_at IS NOT NULL AND (note IS NOT NULL OR outcome_note IS NOT NULL
       OR (response_channel IS NOT NULL AND response_channel NOT IN (${KEPT_CHANNELS}))))`;

export async function anonymizeExpiredDataRequests(
  options: { days?: number; now?: Date } = {},
): Promise<{ days: number; anonymized: number }> {
  const days = options.days ?? retentionDays();
  const ranAt = options.now ?? new Date();
  const cutoff = new Date(ranAt.getTime() - days * MS_PER_DAY).toISOString();
  const rows = await all<{ id: string }>(`SELECT id FROM data_requests WHERE ${NEEDS_ANONYMIZATION}`, cutoff);
  let anonymized = 0;
  for (const row of rows) {
    anonymized += await run(
      `UPDATE data_requests
          SET contact = ?, note = NULL, outcome_note = NULL,
              response_channel = CASE WHEN response_channel IS NULL OR response_channel IN (${KEPT_CHANNELS})
                                      THEN response_channel ELSE ? END,
              anonymized_at = ?, updated_at = ?
        WHERE id = ? AND (${NEEDS_ANONYMIZATION})`,
      anonymizedContact(row.id),
      ANONYMIZED_CHANNEL,
      ranAt.toISOString(),
      ranAt.toISOString(),
      row.id,
      cutoff,
    );
  }
  return { days, anonymized };
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/data-request-retention.ts')) {
  anonymizeExpiredDataRequests()
    .then(({ days, anonymized }) => {
      console.log(`[retensi] ${anonymized} permintaan data dianonimkan (masa simpan ${days} hari).`);
    })
    .catch((error) => {
      console.error('[retensi]', error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => closePool());
}
