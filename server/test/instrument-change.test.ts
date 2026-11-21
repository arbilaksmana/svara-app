import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { after, before, test } from 'node:test';
import { closeTestDatabase, resetTestDatabase } from './test-db.ts';
import type { QuestionPayload, SurveyPayload } from '../../src/lib/api.ts';
import { app } from '../app.ts';
import { all } from '../db.ts';
import { seedDemoIfEmpty } from '../seed-data.ts';

process.env.NODE_ENV = 'test';
process.env.SEED_DEMO = '1';
process.env.SEED_PASSWORD = 'SvaraDemo123!';

interface Detail {
  survey: { id: string; title: string; current_version_id: string };
  versions: Array<{ id: string; status: string; number: number }>;
  questions: unknown[];
  instrumentChange: { changed: boolean; affectedResponses: number };
}

let server: Server;
let base: string;
let cookie: string;

async function call<T>(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = { Cookie: cookie }) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'X-Svara-Client': 'web', 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json() as { data: T };
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(json)}`);
  return { data: json.data, headers: response.headers };
}

before(async () => {
  await resetTestDatabase();
  await seedDemoIfEmpty();
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}/api/v1`;
  const login = await call('/auth/login', 'POST', { email: 'creator.a@svara.local', password: 'SvaraDemo123!' }, {});
  cookie = login.headers.get('set-cookie')!.split(';')[0]!;
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

async function fixture(published = true) {
  const created = await call<Detail>('/surveys', 'POST', { title: 'Uji instrumen' });
  const id = created.data.survey.id;
  const payload: SurveyPayload = {
    title: 'Uji instrumen', purpose: 'Menguji perubahan pertanyaan', object_label: 'Peserta', instructions: '',
    questions: [question('Q1'), question('Q2')],
  };
  await call<Detail>(`/surveys/${id}`, 'PUT', payload);
  const publish = () => call<{ version: { id: string }; publicLink: { token: string } }>(`/surveys/${id}/publish`, 'POST');
  const issued = published ? (await publish()).data : null;
  return {
    id, payload, issued, publish,
    save: (body = payload, preview = false) => call<Detail>(`/surveys/${id}${preview ? '?preview=true' : ''}`, 'PUT', body),
    detail: async () => (await call<Detail>(`/surveys/${id}`)).data,
  };
}

async function submit(token: string, key: string) {
  const consent = await call<{ consent_id: string }>(`/public/surveys/${token}/consent`, 'POST', {
    respondent_click: true, eligibility: true, guardian_evidence_ref: 'Wali uji sintetis',
  }, {});
  await call(`/public/surveys/${token}/responses`, 'POST', {
    consent_id: consent.data.consent_id,
    answers: [{ question_code: 'Q1', text: '0' }, { question_code: 'Q2', text: '1' }],
  }, { Cookie: consent.headers.get('set-cookie')!.split(';')[0]!, 'Idempotency-Key': key });
}

async function storedResponses(id: string) {
  return {
    responses: await all('SELECT * FROM responses WHERE survey_id = ? ORDER BY id', id),
    answers: await all(`SELECT a.* FROM answers a JOIN responses r ON r.id = a.response_id
      WHERE r.survey_id = ? ORDER BY a.response_id, a.question_code`, id),
  };
}

test('Simpan ulang pertanyaan identik: changed false, tanpa draf baru atau penulisan ulang pertanyaan', async () => {
  const f = await fixture();
  const before = await f.detail();
  const result = (await f.save()).data;
  assert.deepEqual(result.instrumentChange, { changed: false, affectedResponses: 0 });
  assert.deepEqual(result.versions, before.versions);
  assert.deepEqual(result.questions, before.questions);
  assert.equal(result.survey.current_version_id, before.survey.current_version_id);
});

test('Teks dan opsi berubah tanpa jawaban: changed true dengan affectedResponses 0', async (t) => {
  for (const published of [false, true]) {
    await t.test(published ? 'acuan versi terbit' : 'acuan draf sebelum pernah terbit', async () => {
      const f = await fixture(published);
      f.payload.questions[0]!.label = 'Teks diperbarui';
      f.payload.questions[0]!.options[0]!.label = 'Belum';
      const result = (await f.save()).data;
      assert.deepEqual(result.instrumentChange, { changed: true, affectedResponses: 0 });
      assert.ok(result.versions.some((v) => v.status === 'draft'));
      assert.deepEqual((await f.save()).data.instrumentChange, { changed: published, affectedResponses: 0 });
    });
  }
});

test('Perubahan instrumen dengan jawaban: hitungan tepat, pratinjau tanpa mutasi, jawaban tetap identik', async () => {
  const f = await fixture();
  await submit(f.issued!.publicLink.token, 'instrumen-1');
  await submit(f.issued!.publicLink.token, 'instrumen-2');
  const before = await f.detail();
  const responses = await storedResponses(f.id);
  f.payload.questions[0]!.options[0]!.value = -1;
  const preview = (await f.save(f.payload, true)).data;
  assert.deepEqual(preview.instrumentChange, { changed: true, affectedResponses: 2 });
  assert.deepEqual(await f.detail(), before, 'membatalkan konfirmasi tidak menyimpan apa pun');
  const saved = (await f.save()).data;
  assert.deepEqual(saved.instrumentChange, { changed: true, affectedResponses: 2 });
  assert.ok(saved.versions.some((v) => v.status === 'draft'));
  assert.deepEqual(await storedResponses(f.id), responses);
  const draftBefore = await f.detail();
  const repeated = (await f.save()).data;
  assert.deepEqual(repeated.instrumentChange, { changed: true, affectedResponses: 2 }, 'draf tidak menggantikan acuan terbit');
  assert.deepEqual(repeated.questions, draftBefore.questions, 'simpan ulang draf identik tidak mengganti ID pertanyaan');
});

test('Hanya metadata berubah: changed false, pertanyaan tidak tersentuh, tanpa draf baru', async () => {
  const f = await fixture();
  await submit(f.issued!.publicLink.token, 'metadata-1');
  const before = await f.detail();
  f.payload.title = 'Judul baru';
  f.payload.purpose = 'Tujuan baru';
  f.payload.object_label = 'Responden';
  f.payload.instructions = 'Petunjuk baru';
  const saved = (await f.save()).data;
  assert.deepEqual(saved.instrumentChange, { changed: false, affectedResponses: 0 });
  assert.equal(saved.survey.title, 'Judul baru');
  assert.deepEqual(saved.questions, before.questions);
  assert.deepEqual(saved.versions, before.versions);
});

test('Urutan pertanyaan dan opsi saja berubah: changed false, urutan baru tetap tersimpan', async () => {
  const f = await fixture();
  await submit(f.issued!.publicLink.token, 'urutan-1');
  f.payload.questions.reverse();
  f.payload.questions[0]!.options.reverse();
  const saved = (await f.save()).data;
  assert.deepEqual(saved.instrumentChange, { changed: false, affectedResponses: 0 });
  const draft = saved.versions.find((v) => v.status === 'draft')!;
  const questions = saved.questions as Array<{ version_id: string; code: string; options: Array<{ value: number }> }>;
  const reordered = questions.filter((q) => q.version_id === draft.id);
  assert.deepEqual(reordered.map((q) => q.code), ['Q2', 'Q1']);
  assert.deepEqual(reordered[0]!.options.map((o) => o.value), [1, 0]);
});

test('Jumlah, kode, tipe, teks, wajib, label dan nilai opsi masing-masing terdeteksi', async (t) => {
  const f = await fixture();
  const edits: Array<[string, (p: SurveyPayload) => void]> = [
    ['jumlah', (p) => { p.questions.pop(); }],
    ['kode', (p) => { p.questions[0]!.code = 'LAIN'; }],
    ['tipe', (p) => { p.questions[0]!.type = 'likert'; }],
    ['teks', (p) => { p.questions[0]!.label += ' baru'; }],
    ['wajib', (p) => { p.questions[0]!.required = false; }],
    ['label opsi', (p) => { p.questions[0]!.options[0]!.label = 'Belum'; }],
    ['nilai opsi', (p) => { p.questions[0]!.options[0]!.value = -1; }],
  ];
  for (const [name, edit] of edits) {
    await t.test(name, async () => {
      const p = structuredClone(f.payload);
      edit(p);
      assert.deepEqual((await f.save(p, true)).data.instrumentChange, { changed: true, affectedResponses: 0 });
    });
  }
});

test('Hitungan lintas versi hanya mencakup instrumen berbeda dan tidak menghitung survei lain', async () => {
  const f = await fixture();
  await submit(f.issued!.publicLink.token, 'historis-1');
  const original = structuredClone(f.payload);
  f.payload.questions[0]!.label = 'Instrumen kedua';
  await f.save();
  const second = (await f.publish()).data;
  await submit(second.publicLink.token, 'historis-2');
  await submit(second.publicLink.token, 'historis-3');
  const other = await fixture();
  await submit(other.issued!.publicLink.token, 'survei-lain');
  const before = await storedResponses(f.id);
  assert.deepEqual((await f.save(original, true)).data.instrumentChange, { changed: true, affectedResponses: 2 }, 'versi pertama identik, hanya dua jawaban versi kedua terdampak');
  f.payload.questions[0]!.label = 'Instrumen ketiga';
  assert.deepEqual((await f.save(f.payload, true)).data.instrumentChange, { changed: true, affectedResponses: 3 }, 'jawaban versi tertutup ikut dihitung');
  await call(`/surveys/${f.id}/close`, 'POST');
  assert.deepEqual((await f.save(f.payload, true)).data.instrumentChange, { changed: true, affectedResponses: 3 }, 'survei ditutup tetap dibandingkan dengan versi yang pernah terbit');
  assert.deepEqual(await storedResponses(f.id), before);
});
