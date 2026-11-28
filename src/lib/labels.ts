import type { AccountStatus, ConsentRequired, InvitationStatus, OrganizationType, Role, SurveyStatus, VersionStatus } from './types';

export const STATUS_LABEL: Record<SurveyStatus | VersionStatus, string> = {
  draft: 'Draf',
  published: 'Terbit',
  closed: 'Ditutup',
  archived: 'Arsip',
};

export const ORGANIZATION_TYPE_LABEL: Record<OrganizationType, string> = {
  school: 'Sekolah',
  higher_education: 'Perguruan tinggi',
  company: 'Perusahaan',
  cooperative: 'Koperasi',
  government: 'Instansi pemerintah',
  community: 'Komunitas',
  organization: 'Organisasi lain',
};

/** Urutan opsi dropdown mengikuti urutan label di atas; satu sumber untuk Admin dan Profil organisasi. */
export const ORGANIZATION_TYPES = Object.keys(ORGANIZATION_TYPE_LABEL) as OrganizationType[];

export const CONSENT_REQUIRED_LABEL: Record<ConsentRequired, string> = {
  tidak: 'Persetujuan diri',
  wajib_upload: 'Dengan bukti pendukung',
};

/** Dipakai undangan survei dan kode undangan organisasi; dua permukaan, satu kosakata status. */
export const INVITATION_STATUS_LABEL: Record<InvitationStatus, string> = {
  active: 'Aktif',
  used: 'Terpakai',
  revoked: 'Dicabut',
  expired: 'Kedaluwarsa',
  closed: 'Ditutup',
};

/** Jalur pengisian (enum tersimpan); label manusiawi agar `standalone` tidak bocor ke layar hasil. */
export const COLLECTION_MODE_LABEL: Partial<Record<string, string>> = {
  standalone: 'Pengisian mandiri',
  integrated: 'Integrasi sistem',
};

/** Status bukti pendukung pada layar moderasi, termasuk status konsen yang tak perlu ditinjau. */
export const GUARDIAN_EVIDENCE_STATUS_LABEL: Record<string, string> = {
  not_required: 'Tidak wajib',
  pending: 'Belum diunggah',
  self_attested: 'Menunggu tinjauan',
  verified: 'Terverifikasi',
  rejected: 'Ditolak',
  revoked: 'Dicabut',
};

export const GUARDIAN_EVIDENCE_STATUS_TONE: Record<string, 'success' | 'danger' | 'neutral' | 'warning'> = {
  not_required: 'neutral',
  pending: 'warning',
  self_attested: 'neutral',
  verified: 'success',
  rejected: 'danger',
};

export const INVITATION_STATUS_TONE: Record<InvitationStatus, 'success' | 'info' | 'danger' | 'warning' | 'neutral'> = {
  active: 'success',
  used: 'info',
  revoked: 'danger',
  expired: 'warning',
  closed: 'neutral',
};

/** Nama aktor mengikuti PRD §3; dipakai daftar akun super admin dan daftar anggota organisasi. */
export const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Super admin',
  org_admin: 'Admin organisasi',
  creator: 'Creator',
};

export const ACCOUNT_STATUS_LABEL: Record<AccountStatus, string> = {
  active: 'Aktif',
  suspended: 'Dinonaktifkan',
};

/** Sama dengan pilihan formulir permintaan data di /privacy; jenis lain dari server ditampilkan apa adanya. */
export const DATA_REQUEST_TYPE_LABEL: Partial<Record<string, string>> = {
  access: 'Akses data',
  correction: 'Koreksi data',
  withdrawal: 'Penarikan persetujuan',
  deletion: 'Penghapusan data',
};

/** Status pada bukti pengiriman responden; status lain dari server ditampilkan apa adanya. */
export const RECEIPT_STATUS_LABEL: Partial<Record<string, string>> = {
  submitted: 'Terkirim',
};
