import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { Client } from 'pg';
import { seedDemoIfEmpty } from '../seed-data.ts';
import { closeTestDatabase, databaseUrl, resetTestDatabase } from './test-db.ts';

/** Wave 6 / w6-secbiz: SEC-09, SEC-10, SEC-14, SEC-15, SEC-16, BR-04, BR-06, BR-10, BR-11, BF-10. */

const PORT = 3198;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const EVIDENCE_DIR = fileURLToPath(new URL('.tmp-secbiz-evidence', import.meta.url));
const PASSWORD = 'SvaraDemo123!';

let server: ChildProcess | undefined;
let stopping = false;

interface Result {
  status: number;
  json: Record<string, unknown> | null;
  text: string;
  headers: Headers;
}

async function call(
  path: string,
  options: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string>; idempotencyKey?: string } = {},
): Promise<Result> {
  const headers = new Headers({ 'X-Svara-Client': 'web', Accept: 'application/json' });
  if (options.cookie) headers.set('Cookie', options.cookie);
  if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey);
  for (const [key, value] of Object.entries(options.headers ?? {})) headers.set(key, value);
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
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

function data<T = Record<string, unknown>>(result: Result): T {
  assert.equal(result.status < 400, true, result.text);
  return (result.json as { data: T }).data;
}

function code(result: Result): string {
  const value = result.json && typeof result.json.code === 'string' ? result.json.code : '';
  assert.ok(value, `respons tanpa kode galat: ${result.text}`);
  return value;
}

const sessions = new Map<string, Promise<string>>();

function session(email: string): Promise<string> {
  let cached = sessions.get(email);
  if (!cached) {
    cached = (async () => {
      const result = await call('/auth/login', { method: 'POST', body: { email, password: PASSWORD } });
      assert.equal(result.status, 200, `login ${email}: ${result.text}`);
      return (result.headers.get('set-cookie') ?? '').split(';')[0]!;
    })();
    sessions.set(email, cached);
  }
  return cached;
}

async function sql<T>(query: string, params: unknown[] = []): Promise<{ rows: T[]; rowCount: number }> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(query, params);
    return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
  } finally {
    await client.end();
  }
}

async function waitForServer(child: ChildProcess): Promise<void> {
  const { promise: signal, resolve: ready } = Promise.withResolvers<void>();
  let output = '';
  const onData = (chunk: unknown) => {
    output += String(chunk);
    if (output.includes('Svara berjalan')) ready();
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
  child.once('exit', (exitCode) => {
    if (!stopping) throw new Error(`server uji berhenti (kode ${exitCode}): ${output}`);
  });
  await signal;
}

before(async () => {
  await resetTestDatabase();
  // Seed demo dimuat sekali dari proses uji sebelum server berjalan; server uji yang dijalankan ulang
  // tidak akan memuatnya sendiri karena akun sudah ada.
  process.env.SEED_DEMO = '1';
  process.env.SEED_PASSWORD = PASSWORD;
  assert.equal(await seedDemoIfEmpty(), true, 'seed demo harus dimuat dari basis data kosong');
  rmSync(EVIDENCE_DIR, { recursive: true, force: true });
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DATABASE_URL: databaseUrl,
      GUARDIAN_EVIDENCE_DIR: EVIDENCE_DIR,
      COOKIE_SECURE: '0',
      ENABLE_HSTS: '0',
      NODE_ENV: 'test',
      SEED_DEMO: '1',
      SEED_PASSWORD: PASSWORD,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForServer(server);
});

after(async () => {
  stopping = true;
  server?.kill();
  await closeTestDatabase();
  rmSync(EVIDENCE_DIR, { recursive: true, force: true });
});

test('BF-10: /public/policy memakai profil kebijakan organisasi dan platform, bukan baris legacy', async () => {
  const before = data<{
    sources: Array<{ id: string; source: string; organization_name: string; data_request_contact: string | null; notice_version: string }>;
    profiles?: Array<{ id: string }>;
    notices?: Array<{ profile_id: string }>;
    data_request_contact: string;
    synthetic_placeholder: boolean;
  }>(await call('/public/policy'));

  assert.equal(before.synthetic_placeholder, false, 'kontak diambil dari data kebijakan nyata, bukan placeholder');
  const orgContacts = (
    await sql<{ data_request_contact: string | null }>('SELECT data_request_contact FROM organizations')
  ).rows.map((row) => row.data_request_contact);
  assert.ok(before.data_request_contact.endsWith('@svara.local') || orgContacts.includes(before.data_request_contact),
    `kontak ${before.data_request_contact} bukan kontak organisasi/platform`);
  assert.equal(before.profiles, undefined, 'baris profiles legacy tidak lagi menjadi dasar halaman kebijakan');
  assert.equal(before.notices, undefined, 'baris notices legacy tidak lagi menjadi dasar halaman kebijakan');

  const rows = await sql<{ id: string }>('SELECT id FROM organizations ORDER BY id');
  const expected = new Set(['platform', ...rows.rows.map((row) => row.id)]);
  assert.deepEqual(new Set(before.sources.map((row) => row.id)), expected);

  // Perubahan profil organisasi langsung terlihat, tanpa baris profiles/notices.
  const contact = 'privasi.khusus@svara.local';
  const orgAdmin = await session('orgadmin@svara.local');
  const updated = await call('/org/profile', { method: 'PUT', cookie: orgAdmin, body: { data_request_contact: contact } });
  assert.equal(updated.status, 200, updated.text);
  try {
    const published = data<{ sources: Array<{ id: string; data_request_contact: string | null }> }>(
      await call('/public/policy'),
    );
    assert.equal(published.sources.find((row) => row.id === 'org_smk')?.data_request_contact, contact,
      `sumber: ${JSON.stringify(published.sources.map((row) => [row.id, row.data_request_contact]))}`);
  } finally {
    await call('/org/profile', { method: 'PUT', cookie: orgAdmin, body: { data_request_contact: 'dpo@sekolah-a.test' } });
  }
});

test('SEC-16: ringkasan menyembunyikan hitungan kelompok kecil', async () => {
  const creator = await session('creator.a@svara.local');
  const admin = await session('admin@svara.local');
  const created = await call('/surveys', {
    method: 'POST',
    cookie: creator,
    body: { title: 'Survei k-anonim' },
  });
  assert.equal(created.status, 201, created.text);
  const surveyId = data<{ survey: { id: string } }>(created).survey.id;
  const questions = [
    {
      code: 'Q1',
      type: 'single_choice',
      required: true,
      section: 'Bagian A',
      label: 'Pilihan',
      options: [
        { label: 'Ya', value: 1 },
        { label: 'Tidak', value: 0 },
      ],
    },
    { code: 'Q2', type: 'short_text', required: false, section: 'Bagian A', label: 'Cerita' },
  ];
  const saved = await call(`/surveys/${surveyId}`, { method: 'PUT', cookie: creator, body: { title: 'Survei k-anonim', purpose: 'Memantau mutu kelas', questions } });
  assert.equal(saved.status, 200, saved.text);
  const settings = await call(`/surveys/${surveyId}/settings`, {
    method: 'PUT',
    cookie: creator,
    body: { allowResults: true, allowIndividual: false },
  });
  assert.equal(settings.status, 200, settings.text);
  const published = await call(`/surveys/${surveyId}/publish`, { method: 'POST', cookie: creator });
  assert.equal(published.status, 200, published.text);
  const token = data<{ publicLink: { token: string } }>(published).publicLink.token;
  const versionId = data<{ version: { id: string } }>(published).version.id;

  const consentVersion = data<{ consent_version: string }>(await call(`/public/surveys/${token}`)).consent_version;
  const submit = async (index: number) => {
    const consent = await call(`/public/surveys/${token}/consent`, {
      method: 'POST',
      body: { version_id: consentVersion, respondent_click: true, eligibility: true, guardian_evidence_ref: `ref-${index}` },
    });
    const cookie = (consent.headers.get('set-cookie') ?? '').split(';')[0]!;
    const consentId = data<{ consent_id: string }>(consent).consent_id;
    const form = data<{
      questions: Array<{ code: string; option_ids: string[] }>;
      consent: { consent_id: string };
    }>(await call(`/public/surveys/${token}/form?consent_id=${consentId}`, { cookie }));
    const q1 = form.questions.find((question) => question.code === 'Q1')!;
    const response = await call(`/public/surveys/${token}/responses`, {
      method: 'POST',
      cookie,
      idempotencyKey: `kanon-${index}-${Date.now()}`,
      body: {
        consent_id: form.consent.consent_id,
        answers: [
          { question_code: 'Q1', option_id: q1.option_ids[0] },
          { question_code: 'Q2', text: `catatan ${index}` },
        ],
      },
    });
    assert.equal(response.status, 201, response.text);
  };
  await submit(0);
  await submit(1);

  const hidden = data<{ total: number | null; fewer_than: number | null; items: unknown[] }>(
    await call(`/surveys/${surveyId}/summary?version=${versionId}`, { cookie: creator }),
  );
  assert.equal(hidden.total, null, 'total di bawah ambang tidak diungkap');
  assert.equal(hidden.fewer_than, 5);
  assert.deepEqual(hidden.items, [], 'pecahan per pertanyaan juga ditahan');
  // Super admin tanpa grant tetap ditolak (DOC-01: pemilik dan org_admin membaca tanpa grant, super
  // admin tidak); ambang sendiri berlaku pada jalur mana pun yang boleh membaca ringkasan.
  const adminHidden = await call(`/surveys/${surveyId}/summary?version=${versionId}`, { cookie: admin });
  assert.equal(adminHidden.status, 403, 'super_admin tanpa grant tidak membaca ringkasan');

  await submit(2);
  await submit(3);
  await submit(4);
  const shown = data<{ total: number | null; fewer_than: number | null; items: Array<{ code: string; options: Array<{ count: number }> }> }>(
    await call(`/surveys/${surveyId}/summary?version=${versionId}`, { cookie: creator }),
  );
  assert.equal(shown.total, 5);
  assert.equal(shown.fewer_than, null);
  assert.equal(shown.items.find((item) => item.code === 'Q1')?.options[0]?.count, 5);
});

test('SEC-15: super_admin tidak dapat memberi grant akses data kepada dirinya sendiri', async () => {
  const admin = await session('admin@svara.local');
  const survey = 's_demo1';

  const single = await call('/admin/grants/u_admin', {
    method: 'PUT',
    cookie: admin,
    body: { grants: [{ survey_id: survey, can_read_individual: true, can_export: true, can_read_free_text: true, purpose: 'Uji diri sendiri' }] },
  });
  assert.equal(single.status, 422, single.text);
  assert.equal(code(single), 'self_grant_forbidden');

  const bulk = await call('/admin/grants', {
    method: 'PUT',
    cookie: admin,
    body: { grants: [{ account_id: 'u_admin', survey_id: survey, can_read_individual: true, can_export: true, can_read_free_text: true, purpose: 'Uji diri sendiri' }] },
  });
  assert.equal(bulk.status, 422, bulk.text);
  assert.equal(code(bulk), 'self_grant_forbidden');

  const rows = await sql<{ count: number }>('SELECT COUNT(*)::int AS count FROM access_grants WHERE account_id = $1', ['u_admin']);
  assert.equal(rows.rows[0]?.count, 0);
  const responses = await call(`/surveys/${survey}/responses`, { cookie: admin });
  assert.equal(responses.status, 403, 'super_admin tanpa grant tetap tidak membaca jawaban individual');
  const csv = await call(`/surveys/${survey}/export?format=csv`, { cookie: admin });
  assert.equal(csv.status, 403);
});

test('BR-11: pemilik yang tidak lagi anggota organisasi tidak mengelola survei organisasinya', async () => {
  const admin = await session('admin@svara.local');
  const owner = await session('creator.a@svara.local');
  const snapshot = (
    await sql<{ organization_id: string | null }>("SELECT organization_id FROM accounts WHERE id = 'u_creator_a'")
  ).rows[0];
  assert.equal(snapshot?.organization_id, 'org_smk');

  const created = await call('/surveys', { method: 'POST', cookie: owner, body: { title: 'Lintas waktu', owner_scope: 'organization' } });
  assert.equal(created.status, 201, created.text);
  const createdSurvey = data<{ survey: { id: string; organization_id: string | null } }>(created).survey;
  assert.equal(createdSurvey.organization_id, 'org_smk', 'survei harus milik organisasi pemilik');
  const surveyId = createdSurvey.id;
  const manage = async (cookie: string) => {
    const settings = await call(`/surveys/${surveyId}/settings`, { method: 'PUT', cookie, body: { allowResults: true } });
    return settings.status;
  };

  try {
    assert.equal(await manage(owner), 200, 'pemilik anggota organisasi mengelola surveinya');
    const detail = await call(`/surveys/${surveyId}`, { cookie: owner });
    assert.equal(detail.status, 200);

    const moved = await call('/admin/accounts/u_creator_a', { method: 'PATCH', cookie: admin, body: { organization_id: null } });
    assert.equal(moved.status, 200, moved.text);

    assert.equal(await manage(owner), 403, 'setelah keluar organisasi pemilik bukan lagi pengelola');
    const denied = await call(`/surveys/${surveyId}`, { cookie: owner });
    assert.equal(denied.status, 403);
    const responses = await call(`/surveys/${surveyId}/responses`, { cookie: owner });
    assert.equal(responses.status, 403);
    const orgAdmin = await session('orgadmin@svara.local');
    assert.equal(await manage(orgAdmin), 200, 'org_admin organisasi pemilik tetap mengelola');
    // Survei individual (tanpa organisasi) tetap dikelola pemiliknya walau tanpa organisasi.
    const individual = await call('/surveys', { method: 'POST', cookie: owner, body: { title: 'Individual lintas waktu' } });
    assert.equal(individual.status, 201, individual.text);
    const individualId = data<{ survey: { id: string } }>(individual).survey.id;
    const individualSettings = await call(`/surveys/${individualId}/settings`, {
      method: 'PUT',
      cookie: owner,
      body: { allowResults: false },
    });
    assert.equal(individualSettings.status, 200);
  } finally {
    await call('/admin/accounts/u_creator_a', {
      method: 'PATCH',
      cookie: admin,
      body: { organization_id: snapshot?.organization_id ?? 'org_smk' },
    });
  }
});

test('BR-06/SEC-14: grant lintas tenant mencatat pemberi, tujuan, dan kedaluwarsa, serta dipatuhi', async () => {
  const admin = await session('admin@svara.local');
  const grantee = await session('officer@svara.local');

  // Pendahuluan: survei uji milik org_perpus dibuat pemiliknya, supaya `GET /responses` memiliki versi
  // acuan dan grant penerima (org_smk) benar-benar lintas tenant.
  const owner = await session('creator.b@svara.local');
  const created = await call('/surveys', {
    method: 'POST',
    cookie: owner,
    body: { title: 'Survei lintas tenant', owner_scope: 'organization' },
  });
  assert.equal(created.status, 201, created.text);
  const survey = data<{ survey: { id: string; organization_id: string | null; owner_id: string } }>(created).survey;
  const prepared = await call(`/surveys/${survey.id}`, {
    method: 'PUT',
    cookie: owner,
    body: {
      title: 'Survei lintas tenant',
      purpose: 'Menguji grant lintas tenant',
      questions: [{ code: 'Q1', type: 'short_text', required: false, section: 'Bagian A', label: 'Catatan' }],
    },
  });
  assert.equal(prepared.status, 200, prepared.text);
  // `survey_settings.allow_individual` default 0; grant baca individual hanya berlaku bila pengelola
  // mengizinkannya (perilaku yang sudah ada, bukan bagian uji ini).
  const settings = await call(`/surveys/${survey.id}/settings`, {
    method: 'PUT',
    cookie: owner,
    body: { allowResults: true, allowIndividual: true },
  });
  assert.equal(settings.status, 200, settings.text);
  const published = await call(`/surveys/${survey.id}/publish`, { method: 'POST', cookie: owner });
  assert.equal(published.status, 200, published.text);
  const versionId = data<{ version: { id: string } }>(published).version.id;
  const surveyId = survey.id;

  const granteeOrg = (
    await sql<{ organization_id: string | null }>("SELECT organization_id FROM accounts WHERE id = 'u_petugas'")
  ).rows[0]?.organization_id;
  assert.ok(
    granteeOrg && survey.organization_id && granteeOrg !== survey.organization_id && survey.owner_id !== 'u_petugas',
    `prasyarat grant lintas tenant: penerima ${granteeOrg}, survei ${survey.organization_id} (pemilik ${survey.owner_id})`,
  );

  // Prasyarat: grant yang ada dihapus dulu supaya hanya grant uji ini yang berlaku (endpoint mengganti
  // seluruh daftar grant akun). Akun lain tidak tersentuh.
  const cleared = await call('/admin/grants/u_petugas', {
    method: 'PUT',
    cookie: admin,
    body: { grants: [{ survey_id: surveyId, can_read_individual: true, purpose: 'Prasyarat uji grant', expires_at: null }] },
  });
  assert.equal(cleared.status, 200, cleared.text);

  const future = new Date(Date.now() + 86_400_000).toISOString();
  const purpose = 'Audit mutu lintas sekolah';
  const saved = await call('/admin/grants/u_petugas', {
    method: 'PUT',
    cookie: admin,
    body: {
      grants: [
        {
          survey_id: surveyId,
          can_read_individual: true,
          can_export: false,
          can_read_free_text: false,
          purpose,
          expires_at: future,
        },
      ],
    },
  });
  assert.equal(saved.status, 200, saved.text);

  type GrantRecord = {
    id: string;
    account_id: string;
    survey_id: string | null;
    can_read_individual: number;
    can_export: number;
    can_read_free_text: number;
    purpose: string | null;
    expires_at: string | null;
    granted_by: string | null;
  };
  const stored = await sql<GrantRecord>('SELECT * FROM access_grants WHERE account_id = $1', ['u_petugas']);
  const row = stored.rows.find((grant) => grant.survey_id === surveyId);
  assert.ok(row, 'grant tersimpan');
  assert.equal(row.purpose, purpose);
  assert.equal(row.expires_at, future);
  assert.equal(row.granted_by, 'u_admin');
  assert.equal(row.can_read_individual, 1);

  const accounts = data<{ grants: GrantRecord[] }>(await call('/admin/accounts', { cookie: admin }));
  const listed = accounts.grants.find((grant) => grant.survey_id === surveyId && grant.account_id === 'u_petugas');
  assert.equal(listed?.purpose, purpose);
  assert.equal(listed?.expires_at, future);
  assert.equal(listed?.granted_by, 'u_admin');
  const latestAudit = await sql<{ metadata: string | null }>(
    "SELECT metadata FROM audit_logs WHERE action = 'Ubah izin akses' AND account_id = 'u_admin' ORDER BY at DESC LIMIT 1",
  );
  const rawMeta: unknown = JSON.parse(latestAudit.rows[0]?.metadata ?? 'null');
  const meta = rawMeta as { grants?: Array<{ survey_id: string | null; purpose: string | null; expires_at: string | null; granted_by: string }> };
  assert.deepEqual(meta.grants?.find((grant) => grant.survey_id === surveyId), {
    survey_id: surveyId,
    purpose,
    expires_at: future,
    granted_by: 'u_admin',
  }, 'audit detail izin memuat grant pemberi, tujuan, dan kedaluwarsa');

  const responsesPath = `/surveys/${surveyId}/responses?version=${versionId}`;
  const granteeResponses = await call(responsesPath, { cookie: grantee });
  assert.equal(granteeResponses.status, 200, granteeResponses.text);

  // Input tidak valid ditolak tanpa menyentuh baris lama.
  const past = new Date(Date.now() - 60_000).toISOString();
  for (const invalid of [{ expires_at: 'besok' }, { purpose: '   ' }, { expires_at: past }]) {
    const rejected = await call('/admin/grants/u_petugas', {
      method: 'PUT',
      cookie: admin,
      body: { grants: [{ survey_id: surveyId, can_read_individual: true, purpose, ...invalid }] },
    });
    assert.equal(rejected.status, 422, `payload ${JSON.stringify(invalid)} harus 422: ${rejected.text}`);
  }
  assert.equal(
    (await sql<{ expires_at: string }>('SELECT expires_at FROM access_grants WHERE survey_id = $1 AND account_id = $2', [surveyId, 'u_petugas'])).rows[0]?.expires_at,
    future,
  );

  // Grant kedaluwarsa tidak berlaku lagi tanpa menghapus baris. Kedaluwarsa ditulis langsung karena API
  // menolak `expires_at` di masa lalu (grant dicabut dengan menghapusnya, bukan menundanya).
  const expiredAt = new Date(Date.now() - 60_000).toISOString();
  await sql('UPDATE access_grants SET expires_at = $1 WHERE survey_id = $2 AND account_id = $3', [expiredAt, surveyId, 'u_petugas']);
  sessions.delete('officer@svara.local');
  const expiredGrantee = await session('officer@svara.local');
  assert.equal((await call(responsesPath, { cookie: expiredGrantee })).status, 403);
  assert.equal((await call('/surveys/s_demo3', { cookie: expiredGrantee })).status, 403);
  const bootstrap = data<{ grants: Array<{ survey_id: string | null; expires_at: string | null }> }>(
    await call('/bootstrap', { cookie: expiredGrantee }),
  );
  assert.equal(bootstrap.grants.find((grant) => grant.survey_id === surveyId)?.expires_at, expiredAt,
    'baris grant tetap terbaca pemiliknya beserta kedaluwarsanya');
  // Baris tidak dihapus: riwayat dan pemberi tetap utuh.
  const kept = await sql<{ granted_by: string; expires_at: string }>(
    'SELECT granted_by, expires_at FROM access_grants WHERE survey_id = $1 AND account_id = $2',
    [surveyId, 'u_petugas'],
  );
  assert.deepEqual(kept.rows, [{ granted_by: 'u_admin', expires_at: expiredAt }]);
});

test('SEC-09: kode undangan tidak dapat ditebak dan resolver tidak menyajikan token mentah', async () => {
  const creator = await session('creator.a@svara.local');
  const created = await call('/surveys/s_demo1/invitations', {
    method: 'POST',
    cookie: creator,
    body: { label: 'Peserta kode', expires_at: '2027-01-01' },
  });
  assert.equal(created.status, 201, created.text);
  const invitation = data<{ invitation: { id: string; code: string }; token: string }>(created);
  assert.match(invitation.invitation.code, /^UND-[0-9A-F]{7,}$/u, 'kode undangan harus di atas 24 bit');

  const resolved = await call('/public/invitations/resolve', {
    method: 'POST',
    body: { code: invitation.invitation.code },
  });
  assert.equal(resolved.status, 200, resolved.text);
  const payload = data<Record<string, unknown>>(resolved);
  assert.equal(payload.token, undefined, 'resolver tidak mengembalikan token mentah');
  assert.equal(typeof payload.url, 'string');
  assert.equal(String(payload.url).includes(invitation.token), false, 'URL tidak memuat token undangan');

  // Tautan dari resolver tetap membuka formulir undangan lewat ID undangan (tanpa token di URL).
  const target = String(payload.url).replace(/^\/s\//u, '');
  assert.match(target, /^inv_[0-9a-f]+$/u, 'penukaran kode mengembalikan ID undangan, bukan token');
  const form = await call(`/public/surveys/${target}`);
  assert.equal(form.status, 200, `${target}: ${form.text}`);
  assert.match(form.text, /UND-/u);
  // ID undangan hasil penukaran kode tetap tunduk pada status: formulir undangan yang sudah terpakai
  // menolak permintaan baris baru, dan ID acak tidak ditemukan.
  const used = await call('/public/invitations/resolve', { method: 'POST', body: { code: 'UND-02-TERPAKAI' } });
  assert.equal(used.status, 409);
  assert.equal(code(used), 'invitation_inactive');
  assert.equal((await call('/public/surveys/inv_tidakada')).status, 404);
});

test('BR-06/SEC-14: grant seed membawa pemberi dan tujuan; super admin tidak diberi grant', async () => {
  // Seed demo ditulis dengan provenance yang sama seperti API, dan bootstrap hanya membawa grant milik
  // akun itu sendiri (SEC-15): super admin tidak pernah menerima grant milik akun lain.
  const admin = await session('admin@svara.local');
  const creator = await session('creator.b@svara.local');
  const adminBootstrap = data<{ grants: Array<{ account_id: string }> }>(await call('/bootstrap', { cookie: admin }));
  assert.deepEqual(adminBootstrap.grants, []);
  const own = data<{ grants: Array<{ survey_id: string; purpose: string | null; granted_by: string | null; expires_at: string | null }> }>(
    await call('/bootstrap', { cookie: creator }),
  );
  // s_demo3 milik creator.b (org_perpus); grant g_03 adalah grant lintas sekolah yang dibatasi waktunya.
  const seeded = own.grants.find((grant) => grant.survey_id === 's_demo3');
  assert.deepEqual(
    { purpose: seeded?.purpose, granted_by: seeded?.granted_by },
    { purpose: 'Tinjauan mutu lintas sekolah', granted_by: 'u_admin' },
  );
  const { get: dbGet } = await import('../db.ts');
  console.log('DBG owner', await dbGet('SELECT owner_id, organization_id FROM surveys WHERE id = ?', 's_demo2'));
  // g_04 sengaja kedaluwarsa: barisnya terbaca, tetapi tidak lagi memberi izin apa pun.
  const expiredGrant = own.grants.find((grant) => grant.survey_id === 's_demo3');
  assert.ok(expiredGrant && expiredGrant.expires_at, 'grant kedaluwarsa tetap terbaca beserta tanggalnya');
  const expired = await call('/surveys/s_demo1/responses?version=v_demo1_1', { cookie: creator });
  assert.equal(expired.status, 403, 'grant kedaluwarsa tidak memberi akses jawaban individual');
});

test('SEC-10: /s/:token bentuk yang tidak pernah diterbitkan tidak menyentuh basis data', async () => {
  // Token seed berupa konstanta demo yang memenuhi pola token (dipakai uji lain); bentuk lain ditolak
  // sebelum query, jadi variasi path tidak menjadi jalur pencarian baru.
  for (const probe of ['undangan-demo', 'PLACEHOLDER-token', 'x'.repeat(200)]) {
    const result = await call(`/public/surveys/${probe}`);
    assert.equal(result.status, 404, `${probe}: ${result.text}`);
    assert.equal((result.json as { code?: string } | null)?.code, 'token_not_found');
  }
});

test('SEC-10/BR-10: bootstrap tidak memuat salinan token mentah; tautan publik memakai hash saja', async () => {
  const creator = await session('creator.a@svara.local');
  const created = await call('/surveys/s_demo1/invitations', {
    method: 'POST',
    cookie: creator,
    body: { label: 'Tanpa salin', expires_at: '2027-01-01' },
  });
  assert.equal(created.status, 201, created.text);
  const issued = data<{ invitation: { id: string }; token: string; url: string }>(created);

  const bootstrap = await call('/bootstrap', { cookie: creator });
  assert.equal(bootstrap.status, 200, bootstrap.text);
  assert.equal(bootstrap.text.includes(issued.token), false, 'bootstrap tidak boleh memuat token undangan mentah');
  const payload = data<{
    invitations: Array<{ id: string; token?: string | null }>;
    publicLinks: Array<{ id: string; survey_id: string; token?: string | null; token_hash?: string; url?: string | null }>;
  }>(bootstrap);
  const invitation = payload.invitations.find((row) => row.id === issued.invitation.id);
  assert.equal(invitation?.token, null, 'bootstrap tidak memuat salinan token undangan');
  const links = payload.publicLinks.filter((row) => row.survey_id === 's_demo1');
  assert.ok(links.length > 0);
  for (const row of links) {
    assert.equal(row.token, null, 'bootstrap tidak memuat token tautan umum');
    assert.equal(row.url, null, 'bootstrap tidak membentuk URL bertoken');
    assert.equal(row.token_hash, '', 'bootstrap tidak mengirim hash token tautan umum');
  }
  const issuedLink = data<{ token: string; url: string }>(
    await call('/surveys/s_demo1/public-link/token', { method: 'POST', cookie: creator }),
  );
  // Token hanya keluar pada respons cetak ulang; path `/s/<token>` membandingkan hash saja.
  assert.equal((await call(`/public/surveys/${issuedLink.token}`)).status, 200, issuedLink.url);
  assert.equal((await call(`/public/surveys/${issuedLink.token}x`)).status, 404);

  // Super admin tidak lagi menerima seluruh grant berisi grantor.
  const admin = await session('admin@svara.local');
  const adminBootstrap = await call('/bootstrap', { cookie: admin });
  assert.equal(adminBootstrap.text.includes(issued.token), false);
});

