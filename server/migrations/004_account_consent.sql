ALTER TABLE accounts ADD COLUMN consent_version TEXT;
ALTER TABLE accounts ADD COLUMN consent_accepted_at TEXT;
ALTER TABLE accounts ADD CONSTRAINT accounts_consent_pair
  CHECK ((consent_version IS NULL) = (consent_accepted_at IS NULL));
