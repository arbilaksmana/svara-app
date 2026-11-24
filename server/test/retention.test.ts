import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { closeTestDatabase, resetAndAttachTestDatabase } from './test-db.ts';
import { all, run } from '../db.ts';
import { seedDemoIfEmpty } from '../seed-data.ts';
import { purgeExpiredResponses, retentionScopes } from '../retention.ts';

process.env.NODE_ENV = 'test';
process.env.SEED_DEMO = '1';
process.env.SEED_PASSWORD = 'SvaraDemo123!';

const NOW = new Date('2026-11-24T12:00:00.000Z');
const DAY_MS = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS).toISOString();

async function setRetention(source: 'organization' | 'platform', id: string, days: number | null): Promise<void> {
  if (source === 'organization') {
    await run('UPDATE organizations SET retention_days = ? WHERE id = ?', days, id);
  } else {
    await run('UPDATE platform_profile SET retention_days = ? WHERE id = ?', days, id);
  }
}

/** Draf tanpa versi (s_demo3) mendapat versi sendiri agar dapat menampung baris seperti pengiriman nyata. */
async function versionFor(surveyId: string): Promise<string> {
  const rows = await all<{ id: string }>(
    'SELECT id FROM survey_versions WHERE survey_id = ? ORDER BY number DESC LIMIT 1',
    surveyId,
  );
  const versionId = rows[0]?.id ?? `v_${surveyId}_retention`;
  if (!rows[0]) {
    await run(
      `INSERT INTO survey_versions (id, survey_id, number, status, notice_version, published_at, closed_at)
       VALUES (?, ?, 1, 'draft', '1.0', NULL, NULL)`,
      versionId,
      surveyId,
    );
  }
  return versionId;
}

async function insertResponse(surveyId: string, id: string, submittedAt: string): Promise<void> {
  await run(
    `INSERT INTO responses (id, survey_id, version_id, assignment_id, respondent_id, collection_mode, identity_source, submitted_at, idempotency_key)
     VALUES (?, ?, ?, NULL, ?, 'web', 'self', ?, ?)`,
    id,
    surveyId,
    await versionFor(surveyId),
    `p_${id}`,
    submittedAt,
    `retention-${id}`,
  );
  await run(
    `INSERT INTO answers (id, response_id, question_id, question_code, option_id, value, text, skipped)
     VALUES (?, ?, ?, 'q1', NULL, 4, NULL, 0)`,
    `ans_${id}`,
    id,
    `q_${surveyId}`,
  );
}

async function insertConsent(surveyId: string, id: string, recordedAt: string, responseId: string | null = null): Promise<void> {
  await run(
    `INSERT INTO consent_records (id, survey_id, version_id, notice_version, basis, status, recorded_at,
       respondent_click, guardian_evidence_status, guardian_evidence_ref, invitation_id, response_id)
     VALUES (?, ?, ?, '1.0', 'consent', 'granted', ?, 1, 'tidak_berlaku', NULL, NULL, ?)`,
    id,
    surveyId,
    await versionFor(surveyId),
    recordedAt,
    responseId,
  );
}

async function ids(table: 'responses' | 'consent_records'): Promise<string[]> {
  return (await all<{ id: string }>(`SELECT id FROM ${table} ORDER BY id`)).map((row) => row.id);
}

async function retentionAudits(): Promise<Array<{ actor: string; object: string; outcome: string; metadata: Record<string, unknown> }>> {
  return (
    await all<{ actor: string; object: string; outcome: string; metadata: string | null }>(
      "SELECT actor, object, outcome, metadata FROM audit_logs WHERE action = 'Retensi data' ORDER BY at, id",
    )
  ).map((row) => ({ ...row, metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : {} }));
}

before(async () => {
  await resetAndAttachTestDatabase();
  await seedDemoIfEmpty();
});

after(async () => {
  await closeTestDatabase();
});

beforeEach(async () => {
  // Titik nol fail-closed: setiap skenario memasang sendiri kebijakan yang diuji.
  await run('UPDATE organizations SET retention_days = NULL');
  await run('UPDATE platform_profile SET retention_days = NULL');
  await run('DELETE FROM responses');
  await run('DELETE FROM consent_records');
  await run("DELETE FROM audit_logs WHERE action = 'Retensi data'");
});

test('retentionScopes: NULL dan 0 dilewati, isi positif diambil apa adanya', async () => {
  await setRetention('organization', 'org_smk', 30);
  await setRetention('organization', 'org_perpus', 0);
  await setRetention('platform', 'platform', 90);
  // s_demo3 (draf tanpa organisasi) dijadikan survei platform supaya platform punya penampung baris.
  await run("UPDATE surveys SET organization_id = NULL WHERE id = 's_demo3'");
  assert.deepEqual(
    (await retentionScopes()).map((scope) => [scope.source, scope.id, scope.days]),
    [
      ['organization', 'org_smk', 30],
      ['platform', 'platform', 90],
    ],
  );
  await setRetention('platform', 'platform', -5);
  assert.deepEqual((await retentionScopes()).map((scope) => scope.id), ['org_smk'], 'negatif juga dilewati');
});

test('retention_days NULL: tidak ada yang dihapus, hitungan 0', async () => {
  await insertResponse('s_demo1', 'r_null_lama', daysAgo(400));
  await insertConsent('s_demo1', 'c_null_lama', daysAgo(400), 'r_null_lama');

  const result = await purgeExpiredResponses({ dryRun: false, now: NOW });
  assert.deepEqual(result.scopes, []);
  assert.equal(result.dryRun, false);
  assert.deepEqual(await ids('responses'), ['r_null_lama']);
  assert.deepEqual(await ids('consent_records'), ['c_null_lama']);
  assert.deepEqual(await retentionAudits(), [], 'tanpa kebijakan tidak ada batch');
});

test('retention_days = 30: respons 40 hari lalu terhapus, 10 hari lalu tetap (cascade answers)', async () => {
  await setRetention('organization', 'org_smk', 30);
  await insertResponse('s_demo1', 'r_40', daysAgo(40));
  await insertResponse('s_demo1', 'r_10', daysAgo(10));

  const result = await purgeExpiredResponses({ dryRun: false, now: NOW });
  assert.deepEqual(result.scopes, [{ scope: { source: 'organization', id: 'org_smk', days: 30 }, responses: 1, consents: 0 }]);
  assert.deepEqual(await ids('responses'), ['r_10']);
  assert.deepEqual(
    (await all<{ id: string }>('SELECT id FROM answers ORDER BY id')).map((row) => row.id),
    ['ans_r_10'],
  );
});

test('consent_records ikut terhapus dengan batas yang sama', async () => {
  await setRetention('organization', 'org_smk', 30);
  await insertConsent('s_demo1', 'c_40', daysAgo(40));
  await insertConsent('s_demo1', 'c_10', daysAgo(10));

  const result = await purgeExpiredResponses({ dryRun: false, now: NOW });
  assert.equal(result.scopes[0]?.consents, 1);
  assert.deepEqual(await ids('consent_records'), ['c_10']);
});

test('dryRun: hitungan sama dengan run nyata, baris tetap ada, audit bertanda dryRun', async () => {
  await setRetention('organization', 'org_smk', 30);
  await insertResponse('s_demo1', 'r_40', daysAgo(40));
  await insertResponse('s_demo1', 'r_10', daysAgo(10));
  await insertConsent('s_demo1', 'c_40', daysAgo(40));
  await insertConsent('s_demo1', 'c_10', daysAgo(10));

  const dry = await purgeExpiredResponses({ dryRun: true, now: NOW });
  assert.deepEqual(dry.scopes, [{ scope: { source: 'organization', id: 'org_smk', days: 30 }, responses: 1, consents: 1 }]);
  assert.equal(dry.dryRun, true);
  assert.deepEqual(await ids('responses'), ['r_10', 'r_40']);
  assert.deepEqual(await ids('consent_records'), ['c_10', 'c_40']);
  const dryAudits = await retentionAudits();
  assert.equal(dryAudits.length, 1);
  assert.equal(dryAudits[0]!.metadata.dryRun, true);
  // dryRun bukan penghapusan: outcome audit berbeda agar penyaring tidak mengira ada data terhapus.
  assert.equal(dryAudits[0]!.outcome, 'diperiksa');

  const real = await purgeExpiredResponses({ dryRun: false, now: NOW });
  const realAudits = await retentionAudits();
  assert.equal(realAudits.at(-1)!.outcome, 'berhasil', 'run nyata tetap berhasil');
  assert.deepEqual(real.scopes, dry.scopes);
  assert.deepEqual(await ids('responses'), ['r_10']);
  assert.deepEqual(await ids('consent_records'), ['c_10']);
});

test('audit per batch tanpa identitas; idempoten pada run kedua', async () => {
  await setRetention('organization', 'org_smk', 30);
  await insertResponse('s_demo1', 'r_40', daysAgo(40));
  await insertConsent('s_demo1', 'c_40', daysAgo(40), 'r_40');

  const first = await purgeExpiredResponses({ dryRun: false, now: NOW });
  assert.equal(first.scopes[0]?.responses, 1);

  const audits = await retentionAudits();
  assert.equal(audits.length, 1);
  assert.equal(audits[0]!.outcome, 'berhasil');
  assert.equal(audits[0]!.actor, 'sistem');
  assert.deepEqual(audits[0]!.metadata, {
    source: 'organization',
    id: 'org_smk',
    days: 30,
    responses: 1,
    consents: 1,
    dryRun: false,
  });
  assert.doesNotMatch(JSON.stringify(audits), /r_40|c_40|p_r_40|ans_|q1/, 'audit tidak memuat ID jawaban/responden');
  assert.doesNotMatch(JSON.stringify(audits), /@|0[89]\d{2}/, 'audit tidak memuat kontak');

  const second = await purgeExpiredResponses({ dryRun: false, now: NOW });
  assert.equal(second.scopes[0]?.responses, 0);
  assert.equal(second.scopes[0]?.consents, 0);
  assert.equal((await retentionAudits()).length, 2, 'run kedua tetap meninggalkan jejak batch kosong');
  assert.deepEqual(await ids('responses'), []);
});

test('sumber kebijakan mengikuti survei: organisasi pemilik vs platform', async () => {
  await setRetention('organization', 'org_smk', 30);
  await setRetention('platform', 'platform', 200);
  // s_demo3 tanpa organisasi memakai platform_profile — aturan yang sama dengan surveyProfileFor.
  await run("UPDATE surveys SET organization_id = NULL WHERE id = 's_demo3'");
  await insertResponse('s_demo1', 'r_org_40', daysAgo(40));
  await insertResponse('s_demo3', 'r_plat_40', daysAgo(40));
  await insertResponse('s_demo3', 'r_plat_100', daysAgo(100));

  const result = await purgeExpiredResponses({ dryRun: false, now: NOW });
  assert.deepEqual(result.scopes, [
    { scope: { source: 'organization', id: 'org_smk', days: 30 }, responses: 1, consents: 0 },
    { scope: { source: 'platform', id: 'platform', days: 200 }, responses: 0, consents: 0 },
  ]);
  assert.deepEqual(await ids('responses'), ['r_plat_100', 'r_plat_40'], '200 hari belum lewat untuk survei platform');
});
