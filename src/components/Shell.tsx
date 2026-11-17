import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { PlainLink, PolicyLinks, Badge } from './ui';
import { useToast } from './Toast';
import { ROUTES } from '../lib/routes';
import { signOut, useStore } from '../lib/store';

type ShellKind = 'public' | 'creator' | 'admin' | 'respondent';
const NAV: Record<ShellKind, { to: string; label: string }[]> = {
  public: [
    { to: ROUTES.home, label: 'Beranda' },
    { to: ROUTES.creator, label: 'Survei saya' },
    { to: ROUTES.privacy, label: 'Privasi' },
    { to: ROUTES.terms, label: 'Ketentuan' },
  ],
  creator: [
    { to: ROUTES.creator, label: 'Daftar survei' },
    { to: ROUTES.creatorEdit('s_demo1'), label: 'Editor' },
    { to: ROUTES.creatorResults('s_demo1'), label: 'Hasil' },
    { to: ROUTES.creatorSettings('s_demo1'), label: 'Pengaturan' },
  ],
  admin: [
    { to: ROUTES.admin, label: 'Ringkasan' },
    { to: ROUTES.adminAccounts, label: 'Akun & izin' },
    { to: ROUTES.adminAudit, label: 'Log audit' },
    { to: ROUTES.adminIntegration, label: 'Integrasi' },
  ],
  respondent: [
    { to: ROUTES.home, label: 'Beranda' },
    { to: ROUTES.creator, label: 'Survei saya' },
    { to: ROUTES.privacy, label: 'Privasi' },
    { to: ROUTES.terms, label: 'Ketentuan' },
  ],
};
function Wordmark() {
  return (
    <Link to={ROUTES.home} className="inline-flex min-h-[40px] items-center text-body font-bold text-ink no-underline">
      Svara
    </Link>
  );
}

/** Tautan navbar tanpa garis bawah; status aktif ditandai warna dan latar saja. */
function NavItem({ to, label, active }: { to: string; label: string; active: boolean }) {
  return (
    <li>
      <Link
        to={to}
        aria-current={active ? 'page' : undefined}
        className={`inline-flex min-h-[44px] items-center rounded-sm px-2 text-body-sm font-bold no-underline transition-colors duration-fast lg:px-3 ${
          active ? 'bg-action-soft text-action' : 'text-n600 hover:bg-n100'
        }`}
      >
        {label}
      </Link>
    </li>
  );
}

export function Shell({
  kind,
  children,
  title,
  subtitle,
}: {
  kind: ShellKind;
  children: ReactNode;
  title: string;
  subtitle?: string;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const notify = useToast();
  const { session } = useStore();
  const nav = NAV[kind];
  const inWorkspace = kind === 'creator' || kind === 'admin';
  const showAccount = inWorkspace && session !== null;
  const activePath = kind === 'respondent' ? ROUTES.home : location.pathname;

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <a
        href="#konten-utama"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-toast focus:rounded-md focus:bg-action focus:px-4 focus:py-2 focus:text-n0"
      >
        Lewati ke konten utama
      </a>

      <header className="sticky top-0 z-nav border-b border-n200 bg-n0/95 backdrop-blur-sm">
        <div className="mx-auto flex min-h-[64px] max-w-[1200px] flex-wrap items-center justify-between gap-2 px-4 py-2 lg:px-6">
          <Wordmark />

          {/* Slot tengah selalu ada dan berupa elemen yang sama di semua halaman. */}
          <div className="order-2 flex min-h-[40px] items-center gap-3 sm:order-none">
            {showAccount && session ? (
              <>
                <span className="hidden text-body-sm text-muted sm:inline">{session.name}</span>
                <Badge tone="neutral">{session.role === 'admin' ? 'Administrator' : 'Pengelola'}</Badge>
                <button
                  type="button"
                  onClick={() => {
                    signOut();
                    notify('Anda telah keluar.');
                    navigate(ROUTES.home);
                  }}
                  className="min-h-[40px] rounded-sm border border-n200 px-3 text-body-sm font-bold text-n600 hover:bg-n100"
                >
                  Keluar
                </button>
              </>
            ) : null}
          </div>

          <nav aria-label="Navigasi utama" className="order-3 w-full overflow-x-auto lg:order-none lg:w-auto lg:overflow-visible">
            <ul className="flex min-w-max items-center gap-1 lg:gap-2">
              {nav.map((item) => (
                <NavItem key={item.to} to={item.to} label={item.label} active={activePath === item.to} />
              ))}
            </ul>
          </nav>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-6 px-4 py-6 lg:flex-row lg:px-6 lg:py-8">
        {inWorkspace && (
          <aside aria-label="Navigasi bagian" className="shrink-0 lg:w-48">
            <p className="mb-3 hidden font-mono text-annotation tracking-mono text-n600 lg:block">WORKSPACE</p>
            <nav className="flex flex-row gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
              {nav.map((item) => (
                <PlainLink
                  key={item.to}
                  to={item.to}
                  className={`min-h-[40px] shrink-0 rounded-sm px-3 py-2 text-body-sm font-bold no-underline ${
                    location.pathname === item.to ? 'bg-n100 text-action' : 'text-n600 hover:bg-n50'
                  }`}
                >
                  {item.label}
                </PlainLink>
              ))}
            </nav>
            {session && (
              <div className="mt-6 hidden lg:block">
                <p className="font-mono text-annotation tracking-mono text-n600">AKUN</p>
                <p className="mt-1 text-body-sm font-bold text-ink">{session.name}</p>
                <p className="text-caption text-muted">{session.email}</p>
              </div>
            )}
          </aside>
        )}

        <main id="konten-utama" tabIndex={-1} className="min-w-0 flex-1">
          <div className="mb-6 flex flex-col gap-2">
            <h1 className="text-h1 font-bold text-ink">{title}</h1>
            {subtitle && <p className="max-w-[70ch] text-body text-muted">{subtitle}</p>}
          </div>
          {children}
        </main>
      </div>

      <footer className="border-t border-n200 bg-n50">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-2 px-4 py-6 lg:flex-row lg:items-center lg:justify-between lg:px-6">
          <div>
            <p className="text-body-sm font-bold text-ink">Svara</p>
            <p className="text-caption text-muted">Lingkungan demonstrasi dengan data contoh. Perubahan tersimpan di peramban ini.</p>
          </div>
          <PolicyLinks />
        </div>
      </footer>
    </div>
  );
}
