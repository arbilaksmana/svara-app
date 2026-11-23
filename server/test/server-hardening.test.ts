import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { after, before, test } from 'node:test';
import { closeTestDatabase, resetTestDatabase } from './test-db.ts';

process.env.NODE_ENV = 'test';
process.env.SEED_DEMO = '1';
process.env.SEED_PASSWORD = 'SvaraDemo123!';

const { app } = await import('../app.ts');
const { all, get, nowIso, run } = await import('../db.ts');
const { seedDemoIfEmpty } = await import('../seed-data.ts');
const { trustProxySetting } = await import('../security.ts');

const DEMO_PASSWORD = 'SvaraDemo123!';
const PUBLIC_LINK = 'pl_demoTautanUmum1A';
const SECURE_ATTR = /;\s*Secure(?:;|$)/i;

let server: Server | undefined;
let base = '';

interface Result {
  status: number;
  json: Record<string, unknown> | null;
  text: string;
  headers: Headers;
}

async function call(
  path: string,
  options: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {},
): Promise<Result> {
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers: {
      Accept: 'application/json',
      'X-Svara-Client': 'web',
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
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
  return { status: response.status, json, text, headers: response.headers };
}

function data<T>(result: Result): T {
  assert.ok(result.status < 400, `${result.status}: ${result.text.slice(0, 300)}`);
  return (result.json as { data: T }).data;
}

/** Login baru setiap kali: test L-04 justru memeriksa cookie lama setelah status akun berubah. */
async function login(email: string): Promise<string> {
  const result = await call('/auth/login', { body: { email, password: DEMO_PASSWORD } });
  assert.equal(result.status, 200, `login ${email}: ${result.text.slice(0, 300)}`);
  const cookie = result.headers.get('set-cookie') ?? '';
  assert.match(cookie, /^svara_session=/);
  return cookie.split(';')[0]!;
}

const cookies = new Map<string, Promise<string>>();

/** Sesi bersama untuk akun yang statusnya tidak diubah test; login dibatasi 8 per email. */
function session(email: string): Promise<string> {
  let cached = cookies.get(email);
  if (!cached) {
    cached = login(email);
    cookies.set(email, cached);
  }
  return cached;
}

async function createInvitation(cookie: string, label: string): Promise<{ id: string; code: string; token: string }> {
  const created = data<{ invitation: { id: string; code: string }; token: string }>(
    await call('/surveys/s_demo1/invitations', { cookie, body: { label, expires_at: '2027-01-01' } }),
  );
  return { id: created.invitation.id, code: created.invitation.code, token: created.token };
}

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

test('L-01: GET terautentikasi di router surveys dan bacaan admin membawa Cache-Control: no-store', async () => {
  const admin = await session('admin@svara.local');
  const creator = await session('creator.a@svara.local');
  const reads: Array<[string, string, number]> = [
    [admin, '/admin/accounts', 200],
    [admin, '/admin/audit', 200],
    [admin, '/admin/data-requests', 200],
    [admin, '/admin/integration', 200],
    [admin, '/admin/stats', 200],
    [creator, '/surveys', 200],
    [creator, '/surveys/s_demo1', 200],
    [creator, '/surveys/s_demo1/settings', 200],
    [creator, '/surveys/s_demo1/summary', 200],
    [creator, '/surveys/s_demo1/responses', 200],
    [creator, '/surveys/s_demo1/export?format=codebook', 200],
    // Penolakan dan path tak dikenal untuk sesi yang sah juga tidak boleh di-cache.
    [creator, '/admin/accounts', 403],
    [creator, '/surveys/s_tidak_ada', 404],
  ];
  const observed: Array<{ path: string; status: number; cache: string | null }> = [];
  for (const [cookie, path] of reads) {
    const result = await call(path, { cookie });
    observed.push({ path, status: result.status, cache: result.headers.get('cache-control') });
  }
  assert.deepEqual(
    observed,
    reads.map(([, path, status]) => ({ path, status, cache: 'no-store' })),
  );
});

test('L-02: membuat undangan dengan expires_at tak valid → 422; tanggal/tanggal-waktu ISO yang sah diterima', async () => {
  const cookie = await session('creator.a@svara.local');
  const invalid: unknown[] = [
    '2026-99-99',
    '2027-02-30',
    '2027-13-01',
    '2027-1-1',
    'besok',
    '2027-01-01T25:00:00Z',
    '2027-01-01T24:00:00Z',
    '2027-01-01T10:00:00',
    '2027-01-01T10:00:00+25:00',
    '2027-01-01T23:59:59.000ZT23:59:59.000Z',
    '2020-01-01',
    '2020-01-01T00:00:00Z',
    20270101,
    true,
    { at: '2027-01-01' },
  ];
  const observed: Array<{ value: unknown; status: number; code: unknown }> = [];
  for (const value of invalid) {
    const result = await call('/surveys/s_demo1/invitations', { cookie, body: { label: 'Uji L-02', expires_at: value } });
    observed.push({ value, status: result.status, code: result.json?.code });
  }
  assert.deepEqual(
    observed,
    invalid.map((value) => ({ value, status: 422, code: 'validation_error' })),
  );

  const accepted: Array<[unknown, string | null]> = [
    ['2027-01-01', '2027-01-01T23:59:59.000Z'],
    ['2028-02-29', '2028-02-29T23:59:59.000Z'],
    ['2027-01-01T10:00:00+07:00', '2027-01-01T03:00:00.000Z'],
    ['2027-01-01T10:00Z', '2027-01-01T10:00:00.000Z'],
    [undefined, null],
  ];
  for (const [value, expected] of accepted) {
    const created = data<{ invitation: { id: string; expires_at: string | null } }>(
      await call('/surveys/s_demo1/invitations', { cookie, body: { label: 'Uji L-02 sah', expires_at: value } }),
    );
    assert.equal(created.invitation.expires_at, expected, `expires_at ${String(value)}`);
    const stored = await get<{ expires_at: string | null }>('SELECT expires_at FROM invitations WHERE id = ?', created.invitation.id);
    assert.equal(stored?.expires_at, expected, `tersimpan ${String(value)}`);
  }
});

test('L-02: undangan di DB dengan expires_at tak valid diperlakukan kedaluwarsa oleh endpoint publik', async () => {
  const cookie = await session('creator.a@svara.local');
  for (const broken of ['2026-99-99T23:59:59.000Z', 'bukan-tanggal', '']) {
    const invitation = await createInvitation(cookie, `Uji L-02 rusak ${broken || 'kosong'}`);
    await run('UPDATE invitations SET expires_at = ? WHERE id = ?', broken, invitation.id);

    const context = data<{ state: string; canSubmit: boolean; consent_version: string }>(
      await call(`/public/surveys/${invitation.token}`),
    );
    assert.deepEqual({ state: context.state, canSubmit: context.canSubmit }, { state: 'expired', canSubmit: false }, `konteks ${JSON.stringify(broken)}`);

    const resolved = await call('/public/invitations/resolve', { body: { code: invitation.code } });
    assert.equal(resolved.status, 409, `resolve ${JSON.stringify(broken)}: ${resolved.text.slice(0, 200)}`);
    assert.equal(resolved.json?.code, 'invitation_expired');
    assert.equal((resolved.json?.data as { token?: string } | undefined)?.token, undefined, 'token tidak dibuka');

    const consent = await call(`/public/surveys/${invitation.token}/consent`, {
      body: { version_id: context.consent_version, respondent_click: true, eligibility: true, guardian_evidence_ref: 'wali-sintetis' },
    });
    assert.equal(consent.status, 409, `consent ${JSON.stringify(broken)}: ${consent.text.slice(0, 200)}`);
    assert.equal(consent.json?.code, 'submission_expired');
  }
});

async function me(cookie: string): Promise<number> {
  return (await call('/auth/me', { cookie })).status;
}

test('L-04: akun ditangguhkan lalu diaktifkan kembali lewat /admin/accounts: cookie sesi lama 401', async () => {
  const admin = await session('admin@svara.local');
  const laptop = await login('creator.b@svara.local');
  const phone = await login('creator.b@svara.local');
  assert.deepEqual([await me(laptop), await me(phone)], [200, 200]);

  const suspended = await call('/admin/accounts/u_creator_b', { method: 'PATCH', cookie: admin, body: { status: 'suspended' } });
  assert.equal(suspended.status, 200, suspended.text.slice(0, 200));
  assert.deepEqual([await me(laptop), await me(phone)], [401, 401]);

  const reactivated = await call('/admin/accounts/u_creator_b', { method: 'PATCH', cookie: admin, body: { status: 'active' } });
  assert.equal(reactivated.status, 200, reactivated.text.slice(0, 200));
  assert.deepEqual([await me(laptop), await me(phone)], [401, 401], 'aktivasi ulang tidak menghidupkan sesi lama');

  const fresh = await login('creator.b@svara.local');
  assert.equal(await me(fresh), 200, 'login baru setelah aktivasi ulang tetap bisa');
  assert.equal(await me(admin), 200, 'sesi admin yang mengubah status tidak tersentuh');
});

test('L-04: anggota ditangguhkan lalu diaktifkan kembali lewat /org/members: cookie sesi lama 401', async () => {
  const orgAdmin = await session('orgadmin@svara.local');
  const old = await login('officer@svara.local');
  assert.equal(await me(old), 200);

  const suspended = await call('/org/members/u_petugas', { method: 'PATCH', cookie: orgAdmin, body: { status: 'suspended' } });
  assert.equal(suspended.status, 200, suspended.text.slice(0, 200));
  assert.equal(await me(old), 401);

  const reactivated = await call('/org/members/u_petugas', { method: 'PATCH', cookie: orgAdmin, body: { status: 'active' } });
  assert.equal(reactivated.status, 200, reactivated.text.slice(0, 200));
  assert.equal(await me(old), 401, 'aktivasi ulang tidak menghidupkan sesi lama');

  const fresh = await login('officer@svara.local');
  assert.equal(await me(fresh), 200);
  assert.equal(await me(orgAdmin), 200, 'sesi org_admin tidak tersentuh');
});

test('SEC-11: audit buat/cabut undangan memakai ID undangan; kode lama tidak keluar mentah di /admin/audit, /org/audit, dan bootstrap', async () => {
  const creator = await session('creator.a@svara.local');
  const admin = await session('admin@svara.local');
  const orgAdmin = await session('orgadmin@svara.local');

  const invitation = await createInvitation(creator, 'Uji SEC-11');
  const revoked = await call(`/invitations/${invitation.id}/revoke`, { cookie: creator, body: {} });
  assert.equal(revoked.status, 200, revoked.text.slice(0, 200));

  const written = await all<{ action: string; object: string; metadata: string | null }>(
    "SELECT action, object, metadata FROM audit_logs WHERE action IN ('Buat undangan', 'Cabut undangan') ORDER BY at, id",
  );
  const mine = written.filter((row) => row.object.includes(invitation.id));
  assert.deepEqual(
    mine.map((row) => row.action),
    ['Buat undangan', 'Cabut undangan'],
    `baris audit merujuk ID undangan: ${JSON.stringify(written)}`,
  );
  for (const row of written) {
    assert.doesNotMatch(`${row.object} ${row.metadata ?? ''}`, /UND-/, `audit tanpa kode undangan: ${JSON.stringify(row)}`);
  }

  // Baris lama yang ditulis sebelum perbaikan tetap di DB; jalur baca menyamarkannya.
  const legacyCode = 'UND-LAMA01';
  await run(
    `INSERT INTO audit_logs (id, actor, action, object, outcome, at, metadata, account_id, organization_id)
     VALUES ('log_sec11_legacy', 'u_creator_a', 'Cabut undangan', ?, 'berhasil', ?, NULL, 'u_creator_a', 'org_smk')`,
    `s_demo1 · ${legacyCode}`,
    nowIso(),
  );
  const codes = [legacyCode, invitation.code];

  type AuditRow = { id: string; object: string };
  const adminAudit = await call('/admin/audit?limit=500', { cookie: admin });
  const orgAudit = await call('/org/audit?limit=500', { cookie: orgAdmin });
  const bootstrap = data<{ auditLogs: AuditRow[] }>(await call('/bootstrap', { cookie: admin }));
  const paths: Array<[string, AuditRow[], string]> = [
    ['/admin/audit', data<AuditRow[]>(adminAudit), adminAudit.text],
    ['/org/audit', data<{ rows: AuditRow[] }>(orgAudit).rows, orgAudit.text],
    ['/bootstrap auditLogs', bootstrap.auditLogs, JSON.stringify(bootstrap.auditLogs)],
  ];
  for (const [path, rows, text] of paths) {
    for (const code of codes) assert.ok(!text.includes(code), `${path} memuat kode ${code}`);
    const legacy = rows.find((row) => row.id === 'log_sec11_legacy');
    assert.ok(legacy, `${path} tetap menampilkan baris lama`);
    assert.ok(legacy.object.startsWith('s_demo1 · '), `${path}: konteks selain kode dipertahankan: ${legacy.object}`);
  }
  const untouched = data<AuditRow[]>(adminAudit).find((row) => row.id === 'log_01');
  assert.equal(untouched?.object, 's_demo1 · v1', 'objek audit tanpa kode tidak diubah');

  const stored = await get<{ object: string }>("SELECT object FROM audit_logs WHERE id = 'log_sec11_legacy'");
  assert.equal(stored?.object, `s_demo1 · ${legacyCode}`, 'isi baris audit di DB tidak diubah');
});

test('BR-12: mencabut undangan yang sudah dipakai → 409 dan status tetap used', async () => {
  const cookie = await session('creator.a@svara.local');
  const select = () =>
    get<{ status: string; used_at: string | null; revoked_at: string | null }>(
      "SELECT status, used_at, revoked_at FROM invitations WHERE id = 'inv_02'",
    );
  const before = await select();
  assert.equal(before?.status, 'used');
  assert.ok(before?.used_at);

  const revoked = await call('/invitations/inv_02/revoke', { cookie, body: {} });
  assert.equal(revoked.status, 409, revoked.text.slice(0, 200));
  assert.equal(revoked.json?.code, 'invitation_used');
  assert.deepEqual(await select(), before, 'baris undangan tidak berubah');
  // SEC-09/10: ID undangan (`/s/<invitation id>`) adalah referensi, bukan kredensial, dan statusnya
  // tegak di konteks undangan. ID seed (`inv_02`) bukan bentuk `newId` sehingga diuji lewat ID asli.
  const usedInvitation = await createInvitation(cookie, 'Uji BR-12 terpakai');
  await run(
    "UPDATE invitations SET status = 'used', used_at = ? WHERE id = ?",
    new Date().toISOString(),
    usedInvitation.id,
  );
  assert.equal(data<{ state: string }>(await call(`/public/surveys/${usedInvitation.id}`)).state, 'used');
  assert.equal(data<{ state: string }>(await call(`/public/surveys/${usedInvitation.token}`)).state, 'used');
  assert.equal((await call('/public/surveys/undangan-demo')).status, 404, 'bentuk token lama tidak dicari');
  const audited = await get<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM audit_logs WHERE action = 'Cabut undangan' AND object LIKE '%inv_02%'",
  );
  assert.equal(audited?.count, 0, 'penolakan tidak dicatat sebagai pencabutan berhasil');

  // Undangan aktif tetap dapat dicabut, dan pencabutan ulang tetap idempoten.
  const active = await createInvitation(cookie, 'Uji BR-12 aktif');
  assert.equal((await call(`/invitations/${active.id}/revoke`, { cookie, body: {} })).status, 200);
  assert.equal((await call(`/invitations/${active.id}/revoke`, { cookie, body: {} })).status, 200);
  assert.equal(data<{ state: string }>(await call(`/public/surveys/${active.token}`)).state, 'revoked');
});

async function respondentCookie(headers: Record<string, string> = {}): Promise<string> {
  const context = data<{ consent_version: string }>(await call(`/public/surveys/${PUBLIC_LINK}`));
  const result = await call(`/public/surveys/${PUBLIC_LINK}/consent`, {
    headers,
    body: { version_id: context.consent_version, respondent_click: true, eligibility: true, guardian_evidence_ref: 'wali-sintetis' },
  });
  assert.equal(result.status, 201, result.text.slice(0, 200));
  const cookie = result.headers.get('set-cookie') ?? '';
  assert.match(cookie, /^svara_respondent=[A-Za-z0-9_-]{43};/u);
  return cookie;
}

test('SEC-13: cookie svara_respondent memakai COOKIE_SECURE atau req.secure, bukan X-Forwarded-Proto klien', async () => {
  const previous = process.env.COOKIE_SECURE;
  const trustProxy = app.get('trust proxy');
  try {
    process.env.COOKIE_SECURE = '1';
    const forced = await respondentCookie();
    assert.match(forced, SECURE_ATTR, `COOKIE_SECURE=1 lewat HTTP → Secure: ${forced}`);

    delete process.env.COOKIE_SECURE;
    assert.equal(trustProxy, false, 'TRUST_PROXY kosong → trust proxy mati');
    const spoofed = await respondentCookie({ 'X-Forwarded-Proto': 'https' });
    assert.doesNotMatch(spoofed, SECURE_ATTR, `X-Forwarded-Proto dari klien tidak dipercaya: ${spoofed}`);
    const plain = await respondentCookie();
    assert.doesNotMatch(plain, SECURE_ATTR, `HTTP biasa tanpa COOKIE_SECURE → tanpa Secure: ${plain}`);

    app.set('trust proxy', trustProxySetting('loopback'));
    const trusted = await respondentCookie({ 'X-Forwarded-Proto': 'https' });
    assert.match(trusted, SECURE_ATTR, `HTTPS dari proxy tepercaya → Secure: ${trusted}`);
  } finally {
    app.set('trust proxy', trustProxy);
    if (previous === undefined) delete process.env.COOKIE_SECURE;
    else process.env.COOKIE_SECURE = previous;
  }
});
