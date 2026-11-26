-- Kolom warisan persetujuan di tabel `profiles` dibuang.
--
-- `profiles.respondent_age_category` dan `profiles.consent_mode` berasal dari skema awal saat persetujuan
-- diatur per profil. Sejak 024 kebutuhan bukti adalah milik survei (`surveys.consent_required`), dan sejak
-- perubahan yang sama tidak ada lagi kode yang membaca kategori umur responden. Satu-satunya penulis sisa
-- adalah INSERT yang mengisi nilai netral ('adult'/'self') semata agar kolom NOT NULL terisi.
--
-- Perubahan:
-- - Kedua kolom dibuang. Semua penulis/pembaca dihapus dalam perubahan yang sama (routes, seed, tes).
-- - `notices.child_data_text` dibiarkan: itu isi teks notice yang dikelola per profil, bukan kategori usia.
--
-- Data lama: aplikasi belum rilis dan tidak ada backfill; nilai kolom ini tidak pernah masuk kontrak API.
--
-- Idempoten: `DROP COLUMN IF EXISTS` dan `DROP CONSTRAINT IF EXISTS`.
ALTER TABLE profiles DROP COLUMN IF EXISTS respondent_age_category;
ALTER TABLE profiles DROP COLUMN IF EXISTS consent_mode;
