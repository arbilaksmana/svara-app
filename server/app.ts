import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { attachSession, csrfGuard, requireAuth } from './security.ts';
import { authRouter } from './routes/auth.ts';
import { publicRouter } from './routes/public.ts';
import { surveysRouter } from './routes/surveys.ts';
import { adminRouter } from './routes/admin.ts';
import { integrationRouter } from './routes/integration.ts';
import { sendError } from './http.ts';

export const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '512kb' }));
app.use(attachSession);
app.use('/api', csrfGuard);

app.get('/api/v1/health', (_req: Request, res: Response) => {
  res.json({ data: { ok: true } });
});

app.use('/api/v1', authRouter);
app.use('/api/v1', publicRouter);
app.use('/api/v1', integrationRouter);
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

export function attachStatic(target: express.Express, distDir: string): void {
  target.use(express.static(distDir, { index: false }));
  target.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    res.sendFile(`${distDir}/index.html`);
  });
}
