import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { Response } from 'express';
import { all, get, nowIso, run, withTx } from '../db.ts';
import { parseCookies, rateLimit, type AuthedRequest } from '../security.ts';
import {
  ApiError,
  asString,
  auditPublic,
  fail,
  newId,
  pathParam,
  payloadHash,
  sendError,
  sha256Hex,
} from '../http.ts';
import type { SurveyRow, VersionRow } from '../http.ts';

type QuestionType = 'likert' | 'short_text' | 'single_choice';

interface LinkRow {
  id: string;
  survey_id: string;
  version_id: string;
  label: string;
  status: string;
  expires_at: string | null;
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
  version_id: string;
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
  notice_version: string;
  basis: string;
  recorded_at: string;
  guardian_evidence_status: string;
  guardian_evidence_ref: string | null;
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

async function optionRows(questionId: string): Promise<OptionRow[]> {
  return all<OptionRow>('SELECT * FROM question_options WHERE question_id = ? ORDER BY ord', questionId);
}

async function publicQuestions(versionId: string): Promise<{ questions: PublicQuestion[]; options: PublicOption[] }> {
  const questions: PublicQuestion[] = [];
  const options: PublicOption[] = [];
  for (const question of await questionRows(versionId)) {
    const questionOptions = await optionRows(question.id);
    questions.push({
      id: question.id,
      version_id: question.version_id,
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
  const row = survey.organization_id
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
  return { ...row, source: survey.organization_id ? 'organization' : 'platform' };
}

/**
 * Notice harus persis versi yang tercatat pada versi survei. Bila versi itu tidak ada,
 * permintaan gagal (fail closed) alih-alih menampilkan notice versi lain.
 */
async function noticeForVersion(source: NoticeSource, version: string): Promise<PolicyNotice> {
  const row =
    source.source === 'organization'
      ? await get<PolicyNotice>(
          'SELECT * FROM organization_notices WHERE organization_id = ? AND version = ? ORDER BY effective_date DESC LIMIT 1',
          source.id,
          version,
        )
      : await get<PolicyNotice>(
          'SELECT * FROM platform_notices WHERE version = ? ORDER BY effective_date DESC LIMIT 1',
          version,
        );
  if (!row) fail(500, 'notice_version_unavailable', 'Pemberitahuan versi yang diperlukan survei tidak tersedia.');
  return row;
}

async function invitationForToken(token: string): Promise<InvitationRow | undefined> {
  return get<InvitationRow>('SELECT * FROM invitations WHERE token_hash = ?', sha256Hex(token));
}

async function linkForToken(token: string): Promise<LinkRow | undefined> {
  return get<LinkRow>('SELECT * FROM public_links WHERE token_hash = ?', sha256Hex(token));
}

function baseState(version: VersionRow, survey: SurveyRow): 'active' | 'closed' | 'expired' | 'revoked' | 'used' {
  if (survey.status === 'archived') return 'closed';
  if (version.status === 'closed' || version.status === 'archived') return 'closed';
  if (version.status !== 'published') return 'closed';
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
    else if (invitation.status === 'expired' || (invitation.expires_at && new Date(invitation.expires_at).getTime() < Date.now())) state = 'expired';
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
  const version = await get<VersionRow>('SELECT * FROM survey_versions WHERE id = ?', link.version_id);
  const survey = await get<SurveyRow>('SELECT * FROM surveys WHERE id = ?', link.survey_id);
  if (!version || !survey) fail(404, 'token_not_found', 'Tautan tidak dikenal.');
  const profile = await noticeSourceFor(survey);
  const notice = await noticeForVersion(profile, version.notice_version);
  let state = baseState(version, survey);
  if (link.status === 'closed') state = 'closed';
  else if (link.status === 'expired' || (link.expires_at && new Date(link.expires_at).getTime() < Date.now())) state = 'expired';
  else if (link.status !== 'active') state = 'revoked';
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

function publicPayload(context: PublicContext, includeQuestions = false) {
  return {
    kind: context.kind,
    isPublicLink: context.kind === 'public',
    state: context.state,
    canSubmit: context.canSubmit,
    guardianRequired: context.guardianRequired,
    survey: context.survey,
    version: {
      ...context.version,
      question_ids: includeQuestions ? context.questions.map((question) => question.id) : [],
    },
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
          id: context.invitation.id,
          assignment_id: context.invitation.assignment_id,
          survey_id: context.invitation.survey_id,
          version_id: context.invitation.version_id,
          code: context.invitation.code,
          status: context.state === 'used' ? 'used' : context.invitation.status,
          expires_at: context.invitation.expires_at,
          used_at: context.invitation.used_at,
          revoked_at: context.invitation.revoked_at,
          token_hash: '',
        }
      : null,
    assignment: context.assignment ?? null,
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
    const options = await optionRows(question.id);
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

async function requireConsent(
  context: PublicContext, req: AuthedRequest, consentId: unknown, lock = false,
): Promise<ConsentRow> {
  const id = typeof consentId === 'string' ? consentId.trim() : '';
  if (!id) fail(403, 'consent_required', 'Persetujuan belum tercatat. Buka pengantar dan setujui pemberitahuan.');
  const session = respondentSession(req);
  if (!session) fail(409, 'consent_context_mismatch', 'Buka kembali pengantar dan catat persetujuan untuk sesi ini.');
  const consent = await get<ConsentRow>(
    `SELECT id, notice_version, basis, recorded_at, guardian_evidence_status, guardian_evidence_ref, response_id
       FROM consent_records
      WHERE id = ? AND survey_id = ? AND version_id = ? AND status = 'granted'
        AND invitation_id IS NOT DISTINCT FROM ? AND public_link_id IS NOT DISTINCT FROM ?
        AND respondent_session_hash = ?${lock ? ' FOR UPDATE' : ''}`,
    id,
    context.survey.id,
    context.version.id,
    context.invitation?.id ?? null,
    context.link?.id ?? null,
    consentSessionHash(id, session),
  );
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
    !['self_attested', 'verified'].includes(consent.guardian_evidence_status) || !consent.guardian_evidence_ref?.trim()
  )) {
    fail(409, 'guardian_evidence_required', 'Buka kembali pengantar dan lengkapi bukti wali.');
  }
}

async function receiptFor(responseId: string) {
  const row = await get<{
    id: string;
    survey_id: string;
    version_id: string;
    submitted_at: string;
    idempotency_key: string;
    number: number;
  }>(
    `SELECT r.id, r.survey_id, r.version_id, r.submitted_at, r.idempotency_key, v.number
       FROM responses r JOIN survey_versions v ON v.id = r.version_id
      WHERE r.id = ?`,
    responseId,
  );
  if (!row) fail(404, 'response_not_found', 'Respons tidak ditemukan.');
  return {
    response_id: row.id,
    survey_id: row.survey_id,
    version_id: row.version_id,
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
  try {
    if (!rateLimit({ key: `consent:${req.ip}:${pathParam(req, 'token')}`, limit: 30, windowMs: 60 * 1000 })) {
      fail(429, 'rate_limited', 'Terlalu banyak permintaan. Coba lagi sebentar.');
    }
    const context = await resolvePublicContext(pathParam(req, 'token'));
    if (!context.canSubmit) {
      fail(409, `submission_${context.state}`, `Formulir tidak dapat menerima persetujuan: ${context.state}.`);
    }
    const click = req.body?.respondent_click === true;
    const eligibility = req.body?.eligibility === true;
    const evidenceRef = typeof req.body?.guardian_evidence_ref === 'string' ? req.body.guardian_evidence_ref.trim() : '';
    if (!click || !eligibility) {
      fail(422, 'consent_incomplete', 'Konfirmasi kelayakan dan persetujuan wajib dicentang.');
    }
    if (context.guardianRequired && !evidenceRef) {
      fail(422, 'guardian_evidence_required', 'Bukti verifikasi wali wajib tersedia sebelum pengisian.');
    }
    const consentId = newId('c');
    const existingSession = respondentSession(req);
    const session = existingSession ?? randomBytes(32).toString('base64url');
    const basis = context.guardianRequired ? 'Persetujuan wali' : 'Persetujuan diri';
    // SEC-04/BF-03: referensi dari form adalah pernyataan responden, bukan hasil verifikasi.
    // Tidak ada jalur yang menandai evidence_ref sebagai sah, jadi statusnya self_attested.
    const guardianStatus = context.guardianRequired ? 'self_attested' : 'not_required';
    const recordedAt = nowIso();
    await withTx(async () => {
      await run(
        `INSERT INTO consent_records (id, survey_id, version_id, notice_version, basis, status, recorded_at,
          respondent_click, guardian_evidence_status, guardian_evidence_ref, invitation_id, public_link_id,
          respondent_session_hash, response_id)
         VALUES (?, ?, ?, ?, ?, 'granted', ?, 1, ?, ?, ?, ?, ?, NULL)`,
        consentId,
        context.survey.id,
        context.version.id,
        context.version.notice_version,
        basis,
        recordedAt,
        guardianStatus,
        context.guardianRequired ? evidenceRef : null,
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
        secure: process.env.COOKIE_SECURE === '1' || req.secure || req.get('x-forwarded-proto') === 'https',
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
    sendError(res, error);
  }
});

publicRouter.get('/public/surveys/:token/form', async (req: AuthedRequest, res: Response) => {
  try {
    const context = await resolvePublicContext(pathParam(req, 'token'));
    const consent = await requireConsent(context, req, req.query.consent_id);
    if (!context.canSubmit) {
      fail(409, `submission_${context.state}`, `Formulir tidak dapat dibuka: ${context.state}.`);
    }
    requireUnusedConsent(context, consent);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      data: {
        ...publicPayload(context, true),
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
});

publicRouter.post('/public/invitations/resolve', async (req: AuthedRequest, res: Response) => {
  try {
    if (!rateLimit({ key: `invite-code:${req.ip}`, limit: 20, windowMs: 10 * 60 * 1000 })) {
      fail(429, 'rate_limited', 'Terlalu banyak percobaan. Coba lagi nanti.');
    }
    const code = asString(req.body?.code ?? '', 'code', 80).toUpperCase();
    if (!code) fail(422, 'validation_error', 'Kode undangan wajib diisi.');
    const invitation = await get<{ token: string; status: string; expires_at: string | null; survey_id: string; version_id: string }>(
      'SELECT token, status, expires_at, survey_id, version_id FROM invitations WHERE code = ?',
      code,
    );
    if (!invitation) fail(404, 'invitation_not_found', 'Kode undangan tidak dikenal.');
    if (invitation.status !== 'active') fail(409, 'invitation_inactive', 'Undangan ini tidak aktif.');
    if (invitation.expires_at && new Date(invitation.expires_at).getTime() < Date.now()) {
      fail(409, 'invitation_expired', 'Undangan ini sudah kedaluwarsa.');
    }
    res.json({ data: { token: invitation.token, url: `/s/${invitation.token}` } });
  } catch (error) {
    sendError(res, error);
  }
});

publicRouter.post('/public/surveys/:token/responses', async (req: AuthedRequest, res: Response) => {
  let auditObject = 'respons';
  try {
    if (!rateLimit({ key: `submit:${req.ip}`, limit: 40, windowMs: 10 * 60 * 1000 })) {
      fail(429, 'rate_limited', 'Terlalu banyak kiriman. Coba lagi nanti.');
    }
    const key = req.get('idempotency-key')?.trim() ?? '';
    if (key.length < 8 || key.length > 128) {
      fail(422, 'idempotency_key_required', 'Header Idempotency-Key wajib diisi (8–128 karakter).');
    }
    const context = await resolvePublicContext(pathParam(req, 'token'));
    auditObject = `${context.survey.id} · v${context.version.number}`;
    const consent = await requireConsent(context, req, req.body?.consent_id);
    const answers = await parseAnswers(context, req.body?.answers);
    const scope = context.kind === 'invitation' ? `invitation:${context.invitation!.id}` : `public:${context.link!.id}`;
    const hash = payloadHash({
      consent_id: consent.id,
      answers: answers.map((answer) => ({
        code: answer.question.code,
        option_id: answer.option?.id ?? null,
        text: answer.text,
        skipped: answer.skipped,
      })),
    });
    const outcome = await withTx(async () => {
      // Serialkan retry dengan kunci yang sama sebelum memeriksa idempotensi.
      await get('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', `${scope}:${key}`);
      const existingAttempt = await get<{ response_id: string; payload_hash: string }>(
        'SELECT response_id, payload_hash FROM submission_attempts WHERE scope = ? AND idempotency_key = ?',
        scope,
        key,
      );
      if (existingAttempt) {
        if (existingAttempt.payload_hash !== hash) {
          fail(409, 'idempotency_conflict', 'Kunci pengiriman yang sama dipakai dengan isi berbeda.', { retryable: false });
        }
        return { receipt: await receiptFor(existingAttempt.response_id), created: false };
      }
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
      const freshVersion = await get<{ status: string }>('SELECT status FROM survey_versions WHERE id = ?', context.version.id);
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
    const key = req.get('idempotency-key')?.trim() ?? '';
    if (!key) fail(422, 'idempotency_key_required', 'Header Idempotency-Key diperlukan untuk memulihkan bukti.');
    const context = await resolvePublicContext(pathParam(req, 'token'));
    const scope = context.kind === 'invitation' ? `invitation:${context.invitation!.id}` : `public:${context.link!.id}`;
    const attempt = await get<{ response_id: string }>(
      'SELECT response_id FROM submission_attempts WHERE scope = ? AND idempotency_key = ?',
      scope,
      key,
    );
    if (!attempt || attempt.response_id !== pathParam(req, 'responseId')) {
      fail(404, 'receipt_not_found', 'Bukti tidak ditemukan untuk konteks ini.');
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ data: await receiptFor(attempt.response_id) });
  } catch (error) {
    sendError(res, error);
  }
});

publicRouter.get('/public/policy', async (_req: AuthedRequest, res: Response) => {
  try {
    const profiles = await all<Record<string, unknown>>('SELECT * FROM profiles ORDER BY id');
    const notices = await all<Record<string, unknown>>('SELECT * FROM notices ORDER BY profile_id, effective_date DESC');
    const contact = profiles
      .map((profile) => profile.data_request_contact)
      .find((value): value is string => typeof value === 'string' && value.length > 0);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      data: {
        profiles,
        notices,
        data_request_contact: contact ?? 'privasi@organisasi.contoh',
        effective_date: '2026-11-17',
        synthetic_placeholder: true,
      },
    });
  } catch (error) {
    sendError(res, error);
  }
});

publicRouter.post('/data-requests', async (req: AuthedRequest, res: Response) => {
  try {
    if (!rateLimit({ key: `data-request:${req.ip}`, limit: 10, windowMs: 60 * 60 * 1000 })) {
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
