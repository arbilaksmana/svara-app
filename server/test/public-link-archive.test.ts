import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { after, before, test } from 'node:test';
import { closeTestDatabase, resetTestDatabase } from './test-db.ts';
import type { QuestionPayload, SurveyPayload } from '../../src/lib/api.ts';
import { app } from '../app.ts';
import { all, get, run } from '../db.ts';
import { seedDemoIfEmpty } from '../seed-data.ts';

process.env.NODE_ENV = 'test';
process.env.SEED_DEMO = '1';
process.env.SEED_PASSWORD = 'SvaraDemo123!';

interface Detail {
  survey: { id: string };
  versions: Array<{ id: string; status: string; number: number }>;
}

let server: Server;
let base: string;
let cookie: string;

async function request(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'X-Svara-Client': 'web', 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({})) as {
    code?: string; error?: string; data?: unknown;
  };
  return { status: response.status, json, headers: response.headers };
}

async function call<T>(path: string, method = 'GET', body?: unknown) {
  const response = await request(path, method, body, { Cookie: cookie });
  assert.ok(response.status < 400, `${method} ${path}: ${response.status} ${JSON.stringify(response.json)}`);
  return response.json.data as T;
}

before(async () => {
  await resetTestDatabase();
  await seedDemoIfEmpty();
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}/api/v1`;
  cookie = (await request('/auth/login', 'POST', { email: 'creator.a@svara.local', password: 'SvaraDemo123!' })).headers
    .get('set-cookie')!.split(';')[0]!;
});

after(async () => {
  if (server) {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    server.close((error) => error ? reject(error) : resolve());
    await promise;
  }
  await closeTestDatabase();
});

function question(code: string): QuestionPayload {
  return {
    code, type: 'single_choice', required: true, section: 'Bagian 1', label: `Pertanyaan ${code}`,
    hint: null, group_code: null, dimension_code: null, direction: null,
    options: [{ label: 'Tidak', value: 0 }, { label: 'Ya', value: 1 }],
  };
}

async function fixture() {
  const created = await call<Detail>('/surveys', 'POST', { title: `Uji tautan arsip ${Math.random()}` });
  const id = created.survey.id;
  const payload: SurveyPayload = {
    title: 'Uji tautan arsip', purpose: 'Menguji penutupan tautan', object_label: 'Peserta', instructions: '',
    questions: [question('Q1'), question('Q2')],
  };
  await call<Detail>(`/surveys/${id}`, 'PUT', payload);
  const publish = () => call<{ version: { id: string; number: number }; publicLink: { token: string } }>(`/surveys/${id}/publish`, 'POST');
  const first = await publish();
  const link = (versionId: string) => get<{ id: string; status: string; closed_reason: string | null }>(
    'SELECT id, status, closed_reason FROM public_links WHERE survey_id = ? AND version_id = ?',
    id,
    versionId,
  );
  const setStatus = (versionId: string, status: string, closedReason: string | null = null) => get(
    'UPDATE public_links SET status = ?, closed_reason = ? WHERE survey_id = ? AND version_id = ? RETURNING id',
    status,
    closedReason,
    id,
    versionId,
  );
  const publishNew = async () => {
    payload.questions[0]!.label = `Pertanyaan baru ${Math.random()}`;
    await call<Detail>(`/surveys/${id}`, 'PUT', payload);
    return publish();
  };
  const responses = () => all('SELECT id, version_id FROM responses WHERE survey_id = ?', id);
  return { id, first, publishNew, link, setStatus, responses };
}

async function consentAndSubmit(token: string, key: string) {
  // Tautan dicabut: konteks sudah 409 tanpa data, jadi konsentrasi uji ada pada penolakan di endpoint consent.
  const intro = (await request(`/public/surveys/${token}`)).json.data as { consent_version?: string } | undefined;
  const versionId = intro?.consent_version ?? '';
  const consent = await request(`/public/surveys/${token}/consent`, 'POST', {
    version_id: versionId,
    respondent_click: true, eligibility: true, guardian_evidence_ref: 'Wali uji sintetis',
  });
  if (consent.status !== 200) return consent;
  const session = consent.headers.get('set-cookie')!.split(';')[0]!;
  const consentId = (consent.json.data as { consent_id: string }).consent_id;
  return request(`/public/surveys/${token}/responses`, 'POST', {
    consent_id: consentId,
    answers: [{ question_code: 'Q1', text: '0' }, { question_code: 'Q2', text: '1' }],
  }, { Cookie: session, 'Idempotency-Key': key });
}

test('Tautan revoked tetap dicabut setelah arsip lalu terbit versi baru, tanpa consent atau respons', async () => {
  const f = await fixture();
  const { token } = f.first.publicLink;
  await f.setStatus(f.first.version.id, 'revoked');
  await call(`/surveys/${f.id}/archive`, 'POST');
  assert.equal((await f.link(f.first.version.id))!.status, 'revoked', 'arsip tidak menimpa revoked');
  await f.publishNew();

  for (const path of [`/public/surveys/${token}`, `/public/surveys/${token}/form`]) {
    const response = await request(path);
    assert.equal(response.status, 409, path);
    assert.equal(response.json.code, 'link_revoked', path);
    assert.equal(response.json.data, undefined, 'isi survei tidak bocor');
  }
  const submit = await consentAndSubmit(token, 'revoked-arsip-1');
  assert.equal(submit.status, 409);
  assert.equal(submit.json.code, 'link_revoked');
  assert.deepEqual(await f.responses(), []);
  assert.equal(await get('SELECT id FROM consent_records WHERE public_link_id = ?', (await f.link(f.first.version.id))!.id), undefined);
});

test('Tautan expired tetap expired melewati arsip dan terbit ulang', async () => {
  const f = await fixture();
  const { token } = f.first.publicLink;
  await f.setStatus(f.first.version.id, 'expired');
  await call(`/surveys/${f.id}/archive`, 'POST');
  await f.publishNew();
  assert.equal((await f.link(f.first.version.id))!.status, 'expired');
  const response = await request(`/public/surveys/${token}`);
  const data = response.json.data as { state: string; canSubmit: boolean; questions: unknown[] };
  assert.equal(data.state, 'expired');
  assert.equal(data.canSubmit, false);
  assert.deepEqual(data.questions, []);
  assert.deepEqual(await f.responses(), []);
});

test('Tautan dengan expires_at lampau selalu expired, apa pun status barisnya', async () => {
  const f = await fixture();
  const { token } = f.first.publicLink;
  const past = new Date(Date.now() - 60_000).toISOString();
  for (const status of ['active', 'closed', 'used']) {
    await run('UPDATE public_links SET status = ?, expires_at = ? WHERE survey_id = ? AND version_id = ?', status, past, f.id, f.first.version.id);
    const response = await request(`/public/surveys/${token}`);
    assert.equal(response.status, 200, `${status}: ${JSON.stringify(response.json)}`);
    const data = response.json.data as { state: string; canSubmit: boolean };
    assert.equal(data.state, 'expired', `${status}: expiry harus menang atas status baris`);
    assert.equal(data.canSubmit, false, status);
  }
});

test('Tautan yang ditutup oleh publish versi baru tetap menyajikan versi terbaru; arsip mematikannya', async () => {
  const f = await fixture();
  const { token } = f.first.publicLink;
  const second = await f.publishNew();
  const stale = (await f.link(f.first.version.id))!;
  assert.equal(stale.status, 'closed');
  assert.equal(stale.closed_reason, 'superseded');
  const response = await request(`/public/surveys/${token}`);
  assert.equal(response.status, 200, JSON.stringify(response.json));
  const data = response.json.data as { state: string; canSubmit: boolean; version: { number: number } };
  assert.equal(data.state, 'active');
  assert.equal(data.canSubmit, true);
  assert.equal(data.version.number, second.version.number, 'token lama menyajikan versi terbit terbaru');

  // Arsip menutup survei: token lama berhenti menyajikan versi terbaru dan kontrak 'closed' dipakai.
  await call(`/surveys/${f.id}/archive`, 'POST');
  const archived = await request(`/public/surveys/${token}`);
  const after = archived.json.data as { state: string; canSubmit: boolean; version: { number: number } };
  assert.equal(after.state, 'closed');
  assert.equal(after.canSubmit, false);
  assert.equal(after.version.number, 1, 'tetap di versi milik tautan; tidak memuat versi baru');
});

test('Tautan used tidak berubah status saat arsip', async () => {
  const f = await fixture();
  const { token } = f.first.publicLink;
  const submit = await consentAndSubmit(token, 'used-arsip-1');
  assert.equal(submit.status, 201, JSON.stringify(submit.json));
  await f.setStatus(f.first.version.id, 'used');
  await call(`/surveys/${f.id}/archive`, 'POST');
  assert.equal((await f.link(f.first.version.id))!.status, 'used');
});

test('Archive hanya menutup tautan active; close tidak menghidupkan revoked', async () => {
  const f = await fixture();
  await f.publishNew();
  await call(`/surveys/${f.id}/archive`, 'POST');
  const closed = await all<{ status: string; closed_reason: string | null }>(
    'SELECT status, closed_reason FROM public_links WHERE survey_id = ? ORDER BY version_id',
    f.id,
  );
  assert.deepEqual(closed.map(({ status }) => status), ['closed', 'closed']);
  assert.deepEqual(
    closed.map(({ closed_reason }) => closed_reason).sort(),
    ['archived', 'superseded'],
  );

  // public_links tidak punya status 'used' (tautan terpakai tetap 'active'); 'used' diuji terpisah.
  for (const status of ['revoked', 'expired']) {
    const g = await fixture();
    await g.setStatus(g.first.version.id, status);
    await call(`/surveys/${g.id}/close`, 'POST');
    assert.equal((await g.link(g.first.version.id))!.status, status, `close tidak menimpa ${status}`);
    const probe = await request(`/public/surveys/${g.first.publicLink.token}`);
    if (status === 'revoked') {
      assert.equal(probe.status, 409);
      assert.equal(probe.json.code, 'link_revoked');
      assert.equal(probe.json.data, undefined, 'isi survei tidak bocor');
    } else {
      assert.equal(probe.status, 200, status);
      const data = probe.json.data as { state: string; canSubmit: boolean };
      assert.equal(data.state, status === 'expired' ? 'expired' : 'closed', status);
      assert.equal(data.canSubmit, false, status);
    }
  }
});

test('closed tanpa reason dari publish tetap di-remap, tetapi arsip/revoked tidak', async () => {
  const f = await fixture();
  const { token } = f.first.publicLink;
  await f.setStatus(f.first.version.id, 'closed');
  await f.publishNew();
  // Baris 'closed' tanpa alasan berasal dari data pra-014 dan baru ditutup oleh publish: perilaku
  // remap 3c9b72c dipertahankan. Yang dilarang adalah resurrect tautan revoked/archived.
  const response = await request(`/public/surveys/${token}`);
  const data = response.json.data as { state: string; canSubmit: boolean; version: { number: number } };
  assert.equal(data.state, 'active');
  assert.equal(data.canSubmit, true);
  assert.equal(data.version.number, 2);
});
