-- NEW-01: verifikasi pemohon data berbasis bukti balasan + retensi anonimisasi.
-- Permintaan tetap dicatat 'pending' saat diterima; jejak balasan membuktikan pengelola
-- benar-benar menghubungi kontak yang diberikan sebelum status 'handled' boleh diisi.
ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS responded_at TEXT;
ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS responded_by TEXT;
ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS response_channel TEXT;
-- Penanda idempoten job retensi: baris yang sudah dianonimkan tidak disentuh lagi.
ALTER TABLE data_requests ADD COLUMN IF NOT EXISTS anonymized_at TEXT;

CREATE INDEX IF NOT EXISTS ix_data_requests_retention
  ON data_requests (created_at) WHERE anonymized_at IS NULL;
