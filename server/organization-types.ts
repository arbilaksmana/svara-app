/**
 * Tipe organisasi yang diterima API saat membuat atau mengubah organisasi.
 * Klien memakai daftar label yang sama di src/lib/labels.ts (`ORGANIZATION_TYPE_LABEL`).
 */
export const ORGANIZATION_TYPES = [
  'school',
  'higher_education',
  'company',
  'cooperative',
  'government',
  'community',
  'organization',
] as const;

export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

/** Kolom DB bertipe TEXT, jadi pemeriksaan ini yang menjaga nilai di luar daftar tidak masuk lewat API. */
export const ORGANIZATION_TYPE_SET: ReadonlySet<string> = new Set(ORGANIZATION_TYPES);