import type { NextConfig } from 'next';

/**
 * Same-origin API routing for development and single-origin deployments.
 * Production uses an ingress split (`/api/*` -> Express) documented in README.md;
 * the rewrite is not required there but stays harmless when both origins are
 * reachable from the web container.
 */
const apiOrigin = (process.env.API_ORIGIN ?? 'http://127.0.0.1:3001').replace(/\/+$/, '');

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  allowedDevOrigins: ['127.0.0.1'],
  devIndicators: false,
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }];
  },
  // Bookmark lama sebelum rute dipindah ke /auth/login dan /creator (T4).
  // Profil platform tidak punya halaman lagi: masa retensi diatur di /admin/audit.
  async redirects() {
    return [
      { source: '/login', destination: '/auth/login', permanent: true },
      { source: '/surveys', destination: '/creator', permanent: true },
      { source: '/admin/platform', destination: '/admin/audit', permanent: true },
    ];
  },
};

export default nextConfig;
