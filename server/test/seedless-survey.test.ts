import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { after, before, beforeEach, test } from 'node:test';
import { Client } from 'pg';
import { closeTestDatabase, databaseUrl, resetTestDatabase } from './test-db.ts';
import { app } from '../app.ts';
import { hashPassword } from '../security.ts';

/**
 * KP-10 / NEW-PO-04: POST /surveys tidak lagi bergantung pada tabel `profiles` legacy. Instalasi tanpa seed
 * hanya punya `organizations`/`platform_profile`; keduanya sumber profil survei baru, dan baris `profiles`
 * hanya diturunkan (sekali, idempoten) karena `surveys.profile_id` masih FK NOT NULL.
 */
process.env.NODE_ENV = 'test';

const PASSWORD = 'SvaraDemo123!';

let server: Server;
let origin = '';

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server) {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    server.close((error) => (error ? reject(error) : resolve()));
    await promise;
  }
  await closeTestDatabase();
});

async function sql<T extends Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return (await client.query<T>(text, params)).rows;
  } finally {
    await client.end();
  }
}

/** Instalasi tanpa seed: skema baru, tanpa `profiles`, tanpa organisasi, tanpa profil platform. */
async function seedlessSchema(): Promise<void> {
  await resetTestDatabase();
  assert.deepEqual(await sql('SELECT id FROM profiles'), [], 'prasyarat: tidak ada profil legacy');
  assert.deepEqual(await sql('SELECT id FROM platform_profile'), []);
  assert.deepEqual(await sql('SELECT id FROM organizations'), []);
}

async function account(email: string, role: 'super_admin' | 'creator', organizationId: string | null): Promise<string> {
  await sql(
    `INSERT INTO accounts (id, email, display_name, role, status, password_hash, created_at, organization_id)
     VALUES ($1, $2, $3, $4, 'active', $5, '2026-01-01T00:00:00.000Z', $6)`,
    [`u_${Math.random().toString(36).slice(2)}`, email, email, role, await hashPassword(PASSWORD), organizationId],
  );
  return email;
}

/** Sama dengan hasil `pnpm admin:bootstrap` tanpa seed: profil platform + notice templat versi 1.0. */
async function platformProfile(): Promise<void> {
  await sql(
    `INSERT INTO platform_profile (id, organization_name, organization_type, policy_url, terms_url, retention_days,
       data_request_contact, cross_border_transfer, notice_version, updated_at)
     VALUES ('platform', 'Svara', 'platform', '/privasi', '/ketentuan', NULL, NULL, NULL, '1.0', '2026-01-01T00:00:00.000Z')`,
  );
  await sql(
    `INSERT INTO platform_notices (id, version, effective_date, purpose, data_categories, module15_usage,
       retention_text, recipients, contact, rights, child_data_text, cross_border_text, created_at)
     VALUES ('pn_1_0', '1.0', '2026-01-01', 'Tujuan.', 'Kategori.', 'Modul.', 'Retensi.', 'Penerima.', 'Kontak.',
       'Hak.', 'Anak.', 'Lintas.', '2026-01-01T00:00:00.000Z')`,
  );
}

/** Login dibatasi per email per alamat IP; satu suite memakai beberapa sesi saja. */
const sessionCache = new Map<string, Promise<string>>();

function login(email: string, password = PASSWORD): Promise<string> {
  let cached = sessionCache.get(email);
  if (!cached) {
    cached = loginOnce(email, password);
    sessionCache.set(email, cached);
  }
  return cached;
}

/** Akun dibuat ulang tiap test (schema diganti), jadi login setiap test memakai satu jatah kuota per email. */
const LOGIN_ATTEMPTS = 8;
let loginAttempts = 0;

function nextEmail(label: string): string {
  loginAttempts += 1;
  assert.ok(loginAttempts <= LOGIN_ATTEMPTS, `login melebihi batas ${LOGIN_ATTEMPTS} per test: ${label}`);
  return `${loginAttempts}.${label}@tanpa-seed.test`;
}

/** Satu akun fixture per test: dibuat sebelum login, bukan lewat helper bersama dari modul teratas. */
async function loginOnce(email: string, password: string): Promise<string> {
  const response = await fetch(`${origin}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Svara-Client': 'web' },
    body: JSON.stringify({ email, password }),
  });
  const text = await response.text();
  assert.equal(response.status, 200, `login ${email}: ${text}`);
  return (response.headers.get('set-cookie') ?? '').split(';')[0]!;
}

interface ApiResult {
  status: number;
  json: { code?: string; error?: string; data?: Record<string, unknown> };
}

async function api(cookie: string, path: string, body?: Record<string, unknown>): Promise<ApiResult> {
  const response = await fetch(`${origin}/api/v1${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Svara-Client': 'web', Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json().catch(() => ({}))) as ApiResult['json'] };
}

const createSurvey = (cookie: string, body: Record<string, unknown>) => api(cookie, '/surveys', body);

/**
 * Organisasi persis seperti yang dibuat lewat POST /admin/organizations: URL kebijakan/ketentuan sudah diisi
 * form; hanya nilai placeholder "/" yang dianggap belum dikonfigurasi pengelola.
 */
async function createOrganization(configured: boolean): Promise<void> {
  const cookie = await login(await account(nextEmail('platform'), 'super_admin', null));
  const created = await api(cookie, '/admin/organizations', {
    name: 'Yayasan Tanpa Seed',
    notice_version: '1.0',
    organization_type: 'organization',
    policy_url: configured ? 'https://yayasan.test/privasi' : '-',
    terms_url: configured ? 'https://yayasan.test/ketentuan' : '-',
    admin: { display_name: 'Admin Yayasan', email: nextEmail('org-admin'), password: PASSWORD },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
}

/** Creator dengan email unik per test; schema diganti tiap test sehingga login juga unik. */
async function creatorSession(organizationId: string | null): Promise<string> {
  return login(await account(nextEmail('creator'), 'creator', organizationId));
}

async function organizationId(): Promise<string> {
  return (await sql<{ id: string }>('SELECT id FROM organizations'))[0]!.id;
}

beforeEach(async () => {
  // resetTestDatabase mengganti schema: sesi cache menunjuk baris sesi yang sudah hilang.
  sessionCache.clear();
  loginAttempts = 0;
  await seedlessSchema();
});

test('KP-10: tanpa seed, platform_profile ada → POST /surveys 201 dan baris survei benar-benar tersimpan', async () => {
  await platformProfile();
  const cookie = await creatorSession(null);

  const created = await createSurvey(cookie, { title: 'Survei tanpa seed', owner_scope: 'individual' });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const survey = (created.json.data as { survey: { id: string; profile_id: string; status: string } }).survey;
  assert.equal(survey.status, 'draft', 'survei dibuat sebagai draf, bukan sekadar respons 201');

  const rows = await sql<{ id: string; profile_id: string; organization_id: string | null; status: string }>(
    'SELECT id, profile_id, organization_id, status FROM surveys ORDER BY id',
  );
  assert.deepEqual(rows.map((row) => row.id), [survey.id], 'tepat satu baris surveys di DB');
  assert.equal(rows[0]!.status, 'draft');
  assert.equal(rows[0]!.organization_id, null);
  assert.equal(rows[0]!.profile_id, 'p_platform');
  assert.deepEqual(
    await sql('SELECT id FROM profiles'),
    [{ id: 'p_platform' }],
    'profil turunan platform ditulis karena FK surveys.profile_id wajib',
  );
  assert.deepEqual(
    await sql('SELECT organization_name, organization_type, policy_url, terms_url FROM profiles WHERE id = $1', ['p_platform']),
    [{ organization_name: 'Svara', organization_type: 'platform', policy_url: '/privasi', terms_url: '/ketentuan' }],
    'nilai profil turunan diambil dari platform_profile',
  );
});

test('KP-10: tanpa seed, organisasi terkonfigurasi → survei organisasi memakai profil organisasi', async () => {
  await platformProfile();
  await createOrganization(true);
  const cookie = await creatorSession(await organizationId());

  const created = await createSurvey(cookie, { title: 'Survei organisasi', owner_scope: 'organization' });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const rows = await sql<{ profile_id: string; organization_id: string | null }>(
    'SELECT profile_id, organization_id FROM surveys',
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.organization_id, (await sql<{ id: string }>('SELECT id FROM organizations'))[0]!.id);
  assert.equal(rows[0]!.profile_id, `p_org_${rows[0]!.organization_id}`);
  assert.deepEqual(
    await sql('SELECT organization_name, policy_url, respondent_age_category FROM profiles WHERE id = $1', [rows[0]!.profile_id]),
    [{ organization_name: 'Yayasan Tanpa Seed', policy_url: 'https://yayasan.test/privasi', respondent_age_category: 'adult' }],
    'profil turunan organisasi diambil dari organizations',
  );
});

/**
 * Organisasi hasil bootstrap (`BOOTSTRAP_ORGANIZATION_NAME`) punya semua kolom NOT NULL, jadi gerbang profil tidak
 * pernah menghalanginya. Yang tidak ada pada instalasi tanpa seed adalah notice responden; notice itu diperiksa saat
 * publikasi (`requirePublishableNotice`), bukan saat draf dibuat, sehingga pembuatan draf tetap 201.
 */
test('KP-10: organisasi hasil bootstrap tanpa notice tersedia → draf 201 tersimpan, notice menyusul sebelum publikasi', async () => {
  await platformProfile();
  await createOrganization(false);
  const org = await organizationId();
  await sql('DELETE FROM organization_notices');
  const cookie = await creatorSession(org);

  const created = await createSurvey(cookie, { title: 'Survei organisasi', owner_scope: 'organization' });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.deepEqual(
    await sql('SELECT profile_id, organization_id, status FROM surveys'),
    [{ profile_id: `p_org_${org}`, organization_id: org, status: 'draft' }],
    'draf benar-benar tersimpan pada lingkup organisasi',
  );
  assert.deepEqual(await sql('SELECT id FROM profiles'), [{ id: `p_org_${org}` }], 'profil turunan dari organizations');
});

test('KP-10: platform_profile tidak ada → 409 profile_missing yang menyebut bootstrap', async () => {
  const cookie = await creatorSession(null);

  const created = await createSurvey(cookie, { title: 'Survei tanpa profil', owner_scope: 'individual' });
  assert.equal(created.status, 409, JSON.stringify(created.json));
  assert.equal(created.json.code, 'profile_missing');
  assert.match(created.json.error ?? '', /bootstrap/iu);
  assert.deepEqual(await sql('SELECT id FROM surveys'), []);
});

test('KP-10: dua kali membuat survei tidak menggandakan baris profiles untuk sumber yang sama', async () => {
  await platformProfile();
  const cookie = await creatorSession(null);

  assert.equal((await createSurvey(cookie, { title: 'Pertama' })).status, 201);
  assert.equal((await createSurvey(cookie, { title: 'Kedua' })).status, 201);

  const rows = await sql<{ profile_id: string }>('SELECT profile_id FROM surveys ORDER BY profile_id');
  assert.equal(rows.length, 2, 'dua survei benar-benar tersimpan');
  assert.deepEqual(rows.map((row) => row.profile_id), ['p_platform', 'p_platform']);
  assert.deepEqual(
    await sql('SELECT id FROM profiles'),
    [{ id: 'p_platform' }],
    'profil turunan idempoten: satu baris untuk sumber yang sama',
  );
});

test('KP-10: profil legacy bernama sama tetap dipakai tanpa menggandakan baris', async () => {
  await platformProfile();
  await createOrganization(true);
  await sql(
    `INSERT INTO profiles (id, organization_name, organization_type, respondent_age_category, consent_mode,
       policy_url, terms_url, notice_version)
     VALUES ('p_legacy', 'Yayasan Tanpa Seed', 'organization', 'adult', 'self', '/p', '/t', '1.0')`,
  );
  const cookie = await creatorSession(await organizationId());

  assert.equal((await createSurvey(cookie, { title: 'Satu', owner_scope: 'organization' })).status, 201);
  assert.equal((await createSurvey(cookie, { title: 'Dua', owner_scope: 'organization' })).status, 201);
  assert.deepEqual(
    await sql('SELECT profile_id FROM surveys ORDER BY profile_id'),
    [{ profile_id: 'p_legacy' }, { profile_id: 'p_legacy' }],
    'padanan profil legacy dipakai, bukan baris turunan',
  );
  assert.deepEqual(await sql('SELECT id FROM profiles'), [{ id: 'p_legacy' }]);
});

/**
 * Baris `profiles` turunan yang pernah ditulis kode lama memakai pola id yang sama (`p_org_<organization_id>`).
 * Survei baru tetap memakai sumber lingkup (`organizations`), dan baris lama dipertahankan apa adanya karena
 * `ON CONFLICT (id) DO NOTHING` — nilai profil efektif tidak dibaca dari sana.
 */
test('KP-10: baris profiles turunan lama untuk organisasi yang sama tidak ditimpa', async () => {
  await platformProfile();
  await createOrganization(true);
  const org = await organizationId();
  await sql(
    `INSERT INTO profiles (id, organization_name, organization_type, respondent_age_category, consent_mode,
       policy_url, terms_url, notice_version, synthetic_placeholder)
     VALUES ($1, 'Salinan lama', 'organization', 'adult', 'self', '/p', '/t', '1.0', 1)`,
    [`p_org_${org}`],
  );
  const cookie = await creatorSession(org);

  const created = await createSurvey(cookie, { title: 'Survei organisasi', owner_scope: 'organization' });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.deepEqual(await sql('SELECT profile_id FROM surveys'), [{ profile_id: `p_org_${org}` }]);
  assert.deepEqual(
    await sql('SELECT id, organization_name, policy_url FROM profiles'),
    [{ id: `p_org_${org}`, organization_name: 'Salinan lama', policy_url: '/p' }],
    'baris turunan lama dipertahankan, tidak ditimpa maupun digandakan',
  );
});

test('KP-10: profile_id eksplisit tidak valid tetap ditolak 409 dan tidak membuat survei', async () => {
  await platformProfile();
  const cookie = await creatorSession(null);

  const created = await createSurvey(cookie, { title: 'Survei profil asing', profile_id: 'p_tidak_ada' });
  assert.equal(created.status, 409, JSON.stringify(created.json));
  assert.equal(created.json.code, 'profile_missing');
  assert.deepEqual(await sql('SELECT id FROM surveys'), [], 'tidak ada survei yang terbuat dengan profil tidak valid');
  assert.deepEqual(await sql('SELECT id FROM profiles'), [], 'tidak ada profil turunan untuk pilihan eksplisit yang tidak ada');
});

test('KP-10: profile_id eksplisit valid tetap dipakai apa adanya', async () => {
  await platformProfile();
  await sql(
    `INSERT INTO profiles (id, organization_name, organization_type, respondent_age_category, consent_mode,
       policy_url, terms_url, notice_version)
     VALUES ('p_pilihan', 'Profil Pilihan', 'organization', 'adult', 'self', '/p', '/t', '1.0')`,
  );
  const cookie = await creatorSession(null);

  const created = await createSurvey(cookie, { title: 'Survei profil pilihan', profile_id: 'p_pilihan' });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.deepEqual(await sql('SELECT profile_id FROM surveys'), [{ profile_id: 'p_pilihan' }]);
});
