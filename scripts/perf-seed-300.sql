-- Dataset uji muat: +300 respons sintetis pada s_demo1 / v_demo1_1.
-- Jalankan pada basis data demo yang sudah di-seed, lalu:
--   node scripts/perf-api.mjs --label load-300
-- Bersihkan dengan: SEED_DEMO=1 DATABASE_URL=... pnpm db:reset
BEGIN;

INSERT INTO respondents (id, source, external_ref, created_at)
SELECT 'perf2_p_' || g, 'public_link', NULL, '2026-11-19T00:00:00Z'
FROM generate_series(1, 300) AS g;

INSERT INTO responses (id, survey_id, version_id, assignment_id, respondent_id, collection_mode, identity_source, submitted_at, idempotency_key)
SELECT 'perf2_r_' || g, 's_demo1', 'v_demo1_1', NULL, 'perf2_p_' || g, 'standalone', 'local',
       '2026-11-19T' || lpad((g % 24)::text, 2, '0') || ':' || lpad((g % 60)::text, 2, '0') || ':00Z',
       'perf2-key-' || g
FROM generate_series(1, 300) AS g;

INSERT INTO answers (id, response_id, question_id, question_code, option_id, value, text, skipped)
SELECT 'perf2_a_ad_' || g, 'perf2_r_' || g, 'q_ad01', 'AD01', 'q_ad01_opt' || (1 + (g % 5)), 1 + (g % 5), NULL, 0
FROM generate_series(1, 300) AS g;

INSERT INTO answers (id, response_id, question_id, question_code, option_id, value, text, skipped)
SELECT 'perf2_a_ts_' || g, 'perf2_r_' || g, 'q_ts01', 'TS01', 'q_ts01_opt' || (1 + ((g + 2) % 5)), 1 + ((g + 2) % 5), NULL, 0
FROM generate_series(1, 300) AS g;

INSERT INTO answers (id, response_id, question_id, question_code, option_id, value, text, skipped)
SELECT 'perf2_a_k_' || g, 'perf2_r_' || g, 'q_k02', 'K02', NULL, NULL,
       'Jawaban performa #' || g || ' — teks sintetis untuk uji muat.', 0
FROM generate_series(1, 300) AS g
WHERE g % 3 = 0;

COMMIT;
