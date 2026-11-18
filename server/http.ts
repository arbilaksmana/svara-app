import { createHash, randomBytes } from 'node:crypto';
import type { Response } from 'express';
import { get, nowIso, run } from './db.ts';
import type { AccountRow, AuthedRequest } from './security.ts';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function fail(status: number, code: string, message: string, details?: unknown): never {
  throw new ApiError(status, code, message, details);
}

const PG_ERROR_STATUS: Record<string, { status: number; code: string; message: string }> = {
  '23505': { status: 409, code: 'constraint_conflict', message: 'Data yang sama sudah ada.' },
  '23503': { status: 409, code: 'constraint_conflict', message: 'Data terkait masih dipakai atau tidak ada.' },
  '23514': { status: 422, code: 'constraint_violation', message: 'Nilai data tidak memenuhi batasan server.' },
  '40001': { status: 503, code: 'conflict_retry', message: 'Transaksi bentrok. Coba lagi.' },
  '40P01': { status: 503, code: 'conflict_retry', message: 'Transaksi bentrok. Coba lagi.' },
};

export function sendError(res: Response, error: unknown): void {
  if (error instanceof ApiError) {
    res.status(error.status).json({ error: error.message, code: error.code, details: error.details });
    return;
  }
  const pgCode = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  const mapped = typeof pgCode === 'string' ? PG_ERROR_STATUS[pgCode] : undefined;
  if (mapped) {
    res.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    return;
  }
  console.error('[api] unhandled error', error);
  res.status(500).json({ error: 'Terjadi kesalahan internal.', code: 'internal_error' });
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

export function pathParam(req: AuthedRequest, key: string): string {
  const value = req.params[key];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0] ?? '';
  return '';
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

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

export interface GrantRow {
  id: string;
  account_id: string;
  survey_id: string;
  can_read_individual: number;
  can_export: number;
  can_read_free_text: number;
}

export async function surveyRow(id: string): Promise<SurveyRow | undefined> {
  return get<SurveyRow>('SELECT * FROM surveys WHERE id = ?', id);
}

export async function versionRow(id: string): Promise<VersionRow | undefined> {
  return get<VersionRow>('SELECT * FROM survey_versions WHERE id = ?', id);
}

export function canManageSurvey(account: AccountRow, survey: SurveyRow): boolean {
  return survey.owner_id === account.id;
}

export async function canReadSurveyMetadata(account: AccountRow, survey: SurveyRow): Promise<boolean> {
  return canManageSurvey(account, survey) || account.role === 'super_admin' || Boolean(await grantFor(account.id, survey.id));
}

export async function grantFor(accountId: string, surveyId: string): Promise<GrantRow | undefined> {
  return get<GrantRow>('SELECT * FROM access_grants WHERE account_id = ? AND survey_id = ?', accountId, surveyId);
}

export async function settingsFor(
  surveyId: string,
): Promise<{ allow_results: number; allow_individual: number } | undefined> {
  return get<{ allow_results: number; allow_individual: number }>(
    'SELECT allow_results, allow_individual FROM survey_settings WHERE survey_id = ?',
    surveyId,
  );
}

export async function canReadAggregate(account: AccountRow, survey: SurveyRow): Promise<boolean> {
  if (canManageSurvey(account, survey)) return true;
  const [grant, settings] = await Promise.all([grantFor(account.id, survey.id), settingsFor(survey.id)]);
  return Boolean(grant && settings?.allow_results);
}

export async function canReadIndividual(account: AccountRow, survey: SurveyRow): Promise<boolean> {
  const [grant, settings] = await Promise.all([grantFor(account.id, survey.id), settingsFor(survey.id)]);
  return Boolean(grant?.can_read_individual && settings?.allow_individual);
}

export async function canExport(account: AccountRow, survey: SurveyRow): Promise<boolean> {
  return Boolean((await grantFor(account.id, survey.id))?.can_export);
}

export async function canReadFreeText(account: AccountRow, survey: SurveyRow): Promise<boolean> {
  return Boolean((await grantFor(account.id, survey.id))?.can_read_free_text);
}

export async function requireSurvey(id: string): Promise<SurveyRow> {
  const survey = await surveyRow(id);
  if (!survey) fail(404, 'survey_not_found', 'Survei tidak ditemukan.');
  return survey;
}

export async function requireManageSurvey(account: AccountRow, id: string): Promise<SurveyRow> {
  const survey = await requireSurvey(id);
  if (!canManageSurvey(account, survey)) {
    fail(403, 'forbidden_survey', 'Anda tidak memiliki akses pengelolaan ke survei ini.');
  }
  return survey;
}

export async function requireVersion(versionId: string): Promise<VersionRow> {
  const version = await versionRow(versionId);
  if (!version) fail(404, 'version_not_found', 'Versi survei tidak ditemukan.');
  return version;
}

export async function requirePublishedVersion(surveyId: string): Promise<VersionRow> {
  const version = await get<VersionRow>(
    `SELECT * FROM survey_versions
      WHERE survey_id = ? AND status = 'published'
      ORDER BY number DESC LIMIT 1`,
    surveyId,
  );
  if (!version) fail(409, 'no_published_version', 'Belum ada versi terbit untuk survei ini.');
  return version;
}

export function actorFor(req: AuthedRequest): string {
  return req.account?.id ?? 'publik';
}

type AuditOutcome = 'berhasil' | 'ditolak' | 'gagal';

/** Audit hanya menyimpan metadata operasional; token, kata sandi, dan jawaban tidak boleh masuk. */
async function insertAudit(
  actor: string,
  action: string,
  object: string,
  outcome: AuditOutcome,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await run(
    'INSERT INTO audit_logs (id, actor, action, object, outcome, at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
    newId('log'),
    actor,
    action,
    object,
    outcome,
    nowIso(),
    metadata ? JSON.stringify(metadata) : null,
  );
}

export async function audit(
  req: AuthedRequest,
  action: string,
  object: string,
  outcome: AuditOutcome,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await insertAudit(actorFor(req), action, object, outcome, metadata);
}

/** Aksi route publik tidak boleh diatribusikan ke akun dari cookie ambient. */
export async function auditPublic(
  action: string,
  object: string,
  outcome: AuditOutcome,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await insertAudit('publik', action, object, outcome, metadata);
}

export function csvCell(value: unknown, neutralizeFormula = true): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (neutralizeFormula && /^[=+\-@\t\r]/.test(text)) {
    // Prefix apostrof agar spreadsheet memperlakukan nilai sebagai teks.
    // Nilai asli di basis data tidak diubah.
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvDocument(rows: unknown[][]): string {
  return `\uFEFF${rows.map((row) => row.map((cell) => csvCell(cell)).join(',')).join('\r\n')}\r\n`;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

export function payloadHash(value: unknown): string {
  return sha256Hex(stableStringify(value));
}

export function parseLimit(raw: unknown, fallback = 100, max = 500): number {
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

export function asString(value: unknown, field: string, max = 5000): string {
  if (typeof value !== 'string') fail(422, 'validation_error', `${field} wajib berupa teks.`, { field });
  const trimmed = value.trim();
  if (trimmed.length > max) fail(422, 'validation_error', `${field} terlalu panjang.`, { field, max });
  return trimmed;
}

export function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0') return false;
  return fallback;
}
