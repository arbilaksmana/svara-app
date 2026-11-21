-- Sumber pemberitahuan persetujuan per survei (SEC-01/SEC-02, audit 2026-11-20).
-- Profil deployment lama (profiles/notices) tetap ada untuk kompatibilitas seed dan
-- pembacaan historis, tetapi formulir publik tidak lagi membacanya.

CREATE TABLE organization_notices (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  version TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  purpose TEXT NOT NULL,
  data_categories TEXT NOT NULL,
  module15_usage TEXT NOT NULL,
  retention_text TEXT NOT NULL,
  recipients TEXT NOT NULL,
  contact TEXT NOT NULL,
  rights TEXT NOT NULL,
  child_data_text TEXT NOT NULL,
  cross_border_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (organization_id, version)
);

CREATE INDEX ix_org_notices_lookup ON organization_notices (organization_id, version, effective_date DESC);

CREATE TABLE platform_notices (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL UNIQUE,
  effective_date TEXT NOT NULL,
  purpose TEXT NOT NULL,
  data_categories TEXT NOT NULL,
  module15_usage TEXT NOT NULL,
  retention_text TEXT NOT NULL,
  recipients TEXT NOT NULL,
  contact TEXT NOT NULL,
  rights TEXT NOT NULL,
  child_data_text TEXT NOT NULL,
  cross_border_text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Riwayat pemberitahuan yang benar-benar ditampilkan pada saat persetujuan dicatat.
CREATE TABLE consent_notice_versions (
  consent_id TEXT PRIMARY KEY REFERENCES consent_records(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  notice_id TEXT NOT NULL,
  notice_version TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
