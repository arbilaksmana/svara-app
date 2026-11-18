import { Router } from 'express';
import type { Request, Response } from 'express';
import { all, get, nowIso, run } from '../db.ts';
import { fail, newId, parseLimit, sendError } from '../http.ts';

interface SurveyRow {
  id: string;
  title: string;
  status: string;
  current_version_id: string | null;
}

interface VersionRow {
  id: string;
  number: number;
  status: string;
}

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

function serviceAuthorized(req: Request): boolean {
  const expected = process.env.INTEGRATION_TOKEN;
  const header = req.get('authorization') ?? '';
  return Boolean(expected) && header === `Bearer ${expected}`;
}

integrationRouter.get('/integration/survey-data', async (req: Request, res: Response) => {
  try {
    if (!serviceAuthorized(req)) {
      fail(401, 'unauthenticated_service', 'Kredensial layanan tidak valid.');
    }
    const surveyId = typeof req.query.survey_id === 'string' ? req.query.survey_id : '';
    const survey = await get<SurveyRow>('SELECT id, title, status, current_version_id FROM surveys WHERE id = ?', surveyId);
    if (!survey) fail(404, 'not_found', 'Survei tidak ditemukan untuk cakupan layanan.');
    const requested = typeof req.query.version === 'string' ? req.query.version : '';
    let version: VersionRow | undefined;
    if (requested) {
      const requestedNumber = Number(requested);
      version = Number.isInteger(requestedNumber)
        ? await get<VersionRow>(
            'SELECT id, number, status FROM survey_versions WHERE survey_id = ? AND (id = ? OR number = ?)',
            survey.id,
            requested,
            requestedNumber,
          )
        : await get<VersionRow>(
            'SELECT id, number, status FROM survey_versions WHERE survey_id = ? AND id = ?',
            survey.id,
            requested,
          );
    } else {
      version = await get<VersionRow>(
        "SELECT id, number, status FROM survey_versions WHERE survey_id = ? AND status = 'published' ORDER BY number DESC LIMIT 1",
        survey.id,
      );
    }
    if (!version) fail(404, 'version_not_found', 'Versi tidak ditemukan.');
    const limit = parseLimit(req.query.limit, 100, 500);
    const offset = Number(req.query.offset ?? 0);
    const safeOffset = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
    const total = Number(
      (await get<{ count: number }>('SELECT COUNT(*) AS count FROM responses WHERE version_id = ?', version.id))?.count ?? 0,
    );
    const responses = await all<ResponseRow>(
      'SELECT id, respondent_id, submitted_at, assignment_id FROM responses WHERE version_id = ? ORDER BY submitted_at, id LIMIT ? OFFSET ?',
      version.id,
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
      'INSERT INTO audit_logs (id, actor, action, object, outcome, at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
      newId('log'),
      'layanan-15',
      'Ambil data survei',
      `${survey.id} · v${version.number}`,
      'berhasil',
      nowIso(),
      null,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      schema_version: 1,
      simulated: true,
      label: 'SIMULASI Modul 15 — bukan integrasi nyata.',
      survey_id: survey.id,
      survey_version: version.number,
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
