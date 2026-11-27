'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LayoutGrid } from 'runeicons-react/icons/LayoutGrid';
import { Users } from 'runeicons-react/icons/Users';
import { FileText } from 'runeicons-react/icons/FileText';
import { Link2 } from 'runeicons-react/icons/Link2';
import { Inbox } from 'runeicons-react/icons/Inbox';
import { UnfoldVertical } from 'runeicons-react/icons/UnfoldVertical';
import { LogOut } from 'runeicons-react/icons/LogOut';
import { Menu } from 'runeicons-react/icons/Menu';
import { X } from 'runeicons-react/icons/X';
import { withIconClass, type ClassIcon } from './rune-icon';
import { BrandMark } from './Brand';
import { useToast } from './Toast';
import { ROUTES } from '../lib/routes';
import { activeNavTo, type NavEntry } from '../lib/nav';
import { allowNavigation, confirmIfDirty, useNavigationGuard } from '../lib/navigation-guard';
import { signOut, useStore } from '../lib/store';
import { cn } from '../lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

/**
 * Sidebar admin gaya shadcn — chrome seluruh halaman super admin (/admin, /admin/accounts,
 * /admin/audit, /admin/integration, /admin/requests).
 * Desktop: kolom tetap 256px di kiri. Mobile: bar atas tipis dengan tombol menu yang membuka drawer.
 * Halaman organisasi (/admin/org*) dan peran lain tetap memakai chrome lama (pill + sidebar Shell).
 */

type AdminNavEntry = NavEntry & { icon: ClassIcon };

const NAV_GROUPS: Array<{ label: string; items: AdminNavEntry[] }> = [
  {
    label: 'Platform',
    items: [
      { to: ROUTES.admin, label: 'Ringkasan', icon: withIconClass(LayoutGrid) },
    ],
  },
  {
    label: 'Operasional',
    items: [
      { to: ROUTES.adminAccounts, label: 'Akun & izin', icon: withIconClass(Users) },
      { to: ROUTES.adminAudit, label: 'Log audit', icon: withIconClass(FileText) },
      { to: ROUTES.adminIntegration, label: 'Integrasi', icon: withIconClass(Link2) },
      { to: ROUTES.adminRequests, label: 'Permintaan data', icon: withIconClass(Inbox) },
    ],
  },
];

const UnfoldVerticalIcon = withIconClass(UnfoldVertical);
const LogOutIcon = withIconClass(LogOut);
const MenuIcon = withIconClass(Menu);
const XIcon = withIconClass(X);

const ALL_ITEMS = NAV_GROUPS.flatMap((group) => group.items);

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const guard = useNavigationGuard();
  const activeTo = activeNavTo(ALL_ITEMS, pathname);
  return (
    <nav aria-label="Navigasi admin" className="flex flex-col gap-4">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="px-3 pb-1 text-caption font-bold text-[color:var(--ad-muted)]">{group.label}</p>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = item.to === activeNavTo([item], pathname) && item.to === activeTo;
              return (
                <li key={item.to}>
                  <Link
                    href={item.to}
                    aria-current={active ? 'page' : undefined}
                    onClick={(event) => {
                      if (!allowNavigation(event, guard)) {
                        event.preventDefault();
                        return;
                      }
                      onNavigate?.();
                    }}
                    className={cn(
                      'flex min-h-[44px] items-center gap-2.5 rounded-md px-3 text-body-sm no-underline transition-colors duration-fast',
                      active
                        ? 'bg-[var(--ad-accent-soft)] font-bold text-[color:var(--ad-accent)]'
                        : 'font-normal text-[color:var(--ad-muted)] hover:bg-[var(--ad-soft)] hover:text-[color:var(--ad-text)]',
                    )}
                  >
                    <item.icon aria-hidden="true" className="size-4 shrink-0" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function UserFooter() {
  const router = useRouter();
  const notify = useToast();
  const { session } = useStore();
  const guard = useNavigationGuard();
  if (!session) return null;

  const initials = session.name
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex min-h-[44px] w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-start transition-colors duration-fast hover:bg-[var(--ad-soft)]"
        aria-label={`Menu akun ${session.name}`}
      >
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--ad-accent-soft)] text-caption font-bold text-[color:var(--ad-accent)]"
        >
          {initials}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body-sm font-bold text-[color:var(--ad-text)]">{session.name}</span>
          <span className="block truncate text-caption text-[color:var(--ad-muted)]">{session.email}</span>
        </span>
        <UnfoldVerticalIcon aria-hidden="true" className="size-4 shrink-0 text-[color:var(--ad-muted)]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-[calc(100%+0.5rem)] min-w-[12rem]">
        <DropdownMenuItem
          onSelect={() => {
            if (!confirmIfDirty(guard)) return;
            void signOut().finally(() => {
              notify('Anda telah keluar.');
              router.push(ROUTES.home);
            });
          }}
        >
          <LogOutIcon aria-hidden="true" className="size-4" />
          Keluar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Wordmark() {
  const guard = useNavigationGuard();
  return (
    <Link
      href={ROUTES.admin}
      aria-label="Svara — Ringkasan admin"
      onClick={(event) => { if (!allowNavigation(event, guard)) event.preventDefault(); }}
      className="inline-flex min-h-[44px] items-center gap-2 text-body font-semibold text-[color:var(--ad-text)] no-underline"
    >
      <BrandMark className="size-6" />
      Svara
    </Link>
  );
}

export function AdminSidebar({ pathname }: { pathname: string }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Navigasi dari drawer menutupnya; pathname berubah setelah route berpindah.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setDrawerOpen(false);
      menuButtonRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
    };
  }, [drawerOpen]);

  return (
    <>
      {/* Desktop: kolom tetap kiri 256px. */}
      <aside className="fixed inset-y-0 start-0 z-sticky hidden w-64 flex-col border-e border-[var(--ad-border)] bg-[var(--ad-surface)] lg:flex">
        <div className="flex h-14 shrink-0 items-center border-b border-[var(--ad-border)] px-4">
          <Wordmark />
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <NavLinks pathname={pathname} />
        </div>
        <div className="shrink-0 border-t border-[var(--ad-border)] p-3">
          <UserFooter />
        </div>
      </aside>

      {/* Mobile: bar atas tipis dengan pemicu drawer. */}
      <div className="sticky top-0 z-nav flex h-14 items-center gap-1 border-b border-[var(--ad-border)] bg-[var(--ad-surface)] px-3 lg:hidden">
        <button
          ref={menuButtonRef}
          type="button"
          aria-expanded={drawerOpen}
          aria-controls="admin-nav-drawer"
          aria-label={drawerOpen ? 'Tutup menu navigasi' : 'Buka menu navigasi'}
          onClick={() => setDrawerOpen((value) => !value)}
          className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-[color:var(--ad-muted)] transition-colors duration-fast hover:bg-[var(--ad-soft)] hover:text-[color:var(--ad-text)]"
        >
          <MenuIcon aria-hidden="true" className="size-5" />
        </button>
        <Wordmark />
      </div>

      {drawerOpen && (
        <div className="fixed inset-0 z-overlay lg:hidden">
          <button
            type="button"
            aria-label="Tutup menu navigasi"
            onClick={() => {
              setDrawerOpen(false);
              menuButtonRef.current?.focus();
            }}
            className="absolute inset-0 cursor-default bg-dark/60"
          />
          <div
            ref={drawerRef}
            id="admin-nav-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Navigasi admin"
            className="absolute inset-y-0 start-0 flex w-72 max-w-[85vw] flex-col bg-[var(--ad-surface)] shadow-overlay"
          >
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--ad-border)] px-4">
              <Wordmark />
              <button
                type="button"
                aria-label="Tutup menu navigasi"
                onClick={() => {
                  setDrawerOpen(false);
                  menuButtonRef.current?.focus();
                }}
                className="inline-flex size-11 cursor-pointer items-center justify-center rounded-md text-[color:var(--ad-muted)] transition-colors duration-fast hover:bg-[var(--ad-soft)] hover:text-[color:var(--ad-text)]"
              >
                <XIcon aria-hidden="true" className="size-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-4">
              <NavLinks pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
            </div>
            <div className="shrink-0 border-t border-[var(--ad-border)] p-3">
              <UserFooter />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
