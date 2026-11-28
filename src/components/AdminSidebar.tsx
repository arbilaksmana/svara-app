'use client';

import type { CSSProperties, ReactNode, RefObject } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Building2,
  ChevronsUpDown,
  ClipboardList,
  FileCheck2,
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
 * /admin/integration, /admin/requests) dan ruang organisasi (/admin/org*): Sidebar block
 * shadcn (`inset`, drawer Sheet di mobile) + SidebarInset berisi header halaman.
 * Peran lain tetap memakai chrome lama di Shell.
 */

export type WorkspaceNavGroup = { label: string; items: Array<NavEntry & { icon: LucideIcon }> };

const ADMIN_NAV_GROUPS: WorkspaceNavGroup[] = [
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

/** Navigasi ruang organisasi untuk org_admin: profil, bukti pendukung, dan daftar survei. */
export const ORG_NAV_GROUPS: WorkspaceNavGroup[] = [
  {
    label: 'Organisasi',
    items: [
      { to: ROUTES.adminOrg, label: 'Organisasi', icon: Building2 },
      { to: ROUTES.adminOrgEvidence, label: 'Bukti pendukung', icon: FileCheck2 },
    ],
  },
  {
    label: 'Survei',
    items: [{ to: ROUTES.creatorOrg, label: 'Daftar survei', icon: ClipboardList, aliases: [`${ROUTES.creator}/surveys`] }],
  },
];

function NavMenu({ pathname, groups, label }: { pathname: string; groups: WorkspaceNavGroup[]; label: string }) {
  const guard = useNavigationGuard();
  const activeTo = activeNavTo(groups.flatMap((group) => group.items), pathname);
  return (
    <nav aria-label={label} className="flex flex-col gap-2">
      {groups.map((group) => (
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

function Wordmark({ label, homeTo }: { label: string; homeTo: string }) {
  const guard = useNavigationGuard();
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton asChild size="lg" className="data-[slot=sidebar-menu-button]:p-1.5!">
          <Link
            href={homeTo}
            aria-label={`Svara — ${label}`}
            onClick={(event) => {
              if (!allowNavigation(event, guard)) event.preventDefault();
            }}
          >
            <BrandMark className="size-8 shrink-0" />
            <span className="grid flex-1 text-start text-base leading-tight">
              <span className="truncate font-semibold">Svara</span>
              <span className="truncate text-xs text-muted-foreground">{label}</span>
            </span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function crumbFor(groups: WorkspaceNavGroup[], pathname: string, fallback: string): string {
  const items = groups.flatMap((group) => group.items);
  const entry = items.find((item) => item.to === activeNavTo(items, pathname));
  return entry?.label ?? fallback;
}

export function AdminShell({
  pathname,
  title,
  subtitle,
  hideHeading,
  mainRef,
  navGroups = ADMIN_NAV_GROUPS,
  navLabel = 'Navigasi admin',
  brandLabel = 'Super admin',
  homeTo = ROUTES.admin,
  crumbFallback = 'Admin',
  children,
}: {
  pathname: string;
  title: string;
  subtitle?: string;
  hideHeading?: boolean;
  mainRef: RefObject<HTMLElement | null>;
  /** Grup navigasi sidebar; bawaan menu super admin. */
  navGroups?: WorkspaceNavGroup[];
  navLabel?: string;
  brandLabel?: string;
  homeTo?: string;
  crumbFallback?: string;
  children: ReactNode;
}) {
  const pageLabel = crumbFor(navGroups, pathname, crumbFallback);

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
          <Wordmark label={brandLabel} homeTo={homeTo} />
        </SidebarHeader>
        <SidebarContent>
          <NavMenu pathname={pathname} groups={navGroups} label={navLabel} />
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