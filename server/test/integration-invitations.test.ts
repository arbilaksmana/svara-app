import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { after, before, test } from 'node:test';
import { app } from '../app.ts';
import { all, get, run } from '../db.ts';
import { seedDemoIfEmpty } from '../seed-data.ts';
import { closeTestDatabase, resetTestDatabase } from './test-db.ts';

/**
 * Modul 13 (BeCraft) memakai kredensial layanan tanpa sesi pengelola: membuat undangan per peserta,
 * lalu mengambil respons berdasarkan `assignment_id` yang dikembalikan. Berkas ini menguji kedua jalur
 * itu beserta batas cakupan, kredensial, dan regresi pembacaan tanpa filter.
 */

process.env.NODE_ENV = 'test';
process.env.SEED_DEMO = '1';
process.env.SEED_PASSWORD = 'SvaraDemo123!';
const SERVICE_TOKEN = 'm13-service-invitations-token-0123456789';
process.env.INTEGRATION_TOKEN = SERVICE_TOKEN;

interface Result {
  status: number;
  json: {
    code?: string;
    error?: string;
    data?: unknown;
    simulated?: boolean;
    label?: string;
    survey_version?: number | null;
    pagination?: { limit: number; offset: number; total: number };
    assignment_id?: string;
    invitation_id?: string;
    invitation_status?: string;
  };
  headers: Headers;
}

interface InvitationData {
  assignment_id: string;
  invitation_id: string;
  version_id: string;
  code: string;
  token: string;
  url: string;
  expires_at: string | null;
}

let server: Server;
let base: string;

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function request(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    auth?: string | null;
    cookie?: string;
    idempotencyKey?: string;
    csrfHeader?: boolean;
  } = {},
): Promise<Result> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (options.csrfHeader !== false) headers['X-Svara-Client'] = 'web';
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const auth = options.auth === undefined ? SERVICE_TOKEN : options.auth;
  if (auth !== null) headers.Authorization = `Bearer ${auth}`;
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const json = (await response.json().catch(() => ({}))) as Result['json'];
  return { status: response.status, json, headers: response.headers };
}

function createInvitation(surveyId: string, body: Record<string, unknown>): Promise<Result> {
  return request(`/integration/surveys/${surveyId}/invitations`, { method: 'POST', body, csrfHeader: false });
}

/** Bentuk respons diperiksa di perbatasan HTTP sebelum field-nya dipakai. */
function invitationData(raw: unknown): InvitationData {
  assert.ok(raw && typeof raw === 'object');
  const { assignment_id, invitation_id, version_id, code, token, url, expires_at } = raw as Record<string, unknown>;
  assert.ok(typeof assignment_id === 'string');
  assert.ok(typeof invitation_id === 'string');
  assert.ok(typeof version_id === 'string');
  assert.ok(typeof code === 'string');
  assert.ok(typeof token === 'string');
  assert.ok(typeof url === 'string');
  assert.ok(expires_at === null || typeof expires_at === 'string');
  return { assignment_id, invitation_id, version_id, code, token, url, expires_at };
}

function assignmentIds(body: Result['json']): Array<string | null> {
  assert.ok(body.pagination && Array.isArray(body.data));
  return body.data.map((row) => {
    assert.ok(row && typeof row === 'object' && 'assignment_id' in row);
    const id = row.assignment_id;
    assert.ok(id === null || typeof id === 'string');
    return id;
  });
}

async function setOrganizationScope(organizationId: string): Promise<void> {
  await run(
    'UPDATE integration_token_scopes SET organization_id = ?, survey_id = NULL WHERE token_hash = ?',
    organizationId,
    tokenHash(SERVICE_TOKEN),
  );
}

function reissueInvitation(assignmentId: string, body: Record<string, unknown> = {}): Promise<Result> {
  return request(`/integration/assignments/${assignmentId}/invitations`, {
    method: 'POST',
    body,
    csrfHeader: false,
  });
}

const DEMO2_ANSWERS = [
  { question_code: 'P01', text: '4' },
  { question_code: 'P02', text: '2' },
];

/** Alur publik lengkap untuk membuktikan token undangan benar-benar dapat dipakai. */
async function submitInvitation(token: string, idempotencyKey: string): Promise<Result> {
  const intro = await request(`/public/surveys/${token}`, { auth: null });
  assert.equal(intro.status, 200, JSON.stringify(intro.json));
  assert.ok(intro.json.data && typeof intro.json.data === 'object' && 'consent_version' in intro.json.data);
  const consentVersion = (intro.json.data as Record<string, unknown>).consent_version;
  assert.ok(typeof consentVersion === 'string');

  const consent = await request(`/public/surveys/${token}/consent`, {
    method: 'POST',
    auth: null,
    body: { version_id: consentVersion, respondent_click: true, eligibility: true },
  });
  assert.equal(consent.status, 201, JSON.stringify(consent.json));
  const session = consent.headers.get('set-cookie')?.split(';')[0];
  assert.ok(session);
  const consentPayload = consent.json.data;
  assert.ok(consentPayload && typeof consentPayload === 'object' && 'consent_id' in consentPayload);
  const consentId = (consentPayload as Record<string, unknown>).consent_id;
  assert.ok(typeof consentId === 'string');

  return request(`/public/surveys/${token}/responses`, {
    method: 'POST',
    auth: null,
    cookie: session,
    idempotencyKey,
    body: { consent_id: consentId, answers: DEMO2_ANSWERS },
  });
}

function receiptResponseId(body: Result['json']): string {
  assert.ok(body.data && typeof body.data === 'object' && 'response_id' in body.data);
  const responseId = (body.data as Record<string, unknown>).response_id;
  assert.ok(typeof responseId === 'string');
  return responseId;
}

const REPUBLISH_VERSION_ID = 'v_demo2_2';

/** Draf v2 untuk s_demo2; tidak mengubah versi terbit sampai `setRepublished(true)`. */
async function ensureRepublishDraft(): Promise<void> {
  await run(
    `INSERT INTO survey_versions (id, survey_id, number, status, notice_version, published_at, closed_at)
     VALUES (?, 's_demo2', 2, 'draft', '1.0', NULL, NULL)
     ON CONFLICT (id) DO UPDATE SET status = 'draft', published_at = NULL, closed_at = NULL`,
    REPUBLISH_VERSION_ID,
  );
}

/** Mensimulasikan republish v2 lalu mengembalikan s_demo2 ke keadaan seed. */
async function setRepublished(republished: boolean): Promise<void> {
  if (republished) {
    await run("UPDATE survey_versions SET status = 'closed', closed_at = ? WHERE id = 'v_demo2_1'", new Date().toISOString());
    await run(
      "UPDATE survey_versions SET status = 'published', published_at = ? WHERE id = ?",
      new Date().toISOString(),
      REPUBLISH_VERSION_ID,
    );
  } else {
    await run("UPDATE survey_versions SET status = 'published', closed_at = NULL WHERE id = 'v_demo2_1'");
    await run("UPDATE survey_versions SET status = 'draft', published_at = NULL, closed_at = NULL WHERE id = ?", REPUBLISH_VERSION_ID);
  }
}

before(async () => {
  await resetTestDatabase();
  await seedDemoIfEmpty();
  await ensureRepublishDraft();
  // Sama dengan server/index.ts saat start dengan INTEGRATION_ORGANIZATION_ID=org_smk.
  await run(
    'INSERT INTO integration_token_scopes (token_hash, organization_id) VALUES (?, ?)',
    tokenHash(SERVICE_TOKEN),
    'org_smk',
  );
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
    await promise;
  }
  await closeTestDatabase();
});

test('POST layanan membuat undangan per peserta dan menyimpan participant_ref apa adanya', async () => {
  // createInvitation sengaja TIDAK mengirim x-svara-client: klien BeCraft tidak boleh dimintai header web.
  const response = await createInvitation('s_demo1', {
    participant_ref: 'becraft-peserta-001',
    label: 'Kelas A · 01',
    expires_at: '2099-01-01T00:00:00Z',
  });
  assert.equal(response.status, 201, JSON.stringify(response.json));
  const data = invitationData(response.json.data);
  assert.match(data.assignment_id, /^a_[0-9a-f]{16}$/);
  assert.match(data.invitation_id, /^inv_[0-9a-f]{16}$/);
  // s_demo1 punya draf v2 sebagai current_version_id; undangan harus memakai versi terbit terbaru.
  assert.equal(data.version_id, 'v_demo1_1');
  assert.match(data.code, /^UND-[0-9A-F]{8}$/);
  assert.match(data.token, /^[A-Za-z0-9_-]{24}$/);
  assert.equal(data.url, `/s/${data.token}`);
  assert.equal(data.expires_at, '2099-01-01T00:00:00.000Z');

  const assignment = await get<{ label: string; participant_ref: string; version_id: string }>(
    'SELECT label, participant_ref, version_id FROM assignments WHERE id = ?',
    data.assignment_id,
  );
  assert.ok(assignment);
  assert.equal(assignment.participant_ref, 'becraft-peserta-001');
  assert.equal(assignment.label, 'Kelas A · 01');
  assert.equal(assignment.version_id, 'v_demo1_1');

  const invitation = await get<{ code: string; token_hash: string; status: string; expires_at: string | null }>(
    'SELECT code, token_hash, status, expires_at FROM invitations WHERE id = ?',
    data.invitation_id,
  );
  assert.ok(invitation);
  assert.equal(invitation.code, data.code);
  assert.equal(invitation.status, 'active');
  assert.equal(invitation.expires_at, '2099-01-01T00:00:00.000Z');
  assert.notEqual(invitation.token_hash, data.token);
  assert.equal(invitation.token_hash, tokenHash(data.token));
  const columns = await all<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'invitations'",
  );
  assert.ok(!columns.some((column) => column.column_name === 'token'));

  const audits = await all<{ actor: string; outcome: string; metadata: string | null }>(
    `SELECT actor, outcome, metadata FROM audit_logs
      WHERE action = 'Buat undangan layanan' AND object = ?`,
    `s_demo1 · ${data.invitation_id}`,
  );
  assert.equal(audits.length, 1);
  assert.equal(audits[0]!.actor, 'layanan-13');
  assert.equal(audits[0]!.outcome, 'berhasil');
  assert.ok(!JSON.stringify(audits).includes(data.token));
});

test('POST layanan menolak permintaan tanpa kredensial atau dengan bearer salah', async () => {
  // Tanpa x-svara-client juga: pengecualian CSRF tidak boleh menjadi pengecualian autentikasi.
  const noHeader = await request('/integration/surveys/s_demo1/invitations', {
    method: 'POST',
    auth: null,
    csrfHeader: false,
    body: { participant_ref: 'p-2', label: 'L-2' },
  });
  assert.equal(noHeader.status, 401, JSON.stringify(noHeader.json));

  const wrongBearer = await request('/integration/surveys/s_demo1/invitations', {
    method: 'POST',
    auth: 'not-the-service-token',
    csrfHeader: false,
    body: { participant_ref: 'p-3', label: 'L-3' },
  });
  assert.equal(wrongBearer.status, 401, JSON.stringify(wrongBearer.json));
});

test('POST pengelola tetap menolak tanpa header x-svara-client (403 csrf_header_required)', async () => {
  const sessionToken = 'sesi-csrf-manager-m13';
  const now = new Date();
  await run(
    'INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    tokenHash(sessionToken),
    'u_creator_a',
    now.toISOString(),
    new Date(now.getTime() + 3_600_000).toISOString(),
  );
  const blocked = await request('/surveys/s_demo1/invitations', {
    method: 'POST',
    auth: null,
    cookie: `svara_session=${sessionToken}`,
    csrfHeader: false,
    body: { label: 'Regresi CSRF pengelola' },
  });
  assert.equal(blocked.status, 403, JSON.stringify(blocked.json));
  assert.equal(blocked.json.code, 'csrf_header_required');
});

test('POST layanan menyamarkan survei di luar cakupan sebagai 404', async () => {
  await setOrganizationScope('org_perpus');
  try {
    const crossOrganization = await createInvitation('s_demo1', { participant_ref: 'p-4', label: 'L-4' });
    assert.equal(crossOrganization.status, 404, JSON.stringify(crossOrganization.json));
    assert.equal(crossOrganization.json.code, 'not_found');
  } finally {
    await setOrganizationScope('org_smk');
  }

  const missingSurvey = await createInvitation('s_tidak_ada', { participant_ref: 'p-5', label: 'L-5' });
  assert.equal(missingSurvey.status, 404, JSON.stringify(missingSurvey.json));
  assert.equal(missingSurvey.json.code, 'not_found');
});

test('GET survey-data menyaring assignment_id, total ikut filter, dan tanpa filter tetap sama', async () => {
  const created = await createInvitation('s_demo2', {
    participant_ref: 'becraft-peserta-002',
    label: 'Perpustakaan · 02',
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const invitation = invitationData(created.json.data);

  const intro = await request(`/public/surveys/${invitation.token}`, { auth: null });
  assert.equal(intro.status, 200, JSON.stringify(intro.json));
  const introPayload = intro.json.data;
  assert.ok(introPayload && typeof introPayload === 'object');
  assert.ok('consent_version' in introPayload);
  const consentVersion = introPayload.consent_version;
  assert.ok(typeof consentVersion === 'string');
  assert.ok('state' in introPayload);
  assert.equal(introPayload.state, 'active');

  const consent = await request(`/public/surveys/${invitation.token}/consent`, {
    method: 'POST',
    auth: null,
    body: { version_id: consentVersion, respondent_click: true, eligibility: true },
  });
  assert.equal(consent.status, 201, JSON.stringify(consent.json));
  const session = consent.headers.get('set-cookie')?.split(';')[0];
  assert.ok(session);
  const consentPayload = consent.json.data;
  assert.ok(consentPayload && typeof consentPayload === 'object' && 'consent_id' in consentPayload);
  const consentId = consentPayload.consent_id;
  assert.ok(typeof consentId === 'string');

  const submitted = await request(`/public/surveys/${invitation.token}/responses`, {
    method: 'POST',
    auth: null,
    cookie: session,
    idempotencyKey: 'm13-filter-assignment-1',
    body: {
      consent_id: consentId,
      answers: [
        { question_code: 'P01', text: '4' },
        { question_code: 'P02', text: '2' },
      ],
    },
  });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.json));

  const filtered = await request(`/integration/survey-data?survey_id=s_demo2&assignment_id=${invitation.assignment_id}`);
  assert.equal(filtered.status, 200, JSON.stringify(filtered.json));
  assert.equal(filtered.json.pagination?.total, 1);
  assert.deepEqual(assignmentIds(filtered.json), [invitation.assignment_id]);

  // Assignment yang ada, tetapi milik survei lain: himpunan kosong, bukan 404.
  const other = await request('/integration/survey-data?survey_id=s_demo2&assignment_id=a_demo01');
  assert.equal(other.status, 200, JSON.stringify(other.json));
  assert.equal(other.json.pagination?.total, 0);
  assert.deepEqual(assignmentIds(other.json), []);

  const unfiltered = await request('/integration/survey-data?survey_id=s_demo2');
  assert.equal(unfiltered.status, 200, JSON.stringify(unfiltered.json));
  // Satu respons seed (a_perpus01) + satu respons yang baru dikirim lewat undangan layanan.
  assert.equal(unfiltered.json.pagination?.total, 2);
  assert.equal(assignmentIds(unfiltered.json).length, 2);
  assert.equal(unfiltered.json.simulated, true);
  assert.equal(unfiltered.json.label, 'SIMULASI Modul 15 — bukan integrasi nyata.');
});

test('POST layanan dengan participant_ref sama mengembalikan 409 assignment_exists tanpa baris baru', async () => {
  const first = await createInvitation('s_demo2', { participant_ref: 'becraft-duplikat-001', label: 'Duplikat · 1' });
  assert.equal(first.status, 201, JSON.stringify(first.json));
  const invitation = invitationData(first.json.data);

  const second = await createInvitation('s_demo2', { participant_ref: 'becraft-duplikat-001', label: 'Duplikat · 2' });
  assert.equal(second.status, 409, JSON.stringify(second.json));
  assert.equal(second.json.code, 'assignment_exists');
  assert.equal(second.json.assignment_id, invitation.assignment_id);
  assert.equal(second.json.invitation_id, invitation.invitation_id);
  assert.equal(second.json.invitation_status, 'active');
  // Token mentah tidak dapat diputar ulang, jadi balasan konflik tidak boleh memuatnya.
  assert.ok(!JSON.stringify(second.json).includes(invitation.token));

  const assignments = await all<{ id: string }>(
    'SELECT id FROM assignments WHERE survey_id = ? AND participant_ref = ?',
    's_demo2',
    'becraft-duplikat-001',
  );
  assert.equal(assignments.length, 1);
  const invitations = await all<{ id: string }>('SELECT id FROM invitations WHERE assignment_id = ?', invitation.assignment_id);
  assert.equal(invitations.length, 1);
});

test('POST layanan aman terhadap balapan participant_ref yang sama', async () => {
  const attempts = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      createInvitation('s_demo2', { participant_ref: 'becraft-balapan-001', label: `Balapan · ${index}` }),
    ),
  );
  const created = attempts.filter((attempt) => attempt.status === 201);
  assert.equal(created.length, 1, JSON.stringify(attempts.map((attempt) => attempt.status)));
  for (const conflict of attempts.filter((attempt) => attempt.status !== 201)) {
    assert.equal(conflict.status, 409, JSON.stringify(conflict.json));
    assert.equal(conflict.json.code, 'assignment_exists');
  }
  const assignments = await all<{ id: string }>(
    'SELECT id FROM assignments WHERE survey_id = ? AND participant_ref = ?',
    's_demo2',
    'becraft-balapan-001',
  );
  assert.equal(assignments.length, 1);
  const invitations = await all<{ id: string }>('SELECT id FROM invitations WHERE assignment_id = ?', assignments[0]!.id);
  assert.equal(invitations.length, 1);
});

test('POST reissue memakai version_id assignment meskipun versi terbit terbaru sudah berganti', async () => {
  const created = await createInvitation('s_demo2', { participant_ref: 'becraft-reissue-versi-001', label: 'Reissue versi' });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const invitation = invitationData(created.json.data);
  assert.equal(invitation.version_id, 'v_demo2_1');

  await setRepublished(true);
  try {
    const reissued = await reissueInvitation(invitation.assignment_id);
    assert.equal(reissued.status, 201, JSON.stringify(reissued.json));
    const next = invitationData(reissued.json.data);
    assert.equal(next.assignment_id, invitation.assignment_id);
    assert.notEqual(next.invitation_id, invitation.invitation_id);
    // Versi terbit terbaru adalah v2, tetapi undangan tetap mengikuti versi assignment.
    assert.equal(next.version_id, 'v_demo2_1');
    const row = await get<{ version_id: string }>('SELECT version_id FROM invitations WHERE id = ?', next.invitation_id);
    assert.equal(row?.version_id, 'v_demo2_1');
  } finally {
    await setRepublished(false);
  }
});

test('POST reissue mencabut undangan aktif lama dan token baru bisa dipakai', async () => {
  const created = await createInvitation('s_demo2', { participant_ref: 'becraft-reissue-token-001', label: 'Reissue token' });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const first = invitationData(created.json.data);

  const reissued = await reissueInvitation(first.assignment_id, { expires_at: '2099-04-04T00:00:00Z' });
  assert.equal(reissued.status, 201, JSON.stringify(reissued.json));
  const second = invitationData(reissued.json.data);
  assert.equal(second.assignment_id, first.assignment_id);
  assert.notEqual(second.invitation_id, first.invitation_id);
  assert.notEqual(second.code, first.code);
  assert.notEqual(second.token, first.token);
  assert.equal(second.version_id, 'v_demo2_1');
  assert.equal(second.expires_at, '2099-04-04T00:00:00.000Z');

  const oldRow = await get<{ status: string; revoked_at: string | null }>(
    'SELECT status, revoked_at FROM invitations WHERE id = ?',
    first.invitation_id,
  );
  assert.equal(oldRow?.status, 'revoked');
  assert.ok(oldRow?.revoked_at);
  const newRow = await get<{ status: string; token_hash: string }>(
    'SELECT status, token_hash FROM invitations WHERE id = ?',
    second.invitation_id,
  );
  assert.equal(newRow?.status, 'active');
  assert.equal(newRow?.token_hash, tokenHash(second.token));

  const submitted = await submitInvitation(second.token, 'm13-reissue-token-1');
  assert.equal(submitted.status, 201, JSON.stringify(submitted.json));
});

test('POST reissue setelah submit mengembalikan 409 already_submitted', async () => {
  const created = await createInvitation('s_demo2', { participant_ref: 'becraft-reissue-submitted-001', label: 'Reissue submitted' });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const invitation = invitationData(created.json.data);
  const submitted = await submitInvitation(invitation.token, 'm13-reissue-submitted-1');
  assert.equal(submitted.status, 201, JSON.stringify(submitted.json));

  const rejected = await reissueInvitation(invitation.assignment_id);
  assert.equal(rejected.status, 409, JSON.stringify(rejected.json));
  assert.equal(rejected.json.code, 'already_submitted');

  const invitations = await all<{ status: string }>('SELECT status FROM invitations WHERE assignment_id = ?', invitation.assignment_id);
  assert.equal(invitations.length, 1);
  assert.equal(invitations[0]!.status, 'used');
});

test('POST reissue assignment di luar cakupan atau tidak ada mengembalikan 404', async () => {
  await setOrganizationScope('org_perpus');
  try {
    const outOfScope = await reissueInvitation('a_demo02');
    assert.equal(outOfScope.status, 404, JSON.stringify(outOfScope.json));
    assert.equal(outOfScope.json.code, 'not_found');
  } finally {
    await setOrganizationScope('org_smk');
  }
  const missing = await reissueInvitation('a_tidak_ada');
  assert.equal(missing.status, 404, JSON.stringify(missing.json));
  assert.equal(missing.json.code, 'not_found');
});

test('GET survey-data dengan assignment_id tetap mengembalikan baris setelah republish', async () => {
  const created = await createInvitation('s_demo2', { participant_ref: 'becraft-republish-001', label: 'Republish · 1' });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const invitation = invitationData(created.json.data);
  const submitted = await submitInvitation(invitation.token, 'm13-republish-1');
  assert.equal(submitted.status, 201, JSON.stringify(submitted.json));
  const responseId = receiptResponseId(submitted.json);

  await setRepublished(true);
  try {
    // Versi terbit terbaru kini v2, sedangkan assignment dan respons tetap di v1.
    const byAssignment = await request(`/integration/survey-data?survey_id=s_demo2&assignment_id=${invitation.assignment_id}`);
    assert.equal(byAssignment.status, 200, JSON.stringify(byAssignment.json));
    assert.equal(byAssignment.json.pagination?.total, 1);
    assert.equal(byAssignment.json.survey_version, 1);
    const rows = byAssignment.json.data as Array<Record<string, unknown>>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.response_id, responseId);
    assert.equal(rows[0]!.assignment_id, invitation.assignment_id);

    for (const matchingVersion of ['v_demo2_1', '1']) {
      const same = await request(
        `/integration/survey-data?survey_id=s_demo2&assignment_id=${invitation.assignment_id}&version=${matchingVersion}`,
      );
      assert.equal(same.status, 200, JSON.stringify(same.json));
      assert.equal(same.json.pagination?.total, 1, `versi ${matchingVersion}`);
    }

    const mismatched = await request(
      `/integration/survey-data?survey_id=s_demo2&assignment_id=${invitation.assignment_id}&version=v_demo2_2`,
    );
    assert.equal(mismatched.status, 200, JSON.stringify(mismatched.json));
    assert.equal(mismatched.json.pagination?.total, 0);
    assert.deepEqual(assignmentIds(mismatched.json), []);
  } finally {
    await setRepublished(false);
  }
});

test('GET status assignment sebelum submit melaporkan belum ada respons', async () => {
  const created = await createInvitation('s_demo2', { participant_ref: 'becraft-status-001', label: 'Status · 1' });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const invitation = invitationData(created.json.data);

  const status = await request(`/integration/surveys/s_demo2/assignments/${invitation.assignment_id}`);
  assert.equal(status.status, 200, JSON.stringify(status.json));
  const data = status.json.data as Record<string, unknown>;
  assert.equal(data.assignment_id, invitation.assignment_id);
  assert.equal(data.survey_id, 's_demo2');
  assert.equal(data.participant_ref, 'becraft-status-001');
  assert.equal(data.label, 'Status · 1');
  assert.equal(data.version_id, 'v_demo2_1');
  assert.equal(data.invitation_status, 'active');
  assert.equal(data.submitted, false);
  assert.equal(data.submitted_at, null);
  assert.equal(data.response_id, null);
});

test('GET status assignment sesudah submit melaporkan response_id', async () => {
  const created = await createInvitation('s_demo2', { participant_ref: 'becraft-status-002', label: 'Status · 2' });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const invitation = invitationData(created.json.data);
  const submitted = await submitInvitation(invitation.token, 'm13-status-submit-1');
  assert.equal(submitted.status, 201, JSON.stringify(submitted.json));
  const responseId = receiptResponseId(submitted.json);

  const status = await request(`/integration/surveys/s_demo2/assignments/${invitation.assignment_id}`);
  assert.equal(status.status, 200, JSON.stringify(status.json));
  const data = status.json.data as Record<string, unknown>;
  assert.equal(data.invitation_status, 'used');
  assert.equal(data.submitted, true);
  assert.equal(data.response_id, responseId);
  assert.equal(typeof data.submitted_at, 'string');
  assert.ok(data.submitted_at);
});

test('GET status assignment di luar cakupan atau bukan milik survei mengembalikan 404', async () => {
  await setOrganizationScope('org_perpus');
  try {
    const outOfScope = await request('/integration/surveys/s_demo2/assignments/a_demo02');
    assert.equal(outOfScope.status, 404, JSON.stringify(outOfScope.json));
    assert.equal(outOfScope.json.code, 'not_found');
  } finally {
    await setOrganizationScope('org_smk');
  }

  const missing = await request('/integration/surveys/s_demo2/assignments/a_tidak_ada');
  assert.equal(missing.status, 404, JSON.stringify(missing.json));
  assert.equal(missing.json.code, 'not_found');

  const otherSurvey = await request('/integration/surveys/s_demo1/assignments/a_perpus01');
  assert.equal(otherSurvey.status, 404, JSON.stringify(otherSurvey.json));
  assert.equal(otherSurvey.json.code, 'not_found');
});