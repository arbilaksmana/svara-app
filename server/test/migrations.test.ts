import { after, before, test } from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { closeTestDatabase, databaseUrl, indexExists, resetTestDatabase, tableCount } from './test-db.ts';

async function appliedVersions(): Promise<string[]> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version');
    return result.rows.map((row) => row.version);
  } finally {
    await client.end();
  }
}

before(async () => {
  await resetTestDatabase();
});

after(async () => {
  await closeTestDatabase();
});

const VERSIONS = [
  '001_initial.sql',
  '002_operational_indexes.sql',
  '003_public_link_uniqueness.sql',
  '004_account_consent.sql',
  '005_organizations.sql',
  '006_organization_profile.sql',
  '007_organization_invitations.sql',
  '008_organization_invitation_lifecycle.sql',
  '009_organization_invitation_expiry_backfill.sql',
  '010_consent_notice_source.sql',
  '011_integration_token_scope.sql',
  '012_consent_context_binding.sql',
  '013_consent_notice_backfill.sql',
  '014_public_link_close_reason.sql',
];

test('migrasi membuat 28 tabel aplikasi dan mencatat versi', async () => {
  assert.equal(await tableCount(), 28);
  const versions = await appliedVersions();
  assert.deepEqual(versions, VERSIONS);
});

test('migrasi kedua idempoten dan tidak menerapkan ulang', async () => {
  const { migrate } = await import('../migrate.ts');
  const applied = await migrate();
  assert.deepEqual(applied, []);
  assert.equal(await tableCount(), 28);
  assert.deepEqual(await appliedVersions(), VERSIONS);
});

test('upgrade path 001 → terbaru mempertahankan data dan menambah indeks operasional', async () => {
  const { migrate, resetSchema } = await import('../migrate.ts');
  await resetSchema();
  assert.deepEqual(await migrate({ to: '001' }), ['001_initial.sql']);
  assert.equal(await indexExists('ix_sessions_expires'), false, 'indeks 002 belum ada');

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      "INSERT INTO accounts (id, email, display_name, role, status, password_hash, created_at) VALUES ('u_upgrade', 'upgrade@example.org', 'Upgrade', 'creator', 'active', 'scrypt$x$y', '2026-11-01T00:00:00Z')",
    );
  } finally {
    await client.end();
  }

  assert.deepEqual(await migrate(), [
    ...VERSIONS.slice(1),
  ]);
  assert.equal(await indexExists('ix_sessions_expires'), true);
  assert.equal(await indexExists('ix_audit_actor_at'), true);
  assert.equal(await indexExists('ux_public_links_survey_version'), true);

  const verify = new Client({ connectionString: databaseUrl });
  await verify.connect();
  try {
    const row = await verify.query<{ email: string; consent_version: string | null; consent_accepted_at: string | null }>(
      'SELECT email, consent_version, consent_accepted_at FROM accounts WHERE id = $1',
      ['u_upgrade'],
    );
    assert.equal(row.rows[0]?.email, 'upgrade@example.org', 'data lama tetap ada setelah upgrade');
    assert.equal(row.rows[0]?.consent_version, null, 'akun lama tidak memiliki bukti persetujuan versi baru');
    assert.equal(row.rows[0]?.consent_accepted_at, null);

    const tenancy = await verify.query<{ organization_id: string | null }>(
      'SELECT organization_id FROM accounts WHERE id = $1',
      ['u_upgrade'],
    );
    assert.equal(tenancy.rows[0]?.organization_id, null, 'akun lama tetap valid tanpa organisasi');
  } finally {
    await verify.end();
  }
});

test('upgrade 008 → 009 mengisi expires_at lama dengan created_at + 14 hari lalu mewajibkannya', async () => {
  const { migrate, resetSchema } = await import('../migrate.ts');
  await resetSchema();
  await migrate({ to: '008' });

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      "INSERT INTO accounts (id, email, display_name, role, status, password_hash, created_at) VALUES ('u_exp', 'exp@example.org', 'Exp', 'org_admin', 'active', 'scrypt$x$y', '2026-11-01T00:00:00.000Z')",
    );
    await client.query(
      "INSERT INTO organizations (id, name, organization_type, policy_url, terms_url, created_at) VALUES ('org_exp', 'Org', 'Sekolah', '/p', '/t', '2026-11-01T00:00:00.000Z')",
    );
    await client.query(
      `INSERT INTO organization_invitations (id, organization_id, code, created_by, created_at, expires_at)
       VALUES ('oi_legacy_null', 'org_exp', 'ORG-LAMA-TANPA-BATAS', 'u_exp', '2026-11-01T00:00:00.000Z', NULL),
              ('oi_legacy_set', 'org_exp', 'ORG-LAMA-PUNYA-BATAS', 'u_exp', '2026-11-01T00:00:00.000Z', '2026-11-05T00:00:00.000Z')`,
    );
  } finally {
    await client.end();
  }

  assert.deepEqual(await migrate(), VERSIONS.slice(8));

  const verify = new Client({ connectionString: databaseUrl });
  await verify.connect();
  try {
    const rows = await verify.query<{ id: string; expires_at: string }>(
      'SELECT id, expires_at FROM organization_invitations ORDER BY id',
    );
    assert.deepEqual(rows.rows, [
      { id: 'oi_legacy_null', expires_at: '2026-11-15T00:00:00.000Z' },
      { id: 'oi_legacy_set', expires_at: '2026-11-05T00:00:00.000Z' },
    ]);
    await assert.rejects(
      verify.query(
        `INSERT INTO organization_invitations (id, organization_id, code, created_by, created_at)
         VALUES ('oi_new_null', 'org_exp', 'ORG-BARU-TANPA-BATAS', 'u_exp', '2026-11-01T00:00:00.000Z')`,
      ),
      (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === '23502',
      'expires_at NOT NULL menolak undangan tanpa masa berlaku',
    );
  } finally {
    await verify.end();
  }
});

test('foreign key dan unique constraint ditegakkan Postgres', async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await assert.rejects(
      client.query(
        "INSERT INTO surveys (id, owner_id, profile_id, title, purpose, object_label, instructions, status, created_at, updated_at) VALUES ('s_bad', 'u_missing', 'p_missing', 'x', '', '', '', 'draft', 'now', 'now')",
      ),
      (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === '23503',
    );
    await client.query(
      "INSERT INTO accounts (id, email, display_name, role, status, password_hash, created_at) VALUES ('u_dup', 'dup@example.org', 'Dup', 'creator', 'active', 'scrypt$x$y', '2026-11-01T00:00:00Z')",
    );
    await assert.rejects(
      client.query(
        "INSERT INTO accounts (id, email, display_name, role, status, password_hash, created_at) VALUES ('u_dup2', 'dup@example.org', 'Dup 2', 'creator', 'active', 'scrypt$x$y', '2026-11-01T00:00:00Z')",
      ),
      (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === '23505',
    );

    await client.query(
      "INSERT INTO profiles (id, organization_name, organization_type, respondent_age_category, consent_mode, policy_url, terms_url, retention_days, data_request_contact, cross_border_transfer, notice_version, synthetic_placeholder) VALUES ('p_pub', 'Org', 'Sekolah', '13-17', 'respondent', '/p', '/t', 30, 'x', 0, 'v1', 1)",
    );
    await client.query(
      "INSERT INTO surveys (id, owner_id, profile_id, title, purpose, object_label, instructions, status, created_at, updated_at) VALUES ('s_pub', 'u_dup', 'p_pub', 'x', '', '', '', 'draft', 'now', 'now')",
    );
    await client.query(
      "INSERT INTO survey_versions (id, survey_id, number, status, notice_version) VALUES ('v_pub', 's_pub', 1, 'draft', 'v1')",
    );
    await client.query(
      "INSERT INTO public_links (id, survey_id, version_id, token, token_hash, label, status, expires_at, created_at) VALUES ('pl_pub1', 's_pub', 'v_pub', 'tok1', 'hash1', 'L', 'active', NULL, 'now')",
    );
    await assert.rejects(
      client.query(
        "INSERT INTO public_links (id, survey_id, version_id, token, token_hash, label, status, expires_at, created_at) VALUES ('pl_pub2', 's_pub', 'v_pub', 'tok2', 'hash2', 'L', 'active', NULL, 'now')",
      ),
      (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === '23505',
    );
  } finally {
    await client.end();
  }
});

/** Organisasi + survei terbit + tautan publik pada skema saat ini, pola data produksi tanpa seed demo. */
async function seedUpgradedDeployment(): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`
      INSERT INTO profiles (id, organization_name, organization_type, respondent_age_category, consent_mode,
        policy_url, terms_url, retention_days, data_request_contact, cross_border_transfer, notice_version, synthetic_placeholder)
      VALUES ('p_deploy', 'Yayasan Nyata', 'organization', 'adult', 'self', '/p', '/t', 30, 'privasi@nyata.id', 0, '1.0', 0),
             ('p_platform', 'Svara', 'platform', 'adult', 'self', '/p', '/t', NULL, 'privasi@svara.id', 0, '2.0', 0);
      INSERT INTO notices (id, profile_id, version, effective_date, purpose, data_categories, module15_usage,
        retention_text, recipients, contact, rights, child_data_text, cross_border_text, synthetic_placeholder)
      VALUES ('n_deploy', 'p_deploy', '1.0', '2026-01-05', 'Tujuan nyata', 'Kat nyata', 'Mod nyata', 'Retensi nyata',
              'Penerima nyata', 'privasi@nyata.id', 'Hak nyata', 'Anak nyata', 'Lintas nyata', 0),
             ('n_platform', 'p_platform', '2.0', '2026-02-01', 'Tujuan platform', 'Kat platform', 'Mod platform',
              'Retensi platform', 'Penerima platform', 'privasi@svara.id', 'Hak platform', 'Anak platform',
              'Lintas platform', 0);
      INSERT INTO accounts (id, email, display_name, role, status, password_hash, created_at)
      VALUES ('u_real', 'real@nyata.id', 'Real', 'org_admin', 'active', 'scrypt$x$y', '2026-11-01T00:00:00Z');
      INSERT INTO organizations (id, name, organization_type, policy_url, terms_url, data_request_contact,
        cross_border_transfer, notice_version, created_at)
      VALUES ('org_real', 'Yayasan Nyata', 'organization', '/p', '/t', 'privasi@nyata.id', 0, '1.0', '2026-11-01T00:00:00Z');
      INSERT INTO platform_profile (id, organization_name, organization_type, policy_url, terms_url, data_request_contact,
        cross_border_transfer, notice_version, updated_at)
      VALUES ('platform', 'Svara', 'platform', '/p', '/t', 'privasi@svara.id', 0, '2.0', '2026-11-01T00:00:00Z');
      INSERT INTO surveys (id, owner_id, profile_id, organization_id, title, purpose, object_label, instructions,
        status, created_at, updated_at)
      VALUES ('s_real', 'u_real', 'p_deploy', 'org_real', 'Survei nyata', 'Tujuan', 'Objek', 'Instruksi',
              'published', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z');
      INSERT INTO survey_versions (id, survey_id, number, status, notice_version, published_at)
      VALUES ('v_real', 's_real', 1, 'published', '1.0', '2026-11-01T00:00:00Z');
      UPDATE surveys SET current_version_id = 'v_real' WHERE id = 's_real';
    `);
    await client.query(
      `INSERT INTO public_links (id, survey_id, version_id, token, token_hash, label, status, expires_at, created_at)
       VALUES ('pl_real', 's_real', 'v_real', 'token-nyata', $1, 'Umum', 'active', NULL, '2026-11-01T00:00:00Z')`,
      [createHash('sha256').update('token-nyata').digest('hex')],
    );
  } finally {
    await client.end();
  }
}

interface NoticeColumns {
  version: string;
  effective_date: string;
  purpose: string;
  data_categories: string;
  module15_usage: string;
  retention_text: string;
  recipients: string;
  contact: string;
  rights: string;
  child_data_text: string;
  cross_border_text: string;
}

const NOTICE_FIELDS = [
  'version', 'effective_date', 'purpose', 'data_categories', 'module15_usage', 'retention_text', 'recipients',
  'contact', 'rights', 'child_data_text', 'cross_border_text',
] as const;

function noticeValues(row: NoticeColumns): string[] {
  return NOTICE_FIELDS.map((field) => row[field]);
}

const LEGACY_DEPLOY_NOTICE = [
  '1.0', '2026-01-05', 'Tujuan nyata', 'Kat nyata', 'Mod nyata', 'Retensi nyata', 'Penerima nyata',
  'privasi@nyata.id', 'Hak nyata', 'Anak nyata', 'Lintas nyata',
];

test('upgrade 010 → 013 mengisi notice lingkup organisasi dan platform dari notice legacy', async () => {
  const { migrate, resetSchema } = await import('../migrate.ts');
  await resetSchema();
  await migrate({ to: '010' });
  await seedUpgradedDeployment();

  assert.deepEqual(await migrate(), VERSIONS.slice(10));

  const after = new Client({ connectionString: databaseUrl });
  await after.connect();
  try {
    const orgRows = await after.query<NoticeColumns>(
      `SELECT ${NOTICE_FIELDS.join(', ')} FROM organization_notices WHERE organization_id = 'org_real'`,
    );
    assert.deepEqual(orgRows.rows.map(noticeValues), [LEGACY_DEPLOY_NOTICE], 'notice organisasi = notice legacy yang tadinya tampil');
    const platformRows = await after.query<NoticeColumns & { id: string }>(
      `SELECT id, ${NOTICE_FIELDS.join(', ')} FROM platform_notices`,
    );
    assert.deepEqual(platformRows.rows.map((row) => row.id), ['pn_2_0']);
    assert.deepEqual(platformRows.rows.map(noticeValues), [[
      '2.0', '2026-02-01', 'Tujuan platform', 'Kat platform', 'Mod platform', 'Retensi platform',
      'Penerima platform', 'privasi@svara.id', 'Hak platform', 'Anak platform', 'Lintas platform',
    ]]);
  } finally {
    await after.end();
  }
});

test('013 idempoten dan tidak menimpa notice yang disesuaikan pengelola', async () => {
  const { migrate } = await import('../migrate.ts');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("UPDATE organization_notices SET rights = 'Hak disesuaikan' WHERE organization_id = 'org_real'");
    const before = await client.query<{ c: number }>('SELECT COUNT(*)::int AS c FROM organization_notices');
    assert.deepEqual(await migrate(), []);
    await client.query('BEGIN');
    try {
      await client.query("DELETE FROM schema_migrations WHERE version = '013_consent_notice_backfill.sql'");
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    assert.deepEqual(await migrate(), ['013_consent_notice_backfill.sql'], 'menerapkan ulang 013');
    const rows = await client.query<{ rights: string }>('SELECT rights FROM organization_notices ORDER BY id');
    assert.deepEqual(rows.rows, [{ rights: 'Hak disesuaikan' }], 'baris tidak berlipat dan isi tidak ditimpa');
    assert.equal((await client.query<{ c: number }>('SELECT COUNT(*)::int AS c FROM organization_notices')).rows[0]?.c, before.rows[0]?.c);
    assert.equal((await client.query<{ c: number }>('SELECT COUNT(*)::int AS c FROM platform_notices')).rows[0]?.c, 1);
  } finally {
    await client.end();
  }
});

test('organisasi baru setelah migrasi mendapat notice dari jalur provisioning yang sama', async () => {
  const { migrate } = await import('../migrate.ts');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`
      INSERT INTO organizations (id, name, organization_type, policy_url, terms_url, data_request_contact,
        cross_border_transfer, notice_version, created_at)
      VALUES ('org_kedua', 'Yayasan Nyata', 'organization', '/p', '/t', 'privasi@nyata.id', 0, '1.0', '2026-11-22T00:00:00Z');
      INSERT INTO surveys (id, owner_id, profile_id, organization_id, title, purpose, object_label, instructions,
        status, created_at, updated_at)
      VALUES ('s_kedua', 'u_real', 'p_deploy', 'org_kedua', 'Survei kedua', 'Tujuan', 'Objek', 'Instruksi',
              'published', '2026-11-22T00:00:00Z', '2026-11-22T00:00:00Z');
      INSERT INTO survey_versions (id, survey_id, number, status, notice_version, published_at)
      VALUES ('v_kedua', 's_kedua', 1, 'published', '1.0', '2026-11-22T00:00:00Z');
    `);
    await client.query("DELETE FROM schema_migrations WHERE version = '013_consent_notice_backfill.sql'");
    assert.deepEqual(await migrate(), ['013_consent_notice_backfill.sql']);
    const notices = await client.query<{ organization_id: string; version: string; rights: string }>(
      'SELECT organization_id, version, rights FROM organization_notices ORDER BY organization_id',
    );
    assert.deepEqual(notices.rows, [
      { organization_id: 'org_kedua', version: '1.0', rights: 'Hak nyata' },
      { organization_id: 'org_real', version: '1.0', rights: 'Hak disesuaikan' },
    ]);
  } finally {
    await client.end();
  }
});
