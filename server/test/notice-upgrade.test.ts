import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { closeTestDatabase, databaseUrl, resetTestDatabase } from './test-db.ts';
import { ApiError, adminCreateOrganization, type NewOrganizationInput } from '../../src/lib/api.ts';
import { app } from '../app.ts';
import { migrate, resetSchema } from '../migrate.ts';
import { seedDemoIfEmpty } from '../seed-data.ts';
import { hashPassword } from '../security.ts';

process.env.NODE_ENV = 'test';
process.env.SEED_DEMO = '1';
process.env.SEED_PASSWORD = 'SvaraDemo123!';

const MIGRATION_018 = '018_notice_survey_profile_backfill.sql';
const PASSWORD = 'SvaraDemo123!';

let server: Server;
let origin: string;

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

async function request(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${origin}/api/v1${path}`, {
    method,
    headers: { 'X-Svara-Client': 'web', 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as { code?: string; error?: string; details?: unknown; data?: unknown };
  return { status: response.status, json, headers: response.headers };
}

async function login(email: string): Promise<string> {
  const response = await request('/auth/login', 'POST', { email, password: PASSWORD });
  assert.equal(response.status, 200, `login ${email}: ${JSON.stringify(response.json)}`);
  return response.headers.get('set-cookie')!.split(';')[0]!;
}

async function sql<T extends Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return (await client.query<T>(text, params)).rows;
  } finally {
    await client.end();
  }
}

interface PublicIntro {
  state: string;
  consent_version: string;
  version: { notice_version: string };
  notice: { version: string; purpose: string; rights: string };
}

/** Pengantar publik lalu persetujuan, persis urutan yang dijalankan formulir responden. */
async function openAndConsent(token: string) {
  const intro = await request(`/public/surveys/${token}`);
  if (intro.status !== 200) return { intro, consent: undefined };
  const data = intro.json.data as PublicIntro;
  const consent = await request(`/public/surveys/${token}/consent`, 'POST', {
    version_id: data.consent_version,
    respondent_click: true,
    eligibility: true,
  });
  return { intro, consent };
}

/**
 * Data seperti deployment main (95eafa3) sebelum 010: notice publik dibaca dari surveys.profile_id
 * (versi persis, atau notice terbaru profil itu). Organisasi dibuat lewat POST /admin/organizations main
 * dengan nama yang tidak sama dengan profil legacy mana pun; survei baru main memakai profil default
 * deployment (p_smk, atau profil pertama menurut id) dan notice_version dari organisasi/platform.
 */
const MAIN = {
  orgPilot: 'org_5b2d0c1e9a7f4410',
  orgArsip: 'org_3e1f0a9b7c6d5524',
  orgBelum: 'org_9d4a6f2b1c8e7730',
  tokens: {
    org: 'pl_mOrgPilotXXXXXXX',
    platform: 'pl_mPlatformXXXXXXX',
    arsip: 'pl_mArsipXXXXXXXXXX',
  },
};

async function seedMainDeployment(): Promise<void> {
  const adminHash = await hashPassword(PASSWORD);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO platform_profile (id, organization_name, organization_type, policy_url, terms_url, retention_days,
         data_request_contact, cross_border_transfer, notice_version, updated_at)
       VALUES ('platform', 'Svara', 'platform', '/privacy', '/terms', NULL, 'privasi@svara.id', 0, '2.0', '2026-09-01T00:00:00.000Z')`,
    );
    // Skema berhenti di 009: kolom warisan persetujuan/usia masih NOT NULL (dibuang oleh 025).
    await client.query(`
      INSERT INTO profiles (id, organization_name, organization_type, respondent_age_category, consent_mode,
        policy_url, terms_url, retention_days, data_request_contact, cross_border_transfer, notice_version, synthetic_placeholder)
      VALUES ('p_lugina', 'SMK Lugina Rancaekek', 'school', 'minor', 'guardian', '/privacy', '/terms', 365,
              'privasi@lugina.sch.id', 0, '1.0', 0),
             ('p_warga_lama', 'Profil Warga Lama', 'organization', 'adult', 'self', '/privacy', '/terms', NULL, NULL, 0, '1.0', 0);
      INSERT INTO notices (id, profile_id, version, effective_date, purpose, data_categories, module15_usage,
        retention_text, recipients, contact, rights, child_data_text, cross_border_text, synthetic_placeholder)
      VALUES ('n_lugina_10', 'p_lugina', '1.0', '2026-08-01', 'Tujuan Lugina 1.0', 'Kategori Lugina 1.0', 'Modul 15 Lugina 1.0',
              'Retensi Lugina 1.0', 'Penerima Lugina 1.0', 'privasi@lugina.sch.id', 'Hak Lugina 1.0', 'Anak Lugina 1.0',
              'Lintas Lugina 1.0', 0),
             ('n_lugina_11', 'p_lugina', '1.1', '2026-10-01', 'Tujuan Lugina 1.1', 'Kategori Lugina 1.1', 'Modul 15 Lugina 1.1',
              'Retensi Lugina 1.1', 'Penerima Lugina 1.1', 'privasi@lugina.sch.id', 'Hak Lugina 1.1', 'Anak Lugina 1.1',
              'Lintas Lugina 1.1', 0);
    `);
    await client.query(
      `INSERT INTO organizations (id, name, organization_type, policy_url, terms_url, retention_days, data_request_contact,
         cross_border_transfer, notice_version, created_at)
       VALUES ($1, 'Yayasan Pilot Nyata', 'organization', '/kebijakan-privasi', '/ketentuan-layanan', NULL, NULL, NULL, '1.0',
               '2026-11-05T02:00:00.000Z'),
              ($2, 'Komunitas Arsip Warga', 'organization', '/kebijakan-privasi', '/ketentuan-layanan', NULL, NULL, NULL, '1.0',
               '2026-11-06T02:00:00.000Z'),
              ($3, 'Lembaga Belum Bersurvei', 'organization', '/kebijakan-privasi', '/ketentuan-layanan', NULL, NULL, NULL, '1.0',
               '2026-11-09T02:00:00.000Z')`,
      [MAIN.orgPilot, MAIN.orgArsip, MAIN.orgBelum],
    );
    await client.query(
      `INSERT INTO accounts (id, email, display_name, role, status, password_hash, created_at, organization_id)
       VALUES ('u_admin', 'admin@svara.local', 'Admin Platform', 'super_admin', 'active', $1, '2026-11-01T00:00:00.000Z', NULL),
              ('u_pilot', 'kreator@pilot.example.org', 'Kreator Pilot', 'creator', 'active', $1, '2026-11-05T03:00:00.000Z', $2),
              ('u_mandiri', 'mandiri@example.org', 'Kreator Mandiri', 'creator', 'active', $1, '2026-11-05T04:00:00.000Z', NULL),
              ('u_arsip', 'kreator@arsip.example.org', 'Kreator Arsip', 'creator', 'active', $1, '2026-11-06T03:00:00.000Z', $3),
              ('u_belum', 'kreator@belum.example.org', 'Kreator Belum', 'creator', 'active', $1, '2026-11-09T03:00:00.000Z', $4)`,
      [adminHash, MAIN.orgPilot, MAIN.orgArsip, MAIN.orgBelum],
    );
    const surveys: Array<[string, string, string, string | null, string, string]> = [
      ['s_main_org', 'u_pilot', 'p_lugina', MAIN.orgPilot, '1.0', MAIN.tokens.org],
      ['s_main_platform', 'u_mandiri', 'p_lugina', null, '2.0', MAIN.tokens.platform],
      ['s_main_arsip', 'u_arsip', 'p_warga_lama', MAIN.orgArsip, '1.0', MAIN.tokens.arsip],
    ];
    for (const [id, owner, profile, organization, noticeVersion, token] of surveys) {
      const version = `v_${id}_1`;
      await client.query(
        `INSERT INTO surveys (id, owner_id, profile_id, title, purpose, object_label, instructions, status, created_at,
           updated_at, current_version_id, organization_id)
         VALUES ($1, $2, $3, 'Survei pilot', 'Tujuan pilot', 'Objek', '', 'published', '2026-11-07T00:00:00.000Z',
                 '2026-11-07T00:00:00.000Z', NULL, $4)`,
        [id, owner, profile, organization],
      );
      await client.query('INSERT INTO survey_settings (survey_id, allow_results, allow_individual) VALUES ($1, 1, 0)', [id]);
      await client.query(
        `INSERT INTO survey_versions (id, survey_id, number, status, notice_version, published_at, closed_at)
         VALUES ($1, $2, 1, 'published', $3, '2026-11-07T01:00:00.000Z', NULL)`,
        [version, id, noticeVersion],
      );
      await client.query('UPDATE surveys SET current_version_id = $1 WHERE id = $2', [version, id]);
      await client.query(
        `INSERT INTO questions (id, version_id, code, ord, type, required, section, label, hint, group_code, dimension_code, direction)
         VALUES ($1, $2, 'Q1', 1, 'likert', 1, 'Bagian 1', 'Pertanyaan 1', NULL, NULL, NULL, NULL)`,
        [`q_${id}`, version],
      );
      await client.query(
        `INSERT INTO question_options (id, question_id, ord, label, value)
         VALUES ($1, $3, 1, 'Tidak', 1), ($2, $3, 2, 'Ya', 2)`,
        [`o_${id}_1`, `o_${id}_2`, `q_${id}`],
      );
      await client.query(
        // Penyiapan main (export helper, bukan uji upgrade) menulis kolom `token` yang masih ada di 009.
        `INSERT INTO public_links (id, survey_id, version_id, token, token_hash, label, status, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, 'Tautan umum · Survei pilot', 'active', NULL, '2026-11-07T01:00:00.000Z')`,
        [`pl_${id}`, id, version, token, createHash('sha256').update(token).digest('hex')],
      );
    }
    // Persetujuan era main mencatat notice_version versi survei (2.0) walau teks yang tampil adalah notice 1.1.
    await client.query(
      `INSERT INTO consent_records (id, survey_id, version_id, notice_version, basis, status, recorded_at, respondent_click,
         guardian_evidence_status, guardian_evidence_ref, invitation_id, response_id)
       VALUES ('c_main_platform', 's_main_platform', 'v_s_main_platform_1', '2.0', 'Persetujuan diri', 'granted',
               '2026-11-08T00:00:00.000Z', 1, 'not_required', NULL, NULL, NULL)`,
    );
  } finally {
    await client.end();
  }
}

test('(a) data buatan main yang namanya tidak cocok dengan profil legacy tetap terbuka publik setelah upgrade', async () => {
  await resetSchema();
  await migrate({ to: '009' });
  await seedMainDeployment();
  const applied = await migrate();

  const org = await openAndConsent(MAIN.tokens.org);
  assert.equal(org.intro.status, 200, `survei organisasi main: ${JSON.stringify(org.intro.json)}`);
  const orgIntro = org.intro.json.data as PublicIntro;
  assert.equal(orgIntro.state, 'active');
  // Versi persis 1.0 ada di profil survei: teks yang tampil di main.
  assert.equal(orgIntro.notice.version, '1.0');
  assert.equal(orgIntro.notice.purpose, 'Tujuan Lugina 1.0');
  assert.equal(org.consent?.status, 201, `consent survei organisasi: ${JSON.stringify(org.consent?.json)}`);

  const platform = await openAndConsent(MAIN.tokens.platform);
  assert.equal(platform.intro.status, 200, `survei platform main: ${JSON.stringify(platform.intro.json)}`);
  const platformIntro = platform.intro.json.data as PublicIntro;
  assert.equal(platformIntro.state, 'active');
  // Profil survei tidak punya 2.0; main menampilkan notice terbarunya (1.1) untuk versi survei 2.0.
  assert.equal(platformIntro.version.notice_version, '2.0');
  assert.equal(platformIntro.notice.version, '2.0');
  assert.equal(platformIntro.notice.purpose, 'Tujuan Lugina 1.1');
  assert.equal(platform.consent?.status, 201, `consent survei platform: ${JSON.stringify(platform.consent?.json)}`);

  // Profil tanpa notice sama sekali: tidak ada teks yang boleh dikarang, tetap gagal-tertutup.
  const arsip = await request(`/public/surveys/${MAIN.tokens.arsip}`);
  assert.equal(arsip.status, 500);
  assert.equal(arsip.json.code, 'notice_version_unavailable');

  assert.ok(applied.includes(MIGRATION_018), `migrasi yang diterapkan: ${applied.join(', ')}`);
  const sources = await sql<{ id: string }>(
    `SELECT 'organization:' || id AS id FROM organization_notice_sources
     UNION ALL SELECT 'platform:' || id FROM platform_notice_sources ORDER BY 1`,
  );
  assert.deepEqual(sources.map((row) => row.id), [
    'organization:legacy',
    'organization:platform',
    'organization:survey_profile',
    'platform:platform',
    'platform:survey_profile',
  ]);
});

test('(a) organisasi main yang belum punya survei dapat membuka survei pertamanya setelah upgrade', async () => {
  const token = await publishOrganizationSurvey(await login('kreator@belum.example.org'));
  const opened = await openAndConsent(token);
  assert.equal(opened.intro.status, 200, `survei pertama organisasi main: ${JSON.stringify(opened.intro.json)}`);
  const intro = opened.intro.json.data as PublicIntro;
  assert.equal(intro.state, 'active');
  // Survei baru main tanpa profile_id memakai profil pertama menurut id (tidak ada p_smk): p_lugina, versi persis 1.0.
  assert.equal(intro.notice.version, '1.0');
  assert.equal(intro.notice.purpose, 'Tujuan Lugina 1.0');
  assert.equal(opened.consent?.status, 201, JSON.stringify(opened.consent?.json));
});

test('(b) 018 dijalankan ulang tetap satu baris per notice dan tidak menimpa notice yang disesuaikan', async () => {
  await sql(
    "UPDATE organization_notices SET rights = 'Hak disesuaikan pengelola' WHERE organization_id = $1 AND version = '1.0'",
    [MAIN.orgPilot],
  );
  const snapshot = async () => ({
    organization: await sql<{ organization_id: string; version: string; rows: number; rights: string }>(
      `SELECT organization_id, version, COUNT(*)::int AS rows, MAX(rights) AS rights
         FROM organization_notices GROUP BY organization_id, version ORDER BY 1, 2`,
    ),
    platform: await sql<{ version: string; rows: number; purpose: string }>(
      'SELECT version, COUNT(*)::int AS rows, MAX(purpose) AS purpose FROM platform_notices GROUP BY version ORDER BY 1',
    ),
    sources: await sql<{ rows: number }>(
      'SELECT (SELECT COUNT(*) FROM organization_notice_sources) + (SELECT COUNT(*) FROM platform_notice_sources) AS rows',
    ),
  });
  const before = await snapshot();
  assert.deepEqual(before.organization, [
    { organization_id: MAIN.orgPilot, version: '1.0', rows: 1, rights: 'Hak disesuaikan pengelola' },
    { organization_id: MAIN.orgBelum, version: '1.0', rows: 1, rights: 'Hak Lugina 1.0' },
  ]);
  assert.deepEqual(before.platform, [{ version: '2.0', rows: 1, purpose: 'Tujuan Lugina 1.1' }]);

  assert.deepEqual(await migrate(), [], 'migrasi kedua tidak menerapkan ulang 018');
  await sql('DELETE FROM schema_migrations WHERE version = $1', [MIGRATION_018]);
  assert.deepEqual(await migrate(), [MIGRATION_018], 'menerapkan ulang 018');
  assert.deepEqual(await snapshot(), before, 'baris tidak berlipat dan isi yang disesuaikan tidak ditimpa');
});

/** Panggil klien UI (src/lib/api.ts) apa adanya; fetch relatif diarahkan ke server uji dengan cookie sesi. */
async function asBrowser<T>(cookie: string, action: () => Promise<T>): Promise<{ result: T; sent: unknown }> {
  const original = globalThis.fetch;
  let sent: unknown;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set('Cookie', cookie);
    if (typeof init?.body === 'string') sent = JSON.parse(init.body);
    return original(new URL(String(input), origin), { ...init, headers });
  }) as typeof fetch;
  try {
    return { result: await action(), sent };
  } finally {
    globalThis.fetch = original;
  }
}

/** Body persis seperti yang disusun formulir organisasi di src/screens/Admin.tsx. */
function uiOrganizationInput(name: string, email: string): NewOrganizationInput {
  return {
    name,
    organization_type: 'organization',
    admin: { display_name: 'Admin Organisasi Baru', email, password: 'PilotNyata123!x' },
  };
}

async function createOrganizationFromUi(admin: string, input: NewOrganizationInput) {
  try {
    return await asBrowser(admin, () => adminCreateOrganization(input));
  } catch (error) {
    if (error instanceof ApiError) assert.fail(`POST /admin/organizations dari UI: ${error.status} ${error.code}: ${error.message}`);
    throw error;
  }
}

test('(c) onboarding dari UI di deployment hasil upgrade main memakai notice platform yang berlaku', async () => {
  const admin = await login('admin@svara.local');
  const input = uiOrganizationInput('Yayasan Kedua', 'admin.kedua@example.org');
  const { result, sent } = await createOrganizationFromUi(admin, input);
  assert.deepEqual(sent, input, 'body yang dikirim klien UI');
  assert.equal(result.organization.name, 'Yayasan Kedua');
  assert.equal(result.account.display_name, 'Admin Organisasi Baru');

  const notices = await sql<{ version: string; purpose: string }>(
    'SELECT version, purpose FROM organization_notices WHERE organization_id = $1',
    [result.organization.id],
  );
  // platform_profile.notice_version deployment ini 2.0; notice platform 2.0 berasal dari 018.
  assert.deepEqual(notices, [{ version: '2.0', purpose: 'Tujuan Lugina 1.1' }]);
});

async function publishOrganizationSurvey(creator: string): Promise<string> {
  const created = await request('/surveys', 'POST', { title: 'Survei organisasi baru', owner_scope: 'organization' }, { Cookie: creator });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const id = (created.json.data as { survey: { id: string } }).survey.id;
  const saved = await request(`/surveys/${id}`, 'PUT', {
    title: 'Survei organisasi baru',
    purpose: 'Menguji notice organisasi yang baru dibuat.',
    object_label: 'Peserta',
    instructions: '',
    questions: [{
      code: 'Q1', type: 'likert', required: true, section: 'Bagian 1', label: 'Pertanyaan 1', hint: null,
      group_code: null, dimension_code: null, direction: null, options: [{ label: 'Tidak', value: 1 }, { label: 'Ya', value: 2 }],
    }],
  }, { Cookie: creator });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  const published = await request(`/surveys/${id}/publish`, 'POST', undefined, { Cookie: creator });
  assert.equal(published.status, 200, JSON.stringify(published.json));
  return (published.json.data as { publicLink: { token: string } }).publicLink.token;
}

test('(c) POST /admin/organizations dengan body UI pada seed baru: 201, punya notice, survei barunya terbuka publik', async () => {
  await resetTestDatabase();
  await seedDemoIfEmpty();
  const admin = await login('admin@svara.local');
  const input = uiOrganizationInput('Yayasan Baru Sejahtera', 'admin.baru@example.org');
  const { result, sent } = await createOrganizationFromUi(admin, input);
  assert.deepEqual(sent, input, 'body yang dikirim klien UI');
  assert.equal(result.organization.name, 'Yayasan Baru Sejahtera');
  assert.equal(result.account.display_name, 'Admin Organisasi Baru');

  const organization = (await sql<{ notice_version: string }>('SELECT notice_version FROM organizations WHERE id = $1', [
    result.organization.id,
  ]))[0]!;
  const [platformNotice] = await sql<{ version: string; purpose: string; rights: string }>(
    `SELECT pn.version, pn.purpose, pn.rights FROM platform_notices pn
       JOIN platform_profile pp ON pp.notice_version = pn.version`,
  );
  assert.ok(platformNotice, 'seed menyediakan notice platform yang berlaku');
  assert.equal(organization.notice_version, platformNotice.version);
  const notices = await sql<{ version: string; purpose: string; rights: string }>(
    'SELECT version, purpose, rights FROM organization_notices WHERE organization_id = $1',
    [result.organization.id],
  );
  assert.deepEqual(notices, [platformNotice], 'notice awal = salinan notice platform versi organisasi');
  const audit = await sql<{ metadata: string }>(
    "SELECT metadata FROM audit_logs WHERE action = 'Buat organisasi' AND object = $1",
    [result.organization.id],
  );
  assert.equal((JSON.parse(audit[0]!.metadata) as { notice_source?: string }).notice_source, 'platform');

  const linked = await request('/admin/accounts/u_creator_b', 'PATCH', { organization_id: result.organization.id }, { Cookie: admin });
  assert.equal(linked.status, 200, JSON.stringify(linked.json));
  const token = await publishOrganizationSurvey(await login('creator.b@svara.local'));
  const opened = await openAndConsent(token);
  assert.equal(opened.intro.status, 200, `survei organisasi baru: ${JSON.stringify(opened.intro.json)}`);
  const intro = opened.intro.json.data as PublicIntro;
  assert.equal(intro.state, 'active');
  assert.equal(intro.notice.version, platformNotice.version);
  assert.equal(intro.notice.purpose, platformNotice.purpose);
  assert.equal(opened.consent?.status, 201, JSON.stringify(opened.consent?.json));
});

test('galat notice onboarding memakai ApiError: versi tanpa notice platform 422 tanpa sisa, katalog hilang bukan 500 generik', async () => {
  const admin = await login('admin@svara.local');
  const body = { ...uiOrganizationInput('Yayasan Versi Asing', 'admin.asing@example.org'), notice_version: '9.9' };
  const missing = await request('/admin/organizations', 'POST', body, { Cookie: admin });
  assert.equal(missing.status, 422, JSON.stringify(missing.json));
  assert.equal(missing.json.code, 'notice_version_unavailable');
  assert.match(missing.json.error ?? '', /platform.*9\.9/);
  assert.deepEqual(await sql('SELECT id FROM organizations WHERE name = $1', [body.name]), [], 'organisasi tidak tersisa');
  assert.deepEqual(await sql('SELECT id FROM accounts WHERE email = $1', [body.admin.email]), [], 'admin tidak tersisa');

  const catalog = await sql<{ select_sql: string; created_at: string }>(
    "SELECT select_sql, created_at FROM organization_notice_sources WHERE id = 'platform'",
  );
  assert.equal(catalog.length, 1);
  await sql("DELETE FROM organization_notice_sources WHERE id = 'platform'");
  try {
    const broken = await request('/admin/organizations', 'POST', uiOrganizationInput('Yayasan Tanpa Katalog', 'admin.katalog@example.org'), {
      Cookie: admin,
    });
    assert.equal(broken.status, 500);
    assert.equal(broken.json.code, 'notice_catalog_missing');
  } finally {
    await sql("INSERT INTO organization_notice_sources (id, select_sql, created_at) VALUES ('platform', $1, $2)", [
      catalog[0]!.select_sql,
      catalog[0]!.created_at,
    ]);
  }
});

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BOOTSTRAP_SCRIPT = fileURLToPath(new URL('../scripts/bootstrap-admin.ts', import.meta.url));

/** `pnpm admin:bootstrap` apa adanya (tsx server/scripts/bootstrap-admin.ts) pada basis data uji. */
function runAdminBootstrap(email: string) {
  return spawnSync(process.execPath, ['--import', 'tsx', BOOTSTRAP_SCRIPT], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      BOOTSTRAP_ADMIN_EMAIL: email,
      BOOTSTRAP_ADMIN_NAME: 'Pengelola Utama',
      BOOTSTRAP_ADMIN_PASSWORD: PASSWORD,
    },
    encoding: 'utf8',
    timeout: 60_000,
  });
}

const NOTICE_TEXT_COLUMNS = [
  'purpose', 'data_categories', 'module15_usage', 'retention_text', 'recipients', 'contact', 'rights',
  'child_data_text', 'cross_border_text',
] as const;

test('instalasi tanpa seed sebelum bootstrap: galat onboarding menyebut organisasi dan notice platform, bukan survei', async () => {
  await resetTestDatabase();
  await sql(
    `INSERT INTO accounts (id, email, display_name, role, status, password_hash, created_at)
     VALUES ('u_root', 'root@yayasan.example.org', 'Root', 'super_admin', 'active', $1, '2026-11-22T00:00:00.000Z')`,
    [await hashPassword(PASSWORD)],
  );
  const admin = await login('root@yayasan.example.org');
  const body = uiOrganizationInput('Yayasan Tanpa Profil', 'admin.tanpa.profil@example.org');
  const response = await request('/admin/organizations', 'POST', body, { Cookie: admin });
  assert.equal(response.status, 409, JSON.stringify(response.json));
  assert.equal(response.json.code, 'notice_source_missing');
  assert.doesNotMatch(response.json.error ?? '', /survei/i, `pesan: ${response.json.error}`);
  assert.match(response.json.error ?? '', /organisasi/i);
  assert.match(response.json.error ?? '', /profil platform/i);
  assert.match(response.json.error ?? '', /pnpm admin:bootstrap/);
  assert.deepEqual(await sql('SELECT id FROM organizations'), [], 'organisasi tidak tersisa');

  // Instalasi yang super_admin-nya dibuat bootstrap versi lama: bootstrap ulang tetap mengisi profil platform.
  const accounts = await sql('SELECT * FROM accounts ORDER BY id');
  const rerun = runAdminBootstrap('root@yayasan.example.org');
  assert.equal(rerun.status, 0, `admin:bootstrap: ${rerun.stderr}`);
  assert.match(rerun.stdout, /profil platform awal dibuat/);
  assert.match(rerun.stdout, /akun tidak diubah/);
  assert.deepEqual(await sql('SELECT * FROM accounts ORDER BY id'), accounts, 'akun super_admin tidak diubah');
  const { result } = await createOrganizationFromUi(admin, body);
  assert.equal(result.organization.name, 'Yayasan Tanpa Profil');
});

test('instalasi tanpa seed: pnpm admin:bootstrap menyiapkan profil + notice platform templat, lalu onboarding dari UI 201', async () => {
  await resetTestDatabase();
  const bootstrap = runAdminBootstrap('root@yayasan.example.org');
  assert.equal(bootstrap.status, 0, `admin:bootstrap: ${bootstrap.stderr}`);

  const admin = await login('root@yayasan.example.org');
  const input = uiOrganizationInput('Yayasan Pertama Mandiri', 'admin.pertama@example.org');
  const { result, sent } = await createOrganizationFromUi(admin, input);
  assert.deepEqual(sent, input, 'body yang dikirim klien UI');
  assert.equal(result.organization.name, 'Yayasan Pertama Mandiri');
  assert.equal(result.account.display_name, 'Admin Organisasi Baru');
  assert.equal(result.account.role, 'org_admin');

  const [platformNotice] = await sql<Record<string, string>>(
    `SELECT pn.version, ${NOTICE_TEXT_COLUMNS.map((column) => `pn.${column}`).join(', ')}
       FROM platform_notices pn JOIN platform_profile pp ON pp.notice_version = pn.version`,
  );
  assert.ok(platformNotice, 'bootstrap membuat notice platform untuk platform_profile.notice_version');
  for (const column of NOTICE_TEXT_COLUMNS) {
    const text = platformNotice[column]!;
    assert.match(text, /^\[Templat awal: wajib ditinjau pengelola platform; bukan teks hukum final\]/, `${column}: ${text}`);
    assert.doesNotMatch(text, /wali|orang tua|anak/i, `${column} tidak berteks wali/anak: ${text}`);
  }
  assert.deepEqual(
    await sql('SELECT notice_version FROM organizations WHERE id = $1', [result.organization.id]),
    [{ notice_version: platformNotice.version }],
  );
  const organizationNotices = await sql<Record<string, string>>(
    `SELECT version, ${NOTICE_TEXT_COLUMNS.join(', ')} FROM organization_notices WHERE organization_id = $1`,
    [result.organization.id],
  );
  assert.deepEqual(organizationNotices, [platformNotice], 'notice awal organisasi = salinan notice platform templat');

  // Halaman /admin/platform membaca dan menyimpan profil yang dibuat bootstrap.
  const profile = await request('/admin/platform-profile', 'GET', undefined, { Cookie: admin });
  assert.equal(profile.status, 200, JSON.stringify(profile.json));
  assert.equal((profile.json.data as { profile: { organization_type: string } }).profile.organization_type, 'platform');
  const audit = await sql<{ action: string; actor: string }>(
    "SELECT action, actor FROM audit_logs WHERE action IN ('Bootstrap profil platform', 'Bootstrap admin') ORDER BY action",
  );
  assert.deepEqual(audit, [
    { action: 'Bootstrap admin', actor: 'system' },
    { action: 'Bootstrap profil platform', actor: 'system' },
  ]);
});

test('pnpm admin:bootstrap diulang tidak menimpa profil atau notice platform yang sudah ditinjau pengelola', async () => {
  await sql("UPDATE platform_notices SET purpose = 'Tujuan yang sudah ditinjau pengelola'");
  await sql("UPDATE platform_profile SET organization_name = 'Yayasan Pengelola Platform'");
  const snapshot = async () => ({
    profile: await sql('SELECT * FROM platform_profile'),
    notices: await sql('SELECT * FROM platform_notices ORDER BY version'),
    accounts: await sql('SELECT id, email, role FROM accounts ORDER BY id'),
  });
  const before = await snapshot();
  const again = runAdminBootstrap('root@yayasan.example.org');
  assert.equal(again.status, 0, `admin:bootstrap ulang: ${again.stderr}`);
  assert.deepEqual(await snapshot(), before);
  assert.equal(
    (await sql<{ count: number }>("SELECT COUNT(*)::int AS count FROM audit_logs WHERE action = 'Bootstrap profil platform'"))[0]!.count,
    1,
  );
});
