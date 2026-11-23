import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * HSTS: hanya untuk permintaan HTTPS. `ENABLE_HSTS=1/0` menimpa default produksi
 * (NODE_ENV=production dan seluruh APP_ORIGIN https). Aturan yang sama dengan
 * `server/security-headers.ts`; disalin karena `tsconfig.json` mengecualikan `server/`
 * dari kompilasi Next, sehingga `src/` tidak boleh mengimpornya.
 */
const HSTS_VALUE = 'max-age=15552000; includeSubDomains';

function hstsEnabled(env: Record<string, string | undefined>, requestIsHttps: boolean): boolean {
  const flag = env.ENABLE_HSTS?.trim();
  if (flag === '0') return false;
  if (flag === '1') return requestIsHttps;
  if (!requestIsHttps || env.NODE_ENV !== 'production') return false;
  const origins = (env.APP_ORIGIN ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  if (origins.length === 0) return false;
  return origins.every((origin) => {
    try {
      return new URL(origin).protocol === 'https:';
    } catch {
      return false;
    }
  });
}

/**
 * Next.js 16 renamed the `middleware` file convention to `proxy`.
 * This runs before every page render to mint a per-request CSP nonce and
 * emit the same security headers the Express app used to send.
 */
export function proxy(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV !== 'production';

  const csp = [
    "default-src 'self'",
    // 'strict-dynamic' lets the nonced Next.js bootstrap load chunks; 'self'
    // remains as the fallback for browsers without strict-dynamic support.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (hstsEnabled(process.env, request.nextUrl.protocol === 'https:' || forwardedProto === 'https')) {
    response.headers.set('Strict-Transport-Security', HSTS_VALUE);
  }
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
