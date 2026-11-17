import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate, useSearchParams, Link } from 'react-router-dom';
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
  'creator-list': ['default', 'empty', 'search-empty', 'loading', 'error', 'permission-denied', 'closed', 'success'],
  'creator-edit': ['default', 'empty', 'loading', 'error', 'validation', 'permission-denied', 'success'],
  'creator-preview': ['default', 'empty', 'loading', 'error', 'validation', 'permission-denied', 'closed', 'expired', 'success'],
  'creator-publish': ['default', 'loading', 'error', 'validation', 'permission-denied', 'closed', 'success'],
  'creator-share': ['default', 'empty', 'loading', 'error', 'validation', 'permission-denied', 'closed', 'expired', 'revoked', 'success'],
  'creator-results': ['default', 'empty', 'loading', 'error', 'permission-denied', 'closed', 'no-answers', 'success'],
  'creator-settings': ['default', 'loading', 'error', 'validation', 'permission-denied', 'success'],
  'creator-history': ['default', 'empty', 'loading', 'error', 'permission-denied', 'closed', 'success'],
  'respondent-intro': ['default', 'loading', 'error', 'validation', 'permission-denied', 'closed', 'expired', 'revoked', 'success'],
  'respondent-form': ['default', 'loading', 'error', 'validation', 'permission-denied', 'closed', 'expired', 'revoked', 'success'],
  'respondent-review': ['default', 'loading', 'error', 'validation', 'permission-denied', 'closed', 'expired', 'revoked', 'conflict', 'success'],
  'respondent-receipt': ['default', 'loading', 'error', 'conflict', 'success'],
  'admin-summary': ['default', 'empty', 'loading', 'error', 'permission-denied'],
  'admin-accounts': ['default', 'empty', 'loading', 'error', 'validation', 'permission-denied', 'success'],
  'admin-audit': ['default', 'empty', 'loading', 'error', 'permission-denied'],
  'admin-integration': ['default', 'loading', 'error', 'permission-denied', 'conflict', 'success'],
  privacy: ['default', 'loading', 'error'],
  terms: ['default', 'loading', 'error'],
  notfound: ['default'],
};

interface StateContextValue {
  raw: StateCode | null;
  link: (to: string) => string;
  navigateWithState: (state: StateCode) => void;
}

const StateContext = createContext<StateContextValue | null>(null);

/** Membaca ?state= dari URL. Dipasang di dalam Router. */
export function ScreenStateProvider({ children }: { children: ReactNode }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const param = params.get('state');
  const raw = STATE_CODES.includes(param as StateCode) ? (param as StateCode) : null;

  const value: StateContextValue = {
    raw,
    link: (to: string) => withState(to, raw),
    navigateWithState: (state: StateCode) => {
      const next = new URLSearchParams(location.search);
      if (state === 'default') next.delete('state');
      else next.set('state', state);
      const qs = next.toString();
      navigate(`${location.pathname}${qs ? `?${qs}` : ''}`);
    },
  };

  return <StateContext.Provider value={value}>{children}</StateContext.Provider>;
}

function useProvider(): StateContextValue {
  const ctx = useContext(StateContext);
  if (!ctx) throw new Error('ScreenStateProvider belum dipasang');
  return ctx;
}

export interface ScreenState {
  /** State aktif, sudah divalidasi terhadap daftar layar. */
  state: StateCode;
  link: (to: string) => string;
  setState: (state: StateCode) => void;
  allowed: readonly StateCode[];
}

export function useScreenState(routeId: RouteId): ScreenState {
  const ctx = useProvider();
  const allowed = ROUTE_STATES[routeId];
  const state: StateCode = ctx.raw && allowed.includes(ctx.raw) ? ctx.raw : 'default';
  return { state, link: ctx.link, setState: ctx.navigateWithState, allowed };
}

/** Link yang otomatis membawa ?state= aktif. */
export function StateLink({
  to,
  children,
  className,
  ariaLabel,
}: {
  to: string;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  const ctx = useProvider();
  return (
    <Link to={ctx.link(to)} className={className} aria-label={ariaLabel}>
      {children}
    </Link>
  );
}

/** Panel pemilih state. HANYA dirender saat import.meta.env.DEV. */
export function DevStateSwitcher({ routeId }: { routeId: RouteId }) {
  const { state, setState, allowed } = useScreenState(routeId);
  if (!import.meta.env.DEV) return null;
  return (
    <aside aria-label="Pemilih state pengembangan" className="border-t border-n200 bg-n100">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-2 px-4 py-2 lg:px-6">
        <span className="font-mono text-caption font-bold text-n600">DEV · state</span>
        {allowed.map((code) => (
          <button
            key={code}
            type="button"
            onClick={() => setState(code)}
            aria-pressed={state === code}
            className={`min-h-[32px] rounded-sm px-2 font-mono text-annotation font-bold transition-colors duration-fast ${
              state === code
                ? 'bg-action text-n0'
                : 'border border-n200 bg-n0 text-n600 hover:bg-action-soft'
            }`}
          >
            {code}
          </button>
        ))}
      </div>
    </aside>
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
