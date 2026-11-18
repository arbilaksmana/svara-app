import { get, all } from './db.ts';

export interface SurveyRow {
  id: string;
  owner_id: string;
  profile_id: string;
  title: string;
  purpose: string;
  object_label: string;
  instructions: string;
  status: string;
  created_at: string;
  updated_at: string;
  current_version_id: string | null;
}

export interface VersionRow {
  id: string;
  survey_id: string;
  number: number;
  status: string;
  notice_version: string;
  published_at: string | null;
  closed_at: string | null;
}

export interface QuestionRow {
  id: string;
  version_id: string;
  code: string;
  ord: number;
  type: string;
  required: number;
  section: string;
  label: string;
  hint: string | null;
  group_code: string | null;
  dimension_code: string | null;
  direction: string | null;
}

export interface OptionRow {
  id: string;
  question_id: string;
  ord: number;
  label: string;
  value: number | null;
}

export interface GrantRow {
  id: string;
  account_id: string;
  survey_id: string | null;
  can_read_individual: number;
  can_export: number;
  can_read_free_text: number;
}

export interface PublicProfileRow {
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

export interface Permissions {
  manage: boolean;
  read_aggregate: boolean;
  read_individual: boolean;
  export_data: boolean;
  read_free_text: boolean;
}

export interface PublicAccess {
  ok: boolean;
  code: 'ok' | 'closed' | 'expired' | 'revoked' | 'used' | 'archived' | 'not_found';
  detail: string;
}

export function surveyById(id: string): SurveyRow | undefined {
  return get<SurveyRow>('SELECT * FROM surveys WHERE id = ?', id);
}

export function versionById(id: string): VersionRow | undefined {
  return get<VersionRow>('SELECT * FROM survey_versions WHERE id = ?', id);
}

export function versionsFor(surveyId: string): VersionRow[] {
  return all<VersionRow>('SELECT * FROM survey_versions WHERE survey_id = ? ORDER BY number', surveyId);
}

export function questionsFor(versionId: string): QuestionRow[] {
  return all<QuestionRow>('SELECT * FROM questions WHERE version_id = ? ORDER BY ord', versionId);
}

export function optionsFor(questionId: string): OptionRow[] {
  return all<OptionRow>('SELECT * FROM question_options WHERE question_id = ? ORDER BY ord', questionId);
}

export function grantFor(accountId: string, surveyId: string): GrantRow | undefined {
  return get<GrantRow>('SELECT * FROM access_grants WHERE account_id = ? AND survey_id = ?', accountId, surveyId);
}

export function permissionsFor(accountId: string, role: string, survey: SurveyRow): Permissions {
  const owner = survey.owner_id === accountId;
  const grant = grantFor(accountId, survey.id);
  if (role === 'super_admin' && !owner) {
    return {
      manage: false,
      read_aggregate: Boolean(grant),
      read_individual: Boolean(grant?.can_read_individual),
      export_data: Boolean(grant?.can_export),
      read_free_text: Boolean(grant?.can_read_free_text),
    };
  }
  const settings = get<{ allow_results: number; allow_individual: number }>(
    'SELECT allow_results, allow_individual FROM survey_settings WHERE survey_id = ?',
    survey.id,
  );
  return {
    manage: owner,
    read_aggregate: owner || Boolean(grant && (grant.can_export || grant.can_read_individual)) || Boolean(settings?.allow_results),
    read_individual: Boolean(grant?.can_read_individual),
    export_data: Boolean(grant?.can_export),
    read_free_text: Boolean(grant?.can_read_free_text),
  };
}

export function canSeeSurvey(accountId: string, survey: SurveyRow): boolean {
  if (survey.owner_id === accountId) return true;
  return Boolean(grantFor(accountId, survey.id));
}

export interface ResolvedToken {
  survey: SurveyRow;
  version: VersionRow;
  isPublicLink: boolean;
  linkId: string | null;
  invitationId: string | null;
  invitationCode: string | null;
  assignmentId: string | null;
}

export function resolvePublicToken(token: string): ResolvedToken | null {
  const link = get<{ id: string; survey_id: string; version_id: string; status: string; expires_at: string | null }>(
    'SELECT id, survey_id, version_id, status, expires_at FROM public_links WHERE token_hash = ? OR token = ?',
    hashToken(token),
    token,
  );
  if (link) {
    const survey = surveyById(link.survey_id);
    const version = versionById(link.version_id);
    if (!survey || !version) return null;
    return {
      survey,
      version,
      isPublicLink: true,
      linkId: link.id,
      invitationId: null,
      invitationCode: null,
      assignmentId: null,
    };
  }
  const invitation = get<{
    id: string;
    survey_id: string;
    version_id: string;
    assignment_id: string;
    code: string;
  }>('SELECT id, survey_id, version_id, assignment_id, code FROM invitations WHERE token_hash = ? OR token = ?', hashToken(token), token);
  if (!invitation) return null;
  const survey = surveyById(invitation.survey_id);
  const version = versionById(invitation.version_id);
  if (!survey || !version) return null;
  return {
    survey,
    version,
    isPublicLink: false,
    linkId: null,
    invitationId: invitation.id,
    invitationCode: invitation.code,
    assignmentId: invitation.assignment_id,
  };
}

import { sha256 } from './security.ts';

export function hashToken(token: string): string {
  return sha256(token);
}

export function publicAccessState(token: string): { access: PublicAccess; resolved: ReturnType<typeof resolvePublicToken> } {
  const resolved = resolvePublicToken(token);
  if (!resolved) {
    return { resolved: null, access: { ok: false, code: 'not_found', detail: 'Tautan tidak dikenal.' } };
  }
  const { survey, version, linkId, invitationId } = resolved;
  if (survey.status === 'archived') {
    return { resolved, access: { ok: false, code: 'archived', detail: 'Survei ini sudah diarsipkan.' } };
  }
  if (version.status === 'closed' || version.closed_at) {
    return { resolved, access: { ok: false, code: 'closed', detail: 'Versi ini sudah ditutup untuk kiriman baru.' } };
  }
  if (version.status !== 'published') {
    return { resolved, access: { ok: false, code: 'closed', detail: 'Versi ini belum terbit atau sudah ditutup.' } };
  }
  if (linkId) {
    const link = get<{ status: string; expires_at: string | null }>(
      'SELECT status, expires_at FROM public_links WHERE id = ?',
      linkId,
    );
    if (!link || link.status !== 'active') {
      return { resolved, access: { ok: false, code: 'expired', detail: 'Tautan umum tidak aktif lagi.' } };
    }
    if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
      return { resolved, access: { ok: false, code: 'expired', detail: 'Tautan umum sudah kedaluwarsa.' } };
    }
  }
  if (invitationId) {
    const invitation = get<{ status: string; expires_at: string | null; used_at: string | null }>(
      'SELECT status, expires_at, used_at FROM invitations WHERE id = ?',
      invitationId,
    );
    if (!invitation || invitation.status === 'revoked') {
      return { resolved, access: { ok: false, code: 'revoked', detail: 'Undangan ini sudah dicabut.' } };
    }
    if (invitation.status === 'used' || invitation.used_at) {
      return { resolved, access: { ok: false, code: 'used', detail: 'Undangan ini sudah dipakai untuk satu respons final.' } };
    }
    if (invitation.status === 'expired' || (invitation.expires_at && new Date(invitation.expires_at).getTime() < Date.now())) {
      return { resolved, access: { ok: false, code: 'expired', detail: 'Undangan ini sudah kedaluwarsa.' } };
    }
    if (invitation.status !== 'active') {
      return { resolved, access: { ok: false, code: 'revoked', detail: 'Undangan ini tidak aktif.' } };
    }
  }
  return { resolved, access: { ok: true, code: 'ok', detail: 'Siap menerima respons.' } };
}

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

export interface QuestionInput {
  id?: string;
  code: string;
  order: number;
  type: 'likert' | 'short_text' | 'single_choice';
  required: boolean;
  section: string;
  label: string;
  hint?: string | null;
  group_code?: string | null;
  dimension_code?: string | null;
  direction?: string | null;
  options: Array<{ id?: string; order: number; label: string; value: number | null }>;
}

export interface SurveyInput {
  title: string;
  purpose: string;
  object_label: string;
  instructions: string;
  profile_id?: string;
  notice_version?: string;
  questions: QuestionInput[];
}

/** Draf boleh tidak lengkap; fungsi ini hanya untuk blokir publikasi. */
export function publicationBlockers(input: SurveyInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!input.title.trim()) issues.push({ path: 'title', code: 'title_empty', message: 'Judul survei wajib diisi.' });
  if (!input.purpose.trim()) issues.push({ path: 'purpose', code: 'purpose_empty', message: 'Tujuan survei wajib diisi.' });
  if (input.questions.length === 0) {
    issues.push({ path: 'questions', code: 'no_questions', message: 'Tambahkan minimal satu pertanyaan.' });
  }
  const codes = new Map<string, number>();
  for (const question of input.questions) {
    const label = question.code.trim() || `#${question.order}`;
    const normalized = question.code.trim().toUpperCase();
    if (!normalized) {
      issues.push({ path: `q:${label}`, code: 'code_empty', message: `Kode item ${label} wajib diisi.` });
    } else if (!/^[A-Za-z0-9_-]+$/.test(normalized)) {
      issues.push({ path: `q:${label}`, code: 'code_invalid', message: `Kode item ${label} hanya boleh huruf, angka, garis bawah, atau tanda hubung.` });
    }
    codes.set(normalized, (codes.get(normalized) ?? 0) + 1);
    if (!question.label.trim()) {
      issues.push({ path: `q:${label}`, code: 'label_empty', message: `Label item ${label} wajib diisi.` });
    }
    if (!question.section.trim()) {
      issues.push({ path: `q:${label}`, code: 'section_empty', message: `Bagian item ${label} wajib diisi.` });
    }
    const choice = question.type === 'likert' || question.type === 'single_choice';
    if (choice) {
      if (question.options.length < 2) {
        issues.push({ path: `q:${label}`, code: 'options_min', message: `Item ${label} memerlukan minimal dua opsi.` });
      }
      const values = new Set<number>();
      for (const option of question.options) {
        if (!option.label.trim()) {
          issues.push({ path: `q:${label}`, code: 'option_label_empty', message: `Item ${label} memiliki opsi tanpa label.` });
        }
        if (option.value === null || !Number.isFinite(option.value)) {
          issues.push({ path: `q:${label}`, code: 'option_value_invalid', message: `Item ${label} memiliki nilai opsi yang tidak valid.` });
        } else if (values.has(option.value)) {
          issues.push({ path: `q:${label}`, code: 'option_value_duplicate', message: `Item ${label} memiliki nilai opsi duplikat: ${option.value}.` });
        }
        values.add(option.value ?? Number.NaN);
      }
    } else if (question.options.length > 0) {
      issues.push({ path: `q:${label}`, code: 'options_not_allowed', message: `Item teks ${label} tidak boleh memiliki opsi.` });
    }
  }
  for (const [code, count] of codes) {
    if (count > 1) {
      issues.push({ path: `code:${code}`, code: 'code_duplicate', message: `Kode item ${code} duplikat dalam versi ini.` });
    }
  }
  return issues;
}
