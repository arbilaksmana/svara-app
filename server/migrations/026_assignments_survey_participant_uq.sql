-- Idempotensi undangan layanan per peserta: satu participant_ref hanya boleh punya satu penugasan
-- pada satu survei. Tanpa indeks ini, retry POST /integration/surveys/:id/invitations membuat
-- assignment dan undangan baru setiap kali, sehingga satu peserta bisa menerima banyak tautan aktif.
--
-- Preflight WAJIB sebelum migrasi ini dijalankan pada basis data berisi data:
--
--   SELECT survey_id, participant_ref, COUNT(*)
--     FROM assignments
--    GROUP BY survey_id, participant_ref
--   HAVING COUNT(*) > 1;
--
-- Hasil yang tidak kosong berarti sudah ada duplikat. JANGAN jalankan migrasi ini dan JANGAN hapus
-- atau ubah data secara otomatis: indeks unik akan gagal dibuat dan transaksi migrasi di-rollback.
-- Laporkan baris duplikat (survey_id, participant_ref, jumlah) untuk diputuskan pemilik data.
--
-- Idempoten: CREATE UNIQUE INDEX IF NOT EXISTS. Indeks biasa (bukan parsial) karena participant_ref
-- NOT NULL dan setiap assignment memang harus unik per survei.
CREATE UNIQUE INDEX IF NOT EXISTS assignments_survey_participant_uq
  ON assignments (survey_id, participant_ref);