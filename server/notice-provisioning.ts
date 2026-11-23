import { all, get, nowIso, run, withTx } from './db.ts';
import { fail } from './http.ts';

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
  if (noticeProfileName === null) {
    const platform = await get<{ notice_version: string }>("SELECT notice_version FROM platform_profile WHERE id = 'platform'");
    if (!platform) {
      fail(
        409,
        'notice_source_missing',
        'Profil platform belum dikonfigurasi, jadi organisasi baru belum dapat diberi notice platform. ' +
          'Jalankan pnpm admin:bootstrap untuk mengisi profil dan notice platform awal.',
      );
    }
    return platform.notice_version;
  }
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

/** Versi notice platform awal; sama dengan default organizations.notice_version (005). */
const PLATFORM_TEMPLATE_VERSION = '1.0';
const TEMPLATE_MARK = '[Templat awal: wajib ditinjau pengelola platform; bukan teks hukum final]';

/**
 * Teks notice platform awal. Sengaja generik dan bertanda templat: kategori responden (dewasa, anak, wali)
 * ditetapkan per organisasi, jadi templat tidak memuat ketentuan persetujuan wali atau data anak.
 */
const PLATFORM_TEMPLATE_NOTICE = {
  purpose: 'Tujuan pengumpulan data dinyatakan oleh pembuat survei pada setiap instrumen.',
  data_categories: 'Jawaban survei, kode acak peserta, waktu pengiriman, dan catatan persetujuan.',
  module15_usage: 'Ringkasan dan data yang diizinkan dapat diteruskan ke konsumen analitik melalui API terbatas.',
  retention_text: 'Masa retensi belum ditetapkan pengelola.',
  recipients: 'Pembuat survei dan petugas berizin pada survei ini.',
  contact: 'Kanal kontak pengelola belum ditetapkan.',
  rights: 'Akses, koreksi, penarikan persetujuan, dan penghapusan melalui kanal resmi pengelola.',
  child_data_text: 'Ketentuan khusus kategori responden belum ditetapkan pengelola.',
  cross_border_text: 'Ketentuan transfer lintas negara belum ditetapkan pengelola.',
};

export interface PlatformDefaults {
  notice_version: string;
  /** false bila notice platform versi itu sudah ada dan dipakai apa adanya. */
  notice_created: boolean;
}

/**
 * Profil dan notice platform awal untuk instalasi tanpa seed, dipanggil `pnpm admin:bootstrap`. Tanpa
 * keduanya POST /admin/organizations ditolak notice_source_missing dan survei platform tidak dapat dibuat.
 * Hanya mengisi bila profil platform belum ada: profil dan notice yang sudah ada (seed, upgrade, atau hasil
 * tinjauan pengelola) tidak pernah ditimpa, sehingga aman dijalankan ulang. null = profil platform sudah ada.
 */
export async function provisionPlatformDefaults(): Promise<PlatformDefaults | null> {
  return withTx(async () => {
    const now = nowIso();
    const profileCreated = await run(
      `INSERT INTO platform_profile (id, organization_name, organization_type, policy_url, terms_url, retention_days,
         data_request_contact, cross_border_transfer, notice_version, updated_at)
       VALUES ('platform', 'Svara', 'platform', '/privacy', '/terms', NULL, NULL, NULL, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
      PLATFORM_TEMPLATE_VERSION,
      now,
    );
    if (profileCreated === 0) return null;
    const text = (value: string) => `${TEMPLATE_MARK} ${value}`;
    const noticeCreated = await run(
      `INSERT INTO platform_notices (id, version, effective_date, purpose, data_categories, module15_usage,
         retention_text, recipients, contact, rights, child_data_text, cross_border_text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
      `pn_${PLATFORM_TEMPLATE_VERSION.replace('.', '_')}`,
      PLATFORM_TEMPLATE_VERSION,
      now.slice(0, 10),
      text(PLATFORM_TEMPLATE_NOTICE.purpose),
      text(PLATFORM_TEMPLATE_NOTICE.data_categories),
      text(PLATFORM_TEMPLATE_NOTICE.module15_usage),
      text(PLATFORM_TEMPLATE_NOTICE.retention_text),
      text(PLATFORM_TEMPLATE_NOTICE.recipients),
      text(PLATFORM_TEMPLATE_NOTICE.contact),
      text(PLATFORM_TEMPLATE_NOTICE.rights),
      text(PLATFORM_TEMPLATE_NOTICE.child_data_text),
      text(PLATFORM_TEMPLATE_NOTICE.cross_border_text),
      now,
    );
    return { notice_version: PLATFORM_TEMPLATE_VERSION, notice_created: noticeCreated > 0 };
  });
}
