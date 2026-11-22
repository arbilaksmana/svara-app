import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { attachSession, csrfGuard, requireAuth, trustProxySetting } from './security.ts';
import type { AuthedRequest } from './security.ts';
import { authRouter } from './routes/auth.ts';
import { publicRouter } from './routes/public.ts';
import { surveysRouter } from './routes/surveys.ts';
import { adminRouter } from './routes/admin.ts';
import { integrationRouter } from './routes/integration.ts';
import { orgRouter } from './routes/org.ts';
import { get } from './db.ts';
import { sendError } from './http.ts';

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export const app = express();
app.set('trust proxy', trustProxySetting(process.env.TRUST_PROXY));
app.disable('x-powered-by');
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.ENABLE_HSTS === '1') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }
  next();
});
// Respons API memuat data sesi atau status token; jangan pernah disimpan cache browser/proxy.
app.use('/api', (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '512kb' }));
app.use((req, res, next) => {
  attachSession(req as AuthedRequest, res, next).catch(next);
});
app.use('/api', csrfGuard);

app.get('/api/v1/health', async (_req: Request, res: Response) => {
  try {
    await get('SELECT 1 AS ok');
    res.setHeader('Cache-Control', 'no-store');
    res.json({ data: { ok: true } });
  } catch {
    res.status(503).json({ error: 'Basis data tidak siap.', code: 'unavailable' });
  }
});

app.use('/api/v1', authRouter);
app.use('/api/v1', publicRouter);
app.use('/api/v1', integrationRouter);
app.use('/api/v1', requireAuth, orgRouter);
app.use('/api/v1', requireAuth, surveysRouter);
app.use('/api/v1', requireAuth, adminRouter);

app.use('/api', (_req: Request, res: Response) => {
  res.status(404).json({ error: 'Endpoint tidak ditemukan.', code: 'not_found' });
});

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[api] unhandled', error.message);
  if (res.headersSent) return;
  sendError(res, error);
});


