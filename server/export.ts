import { all } from './db.ts';
import { optionsFor, questionsFor, type QuestionRow, type VersionRow } from './survey-service.ts';

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** Netralkan teks yang tampak seperti formula tanpa mengubah nilai tersimpan di basis data. */
export function neutralizeFormula(value: string): string {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

export function csvCell(value: string | number | null | undefined, neutralize = false): string {
  if (value === null || value === undefined) return '';
  const raw = String(value);
  const safe = neutralize ? neutralizeFormula(raw) : raw;
  if (/[",\r\n]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

export function csvRows(rows: Array<Array<string | number | null | undefined>>, neutralizeColumns: number[] = []): string {
  return rows
    .map((row) => row.map((cell, index) => csvCell(cell, neutralizeColumns.includes(index))).join(','))
    .join('\r\n');
}

export interface ExportAnswer {
  question_code: string;
  option_id: string | null;
  value: number | null;
  text: string | null;
  skipped: number;
}

export interface ExportResponse {
  id: string;
  respondent_id: string;
  survey_id: string;
  version_id: string;
  assignment_id: string | null;
  collection_mode: string;
  identity_source: string;
  submitted_at: string;
  answers: ExportAnswer[];
}

export async function responsesForVersion(versionId: string): Promise<ExportResponse[]> {
  const responses = await all<Omit<ExportResponse, 'answers'>>(
    `SELECT id, respondent_id, survey_id, version_id, assignment_id, collection_mode, identity_source, submitted_at
       FROM responses WHERE version_id = ? ORDER BY submitted_at, id`,
    versionId,
  );
  return Promise.all(
    responses.map(async (response) => ({
      ...response,
      answers: await all<ExportAnswer>(
        'SELECT question_code, option_id, value, text, skipped FROM answers WHERE response_id = ? ORDER BY question_code',
        response.id,
      ),
    })),
  );
}

/** CSV standar PRD §7.1: satu baris per respons, satu versi, tanpa token dan nama. */
export async function buildCsv(version: VersionRow, includeFreeText: boolean): Promise<string> {
  const questions = await questionsFor(version.id);
  const responses = await responsesForVersion(version.id);
  const header = [
    'response_id',
    'respondent_id',
    'survey_id',
    'survey_version',
    'assignment_id',
    'collection_mode',
    'identity_source',
    'submitted_at',
    ...questions.map((question) => question.code),
  ];
  const rows: Array<Array<string | number | null>> = [header];
  for (const response of responses) {
    const answerMap = new Map(response.answers.map((answer) => [answer.question_code, answer]));
    const cells: Array<string | number | null> = [
      response.id,
      response.respondent_id,
      response.survey_id,
      version.number,
      response.assignment_id ?? '',
      response.collection_mode,
      response.identity_source,
      response.submitted_at,
    ];
    for (const question of questions) {
      const answer = answerMap.get(question.code);
      if (!answer || answer.skipped === 1) {
        cells.push('');
      } else if (question.type === 'short_text') {
        cells.push(includeFreeText && answer.text ? answer.text : '');
      } else {
        cells.push(answer.value === null ? '' : answer.value);
      }
    }
    rows.push(cells);
  }
  const freeTextIndexes = questions
    .map((question, index) => (question.type === 'short_text' ? index + 8 : -1))
    .filter((index) => index >= 0);
  return `\uFEFF${csvRows(rows, freeTextIndexes)}\r\n`;
}

/** Kodebook per versi; teks item teks bebas hanya untuk penerima berizin. */
export async function buildCodebook(version: VersionRow, includeFreeText: boolean): Promise<string> {
  const questions = await questionsFor(version.id);
  const rows: Array<Array<string | number | null>> = [
    [
      'survey_version',
      'code',
      'label',
      'type',
      'required',
      'section',
      'group_code',
      'dimension_code',
      'direction',
      'values',
      'blank_meaning',
      'free_text_included',
    ],
  ];
  for (const question of questions) {
    if (question.type === 'short_text' && !includeFreeText) continue;
    const options = await optionsFor(question.id);
    rows.push([
      version.number,
      question.code,
      question.label,
      question.type,
      question.required === 1 ? 'wajib' : 'opsional',
      question.section,
      question.group_code ?? '',
      question.dimension_code ?? '',
      question.direction ?? '',
      options.length > 0 ? options.map((option) => `${option.value ?? ''}=${option.label}`).join('; ') : 'teks bebas',
      question.required === 1 ? 'tidak diizinkan untuk item wajib' : 'dilewati (tidak dihitung nol)',
      question.type === 'short_text' ? (includeFreeText ? 'ya' : 'tidak') : 'tidak berlaku',
    ]);
  }
  return `\uFEFF${csvRows(rows, [2])}\r\n`;
}

/** Data individual untuk API; hanya dipanggil setelah izin `can_read_individual`. */
export async function individualResponses(version: VersionRow, includeFreeText: boolean) {
  const questions = await questionsFor(version.id);
  const questionMap = new Map(questions.map((question) => [question.code, question]));
  return (await responsesForVersion(version.id)).map((response) => ({
    id: response.id,
    respondent_id: response.respondent_id,
    assignment_id: response.assignment_id,
    collection_mode: response.collection_mode,
    identity_source: response.identity_source,
    submitted_at: response.submitted_at,
    answers: response.answers.map((answer) => {
      const question = questionMap.get(answer.question_code);
      const isText = question?.type === 'short_text';
      return {
        question_code: answer.question_code,
        option_id: answer.option_id,
        value: answer.value,
        text: isText ? (includeFreeText ? answer.text : null) : null,
        text_redacted: Boolean(isText && !includeFreeText && answer.text),
        skipped: answer.skipped === 1,
      };
    }),
  }));
}

export type { QuestionRow };
