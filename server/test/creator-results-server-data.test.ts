import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime.js';
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime.js';
import { ToastProvider } from '../../src/components/Toast.tsx';
import { ResultsPage } from '../../src/screens/CreatorData.tsx';
import { surveys } from '../../src/lib/fixtures/surveys.ts';

const router = {
  back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {}, bfcacheId: 'test',
};

function render(id: string): string {
  return renderToStaticMarkup(
    createElement(AppRouterContext.Provider, { value: router },
      createElement(PathnameContext.Provider, { value: `/creator/surveys/${id}/results` },
        createElement(SearchParamsContext.Provider, { value: new URLSearchParams() },
          createElement(ToastProvider, null, createElement(ResultsPage, { id }))))),
  );
}

const FIXTURE_TITLE = surveys[0]!.title;

test('NEW-UX-A sisa: halaman hasil tidak merender survei fixture sebelum bootstrap berhasil', () => {
  const html = render('s_demo1');
  assert.doesNotMatch(html, new RegExp(FIXTURE_TITLE), 'Judul survei fixture tidak boleh tampil sebagai data server');
  assert.doesNotMatch(html, /Unduh CSV|Unduh kodebook/, 'Kontrol ekspor tidak boleh muncul dari data contoh');
  assert.match(html.replace(/<[^>]+>/g, ' '), /Survei tidak ditemukan/, 'Tanpa data server, halaman menyatakan survei tidak diketahui');
});
