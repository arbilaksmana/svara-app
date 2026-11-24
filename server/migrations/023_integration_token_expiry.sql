-- BF-09c: kredensial integrasi tanpa masa berlaku.
--
-- `integration_token_scopes` semula hanya menyimpan `token_hash` dan cakupannya, sehingga token layanan
-- berlaku selamanya: token yang bocor (log, backup, tiket support) tidak pernah berhenti bekerja.
--
-- Perubahan:
-- - `expires_at` ISO-8601 berzona waktu; NULL = tanpa batas. Baris yang lewat `expires_at` ditolak oleh
--                `integrationScope` (server/routes/integration.ts) dengan pesan yang sama seperti cakupan
--                tidak ada. CHECK menolak nilai yang tak terurai oleh timestamptz.
-- - `created_at` waktu baris dibuat/diisi ulang saat startup; baris lama diisi waktu migrasi ini.
--
-- Data lama aman: `expires_at` NULL untuk semua baris yang ada, jadi instalasi yang belum mengisi env
-- `INTEGRATION_TOKEN_EXPIRES_AT` berperilaku persis seperti sebelum migrasi.
--
-- Idempoten: `ADD COLUMN IF NOT EXISTS`, backfill hanya untuk NULL, CHECK dipasang sekali lewat DO blok.
ALTER TABLE integration_token_scopes ADD COLUMN IF NOT EXISTS expires_at TEXT;
ALTER TABLE integration_token_scopes ADD COLUMN IF NOT EXISTS created_at TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'integration_token_scopes_expires_at_iso'
  ) THEN
    ALTER TABLE integration_token_scopes
      ADD CONSTRAINT integration_token_scopes_expires_at_iso
      CHECK (expires_at IS NULL OR pg_input_is_valid(expires_at, 'timestamptz'));
  END IF;
END
$$;

UPDATE integration_token_scopes
   SET created_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 WHERE created_at IS NULL;
