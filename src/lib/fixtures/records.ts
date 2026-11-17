import type {
  Response,
  ConsentRecord,
  AuditLog,
  Account,
  AccessGrant,
  IntegrationEvent,
} from '../types';

/**
 * Fixture skoring PRD §7: 5 respons final, nilai AD01 = 2, 4, 4, 5, kosong.
 * Ringkasan dihitung dari sini oleh summary.ts, bukan angka hardcode.
 */
function answer(questionCode: string, value: number | null, text: string | null = null) {
  return {
    question_code: questionCode,
    option_id: value === null ? null : `q_ad01_opt${value}`,
    value,
    text,
    skipped: value === null && text === null,
  };
}

export const responses: Response[] = [
  {
    id: 'r_demo01', version_id: 'v_demo1_1', survey_id: 's_demo1', assignment_id: 'a_demo01',
    respondent_id: 'p_demo01', collection_mode: 'standalone', identity_source: 'local',
    submitted_at: '2026-11-09T05:00:00Z', idempotency_key: 'key-demo01',
    answers: [answer('AD01', 4), answer('TS01', 2), answer('K02', null, 'Perlu panduan singkat.')],
  },
  {
    id: 'r_demo02', version_id: 'v_demo1_1', survey_id: 's_demo1', assignment_id: 'a_demo02',
    respondent_id: 'p_demo02', collection_mode: 'standalone', identity_source: 'local',
    submitted_at: '2026-11-09T05:04:00Z', idempotency_key: 'key-demo02',
    answers: [answer('AD01', 2), answer('TS01', 3), answer('K02', null, null)],
  },
  {
    id: 'r_demo03', version_id: 'v_demo1_1', survey_id: 's_demo1', assignment_id: 'a_demo03',
    respondent_id: 'p_demo03', collection_mode: 'standalone', identity_source: 'local',
    submitted_at: '2026-11-09T05:08:00Z', idempotency_key: 'key-demo03',
    answers: [answer('AD01', 4), answer('TS01', 5), answer('K02', null, 'Koneksi lambat.')],
  },
  {
    id: 'r_demo04', version_id: 'v_demo1_1', survey_id: 's_demo1', assignment_id: 'a_demo04',
    respondent_id: 'p_demo04', collection_mode: 'standalone', identity_source: 'local',
    submitted_at: '2026-11-09T05:12:00Z', idempotency_key: 'key-demo04',
    answers: [answer('AD01', 5), answer('TS01', 1), answer('K02', null, null)],
  },
  {
    id: 'r_demo05', version_id: 'v_demo1_1', survey_id: 's_demo1', assignment_id: 'a_demo05',
    respondent_id: 'p_demo05', collection_mode: 'standalone', identity_source: 'local',
    submitted_at: '2026-11-09T05:16:00Z', idempotency_key: 'key-demo05',
    answers: [answer('AD01', null), answer('TS01', 4), answer('K02', null, null)],
  },
  {
    id: 'r_perpus01', version_id: 'v_demo2_1', survey_id: 's_demo2', assignment_id: 'a_perpus01',
    respondent_id: 'p_perpus01', collection_mode: 'standalone', identity_source: 'local',
    submitted_at: '2026-11-10T03:10:00Z', idempotency_key: 'key-perpus01',
    answers: [
      { question_code: 'P01', option_id: 'q_p01_opt3', value: 3, text: null, skipped: false },
      { question_code: 'P02', option_id: 'q_p02_opt2', value: 2, text: null, skipped: false },
      { question_code: 'K01', option_id: null, value: null, text: 'Tambahkan jam buka.', skipped: false },
    ],
  },
];

export const consentRecords: ConsentRecord[] = [
  {
    id: 'c_demo01', survey_id: 's_demo1', version_id: 'v_demo1_1',
    notice_version: '1.0', basis: 'Persetujuan wali',
    status: 'granted', recorded_at: '2026-11-09T04:58:00Z', respondent_click: true,
    guardian_evidence_status: 'verified', guardian_evidence_ref: 'ref-wali-sintetis-01',
  },
  {
    id: 'c_demo02', survey_id: 's_demo1', version_id: 'v_demo1_1',
    notice_version: '1.0', basis: 'Persetujuan wali',
    status: 'pending', recorded_at: '2026-11-09T05:02:00Z', respondent_click: false,
    guardian_evidence_status: 'pending', guardian_evidence_ref: null,
  },
  {
    id: 'c_perpus01', survey_id: 's_demo2', version_id: 'v_demo2_1',
    notice_version: '1.0', basis: 'Persetujuan diri',
    status: 'granted', recorded_at: '2026-11-10T03:08:00Z', respondent_click: true,
    guardian_evidence_status: 'not_required', guardian_evidence_ref: null,
  },
];

/** Log audit TANPA token, kredensial, atau isi jawaban (PRD §6 / §9). */
export const auditLogs: AuditLog[] = [
  { id: 'log_01', actor: 'creator-a', action: 'Publikasi versi', object: 's_demo1 · v1', outcome: 'berhasil', at: '2026-11-03T03:00:00Z' },
  { id: 'log_02', actor: 'creator-a', action: 'Buat undangan', object: 's_demo1 · penugasan', outcome: 'berhasil', at: '2026-11-04T02:10:00Z' },
  { id: 'log_03', actor: 'petugas-izin', action: 'Baca jawaban individual', object: 's_demo1 · v1', outcome: 'berhasil', at: '2026-11-10T06:00:00Z' },
  { id: 'log_04', actor: 'creator-b', action: 'Unduh hasil', object: 's_demo1 · v1', outcome: 'ditolak', at: '2026-11-10T06:05:00Z' },
  { id: 'log_05', actor: 'creator-a', action: 'Cabut undangan', object: 's_demo1 · kode', outcome: 'berhasil', at: '2026-11-10T02:00:00Z' },
  { id: 'log_06', actor: 'layanan-15', action: 'Ambil skema', object: 's_demo1 · v1', outcome: 'gagal', at: '2026-11-11T01:00:00Z' },
  { id: 'log_07', actor: 'admin-utama', action: 'Ubah peran akun', object: 'akun creator-b', outcome: 'berhasil', at: '2026-11-12T04:00:00Z' },
  { id: 'log_08', actor: 'creator-a', action: 'Ekspor CSV', object: 's_demo1 · v1', outcome: 'berhasil', at: '2026-11-12T07:30:00Z' },
];

export const accounts: Account[] = [
  { id: 'u_admin', display_name: 'Rani Wijaya', role: 'super_admin', status: 'active' },
  { id: 'u_creator_a', display_name: 'Andi Pratama', role: 'creator', status: 'active' },
  { id: 'u_creator_b', display_name: 'Sinta Maharani', role: 'creator', status: 'active' },
  { id: 'u_petugas', display_name: 'Dedi Kurniawan', role: 'authorized_officer', status: 'active' },
  { id: 'u_nonaktif', display_name: 'Bayu Setiawan', role: 'creator', status: 'suspended' },
];

/** Izin baca individual, ekspor, dan teks bebas dipisah (PRD §3 / §9.1). */
export const accessGrants: AccessGrant[] = [
  { id: 'g_01', account_id: 'u_creator_a', survey_id: 's_demo1', can_read_individual: false, can_export: true, can_read_free_text: false },
  { id: 'g_02', account_id: 'u_petugas', survey_id: 's_demo1', can_read_individual: true, can_export: true, can_read_free_text: true },
  { id: 'g_03', account_id: 'u_creator_b', survey_id: 's_demo3', can_read_individual: false, can_export: false, can_read_free_text: false },
];

export const integrationEvents: IntegrationEvent[] = [
  { id: 'ie_01', event_id: 'ev_demo01', type: 'survey.submitted', target: 'module_13', status: 'delivered', attempts: 1, at: '2026-11-09T05:00:02Z', simulated: true },
  { id: 'ie_02', event_id: 'ev_demo02', type: 'survey.submitted', target: 'module_13', status: 'pending', attempts: 2, at: '2026-11-09T05:04:02Z', simulated: true },
  { id: 'ie_03', event_id: 'ev_demo03', type: 'survey-data.read', target: 'module_15', status: 'failed', attempts: 3, at: '2026-11-11T01:00:00Z', simulated: true },
];

/** Bukti kirim yang dipulihkan retry identik (PRD §6.1, AC07). */
export const receiptFixture = {
  response_id: 'r_demo01',
  version_id: 'v_demo1_1',
  submitted_at: '2026-11-09T05:00:00Z',
  status: 'submitted' as const,
  idempotency_key: 'key-demo01',
};
