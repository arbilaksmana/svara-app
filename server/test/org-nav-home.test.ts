import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime.js';
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime.js';
import { Shell } from '../../src/components/Shell.tsx';
import { ToastProvider } from '../../src/components/Toast.tsx';
import { homeForRole, ROUTES } from '../../src/lib/routes.ts';
import { loadBootstrap } from '../../src/lib/store.ts';
import type { BootstrapData } from '../../src/lib/api.ts';

const router = {
  back: () => {}, forward: () => {}, refresh: () => {}, hmrRefresh: () => {}, push: () => {}, replace: () => {},
  prefetch: () => {}, bfcacheId: 'test',
};

/** Sesi `org_admin` dari bootstrap nyata-shape: peran UI `org_admin`, organisasi terisi. */
async function orgAdminSession(): Promise<void> {
  const payload: BootstrapData = {
    account: {
      id: 'u_orgadmin', display_name: 'Admin Organisasi', email: 'orgadmin@contoh.test', role: 'org_admin', status: 'active',
      organization_id: 'org_contoh',
    },
    surveys: [], versions: [], profiles: [], notices: [], surveyProfiles: {}, questions: [], options: [],
    invitations: [], publicLinks: [], assignments: [], settings: {}, grants: [], accounts: [], organizations: [],
    auditLogs: [], integrationEvents: [], dataRequests: [], serverTime: '2026-11-26T00:00:00Z',
  } as unknown as BootstrapData;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ data: payload })) as typeof fetch;
  try {
    await loadBootstrap();
  } finally {
    globalThis.fetch = original;
  }
}

function render(pathname: string, kind: 'creator' | 'admin'): string {
  return renderToStaticMarkup(
    createElement(AppRouterContext.Provider, { value: router },
      createElement(PathnameContext.Provider, { value: pathname },
        createElement(SearchParamsContext.Provider, { value: new URLSearchParams() },
          createElement(ToastProvider, null, createElement(Shell, { kind, title: 'Uji navigasi', children: null }))))),
  );
}

/** Label semua tautan aria-current pada chrome yang dirender. */
function currentLabels(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gu)]
    .filter(([markup]) => markup.includes('aria-current="page"'))
    .map(([markup]) => markup.replace(/<[^>]+>/gu, '').trim());
}

test('homeForRole: org_admin mendarat di /admin/org, admin di /admin, sisanya /creator', () => {
  assert.equal(homeForRole('admin'), ROUTES.admin);
  assert.equal(homeForRole('org_admin'), ROUTES.adminOrg);
  assert.equal(homeForRole('creator'), ROUTES.creator);
});

test('chrome organisasi: entri organisasi, bukti pendukung, dan daftar survei tersedia', async () => {
  await orgAdminSession();
  const html = render(ROUTES.adminOrg, 'admin');
  assert.ok(html.includes('Navigasi organisasi'), html);
  assert.ok(html.includes(`href="${ROUTES.adminOrg}"`), html);
  assert.ok(html.includes(`href="${ROUTES.adminOrgEvidence}"`), html);
  assert.ok(html.includes(`href="${ROUTES.creatorOrg}"`), html);
  assert.ok(html.includes('Daftar survei'), html);
});

test('chrome organisasi: sorot satu entri per halaman, termasuk detail survei', async () => {
  await orgAdminSession();
  for (const [pathname, kind, label] of [
    [ROUTES.adminOrg, 'admin', 'Organisasi'],
    [ROUTES.adminOrgEvidence, 'admin', 'Bukti pendukung'],
    [ROUTES.creatorOrg, 'creator', 'Daftar survei'],
    [ROUTES.creatorEdit('s_contoh'), 'creator', 'Daftar survei'],
  ] as const) {
    const html = render(pathname, kind);
    assert.ok(html.includes('Navigasi organisasi'), `${pathname} harus memakai chrome organisasi`);
    assert.deepEqual(currentLabels(html), [label], `${pathname} menyorot tepat "${label}"`);
  }
});
