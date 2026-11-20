-- Masa berlaku dan pencabutan kode undangan organisasi.
-- NULL pada expires_at hanya berlaku untuk baris lama: kode baru selalu diberi masa berlaku.
ALTER TABLE organization_invitations ADD COLUMN expires_at TEXT;
ALTER TABLE organization_invitations ADD COLUMN revoked_at TEXT;
