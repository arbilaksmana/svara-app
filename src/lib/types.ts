/** Tipe domain Modul 14. Mengikuti PRD §6 dan §1.2. Semua data bersifat sintetis. */

export type OrganizationType = 'school' | 'organization';
export type AgeCategory = 'adult' | 'minor' | 'mixed';
export type ConsentMode = 'self' | 'guardian';

export interface DeploymentProfile {
  id: string;
  organization_name: string;
  organization_type: OrganizationType;
  respondent_age_category: AgeCategory;
  consent_mode: ConsentMode;
  policy_url: string;
  terms_url: string;
  /** null berarti menunggu keputusan pengendali (PRD §1.2 / §14). */
  retention_days: number | null;
  data_request_contact: string | null;
  cross_border_transfer: boolean | null;
  notice_version: string;
  /** Penanda bahwa seluruh teks kebijakan masih placeholder sintetis. */
  synthetic_placeholder: boolean;
}

export type SurveyStatus = 'draft' | 'published' | 'closed' | 'archived';

export interface Survey {
  id: string;
  owner_id: string;
  profile_id: string;
  title: string;
  purpose: string;
  object_label: string;
  instructions: string;
  status: SurveyStatus;
  created_at: string;
  updated_at: string;
  current_version_id: string | null;
}

export type VersionStatus = 'draft' | 'published' | 'closed' | 'archived';

export interface SurveyVersion {
  id: string;
  survey_id: string;
  number: number;
  status: VersionStatus;
  notice_version: string;
  published_at: string | null;
  closed_at: string | null;
  question_ids: string[];
}

export type QuestionType = 'likert' | 'short_text' | 'single_choice';

export interface Question {
  id: string;
  version_id: string;
  code: string;
  order: number;
  type: QuestionType;
  required: boolean;
  section: string;
  label: string;
  hint: string | null;
  group_code: string | null;
  dimension_code: string | null;
  option_ids: string[];
}

export interface QuestionOption {
  id: string;
  question_id: string;
  order: number;
  label: string;
  /** null untuk isian teks; nilai asli Likert tetap disimpan (PRD §7). */
  value: number | null;
}

export interface Assignment {
  id: string;
  survey_id: string;
  version_id: string;
  label: string;
  /** Kode lokal peserta, bukan nama. PRD §9.1 melarang pencocokan berdasarkan nama. */
  participant_ref: string;
}

export type InvitationStatus = 'active' | 'used' | 'revoked' | 'expired';

export interface Invitation {
  id: string;
  assignment_id: string;
  survey_id: string;
  version_id: string;
  /** Kode yang boleh ditampilkan ke creator. Berbeda dari token dan dari ID pseudonim. */
  code: string;
  status: InvitationStatus;
  expires_at: string | null;
  used_at: string | null;
  revoked_at: string | null;
  /** Hash token hanya untuk kontrak; tidak pernah dirender pada UI (PRD §9.1). */
  token_hash: string;
}

export type LinkStatus = 'active' | 'expired' | 'closed';

export interface PublicLink {
  id: string;
  survey_id: string;
  version_id: string;
  /** Token publik untuk rute /s/:token. Bukan kredensial. */
  token: string;
  url: string;
  label: string;
  status: LinkStatus;
  expires_at: string | null;
}

export type CollectionMode = 'standalone' | 'integrated';
export type IdentitySource = 'local' | 'module_13';

export interface Answer {
  question_code: string;
  option_id: string | null;
  /** Nilai asli opsi, diturunkan dari konfigurasi versi. */
  value: number | null;
  /** Isian teks bebas; hanya boleh dilihat penerima berizin. */
  text: string | null;
  skipped: boolean;
}

export interface Response {
  id: string;
  version_id: string;
  survey_id: string;
  assignment_id: string | null;
  respondent_id: string;
  collection_mode: CollectionMode;
  identity_source: IdentitySource;
  submitted_at: string;
  idempotency_key: string;
  answers: Answer[];
}

export type ConsentStatus = 'granted' | 'pending' | 'withdrawn';
export type GuardianEvidenceStatus = 'not_required' | 'pending' | 'verified' | 'revoked';

export interface ConsentRecord {
  id: string;
  survey_id: string;
  version_id: string;
  notice_version: string;
  basis: string;
  status: ConsentStatus;
  recorded_at: string;
  /** Klik responden dipisah dari bukti verifikasi pihak berwenang (PRD §6). */
  respondent_click: boolean;
  guardian_evidence_status: GuardianEvidenceStatus;
  guardian_evidence_ref: string | null;
}

export type AuditOutcome = 'berhasil' | 'ditolak' | 'gagal';

export interface AuditLog {
  id: string;
  actor: string;
  action: string;
  object: string;
  outcome: AuditOutcome;
  at: string;
}

export type Role = 'super_admin' | 'creator' | 'authorized_officer';
export type AccountStatus = 'active' | 'suspended';

export interface Account {
  id: string;
  display_name: string;
  role: Role;
  status: AccountStatus;
}

export interface AccessGrant {
  id: string;
  account_id: string;
  survey_id: string | null;
  can_read_individual: boolean;
  can_export: boolean;
  can_read_free_text: boolean;
}

export type IntegrationTarget = 'module_13' | 'module_15';
export type EventStatus = 'delivered' | 'pending' | 'failed';

export interface IntegrationEvent {
  id: string;
  event_id: string;
  type: string;
  target: IntegrationTarget;
  status: EventStatus;
  attempts: number;
  at: string;
  simulated: boolean;
}

export interface Notice {
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
  synthetic_placeholder: boolean;
}
