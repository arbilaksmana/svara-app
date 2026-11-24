import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { after, before, test } from 'node:test';
import { closeTestDatabase, resetTestDatabase } from './test-db.ts';
import type { QuestionPayload } from '../../src/lib/api.ts';
import { app } from '../app.ts';
import { get, run } from '../db.ts';
import { sha256Hex } from '../http.ts';
import { seedDemoIfEmpty } from '../seed-data.ts';

// KP-04/NR-05: undangan yang diterbitkan untuk versi lama harus menyajikan versi terbit terbaru (remap,
// sama seperti tautan umum) dan mewajibkan persetujuan ulang untuk versi+notice baru.

process.env.NODE_ENV = 'test';
process.env.SEED_DEMO = '1';
process.env.SEED_PASSWORD = 'SvaraDemo123!';

interface PublicBody {
  data?: unknown;
  code?: string;
}

interface InvitationContext {
  state: 'active' | 'closed' | 'expired' | 'revoked' | 'used';
  canSubmit: boolean;
  consent_version: string;
  version: { number: number; notice_version: string };
  invitation: { code: string; status: string } | null;
}

let server: Server;
let base: string;
let creator: string;
let counter = 0;

async function request(path: string, method = 'GET', body?: unknown, cookie?: string) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'X-Svara-Client': 'web', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const json: PublicBody = text ? (JSON.parse(text) as PublicBody) : {};
  return { status: response.status, json, headers: response.headers, text };
}

async function managed<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await request(path, method, body, creator);
  assert.ok(response.status < 400, `${method} ${path}: ${response.status} ${response.text}`);
  return response.json.data as T;
}

function likert(code: string, label: string): QuestionPayload {
  return {
    code, type: 'likert', required: true, section: 'Bagian 1', label, hint: null,
    group_code: null, dimension_code: null, direction: null,
    options: ['Sangat setuju', 'Setuju', 'Netral', 'Tidak setuju', 'Sangat tidak setuju'].map((option, index) => ({
      label: option, value: index + 1,
    })),
  };
}

interface Fixture {
  invitationId: string;
  token: string;
  surveyId: string;
  v1: { id: string; number: number };
}

/**
 * Survei baru milik creator a: v1 terbit, satu penugasan, satu undangan `active` pada v1. Survei baru
 * dipakai per skenario agar status versi/survei tidak saling mewarisi antar-test.
 */
async function fixture(label: string): Promise<Fixture> {
  counter += 1;
  const title = `KP-04 undangan ${label} ${counter}`;
  const created = await managed<{ survey: { id: string } }>('/surveys', 'POST', { title });
  const path = `/surveys/${created.survey.id}`;
  await managed(path, 'PUT', {
    title,
    purpose: 'Mengukur pengalaman peserta setelah sesi pelatihan.',
    object_label: 'Sesi pelatihan',
    instructions: 'Pilih satu jawaban.',
    questions: [likert('KP01', 'Materi sesi mudah dipahami.')],
  });
  const v1 = await managed<{ version: { id: string; number: number } }>(`${path}/publish`, 'POST');
  // Simpan draf v2 lebih dulu agar publish kedua benar-benar menerbitkan versi baru.
  await managed(path, 'PUT', {
    title,
    purpose: 'Mengukur pengalaman peserta setelah sesi pelatihan.',
    object_label: 'Sesi pelatihan',
    instructions: 'Pilih satu jawaban.',
    questions: [likert('KP01', 'Materi sesi mudah dipahami.'), likert('KP02', 'Waktu sesi cukup untuk praktik.')],
  });

  const invitationId = `inv_kp04_${counter}`;
  // Bentuk token undangan (18 byte base64url = 24 karakter) agar `/s/:token` menerimanya.
  const token = randomBytes(18).toString('base64url');
  await run(
    `INSERT INTO assignments (id, survey_id, version_id, label, participant_ref) VALUES (?, ?, ?, ?, ?)`,
    `a_kp04_${counter}`,
    created.survey.id,
    v1.version.id,
    `Uji KP-04 ${counter}`,
    `kp04-${counter}`,
  );
  await run(
    `INSERT INTO invitations (id, assignment_id, survey_id, version_id, code, token_hash, status, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    invitationId,
    `a_kp04_${counter}`,
    created.survey.id,
    v1.version.id,
    `UND-KP04-${counter}`,
    sha256Hex(token),
    new Date(Date.now() + 86_400_000).toISOString(),
    new Date().toISOString(),
  );
  return { invitationId, token, surveyId: created.survey.id, v1: { id: v1.version.id, number: v1.version.number } };
}

/** Terbitkan draf survei milik versi yang diberikan; cukup butuh id versi sumber. */
async function publishNext(surveyPathVersion: { v1: { id: string } }) {
  const survey = await get<{ survey_id: string }>('SELECT survey_id FROM survey_versions WHERE id = ?', surveyPathVersion.v1.id);
  assert.ok(survey);
  return managed<{ version: { id: string; number: number; notice_version: string } }>(
    `/surveys/${survey.survey_id}/publish`,
    'POST',
  );
}

before(async () => {
  await resetTestDatabase();
  await seedDemoIfEmpty();
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}/api/v1`;
  const login = await request('/auth/login', 'POST', { email: 'creator.a@svara.local', password: 'SvaraDemo123!' });
  assert.equal(login.status, 200, login.text);
  creator = login.headers.get('set-cookie')!.split(';')[0]!;
});

after(async () => {
  if (server) {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    server.close((error) => (error ? reject(error) : resolve()));
    await promise;
  }
  await closeTestDatabase();
});

test('KP-04: undangan v1 menyajikan versi terbit terbaru sebagai active', async () => {
  const { token, v1 } = await fixture('remap');
  const before = await request(`/public/surveys/${token}`);
  assert.equal(before.status, 200, before.text);
  const initial = before.json.data as InvitationContext;
  assert.equal(initial.state, 'active', 'setup: undangan pada versi terbit aktif');
  assert.equal(initial.version.number, v1.number);

  const v2 = await publishNext({ v1 });
  assert.equal(v2.version.number, v1.number + 1);
  const closed = await get<{ status: string }>('SELECT status FROM survey_versions WHERE id = ?', v1.id);
  assert.equal(closed?.status, 'closed', 'setup: publish menutup versi lama');

  const response = await request(`/public/surveys/${token}`);
  assert.equal(response.status, 200, response.text);
  const context = response.json.data as InvitationContext;
  assert.equal(context.state, 'active');
  assert.equal(context.canSubmit, true);
  assert.equal(context.version.number, v2.version.number);
  assert.equal(context.version.notice_version, v2.version.notice_version);
  assert.equal(context.invitation?.status, 'active');
  assert.notEqual(context.consent_version, initial.consent_version, 'token versi harus milik versi remap');
});

test('KP-04: remap tidak membawa consent v1; pengantar baru wajib disetujui', async () => {
  const { token, v1, surveyId } = await fixture('consent');
  const v2 = await publishNext({ v1 });
  const context = (await request(`/public/surveys/${token}`)).json.data as InvitationContext;
  assert.equal(context.version.number, v2.version.number);

  const noVersion = await request(`/public/surveys/${token}/consent`, 'POST', {
    respondent_click: true,
    eligibility: true,
    guardian_evidence_ref: 'Surat wali 7B',
  });
  assert.equal(noVersion.status, 422, noVersion.text);
  assert.equal(noVersion.json.code, 'version_id_required');

  const v1Token = Buffer.from(v1.id, 'utf8').toString('base64url');
  assert.notEqual(v1Token, context.consent_version);
  const stale = await request(`/public/surveys/${token}/consent`, 'POST', {
    version_id: v1Token,
    respondent_click: true,
    eligibility: true,
    guardian_evidence_ref: 'Surat wali 7B',
  });
  assert.equal(stale.status, 409, stale.text);
  assert.equal(stale.json.code, 'notice_changed');
  const counted = await get<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM consent_records c JOIN assignments a ON a.id = c.invitation_id
      WHERE a.survey_id = ?`,
    surveyId,
  );
  assert.equal(counted?.count, 0, 'persetujuan basi tidak boleh tercatat');

  const fresh = await request(`/public/surveys/${token}/consent`, 'POST', {
    version_id: context.consent_version,
    respondent_click: true,
    eligibility: true,
    guardian_evidence_ref: 'Surat wali 7B',
  });
  assert.equal(fresh.status, 201, fresh.text);
  const consentId = (fresh.json.data as { consent_id: string }).consent_id;
  const stored = await get<{ version_id: string }>('SELECT version_id FROM consent_records WHERE id = ?', consentId);
  assert.equal(stored?.version_id, v2.version.id, 'persetujuan tercatat pada versi remap');
  const scoped = await get<{ count: number }>(
    'SELECT COUNT(*)::int AS count FROM consent_records WHERE id = ? AND invitation_id IS NOT NULL',
    consentId,
  );
  assert.equal(scoped?.count, 1, 'persetujuan terikat pada undangan yang diremap');
});

test('KP-04: undangan used/revoked/expired tidak diremap', async () => {
  const { token, v1 } = await fixture('status');
  const v2 = await publishNext({ v1 });
  const cases = ['used', 'revoked', 'expired'] as const;
  for (const status of cases) {
    await run("UPDATE invitations SET status = ? WHERE token_hash = ?", status, sha256Hex(token));
    const response = await request(`/public/surveys/${token}`);
    assert.equal(response.status, 200, `${status}: ${response.text}`);
    const context = response.json.data as InvitationContext;
    assert.equal(context.state, status, `undangan ${status} harus tetap ${status}`);
    assert.equal(context.canSubmit, false, `${status}: tidak boleh dapat dikirim`);
    assert.equal(context.version.number, v1.number, `${status}: tidak diremap`);
  }
  assert.equal(v2.version.number, v1.number + 1);
});

test('KP-04: survei tidak terbit tetap closed walau ada versi terbit yang lebih baru', async () => {
  const { token, v1 } = await fixture('closed-survey');
  await publishNext({ v1 });
  const surveyId = (await get<{ survey_id: string }>('SELECT survey_id FROM survey_versions WHERE id = ?', v1.id))!.survey_id;
  await run("UPDATE surveys SET status = 'draft' WHERE id = ?", surveyId);
  const response = await request(`/public/surveys/${token}`);
  assert.equal(response.status, 200, response.text);
  const context = response.json.data as InvitationContext;
  assert.equal(context.state, 'closed');
  assert.equal(context.canSubmit, false);
});

test('KP-04: tanpa versi terbit terbaru undangan tetap closed', async () => {
  const { token, v1 } = await fixture('no-successor');
  // Versi undangan ditutup tanpa penerbitan pengganti (sama seperti close survei).
  const surveyId = (await get<{ survey_id: string }>('SELECT survey_id FROM survey_versions WHERE id = ?', v1.id))!.survey_id;
  await managed(`/surveys/${surveyId}/close`, 'POST');
  const response = await request(`/public/surveys/${token}`);
  assert.equal(response.status, 200, response.text);
  const context = response.json.data as InvitationContext;
  assert.equal(context.state, 'closed');
  assert.equal(context.canSubmit, false);
  assert.equal(context.version.number, v1.number, 'tidak ada versi pengganti; versi undangan tetap disajikan');
});

