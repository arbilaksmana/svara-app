import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime.js';
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime.js';
import {
  GuardianEvidenceSummary,
  guardianEvidencePresentation,
} from '../../src/components/GuardianEvidence.tsx';
import { OrgEvidencePage } from '../../src/screens/OrgEvidence.tsx';
import { ToastProvider } from '../../src/components/Toast.tsx';

const FORBIDDEN = /terverifikasi|verified/i;

const render = (status: string) => renderToStaticMarkup(createElement(GuardianEvidenceSummary, { status }));

test('UIX-04: status self_attested tidak diklaim terverifikasi', () => {
  const html = render('self_attested');
  assert.doesNotMatch(html, FORBIDDEN);
  assert.match(html, /belum diverifikasi/);
});

test('UIX-04: status lain tetap jujur dan lengkap', () => {
  assert.doesNotMatch(render('not_required'), FORBIDDEN);
  assert.doesNotMatch(render('pending'), FORBIDDEN);
  assert.match(guardianEvidencePresentation('revoked').text, /dicabut/i);
  assert.match(guardianEvidencePresentation('rejected').badge, /ditolak/i);
  assert.match(guardianEvidencePresentation('verified').badge, /pengelola/i);
});

/* ---------------- Layar moderasi org_admin ---------------- */

const unexpectedNavigation = () => { throw new Error('Render tidak boleh melakukan navigasi'); };
const router = {
  back: unexpectedNavigation, forward: unexpectedNavigation, refresh: unexpectedNavigation,
  hmrRefresh: unexpectedNavigation, push: unexpectedNavigation, replace: unexpectedNavigation,
  prefetch: unexpectedNavigation, bfcacheId: 'test',
};

test('SEC-04: layar moderasi bukti wali merender antrean dan filter status', () => {
  const html = renderToStaticMarkup(
    createElement(AppRouterContext.Provider, { value: router },
      createElement(PathnameContext.Provider, { value: '/admin/org/evidence' },
        createElement(SearchParamsContext.Provider, { value: new URLSearchParams() },
          createElement(ToastProvider, null, createElement(OrgEvidencePage))))),
  );
  assert.match(html, /Bukti wali/);
  assert.match(html, /Antrean tinjauan/);
  assert.match(html, /Status bukti/);
  assert.match(html, /Memuat bukti wali/);
  assert.doesNotMatch(html, /verifikasi wali|bukti wali sah|bukti yang sah/i);
});
