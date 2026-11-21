-- Backfill notice untuk lingkup yang sudah ada (SEC-01/SEC-02, audit 2026-11-20).
-- 010 hanya membuat tabel kosong, sedangkan formulir publik mewajibkan notice persis versi
-- yang tercatat pada versi survei. Tanpa backfill, upgrade dari 009 mematikan semua tautan
-- publik dengan notice_version_unavailable.
--
-- Isi notice disalin apa adanya dari notice legacy (profiles/notices) yang dipakai jalur
-- publik sebelum 010; tidak ada teks baru. ON CONFLICT DO NOTHING membuat migrasi idempoten
-- dan tidak menimpa notice yang sudah disesuaikan pengelola.

-- Lingkup organisasi: organisasi mewarisi notice profil deployment yang kini dipakai bersama.
-- profiles.notice_version = 1.0 dan survei organisasi menerima notice_version yang sama pada 19d39c9.
INSERT INTO organization_notices (id, organization_id, version, effective_date, purpose, data_categories,
  module15_usage, retention_text, recipients, contact, rights, child_data_text, cross_border_text, created_at)
SELECT 'on_' || o.id || '_' || n.version, o.id, n.version, n.effective_date, n.purpose, n.data_categories,
       n.module15_usage, n.retention_text, n.recipients, n.contact, n.rights, n.child_data_text,
       n.cross_border_text, n.effective_date || 'T00:00:00.000Z'
  FROM organizations o
  JOIN profiles p ON o.name = p.organization_name AND o.organization_type = p.organization_type
  JOIN notices n ON n.profile_id = p.id
ON CONFLICT DO NOTHING;

-- Lingkup platform: profil platform tunggal mewarisi notice profil deployment platform
-- (nama dan tipe sama) beserta notice dengan versi yang sama di profil deployment lain;
-- notice prosedural tidak memuat data penyelenggara. Versi ditulis sesuai versi notice
-- legacy, bukan platform_profile.notice_version, agar membaca NOTICE itu sendiri.
INSERT INTO platform_notices (id, version, effective_date, purpose, data_categories, module15_usage,
  retention_text, recipients, contact, rights, child_data_text, cross_border_text, created_at)
SELECT DISTINCT ON (n.version)
       'pn_' || replace(n.version, '.', '_'), n.version, n.effective_date, n.purpose, n.data_categories,
       n.module15_usage, n.retention_text, n.recipients, n.contact, n.rights, n.child_data_text,
       n.cross_border_text, n.effective_date || 'T00:00:00.000Z'
  FROM platform_profile pp
  LEFT JOIN profiles own ON own.organization_name = pp.organization_name AND own.organization_type = pp.organization_type
  JOIN notices n ON n.profile_id = own.id OR n.version = pp.notice_version
 ORDER BY n.version, (n.profile_id IS NOT DISTINCT FROM own.id) DESC, n.profile_id
ON CONFLICT DO NOTHING;
