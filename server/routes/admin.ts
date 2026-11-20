import { Router } from 'express';
import type { Response } from 'express';
import { all, get, nowIso, run, withTx } from '../db.ts';
import type { AuthedRequest } from '../security.ts';
import { hashPassword, passwordPolicyError, requireRole } from '../security.ts';
import {
  asBoolean,
  asString,
  audit,
  fail,
  newId,
  parseLimit,
  pathParam,
  sendError,
} from '../http.ts';

interface AccountRow {
  id: string;
  email: string;
  display_name: string;
  role: string;
  status: string;
  organization_id: string | null;
}

interface GrantInput {
  survey_id: string | null;
  can_read_individual: boolean;
  can_export: boolean;
  can_read_free_text: boolean;
}

interface EventRow {
  id: string;
  event_id: string;
  type: string;
  target: string;
  status: string;
  attempts: number;
  response_id: string | null;
  last_error: string | null;
}

export const adminRouter = Router();
adminRouter.use(requireRole(['super_admin']));

async function activeSuperAdmins(): Promise<number> {
  return (
    (
      await get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM accounts WHERE role = 'super_admin' AND status = 'active'",
      )
    )?.count ?? 0
  );
}

adminRouter.get('/admin/accounts', async (_req: AuthedRequest, res: Response) => {
  try {
    const accounts = await all<AccountRow & { created_at: string }>(
      'SELECT id, email, display_name, role, status, organization_id, created_at FROM accounts ORDER BY display_name',
    );
    const grants = await all<Record<string, unknown>>(
      `SELECT g.*, s.title AS survey_title
         FROM access_grants g LEFT JOIN surveys s ON s.id = g.survey_id
        ORDER BY g.account_id, g.survey_id`,
    );
    res.json({ data: { accounts, grants } });
  } catch (error) {
    sendError(res, error);
  }
});

adminRouter.patch('/admin/accounts/:id', async (req: AuthedRequest, res: Response) => {
  try {
    const account = await get<AccountRow>('SELECT * FROM accounts WHERE id = ?', pathParam(req, 'id'));
    if (!account) fail(404, 'account_not_found', 'Akun tidak ditemukan.');
    const role = typeof req.body?.role === 'string' ? req.body.role : account.role;
    const status = typeof req.body?.status === 'string' ? req.body.status : account.status;
    if (!['super_admin', 'org_admin', 'creator'].includes(role)) {
      fail(422, 'validation_error', 'Peran akun tidak dikenal.');
    }
    if (!['active', 'suspended'].includes(status)) {
      fail(422, 'validation_error', 'Status akun tidak dikenal.');
    }
    // Lingkup akun menentukan organisasi survei yang dibuatnya dan akses /org/*.
    let organizationId = account.organization_id;
    if (req.body?.organization_id !== undefined) {
      const raw = req.body.organization_id;
      if (raw === null || raw === '') {
        organizationId = null;
      } else if (typeof raw !== 'string') {
        fail(422, 'validation_error', 'organization_id harus berupa id organisasi atau null.');
      } else {
        const organization = await get<{ id: string }>('SELECT id FROM organizations WHERE id = ?', raw);
        if (!organization) fail(422, 'unknown_organization', 'Organisasi tidak dikenal.');
        organizationId = organization.id;
      }
    }
    if (role === 'org_admin' && !organizationId) {
      fail(422, 'organization_required', 'Akun org_admin harus terikat organisasi.');
    }
    if (role === 'super_admin' && organizationId) {
      fail(422, 'super_admin_scope', 'Lepas organisasi akun sebelum menjadikannya super_admin.');
    }
    if (account.role === 'super_admin' && (role !== 'super_admin' || status !== 'active') && (await activeSuperAdmins()) <= 1) {
      fail(409, 'last_super_admin', 'Tidak dapat menonaktifkan super admin terakhir.');
    }
    await run(
      'UPDATE accounts SET role = ?, status = ?, organization_id = ? WHERE id = ?',
      role,
      status,
      organizationId,
      account.id,
    );
    await audit(req, 'Ubah akun', account.id, 'berhasil', { role, status, organization_id: organizationId });
    res.json({ data: { ...account, role, status, organization_id: organizationId } });
  } catch (error) {
    sendError(res, error);
  }
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ORGANIZATION_TYPE: Record<string, true> = { school: true, organization: true };
const AGE_CATEGORY: Record<string, true> = { adult: true, minor: true, mixed: true };
const CONSENT_MODE: Record<string, true> = { self: true, guardian: true };

/**
 * Onboarding satu langkah: organisasi baru langsung dengan admin pertamanya.
 * Akun hasil pembuatan di sini belum menyetujui kebijakan (consent_version NULL);
 * persetujuan dicatat saat pemiliknya mendaftar atau menerima ulang kebijakan.
 */
adminRouter.post('/admin/organizations', async (req: AuthedRequest, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = asString(body.name ?? '', 'name', 200);
    if (!name) fail(422, 'validation_error', 'name wajib diisi.');
    const organizationType = asString(body.organization_type ?? '', 'organization_type', 50);
    if (!ORGANIZATION_TYPE[organizationType]) {
      fail(422, 'validation_error', 'organization_type harus school atau organization.');
    }
    const ageCategory =
      body.respondent_age_category === undefined
        ? 'adult'
        : asString(body.respondent_age_category, 'respondent_age_category', 20);
    if (!AGE_CATEGORY[ageCategory]) {
      fail(422, 'validation_error', 'respondent_age_category harus adult, minor, atau mixed.');
    }
    const consentMode =
      body.consent_mode === undefined ? 'self' : asString(body.consent_mode, 'consent_mode', 20);
    if (!CONSENT_MODE[consentMode]) {
      fail(422, 'validation_error', 'consent_mode harus self atau guardian.');
    }
    // PRD §1.2: responden minor/mixed mewajibkan persetujuan wali.
    if ((ageCategory === 'minor' || ageCategory === 'mixed') && consentMode === 'self') {
      fail(422, 'consent_mode_mismatch', 'respondent_age_category minor/mixed mewajibkan consent_mode guardian.');
    }
    const policyUrl =
      body.policy_url === undefined ? '/kebijakan-privasi' : asString(body.policy_url, 'policy_url', 500);
    if (!policyUrl) fail(422, 'validation_error', 'policy_url wajib diisi.');
    const termsUrl =
      body.terms_url === undefined ? '/ketentuan-layanan' : asString(body.terms_url, 'terms_url', 500);
    if (!termsUrl) fail(422, 'validation_error', 'terms_url wajib diisi.');
    const noticeVersion =
      body.notice_version === undefined ? '1.0' : asString(body.notice_version, 'notice_version', 20);
    if (!noticeVersion) fail(422, 'validation_error', 'notice_version wajib diisi.');

    let retentionDays: number | null = null;
    if (body.retention_days !== undefined && body.retention_days !== null) {
      const value = body.retention_days;
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        fail(422, 'validation_error', 'retention_days harus bilangan bulat >= 0.');
      }
      retentionDays = value;
    }
    let crossBorder: number | null = null;
    if (body.cross_border_transfer !== undefined && body.cross_border_transfer !== null) {
      if (typeof body.cross_border_transfer !== 'boolean') {
        fail(422, 'validation_error', 'cross_border_transfer harus boolean.');
      }
      crossBorder = body.cross_border_transfer ? 1 : 0;
    }
    const contact =
      body.data_request_contact === undefined || body.data_request_contact === null
        ? null
        : asString(body.data_request_contact, 'data_request_contact', 200) || null;

    const admin = (body.admin ?? {}) as Record<string, unknown>;
    const adminName = asString(admin.display_name ?? '', 'admin.display_name', 120).replace(/\s+/g, ' ');
    if (adminName.length < 2) {
      fail(422, 'validation_error', 'admin.display_name harus 2-120 karakter.');
    }
    const adminEmail = asString(admin.email ?? '', 'admin.email', 254).toLowerCase();
    if (!EMAIL_RE.test(adminEmail)) fail(422, 'validation_error', 'admin.email tidak valid.');
    const adminPassword = typeof admin.password === 'string' ? admin.password : '';
    const passwordError = passwordPolicyError(adminPassword);
    if (passwordError) fail(422, 'weak_password', passwordError);

    if (await get<{ id: string }>('SELECT id FROM accounts WHERE email = ?', adminEmail)) {
      fail(409, 'email_taken', 'Email sudah terdaftar. Tautkan akun itu ke organisasi lewat tabel akun, atau pakai email lain.');
    }

    const organizationId = newId('org');
    const accountId = newId('u');
    const createdAt = nowIso();
    await withTx(async () => {
      await run(
        `INSERT INTO organizations (id, name, organization_type, policy_url, terms_url, retention_days,
                                    data_request_contact, cross_border_transfer, notice_version, created_at,
                                    respondent_age_category, consent_mode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        organizationId,
        name,
        organizationType,
        policyUrl,
        termsUrl,
        retentionDays,
        contact,
        crossBorder,
        noticeVersion,
        createdAt,
        ageCategory,
        consentMode,
      );
      await run(
        `INSERT INTO accounts (id, email, display_name, role, status, password_hash, created_at,
                               consent_version, consent_accepted_at, organization_id)
         VALUES (?, ?, ?, 'org_admin', 'active', ?, ?, NULL, NULL, ?)`,
        accountId,
        adminEmail,
        adminName,
        hashPassword(adminPassword),
        createdAt,
        organizationId,
      );
    });
    await audit(req, 'Buat organisasi', organizationId, 'berhasil', {
      organization_id: organizationId,
      admin_account_id: accountId,
      organization_type: organizationType,
    });
    res.status(201).json({
      data: {
        organization: await get<Record<string, unknown>>('SELECT * FROM organizations WHERE id = ?', organizationId),
        account: await get<AccountRow>('SELECT id, email, display_name, role, status, organization_id FROM accounts WHERE id = ?', accountId),
      },
    });
  } catch (error) {
    sendError(res, error);
  }
});

async function replaceGrants(accountId: string, grants: GrantInput[]): Promise<void> {
  const account = await get<{ id: string }>('SELECT id FROM accounts WHERE id = ?', accountId);
  if (!account) fail(404, 'account_not_found', 'Akun tidak ditemukan.');
  for (const grant of grants) {
    if (grant.survey_id) {
      const survey = await get<{ id: string }>('SELECT id FROM surveys WHERE id = ?', grant.survey_id);
      if (!survey) fail(422, 'survey_not_found', `Survei ${grant.survey_id} tidak ditemukan.`);
    }
  }
  await withTx(async () => {
    await run('DELETE FROM access_grants WHERE account_id = ?', accountId);
    for (const grant of grants) {
      await run(
        `INSERT INTO access_grants (id, account_id, survey_id, can_read_individual, can_export, can_read_free_text)
         VALUES (?, ?, ?, ?, ?, ?)`,
        newId('g'),
        accountId,
        grant.survey_id,
        grant.can_read_individual ? 1 : 0,
        grant.can_export ? 1 : 0,
        grant.can_read_free_text ? 1 : 0,
      );
    }
  });
}

function parseGrant(raw: unknown): GrantInput {
  if (!raw || typeof raw !== 'object') fail(422, 'validation_error', 'Data izin tidak valid.');
  const row = raw as Record<string, unknown>;
  return {
    survey_id: typeof row.survey_id === 'string' && row.survey_id ? row.survey_id : null,
    can_read_individual: asBoolean(row.can_read_individual, false),
    can_export: asBoolean(row.can_export, false),
    can_read_free_text: asBoolean(row.can_read_free_text, false),
  };
}

adminRouter.put('/admin/grants/:id', async (req: AuthedRequest, res: Response) => {
  try {
    const raw = Array.isArray(req.body?.grants) ? req.body.grants : [];
    const grants = raw.map(parseGrant);
    await replaceGrants(pathParam(req, 'id'), grants);
    await audit(req, 'Ubah izin akses', pathParam(req, 'id'), 'berhasil', { grants: grants.length });
    res.json({ data: { ok: true, grants } });
  } catch (error) {
    sendError(res, error);
  }
});

adminRouter.put('/admin/grants', async (req: AuthedRequest, res: Response) => {
  try {
    const raw = Array.isArray(req.body?.grants) ? req.body.grants : [];
    const byAccount = new Map<string, GrantInput[]>();
    for (const item of raw) {
      if (!item || typeof item !== 'object') fail(422, 'validation_error', 'Data izin tidak valid.');
      const row = item as Record<string, unknown>;
      const accountId = asString(row.account_id ?? '', 'account_id', 100);
      if (!accountId) fail(422, 'validation_error', 'account_id wajib diisi.');
      const list = byAccount.get(accountId) ?? [];
      list.push(parseGrant(item));
      byAccount.set(accountId, list);
    }
    const accountIds = [...byAccount.keys()];
    await withTx(async () => {
      // Hanya akun yang disebut pada payload yang izinnya diganti; izin akun lain tetap utuh.
      if (accountIds.length > 0) {
        const list = await all<{ id: string }>(
          `SELECT id FROM accounts WHERE id IN (${accountIds.map(() => '?').join(',')})`,
          ...accountIds,
        );
        if (list.length !== accountIds.length) {
          const known = new Set(list.map((row) => row.id));
          fail(422, 'account_not_found', `Akun ${accountIds.find((id) => !known.has(id))} tidak ditemukan.`);
        }
        await run(
          `DELETE FROM access_grants WHERE account_id IN (${accountIds.map(() => '?').join(',')})`,
          ...accountIds,
        );
      }
      for (const [accountId, grants] of byAccount) {
        for (const grant of grants) {
          if (grant.survey_id && !(await get<{ id: string }>('SELECT id FROM surveys WHERE id = ?', grant.survey_id))) {
            fail(422, 'survey_not_found', `Survei ${grant.survey_id} tidak ditemukan.`);
          }
          await run(
            `INSERT INTO access_grants (id, account_id, survey_id, can_read_individual, can_export, can_read_free_text)
             VALUES (?, ?, ?, ?, ?, ?)`,
            newId('g'),
            accountId,
            grant.survey_id,
            grant.can_read_individual ? 1 : 0,
            grant.can_export ? 1 : 0,
            grant.can_read_free_text ? 1 : 0,
          );
        }
      }
    });
    await audit(req, 'Ubah izin akses', accountIds.join(', ') || 'tidak ada akun', 'berhasil', { rows: raw.length });
    res.json({ data: { ok: true } });
  } catch (error) {
    sendError(res, error);
  }
});

adminRouter.get('/admin/audit', async (req: AuthedRequest, res: Response) => {
  try {
    const limit = parseLimit(req.query.limit, 100, 500);
    const rows = await all<Record<string, unknown>>('SELECT * FROM audit_logs ORDER BY at DESC LIMIT ?', limit);
    res.json({ data: rows });
  } catch (error) {
    sendError(res, error);
  }
});

adminRouter.get('/admin/integration', async (_req: AuthedRequest, res: Response) => {
  try {
    const rows = await all<Record<string, unknown>>('SELECT * FROM integration_events ORDER BY at DESC LIMIT 250');
    res.json({ data: rows });
  } catch (error) {
    sendError(res, error);
  }
});

adminRouter.post('/admin/integration/:id/retry', async (req: AuthedRequest, res: Response) => {
  try {
    const event = await get<EventRow>(
      'SELECT * FROM integration_events WHERE id = ? OR event_id = ?',
      pathParam(req, 'id'),
      pathParam(req, 'id'),
    );
    if (!event) fail(404, 'event_not_found', 'Event integrasi tidak ditemukan.');
    if (event.type === 'survey.submitted') {
      const response = event.response_id
        ? await get<{ id: string }>('SELECT id FROM responses WHERE id = ?', event.response_id)
        : undefined;
      if (!response) {
        await run(
          "UPDATE integration_events SET attempts = attempts + 1, status = 'failed', last_error = ? WHERE id = ?",
          'Respons tidak ditemukan; retry tidak boleh menandai terkirim.',
          event.id,
        );
        await audit(req, 'Retry integrasi', event.event_id, 'gagal', { reason: 'response_missing' });
        fail(409, 'response_missing', 'Retry tidak dapat dilakukan karena respons sumber tidak ada.');
      }
      await run(
        "UPDATE integration_events SET attempts = attempts + 1, status = 'delivered', last_error = NULL WHERE id = ?",
        event.id,
      );
      await audit(req, 'Retry integrasi', event.event_id, 'berhasil', { target: event.target, response_id: response.id });
      res.json({ data: { ok: true, status: 'delivered' } });
      return;
    }
    await run(
      "UPDATE integration_events SET attempts = attempts + 1, status = 'failed', last_error = ? WHERE id = ?",
      'Baca ulang schema melalui endpoint integrasi; retry tidak membuktikan pengiriman data.',
      event.id,
    );
    await audit(req, 'Retry integrasi', event.event_id, 'gagal', { reason: 'not_a_delivery_event' });
    fail(409, 'not_delivery_event', 'Event baca-schema tidak dapat ditandai terkirim lewat retry. Gunakan endpoint integrasi.');
  } catch (error) {
    sendError(res, error);
  }
});

adminRouter.get('/admin/data-requests', async (_req: AuthedRequest, res: Response) => {
  try {
    res.json({ data: await all<Record<string, unknown>>('SELECT * FROM data_requests ORDER BY created_at DESC LIMIT 250') });
  } catch (error) {
    sendError(res, error);
  }
});

adminRouter.patch('/admin/data-requests/:id', async (req: AuthedRequest, res: Response) => {
  try {
    const row = await get<{ id: string }>('SELECT id FROM data_requests WHERE id = ?', pathParam(req, 'id'));
    if (!row) fail(404, 'request_not_found', 'Permintaan data tidak ditemukan.');
    const status = typeof req.body?.status === 'string' ? req.body.status : 'handled';
    if (!['pending', 'in_progress', 'handled', 'rejected'].includes(status)) {
      fail(422, 'validation_error', 'Status permintaan tidak dikenal.');
    }
    const note = typeof req.body?.outcome_note === 'string' ? req.body.outcome_note.trim() : null;
    await run(
      'UPDATE data_requests SET status = ?, outcome_note = ?, handled_by = ?, updated_at = ? WHERE id = ?',
      status,
      note,
      req.account?.id ?? null,
      nowIso(),
      row.id,
    );
    await audit(req, 'Tangani permintaan data', row.id, 'berhasil', { status });
    res.json({ data: { ok: true, status } });
  } catch (error) {
    sendError(res, error);
  }
});

adminRouter.get('/admin/stats', async (_req: AuthedRequest, res: Response) => {
  try {
    const count = async (sql: string) => Number((await get<{ count: number }>(sql))?.count ?? 0);
    res.json({
      data: {
        accounts: await count('SELECT COUNT(*) AS count FROM accounts'),
        surveys: await count('SELECT COUNT(*) AS count FROM surveys'),
        responses: await count('SELECT COUNT(*) AS count FROM responses'),
        pendingRequests: await count("SELECT COUNT(*) AS count FROM data_requests WHERE status = 'pending'"),
        perCreator: await all<{ id: string; display_name: string; surveys: number; responses: number }>(
          `SELECT a.id, a.display_name,
                  COUNT(DISTINCT s.id) AS surveys,
                  COUNT(DISTINCT r.id) AS responses
             FROM accounts a
             LEFT JOIN surveys s ON s.owner_id = a.id
             LEFT JOIN responses r ON r.survey_id = s.id
             WHERE a.role = 'creator'
            GROUP BY a.id, a.display_name
            ORDER BY a.display_name`,
        ),
        perSurvey: await all<{ id: string; title: string; owner: string; versions: number; responses: number }>(
          `SELECT s.id, s.title, a.display_name AS owner,
                  COUNT(DISTINCT v.id) AS versions,
                  COUNT(DISTINCT r.id) AS responses
             FROM surveys s
             LEFT JOIN accounts a ON a.id = s.owner_id
             LEFT JOIN survey_versions v ON v.survey_id = s.id
             LEFT JOIN responses r ON r.survey_id = s.id
            GROUP BY s.id, s.title, s.updated_at, a.display_name
            ORDER BY s.updated_at DESC`,
        ),
      },
    });
  } catch (error) {
    sendError(res, error);
  }
});
