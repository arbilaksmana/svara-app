import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { PlainLink, PolicyLinks, Code } from './ui';
import { ROUTES } from '../lib/routes';

type ShellKind = 'public' | 'creator' | 'admin' | 'respondent';

const NAV: Record<ShellKind, { to: string; label: string }[]> = {
  public: [
    { to: ROUTES.home, label: 'Beranda' },
    { to: ROUTES.login, label: 'Masuk pengelola' },
    { to: ROUTES.creator, label: 'Creator' },
    { to: ROUTES.admin, label: 'Admin' },
    { to: ROUTES.privacy, label: 'Privasi' },
  ],
  creator: [
    { to: ROUTES.creator, label: 'Daftar survei' },
    { to: ROUTES.creatorEdit('s_demo1'), label: 'Editor' },
    { to: ROUTES.creatorResults('s_demo1'), label: 'Hasil' },
    { to: ROUTES.creatorSettings('s_demo1'), label: 'Pengaturan' },
    { to: ROUTES.admin, label: 'Admin' },
    { to: ROUTES.login, label: 'Keluar (simulasi)' },
  ],
  admin: [
    { to: ROUTES.admin, label: 'Ringkasan' },
    { to: ROUTES.adminAccounts, label: 'Akun & izin' },
    { to: ROUTES.adminAudit, label: 'Log audit' },
    { to: ROUTES.adminIntegration, label: 'Integrasi' },
    { to: ROUTES.creator, label: 'Ke creator' },
  ],
  respondent: [
    { to: ROUTES.home, label: 'Beranda' },
    { to: ROUTES.privacy, label: 'Privasi' },
    { to: ROUTES.terms, label: 'Ketentuan' },
  ],
};

function Wordmark() {
  return (
    <PlainLink to={ROUTES.home} className="flex items-center gap-2 no-underline">
      <span aria-hidden="true" className="grid size-8 place-items-center rounded-sm bg-action font-mono text-caption font-bold text-n0">
        14
      </span>
      <span className="text-body font-bold text-ink no-underline">Modul 14</span>
    </PlainLink>
  );
}

export function Shell({
  kind,
  children,
  title,
  subtitle,
  routeId,
}: {
  kind: ShellKind;
  children: ReactNode;
  title: string;
  subtitle?: string;
  routeId: string;
}) {
  const location = useLocation();
  const nav = NAV[kind];

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
          <span className="hidden font-mono text-annotation tracking-mono text-n600 sm:inline">
            PRATINJAU UI · DATA SINTETIS
          </span>
          <nav aria-label="Navigasi utama" className="order-3 w-full overflow-x-auto lg:order-none lg:w-auto lg:overflow-visible">
            <ul className="flex min-w-max items-center gap-1 lg:gap-2">
              {nav.map((item) => {
                const active = location.pathname === item.to;
                return (
                  <li key={item.to}>
                    <PlainLink
                      to={item.to}
                      className={`min-h-[44px] rounded-sm px-2 text-body-sm no-underline lg:px-3 ${
                        active ? 'bg-action-soft font-bold text-action' : 'font-bold text-n600 hover:bg-n100'
                      }`}
                    >
                      {item.label}
                    </PlainLink>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-6 px-4 py-6 lg:flex-row lg:px-6 lg:py-8">
        {kind !== 'public' && kind !== 'respondent' && (
          <aside aria-label="Navigasi bagian" className="shrink-0 lg:w-48">
            <nav className="flex flex-row gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
              {nav.slice(0, kind === 'creator' ? 4 : 4).map((item) => (
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
            <div className="mt-6 hidden lg:block">
              <p className="font-mono text-annotation tracking-mono text-n600">PROFIL AKTIF</p>
              <p className="mt-1 text-caption text-muted">
                <Code>{routeId}</Code>
              </p>
            </div>
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
        <div className="mx-auto flex max-w-[1200px] flex-col gap-3 px-4 py-6 lg:flex-row lg:items-center lg:justify-between lg:px-6">
          <div>
            <p className="text-body-sm font-bold text-ink">Modul 14 · pratinjau antarmuka statis</p>
            <p className="text-caption text-muted">
              Seluruh data sintetis. Tidak ada backend, basis data, atau autentikasi nyata.
            </p>
          </div>
          <PolicyLinks />
        </div>
      </footer>
    </div>
  );
}

export function LegalPageTitle({ children, version }: { children: ReactNode; version: string }) {
  return (
    <div className="mb-6 flex flex-col gap-2 border-b border-n200 pb-4">
      <h1 className="text-h1 font-bold text-ink">{children}</h1>
      <p className="font-mono text-caption tracking-mono text-muted">
        Versi {version} · berlaku 17 November 2026 · placeholder sintetis
      </p>
    </div>
  );
}
