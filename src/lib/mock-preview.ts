/**
 * MODE PREVIEW UI (dev-only). Aktif HANYA saat NEXT_PUBLIC_UI_MOCK=1.
 * Menyediakan payload kanonis agar komponen React asli (/admin Ringkasan) dirender
 * tanpa backend/DB/login. Tidak dipakai pada build normal; nilai default mati.
 */
import type { AdminStats, BootstrapData } from './api';

const MONTHS = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];

export const MOCK_STATS: AdminStats = {
  accounts: 6,
  surveys: 4,
  responses: 253,
  pendingRequests: 1,
  delta: {
    surveys: { current: 4, previous: 2 },
    responses: { current: 57, previous: 38 },
    accounts: { current: 6, previous: 0 },
    requests: { current: 1, previous: 0 },
  },
  perMonth: MONTHS.map((month, i) => ({ month, responses: [12, 20, 18, 34, 42, 57][i]! })),
  perCreator: [
    { id: 'u_creator_a', display_name: 'Andi Pratama', surveys: 3, responses: 120 },
    { id: 'u_creator_b', display_name: 'Sinta Maharani', surveys: 2, responses: 84 },
    { id: 'u_petugas', display_name: 'Dedi Kurniawan', surveys: 1, responses: 31 },
    { id: 'u_creator_c', display_name: 'Rina Safitri', surveys: 1, responses: 18 },
    { id: 'u_creator_d', display_name: 'Fajar Nugroho', surveys: 1, responses: 9 },
    { id: 'u_creator_e', display_name: 'Ayu Lestari', surveys: 1, responses: 4 },
  ],
  perSurvey: [
    { id: 's_1', title: 'Kepuasan Layanan Kampus', owner: 'Andi Pratama', versions: 3, responses: 76 },
    { id: 's_2', title: 'Umpan Balik Perpustakaan', owner: 'Sinta Maharani', versions: 2, responses: 54 },
    { id: 's_3', title: 'Survei Keselamatan Lab', owner: 'Dedi Kurniawan', versions: 1, responses: 31 },
    { id: 's_4', title: 'Survei Beasiswa Semester Ganjil', owner: 'Rina Safitri', versions: 1, responses: 40 },
    { id: 's_5', title: 'Survei Kebiasaan Belajar', owner: 'Petugas Lapangan', versions: 2, responses: 22 },
    { id: 's_6', title: 'Survei Iklim Kelas', owner: 'Andi Pratama', versions: 1, responses: 15 },
    { id: 's_7', title: 'Survei Kesiapan Kerja', owner: 'Sinta Maharani', versions: 1, responses: 5 },
  ],
};

/**
 * Deret grafik per rentang untuk mode preview: 'today' per jam, '7d'/'30d' per hari.
 * Jendela 7 hari memakai ekor deret 30 hari agar angka antar rentang konsisten.
 */
const HOURLY_TODAY = [
  0, 0, 0, 0, 0, 0, 0, 1, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];
const DAILY_30 = [
  1, 0, 2, 3, 1, 0, 1, 2, 4, 3, 2, 1, 0, 2, 3, 5, 4, 3, 2, 1, 2, 0, 0, 2, 4, 1, 3, 2, 1, 2,
];
const DAILY_7 = DAILY_30.slice(-7);

/** Kunci hari lokal 'YYYY-MM-DD', format yang sama dengan kunci titik server. */
function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Deret titik sesuai rentang yang diminta layar. Rentang di luar today/7d/30d
 * (mis. '6m' milik server) memakai deret 30 hari karena UI tidak menawarkannya.
 */
function chartForRange(range: string | null): Array<{ point: string; responses: number }> {
  const now = new Date();
  if (range === 'today') {
    const day = dayKey(now);
    return HOURLY_TODAY.map((responses, hour) => ({
      point: `${day}T${String(hour).padStart(2, '0')}`,
      responses,
    }));
  }
  const daily = range === '7d' ? DAILY_7 : DAILY_30;
  return daily.map((responses, index) => {
    const date = new Date(now);
    date.setDate(date.getDate() - (daily.length - 1 - index));
    return { point: dayKey(date), responses };
  });
}

const ACCOUNT = {
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

const MOCK_DATA_REQUESTS = [
  { id: 'dr_1', type: 'akses', contact: 'andi.pratama@svara.sch.id', note: 'Ingin memeriksa jawaban yang tercatat atas nama saya.', status: 'pending' as const, outcome_note: null, handled_by: null, created_at: wibAt(1, 10, 20), updated_at: wibAt(1, 10, 20), response_channel: null, responded_by: null },
  { id: 'dr_2', type: 'koreksi', contact: 'rina.safitri@svara.sch.id', note: 'Kelas saya tercatat XI IPS 2, seharusnya XI IPS 1.', status: 'in_progress' as const, outcome_note: null, handled_by: 'u_admin', created_at: wibAt(3, 8, 5), updated_at: wibAt(2, 13, 40), response_channel: null, responded_by: null },
  { id: 'dr_3', type: 'hapus', contact: 'dedi.kurniawan@svara.sch.id', note: 'Mohon hapus jawaban survei lama saya.', status: 'handled' as const, outcome_note: 'Jawaban dihapus dan tercatat di log audit.', handled_by: 'u_admin', created_at: wibAt(9, 9, 0), updated_at: wibAt(7, 16, 12), response_channel: 'email', responded_by: 'u_admin' },
  { id: 'dr_4', type: 'keberatan', contact: 'fajar.nugroho@svara.sch.id', note: 'Tidak setuju jawaban dipakai untuk module_15.', status: 'rejected' as const, outcome_note: 'Dasar pemrosesan sudah tercantum pada notice v2.', handled_by: 'u_admin', created_at: wibAt(12, 11, 30), updated_at: wibAt(11, 9, 45), response_channel: 'email', responded_by: 'u_admin' },
];

const MOCK_PLATFORM_PROFILE = {
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
  account: ACCOUNT,
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
  accounts: [ACCOUNT, ...OTHER_ACCOUNTS],
  organizations: MOCK_ORGANIZATIONS,
  auditLogs: MOCK_AUDIT_LOGS,
  integrationEvents: MOCK_INTEGRATION_EVENTS,
  dataRequests: MOCK_DATA_REQUESTS,
  serverTime: new Date().toISOString(),
};

/** true hanya saat env preview aktif (di-inline Next pada build/dev). */
export const UI_MOCK = process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_UI_MOCK === '1';

/** Balasan kanonis untuk path yang dipakai layar Ringkasan; null = tidak di-mock. */
export function mockResponse(path: string, method: string): unknown | null {
  if (!UI_MOCK) return null;
  if (path === '/bootstrap') return MOCK_BOOTSTRAP;
  if (path === '/auth/me') return { account: ACCOUNT };
  if (path === '/auth/login' && method === 'POST') return { account: { ...ACCOUNT, email: 'admin@svara.local' } };
  if (path.startsWith('/admin/stats')) {
    const range = new URLSearchParams(path.split('?')[1] ?? '').get('range');
    return { ...MOCK_STATS, chart: chartForRange(range) };
  }
  if (path === '/auth/logout' && method === 'POST') return {};
  if (path === '/admin/requests' || path === '/admin/data-requests') return MOCK_DATA_REQUESTS;
  if (path === '/admin/platform-profile') return { profile: MOCK_PLATFORM_PROFILE };
  return null;
}
