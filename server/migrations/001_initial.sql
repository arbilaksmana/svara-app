-- Svara initial Postgres schema (parity with the former SQLite 21-table schema).
-- Timestamps stay ISO-8601 UTC text so the HTTP contract keeps its exact values;
-- SQLite INTEGER flags keep their 0/1 representation for response parity.

CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  organization_name TEXT NOT NULL,
  organization_type TEXT NOT NULL,
  respondent_age_category TEXT NOT NULL,
  consent_mode TEXT NOT NULL,
  policy_url TEXT NOT NULL,
  terms_url TEXT NOT NULL,
  retention_days INTEGER,
  data_request_contact TEXT,
  cross_border_transfer INTEGER,
  notice_version TEXT NOT NULL,
  synthetic_placeholder INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE notices (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  version TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  purpose TEXT NOT NULL,
  data_categories TEXT NOT NULL,
  module15_usage TEXT NOT NULL,
  retention_text TEXT NOT NULL,
  recipients TEXT NOT NULL,
  contact TEXT NOT NULL,
  rights TEXT NOT NULL,
  child_data_text TEXT NOT NULL,
  cross_border_text TEXT NOT NULL,
  synthetic_placeholder INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE surveys (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES accounts(id),
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  title TEXT NOT NULL,
  purpose TEXT NOT NULL,
  object_label TEXT NOT NULL,
  instructions TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  current_version_id TEXT
);

CREATE TABLE survey_settings (
  survey_id TEXT PRIMARY KEY REFERENCES surveys(id) ON DELETE CASCADE,
  allow_results INTEGER NOT NULL DEFAULT 1,
  allow_individual INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE survey_versions (
  id TEXT PRIMARY KEY,
  survey_id TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  status TEXT NOT NULL,
  notice_version TEXT NOT NULL,
  published_at TEXT,
  closed_at TEXT,
  UNIQUE (survey_id, number)
);

CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES survey_versions(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  ord INTEGER NOT NULL,
  type TEXT NOT NULL,
  required INTEGER NOT NULL,
  section TEXT NOT NULL,
  label TEXT NOT NULL,
  hint TEXT,
  group_code TEXT,
  dimension_code TEXT,
  direction TEXT
);

CREATE TABLE question_options (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL,
  label TEXT NOT NULL,
  value DOUBLE PRECISION
);

CREATE TABLE assignments (
  id TEXT PRIMARY KEY,
  survey_id TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES survey_versions(id),
  label TEXT NOT NULL,
  participant_ref TEXT NOT NULL
);

CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES assignments(id),
  survey_id TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES survey_versions(id),
  code TEXT NOT NULL UNIQUE,
  token TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  expires_at TEXT,
  used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE public_links (
  id TEXT PRIMARY KEY,
  survey_id TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES survey_versions(id),
  token TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE respondents (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  external_ref TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE consent_records (
  id TEXT PRIMARY KEY,
  survey_id TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES survey_versions(id),
  notice_version TEXT NOT NULL,
  basis TEXT NOT NULL,
  status TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  respondent_click INTEGER NOT NULL,
  guardian_evidence_status TEXT NOT NULL,
  guardian_evidence_ref TEXT,
  invitation_id TEXT,
  response_id TEXT
);

CREATE TABLE responses (
  id TEXT PRIMARY KEY,
  survey_id TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES survey_versions(id),
  assignment_id TEXT,
  respondent_id TEXT NOT NULL,
  collection_mode TEXT NOT NULL,
  identity_source TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  idempotency_key TEXT NOT NULL
);

CREATE UNIQUE INDEX ux_responses_assignment
  ON responses(assignment_id) WHERE assignment_id IS NOT NULL;

CREATE TABLE answers (
  id TEXT PRIMARY KEY,
  response_id TEXT NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  question_code TEXT NOT NULL,
  option_id TEXT,
  value DOUBLE PRECISION,
  text TEXT,
  skipped INTEGER NOT NULL DEFAULT 0,
  UNIQUE (response_id, question_code)
);

CREATE TABLE submission_attempts (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  response_id TEXT NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE (scope, idempotency_key)
);

CREATE TABLE access_grants (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  survey_id TEXT REFERENCES surveys(id) ON DELETE CASCADE,
  can_read_individual INTEGER NOT NULL DEFAULT 0,
  can_export INTEGER NOT NULL DEFAULT 0,
  can_read_free_text INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  object TEXT NOT NULL,
  outcome TEXT NOT NULL,
  at TEXT NOT NULL,
  metadata TEXT
);

CREATE TABLE integration_events (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  target TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  at TEXT NOT NULL,
  simulated INTEGER NOT NULL DEFAULT 1,
  response_id TEXT,
  last_error TEXT,
  payload TEXT
);

CREATE TABLE data_requests (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  contact TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  handled_by TEXT,
  outcome_note TEXT
);

CREATE INDEX ix_versions_survey ON survey_versions(survey_id);
CREATE INDEX ix_questions_version ON questions(version_id);
CREATE INDEX ix_answers_response ON answers(response_id);
CREATE INDEX ix_audit_at ON audit_logs(at);
CREATE INDEX ix_responses_version ON responses(version_id);
CREATE UNIQUE INDEX ux_grants_account_survey ON access_grants(account_id, survey_id);
CREATE UNIQUE INDEX ux_consent_response ON consent_records(response_id) WHERE response_id IS NOT NULL;
