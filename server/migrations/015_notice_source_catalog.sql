-- Sumber notice untuk provisioning (temuan D audit 2026-11-20) dan backfill 013.
-- 013 hanya menyalin notice saat upgrade; organisasi baru sesudahnya tidak mendapat notice sehingga
-- survei publiknya gagal notice_version_unavailable. Definisi SELECT dipusatkan di sini agar migrasi
-- dan jalur pembuatan organisasi membaca teks yang sama, bukan dua salinan yang bisa menyimpang.
-- 013 sendiri tidak diubah: migrasi yang sudah diterapkan adalah riwayat, bukan kode yang dipakai ulang.

CREATE TABLE organization_notice_sources (
  id TEXT PRIMARY KEY,
  select_sql TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CONSTRAINT organization_notice_sources_single CHECK (id = 'legacy')
);

CREATE TABLE platform_notice_sources (
  id TEXT PRIMARY KEY,
  select_sql TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CONSTRAINT platform_notice_sources_single CHECK (id = 'platform')
);

-- $1 = nama profil deployment legacy yang dipilih saat membuat organisasi, $2 = id organisasi baru.
-- Aturan nama+tipe milik 013 tidak dipakai: nama organisasi baru tidak diturunkan dari profil lama.
INSERT INTO organization_notice_sources (id, select_sql, created_at) VALUES (
  'legacy',
  $sql$SELECT 'on_' || o.id || '_' || n.version AS id, o.id AS organization_id, n.version,
       n.effective_date, n.purpose, n.data_categories, n.module15_usage, n.retention_text,
       n.recipients, n.contact, n.rights, n.child_data_text, n.cross_border_text,
       n.effective_date || 'T00:00:00.000Z' AS created_at
  FROM organizations o
  JOIN profiles p ON p.organization_name = $1
  JOIN notices n ON n.profile_id = p.id
 WHERE o.id = $2$sql$,
  '2026-11-20T00:00:00.000Z'
);

INSERT INTO platform_notice_sources (id, select_sql, created_at) VALUES (
  'platform',
  $sql$SELECT DISTINCT ON (n.version)
       'pn_' || replace(n.version, '.', '_'), n.version, n.effective_date, n.purpose, n.data_categories,
       n.module15_usage, n.retention_text, n.recipients, n.contact, n.rights, n.child_data_text,
       n.cross_border_text, n.effective_date || 'T00:00:00.000Z'
  FROM platform_profile pp
  LEFT JOIN profiles own ON own.organization_name = pp.organization_name AND own.organization_type = pp.organization_type
  JOIN notices n ON n.profile_id = own.id OR n.version = pp.notice_version
 ORDER BY n.version, (n.profile_id IS NOT DISTINCT FROM own.id) DESC, n.profile_id$sql$,
  '2026-11-20T00:00:00.000Z'
);
