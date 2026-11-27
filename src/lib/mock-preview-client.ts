/**
 * Data preview UI (dev-only). Diimpor `mock-preview.ts` (sisi klien) dan
 * `server/guards.mock.ts` (sisi server), jadi TIDAK BOLEH memuat nilai `process.env`
 * atau konstanta yang di-inline saat build: modul ini terlihat oleh kedua compiler.
 */
import type { BootstrapData } from './api';

export const MOCK_ACCOUNT = {
  id: 'u_admin',
  display_name: 'Rani Wijaya',
  email: 'admin@svara.local',
  role: 'super_admin' as const,
  status: 'active' as const,
  organization_id: null,
};

/** Akun lain untuk layar Akun & izin; nama sama dengan pemilik di MOCK_STATS.perCreator. */
const OTHER_ACCOUNTS = [
  { id: 'u_creator_a', display_name: 'Andi Pratama', email: 'andi.pratama@svara.sch.id', role: 'creator', status: 'active', organization_id: 'org_1' },
  { id: 'u_creator_b', display_name: 'Sinta Maharani', email: 'sinta.maharani@svara.sch.id', role: 'creator', status: 'active', organization_id: 'org_1' },
  { id: 'u_petugas', display_name: 'Dedi Kurniawan', email: 'dedi.kurniawan@svara.sch.id', role: 'creator', status: 'suspended', organization_id: 'org_1' },
  { id: 'u_admin_org', display_name: 'Budi Santoso', email: 'budi.santoso@svara.sch.id', role: 'org_admin', status: 'active', organization_id: 'org_1' },
  { id: 'u_creator_c', display_name: 'Rina Safitri', email: 'rina.safitri@svara.sch.id', role: 'creator', status: 'active', organization_id: 'org_2' },
  { id: 'u_creator_d', display_name: 'Fajar Nugroho', email: 'fajar.nugroho@svara.sch.id', role: 'creator', status: 'active', organization_id: 'org_2' },
] as const;

const MOCK_ORGANIZATIONS = [
  { id: 'org_1', name: 'SMA Svara Nusantara', organization_type: 'school' as const },
  { id: 'org_2', name: 'Yayasan Literasi Bangsa', organization_type: 'organization' as const },
];

const MOCK_GRANTS = [
  { id: 'g_1', account_id: 'u_creator_a', survey_id: 's_1', can_read_individual: true, can_export: true, can_read_free_text: false },
  { id: 'g_2', account_id: 'u_creator_b', survey_id: 's_2', can_read_individual: false, can_export: true, can_read_free_text: true },
  { id: 'g_3', account_id: 'u_petugas', survey_id: 's_3', can_read_individual: false, can_export: false, can_read_free_text: false },
  { id: 'g_4', account_id: 'u_admin_org', survey_id: null, can_read_individual: true, can_export: true, can_read_free_text: true },
];

/** Jam WIB (UTC+7) untuk stempel waktu mock, agar formatWIB menampilkan jam kerja. */
function wibAt(dayOffset: number, hour: number, minute = 0): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - dayOffset);
  date.setUTCHours(hour - 7, minute, 0, 0);
  return date.toISOString();
}

const MOCK_AUDIT_LOGS = [
  { id: 'a_1', actor: 'u_admin', action: 'survei.dipublikasikan', object: 'Kepuasan Layanan Kampus v3', outcome: 'berhasil' as const, at: wibAt(0, 9, 12), metadata: null },
  { id: 'a_2', actor: 'u_admin_org', action: 'izin.diubah', object: 'Andi Pratama · Kepuasan Layanan Kampus', outcome: 'berhasil' as const, at: wibAt(0, 10, 41), metadata: 'can_export=true' },
  { id: 'a_3', actor: 'u_creator_b', action: 'jawaban.dibaca', object: 'Umpan Balik Perpustakaan', outcome: 'ditolak' as const, at: wibAt(1, 14, 5), metadata: 'izin_baca_individual=false' },
  { id: 'a_4', actor: 'u_petugas', action: 'ekspor.diminta', object: 'Survei Keselamatan Lab · CSV', outcome: 'gagal' as const, at: wibAt(1, 16, 22), metadata: 'akun_ditangguhkan' },
  { id: 'a_5', actor: 'u_creator_a', action: 'survei.ditutup', object: 'Survei Kebiasaan Belajar v2', outcome: 'berhasil' as const, at: wibAt(2, 8, 30), metadata: null },
  { id: 'a_6', actor: 'u_9c1f', action: 'sesi.dibuat', object: 'admin@svara.local', outcome: 'berhasil' as const, at: wibAt(2, 11, 0), metadata: null },
  { id: 'a_7', actor: 'u_admin', action: 'ekspor.dikirim', object: 'Survei Beasiswa Semester Ganjil · CSV', outcome: 'dimulai' as const, at: wibAt(3, 13, 47), metadata: 'penerima=module_13' },
  { id: 'a_8', actor: 'u_creator_c', action: 'jawaban.dibaca', object: 'Survei Beasiswa Semester Ganjil', outcome: 'berhasil' as const, at: wibAt(4, 9, 15), metadata: null },
  { id: 'a_9', actor: 'u_admin_org', action: 'akun.ditangguhkan', object: 'Dedi Kurniawan', outcome: 'berhasil' as const, at: wibAt(5, 15, 3), metadata: null },
  { id: 'a_10', actor: 'u_creator_a', action: 'survei.dibuat', object: 'Survei Iklim Kelas v1', outcome: 'berhasil' as const, at: wibAt(6, 7, 55), metadata: null },
];

const MOCK_INTEGRATION_EVENTS = [
  { id: 'e_1', event_id: 'evt_7f2a91', type: 'respons.disimpan', target: 'module_13' as const, status: 'delivered' as const, attempts: 1, at: wibAt(0, 9, 13), simulated: true },
  { id: 'e_2', event_id: 'evt_7f2a92', type: 'respons.disimpan', target: 'module_15' as const, status: 'pending' as const, attempts: 2, at: wibAt(0, 10, 2), simulated: true },
  { id: 'e_3', event_id: 'evt_7f2a93', type: 'survei.dipublikasikan', target: 'module_13' as const, status: 'delivered' as const, attempts: 1, at: wibAt(0, 11, 30), simulated: true },
  { id: 'e_4', event_id: 'evt_7f2a94', type: 'respons.disimpan', target: 'module_15' as const, status: 'failed' as const, attempts: 3, at: wibAt(1, 14, 6), simulated: true, last_error: 'Kontrak pengirim belum dikonfirmasi.' },
  { id: 'e_5', event_id: 'evt_7f2a95', type: 'ekspor.dikirim', target: 'module_13' as const, status: 'delivered' as const, attempts: 1, at: wibAt(2, 8, 31), simulated: true },
  { id: 'e_6', event_id: 'evt_7f2a96', type: 'respons.disimpan', target: 'module_13' as const, status: 'pending' as const, attempts: 0, at: wibAt(3, 13, 48), simulated: true },
  { id: 'e_7', event_id: 'evt_7f2a97', type: 'respons.disimpan', target: 'module_15' as const, status: 'failed' as const, attempts: 2, at: wibAt(4, 9, 16), simulated: true, last_error: 'Endpoint penerima belum tersedia.' },
  { id: 'e_8', event_id: 'evt_7f2a98', type: 'survei.ditutup', target: 'module_13' as const, status: 'delivered' as const, attempts: 1, at: wibAt(5, 15, 4), simulated: true },
];

export const MOCK_DATA_REQUESTS = [
  { id: 'dr_1', type: 'akses', contact: 'andi.pratama@svara.sch.id', note: 'Ingin memeriksa jawaban yang tercatat atas nama saya.', status: 'pending' as const, outcome_note: null, handled_by: null, created_at: wibAt(1, 10, 20), updated_at: wibAt(1, 10, 20), response_channel: null, responded_by: null },
  { id: 'dr_2', type: 'koreksi', contact: 'rina.safitri@svara.sch.id', note: 'Kelas saya tercatat XI IPS 2, seharusnya XI IPS 1.', status: 'in_progress' as const, outcome_note: null, handled_by: 'u_admin', created_at: wibAt(3, 8, 5), updated_at: wibAt(2, 13, 40), response_channel: null, responded_by: null },
  { id: 'dr_3', type: 'hapus', contact: 'dedi.kurniawan@svara.sch.id', note: 'Mohon hapus jawaban survei lama saya.', status: 'handled' as const, outcome_note: 'Jawaban dihapus dan tercatat di log audit.', handled_by: 'u_admin', created_at: wibAt(9, 9, 0), updated_at: wibAt(7, 16, 12), response_channel: 'email', responded_by: 'u_admin' },
  { id: 'dr_4', type: 'keberatan', contact: 'fajar.nugroho@svara.sch.id', note: 'Tidak setuju jawaban dipakai untuk module_15.', status: 'rejected' as const, outcome_note: 'Dasar pemrosesan sudah tercantum pada notice v2.', handled_by: 'u_admin', created_at: wibAt(12, 11, 30), updated_at: wibAt(11, 9, 45), response_channel: 'email', responded_by: 'u_admin' },
];

export const MOCK_PLATFORM_PROFILE = {
  id: 'platform',
  organization_name: 'Svara',
  organization_type: 'platform' as const,
  policy_url: 'https://svara.local/kebijakan-privasi',
  terms_url: 'https://svara.local/ketentuan-layanan',
  retention_days: 365,
  data_request_contact: 'privasi@svara.local',
  cross_border_transfer: 0,
  notice_version: 'v2',
  updated_at: wibAt(14, 10, 0),
};

const MOCK_DEPLOYMENT_PROFILE = {
  id: 'platform',
  organization_name: 'Svara',
  organization_type: 'organization' as const,
  policy_url: 'https://svara.local/kebijakan-privasi',
  terms_url: 'https://svara.local/ketentuan-layanan',
  retention_days: 365,
  data_request_contact: 'privasi@svara.local',
  cross_border_transfer: false,
  notice_version: 'v2',
  synthetic_placeholder: true,
};

export const MOCK_BOOTSTRAP: BootstrapData = {
  account: MOCK_ACCOUNT,
  profiles: [MOCK_DEPLOYMENT_PROFILE],
  notices: [],
  surveys: [],
  surveyProfiles: {},
  surveyNotices: {},
  versions: [],
  questions: [],
  options: [],
  invitations: [],
  publicLinks: [],
  assignments: [],
  settings: {},
  grants: MOCK_GRANTS,
  accounts: [MOCK_ACCOUNT, ...OTHER_ACCOUNTS],
  organizations: MOCK_ORGANIZATIONS,
  auditLogs: MOCK_AUDIT_LOGS,
  integrationEvents: MOCK_INTEGRATION_EVENTS,
  dataRequests: MOCK_DATA_REQUESTS,
  serverTime: new Date().toISOString(),
};
