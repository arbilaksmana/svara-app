import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  GuardianEvidenceSummary,
  guardianEvidencePresentation,
} from '../../src/components/GuardianEvidence.tsx';

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
  assert.match(guardianEvidencePresentation('verified').badge, /pengelola/i);
});
