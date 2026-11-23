import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { after, before, test } from 'node:test';
import { closeTestDatabase, resetTestDatabase } from './test-db.ts';

process.env.NODE_ENV = 'test';
process.env.SEED_DEMO = '1';
process.env.SEED_PASSWORD = 'SvaraDemo123!';

const { app } = await import('../app.ts');
const { get } = await import('../db.ts');
const { seedDemoIfEmpty } = await import('../seed-data.ts');
const { hashPassword, parseCookies, rateLimitBucketCount, resetRateLimits, trustProxySetting, verifyPassword } = await import('../security.ts');

const DEMO_PASSWORD = 'SvaraDemo123!';

let server: Server | undefined;
let base = '';

interface Result {
  status: number;
  json: Record<string, unknown> | null;
  text: string;
  setCookie: string;
  headers: Headers;
}

async function call(path: string, options: { body?: unknown; headers?: Record<string, string> } = {}): Promise<Result> {
  const response = await fetch(`${base}${path}`, {
    method: options.body === undefined ? 'GET' : 'POST',
    headers: {
      Accept: 'application/json',
      'X-Svara-Client': 'web',
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    json = null;
  }
  return { status: response.status, json, text: text.slice(0, 300), setCookie: response.headers.get('set-cookie') ?? '', headers: response.headers };
}

function login(email: string, password: string, headers: Record<string, string> = {}): Promise<Result> {
  return call('/auth/login', { body: { email, password }, headers });
}

async function failedLoginAudit(): Promise<{ count: number; maxActor: number }> {
  const row = await get<{ count: number; max_actor: number | null }>(
    "SELECT COUNT(*)::int AS count, MAX(length(actor)) AS max_actor FROM audit_logs WHERE action = 'Masuk' AND outcome = 'gagal'",
  );
  return { count: row?.count ?? 0, maxActor: row?.max_actor ?? 0 };
}

const SECURE_ATTR = /;\s*Secure(?:;|$)/i;

before(async () => {
  await resetTestDatabase();
  await seedDemoIfEmpty();
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}/api/v1`;
});

after(async () => {
  if (server) {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
    await promise;
  }
  await closeTestDatabase();
});

test('SEC-05: login menolak email/sandi di luar batas sebelum limiter, query akun, hashing, dan audit', async () => {
  const email = (length: number) => `${'a'.repeat(length - '@svara.local'.length)}@svara.local`;
  assert.equal(email(500_000).length, 500_000);
  const auditBefore = await failedLoginAudit();

  const rejected: Array<[string, string, string]> = [
    ['email 500.000 karakter', email(500_000), 'Salah-Sekali-2026!'],
    ['email 2.000 karakter', email(2_000), 'Salah-Sekali-2026!'],
    ['email 255 karakter', email(255), 'Salah-Sekali-2026!'],
    ['sandi 500.000 karakter untuk akun nyata', 'admin@svara.local', 'B'.repeat(500_000)],
    ['sandi 257 karakter untuk akun nyata', 'admin@svara.local', 'C'.repeat(257)],
    ['email tanpa @', 'bukan-email', 'Salah-Sekali-2026!'],
    ['email tanpa domain bertitik', 'admin@svara', 'Salah-Sekali-2026!'],
  ];
  const observed: Array<Record<string, unknown>> = [];
  const messages = new Set<unknown>();
  for (const [label, address, password] of rejected) {
    const audit = await failedLoginAudit();
    const buckets = rateLimitBucketCount();
    const result = await login(address, password);
    const audited = await failedLoginAudit();
    observed.push({
      label,
      status: result.status,
      code: result.json?.code,
      auditRows: audited.count - audit.count,
      maxAuditActor: Math.max(audited.maxActor, auditBefore.maxActor),
      limiterKeys: rateLimitBucketCount() - buckets,
    });
    messages.add(result.json?.error);
  }
  // Ditolak 422 tanpa baris audit dan tanpa kunci limiter baru untuk setiap input di luar batas.
  assert.deepEqual(
    observed,
    rejected.map(([label]) => ({
      label,
      status: 422,
      code: 'validation_error',
      auditRows: 0,
      maxAuditActor: auditBefore.maxActor,
      limiterKeys: 0,
    })),
  );
  assert.equal(messages.size, 1, 'satu pesan generik untuk semua penolakan batas');

  // Batas atas yang sah tetap diproses sebagai kredensial biasa: 401 generik + audit ternormalisasi.
  const longest = `${'a'.repeat(64)}@${'b'.repeat(254 - 65 - '.local'.length)}.local`;
  assert.equal(longest.length, 254);
  const boundary = await login(`  ${longest.toUpperCase()}  `, 'D'.repeat(256));
  assert.equal(boundary.status, 401, boundary.text);
  assert.equal(boundary.json?.code, 'invalid_credentials');
  const actor = await get<{ actor: string }>(
    "SELECT actor FROM audit_logs WHERE action = 'Masuk' AND outcome = 'gagal' ORDER BY at DESC, id DESC LIMIT 1",
  );
  assert.equal(actor?.actor, longest, 'actor audit login gagal = email ternormalisasi');
  const audit = await failedLoginAudit();
  assert.equal(audit.count, auditBefore.count + 1);
  assert.ok(audit.maxActor <= 254, `panjang actor audit login gagal terbatas: ${audit.maxActor}`);

  const unknown = await login('tidak-ada@svara.local', 'Salah-Sekali-2026!');
  assert.equal(unknown.status, 401);
  assert.equal(unknown.json?.error, boundary.json?.error, 'akun tak dikenal dan sandi salah tetap generik');

  const demo = await login('admin@svara.local', DEMO_PASSWORD);
  assert.equal(demo.status, 200, demo.text);
});

test('SEC-13: COOKIE_SECURE=1 selalu memberi Secure pada cookie sesi lewat HTTP biasa', async () => {
  const previous = process.env.COOKIE_SECURE;
  try {
    process.env.COOKIE_SECURE = '1';
    const forced = await login('creator.a@svara.local', DEMO_PASSWORD);
    assert.equal(forced.status, 200, forced.text);
    assert.match(forced.setCookie, /^svara_session=/);
    assert.match(forced.setCookie, SECURE_ATTR, `COOKIE_SECURE=1 → Secure: ${forced.setCookie}`);
  } finally {
    if (previous === undefined) delete process.env.COOKIE_SECURE;
    else process.env.COOKIE_SECURE = previous;
  }
});

test('SEC-13: tanpa TRUST_PROXY, X-Forwarded-Proto dari klien tidak memberi Secure; proxy tepercaya tetap memberi', async () => {
  const previous = process.env.COOKIE_SECURE;
  const trustProxy = app.get('trust proxy');
  try {
    delete process.env.COOKIE_SECURE;
    assert.equal(trustProxy, false, 'TRUST_PROXY kosong → trust proxy mati');

    const spoofed = await login('creator.b@svara.local', DEMO_PASSWORD, { 'X-Forwarded-Proto': 'https' });
    assert.equal(spoofed.status, 200, spoofed.text);
    assert.doesNotMatch(spoofed.setCookie, SECURE_ATTR, `header klien tidak dipercaya: ${spoofed.setCookie}`);

    const plain = await login('officer@svara.local', DEMO_PASSWORD);
    assert.equal(plain.status, 200, plain.text);
    assert.doesNotMatch(plain.setCookie, SECURE_ATTR, 'HTTP biasa tanpa COOKIE_SECURE → tanpa Secure');

    // Proxy loopback yang dipercaya lewat TRUST_PROXY: req.secure membaca protokolnya.
    app.set('trust proxy', trustProxySetting('loopback'));
    const trusted = await login('orgadmin@svara.local', DEMO_PASSWORD, { 'X-Forwarded-Proto': 'https' });
    assert.equal(trusted.status, 200, trusted.text);
    assert.match(trusted.setCookie, SECURE_ATTR, `HTTPS dari proxy tepercaya → Secure: ${trusted.setCookie}`);
  } finally {
    app.set('trust proxy', trustProxy);
    if (previous === undefined) delete process.env.COOKIE_SECURE;
    else process.env.COOKIE_SECURE = previous;
  }
});

test('L-05: cookie dengan percent-encoding rusak diabaikan, bukan 500', async () => {
  const malformed = 'a=%E0%A4%A';
  const health = await call('/health', { headers: { Cookie: malformed } });
  assert.equal(health.status, 200, health.text);

  const bootstrap = await call('/bootstrap', { headers: { Cookie: malformed } });
  assert.equal(bootstrap.status, 200, bootstrap.text);
  assert.equal((bootstrap.json?.data as { account: unknown } | undefined)?.account, null, 'diperlakukan sebagai tamu');

  const me = await call('/auth/me', { headers: { Cookie: malformed } });
  assert.equal(me.status, 401, me.text);
  assert.equal(me.json?.code, 'unauthenticated');

  const badSession = await call('/auth/me', { headers: { Cookie: 'svara_session=%E0%A4%A' } });
  assert.equal(badSession.status, 401, badSession.text);

  const active = await login('admin@svara.local', DEMO_PASSWORD);
  assert.equal(active.status, 200, active.text);
  const cookie = active.setCookie.split(';')[0]!;
  const mixed = await call('/auth/me', { headers: { Cookie: `${malformed}; ${cookie}` } });
  assert.equal(mixed.status, 200, mixed.text);
  assert.equal((mixed.json?.data as { account: { email: string } }).account.email, 'admin@svara.local');

  const logout = await call('/auth/logout', { body: {}, headers: { Cookie: malformed } });
  assert.equal(logout.status, 200, logout.text);

  assert.deepEqual(parseCookies('a=%E0%A4%A; b=ok%20sip; c=%'), { b: 'ok sip' });
});

test('PERF-09: hash paralel tidak memblokir event loop', async () => {
  let ticks = 0;
  const timer = setInterval(() => {
    ticks += 1;
  }, 1);
  try {
    const hashes = await Promise.all(Array.from({ length: 8 }, (_, index) => hashPassword(`Paralel-${index}-Sandi-2026!`)));
    assert.equal(new Set(hashes).size, 8);
  } finally {
    clearInterval(timer);
  }
  assert.ok(ticks >= 2, `timer harus tetap berjalan selama 8 hash paralel; tick=${ticks}`);
});

test('PERF-09: API hash async; hash format lama (scryptSync) tetap terverifikasi', async () => {
  const salt = randomBytes(16).toString('hex');
  const legacy = `scrypt$${salt}$${scryptSync(DEMO_PASSWORD, salt, 64).toString('hex')}`;

  const verifying = verifyPassword(DEMO_PASSWORD, legacy);
  assert.ok(verifying instanceof Promise, 'verifyPassword mengembalikan Promise');
  assert.equal(await verifying, true, 'hash lama tetap cocok');
  assert.equal(await verifyPassword('Sandi-Salah-2026!', legacy), false);
  assert.equal(await verifyPassword(DEMO_PASSWORD, `bcrypt$${salt}$00`), false);
  assert.equal(await verifyPassword(DEMO_PASSWORD, `scrypt$${salt}$00`), false, 'panjang hash berbeda ditolak');

  const hashing = hashPassword(DEMO_PASSWORD);
  assert.ok(hashing instanceof Promise, 'hashPassword mengembalikan Promise');
  const stored = await hashing;
  const [scheme, newSalt, hash] = stored.split('$');
  assert.equal(scheme, 'scrypt');
  assert.match(newSalt ?? '', /^[0-9a-f]{32}$/);
  assert.equal(hash, scryptSync(DEMO_PASSWORD, newSalt!, 64).toString('hex'), 'parameter dan format scrypt tidak berubah');
  assert.equal(await verifyPassword(DEMO_PASSWORD, stored), true);
});

/* ---------------- NR-09: kuota login per akun, pengaman kasar per alamat ---------------- */

/** `count` kredensial salah dari satu alamat klien, masing-masing untuk email berbeda (akun tak dikenal). */
async function distinctFailures(prefix: string, count: number): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < count; i += 1) {
    statuses.push((await login(`${prefix}.${i}@sekolah.contoh`, 'Salah-Sekali-2026!')).status);
  }
  return statuses;
}

test('NR-09: 30 kegagalan dari satu alamat dengan email berbeda tidak mengunci akun lain dari alamat itu', async () => {
  resetRateLimits();
  assert.deepEqual(await distinctFailures('nr09a', 30), Array(30).fill(401), '30 email berbeda dari satu alamat tidak terkena 429');

  const legitimate = await login('admin@svara.local', DEMO_PASSWORD);
  assert.equal(legitimate.status, 200, `sandi benar akun lain tidak terkunci: ${legitimate.text}`);
  assert.match(legitimate.setCookie, /^svara_session=/);
});

test('NR-09: batas 8 kegagalan per alamat+akun tetap menahan akun itu tanpa mengunci akun lain', async () => {
  resetRateLimits();
  const email = 'creator.b@svara.local';
  const statuses: number[] = [];
  for (let i = 0; i < 9; i += 1) statuses.push((await login(email, 'Salah-Sekali-2026!')).status);
  assert.deepEqual(statuses, [...Array(8).fill(401), 429], 'percobaan ke-9 ditolak');

  const audit = await failedLoginAudit();
  const blocked = await login(email, DEMO_PASSWORD);
  assert.equal(blocked.status, 429, 'email itu tetap tertahan meski sandi benar');
  assert.equal(blocked.json?.code, 'rate_limited');
  assert.equal((await failedLoginAudit()).count, audit.count, 'penolakan 429 tidak menulis audit');

  const other = await login('officer@svara.local', DEMO_PASSWORD);
  assert.equal(other.status, 200, 'blokir satu akun tidak menjalar ke akun lain dari alamat yang sama');
});

test('NR-09: login sah tidak memotong kuota per alamat; kuota 200 utuh setelah 35 login berhasil', async () => {
  resetRateLimits();
  const accounts = ['admin@svara.local', 'creator.a@svara.local', 'creator.b@svara.local', 'officer@svara.local', 'orgadmin@svara.local'];
  const successes: number[] = [];
  for (let round = 0; round < 7; round += 1) {
    for (const email of accounts) successes.push((await login(email, DEMO_PASSWORD)).status);
  }
  assert.deepEqual(successes, Array(35).fill(200));
  // Bila 35 login berhasil ikut memotong kuota, kegagalan berikutnya akan 429 lebih cepat.
  assert.deepEqual(await distinctFailures('nr09c', 200), Array(200).fill(401), 'kuota per alamat tetap 200 setelah 35 login berhasil');
  assert.equal((await login('nr09c.last@sekolah.contoh', 'Salah-Sekali-2026!')).status, 429, 'kuota ke-201 habis');
});

test('NR-09: pengaman kasar 200 kegagalan per alamat tetap menahan banjir lintas akun', async () => {
  resetRateLimits();
  assert.deepEqual(await distinctFailures('nr09e', 200), Array(200).fill(401), '200 email berbeda dari satu alamat');
  const audited = await login('nr09e.200@sekolah.contoh', 'Salah-Sekali-2026!');
  assert.equal(audited.status, 429, 'kegagalan ke-201 ditolak sebelum query akun dan audit');
  const audit = await failedLoginAudit();
  const blocked = await login('admin@svara.local', DEMO_PASSWORD);
  assert.equal(blocked.status, 429, 'alamat itu tertahan, termasuk sandi benar');
  assert.equal((await failedLoginAudit()).count, audit.count, 'penolakan 429 tidak menulis audit');
});


const HSTS_VALUE = 'max-age=15552000; includeSubDomains';

interface EnvSnapshot {
  NODE_ENV: string | undefined;
  APP_ORIGIN: string | undefined;
  COOKIE_SECURE: string | undefined;
  ENABLE_HSTS: string | undefined;
}

function snapshotEnv(): EnvSnapshot {
  return {
    NODE_ENV: process.env.NODE_ENV,
    APP_ORIGIN: process.env.APP_ORIGIN,
    COOKIE_SECURE: process.env.COOKIE_SECURE,
    ENABLE_HSTS: process.env.ENABLE_HSTS,
  };
}

function restoreEnv(snapshot: EnvSnapshot): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test('OPS-04: produksi dengan APP_ORIGIN https memaksa cookie Secure dan HSTS pada permintaan HTTPS', async () => {
  const env = snapshotEnv();
  const trustProxy = app.get('trust proxy');
  try {
    process.env.NODE_ENV = 'production';
    process.env.APP_ORIGIN = 'https://app.example.org';
    resetRateLimits();
    delete process.env.COOKIE_SECURE;
    delete process.env.ENABLE_HSTS;
    app.set('trust proxy', trustProxySetting('loopback'));

    const secure = await login('creator.a@svara.local', DEMO_PASSWORD, { 'X-Forwarded-Proto': 'https' });
    assert.equal(secure.status, 200, secure.text);
    assert.match(secure.setCookie, SECURE_ATTR, `production+https → Secure tanpa COOKIE_SECURE: ${secure.setCookie}`);
    assert.equal(secure.headers.get('strict-transport-security'), HSTS_VALUE);

    const plain = await login('creator.a@svara.local', DEMO_PASSWORD);
    assert.equal(plain.status, 200, plain.text);
    assert.match(plain.setCookie, SECURE_ATTR, 'default produksi tetap memaksa Secure di permintaan HTTP');
    assert.equal(plain.headers.get('strict-transport-security'), null, 'HSTS hanya dikirim untuk permintaan HTTPS');
  } finally {
    app.set('trust proxy', trustProxy);
    restoreEnv(env);
  }
});

test('OPS-04: COOKIE_SECURE=0 dan ENABLE_HSTS=0 tetap menjadi override eksplisit produksi', async () => {
  const env = snapshotEnv();
  const trustProxy = app.get('trust proxy');
  try {
    process.env.NODE_ENV = 'production';
    process.env.APP_ORIGIN = 'https://app.example.org';
    resetRateLimits();
    process.env.COOKIE_SECURE = '0';
    process.env.ENABLE_HSTS = '0';
    app.set('trust proxy', false);

    const plain = await login('creator.a@svara.local', DEMO_PASSWORD);
    assert.equal(plain.status, 200, plain.text);
    assert.doesNotMatch(plain.setCookie, SECURE_ATTR, `COOKIE_SECURE=0 mematikan default produksi: ${plain.setCookie}`);

    app.set('trust proxy', trustProxySetting('loopback'));
    const secure = await login('creator.a@svara.local', DEMO_PASSWORD, { 'X-Forwarded-Proto': 'https' });
    assert.equal(secure.status, 200, secure.text);
    assert.match(secure.setCookie, SECURE_ATTR, 'permintaan HTTPS tetap memakai Secure');
    assert.equal(secure.headers.get('strict-transport-security'), null, 'ENABLE_HSTS=0 mematikan HSTS');
  } finally {
    app.set('trust proxy', trustProxy);
    restoreEnv(env);
  }
});

test('OPS-04: produksi tanpa HTTPS tetap login tanpa Secure/HSTS dan memberi peringatan satu baris', async () => {
  const env = snapshotEnv();
  const trustProxy = app.get('trust proxy');
  try {
    process.env.NODE_ENV = 'production';
    process.env.APP_ORIGIN = 'http://127.0.0.1:3000';
    resetRateLimits();
    delete process.env.COOKIE_SECURE;
    delete process.env.ENABLE_HSTS;
    app.set('trust proxy', false);

    const result = await login('creator.a@svara.local', DEMO_PASSWORD);
    assert.equal(result.status, 200, `login HTTP produksi harus tetap berjalan: ${result.text}`);
    assert.doesNotMatch(result.setCookie, SECURE_ATTR, 'instalasi HTTP tidak boleh dipaksa Secure');
    assert.equal(result.headers.get('strict-transport-security'), null);

    const { productionWithoutHttpsWarning } = await import('../security.ts');
    assert.match(String(productionWithoutHttpsWarning()), /HTTPS/, 'peringatan produksi tanpa HTTPS');

    process.env.APP_ORIGIN = 'https://app.example.org';
    assert.equal(productionWithoutHttpsWarning(), null, 'produksi HTTPS tidak memperingatkan');

    process.env.NODE_ENV = 'test';
    process.env.APP_ORIGIN = 'http://127.0.0.1:3000';
    assert.equal(productionWithoutHttpsWarning(), null, 'dev tidak memperingatkan');
  } finally {
    app.set('trust proxy', trustProxy);
    restoreEnv(env);
  }
});

test('OPS-04: dev tetap tanpa Secure/HSTS walau APP_ORIGIN https', async () => {
  const env = snapshotEnv();
  const trustProxy = app.get('trust proxy');
  try {
    process.env.NODE_ENV = 'test';
    process.env.APP_ORIGIN = 'https://app.example.org';
    resetRateLimits();
    delete process.env.COOKIE_SECURE;
    delete process.env.ENABLE_HSTS;
    app.set('trust proxy', false);

    const result = await login('creator.a@svara.local', DEMO_PASSWORD);
    assert.equal(result.status, 200, result.text);
    assert.doesNotMatch(result.setCookie, SECURE_ATTR, `dev HTTP tetap tanpa Secure: ${result.setCookie}`);
    assert.equal(result.headers.get('strict-transport-security'), null);
  } finally {
    app.set('trust proxy', trustProxy);
    restoreEnv(env);
  }
});
