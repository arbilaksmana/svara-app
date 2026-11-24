import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { after, before, test } from 'node:test';
import { closeTestDatabase, resetTestDatabase } from './test-db.ts';
import type { QuestionPayload, SurveyPayload } from '../../src/lib/api.ts';
import { INVITATION_STATUS_LABEL, INVITATION_STATUS_TONE } from '../../src/lib/labels.ts';
import type { InvitationStatus } from '../../src/lib/types.ts';
import { app } from '../app.ts';
import { all, get, run } from '../db.ts';
import { seedDemoIfEmpty } from '../seed-data.ts';

process.env.NODE_ENV = 'test';
process.env.SEED_DEMO = '1';
process.env.SEED_PASSWORD = 'SvaraDemo123!';
const INTEGRATION_TOKEN = 'lifecycle-integration-token-0123456789';
process.env.INTEGRATION_TOKEN = INTEGRATION_TOKEN;

interface Result {
  status: number;
  json: { code?: string; error?: string; data?: unknown } & Record<string, unknown>;
  headers: Headers;
}

interface Published {
  version: { id: string; number: number };
  publicLink: { token: string };
}

interface PublicData {
  state: string;
  canSubmit: boolean;
  version: { number: number };
  questions: unknown[];
  consent_version: string;
}

interface IntegrationBody {
  survey_version?: number;
  survey_version_status?: string;
  pagination?: { total: number };
  data?: unknown[];
  code?: string;
}

let server: Server;
let base: string;
let creatorA: string;
let creatorB: string;

async function request(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}): Promise<Result> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'X-Svara-Client': 'web', 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as Result['json'];
  return { status: response.status, json, headers: response.headers };
}

async function login(email: string): Promise<string> {
  const response = await request('/auth/login', 'POST', { email, password: 'SvaraDemo123!' });
  assert.equal(response.status, 200, `login ${email}: ${JSON.stringify(response.json)}`);
  return response.headers.get('set-cookie')!.split(';')[0]!;
}

async function call<T>(cookie: string, path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await request(path, method, body, { Cookie: cookie });
  assert.ok(response.status < 400, `${method} ${path}: ${response.status} ${JSON.stringify(response.json)}`);
  return response.json.data as T;
}

function likert(code: string, label: string): QuestionPayload {
  return {
    code, type: 'likert', required: true, section: 'Bagian 1', label, hint: null,
    group_code: null, dimension_code: null, direction: null,
    options: ['Sangat tidak setuju', 'Tidak setuju', 'Netral', 'Setuju', 'Sangat setuju'].map((option, index) => ({ label: option, value: index + 1 })),
  };
}

function surveyPayload(title: string, label: string): SurveyPayload {
  return {
    title,
    purpose: 'Mengukur pengalaman peserta setelah sesi pelatihan.',
    object_label: 'Sesi pelatihan',
    instructions: 'Pilih satu jawaban.',
    questions: [likert('KP01', label), likert('KP02', 'Waktu sesi cukup untuk praktik.')],
  };
}

/** Survei terbit lewat alur pengelola: buat, simpan, terbitkan; `revise` menyimpan perubahan instrumen lalu terbit ulang. */
async function publishedSurvey(cookie: string, title: string, ownerScope: 'organization' | 'individual' = 'organization') {
  const created = await call<{ survey: { id: string } }>(cookie, '/surveys', 'POST', { title, owner_scope: ownerScope });
  const id = created.survey.id;
  await call(cookie, `/surveys/${id}`, 'PUT', surveyPayload(title, 'Materi sesi mudah dipahami.'));
  const first = await call<Published>(cookie, `/surveys/${id}/publish`, 'POST');
  const save = (label: string) => call(cookie, `/surveys/${id}`, 'PUT', surveyPayload(title, label));
  const revise = async (label: string) => {
    await save(label);
    return call<Published>(cookie, `/surveys/${id}/publish`, 'POST');
  };
  return { id, first, save, revise };
}

async function publicContext(token: string): Promise<{ status: number; data: PublicData; code?: string }> {
  const response = await request(`/public/surveys/${token}`);
  return { status: response.status, data: response.json.data as PublicData, code: response.json.code };
}

/** Alur responden lengkap: intro → consent (versi yang dirender) → kirim. */
async function consentAndSubmit(token: string, key: string) {
  const intro = await publicContext(token);
  const consent = await request(`/public/surveys/${token}/consent`, 'POST', {
    version_id: intro.data?.consent_version ?? '',
    respondent_click: true,
    eligibility: true,
    guardian_evidence_ref: 'Surat wali kelas 7B',
  });
  if (consent.status !== 201) return { consent, response: undefined };
  const session = consent.headers.get('set-cookie')!.split(';')[0]!;
  const response = await request(`/public/surveys/${token}/responses`, 'POST', {
    consent_id: (consent.json.data as { consent_id: string }).consent_id,
    answers: [{ question_code: 'KP01', text: '4' }, { question_code: 'KP02', text: '2' }],
  }, { Cookie: session, 'Idempotency-Key': key });
  return { consent, response };
}

async function integration(surveyId: string, version?: string) {
  const query = version === undefined ? '' : `&version=${encodeURIComponent(version)}`;
  const response = await request(`/integration/survey-data?survey_id=${surveyId}${query}`, 'GET', undefined, {
    Authorization: `Bearer ${INTEGRATION_TOKEN}`,
  });
  return { status: response.status, body: response.json as IntegrationBody };
}

before(async () => {
  await resetTestDatabase();
  await seedDemoIfEmpty();
  // Sama dengan server/index.ts saat start dengan INTEGRATION_ORGANIZATION_ID=org_smk.
  await run(
    'INSERT INTO integration_token_scopes (token_hash, organization_id) VALUES (?, ?)',
    createHash('sha256').update(INTEGRATION_TOKEN).digest('hex'),
    'org_smk',
  );
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}/api/v1`;
  creatorA = await login('creator.a@svara.local');
  creatorB = await login('creator.b@svara.local');
});

after(async () => {
  if (server) {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    server.close((error) => (error ? reject(error) : resolve()));
    await promise;
  }
  await closeTestDatabase();
});

test('M1: Modul 15 membaca v1 yang ditutup oleh terbitnya v2, dengan status versinya', async () => {
  const survey = await publishedSurvey(creatorA, 'Evaluasi pelatihan guru piket');
  const sent = await consentAndSubmit(survey.first.publicLink.token, 'lifecycle-m1-0001');
  assert.equal(sent.response?.status, 201, JSON.stringify(sent.response?.json ?? sent.consent.json));
  const second = await survey.revise('Materi sesi relevan dengan tugas piket.');
  assert.equal(second.version.number, 2);

  for (const version of ['1', survey.first.version.id]) {
    const v1 = await integration(survey.id, version);
    assert.equal(v1.status, 200, `version=${version} sesudah v2 terbit: ${JSON.stringify(v1.body)}`);
    assert.equal(v1.body.survey_version, 1);
    assert.equal(v1.body.survey_version_status, 'closed', 'konsumen diberi tahu bahwa v1 sudah ditutup');
    assert.equal(v1.body.pagination?.total, 1, 'kiriman v1 tetap terbaca');
    assert.equal(v1.body.data?.length, 1);
  }
  const latest = await integration(survey.id);
  assert.equal(latest.status, 200, JSON.stringify(latest.body));
  assert.equal(latest.body.survey_version, 2);
  assert.equal(latest.body.survey_version_status, 'published');
});

test('M1: setelah survei ditutup, Modul 15 tetap membaca versi yang pernah terbit', async () => {
  const survey = await publishedSurvey(creatorA, 'Survei kantin semester ganjil');
  await survey.revise('Menu kantin bervariasi.');
  await call(creatorA, `/surveys/${survey.id}/close`, 'POST');

  const latest = await integration(survey.id);
  assert.equal(latest.status, 200, `tanpa version setelah close: ${JSON.stringify(latest.body)}`);
  assert.equal(latest.body.survey_version, 2, 'tanpa version = versi terbit terakhir');
  assert.equal(latest.body.survey_version_status, 'closed');
  const v1 = await integration(survey.id, '1');
  assert.equal(v1.status, 200, `version=1 setelah close: ${JSON.stringify(v1.body)}`);
  assert.equal(v1.body.survey_version_status, 'closed');
});

test('M1: draf (termasuk draf yang ikut ditutup arsip) dan survei organisasi lain tetap 404', async () => {
  const survey = await publishedSurvey(creatorA, 'Survei layanan perpustakaan sekolah');
  await call(creatorA, `/surveys/${survey.id}/close`, 'POST');
  await survey.save('Draf v2 yang belum diterbitkan.');
  const draft = await get<{ id: string; number: number; status: string }>(
    "SELECT id, number, status FROM survey_versions WHERE survey_id = ? AND status = 'draft'",
    survey.id,
  );
  assert.ok(draft, 'draf v2 tersimpan');
  for (const version of [String(draft.number), draft.id]) {
    const response = await integration(survey.id, version);
    assert.equal(response.status, 404, `draf version=${version}: ${JSON.stringify(response.body)}`);
    assert.equal(response.body.code, 'version_not_found');
  }
  // Arsip menutup draf (status 'closed') tanpa pernah menerbitkannya; tetap bukan versi terbit.
  await call(creatorA, `/surveys/${survey.id}/archive`, 'POST');
  assert.equal((await get<{ status: string }>('SELECT status FROM survey_versions WHERE id = ?', draft.id))?.status, 'closed');
  const archivedDraft = await integration(survey.id, draft.id);
  assert.equal(archivedDraft.status, 404, `draf yang diarsipkan: ${JSON.stringify(archivedDraft.body)}`);
  const stillPublished = await integration(survey.id, '1');
  assert.equal(stillPublished.status, 200, 'v1 yang pernah terbit tetap terbaca setelah arsip');

  // Survei organisasi lain (org_perpus) dengan versi tertutup: tetap di luar cakupan token org_smk.
  const other = await publishedSurvey(creatorB, 'Survei anggota perpustakaan kota');
  await other.revise('Koleksi buku memadai.');
  for (const version of [undefined, '1', other.first.version.id]) {
    const response = await integration(other.id, version);
    assert.equal(response.status, 404, `organisasi lain version=${version}: ${JSON.stringify(response.body)}`);
    assert.equal(response.body.code, 'not_found');
  }
});

test('M3: tautan yang ditutup arsip tidak hidup lagi setelah simpan dan terbit ulang', async () => {
  const survey = await publishedSurvey(creatorA, 'Survei ekstrakurikuler');
  const { token } = survey.first.publicLink;
  await call(creatorA, `/surveys/${survey.id}/archive`, 'POST');
  const second = await survey.revise('Jadwal ekstrakurikuler sesuai.');

  const context = await publicContext(token);
  assert.equal(context.status, 200, JSON.stringify(context));
  assert.equal(context.data.state, 'closed', 'tautan archived tidak dilayani ulang ke versi terbaru');
  assert.equal(context.data.canSubmit, false);
  assert.equal(context.data.version.number, 1);
  assert.deepEqual(context.data.questions, []);
  const attempt = await consentAndSubmit(token, 'lifecycle-m3-arsip-0001');
  assert.equal(attempt.consent.status, 409, JSON.stringify(attempt.consent.json));
  assert.equal(attempt.consent.json.code, 'submission_closed');
  assert.equal(attempt.response, undefined);
  assert.deepEqual(await all('SELECT id FROM responses WHERE survey_id = ?', survey.id), []);
  assert.deepEqual(
    await all(
      'SELECT c.id FROM consent_records c JOIN public_links l ON l.id = c.public_link_id WHERE l.token_hash = ?',
      createHash('sha256').update(token).digest('hex'),
    ),
    [],
  );

  // Pembanding: tautan versi baru tetap bekerja, jadi penolakan di atas bukan karena terbit ulang gagal.
  const fresh = await consentAndSubmit(second.publicLink.token, 'lifecycle-m3-arsip-0002');
  assert.equal(fresh.response?.status, 201, JSON.stringify(fresh.response?.json ?? fresh.consent.json));
});

test('M3: tautan lama yang sudah superseded ikut mati saat arsip, lalu tidak hidup lagi setelah terbit ulang', async () => {
  const survey = await publishedSurvey(creatorA, 'Survei sarana laboratorium');
  const second = await survey.revise('Alat laboratorium lengkap.');
  await call(creatorA, `/surveys/${survey.id}/archive`, 'POST');
  const third = await survey.revise('Alat laboratorium terawat.');
  assert.equal(third.version.number, 3);

  for (const [index, token] of [survey.first.publicLink.token, second.publicLink.token].entries()) {
    const context = await publicContext(token);
    assert.equal(context.data.state, 'closed', `tautan v${index + 1} survei yang diarsipkan tidak menyajikan v3`);
    assert.equal(context.data.canSubmit, false);
    const attempt = await consentAndSubmit(token, `lifecycle-m3-v3-000${index}`);
    assert.equal(attempt.consent.status, 409, `consent lewat tautan v${index + 1}: ${JSON.stringify(attempt.consent.json)}`);
    assert.equal(attempt.response, undefined);
  }
  assert.deepEqual(await all('SELECT id FROM responses WHERE survey_id = ?', survey.id), [], 'tidak ada kiriman lewat tautan lama');
  const reasons = await all<{ closed_reason: string | null }>(
    'SELECT closed_reason FROM public_links WHERE survey_id = ? AND version_id <> ? ORDER BY created_at',
    survey.id,
    third.version.id,
  );
  assert.deepEqual(reasons.map((row) => row.closed_reason), ['archived', 'archived']);
});

test('M3: close menulis alasan sendiri; close → terbit ulang tetap menyajikan versi terbaru', async () => {
  const survey = await publishedSurvey(creatorA, 'Survei kepuasan bimbingan konseling');
  const { token } = survey.first.publicLink;
  await call(creatorA, `/surveys/${survey.id}/close`, 'POST');
  const closed = await get<{ status: string; closed_reason: string | null }>(
    'SELECT status, closed_reason FROM public_links WHERE token_hash = ?',
    createHash('sha256').update(token).digest('hex'),
  );
  assert.deepEqual(closed, { status: 'closed', closed_reason: 'closed' }, 'penutupan survei bukan superseded');
  assert.equal((await publicContext(token)).data.state, 'closed');

  const second = await survey.revise('Konselor mudah dihubungi.');
  const context = await publicContext(token);
  assert.equal(context.data.state, 'active');
  assert.equal(context.data.version.number, second.version.number, 'tautan lama menyajikan versi terbit terbaru');
  const sent = await consentAndSubmit(token, 'lifecycle-m3-close-0001');
  assert.equal(sent.response?.status, 201, JSON.stringify(sent.response?.json ?? sent.consent.json));
  const stored = await all<{ version_id: string }>('SELECT version_id FROM responses WHERE survey_id = ?', survey.id);
  assert.deepEqual(stored.map((row) => row.version_id), [second.version.id]);
});

test('M3: close lalu arsip lalu terbit ulang tidak menghidupkan tautan', async () => {
  const survey = await publishedSurvey(creatorA, 'Survei transportasi siswa');
  const { token } = survey.first.publicLink;
  await call(creatorA, `/surveys/${survey.id}/close`, 'POST');
  await call(creatorA, `/surveys/${survey.id}/archive`, 'POST');
  await survey.revise('Rute antar jemput tepat waktu.');
  const context = await publicContext(token);
  assert.equal(context.data.state, 'closed');
  assert.equal(context.data.canSubmit, false);
});

test('M3: tautan pra-014 (closed tanpa closed_reason) tetap closed setelah terbit ulang', async () => {
  const survey = await publishedSurvey(creatorA, 'Survei lama sebelum migrasi 014');
  const { token } = survey.first.publicLink;
  await call(creatorA, `/surveys/${survey.id}/close`, 'POST');
  // Kode main menutup tautan lewat close/arsip tanpa alasan; migrasi 014 menambah kolom bernilai NULL.
  await run(
    'UPDATE public_links SET closed_reason = NULL WHERE token_hash = ?',
    createHash('sha256').update(token).digest('hex'),
  );
  await survey.revise('Pertanyaan diperbarui setelah upgrade.');
  const context = await publicContext(token);
  assert.equal(context.data.state, 'closed', 'alasan tidak diketahui tidak dilayani ulang');
  assert.equal(context.data.canSubmit, false);
});

test('M4: bootstrap menandai undangan versi yang sudah tidak terbit sebagai ditutup', async () => {
  const survey = await publishedSurvey(creatorA, 'Survei wali murid kelas 9');
  type Created = { invitation: { id: string; code: string } };
  const active = await call<Created>(creatorA, `/surveys/${survey.id}/invitations`, 'POST', { label: 'Wali murid 9A-01' });
  const revoked = await call<Created>(creatorA, `/surveys/${survey.id}/invitations`, 'POST', { label: 'Wali murid 9A-02' });
  const lapsed = await call<Created>(creatorA, `/surveys/${survey.id}/invitations`, 'POST', { label: 'Wali murid 9A-03' });
  await call(creatorA, `/invitations/${revoked.invitation.id}/revoke`, 'POST');
  await survey.revise('Informasi sekolah mudah didapat.');
  // Batas waktu undangan ketiga sudah lewat (waktu berjalan); kedaluwarsa tetap didahulukan seperti di formulir publik.
  await run('UPDATE invitations SET expires_at = ? WHERE id = ?', new Date(Date.now() - 60_000).toISOString(), lapsed.invitation.id);
  const current = await call<Created>(creatorA, `/surveys/${survey.id}/invitations`, 'POST', { label: 'Wali murid 9A-04' });

  const boot = await call<{ invitations: Array<{ id: string; status: InvitationStatus }> }>(creatorA, '/bootstrap');
  const statusOf = (id: string) => boot.invitations.find((row) => row.id === id)?.status;
  assert.equal(statusOf(active.invitation.id), 'closed', 'undangan v1 tidak lagi ditampilkan Aktif');
  assert.equal(statusOf(revoked.invitation.id), 'revoked');
  assert.equal(statusOf(lapsed.invitation.id), 'expired');
  assert.equal(statusOf(current.invitation.id), 'active', 'undangan versi terbit saat ini tetap aktif');
  assert.equal(INVITATION_STATUS_LABEL[statusOf(active.invitation.id)!], 'Ditutup');
  assert.ok(INVITATION_STATUS_TONE[statusOf(active.invitation.id)!], 'tone badge tersedia');

  // Status tampilan saja: baris undangan tidak diubah. Formulir publik meremap ke versi terbit terbaru
  // (KP-04/NR-05), bukan tertutup.
  assert.equal((await get<{ status: string }>('SELECT status FROM invitations WHERE id = ?', active.invitation.id))?.status, 'active');
  const resolved = await request('/public/invitations/resolve', 'POST', { code: active.invitation.code });
  assert.equal(resolved.status, 200, JSON.stringify(resolved.json));
  // SEC-09: penukaran kode mengembalikan URL berisi ID undangan, bukan token mentah.
  const form = await publicContext((resolved.json.data as { url: string }).url.replace(/^\/s\//u, ''));
  assert.equal(form.data.state, 'active');
  assert.equal(form.data.version.number, 2, 'undangan v1 menyajikan versi terbit terbaru (KP-04)');
});

test('Publish menolak survei organisasi yang notice-nya tidak tersedia, lalu menerima setelah notice tersedia', async () => {
  // Profil organisasi dinaikkan ke notice 2.0 tanpa teks notice 2.0 (keadaan upgrade H1).
  await run("UPDATE organizations SET notice_version = '2.0' WHERE id = 'org_perpus'");
  try {
    const created = await call<{ survey: { id: string } }>(creatorB, '/surveys', 'POST', { title: 'Survei ruang baca anak', owner_scope: 'organization' });
    const id = created.survey.id;
    await call(creatorB, `/surveys/${id}`, 'PUT', surveyPayload('Survei ruang baca anak', 'Ruang baca nyaman.'));
    const blocked = await request(`/surveys/${id}/publish`, 'POST', undefined, { Cookie: creatorB });
    assert.equal(blocked.status, 422, `publish: ${blocked.status} ${blocked.json.code ?? ""}`);
    assert.equal(blocked.json.code, 'notice_version_unavailable');
    assert.deepEqual(
      await get('SELECT status, published_at FROM survey_versions WHERE survey_id = ?', id),
      { status: 'draft', published_at: null },
      'versi tidak terbit',
    );
    assert.equal((await get<{ status: string }>('SELECT status FROM surveys WHERE id = ?', id))?.status, 'draft');
    assert.deepEqual(await all('SELECT id FROM public_links WHERE survey_id = ?', id), [], 'tidak ada tautan yang langsung 500');

    await run(
      `INSERT INTO organization_notices (id, organization_id, version, effective_date, purpose, data_categories, module15_usage,
         retention_text, recipients, contact, rights, child_data_text, cross_border_text, created_at)
       SELECT 'on_perpus_2_0', organization_id, '2.0', '2026-11-20', purpose, data_categories, module15_usage,
              retention_text, recipients, contact, rights, child_data_text, cross_border_text, '2026-11-20T00:00:00Z'
         FROM organization_notices WHERE organization_id = 'org_perpus' AND version = '1.2'`,
    );
    const published = await call<Published>(creatorB, `/surveys/${id}/publish`, 'POST');
    const context = await publicContext(published.publicLink.token);
    assert.equal(context.status, 200, JSON.stringify(context));
    assert.equal(context.data.state, 'active');
  } finally {
    await run("UPDATE organizations SET notice_version = '1.2' WHERE id = 'org_perpus'");
  }
});

test('Publish menolak survei mandiri bila notice platform versinya tidak tersedia', async () => {
  const original = await get<{ notice_version: string }>("SELECT notice_version FROM platform_profile WHERE id = 'platform'");
  assert.ok(original);
  await run("UPDATE platform_profile SET notice_version = '9.0' WHERE id = 'platform'");
  try {
    const created = await call<{ survey: { id: string } }>(creatorA, '/surveys', 'POST', { title: 'Survei pribadi alumni', owner_scope: 'individual' });
    await call(creatorA, `/surveys/${created.survey.id}`, 'PUT', surveyPayload('Survei pribadi alumni', 'Reuni bermanfaat.'));
    const blocked = await request(`/surveys/${created.survey.id}/publish`, 'POST', undefined, { Cookie: creatorA });
    assert.equal(blocked.status, 422, `publish: ${blocked.status} ${blocked.json.code ?? ""}`);
    assert.equal(blocked.json.code, 'notice_version_unavailable');
  } finally {
    await run("UPDATE platform_profile SET notice_version = ? WHERE id = 'platform'", original.notice_version);
  }
});

test('B1: menutup survei tidak gagal karena expires_at tautan yang tak terurai', async () => {
  const survey = await publishedSurvey(creatorA, 'Survei kepuasan layanan perpustakaan sekolah');
  const { token } = survey.first.publicLink;
  await run(
    "UPDATE public_links SET expires_at = 'bukan-tanggal' WHERE token_hash = ?",
    createHash('sha256').update(token).digest('hex'),
  );
  const closed = await request(`/surveys/${survey.id}/close`, 'POST', undefined, { Cookie: creatorA });
  assert.equal(closed.status, 200, JSON.stringify(closed.json));
  const link = await get<{ status: string; closed_reason: string | null }>(
    'SELECT status, closed_reason FROM public_links WHERE token_hash = ?',
    createHash('sha256').update(token).digest('hex'),
  );
  assert.deepEqual(link, { status: 'closed', closed_reason: 'closed' });
});
