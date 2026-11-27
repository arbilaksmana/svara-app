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
    if (!rateLimit({ key: `svc-invite:${sha256Hex(token).slice(0, 12)}`, limit: 120, windowMs: 10 * 60 * 1000 })) {
      fail(429, 'rate_limited', 'Terlalu banyak permintaan pembuatan undangan. Coba lagi nanti.');
    }
    const surveyId = typeof req.params.id === 'string' ? req.params.id : '';
    const survey = await get<SurveyRow>('SELECT id, organization_id FROM surveys WHERE id = ?', surveyId);
    if (!survey) fail(404, 'not_found', 'Survei tidak ditemukan untuk cakupan layanan.');
    if (
      (scope.organization_id && survey.organization_id !== scope.organization_id) ||
      (scope.survey_id && survey.id !== scope.survey_id)
    ) {
      fail(404, 'not_found', 'Survei tidak ditemukan untuk cakupan layanan.');
    }
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
    await withTx(async () => {
      await run(
        'INSERT INTO assignments (id, survey_id, version_id, label, participant_ref) VALUES (?, ?, ?, ?, ?)',
        assignmentId,
        survey.id,
        version.id,
        label,
        participantRef,
      );
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
    });
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

integrationRouter.get('/integration/survey-data', async (req: Request, res: Response) => {
  try {
    const token = serviceToken(req);
    if (!token) fail(401, 'unauthenticated_service', 'Kredensial layanan tidak valid.');
    const scope = await integrationScope(token);
    if (!scope) fail(403, 'forbidden_service_scope', 'Cakupan kredensial layanan tidak tersedia.');
    const surveyId = typeof req.query.survey_id === 'string' ? req.query.survey_id : '';
    const survey = await get<SurveyRow>('SELECT id, organization_id FROM surveys WHERE id = ?', surveyId);
    if (!survey) fail(404, 'not_found', 'Survei tidak ditemukan untuk cakupan layanan.');
    if (
      (scope.organization_id && survey.organization_id !== scope.organization_id) ||
      (scope.survey_id && survey.id !== scope.survey_id)
    ) {
      fail(404, 'not_found', 'Survei tidak ditemukan untuk cakupan layanan.');
    }
    const requested = typeof req.query.version === 'string' ? req.query.version : '';
    let version: VersionRow | undefined;
    if (requested) {
      const requestedNumber = Number(requested);
      version = Number.isInteger(requestedNumber)
        ? await get<VersionRow>(
            `SELECT id, number, status FROM survey_versions WHERE survey_id = ? AND ${PUBLISHED_ONCE} AND (id = ? OR number = ?)`,
            survey.id,
            requested,
            requestedNumber,
          )
        : await get<VersionRow>(
            `SELECT id, number, status FROM survey_versions WHERE survey_id = ? AND ${PUBLISHED_ONCE} AND id = ?`,
            survey.id,
            requested,
          );
    } else {
      version = await get<VersionRow>(
        `SELECT id, number, status FROM survey_versions WHERE survey_id = ? AND ${PUBLISHED_ONCE} ORDER BY number DESC LIMIT 1`,
        survey.id,
      );
    }
    if (!version) fail(404, 'version_not_found', 'Versi tidak ditemukan.');
    const limit = parseLimit(req.query.limit, 100, 500);
    const offset = Number(req.query.offset ?? 0);
    const safeOffset = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
    // Filter assignment hanya mempersempit versi yang sudah dipilih; assignment milik survei/versi lain
    // menghasilkan himpunan kosong, bukan 404, agar klien tidak bisa membedakan "tidak ada" dari "bukan milikmu".
    const assignmentId = typeof req.query.assignment_id === 'string' ? req.query.assignment_id.trim() : '';
    const assignmentFilter = assignmentId ? ' AND assignment_id = ?' : '';
    const assignmentParams = assignmentId ? [assignmentId] : [];
    const total = Number(
      (await get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM responses WHERE version_id = ?${assignmentFilter}`,
        version.id,
        ...assignmentParams,
      ))?.count ?? 0,
    );
    const responses = await all<ResponseRow>(
      `SELECT id, respondent_id, submitted_at, assignment_id FROM responses WHERE version_id = ?${assignmentFilter} ORDER BY submitted_at, id LIMIT ? OFFSET ?`,
      version.id,
      ...assignmentParams,
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
    await run(
      `INSERT INTO integration_events (id, event_id, type, target, status, attempts, at, simulated, response_id, last_error, payload)
       VALUES (?, ?, 'survey-data.read', 'module_15', 'delivered', 1, ?, 1, NULL, NULL, ?)`,
      newId('evt'),
      newId('event'),
      nowIso(),
      JSON.stringify({ survey_id: survey.id, version_id: version.id, rows: responses.length, offset: safeOffset, limit }),
    );
    await run(
      'INSERT INTO audit_logs (id, actor, action, object, outcome, at, metadata, account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      newId('log'),
      'layanan-15',
      'Ambil data survei',
      `${survey.id} · v${version.number}`,
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
      columns: ['response_id', 'respondent_id', 'submitted_at', 'assignment_id', 'question_code', 'value', 'option_id'],
      free_text_included: false,
      pagination: { limit, offset: safeOffset, total },
      data: responses.map((response) => ({
        response_id: response.id,
        respondent_id: response.respondent_id,
        submitted_at: response.submitted_at,
        assignment_id: response.assignment_id,
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
