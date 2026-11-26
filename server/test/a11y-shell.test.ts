import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime.js';
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime.js';
import { Shell } from '../../src/components/Shell.tsx';
import { TextArea } from '../../src/components/ui.tsx';
import { ToastProvider } from '../../src/components/Toast.tsx';
import { PreviewPage } from '../../src/screens/CreatorCore.tsx';
import { HomePage } from '../../src/screens/Landing.tsx';
import { LoginPage, PrivacyPage } from '../../src/screens/Public.tsx';
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
  const html = render(createElement(Shell, { kind: 'public', title: 'Uji', children: 'isi' }));
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

/** Tag pembuka JSX sampai `>` penutupnya; `=>` di dalam `{...}` tidak dianggap akhir tag. */
function jsxOpeningTag(source: string, start: number): string {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === '"' && depth === 0) i = source.indexOf('"', i + 1);
    else if (ch === '>' && depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Tag tidak tertutup di posisi ${start}`);
}

/** Kelas statis dari `className="..."` atau ``className={`...`}``; interpolasi `${...}` diabaikan. */
function staticClassName(tag: string): string {
  const at = tag.indexOf('className=');
  if (at < 0) return '';
  const value = tag.slice(at + 'className='.length);
  if (value.startsWith('"')) return value.slice(1, value.indexOf('"', 1));
  let depth = 0;
  const end = [...value].findIndex((ch) => (depth += ch === '{' ? 1 : ch === '}' ? -1 : 0) === 0);
  return [...value.slice(0, end + 1).matchAll(/`([^`]*)`|'([^']*)'|"([^"]*)"/g)]
    .map(([, tpl, single, double]) => (tpl ?? single ?? double ?? '').replace(/\$\{[^}]*\}/g, ' '))
    .join(' ');
}

function sourceFiles(dir: URL): URL[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
    ? sourceFiles(new URL(`${entry.name}/`, dir))
    : entry.name.endsWith('.tsx') ? [new URL(entry.name, dir)] : []);
}

test('UIX-14: semua select, textarea, dan input di src memakai token batas dengan kontras ≥ 3:1', () => {
  const root = new URL('../../src/', import.meta.url);
  const checked = new Map<string, number>();
  for (const file of sourceFiles(root)) {
    const source = readFileSync(file, 'utf8');
    const name = file.pathname.slice(root.pathname.length);
    for (const match of source.matchAll(/<(?:select|textarea|input)\b/g)) {
      const tag = jsxOpeningTag(source, match.index);
      const line = source.slice(0, match.index).split('\n').length;
      const base = `class="${staticClassName(tag).split(/\s+/).filter((utility) => utility && !utility.includes(':')).join(' ')}"`;
      const border = colorToken(base, 'border');
      if (!border) continue;
      const background = colorToken(base, 'bg') ?? 'canvas';
      const ratio = contrast(border, background);
      assert.ok(ratio >= 3, `${name}:${line} batas ${border} di atas ${background} hanya ${ratio.toFixed(2)}:1 (butuh ≥ 3:1)`);
      checked.set(name, (checked.get(name) ?? 0) + 1);
    }
  }
  const minimums = [['screens/Admin.tsx', 7], ['screens/CreatorCore.tsx', 3], ['screens/CreatorData.tsx', 1], ['screens/Public.tsx', 2], ['components/ui.tsx', 2]] as const;
  for (const [file, minimum] of minimums) {
    const found = checked.get(file) ?? 0;
    assert.ok(found >= minimum, `Pemindaian harus memeriksa ≥ ${minimum} kontrol bertoken batas di ${file}, ditemukan ${found}`);
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

const WRAPS = /^(?:wrap-anywhere|wrap-break-word|break-words|break-all)$/;

test('UIX-16: judul halaman di shell boleh patah baris agar tidak terpotong pada teks 200%', () => {
  const html = render(createElement(Shell, { kind: 'public', title: 'Survei Kebiasaan Membaca Perpustakaan', children: 'isi' }));
  const heading = /<h1\b[^>]*>Survei Kebiasaan Membaca Perpustakaan<\/h1>/.exec(html)?.[0];
  assert.ok(heading, 'Shell harus merender judul sebagai h1');
  assert.ok(classes(heading).some((name) => WRAPS.test(name)), `Judul harus memakai overflow-wrap agar kata panjang tidak terpotong: ${heading}`);
});

test('UIX-16: heading landing dan halaman masuk boleh patah baris pada teks 200%', () => {
  const headings = [render(createElement(HomePage)), render(createElement(LoginPage), '/auth/login')]
    .flatMap((html) => [...html.matchAll(/<h[12]\b[^>]*>/g)].map(([tag]) => tag));
  assert.equal(headings.length, 8, 'Landing (h1 + 6 h2) dan halaman masuk (h1) harus diperiksa');
  for (const tag of headings) {
    assert.ok(classes(tag).some((name) => WRAPS.test(name)), `Heading harus memakai overflow-wrap: ${tag}`);
  }
});

test('UIX-25: item navigasi Ringkasan aktif memakai aria-current dan penanda selain warna', async (t) => {
  await signInAs('super_admin', t.mock);
  const html = render(createElement(Shell, { kind: 'admin', title: 'Ringkasan', children: 'isi' }), '/admin');
  // Halaman Ringkasan memakai sidebar admin bergrup, bukan pill lama.
  const nav = /<nav\b[^>]*aria-label="Navigasi admin"[^>]*>[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
  assert.ok(nav, 'Ringkasan super admin harus merender sidebar admin');
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

  // Halaman admin selain Ringkasan tetap memakai pill lama dengan sorotan aria-current.
  const accounts = render(createElement(Shell, { kind: 'admin', title: 'Akun & izin', children: 'isi' }), '/admin/accounts');
  const pillNav = /<nav\b[^>]*aria-label="Navigasi utama"[^>]*>[\s\S]*?<\/nav>/.exec(accounts)?.[0] ?? '';
  const pillActive = [...pillNav.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map(([a]) => a).filter((a) => /\baria-current="page"/.test(a));
  assert.equal(pillActive.length, 1, 'Halaman admin lain tetap memakai pill dengan satu item aktif');
  assert.match(pillActive[0]!, />Akun &amp; izin<\/a>$/);
});
