'use client';

import type { CSSProperties, ReactNode, RefObject } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ChevronsUpDown,
  FileText,
  Inbox,
  LayoutDashboard,
  Link2,
  LogOut,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { BrandMark } from './Brand';
import { useToast } from './Toast';
import { ROUTES } from '../lib/routes';
import { activeNavTo, type NavEntry } from '../lib/nav';
import { allowNavigation, confirmIfDirty, useNavigationGuard } from '../lib/navigation-guard';
import { signOut, useStore } from '../lib/store';
import { Avatar, AvatarFallback } from './ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Separator } from './ui/separator';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from './ui/sidebar';

/**
 * Chrome seluruh halaman super admin (/admin, /admin/accounts, /admin/audit,
 * /admin/integration, /admin/requests): Sidebar block shadcn (`inset`, drawer Sheet di
 * mobile) + SidebarInset berisi header halaman. Halaman organisasi (/admin/org*) dan peran
 * lain tetap memakai chrome lama di Shell.
 */

type AdminNavEntry = NavEntry & { icon: LucideIcon };

const NAV_GROUPS: Array<{ label: string; items: AdminNavEntry[] }> = [
  {
    label: 'Platform',
    items: [{ to: ROUTES.admin, label: 'Ringkasan', icon: LayoutDashboard }],
  },
  {
    label: 'Operasional',
    items: [
      { to: ROUTES.adminAccounts, label: 'Akun & izin', icon: Users },
      { to: ROUTES.adminAudit, label: 'Log audit', icon: FileText },
      { to: ROUTES.adminIntegration, label: 'Integrasi', icon: Link2 },
      { to: ROUTES.adminRequests, label: 'Permintaan data', icon: Inbox },
    ],
  },
];

const ALL_ITEMS = NAV_GROUPS.flatMap((group) => group.items);

function NavMenu({ pathname }: { pathname: string }) {
  const guard = useNavigationGuard();
  const activeTo = activeNavTo(ALL_ITEMS, pathname);
  return (
    <nav aria-label="Navigasi admin" className="flex flex-col gap-2">
      {NAV_GROUPS.map((group) => (
        <SidebarGroup key={group.label}>
          <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((item) => {
                const active = item.to === activeTo;
                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={item.label}
                      className={active ? 'font-semibold' : undefined}
                    >
                      <Link
                        href={item.to}
                        aria-current={active ? 'page' : undefined}
                        onClick={(event) => {
                          if (!allowNavigation(event, guard)) event.preventDefault();
                        }}
                      >
                        <item.icon aria-hidden="true" />
                        {item.label}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </nav>
  );
}

function NavUser() {
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
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" aria-label={`Menu akun ${session.name}`}>
              <Avatar className="size-8 rounded-lg">
                <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
              </Avatar>
              <span className="grid flex-1 text-start text-sm leading-tight">
                <span className="truncate font-medium">{session.name}</span>
                <span className="truncate text-xs text-muted-foreground">{session.email}</span>
              </span>
              <ChevronsUpDown className="ms-auto size-4" aria-hidden="true" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-64">
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-start text-sm">
                <Avatar className="size-8 rounded-lg">
                  <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-start text-sm leading-tight">
                  <span className="truncate font-medium">{session.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{session.email}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => {
                if (!confirmIfDirty(guard)) return;
                void signOut().finally(() => {
                  notify('Anda telah keluar.');
                  router.push(ROUTES.home);
                });
              }}
            >
              <LogOut aria-hidden="true" />
              Keluar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function Wordmark() {
  const guard = useNavigationGuard();
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton asChild size="lg" className="data-[slot=sidebar-menu-button]:p-1.5!">
          <Link
            href={ROUTES.admin}
            aria-label="Svara — Ringkasan admin"
            onClick={(event) => {
              if (!allowNavigation(event, guard)) event.preventDefault();
            }}
          >
            <BrandMark className="size-8 shrink-0" />
            <span className="grid flex-1 text-start text-base leading-tight">
              <span className="truncate font-semibold">Svara</span>
              <span className="truncate text-xs text-muted-foreground">Super admin</span>
            </span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function crumbFor(pathname: string): string {
  const entry = ALL_ITEMS.find((item) => item.to === activeNavTo(ALL_ITEMS, pathname));
  return entry?.label ?? 'Admin';
}

export function AdminShell({
  pathname,
  title,
  subtitle,
  hideHeading,
  mainRef,
  children,
}: {
  pathname: string;
  title: string;
  subtitle?: string;
  hideHeading?: boolean;
  mainRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const pageLabel = crumbFor(pathname);

  return (
    <SidebarProvider
      style={
        {
          '--sidebar-width': 'calc(var(--spacing) * 72)',
          '--header-height': 'calc(var(--spacing) * 12)',
        } as CSSProperties
      }
      className="bg-background text-foreground"
    >
      <a
        href="#konten-utama"
        className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[60] focus:inline-flex focus:min-h-[44px] focus:items-center focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Lewati ke konten utama
      </a>

      <Sidebar variant="inset" collapsible="offcanvas">
        <SidebarHeader>
          <Wordmark />
        </SidebarHeader>
        <SidebarContent>
          <NavMenu pathname={pathname} />
        </SidebarContent>
        <SidebarFooter>
          <NavUser />
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b">
          <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
            <SidebarTrigger className="-ms-1" />
            <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
            <h1 className="min-w-0 truncate text-base font-medium wrap-anywhere">
              {hideHeading ? pageLabel : title}
            </h1>
          </div>
        </header>

        <main id="konten-utama" ref={mainRef} tabIndex={-1} className="flex-1 focus:outline-none">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6 px-4 lg:px-6">
              {!hideHeading && subtitle && (
                <p className="max-w-[70ch] text-sm text-muted-foreground">{subtitle}</p>
              )}
              {children}
            </div>
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}