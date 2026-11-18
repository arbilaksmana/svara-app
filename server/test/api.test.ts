import { spawn, type ChildProcess } from 'node:child_process';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeTestDatabase, databaseUrl, resetTestDatabase } from './test-db.ts';

const PORT = 3191;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const INTEGRATION_TOKEN = 'token-uji-integrasi';

let server: ChildProcess | undefined;
let stopping = false;

interface Result {
  status: number;
  json: Record<string, unknown> | null;
  text: string;
  bytes: Uint8Array;
  headers: Headers;
}

async function call(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    cookie?: string;
    idempotencyKey?: string;
    headers?: Record<string, string>;
    auth?: string;
  } = {},
): Promise<Result> {
  const headers = new Headers({ 'X-Svara-Client': 'web', Accept: 'application/json' });
  if (options.cookie) headers.set('Cookie', options.cookie);
  if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey);
  if (options.auth) headers.set('Authorization', options.auth);
  for (const [key, value] of Object.entries(options.headers ?? {})) headers.set(key, value);
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    json = null;
  }
  return { status: response.status, json, text, bytes, headers: response.headers };
}

async function login(email: string, password = 'SvaraDemo123!'): Promise<string> {
  const result = await call('/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(result.status, 200, `login ${email}: ${result.text}`);
  const raw = result.headers.get('set-cookie') ?? '';
  assert.ok(raw.startsWith('svara_session='), 'cookie sesi harus terpasang');
  return raw.split(';')[0]!;
}

function data<T = Record<string, unknown>>(result: Result): T {
  assert.equal(result.status < 400, true, result.text);
  return (result.json as { data: T }).data;
}

async function waitForServer(child: ChildProcess): Promise<void> {
  let ready!: () => void;
  const signal = new Promise<void>((resolveSignal) => {
    ready = resolveSignal;
  });
  let output = '';
  const onData = (chunk: unknown) => {
    output += String(chunk);
    if (output.includes('Svara berjalan')) ready();
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
  child.once('exit', (code) => {
    if (!stopping) throw new Error(`server uji berhenti (kode ${code}): ${output}`);
  });
  await signal;
}

before(async () => {
  await resetTestDatabase();
  server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DATABASE_URL: databaseUrl,
      INTEGRATION_TOKEN,
      COOKIE_SECURE: '0',
      ENABLE_HSTS: '0',
      NODE_ENV: 'test',
      SEED_DEMO: '1',
      SEED_PASSWORD: 'SvaraDemo123!',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForServer(server);
});

after(async () => {
  stopping = true;
  server?.kill();
  await closeTestDatabase();
});

test('AC01/AC10: peran, kepemilikan, dan isolasi data creator', async () => {
  const wrong = await call('/auth/login', { method: 'POST', body: { email: 'creator.a@svara.local', password: 'salah' } });
  assert.equal(wrong.status, 401);

  const suspended = await call('/auth/login', {
    method: 'POST',
    body: { email: 'suspended@svara.local', password: 'SvaraDemo123!' },
  });
  assert.equal(suspended.status, 401);

  const creatorA = await login('creator.a@svara.local');
  const bootstrapA = data<{
    surveys: Array<{ id: string }>;
    summaries: Record<string, unknown>;
    accounts: Array<unknown>;
  }>(await call('/bootstrap', { cookie: creatorA }));
  const idsA = bootstrapA.surveys.map((survey) => survey.id).sort();
  assert.deepEqual(idsA, ['s_demo1', 's_demo2', 's_demo4']);
  assert.equal(bootstrapA.accounts.length, 0, 'creator tidak menerima daftar akun admin');

  const foreignSummary = await call('/surveys/s_demo3/summary', { cookie: creatorA });
  assert.ok([403, 404].includes(foreignSummary.status), 'survei creator B tidak boleh dibaca');

  const admin = await login('admin@svara.local');
  const bootstrapAdmin = data<{
    surveys: Array<unknown>;
    summaries: Record<string, unknown>;
    accounts: Array<unknown>;
    auditLogs: Array<unknown>;
  }>(await call('/bootstrap', { cookie: admin }));
  assert.equal(bootstrapAdmin.surveys.length, 4);
  assert.equal(bootstrapAdmin.accounts.length, 5);
  assert.ok(bootstrapAdmin.auditLogs.length > 0);
  const adminSummary = await call('/surveys/s_demo1/summary', { cookie: admin });
  assert.equal(adminSummary.status, 403, 'administrator tanpa grant tidak membaca jawaban');
  const adminCsv = await call('/surveys/s_demo1/export?version=1', { cookie: admin });
  assert.equal(adminCsv.status, 403);
});

test('Security headers: CSP dan hardening aktif pada API dan 404', async () => {
  const health = await call('/health');
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(health.headers.get('x-frame-options'), 'DENY');
  assert.equal(health.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(health.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()');
  const csp = health.headers.get('content-security-policy') ?? '';
  for (const directive of ["default-src 'self'", "script-src 'self'", "font-src 'self' data:", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'"]) {
    assert.ok(csp.includes(directive), `CSP harus memuat ${directive}`);
  }
  assert.equal(health.headers.get('strict-transport-security'), null, 'HSTS hanya dikirim saat ENABLE_HSTS=1');

  const missing = await fetch(`http://127.0.0.1:${PORT}/api/tidak-ada`, {
    headers: { 'X-Svara-Client': 'web' },
  });
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('x-content-type-options'), 'nosniff');
  assert.ok((missing.headers.get('content-security-policy') ?? '').includes("frame-ancestors 'none'"));
});

test('AC02: draf tidak lengkap tersimpan, blokir publikasi, salin konfigurasi tanpa respons', async () => {
  const cookie = await login('creator.a@svara.local');
  const created = data<{ survey: { id: string } }>(
    await call('/surveys', { method: 'POST', cookie, body: { title: 'Uji dua skala' } }),
  );
  const id = created.survey.id;

  const draft = {
    title: 'Uji dua skala',
    purpose: 'Menguji publikasi dua skala berbeda.',
    object_label: 'Objek uji',
    instructions: 'Isi semua item.',
    profile_id: 'p_perpus',
    questions: [
      {
        code: 'A01',
        type: 'likert',
        required: true,
        section: 'Bagian 1',
        label: 'Item pertama',
        hint: null,
        group_code: null,
        dimension_code: null,
        direction: null,
        options: [
          { label: 'Rendah', value: 1 },
          { label: 'Tinggi', value: 5 },
        ],
      },
      {
        code: 'A01',
        type: 'single_choice',
        required: true,
        section: 'Bagian 1',
        label: '',
        hint: null,
        group_code: null,
        dimension_code: null,
        direction: null,
        options: [{ label: '', value: 1 }],
      },
    ],
  };
  const saved = await call(`/surveys/${id}`, { method: 'PUT', cookie, body: draft });
  assert.equal(saved.status, 200, 'draf dengan duplikat tetap boleh disimpan');

  const blocked = await call(`/surveys/${id}/publish`, { method: 'POST', cookie });
  assert.equal(blocked.status, 422);
  const payload = blocked.json as { error: string; code: string; details?: { errors?: string[] } };
  assert.equal(payload.code, 'publish_blocked');
  assert.ok((payload.details?.errors ?? []).some((message) => message.includes('duplikat')));
  assert.ok((payload.details?.errors ?? []).some((message) => message.includes('dua opsi')));

  const fixed = {
    ...draft,
    questions: [
      draft.questions[0],
      {
        ...draft.questions[1],
        code: 'B01',
        label: 'Pilih satu',
        options: [
          { label: 'Ya', value: 1 },
          { label: 'Tidak', value: 0 },
        ],
      },
    ],
  };
  assert.equal((await call(`/surveys/${id}`, { method: 'PUT', cookie, body: fixed })).status, 200);
  const published = await call(`/surveys/${id}/publish`, { method: 'POST', cookie });
  assert.equal(published.status, 200, published.text);
  const link = data<{ publicLink: { token: string; version_id: string } }>(published).publicLink;
  assert.ok(link.token);

  const copy = data<{ survey: { id: string } }>(
    await call(`/surveys/${id}/duplicate`, { method: 'POST', cookie }),
  );
  const copyDetail = data<{ versions: Array<{ id: string; status: string }>; questions: Array<{ id: string }> }>(
    await call(`/surveys/${copy.survey.id}`, { cookie }),
  );
  assert.equal(copyDetail.versions[0]?.status, 'draft');
  const copyVersionId = copyDetail.versions[0]!.id;
  assert.equal(copyDetail.questions.length, 2);
  const publishCopy = await call(`/surveys/${copy.survey.id}/publish`, { method: 'POST', cookie });
  assert.equal(publishCopy.status, 200, publishCopy.text);
  const copySummary = await call(`/surveys/${copy.survey.id}/summary?version=${copyVersionId}`, { cookie });
  assert.equal(copySummary.status, 200);
  assert.equal((copySummary.json as { data: { total: number } }).data.total, 0);
});

test('AC02/AC04: mengubah versi terbit membuat draf dan tautan lama tetap melayani versi lama', async () => {
  const cookie = await login('creator.a@svara.local');
  const detail = data<{
    survey: { id: string; current_version_id: string };
    versions: Array<{ id: string; number: number; status: string }>;
    questions: Array<{
      id: string;
      version_id: string;
      code: string;
      section: string;
      label: string;
      type: string;
      required: boolean;
      hint: string | null;
      group_code: string | null;
      dimension_code: string | null;
      options: Array<{ label: string; value: number }>;
    }>;
  }>(await call('/surveys/s_demo1', { cookie }));
  const published = detail.versions.find((version) => version.status === 'published');
  assert.ok(published);
  const currentQuestions = detail.questions.filter((question) => question.version_id === published.id);
  assert.ok(currentQuestions.length > 0);
  const input = {
    title: 'Pengalaman penggunaan alat bantu tugas (uji)',
    purpose: 'Tujuan diperbarui untuk versi baru.',
    object_label: 'Alat bantu tugas desain',
    instructions: 'Petunjuk baru.',
    profile_id: 'p_smk',
    questions: currentQuestions.slice(0, 3).map((question) => ({
      code: question.code,
      type: question.type,
      required: question.required,
      section: question.section,
      label: question.label,
      hint: question.hint,
      group_code: question.group_code,
      dimension_code: question.dimension_code,
      direction: null,
      options: question.options.map((option) => ({ label: option.label, value: option.value })),
    })),
  };
  const saved = await call('/surveys/s_demo1', { method: 'PUT', cookie, body: input });
  assert.equal(saved.status, 200, saved.text);
  const after = data<{
    versions: Array<{ id: string; number: number; status: string }>;
    survey: { current_version_id: string };
  }>(await call('/surveys/s_demo1', { cookie }));
  const draft = after.versions.find((version) => version.status === 'draft' && version.number >= 2);
  assert.ok(draft, 'versi draf baru dibuat');
  assert.equal(after.survey.current_version_id, draft.id);

  const legacy = await call('/public/surveys/link-umum-demo');
  assert.equal(legacy.status, 200);
  assert.equal((legacy.json as { data: { version: { id: string } } }).data.version.id, published.id);
});

test('AC05/AC06/AC07: consent server-side, validasi, satu undangan satu respons, retry bukti sama', async () => {
  const creator = await login('creator.a@svara.local');
  const fresh = data<{ token: string }>(
    await call('/surveys/s_demo1/invitations', {
      method: 'POST',
      cookie: creator,
      body: { label: 'Uji consent', expires_at: '2027-01-01' },
    }),
  );
  const token = fresh.token;
  const base = await call(`/public/surveys/${token}`);
  const baseData = data<{ questions: unknown[]; guardianRequired: boolean; canSubmit: boolean }>(base);
  assert.equal(baseData.questions.length, 0, 'metadata publik tidak membocorkan item sebelum consent');
  assert.equal(baseData.guardianRequired, true);

  const noConsentForm = await call(`/public/surveys/${token}/form`);
  assert.equal(noConsentForm.status, 403);
  assert.equal((noConsentForm.json as { code: string }).code, 'consent_required');

  const missingGuardian = await call(`/public/surveys/${token}/consent`, {
    method: 'POST',
    body: { respondent_click: true, eligibility: true },
  });
  assert.equal(missingGuardian.status, 422);

  const consent = data<{ consent_id: string }>(
    await call(`/public/surveys/${token}/consent`, {
      method: 'POST',
      body: { respondent_click: true, eligibility: true, guardian_evidence_ref: 'ref-wali-uji' },
    }),
  );
  const form = data<{
    questions: Array<{ code: string; type: string; required: boolean; option_ids: string[] }>;
    options: Array<{ id: string }>;
  }>(await call(`/public/surveys/${token}/form?consent_id=${consent.consent_id}`));
  assert.equal(form.questions.length, 3);

  const missingAnswers = await call(`/public/surveys/${token}/responses`, {
    method: 'POST',
    idempotencyKey: 'kunci-validasi-001',
    body: { consent_id: consent.consent_id, version_id: 'v_demo1_1', answers: [] },
  });
  assert.equal(missingAnswers.status, 422);
  const issues = (missingAnswers.json as { details: { fields: string[] } }).details.fields;
  assert.deepEqual(issues, ['AD01', 'TS01']);

  const body = {
    consent_id: consent.consent_id,
    version_id: 'v_demo1_1',
    answers: [
      { question_code: 'AD01', option_id: 'q_ad01_opt3' },
      { question_code: 'TS01', option_id: 'q_ts01_opt2' },
      { question_code: 'K02', text: 'Kendala kecil.' },
    ],
  };
  const noConsent = await call(`/public/surveys/${token}/responses`, {
    method: 'POST',
    idempotencyKey: 'kunci-validasi-002',
    body: { ...body, consent_id: '' },
  });
  assert.equal(noConsent.status, 403);

  const ambientCreator = creator;
  const created = await call(`/public/surveys/${token}/responses`, {
    method: 'POST',
    idempotencyKey: 'kunci-undangan-0001',
    cookie: ambientCreator,
    body,
  });
  assert.equal(created.status, 201, created.text);
  const receipt = data<{ response_id: string }>(created);

  const auditRows = data<Array<{ action: string; actor: string; metadata: string | null }>>(
    await call('/admin/audit?limit=500', { cookie: await login('admin@svara.local') }),
  );
  const responseAudit = auditRows.find(
    (row) => row.action === 'Kirim respons' && row.metadata?.includes(receipt.response_id),
  );
  assert.equal(responseAudit?.actor, 'publik', 'submission publik tidak boleh memakai akun dari cookie ambient');
  assert.ok(
    auditRows.filter((row) => row.action === 'Kirim respons').every((row) => row.actor === 'publik'),
    'semua audit Kirim respons lewat route publik harus memakai aktor publik',
  );

  const replay = await call(`/public/surveys/${token}/responses`, {
    method: 'POST',
    idempotencyKey: 'kunci-undangan-0001',
    body,
  });
  assert.equal(replay.status, 200, 'retry harus mengembalikan bukti yang sama');
  assert.equal(data<{ response_id: string }>(replay).response_id, receipt.response_id);

  const conflict = await call(`/public/surveys/${token}/responses`, {
    method: 'POST',
    idempotencyKey: 'kunci-undangan-0001',
    body: { ...body, answers: [] },
  });
  assert.equal(conflict.status, 422, 'isi berbeda dengan kunci sama tidak membuat respons baru');

  const second = await call(`/public/surveys/${token}/responses`, {
    method: 'POST',
    idempotencyKey: 'kunci-undangan-0002',
    body,
  });
  assert.equal(second.status, 409, 'undangan terpakai tidak menerima respons kedua');

  const wrongReceipt = await call(`/public/surveys/${token}/receipt/${receipt.response_id}`, {
    headers: { 'Idempotency-Key': 'kunci-lain-000000' },
  });
  assert.equal(wrongReceipt.status, 404);
  const rightReceipt = await call(`/public/surveys/${token}/receipt/${receipt.response_id}`, {
    headers: { 'Idempotency-Key': 'kunci-undangan-0001' },
  });
  assert.equal(rightReceipt.status, 200);
});

test('AC03: tautan umum, kedaluwarsa, pencabutan, dan kode undangan', async () => {
  const cookie = await login('creator.a@svara.local');
  const resolve = await call('/public/invitations/resolve', { method: 'POST', body: { code: 'UND-01-AKTIF' } });
  assert.equal(resolve.status, 200);
  assert.equal((resolve.json as { data: { token: string } }).data.token, 'undangan-demo');

  const past = await call('/surveys/s_demo1/invitations', {
    method: 'POST',
    cookie,
    body: { label: 'Kedaluwarsa', expires_at: '2020-01-01' },
  });
  assert.equal(past.status, 422);

  const created = data<{ invitation: { id: string; code: string }; token: string }>(
    await call('/surveys/s_demo1/invitations', {
      method: 'POST',
      cookie,
      body: { label: 'Kelas uji baru', expires_at: '2027-01-01' },
    }),
  );
  assert.ok(created.invitation.code.startsWith('UND-'));
  assert.ok(created.token.length >= 20);

  const revoked = await call(`/invitations/${created.invitation.id}/revoke`, { method: 'POST', cookie });
  assert.equal(revoked.status, 200);
  const context = await call(`/public/surveys/${created.token}`);
  assert.equal(context.status, 200);
  assert.equal((context.json as { data: { state: string; canSubmit: boolean } }).data.state, 'revoked');

  const secondRevoke = await call(`/invitations/${created.invitation.id}/revoke`, { method: 'POST', cookie });
  assert.equal(secondRevoke.status, 200);
  const stillRevoked = data<{ state: string }>(await call(`/public/surveys/${created.token}`));
  assert.equal(stillRevoked.state, 'revoked');
});

test('AC09/AC11: hasil, CSV, codebook, izin ekspor, dan audit akses', async () => {
  const creator = await login('creator.a@svara.local');
  const officer = await login('officer@svara.local');
  const creatorB = await login('creator.b@svara.local');

  const summary = data<{
    total: number;
    items: Array<{ code: string; answered: number; options: Array<{ count: number }> }>;
  }>(await call('/surveys/s_demo1/summary?version=v_demo1_1', { cookie: creator }));
  assert.ok(summary.total >= 5);
  const ad01 = summary.items.find((item) => item.code === 'AD01');
  assert.ok(ad01);
  assert.equal(ad01.options.length, 5, 'opsi tanpa pemilih tetap tampil');
  assert.equal(ad01.answered, summary.total, 'semua respons seed harus menjawab item wajib AD01');

  const officerCsv = await call('/surveys/s_demo1/export?version=v_demo1_1&format=csv', { cookie: officer });
  assert.equal(officerCsv.status, 200);
  assert.ok(officerCsv.headers.get('content-type')?.startsWith('text/csv'));
  assert.equal(officerCsv.bytes[0], 0xef, 'CSV memakai BOM UTF-8');
  assert.equal(officerCsv.bytes[1], 0xbb);
  assert.equal(officerCsv.bytes[2], 0xbf);
  const header = officerCsv.text.replace('\uFEFF', '').split('\r\n')[0]!;
  assert.equal(
    header,
    'response_id,respondent_id,survey_id,survey_version,assignment_id,collection_mode,identity_source,submitted_at,AD01,TS01,K02',
  );
  assert.ok(!header.toLowerCase().includes('token'));
  assert.ok(!header.toLowerCase().includes('name'));
  assert.ok(officerCsv.text.includes('Perlu panduan singkat.'), 'teks bebas tampil untuk penerima berizin');

  const creatorCsv = await call('/surveys/s_demo1/export?version=v_demo1_1&format=csv', { cookie: creator });
  assert.equal(creatorCsv.status, 200);
  assert.ok(!creatorCsv.text.includes('Perlu panduan singkat.'), 'teks bebas disamarkan tanpa izin');

  const denied = await call('/surveys/s_demo1/export?version=v_demo1_1&format=csv', { cookie: creatorB });
  assert.equal(denied.status, 403);

  const codebook = await call('/surveys/s_demo1/export?version=v_demo1_1&format=codebook', { cookie: officer });
  assert.equal(codebook.status, 200);
  assert.ok(codebook.text.includes('K02'));
  assert.ok(codebook.text.includes('Sangat tidak setuju'));
  const creatorCodebook = await call('/surveys/s_demo1/export?version=v_demo1_1&format=codebook', { cookie: creator });
  assert.ok(!creatorCodebook.text.includes('Ceritakan kendala'), 'item teks bebas tidak masuk codebook tanpa izin');

  const individualDenied = await call('/surveys/s_demo1/responses?version=v_demo1_1', { cookie: creator });
  assert.equal(individualDenied.status, 403);
  const individual = data<Array<{ answers: Array<{ question_code: string; text: string | null }> }>>(
    await call('/surveys/s_demo1/responses?version=v_demo1_1', { cookie: officer }),
  );
  assert.ok(individual.some((response) =>
    response.answers.some((answer) => answer.question_code === 'K02' && answer.text !== null),
  ));
  assert.ok(individual.length >= 5);

  const audit = data<Array<{ action: string; outcome: string }>>(
    await call('/admin/audit', { cookie: await login('admin@svara.local') }),
  );
  assert.ok(audit.some((log) => log.action === 'Ekspor hasil' && log.outcome === 'ditolak'));
  assert.ok(audit.some((log) => log.action === 'Baca jawaban individual' && log.outcome === 'berhasil'));

  const disabled = await call('/surveys/s_demo1/settings', {
    method: 'PUT',
    cookie: creator,
    body: { allowResults: true, allowIndividual: false },
  });
  assert.equal(disabled.status, 200);
  const settingsDenied = await call('/surveys/s_demo1/responses?version=v_demo1_1', { cookie: officer });
  assert.equal(settingsDenied.status, 403, 'pengaturan allow_individual=false menolak baca individual');
  const restored = await call('/surveys/s_demo1/settings', {
    method: 'PUT',
    cookie: creator,
    body: { allowResults: true, allowIndividual: true },
  });
  assert.equal(restored.status, 200);
});

test('AC09: formula, kutip, dan baris baru dinetralkan tanpa mengubah nilai tersimpan', async () => {
  const token = 'link-umum-demo';
  const context = data<{ version: { id: string }; guardianRequired: boolean }>(await call(`/public/surveys/${token}`));
  assert.equal(context.guardianRequired, true);
  const consent = data<{ consent_id: string }>(
    await call(`/public/surveys/${token}/consent`, {
      method: 'POST',
      body: { respondent_click: true, eligibility: true, guardian_evidence_ref: 'ref-wali-formula' },
    }),
  );
  const text = '=SUM(1,2) "kutip", baris\nbaru';
  const created = await call(`/public/surveys/${token}/responses`, {
    method: 'POST',
    idempotencyKey: 'kunci-formula-0001',
    body: {
      consent_id: consent.consent_id,
      version_id: context.version.id,
      answers: [
        { question_code: 'AD01', option_id: 'q_ad01_opt3' },
        { question_code: 'TS01', option_id: 'q_ts01_opt2' },
        { question_code: 'K02', text },
      ],
    },
  });
  assert.equal(created.status, 201);

  const cookie = await login('officer@svara.local');
  const csv = await call('/surveys/s_demo1/export?version=v_demo1_1&format=csv', { cookie });
  assert.equal(csv.status, 200);
  assert.ok(!csv.text.includes('\n=SUM'), 'formula diberi awalan kutip');
  assert.ok(csv.text.includes("'=SUM(1,2)"), 'nilai formula dinetralkan saat ekspor');
  assert.ok(csv.text.includes('""kutip""'), 'kutip ganda di-escape');
  assert.ok(csv.text.includes('baris\nbaru"'), 'baris baru dikutip');
});

test('AC12: akun, izin terpisah, dan perubahan berlaku pada permintaan berikutnya', async () => {
  const admin = await login('admin@svara.local');
  const accounts = data<{ accounts: Array<{ id: string; role: string; status: string }> }>(
    await call('/admin/accounts', { cookie: admin }),
  );
  assert.ok(accounts.accounts.length >= 4);

  const patched = await call('/admin/accounts/u_creator_b', {
    method: 'PATCH',
    cookie: admin,
    body: { status: 'suspended' },
  });
  assert.equal(patched.status, 200);
  const blockedLogin = await call('/auth/login', {
    method: 'POST',
    body: { email: 'creator.b@svara.local', password: 'SvaraDemo123!' },
  });
  assert.equal(blockedLogin.status, 401);
  await call('/admin/accounts/u_creator_b', { method: 'PATCH', cookie: admin, body: { status: 'active' } });

  const before = data<{ grants: Array<{ account_id: string }> }>(
    await call('/bootstrap', { cookie: admin }),
  );
  assert.ok(before.grants.some((grant) => grant.account_id === 'u_petugas'));

  const setGrants = await call('/admin/grants/u_petugas', {
    method: 'PUT',
    cookie: admin,
    body: {
      grants: [
        {
          survey_id: 's_demo1',
          can_read_individual: true,
          can_export: true,
          can_read_free_text: false,
        },
      ],
    },
  });
  assert.equal(setGrants.status, 200);
  const officer = await login('officer@svara.local');
  const withoutText = data<Array<{ answers: Array<{ question_code: string; text: string | null }> }>>(
    await call('/surveys/s_demo1/responses?version=v_demo1_1', { cookie: officer }),
  );
  assert.ok(withoutText.length > 0);
  assert.ok(withoutText.every((response) =>
    response.answers.every((answer) => answer.question_code !== 'K02' || answer.text === null),
  ));
});

test('Postgres: statistik admin mengagregasi kreator dan survei', async () => {
  const admin = await login('admin@svara.local');
  const stats = data<{
    perCreator: Array<{ id: string; surveys: number; responses: number }>;
    perSurvey: Array<{ id: string; title: string; owner: string; versions: number; responses: number }>;
  }>(await call('/admin/stats', { cookie: admin }));
  assert.ok(stats.perCreator.length >= 1);
  assert.ok(stats.perSurvey.length >= 1);
  assert.ok(stats.perSurvey.every((row) => typeof row.owner === 'string'));
});

test('AC14: event integrasi, retry tanpa status palsu, dan API layanan terbatas', async () => {
  const admin = await login('admin@svara.local');
  const events = data<Array<{ event_id: string; status: string; response_id: string | null }>>(
    await call('/admin/integration', { cookie: admin }),
  );
  const failed = events.find((event) => event.event_id === 'ev_demo03');
  assert.ok(failed);
  const retryFailed = await call(`/admin/integration/${failed.event_id}/retry`, { method: 'POST', cookie: admin });
  assert.equal(retryFailed.status, 409);
  const afterRetry = data<Array<{ event_id: string; status: string; attempts: number }>>(
    await call('/admin/integration', { cookie: admin }),
  );
  const stillFailed = afterRetry.find((event) => event.event_id === 'ev_demo03');
  assert.equal(stillFailed?.status, 'failed');
  assert.ok((stillFailed?.attempts ?? 0) > 0);

  const retryDelivered = await call('/admin/integration/ev_demo02/retry', { method: 'POST', cookie: admin });
  assert.equal(retryDelivered.status, 200);
  assert.equal((retryDelivered.json as { data: { status: string } }).data.status, 'delivered');

  const unauthorized = await call('/integration/survey-data?survey_id=s_demo1');
  assert.equal(unauthorized.status, 401);
  const scoped = await call('/integration/survey-data?survey_id=s_demo1&version=1&limit=2&offset=0', {
    auth: `Bearer ${INTEGRATION_TOKEN}`,
  });
  assert.equal(scoped.status, 200, scoped.text);
  const scopedData = scoped.json as {
    simulated: boolean;
    pagination: { total: number; limit: number };
    columns: string[];
    data: Array<{ answers: Array<{ question_code: string }> }>;
  };
  assert.equal(scopedData.simulated, true);
  assert.equal(scopedData.pagination.limit, 2);
  assert.ok(scopedData.data.length <= 2);
  assert.ok(!scopedData.columns.includes('text'));
  assert.ok(!JSON.stringify(scopedData.data).includes('Perlu panduan singkat.'));

  const byVersionId = await call('/integration/survey-data?survey_id=s_demo1&version=v_demo1_1&limit=1', {
    auth: `Bearer ${INTEGRATION_TOKEN}`,
  });
  assert.equal(byVersionId.status, 200, byVersionId.text);
  const byVersionJson = byVersionId.json;
  assert.ok(byVersionJson && typeof byVersionJson.survey_version === 'number');
  assert.equal(byVersionJson.survey_version, 1);

  const audit = data<Array<{ action: string; actor: string }>>(await call('/admin/audit', { cookie: admin }));
  assert.ok(audit.some((log) => log.actor === 'layanan-15'));
});

test('AC13: 30 kiriman paralel pada satu tautan umum masing-masing menghasilkan satu respons', async () => {
  const token = 'link-umum-perpus';
  const context = data<{ version: { id: string } }>(await call(`/public/surveys/${token}`));
  const consents = await Promise.all(
    Array.from({ length: 30 }, () =>
      call(`/public/surveys/${token}/consent`, {
        method: 'POST',
        body: { respondent_click: true, eligibility: true },
      }),
    ),
  );
  consents.forEach((consent) => assert.equal(consent.status, 201, consent.text));
  const responses = await Promise.all(
    consents.map((consent, index) => {
      const consentId = (consent.json as { data: { consent_id: string } }).data.consent_id;
      return call(`/public/surveys/${token}/responses`, {
        method: 'POST',
        idempotencyKey: `beban-kunci-${index}-abcdef`,
        body: {
          consent_id: consentId,
          version_id: context.version.id,
          answers: [
            { question_code: 'P01', option_id: 'q_p01_opt3' },
            { question_code: 'P02', option_id: 'q_p02_opt2' },
          ],
        },
      });
    }),
  );
  const statuses = responses.map((result) => result.status);
  assert.deepEqual(statuses, Array.from({ length: 30 }, () => 201));
  const ids = new Set(
    responses.map((result) => (result.json as { data: { response_id: string } }).data.response_id),
  );
  assert.equal(ids.size, 30, 'tidak ada respons tergabung atau hilang');

  const creator = await login('creator.a@svara.local');
  const summary = data<{ total: number }>(
    await call('/surveys/s_demo2/summary?version=v_demo2_1', { cookie: creator }),
  );
  assert.ok(summary.total >= 30);
});

test('Permintaan data publik dapat ditindaklanjuti admin tanpa memuat jawaban', async () => {
  const created = await call('/data-requests', {
    method: 'POST',
    body: { type: 'access', contact: 'pemohon@contoh.test', note: 'Minta salinan data saya.' },
  });
  assert.equal(created.status, 201);
  const id = (created.json as { data: { id: string } }).data.id;
  const admin = await login('admin@svara.local');
  const patched = await call(`/admin/data-requests/${id}`, {
    method: 'PATCH',
    cookie: admin,
    body: { status: 'handled', outcome_note: 'Sudah diverifikasi.' },
  });
  assert.equal(patched.status, 200);
});
