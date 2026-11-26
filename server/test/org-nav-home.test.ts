import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime.js';
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime.js';
import { Shell } from '../../src/components/Shell.tsx';
import { ToastProvider } from '../../src/components/Toast.tsx';
import { homeForRole, ROUTES } from '../../src/lib/routes.ts';
import { refreshBootstrap } from '../../src/lib/store.ts';
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
    await refreshBootstrap();
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

/** Entri sidebar yang menyorot dirinya: `aria-current="page"` beserta teks tautannya. */
function highlighted(html: string): string[] {
  const nav = /<nav class="flex flex-row flex-wrap gap-2 lg:flex-col">([\s\S]*?)<\/nav>/u.exec(html)?.[1] ?? '';
  return [...nav.matchAll(/<a[^>]*class="[^"]*bg-n100 text-action"[^>]*>([\s\S]*?)<\/a>/gu)].map((match) => match[1]!.trim());
}

test('homeForRole: org_admin mendarat di /admin/org, admin di /admin, sisanya /creator', () => {
  assert.equal(homeForRole('admin'), ROUTES.admin);
  assert.equal(homeForRole('org_admin'), ROUTES.adminOrg);
  assert.equal(homeForRole('creator'), ROUTES.creator);
});

test('sidebar org_admin: entri organisasi, bukti pendukung, dan daftar survei tersedia', async () => {
  await orgAdminSession();
  const html = render('', 'admin');
  const nav = /<nav class="flex flex-row flex-wrap gap-2 lg:flex-col">([\s\S]*?)<\/nav>/u.exec(html)?.[1] ?? '';
  assert.ok(nav.includes(`href="${ROUTES.adminOrg}"`), nav);
  assert.ok(nav.includes(`href="${ROUTES.adminOrgEvidence}"`), nav);
  assert.ok(nav.includes(`href="${ROUTES.creator}"`), nav);
  assert.ok(nav.includes('Daftar survei'), nav);
});

test('sidebar org_admin: sorot satu entri per halaman, tanpa sorot ganda', async () => {
  await orgAdminSession();
  for (const [pathname, kind, label] of [
    [ROUTES.adminOrg, 'admin', 'Organisasi'],
    [ROUTES.adminOrgEvidence, 'admin', 'Bukti pendukung'],
    [ROUTES.creator, 'creator', 'Daftar survei'],
    [ROUTES.creatorEdit('s_contoh'), 'creator', 'Daftar survei'],
  ] as const) {
    const active = highlighted(render(pathname, kind));
    assert.deepEqual(active, [label], `${pathname} menyorot tepat "${label}"`);
  }
});
