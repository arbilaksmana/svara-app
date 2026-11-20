-- Tenancy dasar: organisasi pengendali, profil platform tunggal, dan kolom tautan.
-- Aditif saja: tidak ada kolom lama yang diubah atau dihapus, dan baris lama tetap
-- valid dengan NULL pada kolom baru.

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  organization_type TEXT NOT NULL,
  policy_url TEXT NOT NULL,
  terms_url TEXT NOT NULL,
  retention_days INTEGER,
  data_request_contact TEXT,
  cross_border_transfer INTEGER,
  notice_version TEXT NOT NULL DEFAULT '1.0',
  created_at TEXT NOT NULL
);

CREATE TABLE platform_profile (
  id TEXT PRIMARY KEY,
  organization_name TEXT NOT NULL,
  organization_type TEXT NOT NULL,
  policy_url TEXT NOT NULL,
  terms_url TEXT NOT NULL,
  retention_days INTEGER,
  data_request_contact TEXT,
  cross_border_transfer INTEGER,
  notice_version TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT platform_profile_single_row CHECK (id = 'platform')
);

ALTER TABLE accounts ADD COLUMN organization_id TEXT REFERENCES organizations(id);
ALTER TABLE surveys ADD COLUMN organization_id TEXT REFERENCES organizations(id);
ALTER TABLE audit_logs ADD COLUMN account_id TEXT REFERENCES accounts(id);
ALTER TABLE audit_logs ADD COLUMN organization_id TEXT REFERENCES organizations(id);
