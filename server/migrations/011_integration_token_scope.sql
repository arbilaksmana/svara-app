CREATE TABLE integration_token_scopes (
  token_hash TEXT PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  survey_id TEXT REFERENCES surveys(id) ON DELETE CASCADE,
  CONSTRAINT integration_token_scope_exactly_one_resource
    CHECK ((organization_id IS NULL) <> (survey_id IS NULL))
);
