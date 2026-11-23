-- Koreksi backfill notice untuk data yang dibuat kode main 95eafa3 (temuan H1 review 2026-11-22).
--
-- Di main, notice publik sebuah survei dibaca dari surveys.profile_id: notice profil itu dengan versi persis
-- survey_versions.notice_version, atau notice terbaru profil itu bila versi persis tidak ada (noticeFor di
-- routes/public.ts main). 013 malah mencocokkan organizations.name = profiles.organization_name, jadi
-- organisasi buatan POST /admin/organizations (namanya bebas) dan survei platform (platform_profile tidak
-- punya padanan nama) tidak mendapat notice; GET /public/surveys/:token gagal 500 notice_version_unavailable.
-- Komentar 013 ("organisasi mewarisi notice profil deployment") dan 015 ("Sumber notice untuk provisioning
-- dan backfill 013") hanya benar untuk organisasi yang kebetulan bernama sama dengan profil legacy. Berkas
-- 010-017 tidak diubah: checksum migrasi yang sudah diterapkan dikunci oleh migrate.ts.
--
-- Isi yang disalin adalah teks yang memang ditampilkan main untuk setiap versi survei yang ada, dicatat di
-- bawah label versi pada survey_versions (label yang juga tersimpan di consent_records), agar responden
-- melihat teks yang sama seperti sebelum upgrade dan persetujuan lama tetap merujuk teks yang disetujuinya
-- (PRD §9.2). Survei organisasi mengisi organization_notices milik surveys.organization_id; survei tanpa
-- organisasi mengisi platform_notices. Bila beberapa survei menyumbang lingkup dan versi yang sama, versi
-- persis menang, lalu survei tertua. Profil tanpa notice sama sekali tidak menghasilkan baris, sehingga
-- surveinya tetap gagal-tertutup seperti di main.
--
-- organizations.notice_version dan platform_profile.notice_version saat migrasi yang belum dipakai versi
-- survei mana pun (mis. organisasi main yang belum punya survei) diisi dari profil yang dipasang POST /surveys
-- pada survei baru bila profile_id tidak dikirim (UI tidak pernah mengirimnya): p_smk, atau profil pertama
-- menurut id. Itu teks yang akan ditampilkan main untuk survei baru di lingkup itu. Pasangan lingkup+versi
-- yang sudah dipakai survei tidak ikut aturan ini, jadi survei berprofil tanpa notice tidak terbuka diam-diam.
--
-- ON CONFLICT DO NOTHING: baris dari 013, seed, atau yang sudah disesuaikan pengelola tidak ditimpa, dan
-- migrasi ini aman dijalankan ulang.

-- Katalog 015 dibatasi satu sumber per tabel; sumber di bawah ikut dicatat agar asal setiap notice lingkup
-- dapat ditelusuri.
ALTER TABLE organization_notice_sources
  DROP CONSTRAINT IF EXISTS organization_notice_sources_single,
  DROP CONSTRAINT IF EXISTS organization_notice_sources_known,
  ADD CONSTRAINT organization_notice_sources_known CHECK (id IN ('legacy', 'platform', 'survey_profile'));

ALTER TABLE platform_notice_sources
  DROP CONSTRAINT IF EXISTS platform_notice_sources_single,
  DROP CONSTRAINT IF EXISTS platform_notice_sources_known,
  ADD CONSTRAINT platform_notice_sources_known CHECK (id IN ('platform', 'survey_profile'));

INSERT INTO organization_notice_sources (id, select_sql, created_at) VALUES (
  'survey_profile',
  $sql$SELECT DISTINCT ON (c.organization_id, c.version)
       'on_' || c.organization_id || '_' || c.version AS id, c.organization_id, c.version, n.effective_date,
       n.purpose, n.data_categories, n.module15_usage, n.retention_text, n.recipients, n.contact, n.rights,
       n.child_data_text, n.cross_border_text, n.effective_date || 'T00:00:00.000Z' AS created_at
  FROM (
    SELECT s.organization_id, sv.notice_version AS version, s.profile_id, s.created_at AS since, s.id AS ref
      FROM survey_versions sv
      JOIN surveys s ON s.id = sv.survey_id
     WHERE s.organization_id IS NOT NULL
    UNION ALL
    SELECT o.id, o.notice_version, d.id, o.created_at, o.id
      FROM organizations o
     CROSS JOIN (SELECT COALESCE((SELECT id FROM profiles WHERE id = 'p_smk'),
                                 (SELECT id FROM profiles ORDER BY id LIMIT 1)) AS id) d
     WHERE NOT EXISTS (SELECT 1 FROM survey_versions sv JOIN surveys s ON s.id = sv.survey_id
                        WHERE s.organization_id = o.id AND sv.notice_version = o.notice_version)
  ) c
  CROSS JOIN LATERAL (
    SELECT ln.* FROM notices ln
     WHERE ln.profile_id = c.profile_id
     ORDER BY (ln.version = c.version) DESC, ln.effective_date DESC, ln.id
     LIMIT 1
  ) n
 ORDER BY c.organization_id, c.version, (n.version = c.version) DESC, c.since, c.ref$sql$,
  '2026-11-22T00:00:00.000Z'
), (
  -- Notice awal organisasi baru (POST /admin/organizations tanpa notice_profile_name): salinan notice
  -- platform untuk organizations.notice_version. $1 = id organisasi yang baru dibuat.
  'platform',
  $sql$SELECT 'on_' || o.id || '_' || pn.version AS id, o.id AS organization_id, pn.version, pn.effective_date,
       pn.purpose, pn.data_categories, pn.module15_usage, pn.retention_text, pn.recipients, pn.contact,
       pn.rights, pn.child_data_text, pn.cross_border_text, o.created_at
  FROM organizations o
  JOIN platform_notices pn ON pn.version = o.notice_version
 WHERE o.id = $1$sql$,
  '2026-11-22T00:00:00.000Z'
)
ON CONFLICT DO NOTHING;

INSERT INTO platform_notice_sources (id, select_sql, created_at) VALUES (
  'survey_profile',
  $sql$SELECT DISTINCT ON (c.version)
       'pn_' || replace(c.version, '.', '_') AS id, c.version, n.effective_date, n.purpose, n.data_categories,
       n.module15_usage, n.retention_text, n.recipients, n.contact, n.rights, n.child_data_text,
       n.cross_border_text, n.effective_date || 'T00:00:00.000Z' AS created_at
  FROM (
    SELECT sv.notice_version AS version, s.profile_id, s.created_at AS since, s.id AS ref
      FROM survey_versions sv
      JOIN surveys s ON s.id = sv.survey_id
     WHERE s.organization_id IS NULL
    UNION ALL
    SELECT pp.notice_version, d.id, pp.updated_at, pp.id
      FROM platform_profile pp
     CROSS JOIN (SELECT COALESCE((SELECT id FROM profiles WHERE id = 'p_smk'),
                                 (SELECT id FROM profiles ORDER BY id LIMIT 1)) AS id) d
     WHERE NOT EXISTS (SELECT 1 FROM survey_versions sv JOIN surveys s ON s.id = sv.survey_id
                        WHERE s.organization_id IS NULL AND sv.notice_version = pp.notice_version)
  ) c
  CROSS JOIN LATERAL (
    SELECT ln.* FROM notices ln
     WHERE ln.profile_id = c.profile_id
     ORDER BY (ln.version = c.version) DESC, ln.effective_date DESC, ln.id
     LIMIT 1
  ) n
 ORDER BY c.version, (n.version = c.version) DESC, c.since, c.ref$sql$,
  '2026-11-22T00:00:00.000Z'
)
ON CONFLICT DO NOTHING;

-- Backfill menjalankan teks yang tercatat di katalog, bukan salinan kedua yang bisa menyimpang.
DO $do$
BEGIN
  EXECUTE 'INSERT INTO organization_notices (id, organization_id, version, effective_date, purpose, data_categories,
             module15_usage, retention_text, recipients, contact, rights, child_data_text, cross_border_text, created_at) '
    || (SELECT select_sql FROM organization_notice_sources WHERE id = 'survey_profile')
    || ' ON CONFLICT DO NOTHING';
  EXECUTE 'INSERT INTO platform_notices (id, version, effective_date, purpose, data_categories, module15_usage,
             retention_text, recipients, contact, rights, child_data_text, cross_border_text, created_at) '
    || (SELECT select_sql FROM platform_notice_sources WHERE id = 'survey_profile')
    || ' ON CONFLICT DO NOTHING';
END
$do$;
