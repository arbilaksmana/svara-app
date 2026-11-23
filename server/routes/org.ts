import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { Response } from 'express';
import { all, get, nowIso, run, withTx } from '../db.ts';
import { redactAuditRow, revokeSessionsOnStatusChange, type AuthedRequest } from '../security.ts';
import { asString, audit, fail, newId, pathParam, sendError } from '../http.ts';
import {
  INVITATION_LIST_LIMIT, INVITATION_TTL_DAYS,
  ORGANIZATION_INVITATION_COLUMNS,
  invitationExpiry,
  invitationStatus,
  type OrganizationInvitationRow,
} from '../organization-invitations.ts';

/** Profil deployment milik organisasi; tanpa UI dan tanpa perubahan skema survei (PRD §1.2). */
export const orgRouter = Router();

interface OrgProfileRow {
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
}

interface PlatformProfileRow {
  id: string;
  organization_name: string;
  organization_type: string;
  policy_url: string;
  terms_url: string;
  retention_days: number | null;
  data_request_contact: string | null;
  cross_border_transfer: number | null;
  notice_version: string;
  updated_at: string;
}

const ORG_COLUMNS = `id, name AS organization_name, organization_type, respondent_age_category, consent_mode,
  policy_url, terms_url, retention_days, data_request_contact, cross_border_transfer, notice_version`;
const PLATFORM_COLUMNS = `id, organization_name, organization_type, policy_url, terms_url, retention_days,
  data_request_contact, cross_border_transfer, notice_version, updated_at`;

orgRouter.get('/org/profile', async (req: AuthedRequest, res: Response) => {
  try {
    if (!req.account) fail(401, 'unauthenticated', 'Masuk kembali untuk melanjutkan.');
    const row = req.account.organization_id
      ? await get<OrgProfileRow>(`SELECT ${ORG_COLUMNS} FROM organizations WHERE id = ?`, req.account.organization_id)
      : await get<PlatformProfileRow>(`SELECT ${PLATFORM_COLUMNS} FROM platform_profile WHERE id = 'platform'`);
    if (!row) fail(404, 'profile_missing', 'Profil organisasi belum dikonfigurasi.');
    res.setHeader('Cache-Control', 'no-store');
    res.json({ data: { source: req.account.organization_id ? 'organization' : 'platform', profile: row } });
  } catch (error) {
    sendError(res, error);
  }
});

const AGE_CATEGORY: Record<string, true> = { adult: true, minor: true, mixed: true };
const CONSENT_MODE: Record<string, true> = { self: true, guardian: true };

orgRouter.put('/org/profile', async (req: AuthedRequest, res: Response) => {
  try {
    if (!req.account) fail(401, 'unauthenticated', 'Masuk kembali untuk melanjutkan.');
    if (req.account.role !== 'org_admin') fail(403, 'forbidden_role', 'Hanya admin organisasi yang dapat mengubah profil.');
    const organizationId = req.account.organization_id;
    if (!organizationId) fail(403, 'no_organization', 'Akun ini tidak terikat organisasi.');
    const current = await get<OrgProfileRow>(`SELECT ${ORG_COLUMNS} FROM organizations WHERE id = ?`, organizationId);
    if (!current) fail(404, 'profile_missing', 'Profil organisasi belum dikonfigurasi.');

    const body = (req.body ?? {}) as Record<string, unknown>;
    const text = (key: string, max: number): string => asString(body[key] ?? '', key, max);
    /** Field yang tidak dikirim mempertahankan nilai tersimpan. */
    const merged = (key: string, stored: string, max: number): string =>
      body[key] === undefined ? stored : text(key, max);
    const required = (key: string, stored: string, max: number): string => {
      const value = merged(key, stored, max);
      if (!value) fail(422, 'validation_error', `${key} wajib diisi.`);
      return value;
    };

    const ageCategory = merged('respondent_age_category', current.respondent_age_category, 20);
    if (!AGE_CATEGORY[ageCategory]) {
      fail(422, 'validation_error', 'respondent_age_category harus adult, minor, atau mixed.');
    }
    const consentMode = merged('consent_mode', current.consent_mode, 20);
    if (!CONSENT_MODE[consentMode]) {
      fail(422, 'validation_error', 'consent_mode harus self atau guardian.');
    }
    // PRD §1.2: responden minor/mixed mewajibkan persetujuan wali.
    if ((ageCategory === 'minor' || ageCategory === 'mixed') && consentMode === 'self') {
      fail(422, 'consent_mode_mismatch', 'respondent_age_category minor/mixed mewajibkan consent_mode guardian.');
    }

    let retentionDays: number | null = current.retention_days;
    if (body.retention_days !== undefined) {
      const value = body.retention_days;
      if (value !== null && (typeof value !== 'number' || !Number.isInteger(value) || value < 0)) {
        fail(422, 'validation_error', 'retention_days harus bilangan bulat >= 0.');
      }
      retentionDays = value as number | null;
    }
    let crossBorder: number | null = current.cross_border_transfer;
    if (body.cross_border_transfer !== undefined) {
      if (typeof body.cross_border_transfer !== 'boolean') {
        fail(422, 'validation_error', 'cross_border_transfer harus boolean.');
      }
      crossBorder = body.cross_border_transfer ? 1 : 0;
    }
    await run(
      `UPDATE organizations
          SET name = ?, organization_type = ?, respondent_age_category = ?, consent_mode = ?,
              policy_url = ?, terms_url = ?, retention_days = ?, data_request_contact = ?,
              cross_border_transfer = ?
        WHERE id = ?`,
      required('organization_name', current.organization_name, 200),
      required('organization_type', current.organization_type, 50),
      ageCategory,
      consentMode,
      required('policy_url', current.policy_url, 500),
      required('terms_url', current.terms_url, 500),
      retentionDays,
      merged('data_request_contact', current.data_request_contact ?? '', 200) || null,
      crossBorder,
      organizationId,
    );
    await audit(req, 'Ubah profil organisasi', organizationId, 'berhasil', {
      respondent_age_category: ageCategory,
      consent_mode: consentMode,
    });
    res.json({
      data: {
        source: 'organization',
        profile: await get<OrgProfileRow>(`SELECT ${ORG_COLUMNS} FROM organizations WHERE id = ?`, organizationId),
      },
    });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * Lingkup organisasi selalu diambil dari sesi; body/query tidak pernah menentukan organisasi.
 * Akun tanpa organisasi ditolak sebelum menyentuh data apa pun.
 */
function requireOrgScope(req: AuthedRequest, role?: 'org_admin'): string {
  if (!req.account) fail(401, 'unauthenticated', 'Masuk kembali untuk melanjutkan.');
  if (role && req.account.role !== role) fail(403, 'forbidden_role', 'Hanya admin organisasi yang dapat melakukan tindakan ini.');
  if (!req.account.organization_id) fail(403, 'no_organization', 'Akun ini tidak terikat organisasi.');
  return req.account.organization_id;
}

const MEMBER_COLUMNS = 'id, email, display_name, role, status, created_at';

orgRouter.get('/org/members', async (req: AuthedRequest, res: Response) => {
  try {
    const organizationId = requireOrgScope(req, 'org_admin');
    const rows = await all<Record<string, unknown>>(
      `SELECT ${MEMBER_COLUMNS} FROM accounts WHERE organization_id = ? ORDER BY display_name`,
      organizationId,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.json({ data: { members: rows } });
  } catch (error) {
    sendError(res, error);
  }
});

/** Hanya status anggota creator dalam organisasi sendiri; peran tidak dapat diubah di sini. */
orgRouter.patch('/org/members/:id', async (req: AuthedRequest, res: Response) => {
  try {
    const organizationId = requireOrgScope(req, 'org_admin');
    const status = typeof req.body?.status === 'string' ? req.body.status : '';
    if (!['active', 'suspended'].includes(status)) {
      fail(422, 'validation_error', 'Status harus active atau suspended.');
    }
    const member = await get<{ id: string; role: string; status: string; organization_id: string | null }>(
      'SELECT id, role, status, organization_id FROM accounts WHERE id = ?',
      pathParam(req, 'id'),
    );
    // 404 untuk akun di luar organisasi: jangan membocorkan keberadaan akun organisasi lain.
    if (!member || member.organization_id !== organizationId) fail(404, 'member_not_found', 'Anggota tidak ditemukan.');
    if (member.role !== 'creator') {
      fail(403, 'forbidden_member_role', 'Hanya status creator di organisasi ini yang dapat diubah.');
    }
    await withTx(async () => {
      await run('UPDATE accounts SET status = ? WHERE id = ?', status, member.id);
      await revokeSessionsOnStatusChange(member.id, member.status, status);
    });
    await audit(req, 'Ubah status anggota', member.id, 'berhasil', { status });
    const row = await get<Record<string, unknown>>(`SELECT ${MEMBER_COLUMNS} FROM accounts WHERE id = ?`, member.id);
    res.json({ data: { member: row } });
  } catch (error) {
    sendError(res, error);
  }
});

orgRouter.get('/org/invitations', async (req: AuthedRequest, res: Response) => {
  try {
    const organizationId = requireOrgScope(req, 'org_admin');
    const now = nowIso();
    const rows = await all<OrganizationInvitationRow>(
      `SELECT ${ORGANIZATION_INVITATION_COLUMNS} FROM organization_invitations
        WHERE organization_id = ? ORDER BY created_at DESC, id DESC LIMIT ${INVITATION_LIST_LIMIT}`,
      organizationId,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      data: {
        invitations: rows.map((row) => ({ ...row, status: invitationStatus(row, now) })),
        ttl_days: INVITATION_TTL_DAYS,
      },
    });
  } catch (error) {
    sendError(res, error);
  }
});

orgRouter.post('/org/invitations', async (req: AuthedRequest, res: Response) => {
  try {
    const organizationId = requireOrgScope(req, 'org_admin');
    const code = `ORG-${randomBytes(9).toString('base64url').toUpperCase()}`;
    const id = newId('oi');
    const createdAt = nowIso();
    const expiresAt = invitationExpiry(createdAt);
    await run(
      'INSERT INTO organization_invitations (id, organization_id, code, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      organizationId,
      code,
      req.account!.id,
      createdAt,
      expiresAt,
    );
    await audit(req, 'Buat undangan organisasi', id, 'berhasil', { expires_at: expiresAt });
    res.status(201).json({
      data: {
        invitation: {
          id,
          organization_id: organizationId,
          code,
          created_at: createdAt,
          expires_at: expiresAt,
          revoked_at: null,
          used_at: null,
          used_by: null,
          status: 'active',
        },
      },
    });
  } catch (error) {
    sendError(res, error);
  }
});

orgRouter.delete('/org/invitations/:id', async (req: AuthedRequest, res: Response) => {
  try {
    const organizationId = requireOrgScope(req, 'org_admin');
    const id = pathParam(req, 'id');
    const row = await get<OrganizationInvitationRow>(
      `SELECT ${ORGANIZATION_INVITATION_COLUMNS} FROM organization_invitations WHERE id = ? AND organization_id = ?`,
      id,
      organizationId,
    );
    // 404 untuk kode organisasi lain: jangan membocorkan keberadaannya.
    if (!row) fail(404, 'invitation_not_found', 'Kode undangan tidak ditemukan.');
    if (row.used_at) {
      fail(409, 'invitation_used', 'Kode undangan sudah dipakai dan tidak dapat dicabut.');
    }
    if (!row.revoked_at) {
      const revokedAt = nowIso();
      const changed = await run(
        'UPDATE organization_invitations SET revoked_at = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL',
        revokedAt,
        id,
      );
      if (changed === 0) {
        fail(409, 'invitation_used', 'Kode undangan sudah dipakai dan tidak dapat dicabut.');
      }
      await audit(req, 'Cabut undangan organisasi', id, 'berhasil');
      row.revoked_at = revokedAt;
    }
    res.json({ data: { invitation: { ...row, status: invitationStatus(row, nowIso()) } } });
  } catch (error) {
    sendError(res, error);
  }
});

/** Audit organisasi: tanpa metadata mentah, hanya kolom yang aman ditampilkan. */
orgRouter.get('/org/audit', async (req: AuthedRequest, res: Response) => {
  try {
    const organizationId = requireOrgScope(req, 'org_admin');
    const limit = Math.min(Math.max(Number.parseInt(typeof req.query.limit === 'string' ? req.query.limit : '', 10) || 100, 1), 500);
    const rows = await all<{ id: string; at: string; actor: string; action: string; object: string; outcome: string }>(
      `SELECT id, at, actor, action, object, outcome FROM audit_logs
        WHERE organization_id = ? ORDER BY at DESC, id DESC LIMIT ?`,
      organizationId,
      limit,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.json({ data: { rows: rows.map(redactAuditRow) } });
  } catch (error) {
    sendError(res, error);
  }
});
