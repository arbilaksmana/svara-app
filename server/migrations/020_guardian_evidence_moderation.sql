-- SEC-04/BF-03: bukti persetujuan wali diunggah responden, lalu dimoderasi operator organisasi.
-- Berkas biner tetap di disk (GUARDIAN_EVIDENCE_DIR); tabel hanya menyimpan metadata dan nama asli.
-- Status 'self_attested' saat dicatat; 'verified'/'rejected' hanya berasal dari keputusan operator.
ALTER TABLE consent_records ADD COLUMN IF NOT EXISTS guardian_evidence_file TEXT;
ALTER TABLE consent_records ADD COLUMN IF NOT EXISTS guardian_evidence_mime TEXT;
ALTER TABLE consent_records ADD COLUMN IF NOT EXISTS guardian_evidence_size INTEGER;
ALTER TABLE consent_records ADD COLUMN IF NOT EXISTS guardian_evidence_uploaded_at TEXT;
ALTER TABLE consent_records ADD COLUMN IF NOT EXISTS guardian_evidence_reviewed_by TEXT;
ALTER TABLE consent_records ADD COLUMN IF NOT EXISTS guardian_evidence_reviewed_at TEXT;
ALTER TABLE consent_records ADD COLUMN IF NOT EXISTS guardian_evidence_review_note TEXT;

CREATE INDEX IF NOT EXISTS ix_consent_records_guardian_status
  ON consent_records (guardian_evidence_status, recorded_at DESC);
