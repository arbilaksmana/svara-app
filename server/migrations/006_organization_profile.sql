-- Profil deployment per organisasi (PRD §1.2). Aditif: baris lama mendapat
-- default aman (responden dewasa, persetujuan diri) tanpa menyentuh data lain.

ALTER TABLE organizations ADD COLUMN respondent_age_category TEXT NOT NULL DEFAULT 'adult';
ALTER TABLE organizations ADD COLUMN consent_mode TEXT NOT NULL DEFAULT 'self';
