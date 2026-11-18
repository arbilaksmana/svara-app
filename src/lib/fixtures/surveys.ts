import type {
  Survey,
  SurveyVersion,
  Question,
  QuestionOption,
  Assignment,
  Invitation,
  PublicLink,
} from '../types';

/** Dua survei dengan topik berbeda memakai skema yang sama (PRD §1.1, AC01). */

export const surveys: Survey[] = [
  {
    id: 's_demo1',
    owner_id: 'u_creator_a',
    profile_id: 'p_smk',
    title: 'Pengalaman penggunaan alat bantu tugas',
    purpose: 'Mengumpulkan tanggapan atas penggunaan alat bantu tugas pada lingkungan belajar.',
    object_label: 'Alat bantu tugas desain',
    instructions: 'Pilih satu jawaban pada setiap pernyataan. Isian kendala boleh dikosongkan.',
    status: 'published',
    created_at: '2026-11-02T02:00:00Z',
    updated_at: '2026-11-12T07:30:00Z',
    current_version_id: 'v_demo1_1',
  },
  {
    id: 's_demo2',
    owner_id: 'u_creator_a',
    profile_id: 'p_perpus',
    title: 'Kepuasan layanan perpustakaan',
    purpose: 'Mengetahui pengalaman pengunjung terhadap layanan pinjam dan ruang baca.',
    object_label: 'Layanan perpustakaan',
    instructions: 'Pilih tingkat kesesuaian pada tiap pernyataan. Komentar singkat bersifat opsional.',
    status: 'published',
    created_at: '2026-11-05T04:00:00Z',
    updated_at: '2026-11-10T03:00:00Z',
    current_version_id: 'v_demo2_1',
  },
  {
    id: 's_demo3',
    owner_id: 'u_creator_b',
    profile_id: 'p_perpus',
    title: 'Survei kepuasan anggota',
    purpose: 'Draf belum memiliki pertanyaan.',
    object_label: 'Belum ditetapkan',
    instructions: '',
    status: 'draft',
    created_at: '2026-11-14T09:00:00Z',
    updated_at: '2026-11-14T09:00:00Z',
    current_version_id: null,
  },
  {
    id: 's_demo4',
    owner_id: 'u_creator_a',
    profile_id: 'p_perpus',
    title: 'Evaluasi layanan semester lalu',
    purpose: 'Contoh survei dengan versi yang sudah ditutup.',
    object_label: 'Layanan lama',
    instructions: '',
    status: 'archived',
    created_at: '2026-10-01T01:00:00Z',
    updated_at: '2026-11-01T01:00:00Z',
    current_version_id: 'v_demo4_1',
  },
];

export const versions: SurveyVersion[] = [
  {
    id: 'v_demo1_1',
    survey_id: 's_demo1',
    number: 1,
    status: 'published',
    notice_version: '1.0',
    published_at: '2026-11-03T03:00:00Z',
    closed_at: null,
    question_ids: ['q_ad01', 'q_ts01', 'q_k02'],
  },
  {
    id: 'v_demo1_2',
    survey_id: 's_demo1',
    number: 2,
    status: 'draft',
    notice_version: '1.1',
    published_at: null,
    closed_at: null,
    question_ids: ['q_ad01_v2', 'q_ts01_v2'],
  },
  {
    id: 'v_demo2_1',
    survey_id: 's_demo2',
    number: 1,
    status: 'published',
    notice_version: '1.0',
    published_at: '2026-11-06T05:00:00Z',
    closed_at: null,
    question_ids: ['q_p01', 'q_p02', 'q_k01'],
  },
  {
    id: 'v_demo4_1',
    survey_id: 's_demo4',
    number: 1,
    status: 'closed',
    notice_version: '1.0',
    published_at: '2026-10-02T02:00:00Z',
    closed_at: '2026-11-01T01:00:00Z',
    question_ids: ['q_old01'],
  },
];

function likertOptions(questionId: string, count: number): QuestionOption[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${questionId}_opt${i + 1}`,
    question_id: questionId,
    order: i + 1,
    label: count === 5
      ? ['Sangat tidak setuju', 'Tidak setuju', 'Netral', 'Setuju', 'Sangat setuju'][i] ?? String(i + 1)
      : ['Tidak sesuai', 'Kurang sesuai', 'Sesuai', 'Sangat sesuai'][i] ?? String(i + 1),
    value: i + 1,
  }));
}

export const options: QuestionOption[] = [
  ...likertOptions('q_ad01', 5),
  ...likertOptions('q_ts01', 5),
  ...likertOptions('q_ad01_v2', 5),
  ...likertOptions('q_ts01_v2', 5),
  ...likertOptions('q_p01', 4),
  ...likertOptions('q_p02', 4),
  ...likertOptions('q_old01', 5),
];

export const questions: Question[] = [
  {
    id: 'q_ad01',
    version_id: 'v_demo1_1',
    code: 'AD01',
    order: 1,
    type: 'likert',
    required: true,
    section: 'Bagian 1 · Penerimaan',
    label: 'Alat bantu ini membantu saya menyelesaikan tugas yang diberikan.',
    hint: null,
    group_code: null,
    dimension_code: 'adopsi',
    option_ids: options.filter((o) => o.question_id === 'q_ad01').map((o) => o.id),
  },
  {
    id: 'q_ts01',
    version_id: 'v_demo1_1',
    code: 'TS01',
    order: 2,
    type: 'likert',
    required: true,
    section: 'Bagian 1 · Penerimaan',
    label: 'Saya merasa terbebani ketika harus memakai beberapa fitur alat bantu tersebut.',
    hint: null,
    group_code: null,
    dimension_code: 'beban',
    option_ids: options.filter((o) => o.question_id === 'q_ts01').map((o) => o.id),
  },
  {
    id: 'q_k02',
    version_id: 'v_demo1_1',
    code: 'K02',
    order: 3,
    type: 'short_text',
    required: false,
    section: 'Bagian 2 · Kendala',
    label: 'Ceritakan kendala yang Anda temui (opsional).',
    hint: 'Jangan tuliskan nama atau data identitas lain.',
    group_code: null,
    dimension_code: null,
    option_ids: [],
  },
  {
    id: 'q_ad01_v2',
    version_id: 'v_demo1_2',
    code: 'AD01',
    order: 1,
    type: 'likert',
    required: true,
    section: 'Bagian 1 · Penerimaan',
    label: 'Alat bantu ini membantu saya menyelesaikan tugas yang diberikan.',
    hint: 'Versi draf baru, belum diterbitkan.',
    group_code: null,
    dimension_code: 'adopsi',
    option_ids: options.filter((o) => o.question_id === 'q_ad01_v2').map((o) => o.id),
  },
  {
    id: 'q_ts01_v2',
    version_id: 'v_demo1_2',
    code: 'TS01',
    order: 2,
    type: 'likert',
    required: true,
    section: 'Bagian 1 · Penerimaan',
    label: 'Saya merasa terbebani ketika harus memakai beberapa fitur alat bantu tersebut.',
    hint: 'Versi draf baru, belum diterbitkan.',
    group_code: null,
    dimension_code: 'beban',
    option_ids: options.filter((o) => o.question_id === 'q_ts01_v2').map((o) => o.id),
  },
  {
    id: 'q_p01',
    version_id: 'v_demo2_1',
    code: 'P01',
    order: 1,
    type: 'likert',
    required: true,
    section: 'Bagian 1 · Layanan',
    label: 'Proses peminjaman mudah saya ikuti.',
    hint: null,
    group_code: null,
    dimension_code: 'proses',
    option_ids: options.filter((o) => o.question_id === 'q_p01').map((o) => o.id),
  },
  {
    id: 'q_p02',
    version_id: 'v_demo2_1',
    code: 'P02',
    order: 2,
    type: 'likert',
    required: true,
    section: 'Bagian 1 · Layanan',
    label: 'Ruang baca nyaman digunakan.',
    hint: null,
    group_code: null,
    dimension_code: 'fasilitas',
    option_ids: options.filter((o) => o.question_id === 'q_p02').map((o) => o.id),
  },
  {
    id: 'q_k01',
    version_id: 'v_demo2_1',
    code: 'K01',
    order: 3,
    type: 'short_text',
    required: false,
    section: 'Bagian 2 · Komentar',
    label: 'Saran singkat untuk layanan (opsional).',
    hint: 'Jangan tuliskan nama atau data identitas lain.',
    group_code: null,
    dimension_code: null,
    option_ids: [],
  },
  {
    id: 'q_old01',
    version_id: 'v_demo4_1',
    code: 'L01',
    order: 1,
    type: 'likert',
    required: true,
    section: 'Bagian 1',
    label: 'Pernyataan pada versi lama yang sudah ditutup.',
    hint: null,
    group_code: null,
    dimension_code: null,
    option_ids: options.filter((o) => o.question_id === 'q_old01').map((o) => o.id),
  },
];

export const assignments: Assignment[] = [
  { id: 'a_demo01', survey_id: 's_demo1', version_id: 'v_demo1_1', label: 'Kelas A · 01', participant_ref: 'lokal-01' },
  { id: 'a_demo02', survey_id: 's_demo1', version_id: 'v_demo1_1', label: 'Kelas A · 02', participant_ref: 'lokal-02' },
  { id: 'a_demo03', survey_id: 's_demo1', version_id: 'v_demo1_1', label: 'Kelas A · 03', participant_ref: 'lokal-03' },
  { id: 'a_demo04', survey_id: 's_demo1', version_id: 'v_demo1_1', label: 'Kelas A · 04', participant_ref: 'lokal-04' },
  { id: 'a_demo05', survey_id: 's_demo1', version_id: 'v_demo1_1', label: 'Kelas A · 05', participant_ref: 'lokal-05' },
  { id: 'a_perpus01', survey_id: 's_demo2', version_id: 'v_demo2_1', label: 'Penugasan perpustakaan 01', participant_ref: 'lokal-p01' },
];

/** Kode yang boleh ditampilkan. token_hash tidak pernah dirender di UI. */
export const invitations: Invitation[] = [
  {
    id: 'inv_01', assignment_id: 'a_demo01', survey_id: 's_demo1', version_id: 'v_demo1_1',
    code: 'UND-01-AKTIF', status: 'active', expires_at: '2026-12-31T00:00:00Z',
    used_at: null, revoked_at: null, token_hash: 'hash-sintetis-01',
  },
  {
    id: 'inv_02', assignment_id: 'a_demo02', survey_id: 's_demo1', version_id: 'v_demo1_1',
    code: 'UND-02-TERPAKAI', status: 'used', expires_at: '2026-12-31T00:00:00Z',
    used_at: '2026-11-09T05:00:00Z', revoked_at: null, token_hash: 'hash-sintetis-02',
  },
  {
    id: 'inv_03', assignment_id: 'a_demo03', survey_id: 's_demo1', version_id: 'v_demo1_1',
    code: 'UND-03-DICABUT', status: 'revoked', expires_at: '2026-12-31T00:00:00Z',
    used_at: null, revoked_at: '2026-11-10T02:00:00Z', token_hash: 'hash-sintetis-03',
  },
  {
    id: 'inv_04', assignment_id: 'a_demo04', survey_id: 's_demo1', version_id: 'v_demo1_1',
    code: 'UND-04-KEDALUWARSA', status: 'expired', expires_at: '2026-11-08T00:00:00Z',
    used_at: null, revoked_at: null, token_hash: 'hash-sintetis-04',
  },
  {
    id: 'inv_p01', assignment_id: 'a_perpus01', survey_id: 's_demo2', version_id: 'v_demo2_1',
    code: 'UND-P01-AKTIF', status: 'active', expires_at: '2026-12-31T00:00:00Z',
    used_at: null, revoked_at: null, token_hash: 'hash-sintetis-p01',
  },
];

export const publicLinks: PublicLink[] = [
  {
    id: 'pl_demo1', survey_id: 's_demo1', version_id: 'v_demo1_1',
    token: 'link-umum-demo', url: '/s/link-umum-demo', label: 'Tautan umum · survei utama',
    status: 'active', expires_at: null,
  },
  {
    id: 'pl_demo2', survey_id: 's_demo2', version_id: 'v_demo2_1',
    token: 'link-umum-perpus', url: '/s/link-umum-perpus', label: 'Tautan umum · perpustakaan',
    status: 'active', expires_at: null,
  },
];

/** Token undangan untuk rute /s/:token. Tidak sama dengan kode tampil di creator-share. */
export const invitationTokens: Record<string, { surveyId: string; versionId: string; invitationId: string }> = {
  'undangan-demo': { surveyId: 's_demo1', versionId: 'v_demo1_1', invitationId: 'inv_01' },
  'undangan-perpus': { surveyId: 's_demo2', versionId: 'v_demo2_1', invitationId: 'inv_p01' },
};

export function findSurvey(id: string): Survey | undefined {
  return surveys.find((s) => s.id === id);
}

export function versionsFor(surveyId: string): SurveyVersion[] {
  return versions
    .filter((v) => v.survey_id === surveyId)
    .sort((a, b) => b.number - a.number);
}

export function draftVersionFor(surveyId: string): SurveyVersion | undefined {
  return versionsFor(surveyId).find((version) => version.status === 'draft');
}

export function publishedVersionFor(surveyId: string): SurveyVersion | undefined {
  return versionsFor(surveyId).find((version) => version.status === 'published');
}

export function editorVersionFor(surveyId: string): SurveyVersion | undefined {
  return draftVersionFor(surveyId) ?? publishedVersionFor(surveyId) ?? versionsFor(surveyId)[0];
}

export function questionsFor(versionId: string): Question[] {
  return questions
    .filter((q) => q.version_id === versionId)
    .sort((a, b) => a.order - b.order);
}

export function optionsFor(questionId: string): QuestionOption[] {
  return options
    .filter((o) => o.question_id === questionId)
    .sort((a, b) => a.order - b.order);
}

export function resolveToken(token: string): {
  survey: Survey;
  version: SurveyVersion;
  isPublicLink: boolean;
  invitation: Invitation | null;
} | null {
  const link = publicLinks.find((l) => l.token === token);
  if (link) {
    const survey = findSurvey(link.survey_id);
    const version = versions.find((v) => v.id === link.version_id);
    if (survey && version) return { survey, version, isPublicLink: true, invitation: null };
  }
  const entry = invitationTokens[token];
  if (entry) {
    const survey = findSurvey(entry.surveyId);
    const version = versions.find((v) => v.id === entry.versionId);
    const invitation = invitations.find((i) => i.id === entry.invitationId) ?? null;
    if (survey && version) return { survey, version, isPublicLink: false, invitation };
  }
  return null;
}
