-- Operational lookups added with the Postgres migration.
-- These back session expiry sweeps, survey-scoped export/consent reads,
-- and the admin audit stream without changing any table shape.

CREATE INDEX ix_sessions_expires ON sessions(expires_at);
CREATE INDEX ix_responses_survey ON responses(survey_id);
CREATE INDEX ix_invitations_survey ON invitations(survey_id);
CREATE INDEX ix_public_links_survey ON public_links(survey_id);
CREATE INDEX ix_consent_survey_version ON consent_records(survey_id, version_id);
CREATE INDEX ix_audit_actor_at ON audit_logs(actor, at DESC);
