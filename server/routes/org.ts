import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { Response } from 'express';
import { all, get, nowIso, run, withTx } from '../db.ts';
import { readGuardianEvidence } from '../guardian-evidence.ts';
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
    // BF-05: naik versi notice hanya boleh ke teks yang sudah ada di katalog organisasi; tidak ada
    // teks yang dikarang atau fallback ke versi lain.
    const requestedNotice = body.notice_version === undefined ? null : asString(body.notice_version, 'notice_version', 20);
    if (requestedNotice === '') fail(422, 'validation_error', 'notice_version wajib diisi.');
    const noticeVersion = requestedNotice ?? current.notice_version;
    if (!(await get<{ ok: number }>(
      'SELECT 1 AS ok FROM organization_notices WHERE organization_id = ? AND version = ?',
      organizationId,
      noticeVersion,
    ))) {
      const versions = (await all<{ version: string }>(
        'SELECT version FROM organization_notices WHERE organization_id = ? ORDER BY version',
        organizationId,
      )).map((row) => row.version);
      fail(
        422,
        'notice_version_unavailable',
        `Notice organisasi versi ${noticeVersion} belum tersedia. ` +
          (versions.length ? `Versi yang tersedia: ${versions.join(', ')}.` : 'Belum ada notice organisasi sama sekali.'),
        { notice_version: noticeVersion, available_versions: versions },
      );
    }
    const noticeChange = await withTx(async () => {
      await run(
        `UPDATE organizations
            SET name = ?, organization_type = ?, respondent_age_category = ?, consent_mode = ?,
                policy_url = ?, terms_url = ?, retention_days = ?, data_request_contact = ?,
                cross_border_transfer = ?, notice_version = ?
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
        noticeVersion,
        organizationId,
      );
      if (noticeVersion === current.notice_version) return null;
      // Draf tanpa jawaban belum pernah ditampilkan ke responden: mengikuti notice baru. Draf yang
      // sudah punya jawaban tetap pada versi notice yang disetujui responden dan dilaporkan di respons.
      const drafts = await all<{ id: string; survey_id: string; responses: number }>(
        `SELECT v.id, v.survey_id,
                (SELECT COUNT(*) FROM responses r WHERE r.version_id = v.id) AS responses
           FROM survey_versions v JOIN surveys s ON s.id = v.survey_id
          WHERE s.organization_id = ? AND v.status = 'draft'
          ORDER BY v.survey_id, v.number`,
        organizationId,
      );
      const followed: string[] = [];
      const kept: Array<{ version_id: string; survey_id: string; responses: number }> = [];
      for (const draft of drafts) {
        if (Number(draft.responses) > 0) {
          kept.push({ version_id: draft.id, survey_id: draft.survey_id, responses: Number(draft.responses) });
          continue;
        }
        await run('UPDATE survey_versions SET notice_version = ? WHERE id = ?', noticeVersion, draft.id);
        followed.push(draft.id);
      }
      return { from: current.notice_version, to: noticeVersion, drafts_followed: followed, drafts_kept: kept };
    });
    await audit(req, 'Ubah profil organisasi', organizationId, 'berhasil', {
      respondent_age_category: ageCategory,
      consent_mode: consentMode,
      notice_version: noticeVersion,
      drafts_followed: noticeChange?.drafts_followed.length ?? 0,
      drafts_kept: noticeChange?.drafts_kept.length ?? 0,
    });
    res.json({
      data: {
        source: 'organization',
        profile: await get<OrgProfileRow>(`SELECT ${ORG_COLUMNS} FROM organizations WHERE id = ?`, organizationId),
        notice_change: noticeChange,
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

/* ---------- Moderasi bukti persetujuan wali (SEC-04/BF-03) ---------- */

interface GuardianEvidenceRow {
  consent_id: string;
  survey_id: string;
  survey_title: string;
  basis: string;
  recorded_at: string;
  guardian_evidence_status: string;
  guardian_evidence_ref: string | null;
  guardian_evidence_file: string | null;
  guardian_evidence_mime: string | null;
  guardian_evidence_size: number | null;
  guardian_evidence_uploaded_at: string | null;
  guardian_evidence_reviewed_by: string | null;
  guardian_evidence_reviewed_at: string | null;
  guardian_evidence_review_note: string | null;
}

const EVIDENCE_LIST_LIMIT = 100;
const EVIDENCE_STATUS = ['self_attested', 'verified', 'rejected', 'all'] as const;
const EVIDENCE_COLUMNS = `cr.id AS consent_id, cr.survey_id, s.title AS survey_title, cr.basis, cr.recorded_at,
  cr.guardian_evidence_status, cr.guardian_evidence_ref, cr.guardian_evidence_file, cr.guardian_evidence_mime,
  cr.guardian_evidence_size, cr.guardian_evidence_uploaded_at, cr.guardian_evidence_reviewed_by,
  cr.guardian_evidence_reviewed_at, cr.guardian_evidence_review_note`;

/** Lingkup selalu lewat surveys.organization_id milik sesi; ID lain tidak pernah dijangkau. */
async function evidenceForOrg(organizationId: string, consentId: string): Promise<GuardianEvidenceRow | undefined> {
  return get<GuardianEvidenceRow>(
    `SELECT ${EVIDENCE_COLUMNS}
       FROM consent_records cr JOIN surveys s ON s.id = cr.survey_id
      WHERE cr.id = ? AND s.organization_id = ?`,
    consentId,
    organizationId,
  );
}

function withFileFlag(row: GuardianEvidenceRow): GuardianEvidenceRow & { has_file: boolean } {
  return { ...row, has_file: row.guardian_evidence_file !== null };
}

/** Header unduhan aman: nama asli di-encode RFC 5987, fallback ASCII tanpa tanda kutip atau kontrol. */
function attachmentDisposition(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]/gu, '_').replace(/["\\]/gu, '_').slice(0, 100) || 'bukti-wali';
  const encoded = encodeURIComponent(name).replace(/[!'()*]/gu, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

orgRouter.get('/org/guardian-evidence', async (req: AuthedRequest, res: Response) => {
  try {
    const organizationId = requireOrgScope(req, 'org_admin');
    const requested = typeof req.query.status === 'string' && req.query.status.trim() ? req.query.status.trim() : 'self_attested';
    if (!EVIDENCE_STATUS.includes(requested as (typeof EVIDENCE_STATUS)[number])) {
      fail(422, 'validation_error', 'status harus self_attested, verified, rejected, atau all.');
    }
    const rows = requested === 'all'
      ? await all<GuardianEvidenceRow>(
        `SELECT ${EVIDENCE_COLUMNS}
           FROM consent_records cr JOIN surveys s ON s.id = cr.survey_id
          WHERE s.organization_id = ?
          ORDER BY cr.recorded_at DESC, cr.id DESC LIMIT ${EVIDENCE_LIST_LIMIT}`,
        organizationId,
      )
      : await all<GuardianEvidenceRow>(
        `SELECT ${EVIDENCE_COLUMNS}
           FROM consent_records cr JOIN surveys s ON s.id = cr.survey_id
          WHERE s.organization_id = ? AND cr.guardian_evidence_status = ?
          ORDER BY cr.recorded_at DESC, cr.id DESC LIMIT ${EVIDENCE_LIST_LIMIT}`,
        organizationId,
        requested,
      );
    res.setHeader('Cache-Control', 'no-store');
    res.json({ data: { evidence: rows.map(withFileFlag) } });
  } catch (error) {
    sendError(res, error);
  }
});

/** Berkas hanya disajikan untuk sesi org_admin pemilik organisasi; tidak ada URL publik yang bisa ditebak. */
orgRouter.get('/org/guardian-evidence/:consentId/file', async (req: AuthedRequest, res: Response) => {
  try {
    const organizationId = requireOrgScope(req, 'org_admin');
    const consentId = pathParam(req, 'consentId');
    const row = await evidenceForOrg(organizationId, consentId);
    if (!row || !row.guardian_evidence_file) fail(404, 'evidence_not_found', 'Bukti wali tidak ditemukan.');
    const buffer = await readGuardianEvidence(consentId);
    if (!buffer) fail(404, 'evidence_not_found', 'Berkas bukti wali tidak ditemukan.');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', row.guardian_evidence_mime ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', attachmentDisposition(row.guardian_evidence_file));
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  } catch (error) {
    sendError(res, error);
  }
});

orgRouter.patch('/org/guardian-evidence/:consentId', async (req: AuthedRequest, res: Response) => {
  try {
    const organizationId = requireOrgScope(req, 'org_admin');
    const consentId = pathParam(req, 'consentId');
    const row = await evidenceForOrg(organizationId, consentId);
    // 404 untuk organisasi lain: keberadaan bukti organisasi lain tidak dibocorkan.
    if (!row) fail(404, 'evidence_not_found', 'Bukti wali tidak ditemukan.');
    const decision = req.body?.decision;
    if (decision !== 'verified' && decision !== 'rejected') {
      fail(422, 'validation_error', 'decision harus verified atau rejected.');
    }
    const rawNote = req.body?.note;
    const note = rawNote === undefined || rawNote === null ? null : asString(rawNote, 'note', 500) || null;
    const reviewedAt = nowIso();
    const outcome = decision === 'verified' ? 'berhasil' : 'ditolak';
    await withTx(async () => {
      await run(
        `UPDATE consent_records
            SET guardian_evidence_status = ?, guardian_evidence_reviewed_by = ?,
                guardian_evidence_reviewed_at = ?, guardian_evidence_review_note = ?
          WHERE id = ?`,
        decision,
        req.account!.id,
        reviewedAt,
        note,
        consentId,
      );
      await audit(req, 'Verifikasi bukti wali', consentId, outcome, { decision });
    });
    const updated = await evidenceForOrg(organizationId, consentId);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ data: { evidence: updated ? withFileFlag(updated) : null } });
  } catch (error) {
    sendError(res, error);
  }
});
