import { Router } from 'express';
import type { Response } from 'express';
import { all, get, nowIso, run, withTx } from '../db.ts';
import { ORGANIZATION_TYPE_SET, ORGANIZATION_TYPES } from '../organization-types.ts';
import { noticeVersionForNewOrganization, provisionNoticesForNewOrganization } from '../notice-provisioning.ts';
import type { AuthedRequest } from '../security.ts';
import { hashPassword, passwordPolicyError, redactAuditRow, requireRole, revokeSessionsOnStatusChange } from '../security.ts';
import {
  asBoolean,
  asString,
  audit,
  fail,
  newId,
  parseLimit,
  pathParam,
  rejectSelfGrant,
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
  /** BR-06: wajib diisi; tanpa tujuan, grant lintas tenant tidak dapat ditinjau. */
  purpose: string;
  expires_at: string | null;
  granted_by: string;
}

/**
 * BR-06: `expires_at` masa lalu ditolak — super admin yang ingin mencabut grant menghapus barisnya.
 * Nilai tak-terurai atau tanpa zona waktu ditolak agar kedaluwarsa tidak ambigu antar zona.
 */
function grantExpiry(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const value = typeof raw === 'string' ? raw.trim() : '';
  const at = Date.parse(value);
  if (!value || Number.isNaN(at) || !/[zZ]|[+-]\d{2}:?\d{2}$/u.test(value)) {
    fail(422, 'validation_error', 'expires_at harus waktu ISO-8601 dengan zona waktu, atau null.');
  }
  if (at <= Date.now()) fail(422, 'validation_error', 'expires_at harus di masa depan; hapus grant untuk mencabutnya.');
  return value;
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

adminRouter.get('/admin/accounts', async (req: AuthedRequest, res: Response) => {
  try {
    const accounts = await all<AccountRow & { created_at: string }>(
      'SELECT id, email, display_name, role, status, organization_id, created_at FROM accounts ORDER BY display_name',
    );
    // Grant ikut lingkup akun penerima: creator/super_admin hanya melihat grant yang berlaku untuknya.
    // Penerima grant adalah akun non-super_admin, jadi penyaring `g.account_id` tidak menghilangkan grant
    // milik akun lain bagi super admin (`g.account_id = g.account_id`).
    const grants = await all<Record<string, unknown>>(
      `SELECT g.*, s.title AS survey_title
         FROM access_grants g
         LEFT JOIN surveys s ON s.id = g.survey_id
         LEFT JOIN accounts a ON a.id = g.account_id
        WHERE a.role <> 'super_admin'
          AND (g.account_id = ? OR ? = 'super_admin')
        ORDER BY g.account_id, g.survey_id`,
      req.account!.id,
      req.account!.role,
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
    await withTx(async () => {
      await run(
        'UPDATE accounts SET role = ?, status = ?, organization_id = ? WHERE id = ?',
        role,
        status,
        organizationId,
        account.id,
      );
      await revokeSessionsOnStatusChange(account.id, account.status, status);
    });
    await audit(req, 'Ubah akun', account.id, 'berhasil', { role, status, organization_id: organizationId });
    res.json({ data: { ...account, role, status, organization_id: organizationId } });
  } catch (error) {
    sendError(res, error);
  }
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    if (!ORGANIZATION_TYPE_SET.has(organizationType)) {
      fail(422, 'validation_error', `organization_type harus salah satu: ${ORGANIZATION_TYPES.join(', ')}.`);
    }
    const policyUrl =
      body.policy_url === undefined ? '/kebijakan-privasi' : asString(body.policy_url, 'policy_url', 500);
    if (!policyUrl) fail(422, 'validation_error', 'policy_url wajib diisi.');
    const termsUrl =
      body.terms_url === undefined ? '/ketentuan-layanan' : asString(body.terms_url, 'terms_url', 500);
    if (!termsUrl) fail(422, 'validation_error', 'terms_url wajib diisi.');
    const requestedNoticeVersion =
      body.notice_version === undefined ? null : asString(body.notice_version, 'notice_version', 20);
    if (requestedNoticeVersion === '') fail(422, 'validation_error', 'notice_version wajib diisi.');

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

    // Notice awal berasal dari profil legacy hanya bila notice_profile_name dikirim; tanpa itu (payload UI)
    // organisasi mendapat salinan notice platform. Nama organisasi tidak dicocokkan ke profil legacy.
    const noticeProfile =
      body.notice_profile_name === undefined || body.notice_profile_name === null
        ? null
        : asString(body.notice_profile_name, 'notice_profile_name', 200) || null;
    const noticeVersion = requestedNoticeVersion ?? (await noticeVersionForNewOrganization(noticeProfile));

    const organizationId = newId('org');
    const accountId = newId('u');
    const createdAt = nowIso();
    const provisioned = await withTx(async () => {
      await run(
        `INSERT INTO organizations (id, name, organization_type, policy_url, terms_url, retention_days,
                                    data_request_contact, cross_border_transfer, notice_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      );
      await run(
        `INSERT INTO accounts (id, email, display_name, role, status, password_hash, created_at,
                               consent_version, consent_accepted_at, organization_id)
         VALUES (?, ?, ?, 'org_admin', 'active', ?, ?, NULL, NULL, ?)`,
        accountId,
        adminEmail,
        adminName,
        await hashPassword(adminPassword),
        createdAt,
        organizationId,
      );
      // Tanpa notice, survei publik organisasi baru gagal notice_version_unavailable; provisioning
      // berjalan dalam transaksi yang sama agar organisasi tanpa notice tidak pernah terlihat.
      return provisionNoticesForNewOrganization(organizationId, noticeVersion, noticeProfile);
    });
    await audit(req, 'Buat organisasi', organizationId, 'berhasil', {
      organization_id: organizationId,
      admin_account_id: accountId,
      organization_type: organizationType,
      notice_version: noticeVersion,
      notice_source: provisioned.source,
      notice_count: provisioned.organization_notices,
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

const PLATFORM_COLUMNS = `id, organization_name, organization_type, policy_url, terms_url, retention_days,
  data_request_contact, cross_border_transfer, notice_version, updated_at`;

/** Profil platform dipakai akun tanpa organisasi; sebelumnya hanya bisa dibaca lewat /org/profile. */
adminRouter.get('/admin/platform-profile', async (_req: AuthedRequest, res: Response) => {
  try {
    const profile = await get<Record<string, unknown>>(
      `SELECT ${PLATFORM_COLUMNS} FROM platform_profile WHERE id = 'platform'`,
    );
    if (!profile) fail(404, 'profile_missing', 'Profil platform belum dikonfigurasi.');
    res.setHeader('Cache-Control', 'no-store');
    res.json({ data: { profile } });
  } catch (error) {
    sendError(res, error);
  }
});

adminRouter.put('/admin/platform-profile', async (req: AuthedRequest, res: Response) => {
  try {
    const current = await get<Record<string, unknown>>(
      `SELECT ${PLATFORM_COLUMNS} FROM platform_profile WHERE id = 'platform'`,
    );
    if (!current) fail(404, 'profile_missing', 'Profil platform belum dikonfigurasi.');
    const body = (req.body ?? {}) as Record<string, unknown>;
    /** Field yang tidak dikirim mempertahankan nilai tersimpan. */
    const merged = (key: string, stored: unknown, max: number): string =>
      body[key] === undefined ? String(stored ?? '') : asString(body[key], key, max);
    const required = (key: string, max: number): string => {
      const value = merged(key, current[key], max);
      if (!value) fail(422, 'validation_error', `${key} wajib diisi.`);
      return value;
    };

    let retentionDays: number | null = current.retention_days as number | null;
    if (body.retention_days !== undefined) {
      const value = body.retention_days;
      if (value !== null && (typeof value !== 'number' || !Number.isInteger(value) || value < 0)) {
        fail(422, 'validation_error', 'retention_days harus bilangan bulat >= 0.');
      }
      retentionDays = value as number | null;
    }
    let crossBorder: number | null = current.cross_border_transfer as number | null;
    if (body.cross_border_transfer !== undefined) {
      if (typeof body.cross_border_transfer !== 'boolean') {
        fail(422, 'validation_error', 'cross_border_transfer harus boolean.');
      }
      crossBorder = body.cross_border_transfer ? 1 : 0;
    }
    const organizationName = required('organization_name', 200);
    const organizationType = required('organization_type', 50);
    const policyUrl = required('policy_url', 500);
    const termsUrl = required('terms_url', 500);
    await run(
      `UPDATE platform_profile
          SET organization_name = ?, organization_type = ?, policy_url = ?, terms_url = ?,
              retention_days = ?, data_request_contact = ?, cross_border_transfer = ?, updated_at = ?
        WHERE id = 'platform'`,
      organizationName,
      organizationType,
      policyUrl,
      termsUrl,
      retentionDays,
      merged('data_request_contact', current.data_request_contact, 200) || null,
      crossBorder,
      nowIso(),
    );
    await audit(req, 'Ubah profil platform', 'platform', 'berhasil', {
      organization_type: organizationType,
    });
    res.json({
      data: {
        profile: await get<Record<string, unknown>>(
          `SELECT ${PLATFORM_COLUMNS} FROM platform_profile WHERE id = 'platform'`,
        ),
      },
    });
  } catch (error) {
    sendError(res, error);
  }
});

/** Baris audit izin (SEC-14): per grant, siapa memberi, untuk apa, dan sampai kapan. */
function grantAuditRows(rows: GrantInput[]): Array<Record<string, unknown>> {
  return rows.map((grant) => ({
    survey_id: grant.survey_id,
    purpose: grant.purpose,
    expires_at: grant.expires_at,
    granted_by: grant.granted_by,
  }));
}

async function replaceGrants(accountId: string, grants: GrantInput[], grantedBy: string): Promise<void> {
  const account = await get<{ id: string; role: string }>('SELECT id, role FROM accounts WHERE id = ?', accountId);
  if (!account) fail(404, 'account_not_found', 'Akun tidak ditemukan.');
  rejectSelfGrant(account.id, grantedBy, account.role);
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
        `INSERT INTO access_grants (id, account_id, survey_id, can_read_individual, can_export, can_read_free_text,
                                    purpose, expires_at, granted_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId('g'),
        accountId,
        grant.survey_id,
        grant.can_read_individual ? 1 : 0,
        grant.can_export ? 1 : 0,
        grant.can_read_free_text ? 1 : 0,
        grant.purpose,
        grant.expires_at,
        grant.granted_by,
      );
    }
  });
}

/** `grantedBy` adalah super admin pemanggil: pemberi grant tidak dapat dipalsukan lewat payload. */
function parseGrant(raw: unknown, grantedBy: string): GrantInput {
  if (!raw || typeof raw !== 'object') fail(422, 'validation_error', 'Data izin tidak valid.');
  const row = raw as Record<string, unknown>;
  const purpose = typeof row.purpose === 'string' ? row.purpose.trim() : '';
  if (purpose.length < 3 || purpose.length > 300) {
    fail(422, 'validation_error', 'purpose grant wajib diisi 3-300 karakter.');
  }
  return {
    survey_id: typeof row.survey_id === 'string' && row.survey_id ? row.survey_id : null,
    can_read_individual: asBoolean(row.can_read_individual, false),
    can_export: asBoolean(row.can_export, false),
    can_read_free_text: asBoolean(row.can_read_free_text, false),
    purpose,
    expires_at: grantExpiry(row.expires_at),
    granted_by: grantedBy,
  };
}

adminRouter.put('/admin/grants/:id', async (req: AuthedRequest, res: Response) => {
  try {
    const grantedBy = req.account!.id;
    const raw: unknown[] = Array.isArray(req.body?.grants) ? (req.body.grants as unknown[]) : [];
    const grants = raw.map((item) => parseGrant(item, grantedBy));
    await replaceGrants(pathParam(req, 'id'), grants, grantedBy);
    await audit(req, 'Ubah izin akses', pathParam(req, 'id'), 'berhasil', { grants: grantAuditRows(grants) });
    res.json({ data: { ok: true, grants } });
  } catch (error) {
    sendError(res, error);
  }
});

adminRouter.put('/admin/grants', async (req: AuthedRequest, res: Response) => {
  try {
    const grantedBy = req.account!.id;
    const raw: unknown[] = Array.isArray(req.body?.grants) ? (req.body.grants as unknown[]) : [];
    const rawByAccount = new Map<string, unknown[]>();
    for (const item of raw) {
      if (!item || typeof item !== 'object') fail(422, 'validation_error', 'Data izin tidak valid.');
      const row = item as Record<string, unknown>;
      const accountId = asString(row.account_id ?? '', 'account_id', 100);
      if (!accountId) fail(422, 'validation_error', 'account_id wajib diisi.');
      const list = rawByAccount.get(accountId) ?? [];
      list.push(item);
      rawByAccount.set(accountId, list);
    }
    const accountIds = [...rawByAccount.keys()];
    // SEC-15 diperiksa sebelum bentuk payload lain: balasan harus menyebut aturannya, bukan field pertama
    // yang kebetulan kosong.
    const known = accountIds.length
      ? await all<{ id: string; role: string }>(
          `SELECT id, role FROM accounts WHERE id IN (${accountIds.map(() => '?').join(',')})`,
          ...accountIds,
        )
      : [];
    for (const account of known) rejectSelfGrant(account.id, grantedBy, account.role);
    const byAccount = new Map<string, GrantInput[]>(
      [...rawByAccount].map(([accountId, items]) => [accountId, items.map((item) => parseGrant(item, grantedBy))] as const),
    );
    await withTx(async () => {
      // Hanya akun yang disebut pada payload yang izinnya diganti; izin akun lain tetap utuh.
      if (accountIds.length > 0) {
        if (known.length !== accountIds.length) {
          const knownIds = new Set(known.map((row) => row.id));
          fail(422, 'account_not_found', `Akun ${accountIds.find((id) => !knownIds.has(id))} tidak ditemukan.`);
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
            `INSERT INTO access_grants (id, account_id, survey_id, can_read_individual, can_export, can_read_free_text,
                                        purpose, expires_at, granted_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            newId('g'),
            accountId,
            grant.survey_id,
            grant.can_read_individual ? 1 : 0,
            grant.can_export ? 1 : 0,
            grant.can_read_free_text ? 1 : 0,
            grant.purpose,
            grant.expires_at,
            grant.granted_by,
          );
        }
      }
    });
    const detail = [...byAccount.entries()].flatMap(([accountId, grants]) =>
      grants.map((grant) => ({ account_id: accountId, ...grantAuditRows([grant])[0] })),
    );
    await audit(req, 'Ubah izin akses', accountIds.join(', ') || 'tidak ada akun', 'berhasil', { grants: detail });
    res.json({ data: { ok: true } });
  } catch (error) {
    sendError(res, error);
  }
});

adminRouter.get('/admin/audit', async (req: AuthedRequest, res: Response) => {
  try {
    const limit = parseLimit(req.query.limit, 100, 500);
    const rows = await all<{ object: string; metadata: string | null }>('SELECT * FROM audit_logs ORDER BY at DESC LIMIT ?', limit);
    res.json({ data: rows.map(redactAuditRow) });
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
    const responseChannel = asString(req.body?.response_channel ?? '', 'response_channel', 80).trim();
    // Verifikasi pemohon = balasan pengelola ke kontak yang diberikan; tanpa bukti balasan
    // status 'handled' tidak boleh diklaim.
    if (status === 'handled' && !responseChannel) {
      fail(422, 'response_evidence_required', 'Status handled wajib mencatat response_channel sebagai bukti balasan.');
    }
    const at = nowIso();
    const actor = req.account?.id ?? null;
    await run(
      `UPDATE data_requests
          SET status = ?, outcome_note = ?, handled_by = ?, updated_at = ?,
              responded_at = CASE WHEN ? = '' THEN responded_at ELSE ? END,
              responded_by = CASE WHEN ? = '' THEN responded_by ELSE ? END,
              response_channel = CASE WHEN ? = '' THEN response_channel ELSE ? END
        WHERE id = ?`,
      status,
      note,
      actor,
      at,
      responseChannel,
      at,
      responseChannel,
      actor,
      responseChannel,
      responseChannel,
      row.id,
    );
    await audit(req, 'Tangani permintaan data', row.id, 'berhasil', { status, response_channel: responseChannel });
    res.json({ data: { ok: true, status, responded_at: responseChannel ? at : null, response_channel: responseChannel || null } });
  } catch (error) {
    sendError(res, error);
  }
});

type StatsRange = 'today' | '7d' | '30d' | '6m';

const STATS_RANGES: readonly StatsRange[] = ['today', '7d', '30d', '6m'];

/** Rentang grafik: nilai hilang memakai 30d, nilai lain adalah galat klien. */
function statsRange(raw: unknown): StatsRange {
  if (raw === undefined) return '30d';
  if (typeof raw !== 'string' || !STATS_RANGES.includes(raw as StatsRange)) {
    fail(400, 'validation_error', 'range harus salah satu dari today, 7d, 30d, atau 6m.');
  }
  return raw as StatsRange;
}

/**
 * Satu query agregat per rentang: bucket penuh dari generate_series LEFT JOIN hitungan respons,
 * sehingga periode kosong tetap hadir bernilai 0. Semua batas dan bucket memakai waktu WIB;
 * `submitted_at` disimpan sebagai teks ISO UTC dan baru dikonversi di sini.
 */
const STATS_CHART_SQL: Record<StatsRange, string> = {
  today: `
    WITH bounds AS (
      SELECT date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta') AS start_wib
    ),
    buckets AS (
      SELECT generate_series(start_wib, start_wib + interval '23 hours', interval '1 hour') AS bucket
        FROM bounds
    ),
    counts AS (
      SELECT date_trunc('hour', submitted_at::timestamptz AT TIME ZONE 'Asia/Jakarta') AS bucket,
             COUNT(*)::int AS responses
        FROM responses, bounds
       WHERE submitted_at::timestamptz >= start_wib AT TIME ZONE 'Asia/Jakarta'
         AND submitted_at::timestamptz < (start_wib + interval '1 day') AT TIME ZONE 'Asia/Jakarta'
       GROUP BY 1
    )
    SELECT to_char(b.bucket, 'YYYY-MM-DD"T"HH24') AS point, COALESCE(c.responses, 0) AS responses
      FROM buckets b
      LEFT JOIN counts c USING (bucket)
     ORDER BY b.bucket`,
  '7d': `
    WITH bounds AS (
      SELECT date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta') - interval '6 days' AS start_wib,
             date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta') + interval '1 day' AS end_wib
    ),
    buckets AS (
      SELECT generate_series(start_wib, end_wib - interval '1 day', interval '1 day') AS bucket
        FROM bounds
    ),
    counts AS (
      SELECT date_trunc('day', submitted_at::timestamptz AT TIME ZONE 'Asia/Jakarta') AS bucket,
             COUNT(*)::int AS responses
        FROM responses, bounds
       WHERE submitted_at::timestamptz >= start_wib AT TIME ZONE 'Asia/Jakarta'
         AND submitted_at::timestamptz < end_wib AT TIME ZONE 'Asia/Jakarta'
       GROUP BY 1
    )
    SELECT to_char(b.bucket, 'YYYY-MM-DD') AS point, COALESCE(c.responses, 0) AS responses
      FROM buckets b
      LEFT JOIN counts c USING (bucket)
     ORDER BY b.bucket`,
  '30d': `
    WITH bounds AS (
      SELECT date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta') - interval '29 days' AS start_wib,
             date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta') + interval '1 day' AS end_wib
    ),
    buckets AS (
      SELECT generate_series(start_wib, end_wib - interval '1 day', interval '1 day') AS bucket
        FROM bounds
    ),
    counts AS (
      SELECT date_trunc('day', submitted_at::timestamptz AT TIME ZONE 'Asia/Jakarta') AS bucket,
             COUNT(*)::int AS responses
        FROM responses, bounds
       WHERE submitted_at::timestamptz >= start_wib AT TIME ZONE 'Asia/Jakarta'
         AND submitted_at::timestamptz < end_wib AT TIME ZONE 'Asia/Jakarta'
       GROUP BY 1
    )
    SELECT to_char(b.bucket, 'YYYY-MM-DD') AS point, COALESCE(c.responses, 0) AS responses
      FROM buckets b
      LEFT JOIN counts c USING (bucket)
     ORDER BY b.bucket`,
  '6m': `
    WITH bounds AS (
      SELECT date_trunc('month', now() AT TIME ZONE 'Asia/Jakarta') - interval '5 months' AS start_wib,
             date_trunc('month', now() AT TIME ZONE 'Asia/Jakarta') + interval '1 month' AS end_wib
    ),
    buckets AS (
      SELECT generate_series(start_wib, end_wib - interval '1 month', interval '1 month') AS bucket
        FROM bounds
    ),
    counts AS (
      SELECT date_trunc('month', submitted_at::timestamptz AT TIME ZONE 'Asia/Jakarta') AS bucket,
             COUNT(*)::int AS responses
        FROM responses, bounds
       WHERE submitted_at::timestamptz >= start_wib AT TIME ZONE 'Asia/Jakarta'
         AND submitted_at::timestamptz < end_wib AT TIME ZONE 'Asia/Jakarta'
       GROUP BY 1
    )
    SELECT to_char(b.bucket, 'YYYY-MM') AS point, COALESCE(c.responses, 0) AS responses
      FROM buckets b
      LEFT JOIN counts c USING (bucket)
     ORDER BY b.bucket`,
};

adminRouter.get('/admin/stats', async (req: AuthedRequest, res: Response) => {
  try {
    const range = statsRange(req.query.range);
    const count = async (sql: string) => Number((await get<{ count: number }>(sql))?.count ?? 0);
    res.json({
      data: {
        accounts: await count('SELECT COUNT(*) AS count FROM accounts'),
        surveys: await count('SELECT COUNT(*) AS count FROM surveys'),
        responses: await count('SELECT COUNT(*) AS count FROM responses'),
        pendingRequests: await count("SELECT COUNT(*) AS count FROM data_requests WHERE status = 'pending'"),
        chart: await all<{ point: string; responses: number }>(STATS_CHART_SQL[range]),
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
