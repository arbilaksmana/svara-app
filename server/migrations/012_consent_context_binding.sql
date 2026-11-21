ALTER TABLE consent_records
  ADD COLUMN public_link_id TEXT REFERENCES public_links(id),
  ADD COLUMN respondent_session_hash TEXT,
  ADD CONSTRAINT consent_context_binding CHECK (
    (respondent_session_hash IS NULL AND public_link_id IS NULL)
    OR (respondent_session_hash IS NOT NULL AND (public_link_id IS NULL) <> (invitation_id IS NULL))
  );

-- Existing records are retained without guessing the original respondent or public link.
