import { Router } from 'express';
import type { Response } from 'express';
import { get, nowIso, run } from '../db.ts';
import type { AccountRow, AuthedRequest } from '../security.ts';
import {
  SESSION_COOKIE,
  clearSessionCookie,
  createSession,
  destroySession,
  parseCookies,
  rateLimit,
  requireAuth,
  sessionCookie,
  verifyPassword,
} from '../security.ts';
import { buildBootstrap } from '../bootstrap.ts';
import { ApiError, newId, sendError } from '../http.ts';

interface LoginRow extends AccountRow {
  password_hash: string;
}

export const authRouter = Router();

function isSecure(req: AuthedRequest): boolean {
  return req.secure || req.get('x-forwarded-proto') === 'https';
}

function failLogin(actor: string): void {
  run(
    'INSERT INTO audit_logs (id, actor, action, object, outcome, at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
    newId('log'),
    actor,
    'Masuk',
    'akun',
    'gagal',
    nowIso(),
    null,
  );
}

authRouter.get('/bootstrap', (req: AuthedRequest, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ data: buildBootstrap(req.account) });
});

authRouter.get('/auth/me', requireAuth, (req: AuthedRequest, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ data: { account: req.account } });
});

authRouter.post('/auth/login', (req: AuthedRequest, res: Response) => {
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
    const row = get<LoginRow>('SELECT * FROM accounts WHERE email = ?', email);
    if (!row || !verifyPassword(password, row.password_hash) || row.status !== 'active') {
      failLogin(email || 'tidak-dikenal');
      throw new ApiError(401, 'invalid_credentials', 'Email atau kata sandi tidak cocok.');
    }
    const session = createSession(row.id);
    res.setHeader('Set-Cookie', sessionCookie(session.token, isSecure(req)));
    res.setHeader('Cache-Control', 'no-store');
    run(
      'INSERT INTO audit_logs (id, actor, action, object, outcome, at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
      newId('log'),
      row.id,
      'Masuk',
      'akun',
      'berhasil',
      nowIso(),
      null,
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

authRouter.post('/auth/logout', (req: AuthedRequest, res: Response) => {
  try {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) destroySession(token);
    if (req.account) {
      run(
        'INSERT INTO audit_logs (id, actor, action, object, outcome, at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
        newId('log'),
        req.account.id,
        'Keluar',
        'akun',
        'berhasil',
        nowIso(),
        null,
      );
    }
    res.setHeader('Set-Cookie', clearSessionCookie());
    res.json({ data: { ok: true } });
  } catch (error) {
    sendError(res, error);
  }
});
