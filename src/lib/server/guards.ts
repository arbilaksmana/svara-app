import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { UI_MOCK } from '../mock-preview';

/**
 * Server-side role gates. Reads the existing session cookie, forwards it to the
 * Express API `/auth/me` endpoint, and never imports the client store.
 */
export interface ServerAccount {
  id: string;
  email: string;
  display_name: string;
  role: 'super_admin' | 'org_admin' | 'creator';
  status: string;
  organization_id?: string | null;
}

const API_INTERNAL_URL = (process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001').replace(/\/+$/, '');

/**
 * Akun dari cookie sesi lewat `/auth/me`, yang hanya membaca sesi; bootstrap penuh
 * tidak dibutuhkan untuk gerbang peran. 401/403 berarti tidak ada sesi aktif.
 */
export async function accountForCookie(cookie: string): Promise<ServerAccount | null> {
  if (!cookie) return null;

  let response: Response;
  try {
    response = await fetch(`${API_INTERNAL_URL}/api/v1/auth/me`, {
      headers: { accept: 'application/json', cookie },
      cache: 'no-store',
    });
  } catch {
    throw new Error(`API internal tidak dapat dijangkau di ${API_INTERNAL_URL}.`);
  }

  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) {
    throw new Error(`Pemeriksaan sesi gagal dengan status ${response.status}.`);
  }

  const payload = (await response.json()) as { data?: { account?: ServerAccount | null } };
  return payload.data?.account ?? null;
}

/** Akun pengganti saat mode preview UI (NEXT_PUBLIC_UI_MOCK=1) aktif: tanpa backend/login. */
const MOCK_ACCOUNT: ServerAccount = {
  id: 'u_admin',
  email: 'admin@svara.local',
  display_name: 'Rani Wijaya',
  role: 'super_admin',
  status: 'active',
  organization_id: null,
};

async function fetchAccount(): Promise<ServerAccount | null> {
  if (UI_MOCK) return MOCK_ACCOUNT;
  return accountForCookie((await cookies()).toString());
}

/**
 * Mirrors the previous client guard: unauthenticated -> login, super_admin
 * cannot open the creator workspace. Returns null when the role is denied.
 */
export async function requireCreator(): Promise<ServerAccount | null> {
  const account = await fetchAccount();
  if (!account) redirect('/auth/login');
  if (account.role === 'super_admin') return null;
  return account;
}

/** Halaman organisasi: hanya org_admin yang terikat organisasi. */
export async function requireOrgAdmin(): Promise<ServerAccount | null> {
  const account = await fetchAccount();
  if (!account) redirect('/auth/login');
  if (account.role !== 'org_admin' || !account.organization_id) return null;
  return account;
}

/** Mirrors the previous client guard: only super_admin may open /admin. */
export async function requireAdmin(): Promise<ServerAccount | null> {
  const account = await fetchAccount();
  if (!account) redirect('/auth/login');
  if (account.role !== 'super_admin') return null;
  return account;
}
