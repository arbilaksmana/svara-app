import { test } from 'node:test';
import assert from 'node:assert/strict';
import nextConfig from '../../next.config.ts';

/**
 * Rute yang dipindah/dihapus tetap dijangkau lewat redirect permanen, supaya tautan lama dan bookmark
 * tidak menjadi 404. Profil platform tidak punya halaman lagi (retensi pindah ke Log audit).
 */
test('redirect lama: login, daftar survei, dan profil platform menuju halaman penggantinya', async () => {
  const redirects = await nextConfig.redirects?.();
  assert.ok(redirects, 'next.config harus mendefinisikan redirects()');

  const bySource = new Map(redirects.map((entry) => [entry.source, entry]));
  assert.deepEqual(bySource.get('/login'), {
    source: '/login', destination: '/auth/login', permanent: true,
  });
  assert.deepEqual(bySource.get('/surveys'), {
    source: '/surveys', destination: '/creator', permanent: true,
  });
  // Profil platform (retensi, kontak) dihapus dari UI; nilai lamanya hidup di /admin/audit.
  assert.deepEqual(bySource.get('/admin/platform'), {
    source: '/admin/platform', destination: '/admin/audit', permanent: true,
  });
});
