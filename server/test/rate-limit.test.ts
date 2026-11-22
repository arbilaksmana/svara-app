import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { app } from '../app.ts';
import { clientIp, rateLimit, rateLimitBucketCount, trustProxySetting } from '../security.ts';

/**
 * Kirim permintaan HTTP mentah ke server Express yang sedang berjalan agar
 * sumber koneksi dan header X-Forwarded-For benar-benar dipakai; `fetch` selalu
 * lewat loopback, jadi `TRUST_PROXY=loopback` tidak bisa diuji lewat fetch.
 */
async function send(
  port: number,
  path: string,
  headers: Record<string, string>,
  options: { body?: unknown; method?: string } = {},
): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const { body } = options;
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const { promise, resolve, reject } = Promise.withResolvers<{ status: number; json: Record<string, unknown> | null }>();
  const req = request(
    {
      host: '127.0.0.1',
      port,
      path,
      method: options.method ?? 'GET',
      // Agent global Node 24 memakai keep-alive; koneksi terpakai ulang antar-tes dan
      // membawa header lama, jadi tiap kiriman memakai koneksi baru.
      agent: false,
      headers: {
        Accept: 'application/json',
        'X-Svara-Client': 'web',
        ...(payload === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)) }),
        ...headers,
      },
    },
    (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (text += chunk));
      res.on('end', () => {
        let json: Record<string, unknown> | null = null;
        try {
          json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
        } catch {
          json = null;
        }
        resolve({ status: res.statusCode ?? 0, json });
      });
    },
  );
  req.on('error', reject);
  if (payload !== undefined) req.write(payload);
  req.end();
  return promise;
}

interface Listening {
  server: Server;
  port: number;
}

function listen(target: ReturnType<typeof express> = app): Promise<Listening> {
  const { promise, resolve } = Promise.withResolvers<Listening>();
  const server = target.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as AddressInfo).port }));
  return promise;
}

function close(server: Server): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  server.close(() => resolve());
  return promise;
}

test('PERF-06 trustProxySetting: default mati dan nilai tak dikenal dibatasi', () => {
  assert.equal(trustProxySetting(undefined), false);
  assert.equal(trustProxySetting(''), false);
  assert.equal(trustProxySetting('false'), false);
  assert.equal(trustProxySetting('0'), false);
  assert.equal(trustProxySetting('1'), 1);
  assert.equal(trustProxySetting(' 2 '), 2);
  assert.equal(trustProxySetting('loopback'), 'loopback');
  assert.equal(trustProxySetting('loopback, linklocal'), 'loopback, linklocal');
  assert.equal(trustProxySetting('true'), 'loopback');
  assert.equal(trustProxySetting('*'), 'loopback');
  assert.equal(trustProxySetting('10.0.0.0/8'), 'loopback', 'rentang IP tidak didukung; jatuh ke loopback');
});

test('PERF-06 limiter: 429 pada limit+1 dan entri kedaluwarsa dibersihkan', () => {
  assert.equal(app.get('trust proxy'), false, 'TRUST_PROXY kosong → trust proxy mati');
  const key = 'perf06:unit';
  for (let i = 0; i < 3; i += 1) {
    assert.equal(rateLimit({ key, limit: 3, windowMs: 30 }), true, `permintaan ke-${i + 1}`);
  }
  assert.equal(rateLimit({ key, limit: 3, windowMs: 30 }), false, 'permintaan ke-4 → ditolak');
  assert.equal(rateLimitBucketCount(), 1);

  for (let i = 0; i < 20; i += 1) rateLimit({ key: `perf06:unit:fill:${i}`, limit: 1, windowMs: 1_000 });
  assert.equal(rateLimitBucketCount(), 21, 'kunci sementara menumpuk sebelum sapuan');
  const dateNow = Date.now;
  try {
    // Jam maju melewati jendela dan interval sapuan; sapuan berjalan pada panggilan berikutnya.
    Date.now = () => dateNow() + 120_000;
    rateLimit({ key: 'perf06:unit:after', limit: 1, windowMs: 60_000 });
    assert.equal(rateLimitBucketCount(), 1, 'semua 21 entri kedaluwarsa tersapu, hanya kunci baru tersisa');
  } finally {
    Date.now = dateNow;
  }
});

test('PERF-06 TRUST_PROXY mati: X-Forwarded-For diabaikan (429 hanya untuk IP palsu yang sama)', async () => {
  const { server, port } = await listen();
  try {
    // Login: kunci `login:<ip>:<email>`, limit 8 per 15 menit. Email tak terdaftar → 401, bukan 429.
    const statuses: number[] = [];
    for (let i = 0; i < 9; i += 1) {
      const res = await send(
        port,
        '/api/v1/auth/login',
        { 'X-Forwarded-For': `203.0.113.${i + 1}` },
        { method: 'POST', body: { email: 'tidak-ada@perf06.test', password: 'Salah-Sekali-2026!' } },
      );
      statuses.push(res.status);
    }
    assert.deepEqual(statuses.slice(0, 8), Array(8).fill(401));
    assert.equal(statuses[8], 429, 'header berbeda tidak memecah penghitung karena diabaikan');
    assert.equal(
      (await send(port, '/api/v1/auth/login', { 'X-Forwarded-For': '203.0.113.99' }, { method: 'POST', body: { email: 'tidak-ada@perf06.test', password: 'x' } }))
        .status,
      429,
    );
  } finally {
    await close(server);
  }
});

/** Jalankan `fn` dengan `trust proxy` app utama seperti `TRUST_PROXY=<value>`, lalu pulihkan. */
async function withTrustProxy(value: string, fn: (port: number) => Promise<void>): Promise<void> {
  const trustProxy = app.get('trust proxy');
  app.set('trust proxy', trustProxySetting(value));
  const { server, port } = await listen();
  try {
    await fn(port);
  } finally {
    await close(server);
    app.set('trust proxy', trustProxy);
  }
}

test('H3 TRUST_PROXY=loopback: klien berbeda di belakang proxy loopback tidak berbagi bucket submit', async () => {
  await withTrustProxy('loopback', async (port) => {
    // Submit publik: kunci `submit:<ip>`, limit 40 per 10 menit. Tanpa Idempotency-Key → 422, bukan 429.
    const submit = async (forwardedFor: string) =>
      (await send(port, '/api/v1/public/surveys/pl_h3kelas/responses', { 'X-Forwarded-For': forwardedFor }, { method: 'POST', body: {} })).status;
    const classroom: number[] = [];
    for (let i = 1; i <= 41; i += 1) classroom.push(await submit(`198.51.100.${i}`));
    assert.deepEqual(classroom, Array(41).fill(422), '41 responden berbeda lewat proxy yang sama tidak kena 429');
    const sameClient: number[] = [];
    for (let i = 0; i < 41; i += 1) sameClient.push(await submit('192.0.2.77'));
    assert.deepEqual(sameClient.slice(0, 40), Array(40).fill(422));
    assert.equal(sameClient[40], 429, 'klien yang sama tetap dibatasi pada permintaan ke-41');
  });
});

test('H3 TRUST_PROXY=loopback: rantai "<palsu>, <klien asli>" dari proxy tepercaya memakai klien asli', async () => {
  await withTrustProxy('loopback', async (port) => {
    // Resolusi kode undangan: kunci `invite-code:<ip>`, limit 20 per 10 menit. Kode tak dikenal → 404.
    const resolveCode = async (forwardedFor: string) =>
      (await send(port, '/api/v1/public/invitations/resolve', { 'X-Forwarded-For': forwardedFor }, { method: 'POST', body: { code: 'UND-TIDAK-TERDAFTAR' } }))
        .status;
    // Proxy menambahkan alamat yang dilihatnya di kanan; bagian kiri dikirim klien dan bisa dipalsukan.
    const attacker: number[] = [];
    for (let i = 1; i <= 21; i += 1) attacker.push(await resolveCode(`203.0.113.${i}, 198.51.100.200`));
    assert.deepEqual(attacker.slice(0, 20), Array(20).fill(404));
    assert.equal(attacker[20], 429, 'mengganti alamat palsu di kiri tidak membuka bucket baru');
    assert.equal(await resolveCode('203.0.113.1, 198.51.100.201'), 404, 'klien asli lain dengan alamat palsu yang sama tidak ikut tertahan');
  });
});

test('H3 klien langsung yang bukan proxy tepercaya: X-Forwarded-For diabaikan, limiter tetap per socket', async () => {
  // Proxy tepercaya hanya di jaringan privat; koneksi dari 127.0.0.1 adalah klien langsung.
  await withTrustProxy('uniquelocal', async (port) => {
    // Login: kunci `login:<ip>:<email>`, limit 8 per 15 menit. Akun tidak ada → 401.
    const statuses: number[] = [];
    for (let i = 1; i <= 9; i += 1) {
      const res = await send(
        port,
        '/api/v1/auth/login',
        { 'X-Forwarded-For': `203.0.113.${i}` },
        { method: 'POST', body: { email: 'tebak-sandi@h3.test', password: 'Coba-Sandi-2026!' } },
      );
      statuses.push(res.status);
    }
    assert.deepEqual(statuses.slice(0, 8), Array(8).fill(401));
    assert.equal(statuses[8], 429, 'alamat palsu berbeda dari klien langsung tidak memecah penghitung socket');
  });
});

test('H3 clientIp: aturan trust proxy yang sama dengan Express; header kosong/tidak valid → socket', async () => {
  const probe = express();
  probe.get('/ip', (req, res) => res.json({ clientIp: clientIp(req) }));
  const { server, port } = await listen(probe);
  const cases: { trust: string; forwardedFor?: string; expected: string }[] = [
    { trust: '', forwardedFor: '198.51.100.7', expected: '127.0.0.1' },
    { trust: 'loopback', forwardedFor: '198.51.100.7', expected: '198.51.100.7' },
    { trust: 'loopback', forwardedFor: '203.0.113.9, 198.51.100.7', expected: '198.51.100.7' },
    { trust: 'loopback', forwardedFor: '198.51.100.7, 127.0.0.1', expected: '198.51.100.7' },
    { trust: 'loopback', forwardedFor: '198.51.100.7, 10.0.4.2', expected: '10.0.4.2' },
    { trust: 'loopback, uniquelocal', forwardedFor: '198.51.100.7, 10.0.4.2', expected: '198.51.100.7' },
    { trust: 'uniquelocal', forwardedFor: '198.51.100.7', expected: '127.0.0.1' },
    { trust: '1', forwardedFor: '203.0.113.9, 198.51.100.7', expected: '198.51.100.7' },
    { trust: '2', forwardedFor: '203.0.113.9, 198.51.100.7', expected: '203.0.113.9' },
    { trust: 'loopback', forwardedFor: 'unknown', expected: '127.0.0.1' },
    { trust: 'loopback', forwardedFor: '', expected: '127.0.0.1' },
    { trust: 'loopback', expected: '127.0.0.1' },
  ];
  try {
    for (const { trust, forwardedFor, expected } of cases) {
      probe.set('trust proxy', trustProxySetting(trust));
      const headers: Record<string, string> = forwardedFor === undefined ? {} : { 'X-Forwarded-For': forwardedFor };
      const { json } = await send(port, '/ip', headers);
      assert.equal(json?.clientIp, expected, `TRUST_PROXY=${JSON.stringify(trust)}, X-Forwarded-For=${JSON.stringify(forwardedFor ?? null)}`);
    }
  } finally {
    await close(server);
  }
});
