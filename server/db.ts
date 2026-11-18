import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Satu koneksi SQLite lokal berbasis `node:sqlite` (tanpa addon native).
 * Berkas default `data/svara.sqlite`, dapat diarahkan lewat DB_PATH untuk uji.
 */
export const DB_PATH = resolve(process.env.DB_PATH ?? 'data/svara.sqlite');
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

export type SqlValue = string | number | bigint | null | Uint8Array;

export function all<T>(sql: string, ...params: SqlValue[]): T[] {
  return db.prepare(sql).all(...params) as unknown as T[];
}

export function get<T>(sql: string, ...params: SqlValue[]): T | undefined {
  return db.prepare(sql).get(...params) as unknown as T | undefined;
}

export function run(sql: string, ...params: SqlValue[]) {
  return db.prepare(sql).run(...params);
}

/** Transaksi tunggal; rollback seluruh perubahan bila callback melempar. */
export function withTx<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function ensureSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
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

    CREATE TABLE IF NOT EXISTS notices (
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

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS surveys (
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

    CREATE TABLE IF NOT EXISTS survey_settings (
      survey_id TEXT PRIMARY KEY REFERENCES surveys(id) ON DELETE CASCADE,
      allow_results INTEGER NOT NULL DEFAULT 1,
      allow_individual INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS survey_versions (
      id TEXT PRIMARY KEY,
      survey_id TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
      number INTEGER NOT NULL,
      status TEXT NOT NULL,
      notice_version TEXT NOT NULL,
      published_at TEXT,
      closed_at TEXT,
      UNIQUE (survey_id, number)
    );

    CREATE TABLE IF NOT EXISTS questions (
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

    CREATE TABLE IF NOT EXISTS question_options (
      id TEXT PRIMARY KEY,
      question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      ord INTEGER NOT NULL,
      label TEXT NOT NULL,
      value REAL
    );

    CREATE TABLE IF NOT EXISTS assignments (
      id TEXT PRIMARY KEY,
      survey_id TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
      version_id TEXT NOT NULL REFERENCES survey_versions(id),
      label TEXT NOT NULL,
      participant_ref TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invitations (
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

    CREATE TABLE IF NOT EXISTS public_links (
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

    CREATE TABLE IF NOT EXISTS respondents (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      external_ref TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS consent_records (
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

    CREATE TABLE IF NOT EXISTS responses (
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

    CREATE UNIQUE INDEX IF NOT EXISTS ux_responses_assignment
      ON responses(assignment_id) WHERE assignment_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS answers (
      id TEXT PRIMARY KEY,
      response_id TEXT NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
      question_id TEXT NOT NULL,
      question_code TEXT NOT NULL,
      option_id TEXT,
      value REAL,
      text TEXT,
      skipped INTEGER NOT NULL DEFAULT 0,
      UNIQUE (response_id, question_code)
    );

    CREATE TABLE IF NOT EXISTS submission_attempts (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      response_id TEXT NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      UNIQUE (scope, idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS access_grants (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      survey_id TEXT REFERENCES surveys(id) ON DELETE CASCADE,
      can_read_individual INTEGER NOT NULL DEFAULT 0,
      can_export INTEGER NOT NULL DEFAULT 0,
      can_read_free_text INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      object TEXT NOT NULL,
      outcome TEXT NOT NULL,
      at TEXT NOT NULL,
      metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS integration_events (
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

    CREATE TABLE IF NOT EXISTS data_requests (
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

    CREATE INDEX IF NOT EXISTS ix_versions_survey ON survey_versions(survey_id);
    CREATE INDEX IF NOT EXISTS ix_questions_version ON questions(version_id);
    CREATE INDEX IF NOT EXISTS ix_answers_response ON answers(response_id);
    CREATE INDEX IF NOT EXISTS ix_audit_at ON audit_logs(at);
    CREATE INDEX IF NOT EXISTS ix_responses_version ON responses(version_id);
    CREATE UNIQUE INDEX IF NOT EXISTS ux_grants_account_survey ON access_grants(account_id, survey_id);
    CREATE UNIQUE INDEX IF NOT EXISTS ux_consent_response ON consent_records(response_id) WHERE response_id IS NOT NULL;
  `);
}
