-- Satu tautan publik per survei/versi. Mencegah dua publish paralel
-- membuat token berbeda untuk versi yang sama.
CREATE UNIQUE INDEX IF NOT EXISTS ux_public_links_survey_version
  ON public_links (survey_id, version_id);
