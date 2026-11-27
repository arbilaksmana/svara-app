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
    pagination?: { limit: number; offset: number; total: number };
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
  options: { method?: string; body?: unknown; auth?: string | null; cookie?: string; idempotencyKey?: string } = {},
): Promise<Result> {
  const headers: Record<string, string> = {
    'X-Svara-Client': 'web',
    Accept: 'application/json',
  };
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
  return request(`/integration/surveys/${surveyId}/invitations`, { method: 'POST', body });
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

before(async () => {
  await resetTestDatabase();
  await seedDemoIfEmpty();
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
  const noHeader = await request('/integration/surveys/s_demo1/invitations', {
    method: 'POST',
    auth: null,
    body: { participant_ref: 'p-2', label: 'L-2' },
  });
  assert.equal(noHeader.status, 401, JSON.stringify(noHeader.json));

  const wrongBearer = await request('/integration/surveys/s_demo1/invitations', {
    method: 'POST',
    auth: 'not-the-service-token',
    body: { participant_ref: 'p-3', label: 'L-3' },
  });
  assert.equal(wrongBearer.status, 401, JSON.stringify(wrongBearer.json));
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