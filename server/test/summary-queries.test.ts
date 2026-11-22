import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { closeTestDatabase, resetTestDatabase } from './test-db.ts';
import { recordQueries } from './query-log.ts';

const { all, get, run } = await import('../db.ts');
const { summaryFor } = await import('../summary.ts');
const { seedDemoIfEmpty } = await import('../seed-data.ts');

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.SEED_DEMO = '1';
  await resetTestDatabase();
  await seedDemoIfEmpty();

  // Kasus tepi untuk ringkasan: jawaban dilewati yang tetap membawa option_id, teks kosong
  // berisi spasi, teks NULL yang tidak dilewati, dan respons yang seluruhnya dilewati.
  const questions = await all<{ id: string; code: string; type: string }>(
    "SELECT id, code, type FROM questions WHERE version_id = 'v_demo1_1' ORDER BY ord, code",
  );
  const firstOption = async (questionId: string) =>
    (await get<{ id: string }>('SELECT id FROM question_options WHERE question_id = ? ORDER BY ord LIMIT 1', questionId))?.id ?? null;
  for (const [index, kind] of ['skipped_with_option', 'blank_text', 'null_text', 'all_skipped'].entries()) {
    const responseId = `r_edge_${index}`;
    await run(
      "INSERT INTO respondents (id, source, external_ref, created_at) VALUES (?, 'public_link', NULL, '2026-11-19T00:00:00Z')",
      `p_edge_${index}`,
    );
    await run(
      `INSERT INTO responses (id, survey_id, version_id, assignment_id, respondent_id, collection_mode, identity_source, submitted_at, idempotency_key)
       VALUES (?, 's_demo1', 'v_demo1_1', NULL, ?, 'standalone', 'local', ?, ?)`,
      responseId, `p_edge_${index}`, `2026-11-19T0${index}:00:00Z`, `edge-key-${index}`,
    );
    for (const question of questions) {
      const optionId = question.type === 'short_text' ? null : await firstOption(question.id);
      const skipped = kind === 'all_skipped' || (kind === 'skipped_with_option' && question.type !== 'short_text') ? 1 : 0;
      const text = question.type !== 'short_text' ? null : kind === 'blank_text' ? '   ' : kind === 'null_text' ? null : 'isi';
      await run(
        `INSERT INTO answers (id, response_id, question_id, question_code, option_id, value, text, skipped)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
        `a_edge_${index}_${question.code}`, responseId, question.id, question.code,
        kind === 'all_skipped' ? null : optionId, text, skipped,
      );
    }
  }
});

after(async () => {
  await closeTestDatabase();
});

/** Ringkasan acuan dihitung di JavaScript langsung dari baris tabel, tanpa agregasi SQL. */
async function expectedSummary(versionId: string) {
  const version = await get<{ id: string; survey_id: string; number: number; status: string }>(
    'SELECT id, survey_id, number, status FROM survey_versions WHERE id = ?',
    versionId,
  );
  assert.ok(version);
  const responseIds = new Set(
    (await all<{ id: string }>('SELECT id FROM responses WHERE version_id = ?', versionId)).map((row) => row.id),
  );
  const answers = (
    await all<{ response_id: string; question_id: string; option_id: string | null; text: string | null; skipped: number }>(
      'SELECT response_id, question_id, option_id, text, skipped FROM answers',
    )
  ).filter((answer) => responseIds.has(answer.response_id) && answer.skipped === 0);
  const questions = await all<{ id: string; code: string; section: string; label: string; type: 'likert' | 'short_text' | 'single_choice'; required: number }>(
    'SELECT id, code, section, label, type, required FROM questions WHERE version_id = ? ORDER BY ord, code',
    versionId,
  );
  const total = responseIds.size;
  const items = [];
  for (const question of questions) {
    const options = await all<{ id: string; label: string; value: number | null }>(
      'SELECT id, label, value FROM question_options WHERE question_id = ? ORDER BY ord, id',
      question.id,
    );
    // TRIM Postgres hanya membuang spasi, bukan seluruh whitespace seperti String.trim.
    const answered = answers.filter((answer) =>
      answer.question_id === question.id &&
      (question.type === 'short_text' ? answer.text !== null && answer.text.replace(/^ +| +$/g, '') !== '' : answer.option_id !== null),
    ).length;
    items.push({
      question_id: question.id,
      code: question.code,
      section: question.section,
      label: question.label,
      type: question.type,
      required: question.required === 1,
      answered,
      skipped: Math.max(0, total - answered),
      total,
      options: options.map((option) => ({
        option_id: option.id,
        label: option.label,
        value: option.value,
        count: answers.filter((answer) => answer.option_id === option.id).length,
      })),
      free_text_count: question.type === 'short_text' ? answered : 0,
    });
  }
  return { version_id: version.id, survey_id: version.survey_id, number: version.number, status: version.status, total, items };
}

test('PERF-02: ringkasan setiap versi sama dengan hitungan langsung dari baris jawaban', async () => {
  const versions = await all<{ id: string }>('SELECT id FROM survey_versions ORDER BY id');
  assert.ok(versions.length > 1);
  for (const { id } of versions) {
    assert.deepEqual(await summaryFor(id), await expectedSummary(id), `ringkasan ${id}`);
  }
  const edge = (await summaryFor('v_demo1_1')).items;
  assert.ok(edge.some((item) => item.type === 'short_text' && item.skipped > 0), 'kasus tepi teks ikut terhitung dilewati');
});

test('PERF-02: jumlah query ringkasan tetap, tidak bertambah per pertanyaan', async () => {
  const versions = await all<{ id: string; questions: number }>(
    `SELECT v.id, COUNT(q.id) AS questions FROM survey_versions v LEFT JOIN questions q ON q.version_id = v.id
      GROUP BY v.id ORDER BY questions DESC, v.id`,
  );
  // Pembanding hanya bermakna bila ada versi dengan jumlah pertanyaan berbeda.
  assert.ok(new Set(versions.map((version) => Number(version.questions))).size > 1, 'butuh versi dengan jumlah pertanyaan berbeda');
  const counts = new Set<number>();
  for (const version of versions) {
    const { queries } = await recordQueries(() => summaryFor(version.id));
    counts.add(queries.length);
    assert.ok(queries.length <= 6, `${version.id} (${version.questions} pertanyaan) memakai ${queries.length} query`);
  }
  assert.equal(counts.size, 1, `jumlah query berbeda antarversi: ${[...counts].join(', ')}`);
});
