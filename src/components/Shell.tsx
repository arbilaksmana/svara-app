import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { PlainLink, PolicyLinks } from './ui';
import { useToast } from './Toast';
import { ROUTES } from '../lib/routes';
import { signOut, useStore } from '../lib/store';

type ShellKind = 'public' | 'creator' | 'admin' | 'respondent';
export type NavEntry = { to: string; label: string };

/* Tamu memakai tautan bagian landing; anchor absolut agar tetap benar dari halaman lain. */
const GUEST_NAV: NavEntry[] = [
  { to: `${ROUTES.home}#kemampuan`, label: 'Kemampuan' },
  { to: `${ROUTES.home}#persetujuan`, label: 'Persetujuan' },
  { to: `${ROUTES.home}#alur`, label: 'Alur' },
  { to: `${ROUTES.home}#faq`, label: 'FAQ' },
];

const NAV: Record<ShellKind, NavEntry[]> = {
  public: GUEST_NAV,
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
  respondent: GUEST_NAV,
};

/* Sama dengan referensi: sudut atas rata menempel tepi, sudut bawah membulat. */
const OUTER = 'rounded-b-[18px] corner-squircle';
const INNER = 'rounded-[10px] corner-squircle';
const PRESS = 'transition-[transform,background-color,color] duration-150 ease-out';
const PRESS_LINK = `${PRESS} motion-safe:active:scale-[0.96]`;
const PRESS_BUTTON = `${PRESS} motion-safe:enabled:active:scale-[0.96]`;

function Wordmark() {
  return (
    <Link
      to={ROUTES.home}
      className={`inline-flex min-h-[40px] shrink-0 items-center px-2 text-body font-semibold text-n0 no-underline ${INNER} ${PRESS_LINK}`}
    >
      Svara
    </Link>
  );
}

function NavItem({ to, label, active }: NavEntry & { active: boolean }) {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={`inline-flex min-h-[40px] shrink-0 items-center rounded-full px-2.5 text-body-sm font-normal no-underline ${PRESS_LINK} ${
        active ? 'text-n0' : 'text-n400 hover:text-n0'
      }`}
    >
      {label}
    </Link>
  );
}

function PillNavbar({ nav, activePath, guestOnly = false }: { nav: NavEntry[]; activePath: string; guestOnly?: boolean }) {
  const navigate = useNavigate();
  const notify = useToast();
  const { session } = useStore();
  // Di landing, pengguna dianggap belum masuk walau stor masih menyimpan sesi.
  const current = guestOnly ? null : session;
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-nav">
      <div className="relative mx-auto w-fit max-w-[calc(100%-2rem)]">
        <div className={`relative flex items-center gap-3 bg-dark p-2 sm:gap-5 ${OUTER}`}>
          {/* Fillet cekung, path diambil dari SVG nav referensi (20x20 per sudut). */}
          {([-1, 1] as const).map((side) => (
            <span
              key={side}
              aria-hidden="true"
              className={`pointer-events-none absolute top-0 size-[20px] ${side === -1 ? '-start-[20px]' : '-end-[20px]'}`}
            >
              <svg viewBox="0 0 20 20" className={`size-full ${side === -1 ? '-scale-x-100' : ''}`} fill="var(--color-dark)">
                <path d="M 0 0 L 20 0 C 8.954 0 0 8.954 0 20 Z" />
              </svg>
            </span>
          ))}
          <div className="flex min-w-0 items-center gap-5">
            <Wordmark />

          {/* Desktop: deretan tautan seperti referensi. */}
            <nav aria-label="Navigasi utama" className="hidden sm:block">
              <ul className="flex items-center gap-1">
                {nav.map((item) => (
                  <li key={item.to}>
                    <NavItem {...item} active={activePath === item.to} />
                  </li>
                ))}
              </ul>
            </nav>

            {/* Mobile: satu pemicu menu, jadi tidak ada tautan yang terpotong. */}
            <button
              type="button"
              aria-expanded={menuOpen}
              aria-controls="pill-menu"
              onClick={() => setMenuOpen((v) => !v)}
              className={`inline-flex min-h-[40px] items-center rounded-full px-2.5 text-body-sm font-normal text-n400 sm:hidden ${PRESS_BUTTON} hover:text-n0`}
            >
              Menu
            </button>
          </div>

          {current ? (
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  signOut();
                  notify('Anda telah keluar.');
                  navigate(ROUTES.home);
                }}
                className={`inline-flex min-h-[40px] min-w-[88px] shrink-0 items-center justify-center rounded-[18px] corner-squircle bg-n0 px-5 text-body-sm font-semibold text-ink ${PRESS_BUTTON} hover:bg-n100`}
              >
                Keluar
              </button>
            </div>
          ) : (
            <Link
              to={ROUTES.login}
              className={`inline-flex min-h-[40px] min-w-[88px] shrink-0 items-center justify-center rounded-[18px] corner-squircle bg-n0 px-5 text-body-sm font-semibold text-ink no-underline hover:bg-n100 ${PRESS_LINK}`}
            >
              Masuk
            </Link>
          )}
        </div>

        {menuOpen && (
          <nav
            id="pill-menu"
            aria-label="Navigasi seluler"
            className={`absolute inset-x-0 top-full mt-2 border border-n200 bg-n0 p-1.5 shadow-overlay sm:hidden rounded-[16px] corner-squircle`}
          >
            <ul className="flex flex-col gap-1">
              {nav.map((item) => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    onClick={() => setMenuOpen(false)}
                    aria-current={activePath === item.to ? 'page' : undefined}
                    className={`flex min-h-[44px] items-center px-3 text-body-sm font-normal no-underline ${INNER} transition-colors duration-150 ease-out ${
                      activePath === item.to ? 'bg-action-soft text-action' : 'text-ink hover:bg-n100'
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
    </header>
  );
}

export function Shell({
  kind,
  children,
  title,
  subtitle,
  hideHeading = false,
  guestOnly = false,
  chromeless = false,
}: {
  kind: ShellKind;
  children: ReactNode;
  title: string;
  subtitle?: string;
  /** Halaman yang menyediakan judulnya sendiri (mis. landing) agar tidak ada dua h1. */
  hideHeading?: boolean;
  /** Landing: navbar selalu tampil seperti pengunjung yang belum masuk. */
  guestOnly?: boolean;
  /** Halaman yang mengatur layout sendiri (mis. login): tanpa navbar dan footer. */
  chromeless?: boolean;
}) {
  const location = useLocation();
  const { session } = useStore();
  const sectionNav = NAV[kind];
  const inWorkspace = kind === 'creator' || kind === 'admin';
  // Tamu melihat tautan bagian landing; pengguna masuk melihat menu sesuai perannya.
  const activeSession = guestOnly ? null : session;
  const topNav = activeSession ? (activeSession.role === 'admin' ? NAV.admin : NAV.creator) : GUEST_NAV;
  const activePath =
    kind === 'respondent'
      ? ROUTES.home
      : location.pathname.startsWith(ROUTES.creator)
        ? ROUTES.creator
        : location.pathname;

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <a
        href="#konten-utama"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-toast focus:rounded-md focus:bg-action focus:px-4 focus:py-2 focus:text-n0"
      >
        Lewati ke konten utama
      </a>

      {!chromeless && <PillNavbar nav={topNav} activePath={activePath} guestOnly={guestOnly} />}

      {chromeless ? (
        <main id="konten-utama" tabIndex={-1} className="flex flex-1 flex-col">
          {children}
        </main>
      ) : (
      <div className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-6 px-4 py-6 lg:flex-row lg:px-6 lg:py-8">
        {inWorkspace && (
          <aside aria-label="Navigasi bagian" className="shrink-0 lg:w-48">
            <p className="mb-3 hidden font-mono text-annotation tracking-mono text-n600 lg:block">WORKSPACE</p>
            <nav className="flex flex-row gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
              {sectionNav.map((item) => (
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
          {!hideHeading && (
            <div className="mb-6 flex flex-col gap-2">
              <h1 className="text-h1 font-bold text-ink">{title}</h1>
              {subtitle && <p className="max-w-[70ch] text-body text-muted">{subtitle}</p>}
            </div>
          )}
          {children}
        </main>
      </div>
      )}

      {!chromeless && (
      <footer className="border-t border-n200 bg-n50">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-2 px-4 py-6 lg:flex-row lg:items-center lg:justify-between lg:px-6">
          <div>
            <p className="text-body-sm font-bold text-ink">Svara</p>
            <p className="text-caption text-muted">Lingkungan demonstrasi dengan data contoh. Perubahan tersimpan di peramban ini.</p>
          </div>
          <PolicyLinks />
        </div>
      </footer>
      )}
    </div>
  );
}
