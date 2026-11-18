import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

/**
 * Server-side role gates. Reads the existing session cookie, forwards it to the
 * Express API bootstrap endpoint, and never imports the client store.
 */
export interface ServerAccount {
  id: string;
  email: string;
  display_name: string;
  role: 'super_admin' | 'creator' | 'authorized_officer';
  status: string;
}

const API_INTERNAL_URL = (process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001').replace(/\/+$/, '');

async function fetchAccount(): Promise<ServerAccount | null> {
  const cookie = (await cookies()).toString();
  if (!cookie) return null;

  let response: Response;
  try {
    response = await fetch(`${API_INTERNAL_URL}/api/v1/bootstrap`, {
      headers: { accept: 'application/json', cookie },
      cache: 'no-store',
    });
  } catch {
    throw new Error(`API internal tidak dapat dijangkau di ${API_INTERNAL_URL}.`);
  }

  if (!response.ok) {
    throw new Error(`Bootstrap sesi gagal dengan status ${response.status}.`);
  }

  const payload = (await response.json()) as { data?: { account?: ServerAccount | null } };
  return payload.data?.account ?? null;
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

/** Mirrors the previous client guard: only super_admin may open /admin. */
export async function requireAdmin(): Promise<ServerAccount | null> {
  const account = await fetchAccount();
  if (!account) redirect('/auth/login');
  if (account.role !== 'super_admin') return null;
  return account;
}
