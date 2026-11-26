-- Kolom warisan persetujuan/usia di tabel `profiles` dan `organizations` dibuang.
--
-- `respondent_age_category` dan `consent_mode` berasal dari skema awal saat persetujuan dan aturan usia
-- diatur per profil. `organizations.consent_mode` sudah dibuang di 024, tetapi pasangannya
-- `organizations.respondent_age_category` (ditambahkan 006) masih tersisa; sisanya dibuang di sini. Sejak
-- 024 kebutuhan bukti adalah milik survei (`surveys.consent_required`), dan tidak ada lagi kode yang membaca
-- kategori umur responden. Satu-satunya penulis sisa adalah INSERT yang mengisi nilai netral ('adult'/'self')
-- semata agar kolom NOT NULL terisi.
--
-- Perubahan:
-- - Ketiga kolom dibuang: `profiles.respondent_age_category` dan `profiles.consent_mode`, serta
--   `organizations.respondent_age_category`. Semua penulis/pembaca dihapus dalam perubahan yang sama
--   (routes, seed, tes).
-- - `notices.child_data_text` dibiarkan: itu isi teks notice yang dikelola per profil, bukan kategori usia.
--
-- Data lama: aplikasi belum rilis dan tidak ada backfill; nilai kolom ini tidak pernah masuk kontrak API.
--
-- Idempoten: `DROP COLUMN IF EXISTS` dan `DROP CONSTRAINT IF EXISTS`.
ALTER TABLE profiles DROP COLUMN IF EXISTS respondent_age_category;
ALTER TABLE profiles DROP COLUMN IF EXISTS consent_mode;
ALTER TABLE organizations DROP COLUMN IF EXISTS respondent_age_category;
