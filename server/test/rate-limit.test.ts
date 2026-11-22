import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express, { type Request } from 'express';
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

test('PERF-06 TRUST_PROXY=loopback: proxy loopback dipercaya, klien langsung tidak bisa memalsukan IP limiter', async () => {
  const trusted = express();
  trusted.set('trust proxy', trustProxySetting('loopback'));
  trusted.get('/ip', (req, res) => res.json({ ip: req.ip }));
  const login = express();
  login.set('trust proxy', trustProxySetting('loopback'));
  const attempt = (req: Request, res: Parameters<Parameters<typeof login.post>[1]>[1]) => {
    // Kunci tetap per rute: hanya identitas socket yang memisahkan klien.
    const key = `login:${req.path}:${clientIp(req)}`;
    res.json({ limited: !rateLimit({ key, limit: 2, windowMs: 60_000 }) });
  };
  login.post('/login', attempt);
  login.post('/login-direct', attempt);
  const upstream = await listen(trusted);
  const loginUpstream = await listen(login);

  /** Proxy lokal yang meneruskan header X-Forwarded-For milik klien apa adanya. */
  const proxy = express();
  proxy.use((req, res) => {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const target = req.url.startsWith('/login') ? loginUpstream.port : upstream.port;
    const forwarded = request(
      {
        host: '127.0.0.1',
        port: target,
        path: req.url,
        method: req.method,
        agent: false,
        headers: { Host: req.headers.host ?? 'perf06.test', 'X-Forwarded-For': req.headers['x-forwarded-for'] ?? '' },
      },
      (reply) => {
        res.statusCode = reply.statusCode ?? 502;
        reply.pipe(res);
        reply.on('end', resolve);
        reply.on('error', reject);
      },
    );
    forwarded.on('error', reject);
    forwarded.end();
    return promise;
  });
  const front = await listen(proxy);
  try {
    // Di belakang proxy loopback, req.ip memakai IP klien dari header.
    assert.deepEqual((await send(front.port, '/ip', { 'X-Forwarded-For': '198.51.100.7' })).json, { ip: '198.51.100.7' });

    // Limiter memakai alamat koneksi: klien yang sama tertahan di permintaan ketiga.
    const viaProxy = async (ip: string) =>
      (await send(front.port, '/login', { 'X-Forwarded-For': ip }, { method: 'POST' })).json?.limited;
    assert.equal(await viaProxy('198.51.100.7'), false);
    assert.equal(await viaProxy('198.51.100.7'), false);
    assert.equal(await viaProxy('198.51.100.7'), true, 'limit+1 untuk klien yang sama');
    // Klien langsung tanpa hop terpercaya: header palsu tidak memecah penghitung socket.
    assert.equal((await send(loginUpstream.port, '/login-direct', { 'X-Forwarded-For': '203.0.113.7' }, { method: 'POST' })).json?.limited, false);
    assert.equal((await send(loginUpstream.port, '/login-direct', { 'X-Forwarded-For': '203.0.113.8' }, { method: 'POST' })).json?.limited, false);
    assert.equal((await send(loginUpstream.port, '/login-direct', { 'X-Forwarded-For': '203.0.113.9' }, { method: 'POST' })).json?.limited, true, 'IP palsu ketiga tidak memecah penghitung');
  } finally {
    await close(front.server);
    await close(loginUpstream.server);
    await close(upstream.server);
  }
});
