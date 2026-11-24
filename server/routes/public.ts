import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { Response } from 'express';
import { all, get, nowIso, run, withTx } from '../db.ts';
import { clientIp, parseCookies, publicTokenShape, rateLimit, secureCookie, type AuthedRequest } from '../security.ts';
import {
  ApiError,
  asString,
  auditPublic,
  fail,
  newId,
  noticeRowFor,
  pathParam,
  payloadHash,
  sendError,
  sha256Hex,
} from '../http.ts';
import type { SurveyRow, VersionRow } from '../http.ts';
import {
  decodeGuardianEvidence,
  removeGuardianEvidence,
  writeGuardianEvidence,
  type GuardianEvidenceUpload,
} from '../guardian-evidence.ts';

type QuestionType = 'likert' | 'short_text' | 'single_choice';

interface LinkRow {
  id: string;
  survey_id: string;
  version_id: string;
  label: string;
  status: string;
  expires_at: string | null;
  closed_reason: string | null;
}

interface InvitationRow {
  id: string;
  assignment_id: string;
  survey_id: string;
  version_id: string;
  code: string;
  status: string;
  expires_at: string | null;
  used_at: string | null;
  revoked_at: string | null;
}

interface AssignmentRow {
  id: string;
  survey_id: string;
  version_id: string;
  label: string;
  participant_ref: string;
}

interface QuestionRow {
  id: string;
  version_id: string;
  code: string;
  ord: number;
  type: QuestionType;
  required: number;
  section: string;
  label: string;
  hint: string | null;
  group_code: string | null;
  dimension_code: string | null;
}

interface OptionRow {
  id: string;
  question_id: string;
  ord: number;
  label: string;
  value: number | null;
}

/** `profile` pada payload publik adalah profil kebijakan efektif, bukan baris `profiles` lama. */
interface ProfileRow {
  id: string;
  organization_name: string;
  organization_type: string;
  respondent_age_category: string | null;
  consent_mode: string | null;
  policy_url: string;
  terms_url: string;
  retention_days: number | null;
  data_request_contact: string | null;
  cross_border_transfer: number | null;
  notice_version: string;
  source: 'organization' | 'platform';
}

type NoticeRow = PolicyNotice;

interface PublicQuestion {
  id: string;
  code: string;
  ord: number;
  type: QuestionType;
  required: boolean;
  section: string;
  label: string;
  hint: string | null;
  group_code: string | null;
  dimension_code: string | null;
  order: number;
  option_ids: string[];
}

interface PublicOption extends OptionRow {
  order: number;
}

interface PublicContext {
  kind: 'public' | 'invitation';
  link?: LinkRow;
  invitation?: InvitationRow;
  assignment?: AssignmentRow;
  survey: SurveyRow;
  version: VersionRow;
  profile: ProfileRow;
  notice: NoticeRow;
  questions: PublicQuestion[];
  options: PublicOption[];
  state: 'active' | 'closed' | 'expired' | 'revoked' | 'used';
  canSubmit: boolean;
  guardianRequired: boolean;
}

interface AnswerInput {
  question_code: string;
  option_id?: string | null;
  text?: string | null;
}

interface ValidAnswer {
  question: PublicQuestion;
  option: OptionRow | null;
  text: string | null;
  skipped: boolean;
}

interface ConsentRow {
  id: string;
  version_id: string;
  notice_version: string;
  basis: string;
  recorded_at: string;
  guardian_evidence_status: string;
  guardian_evidence_ref: string | null;
  guardian_evidence_file: string | null;
  response_id: string | null;
}

export const publicRouter = Router();

const RESPONDENT_COOKIE = 'svara_respondent';
const CONSENT_TTL_MS = 24 * 60 * 60 * 1000;

function respondentSession(req: AuthedRequest): string | undefined {
  const token = parseCookies(req.headers.cookie)[RESPONDENT_COOKIE];
  return token && /^[A-Za-z0-9_-]{43}$/u.test(token) ? token : undefined;
}

function consentSessionHash(consentId: string, session: string): string {
  return sha256Hex(`${consentId}:${session}`);
}

async function questionRows(versionId: string): Promise<QuestionRow[]> {
  return all<QuestionRow>('SELECT * FROM questions WHERE version_id = ? ORDER BY ord, code', versionId);
}

async function publicQuestions(versionId: string): Promise<{ questions: PublicQuestion[]; options: PublicOption[] }> {
  const questions: PublicQuestion[] = [];
  const options: PublicOption[] = [];
  const rows = await questionRows(versionId);
  const byQuestion = new Map<string, OptionRow[]>();
  if (rows.length > 0) {
    const placeholders = rows.map(() => '?').join(', ');
    for (const option of await all<OptionRow>(
      `SELECT * FROM question_options WHERE question_id IN (${placeholders}) ORDER BY question_id, ord`,
      ...rows.map((row) => row.id),
    )) {
      const bucket = byQuestion.get(option.question_id);
      if (bucket) bucket.push(option);
      else byQuestion.set(option.question_id, [option]);
    }
  }
  for (const question of rows) {
    const questionOptions = byQuestion.get(question.id) ?? [];
    questions.push({
      id: question.id,
      code: question.code,
      ord: question.ord,
      type: question.type,
      required: question.required === 1,
      section: question.section,
      label: question.label,
      hint: question.hint,
      group_code: question.group_code,
      dimension_code: question.dimension_code,
      order: question.ord,
      option_ids: questionOptions.map((option) => option.id),
    });
    for (const option of questionOptions) options.push({ ...option, order: option.ord });
  }
  return { questions, options };
}

/**
 * Kebijakan efektif mengikuti lingkup survei: organisasi pemilik, atau platform untuk survei
 * mandiri. `surveys.profile_id`/`profiles` adalah warisan deployment dan tidak dibaca lagi.
 */
interface NoticeSource {
  id: string;
  organization_name: string;
  organization_type: string;
  respondent_age_category: string | null;
  consent_mode: string | null;
  policy_url: string;
  terms_url: string;
  retention_days: number | null;
  data_request_contact: string | null;
  cross_border_transfer: number | null;
  notice_version: string;
  source: 'organization' | 'platform';
}

interface PolicyNotice {
  id: string;
  version: string;
  effective_date: string;
  purpose: string;
  data_categories: string;
  module15_usage: string;
  retention_text: string;
  recipients: string;
  contact: string;
  rights: string;
  child_data_text: string;
  cross_border_text: string;
}

async function noticeSourceFor(survey: SurveyRow): Promise<NoticeSource> {
  let row = survey.organization_id
    ? await get<Omit<NoticeSource, 'source'>>(
        `SELECT id, name AS organization_name, organization_type, respondent_age_category, consent_mode,
                policy_url, terms_url, retention_days, data_request_contact, cross_border_transfer, notice_version
           FROM organizations WHERE id = ?`,
        survey.organization_id,
      )
    : await get<Omit<NoticeSource, 'source'>>(
        `SELECT id, organization_name, organization_type, NULL::text AS respondent_age_category,
                NULL::text AS consent_mode, policy_url, terms_url, retention_days, data_request_contact,
                cross_border_transfer, notice_version
           FROM platform_profile WHERE id = 'platform'`,
      );
  if (!row) fail(409, 'policy_source_missing', 'Profil kebijakan survei ini belum dikonfigurasi.');
  // UIX-08: kontak pengendali yang dapat dipakai adalah kolom organisasi survei; bila belum diisi,
  // pengelola platform yang menjadi kanal. Notice tidak menyalin alamat platform diam-diam.
  if (row.data_request_contact === null) {
    const platform = await get<{ data_request_contact: string | null }>(
      "SELECT data_request_contact FROM platform_profile WHERE id = 'platform'",
    );
    row = { ...row, data_request_contact: platform?.data_request_contact ?? null };
  }
  return { ...row, source: survey.organization_id ? 'organization' : 'platform' };
}

async function noticeRow(source: NoticeSource, version: string): Promise<PolicyNotice | undefined> {
  // Aturan pemilihan baris yang sama dipakai bootstrap (`surveyNoticesFor`), jadi layar creator dan
  // pengantar responden tidak dapat menampilkan notice versi yang berbeda.
  return noticeRowFor(source.source, source.id, version);
}

/**
 * Notice harus persis versi yang tercatat pada versi survei. Bila versi itu tidak ada,
 * permintaan gagal (fail closed) alih-alih menampilkan notice versi lain.
 */
async function noticeForVersion(source: NoticeSource, version: string): Promise<PolicyNotice> {
  const row = await noticeRow(source, version);
  if (!row) fail(500, 'notice_version_unavailable', 'Pemberitahuan versi yang diperlukan survei tidak tersedia.');
  return row;
}

/**
 * Dipanggil publish dengan pembaca yang sama dengan endpoint publik, agar tidak ada versi terbit
 * yang tautannya langsung gagal 500. Sumber kebijakan yang hilang tetap 409 `policy_source_missing`.
 */
export async function requirePublishableNotice(survey: SurveyRow, version: string): Promise<void> {
  if (!(await noticeRow(await noticeSourceFor(survey), version))) {
    fail(
      422,
      'notice_version_unavailable',
      `Pemberitahuan privasi versi ${version} untuk survei ini belum tersedia, sehingga tautannya tidak dapat dibuka responden. Minta admin melengkapinya sebelum menerbitkan.`,
    );
  }
}

/** NULL = tanpa batas. Nilai yang tidak dapat diurai dianggap sudah lewat (fail-closed), bukan tanpa batas. */
function invitationExpired(expiresAt: string | null): boolean {
  if (expiresAt === null) return false;
  const at = Date.parse(expiresAt);
  return Number.isNaN(at) || at < Date.now();
}

// SEC-10: path token tidak pernah dibandingkan dengan kolom token; hanya hash yang dicari. ID undangan
// hasil penukaran kode (SEC-09) adalah referensi, bukan kredensial, dan dibaca lewat kuncinya.
async function invitationForToken(token: string): Promise<InvitationRow | undefined> {
  const shape = publicTokenShape(token);
  if (shape === 'invitation_id') return get<InvitationRow>('SELECT * FROM invitations WHERE id = ?', token);
  if (shape !== 'invitation') return undefined;
  return get<InvitationRow>('SELECT * FROM invitations WHERE token_hash = ?', sha256Hex(token));
}

async function linkForToken(token: string): Promise<LinkRow | undefined> {
  if (publicTokenShape(token) !== 'link') return undefined;
  return get<LinkRow>('SELECT * FROM public_links WHERE token_hash = ?', sha256Hex(token));
}

/**
 * `public_links.closed_reason` yang boleh dilayani ulang ke versi terbit terbaru (BF-04): ditutup oleh
 * versi baru ('superseded') atau oleh penutupan survei ('closed'). Arsip menulis 'archived' dan tidak
 * pernah dihidupkan lagi.
 */
export const CONTINUABLE_CLOSE_REASONS = ['superseded', 'closed'] as const;

function baseState(version: VersionRow, survey: SurveyRow): 'active' | 'closed' | 'expired' | 'revoked' | 'used' {
  if (survey.status !== 'published' || version.status !== 'published') return 'closed';
  return 'active';
}

export async function resolvePublicContext(token: string): Promise<PublicContext> {
  const invitation = await invitationForToken(token);
  if (invitation) {
    const assignment = await get<AssignmentRow>('SELECT * FROM assignments WHERE id = ?', invitation.assignment_id);
    const version = await get<VersionRow>('SELECT * FROM survey_versions WHERE id = ?', invitation.version_id);
    const survey = await get<SurveyRow>('SELECT * FROM surveys WHERE id = ?', invitation.survey_id);
    if (!assignment || !version || !survey) fail(404, 'token_not_found', 'Tautan tidak dikenal.');
    const profile = await noticeSourceFor(survey);
    const notice = await noticeForVersion(profile, version.notice_version);
    const existing = await get<{ id: string }>('SELECT id FROM responses WHERE assignment_id = ? LIMIT 1', assignment.id);
    let state = baseState(version, survey);
    if (invitation.status === 'used' || existing) state = 'used';
    else if (invitation.status === 'revoked') state = 'revoked';
    else if (invitation.status === 'expired' || invitationExpired(invitation.expires_at)) state = 'expired';
    const { questions, options } = await publicQuestions(version.id);
    return {
      kind: 'invitation',
      invitation,
      assignment,
      survey,
      version,
      profile,
      notice,
      questions,
      options,
      state,
      canSubmit: state === 'active',
      guardianRequired: profile.consent_mode === 'guardian',
    };
  }
  const link = await linkForToken(token);
  if (!link) fail(404, 'token_not_found', 'Tautan tidak dikenal.');
  const version0 = await get<VersionRow>('SELECT * FROM survey_versions WHERE id = ? AND survey_id = ?', link.version_id, link.survey_id);
  const survey = await get<SurveyRow>('SELECT * FROM surveys WHERE id = ?', link.survey_id);
  if (!version0 || !survey) fail(404, 'token_not_found', 'Tautan tidak dikenal.');
  let version = version0;
  const expired = link.status === 'expired' || (link.expires_at !== null && Date.parse(link.expires_at) < Date.now());
  // Tautan yang dicabut ditolak sebelum isi survei dibaca; arsip/penutupan tetap dilayani sebagai
  // 'closed' (tanpa pertanyaan, tanpa kiriman) seperti kontrak publik sebelumnya.
  if (link.status === 'revoked') fail(409, 'link_revoked', 'Tautan ini sudah tidak aktif.');
  let state = baseState(version, survey);
  // Expiry menang atas status baris: tautan yang lewat expires_at selalu 'expired' walau barisnya
  // 'closed'/'active', agar responden tidak mencoba mengisi tautan yang sudah tidak berlaku.
  if (expired) state = 'expired';
  else if (link.status === 'closed') state = 'closed';
  // Versi terbit saat ini berstatus published, jadi sumber remap wajib sudah tidak terbit; arsip menutup
  // survei tanpa menaikkan current_version_id sehingga status versi harus ikut diperiksa. Hanya tautan
  // berstatus 'closed' dengan alasan di CONTINUABLE_CLOSE_REASONS ('superseded' dan 'closed') yang
  // di-remap; komentar migrasi 014 ("remap hanya 'superseded'") mendahului alasan 'closed'. Alasan
  // 'archived', NULL (ditutup sebelum 014, asal penutupan tidak diketahui), dan tautan yang masih
  // 'active' pada versi yang tidak lagi terbit tetap 'closed'.
  if (
    version.status !== 'published' &&
    link.status === 'closed' &&
    CONTINUABLE_CLOSE_REASONS.some((reason) => reason === link.closed_reason) &&
    !expired &&
    survey.status === 'published' &&
    survey.current_version_id !== version.id
  ) {
    // The survey's current_version_id can point to a draft instead of the published version.
    const latest = await get<VersionRow>(
      `SELECT * FROM survey_versions
       WHERE survey_id = ? AND status = 'published' AND number > ?
       ORDER BY number DESC LIMIT 1`,
      link.survey_id,
      version.number,
    );
    if (latest) {
      version = latest;
      state = 'active';
    }
  }
  const profile = await noticeSourceFor(survey);
  const notice = await noticeForVersion(profile, version.notice_version);
  const { questions, options } = await publicQuestions(version.id);
  return {
    kind: 'public',
    link,
    survey,
    version,
    profile,
    notice,
    questions,
    options,
    state,
    canSubmit: state === 'active',
    guardianRequired: profile.consent_mode === 'guardian',
  };
}

// SEC-02: id versi tidak boleh bocor ke responden (juga mencakup id draf). Token buram di bawah membuat
// klien bisa mengirim balik versi yang dirender tanpa memegang id internalnya.
function consentVersionToken(versionId: string): string {
  return Buffer.from(versionId, 'utf8').toString('base64url');
}

/**
 * Retry harus divalidasi terhadap versi milik attempt pertama, bukan versi terbit saat ini: sesudah
 * publish berikutnya, isi dan kunci idempotensi yang sama masih milik versi lama. Pertanyaan, opsi,
 * dan consent diambil dari versi attempt agar hash idempotensi bisa dibandingkan apa adanya.
 */
async function contextForStoredAttempt(context: PublicContext, versionId: string): Promise<PublicContext> {
  if (versionId === context.version.id) return context;
  const version = await get<VersionRow>('SELECT * FROM survey_versions WHERE id = ?', versionId);
  if (!version) fail(409, 'submission_closed', 'Versi respons ini tidak tersedia lagi.');
  const { questions, options } = await publicQuestions(version.id);
  return { ...context, version, questions, options, state: 'active', canSubmit: false };
}

function publicPayload(context: PublicContext, includeQuestions = false) {
  return {
    kind: context.kind,
    isPublicLink: context.kind === 'public',
    state: context.state,
    canSubmit: context.canSubmit,
    guardianRequired: context.guardianRequired,
    survey: {
      title: context.survey.title,
      purpose: context.survey.purpose,
      object_label: context.survey.object_label,
      instructions: context.survey.instructions,
    },
    version: {
      number: context.version.number,
      notice_version: context.version.notice_version,
    },
    consent_version: consentVersionToken(context.version.id),
    questions: includeQuestions ? context.questions : [],
    options: includeQuestions ? context.options : [],
    profile: {
      ...context.profile,
      cross_border_transfer:
        context.profile.cross_border_transfer === null ? null : context.profile.cross_border_transfer === 1,
      synthetic_placeholder: false,
    },
    notice: { ...context.notice, synthetic_placeholder: false },
    invitation: context.invitation
      ? {
          code: context.invitation.code,
          status: context.state === 'used' ? 'used' : context.invitation.status,
        }
      : null,
  };
}

async function parseAnswers(context: PublicContext, raw: unknown): Promise<ValidAnswer[]> {
  if (!Array.isArray(raw)) fail(422, 'validation_error', 'answers wajib berupa array.');
  const byCode = new Map<string, AnswerInput>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') fail(422, 'validation_error', 'Format jawaban tidak valid.');
    const row = item as Record<string, unknown>;
    const code =
      typeof row.question_code === 'string'
        ? row.question_code.trim()
        : typeof row.code === 'string'
          ? row.code.trim()
          : '';
    if (!code) fail(422, 'validation_error', 'Kode pertanyaan wajib ada pada setiap jawaban.');
    byCode.set(code, {
      question_code: code,
      option_id: typeof row.option_id === 'string' ? row.option_id : null,
      text: typeof row.text === 'string' ? row.text : null,
    });
  }
  // Opsi seluruh versi sudah dimuat `publicQuestions`; jangan baca ulang tabel opsi per pertanyaan.
  const optionsByQuestion = new Map<string, OptionRow[]>();
  for (const question of context.questions) optionsByQuestion.set(question.id, []);
  for (const option of context.options) optionsByQuestion.get(option.question_id)?.push(option);
  const known = new Set(context.questions.map((question) => question.code));
  for (const code of byCode.keys()) {
    if (!known.has(code)) fail(422, 'unknown_question', `Pertanyaan ${code} bukan bagian dari versi ini.`, { code });
  }
  const result: ValidAnswer[] = [];
  const missing: string[] = [];
  for (const question of context.questions) {
    const input = byCode.get(question.code);
    if (question.type === 'short_text') {
      const text = (input?.text ?? '').trim();
      if (!text) {
        if (question.required) missing.push(question.code);
        result.push({ question, option: null, text: null, skipped: true });
        continue;
      }
      if (text.length > 5000) fail(422, 'validation_error', `Jawaban ${question.code} terlalu panjang.`, { code: question.code });
      result.push({ question, option: null, text, skipped: false });
      continue;
    }
    const options = optionsByQuestion.get(question.id) ?? [];
    let option = options.find((item) => item.id === input?.option_id) ?? null;
    if (!option && input?.option_id) {
      fail(422, 'invalid_option', `Opsi untuk ${question.code} bukan bagian dari pertanyaan ini.`, { code: question.code });
    }
    if (!option && input?.text) {
      const numeric = Number(input.text);
      option = options.find((item) => item.value === numeric) ?? null;
    }
    if (!option) {
      if (question.required) missing.push(question.code);
      result.push({ question, option: null, text: null, skipped: true });
      continue;
    }
    result.push({ question, option, text: null, skipped: false });
  }
  if (missing.length > 0) {
    fail(422, 'required_items_missing', 'Beberapa item wajib belum diisi.', { fields: missing });
  }
  return result;
}

function consentForSession(context: PublicContext, versionId: string, id: string, session: string, lock = false) {
  return get<ConsentRow>(
    `SELECT id, version_id, notice_version, basis, recorded_at, guardian_evidence_status, guardian_evidence_ref,
            guardian_evidence_file, response_id
       FROM consent_records
      WHERE id = ? AND survey_id = ? AND version_id = ? AND status = 'granted'
        AND invitation_id IS NOT DISTINCT FROM ? AND public_link_id IS NOT DISTINCT FROM ?
        AND respondent_session_hash = ?${lock ? ' FOR UPDATE' : ''}`,
    id,
    context.survey.id,
    versionId,
    context.invitation?.id ?? null,
    context.link?.id ?? null,
    consentSessionHash(id, session),
  );
}

/**
 * Consent milik sesi ini tanpa syarat versi; dipakai review historis yang harus tetap terbuka untuk
 * attempt pada versi lama sesudah publish berikutnya. Form/review versi lain tetap ditolak pemanggil.
 */
function sessionConsent(context: PublicContext, id: string, session: string) {
  return get<ConsentRow>(
    `SELECT id, version_id, notice_version, basis, recorded_at, guardian_evidence_status, guardian_evidence_ref,
            guardian_evidence_file, response_id
       FROM consent_records
      WHERE id = ? AND survey_id = ? AND status = 'granted'
        AND invitation_id IS NOT DISTINCT FROM ? AND public_link_id IS NOT DISTINCT FROM ?
        AND respondent_session_hash = ?`,
    id,
    context.survey.id,
    context.invitation?.id ?? null,
    context.link?.id ?? null,
    consentSessionHash(id, session),
  );
}

async function requireConsent(
  context: PublicContext, req: AuthedRequest, consentId: unknown, lock = false,
): Promise<ConsentRow> {
  const id = typeof consentId === 'string' ? consentId.trim() : '';
  if (!id) fail(403, 'consent_required', 'Persetujuan belum tercatat. Buka pengantar dan setujui pemberitahuan.');
  const session = respondentSession(req);
  if (!session) fail(409, 'consent_context_mismatch', 'Buka kembali pengantar dan catat persetujuan untuk sesi ini.');
  const consent = await consentForSession(context, context.version.id, id, session, lock);
  if (!consent) fail(409, 'consent_context_mismatch', 'Buka kembali pengantar dan catat persetujuan untuk sesi ini.');
  return consent;
}

function requireUnusedConsent(context: PublicContext, consent: ConsentRow): void {
  if (consent.response_id !== null) {
    fail(409, 'consent_already_used', 'Persetujuan ini sudah dipakai untuk satu respons final.');
  }
  const age = Date.now() - Date.parse(consent.recorded_at);
  if (!Number.isFinite(age) || age < 0 || age >= CONSENT_TTL_MS) {
    fail(409, 'consent_expired', 'Persetujuan kedaluwarsa. Buka kembali pengantar untuk mencatat persetujuan baru.');
  }
  if (context.guardianRequired && (
    !['self_attested', 'verified'].includes(consent.guardian_evidence_status)
    || !(consent.guardian_evidence_file || consent.guardian_evidence_ref?.trim())
  )) {
    fail(409, 'guardian_evidence_required', 'Buka kembali pengantar dan lengkapi bukti wali.');
  }
}

async function receiptFor(responseId: string) {
  const row = await get<{
    id: string;
    survey_id: string;
    submitted_at: string;
    idempotency_key: string;
    number: number;
  }>(
    `SELECT r.id, r.survey_id, r.submitted_at, r.idempotency_key, v.number
       FROM responses r JOIN survey_versions v ON v.id = r.version_id
      WHERE r.id = ?`,
    responseId,
  );
  if (!row) fail(404, 'response_not_found', 'Respons tidak ditemukan.');
  return {
    response_id: row.id,
    survey_id: row.survey_id,
    version_number: row.number,
    submitted_at: row.submitted_at,
    status: 'submitted',
    idempotency_key: row.idempotency_key,
  };
}

publicRouter.get('/public/surveys/:token', async (req: AuthedRequest, res: Response) => {
  try {
    const context = await resolvePublicContext(pathParam(req, 'token'));
    res.setHeader('Cache-Control', 'no-store');
    res.json({ data: publicPayload(context, false) });
  } catch (error) {
    sendError(res, error);
  }
});

publicRouter.post('/public/surveys/:token/consent', async (req: AuthedRequest, res: Response) => {
  let storedEvidenceId: string | null = null;
  try {
    if (!rateLimit({ key: `consent:${clientIp(req)}:${pathParam(req, 'token')}`, limit: 30, windowMs: 60 * 1000 })) {
      fail(429, 'rate_limited', 'Terlalu banyak permintaan. Coba lagi sebentar.');
    }
    const context = await resolvePublicContext(pathParam(req, 'token'));
    if (!context.canSubmit) {
      fail(409, `submission_${context.state}`, `Formulir tidak dapat menerima persetujuan: ${context.state}.`);
    }
    const click = req.body?.respondent_click === true;
    const eligibility = req.body?.eligibility === true;
    const evidenceRef = typeof req.body?.guardian_evidence_ref === 'string' ? req.body.guardian_evidence_ref.trim() : '';
    const hasEvidenceFile = req.body?.guardian_evidence_file !== undefined;
    if (!click || !eligibility) {
      fail(422, 'consent_incomplete', 'Konfirmasi kelayakan dan persetujuan wajib dicentang.');
    }
    // Berkas hanya bermakna pada survei bermode wali; jangan menerimanya diam-diam sebagai data yatim.
    if (hasEvidenceFile && !context.guardianRequired) {
      fail(422, 'invalid_evidence', 'Berkas bukti wali hanya diterima untuk survei yang mewajibkan wali.');
    }
    if (context.guardianRequired && !evidenceRef && !hasEvidenceFile) {
      fail(422, 'guardian_evidence_required', 'Bukti verifikasi wali wajib tersedia sebelum pengisian.');
    }
    // Batas ukuran, MIME, dan isi diperiksa seluruhnya di memori sebelum satu byte pun ditulis.
    const upload: GuardianEvidenceUpload | null = hasEvidenceFile
      ? decodeGuardianEvidence(req.body.guardian_evidence_file, req.body?.guardian_evidence_mime, req.body?.guardian_evidence_name)
      : null;
    // SEC-02: persetujuan hanya sah untuk versi+notice yang benar-benar dirender pada intro. Klien mengirim
    // consent_version dari konteks yang tampil; remap tautan lama tidak boleh diam-diam mengganti notice yang disetujui.
    const shownToken = typeof req.body?.version_id === 'string' ? req.body.version_id.trim() : '';
    if (!shownToken) {
      fail(422, 'version_id_required', 'Muat ulang pengantar sebelum menyetujui pemberitahuan.');
    }
    const consentId = newId('c');
    const existingSession = respondentSession(req);
    const session = existingSession ?? randomBytes(32).toString('base64url');
    const basis = context.guardianRequired ? 'Persetujuan wali' : 'Persetujuan diri';
    // SEC-04/BF-03: bukti dari wali adalah pernyataan yang belum dimoderasi; status baru berubah lewat
    // keputusan operator organisasi pada PATCH /org/guardian-evidence/:consentId.
    const guardianStatus = context.guardianRequired ? 'self_attested' : 'not_required';
    const recordedAt = nowIso();
    if (upload) {
      await writeGuardianEvidence(consentId, upload);
      storedEvidenceId = consentId;
    }
    await withTx(async () => {
      // Versi diperiksa di dalam transaksi agar publish yang terjadi setelah resolve tidak lolos.
      const shownVersionId = Buffer.from(shownToken, 'base64url').toString('utf8');
      if (shownVersionId !== context.version.id) {
        fail(409, 'notice_changed', 'Pemberitahuan atau versi survei berubah. Baca ulang pengantar lalu setujui.');
      }
      await run(
        `INSERT INTO consent_records (id, survey_id, version_id, notice_version, basis, status, recorded_at,
          respondent_click, guardian_evidence_status, guardian_evidence_ref, guardian_evidence_file,
          guardian_evidence_mime, guardian_evidence_size, guardian_evidence_uploaded_at,
          invitation_id, public_link_id, respondent_session_hash, response_id)
         VALUES (?, ?, ?, ?, ?, 'granted', ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        consentId,
        context.survey.id,
        context.version.id,
        context.version.notice_version,
        basis,
        recordedAt,
        guardianStatus,
        context.guardianRequired ? evidenceRef : null,
        upload?.fileName ?? null,
        upload?.mime ?? null,
        upload?.size ?? null,
        upload ? recordedAt : null,
        context.invitation?.id ?? null,
        context.link?.id ?? null,
        consentSessionHash(consentId, session),
      );
      // Catat notice yang benar-benar ditampilkan, terpisah dari notice_version pada versi survei.
      await run(
        `INSERT INTO consent_notice_versions (consent_id, source, source_id, notice_id, notice_version, effective_date, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        consentId,
        context.profile.source,
        context.profile.id,
        context.notice.id,
        context.notice.version,
        context.notice.effective_date,
        recordedAt,
      );
    });
    await auditPublic('Persetujuan tercatat', `${context.survey.id} · v${context.version.number}`, 'berhasil');
    res.setHeader('Cache-Control', 'no-store');
    if (!existingSession) {
      res.cookie(RESPONDENT_COOKIE, session, {
        path: '/api/v1/public/surveys',
        httpOnly: true,
        sameSite: 'lax',
        secure: secureCookie(req),
      });
    }
    res.status(201).json({
      data: {
        consent_id: consentId,
        notice_version: context.version.notice_version,
        notice_source: context.profile.source,
        basis,
        guardian_evidence_status: guardianStatus,
        recorded_at: recordedAt,
      },
    });
  } catch (error) {
    // Setiap kegagalan setelah berkas ditulis (mis. notice berubah) tidak boleh meninggalkan berkas yatim.
    if (storedEvidenceId) await removeGuardianEvidence(storedEvidenceId).catch(() => undefined);
    sendError(res, error);
  }
});

async function loadPublicForm(req: AuthedRequest, res: Response, allowRetry: boolean) {
  try {
    const resolved = await resolvePublicContext(pathParam(req, 'token'));
    const consentId = typeof req.query.consent_id === 'string' ? req.query.consent_id.trim() : '';
    const session = respondentSession(req);
    const owned = consentId && session ? await sessionConsent(resolved, consentId, session) : undefined;
    // Review retry milik attempt historis memakai versi milik consent, bukan versi terbit sekarang.
    const retryOnly = allowRetry && owned !== undefined && owned.response_id !== null;
    const context = retryOnly && owned.version_id !== resolved.version.id
      ? await contextForStoredAttempt(resolved, owned.version_id)
      : resolved;
    const consent = owned?.version_id === context.version.id
      ? owned
      : await requireConsent(context, req, req.query.consent_id);
    if (!retryOnly) {
      if (!context.canSubmit) {
        fail(409, `submission_${context.state}`, `Formulir tidak dapat dibuka: ${context.state}.`);
      }
      requireUnusedConsent(context, consent);
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      data: {
        ...publicPayload(context, true),
        ...(retryOnly ? { retryOnly: true, canSubmit: false } : {}),
        consent: {
          consent_id: consent.id,
          notice_version: consent.notice_version,
          basis: consent.basis,
          guardian_evidence_status: consent.guardian_evidence_status,
        },
      },
    });
  } catch (error) {
    sendError(res, error);
  }
}

publicRouter.get('/public/surveys/:token/form', (req: AuthedRequest, res: Response) => loadPublicForm(req, res, false));
publicRouter.get('/public/surveys/:token/review', (req: AuthedRequest, res: Response) => loadPublicForm(req, res, true));

publicRouter.post('/public/invitations/resolve', async (req: AuthedRequest, res: Response) => {
  try {
    if (!rateLimit({ key: `invite-code:${clientIp(req)}`, limit: 20, windowMs: 10 * 60 * 1000 })) {
      fail(429, 'rate_limited', 'Terlalu banyak percobaan. Coba lagi nanti.');
    }
    const code = asString(req.body?.code ?? '', 'code', 80).toUpperCase();
    if (!code) fail(422, 'validation_error', 'Kode undangan wajib diisi.');
    const invitation = await get<{ id: string; status: string; expires_at: string | null; survey_id: string }>(
      'SELECT id, status, expires_at, survey_id FROM invitations WHERE code = ?',
      code,
    );
    if (!invitation) fail(404, 'invitation_not_found', 'Kode undangan tidak dikenal.');
    if (invitation.status !== 'active') fail(409, 'invitation_inactive', 'Undangan ini tidak aktif.');
    if (invitationExpired(invitation.expires_at)) {
      fail(409, 'invitation_expired', 'Undangan ini sudah kedaluwarsa.');
    }
    // SEC-09: token hanya disimpan sebagai hash, jadi penukaran kode mengembalikan URL formulir yang
    // menyelesaikan token di server; token undangan mentah tidak pernah menyeberang ke klien.
    await auditPublic('Tukar kode undangan', `${invitation.survey_id} · ${invitation.id}`, 'berhasil');
    res.setHeader('Cache-Control', 'no-store');
    res.json({ data: { url: `/s/${invitation.id}` } });
  } catch (error) {
    sendError(res, error);
  }
});

publicRouter.post('/public/surveys/:token/responses', async (req: AuthedRequest, res: Response) => {
  let auditObject = 'respons';
  try {
    if (!rateLimit({ key: `submit:${clientIp(req)}`, limit: 40, windowMs: 10 * 60 * 1000 })) {
      fail(429, 'rate_limited', 'Terlalu banyak kiriman. Coba lagi nanti.');
    }
    const key = req.get('idempotency-key')?.trim() ?? '';
    if (key.length < 8 || key.length > 128) {
      fail(422, 'idempotency_key_required', 'Header Idempotency-Key wajib diisi (8–128 karakter).');
    }
    const context = await resolvePublicContext(pathParam(req, 'token'));
    auditObject = `${context.survey.id} · v${context.version.number}`;
    const scope = context.kind === 'invitation' ? `invitation:${context.invitation!.id}` : `public:${context.link!.id}`;
    const outcome = await withTx(async () => {
      // Serialkan retry dengan kunci yang sama sebelum memeriksa idempotensi.
      await get('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', `${scope}:${key}`);
      const existingAttempt = await get<{ response_id: string; payload_hash: string; version_id: string }>(
        `SELECT a.response_id, a.payload_hash, r.version_id
           FROM submission_attempts a JOIN responses r ON r.id = a.response_id
          WHERE a.scope = ? AND a.idempotency_key = ?`,
        scope,
        key,
      );
      if (existingAttempt) {
        const attemptContext = await contextForStoredAttempt(context, existingAttempt.version_id);
        const bound = await get<{ consent_id: string }>(
          'SELECT id AS consent_id FROM consent_records WHERE response_id = ?',
          existingAttempt.response_id,
        );
        const session = respondentSession(req);
        const attemptConsent = bound && session
          ? await consentForSession(context, attemptContext.version.id, bound.consent_id, session)
          : undefined;
        if (attemptConsent?.response_id !== existingAttempt.response_id) {
          fail(409, 'consent_context_mismatch', 'Buka kembali pengantar dan catat persetujuan untuk sesi ini.');
        }
        const answers = await parseAnswers(attemptContext, req.body?.answers);
        const hash = payloadHash({
          consent_id: attemptConsent.id,
          answers: answers.map((answer) => ({
            code: answer.question.code,
            option_id: answer.option?.id ?? null,
            text: answer.text,
            skipped: answer.skipped,
          })),
        });
        if (existingAttempt.payload_hash !== hash) {
          fail(409, 'idempotency_conflict', 'Kunci pengiriman yang sama dipakai dengan isi berbeda.', { retryable: false });
        }
        return { receipt: await receiptFor(existingAttempt.response_id), created: false };
      }
      const consent = await requireConsent(context, req, req.body?.consent_id);
      const answers = await parseAnswers(context, req.body?.answers);
      const hash = payloadHash({
        consent_id: consent.id,
        answers: answers.map((answer) => ({
          code: answer.question.code,
          option_id: answer.option?.id ?? null,
          text: answer.text,
          skipped: answer.skipped,
        })),
      });
      if (!context.canSubmit) {
        fail(409, `submission_${context.state}`, `Formulir tidak dapat menerima kiriman: ${context.state}.`, { state: context.state });
      }
      if (context.kind === 'invitation') {
        const lockedInvitation = await get<{ status: string; used_at: string | null }>(
          'SELECT status, used_at FROM invitations WHERE id = ? FOR UPDATE',
          context.invitation!.id,
        );
        if (!lockedInvitation || lockedInvitation.status !== 'active' || lockedInvitation.used_at) {
          fail(409, 'invitation_inactive', 'Undangan ini sudah tidak aktif.');
        }
        const existing = await get<{ id: string }>('SELECT id FROM responses WHERE assignment_id = ? LIMIT 1', context.assignment!.id);
        if (existing) fail(409, 'already_submitted', 'Undangan ini sudah digunakan untuk respons final.');
      }
      requireUnusedConsent(context, await requireConsent(context, req, consent.id, true));
      const responseId = newId('r');
      const respondentId = newId('p');
      const now = nowIso();
      // Jangan biarkan penutupan versi commit di antara pengecekan status dan penyimpanan respons.
      const freshVersion = await get<{ status: string }>('SELECT status FROM survey_versions WHERE id = ? FOR SHARE', context.version.id);
      if (freshVersion?.status !== 'published') fail(409, 'submission_closed', 'Versi ini sudah ditutup.');
      await run(
        'INSERT INTO respondents (id, source, external_ref, created_at) VALUES (?, ?, NULL, ?)',
        respondentId,
        context.kind === 'invitation' ? 'invitation' : 'public_link',
        now,
      );
      await run(
        `INSERT INTO responses (id, survey_id, version_id, assignment_id, respondent_id, collection_mode, identity_source, submitted_at, idempotency_key)
         VALUES (?, ?, ?, ?, ?, 'standalone', 'local', ?, ?)`,
        responseId,
        context.survey.id,
        context.version.id,
        context.assignment?.id ?? null,
        respondentId,
        now,
        key,
      );
      for (const answer of answers) {
        await run(
          `INSERT INTO answers (id, response_id, question_id, question_code, option_id, value, text, skipped)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          newId('ans'),
          responseId,
          answer.question.id,
          answer.question.code,
          answer.option?.id ?? null,
          answer.option?.value ?? null,
          answer.text,
          answer.skipped ? 1 : 0,
        );
      }
      const consumed = await run(
        'UPDATE consent_records SET response_id = ? WHERE id = ? AND response_id IS NULL',
        responseId,
        consent.id,
      );
      if (consumed !== 1) fail(409, 'consent_already_used', 'Persetujuan ini sudah dipakai untuk satu respons final.');
      await run(
        'INSERT INTO submission_attempts (id, scope, idempotency_key, payload_hash, response_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        newId('sa'),
        scope,
        key,
        hash,
        responseId,
        now,
      );
      if (context.kind === 'invitation') {
        await run("UPDATE invitations SET status = 'used', used_at = ? WHERE id = ?", now, context.invitation!.id);
      }
      await run(
        `INSERT INTO integration_events (id, event_id, type, target, status, attempts, at, simulated, response_id, last_error, payload)
         VALUES (?, ?, 'survey.submitted', 'module_13', 'delivered', 1, ?, 1, ?, NULL, NULL)`,
        newId('ie'),
        newId('ev'),
        now,
        responseId,
      );
      return { receipt: await receiptFor(responseId), created: true };
    });
    await auditPublic('Kirim respons', auditObject, 'berhasil', {
      response_id: outcome.receipt.response_id,
      version_id: context.version.id,
      kind: context.kind,
    });
    res.status(outcome.created ? 201 : 200).json({ data: outcome.receipt });
  } catch (error) {
    if (error instanceof ApiError && error.status >= 400) {
      await auditPublic('Kirim respons', auditObject, 'ditolak', { code: error.code }).catch((auditError) => {
        console.error('[api] audit penolakan gagal', auditError);
      });
    }
    sendError(res, error);
  }
});

publicRouter.get('/public/surveys/:token/receipt/:responseId', async (req: AuthedRequest, res: Response) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const key = req.get('idempotency-key')?.trim() ?? '';
    if (!key) fail(422, 'idempotency_key_required', 'Header Idempotency-Key diperlukan untuk memulihkan bukti.');
    const session = respondentSession(req);
    if (!session) fail(404, 'receipt_not_found', 'Bukti tidak ditemukan untuk konteks ini.');
    const context = await resolvePublicContext(pathParam(req, 'token'));
    const scope = context.kind === 'invitation' ? `invitation:${context.invitation!.id}` : `public:${context.link!.id}`;
    const responseId = pathParam(req, 'responseId');
    const attempt = await get<{ consent_id: string; version_id: string }>(
      `SELECT c.id AS consent_id, r.version_id
         FROM submission_attempts a
         JOIN responses r ON r.id = a.response_id
         JOIN consent_records c ON c.response_id = r.id
        WHERE a.scope = ? AND a.idempotency_key = ? AND a.response_id = ?`,
      scope,
      key,
      responseId,
    );
    const consent = attempt && await consentForSession(context, attempt.version_id, attempt.consent_id, session);
    if (consent?.response_id !== responseId) {
      fail(404, 'receipt_not_found', 'Bukti tidak ditemukan untuk konteks ini.');
    }
    res.json({ data: await receiptFor(responseId) });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * BF-10: halaman kebijakan publik dibaca dari data kebijakan yang berlaku — organisasi dan profil
 * platform — bukan dari tabel `profiles`/`notices` legacy yang dipertahankan hanya untuk seed dan
 * pembacaan historis. Kontak diambil dari profil yang sama; placeholder hanya bila tidak satu pun
 * organisasi mengisi kontak, dan ditandai `synthetic_placeholder`.
 */
publicRouter.get('/public/policy', async (_req: AuthedRequest, res: Response) => {
  try {
    const organizations = await all<{
      id: string;
      name: string;
      organization_type: string;
      policy_url: string;
      terms_url: string;
      retention_days: number | null;
      data_request_contact: string | null;
      cross_border_transfer: number | null;
      notice_version: string;
    }>(
      `SELECT id, name, organization_type, policy_url, terms_url, retention_days, data_request_contact,
              cross_border_transfer, notice_version
         FROM organizations ORDER BY name, id`,
    );
    const platform = await get<{
      organization_name: string;
      organization_type: string;
      policy_url: string;
      terms_url: string;
      retention_days: number | null;
      data_request_contact: string | null;
      cross_border_transfer: number | null;
      notice_version: string;
    }>(
      `SELECT organization_name, organization_type, policy_url, terms_url, retention_days, data_request_contact,
              cross_border_transfer, notice_version
         FROM platform_profile WHERE id = 'platform'`,
    );
    const sources = [
      ...organizations.map((row) => ({
        source: 'organization' as const,
        id: row.id,
        organization_name: row.name,
        organization_type: row.organization_type,
        policy_url: row.policy_url,
        terms_url: row.terms_url,
        retention_days: row.retention_days,
        data_request_contact: row.data_request_contact,
        cross_border_transfer: row.cross_border_transfer === null ? null : row.cross_border_transfer === 1,
        notice_version: row.notice_version,
      })),
      ...(platform
        ? [{
            source: 'platform' as const,
            id: 'platform',
            organization_name: platform.organization_name,
            organization_type: platform.organization_type,
            policy_url: platform.policy_url,
            terms_url: platform.terms_url,
            retention_days: platform.retention_days,
            data_request_contact: platform.data_request_contact,
            cross_border_transfer: platform.cross_border_transfer === null ? null : platform.cross_border_transfer === 1,
            notice_version: platform.notice_version,
          }]
        : []),
    ];
    const contact = sources
      .map((row) => row.data_request_contact)
      .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      data: {
        sources,
        data_request_contact: contact ?? 'privasi@organisasi.contoh',
        synthetic_placeholder: contact === undefined,
      },
    });
  } catch (error) {
    sendError(res, error);
  }
});

publicRouter.post('/data-requests', async (req: AuthedRequest, res: Response) => {
  try {
    if (!rateLimit({ key: `data-request:${clientIp(req)}`, limit: 10, windowMs: 60 * 60 * 1000 })) {
      fail(429, 'rate_limited', 'Terlalu banyak permintaan. Coba lagi nanti.');
    }
    const type = asString(req.body?.type ?? '', 'type', 80);
    const contact = asString(req.body?.contact ?? '', 'contact', 200);
    const note = asString(req.body?.note ?? '', 'note', 2000);
    if (!type) fail(422, 'validation_error', 'Jenis permintaan wajib diisi.');
    if (!contact) fail(422, 'validation_error', 'Kontak wajib diisi agar pengelola dapat menindaklanjuti.');
    const id = newId('dr');
    const at = nowIso();
    await run(
      `INSERT INTO data_requests (id, type, contact, note, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
      id,
      type,
      contact,
      note || null,
      at,
      at,
    );
    await auditPublic('Permintaan data', id, 'berhasil', { type });
    res.status(201).json({
      data: {
        id,
        type,
        status: 'pending',
        created_at: at,
        message: 'Permintaan diterima dan akan diverifikasi pengelola. Log tidak memuat jawaban atau token.',
      },
    });
  } catch (error) {
    sendError(res, error);
  }
});
