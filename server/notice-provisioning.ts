import { all, get, run, withTx } from './db.ts';
import { fail, noticeVersionFor } from './http.ts';

/** Asal notice awal organisasi baru; dicatat di audit `Buat organisasi`. */
export type NewOrganizationNoticeSource = 'legacy' | 'platform';

export interface NoticeProvisioning {
  source: NewOrganizationNoticeSource;
  organization_notices: number;
}

/** Teks SELECT yang tercatat di katalog sumber (015, 018); katalog yang hilang berarti migrasi belum lengkap. */
async function catalogSource(id: NewOrganizationNoticeSource): Promise<string> {
  const row = await get<{ select_sql: string }>('SELECT select_sql FROM organization_notice_sources WHERE id = ?', id);
  if (!row) fail(500, 'notice_catalog_missing', `Sumber notice organisasi '${id}' belum tersedia; jalankan migrasi terbaru.`);
  return row.select_sql;
}

const ORGANIZATION_NOTICE_COLUMNS = `(id, organization_id, version, effective_date, purpose, data_categories,
  module15_usage, retention_text, recipients, contact, rights, child_data_text, cross_border_text, created_at)`;

/** Padanan eksplisit profil legacy (bukan nama organisasi), idempoten terhadap panggilan ulang. */
export async function provisionOrganizationNotice(organizationId: string, noticeProfileName: string): Promise<number> {
  return run(
    `INSERT INTO organization_notices ${ORGANIZATION_NOTICE_COLUMNS}
     ${await catalogSource('legacy')}
     ON CONFLICT DO NOTHING`,
    noticeProfileName,
    organizationId,
  );
}

/** Salinan notice platform untuk organizations.notice_version, idempoten terhadap panggilan ulang. */
async function provisionOrganizationNoticeFromPlatform(organizationId: string): Promise<number> {
  return run(
    `INSERT INTO organization_notices ${ORGANIZATION_NOTICE_COLUMNS}
     ${await catalogSource('platform')}
     ON CONFLICT DO NOTHING`,
    organizationId,
  );
}

/**
 * notice_version organisasi baru bila tidak dikirim: versi yang berlaku di sumber noticenya (PRD §1.2,
 * "mengikuti template notice yang berlaku"), yaitu platform_profile.notice_version, atau
 * profiles.notice_version bila profil legacy dipilih lewat notice_profile_name.
 */
export async function noticeVersionForNewOrganization(noticeProfileName: string | null): Promise<string> {
  if (noticeProfileName === null) return (await noticeVersionFor(null)).notice_version;
  const profile = await get<{ notice_version: string }>(
    'SELECT notice_version FROM profiles WHERE organization_name = ? ORDER BY id LIMIT 1',
    noticeProfileName,
  );
  if (!profile) {
    fail(422, 'notice_version_unavailable', `Profil pemberitahuan legacy "${noticeProfileName}" tidak ditemukan.`, {
      notice_profile_name: noticeProfileName,
    });
  }
  return profile.notice_version;
}

/**
 * Notice awal organisasi baru disediakan eksplisit saat pembuatan, bukan dicari saat formulir dibaca:
 * dari profil legacy yang dipilih lewat notice_profile_name, atau salinan notice platform untuk versi
 * organisasi. Tidak ada teks yang dikarang; tanpa notice versi itu permintaan ditolak 422 dan transaksi
 * pemanggil ikut batal sehingga organisasi tanpa notice tidak pernah tersimpan.
 */
export async function provisionNoticesForNewOrganization(
  organizationId: string,
  noticeVersion: string,
  noticeProfileName: string | null,
): Promise<NoticeProvisioning> {
  return withTx(async () => {
    const source: NewOrganizationNoticeSource = noticeProfileName === null ? 'platform' : 'legacy';
    const organization_notices =
      noticeProfileName === null
        ? await provisionOrganizationNoticeFromPlatform(organizationId)
        : await provisionOrganizationNotice(organizationId, noticeProfileName);
    const available = await get<{ ok: number }>(
      'SELECT 1 AS ok FROM organization_notices WHERE organization_id = ? AND version = ?',
      organizationId,
      noticeVersion,
    );
    if (!available && noticeProfileName !== null) {
      fail(
        422,
        'notice_version_unavailable',
        `Profil pemberitahuan legacy "${noticeProfileName}" tidak ada atau tidak memiliki notice versi ${noticeVersion}.`,
        { notice_version: noticeVersion, notice_profile_name: noticeProfileName },
      );
    }
    if (!available) {
      const versions = (await all<{ version: string }>('SELECT version FROM platform_notices ORDER BY version')).map(
        (row) => row.version,
      );
      fail(
        422,
        'notice_version_unavailable',
        `Notice platform versi ${noticeVersion} belum tersedia, jadi organisasi baru tidak dapat diberi pemberitahuan responden. ` +
          (versions.length ? `Versi notice platform yang tersedia: ${versions.join(', ')}.` : 'Belum ada notice platform sama sekali.'),
        { notice_version: noticeVersion, available_platform_versions: versions },
      );
    }
    return { source, organization_notices };
  });
}
