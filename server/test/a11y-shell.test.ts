import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime.js';
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime.js';
import { Shell } from '../../src/components/Shell.tsx';
import { TextArea } from '../../src/components/ui.tsx';
import { ToastProvider } from '../../src/components/Toast.tsx';
import { PreviewPage } from '../../src/screens/CreatorCore.tsx';
import { HomePage } from '../../src/screens/Landing.tsx';
import { PrivacyPage } from '../../src/screens/Public.tsx';
import { RegisterPage } from '../../src/screens/Register.tsx';
import { refreshBootstrap } from '../../src/lib/store.ts';
import type { BootstrapData } from '../../src/lib/api.ts';

const unexpectedNavigation = () => { throw new Error('Render tidak boleh melakukan navigasi'); };
const router = {
  back: unexpectedNavigation, forward: unexpectedNavigation, refresh: unexpectedNavigation,
  hmrRefresh: unexpectedNavigation, push: unexpectedNavigation, replace: unexpectedNavigation,
  prefetch: unexpectedNavigation, bfcacheId: 'test',
};

function render(node: ReactNode, pathname = '/'): string {
  return renderToStaticMarkup(
    createElement(AppRouterContext.Provider, { value: router },
      createElement(PathnameContext.Provider, { value: pathname },
        createElement(SearchParamsContext.Provider, { value: new URLSearchParams() },
          createElement(ToastProvider, null, node)))),
  );
}

/* Nilai token dibaca langsung dari globals.css agar test mengikuti sumber kebenaran warna. */
const COLORS = new Map(
  [...readFileSync(new URL('../../src/app/globals.css', import.meta.url), 'utf8')
    .matchAll(/--color-([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)]
    .map(([, name, hex]) => [name!, hex!.toLowerCase()]),
);

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(fgToken: string, bgToken: string): number {
  const fg = COLORS.get(fgToken);
  const bg = COLORS.get(bgToken);
  assert.ok(fg, `Token --color-${fgToken} harus ada di globals.css`);
  assert.ok(bg, `Token --color-${bgToken} harus ada di globals.css`);
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi! + 0.05) / (lo! + 0.05);
}

function classes(tag: string): string[] {
  return (/\bclass="([^"]*)"/.exec(tag)?.[1] ?? '').split(/\s+/).filter(Boolean);
}

/** Token warna dari utility tanpa varian, mis. `border-control-border` → `control-border`. */
function colorToken(tag: string, utility: 'border' | 'bg' | 'text'): string | undefined {
  return classes(tag)
    .filter((name) => name.startsWith(`${utility}-`))
    .map((name) => name.slice(utility.length + 1))
    .find((name) => COLORS.has(name));
}

/** Utility yang hanya mengubah warna (termasuk varian seperti `hover:`), mis. `text-n0`, `hover:text-n0`. */
function isColorOnly(name: string): boolean {
  const match = /^(?:[\w-]+:)*(?:text|bg|border|decoration|outline|ring|fill|stroke)-([\w-]+?)(?:\/\d+)?$/.exec(name);
  return Boolean(match && COLORS.has(match[1]!));
}

function count(html: string, pattern: RegExp): number {
  return [...html.matchAll(pattern)].length;
}

/** Nama aksesibel pada breakpoint dasar (mobile): elemen ber-class `hidden` tidak ikut dibaca. */
function mobileAccessibleName(anchor: string): string {
  const openTag = /^<a\b[^>]*>/.exec(anchor)?.[0] ?? '';
  const label = /\baria-label="([^"]*)"/.exec(openTag)?.[1]?.trim();
  if (label) return label;
  const visible = anchor
    .slice(openTag.length)
    .replace(/<(\w+)\b[^>]*\bclass="(?:[^"]*\s)?hidden(?:\s[^"]*)?"[^>]*>[\s\S]*?<\/\1>/g, '');
  const alts = [...visible.matchAll(/<img\b[^>]*\balt="([^"]*)"/g)].map(([, alt]) => alt);
  return [visible.replace(/<[^>]+>/g, ' '), ...alts].join(' ').replace(/\s+/g, ' ').trim();
}

async function signInAs(role: 'creator' | 'super_admin', mock: TestContext['mock']) {
  const data: BootstrapData = {
    account: { id: 'u_uji', display_name: 'Akun Uji', email: 'uji@svara.local', role, status: 'active', organization_id: null },
    surveys: [], versions: [], profiles: [], notices: [], surveyProfiles: {}, questions: [], options: [], invitations: [],
    publicLinks: [], assignments: [], settings: {}, grants: [], accounts: [], organizations: [], auditLogs: [],
    integrationEvents: [], dataRequests: [], serverTime: '2026-11-21T00:00:00Z',
  };
  mock.method(globalThis, 'fetch', async () => Response.json({ data }));
  await refreshBootstrap();
}

test('UIX-11: halaman daftar memiliki tepat satu h1', () => {
  const html = render(createElement(RegisterPage), '/auth/register');
  assert.equal(count(html, /<h1\b/g), 1, 'Halaman daftar harus memiliki tepat satu h1');
  assert.match(html, /<h1\b[^>]*>Buat akun<\/h1>/);
});

test('UIX-22: halaman survei tidak ditemukan memiliki tepat satu h1', () => {
  const html = render(createElement(PreviewPage, { id: 's_tidak_ada' }), '/creator/surveys/s_tidak_ada/preview');
  assert.match(html, /Survei tidak ditemukan/);
  assert.equal(count(html, /<h1\b/g), 1, 'Shell dan MissingSurvey tidak boleh sama-sama merender h1');
});

test('UIX-12: tautan beranda di header tetap bernama pada breakpoint mobile', () => {
  const html = render(createElement(Shell, { kind: 'public', title: 'Uji' }, 'isi'));
  const header = /<header\b[\s\S]*?<\/header>/.exec(html)?.[0] ?? '';
  const home = [...header.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map(([a]) => a).find((a) => a.includes('/favicon.svg'));
  assert.ok(home, 'Header harus merender tautan beranda bermerek');
  assert.match(home, /\bhref="\/"/);
  assert.equal(mobileAccessibleName(home), 'Svara', 'Tautan beranda harus bernama "Svara" walau teks merek disembunyikan di mobile');
});

test('UIX-14: batas select, textarea, dan input memakai token dengan kontras ≥ 3:1', () => {
  const html = render(createElement(PrivacyPage), '/privacy') + render(createElement(TextArea, { 'aria-label': 'Catatan' }));
  const controls = [...html.matchAll(/<(?:select|textarea|input)\b[^>]*>/g)]
    .map(([tag]) => tag)
    .filter((tag) => !/\btype="(?:checkbox|radio|hidden)"/.test(tag));
  assert.ok(controls.some((tag) => tag.startsWith('<select')), 'Form permintaan data harus memuat select');
  assert.equal(controls.filter((tag) => tag.startsWith('<textarea')).length, 2, 'Textarea halaman privasi dan TextArea bersama harus diperiksa');
  for (const tag of controls) {
    const border = colorToken(tag, 'border');
    const background = colorToken(tag, 'bg') ?? 'canvas';
    assert.ok(border, `Kontrol harus memakai token warna batas: ${tag}`);
    const ratio = contrast(border, background);
    assert.ok(ratio >= 3, `Batas ${border} di atas ${background} hanya ${ratio.toFixed(2)}:1 (butuh ≥ 3:1): ${tag}`);
  }
});

test('UIX-15: anotasi langkah di landing memakai token teks dengan kontras ≥ 4,5:1', () => {
  const html = render(createElement(HomePage));
  const annotations = [...html.matchAll(/<span\b[^>]*>(?:LANGKAH (?:<!-- -->)?\d|0\d)<\/span>/g)].map(([span]) => span);
  assert.equal(annotations.length, 8, 'Landing harus memuat nomor kemampuan 01–04 dan LANGKAH 1–4');
  for (const span of annotations) {
    const text = colorToken(span, 'text');
    assert.ok(text, `Anotasi harus memakai token warna teks: ${span}`);
    const ratio = contrast(text, 'canvas');
    assert.ok(ratio >= 4.5, `Teks ${text} di atas canvas hanya ${ratio.toFixed(2)}:1 (butuh ≥ 4,5:1): ${span}`);
  }
});

test('UIX-16: judul halaman di shell boleh patah baris agar tidak terpotong pada teks 200%', () => {
  const html = render(createElement(Shell, { kind: 'public', title: 'Survei Kebiasaan Membaca Perpustakaan' }, 'isi'));
  const heading = /<h1\b[^>]*>Survei Kebiasaan Membaca Perpustakaan<\/h1>/.exec(html)?.[0];
  assert.ok(heading, 'Shell harus merender judul sebagai h1');
  assert.ok(
    classes(heading).some((name) => /^(?:wrap-anywhere|wrap-break-word|break-words|break-all)$/.test(name)),
    `Judul harus memakai overflow-wrap agar kata panjang tidak terpotong: ${heading}`,
  );
});

test('UIX-25: item navigasi desktop aktif memakai aria-current dan penanda selain warna', async (t) => {
  await signInAs('super_admin', t.mock);
  const html = render(createElement(Shell, { kind: 'admin', title: 'Ringkasan' }, 'isi'), '/admin');
  const nav = /<nav\b[^>]*aria-label="Navigasi utama"[^>]*>[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
  const links = [...nav.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map(([a]) => a);
  assert.ok(links.length > 1, 'Navigasi admin harus memuat beberapa item');
  const active = links.filter((a) => /\baria-current="page"/.test(a));
  assert.equal(active.length, 1, 'Tepat satu item navigasi desktop bertanda aria-current="page"');
  assert.match(active[0]!, />Ringkasan<\/a>$/);
  const inactive = links.find((a) => !/\baria-current=/.test(a));
  assert.ok(inactive, 'Harus ada item navigasi yang tidak aktif');
  const inactiveClasses = new Set(classes(inactive));
  const marker = classes(active[0]!).filter((name) => !inactiveClasses.has(name) && !isColorOnly(name));
  assert.ok(marker.length > 0, `Item aktif hanya dibedakan warna: ${classes(active[0]!).join(' ')}`);
});
