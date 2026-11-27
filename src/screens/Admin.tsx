"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Shell } from "../components/Shell";
import {
  ActionLink,
  Code,
  Spinner,
} from "../components/ui";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { CheckboxField } from "../components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Skeleton } from "../components/ui/skeleton";
import {
  StateView,
  SuccessBanner,
  ValidationSummary,
} from "../components/StateView";
import { useScreenState } from "../lib/state";
import { cn } from "../lib/utils";
import { ROUTES } from "../lib/routes";
import { formatWIBDate, formatWIBTime } from "../lib/summary";
import { useToast } from "../components/Toast";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Avatar, AvatarFallback } from "../components/ui/avatar";
import { Button as DashButton } from "../components/ui/button";
import { Field } from "../components/ui/field";
import { Input } from "../components/ui/input";
import { Separator } from "../components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "../components/ui/chart";
import { DataTable } from "../components/data-table";
import { Plus } from "runeicons-react/icons/Plus";
import { ChartBar } from "runeicons-react/icons/ChartBar";
import { ChartLine } from "runeicons-react/icons/ChartLine";
import { Clock } from "runeicons-react/icons/Clock";
import { Users } from "runeicons-react/icons/Users";
import { Group } from "runeicons-react/icons/Group";
import { ShieldCheck } from "runeicons-react/icons/ShieldCheck";
import { UserMinus } from "runeicons-react/icons/UserMinus";
import { withIconClass } from "../components/rune-icon";
import {
  cancelAdminStatsLoad,
  cancelDataRequestsLoad,
  currentAdminData,
  loadAdminStats,
  loadBootstrap,
  loadDataRequests,
  replayEvent,
  refreshBootstrap,
  saveGrants,
  setIntegrationNote,
  useStore,
  type AdminData,
} from "../lib/store";
import {
  adminCreateOrganization,
  adminSaveAccount,
  adminSaveGrants,
  ApiError,
  getPlatformProfile,
  savePlatformProfile,
  updateDataRequest,
  type AdminStats,
  type ChartRange,
  type DataRequest,
  type DataRequestStatus,
} from "../lib/api";
import { parseRetentionDays } from "../lib/retention";
import {
  ACCOUNT_STATUS_LABEL,
  DATA_REQUEST_TYPE_LABEL,
  ORGANIZATION_TYPE_LABEL,
  ORGANIZATION_TYPES,
  ROLE_LABEL,
} from "../lib/labels";
import type {
  Account,
  AuditLog,
  AuditOutcome,
  EventStatus,
  IntegrationEvent,
  OrganizationSummary,
  OrganizationType,
} from "../lib/types";

/* ---------------- Dialog form ---------------- */

const PlusIcon = withIconClass(Plus);
const SurveysIcon = withIconClass(ChartBar);
const ResponsesIcon = withIconClass(ChartLine);
const AccountsIcon = withIconClass(Users);
const ActiveAccountsIcon = withIconClass(ShieldCheck);
const SuspendedAccountsIcon = withIconClass(UserMinus);
const OrganizationsIcon = withIconClass(Group);
const PendingIcon = withIconClass(Clock);

/**
 * Dialog modal bawaan browser: fokus terperangkap, Esc menutup, dan latar
 * `backdrop:` dari `showModal` — tanpa dependensi baru.
 */
function FormDialog({
  open,
  title,
  description,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Primitif halaman ---------------- */

/** Tombol aksi admin: varian lama dipetakan ke varian Button shadcn; `loading` = spinner + aria-busy. */
function BusyButton({
  variant = "primary",
  loading = false,
  block = false,
  disabled,
  className,
  children,
  ...rest
}: Omit<React.ComponentProps<typeof DashButton>, "variant" | "children"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  loading?: boolean;
  block?: boolean;
  children?: ReactNode;
}) {
  const mapped = variant === "primary" ? "default" : variant === "danger" ? "destructive" : variant;
  return (
    <DashButton
      {...rest}
      variant={mapped}
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      className={cn(block && "w-full", className)}
    >
      {loading && <Spinner />}
      {children}
    </DashButton>
  );
}

/** Placeholder muat: Skeleton shadcn, tetap aria-busy + aria-live untuk pembaca layar. */
function LoadingState({ label = "Memuat data contoh…", rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-3">
      <p className="text-body-sm text-ink-muted">{label}</p>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded-md" />
      ))}
    </div>
  );
}

/** Galat layar: Alert shadcn varian danger. */
function ErrorState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return (
    <Alert variant="danger" className="flex flex-col items-start gap-3">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="text-body-sm">
        <p>{detail}</p>
        {action}
      </AlertDescription>
    </Alert>
  );
}

/* ---------------- Ringkasan ---------------- */

const ROLE_VALUES = ["creator", "org_admin", "admin"] as const;

/** Inisial dua huruf untuk avatar daftar akun. */
function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("") || "?"
  );
}

/** Kolom daftar akun: identitas ber-avatar, select peran/organisasi, status, jumlah cakupan, dan aksi status. */
function accountColumns({
  organizations,
  grantCounts,
  sessionId,
  accountBusy,
  mutationsBlocked,
  onChangeRole,
  onChangeOrganization,
  onToggleStatus,
}: {
  organizations: OrganizationSummary[];
  /** Jumlah grant baca/ekspor per ID akun, dihitung sekali oleh pemanggil. */
  grantCounts: Record<string, number>;
  sessionId: string | null;
  accountBusy: string | null;
  mutationsBlocked: boolean;
  onChangeRole: (accountId: string, displayName: string, chosen: string) => void;
  onChangeOrganization: (accountId: string, displayName: string, chosen: string) => void;
  onToggleStatus: (accountId: string, displayName: string, current: string) => void;
}): ColumnDef<Account>[] {
  return [
    {
      accessorKey: "display_name",
      header: "Akun",
      cell: ({ row }) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar className="size-9 bg-primary/10">
            <AvatarFallback className="bg-transparent text-annotation font-bold text-primary">
              {initials(row.original.display_name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-bold text-foreground">
              <span className="truncate">{row.original.display_name}</span>
              {sessionId === row.original.id && (
                <Badge variant="outline" className="px-1.5 text-annotation">
                  Anda
                </Badge>
              )}
            </p>
            <span className="mt-0.5 block font-mono text-annotation font-normal tracking-mono text-muted-foreground">
              <Code>{row.original.id}</Code>
            </span>
          </div>
        </div>
      ),
    },
    {
      accessorKey: "role",
      header: "Peran",
      cell: ({ row }) => {
        const account = row.original;
        return (
          <Select
            value={account.role === "super_admin" ? "admin" : account.role}
            onValueChange={(value) =>
              onChangeRole(account.id, account.display_name, value)
            }
            disabled={
              accountBusy === account.id ||
              sessionId === account.id ||
              mutationsBlocked
            }
          >
<SelectTrigger
                aria-label={`Peran ${account.display_name}`}
                className="h-11 w-44"
              >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLE_VALUES.map((value) => (
                <SelectItem key={value} value={value}>
                  {ROLE_LABEL[value === "admin" ? "super_admin" : value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      },
    },
    {
      accessorKey: "organization_id",
      header: "Organisasi",
      cell: ({ row }) => {
        const account = row.original;
        return (
          <Select
            value={account.organization_id ?? "__none"}
            onValueChange={(value) =>
              onChangeOrganization(
                account.id,
                account.display_name,
                value === "__none" ? "" : value,
              )
            }
            disabled={
              accountBusy === account.id ||
              sessionId === account.id ||
              mutationsBlocked ||
              account.role === "super_admin"
            }
          >
            <SelectTrigger
              aria-label={`Organisasi ${account.display_name}`}
              className="h-11 w-56"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">Tanpa organisasi</SelectItem>
              {organizations.map((organization) => (
                <SelectItem key={organization.id} value={organization.id}>
                  {organization.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <Badge
          variant={row.original.status === "active" ? "success" : "secondary"}
          className="gap-1.5"
        >
          <span
            aria-hidden="true"
            className={cn(
              "size-1.5 rounded-full",
              row.original.status === "active" ? "bg-emerald-600" : "bg-muted-foreground",
            )}
          />
          {ACCOUNT_STATUS_LABEL[row.original.status]}
        </Badge>
      ),
    },
    {
      id: "grants",
      header: "Cakupan",
      cell: ({ row }) => (
        <span className="tabular-nums">{grantCounts[row.original.id] ?? 0} cakupan</span>
      ),
    },
    {
      id: "action",
      header: "Aksi",
      cell: ({ row }) => {
        const account = row.original;
        return (
          <BusyButton
            variant="ghost"
            loading={accountBusy === account.id}
            disabled={
              accountBusy === account.id ||
              sessionId === account.id ||
              mutationsBlocked
            }
            onClick={() =>
              onToggleStatus(account.id, account.display_name, account.status)
            }
          >
            {account.status === "active" ? "Nonaktifkan" : "Aktifkan"}
          </BusyButton>
        );
      },
    },
  ];
}

/** Label tipe organisasi dengan kunci bebas; nilai di luar enum tampil apa adanya. */
const ORGANIZATION_TYPE_TEXT: Record<string, string> = ORGANIZATION_TYPE_LABEL;

export function AdminSummaryPage() {
  const { state } = useScreenState("admin-summary");
  const { stats, statsError, error } = useStore();
  const [range, setRange] = useState<ChartRange>("30d");
  useEffect(() => {
    void loadAdminStats(range);
    return cancelAdminStatsLoad;
  }, [range]);

  const failure = stats ? null : (statsError ?? error);
  const retry = () => {
    void (async () => {
      if (error) await loadBootstrap();
      await loadAdminStats(range);
    })();
  };

  return (
    <Shell
      kind="admin"
      title="Ringkasan operasional"
      subtitle="Pantau jumlah survei, respons, dan akun tanpa membuka jawaban individual."
    >
      {failure ? (
        <ErrorState
          title="Ringkasan operasional gagal dimuat"
          detail={`${failure} Tidak ada angka yang ditampilkan sampai data berhasil dimuat.`}
          action={
            <BusyButton variant="secondary" onClick={retry}>
              Coba lagi
            </BusyButton>
          }
        />
      ) : !stats ? (
        <LoadingState label="Memuat ringkasan operasional…" />
      ) : (
        <StateView
          routeId="admin-summary"
          state={state}
          emptyTitle="Belum ada survei"
          emptyDetail="Metrik akan muncul setelah survei dibuat dan menerima jawaban."
          permissionDetail="Akses ringkasan memerlukan peran super admin."
        >
          <div className="flex flex-col gap-5">
            <section
              aria-label="Metrik utama"
              className="grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2 @5xl/main:grid-cols-4"
            >
              <StatCard label="Jumlah survei" value={stats.surveys} icon={<SurveysIcon aria-hidden="true" className="size-4" />} />
              <StatCard label="Total respons final" value={stats.responses} icon={<ResponsesIcon aria-hidden="true" className="size-4" />} />
              <StatCard label="Akun pengelola" value={stats.accounts} icon={<AccountsIcon aria-hidden="true" className="size-4" />} />
              <StatCard label="Permintaan menunggu" value={stats.pendingRequests} icon={<PendingIcon aria-hidden="true" className="size-4" />} />
            </section>

            <div className="grid gap-4 xl:grid-cols-5">
              <Tabs
                value={range}
                onValueChange={(value) => setRange(value as ChartRange)}
                asChild
              >
                <Card className="xl:col-span-3">
                  <CardHeader>
                    <CardTitle>Tren respons</CardTitle>
                    <CardDescription>
                      Agregat respons final; periode tanpa data bernilai nol.
                    </CardDescription>
                    <CardAction>
                      <TabsList aria-label="Rentang waktu grafik tren respons">
                        {RANGE_OPTIONS.map((option) => (
                          <TabsTrigger key={option.value} value={option.value}>
                            {option.short}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </CardAction>
                  </CardHeader>
                  <CardContent className="px-2 sm:px-6">
                    {RANGE_OPTIONS.map((option) => (
                      <TabsContent key={option.value} value={option.value}>
                        <ResponsesAreaChart stats={stats} range={option.value} />
                      </TabsContent>
                    ))}
                  </CardContent>
                </Card>
              </Tabs>
              <div className="flex flex-col gap-4 xl:col-span-2">
                <Card className="flex-1">
                  <CardHeader>
                    <CardTitle>Respons per survei</CardTitle>
                    <CardDescription>
                      Total respons final tiap survei.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResponsesPerSurveyChart stats={stats} />
                  </CardContent>
                </Card>
                <Card className="gap-2">
                  <CardHeader>
                    <CardTitle>Antrean tindakan</CardTitle>
                    <CardDescription>
                      Permintaan data yang belum ditindaklanjuti.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-2xl font-semibold leading-none tabular-nums">
                      {stats.pendingRequests}
                    </p>
                    <ActionLink to={ROUTES.adminRequests}>Lihat antrean</ActionLink>
                  </CardContent>
                </Card>
              </div>
            </div>

            <Tabs defaultValue="creators" asChild>
              <Card>
                <CardHeader>
                  <CardTitle>Metrik detail</CardTitle>
                  <CardDescription>
                    Agregat per creator dan per survei; tanpa data jawaban individual.
                  </CardDescription>
                  <CardAction>
                    <TabsList aria-label="Tabel metrik">
                      <TabsTrigger value="creators">Per creator</TabsTrigger>
                      <TabsTrigger value="surveys">Per survei</TabsTrigger>
                    </TabsList>
                  </CardAction>
                </CardHeader>
                <CardContent>
                  <TabsContent value="creators">
                    <DataTable
                      columns={creatorColumns}
                      data={stats.perCreator}
                      caption="Jumlah survei dan respons per creator"
                      emptyMessage="Belum ada creator."
                    />
                  </TabsContent>
                  <TabsContent value="surveys">
                    <DataTable
                      columns={surveyColumns}
                      data={stats.perSurvey}
                      caption="Jumlah versi dan respons per survei"
                      emptyMessage="Belum ada survei."
                    />
                  </TabsContent>
                </CardContent>
              </Card>
            </Tabs>
          </div>
        </StateView>
      )}
    </Shell>
  );
}

/* ---------------- Ringkasan: kartu tren, grafik, dan tabel data ---------------- */

/** Kartu KPI: label, angka besar, dan ikon penanda (pola SectionCards block dashboard-01). */
function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: ReactNode;
}) {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
          {value}
        </CardTitle>
        <CardAction>
          <span
            aria-hidden="true"
            className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground"
          >
            {icon}
          </span>
        </CardAction>
      </CardHeader>
    </Card>
  );
}

/** Recharts butuh pengukuran DOM; grafik dirender setelah mount agar SSR tetap ringan. */
function useChartsReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready;
}

/** `short` dipakai tab pemilih rentang; `label` tetap dipakai kalimat aksesibel grafik. */
const RANGE_OPTIONS: Array<{ value: ChartRange; label: string; short: string }> = [
  { value: "today", label: "Hari ini", short: "Hari ini" },
  { value: "7d", label: "7 hari terakhir", short: "7 hari" },
  { value: "30d", label: "30 hari terakhir", short: "30 hari" },
  { value: "6m", label: "6 bulan terakhir", short: "6 bulan" },
];

const RANGE_LABEL: Record<ChartRange, string> = {
  today: "hari ini",
  "7d": "7 hari terakhir",
  "30d": "30 hari terakhir",
  "6m": "6 bulan terakhir",
};

/**
 * Label sumbu dari kunci titik server: 'YYYY-MM-DDTHH' (per jam), 'YYYY-MM-DD' (per hari),
 * atau 'YYYY-MM' (per bulan). Format dibaca dari panjang kunci, bukan state rentang, karena
 * satu render transisi bisa membawa deret rentang lama saat pemilih baru diganti.
 * Titik harian ditulis 'dd/MM' karena jendela 30 hari melewati dua bulan.
 */
function pointLabel(point: string): string {
  if (point.length === 7) return monthLabel(point);
  if (point.length === 13) return `${point.slice(11, 13)}:00`;
  return `${point.slice(8, 10)}/${point.slice(5, 7)}`;
}

/** Nama bulan singkat Indonesia untuk titik bulanan 'YYYY-MM'. */
const MONTH_SHORT = new Intl.DateTimeFormat("id-ID", { month: "short" });

function monthLabel(point: string): string {
  return MONTH_SHORT.format(new Date(`${point}-01T00:00:00`));
}

function ResponsesAreaChart({
  stats,
  range,
}: {
  stats: AdminStats;
  range: ChartRange;
}) {
  const ready = useChartsReady();
  const data = stats.chart.map((row) => ({
    label: pointLabel(row.point),
    responses: row.responses,
  }));
  if (data.length === 0) {
    return (
      <p className="text-caption text-muted-foreground">
        Belum ada data respons untuk rentang ini.
      </p>
    );
  }
  const total = data.reduce((sum, row) => sum + row.responses, 0);
  const windowLabel = RANGE_LABEL[range];
  const summary = `Respons ${windowLabel} (total ${total}): ${data.map((row) => `${row.label} ${row.responses}`).join(", ")}.`;
  return (
    <>
      <div role="img" aria-label={summary}>
        {ready && (
          <ChartContainer
            config={{
              responses: { label: "Respons", color: "var(--color-chart-1)" },
            }}
            className="aspect-auto h-[250px] w-full"
          >
            <AreaChart
              data={data}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              accessibilityLayer
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={24}
                tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
              />
              <YAxis
                allowDecimals={false}
                width={36}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Area
                type="monotone"
                dataKey="responses"
                stroke="var(--color-responses)"
                strokeWidth={2}
                fill="var(--color-responses)"
                fillOpacity={0.15}
                isAnimationActive={false}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </div>
    </>
  );
}

function ResponsesPerSurveyChart({ stats }: { stats: AdminStats }) {
  const ready = useChartsReady();
  const data = stats.perSurvey.map((survey) => ({
    name: survey.title,
    responses: survey.responses,
  }));
  /** Nama survei utuh selalu tersedia di tooltip dan daftar pembaca layar; sumbu hanya ringkasannya. */
  function shortCategory(value: string) {
    const clipped = value.length > 16 ? `${value.slice(0, 15)}…` : value;
    return clipped.replace(/ /gu, "\u00a0");
  }
  const summary = `Respons per survei: ${data.map((row) => `${row.name} ${row.responses}`).join(", ")}.`;
  return (
    <>
      <div role="img" aria-label={summary}>
        {ready && (
          <ChartContainer
            config={{
              responses: { label: "Respons", color: "var(--color-chart-2)" },
            }}
            className="aspect-auto h-64 min-w-[20rem]"
          >
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 0, right: 16, left: 8, bottom: 0 }}
              accessibilityLayer
            >
              <CartesianGrid horizontal={false} />
              <XAxis
                type="number"
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={112}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
                tickFormatter={shortCategory}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar
                dataKey="responses"
                fill="var(--color-responses)"
                radius={[0, 4, 4, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          </ChartContainer>
        )}
      </div>
      {/* Sumbu memakai nama terpotong; nama utuh hanya ada di sini dan di tooltip. */}
      <ul className="sr-only">
        {data.map((row) => (
          <li key={row.name}>{row.name}</li>
        ))}
      </ul>
    </>
  );
}

type CreatorRow = AdminStats["perCreator"][number];
type SurveyRow = AdminStats["perSurvey"][number];

const creatorColumns: ColumnDef<CreatorRow>[] = [
  {
    accessorKey: "display_name",
    header: "Creator",
    cell: ({ row }) => (
      <>
        {row.original.display_name}
        <span className="mt-1 block font-mono text-annotation tracking-mono text-muted-foreground">
          <Code>{row.original.id}</Code>
        </span>
      </>
    ),
  },
  { accessorKey: "surveys", header: "Survei" },
  { accessorKey: "responses", header: "Respons" },
];

const surveyColumns: ColumnDef<SurveyRow>[] = [
  { accessorKey: "title", header: "Survei" },
  { accessorKey: "owner", header: "Pemilik" },
  { accessorKey: "versions", header: "Versi" },
  { accessorKey: "responses", header: "Respons" },
];

/* ---------------- Data admin dari bootstrap ---------------- */

/**
 * Akun, grant, organisasi, log audit, dan event integrasi hanya berasal dari bootstrap server. Sebelum
 * bootstrap berhasil layar menampilkan keadaan memuat; bila gagal, galat dengan "Coba lagi". Fixture klien
 * tidak pernah dirender, dan kontrol aksi baru ada setelah data server tersedia.
 */
function AdminDataGate({
  subject,
  children,
}: {
  subject: string;
  children: (data: AdminData) => ReactNode;
}) {
  const { admin, error } = useStore();
  if (admin) return <>{children(admin)}</>;
  if (error) {
    return (
      <ErrorState
        title={`${subject} gagal dimuat`}
        detail={`${error} Tidak ada data yang ditampilkan sampai data berhasil dimuat.`}
        action={
          <BusyButton variant="secondary" onClick={() => void loadBootstrap()}>
            Coba lagi
          </BusyButton>
        }
      />
    );
  }
  return <LoadingState label={`Memuat ${subject.toLowerCase()}…`} rows={4} />;
}

/**
 * Aktor audit: nama akun bila dikenal, dengan ID di bawahnya. Aktor tanpa akun yang dikenal
 * (publik, sistem, akun terhapus, atau di luar organisasi) tampil sebagai ID apa adanya.
 */
export function AuditActor({
  actor,
  names,
}: {
  actor: string;
  names: ReadonlyMap<string, string>;
}) {
  const name = names.get(actor);
  if (!name) return <Code>{actor}</Code>;
  return (
    <>
      {name}
      <span className="mt-1 block font-mono text-annotation font-normal tracking-mono text-muted-foreground">
        <Code>{actor}</Code>
      </span>
    </>
  );
}

/* ---------------- Akun dan izin ---------------- */

export function AdminAccountsPage() {
  return (
    <Shell
      kind="admin"
      title="Akun dan izin"
      subtitle="Atur siapa yang boleh membaca jawaban, mengunduh data, dan melihat teks bebas."
    >
      <AdminDataGate subject="Akun dan izin">
        {(data) => <AdminAccountsContent data={data} />}
      </AdminDataGate>
    </Shell>
  );
}

/** Dipasang setelah data server tersedia, sehingga state awal formulir tidak pernah diisi dari fixture. */
function AdminAccountsContent({ data }: { data: AdminData }) {
  const { accounts, accessGrants, organizations, surveys } = data;
  const { state } = useScreenState("admin-accounts");
  const notify = useToast();
  const { grants: storedGrants, session } = useStore();
  const [accountBusy, setAccountBusy] = useState<string | null>(null);
  const [grants, setGrants] = useState(() =>
    Object.fromEntries(
      accessGrants.map((g) => [
        g.id,
        {
      read: storedGrants[g.id]?.read ?? g.can_read_individual,
      export: storedGrants[g.id]?.export ?? g.can_export,
      text: storedGrants[g.id]?.text ?? g.can_read_free_text,
        },
      ]),
    ),
  );
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scopeAccount, setScopeAccount] = useState<string | null>(null);
  const [scopeSurvey, setScopeSurvey] = useState(surveys[0]?.id ?? "");
  const [scopeRead, setScopeRead] = useState(false);
  const [scopeExport, setScopeExport] = useState(false);
  const [scopeText, setScopeText] = useState(false);
  const [scopeBusy, setScopeBusy] = useState(false);
  const [orgTypeFilter, setOrgTypeFilter] = useState<"all" | OrganizationType>(
    "all",
  );
  const [orgDialogOpen, setOrgDialogOpen] = useState(false);
  const [orgForm, setOrgForm] = useState({
    name: "",
    organization_type: "school" as OrganizationType,
    adminName: "",
    adminEmail: "",
    adminPassword: "",
  });
  const [orgBusy, setOrgBusy] = useState(false);
  const [orgError, setOrgError] = useState<string | null>(null);
  const organizationsShown = organizations.filter(
    (organization) =>
      orgTypeFilter === "all" ||
      organization.organization_type === orgTypeFilter,
  );
  const grantCounts = accessGrants.reduce<Record<string, number>>(
    (counts, grant) => ({
      ...counts,
      [grant.account_id]: (counts[grant.account_id] ?? 0) + 1,
    }),
    {},
  );
  const mutationsBlocked = [
    "loading",
    "validation",
    "closed",
    "permission-denied",
  ].includes(state);
  const activeCount = accounts.filter(
    (account) => account.status === "active",
  ).length;

  useEffect(() => {
    setGrants(
      Object.fromEntries(
        accessGrants.map((grant) => [
          grant.id,
          {
      read: storedGrants[grant.id]?.read ?? grant.can_read_individual,
      export: storedGrants[grant.id]?.export ?? grant.can_export,
      text: storedGrants[grant.id]?.text ?? grant.can_read_free_text,
          },
        ]),
      ),
    );
  }, [accessGrants, storedGrants]);

  const changeRole = (
    accountId: string,
    displayName: string,
    chosen: string,
  ) => {
    const role = chosen === "admin" ? "super_admin" : chosen;
    setAccountBusy(accountId);
    void adminSaveAccount(accountId, { role })
      .then(() => {
        notify(`Peran ${displayName} diperbarui.`);
        return refreshBootstrap();
      })
      .catch((error: unknown) =>
        notify(
          error instanceof Error ? error.message : "Peran gagal diubah.",
          "danger",
        ),
      )
      .finally(() => setAccountBusy(null));
  };

  const changeOrganization = (
    accountId: string,
    displayName: string,
    chosen: string,
  ) => {
    setAccountBusy(accountId);
    void adminSaveAccount(accountId, {
      organization_id: chosen === "" ? null : chosen,
    })
      .then(() => {
        notify(`Organisasi ${displayName} diperbarui.`);
        return refreshBootstrap();
      })
      .catch((error: unknown) =>
        notify(
          error instanceof Error ? error.message : "Organisasi gagal diubah.",
          "danger",
        ),
      )
      .finally(() => setAccountBusy(null));
  };

  const toggleStatus = (
    accountId: string,
    displayName: string,
    current: string,
  ) => {
    const status = current === "active" ? "suspended" : "active";
    setAccountBusy(accountId);
    void adminSaveAccount(accountId, { status })
      .then(() => {
        notify(`Status ${displayName} diperbarui.`);
        return refreshBootstrap();
      })
      .catch((error: unknown) =>
        notify(
          error instanceof Error ? error.message : "Status gagal diubah.",
          "danger",
        ),
      )
      .finally(() => setAccountBusy(null));
  };

  const submitOrganization = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setOrgError(null);
    const name = orgForm.name.trim();
    const displayName = orgForm.adminName.trim().replace(/\s+/g, " ");
    const email = orgForm.adminEmail.trim().toLowerCase();
    if (!name || !displayName || !email || !orgForm.adminPassword) {
      setOrgError(
        "Nama organisasi, nama admin, email, dan kata sandi awal wajib diisi.",
      );
      return;
    }
    setOrgBusy(true);
    void adminCreateOrganization({
      name,
      organization_type: orgForm.organization_type,
      admin: {
        display_name: displayName,
        email,
        password: orgForm.adminPassword,
      },
    })
      .then((created) => {
        notify(
          `Organisasi ${created.organization.name} dibuat dengan admin ${created.account.display_name}.`,
        );
        setOrgDialogOpen(false);
        setOrgForm({
          name: "",
          organization_type: "school",
          adminName: "",
          adminEmail: "",
          adminPassword: "",
        });
        // Data sudah tersimpan di server; kegagalan menyegarkan snapshot tidak boleh tampil sebagai kegagalan pembuatan.
        void refreshBootstrap().catch(() => undefined);
      })
      .catch((error: unknown) =>
        setOrgError(
          error instanceof Error ? error.message : "Organisasi gagal dibuat.",
        ),
      )
      .finally(() => setOrgBusy(false));
  };

  return (
    <>
      <StateView
        routeId="admin-accounts"
        state={state}
        emptyTitle="Belum ada akun"
        emptyDetail="Tambahkan akun pengelola untuk mulai mengatur izin."
        permissionDetail="Hanya super admin yang dapat mengubah peran dan izin."
      >
        <div className="flex flex-col gap-5">
          {state === "success" && (
            <SuccessBanner title="Izin diperbarui">
              Perubahan dicatat pada log audit tanpa memuat jawaban atau token.
            </SuccessBanner>
          )}
          {state === "validation" && (
            <ValidationSummary
              items={[
                "Setiap izin harus ditetapkan secara eksplisit.",
                "Cakupan survei harus dipilih untuk petugas berizin.",
              ]}
            />
          )}

          <section
            aria-label="Ringkasan akun dan izin"
            className="grid grid-cols-2 gap-3 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs sm:gap-4 xl:grid-cols-4"
          >
            <StatCard
              label="Total akun"
              value={accounts.length}
              icon={<AccountsIcon aria-hidden="true" className="size-4" />}
            />
            <StatCard
              label="Akun aktif"
              value={activeCount}
              icon={<ActiveAccountsIcon aria-hidden="true" className="size-4" />}
            />
            <StatCard
              label="Akun nonaktif"
              value={accounts.length - activeCount}
              icon={<SuspendedAccountsIcon aria-hidden="true" className="size-4" />}
            />
            <StatCard
              label="Organisasi"
              value={organizations.length}
              icon={<OrganizationsIcon aria-hidden="true" className="size-4" />}
            />
          </section>

          <Card>
            <CardHeader>
              <CardTitle>Akun pengelola</CardTitle>
              <CardDescription>
                Peran, organisasi, dan status menentukan apa yang bisa dibaca tiap
                akun. Akun Anda sendiri tidak dapat diubah.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="hidden lg:block">
                <DataTable
                  columns={accountColumns({
                    organizations,
                    grantCounts,
                    sessionId: session?.id ?? null,
                    accountBusy,
                    mutationsBlocked,
                    onChangeRole: changeRole,
                    onChangeOrganization: changeOrganization,
                    onToggleStatus: toggleStatus,
                  })}
                  data={accounts}
                  compact
                  filterPlaceholder="Cari nama, peran, atau organisasi"
                  filterText={(account) => {
                    const organization =
                      organizations.find(
                        (item) => item.id === account.organization_id,
                      )?.name ?? "";
                    return `${account.display_name} ${account.id} ${ROLE_LABEL[account.role]} ${organization} ${ACCOUNT_STATUS_LABEL[account.status]}`;
                  }}
                  caption="Akun pengelola: peran, organisasi, status, cakupan, dan aksi"
                  emptyMessage="Belum ada akun."
                />
              </div>

              <ul className="flex flex-col gap-3 lg:hidden">
              {accounts.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-col gap-3 rounded-lg border border-border p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar className="size-9 bg-primary/10">
                        <AvatarFallback className="bg-transparent text-annotation font-bold text-primary">
                          {initials(a.display_name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-body font-bold text-foreground">
                          <span className="truncate">{a.display_name}</span>
                          {session?.id === a.id && (
                            <Badge variant="outline" className="px-1.5 text-annotation">
                              Anda
                            </Badge>
                          )}
                        </p>
                        <p className="font-mono text-annotation tracking-mono text-muted-foreground">
                          <Code>{a.id}</Code>
                        </p>
                      </div>
                    </div>
                    <Badge
                      variant={a.status === "active" ? "success" : "secondary"}
                      className="gap-1.5"
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "size-1.5 rounded-full",
                          a.status === "active" ? "bg-emerald-600" : "bg-muted-foreground",
                        )}
                      />
                      {ACCOUNT_STATUS_LABEL[a.status]}
                    </Badge>
                  </div>
                  <label className="flex flex-col gap-1 text-caption font-bold text-muted-foreground">
                    Peran
                    <Select
                      value={a.role === "super_admin" ? "admin" : a.role}
                      disabled={
                        accountBusy === a.id ||
                        session?.id === a.id ||
                        mutationsBlocked
                      }
                      onValueChange={(value) =>
                        changeRole(a.id, a.display_name, value)
                      }
                    >
                      <SelectTrigger
                        aria-label={`Peran ${a.display_name}`}
                        className="h-11 w-full font-normal"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="creator">{ROLE_LABEL.creator}</SelectItem>
                        <SelectItem value="org_admin">{ROLE_LABEL.org_admin}</SelectItem>
                        <SelectItem value="admin">{ROLE_LABEL.super_admin}</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="flex flex-col gap-1 text-caption font-bold text-muted-foreground">
                    Organisasi
                    <Select
                      value={a.organization_id ?? "__none"}
                      disabled={
                        accountBusy === a.id ||
                        session?.id === a.id ||
                        mutationsBlocked ||
                        a.role === "super_admin"
                      }
                      onValueChange={(value) =>
                        changeOrganization(
                          a.id,
                          a.display_name,
                          value === "__none" ? "" : value,
                        )
                      }
                    >
                      <SelectTrigger
                        aria-label={`Organisasi ${a.display_name}`}
                        className="h-11 w-full font-normal"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">Tanpa organisasi</SelectItem>
                        {organizations.map((organization) => (
                          <SelectItem key={organization.id} value={organization.id}>
                            {organization.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                    <span className="text-caption text-muted-foreground">
                      {grantCounts[a.id] ?? 0} cakupan
                    </span>
                    <BusyButton
                      variant="secondary"
                      loading={accountBusy === a.id}
                      disabled={
                        accountBusy === a.id ||
                        session?.id === a.id ||
                        mutationsBlocked
                      }
                      onClick={() => toggleStatus(a.id, a.display_name, a.status)}
                    >
                      {a.status === "active" ? "Nonaktifkan" : "Aktifkan"}
                    </BusyButton>
                  </div>
                </li>
              ))}
            </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Organisasi</CardTitle>
              <CardDescription>
                Setiap organisasi menaungi akun dan surveinya sendiri; jumlah akun
                dihitung dari daftar di atas.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-caption text-muted-foreground">
                  {organizationsShown.length} dari {organizations.length} organisasi
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="w-40 max-w-full">
                    <Select
                      value={orgTypeFilter}
                      onValueChange={(value) =>
                        setOrgTypeFilter(value as "all" | OrganizationType)
                      }
                    >
                      <SelectTrigger
                        aria-label="Saring organisasi berdasarkan tipe"
                        className="h-11 w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Semua tipe</SelectItem>
                        {ORGANIZATION_TYPES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {ORGANIZATION_TYPE_TEXT[value]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <BusyButton
                    onClick={() => setOrgDialogOpen(true)}
                    disabled={mutationsBlocked}
                  >
                    <PlusIcon aria-hidden="true" className="size-4" />
                    Tambah organisasi
                  </BusyButton>
                </div>
              </div>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {organizationsShown.map((organization) => {
                  const memberCount = accounts.filter(
                    (a) => a.organization_id === organization.id,
                  ).length;
                  return (
                    <li
                      key={organization.id}
                      className="flex flex-col gap-3 rounded-lg border border-border p-4"
                    >
                      <div className="flex items-start gap-3">
                        <Avatar className="size-10 rounded-md bg-primary/10">
                          <AvatarFallback className="rounded-md bg-transparent text-primary">
                            <OrganizationsIcon aria-hidden="true" className="size-5" />
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-bold text-foreground">
                            {organization.name}
                          </p>
                          <p className="font-mono text-annotation tracking-mono text-muted-foreground">
                            <Code>{organization.id}</Code>
                          </p>
                        </div>
                      </div>
                      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                        <Badge variant="secondary">
                          {ORGANIZATION_TYPE_TEXT[organization.organization_type] ??
                            organization.organization_type}
                        </Badge>
                        <span className="text-caption tabular-nums text-muted-foreground">
                          {memberCount} akun
                        </span>
                      </div>
                    </li>
                  );
                })}
                {organizationsShown.length === 0 && (
                  <li className="rounded-lg border border-dashed border-border p-6 text-center text-body-sm text-muted-foreground sm:col-span-2 xl:col-span-3">
                    Tidak ada organisasi yang cocok dengan tipe ini.
                  </li>
                )}
              </ul>
            </CardContent>
            <FormDialog
              open={orgDialogOpen}
              title="Organisasi baru"
              description="Admin pertama mengatur profil, anggota, dan undangan. Responden dewasa dengan persetujuan diri dipakai sebagai awal."
              onClose={() => setOrgDialogOpen(false)}
            >
            <form
              className="flex flex-col gap-4"
              noValidate
              onSubmit={submitOrganization}
            >
              <div className="grid gap-4 md:grid-cols-2">
                <Field id="org-new-name" label="Nama organisasi" required>
                  {(aria) => (
                    <Input
                      {...aria}
                      value={orgForm.name}
                      onChange={(event) =>
                        setOrgForm((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      autoComplete="organization"
                    />
                  )}
                </Field>
                <Field id="org-new-type" label="Tipe organisasi" required>
                  {(aria) => (
                    <Select
                      value={orgForm.organization_type}
                      onValueChange={(value) =>
                        setOrgForm((current) => ({
                          ...current,
                          organization_type: value as OrganizationType,
                        }))
                      }
                    >
                      <SelectTrigger
                        {...aria}
                        aria-label="Tipe organisasi"
                        className="h-11 w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ORGANIZATION_TYPES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {ORGANIZATION_TYPE_LABEL[value]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </Field>
                <Field
                  id="org-new-admin-name"
                  label="Nama admin pertama"
                  required
                >
                  {(aria) => (
                    <Input
                      {...aria}
                      value={orgForm.adminName}
                      onChange={(event) =>
                        setOrgForm((current) => ({
                          ...current,
                          adminName: event.target.value,
                        }))
                      }
                      autoComplete="off"
                    />
                  )}
                </Field>
                <Field
                  id="org-new-admin-email"
                  label="Email admin"
                  required
                  hint="Dipakai untuk masuk pertama kali."
                >
                  {(aria) => (
                    <Input
                      {...aria}
                      type="email"
                      value={orgForm.adminEmail}
                      onChange={(event) =>
                        setOrgForm((current) => ({
                          ...current,
                          adminEmail: event.target.value,
                        }))
                      }
                      autoComplete="off"
                    />
                  )}
                </Field>
                <Field
                  id="org-new-admin-password"
                  label="Kata sandi awal"
                  required
                  hint="12–256 karakter, minimal tiga dari: huruf kecil, huruf besar, angka, simbol."
                >
                  {(aria) => (
                    <Input
                      {...aria}
                      type="password"
                      value={orgForm.adminPassword}
                      onChange={(event) =>
                        setOrgForm((current) => ({
                          ...current,
                          adminPassword: event.target.value,
                        }))
                      }
                      autoComplete="new-password"
                    />
                  )}
                </Field>
              </div>
              {orgError && (
                <Alert variant="danger" role="status">
                  <AlertTitle>Tidak dapat membuat organisasi</AlertTitle>
                  <AlertDescription>{orgError}</AlertDescription>
                </Alert>
              )}
              <BusyButton
                type="submit"
                loading={orgBusy}
                disabled={orgBusy || mutationsBlocked}
              >
                Buat organisasi
              </BusyButton>
            </form>
            </FormDialog>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Cakupan izin</CardTitle>
              <CardDescription>
                Satu cakupan menghubungkan satu akun dengan satu survei. Atur akses
                baca, ekspor, dan teks bebasnya secara terpisah.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-caption text-muted-foreground">
                {accessGrants.length} cakupan untuk{" "}
                {new Set(accessGrants.map((grant) => grant.account_id)).size} akun
              </p>
              <BusyButton
                onClick={() =>
                  setScopeAccount(
                    accounts.find((a) => a.role !== "super_admin")?.id ?? null,
                  )
                }
              >
                <PlusIcon aria-hidden="true" className="size-4" />
                Tambah cakupan
              </BusyButton>
            </div>
            {accessGrants.length === 0 && (
              <p className="rounded-lg border border-dashed border-border p-6 text-center text-body-sm text-muted-foreground">
                Belum ada cakupan. Tambahkan cakupan untuk memberi satu akun akses
                ke satu survei.
              </p>
            )}
            <div className="grid gap-3 xl:grid-cols-2">
            {accessGrants.map((g) => {
              const acc = accounts.find((a) => a.id === g.account_id);
              const survey = surveys.find((s) => s.id === g.survey_id);
              const current = grants[g.id] ?? {
                read: false,
                export: false,
                text: false,
              };
              return (
                <article
                  key={g.id}
                  className="flex flex-col gap-3 rounded-lg border border-border p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Avatar className="size-8 bg-primary/10">
                        <AvatarFallback className="bg-transparent text-annotation font-bold text-primary">
                          {initials(acc?.display_name ?? g.account_id)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate text-body font-bold text-foreground">
                          {acc?.display_name ?? g.account_id}
                        </p>
                        <p className="text-caption text-muted-foreground">
                          {acc ? ROLE_LABEL[acc.role] : "Akun tidak ditemukan"}
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline" className="max-w-60">
                      <span className="truncate">
                        {survey?.title ?? "Semua survei"}
                      </span>
                    </Badge>
                  </div>
                  <Separator />
                  <div className="grid gap-2 sm:grid-cols-3">
                    <CheckboxField
                      id={`${g.id}-read`}
                      label="Baca jawaban individual"
                      checked={current.read}
                      onChange={(v) =>
                        setGrants((prev) => ({
                          ...prev,
                          [g.id]: { ...current, read: v },
                        }))
                      }
                    />
                    <CheckboxField
                      id={`${g.id}-export`}
                      label="Ekspor data"
                      checked={current.export}
                      onChange={(v) =>
                        setGrants((prev) => ({
                          ...prev,
                          [g.id]: { ...current, export: v },
                        }))
                      }
                    />
                    <CheckboxField
                      id={`${g.id}-text`}
                      label="Baca teks bebas"
                      checked={current.text}
                      onChange={(v) =>
                        setGrants((prev) => ({
                          ...prev,
                          [g.id]: { ...current, text: v },
                        }))
                      }
                    />
                  </div>
                </article>
              );
            })}
            </div>

            <FormDialog
              open={scopeAccount !== null}
              title="Tambah cakupan izin"
              description="Pilih akun dan survei, lalu tentukan akses baca, ekspor, dan teks bebasnya."
              onClose={() => setScopeAccount(null)}
            >
              <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
                <label className="flex min-w-0 flex-col gap-1 text-caption font-bold text-muted-foreground">
                  Akun
                  <Select
                    value={scopeAccount ?? undefined}
                    onValueChange={setScopeAccount}
                  >
                    <SelectTrigger
                      aria-label="Akun untuk cakupan baru"
                      className="h-11 w-full min-w-0 font-normal"
                    >
                      <SelectValue placeholder="Pilih akun" />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts
                        .filter((a) => a.role !== "super_admin")
                        .map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.display_name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="flex min-w-0 flex-col gap-1 text-caption font-bold text-muted-foreground">
                  Survei
                  <Select
                    value={scopeSurvey}
                    onValueChange={setScopeSurvey}
                  >
                    <SelectTrigger
                      aria-label="Survei untuk cakupan baru"
                      className="h-11 w-full min-w-0 font-normal"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {surveys.map((survey) => (
                        <SelectItem key={survey.id} value={survey.id}>
                          {survey.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <CheckboxField
                  id="scope-read"
                  label="Baca jawaban individual"
                  checked={scopeRead}
                  onChange={setScopeRead}
                />
                <CheckboxField
                  id="scope-export"
                  label="Ekspor data"
                  checked={scopeExport}
                  onChange={setScopeExport}
                />
                <CheckboxField
                  id="scope-text"
                  label="Baca teks bebas"
                  checked={scopeText}
                  onChange={setScopeText}
                />
              </div>
              <BusyButton
                className="mt-3"
                variant="secondary"
                loading={scopeBusy}
                disabled={
                  scopeBusy || mutationsBlocked || !scopeAccount || !scopeSurvey
                }
                onClick={() => {
                  if (!scopeAccount) return;
                  const accountId = scopeAccount;
                  const surveyId = scopeSurvey;
                  const rows = accessGrants
                    .filter(
                      (grant) =>
                        grant.account_id === accountId &&
                        grant.survey_id !== surveyId,
                    )
                    .map((grant) => {
                      const current = grants[grant.id] ?? {
                        read: grant.can_read_individual,
                        export: grant.can_export,
                        text: grant.can_read_free_text,
                      };
                      return {
                        survey_id: grant.survey_id,
                        can_read_individual: current.read,
                        can_export: current.export,
                        can_read_free_text: current.text,
                      };
                    });
                  rows.push({
                    survey_id: surveyId,
                    can_read_individual: scopeRead,
                    can_export: scopeExport,
                    can_read_free_text: scopeText,
                  });
                  setScopeBusy(true);
                  void adminSaveGrants(accountId, rows)
                    .then(async () => {
                      await refreshBootstrap();
                      const created = currentAdminData()?.accessGrants.find(
                        (grant) =>
                          grant.account_id === accountId &&
                          grant.survey_id === surveyId,
                      );
                      if (created) {
                        setGrants((prev) => ({
                          ...prev,
                          [created.id]: {
                            read: scopeRead,
                            export: scopeExport,
                            text: scopeText,
                          },
                        }));
                      }
                      setScopeAccount(null);
                      notify("Cakupan izin berhasil disimpan.");
                    })
                    .catch((error: unknown) =>
                      notify(
                        error instanceof Error
                          ? error.message
                          : "Cakupan gagal disimpan.",
                        "danger",
                      ),
                    )
                    .finally(() => setScopeBusy(false));
                }}
              >
                Simpan cakupan
              </BusyButton>
            </FormDialog>
            <Separator />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-caption text-muted-foreground">
                Perubahan berlaku pada workspace ini setelah disimpan.
              </p>
              <BusyButton
                onClick={() => {
                  setBusy(true);
                  void saveGrants(grants)
                    .then(() => {
                      setSaved(true);
                      notify("Izin akun berhasil disimpan.");
                    })
                    .catch((error: unknown) =>
                      notify(
                        error instanceof Error
                          ? error.message
                          : "Izin gagal disimpan.",
                        "danger",
                      ),
                    )
                    .finally(() => setBusy(false));
                }}
                disabled={
                  state === "loading" ||
                  state === "validation" ||
                  state === "closed" ||
                  busy
                }
                loading={busy}
              >
                Simpan izin
              </BusyButton>
            </div>
            {saved && (
              <Alert variant="success" role="status">
                <AlertTitle>Izin tersimpan</AlertTitle>
                <AlertDescription>Perubahan berlaku pada workspace ini.</AlertDescription>
              </Alert>
            )}
            </CardContent>
          </Card>
        </div>
      </StateView>
    </>
  );
}

/* ---------------- Log audit ---------------- */

const AUDIT_OUTCOME_VARIANT: Record<AuditOutcome, "success" | "danger" | "warning" | "default"> = {
  berhasil: "success",
  ditolak: "danger",
  gagal: "warning",
  dimulai: "default",
};

const AUDIT_OUTCOME_LABEL: Record<AuditOutcome, string> = {
  berhasil: "Berhasil",
  ditolak: "Ditolak",
  gagal: "Gagal",
  dimulai: "Dimulai",
};

const AUDIT_OUTCOME_DOT: Record<AuditOutcome, string> = {
  berhasil: "bg-emerald-600",
  ditolak: "bg-destructive",
  gagal: "bg-amber-600",
  dimulai: "bg-muted-foreground",
};

const AUDIT_FILTERS = [
  { value: "all", label: "Semua hasil" },
  { value: "berhasil", label: "Berhasil" },
  { value: "ditolak", label: "Ditolak" },
  { value: "gagal", label: "Gagal" },
  { value: "dimulai", label: "Dimulai" },
] as const;

type AuditFilter = (typeof AUDIT_FILTERS)[number]["value"];

/** Pemilih hasil audit ala Select shadcn; dipakai di header desktop dan baris kontrol mobile. */
function AuditOutcomeSelect({
  outcome,
  counts,
  total,
  onOutcome,
  className,
}: {
  outcome: AuditFilter;
  counts: Record<AuditOutcome, number>;
  total: number;
  onOutcome: (value: AuditFilter) => void;
  className?: string;
}) {
  return (
    <Select
      value={outcome}
      onValueChange={(value) => onOutcome(value as AuditFilter)}
    >
      <SelectTrigger
        aria-label="Saring entri menurut hasil"
        className={cn("h-11", className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {AUDIT_FILTERS.map((filter) => {
          const count = filter.value === "all" ? total : counts[filter.value];
          return (
            <SelectItem key={filter.value} value={filter.value}>
              {`${filter.label} (${count})`}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

/** Badge hasil dengan titik status; label naik huruf agar sama dengan status lain di admin. */
function OutcomeBadge({ outcome }: { outcome: AuditOutcome }) {
  return (
    <Badge variant={AUDIT_OUTCOME_VARIANT[outcome]} className="gap-1.5">
      <span
        aria-hidden="true"
        className={cn("size-1.5 rounded-full", AUDIT_OUTCOME_DOT[outcome])}
      />
      {AUDIT_OUTCOME_LABEL[outcome]}
    </Badge>
  );
}

/**
 * Kolom tabel audit: jam dan tanggal ditumpuk, aktor ber-avatar, aksi bercampur objeknya,
 * dan hasil memakai badge. Ringkas supaya empat kolom tidak melebar di layar sedang.
 */
function auditColumnDefs(names: ReadonlyMap<string, string>): ColumnDef<AuditLog>[] {
  return [
    {
      accessorKey: "at",
      header: "Waktu",
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="tabular-nums font-bold text-foreground">
            {formatWIBTime(row.original.at)}
          </span>
          <span className="text-annotation text-muted-foreground">
            {formatWIBDate(row.original.at)}
          </span>
        </div>
      ),
    },
    {
      accessorKey: "actor",
      header: "Aktor",
      cell: ({ row }) => {
        const name = names.get(row.original.actor);
        return (
          <div className="flex items-center gap-2.5">
            <Avatar className="size-8 bg-muted">
              <AvatarFallback className="text-annotation font-bold text-muted-foreground">
                {initials(name ?? row.original.actor)}
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0 font-bold text-foreground">
              <AuditActor actor={row.original.actor} names={names} />
            </span>
          </div>
        );
      },
    },
    {
      accessorKey: "action",
      header: "Kejadian",
      cell: ({ row }) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-bold text-foreground">{row.original.action}</span>
          <Code>{row.original.object}</Code>
        </div>
      ),
    },
    {
      accessorKey: "outcome",
      header: "Hasil",
      cell: ({ row }) => <OutcomeBadge outcome={row.original.outcome} />,
    },
  ];
}

export function AdminAuditPage() {
  useEffect(() => {
    void refreshBootstrap();
  }, []);
  return (
    <Shell
      kind="admin"
      title="Log audit"
      subtitle="Telusuri siapa melakukan apa dan hasilnya, lalu saring kejadian yang perlu ditinjau."
    >
      <AdminDataGate subject="Log audit">
        {(data) => <AdminAuditContent data={data} />}
      </AdminDataGate>
    </Shell>
  );
}

/**
 * Masa retensi platform. Halaman Profil platform dihapus: hanya nilai operasional ini yang
 * dipakai, dan konteksnya cocok dengan Log audit karena batch penghapusan tercatat di sana.
 */
function RetentionCard() {
  const notify = useToast();
  const [raw, setRaw] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void getPlatformProfile()
      .then((profile) => {
        setRaw(profile.retention_days === null ? "" : String(profile.retention_days));
      })
      .catch(() => setError("Masa retensi gagal dimuat."));
  }, []);

  const onSave = (event: FormEvent) => {
    event.preventDefault();
    const days = parseRetentionDays(raw);
    if (days === undefined) {
      setError("Masa retensi harus bilangan bulat 0 atau lebih.");
      return;
    }
    setError("");
    setBusy(true);
    void savePlatformProfile({ retention_days: days })
      .then((profile) => {
        setRaw(profile.retention_days === null ? "" : String(profile.retention_days));
        setSaved(true);
        notify("Masa retensi tersimpan.");
      })
      .catch((failure: unknown) =>
        notify(failure instanceof Error ? failure.message : "Masa retensi gagal disimpan.", "danger"),
      )
      .finally(() => setBusy(false));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Retensi data</CardTitle>
        <CardDescription>
          Survei tanpa organisasi; yang berorganisasi memakai retensi organisasinya.
          Kosong atau 0 berarti tanpa penghapusan otomatis.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSave} className="flex flex-wrap items-start gap-3">
          <div className="flex w-40 flex-col gap-1">
            <Input
              aria-label="Masa retensi (hari)"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "platform-retention-error" : undefined}
              inputMode="numeric"
              placeholder="Hari, mis. 30"
              value={raw}
              disabled={busy}
              onChange={(event) => {
                setSaved(false);
                setError("");
                setRaw(event.target.value);
              }}
            />
            {error && (
              <p
                id="platform-retention-error"
                role="alert"
                className="text-caption font-bold text-destructive"
              >
                {error}
              </p>
            )}
          </div>
          <DashButton type="submit" disabled={busy}>
            {busy ? "Menyimpan…" : "Simpan"}
          </DashButton>
          {saved && (
            <p role="status" className="text-caption font-bold text-emerald-600">
              Tersimpan.
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function AdminAuditContent({ data }: { data: AdminData }) {
  const { auditLogs, accounts } = data;
  const { state } = useScreenState("admin-audit");
  const [outcome, setOutcome] = useState<AuditFilter>("all");
  const [query, setQuery] = useState("");
  const names = new Map(
    accounts.map((account) => [account.id, account.display_name]),
  );
  const auditColumns = auditColumnDefs(names);
  const outcomeCounts = auditLogs.reduce<Record<AuditOutcome, number>>(
    (counts, log) => ({
      ...counts,
      [log.outcome]: (counts[log.outcome] ?? 0) + 1,
    }),
    { berhasil: 0, ditolak: 0, gagal: 0, dimulai: 0 },
  );
  const haystack = (log: AuditLog) =>
    `${names.get(log.actor) ?? ""} ${log.actor} ${log.action} ${log.object} ${formatWIBDate(log.at)} ${formatWIBTime(log.at)}`;
  const shown =
    outcome === "all"
      ? auditLogs
      : auditLogs.filter((log) => log.outcome === outcome);
  const needle = query.trim().toLowerCase();
  const mobileShown = needle
    ? shown.filter((log) => haystack(log).toLowerCase().includes(needle))
    : shown;
  const emptyOutcome =
    outcome !== "all"
      ? "Tidak ada entri dengan hasil ini."
      : "Belum ada entri audit.";
  const emptyMobile = needle
    ? "Tidak ada entri yang cocok dengan pencarian."
    : emptyOutcome;
  return (
    <>
      <StateView
        routeId="admin-audit"
        state={state}
        emptyTitle="Belum ada entri audit"
        emptyDetail="Entri muncul setelah publikasi, perubahan izin, akses individual, atau ekspor."
        permissionDetail="Log operasional hanya dapat dibaca sesuai tugas."
      >
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <CardTitle>Entri audit</CardTitle>
              <CardDescription>
                Aktor dikenal tampil sebagai nama; entri publik atau sistem tampil
                sebagai ID. Isi jawaban tidak pernah dicatat di sini.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="hidden lg:block">
                <DataTable
                  columns={auditColumns}
                  data={shown}
                  caption="Entri audit: waktu, aktor, kejadian, dan hasil"
                  emptyMessage={emptyOutcome}
                  compact
                  filter={query}
                  onFilterChange={setQuery}
                  filterPlaceholder="Cari aktor, aksi, atau objek"
                  filterText={haystack}
                  toolbarExtra={
                    <AuditOutcomeSelect
                      outcome={outcome}
                      counts={outcomeCounts}
                      total={auditLogs.length}
                      onOutcome={setOutcome}
                      className="w-40"
                    />
                  }
                />
              </div>

              <div className="mb-3 flex flex-col gap-2 lg:hidden">
                <Input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Cari aktor, aksi, atau objek"
                  aria-label="Cari entri audit"
                />
                <AuditOutcomeSelect
                  outcome={outcome}
                  counts={outcomeCounts}
                  total={auditLogs.length}
                  onOutcome={setOutcome}
                  className="w-full"
                />
              </div>

              <ul className="flex flex-col gap-3 lg:hidden">
                {mobileShown.map((log) => {
                  const name = names.get(log.actor);
                  return (
                    <li
                      key={log.id}
                      className="flex flex-col gap-2 rounded-lg border border-border p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-bold text-foreground">{log.action}</p>
                          <p className="mt-0.5">
                            <Code>{log.object}</Code>
                          </p>
                        </div>
                        <OutcomeBadge outcome={log.outcome} />
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-caption text-muted-foreground">
                        <span className="flex min-w-0 items-center gap-2">
                          <Avatar className="size-6 bg-muted">
                            <AvatarFallback className="text-annotation font-bold text-muted-foreground">
                              {initials(name ?? log.actor)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="truncate">
                            {name ?? <Code>{log.actor}</Code>}
                          </span>
                        </span>
                        <span className="tabular-nums">
                          {formatWIBTime(log.at)} · {formatWIBDate(log.at)}
                        </span>
                      </div>
                    </li>
                  );
                })}
                {!mobileShown.length && (
                  <li className="rounded-lg border border-dashed border-border p-6 text-center text-caption text-muted-foreground">
                    {emptyMobile}
                  </li>
                )}
              </ul>
            </CardContent>
          </Card>

          <RetentionCard />
        </div>
      </StateView>
    </>
  );
}

/* ---------------- Integrasi ---------------- */

const EVENT_STATUS_VARIANT: Record<EventStatus, "success" | "warning" | "danger"> = {
  delivered: "success",
  pending: "warning",
  failed: "danger",
};

const EVENT_STATUS_LABEL: Record<EventStatus, string> = {
  delivered: "Terkirim",
  pending: "Menunggu",
  failed: "Gagal",
};

const EVENT_STATUS_DOT: Record<EventStatus, string> = {
  delivered: "bg-emerald-600",
  pending: "bg-amber-600",
  failed: "bg-white/80",
};

const EVENT_FILTERS = [
  { value: "all", label: "Semua status" },
  { value: "delivered", label: "Terkirim" },
  { value: "pending", label: "Menunggu" },
  { value: "failed", label: "Gagal" },
] as const;

type EventFilter = (typeof EVENT_FILTERS)[number]["value"];

function EventStatusBadge({ status }: { status: EventStatus }) {
  return (
    <Badge variant={EVENT_STATUS_VARIANT[status]} className="gap-1.5">
      <span
        aria-hidden="true"
        className={cn("size-1.5 rounded-full", EVENT_STATUS_DOT[status])}
      />
      {EVENT_STATUS_LABEL[status]}
    </Badge>
  );
}

/** Pemilih status event ala Select shadcn; dipakai di toolbar tabel dan baris kontrol mobile. */
function EventStatusSelect({
  status,
  counts,
  total,
  onStatus,
  className,
}: {
  status: EventFilter;
  counts: Record<EventStatus, number>;
  total: number;
  onStatus: (value: EventFilter) => void;
  className?: string;
}) {
  return (
    <Select
      value={status}
      onValueChange={(value) => onStatus(value as EventFilter)}
    >
      <SelectTrigger
        aria-label="Saring event menurut status"
        className={cn("h-11", className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {EVENT_FILTERS.map((filter) => {
          const count = filter.value === "all" ? total : counts[filter.value];
          return (
            <SelectItem key={filter.value} value={filter.value}>
              {`${filter.label} (${count})`}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

/** Kolom event integrasi; aksi ulang dinonaktifkan saat muat atau saat event itu sendiri sedang diulang. */
function integrationColumns({
  busyEvent,
  replayed,
  locked,
  onReplay,
}: {
  busyEvent: string | null;
  replayed: string | null;
  locked: boolean;
  onReplay: (event: IntegrationEvent) => void;
}): ColumnDef<IntegrationEvent>[] {
  return [
    {
      accessorKey: "event_id",
      header: "Kejadian",
      cell: ({ row }) => (
        <div className="flex flex-col gap-1">
          <Code>{row.original.event_id}</Code>
          <span className="text-caption text-muted-foreground">
            {row.original.type} · {row.original.simulated ? "Simulasi" : "Nyata"}
          </span>
        </div>
      ),
    },
    {
      accessorKey: "at",
      header: "Waktu",
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="tabular-nums font-bold text-foreground">
            {formatWIBTime(row.original.at)}
          </span>
          <span className="text-annotation text-muted-foreground">
            {formatWIBDate(row.original.at)}
          </span>
        </div>
      ),
    },
    {
      accessorKey: "target",
      header: "Tujuan",
      cell: ({ row }) => <Code>{row.original.target}</Code>,
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <div className="flex flex-col items-start gap-1">
          <EventStatusBadge status={row.original.status} />
          <span className="text-caption text-muted-foreground">
            {row.original.attempts} percobaan
          </span>
        </div>
      ),
    },
    {
      id: "action",
      header: "Aksi",
      cell: ({ row }) => {
        const event = row.original;
        return (
          <DashButton
            variant="outline"
            size="sm"
            onClick={() => onReplay(event)}
            disabled={locked || busyEvent === event.id}
          >
            {busyEvent === event.id
              ? "Mengulang…"
              : replayed === event.id
                ? "Diulang"
                : "Ulangi"}
          </DashButton>
        );
      },
    },
  ];
}

export function AdminIntegrationPage() {
  return (
    <Shell
      kind="admin"
      title="Status integrasi"
      subtitle="Pantau status pertukaran data dengan layanan identitas dan konsumen analitik."
    >
      <AdminDataGate subject="Event integrasi">
        {(data) => <AdminIntegrationContent data={data} />}
      </AdminDataGate>
    </Shell>
  );
}

function AdminIntegrationContent({ data }: { data: AdminData }) {
  const { integrationEvents } = data;
  const { state } = useScreenState("admin-integration");
  const notify = useToast();
  const { integrationNote } = useStore();
  const [replayed, setReplayed] = useState<string | null>(null);
  const [busyEvent, setBusyEvent] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [status, setStatus] = useState<EventFilter>("all");
  const [query, setQuery] = useState("");
  const statusCounts = integrationEvents.reduce<Record<EventStatus, number>>(
    (counts, event) => {
      counts[event.status] += 1;
      return counts;
    },
    { delivered: 0, pending: 0, failed: 0 },
  );
  const byStatus =
    status === "all"
      ? integrationEvents
      : integrationEvents.filter((event) => event.status === status);
  const haystack = (event: IntegrationEvent) =>
    `${event.event_id} ${event.type} ${event.target} ${EVENT_STATUS_LABEL[event.status]} ${formatWIBDate(event.at)} ${formatWIBTime(event.at)}`;
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? byStatus.filter((event) => haystack(event).toLowerCase().includes(needle))
    : byStatus;
  const emptyStatus =
    status === "all"
      ? "Belum ada event integrasi."
      : "Tidak ada event dengan status ini.";
  const emptyVisible = needle
    ? "Tidak ada event yang cocok dengan pencarian."
    : emptyStatus;

  const handleReplay = (event: IntegrationEvent) => {
    setBusyEvent(event.id);
    setRetryError(null);
    void replayEvent(event.id)
      .then(() => {
        setReplayed(event.id);
        notify(`Event ${event.event_id} diulang dengan ID yang sama.`);
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : "Event gagal diulang.";
        setRetryError(message);
        notify(message, "danger");
      })
      .finally(() => setBusyEvent(null));
  };

  return (
    <>
      <StateView
        routeId="admin-integration"
        state={state}
        permissionDetail="Status integrasi hanya untuk peran yang berwenang."
        conflictTo={ROUTES.adminAudit}
        errorTitle="Layanan integrasi terputus"
        errorDetail="Alur mandiri tetap berjalan meski layanan integrasi sedang terganggu."
      >
        <div className="flex flex-col gap-5">
          {state === "success" && (
            <SuccessBanner title="Event berhasil diulang">
              ID kejadian tetap dipakai dan tidak membuat respons kedua.
            </SuccessBanner>
          )}
          {retryError && (
            <Alert variant="danger" role="status">
              <AlertTitle>Pengulangan tidak membuktikan pengiriman</AlertTitle>
              <AlertDescription>{retryError}</AlertDescription>
            </Alert>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Event integrasi</CardTitle>
              <CardDescription>
                Satu event per respons tersimpan. Mengulang memakai ID kejadian
                yang sama; event selesai hanya untuk respons tersimpan.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="hidden lg:block">
                <DataTable
                  columns={integrationColumns({
                    busyEvent,
                    replayed,
                    locked: state === "loading",
                    onReplay: handleReplay,
                  })}
                  data={byStatus}
                  caption="Event integrasi: kejadian, waktu, tujuan, status, dan aksi"
                  emptyMessage={emptyStatus}
                  compact
                  filter={query}
                  onFilterChange={setQuery}
                  filterPlaceholder="Cari kejadian, tipe, tujuan"
                  filterText={haystack}
                  toolbarExtra={
                    <EventStatusSelect
                      status={status}
                      counts={statusCounts}
                      total={integrationEvents.length}
                      onStatus={setStatus}
                      className="w-40"
                    />
                  }
                />
              </div>
              <div className="mb-3 flex flex-col gap-2 lg:hidden">
                <Input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Cari kejadian, tipe, tujuan"
                  aria-label="Cari event integrasi"
                  className="w-full"
                />
                <EventStatusSelect
                  status={status}
                  counts={statusCounts}
                  total={integrationEvents.length}
                  onStatus={setStatus}
                  className="w-full"
                />
              </div>
              {visible.length === 0 ? (
                <p className="py-6 text-center text-body-sm text-muted-foreground lg:hidden">
                  {emptyVisible}
                </p>
              ) : (
                <ul className="flex flex-col gap-3 lg:hidden">
                  {visible.map((event) => (
                    <li
                      key={event.id}
                      className="flex flex-col gap-3 rounded-lg border border-border p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 flex-col gap-1">
                          <Code>{event.event_id}</Code>
                          <span className="text-caption text-muted-foreground">
                            {event.type} ·{" "}
                            {event.simulated ? "Simulasi" : "Nyata"}
                          </span>
                        </div>
                        <EventStatusBadge status={event.status} />
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-caption text-muted-foreground">
                        <Code>{event.target}</Code>
                        <span className="tabular-nums">
                          {formatWIBTime(event.at)} · {formatWIBDate(event.at)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-caption text-muted-foreground">
                          {event.attempts} percobaan
                        </span>
                        <DashButton
                          variant="outline"
                          size="sm"
                          onClick={() => handleReplay(event)}
                          disabled={
                            state === "loading" || busyEvent === event.id
                          }
                        >
                          {busyEvent === event.id
                            ? "Mengulang…"
                            : replayed === event.id
                              ? "Diulang"
                              : "Ulangi"}
                        </DashButton>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Layanan terhubung</CardTitle>
              <CardDescription>
                Dua layanan eksternal disimulasikan pada MVP lokal; endpoint dan
                autentikasi nyata masih perlu disepakati.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <ul className="flex flex-col divide-y divide-border">
                <li className="flex items-start justify-between gap-3 pb-4">
                  <div className="min-w-0">
                    <p className="font-bold text-foreground">
                      Layanan identitas
                    </p>
                    <p className="mt-1 text-caption text-muted-foreground">
                      Memberi identitas dan penugasan terverifikasi serta
                      menerima status pengiriman.
                    </p>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-caption font-bold text-foreground">
                        Catatan kontrak
                      </summary>
                      <ul className="mt-2 flex list-disc flex-col gap-1 ps-4 text-caption text-muted-foreground">
                        <li>
                          ID lokal dan kode individual dipakai selama daftar
                          peserta belum tersedia.
                        </li>
                        <li>
                          LMS mencatat tautan dibuka; sistem ini mencatat
                          jawaban tersimpan.
                        </li>
                        <li>Tidak membuat identitas kedua otomatis.</li>
                      </ul>
                    </details>
                  </div>
                  <Badge variant="secondary">Simulasi</Badge>
                </li>
                <li className="flex items-start justify-between gap-3 py-4">
                  <div className="min-w-0">
                    <p className="font-bold text-foreground">Konsumen data</p>
                    <p className="mt-1 text-caption text-muted-foreground">
                      Menerima keluaran CSV wajib MVP; API masih sebatas
                      rancangan.
                    </p>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-caption font-bold text-foreground">
                        Catatan kontrak
                      </summary>
                      <ul className="mt-2 flex list-disc flex-col gap-1 ps-4 text-caption text-muted-foreground">
                        <li>Filter cakupan dan kolom, catat penerima.</li>
                        <li>
                          <Code>schema_version</Code>, versi survei, kode item,
                          nilai atau teks sesuai izin.
                        </li>
                        <li>
                          <Code>collection_mode</Code>: standalone / integrated;{" "}
                          <Code>identity_source</Code>: local/module_13.
                        </li>
                      </ul>
                    </details>
                  </div>
                  <Badge variant="secondary">Simulasi</Badge>
                </li>
              </ul>
              <Separator />
              <div className="flex flex-col gap-2">
                <Field id="integration-note" label="Kontak kontrak">
                  {(aria) => (
                    <Input
                      {...aria}
                      placeholder="Catatan untuk tim integrasi"
                      value={integrationNote}
                      onChange={(e) => setIntegrationNote(e.target.value)}
                    />
                  )}
                </Field>
                <p className="text-caption text-muted-foreground">
                  Catatan tersimpan di peramban ini untuk referensi tim.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </StateView>
    </>
  );
}

/* ---------------- Permintaan data ---------------- */

const REQUEST_LABELS: Record<DataRequestStatus, string> = {
  pending: "Menunggu",
  in_progress: "Diproses",
  handled: "Selesai",
  rejected: "Ditolak",
};

/** Kanal yang dipakai pengelola untuk membalas pemohon; server mencatatnya sebagai jejak balasan `response_channel`. */
const RESPONSE_CHANNEL_LABELS: Record<string, string> = {
  email: "Email",
  phone: "Telepon",
  messaging: "Pesan singkat (SMS/WhatsApp)",
  letter: "Surat",
  in_person: "Tatap muka",
};

/**
 * Nilai kanonis yang dicatat server, bukan pilihan balasan admin: job retensi mengganti kanal teks bebas
 * dengan `dianonimkan`. Baris lama tetap menampilkannya sebagai label manusiawi, tanpa menawarkannya
 * sebagai pilihan kanal baru.
 */
const SYSTEM_CHANNEL_LABELS: Record<string, string> = {
  dianonimkan: "Dianonimkan",
};

const CHANNEL_REQUIRED =
  "Pilih kanal yang dipakai untuk membalas pemohon. Kanal ini dicatat sebagai bukti bahwa permintaan sudah dibalas.";

const REQUEST_STATUS_VARIANT: Record<
  DataRequestStatus,
  "success" | "warning" | "info" | "danger"
> = {
  pending: "warning",
  in_progress: "info",
  handled: "success",
  rejected: "danger",
};

const REQUEST_STATUS_DOT: Record<DataRequestStatus, string> = {
  pending: "bg-amber-600",
  in_progress: "bg-sky-600",
  handled: "bg-emerald-600",
  rejected: "bg-white/80",
};

const REQUEST_FILTERS = [
  { value: "all", label: "Semua status" },
  { value: "pending", label: "Menunggu" },
  { value: "in_progress", label: "Diproses" },
  { value: "handled", label: "Selesai" },
  { value: "rejected", label: "Ditolak" },
] as const;

type RequestFilter = (typeof REQUEST_FILTERS)[number]["value"];

function RequestStatusBadge({ status }: { status: DataRequestStatus }) {
  return (
    <Badge variant={REQUEST_STATUS_VARIANT[status]} className="gap-1.5">
      <span
        aria-hidden="true"
        className={cn("size-1.5 rounded-full", REQUEST_STATUS_DOT[status])}
      />
      {REQUEST_LABELS[status]}
    </Badge>
  );
}

/** Pemilih status permintaan ala Select shadcn; dipakai di toolbar tabel dan baris kontrol mobile. */
function RequestStatusSelect({
  status,
  counts,
  total,
  onStatus,
  className,
}: {
  status: RequestFilter;
  counts: Record<DataRequestStatus, number>;
  total: number;
  onStatus: (value: RequestFilter) => void;
  className?: string;
}) {
  return (
    <Select
      value={status}
      onValueChange={(value) => onStatus(value as RequestFilter)}
    >
      <SelectTrigger
        aria-label="Saring permintaan menurut status"
        className={cn("h-11", className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {REQUEST_FILTERS.map((filter) => {
          const count = filter.value === "all" ? total : counts[filter.value];
          return (
            <SelectItem key={filter.value} value={filter.value}>
              {`${filter.label} (${count})`}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

/** Kolom tabel permintaan; tombol aksi membuka dialog tindak lanjut. */
function requestColumns(
  onOpen: (request: DataRequest) => void,
): ColumnDef<DataRequest>[] {
  return [
    {
      accessorKey: "id",
      header: "Permintaan",
      cell: ({ row }) => (
        <div className="flex min-w-0 flex-col gap-1">
          <Code>{row.original.id}</Code>
          <span className="text-caption text-muted-foreground">
            {DATA_REQUEST_TYPE_LABEL[row.original.type] ?? row.original.type}
          </span>
          <span className="break-all whitespace-normal text-body-sm text-muted-foreground">
            {row.original.contact}
          </span>
        </div>
      ),
    },
    {
      accessorKey: "created_at",
      header: "Diajukan",
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="tabular-nums font-bold text-foreground">
            {formatWIBTime(row.original.created_at)}
          </span>
          <span className="text-annotation text-muted-foreground">
            {formatWIBDate(row.original.created_at)}
          </span>
        </div>
      ),
    },
    {
      accessorKey: "note",
      header: "Keterangan",
      cell: ({ row }) => (
        <p className="line-clamp-2 whitespace-normal text-body-sm text-muted-foreground">
          {row.original.note ?? "—"}
        </p>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const request = row.original;
        const channelLabel = request.response_channel
          ? (RESPONSE_CHANNEL_LABELS[request.response_channel] ??
            SYSTEM_CHANNEL_LABELS[request.response_channel] ??
            request.response_channel)
          : null;
        return (
          <div className="flex flex-col items-start gap-1">
            <RequestStatusBadge status={request.status} />
            {channelLabel ? (
              <span className="text-caption text-muted-foreground">
                {channelLabel}
              </span>
            ) : null}
          </div>
        );
      },
    },
    {
      id: "action",
      header: "Aksi",
      cell: ({ row }) => (
        <DashButton
          variant="outline"
          size="sm"
          onClick={() => onOpen(row.original)}
        >
          Tinjau
        </DashButton>
      ),
    },
  ];
}

function RequestForm({
  request,
  onSaved,
  onCancel,
}: {
  request: DataRequest;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [status, setStatus] = useState<DataRequestStatus>(request.status);
  const [note, setNote] = useState(request.outcome_note ?? "");
  const [channel, setChannel] = useState(request.response_channel ?? "");
  const [channelError, setChannelError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const notify = useToast();
  const fieldId = `request-${request.id}`;
  const channelId = `${fieldId}-channel`;
  // Kanal tersimpan di luar daftar (mis. teks bebas lewat API) tetap dapat dipilih agar simpan ulang tidak menggantinya.
  const storedChannel = request.response_channel;
  const channelOptions =
    storedChannel && !Object.hasOwn(RESPONSE_CHANNEL_LABELS, storedChannel)
      ? [
          [
            storedChannel,
            SYSTEM_CHANNEL_LABELS[storedChannel] ?? storedChannel,
          ],
          ...Object.entries(RESPONSE_CHANNEL_LABELS),
        ]
    : Object.entries(RESPONSE_CHANNEL_LABELS);

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaveError(null);
    setChannelError(null);
    if (status === "handled" && !channel) {
      setChannelError(CHANNEL_REQUIRED);
      document.getElementById(channelId)?.focus();
      return;
    }
    const outcomeNote = note.trim();
    setBusy(true);
    void updateDataRequest(
      request.id,
      status === "handled"
        ? { status, outcome_note: outcomeNote, response_channel: channel }
        : { status, outcome_note: outcomeNote },
    )
      .then(() => {
        notify("Permintaan data diperbarui. Log audit mencatat tindakan ini.");
        onSaved();
      })
      .catch((error: unknown) => {
        if (
          error instanceof ApiError &&
          error.code === "response_evidence_required"
        ) {
          setChannelError(CHANNEL_REQUIRED);
          document.getElementById(channelId)?.focus();
          return;
        }
        setSaveError(
          error instanceof Error
            ? error.message
            : "Permintaan data gagal diperbarui.",
        );
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid gap-3 rounded-md border border-border bg-muted p-3 text-body-sm sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-caption font-bold text-muted-foreground">
            Jenis
          </dt>
          <dd className="text-foreground">
            {DATA_REQUEST_TYPE_LABEL[request.type] ?? request.type}
          </dd>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-caption font-bold text-muted-foreground">
            Diajukan
          </dt>
          <dd className="tabular-nums text-foreground">
            {formatWIBTime(request.created_at)} ·{" "}
            {formatWIBDate(request.created_at)}
          </dd>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5 sm:col-span-2">
          <dt className="text-caption font-bold text-muted-foreground">
            Pemohon
          </dt>
          <dd className="break-all text-foreground">{request.contact}</dd>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5 sm:col-span-2">
          <dt className="text-caption font-bold text-muted-foreground">
            Keterangan
          </dt>
          <dd className="break-words text-foreground">
            {request.note ?? "—"}
          </dd>
        </div>
      </dl>
      <form className="flex flex-col gap-3" noValidate onSubmit={save}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={`${fieldId}-status`} label="Status">
            {(aria) => (
              <Select
                value={status}
                onValueChange={(value) => {
                  setStatus(value as DataRequestStatus);
                  setChannelError(null);
                }}
              >
                <SelectTrigger
                  {...aria}
                  aria-label={`Status permintaan ${request.id}`}
                  className="h-11 w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(REQUEST_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          {status === "handled" && (
            <Field
              id={channelId}
              label="Kanal balasan"
              required
              hint="Cara Anda membalas pemohon."
              error={channelError ?? undefined}
            >
              {(aria) => (
                <Select
                  value={channel || undefined}
                  onValueChange={(value) => {
                    setChannel(value);
                    setChannelError(null);
                  }}
                >
                  <SelectTrigger
                    {...aria}
                    aria-label={`Kanal balasan permintaan ${request.id}`}
                    className="h-11 w-full"
                  >
                    <SelectValue placeholder="Pilih kanal" />
                  </SelectTrigger>
                  <SelectContent>
                    {channelOptions.map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          )}
          <div className="sm:col-span-2">
            <Field id={`${fieldId}-note`} label="Catatan hasil">
              {(aria) => (
                <Input
                  {...aria}
                  aria-label={`Catatan hasil permintaan ${request.id}`}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              )}
            </Field>
          </div>
        </div>
        {saveError && (
          <Alert variant="danger" role="status">
            <AlertTitle>Perubahan belum tersimpan</AlertTitle>
            <AlertDescription>{saveError}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <DashButton type="button" variant="outline" onClick={onCancel}>
            Batal
          </DashButton>
          <BusyButton type="submit" loading={busy} disabled={busy}>
            Simpan
          </BusyButton>
        </div>
      </form>
    </div>
  );
}

/** Dialog tindak lanjut: ringkasan pemohon di atas, form status/kanal/catatan di bawahnya. */
function RequestDialog({
  request,
  onClose,
  onSaved,
}: {
  request: DataRequest | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const typeLabel = request
    ? (DATA_REQUEST_TYPE_LABEL[request.type] ?? request.type)
    : "";
  return (
    <FormDialog
      open={request !== null}
      title="Tindak lanjuti permintaan"
      description={request ? `${request.id} · ${typeLabel}` : ""}
      onClose={onClose}
    >
      {request ? (
        <RequestForm request={request} onSaved={onSaved} onCancel={onClose} />
      ) : null}
    </FormDialog>
  );
}

export function AdminRequestsPage() {
  const { state } = useScreenState("admin-requests");
  const { dataRequests: rows, dataRequestsError: error } = useStore();
  const [active, setActive] = useState<DataRequest | null>(null);
  const [status, setStatus] = useState<RequestFilter>("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    void loadDataRequests();
    return cancelDataRequestsLoad;
  }, []);

  const requests = rows ?? [];
  const statusCounts = requests.reduce<Record<DataRequestStatus, number>>(
    (counts, request) => {
      counts[request.status] += 1;
      return counts;
    },
    { pending: 0, in_progress: 0, handled: 0, rejected: 0 },
  );
  const byStatus =
    status === "all"
      ? requests
      : requests.filter((request) => request.status === status);
  const haystack = (request: DataRequest) =>
    `${request.id} ${DATA_REQUEST_TYPE_LABEL[request.type] ?? request.type} ${request.contact} ${request.note ?? ""} ${REQUEST_LABELS[request.status]} ${formatWIBDate(request.created_at)}`;
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? byStatus.filter((request) =>
        haystack(request).toLowerCase().includes(needle),
      )
    : byStatus;
  const emptyStatus =
    status === "all"
      ? "Belum ada permintaan data."
      : "Tidak ada permintaan dengan status ini.";
  const emptyVisible = needle
    ? "Tidak ada permintaan yang cocok dengan pencarian."
    : emptyStatus;

  return (
    <Shell
      kind="admin"
      title="Permintaan data"
      subtitle="Verifikasi pemohon dan tindak lanjuti akses, koreksi, penarikan, atau penghapusan tanpa membuka jawaban."
    >
      <StateView routeId="admin-requests" state={state}>
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <CardTitle>Daftar permintaan</CardTitle>
              <CardDescription>
                Catat keputusan dan kanal balasan; setiap simpan tercatat di log
                audit.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {error ? (
                <ErrorState
                  title="Daftar permintaan gagal dimuat"
                  detail={`${error} Antrean tidak ditampilkan sampai data berhasil dimuat.`}
                  action={
                    <BusyButton
                      variant="secondary"
                      onClick={() => void loadDataRequests()}
                    >
                      Coba lagi
                    </BusyButton>
                  }
                />
              ) : rows === null ? (
                <p role="status" className="text-body-sm text-muted-foreground">
                  Memuat permintaan…
                </p>
              ) : rows.length === 0 ? (
                <p className="text-body-sm text-muted-foreground">
                  Belum ada permintaan data.
                </p>
              ) : (
                <>
                  <div className="hidden lg:block">
                    <DataTable
                      columns={requestColumns(setActive)}
                      data={byStatus}
                      caption="Permintaan data: ID, pemohon, keterangan, waktu, status, dan aksi"
                      emptyMessage={emptyStatus}
                      compact
                      filter={query}
                      onFilterChange={setQuery}
                      filterPlaceholder="Cari ID, kontak, keterangan"
                      filterText={haystack}
                      toolbarExtra={
                        <RequestStatusSelect
                          status={status}
                          counts={statusCounts}
                          total={requests.length}
                          onStatus={setStatus}
                          className="w-44"
                        />
                      }
                    />
                  </div>
                  <div className="mb-3 flex flex-col gap-2 lg:hidden">
                    <Input
                      type="search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Cari ID, kontak, keterangan"
                      aria-label="Cari permintaan data"
                      className="w-full"
                    />
                    <RequestStatusSelect
                      status={status}
                      counts={statusCounts}
                      total={requests.length}
                      onStatus={setStatus}
                      className="w-full"
                    />
                  </div>
                  {visible.length === 0 ? (
                    <p className="py-6 text-center text-body-sm text-muted-foreground lg:hidden">
                      {emptyVisible}
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-3 lg:hidden">
                      {visible.map((request) => (
                        <li
                          key={request.id}
                          className="flex flex-col gap-3 rounded-lg border border-border p-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 flex-col gap-1">
                              <Code>{request.id}</Code>
                              <span className="text-caption text-muted-foreground">
                                {DATA_REQUEST_TYPE_LABEL[request.type] ??
                                  request.type}
                              </span>
                            </div>
                            <RequestStatusBadge status={request.status} />
                          </div>
                          <div className="flex flex-col gap-1 text-body-sm">
                            <span className="break-all text-foreground">
                              {request.contact}
                            </span>
                            {request.note ? (
                              <span className="line-clamp-2 whitespace-normal text-caption text-muted-foreground">
                                {request.note}
                              </span>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="tabular-nums text-caption text-muted-foreground">
                              {formatWIBTime(request.created_at)} ·{" "}
                              {formatWIBDate(request.created_at)}
                            </span>
                            <DashButton
                              variant="outline"
                              size="sm"
                              onClick={() => setActive(request)}
                            >
                              Tindak lanjuti
                            </DashButton>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </CardContent>
          </Card>
          <RequestDialog
            request={active}
            onClose={() => setActive(null)}
            onSaved={() => {
              setActive(null);
              void loadDataRequests();
            }}
          />
        </div>
      </StateView>
    </Shell>
  );
}
