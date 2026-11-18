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
  label: string;
  value: number | null;
  count: number;
}

export function summaryFor(versionId: string): VersionSummary {
  const version = get<{ id: string; survey_id: string; number: number; status: string }>(
    'SELECT id, survey_id, number, status FROM survey_versions WHERE id = ?',
    versionId,
  );
  if (!version) {
    return { version_id: versionId, survey_id: '', number: 0, status: 'unknown', total: 0, items: [] };
  }
  const total = get<{ count: number }>(
    'SELECT COUNT(*) AS count FROM responses WHERE version_id = ?',
    versionId,
  )?.count ?? 0;
  const questions = all<QuestionRow>(
    'SELECT id, code, section, label, type, required FROM questions WHERE version_id = ? ORDER BY ord, code',
    versionId,
  );
  const items: SummaryItem[] = questions.map((question) => {
    const options = all<OptionRow>(
      `SELECT o.id, o.label, o.value,
              COUNT(a.id) AS count
         FROM question_options o
         LEFT JOIN answers a
           ON a.option_id = o.id
          AND a.response_id IN (SELECT id FROM responses WHERE version_id = ?)
          AND a.skipped = 0
        WHERE o.question_id = ?
        GROUP BY o.id, o.label, o.value, o.ord
        ORDER BY o.ord`,
      versionId,
      question.id,
    ).map((option) => ({
      option_id: option.id,
      label: option.label,
      value: option.value,
      count: Number(option.count),
    }));
    const answered =
      question.type === 'short_text'
        ? get<{ count: number }>(
            `SELECT COUNT(*) AS count
               FROM answers a JOIN responses r ON r.id = a.response_id
              WHERE r.version_id = ? AND a.question_id = ? AND a.skipped = 0
                AND a.text IS NOT NULL AND TRIM(a.text) <> ''`,
            versionId,
            question.id,
          )?.count ?? 0
        : get<{ count: number }>(
            `SELECT COUNT(*) AS count
               FROM answers a JOIN responses r ON r.id = a.response_id
              WHERE r.version_id = ? AND a.question_id = ? AND a.skipped = 0
                AND a.option_id IS NOT NULL`,
            versionId,
            question.id,
          )?.count ?? 0;
    return {
      question_id: question.id,
      code: question.code,
      section: question.section,
      label: question.label,
      type: question.type,
      required: question.required === 1,
      answered: Number(answered),
      skipped: Math.max(0, total - Number(answered)),
      total,
      options,
      free_text_count:
        question.type === 'short_text'
          ? get<{ count: number }>(
              `SELECT COUNT(*) AS count
                 FROM answers a JOIN responses r ON r.id = a.response_id
                WHERE r.version_id = ? AND a.question_id = ? AND a.skipped = 0
                  AND a.text IS NOT NULL AND TRIM(a.text) <> ''`,
              versionId,
              question.id,
            )?.count ?? 0
          : 0,
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
