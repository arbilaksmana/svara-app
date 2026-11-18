import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { Response } from 'express';
import { all, get, nowIso, run, withTx } from '../db.ts';
import type { AuthedRequest } from '../security.ts';
import {
  asBoolean,
  asString,
  audit,
  canExport,
  canReadAggregate,
  canReadFreeText,
  canReadIndividual,
  canReadSurveyMetadata,
  csvDocument,
  fail,
  newId,
  parseLimit,
  requireManageSurvey,
  requirePublishedVersion,
  requireSurvey,
  requireVersion,
  sendError,
  sha256Hex,
} from '../http.ts';
import { summaryFor } from '../summary.ts';

type QuestionType = 'likert' | 'short_text' | 'single_choice';

interface VersionDbRow {
  id: string;
  survey_id: string;
  number: number;
  status: string;
  notice_version: string;
  published_at: string | null;
  closed_at: string | null;
}

interface QuestionDbRow {
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
  direction: string | null;
}

interface OptionDbRow {
  id: string;
  question_id: string;
  ord: number;
  label: string;
  value: number | null;
}

interface OptionInput {
  label: string;
  value: number;
}

interface QuestionInput {
  code: string;
  type: QuestionType;
  required: boolean;
  section: string;
  label: string;
  hint: string | null;
  group_code: string | null;
  dimension_code: string | null;
  direction: string | null;
  options: OptionInput[];
}

interface ResponseDbRow {
  id: string;
  survey_id: string;
  version_id: string;
  assignment_id: string | null;
  respondent_id: string;
  collection_mode: string;
  identity_source: string;
  submitted_at: string;
  idempotency_key: string;
}

interface AnswerDbRow {
  response_id: string;
  question_code: string;
  option_id: string | null;
  value: number | null;
  text: string | null;
  skipped: number;
}

export const surveysRouter = Router();

function stringOrNull(value: unknown, field: string, max = 2000): string | null {
  if (value === null || value === undefined || value === '') return null;
  return asString(value, field, max);
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function versionRows(surveyId: string): VersionDbRow[] {
  return all<VersionDbRow>('SELECT * FROM survey_versions WHERE survey_id = ? ORDER BY number', surveyId);
}

function questionRows(versionId: string): QuestionDbRow[] {
  return all<QuestionDbRow>('SELECT * FROM questions WHERE version_id = ? ORDER BY ord, code', versionId);
}

function optionRows(questionId: string): OptionDbRow[] {
  return all<OptionDbRow>('SELECT * FROM question_options WHERE question_id = ? ORDER BY ord', questionId);
}

function serializeQuestion(row: QuestionDbRow) {
  const options = optionRows(row.id);
  return {
    ...row,
    order: row.ord,
    required: row.required === 1,
    option_ids: options.map((option) => option.id),
    options: options.map((option) => ({ ...option, order: option.ord })),
  };
}

function detailFor(surveyId: string) {
  const survey = requireSurvey(surveyId);
  const versions = versionRows(surveyId);
  return {
    survey,
    versions: versions.map((version) => ({
      ...version,
      question_ids: questionRows(version.id).map((question) => question.id),
    })),
    questions: versions.flatMap((version) => questionRows(version.id).map(serializeQuestion)),
  };
}

function parseQuestions(raw: unknown): QuestionInput[] {
  if (!Array.isArray(raw)) fail(422, 'validation_error', 'questions wajib berupa array.');
  return raw.map((item, index) => {
    if (!item || typeof item !== 'object') fail(422, 'validation_error', `Pertanyaan #${index + 1} tidak valid.`);
    const row = item as Record<string, unknown>;
    const type = typeof row.type === 'string' ? row.type : 'likert';
    if (!['likert', 'short_text', 'single_choice'].includes(type)) {
      fail(422, 'validation_error', `Tipe pertanyaan #${index + 1} tidak dikenal.`);
    }
    const codeRaw = typeof row.code === 'string' ? row.code.trim().toUpperCase() : '';
    const code = codeRaw || `Q${String(index + 1).padStart(2, '0')}`;
    const optionsRaw = Array.isArray(row.options) ? row.options : [];
    const options: OptionInput[] = optionsRaw.map((option, optionIndex) => {
      if (!option || typeof option !== 'object') fail(422, 'validation_error', `Opsi ${code} tidak valid.`);
      const opt = option as Record<string, unknown>;
      const label = typeof opt.label === 'string' ? opt.label.trim() : '';
      const value = numberOrNull(opt.value) ?? optionIndex + 1;
      return { label, value };
    });
    return {
      code,
      type: type as QuestionType,
      required: asBoolean(row.required, false),
      section: typeof row.section === 'string' ? row.section.trim() : 'Bagian 1',
      label: typeof row.label === 'string' ? row.label.trim() : '',
      hint: stringOrNull(row.hint, 'hint', 1000),
      group_code: stringOrNull(row.group_code, 'group_code', 120),
      dimension_code: stringOrNull(row.dimension_code, 'dimension_code', 120),
      direction: stringOrNull(row.direction, 'direction', 20),
      options,
    };
  });
}

function validateForPublish(title: string, purpose: string, questions: QuestionInput[]): string[] {
  const errors: string[] = [];
  if (!title.trim()) errors.push('Judul survei wajib diisi.');
  if (!purpose.trim()) errors.push('Tujuan survei wajib diisi.');
  if (questions.length === 0) errors.push('Minimal satu pertanyaan diperlukan.');
  const codes = new Set<string>();
  for (const question of questions) {
    if (!question.label.trim()) errors.push(`Label pertanyaan ${question.code} wajib diisi.`);
    if (!question.section.trim()) errors.push(`Bagian pertanyaan ${question.code} wajib diisi.`);
    if (codes.has(question.code)) errors.push(`Kode pertanyaan ${question.code} duplikat dalam versi ini.`);
    codes.add(question.code);
    if (question.type === 'short_text' && question.options.length > 0) {
      errors.push(`Pertanyaan teks ${question.code} tidak boleh memiliki opsi.`);
    }
    if (question.type !== 'short_text' && question.options.length < 2) {
      errors.push(`Pertanyaan ${question.code} memerlukan minimal dua opsi.`);
    }
    const values = new Set<number>();
    for (const option of question.options) {
      if (!option.label.trim()) errors.push(`Label opsi pada ${question.code} wajib diisi.`);
      if (!Number.isFinite(option.value)) errors.push(`Nilai opsi pada ${question.code} tidak valid.`);
      if (values.has(option.value)) errors.push(`Nilai opsi ${option.value} duplikat pada ${question.code}.`);
      values.add(option.value);
    }
  }
  return errors;
}

function writeDraftQuestions(versionId: string, questions: QuestionInput[]): void {
  run('DELETE FROM questions WHERE version_id = ?', versionId);
  questions.forEach((question, index) => {
    const questionId = newId('q');
    run(
      `INSERT INTO questions (id, version_id, code, ord, type, required, section, label, hint, group_code, dimension_code, direction)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      questionId,
      versionId,
      question.code,
      index + 1,
      question.type,
      question.required ? 1 : 0,
      question.section || 'Bagian 1',
      question.label,
      question.hint,
      question.group_code,
      question.dimension_code,
      question.direction,
    );
    question.options.forEach((option, optionIndex) => {
      run(
        'INSERT INTO question_options (id, question_id, ord, label, value) VALUES (?, ?, ?, ?, ?)',
        newId('opt'),
        questionId,
        optionIndex + 1,
        option.label,
        option.value,
      );
    });
  });
}

function createDraft(surveyId: string, noticeVersion: string): VersionDbRow {
  const max = get<{ number: number | null }>('SELECT MAX(number) AS number FROM survey_versions WHERE survey_id = ?', surveyId)?.number ?? 0;
  const id = newId('v');
  const now = nowIso();
  run(
    'INSERT INTO survey_versions (id, survey_id, number, status, notice_version, published_at, closed_at) VALUES (?, ?, ?, ?, ?, NULL, NULL)',
    id,
    surveyId,
    max + 1,
    'draft',
    noticeVersion,
  );
  run('UPDATE surveys SET current_version_id = ?, updated_at = ? WHERE id = ?', id, now, surveyId);
  return { id, survey_id: surveyId, number: max + 1, status: 'draft', notice_version: noticeVersion, published_at: null, closed_at: null };
}

function currentOrDraft(surveyId: string): { draft: VersionDbRow | undefined; published: VersionDbRow | undefined } {
  const versions = versionRows(surveyId);
  return {
    draft: versions.find((version) => version.status === 'draft'),
    published: versions.find((version) => version.status === 'published'),
  };
}

surveysRouter.get('/surveys', (req: AuthedRequest, res: Response) => {
  try {
    if (!req.account) fail(401, 'unauthenticated', 'Masuk kembali untuk melanjutkan.');
    const rows =
      req.account.role === 'creator'
        ? all<Record<string, unknown>>('SELECT * FROM surveys WHERE owner_id = ? ORDER BY updated_at DESC', req.account.id)
        : req.account.role === 'super_admin'
          ? all<Record<string, unknown>>('SELECT * FROM surveys ORDER BY updated_at DESC')
          : all<Record<string, unknown>>(
              'SELECT DISTINCT s.* FROM surveys s JOIN access_grants g ON g.survey_id = s.id WHERE g.account_id = ? ORDER BY s.updated_at DESC',
              req.account.id,
            );
    res.json({ data: rows });
  } catch (error) {
    sendError(res, error);
  }
});

surveysRouter.post('/surveys', (req: AuthedRequest, res: Response) => {
  try {
    if (!req.account) fail(401, 'unauthenticated', 'Masuk kembali untuk melanjutkan.');
    if (req.account.role !== 'creator') fail(403, 'forbidden_role', 'Hanya pembuat survei yang dapat membuat survei.');
    const title = typeof req.body?.title === 'string' && req.body.title.trim() ? req.body.title.trim() : 'Survei baru';
    const profileId = typeof req.body?.profile_id === 'string' ? req.body.profile_id : 'p_smk';
    const profile = get<{ id: string; notice_version: string }>('SELECT id, notice_version FROM profiles WHERE id = ?', profileId);
    if (!profile) fail(422, 'profile_not_found', 'Profil deployment tidak dikenal.');
    const id = newId('s');
    const now = nowIso();
    withTx(() => {
      run(
        `INSERT INTO surveys (id, owner_id, profile_id, title, purpose, object_label, instructions, status, created_at, updated_at, current_version_id)
         VALUES (?, ?, ?, ?, '', '', '', 'draft', ?, ?, NULL)`,
        id,
        req.account!.id,
        profile.id,
        title,
        now,
        now,
      );
      run('INSERT INTO survey_settings (survey_id, allow_results, allow_individual) VALUES (?, 1, 0)', id);
      createDraft(id, profile.notice_version);
    });
    audit(req, 'Buat survei', id, 'berhasil');
    res.status(201).json({ data: detailFor(id) });
  } catch (error) {
    sendError(res, error);
  }
});

surveysRouter.get('/surveys/:id', (req: AuthedRequest, res: Response) => {
  try {
    if (!req.account) fail(401, 'unauthenticated', 'Masuk kembali untuk melanjutkan.');
    const survey = requireSurvey(req.params.id);
    if (!canReadSurveyMetadata(req.account, survey)) fail(403, 'forbidden_survey', 'Anda tidak memiliki akses ke survei ini.');
    res.json({ data: detailFor(survey.id) });
  } catch (error) {
    sendError(res, error);
  }
});

surveysRouter.put('/surveys/:id', (req: AuthedRequest, res: Response) => {
  try {
    if (!req.account) fail(401, 'unauthenticated', 'Masuk kembali untuk melanjutkan.');
    const survey = requireManageSurvey(req.account, req.params.id);
    const title = asString(req.body?.title ?? '', 'title', 200);
    const purpose = asString(req.body?.purpose ?? '', 'purpose', 2000);
    const objectLabel = asString(req.body?.object_label ?? '', 'object_label', 200);
    const instructions = asString(req.body?.instructions ?? '', 'instructions', 2000);
    const questions = parseQuestions(req.body?.questions ?? []);
    const profile = get<{ notice_version: string }>('SELECT notice_version FROM profiles WHERE id = ?', survey.profile_id);
    withTx(() => {
      const { draft } = currentOrDraft(survey.id);
      const target = draft ?? createDraft(survey.id, profile?.notice_version ?? '1.0');
      writeDraftQuestions(target.id, questions);
      const status = survey.status === 'archived' ? 'draft' : survey.status === 'published' ? 'published' : 'draft';
      run(
        'UPDATE surveys SET title = ?, purpose = ?, object_label = ?, instructions = ?, status = ?, updated_at = ?, current_version_id = ? WHERE id = ?',
        title,
        purpose,
        objectLabel,
        instructions,
        status,
        nowIso(),
        target.id,
        survey.id,
      );
    });
    audit(req, 'Simpan draf', survey.id, 'berhasil');
    res.json({ data: detailFor(survey.id) });
  } catch (error) {
    sendError(res, error);
  }
});

surveysRouter.post('/surveys/:id/duplicate', (req: AuthedRequest, res: Response) => {
  try {
    if (!req.account) fail(401, 'unauthenticated', 'Masuk kembali untuk melanjutkan.');
    const source = requireManageSurvey(req.account, req.params.id);
    const sourceVersion = source.current_version_id ? requireVersion(source.current_version_id) : versionRows(source.id)[0];
    if (!sourceVersion) fail(409, 'no_version', 'Survei sumber belum memiliki versi.');
    const id = newId('s');
    const now = nowIso();
    withTx(() => {
      run(
        `INSERT INTO surveys (id, owner_id, profile_id, title, purpose, object_label, instructions, status, created_at, updated_at, current_version_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, NULL)`,
        id,
        req.account!.id,
        source.profile_id,
        `${source.title} (salinan)`,
        source.purpose,
        source.object_label,
        source.instructions,
        now,
        now,
      );
      run('INSERT INTO survey_settings (survey_id, allow_results, allow_individual) VALUES (?, 1, 0)', id);
      const draft = createDraft(id, sourceVersion.notice_version);
      const questions = questionRows(sourceVersion.id);
      writeDraftQuestions(
        draft.id,
        questions.map((question) => ({
          code: question.code,
          type: question.type,
          required: question.required === 1,
          section: question.section,
          label: question.label,
          hint: question.hint,
          group_code: question.group_code,
          dimension_code: question.dimension_code,
          direction: question.direction,
          options: optionRows(question.id).map((option) => ({ label: option.label, value: option.value ?? 0 })),
        })),
      );
    });
    audit(req, 'Salin survei', id, 'berhasil', { source: source.id });
    res.status(201).json({ data: detailFor(id) });
  } catch (error) {
    sendError(res, error);
  }
});

surveysRouter.post('/surveys/:id/publish', (req: AuthedRequest, res: Response) => {
  try {
    if (!req.account) fail(401, 'unauthenticated', 'Masuk kembali untuk melanjutkan.');
    const survey = requireManageSurvey(req.account, req.params.id);
    const { draft } = currentOrDraft(survey.id);
    if (!draft) fail(409, 'no_draft', 'Tidak ada draf untuk diterbitkan.');
    const questions = questionRows(draft.id).map((question) => ({
      code: question.code,
      type: question.type,
      required: question.required === 1,
      section: question.section,
      label: question.label,
      hint: question.hint,
      group_code: question.group_code,
      dimension_code: question.dimension_code,
      direction: question.direction,
      options: optionRows(question.id).map((option) => ({ label: option.label, value: option.value ?? 0 })),
    }));
    const errors = validateForPublish(survey.title, survey.purpose, questions);
    if (errors.length > 0) fail(422, 'publish_blocked', 'Draf belum memenuhi syarat publikasi.', { errors });
    const now = nowIso();
    let publicToken = '';
    withTx(() => {
      run('UPDATE survey_versions SET status = ?, published_at = ? WHERE id = ?', 'published', now, draft.id);
      run('UPDATE surveys SET status = ?, current_version_id = ?, updated_at = ? WHERE id = ?', 'published', draft.id, now, survey.id);
      const existing = get<{ token: string }>('SELECT token FROM public_links WHERE survey_id = ? AND version_id = ? LIMIT 1', survey.id, draft.id);
      if (existing) {
        publicToken = existing.token;
      } else {
        publicToken = `pl_${randomBytes(12).toString('base64url')}`;
        run(
          `INSERT INTO public_links (id, survey_id, version_id, token, token_hash, label, status, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'active', NULL, ?)`,
          newId('pl'),
          survey.id,
          draft.id,
          publicToken,
          sha256Hex(publicToken),
          `Tautan umum · ${survey.title}`,
          now,
        );
      }
    });
    audit(req, 'Publikasi versi', `${survey.id} · v${draft.number}`, 'berhasil');
    res.json({
      data: {
        version: versionRows(survey.id).find((version) => version.id === draft.id),
        publicLink: { token: publicToken, url: `/s/${publicToken}` },
        detail: detailFor(survey.id),
      },
    });
  } catch (error) {
    sendError(res, error);
  }
});

surveysRouter.post('/surveys/:id/close', (req: AuthedRequest, res: Response) => {
  try {
    if (!req.account) fail(401, 'unauthenticated', 'Masuk kembali untuk melanjutkan.');
    const survey = requireManageSurvey(req.account, req.params.id);
    const published = versionRows(survey.id).find((version) => version.status === 'published');
    if (!published) fail(409, 'no_published_version', 'Tidak ada versi terbit untuk ditutup.');
    const now = nowIso();
    withTx(() => {
      run('UPDATE survey_versions SET status = ?, closed_at = ? WHERE id = ?', 'closed', now, published.id);
      run('UPDATE surveys SET status = ?, updated_at = ? WHERE id = ?', 'closed', now, survey.id);
      run("UPDATE public_links SET status = 'closed' WHERE version_id = ?", published.id);
    });
    audit(req, 'Tutup versi', `${survey.id} · v${published.number}`, 'berhasil');
    res.json({ data: detailFor(survey.id) });
  } catch (error) {
    sendError(res, error);
  }
});

surveysRouter.post('/surveys/:id/archive', (req: AuthedRequest, res: Response) => {
  try {
    if (!req.account) fail(401, 'unauthenticated', 'Masuk kembali untuk melanjutkan.');
    const survey = requireManageSurvey(req.account, req.params.id);
    const now = nowIso();
    withTx(() => {
      run('UPDATE surveys SET status = ?, updated_at = ? WHERE id = ?', 'archived', now, survey.id);
      run("UPDATE survey_versions SET status = 'closed', closed_at = COALESCE(closed_at, ?) WHERE survey_id = ? AND status IN ('draft','published')", now, survey.id);
      run("UPDATE public_links SET status = 'closed' WHERE survey_id = ?", survey.id);
    });
    audit(req, 'Arsipkan survei', survey.id, 'berhasil');
    res.json({ data: detailFor(survey.id) });
  } catch (error) {
    sendError(res, error);
  }
});

surveysRouter.post('/surveys/:id/invitations', (req: AuthedRequest, res: Response) => {
  try {
    if (!req.account) fail(401, 'unauthenticated', 'Masuk kembali untuk melanjutkan.');
    const survey = requireManageSurvey(req.account, req.params.id);
    const published = versionRows(survey.id).find((version) => version.status === 'published');
    if (!published) fail(409, 'no_published_version', 'Terbitkan versi sebelum membuat undangan.');
    const label = asString(req.body?.label ?? '', 'label', 200);
    if (!label) fail(422, 'validation_error', 'Label penugasan wajib diisi.');
    const expiresAt = typeof req.body?.expires_at === 'string' && req.body.expires_at ? `${req.body.expires_at}T23:59:59.000Z` : null;
    if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
      fail(422, 'validation_error', 'Batas waktu undangan harus di masa depan.');
    }
    const assignmentId = newId('a');
    const invitationId = newId('inv');
    const code = `UND-${randomBytes(3).toString('hex').toUpperCase()}`;
    const token = randomBytes(18).toString('base64url');
    withTx(() => {
      run(
        'INSERT INTO assignments (id, survey_id, version_id, label, participant_ref) VALUES (?, ?, ?, ?, ?)',
        assignmentId,
        survey.id,
        published.id,
        label,
        `lokal-${randomBytes(3).toString('hex')}`,
      );
      run(
        `INSERT INTO invitations (id, assignment_id, survey_id, version_id, code, token, token_hash, status, expires_at, used_at, revoked_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, NULL, NULL, ?)`,
        invitationId,
        assignmentId,
        survey.id,
        published.id,
        code,
        token,
        sha256Hex(token),
        expiresAt,
        nowIso(),
      );
    });
    audit(req, 'Buat undangan', `${survey.id} · ${code}`, 'berhasil');
    res.status(201).json({
      data: {
        invitation: { id: invitationId, code, assignment_id: assignmentId, version_id: published.id, status: 'active', expires_at: expiresAt },
        token,
        url: `/s/${token}`,
      },
    });
  } catch (error) {
    sendError(res, error);
  }
});

surveysRouter.post('/invitations/:id/revoke', (req: AuthedRequest, res: Response) => {
  try {
    if (!req.account) fail(401, 'unauthenticated', 'Masuk kembali untuk melanjutkan.');
    const invitation = get<{ id: string; survey_id: string; code: string }>('SELECT id, survey_id, code FROM invitations WHERE id = ?', req.params.id);
    if (!invitation) fail(404, 'invitation_not_found', 'Undangan tidak ditemukan.');
    requireManageSurvey(req.account, invitation.survey_id);
    run("UPDATE invitations SET status = 'revoked', revoked_at = ? WHERE id = ?", nowIso(), invitation.id);
    audit(req, 'Cabut undangan', `${invitation.survey_id} · ${invitation.code}`, 'berhasil');
    res.json({ data: { ok: true } });
  } catch (error) {
    sendError(res, error);
  }
});

surveysRouter.get('/surveys/:id/settings', (req: AuthedRequest, res: Response) => {
  try {
    if (!req.account) fail(401, 'unauthenticated', 'Masuk kembali untuk melanjutkan.');
    const survey = requireSurvey(req.params.id);
    if (!canReadSurveyMetadata(req.account, survey)) fail(403, 'forbidden_survey', 'Anda tidak memiliki akses ke survei ini.');
    const settings = get<{ allow_results: number; allow_individual: number }>(
      'SELECT allow_results, allow_individual FROM survey_settings WHERE survey_id = ?',
      survey.id,
    );
    res.json({ data: { allowResults: Boolean(settings?.allow_results), allowIndividual: Boolean(settings?.allow_individual) } });
  } catch (error) {
    sendError(res, error);
  }
});

surveysRouter.put('/surveys/:id/settings', (req: AuthedRequest, res: Response) => {
  try {
    if (!req.account) fail(401, 'unauthenticated', 'Masuk kembali untuk melanjutkan.');
    const survey = requireManageSurvey(req.account, req.params.id);
    const allowResults = asBoolean(req.body?.allowResults, true);
    const allowIndividual = asBoolean(req.body?.allowIndividual, false);
    run(
      `INSERT INTO survey_settings (survey_id, allow_results, allow_individual) VALUES (?, ?, ?)
       ON CONFLICT(survey_id) DO UPDATE SET allow_results = excluded.allow_results, allow_individual = excluded.allow_individual`,
      survey.id,
      allowResults ? 1 : 0,
      allowIndividual ? 1 : 0,
    );
    audit(req, 'Ubah pengaturan hasil', survey.id, 'berhasil', { allowResults, allowIndividual });
    res.json({ data: { allowResults, allowIndividual } });
  } catch (error) {
    sendError(res, error);
  }
});

surveysRouter.get('/surveys/:id/summary', (req: AuthedRequest, res: Response) => {
  try {
    if (!req.account) fail(401, 'unauthenticated', 'Masuk kembali untuk melanjutkan.');
    const survey = requireSurvey(req.params.id);
    if (!canReadAggregate(req.account, survey)) fail(403, 'forbidden_summary', 'Ringkasan tidak tersedia untuk akun ini.');
    const requested = typeof req.query.version === 'string' ? req.query.version : '';
    const version = requested ? requireVersion(requested) : requirePublishedVersion(survey.id);
    if (version.survey_id !== survey.id) fail(403, 'forbidden_version', 'Versi bukan milik survei ini.');
    res.json({ data: summaryFor(version.id) });
  } catch (error) {
    sendError(res, error);
  }
});

function questionsForExport(versionId: string): QuestionDbRow[] {
  return questionRows(versionId);
}

function answerRows(versionIds: string[]): Map<string, AnswerDbRow[]> {
  if (versionIds.length === 0) return new Map();
  const rows = all<AnswerDbRow>(
    `SELECT a.response_id, a.question_code, a.option_id, a.value, a.text, a.skipped
       FROM answers a JOIN responses r ON r.id = a.response_id
      WHERE r.version_id IN (${versionIds.map(() => '?').join(',')})`,
    ...versionIds,
  );
  const map = new Map<string, AnswerDbRow[]>();
  for (const row of rows) {
    const list = map.get(row.response_id) ?? [];
    list.push(row);
    map.set(row.response_id, list);
  }
  return map;
}

surveysRouter.get('/surveys/:id/export', (req: AuthedRequest, res: Response) => {
  try {
    if (!req.account) fail(401, 'unauthenticated', 'Masuk kembali untuk melanjutkan.');
    const survey = requireSurvey(req.params.id);
    if (!canExport(req.account, survey)) {
      audit(req, 'Ekspor hasil', survey.id, 'ditolak', { format: req.query.format ?? 'csv' });
      fail(403, 'forbidden_export', 'Akun ini tidak memiliki izin ekspor pada survei ini.');
    }
    const requested = typeof req.query.version === 'string' ? req.query.version : '';
    const version = requested ? requireVersion(requested) : requirePublishedVersion(survey.id);
    if (version.survey_id !== survey.id) fail(403, 'forbidden_version', 'Versi bukan milik survei ini.');
    const format = req.query.format === 'codebook' ? 'codebook' : 'csv';
    const questions = questionsForExport(version.id);
    const includeText = canReadFreeText(req.account, survey);
    if (format === 'codebook') {
      const codebookQuestions = includeText
        ? questions
        : questions.filter((question) => question.type !== 'short_text');
      const rows: unknown[][] = [
        ['survey_version', 'code', 'label', 'type', 'required', 'section', 'group_code', 'dimension_code', 'direction', 'value', 'value_label', 'empty_meaning'],
      ];
      for (const question of codebookQuestions) {
        const options = optionRows(question.id);
        if (options.length === 0) {
          rows.push([version.number, question.code, question.label, question.type, question.required, question.section, question.group_code, question.dimension_code, question.direction, '', '', includeText ? 'Tidak dijawab / kosong' : 'Tidak dijawab / kosong (teks dibatasi izin)']);
        } else {
          for (const option of options) {
            rows.push([version.number, question.code, question.label, question.type, question.required, question.section, question.group_code, question.dimension_code, question.direction, option.value, option.label, 'Tidak dijawab / kosong']);
          }
        }
      }
      audit(req, 'Ekspor kodebook', `${survey.id} · v${version.number}`, 'berhasil');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="kodebook-${survey.id}-v${version.number}.csv"`);
      res.send(csvDocument(rows));
      return;
    }
    const responses = all<ResponseDbRow>(
      'SELECT * FROM responses WHERE survey_id = ? AND version_id = ? ORDER BY submitted_at, id',
      survey.id,
      version.id,
    );
    const answersByResponse = answerRows([version.id]);
    const textQuestions = new Set(questions.filter((question) => question.type === 'short_text').map((question) => question.code));
    const exportQuestions = includeText ? questions : questions.filter((question) => !textQuestions.has(question.code));
    const header = [
      'response_id',
      'respondent_id',
      'survey_id',
      'survey_version',
      'assignment_id',
      'collection_mode',
      'identity_source',
      'submitted_at',
      ...exportQuestions.map((question) => question.code),
    ];
    const rows = responses.map((response) => {
      const answers = answersByResponse.get(response.id) ?? [];
      const byCode = new Map(answers.map((answer) => [answer.question_code, answer]));
      return [
        response.id,
        response.respondent_id,
        response.survey_id,
        version.number,
        response.assignment_id ?? '',
        response.collection_mode,
        response.identity_source,
        response.submitted_at,
        ...exportQuestions.map((question) => {
          const answer = byCode.get(question.code);
          if (!answer || answer.skipped === 1) return '';
          if (question.type === 'short_text') return includeText ? answer.text ?? '' : '';
          return answer.value ?? '';
        }),
      ];
    });
    audit(req, 'Ekspor CSV', `${survey.id} · v${version.number}`, 'berhasil', { rows: rows.length, includeText });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="hasil-${survey.id}-v${version.number}.csv"`);
    res.send(csvDocument([header, ...rows]));
  } catch (error) {
    sendError(res, error);
  }
});

surveysRouter.get('/surveys/:id/responses', (req: AuthedRequest, res: Response) => {
  try {
    if (!req.account) fail(401, 'unauthenticated', 'Masuk kembali untuk melanjutkan.');
    const survey = requireSurvey(req.params.id);
    if (!canReadIndividual(req.account, survey)) {
      audit(req, 'Baca jawaban individual', survey.id, 'ditolak');
      fail(403, 'forbidden_individual', 'Akun ini tidak memiliki izin membaca jawaban individual.');
    }
    const requested = typeof req.query.version === 'string' ? req.query.version : '';
    const version = requested ? requireVersion(requested) : requirePublishedVersion(survey.id);
    if (version.survey_id !== survey.id) fail(403, 'forbidden_version', 'Versi bukan milik survei ini.');
    const includeText = canReadFreeText(req.account, survey);
    const rows = all<ResponseDbRow>(
      `SELECT * FROM responses WHERE survey_id = ? AND version_id = ? ORDER BY submitted_at DESC LIMIT ? OFFSET ?`,
      survey.id,
      version.id,
      parseLimit(req.query.limit),
      Number.parseInt(typeof req.query.offset === 'string' ? req.query.offset : '0', 10) || 0,
    );
    const answersByResponse = answerRows([version.id]);
    audit(req, 'Baca jawaban individual', `${survey.id} · v${version.number}`, 'berhasil', { count: rows.length, includeText });
    res.json({
      data: rows.map((response) => ({
        ...response,
        answers: (answersByResponse.get(response.id) ?? []).map((answer) => ({
          question_code: answer.question_code,
          option_id: answer.option_id,
          value: answer.value,
          text: includeText ? answer.text : null,
          skipped: answer.skipped === 1,
        })),
      })),
    });
  } catch (error) {
    sendError(res, error);
  }
});

