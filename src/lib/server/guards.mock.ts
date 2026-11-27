/**
 * Gerbang peran sisi server untuk mode preview UI (dev-only).
 *
 * Dipisah dari `guards.ts` karena `mock-preview.ts` memuat `process.env` yang di-inline
 * saat build: modul ini hanya diimpor secara dinamis di `guards.ts` saat preview aktif,
 * sehingga tidak ada `process.env` yang lolos ke bundel klien lewat jalur ini.
 */
import type { ServerAccount } from './guards';
import { MOCK_ACCOUNT } from '../mock-preview-client';

/** true hanya saat env preview aktif; dihitung saat modul dimuat (sisi server saja). */
export const UI_MOCK = process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_UI_MOCK === '1';

export async function fetchMockAccount(): Promise<ServerAccount | null> {
  return {
    id: MOCK_ACCOUNT.id,
    email: MOCK_ACCOUNT.email,
    display_name: MOCK_ACCOUNT.display_name,
    role: MOCK_ACCOUNT.role,
    status: MOCK_ACCOUNT.status,
    organization_id: MOCK_ACCOUNT.organization_id,
  };
}
