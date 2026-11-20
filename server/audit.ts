import { randomBytes } from 'node:crypto';
import { nowIso, run } from './db.ts';

export type AuditOutcome = 'berhasil' | 'ditolak' | 'gagal';

/**
 * Log audit tidak pernah memuat token, kredensial, isi jawaban, atau teks bebas.
 * `object` hanya berisi ID objek dan nomor versi.
 * `accountId` adalah akun pelaku bila `actor` adalah ID akun; `null` untuk aktor mesin/publik.
 */
export async function audit(
  actor: string,
  action: string,
  object: string,
  outcome: AuditOutcome = 'berhasil',
  accountId: string | null = null,
): Promise<void> {
  await run(
    'INSERT INTO audit_logs (id, actor, action, object, outcome, at, account_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    `log_${randomBytes(6).toString('hex')}`,
    actor,
    action,
    object,
    outcome,
    nowIso(),
    accountId,
  );
}
