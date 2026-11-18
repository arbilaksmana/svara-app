import { all, get, nowIso } from './db.ts';
import type { AccountRow } from './security.ts';
import { canReadAggregate, type SurveyRow } from './http.ts';
import { summaryFor, type VersionSummary } from './summary.ts';

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

interface VersionRow {
  id: string;
  survey_id: string;
  number: number;
  status: string;
  notice_version: string;
  published_at: string | null;
  closed_at: string | null;
}

interface QuestionRow {
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
}

interface OptionRow {
  id: string;
  question_id: string;
  ord: number;
  label: string;
  value: number | null;
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
  token_hash: string;
}

interface PublicLinkRow {
  id: string;
  survey_id: string;
  version_id: string;
  token: string;
  label: string;
  status: string;
  expires_at: string | null;
}

interface AssignmentRow {
  id: string;
  survey_id: string;
  version_id: string;
  label: string;
  participant_ref: string;
}

interface GrantRow {
  id: string;
  account_id: string;
  survey_id: string | null;
  can_read_individual: number;
  can_export: number;
  can_read_free_text: number;
}

interface AccountAdminRow {
  id: string;
  email: string;
  display_name: string;
  role: string;
  status: string;
}

interface AuditRow {
  id: string;
  actor: string;
  action: string;
  object: string;
  outcome: string;
  at: string;
  metadata: string | null;
}

interface IntegrationRow {
  id: string;
  event_id: string;
  type: string;
  target: string;
  status: string;
  attempts: number;
  at: string;
  simulated: number;
  response_id: string | null;
  last_error: string | null;
}

interface DataRequestRow {
  id: string;
  type: string;
  contact: string;
  note: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  handled_by: string | null;
  outcome_note: string | null;
}

function placeholders(values: string[]): string {
  return values.map(() => '?').join(',');
}

function boolean(value: number): boolean {
  return value === 1;
}

function optionalBoolean(value: number | null): boolean | null {
  return value === null ? null : boolean(value);
}

async function accessibleSurveys(account: AccountRow): Promise<SurveyRow[]> {
  if (account.role === 'super_admin') {
    return all<SurveyRow>('SELECT * FROM surveys ORDER BY updated_at DESC, id');
  }
  if (account.role === 'creator') {
    return all<SurveyRow>('SELECT * FROM surveys WHERE owner_id = ? ORDER BY updated_at DESC, id', account.id);
  }
  return all<SurveyRow>(
    `SELECT DISTINCT s.*
       FROM surveys s JOIN access_grants g ON g.survey_id = s.id
      WHERE g.account_id = ?
      ORDER BY s.updated_at DESC, s.id`,
    account.id,
  );
}

export interface BootstrapPayload {
  account: (AccountRow & { email: string }) | null;
  profiles: unknown[];
  notices: unknown[];
  surveys: unknown[];
  versions: unknown[];
  questions: unknown[];
  options: unknown[];
  invitations: unknown[];
  publicLinks: unknown[];
  assignments: unknown[];
  settings: Record<string, { allowResults: boolean; allowIndividual: boolean }>;
  grants: unknown[];
  accounts: unknown[];
  auditLogs: unknown[];
  integrationEvents: unknown[];
  dataRequests: unknown[];
  summaries: Record<string, VersionSummary>;
  serverTime: string;
}

export async function buildBootstrap(account: AccountRow | undefined): Promise<BootstrapPayload> {
  const profiles = (await all<ProfileRow>('SELECT * FROM profiles ORDER BY id')).map((row) => ({
    ...row,
    cross_border_transfer: optionalBoolean(row.cross_border_transfer),
    synthetic_placeholder: boolean(row.synthetic_placeholder),
  }));
  const notices = (await all<NoticeRow>('SELECT * FROM notices ORDER BY profile_id, version')).map((row) => ({
    ...row,
    synthetic_placeholder: boolean(row.synthetic_placeholder),
  }));

  if (!account) {
    return {
      account: null,
      profiles,
      notices,
      surveys: [],
      versions: [],
      questions: [],
      options: [],
      invitations: [],
      publicLinks: [],
      assignments: [],
      settings: {},
      grants: [],
      accounts: [],
      auditLogs: [],
      integrationEvents: [],
      dataRequests: [],
      summaries: {},
      serverTime: nowIso(),
    };
  }

  const surveys = await accessibleSurveys(account);
  const surveyIds = surveys.map((row) => row.id);
  const versions = surveyIds.length
    ? await all<VersionRow>(
        `SELECT * FROM survey_versions WHERE survey_id IN (${placeholders(surveyIds)}) ORDER BY survey_id, number`,
        ...surveyIds,
      )
    : [];
  const versionIds = versions.map((row) => row.id);
  const questions = versionIds.length
    ? await all<QuestionRow>(
        `SELECT * FROM questions WHERE version_id IN (${placeholders(versionIds)}) ORDER BY version_id, ord`,
        ...versionIds,
      )
    : [];
  const questionIds = questions.map((row) => row.id);
  const options = questionIds.length
    ? await all<OptionRow>(
        `SELECT * FROM question_options WHERE question_id IN (${placeholders(questionIds)}) ORDER BY question_id, ord`,
        ...questionIds,
      )
    : [];

  const versionQuestionIds = new Map<string, string[]>();
  const questionOptionIds = new Map<string, string[]>();
  for (const question of questions) {
    const list = versionQuestionIds.get(question.version_id) ?? [];
    list.push(question.id);
    versionQuestionIds.set(question.version_id, list);
  }
  for (const option of options) {
    const list = questionOptionIds.get(option.question_id) ?? [];
    list.push(option.id);
    questionOptionIds.set(option.question_id, list);
  }

  const manageableSurveyIds = surveys
    .filter((survey) => account.role === 'super_admin' || survey.owner_id === account.id)
    .map((survey) => survey.id);
  const invitations = manageableSurveyIds.length
    ? (
        await all<InvitationRow>(
          `SELECT * FROM invitations WHERE survey_id IN (${placeholders(manageableSurveyIds)}) ORDER BY created_at DESC`,
          ...manageableSurveyIds,
        )
      ).map((row) => ({
        ...row,
        status:
          row.status === 'active' && row.expires_at && new Date(row.expires_at).getTime() < Date.now()
            ? 'expired'
            : row.status,
        token_hash: '',
      }))
    : [];
  const publicLinks = manageableSurveyIds.length
    ? (
        await all<PublicLinkRow>(
          `SELECT * FROM public_links WHERE survey_id IN (${placeholders(manageableSurveyIds)}) ORDER BY created_at DESC`,
          ...manageableSurveyIds,
        )
      ).map((row) => {
        const version = versions.find((item) => item.id === row.version_id);
        const status =
          row.status === 'active' && row.expires_at && new Date(row.expires_at).getTime() < Date.now()
            ? 'expired'
            : row.status === 'active' && version?.status === 'closed'
              ? 'closed'
              : row.status;
        return { ...row, url: `/s/${row.token}`, status };
      })
    : [];
  const assignments = manageableSurveyIds.length
    ? await all<AssignmentRow>(
        `SELECT * FROM assignments WHERE survey_id IN (${placeholders(manageableSurveyIds)}) ORDER BY id`,
        ...manageableSurveyIds,
      )
    : [];

  const grants =
    account.role === 'super_admin'
      ? await all<GrantRow>('SELECT * FROM access_grants ORDER BY account_id, survey_id')
      : await all<GrantRow>('SELECT * FROM access_grants WHERE account_id = ? ORDER BY survey_id', account.id);
  const accounts =
    account.role === 'super_admin'
      ? await all<AccountAdminRow>('SELECT id, email, display_name, role, status FROM accounts ORDER BY display_name')
      : [];
  const auditLogs =
    account.role === 'super_admin'
      ? await all<AuditRow>('SELECT * FROM audit_logs ORDER BY at DESC LIMIT 250')
      : [];
  const integrationEvents =
    account.role === 'super_admin'
      ? await all<IntegrationRow>('SELECT * FROM integration_events ORDER BY at DESC LIMIT 250')
      : [];
  const dataRequests =
    account.role === 'super_admin'
      ? await all<DataRequestRow>('SELECT * FROM data_requests ORDER BY created_at DESC LIMIT 250')
      : [];

  const settingsRows = surveyIds.length
    ? await all<{ survey_id: string; allow_results: number; allow_individual: number }>(
        `SELECT * FROM survey_settings WHERE survey_id IN (${placeholders(surveyIds)})`,
        ...surveyIds,
      )
    : [];
  const settings = Object.fromEntries(
    settingsRows.map((row) => [
      row.survey_id,
      { allowResults: boolean(row.allow_results), allowIndividual: boolean(row.allow_individual) },
    ]),
  );

  const summaries: Record<string, VersionSummary> = {};
  for (const version of versions) {
    const survey = surveys.find((item) => item.id === version.survey_id);
    if (survey && (await canReadAggregate(account, survey))) {
      summaries[version.id] = await summaryFor(version.id);
    }
  }

  return {
    account: { ...account, email: account.email },
    profiles,
    notices,
    surveys: surveys.map((row) => ({ ...row })),
    versions: versions.map((row) => ({ ...row, question_ids: versionQuestionIds.get(row.id) ?? [] })),
    questions: questions.map((row) => ({
      ...row,
      order: row.ord,
      required: boolean(row.required),
      option_ids: questionOptionIds.get(row.id) ?? [],
    })),
    options: options.map((row) => ({ ...row, order: row.ord })),
    invitations,
    publicLinks,
    assignments,
    settings,
    grants: grants.map((row) => ({
      ...row,
      can_read_individual: boolean(row.can_read_individual),
      can_export: boolean(row.can_export),
      can_read_free_text: boolean(row.can_read_free_text),
    })),
    accounts: accounts.map((row) => ({ ...row, active: row.status === 'active' })),
    auditLogs,
    integrationEvents: integrationEvents.map((row) => ({ ...row, simulated: boolean(row.simulated) })),
    dataRequests,
    summaries,
    serverTime: nowIso(),
  };
}

export async function sidebarCounts(account: AccountRow): Promise<{ surveys: number; responses: number }> {
  const surveyIds = (await accessibleSurveys(account)).map((row) => row.id);
  if (surveyIds.length === 0) return { surveys: 0, responses: 0 };
  const responses =
    (
      await get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM responses WHERE survey_id IN (${placeholders(surveyIds)})`,
        ...surveyIds,
      )
    )?.count ?? 0;
  return { surveys: surveyIds.length, responses: Number(responses) };
}
