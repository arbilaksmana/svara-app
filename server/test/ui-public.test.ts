import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime.js';
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime.js';
import { ToastProvider } from '../../src/components/Toast.tsx';
import { HomePage } from '../../src/screens/Landing.tsx';
import { RegisterPage } from '../../src/screens/Register.tsx';
import * as respondent from '../../src/screens/Respondent.tsx';
import { refreshBootstrap } from '../../src/lib/store.ts';
import { ROUTES } from '../../src/lib/routes.ts';
import type { BootstrapData } from '../../src/lib/api.ts';

const unexpectedNavigation = () => { throw new Error('Render tidak boleh melakukan navigasi'); };
const router = {
  back: unexpectedNavigation, forward: unexpectedNavigation, refresh: unexpectedNavigation,
  hmrRefresh: unexpectedNavigation, push: unexpectedNavigation, replace: unexpectedNavigation,
  prefetch: unexpectedNavigation, bfcacheId: 'test',
};

function render(node: ReactNode, pathname = '/', search = ''): string {
  return renderToStaticMarkup(
    createElement(AppRouterContext.Provider, { value: router },
      createElement(PathnameContext.Provider, { value: pathname },
        createElement(SearchParamsContext.Provider, { value: new URLSearchParams(search) },
          createElement(ToastProvider, null, node)))),
  );
}

function count(html: string, pattern: RegExp): number {
  return [...html.matchAll(pattern)].length;
}

/** Tag pembuka elemen ber-id tertentu. */
function tagById(html: string, id: string): string {
  const tag = new RegExp(`<[a-z]+\\b[^>]*\\bid="${id}"[^>]*>`).exec(html)?.[0];
  assert.ok(tag, `Elemen #${id} harus dirender`);
  return tag;
}

function attr(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
}

/** Teks elemen ber-id tertentu (elemen tanpa anak bertag sama). */
function textById(html: string, id: string): string {
  const match = new RegExp(`<(\\w+)\\b[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</\\1>`).exec(html);
  assert.ok(match, `Elemen #${id} harus dirender`);
  return match[2]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Kontrol harus ditandai tidak valid dan galatnya dibaca lewat aria-describedby, bukan lewat alert tersendiri. */
function assertLinkedError(html: string, id: string, message: string) {
  const control = tagById(html, id);
  assert.equal(attr(control, 'aria-invalid'), 'true', `#${id} harus aria-invalid="true": ${control}`);
  const described = (attr(control, 'aria-describedby') ?? '').split(/\s+/).filter(Boolean);
  const errorId = described.find((ref) => textById(html, ref).includes(message));
  assert.ok(errorId, `aria-describedby #${id} harus menunjuk teks galat "${message}": ${control}`);
  assert.notEqual(attr(tagById(html, errorId), 'role'), 'alert', `Galat #${errorId} tidak boleh menjadi alert tersendiri`);
}

const REGISTER_ERRORS = [
  ['register-name', 'Nama minimal 2 karakter.'],
  ['register-email', 'Email wajib diisi.'],
  ['register-password', 'Kata sandi wajib diisi.'],
  ['register-confirmation', 'Ulangi kata sandi wajib diisi.'],
  ['register-terms', 'Persetujuan kebijakan dan ketentuan wajib dicentang.'],
] as const;

test('UIX-23: lima galat registrasi tampil dalam satu ringkasan yang dapat difokus, bukan lima alert', () => {
  const html = render(createElement(RegisterPage), '/auth/register', 'state=validation');
  const alerts = [...html.matchAll(/<(\w+)\b[^>]*\brole="alert"[^>]*>[\s\S]*?<\/\1>/g)].map(([el]) => el);
  assert.equal(alerts.length, 1, `Harus ada tepat satu ringkasan galat ber-role alert, ditemukan ${alerts.length}`);
  const summary = alerts[0]!;
  assert.equal(attr(summary, 'tabindex'), '-1', 'Ringkasan galat harus dapat menerima fokus terprogram');
  for (const [id, message] of REGISTER_ERRORS) {
    assert.ok(summary.includes(message), `Ringkasan harus memuat "${message}"`);
    assert.match(summary, new RegExp(`href="#${id}"`), `Ringkasan harus menautkan galat ke #${id}`);
    assertLinkedError(html, id, message);
  }
});

type QuestionProps = Parameters<typeof respondent.QuestionField>[0];
const noop = () => {};

function renderQuestion(question: Partial<QuestionProps['q']>, highlightEmpty = false): string {
  assert.equal(typeof respondent.QuestionField, 'function', 'QuestionField harus diekspor agar bisa dirender terpisah');
  const q: QuestionProps['q'] = {
    id: 'q_t1', code: 'T01', order: 1, type: 'short_text', required: true, section: 'Umum',
    label: 'Saran untuk perpustakaan', hint: null, group_code: null, dimension_code: null, option_ids: [], ...question,
  };
  return render(createElement(respondent.QuestionField, {
    q, token: 'tok_a', value: { optionId: null, text: '' }, setOption: noop, setText: noop, highlightEmpty, options: [],
  }), '/s/tok_a/form');
}

const textarea = (html: string) => /<textarea\b[^>]*>/.exec(html)?.[0] ?? '';
const isRequired = (tag: string) => attr(tag, 'aria-required') === 'true' || /\srequired(?:=""|\s|>)/.test(tag);

test('UIX-21: isian singkat wajib berlabel wajib dan kontrolnya membawa status wajib', () => {
  const html = renderQuestion({ required: true });
  assert.doesNotMatch(html, /Opsional/, 'Isian wajib tidak boleh berlabel opsional');
  const control = textarea(html);
  assert.ok(isRequired(control), `Textarea isian wajib harus aria-required/required: ${control}`);
  const id = attr(control, 'id');
  assert.ok(id, 'Textarea harus punya id');
  const label = new RegExp(`<label\\b[^>]*\\bfor="${id}"[^>]*>([\\s\\S]*?)</label>`).exec(html)?.[1] ?? '';
  assert.match(label, /\(wajib\)/, `Label textarea harus menyebut wajib: ${label}`);

  const optional = renderQuestion({ required: false });
  assert.match(optional, /Opsional\./, 'Isian opsional tetap berlabel opsional');
  assert.ok(!isRequired(textarea(optional)), 'Isian opsional tidak boleh ditandai wajib');
});

test('UIX-21: galat isian singkat wajib terhubung ke textarea', () => {
  const html = renderQuestion({ required: true }, true);
  const id = attr(textarea(html), 'id');
  assert.ok(id, 'Textarea harus punya id');
  assertLinkedError(html, id, 'Item wajib ini belum diisi.');
});

/* Spesifier non-literal: tipe `next` (NODE_ENV readonly) tidak ikut ke typecheck server, yang menimpa NODE_ENV di test lain. */
const notFound = await import(String(new URL('../../src/app/not-found.tsx', import.meta.url))) as {
  metadata?: { title?: unknown };
  default: () => ReactNode;
};

const PUBLIC_ROUTES = new Set<string>([ROUTES.home, ROUTES.respondentCode, ROUTES.login, ROUTES.register, ROUTES.privacy, ROUTES.terms]);

test('UIX-24: halaman 404 memiliki judul dokumen spesifik', () => {
  assert.equal(notFound.metadata?.title, 'Halaman tidak ditemukan', 'not-found harus mengekspor judul dokumen spesifik');
});

test('UIX-24: semua CTA halaman 404 menuju rute publik', () => {
  const html = render(createElement(notFound.default), '/tidak-ada');
  const main = /<main\b[\s\S]*?<\/main>/.exec(html)?.[0] ?? '';
  const hrefs = [...main.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map(([, href]) => href!);
  assert.ok(hrefs.length >= 2, `Halaman 404 harus menawarkan CTA utama dan sekunder, ditemukan ${hrefs.length}`);
  for (const href of hrefs) {
    assert.ok(PUBLIC_ROUTES.has(href), `CTA 404 harus menuju rute publik, bukan ${href}`);
  }
});

test('UIX-09: landing tidak merender tabel contoh kosong berlabel "Terbit" untuk tamu', async (t) => {
  // NEW-UX-C: sebelum bootstrap (HTML SSR) modul survei masih berisi fixture klien, jadi panel contoh tidak dirender.
  const beforeBootstrap = render(createElement(HomePage));
  assert.equal(count(beforeBootstrap, /<table\b/g), 0, 'Tabel contoh fixture tidak boleh dirender sebelum bootstrap');
  assert.doesNotMatch(beforeBootstrap, />Terbit</, 'Lencana "Terbit" fixture tidak boleh tampil sebelum bootstrap');

  const data: BootstrapData = {
    account: null, surveys: [], versions: [], profiles: [], notices: [], surveyProfiles: {}, questions: [], options: [],
    invitations: [], publicLinks: [], assignments: [], settings: {}, grants: [], accounts: [], organizations: [], auditLogs: [],
    integrationEvents: [], dataRequests: [], serverTime: '2026-11-22T00:00:00Z',
  };
  t.mock.method(globalThis, 'fetch', async () => Response.json({ data }));
  await refreshBootstrap();
  const html = render(createElement(HomePage));
  assert.equal(count(html, /<table\b/g), 0, 'Tabel contoh tidak boleh dirender tanpa versi contoh');
  assert.doesNotMatch(html, />Terbit</, 'Lencana "Terbit" tidak boleh tampil untuk data contoh kosong');
  assert.doesNotMatch(html, /item pada versi aktif/, 'Keterangan jumlah item tidak boleh tampil tanpa versi aktif');
});
