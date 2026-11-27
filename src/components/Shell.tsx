'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { BrandMark } from './Brand';
import { PlainLink, PolicyLinks } from './ui';
import { useToast } from './Toast';
import { ROUTES, homeForRole } from '../lib/routes';
import { allowNavigation, confirmIfDirty, useNavigationGuard } from '../lib/navigation-guard';
import { signOut, useStore } from '../lib/store';
import { activeNavTo, navPath, type NavEntry } from '../lib/nav';
import { AdminSidebar } from './AdminSidebar';

type ShellKind = 'public' | 'creator' | 'admin' | 'respondent';
export type { NavEntry };

/** Halaman super admin yang memakai chrome dasbor baru (sidebar bergrup). */
const ADMIN_CHROME_PATHS = new Set<string>([
  ROUTES.admin,
  ROUTES.adminAccounts,
  ROUTES.adminAudit,
  ROUTES.adminIntegration,
  ROUTES.adminRequests,
  ROUTES.adminPlatform,
]);

/* Tamu memakai tautan bagian landing; anchor absolut agar tetap benar dari halaman lain. */
const GUEST_NAV: NavEntry[] = [
  { to: `${ROUTES.home}#kemampuan`, label: 'Kemampuan' },
  { to: `${ROUTES.home}#persetujuan`, label: 'Persetujuan' },
  { to: `${ROUTES.home}#alur`, label: 'Alur' },
  { to: `${ROUTES.home}#faq`, label: 'FAQ' },
];

/* Ruang organisasi: hanya org_admin yang melihat entri ini. */
const ORG_NAV: NavEntry[] = [
  { to: ROUTES.adminOrg, label: 'Organisasi' },
  { to: ROUTES.adminOrgEvidence, label: 'Bukti pendukung' },
  { to: ROUTES.creator, label: 'Daftar survei' },
];

const NAV: Record<ShellKind, NavEntry[]> = {
  public: GUEST_NAV,
  creator: [
    { to: ROUTES.creator, label: 'Daftar survei' },
  ],
  admin: [
    { to: ROUTES.admin, label: 'Ringkasan' },
    { to: ROUTES.adminAccounts, label: 'Akun & izin' },
    { to: ROUTES.adminPlatform, label: 'Profil platform' },
    { to: ROUTES.adminAudit, label: 'Log audit' },
    { to: ROUTES.adminIntegration, label: 'Integrasi' },
    { to: ROUTES.adminRequests, label: 'Permintaan data' },
  ],
  respondent: [],
};

/* Sama dengan referensi: sudut atas rata menempel tepi, sudut bawah membulat. */
const OUTER = 'rounded-b-[18px] corner-squircle';
const INNER = 'rounded-[10px] corner-squircle';
const PRESS = 'transition-[transform,background-color,color] duration-150 ease-out';
const PRESS_LINK = `${PRESS} motion-safe:active:scale-[0.96]`;
const PRESS_BUTTON = `${PRESS} motion-safe:enabled:active:scale-[0.96]`;

/* Deretan tautan desktop mulai sm; nav panjang (admin, ±880px) baru muat mulai 60rem, di bawahnya memakai menu ringkas. */
const DESKTOP_NAV = {
  short: { fit: 'sm:w-fit', gap: 'sm:gap-5', row: 'sm:w-auto sm:justify-start', block: 'sm:block', flex: 'sm:flex', inlineFlex: 'sm:inline-flex', hidden: 'sm:hidden' },
  long: { fit: 'min-[60rem]:w-fit', gap: 'min-[60rem]:gap-5', row: 'min-[60rem]:w-auto min-[60rem]:justify-start', block: 'min-[60rem]:block', flex: 'min-[60rem]:flex', inlineFlex: 'min-[60rem]:inline-flex', hidden: 'min-[60rem]:hidden' },
};

function Wordmark({ to }: { to: string | null }) {
  const guard = useNavigationGuard();
  const brand = (
    <>
      <BrandMark />
      <span className="hidden sm:inline">Svara</span>
    </>
  );
  // Alur responden tanpa tautan keluar: merek tampil sebagai penanda, bukan jalan pintas ke landing.
  if (to === null) {
    return <span className={`inline-flex min-h-[44px] shrink-0 items-center gap-2 px-2 text-body font-semibold text-n0 ${INNER}`}>{brand}</span>;
  }
  return (
    <Link
      href={to}
      onClick={(event) => { if (!allowNavigation(event, guard)) event.preventDefault(); }}
      aria-label="Svara"
      className={`inline-flex min-h-[44px] shrink-0 items-center gap-2 px-2 text-body font-semibold text-n0 no-underline ${INNER} ${PRESS_LINK}`}
    >
      {brand}
    </Link>
  );
}

function NavItem({ to, label, active }: NavEntry & { active: boolean }) {
  const guard = useNavigationGuard();
  return (
    <Link
      href={to}
      onClick={(event) => { if (!allowNavigation(event, guard)) event.preventDefault(); }}
      aria-current={active ? 'page' : undefined}
      className={`inline-flex min-h-[44px] shrink-0 items-center rounded-full px-2.5 text-body-sm font-normal ${PRESS_LINK} ${
        active ? 'text-n0 underline decoration-2 underline-offset-4' : 'text-n400 no-underline hover:text-n0'
      }`}
    >
      {label}
    </Link>
  );
}

function PillNavbar({ nav, activePath, guestOnly = false, guestActions = true, homeTo }: { nav: NavEntry[]; activePath: string; guestOnly?: boolean; guestActions?: boolean; homeTo: string | null }) {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const notify = useToast();
  const { session } = useStore();
  const guard = useNavigationGuard();
  // Di landing, pengguna dianggap belum masuk walau stor masih menyimpan sesi.
  const current = guestOnly ? null : session;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLElement>(null);
  const bp = DESKTOP_NAV[nav.length > GUEST_NAV.length ? 'long' : 'short'];

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (menuRef.current?.contains(document.activeElement)) menuButtonRef.current?.focus();
      setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  function handleSignOut() {
    if (!confirmIfDirty(guard)) return;
    setMenuOpen(false);
    void signOut().finally(() => {
      notify('Anda telah keluar.');
      router.push(ROUTES.home);
    });
  }

  return (
    <header className="sticky top-0 z-nav">
      <div className={`relative mx-auto w-[calc(100%-3.5rem)] ${bp.fit}`}>
        <div className={`relative flex items-center gap-3 bg-dark p-2 ${bp.gap} ${OUTER}`}>
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
          <div className={`flex w-full min-w-0 items-center justify-between gap-5 ${bp.row}`}>
            <Wordmark to={homeTo} />

          {/* Desktop: deretan tautan seperti referensi. Alur responden tanpa tautan tidak merender nav kosong. */}
          {nav.length > 0 && (
            <nav aria-label="Navigasi utama" className={`hidden ${bp.block}`}>
              <ul className="flex items-center gap-1">
                {nav.map((item) => (
                  <li key={item.to}>
                    <NavItem {...item} active={activePath === item.to} />
                  </li>
                ))}
              </ul>
            </nav>
          )}

            {/* Mobile: satu pemicu menu, jadi tidak ada tautan yang terpotong. */}
            {(nav.length > 0 || current || guestActions) && (
              <button
                ref={menuButtonRef}
                type="button"
                aria-expanded={menuOpen}
                aria-controls="pill-menu"
                aria-label={menuOpen ? 'Tutup menu' : 'Buka menu'}
                onClick={() => setMenuOpen((v) => !v)}
                className={`inline-flex size-11 items-center justify-center rounded-full text-n400 ${bp.hidden} ${PRESS_BUTTON} hover:text-n0`}
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  className="size-5"
                >
                  {menuOpen ? (
                    <>
                      <path d="M5 5l10 10" />
                      <path d="M15 5 5 15" />
                    </>
                  ) : (
                    <>
                      <path d="M3 6h14" />
                      <path d="M3 10h14" />
                      <path d="M3 14h14" />
                    </>
                  )}
                </svg>
              </button>
            )}
          </div>

          {current ? (
            <div className={`hidden shrink-0 items-center gap-1 ${bp.flex}`}>
              <button
                type="button"
                onClick={handleSignOut}
                className={`inline-flex min-h-[44px] min-w-[88px] shrink-0 items-center justify-center rounded-[18px] corner-squircle bg-n0 px-5 text-body-sm font-semibold text-ink ${PRESS_BUTTON} hover:bg-n100`}
              >
                Keluar
              </button>
            </div>
          ) : guestActions ? (
            <Link
              href={ROUTES.login}
              className={`hidden min-h-[44px] min-w-[88px] shrink-0 items-center justify-center rounded-[18px] corner-squircle bg-n0 px-5 text-body-sm font-semibold text-ink no-underline hover:bg-n100 ${bp.inlineFlex} ${PRESS_LINK}`}
            >
              Masuk
            </Link>
          ) : null}
        </div>

        {menuOpen && (
          <nav
            ref={menuRef}
            id="pill-menu"
            aria-label="Navigasi seluler"
            className={`absolute left-1/2 top-full mt-2 w-[calc(100vw-2rem)] max-w-[24rem] -translate-x-1/2 border border-n200 bg-n0 p-1.5 shadow-overlay ${bp.hidden} rounded-[16px] corner-squircle`}
          >
            <ul className="flex flex-col gap-1">
              {nav.map((item) => (
                <li key={item.to}>
                  <Link
                    href={item.to}
                    onClick={(event) => {
                      if (!allowNavigation(event, guard)) return;
                      setMenuOpen(false);
                    }}
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
            {(current || guestActions) && (
              <div className="mt-1 border-t border-n200 pt-1">
                {current ? (
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="flex min-h-[44px] w-full items-center justify-center rounded-[10px] bg-dark px-3 text-body-sm font-semibold text-n0"
                  >
                    Keluar
                  </button>
                ) : (
                  <Link
                    href={ROUTES.login}
                    onClick={(event) => {
                      if (!allowNavigation(event, guard)) {
                        event.preventDefault();
                        return;
                      }
                      setMenuOpen(false);
                    }}
                    className="flex min-h-[44px] items-center justify-center rounded-[10px] bg-dark px-3 text-body-sm font-semibold text-n0 no-underline"
                  >
                    Masuk
                  </Link>
                )}
              </div>
            )}
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
  bottomInset = false,
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
  /** Beri ruang bawah di footer saat halaman memiliki action bar tetap di mobile. */
  bottomInset?: boolean;
}) {
  const pathname = usePathname() ?? '';
  const { session, ready } = useStore();
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    window.scrollTo(0, 0);
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname]);
  const inWorkspace = kind === 'creator' || kind === 'admin';
  // Tamu melihat tautan bagian landing; pengguna masuk melihat menu sesuai perannya.
  const activeSession = guestOnly || kind === 'respondent' ? null : session;
  const homeTo = !activeSession ? ROUTES.home : homeForRole(activeSession.role);
  const isOrgAdmin = activeSession?.role === 'org_admin';
  // Ruang kerja hanya diisi setelah sesi klien dikenal; tamu tidak pernah melihat nav tamu di sana.
  // Alur responden selalu minimal: tanpa tautan marketing agar pengisian tidak terputus.
  const topNav = kind === 'respondent'
    ? []
    : activeSession
      ? isOrgAdmin
        ? ORG_NAV
        : activeSession.role === 'admin'
          ? NAV.admin
          : NAV.creator
      : inWorkspace
        ? []
        : GUEST_NAV;
  // Sidebar: org_admin melihat ruang organisasi (profil, bukti pendukung) dan daftar survei
  // organisasinya, meski halaman dirender sebagai admin.
  const sectionNav = session?.role === 'org_admin' && inWorkspace ? ORG_NAV : NAV[kind];
  const sidebarActiveTo = activeNavTo(sectionNav, pathname);
  const activePath = kind === 'respondent' ? ROUTES.home : sidebarActiveTo ?? pathname;
  // Chrome baru untuk SELURUH halaman super admin: peran 'admin' (super_admin sudah dinormalisasi
  // di store) DAN path salah satu halaman platform/operasional. Halaman organisasi (/admin/org*),
  // org_admin, creator, dan responden tetap memakai pill + sidebar lama di bawah.
  // Hanya `session` (hasil bootstrap), bukan `activeSession` (memakai sesi mock saat request
  // /auth/me awal masih berjalan): sidebar tidak boleh berganti bentuk setelah bootstrap selesai.
  // Selama bootstrap belum selesai (`ready` false) chrome admin langsung dipakai agar sidebar tidak
  // berkedip pill lama lebih dulu; peran diverifikasi begitu sesi tersedia.
  const usesAdminChrome = Boolean(kind === 'admin' && (!ready || session?.role === 'admin'));

  if (!chromeless && usesAdminChrome && ADMIN_CHROME_PATHS.has(navPath(pathname))) {
    return (
      <div className="admin-dash flex min-h-dvh flex-col bg-[var(--ad-bg)] text-[color:var(--ad-text)]">
        <a
          href="#konten-utama"
          className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[60] focus:inline-flex focus:min-h-[44px] focus:items-center focus:rounded-md focus:bg-action focus:px-4 focus:py-2 focus:text-n0"
        >
          Lewati ke konten utama
        </a>

        <AdminSidebar pathname={pathname} />

        <div className="flex min-w-0 flex-1 flex-col lg:ps-64">
          <main id="konten-utama" ref={mainRef} tabIndex={-1} className="flex-1 focus:outline-none">
            <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-4 py-6 lg:px-8 lg:py-8">
              {!hideHeading && (
                <div className="flex flex-col gap-1.5">
                  <h1 className="text-h1 font-bold wrap-break-word">{title}</h1>
                  {subtitle && <p className="max-w-[70ch] text-body text-[color:var(--ad-muted)]">{subtitle}</p>}
                </div>
              )}
              {children}
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <a
        href="#konten-utama"
        className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[60] focus:inline-flex focus:min-h-[44px] focus:items-center focus:rounded-md focus:bg-action focus:px-4 focus:py-2 focus:text-n0"
      >
        Lewati ke konten utama
      </a>

      {!chromeless && (
        <PillNavbar
          nav={topNav}
          activePath={activePath}
          guestOnly={guestOnly || kind === 'respondent'}
          guestActions={!inWorkspace && kind !== 'respondent'}
          homeTo={kind === 'respondent' ? null : homeTo}
        />
      )}

      {chromeless ? (
        <main id="konten-utama" ref={mainRef} tabIndex={-1} className="flex flex-1 flex-col focus:outline-none">
          {children}
        </main>
      ) : (
      <div className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-6 px-4 py-6 lg:flex-row lg:px-6 lg:py-8">
        {inWorkspace && (
          <aside aria-label="Navigasi bagian" className="shrink-0 lg:w-48">
            <p className="mb-3 hidden font-mono text-annotation tracking-mono text-n600 lg:block">WORKSPACE</p>
            <nav className="flex flex-row flex-wrap gap-2 lg:flex-col">
              {sectionNav.map((item) => (
                <PlainLink
                  key={item.to}
                  to={item.to}
                  aria-current={item.to === sidebarActiveTo ? 'page' : undefined}
                  className={`min-h-[44px] shrink-0 rounded-sm px-3 py-2 text-body-sm font-bold no-underline ${
                    item.to === sidebarActiveTo ? 'bg-n100 text-action' : 'text-n600 hover:bg-n50'
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

        <main id="konten-utama" ref={mainRef} tabIndex={-1} className="min-w-0 flex-1 focus:outline-none">
          {!hideHeading && (
            <div className="mb-6 flex flex-col gap-2">
              <h1 className="text-h1 font-bold text-ink wrap-break-word">{title}</h1>
              {subtitle && <p className="max-w-[70ch] text-body text-muted">{subtitle}</p>}
            </div>
          )}
          {children}
        </main>
      </div>
      )}

      {!chromeless && (
      <footer className="border-t border-n200 bg-n50">
        <div className={`mx-auto flex max-w-[1200px] flex-col gap-2 px-4 lg:flex-row lg:items-center lg:justify-between lg:px-6 ${bottomInset ? 'pt-6 pb-24 lg:pb-6' : 'py-6'}`}>
          <div>
            <p className="text-body-sm font-bold text-ink">Svara</p>
            <p className="text-caption text-muted">Instrumen berskala dan isian singkat, dikelola per versi.</p>
          </div>
          <PolicyLinks />
        </div>
      </footer>
      )}
    </div>
  );
}
