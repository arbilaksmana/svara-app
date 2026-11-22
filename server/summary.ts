import { all, get } from './db.ts';

export interface SummaryOption {
  option_id: string;
  label: string;
  value: number | null;
  count: number;
}

export interface SummaryItem {
  question_id: string;
  code: string;
  section: string;
  label: string;
  type: 'likert' | 'short_text' | 'single_choice';
  required: boolean;
  answered: number;
  skipped: number;
  total: number;
  options: SummaryOption[];
  free_text_count: number;
}

export interface VersionSummary {
  version_id: string;
  survey_id: string;
  number: number;
  status: string;
  total: number;
  items: SummaryItem[];
}

interface QuestionRow {
  id: string;
  code: string;
  section: string;
  label: string;
  type: SummaryItem['type'];
  required: number;
}

interface OptionRow {
  id: string;
  question_id: string;
  label: string;
  value: number | null;
}

interface OptionCountRow {
  option_id: string;
  count: number;
}

interface AnsweredRow {
  question_id: string;
  with_option: number;
  with_text: number;
}

/**
 * Ringkasan satu versi dengan jumlah query tetap: hitungan opsi dan hitungan terjawab
 * diagregasi sekali per versi lalu disusun per pertanyaan, bukan dua query per pertanyaan.
 */
export async function summaryFor(versionId: string): Promise<VersionSummary> {
  const version = await get<{ id: string; survey_id: string; number: number; status: string }>(
    'SELECT id, survey_id, number, status FROM survey_versions WHERE id = ?',
    versionId,
  );
  if (!version) {
    return { version_id: versionId, survey_id: '', number: 0, status: 'unknown', total: 0, items: [] };
  }
  const [totalRow, questions, options, optionCounts, answeredRows] = await Promise.all([
    get<{ count: number }>('SELECT COUNT(*) AS count FROM responses WHERE version_id = ?', versionId),
    all<QuestionRow>(
      'SELECT id, code, section, label, type, required FROM questions WHERE version_id = ? ORDER BY ord, code',
      versionId,
    ),
    all<OptionRow>(
      `SELECT o.id, o.question_id, o.label, o.value
         FROM question_options o JOIN questions q ON q.id = o.question_id
        WHERE q.version_id = ?
        ORDER BY o.question_id, o.ord, o.id`,
      versionId,
    ),
    all<OptionCountRow>(
      `SELECT a.option_id, COUNT(*) AS count
         FROM answers a JOIN responses r ON r.id = a.response_id
        WHERE r.version_id = ? AND a.skipped = 0 AND a.option_id IS NOT NULL
        GROUP BY a.option_id`,
      versionId,
    ),
    all<AnsweredRow>(
      `SELECT a.question_id,
              COUNT(*) FILTER (WHERE a.option_id IS NOT NULL) AS with_option,
              COUNT(*) FILTER (WHERE a.text IS NOT NULL AND TRIM(a.text) <> '') AS with_text
         FROM answers a JOIN responses r ON r.id = a.response_id
        WHERE r.version_id = ? AND a.skipped = 0
        GROUP BY a.question_id`,
      versionId,
    ),
  ]);
  const total = totalRow?.count ?? 0;
  const countByOption = new Map(optionCounts.map((row) => [row.option_id, Number(row.count)]));
  const answeredByQuestion = new Map(answeredRows.map((row) => [row.question_id, row]));
  const optionsByQuestion = new Map<string, SummaryOption[]>();
  for (const option of options) {
    const list = optionsByQuestion.get(option.question_id) ?? [];
    list.push({ option_id: option.id, label: option.label, value: option.value, count: countByOption.get(option.id) ?? 0 });
    optionsByQuestion.set(option.question_id, list);
  }
  const items = questions.map((question): SummaryItem => {
    const row = answeredByQuestion.get(question.id);
    const answered = Number((question.type === 'short_text' ? row?.with_text : row?.with_option) ?? 0);
    return {
      question_id: question.id,
      code: question.code,
      section: question.section,
      label: question.label,
      type: question.type,
      required: question.required === 1,
      answered,
      skipped: Math.max(0, total - answered),
      total,
      options: optionsByQuestion.get(question.id) ?? [],
      free_text_count: question.type === 'short_text' ? answered : 0,
    };
  });
  return {
    version_id: version.id,
    survey_id: version.survey_id,
    number: version.number,
    status: version.status,
    total,
    items,
  };
}
