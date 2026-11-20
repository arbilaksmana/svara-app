-- Baris lama tanpa masa berlaku (sebelum 008) diisi created_at + 14 hari, lalu
-- expires_at wajib terisi sehingga tidak ada lagi kode undangan tanpa batas.
UPDATE organization_invitations
SET expires_at = to_char((created_at::timestamptz AT TIME ZONE 'UTC') + interval '14 days',
                         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
WHERE expires_at IS NULL;
ALTER TABLE organization_invitations ALTER COLUMN expires_at SET NOT NULL;
