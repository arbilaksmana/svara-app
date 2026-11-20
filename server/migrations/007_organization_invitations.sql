-- Undangan bergabung ke organisasi (sekali pakai). Kode dibagikan manual oleh org_admin.
CREATE TABLE organization_invitations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  code TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES accounts(id),
  created_at TEXT NOT NULL,
  used_at TEXT,
  used_by TEXT REFERENCES accounts(id)
);
