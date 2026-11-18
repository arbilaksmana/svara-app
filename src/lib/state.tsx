'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { RouteId } from './routes';
import { withState } from './routes';

export const STATE_CODES = [
  'default',
  'empty',
  'search-empty',
  'loading',
  'error',
  'validation',
  'permission-denied',
  'closed',
  'expired',
  'revoked',
  'conflict',
  'no-answers',
  'success',
] as const;

export type StateCode = (typeof STATE_CODES)[number];

/** State yang diizinkan per layar. Sama dengan matriks README.md §4. */
export const ROUTE_STATES: Record<RouteId, readonly StateCode[]> = {
  home: ['default', 'empty', 'loading', 'error'],
  login: ['default', 'loading', 'error', 'validation', 'permission-denied', 'expired', 'revoked', 'success'],
  register: ['default', 'loading', 'error', 'validation', 'success'],
  'creator-list': ['default', 'empty', 'search-empty', 'loading', 'error', 'permission-denied', 'closed', 'success'],
  'creator-edit': ['default', 'empty', 'loading', 'error', 'validation', 'permission-denied', 'success'],
  'creator-preview': ['default', 'empty', 'loading', 'error', 'validation', 'permission-denied', 'closed', 'expired', 'success'],
  'creator-publish': ['default', 'loading', 'error', 'validation', 'permission-denied', 'closed', 'success'],
  'creator-share': ['default', 'empty', 'loading', 'error', 'validation', 'permission-denied', 'closed', 'expired', 'revoked', 'success'],
  'creator-results': ['default', 'empty', 'loading', 'error', 'permission-denied', 'closed', 'no-answers', 'success'],
  'creator-settings': ['default', 'loading', 'error', 'validation', 'permission-denied', 'success'],
  'creator-history': ['default', 'empty', 'loading', 'error', 'permission-denied', 'closed', 'success'],
  'respondent-code': ['default', 'loading', 'error', 'validation'],
  'respondent-intro': ['default', 'loading', 'error', 'validation', 'permission-denied', 'closed', 'expired', 'revoked', 'success'],
  'respondent-form': ['default', 'loading', 'error', 'validation', 'permission-denied', 'closed', 'expired', 'revoked', 'success'],
  'respondent-review': ['default', 'loading', 'error', 'validation', 'permission-denied', 'closed', 'expired', 'revoked', 'conflict', 'success'],
  'respondent-receipt': ['default', 'loading', 'error', 'conflict', 'success'],
  'admin-summary': ['default', 'empty', 'loading', 'error', 'permission-denied'],
  'admin-accounts': ['default', 'empty', 'loading', 'error', 'validation', 'permission-denied', 'success'],
  'admin-audit': ['default', 'empty', 'loading', 'error', 'permission-denied'],
  'admin-integration': ['default', 'loading', 'error', 'permission-denied', 'conflict', 'success'],
  'admin-requests': ['default', 'empty', 'loading', 'error', 'validation', 'permission-denied', 'success'],
  privacy: ['default', 'loading', 'error'],
  terms: ['default', 'loading', 'error'],
  notfound: ['default'],
};

function rawState(param: string | null): StateCode | null {
  if (process.env.NODE_ENV === 'production') return null;
  return STATE_CODES.includes(param as StateCode) ? (param as StateCode) : null;
}

export interface ScreenState {
  /** State aktif, sudah divalidasi terhadap daftar layar. */
  state: StateCode;
  link: (to: string) => string;
  setState: (state: StateCode) => void;
  allowed: readonly StateCode[];
}

/** Membaca ?state= dari URL halaman aktif. */
export function useScreenState(routeId: RouteId): ScreenState {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const raw = rawState(params?.get('state') ?? null);
  const allowed = ROUTE_STATES[routeId];
  const state: StateCode = raw && allowed.includes(raw) ? raw : 'default';

  const setState = (next: StateCode) => {
    const query = new URLSearchParams(params?.toString() ?? '');
    if (next === 'default') query.delete('state');
    else query.set('state', next);
    const qs = query.toString();
    router.push(`${pathname}${qs ? `?${qs}` : ''}`);
  };

  return { state, link: (to: string) => withState(to, raw), setState, allowed };
}

/** Link yang otomatis membawa ?state= aktif. */
export function StateLink({
  to,
  children,
  className,
  ariaLabel,
  ariaCurrent,
  onClick,
}: {
  to: string;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
  ariaCurrent?: 'page';
  onClick?: () => void;
}) {
  const params = useSearchParams();
  return (
    <Link
      href={withState(to, rawState(params?.get('state') ?? null))}
      className={className}
      aria-label={ariaLabel}
      aria-current={ariaCurrent}
      onClick={onClick}
    >
      {children}
    </Link>
  );
}

export function isBlockingState(state: StateCode): boolean {
  return (
    state === 'closed' ||
    state === 'expired' ||
    state === 'revoked' ||
    state === 'permission-denied' ||
    state === 'error' ||
    state === 'loading' ||
    state === 'conflict'
  );
}
