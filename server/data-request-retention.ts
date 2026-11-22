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

export async function anonymizeExpiredDataRequests(
  options: { days?: number; now?: Date } = {},
): Promise<{ days: number; anonymized: number }> {
  const days = options.days ?? retentionDays();
  const cutoff = new Date((options.now ?? new Date()).getTime() - days * MS_PER_DAY).toISOString();
  const rows = await all<{ id: string }>(
    'SELECT id FROM data_requests WHERE anonymized_at IS NULL AND created_at < ?',
    cutoff,
  );
  for (const row of rows) {
    await run(
      `UPDATE data_requests
          SET contact = ?, note = NULL, anonymized_at = ?, updated_at = ?
        WHERE id = ? AND anonymized_at IS NULL`,
      anonymizedContact(row.id),
      cutoff,
      cutoff,
      row.id,
    );
  }
  return { days, anonymized: rows.length };
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
