import type { DeploymentProfile, Notice } from '../types';

/**
 * Profil deployment sintetis (PRD §1.2).
 * Set 1 sengaja membiarkan retensi, kontak, dan transfer lintas negara kosong:
 * PRD §14 menyebutnya keputusan pengendali yang belum ditetapkan.
 */
export const profiles: Record<string, DeploymentProfile> = {
  p_smk: {
    id: 'p_smk',
    organization_name: 'Organisasi contoh: sekolah (nama sintetis)',
    organization_type: 'school',
    respondent_age_category: 'minor',
    consent_mode: 'guardian',
    policy_url: '/privacy',
    terms_url: '/terms',
    retention_days: null,
    data_request_contact: null,
    cross_border_transfer: null,
    notice_version: 'notice-sintetis-1.0',
    synthetic_placeholder: true,
  },
  p_perpus: {
    id: 'p_perpus',
    organization_name: 'Organisasi contoh: layanan perpustakaan (nama sintetis)',
    organization_type: 'organization',
    respondent_age_category: 'adult',
    consent_mode: 'self',
    policy_url: '/privacy',
    terms_url: '/terms',
    retention_days: 90,
    data_request_contact: 'kontak-sintetis@contoh.invalid',
    cross_border_transfer: false,
    notice_version: 'notice-sintetis-1.0',
    synthetic_placeholder: true,
  },
};

const PLACEHOLDER = 'PLACEHOLDER SINTETIS: teks final ditetapkan pengendali sebelum data nyata (PRD §9.3, §14).';

export const notices: Record<string, Notice> = {
  p_smk: {
    id: 'n_smk',
    profile_id: 'p_smk',
    version: 'notice-sintetis-1.0',
    effective_date: '2026-11-17',
    purpose: `Tujuan survei dinyatakan oleh pembuat survei. ${PLACEHOLDER}`,
    data_categories: 'Jawaban pada skala, isian teks singkat, kode acak peserta, waktu pengiriman, dan catatan persetujuan. Tidak meminta nama, tanggal lahir, atau nomor identitas.',
    module15_usage: 'Ringkasan dan data yang diizinkan dapat diteruskan ke konsumen analitik (Modul 15) sesuai kontrak yang masih disepakati.',
    retention_text: 'Belum ditetapkan. Menunggu keputusan pengendali.',
    recipients: 'Pembuat survei, petugas berizin, dan penerima integrasi sesuai cakupan. Daftar final menunggu penetapan.',
    contact: 'Belum ditetapkan. Menunggu keputusan pengendali.',
    rights: 'Akses, koreksi, penarikan persetujuan, dan penghapusan melalui kanal resmi pengendali. Verifikasi pemohon dilakukan sebelum tindak lanjut.',
    child_data_text: 'Responden pada profil ini digolongkan anak. Persetujuan orang tua atau wali dan bukti verifikasi wajib sebelum pengiriman baru.',
    cross_border_text: 'Belum ditinjau. Transfer lintas negara tidak diaktifkan sampai ada keputusan.',
    synthetic_placeholder: true,
  },
  p_perpus: {
    id: 'n_perpus',
    profile_id: 'p_perpus',
    version: 'notice-sintetis-1.0',
    effective_date: '2026-11-17',
    purpose: `Tujuan survei dinyatakan oleh pembuat survei. ${PLACEHOLDER}`,
    data_categories: 'Jawaban pada skala, komentar singkat, kode acak peserta, waktu pengiriman, dan catatan persetujuan.',
    module15_usage: 'Ringkasan dan data yang diizinkan dapat diteruskan ke konsumen analitik (Modul 15) sesuai kontrak yang masih disepakati.',
    retention_text: '90 hari sejak pengiriman (nilai sintetis untuk pengembangan).',
    recipients: 'Pembuat survei dan petugas berizin pada survei ini.',
    contact: 'kontak-sintetis@contoh.invalid',
    rights: 'Akses, koreksi, penarikan persetujuan, dan penghapusan melalui kanal kontak di atas.',
    child_data_text: 'Profil ini ditujukan untuk responden dewasa dengan persetujuan diri.',
    cross_border_text: 'Tidak ada transfer lintas negara.',
    synthetic_placeholder: true,
  },
};

export function profileForSurvey(surveyId: string): DeploymentProfile {
  return surveyId === 's_demo2' ? profiles.p_perpus : profiles.p_smk;
}

export function noticeForSurvey(surveyId: string): Notice {
  return surveyId === 's_demo2' ? notices.p_perpus : notices.p_smk;
}
