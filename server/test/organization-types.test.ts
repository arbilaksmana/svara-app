import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ORGANIZATION_TYPES, ORGANIZATION_TYPE_SET } from '../organization-types.ts';
import { ORGANIZATION_TYPES as CLIENT_ORGANIZATION_TYPES, ORGANIZATION_TYPE_LABEL } from '../../src/lib/labels.ts';

/**
 * Daftar tipe organisasi hidup di dua sisi batas tepercaya: server memvalidasi, UI menawarkan pilihan.
 * Bila keduanya menyimpang, UI menawarkan nilai yang ditolak API (atau sebaliknya). Tes ini mengunci paritasnya.
 */
test('tipe organisasi: daftar server dan pilihan UI identik, berurutan sama', () => {
  assert.deepEqual(CLIENT_ORGANIZATION_TYPES, [...ORGANIZATION_TYPES], 'Urutan dan isi daftar harus sama di server dan UI');
  assert.deepEqual(Object.keys(ORGANIZATION_TYPE_LABEL), [...ORGANIZATION_TYPES], 'Setiap tipe punya label manusiawi');
});

test('tipe organisasi: server menolak nilai di luar daftar', () => {
  for (const type of ORGANIZATION_TYPES) {
    assert.equal(ORGANIZATION_TYPE_SET.has(type), true, `${type} diterima server`);
  }
  for (const type of ['hospital', 'school ', 'School', '']) {
    assert.equal(ORGANIZATION_TYPE_SET.has(type), false, `${JSON.stringify(type)} harus ditolak`);
  }
});
