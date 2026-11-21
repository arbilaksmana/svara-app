import type {
  AccessGrant,
  Account,
  AccountStatus,
  OrgAuditRow,
  OrgInvitation,
  OrgMember,
  OrgProfile,
  OrganizationSummary,
  PlatformProfile,
  AuditLog,
  DeploymentProfile,
  IntegrationEvent,
  Invitation,
  Notice,
  PublicLink,
  Question,
  QuestionOption,
  Survey,
  SurveyProfile,
  SurveyVersion,
} from './types';

interface ApiErrorBody {
  error?: string;
  code?: string;
  details?: unknown;
}

export class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error ?? 'Permintaan tidak dapat diselesaikan.');
    this.status = status;
    this.code = body.code ?? `http_${status}`;
    this.details = body.details;
  }
}

interface CallOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

async function call<T>(path: string, options: CallOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  headers.set('X-Svara-Client', 'web');
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0, { code: 'network_error', error: 'Server tidak dapat dijangkau. Periksa koneksi lalu coba lagi.' });
  }
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const body = payload && typeof payload === 'object' ? (payload as ApiErrorBody) : {};
    throw new ApiError(response.status, body);
  }
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return payload.data as T;
  }
  return payload as T;
}

export interface BootstrapData {
  account: (Account & { email: string }) | null;
  profiles: DeploymentProfile[];
  notices: Notice[];
  surveys: Survey[];
  surveyProfiles: Record<string, SurveyProfile>;
  versions: SurveyVersion[];
  questions: Array<Question & { ord?: number }>;
  options: QuestionOption[];
  invitations: Array<Invitation & { token?: string }>;
  publicLinks: PublicLink[];
  assignments: Array<{ id: string; survey_id: string; version_id: string; label: string; participant_ref: string }>;
  settings: Record<string, { allowResults: boolean; allowIndividual: boolean }>;
  grants: AccessGrant[];
  accounts: Account[];
  organizations: OrganizationSummary[];
  auditLogs: AuditLog[];
  integrationEvents: IntegrationEvent[];
  dataRequests: Array<Record<string, unknown>>;
  summaries: Record<string, unknown>;
  serverTime: string;
}

export async function bootstrap(): Promise<BootstrapData> {
  return call<BootstrapData>('/bootstrap');
}

export async function login(email: string, password: string): Promise<{ account: Account & { email: string } }> {
  return call<{ account: Account & { email: string } }>('/auth/login', {
    method: 'POST',
    body: { email, password },
  });
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  acceptTerms: boolean;
  invite_code?: string;
}

export async function register(input: RegisterInput): Promise<{ account: Account & { email: string } }> {
  return call<{ account: Account & { email: string } }>('/auth/register', {
    method: 'POST',
    body: input,
  });
}

export async function logout(): Promise<void> {
  await call('/auth/logout', { method: 'POST' });
}

export interface SurveyDetail {
  survey: Survey;
  versions: SurveyVersion[];
  questions: Array<Question & { options: QuestionOption[] }>;
  profile: SurveyProfile;
}

export async function getSurvey(id: string): Promise<SurveyDetail> {
  return call<SurveyDetail>(`/surveys/${encodeURIComponent(id)}`);
}

export interface QuestionPayload {
  code: string;
  type: Question['type'];
  required: boolean;
  section: string;
  label: string;
  hint: string | null;
  group_code: string | null;
  dimension_code: string | null;
  direction: string | null;
  options: Array<{ label: string; value: number }>;
}

export interface SurveyPayload {
  title: string;
  purpose: string;
  object_label: string;
  instructions: string;
  questions: QuestionPayload[];
}

export type SurveyScope = 'individual' | 'organization';

export async function createSurvey(title: string, ownerScope?: SurveyScope): Promise<SurveyDetail> {
  return call<SurveyDetail>('/surveys', { method: 'POST', body: { title, owner_scope: ownerScope } });
}

export async function saveSurvey(id: string, payload: SurveyPayload): Promise<SurveyDetail> {
  return call<SurveyDetail>(`/surveys/${encodeURIComponent(id)}`, { method: 'PUT', body: payload });
}

export interface PublishResult {
  version: SurveyVersion;
  publicLink: { token: string; url: string };
  detail: SurveyDetail;
}

export async function publishSurvey(id: string): Promise<PublishResult> {
  return call<PublishResult>(`/surveys/${encodeURIComponent(id)}/publish`, { method: 'POST' });
}

export async function duplicateSurvey(id: string): Promise<SurveyDetail> {
  return call<SurveyDetail>(`/surveys/${encodeURIComponent(id)}/duplicate`, { method: 'POST' });
}

export async function closeSurvey(id: string): Promise<void> {
  await call(`/surveys/${encodeURIComponent(id)}/close`, { method: 'POST' });
}

export async function archiveSurvey(id: string): Promise<void> {
  await call(`/surveys/${encodeURIComponent(id)}/archive`, { method: 'POST' });
}

export async function createInvitation(
  id: string,
  label: string,
  expiresAt: string,
): Promise<{ invitation: Invitation; token: string; url: string }> {
  return call<{ invitation: Invitation; token: string; url: string }>(
    `/surveys/${encodeURIComponent(id)}/invitations`,
    { method: 'POST', body: { label, expires_at: expiresAt } },
  );
}

export async function revokeInvitation(id: string): Promise<void> {
  await call(`/invitations/${encodeURIComponent(id)}/revoke`, { method: 'POST' });
}

export async function saveSettings(id: string, allowResults: boolean, allowIndividual: boolean): Promise<void> {
  await call(`/surveys/${encodeURIComponent(id)}/settings`, {
    method: 'PUT',
    body: { allowResults, allowIndividual },
  });
}

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
  type: Question['type'];
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

export async function getSummary(id: string, versionId?: string): Promise<VersionSummary> {
  const query = versionId ? `?version=${encodeURIComponent(versionId)}` : '';
  return call<VersionSummary>(`/surveys/${encodeURIComponent(id)}/summary${query}`);
}

export interface ResponseAnswer {
  question_code: string;
  option_id: string | null;
  value: number | string | null;
  text: string | null;
  skipped: boolean;
}

export interface IndividualResponse {
  id: string;
  respondent_id: string;
  submitted_at: string;
  collection_mode: string;
  identity_source: string;
  answers: ResponseAnswer[];
}

export async function getResponses(id: string, versionId: string): Promise<IndividualResponse[]> {
  return call<IndividualResponse[]>(
    `/surveys/${encodeURIComponent(id)}/responses?version=${encodeURIComponent(versionId)}`,
  );
}

export async function downloadExport(id: string, versionId: string, format: 'csv' | 'codebook'): Promise<{ blob: Blob; filename: string }> {
  let response: Response;
  try {
    response = await fetch(
      `/api/v1/surveys/${encodeURIComponent(id)}/export?version=${encodeURIComponent(versionId)}&format=${format}`,
      { credentials: 'same-origin', headers: { 'X-Svara-Client': 'web' } },
    );
  } catch {
    throw new ApiError(0, { code: 'network_error', error: 'Server tidak dapat dijangkau.' });
  }
  if (!response.ok) {
    let body: ApiErrorBody = {};
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      body = {};
    }
    throw new ApiError(response.status, body);
  }
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  return { blob: await response.blob(), filename: match?.[1] ?? `ekspor-${id}.${format === 'csv' ? 'csv' : 'md'}` };
}

export async function adminSaveGrants(
  accountId: string,
  grants: Array<{
    survey_id: string | null;
    can_read_individual: boolean;
    can_export: boolean;
    can_read_free_text: boolean;
  }>,
): Promise<void> {
  await call(`/admin/grants/${encodeURIComponent(accountId)}`, { method: 'PUT', body: { grants } });
}

export async function adminRetryEvent(id: string): Promise<void> {
  await call(`/admin/integration/${encodeURIComponent(id)}/retry`, { method: 'POST' });
}

export interface AdminStats {
  accounts: number;
  surveys: number;
  responses: number;
  pendingRequests: number;
  perCreator: Array<{ id: string; display_name: string; surveys: number; responses: number }>;
  perSurvey: Array<{ id: string; title: string; owner: string; versions: number; responses: number }>;
}


export type DataRequestStatus = 'pending' | 'in_progress' | 'handled' | 'rejected';

export interface DataRequest {
  id: string;
  type: string;
  contact: string;
  note: string | null;
  status: DataRequestStatus;
  outcome_note: string | null;
  handled_by: string | null;
  created_at: string;
  updated_at: string;
}

export async function submitDataRequest(input: { type: string; contact: string; note?: string }): Promise<DataRequest> {
  return call<DataRequest>('/data-requests', { method: 'POST', body: input });
}

export async function getDataRequests(): Promise<DataRequest[]> {
  return call<DataRequest[]>('/admin/data-requests');
}

export async function updateDataRequest(id: string, status: DataRequestStatus, outcomeNote: string): Promise<{ ok: boolean; status: DataRequestStatus }> {
  return call<{ ok: boolean; status: DataRequestStatus }>(`/admin/data-requests/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { status, outcome_note: outcomeNote },
  });
}

export async function adminStats(): Promise<AdminStats> {
  return call<AdminStats>('/admin/stats');
}

export interface PublicContextData {
  kind: 'public' | 'invitation';
  isPublicLink: boolean;
  state: 'active' | 'closed' | 'expired' | 'revoked' | 'used';
  canSubmit: boolean;
  guardianRequired: boolean;
  retryOnly?: true;
  survey: Survey;
  version: SurveyVersion;
  questions: Question[];
  options: QuestionOption[];
  profile: DeploymentProfile;
  notice: Notice;
  invitation: (Invitation & { token?: string }) | null;
  assignment: { id: string; survey_id: string; version_id: string; label: string; participant_ref: string } | null;
}

export async function publicContext(token: string): Promise<PublicContextData> {
  return call<PublicContextData>(`/public/surveys/${encodeURIComponent(token)}`);
}

export interface PublicFormData extends PublicContextData {
  consent: {
    consent_id: string;
    notice_version: string;
    basis: string;
    guardian_evidence_status: string;
  };
}

export async function publicForm(token: string, consentId: string, view: 'form' | 'review'): Promise<PublicFormData> {
  return call<PublicFormData>(
    `/public/surveys/${encodeURIComponent(token)}/${view}?consent_id=${encodeURIComponent(consentId)}`,
  );
}

export interface ConsentPayload {
  consent_id: string;
  respondent_click: boolean;
  basis: string;
  notice_version: string;
  guardian_evidence_status: 'not_required' | 'self_attested';
  guardian_evidence_ref: string | null;
}

export interface ConsentRecord {
  consent_id: string;
  notice_version: string;
  basis: string;
  guardian_evidence_status: string;
  recorded_at: string;
}

export async function createConsent(
  token: string,
  guardianEvidenceRef: string | null,
): Promise<ConsentRecord> {
  return call<ConsentRecord>(`/public/surveys/${encodeURIComponent(token)}/consent`, {
    method: 'POST',
    body: { respondent_click: true, eligibility: true, guardian_evidence_ref: guardianEvidenceRef ?? undefined },
  });
}

export interface AnswerPayload {
  question_code: string;
  option_id?: string | null;
  text?: string | null;
}

export interface ReceiptData {
  response_id: string;
  survey_id: string;
  version_id: string;
  version_number: number;
  submitted_at: string;
  status: string;
  idempotency_key: string;
}

export async function submitResponse(
  token: string,
  idempotencyKey: string,
  consentId: string,
  answers: AnswerPayload[],
): Promise<ReceiptData> {
  return call<ReceiptData>(`/public/surveys/${encodeURIComponent(token)}/responses`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: { consent_id: consentId, answers },
  });
}

export async function getReceipt(token: string, responseId: string, idempotencyKey: string): Promise<ReceiptData> {
  return call<ReceiptData>(
    `/public/surveys/${encodeURIComponent(token)}/receipt/${encodeURIComponent(responseId)}`,
    { headers: { 'Idempotency-Key': idempotencyKey } },
  );
}

export async function resolveInvitationCode(code: string): Promise<{ token: string; url: string }> {
  return call<{ token: string; url: string }>('/public/invitations/resolve', {
    method: 'POST',
    body: { code },
  });
}

export async function adminSaveAccount(
  id: string,
  patch: { role?: string; status?: string; organization_id?: string | null },
): Promise<void> {
  await call(`/admin/accounts/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });
}

export interface NewOrganizationInput {
  name: string;
  organization_type: OrganizationSummary['organization_type'];
  admin: { display_name: string; email: string; password: string };
}

/** Onboarding: organisasi baru sekaligus admin pertamanya. */
export async function adminCreateOrganization(
  input: NewOrganizationInput,
): Promise<{ organization: OrganizationSummary; account: Account }> {
  return call<{ organization: OrganizationSummary; account: Account }>('/admin/organizations', {
    method: 'POST',
    body: input,
  });
}

/** Halaman organisasi: organisasi selalu ditentukan sesi server, bukan parameter klien. */
export async function getOrgProfile(): Promise<{ source: string; profile: OrgProfile }> {
  return call<{ source: string; profile: OrgProfile }>('/org/profile');
}

export type OrgProfileInput = Partial<
  Pick<
    OrgProfile,
    | 'organization_name'
    | 'organization_type'
    | 'policy_url'
    | 'terms_url'
    | 'retention_days'
    | 'data_request_contact'
    | 'respondent_age_category'
    | 'consent_mode'
  >
> & { cross_border_transfer?: boolean | null };

export async function saveOrgProfile(input: OrgProfileInput): Promise<{ source: string; profile: OrgProfile }> {
  return call<{ source: string; profile: OrgProfile }>('/org/profile', { method: 'PUT', body: input });
}

export async function getPlatformProfile(): Promise<PlatformProfile> {
  return (await call<{ profile: PlatformProfile }>('/admin/platform-profile')).profile;
}

export type PlatformProfileInput = Partial<
  Pick<
    PlatformProfile,
    'organization_name' | 'organization_type' | 'policy_url' | 'terms_url' | 'retention_days' | 'data_request_contact'
  >
> & { cross_border_transfer?: boolean | null };

export async function savePlatformProfile(input: PlatformProfileInput): Promise<PlatformProfile> {
  return (await call<{ profile: PlatformProfile }>('/admin/platform-profile', { method: 'PUT', body: input })).profile;
}

export async function getOrgMembers(): Promise<OrgMember[]> {
  return (await call<{ members: OrgMember[] }>('/org/members')).members;
}

export async function setOrgMemberStatus(id: string, status: AccountStatus): Promise<OrgMember> {
  return (await call<{ member: OrgMember }>(`/org/members/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { status },
  })).member;
}

export async function inviteOrgMember(): Promise<OrgInvitation> {
  return (await call<{ invitation: OrgInvitation }>('/org/invitations', { method: 'POST' })).invitation;
}

export async function listOrgInvitations(): Promise<{ invitations: OrgInvitation[]; ttlDays: number }> {
  const result = await call<{ invitations: OrgInvitation[]; ttl_days: number }>('/org/invitations');
  return { invitations: result.invitations, ttlDays: result.ttl_days };
}

export async function revokeOrgInvitation(id: string): Promise<OrgInvitation> {
  return (await call<{ invitation: OrgInvitation }>(`/org/invitations/${encodeURIComponent(id)}`, { method: 'DELETE' }))
    .invitation;
}

export async function getOrgAudit(limit = 100): Promise<OrgAuditRow[]> {
  return (await call<{ rows: OrgAuditRow[] }>(`/org/audit?limit=${limit}`)).rows;
}
