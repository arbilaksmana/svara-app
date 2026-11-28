import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRetentionDays } from '../../src/lib/retention.ts';

test('masa retensi kosong berarti tanpa penghapusan otomatis', () => {
  assert.equal(parseRetentionDays(''), null);
  assert.equal(parseRetentionDays('   '), null);
});

test('masa retensi bilangan bulat diterima', () => {
  assert.equal(parseRetentionDays('0'), 0);
  assert.equal(parseRetentionDays(' 30 '), 30);
});

test('masa retensi tidak valid ditolak agar tidak tersimpan sebagai NaN', () => {
  for (const raw of ['-1', '1.5', 'abc', '1e3', '2 0', '9'.repeat(400)]) {
    assert.equal(parseRetentionDays(raw), undefined, raw);
  }
});