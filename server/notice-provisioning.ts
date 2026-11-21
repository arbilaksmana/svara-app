import { get, run, withTx } from './db.ts';

export interface NoticeProvisioning {
  organization_notices: number;
  platform_notices: number;
}

/** Padanan profil deployment legacy yang diminta; tanpa padanan tidak ada teks notice yang boleh dipakai. */
export async function legacyProfileExists(name: string): Promise<boolean> {
  return (await get('SELECT 1 AS ok FROM profiles WHERE organization_name = ?', name)) !== undefined;
}

/** Notice organisasi baru hanya boleh berasal dari profil legacy yang dipilih eksplisit. */
export class NoticeVersionUnavailable extends Error {
  constructor(readonly version: string) {
    super(`Tidak ada notice legacy untuk versi ${version}.`);
    this.name = 'NoticeVersionUnavailable';
  }
}

async function catalogSource(table: 'organization_notice_sources' | 'platform_notice_sources', id: string): Promise<string> {
  const row = await get<{ select_sql: string }>(`SELECT select_sql FROM ${table} WHERE id = ?`, id);
  if (!row) throw new Error(`Sumber notice ${table} tidak tersedia; jalankan migrasi 015.`);
  return row.select_sql;
}

const ORGANIZATION_NOTICE_COLUMNS = `(id, organization_id, version, effective_date, purpose, data_categories,
  module15_usage, retention_text, recipients, contact, rights, child_data_text, cross_border_text, created_at)`;
const PLATFORM_NOTICE_COLUMNS = `(id, version, effective_date, purpose, data_categories, module15_usage,
  retention_text, recipients, contact, rights, child_data_text, cross_border_text, created_at)`;

/** Padanan eksplisit profil legacy (bukan nama organisasi), idempoten terhadap panggilan ulang. */
export async function provisionOrganizationNotice(organizationId: string, noticeProfileName: string): Promise<number> {
  return run(
    `INSERT INTO organization_notices ${ORGANIZATION_NOTICE_COLUMNS}
     ${await catalogSource('organization_notice_sources', 'legacy')}
     ON CONFLICT DO NOTHING`,
    noticeProfileName,
    organizationId,
  );
}

export async function provisionPlatformNotices(): Promise<number> {
  return run(
    `INSERT INTO platform_notices ${PLATFORM_NOTICE_COLUMNS}
     ${await catalogSource('platform_notice_sources', 'platform')}
     ON CONFLICT DO NOTHING`,
  );
}

/**
 * Tanpa notice untuk `noticeVersion`, survei publik organisasi baru gagal notice_version_unavailable.
 * Tidak ada teks notice yang dikarang di sini: permintaan ditolak dan transaksi pemanggil ikut batal.
 */
export async function provisionNoticesForNewOrganization(
  organizationId: string,
  noticeVersion: string,
  noticeProfileName: string,
): Promise<NoticeProvisioning> {
  return withTx(async () => {
    const platform_notices = await provisionPlatformNotices();
    const organization_notices = await provisionOrganizationNotice(organizationId, noticeProfileName);
    const forVersion =
      (
        await get<{ count: number }>(
          'SELECT COUNT(*) AS count FROM organization_notices WHERE organization_id = ? AND version = ?',
          organizationId,
          noticeVersion,
        )
      )?.count ?? 0;
    if (forVersion === 0) throw new NoticeVersionUnavailable(noticeVersion);
    return { organization_notices, platform_notices };
  });
}
