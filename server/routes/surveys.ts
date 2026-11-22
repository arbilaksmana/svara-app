import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { Response } from 'express';
import { all, get, nowIso, run, withTx } from '../db.ts';
import type { AuthedRequest } from '../security.ts';
import {
  accessibleSurveys,
  asBoolean,
  asString,
  audit,
  canExport,
  canExportIndividual,
  canReadAggregate,
  canReadFreeText,
  canReadIndividual,
  canReadSurveyMetadata,
  CSV_BOM,
  CSV_EOL,
  csvDocument,
  csvLine,
  fail,
  newId,
  noticeVersionFor,
  parseLimit,
  requireManageSurvey,
  requirePublishedVersion,
  requireSurvey,
  requireVersion,
  sendError,
  sha256Hex,
  surveyProfileFor,
} from '../http.ts';
import { summaryFor } from '../summary.ts';
import { CONTINUABLE_CLOSE_REASONS, requirePublishableNotice } from './public.ts';

type QuestionType = 'likert' | 'short_text' | 'single_choice';

type ExportFormat = 'csv' | 'codebook';

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

/**
 * Header Accept permintaan apa adanya (dipotong) untuk audit ekspor. Penerima dan tujuan akhir berkas
 * setelah diunduh tidak diketahui server, jadi tidak dicatat seolah-olah diketahui.
 */
function requestAccept(req: AuthedRequest): string | null {
  return req.get('accept')?.slice(0, 200) ?? null;
}

/** Respons per batch ekspor CSV. EXPORT_BATCH_SIZE hanya bisa menurunkannya (test memaksa banyak batch). */
const EXPORT_BATCH_SIZE = Math.min(500, Math.max(1, Number.parseInt(process.env.EXPORT_BATCH_SIZE ?? '', 10) || 500));

function stringOrNull(value: unknown, field: string, max = 2000): string | null {
  if (value === null || value === undefined || value === '') return null;
  return asString(value, field, max);
}

/** `YYYY-MM-DD`, atau tanggal-waktu ISO-8601 yang wajib berzona (`Z`/`±hh:mm`). */
const INVITATION_EXPIRY = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-](\d{2}):(\d{2})))?$/;
const INVITATION_EXPIRY_ERROR = 'Batas waktu undangan harus tanggal YYYY-MM-DD atau tanggal-waktu ISO-8601 dengan zona waktu.';

/**
 * Batas waktu undangan dinormalisasi ke ISO UTC; tanggal saja berarti akhir hari itu (UTC).
 * Kosong = tanpa batas. Nilai lain yang bukan tanggal nyata di masa depan ditolak 422, karena
 * Date.parse memberi NaN (tidak pernah kedaluwarsa) atau menggulirkan tanggal yang tidak ada
 * (2026-02-30 → 2 Maret, 24:00 → hari berikutnya).
 */
function invitationExpiresAt(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const value = typeof raw === 'string' ? raw.trim() : '';
  const match = INVITATION_EXPIRY.exec(value);
  if (!match) fail(422, 'validation_error', INVITATION_EXPIRY_ERROR, { field: 'expires_at' });
  const part = (index: number) => Number(match[index] ?? 0);
  const day = new Date(Date.UTC(part(1), part(2) - 1, part(3)));
  const real =
    day.getUTCFullYear() === part(1) && day.getUTCMonth() === part(2) - 1 && day.getUTCDate() === part(3) &&
    part(4) <= 23 && part(5) <= 59 && part(6) <= 59 && part(7) <= 23 && part(8) <= 59;
  const at = Date.parse(match[4] === undefined ? `${value}T23:59:59.000Z` : value);
  if (!real || Number.isNaN(at)) fail(422, 'validation_error', INVITATION_EXPIRY_ERROR, { field: 'expires_at' });
  if (at <= Date.now()) fail(422, 'validation_error', 'Batas waktu undangan harus di masa depan.', { field: 'expires_at' });
  return new Date(at).toISOString();
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function versionRows(surveyId: string): Promise<VersionDbRow[]> {
  return all<VersionDbRow>('SELECT * FROM survey_versions WHERE survey_id = ? ORDER BY number', surveyId);
}

async function questionRows(versionId: string): Promise<QuestionDbRow[]> {
  return all<QuestionDbRow>('SELECT * FROM questions WHERE version_id = ? ORDER BY ord, code', versionId);
}

async function optionRows(questionId: string): Promise<OptionDbRow[]> {
  return all<OptionDbRow>('SELECT * FROM question_options WHERE question_id = ? ORDER BY ord', questionId);
}

interface SerializedQuestion extends Omit<QuestionDbRow, 'required'> {
  order: number;
  required: boolean;
  option_ids: string[];
  options: Array<OptionDbRow & { order: number }>;
}

async function serializeQuestion(row: QuestionDbRow): Promise<SerializedQuestion> {
  const options = await optionRows(row.id);
  return {
    ...row,
    order: row.ord,
    required: row.required === 1,
    option_ids: options.map((option) => option.id),
    options: options.map((option) => ({ ...option, order: option.ord })),
  };
}

async function detailFor(surveyId: string) {
  const survey = await requireSurvey(surveyId);
  const versions = await versionRows(surveyId);
  const versionDetails: Array<VersionDbRow & { question_ids: string[] }> = [];
  const questions: SerializedQuestion[] = [];
  for (const version of versions) {
    const rows = await questionRows(version.id);
    versionDetails.push({ ...version, question_ids: rows.map((question) => question.id) });
    for (const row of rows) questions.push(await serializeQuestion(row));
  }
  return { survey, versions: versionDetails, questions, profile: await surveyProfileFor(survey) };
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

async function questionInputsFor(versionId: string): Promise<QuestionInput[]> {
  const rows = await questionRows(versionId);
  return parseQuestions(await Promise.all(rows.map(serializeQuestion)));
}

function instrumentSignature(questions: QuestionInput[]): string {
  return JSON.stringify(questions.map((question) => JSON.stringify([
    question.code,
    question.type,
    question.label,
    question.required,
    question.options.map(({ label, value }) => JSON.stringify([label, value])).sort(),
  ])).sort());
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

async function writeDraftQuestions(versionId: string, questions: QuestionInput[]): Promise<void> {
  await run('DELETE FROM questions WHERE version_id = ?', versionId);
  for (const [index, question] of questions.entries()) {
    const questionId = newId('q');
    await run(
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
    for (const [optionIndex, option] of question.options.entries()) {
      await run(
        'INSERT INTO question_options (id, question_id, ord, label, value) VALUES (?, ?, ?, ?, ?)',
        newId('opt'),
        questionId,
        optionIndex + 1,
        option.label,
        option.value,
      );
    }
  }
}

async function createDraft(surveyId: string, noticeVersion: string): Promise<VersionDbRow> {
  // Kunci baris survei agar dua penyimpanan serentak tidak membuat nomor versi yang sama.
  await get<{ id: string }>('SELECT id FROM surveys WHERE id = ? FOR UPDATE', surveyId);
  const max =
    (await get<{ number: number | null }>('SELECT MAX(number) AS number FROM survey_versions WHERE survey_id = ?', surveyId))
      ?.number ?? 0;
  const id = newId('v');
  const now = nowIso();
  await run(
    'INSERT INTO survey_versions (id, survey_id, number, status, notice_version, published_at, closed_at) VALUES (?, ?, ?, ?, ?, NULL, NULL)',
    id,
    surveyId,
    max + 1,
    'draft',
    noticeVersion,
  );
  await run('UPDATE surveys SET current_version_id = ?, updated_at = ? WHERE id = ?', id, now, surveyId);
  return {
    id,
    survey_id: surveyId,
    number: max + 1,
    status: 'draft',
    notice_version: noticeVersion,
    published_at: null,
    closed_at: null,
  };
}

async function currentOrDraft(
  surveyId: string,
): Promise<{ draft: VersionDbRow | undefined; published: VersionDbRow | undefined }> {
  const versions = await versionRows(surveyId);
  return {
    draft: versions.find((version) => version.status === 'draft'),
    published: versions.find((version) => version.status === 'published'),
  };
}

surveysRouter.get('/surveys', async (req: AuthedRequest, res: Response) => {
  try {
    if (!req.account) fail(401, 'unauthenticated', 'Masuk kembali untuk melanjutkan.');
    res.json({ data: await accessibleSurveys(req.account) });
  } catch (error) {
    sendError(res, error);
  }
});

surveysRouter.post('/surveys', async (req: AuthedRequest, res: Response) => {
  try {
    if (!req.account) fail(401, 'unauthenticated', 'Masuk kembali untuk melanjutkan.');
    if (req.account.role !== 'creator') fail(403, 'forbidden_role', 'Hanya pembuat survei yang dapat membuat survei.');
    const title = typeof req.body?.title === 'string' && req.body.title.trim() ? req.body.title.trim() : 'Survei baru';
    // owner_scope menentukan siapa pemilik lingkup survei, bukan sekadar label.
    const rawScope = req.body?.owner_scope;
    if (rawScope !== undefined && rawScope !== 'individual' && rawScope !== 'organization') {
      fail(422, 'validation_error', "owner_scope harus 'individual' atau 'organization'.");
    }
    const ownerScope: 'individual' | 'organization' = rawScope === 'organization' ? 'organization' : 'individual';
    if (ownerScope === 'organization' && !req.account.organization_id) {
      fail(403, 'forbidden_scope', 'Akun ini tidak terikat organisasi.');
    }
    const organizationId = ownerScope === 'organization' ? req.account.organization_id : null;
    const requestedProfileId = typeof req.body?.profile_id === 'string' && req.body.profile_id
      ? req.body.profile_id
      : null;
    const profile = await get<{ id: string }>(
      'SELECT id FROM profiles WHERE id = ?',
      requestedProfileId ?? 'p_smk',
    ) ?? (requestedProfileId ? undefined : await get<{ id: string }>('SELECT id FROM profiles ORDER BY id LIMIT 1'));
    if (!profile) {
      fail(409, 'profile_missing', 'Profil deployment belum dikonfigurasi. Seed data profil terlebih dahulu.');
    }
    // notice_version tidak diambil dari profiles: sumbernya mengikuti owner_scope.
    const notice = await noticeVersionFor(organizationId);
    const id = newId('s');
    const now = nowIso();
    await withTx(async () => {
      await run(
        `INSERT INTO surveys (id, owner_id, profile_id, title, purpose, object_label, instructions, status, created_at, updated_at, current_version_id, organization_id)
         VALUES (?, ?, ?, ?, '', '', '', 'draft', ?, ?, NULL, ?)`,
        id,
        req.account!.id,
        profile.id,
        title,
        now,
        now,
        organizationId,
      );
      await run('INSERT INTO survey_settings (survey_id, allow_results, allow_individual) VALUES (?, 1, 0)', id);
      await createDraft(id, notice.notice_version);
    });
    await audit(req, 'Buat survei', id, 'berhasil', { owner_scope: ownerScope, notice_source: notice.source });
    res.status(201).json({ data: await detailFor(id) });
  } catch (error) {
    sendError(res, error);
  }
});

surveysRouter.get('/surveys/:id', async (req: AuthedRequest, res: Response) => {
  try {
    if (!req.account) fail(401, 'unauthenticated', 'Masuk kembali untuk melanjutkan.');
    const survey = await requireSurvey(req.params.id);
    if (!(await canReadSurveyMetadata(req.account, survey))) {
      fail(403, 'forbidden_survey', 'Anda tidak memiliki akses ke survei ini.');
    }
    res.json({ data: await detailFor(survey.id) });
  } catch (error) {
    sendError(res, error);
  }
});

surveysRouter.put('/surveys/:id', async (req: AuthedRequest, res: Response) => {
  try {
    if (!req.account) fail(401, 'unauthenticated', 'Masuk kembali untuk melanjutkan.');
    const survey = await requireManageSurvey(req.account, req.params.id);
    const title = asString(req.body?.title ?? '', 'title', 200);
    const purpose = asString(req.body?.purpose ?? '', 'purpose', 2000);
    const objectLabel = asString(req.body?.object_label ?? '', 'object_label', 200);
    const instructions = asString(req.body?.instructions ?? '', 'instructions', 2000);
    const questions = parseQuestions(req.body?.questions ?? []);
    const notice = await noticeVersionFor(survey.organization_id);
    const preview = req.query.preview === 'true';
    const instrumentChange = await withTx(async () => {
      await get<{ id: string }>('SELECT id FROM surveys WHERE id = ? FOR UPDATE', survey.id);
      const versions = await versionRows(survey.id);
      const draft = versions.find((version) => version.status === 'draft');
      // Versi yang sudah ditutup tetap menjadi acuan bila survei pernah terbit.
      const published = versions.findLast((version) => version.published_at !== null);
      const draftQuestions = draft ? await questionInputsFor(draft.id) : undefined;
      const baseline = published ? await questionInputsFor(published.id) : draftQuestions ?? [];
      const signature = instrumentSignature(questions);
      const changed = signature !== instrumentSignature(baseline);
      let affectedResponses = 0;
      if (changed) {
        const counts = await all<{ version_id: string; count: number }>(
          `SELECT r.version_id, COUNT(*) AS count FROM responses r
           JOIN survey_versions v ON v.id = r.version_id
           WHERE r.survey_id = ? AND v.published_at IS NOT NULL GROUP BY r.version_id`,
          survey.id,
        );
        for (const row of counts) {
          const previous = row.version_id === published?.id ? baseline : await questionInputsFor(row.version_id);
          if (signature !== instrumentSignature(previous)) affectedResponses += row.count;
        }
      }
      const change = { changed, affectedResponses };
      if (preview) return change;
      let target = draft ?? published;
      const savedQuestions = draftQuestions ?? baseline;
      if (JSON.stringify(questions) !== JSON.stringify(savedQuestions)) {
        target = draft ?? (await createDraft(survey.id, notice.notice_version));
        await writeDraftQuestions(target.id, questions);
      }
      const status = survey.status === 'archived' ? 'draft' : survey.status === 'published' ? 'published' : 'draft';
      await run(
        'UPDATE surveys SET title = ?, purpose = ?, object_label = ?, instructions = ?, status = ?, updated_at = ?, current_version_id = ? WHERE id = ?',
        title,
        purpose,
        objectLabel,
        instructions,
        status,
        nowIso(),
        target?.id ?? survey.current_version_id,
        survey.id,
      );
      return change;
    });
    if (!preview) await audit(req, 'Simpan draf', survey.id, 'berhasil');
    res.json({ data: { ...await detailFor(survey.id), instrumentChange } });
  } catch (error) {
    sendError(res, error);
  }
});

surveysRouter.post('/surveys/:id/duplicate', async (req: AuthedRequest, res: Response) => {
  try {
    if (!req.account) fail(401, 'unauthenticated', 'Masuk kembali untuk melanjutkan.');
    const source = await requireManageSurvey(req.account, req.params.id);
    const sourceVersion = source.current_version_id
      ? await requireVersion(source.current_version_id)
      : (await versionRows(source.id))[0];
    if (!sourceVersion) fail(409, 'no_version', 'Survei sumber belum memiliki versi.');
    const id = newId('s');
    const now = nowIso();
    await withTx(async () => {
      await run(
        `INSERT INTO surveys (id, owner_id, profile_id, title, purpose, object_label, instructions, status, created_at, updated_at, current_version_id, organization_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, NULL, ?)`,
        id,
        req.account!.id,
        source.profile_id,
        `${source.title} (salinan)`,
        source.purpose,
        source.object_label,
        source.instructions,
        now,
        now,
        source.organization_id,
      );
      await run('INSERT INTO survey_settings (survey_id, allow_results, allow_individual) VALUES (?, 1, 0)', id);
      const draft = await createDraft(id, sourceVersion.notice_version);
      const questions = await questionRows(sourceVersion.id);
      const copies: QuestionInput[] = [];
      for (const question of questions) {
        copies.push({
          code: question.code,
          type: question.type,
          required: question.required === 1,
          section: question.section,
          label: question.label,
          hint: question.hint,
          group_code: question.group_code,
          dimension_code: question.dimension_code,
          direction: question.direction,
          options: (await optionRows(question.id)).map((option) => ({ label: option.label, value: option.value ?? 0 })),
        });
      }
      await writeDraftQuestions(draft.id, copies);
    });
    await audit(req, 'Salin survei', id, 'berhasil', { source: source.id });
    res.status(201).json({ data: await detailFor(id) });
  } catch (error) {
    sendError(res, error);
  }
});

/** `reason`: 'superseded' saat publish versi baru, 'closed' saat survei ditutup; keduanya boleh di-remap. */
async function closePublishedVersions(
  surveyId: string,
  now: string,
  reason: (typeof CONTINUABLE_CLOSE_REASONS)[number],
): Promise<Array<{ number: number }>> {
  return all<{ number: number }>(
    `WITH closed_versions AS (
       UPDATE survey_versions SET status = 'closed', closed_at = ?
       WHERE survey_id = ? AND status = 'published'
       RETURNING id, number
     ), closed_links AS (
       UPDATE public_links SET status = 'closed', closed_reason = ?
       WHERE version_id IN (SELECT id FROM closed_versions) AND status = 'active'
         AND (expires_at IS NULL OR expires_at::timestamptz >= ?::timestamptz)
     )
     SELECT number FROM closed_versions ORDER BY number`,
    now,
    surveyId,
    reason,
    now,
  );
}

surveysRouter.post('/surveys/:id/publish', async (req: AuthedRequest, res: Response) => {
  try {
    if (!req.account) fail(401, 'unauthenticated', 'Masuk kembali untuk melanjutkan.');
    const survey = await requireManageSurvey(req.account, req.params.id);
    const { draft, publicToken } = await withTx(async () => {
      // Serialkan transisi survei tanpa menghalangi FK kiriman ke survei.
      await get('SELECT id FROM surveys WHERE id = ? FOR NO KEY UPDATE', survey.id);
      const { draft } = await currentOrDraft(survey.id);
      if (!draft) fail(409, 'no_draft', 'Tidak ada draf untuk diterbitkan.');
      const questionRowsForDraft = await questionRows(draft.id);
      const questions: QuestionInput[] = [];
      for (const question of questionRowsForDraft) {
        questions.push({
          code: question.code,
          type: question.type,
          required: question.required === 1,
          section: question.section,
          label: question.label,
          hint: question.hint,
          group_code: question.group_code,
          dimension_code: question.dimension_code,
          direction: question.direction,
          options: (await optionRows(question.id)).map((option) => ({ label: option.label, value: option.value ?? 0 })),
        });
      }
      const errors = validateForPublish(survey.title, survey.purpose, questions);
      if (errors.length > 0) fail(422, 'publish_blocked', 'Draf belum memenuhi syarat publikasi.', { errors });
      await requirePublishableNotice(survey, draft.notice_version);
      const now = nowIso();
      await closePublishedVersions(survey.id, now, 'superseded');
      await run('UPDATE survey_versions SET status = ?, published_at = ? WHERE id = ?', 'published', now, draft.id);
      await run('UPDATE surveys SET status = ?, current_version_id = ?, updated_at = ? WHERE id = ?', 'published', draft.id, now, survey.id);
      const existing = await get<{ token: string }>(
        'SELECT token FROM public_links WHERE survey_id = ? AND version_id = ? LIMIT 1',
        survey.id,
        draft.id,
      );
      const publicToken = existing?.token ?? `pl_${randomBytes(12).toString('base64url')}`;
      if (!existing) {
        await run(
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
      return { draft, publicToken };
    });
    await audit(req, 'Publikasi versi', `${survey.id} · v${draft.number}`, 'berhasil');
    res.json({
      data: {
        version: (await versionRows(survey.id)).find((version) => version.id === draft.id),
        publicLink: { token: publicToken, url: `/s/${publicToken}` },
        detail: await detailFor(survey.id),
      },
    });
  } catch (error) {
    sendError(res, error);
  }
});

surveysRouter.post('/surveys/:id/close', async (req: AuthedRequest, res: Response) => {
  try {
    if (!req.account) fail(401, 'unauthenticated', 'Masuk kembali untuk melanjutkan.');
    const survey = await requireManageSurvey(req.account, req.params.id);
    const published = await withTx(async () => {
      await get('SELECT id FROM surveys WHERE id = ? FOR NO KEY UPDATE', survey.id);
      const now = nowIso();
      const closedVersions = await closePublishedVersions(survey.id, now, 'closed');
      if (closedVersions.length === 0) fail(409, 'no_published_version', 'Tidak ada versi terbit untuk ditutup.');
      await run('UPDATE surveys SET status = ?, updated_at = ? WHERE id = ?', 'closed', now, survey.id);
      return closedVersions;
    });
    await audit(req, 'Tutup versi', `${survey.id} · ${published.map(({ number }) => `v${number}`).join(', ')}`, 'berhasil');
    res.json({ data: await detailFor(survey.id) });
  } catch (error) {
    sendError(res, error);
  }
});

surveysRouter.post('/surveys/:id/archive', async (req: AuthedRequest, res: Response) => {
  try {
    if (!req.account) fail(401, 'unauthenticated', 'Masuk kembali untuk melanjutkan.');
    const survey = await requireManageSurvey(req.account, req.params.id);
    const now = nowIso();
    await withTx(async () => {
      await run('UPDATE surveys SET status = ?, updated_at = ? WHERE id = ?', 'archived', now, survey.id);
      await run(
        "UPDATE survey_versions SET status = 'closed', closed_at = COALESCE(closed_at, ?) WHERE survey_id = ? AND status IN ('draft','published')",
        now,
        survey.id,
      );
      // Tautan terbuka, dan tautan tertutup yang masih boleh di-remap (superseded/closed), ditandai
      // 'archived' agar terbit ulang tidak menghidupkannya. revoked/expired/used adalah keputusan
      // eksplisit pengelola atau hasil kedaluwarsa dan tidak boleh ditimpa.
      await run(
        `UPDATE public_links SET status = 'closed', closed_reason = 'archived'
          WHERE survey_id = ? AND (status = 'active' OR (status = 'closed' AND closed_reason IN (${CONTINUABLE_CLOSE_REASONS.map(() => '?').join(', ')})))`,
        survey.id,
        ...CONTINUABLE_CLOSE_REASONS,
      );
    });
    await audit(req, 'Arsipkan survei', survey.id, 'berhasil');
    res.json({ data: await detailFor(survey.id) });
  } catch (error) {
    sendError(res, error);
  }
});

surveysRouter.post('/surveys/:id/invitations', async (req: AuthedRequest, res: Response) => {
  try {
    if (!req.account) fail(401, 'unauthenticated', 'Masuk kembali untuk melanjutkan.');
    const survey = await requireManageSurvey(req.account, req.params.id);
    const published = (await versionRows(survey.id)).find((version) => version.status === 'published');
    if (!published) fail(409, 'no_published_version', 'Terbitkan versi sebelum membuat undangan.');
    const label = asString(req.body?.label ?? '', 'label', 200);
    if (!label) fail(422, 'validation_error', 'Label penugasan wajib diisi.');
    const expiresAt = invitationExpiresAt(req.body?.expires_at);
    const assignmentId = newId('a');
    const invitationId = newId('inv');
    const code = `UND-${randomBytes(3).toString('hex').toUpperCase()}`;
    const token = randomBytes(18).toString('base64url');
    await withTx(async () => {
      await run(
        'INSERT INTO assignments (id, survey_id, version_id, label, participant_ref) VALUES (?, ?, ?, ?, ?)',
        assignmentId,
        survey.id,
        published.id,
        label,
        `lokal-${randomBytes(3).toString('hex')}`,
      );
      await run(
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
    // Kode undangan dapat ditukar menjadi token lewat resolver publik; audit hanya memuat ID.
    await audit(req, 'Buat undangan', `${survey.id} · ${invitationId}`, 'berhasil');
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

surveysRouter.post('/invitations/:id/revoke', async (req: AuthedRequest, res: Response) => {
  try {
    if (!req.account) fail(401, 'unauthenticated', 'Masuk kembali untuk melanjutkan.');
    const invitation = await get<{ id: string; survey_id: string }>(
      'SELECT id, survey_id FROM invitations WHERE id = ?',
      req.params.id,
    );
    if (!invitation) fail(404, 'invitation_not_found', 'Undangan tidak ditemukan.');
    await requireManageSurvey(req.account, invitation.survey_id);
    // Undangan terpakai tetap 'used' (sama dengan undangan organisasi). Guard di WHERE menutup
    // balapan dengan kiriman yang mengunci baris undangan dan menandainya used di transaksinya.
    const revoked = await run(
      `UPDATE invitations SET status = 'revoked', revoked_at = ?
        WHERE id = ? AND status <> 'used' AND used_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM responses r WHERE r.assignment_id = invitations.assignment_id)`,
      nowIso(),
      invitation.id,
    );
    if (revoked === 0) fail(409, 'invitation_used', 'Undangan sudah dipakai dan tidak dapat dicabut.');
    await audit(req, 'Cabut undangan', `${invitation.survey_id} · ${invitation.id}`, 'berhasil');
    res.json({ data: { ok: true } });
  } catch (error) {
    sendError(res, error);
  }
});

surveysRouter.get('/surveys/:id/settings', async (req: AuthedRequest, res: Response) => {
  try {
    if (!req.account) fail(401, 'unauthenticated', 'Masuk kembali untuk melanjutkan.');
    const survey = await requireSurvey(req.params.id);
    if (!(await canReadSurveyMetadata(req.account, survey))) {
      fail(403, 'forbidden_survey', 'Anda tidak memiliki akses ke survei ini.');
    }
    const settings = await get<{ allow_results: number; allow_individual: number }>(
      'SELECT allow_results, allow_individual FROM survey_settings WHERE survey_id = ?',
      survey.id,
    );
    res.json({ data: { allowResults: Boolean(settings?.allow_results), allowIndividual: Boolean(settings?.allow_individual) } });
  } catch (error) {
    sendError(res, error);
  }
});

surveysRouter.put('/surveys/:id/settings', async (req: AuthedRequest, res: Response) => {
  try {
    if (!req.account) fail(401, 'unauthenticated', 'Masuk kembali untuk melanjutkan.');
    const survey = await requireManageSurvey(req.account, req.params.id);
    const allowResults = asBoolean(req.body?.allowResults, true);
    const allowIndividual = asBoolean(req.body?.allowIndividual, false);
    await run(
      `INSERT INTO survey_settings (survey_id, allow_results, allow_individual) VALUES (?, ?, ?)
       ON CONFLICT(survey_id) DO UPDATE SET allow_results = excluded.allow_results, allow_individual = excluded.allow_individual`,
      survey.id,
      allowResults ? 1 : 0,
      allowIndividual ? 1 : 0,
    );
    await audit(req, 'Ubah pengaturan hasil', survey.id, 'berhasil', { allowResults, allowIndividual });
    res.json({ data: { allowResults, allowIndividual } });
  } catch (error) {
    sendError(res, error);
  }
});

surveysRouter.get('/surveys/:id/summary', async (req: AuthedRequest, res: Response) => {
  try {
    if (!req.account) fail(401, 'unauthenticated', 'Masuk kembali untuk melanjutkan.');
    const survey = await requireSurvey(req.params.id);
    if (!(await canReadAggregate(req.account, survey))) {
      fail(403, 'forbidden_summary', 'Ringkasan tidak tersedia untuk akun ini.');
    }
    const requested = typeof req.query.version === 'string' ? req.query.version : '';
    const version = requested ? await requireVersion(requested) : await requirePublishedVersion(survey.id);
    if (version.survey_id !== survey.id) fail(403, 'forbidden_version', 'Versi bukan milik survei ini.');
    res.json({ data: await summaryFor(version.id) });
  } catch (error) {
    sendError(res, error);
  }
});

/** Satu batch respons ekspor; keyset `(submitted_at, id)` mengikuti urutan `ORDER BY submitted_at, id`. */
async function responseBatch(surveyId: string, versionId: string, after: ResponseDbRow | undefined): Promise<ResponseDbRow[]> {
  if (!after) {
    return all<ResponseDbRow>(
      'SELECT * FROM responses WHERE survey_id = ? AND version_id = ? ORDER BY submitted_at, id LIMIT ?',
      surveyId,
      versionId,
      EXPORT_BATCH_SIZE,
    );
  }
  return all<ResponseDbRow>(
    `SELECT * FROM responses
      WHERE survey_id = ? AND version_id = ? AND (submitted_at, id) > (?, ?)
      ORDER BY submitted_at, id LIMIT ?`,
    surveyId,
    versionId,
    after.submitted_at,
    after.id,
    EXPORT_BATCH_SIZE,
  );
}

/** Tulis potongan CSV dan tunggu `drain` bila buffer penuh; false bila koneksi klien sudah tertutup. */
async function writeCsv(res: Response, chunk: string): Promise<boolean> {
  if (!res.write(chunk) && !res.destroyed) {
    await new Promise<void>((resolve) => {
      const done = () => {
        res.off('drain', done);
        res.off('close', done);
        resolve();
      };
      res.on('drain', done);
      res.on('close', done);
    });
  }
  return !res.destroyed;
}

function byResponse(rows: AnswerDbRow[]): Map<string, AnswerDbRow[]> {
  const map = new Map<string, AnswerDbRow[]>();
  for (const row of rows) {
    const list = map.get(row.response_id) ?? [];
    list.push(row);
    map.set(row.response_id, list);
  }
  return map;
}

/** Jawaban hanya untuk respons yang sudah dipaginasi, bukan seluruh jawaban versi. */
async function answersForResponses(responseIds: string[]): Promise<Map<string, AnswerDbRow[]>> {
  if (responseIds.length === 0) return new Map();
  const rows = await all<AnswerDbRow>(
    `SELECT a.response_id, a.question_code, a.option_id, a.value, a.text, a.skipped
       FROM answers a
      WHERE a.response_id IN (${responseIds.map(() => '?').join(',')})`,
    ...responseIds,
  );
  return byResponse(rows);
}

surveysRouter.get('/surveys/:id/export', async (req: AuthedRequest, res: Response) => {
  try {
    if (!req.account) fail(401, 'unauthenticated', 'Masuk kembali untuk melanjutkan.');
    const survey = await requireSurvey(req.params.id);
    const format: ExportFormat = req.query.format === 'codebook' ? 'codebook' : 'csv';
    if (!(await canExport(req.account, survey))) {
      await audit(req, 'Ekspor hasil', survey.id, 'ditolak', {
        format,
        reason: 'forbidden_export',
        request_accept: requestAccept(req),
      });
      fail(403, 'forbidden_export', 'Akun ini tidak memiliki izin ekspor pada survei ini.');
    }
    if (format === 'csv' && !(await canExportIndividual(req.account, survey))) {
      await audit(req, 'Ekspor hasil', survey.id, 'ditolak', {
        format,
        reason: 'forbidden_export_individual',
        request_accept: requestAccept(req),
      });
      fail(
        403,
        'forbidden_export_individual',
        'Ekspor CSV memuat data per responden; izin membaca jawaban individual atau pengaturan survei menolaknya. Gunakan format=codebook untuk agregat.',
      );
    }
    const requested = typeof req.query.version === 'string' ? req.query.version : '';
    const version = requested ? await requireVersion(requested) : await requirePublishedVersion(survey.id);
    if (version.survey_id !== survey.id) fail(403, 'forbidden_version', 'Versi bukan milik survei ini.');
    const questions = await questionRows(version.id);
    const includeText = await canReadFreeText(req.account, survey);
    if (format === 'codebook') {
      const codebookQuestions = includeText
        ? questions
        : questions.filter((question) => question.type !== 'short_text');
      const rows: unknown[][] = [
        ['survey_version', 'code', 'label', 'type', 'required', 'section', 'group_code', 'dimension_code', 'direction', 'value', 'value_label', 'empty_meaning'],
      ];
      for (const question of codebookQuestions) {
        const options = await optionRows(question.id);
        if (options.length === 0) {
          rows.push([version.number, question.code, question.label, question.type, question.required, question.section, question.group_code, question.dimension_code, question.direction, '', '', includeText ? 'Tidak dijawab / kosong' : 'Tidak dijawab / kosong (teks dibatasi izin)']);
        } else {
          for (const option of options) {
            rows.push([version.number, question.code, question.label, question.type, question.required, question.section, question.group_code, question.dimension_code, question.direction, option.value, option.label, 'Tidak dijawab / kosong']);
          }
        }
      }
      const filename = `kodebook-${survey.id}-v${version.number}.csv`;
      await audit(req, 'Ekspor kodebook', `${survey.id} · v${version.number}`, 'berhasil', {
        format,
        rows: rows.length - 1,
        includeText,
        individual: false,
        filename,
        questions: codebookQuestions.map((question) => question.code),
        request_accept: requestAccept(req),
      });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csvDocument(rows));
      return;
    }
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
    const object = `${survey.id} · v${version.number}`;
    const filename = `hasil-${survey.id}-v${version.number}.csv`;
    // Fail-closed: jejak audit ditulis sebelum data respons dibaca dan sebelum byte pertama dikirim.
    // Bila INSERT gagal, galat keluar sebagai 500 JSON tanpa isi CSV. Baris ini berstatus 'dimulai' dan
    // satu-satunya yang memuat kolom dan Accept; hasil akhir dan jumlah baris dicatat terpisah di bawah.
    await audit(req, 'Mulai ekspor CSV', object, 'dimulai', {
      format,
      includeText,
      individual: true,
      filename,
      columns: header,
      request_accept: requestAccept(req),
    });
    // Baris ditulis per batch; header HTTP baru terkirim bersama batch pertama sehingga galat sebelumnya tetap JSON.
    let text = `${CSV_BOM}${csvLine(header)}${CSV_EOL}`;
    let rows = 0;
    let stopped: string | undefined;
    try {
      for (let after: ResponseDbRow | undefined; ; ) {
        const batch = await responseBatch(survey.id, version.id, after);
        const answersByResponse = await answersForResponses(batch.map((response) => response.id));
        if (res.destroyed) break;
        for (const response of batch) {
          const answers = answersByResponse.get(response.id) ?? [];
          const byCode = new Map(answers.map((answer) => [answer.question_code, answer]));
          text += `${csvLine([
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
          ])}${CSV_EOL}`;
        }
        if (!res.headersSent) {
          res.setHeader('Content-Type', 'text/csv; charset=utf-8');
          res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        }
        const open = text === '' || (await writeCsv(res, text));
        rows += batch.length;
        if (!open || batch.length < EXPORT_BATCH_SIZE) break;
        text = '';
        after = batch[batch.length - 1];
      }
    } catch (error) {
      if (!res.headersSent) throw error;
      console.error('[api] ekspor CSV terhenti di tengah aliran', error);
      stopped = 'stream_error';
    }
    const metadata = { format, rows, includeText, individual: true, filename };
    if (stopped || res.destroyed) {
      // Sebagian baris mungkin sudah keluar; putus koneksi agar klien tidak menganggap berkas lengkap.
      res.destroy();
      await audit(req, 'Ekspor CSV', object, 'gagal', { ...metadata, reason: stopped ?? 'client_closed' });
      return;
    }
    await audit(req, 'Ekspor CSV', object, 'berhasil', metadata);
    res.end();
  } catch (error) {
    if (res.headersSent) {
      console.error('[api] ekspor CSV terhenti di tengah aliran', error);
      res.destroy();
      return;
    }
    sendError(res, error);
  }
});

surveysRouter.get('/surveys/:id/responses', async (req: AuthedRequest, res: Response) => {
  try {
    if (!req.account) fail(401, 'unauthenticated', 'Masuk kembali untuk melanjutkan.');
    const survey = await requireSurvey(req.params.id);
    if (!(await canReadIndividual(req.account, survey))) {
      await audit(req, 'Baca jawaban individual', survey.id, 'ditolak');
      fail(403, 'forbidden_individual', 'Akun ini tidak memiliki izin membaca jawaban individual.');
    }
    const requested = typeof req.query.version === 'string' ? req.query.version : '';
    const version = requested ? await requireVersion(requested) : await requirePublishedVersion(survey.id);
    if (version.survey_id !== survey.id) fail(403, 'forbidden_version', 'Versi bukan milik survei ini.');
    const includeText = await canReadFreeText(req.account, survey);
    const rows = await all<ResponseDbRow>(
      `SELECT * FROM responses WHERE survey_id = ? AND version_id = ? ORDER BY submitted_at DESC LIMIT ? OFFSET ?`,
      survey.id,
      version.id,
      parseLimit(req.query.limit),
      Number.parseInt(typeof req.query.offset === 'string' ? req.query.offset : '0', 10) || 0,
    );
    const answersByResponse = await answersForResponses(rows.map((response) => response.id));
    await audit(req, 'Baca jawaban individual', `${survey.id} · v${version.number}`, 'berhasil', { count: rows.length, includeText });
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
