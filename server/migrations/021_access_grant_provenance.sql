-- BR-06: grant lintas tenant tanpa pemberi, tujuan, atau masa berlaku.
--
-- `access_grants` semula hanya menyimpan penerima, survei, dan tiga flag izin; siapa yang memberi, untuk
-- apa, dan sampai kapan tidak tercatat, sehingga grant lintas organisasi berlaku selamanya.
--
-- Perubahan:
-- - `purpose`   teks wajib-diisi di API untuk grant baru (CHECK di bawah menolak string kosong);
-- - `expires_at` ISO-8601 berzona waktu; NULL = tanpa batas. Grant yang lewat `expires_at` tidak lagi
--                memberi izin (`grantFor` di server/http.ts dan server/survey-service.ts, serta
--                `accessibleSurveys`), tanpa menghapus barisnya. CHECK menjaga nilai tak-terurai.
-- - `granted_by` akun super admin pemberi grant. Tanpa foreign key: akun yang dihapus tidak boleh
--                menghapus riwayat grant atau memblokir penghapusan akun.
--
-- Data lama aman: semua kolom nullable dan diisi NULL untuk baris yang ada, sehingga grant lama tetap
-- berlaku tanpa pemberi dan tanpa kedaluwarsa seperti sebelumnya. Baris lama dapat dilengkapi lewat
-- `PUT /admin/grants/:accountId`, yang menulis ketiga kolom untuk setiap grant.
--
-- Idempoten: `ADD COLUMN IF NOT EXISTS` dan CHECK yang dipasang sekali lewat DO blok dengan penjaga.
ALTER TABLE access_grants ADD COLUMN IF NOT EXISTS purpose TEXT;
ALTER TABLE access_grants ADD COLUMN IF NOT EXISTS expires_at TEXT;
ALTER TABLE access_grants ADD COLUMN IF NOT EXISTS granted_by TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'access_grants_purpose_not_blank'
  ) THEN
    ALTER TABLE access_grants
      ADD CONSTRAINT access_grants_purpose_not_blank
      CHECK (purpose IS NULL OR length(btrim(purpose)) > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'access_grants_expires_at_iso'
  ) THEN
    ALTER TABLE access_grants
      ADD CONSTRAINT access_grants_expires_at_iso
      CHECK (expires_at IS NULL OR pg_input_is_valid(expires_at, 'timestamptz'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS ix_access_grants_expires_at ON access_grants (expires_at) WHERE expires_at IS NOT NULL;
