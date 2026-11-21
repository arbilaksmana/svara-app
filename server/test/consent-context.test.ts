import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { after, before, test } from 'node:test';
import { Client } from 'pg';
import { closeTestDatabase, databaseUrl, resetTestDatabase } from './test-db.ts';

// Set the pool size before importing the app; the submissions must occupy two connections.
process.env.PG_POOL_MAX = '2';
const { app } = await import('../app.ts');
const { all, get, run } = await import('../db.ts');
const { sha256Hex } = await import('../http.ts');
const { seedDemoIfEmpty } = await import('../seed-data.ts');

const PUBLIC_LINK = 'link-umum-demo';
const INVITATION = 'undangan-demo';
const OTHER_INVITATION = 'undangan-konteks-lain';
let server: Server | undefined;
let base: string;

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.SEED_DEMO = '1';
  await resetTestDatabase();
  await seedDemoIfEmpty();
  const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
  await run('UPDATE invitations SET expires_at = ? WHERE token = ?', expiresAt, INVITATION);
  await run(
    `INSERT INTO assignments (id, survey_id, version_id, label, participant_ref)
     SELECT 'a_sec08', survey_id, version_id, 'Uji konteks', 'sec08' FROM invitations WHERE token = ?`,
    INVITATION,
  );
  await run(
    `INSERT INTO invitations (id, assignment_id, survey_id, version_id, code, token, token_hash, status, expires_at, created_at)
     SELECT 'inv_sec08', id, survey_id, version_id, 'UND-SEC08', ?, ?, 'active', ?, ? FROM assignments WHERE id = 'a_sec08'`,
    OTHER_INVITATION, sha256Hex(OTHER_INVITATION), expiresAt, new Date().toISOString(),
  );
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}/api/v1/public/surveys`;
});

after(async () => {
  if (server) {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    server.close((error) => error ? reject(error) : resolve());
    await promise;
  }
  await closeTestDatabase();
});

async function call<T>(path: string, headers: Record<string, string> = {}, body?: unknown) {
  const response = await fetch(`${base}/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-Svara-Client': 'web', 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json() as { data?: T; code?: string };
  return { status: response.status, headers: response.headers, ...json };
}

async function issueGuardianConsent(token: string, existingCookie?: string) {
  const result = await call<{ consent_id: string }>(`${token}/consent`, existingCookie ? { Cookie: existingCookie } : {}, {
    respondent_click: true,
    eligibility: true,
    guardian_evidence_ref: 'wali-sintetis',
  });
  assert.equal(result.status, 201);
  assert.ok(result.data);
  const setCookie = result.headers.get('set-cookie') ?? '';
  return { id: result.data.consent_id, cookie: existingCookie ?? setCookie.split(';')[0]!, setCookie };
}

function submit(token: string, consent: { id: string; cookie: string }, key: string) {
  return call<{ response_id: string }>(`${token}/responses`, { Cookie: consent.cookie, 'Idempotency-Key': key }, {
    consent_id: consent.id,
    answers: [
      { question_code: 'AD01', option_id: 'q_ad01_opt3' },
      { question_code: 'TS01', option_id: 'q_ts01_opt2' },
    ],
  });
}

async function assertSingleConsentBinding(id: string, responseId: string, keys: string[]) {
  const binding = await get<{ response_id: string }>('SELECT response_id FROM consent_records WHERE id = ?', id);
  assert.equal(binding?.response_id, responseId);
  const placeholders = keys.map(() => '?').join(', ');
  const responses = await all<{ id: string }>(`SELECT id FROM responses WHERE idempotency_key IN (${placeholders})`, ...keys);
  assert.deepEqual(responses, [{ id: responseId }]);
}

test('SEC-08/BF-02: consent baru menerbitkan cookie responden HttpOnly', async () => {
  const { setCookie } = await issueGuardianConsent(PUBLIC_LINK);
  assert.match(setCookie, /^svara_respondent=[A-Za-z0-9_-]{43};/u);
  assert.match(setCookie, /; HttpOnly/u);
});

test('SEC-08/BF-02: consent hanya membuka formulir dan pengiriman pada konteks penerbitannya', async () => {
  const consent = await issueGuardianConsent(PUBLIC_LINK);
  const invitationConsent = await issueGuardianConsent(INVITATION, consent.cookie);
  const otherSession = await issueGuardianConsent(PUBLIC_LINK);
  const otherContexts = [
    { token: INVITATION, id: consent.id, cookie: consent.cookie },
    { token: PUBLIC_LINK, id: invitationConsent.id, cookie: consent.cookie },
    { token: OTHER_INVITATION, id: invitationConsent.id, cookie: consent.cookie },
    { token: PUBLIC_LINK, id: consent.id, cookie: otherSession.cookie },
  ];
  for (const [index, { token, id, cookie }] of otherContexts.entries()) {
    const form = await call(`${token}/form?consent_id=${id}`, { Cookie: cookie });
    assert.equal(form.status, 409, `form di luar konteks consent: ${index}`);
    assert.equal(form.code, 'consent_context_mismatch');
    const denied = await submit(token, { id, cookie }, `kunci-konteks-sec08-${index}`);
    assert.equal(denied.status, 409, `kiriman di luar konteks consent: ${index}`);
    assert.equal(denied.code, 'consent_context_mismatch');
  }
  const ownForm = await call(`${PUBLIC_LINK}/form?consent_id=${consent.id}`, { Cookie: consent.cookie });
  assert.equal(ownForm.status, 200);
  assert.equal((await submit(PUBLIC_LINK, consent, 'kunci-konteks-sec08-valid')).status, 201);
  assert.equal((await submit(INVITATION, invitationConsent, 'kunci-undangan-sec08-valid')).status, 201);
});

test('SEC-08/BF-02: consent terpakai tidak dapat pindah respons; retry identik tetap sah', async () => {
  const consent = await issueGuardianConsent(PUBLIC_LINK);
  const firstKey = 'kunci-consent-sekali';
  const otherKey = 'kunci-consent-lain';
  const first = await submit(PUBLIC_LINK, consent, firstKey);
  assert.equal(first.status, 201);
  assert.ok(first.data);
  const retry = await submit(PUBLIC_LINK, consent, firstKey);
  assert.equal(retry.status, 200);
  assert.deepEqual(retry.data, first.data);
  const reuse = await submit(PUBLIC_LINK, consent, otherKey);
  assert.equal(reuse.status, 409);
  assert.equal(reuse.code, 'consent_already_used');
  await assertSingleConsentBinding(consent.id, first.data.response_id, [firstKey, otherKey]);
});
test('SEC-08/BF-02: consent terpakai tidak dapat digunakan ulang pada konteks undangan', async () => {
  const consent = await issueGuardianConsent(PUBLIC_LINK);
  const first = await submit(PUBLIC_LINK, consent, 'kunci-consent-konteks-pertama');
  assert.equal(first.status, 201);
  assert.ok(first.data);

  const reuse = await submit(INVITATION, consent, 'kunci-consent-konteks-kedua');
  assert.equal(reuse.status, 409, 'consent terpakai tidak boleh dipakai di undangan lain');
  assert.equal(reuse.code, 'consent_context_mismatch');
});

test('SEC-08/BF-02: memuat ulang review setelah pengiriman hanya membuka retry untuk sesi terikat', async () => {
  const consent = await issueGuardianConsent(PUBLIC_LINK);
  const key = 'kunci-retry-review-ulang';
  const first = await submit(PUBLIC_LINK, consent, key);
  assert.equal(first.status, 201);
  assert.ok(first.data);

  const review = await call<{ retryOnly?: boolean; canSubmit: boolean }>(
    `${PUBLIC_LINK}/review?consent_id=${consent.id}`,
    { Cookie: consent.cookie },
  );
  assert.equal(review.status, 200);
  assert.equal(review.data?.retryOnly, true);
  assert.equal(review.data?.canSubmit, false);
  const retry = await submit(PUBLIC_LINK, consent, key);
  assert.equal(retry.status, 200);
  assert.deepEqual(retry.data, first.data);

  const otherCookie = `svara_respondent=${'B'.repeat(43)}`;
  const otherSession = await issueGuardianConsent(PUBLIC_LINK, otherCookie);
  for (const [label, headers] of [
    ['sesi lain', { Cookie: otherSession.cookie }],
    ['tanpa sesi', {}],
  ] as const) {
    const deniedReview = await call(`${PUBLIC_LINK}/review?consent_id=${consent.id}`, headers);
    assert.equal(deniedReview.status, 409, `${label}: review retry harus ditolak`);
    assert.equal(deniedReview.code, 'consent_context_mismatch', `${label}: kode penolakan review`);
    const deniedSubmit = await call(`${PUBLIC_LINK}/responses`, {
      ...headers,
      'Idempotency-Key': key,
    }, {
      consent_id: consent.id,
      answers: [
        { question_code: 'AD01', option_id: 'q_ad01_opt3' },
        { question_code: 'TS01', option_id: 'q_ts01_opt2' },
      ],
    });
    assert.equal(deniedSubmit.status, 409, `${label}: submit retry harus ditolak`);
    assert.equal(deniedSubmit.code, 'consent_context_mismatch', `${label}: kode penolakan submit`);
  }
});


test('SEC-08/BF-02: kiriman serentak dengan consent yang sama hanya menyimpan satu respons', async (t) => {
  const consent = await issueGuardianConsent(PUBLIC_LINK);
  const keys = ['kunci-consent-paralel-a', 'kunci-consent-paralel-b'];
  const barrier = new Client({ connectionString: databaseUrl, statement_timeout: 5000 });
  await barrier.connect();
  let pending: Promise<unknown> | undefined;
  let results;
  try {
    await barrier.query('BEGIN');
    // Non-locking consent reads can finish; both submissions must wait before consuming it.
    await barrier.query('LOCK TABLE consent_records IN EXCLUSIVE MODE');
    let completed = 0;
    const attempts = keys.map((key) => submit(PUBLIC_LINK, consent, key).finally(() => { completed += 1; }));
    pending = Promise.allSettled(attempts);
    const deadline = performance.now() + 5000;
    let waiting = 0;
    while (waiting < keys.length && completed === 0 && performance.now() < deadline) {
      const { rows } = await barrier.query<{ waiting: number }>(`
        SELECT count(DISTINCT pid)::int AS waiting FROM pg_locks
         WHERE locktype = 'relation' AND relation = 'consent_records'::regclass AND NOT granted
           AND pg_backend_pid() = ANY(pg_blocking_pids(pid))
      `);
      waiting = rows[0]?.waiting ?? 0;
    }
    assert.equal(waiting, keys.length, 'kedua transaksi harus menunggu lock PostgreSQL yang sama');
    t.diagnostic(`PostgreSQL: ${waiting} transaksi menunggu lock yang sama sebelum dilepas.`);
    await barrier.query('ROLLBACK');
    results = await Promise.all(attempts);
  } finally {
    await barrier.end();
    await pending;
  }
  assert.deepEqual(results.map(({ status }) => status).sort(), [201, 409]);
  const created = results.find(({ status }) => status === 201);
  assert.ok(created?.data);
  assert.equal(results.find(({ status }) => status === 409)?.code, 'consent_already_used');
  await assertSingleConsentBinding(consent.id, created.data.response_id, keys);
});

test('SEC-08/BF-02: persetujuan kedaluwarsa atau bukti wali tidak lengkap tidak dapat dikonsumsi', async () => {
  const expired = await issueGuardianConsent(PUBLIC_LINK);
  await run('UPDATE consent_records SET recorded_at = ? WHERE id = ?', '2000-01-01T00:00:00Z', expired.id);
  const late = await submit(PUBLIC_LINK, expired, 'kunci-consent-kedaluwarsa');
  assert.equal(late.status, 409);
  assert.equal(late.code, 'consent_expired');

  const incomplete = await issueGuardianConsent(PUBLIC_LINK);
  await run("UPDATE consent_records SET guardian_evidence_status = 'not_required' WHERE id = ?", incomplete.id);
  const denied = await submit(PUBLIC_LINK, incomplete, 'kunci-consent-tanpa-wali');
  assert.equal(denied.status, 409);
  assert.equal(denied.code, 'guardian_evidence_required');
});
