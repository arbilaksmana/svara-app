-- Tutup versi terbit lama yang ditinggalkan kode main 95eafa3 (temuan N2 review konfirmasi 2026-11-22).
--
-- Publish di main tidak menutup versi terbit sebelumnya, jadi survei yang diterbitkan lebih dari sekali
-- memiliki beberapa versi berstatus 'published' sekaligus, dan tautan versi lama tetap 'active' serta
-- menerima kiriman ke versi lama. PRD §5.2 dan keputusan pemilik BF-04: hanya versi terbit terbaru yang
-- menerima kiriman baru, dan tautan lama langsung menyajikan versi terbit terbaru survei yang sama.
-- Close di main juga hanya menutup versi terbit pertama, sehingga survei yang ditutup main bisa masih
-- menyimpan dua versi terbit atau lebih.
--
-- Perubahan pada data nyata, sama dengan yang dilakukan closePublishedVersions(..., 'superseded') saat
-- publish di routes/surveys.ts:
-- - Untuk setiap survei dengan lebih dari satu versi 'published', hanya versi dengan number terbesar yang
--   tetap 'published'. Versi terbit lainnya menjadi 'closed' dengan closed_at = waktu migrasi (format
--   nowIso()): versi itu memang masih menerima kiriman sampai migrasi ini berjalan.
-- - Tautan publik berstatus 'active' pada versi yang ditutup, dan belum lewat expires_at, menjadi 'closed'
--   dengan closed_reason = 'superseded', sehingga remap di routes/public.ts menyajikan versi terbit terbaru
--   bila survei berstatus 'published'. Tautan yang sudah lewat expires_at, dicabut, atau sudah tertutup
--   tidak disentuh, sama seperti publish.
--
-- Tidak diubah: status dan current_version_id survei (survei yang ditutup main tetap 'closed'), draf,
-- respons, jawaban, persetujuan, undangan individual, penugasan, dan isi instrumen setiap versi. Undangan
-- pada versi yang ditutup tetap barisnya, dan formulirnya tertutup karena versinya tidak lagi terbit, sama
-- seperti undangan versi lama sesudah publish.
--
-- Idempoten: sesudah dijalankan tidak ada lagi survei dengan lebih dari satu versi terbit, jadi
-- menjalankannya ulang tidak mengubah baris apa pun. Survei dengan satu versi terbit tidak tersentuh.
WITH stale AS (
  SELECT id
    FROM (
      SELECT id, number, MAX(number) OVER (PARTITION BY survey_id) AS latest
        FROM survey_versions
       WHERE status = 'published'
    ) published
   WHERE number < latest
), closed_versions AS (
  UPDATE survey_versions
     SET status = 'closed', closed_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
   WHERE id IN (SELECT id FROM stale)
  RETURNING id
)
UPDATE public_links SET status = 'closed', closed_reason = 'superseded'
 WHERE version_id IN (SELECT id FROM closed_versions) AND status = 'active'
   AND (expires_at IS NULL OR expires_at::timestamptz >= now());
