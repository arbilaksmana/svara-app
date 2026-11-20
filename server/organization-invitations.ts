/**
 * Siklus hidup kode undangan organisasi: aktif, terpakai, dicabut, atau kedaluwarsa.
 * Dipakai rute organisasi (daftar/cabut) dan pendaftaran (konsumsi) agar keduanya
 * menilai kelayakan kode dengan aturan yang sama.
 */

export interface OrganizationInvitationRow {
  id: string;
  organization_id: string;
  code: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  used_at: string | null;
  used_by: string | null;
}

export type OrganizationInvitationStatus = 'active' | 'used' | 'revoked' | 'expired';

export const ORGANIZATION_INVITATION_COLUMNS =
  'id, organization_id, code, created_by, created_at, expires_at, revoked_at, used_at, used_by';

/** Semua kode berumur 14 hari; migrasi 009 mengisi baris lama dan mewajibkan expires_at. */
export const INVITATION_TTL_DAYS = 14;

/** Batas jumlah kode terbaru yang dikembalikan daftar undangan organisasi. */
export const INVITATION_LIST_LIMIT = 50;

export function invitationStatus(
  row: Pick<OrganizationInvitationRow, 'expires_at' | 'revoked_at' | 'used_at'>,
  now: string,
): OrganizationInvitationStatus {
  if (row.used_at) return 'used';
  if (row.revoked_at) return 'revoked';
  if (row.expires_at <= now) return 'expired';
  return 'active';
}

/** ISO-8601 UTC; perbandingan string aman karena semua waktu disimpan dengan format yang sama. */
export function invitationExpiry(createdAt: string): string {
  return new Date(Date.parse(createdAt) + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}
