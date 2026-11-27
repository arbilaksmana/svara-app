/**
 * Validasi isian masa retensi di UI admin.
 *
 * Kosong berarti tanpa penghapusan otomatis (`null`); bilangan bulat >= 0 diterima apa adanya
 * (`0` juga fail-closed di `server/retention.ts`); selain itu `undefined` = tidak valid.
 */
export function parseRetentionDays(raw: string): number | null | undefined {
  const value = raw.trim();
  if (value === '') return null;
  if (!/^\d+$/.test(value)) return undefined;
  const days = Number(value);
  return Number.isSafeInteger(days) ? days : undefined;
}