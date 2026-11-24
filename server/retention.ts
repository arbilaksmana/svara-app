/**
 * BF-06: retensi `responses` dan `consent_records` menurut `retention_days` milik sumber kebijakan survei.
 *
 * Sumber kebijakan mengikuti survei (aturan yang sama dengan `surveyProfileFor` di `http.ts`): survei
 * ber-`organization_id` memakai baris `organizations` itu, survei tanpa organisasi memakai
 * `platform_profile`. `retention_days` NULL (atau <= 0) berarti tidak ada penghapusan otomatis.
 * Penjadwalan bukan tanggung jawab modul ini (OPS-03).
 */
import { randomBytes } from 'node:crypto';
import { all, nowIso, run, withTx } from './db.ts';

const MS_PER_DAY = 86_400_000;

export interface RetentionScope {
  source: 'organization' | 'platform';
  id: string;
  days: number;
}

export interface RetentionBatch {
  scope: RetentionScope;
  responses: number;
  consents: number;
}

export interface PurgeResult {
  scopes: RetentionBatch[];
  dryRun: boolean;
}

/**
 * Kebijakan yang berlaku, per sumber dan bukan per organisasi akun: hanya organisasi yang punya survei
 * (yang menampung barisnya) dan platform bila ada survei tanpa organisasi. `retention_days` NULL atau
 * <= 0 tidak ikut — fail-closed, tanpa angka bawaan.
 */
export async function retentionScopes(): Promise<RetentionScope[]> {
  const scopes: RetentionScope[] = [];
  const organizations = await all<{ id: string; days: number }>(
    `SELECT DISTINCT o.id, o.retention_days AS days
       FROM organizations o
       JOIN surveys s ON s.organization_id = o.id
      WHERE o.retention_days > 0
      ORDER BY o.id`,
  );
  for (const row of organizations) scopes.push({ source: 'organization', id: row.id, days: row.days });
  const platform = await all<{ id: string; days: number }>(
    `SELECT p.id, p.retention_days AS days
       FROM platform_profile p
      WHERE p.id = 'platform' AND p.retention_days > 0
        AND EXISTS (SELECT 1 FROM surveys WHERE organization_id IS NULL)`,
  );
  for (const row of platform) scopes.push({ source: 'platform', id: row.id, days: row.days });
  return scopes;
}

/**
 * Hapus baris yang melewati masa simpan per sumber kebijakan, satu transaksi dan satu baris audit
 * `audit_logs` per batch. Metadata audit hanya memuat kebijakan dan hitungan, tanpa identitas responden
 * atau isi jawaban. `dryRun` menghitung dengan predikat yang sama dan tetap mencatat batch.
 */
export async function purgeExpiredResponses(options: { dryRun: boolean; now?: Date }): Promise<PurgeResult> {
  const ranAt = options.now ?? new Date();
  const batches: RetentionBatch[] = [];
  for (const scope of await retentionScopes()) {
    const cutoff = new Date(ranAt.getTime() - scope.days * MS_PER_DAY).toISOString();
    const counts = await withTx(async () => {
      // dryRun menghitung predikat yang sama tetapi tidak menghapus.
      const result = options.dryRun ? await countExpired(scope, cutoff) : await deleteExpired(scope, cutoff);
      await run(
        'INSERT INTO audit_logs (id, actor, action, object, outcome, at, metadata, account_id, organization_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        `log_${randomBytes(8).toString('hex')}`,
        'sistem',
        'Retensi data',
        scopeSummary(scope),
        // dryRun adalah pemeriksaan, bukan penghapusan: outcome berbeda agar penyaring audit tidak
        // mengira ada data yang benar-benar dihapus.
        options.dryRun ? 'diperiksa' : 'berhasil',
        nowIso(),
        JSON.stringify({ ...scope, ...result, dryRun: options.dryRun }),
        null,
        scope.source === 'organization' ? scope.id : null,
      );
      return result;
    });
    batches.push({ scope, ...counts });
  }
  return { scopes: batches, dryRun: options.dryRun };
}

/** Predikat batas per sumber; dipakai delete dan hitung agar dryRun tidak menyimpang. */
function expiredClause(scope: RetentionScope): { where: string; params: string[] } {
  return scope.source === 'organization'
    ? {
        where: `survey_id IN (SELECT id FROM surveys WHERE organization_id = ?)`,
        params: [scope.id],
      }
    : {
        where: `survey_id IN (SELECT id FROM surveys WHERE organization_id IS NULL)`,
        params: [],
      };
}

function scopeSummary(scope: RetentionScope): string {
  return `${scope.source === 'organization' ? 'organisasi' : 'platform'}:${scope.id} (${scope.days} hari)`;
}

async function countExpired(
  scope: RetentionScope,
  cutoff: string,
): Promise<{ responses: number; consents: number }> {
  const clause = expiredClause(scope);
  const responses = await all<{ n: number }>(`SELECT COUNT(*) AS n FROM responses WHERE ${clause.where} AND submitted_at < ?`, ...clause.params, cutoff);
  const consents = await all<{ n: number }>(`SELECT COUNT(*) AS n FROM consent_records WHERE ${clause.where} AND recorded_at < ?`, ...clause.params, cutoff);
  return { responses: responses[0]!.n, consents: consents[0]!.n };
}

async function deleteExpired(
  scope: RetentionScope,
  cutoff: string,
): Promise<{ responses: number; consents: number }> {
  const clause = expiredClause(scope);
  const responses = await run(`DELETE FROM responses WHERE ${clause.where} AND submitted_at < ?`, ...clause.params, cutoff);
  const consents = await run(`DELETE FROM consent_records WHERE ${clause.where} AND recorded_at < ?`, ...clause.params, cutoff);
  return { responses, consents };
}
