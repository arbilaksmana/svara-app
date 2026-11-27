import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { all, get, nowIso, run, withTx } from '../db.ts';
import { asString, fail, newId, parseLimit, sendError, sha256Hex } from '../http.ts';
import { rateLimit } from '../security.ts';

interface SurveyRow {
  id: string;
  organization_id: string | null;
}

interface IntegrationTokenScope {
  organization_id: string | null;
  survey_id: string | null;
  expires_at: string | null;
}

interface VersionRow {
  id: string;
  number: number;
  status: 'published' | 'closed';
}

interface AssignmentRow {
  id: string;
  survey_id: string;
  version_id: string;
  label: string;
  participant_ref: string;
}

interface InvitationSummaryRow {
  id: string;
  status: string;
}

/**
 * SEC-12 hanya menolak draf. Versi yang pernah terbit tetap terbaca setelah ditutup oleh versi baru
 * atau oleh penutupan survei (PRD §8: skema berversi, filter versi); draf yang ikut ditutup arsip
 * tidak pernah punya published_at sehingga tetap ditolak.
 */
const PUBLISHED_ONCE = "(status = 'published' OR (status = 'closed' AND published_at IS NOT NULL))";

interface ResponseRow {
  id: string;
  respondent_id: string;
  submitted_at: string;
  assignment_id: string | null;
  version_id: string;
}

interface AnswerRow {
  response_id: string;
  question_code: string;
  option_id: string | null;
  value: number | null;
  text: string | null;
  skipped: number;
}

export const integrationRouter = Router();

function serviceToken(req: Request): string | undefined {
  const expected = process.env.INTEGRATION_TOKEN?.trim();
  return expected && req.get('authorization') === `Bearer ${expected}` ? expected : undefined;
}

async function integrationScope(token: string): Promise<IntegrationTokenScope | undefined> {
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const scope = await get<IntegrationTokenScope>(
    'SELECT organization_id, survey_id, expires_at FROM integration_token_scopes WHERE token_hash = ?',
    tokenHash,
  );
  if (!scope) return undefined;
  // BF-09c: respons sama dengan cakupan tidak ada agar klien tidak bisa membedakan keduanya; audit tetap
  // mencatatnya tanpa token maupun hash-nya.
  const expiresAt = scope.expires_at === null ? NaN : Date.parse(scope.expires_at);
  if (expiresAt <= Date.now()) {
    await run(
      'INSERT INTO audit_logs (id, actor, action, object, outcome, at, metadata, account_id, organization_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      newId('log'),
      'layanan-15',
      'Kredensial integrasi kedaluwarsa',
      scope.organization_id ?? scope.survey_id ?? '',
      'ditolak',
      nowIso(),
      null,
      null,
      scope.organization_id,
    );
    return undefined;
  }
  if (Boolean(scope.organization_id) === Boolean(scope.survey_id)) return undefined;
  return scope;
}

/** Sama dengan `invitationExpiresAt` di surveys.ts: tanggal saja = akhir hari UTC, wajib di masa depan. */
const INVITATION_EXPIRY = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-](\d{2}):(\d{2})))?$/;
const INVITATION_EXPIRY_ERROR = 'Batas waktu undangan harus tanggal YYYY-MM-DD atau tanggal-waktu ISO-8601 dengan zona waktu.';

function serviceInvitationExpiresAt(raw: unknown): string | null {
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

/** Pembuatan dan penerbitan ulang memakai bucket yang sama agar retry tidak menggandakan kuota. */
function serviceInvitationRateLimit(token: string): void {
  if (!rateLimit({ key: `svc-invite:${sha256Hex(token).slice(0, 12)}`, limit: 120, windowMs: 10 * 60 * 1000 })) {
    fail(429, 'rate_limited', 'Terlalu banyak permintaan pembuatan undangan. Coba lagi nanti.');
  }
}

/** Cakupan token: survei di luar organisasi/cakupan dijawab sama dengan survei tidak ada. */
function assertSurveyInScope(survey: SurveyRow, scope: IntegrationTokenScope): void {
  if (
    (scope.organization_id && survey.organization_id !== scope.organization_id) ||
    (scope.survey_id && survey.id !== scope.survey_id)
  ) {
    fail(404, 'not_found', 'Survei tidak ditemukan untuk cakupan layanan.');
  }
}

/**
 * Status undangan terbaru untuk assignment. `invitation_id` pada balasan 409 hanya identitas baris;
 * token mentah tidak pernah disimpan sehingga tidak ada yang bisa diputar ulang (SEC-10).
 */
function latestInvitationFor(assignmentId: string): Promise<InvitationSummaryRow | undefined> {
  return get<InvitationSummaryRow>(
    'SELECT id, status FROM invitations WHERE assignment_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
    assignmentId,
  );
}

async function versionForRequest(surveyId: string, requested: string): Promise<VersionRow | undefined> {
  const requestedNumber = Number(requested);
  return Number.isInteger(requestedNumber)
    ? get<VersionRow>(
        `SELECT id, number, status FROM survey_versions WHERE survey_id = ? AND ${PUBLISHED_ONCE} AND (id = ? OR number = ?)`,
        surveyId,
        requested,
        requestedNumber,
      )
    : get<VersionRow>(
        `SELECT id, number, status FROM survey_versions WHERE survey_id = ? AND ${PUBLISHED_ONCE} AND id = ?`,
        surveyId,
        requested,
      );
}

/**
 * Himpunan kosong tetap memakai amplop yang sama dengan pembacaan biasa. Versi null berarti assignment
 * tidak dikenal pada survei ini; jangan mengarang versi terbit terbaru untuk hasil yang kosong.
 */
function respondEmptySurveyData(
  res: Response,
  survey: SurveyRow,
  version: VersionRow | undefined,
  limit: number,
  offset: number,
): void {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    schema_version: 1,
    simulated: true,
    label: 'SIMULASI Modul 15 — bukan integrasi nyata.',
    survey_id: survey.id,
    survey_version: version?.number ?? null,
    survey_version_status: version?.status ?? null,
    collection_modes: ['standalone', 'integrated'],
    identity_sources: ['local', 'module_13'],
    columns: ['response_id', 'respondent_id', 'submitted_at', 'assignment_id', 'version_id', 'question_code', 'value', 'option_id'],
    free_text_included: false,
    pagination: { limit, offset, total: 0 },
    data: [],
  });
}

/**
 * Modul 13 membuat undangan per peserta tanpa sesi pengelola. Cakupan token menentukan survei mana
 * yang boleh dilayani; survei di luar cakupan dijawab sama dengan survei tidak ada agar keberadaannya
 * tidak bocor.
 */
integrationRouter.post('/integration/surveys/:id/invitations', async (req: Request, res: Response) => {
  try {
    const token = serviceToken(req);
    if (!token) fail(401, 'unauthenticated_service', 'Kredensial layanan tidak valid.');
    const scope = await integrationScope(token);
    if (!scope) fail(403, 'forbidden_service_scope', 'Cakupan kredensial layanan tidak tersedia.');
    serviceInvitationRateLimit(token);
    const surveyId = typeof req.params.id === 'string' ? req.params.id : '';
    const survey = await get<SurveyRow>('SELECT id, organization_id FROM surveys WHERE id = ?', surveyId);
    if (!survey) fail(404, 'not_found', 'Survei tidak ditemukan untuk cakupan layanan.');
    assertSurveyInScope(survey, scope);
    const version = await get<VersionRow>(
      "SELECT id, number, status FROM survey_versions WHERE survey_id = ? AND status = 'published' ORDER BY number DESC LIMIT 1",
      survey.id,
    );
    if (!version) fail(409, 'no_published_version', 'Terbitkan versi sebelum membuat undangan.');
    const participantRef = asString(req.body?.participant_ref, 'participant_ref', 200);
    if (!participantRef) fail(422, 'validation_error', 'participant_ref wajib diisi.', { field: 'participant_ref' });
    const label = asString(req.body?.label, 'label', 200);
    if (!label) fail(422, 'validation_error', 'Label penugasan wajib diisi.', { field: 'label' });
    const expiresAt = serviceInvitationExpiresAt(req.body?.expires_at);
    const assignmentId = newId('a');
    const invitationId = newId('inv');
    // SEC-09: 4 byte = 32 bit; kode 3 byte (24 bit) dapat brute force dalam hitungan jam.
    const code = `UND-${randomBytes(4).toString('hex').toUpperCase()}`;
    // SEC-10: token mentah hanya ada di respons ini; basis data menyimpan hash saja.
    const invitationToken = randomBytes(18).toString('base64url');
    const created = await withTx(async () => {
      // ON CONFLICT menutup balapan retry: pre-check SELECT bisa lolos bersamaan, sedangkan indeks
      // unik membuat tepat satu penulis menang. Penulis yang kalah tidak membuat undangan.
      const inserted = await get<{ id: string }>(
        `INSERT INTO assignments (id, survey_id, version_id, label, participant_ref)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (survey_id, participant_ref) DO NOTHING
         RETURNING id`,
        assignmentId,
        survey.id,
        version.id,
        label,
        participantRef,
      );
      if (!inserted) return false;
      await run(
        `INSERT INTO invitations (id, assignment_id, survey_id, version_id, code, token_hash, status, expires_at, used_at, revoked_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, NULL, NULL, ?)`,
        invitationId,
        assignmentId,
        survey.id,
        version.id,
        code,
        sha256Hex(invitationToken),
        expiresAt,
        nowIso(),
      );
      return true;
    });
    if (!created) {
      // ON CONFLICT hanya melepas baris setelah penulis bentrok commit, jadi baris itu pasti ada.
      const existing = await get<{ id: string }>(
        'SELECT id FROM assignments WHERE survey_id = ? AND participant_ref = ?',
        survey.id,
        participantRef,
      );
      if (!existing) fail(409, 'assignment_exists', 'Peserta sudah memiliki penugasan untuk survei ini.');
      const invitation = await latestInvitationFor(existing.id);
      // SEC-10: token mentah tidak dapat diputar ulang; klien memakai endpoint reissue bila perlu
      // tautan baru. Tidak ada token pada balasan 409.
      res.status(409).json({
        error: 'Peserta sudah memiliki penugasan untuk survei ini.',
        code: 'assignment_exists',
        assignment_id: existing.id,
        invitation_id: invitation?.id ?? null,
        invitation_status: invitation?.status ?? 'none',
      });
      return;
    }
    // Audit hanya memuat ID; token mentah tidak boleh masuk log.
    await run(
      'INSERT INTO audit_logs (id, actor, action, object, outcome, at, metadata, account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      newId('log'),
      'layanan-13',
      'Buat undangan layanan',
      `${survey.id} · ${invitationId}`,
      'berhasil',
      nowIso(),
      null,
      null,
    );
    res.status(201).json({
      data: {
        assignment_id: assignmentId,
        invitation_id: invitationId,
        version_id: version.id,
        code,
        token: invitationToken,
        url: `/s/${invitationToken}`,
        expires_at: expiresAt,
      },
    });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * SEC-10: balasan pembuatan memuat token mentah yang tidak disimpan, jadi retry tidak bisa
 * memutar ulang tautan lama. Penerbitan ulang mencabut undangan aktif dan membuat token baru untuk
 * assignment yang sama, tetap pada `assignments.version_id` meskipun versi itu sudah ditutup.
 */
integrationRouter.post('/integration/assignments/:id/invitations', async (req: Request, res: Response) => {
  try {
    const token = serviceToken(req);
    if (!token) fail(401, 'unauthenticated_service', 'Kredensial layanan tidak valid.');
    const scope = await integrationScope(token);
    if (!scope) fail(403, 'forbidden_service_scope', 'Cakupan kredensial layanan tidak tersedia.');
    serviceInvitationRateLimit(token);
    const assignmentId = typeof req.params.id === 'string' ? req.params.id : '';
    const assignment = await get<AssignmentRow & { organization_id: string | null }>(
      `SELECT a.id, a.survey_id, a.version_id, a.label, a.participant_ref, s.organization_id
         FROM assignments a JOIN surveys s ON s.id = a.survey_id
        WHERE a.id = ?`,
      assignmentId,
    );
    if (!assignment) fail(404, 'not_found', 'Penugasan tidak ditemukan untuk cakupan layanan.');
    assertSurveyInScope(assignment, scope);
    const expiresAt = serviceInvitationExpiresAt(req.body?.expires_at);
    const invitationId = newId('inv');
    // SEC-09/SEC-10: kode dan token baru; token mentah hanya ada di balasan ini.
    const code = `UND-${randomBytes(4).toString('hex').toUpperCase()}`;
    const invitationToken = randomBytes(18).toString('base64url');
    const outcome = await withTx(async () => {
      // Serialkan penerbitan ulang pada assignment yang sama: yang kedua mencabut undangan aktif
      // yang dibuat yang pertama, bukan meninggalkan dua tautan aktif.
      const locked = await get<{ id: string }>('SELECT id FROM assignments WHERE id = ? FOR UPDATE', assignment.id);
      if (!locked) return 'missing';
      const existingResponse = await get<{ id: string }>(
        'SELECT id FROM responses WHERE assignment_id = ? LIMIT 1',
        assignment.id,
      );
      if (existingResponse) return 'submitted';
      await run(
        "UPDATE invitations SET status = 'revoked', revoked_at = ? WHERE assignment_id = ? AND status = 'active'",
        nowIso(),
        assignment.id,
      );
      await run(
        `INSERT INTO invitations (id, assignment_id, survey_id, version_id, code, token_hash, status, expires_at, used_at, revoked_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, NULL, NULL, ?)`,
        invitationId,
        assignment.id,
        assignment.survey_id,
        assignment.version_id,
        code,
        sha256Hex(invitationToken),
        expiresAt,
        nowIso(),
      );
      return 'created';
    });
    if (outcome === 'missing') fail(404, 'not_found', 'Penugasan tidak ditemukan untuk cakupan layanan.');
    if (outcome === 'submitted') fail(409, 'already_submitted', 'Penugasan ini sudah memiliki respons final.');
    // Audit hanya memuat ID; token mentah tidak boleh masuk log.
    await run(
      'INSERT INTO audit_logs (id, actor, action, object, outcome, at, metadata, account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      newId('log'),
      'layanan-13',
      'Terbitkan ulang undangan layanan',
      `${assignment.survey_id} · ${invitationId}`,
      'berhasil',
      nowIso(),
      null,
      null,
    );
    res.status(201).json({
      data: {
        assignment_id: assignment.id,
        invitation_id: invitationId,
        version_id: assignment.version_id,
        code,
        token: invitationToken,
        url: `/s/${invitationToken}`,
        expires_at: expiresAt,
      },
    });
  } catch (error) {
    sendError(res, error);
  }
});

integrationRouter.get('/integration/survey-data', async (req: Request, res: Response) => {
  try {
    const token = serviceToken(req);
    if (!token) fail(401, 'unauthenticated_service', 'Kredensial layanan tidak valid.');
    const scope = await integrationScope(token);
    if (!scope) fail(403, 'forbidden_service_scope', 'Cakupan kredensial layanan tidak tersedia.');
    const surveyId = typeof req.query.survey_id === 'string' ? req.query.survey_id : '';
    const survey = await get<SurveyRow>('SELECT id, organization_id FROM surveys WHERE id = ?', surveyId);
    if (!survey) fail(404, 'not_found', 'Survei tidak ditemukan untuk cakupan layanan.');
    assertSurveyInScope(survey, scope);
    const limit = parseLimit(req.query.limit, 100, 500);
    const offset = Number(req.query.offset ?? 0);
    const safeOffset = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
    const requested = typeof req.query.version === 'string' ? req.query.version : '';
    const assignmentId = typeof req.query.assignment_id === 'string' ? req.query.assignment_id.trim() : '';
    // Tanpa assignment_id, versi hasil resolve menentukan baris. Dengan assignment_id, versi TIDAK
    // diambil dari assignment: respons menyimpan versi yang benar-benar dijawab (public.ts memakai
    // context.version.id), dan undangan tidak dipin versi. Baris difilter langsung lewat assignment_id.
    let version: VersionRow | undefined;
    let assignment: AssignmentRow | undefined;
    if (assignmentId) {
      assignment = await get<AssignmentRow>(
        'SELECT id, survey_id, version_id, label, participant_ref FROM assignments WHERE id = ? AND survey_id = ?',
        assignmentId,
        survey.id,
      );
      if (!assignment) {
        // Assignment milik survei lain atau tidak dikenal: himpunan kosong, bukan 404, agar klien
        // tidak bisa membedakan "tidak ada" dari "bukan milikmu".
        respondEmptySurveyData(res, survey, undefined, limit, safeOffset);
        return;
      }
      // Metadata top-level mengikuti versi respons bila sudah ada; bila belum, versi assignment.
      const answered = await get<{ version_id: string }>(
        'SELECT version_id FROM responses WHERE assignment_id = ? AND survey_id = ? LIMIT 1',
        assignment.id,
        survey.id,
      );
      version = await get<VersionRow>(
        'SELECT id, number, status FROM survey_versions WHERE id = ? AND survey_id = ?',
        answered?.version_id ?? assignment.version_id,
        survey.id,
      );
      if (!version) {
        respondEmptySurveyData(res, survey, undefined, limit, safeOffset);
        return;
      }
    } else if (requested) {
      version = await versionForRequest(survey.id, requested);
    } else {
      version = await get<VersionRow>(
        `SELECT id, number, status FROM survey_versions WHERE survey_id = ? AND ${PUBLISHED_ONCE} ORDER BY number DESC LIMIT 1`,
        survey.id,
      );
    }
    if (!version) fail(404, 'version_not_found', 'Versi tidak ditemukan.');
    const where: string[] = [];
    const whereParams: string[] = [];
    if (assignment) {
      where.push('survey_id = ?', 'assignment_id = ?');
      whereParams.push(survey.id, assignment.id);
      if (requested) {
        // `version` pada jalur assignment hanya filter tambahan pada versi baris respons.
        const requestedVersion = await versionForRequest(survey.id, requested);
        if (!requestedVersion) {
          respondEmptySurveyData(res, survey, version, limit, safeOffset);
          return;
        }
        where.push('version_id = ?');
        whereParams.push(requestedVersion.id);
      }
    } else {
      where.push('version_id = ?');
      whereParams.push(version.id);
    }
    const whereSql = where.join(' AND ');
    const total = Number(
      (await get<{ count: number }>(`SELECT COUNT(*) AS count FROM responses WHERE ${whereSql}`, ...whereParams))
        ?.count ?? 0,
    );
    const responses = await all<ResponseRow>(
      `SELECT id, respondent_id, submitted_at, assignment_id, version_id FROM responses WHERE ${whereSql} ORDER BY submitted_at, id LIMIT ? OFFSET ?`,
      ...whereParams,
      limit,
      safeOffset,
    );
    const ids = responses.map((row) => row.id);
    const answers = ids.length
      ? await all<AnswerRow>(
          `SELECT response_id, question_code, option_id, value, text, skipped
             FROM answers WHERE response_id IN (${ids.map(() => '?').join(',')})
            ORDER BY question_code`,
          ...ids,
        )
      : [];
    const byResponse = new Map<string, AnswerRow[]>();
    for (const answer of answers) {
      const list = byResponse.get(answer.response_id) ?? [];
      list.push(answer);
      byResponse.set(answer.response_id, list);
    }
    // Jalur assignment tidak memakai versi untuk memfilter; jangan catat versi yang tidak terpakai.
    const eventPayload = assignment
      ? {
          survey_id: survey.id,
          assignment_id: assignment.id,
          version_ids: [...new Set(responses.map((row) => row.version_id))],
          rows: responses.length,
          offset: safeOffset,
          limit,
        }
      : { survey_id: survey.id, version_id: version.id, rows: responses.length, offset: safeOffset, limit };
    await run(
      `INSERT INTO integration_events (id, event_id, type, target, status, attempts, at, simulated, response_id, last_error, payload)
       VALUES (?, ?, 'survey-data.read', 'module_15', 'delivered', 1, ?, 1, NULL, NULL, ?)`,
      newId('evt'),
      newId('event'),
      nowIso(),
      JSON.stringify(eventPayload),
    );
    await run(
      'INSERT INTO audit_logs (id, actor, action, object, outcome, at, metadata, account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      newId('log'),
      'layanan-15',
      'Ambil data survei',
      assignment ? `${survey.id} · assignment ${assignment.id}` : `${survey.id} · v${version.number}`,
      'berhasil',
      nowIso(),
      null,
      null,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      schema_version: 1,
      simulated: true,
      label: 'SIMULASI Modul 15 — bukan integrasi nyata.',
      survey_id: survey.id,
      survey_version: version.number,
      survey_version_status: version.status,
      collection_modes: ['standalone', 'integrated'],
      identity_sources: ['local', 'module_13'],
      columns: ['response_id', 'respondent_id', 'submitted_at', 'assignment_id', 'version_id', 'question_code', 'value', 'option_id'],
      free_text_included: false,
      pagination: { limit, offset: safeOffset, total },
      data: responses.map((response) => ({
        response_id: response.id,
        respondent_id: response.respondent_id,
        submitted_at: response.submitted_at,
        assignment_id: response.assignment_id,
        version_id: response.version_id,
        answers: (byResponse.get(response.id) ?? []).map((answer) => ({
          question_code: answer.question_code,
          value: answer.value,
          option_id: answer.option_id,
          skipped: answer.skipped === 1,
        })),
      })),
    });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * Status per penugasan menutup ambiguitas `survey-data` yang kosong: klien bisa membedakan
 * "belum submit", "sudah submit", dan "bukan assignment survei ini" tanpa menebak dari data.
 */
integrationRouter.get('/integration/surveys/:id/assignments/:assignmentId', async (req: Request, res: Response) => {
  try {
    const token = serviceToken(req);
    if (!token) fail(401, 'unauthenticated_service', 'Kredensial layanan tidak valid.');
    const scope = await integrationScope(token);
    if (!scope) fail(403, 'forbidden_service_scope', 'Cakupan kredensial layanan tidak tersedia.');
    const surveyId = typeof req.params.id === 'string' ? req.params.id : '';
    const survey = await get<SurveyRow>('SELECT id, organization_id FROM surveys WHERE id = ?', surveyId);
    if (!survey) fail(404, 'not_found', 'Survei tidak ditemukan untuk cakupan layanan.');
    assertSurveyInScope(survey, scope);
    const assignmentId = typeof req.params.assignmentId === 'string' ? req.params.assignmentId : '';
    const assignment = await get<AssignmentRow>(
      'SELECT id, survey_id, version_id, label, participant_ref FROM assignments WHERE id = ? AND survey_id = ?',
      assignmentId,
      survey.id,
    );
    if (!assignment) fail(404, 'not_found', 'Penugasan tidak ditemukan untuk survei ini.');
    const invitation = await latestInvitationFor(assignment.id);
    const response = await get<{ id: string; submitted_at: string; version_id: string }>(
      'SELECT id, submitted_at, version_id FROM responses WHERE assignment_id = ? LIMIT 1',
      assignment.id,
    );
    // `invitation_status` = status baris undangan terbaru; 'none' bila assignment tidak punya undangan.
    // `answered_version_id` = versi respons; dengan assignment tidak dipin versi, versi ini bisa
    // berbeda dari assignment.version_id setelah republish + upgrade.
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      data: {
        assignment_id: assignment.id,
        survey_id: assignment.survey_id,
        participant_ref: assignment.participant_ref,
        label: assignment.label,
        version_id: assignment.version_id,
        answered_version_id: response?.version_id ?? null,
        invitation_status: invitation?.status ?? 'none',
        submitted: Boolean(response),
        submitted_at: response?.submitted_at ?? null,
        response_id: response?.id ?? null,
      },
    });
  } catch (error) {
    sendError(res, error);
  }
});
