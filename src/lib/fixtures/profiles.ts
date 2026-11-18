import type { DeploymentProfile, Notice } from '../types';
import { findSurvey } from './surveys';

/**
 * Profil deployment sintetis (PRD §1.2).
 * Set 1 sengaja membiarkan retensi, kontak, dan transfer lintas negara kosong:
 * PRD §14 menyebutnya keputusan pengendali yang belum ditetapkan.
 */
export const profiles: Record<string, DeploymentProfile> = {
  p_smk: {
    id: 'p_smk',
    organization_name: 'SMK Nusantara',
    organization_type: 'school',
    respondent_age_category: 'minor',
    consent_mode: 'guardian',
    policy_url: '/privacy',
    terms_url: '/terms',
    retention_days: null,
    data_request_contact: null,
    cross_border_transfer: null,
    notice_version: '1.0',
    synthetic_placeholder: true,
  },
  p_perpus: {
    id: 'p_perpus',
    organization_name: 'Perpustakaan Kota',
    organization_type: 'organization',
    respondent_age_category: 'adult',
    consent_mode: 'self',
    policy_url: '/privacy',
    terms_url: '/terms',
    retention_days: 90,
    data_request_contact: 'privasi@organisasi.id',
    cross_border_transfer: false,
    notice_version: '1.0',
    synthetic_placeholder: true,
  },
};


export const notices: Record<string, Notice> = {
  p_smk: {
    id: 'n_smk',
    profile_id: 'p_smk',
    version: '1.0',
    effective_date: '2026-11-17',
    purpose: 'Tujuan survei dinyatakan oleh pembuat survei pada setiap instrumen.',
    data_categories: 'Jawaban pada skala, isian teks singkat, kode acak peserta, waktu pengiriman, dan catatan persetujuan. Tidak meminta nama, tanggal lahir, atau nomor identitas.',
    module15_usage: 'Ringkasan dan data yang diizinkan dapat diteruskan ke konsumen analitik melalui API terbatas.',
    retention_text: 'Mengikuti kebijakan retensi pengendali.',
    recipients: 'Pembuat survei, petugas berizin, dan penerima integrasi sesuai cakupan.',
    contact: 'privasi@organisasi.id',
    rights: 'Akses, koreksi, penarikan persetujuan, dan penghapusan melalui kanal resmi pengendali.',
    child_data_text: 'Persetujuan orang tua atau wali dan bukti verifikasi wajib sebelum pengiriman baru.',
    cross_border_text: 'Tidak ada transfer lintas negara.',
    synthetic_placeholder: true,
  },
  p_perpus: {
    id: 'n_perpus',
    profile_id: 'p_perpus',
    version: '1.0',
    effective_date: '2026-11-17',
    purpose: 'Tujuan survei dinyatakan oleh pembuat survei pada setiap instrumen.',
    data_categories: 'Jawaban pada skala, komentar singkat, kode acak peserta, waktu pengiriman, dan catatan persetujuan.',
    module15_usage: 'Ringkasan dan data yang diizinkan dapat diteruskan ke konsumen analitik melalui API terbatas.',
    retention_text: '90 hari sejak pengiriman.',
    recipients: 'Pembuat survei dan petugas berizin pada survei ini.',
    contact: 'privasi@organisasi.id',
    rights: 'Akses, koreksi, penarikan persetujuan, dan penghapusan melalui kanal kontak di atas.',
    child_data_text: 'Profil ini ditujukan untuk responden dewasa dengan persetujuan diri.',
    cross_border_text: 'Tidak ada transfer lintas negara.',
    synthetic_placeholder: true,
  },
};

export function profileForSurvey(surveyId: string): DeploymentProfile {
  const survey = findSurvey(surveyId);
  return (survey && profiles[survey.profile_id]) || profiles.p_smk;
}

export function noticeForSurvey(surveyId: string): Notice {
  const profile = profileForSurvey(surveyId);
  return notices[profile.id] || notices.p_smk;
}
