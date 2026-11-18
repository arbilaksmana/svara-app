import { Router } from 'express';
import type { Response } from 'express';
import { all, get, nowIso, run, withTx } from '../db.ts';
import { rateLimit, type AuthedRequest } from '../security.ts';
import {
  ApiError,
  asString,
  audit,
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

interface ProfileRow {
  id: string;
  organization_name: string;
  organization_type: string;
  respondent_age_category: string;
  consent_mode: string;
  policy_url: string;
  terms_url: string;
  retention_days: number | null;
  data_request_contact: string | null;
  cross_border_transfer: number | null;
  notice_version: string;
  synthetic_placeholder: number;
}

interface NoticeRow {
  id: string;
  profile_id: string;
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
  synthetic_placeholder: number;
}

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

export const publicRouter = Router();

function questionRows(versionId: string) {
  return all<QuestionRow>('SELECT * FROM questions WHERE version_id = ? ORDER BY ord, code', versionId);
}

function optionRows(questionId: string) {
  return all<OptionRow>('SELECT * FROM question_options WHERE question_id = ? ORDER BY ord', questionId);
}

function publicQuestions(versionId: string): { questions: PublicQuestion[]; options: PublicOption[] } {
  const questions: PublicQuestion[] = questionRows(versionId).map((question) => ({
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
    option_ids: optionRows(question.id).map((option) => option.id),
  }));
  const options: PublicOption[] = questions.flatMap((question) =>
    optionRows(question.id).map((option) => ({ ...option, order: option.ord })),
  );
  return { questions, options };
}

function profileFor(id: string): ProfileRow | undefined {
  return get<ProfileRow>('SELECT * FROM profiles WHERE id = ?', id);
}

function noticeFor(profileId: string, version: string): NoticeRow | undefined {
  return get<NoticeRow>(
    'SELECT * FROM notices WHERE profile_id = ? ORDER BY CASE WHEN version = ? THEN 0 ELSE 1 END, effective_date DESC LIMIT 1',
    profileId,
    version,
  );
}

function invitationForToken(token: string): InvitationRow | undefined {
  return get<InvitationRow>('SELECT * FROM invitations WHERE token_hash = ?', sha256Hex(token));
}

function linkForToken(token: string): LinkRow | undefined {
  return get<LinkRow>('SELECT * FROM public_links WHERE token_hash = ?', sha256Hex(token));
}

function baseState(version: VersionRow, survey: SurveyRow): 'active' | 'closed' | 'expired' | 'revoked' | 'used' {
  if (survey.status === 'archived') return 'closed';
  if (version.status === 'closed' || version.status === 'archived') return 'closed';
  if (version.status !== 'published') return 'closed';
  return 'active';
}

export function resolvePublicContext(token: string): PublicContext {
  const invitation = invitationForToken(token);
  if (invitation) {
    const assignment = get<AssignmentRow>('SELECT * FROM assignments WHERE id = ?', invitation.assignment_id);
    const version = get<VersionRow>('SELECT * FROM survey_versions WHERE id = ?', invitation.version_id);
    const survey = get<SurveyRow>('SELECT * FROM surveys WHERE id = ?', invitation.survey_id);
    if (!assignment || !version || !survey) fail(404, 'token_not_found', 'Tautan tidak dikenal.');
    const profile = profileFor(survey.profile_id);
    const notice = noticeFor(survey.profile_id, version.notice_version);
    if (!profile || !notice) fail(500, 'profile_missing', 'Konfigurasi profil survei tidak lengkap.');
    const existing = get<{ id: string }>('SELECT id FROM responses WHERE assignment_id = ? LIMIT 1', assignment.id);
    let state = baseState(version, survey);
    if (invitation.status === 'used' || existing) state = 'used';
    else if (invitation.status === 'revoked') state = 'revoked';
    else if (invitation.status === 'expired' || (invitation.expires_at && new Date(invitation.expires_at).getTime() < Date.now())) state = 'expired';
    const { questions, options } = publicQuestions(version.id);
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
  const link = linkForToken(token);
  if (!link) fail(404, 'token_not_found', 'Tautan tidak dikenal.');
  const version = get<VersionRow>('SELECT * FROM survey_versions WHERE id = ?', link.version_id);
  const survey = get<SurveyRow>('SELECT * FROM surveys WHERE id = ?', link.survey_id);
  if (!version || !survey) fail(404, 'token_not_found', 'Tautan tidak dikenal.');
  const profile = profileFor(survey.profile_id);
  const notice = noticeFor(survey.profile_id, version.notice_version);
  if (!profile || !notice) fail(500, 'profile_missing', 'Konfigurasi profil survei tidak lengkap.');
  let state = baseState(version, survey);
  if (link.status === 'closed') state = 'closed';
  else if (link.status === 'expired' || (link.expires_at && new Date(link.expires_at).getTime() < Date.now())) state = 'expired';
  else if (link.status !== 'active') state = 'revoked';
  const { questions, options } = publicQuestions(version.id);
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
      synthetic_placeholder: context.profile.synthetic_placeholder === 1,
    },
    notice: { ...context.notice, synthetic_placeholder: context.notice.synthetic_placeholder === 1 },
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

function parseAnswers(context: PublicContext, raw: unknown): ValidAnswer[] {
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
    const options = optionRows(question.id);
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

interface ConsentRow {
  id: string;
  survey_id: string;
  version_id: string;
  notice_version: string;
  basis: string;
  status: string;
  recorded_at: string;
  guardian_evidence_status: string;
  response_id: string | null;
}

/** Persetujuan harus tercatat lebih dulu; formulir dan kiriman menolak tanpa consent_id yang sah. */
function requireConsent(context: PublicContext, consentId: unknown): ConsentRow {
  const id = typeof consentId === 'string' ? consentId.trim() : '';
  if (!id) fail(403, 'consent_required', 'Persetujuan belum tercatat. Buka pengantar dan setujui pemberitahuan.');
  const consent = get<ConsentRow>('SELECT * FROM consent_records WHERE id = ?', id);
  if (
    !consent ||
    consent.status !== 'granted' ||
    consent.survey_id !== context.survey.id ||
    consent.version_id !== context.version.id
  ) {
    fail(403, 'consent_required', 'Persetujuan tidak berlaku untuk formulir ini.');
  }
  return consent;
}

function receiptFor(responseId: string) {
  const row = get<{
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

publicRouter.get('/public/surveys/:token', (req: AuthedRequest, res: Response) => {
  try {
    const context = resolvePublicContext(pathParam(req, 'token'));
    res.setHeader('Cache-Control', 'no-store');
    res.json({ data: publicPayload(context, false) });
  } catch (error) {
    sendError(res, error);
  }
});

publicRouter.post('/public/surveys/:token/consent', (req: AuthedRequest, res: Response) => {
  try {
    if (!rateLimit({ key: `consent:${req.ip}:${pathParam(req, 'token')}`, limit: 30, windowMs: 60 * 1000 })) {
      fail(429, 'rate_limited', 'Terlalu banyak permintaan. Coba lagi sebentar.');
    }
    const context = resolvePublicContext(pathParam(req, 'token'));
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
    const basis = context.guardianRequired ? 'Persetujuan wali' : 'Persetujuan diri';
    const guardianStatus = context.guardianRequired ? 'verified' : 'not_required';
    const recordedAt = nowIso();
    run(
      `INSERT INTO consent_records (id, survey_id, version_id, notice_version, basis, status, recorded_at,
        respondent_click, guardian_evidence_status, guardian_evidence_ref, invitation_id, response_id)
       VALUES (?, ?, ?, ?, ?, 'granted', ?, 1, ?, ?, ?, NULL)`,
      consentId,
      context.survey.id,
      context.version.id,
      context.version.notice_version,
      basis,
      recordedAt,
      guardianStatus,
      context.guardianRequired ? evidenceRef : null,
      context.invitation?.id ?? null,
    );
    audit(req, 'Persetujuan tercatat', `${context.survey.id} · v${context.version.number}`, 'berhasil');
    res.status(201).json({
      data: {
        consent_id: consentId,
        notice_version: context.version.notice_version,
        basis,
        guardian_evidence_status: guardianStatus,
        recorded_at: recordedAt,
      },
    });
  } catch (error) {
    sendError(res, error);
  }
});

publicRouter.get('/public/surveys/:token/form', (req: AuthedRequest, res: Response) => {
  try {
    const context = resolvePublicContext(pathParam(req, 'token'));
    const consent = requireConsent(context, req.query.consent_id);
    if (!context.canSubmit) {
      fail(409, `submission_${context.state}`, `Formulir tidak dapat dibuka: ${context.state}.`);
    }
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

publicRouter.post('/public/invitations/resolve', (req: AuthedRequest, res: Response) => {
  try {
    if (!rateLimit({ key: `invite-code:${req.ip}`, limit: 20, windowMs: 10 * 60 * 1000 })) {
      fail(429, 'rate_limited', 'Terlalu banyak percobaan. Coba lagi nanti.');
    }
    const code = asString(req.body?.code ?? '', 'code', 80).toUpperCase();
    if (!code) fail(422, 'validation_error', 'Kode undangan wajib diisi.');
    const invitation = get<{ token: string; status: string; expires_at: string | null; survey_id: string; version_id: string }>(
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

publicRouter.post('/public/surveys/:token/responses', (req: AuthedRequest, res: Response) => {
  let auditObject = 'respons';
  try {
    if (!rateLimit({ key: `submit:${req.ip}`, limit: 40, windowMs: 10 * 60 * 1000 })) {
      fail(429, 'rate_limited', 'Terlalu banyak kiriman. Coba lagi nanti.');
    }
    const key = req.get('idempotency-key')?.trim() ?? '';
    if (key.length < 8 || key.length > 128) {
      fail(422, 'idempotency_key_required', 'Header Idempotency-Key wajib diisi (8–128 karakter).');
    }
    const context = resolvePublicContext(pathParam(req, 'token'));
    auditObject = `${context.survey.id} · v${context.version.number}`;
    const consent = requireConsent(context, req.body?.consent_id);
    const answers = parseAnswers(context, req.body?.answers);
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
    const existingAttempt = get<{ response_id: string; payload_hash: string }>(
      'SELECT response_id, payload_hash FROM submission_attempts WHERE scope = ? AND idempotency_key = ?',
      scope,
      key,
    );
    if (existingAttempt) {
      if (existingAttempt.payload_hash !== hash) {
        fail(409, 'idempotency_conflict', 'Kunci pengiriman yang sama dipakai dengan isi berbeda.', { retryable: false });
      }
      res.json({ data: receiptFor(existingAttempt.response_id) });
      return;
    }
    if (!context.canSubmit) {
      fail(409, `submission_${context.state}`, `Formulir tidak dapat menerima kiriman: ${context.state}.`, { state: context.state });
    }
    if (context.kind === 'invitation') {
      const existing = get<{ id: string }>('SELECT id FROM responses WHERE assignment_id = ? LIMIT 1', context.assignment!.id);
      if (existing) fail(409, 'already_submitted', 'Undangan ini sudah digunakan untuk respons final.');
    }
    const responseId = newId('r');
    const respondentId = newId('p');
    const now = nowIso();
    withTx(() => {
      const freshVersion = get<{ status: string }>('SELECT status FROM survey_versions WHERE id = ?', context.version.id);
      if (freshVersion?.status !== 'published') fail(409, 'submission_closed', 'Versi ini sudah ditutup.');
      if (context.kind === 'invitation') {
        const freshInvitation = get<{ status: string; used_at: string | null }>('SELECT status, used_at FROM invitations WHERE id = ?', context.invitation!.id);
        if (!freshInvitation || freshInvitation.status !== 'active' || freshInvitation.used_at) {
          fail(409, 'invitation_inactive', 'Undangan ini sudah tidak aktif.');
        }
      }
      run(
        'INSERT INTO respondents (id, source, external_ref, created_at) VALUES (?, ?, NULL, ?)',
        respondentId,
        context.kind === 'invitation' ? 'invitation' : 'public_link',
        now,
      );
      run(
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
        run(
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
      run('UPDATE consent_records SET response_id = ? WHERE id = ?', responseId, consent.id);
      run(
        'INSERT INTO submission_attempts (id, scope, idempotency_key, payload_hash, response_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        newId('sa'),
        scope,
        key,
        hash,
        responseId,
        now,
      );
      if (context.kind === 'invitation') {
        run("UPDATE invitations SET status = 'used', used_at = ? WHERE id = ?", now, context.invitation!.id);
      }
      run(
        `INSERT INTO integration_events (id, event_id, type, target, status, attempts, at, simulated, response_id, last_error, payload)
         VALUES (?, ?, 'survey.submitted', 'module_13', 'delivered', 1, ?, 1, ?, NULL, NULL)`,
        newId('ie'),
        newId('ev'),
        now,
        responseId,
      );
    });
    audit(req, 'Kirim respons', auditObject, 'berhasil', {
      response_id: responseId,
      version_id: context.version.id,
      kind: context.kind,
    });
    res.status(201).json({ data: receiptFor(responseId) });
  } catch (error) {
    if (error instanceof ApiError && error.status >= 400) {
      audit(req, 'Kirim respons', auditObject, 'ditolak', { code: error.code });
    }
    sendError(res, error);
  }
});

publicRouter.get('/public/surveys/:token/receipt/:responseId', (req: AuthedRequest, res: Response) => {
  try {
    const key = req.get('idempotency-key')?.trim() ?? '';
    if (!key) fail(422, 'idempotency_key_required', 'Header Idempotency-Key diperlukan untuk memulihkan bukti.');
    const context = resolvePublicContext(pathParam(req, 'token'));
    const scope = context.kind === 'invitation' ? `invitation:${context.invitation!.id}` : `public:${context.link!.id}`;
    const attempt = get<{ response_id: string }>(
      'SELECT response_id FROM submission_attempts WHERE scope = ? AND idempotency_key = ?',
      scope,
      key,
    );
    if (!attempt || attempt.response_id !== pathParam(req, 'responseId')) {
      fail(404, 'receipt_not_found', 'Bukti tidak ditemukan untuk konteks ini.');
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ data: receiptFor(attempt.response_id) });
  } catch (error) {
    sendError(res, error);
  }
});

publicRouter.get('/public/policy', (_req: AuthedRequest, res: Response) => {
  try {
    const profiles = all<Record<string, unknown>>('SELECT * FROM profiles ORDER BY id');
    const notices = all<Record<string, unknown>>('SELECT * FROM notices ORDER BY profile_id, effective_date DESC');
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

publicRouter.post('/data-requests', (req: AuthedRequest, res: Response) => {
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
    run(
      `INSERT INTO data_requests (id, type, contact, note, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
      id,
      type,
      contact,
      note || null,
      at,
      at,
    );
    audit(req, 'Permintaan data', id, 'berhasil', { type });
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

