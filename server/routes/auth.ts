import { Router } from 'express';
import type { Response } from 'express';
import { get, nowIso, run, withTx } from '../db.ts';
import type { AccountRow, AuthedRequest } from '../security.ts';
import {
  SESSION_COOKIE,
  clearSessionCookie,
  createSession,
  destroySession,
  hashPassword,
  parseCookies,
  passwordPolicyError,
  rateLimit,
  requireAuth,
  sessionCookie,
  verifyPassword,
} from '../security.ts';
import { buildBootstrap } from '../bootstrap.ts';
import { ApiError, newId, sendError } from '../http.ts';
import {
  ORGANIZATION_INVITATION_COLUMNS,
  invitationStatus,
  type OrganizationInvitationRow,
} from '../organization-invitations.ts';

interface LoginRow extends AccountRow {
  password_hash: string;
}

export const authRouter = Router();

function isSecure(req: AuthedRequest): boolean {
  return req.secure || req.get('x-forwarded-proto') === 'https';
}

async function failLogin(actor: string): Promise<void> {
  await run(
    'INSERT INTO audit_logs (id, actor, action, object, outcome, at, metadata, account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    newId('log'),
    actor,
    'Masuk',
    'akun',
    'gagal',
    nowIso(),
    null,
    null,
  );
}

authRouter.get('/bootstrap', async (req: AuthedRequest, res: Response) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ data: await buildBootstrap(req.account) });
  } catch (error) {
    sendError(res, error);
  }
});

authRouter.get('/auth/me', requireAuth, (req: AuthedRequest, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ data: { account: req.account } });
});

authRouter.post('/auth/login', async (req: AuthedRequest, res: Response) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!email || !password) {
      throw new ApiError(422, 'validation_error', 'Email dan kata sandi wajib diisi.');
    }
    const key = `login:${req.ip}:${email}`;
    if (!rateLimit({ key, limit: 8, windowMs: 15 * 60 * 1000 })) {
      throw new ApiError(429, 'rate_limited', 'Terlalu banyak percobaan masuk. Coba lagi beberapa menit lagi.');
    }
    const row = await get<LoginRow>('SELECT * FROM accounts WHERE email = ?', email);
    if (!row || !verifyPassword(password, row.password_hash) || row.status !== 'active') {
      await failLogin(email || 'tidak-dikenal');
      throw new ApiError(401, 'invalid_credentials', 'Email atau kata sandi tidak cocok.');
    }
    const session = await createSession(row.id);
    res.setHeader('Set-Cookie', sessionCookie(session.token, isSecure(req)));
    res.setHeader('Cache-Control', 'no-store');
    await run(
      'INSERT INTO audit_logs (id, actor, action, object, outcome, at, metadata, account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      newId('log'),
      row.id,
      'Masuk',
      'akun',
      'berhasil',
      nowIso(),
      null,
      row.id,
    );
    res.json({
      data: {
        account: { id: row.id, email: row.email, display_name: row.display_name, role: row.role, status: row.status },
        expiresAt: session.expiresAt,
      },
    });
  } catch (error) {
    sendError(res, error);
  }
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Bump ketika isi halaman kebijakan privasi atau ketentuan layanan berubah. */
const CURRENT_CONSENT_VERSION = '2026-11-19';

/**
 * Batas produksi 5 per alamat per 15 menit. Suite uji melakukan lebih dari lima
 * pendaftaran sah dari satu alamat, jadi batasnya dinaikkan hanya saat NODE_ENV=test;
 * pembatas tetap berjalan di uji, hanya ambangnya berbeda.
 */
const REGISTER_RATE_LIMIT = process.env.NODE_ENV === 'test' ? 50 : 5;

authRouter.post('/auth/register', async (req: AuthedRequest, res: Response) => {
  try {
    const displayName = typeof req.body?.name === 'string' ? req.body.name.replace(/\s+/g, ' ').trim() : '';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const acceptTerms = req.body?.acceptTerms === true;

    if (displayName.length < 2 || displayName.length > 120) {
      throw new ApiError(422, 'validation_error', 'Nama harus 2-120 karakter.');
    }
    if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
      throw new ApiError(422, 'validation_error', 'Alamat email tidak valid.');
    }
    if (!acceptTerms) {
      throw new ApiError(422, 'terms_required', 'Persetujuan kebijakan privasi dan ketentuan layanan wajib dicentang.');
    }
    const passwordError = passwordPolicyError(password);
    if (passwordError) {
      throw new ApiError(422, 'weak_password', passwordError);
    }
    if (!rateLimit({ key: `register:${req.ip}`, limit: REGISTER_RATE_LIMIT, windowMs: 15 * 60 * 1000 })) {
      throw new ApiError(429, 'rate_limited', 'Terlalu banyak pendaftaran dari alamat ini. Coba lagi beberapa menit lagi.');
    }

    const existing = await get<{ id: string }>('SELECT id FROM accounts WHERE email = ?', email);
    if (existing) {
      throw new ApiError(409, 'email_taken', 'Email sudah terdaftar. Masuk atau gunakan email lain.');
    }

    // Undangan organisasi opsional: kode menentukan organisasi akun, bukan body lain.
    // Kode dicari tanpa filter agar alasan penolakan tidak membocorkan statusnya; semua
    // keadaan selain aktif menghasilkan pesan yang sama dengan kode asing.
    const inviteCode = typeof req.body?.invite_code === 'string' ? req.body.invite_code.trim().toUpperCase() : '';
    const invitation = inviteCode
      ? await get<OrganizationInvitationRow>(
          `SELECT ${ORGANIZATION_INVITATION_COLUMNS} FROM organization_invitations WHERE code = ?`,
          inviteCode,
        )
      : undefined;
    if (inviteCode && (!invitation || invitationStatus(invitation, nowIso()) !== 'active')) {
      throw new ApiError(422, 'invalid_invite_code', 'Kode undangan organisasi tidak berlaku.');
    }

    const accountId = newId('u');
    const acceptedAt = nowIso();
    try {
      await withTx(async () => {
        await run(
          'INSERT INTO accounts (id, email, display_name, role, status, password_hash, created_at, consent_version, consent_accepted_at, organization_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          accountId,
          email,
          displayName,
          'creator',
          'active',
          hashPassword(password),
          acceptedAt,
          CURRENT_CONSENT_VERSION,
          acceptedAt,
          invitation?.organization_id ?? null,
        );
        if (invitation) {
          // Kode sekali pakai: pemakaian dicatat pada baris undangan. Guard di WHERE
          // menutup balapan dengan pencabutan atau kode yang kedaluwarsa saat transaksi berjalan.
          const consumed = await run(
            `UPDATE organization_invitations SET used_at = ?, used_by = ?
              WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL
                AND (expires_at IS NULL OR expires_at > ?)`,
            acceptedAt,
            accountId,
            invitation.id,
            acceptedAt,
          );
          if (consumed === 0) {
            throw new ApiError(422, 'invalid_invite_code', 'Kode undangan organisasi tidak berlaku.');
          }
        }
        await run(
          'INSERT INTO audit_logs (id, actor, action, object, outcome, at, metadata, account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          newId('log'),
          accountId,
          'Registrasi',
          'akun',
          'berhasil',
          acceptedAt,
          JSON.stringify({ consentVersion: CURRENT_CONSENT_VERSION, acceptedAt }),
          accountId,
        );
      });
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      if (code === '23505') {
        throw new ApiError(409, 'email_taken', 'Email sudah terdaftar. Masuk atau gunakan email lain.');
      }
      throw error;
    }

    const session = await createSession(accountId);
    res.setHeader('Set-Cookie', sessionCookie(session.token, isSecure(req)));
    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json({
      data: {
        account: { id: accountId, email, display_name: displayName, role: 'creator', status: 'active' },
        expiresAt: session.expiresAt,
      },
    });
  } catch (error) {
    sendError(res, error);
  }
});

authRouter.post('/auth/logout', async (req: AuthedRequest, res: Response) => {
  try {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) await destroySession(token);
    if (req.account) {
      await run(
        'INSERT INTO audit_logs (id, actor, action, object, outcome, at, metadata, account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        newId('log'),
        req.account.id,
        'Keluar',
        'akun',
        'berhasil',
        nowIso(),
        null,
        req.account.id,
      );
    }
    res.setHeader('Set-Cookie', clearSessionCookie());
    res.json({ data: { ok: true } });
  } catch (error) {
    sendError(res, error);
  }
});
