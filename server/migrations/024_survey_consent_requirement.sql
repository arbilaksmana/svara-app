-- Persetujuan menjadi milik survei, bukan profil organisasi.
--
-- `organizations.consent_mode` ('self'/'guardian') menentukan kewajiban bukti untuk SEMUA survei satu
-- organisasi, dan pasangannya `organizations.respondent_age_category` memaksa aturan usia di tingkat
-- profil (`minor`/`mixed` wajib `guardian`). Akibatnya: (1) satu survei yang butuh bukti pendukung
-- memaksa seluruh survei lain di organisasi yang sama ikut meminta bukti, dan (2) isi notice publik
-- menyebut kategori umur responden, padahal keputusan kebutuhan bukti adalah keputusan per instrumen.
--
-- Perubahan:
-- - `surveys.consent_required` menetapkan kebutuhan itu per survei: 'tidak' (default, cukup
--   persetujuan diri) atau 'wajib_upload' (persetujuan harus disertai bukti pendukung). CHECK menjaga
--   nilai di luar dua itu. Penegakan "hanya survei organisasi" ada di API (`PUT/POST /surveys`):
--   survei personal selalu 'tidak'.
-- - `organizations.consent_mode` dibuang beserta constraint terkait. Seluruh pembaca kolom ini di
--   server dan web dihapus dalam perubahan yang sama; API publik tidak lagi membacanya.
--
-- Data lama: semua survei mulai 'tidak'. Aplikasi belum rilis dan belum ada data pelanggan, jadi tidak
-- ada pemetaan dari `consent_mode` lama; pengelola memilih ulang per survei pada layar pengaturan.
-- `organizations.respondent_age_category` tidak dibaca/ditulis lagi (dibiarkan di skema).
--
-- Idempoten: `ADD COLUMN IF NOT EXISTS`, CHECK dipasang sekali lewat DO blok dengan penjaga, dan
-- `DROP CONSTRAINT IF EXISTS`/`DROP COLUMN IF EXISTS`.
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS consent_required TEXT NOT NULL DEFAULT 'tidak';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'surveys_consent_required_check'
  ) THEN
    ALTER TABLE surveys
      ADD CONSTRAINT surveys_consent_required_check
      CHECK (consent_required IN ('tidak', 'wajib_upload'));
  END IF;
END
$$;

ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_consent_mode_check;
ALTER TABLE organizations DROP COLUMN IF EXISTS consent_mode;
