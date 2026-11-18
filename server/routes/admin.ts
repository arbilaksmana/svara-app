import { Router } from 'express';
import type { Response } from 'express';
import { all, get, nowIso, run, withTx } from '../db.ts';
import type { AuthedRequest } from '../security.ts';
import { requireRole } from '../security.ts';
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

function activeSuperAdmins(): number {
  return get<{ count: number }>(
    "SELECT COUNT(*) AS count FROM accounts WHERE role = 'super_admin' AND status = 'active'",
  )?.count ?? 0;
}

adminRouter.get('/admin/accounts', (_req: AuthedRequest, res: Response) => {
  try {
    const accounts = all<AccountRow & { created_at: string }>(
      'SELECT id, email, display_name, role, status, created_at FROM accounts ORDER BY display_name',
    );
    const grants = all<Record<string, unknown>>(
      `SELECT g.*, s.title AS survey_title
         FROM access_grants g LEFT JOIN surveys s ON s.id = g.survey_id
        ORDER BY g.account_id, g.survey_id`,
    );
    res.json({ data: { accounts, grants } });
  } catch (error) {
    sendError(res, error);
  }
});

adminRouter.patch('/admin/accounts/:id', (req: AuthedRequest, res: Response) => {
  try {
    const account = get<AccountRow>('SELECT * FROM accounts WHERE id = ?', pathParam(req, 'id'));
    if (!account) fail(404, 'account_not_found', 'Akun tidak ditemukan.');
    const role = typeof req.body?.role === 'string' ? req.body.role : account.role;
    const status = typeof req.body?.status === 'string' ? req.body.status : account.status;
    if (!['super_admin', 'creator', 'authorized_officer'].includes(role)) {
      fail(422, 'validation_error', 'Peran akun tidak dikenal.');
    }
    if (!['active', 'suspended'].includes(status)) {
      fail(422, 'validation_error', 'Status akun tidak dikenal.');
    }
    if (account.role === 'super_admin' && (role !== 'super_admin' || status !== 'active') && activeSuperAdmins() <= 1) {
      fail(409, 'last_super_admin', 'Tidak dapat menonaktifkan super admin terakhir.');
    }
    run('UPDATE accounts SET role = ?, status = ? WHERE id = ?', role, status, account.id);
    audit(req, 'Ubah akun', account.id, 'berhasil', { role, status });
    res.json({ data: { ...account, role, status } });
  } catch (error) {
    sendError(res, error);
  }
});

function replaceGrants(accountId: string, grants: GrantInput[]): void {
  const account = get<{ id: string }>('SELECT id FROM accounts WHERE id = ?', accountId);
  if (!account) fail(404, 'account_not_found', 'Akun tidak ditemukan.');
  for (const grant of grants) {
    if (grant.survey_id) {
      const survey = get<{ id: string }>('SELECT id FROM surveys WHERE id = ?', grant.survey_id);
      if (!survey) fail(422, 'survey_not_found', `Survei ${grant.survey_id} tidak ditemukan.`);
    }
  }
  withTx(() => {
    run('DELETE FROM access_grants WHERE account_id = ?', accountId);
    for (const grant of grants) {
      run(
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

adminRouter.put('/admin/grants/:id', (req: AuthedRequest, res: Response) => {
  try {
    const raw = Array.isArray(req.body?.grants) ? req.body.grants : [];
    const grants = raw.map(parseGrant);
    replaceGrants(pathParam(req, 'id'), grants);
    audit(req, 'Ubah izin akses', pathParam(req, 'id'), 'berhasil', { grants: grants.length });
    res.json({ data: { ok: true, grants } });
  } catch (error) {
    sendError(res, error);
  }
});

adminRouter.put('/admin/grants', (req: AuthedRequest, res: Response) => {
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
    withTx(() => {
      run('DELETE FROM access_grants');
      for (const [accountId, grants] of byAccount) {
        const account = get<{ id: string }>('SELECT id FROM accounts WHERE id = ?', accountId);
        if (!account) fail(422, 'account_not_found', `Akun ${accountId} tidak ditemukan.`);
        for (const grant of grants) {
          if (grant.survey_id && !get<{ id: string }>('SELECT id FROM surveys WHERE id = ?', grant.survey_id)) {
            fail(422, 'survey_not_found', `Survei ${grant.survey_id} tidak ditemukan.`);
          }
          run(
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
    audit(req, 'Ubah izin akses', 'semua akun', 'berhasil', { rows: raw.length });
    res.json({ data: { ok: true } });
  } catch (error) {
    sendError(res, error);
  }
});

adminRouter.get('/admin/audit', (req: AuthedRequest, res: Response) => {
  try {
    const limit = parseLimit(req.query.limit, 100, 500);
    const rows = all<Record<string, unknown>>('SELECT * FROM audit_logs ORDER BY at DESC LIMIT ?', limit);
    res.json({ data: rows });
  } catch (error) {
    sendError(res, error);
  }
});

adminRouter.get('/admin/integration', (_req: AuthedRequest, res: Response) => {
  try {
    const rows = all<Record<string, unknown>>('SELECT * FROM integration_events ORDER BY at DESC LIMIT 250');
    res.json({ data: rows });
  } catch (error) {
    sendError(res, error);
  }
});

adminRouter.post('/admin/integration/:id/retry', (req: AuthedRequest, res: Response) => {
  try {
    const event = get<EventRow>('SELECT * FROM integration_events WHERE id = ? OR event_id = ?', pathParam(req, 'id'), pathParam(req, 'id'));
    if (!event) fail(404, 'event_not_found', 'Event integrasi tidak ditemukan.');
    if (event.type === 'survey.submitted') {
      const response = event.response_id
        ? get<{ id: string }>('SELECT id FROM responses WHERE id = ?', event.response_id)
        : undefined;
      if (!response) {
        run(
          "UPDATE integration_events SET attempts = attempts + 1, status = 'failed', last_error = ? WHERE id = ?",
          'Respons tidak ditemukan; retry tidak boleh menandai terkirim.',
          event.id,
        );
        audit(req, 'Retry integrasi', event.event_id, 'gagal', { reason: 'response_missing' });
        fail(409, 'response_missing', 'Retry tidak dapat dilakukan karena respons sumber tidak ada.');
      }
      run(
        "UPDATE integration_events SET attempts = attempts + 1, status = 'delivered', last_error = NULL WHERE id = ?",
        event.id,
      );
      audit(req, 'Retry integrasi', event.event_id, 'berhasil', { target: event.target, response_id: response.id });
      res.json({ data: { ok: true, status: 'delivered' } });
      return;
    }
    run(
      "UPDATE integration_events SET attempts = attempts + 1, status = 'failed', last_error = ? WHERE id = ?",
      'Baca ulang schema melalui endpoint integrasi; retry tidak membuktikan pengiriman data.',
      event.id,
    );
    audit(req, 'Retry integrasi', event.event_id, 'gagal', { reason: 'not_a_delivery_event' });
    fail(409, 'not_delivery_event', 'Event baca-schema tidak dapat ditandai terkirim lewat retry. Gunakan endpoint integrasi.');
  } catch (error) {
    sendError(res, error);
  }
});

adminRouter.get('/admin/data-requests', (_req: AuthedRequest, res: Response) => {
  try {
    res.json({ data: all<Record<string, unknown>>('SELECT * FROM data_requests ORDER BY created_at DESC LIMIT 250') });
  } catch (error) {
    sendError(res, error);
  }
});

adminRouter.patch('/admin/data-requests/:id', (req: AuthedRequest, res: Response) => {
  try {
    const row = get<{ id: string }>('SELECT id FROM data_requests WHERE id = ?', pathParam(req, 'id'));
    if (!row) fail(404, 'request_not_found', 'Permintaan data tidak ditemukan.');
    const status = typeof req.body?.status === 'string' ? req.body.status : 'handled';
    if (!['pending', 'in_progress', 'handled', 'rejected'].includes(status)) {
      fail(422, 'validation_error', 'Status permintaan tidak dikenal.');
    }
    const note = typeof req.body?.outcome_note === 'string' ? req.body.outcome_note.trim() : null;
    run(
      'UPDATE data_requests SET status = ?, outcome_note = ?, handled_by = ?, updated_at = ? WHERE id = ?',
      status,
      note,
      req.account?.id ?? null,
      nowIso(),
      row.id,
    );
    audit(req, 'Tangani permintaan data', row.id, 'berhasil', { status });
    res.json({ data: { ok: true, status } });
  } catch (error) {
    sendError(res, error);
  }
});

adminRouter.get('/admin/stats', (_req: AuthedRequest, res: Response) => {
  try {
    const count = (sql: string) => Number(get<{ count: number }>(sql)?.count ?? 0);
    res.json({
      data: {
        accounts: count('SELECT COUNT(*) AS count FROM accounts'),
        surveys: count('SELECT COUNT(*) AS count FROM surveys'),
        responses: count('SELECT COUNT(*) AS count FROM responses'),
        pendingRequests: count("SELECT COUNT(*) AS count FROM data_requests WHERE status = 'pending'"),
        perCreator: all<{ id: string; display_name: string; surveys: number; responses: number }>(
          `SELECT a.id, a.display_name,
                  COUNT(DISTINCT s.id) AS surveys,
                  COUNT(DISTINCT r.id) AS responses
             FROM accounts a
             LEFT JOIN surveys s ON s.owner_id = a.id
             LEFT JOIN responses r ON r.survey_id = s.id
            WHERE a.role = 'creator'
            GROUP BY a.id
            ORDER BY a.display_name`,
        ),
        perSurvey: all<{ id: string; title: string; owner: string; versions: number; responses: number }>(
          `SELECT s.id, s.title, a.display_name AS owner,
                  COUNT(DISTINCT v.id) AS versions,
                  COUNT(DISTINCT r.id) AS responses
             FROM surveys s
             LEFT JOIN accounts a ON a.id = s.owner_id
             LEFT JOIN survey_versions v ON v.survey_id = s.id
             LEFT JOIN responses r ON r.survey_id = s.id
            GROUP BY s.id
            ORDER BY s.updated_at DESC`,
        ),
      },
    });
  } catch (error) {
    sendError(res, error);
  }
});
