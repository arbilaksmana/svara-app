"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Shell } from "../components/Shell";
import {
  ActionLink,
  Banner,
  Button,
  Checkbox,
  Code,
  ErrorState,
  LoadingState,
} from "../components/ui";
import {
  StateView,
  SuccessBanner,
  ValidationSummary,
} from "../components/StateView";
import { useScreenState } from "../lib/state";
import { ROUTES } from "../lib/routes";
import { formatWIB } from "../lib/summary";
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
  CardAction,
  Card as DashCard,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button as DashButton } from "../components/ui/button";
import { Field } from "../components/ui/field";
import { Input } from "../components/ui/input";
import { Separator } from "../components/ui/separator";
import { Select } from "../components/ui/select";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "../components/ui/chart";
import { DataTable } from "../components/data-table";
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
  updateDataRequest,
  type AdminStats,
  type ChartRange,
  type DataRequest,
  type DataRequestStatus,
} from "../lib/api";
import {
  ACCOUNT_STATUS_LABEL,
  DATA_REQUEST_TYPE_LABEL,
  ORGANIZATION_TYPE_LABEL,
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

/** Kartu ringan tanpa elevasi untuk kartu di dalam grid (DESIGN.md: shadow hanya untuk kartu melayang). */
function SoftCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex flex-col gap-3 rounded-lg border border-[var(--ad-border)] bg-[var(--ad-soft)] p-4 sm:p-6 ${className}`}
    >
      {children}
    </section>
  );
}

/* ---------------- Ringkasan ---------------- */

const ROLE_VALUES = ["creator", "org_admin", "admin"] as const;

/** Kolom daftar akun: select peran/organisasi, status, jumlah cakupan, dan aksi status. */
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
        <div className="min-w-0">
          <p className="font-bold text-[color:var(--ad-text)]">{row.original.display_name}</p>
          <span className="mt-1 block font-mono text-annotation font-normal tracking-mono text-[color:var(--ad-muted)]">
            <Code>{row.original.id}</Code>
          </span>
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
            aria-label={`Peran ${account.display_name}`}
            value={account.role === "super_admin" ? "admin" : account.role}
            disabled={
              accountBusy === account.id ||
              sessionId === account.id ||
              mutationsBlocked
            }
            onChange={(event) =>
              onChangeRole(account.id, account.display_name, event.target.value)
            }
          >
            {ROLE_VALUES.map((value) => (
              <option key={value} value={value}>
                {ROLE_LABEL[value === "admin" ? "super_admin" : value]}
              </option>
            ))}
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
            aria-label={`Organisasi ${account.display_name}`}
            className="w-56"
            value={account.organization_id ?? ""}
            disabled={
              accountBusy === account.id ||
              sessionId === account.id ||
              mutationsBlocked ||
              account.role === "super_admin"
            }
            onChange={(event) =>
              onChangeOrganization(
                account.id,
                account.display_name,
                event.target.value,
              )
            }
          >
            <option value="">Tanpa organisasi</option>
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </Select>
        );
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <Badge variant={row.original.status === "active" ? "success" : "secondary"}>
          {ACCOUNT_STATUS_LABEL[row.original.status]}
        </Badge>
      ),
    },
    {
      id: "grants",
      header: "Cakupan",
      cell: ({ row }) => (
        <span className="tabular-nums">{grantCounts[row.original.id] ?? 0} grant</span>
      ),
    },
    {
      id: "action",
      header: "Aksi",
      cell: ({ row }) => {
        const account = row.original;
        return (
          <Button
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
          </Button>
        );
      },
    },
  ];
}

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
            <Button variant="secondary" onClick={retry}>
              Coba lagi
            </Button>
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
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Jumlah survei" value={stats.surveys} />
              <StatCard label="Total respons final" value={stats.responses} />
              <StatCard label="Akun pengelola" value={stats.accounts} />
              <StatCard label="Permintaan menunggu" value={stats.pendingRequests} />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <DashCard>
                <CardHeader>
                  <CardTitle>Tren respons</CardTitle>
                  <CardDescription>
                    Agregat respons final; periode tanpa data bernilai nol.
                  </CardDescription>
                  <CardAction>
                    <Select
                      value={range}
                      onChange={(event) =>
                        setRange(event.target.value as ChartRange)
                      }
                      aria-label="Rentang waktu grafik tren respons"
                    >
                      {RANGE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </CardAction>
                </CardHeader>
                <CardContent>
                  <ResponsesAreaChart stats={stats} range={range} />
                </CardContent>
              </DashCard>
              <DashCard>
                <CardHeader>
                  <CardTitle>Respons per survei</CardTitle>
                  <CardDescription>
                    Total respons final tiap survei.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsesPerSurveyChart stats={stats} />
                </CardContent>
              </DashCard>
            </div>

            <DashCard className="gap-3">
              <CardContent>
                <DataTable
                  title="Metrik per creator"
                  columns={creatorColumns}
                  data={stats.perCreator}
                  caption="Jumlah survei dan respons per creator"
                  emptyMessage="Belum ada creator."
                />
              </CardContent>
            </DashCard>

            <DashCard className="gap-3">
              <CardContent>
                <DataTable
                  title="Metrik per survei"
                  columns={surveyColumns}
                  data={stats.perSurvey}
                  caption="Jumlah versi dan respons per survei"
                  emptyMessage="Belum ada survei."
                />
              </CardContent>
            </DashCard>
          </div>
        </StateView>
      )}
    </Shell>
  );
}

/* ---------------- Ringkasan: kartu tren, grafik, dan tabel data ---------------- */

/** Kartu KPI: label dan angka saja. */
function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <DashCard className="gap-2 py-5">
      <CardHeader>
        <CardDescription className="min-w-0">{label}</CardDescription>
        <CardTitle className="text-h1 leading-none tabular-nums">
          {value}
        </CardTitle>
      </CardHeader>
    </DashCard>
  );
}

/** Recharts butuh pengukuran DOM; grafik dirender setelah mount agar SSR tetap ringan. */
function useChartsReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready;
}

const RANGE_OPTIONS: Array<{ value: ChartRange; label: string }> = [
  { value: "today", label: "Hari ini" },
  { value: "7d", label: "7 hari terakhir" },
  { value: "30d", label: "30 hari terakhir" },
  { value: "6m", label: "6 bulan terakhir" },
];

const RANGE_LABEL: Record<ChartRange, string> = {
  today: "hari ini",
  "7d": "7 hari terakhir",
  "30d": "30 hari terakhir",
  "6m": "6 bulan terakhir",
};

/**
 * Label sumbu dari kunci titik server: 'YYYY-MM-DDTHH' (per jam) atau 'YYYY-MM-DD' (per hari).
 * Titik harian ditulis 'dd/MM' karena jendela 30 hari melewati dua bulan.
 */
function pointLabel(point: string, range: ChartRange): string {
  if (range === "6m") return monthLabel(point);
  return range === "today"
    ? `${point.slice(11, 13)}:00`
    : `${point.slice(8, 10)}/${point.slice(5, 7)}`;
}

/** Nama bulan singkat Indonesia untuk titik bulanan 'YYYY-MM' pada payload tanpa `chart`. */
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
  // Server saat ini hanya mengirim agregat per bulan; bila rentang lain dipilih dan `chart` absen,
  // deret bulanan (6 bulan) yang dipakai agar kartu tidak kosong — pemilih tetap berfungsi.
  const points =
    stats.chart ??
    stats.perMonth.map((row) => ({ point: row.month, responses: row.responses }));
  const data = points.map((row) => ({
    label: pointLabel(row.point, stats.chart ? range : "6m"),
    responses: row.responses,
  }));
  if (data.length === 0) {
    return (
      <p className="text-caption text-[color:var(--ad-muted)]">
        Belum ada data respons.
      </p>
    );
  }
  const total = data.reduce((sum, row) => sum + row.responses, 0);
  const windowLabel = stats.chart ? RANGE_LABEL[range] : "6 bulan terakhir";
  const summary = `Respons ${windowLabel} (total ${total}): ${data.map((row) => `${row.label} ${row.responses}`).join(", ")}.`;
  return (
    <>
      {!stats.chart && (
        <p className="mb-1 text-caption text-[color:var(--ad-muted)]">
          Server hanya menyediakan agregat bulanan; grafik menampilkan 6 bulan
          terakhir.
        </p>
      )}
      <div role="img" aria-label={summary}>
        {ready && (
          <ChartContainer
            config={{
              responses: { label: "Respons", color: "var(--ad-accent)" },
            }}
            className="h-64"
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
                tick={{ fill: "var(--ad-muted)", fontSize: 12 }}
              />
              <YAxis
                allowDecimals={false}
                width={36}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--ad-muted)", fontSize: 12 }}
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
              responses: { label: "Respons", color: "var(--ad-accent)" },
            }}
            className="h-64 min-w-[20rem]"
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
                tick={{ fill: "var(--ad-muted)", fontSize: 12 }}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={112}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--ad-muted)", fontSize: 12 }}
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
        <span className="mt-1 block font-mono text-annotation tracking-mono text-[color:var(--ad-muted)]">
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
          <Button variant="secondary" onClick={() => void loadBootstrap()}>
            Coba lagi
          </Button>
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
      <span className="mt-1 block font-mono text-annotation font-normal tracking-mono text-[color:var(--ad-muted)]">
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
  const [scopeAccount, setScopeAccount] = useState("");
  const [scopeSurvey, setScopeSurvey] = useState(surveys[0]?.id ?? "");
  const [scopeRead, setScopeRead] = useState(false);
  const [scopeExport, setScopeExport] = useState(false);
  const [scopeText, setScopeText] = useState(false);
  const [scopeBusy, setScopeBusy] = useState(false);
  const [orgForm, setOrgForm] = useState({
    name: "",
    organization_type: "school" as OrganizationType,
    adminName: "",
    adminEmail: "",
    adminPassword: "",
  });
  const [orgBusy, setOrgBusy] = useState(false);
  const [orgError, setOrgError] = useState<string | null>(null);
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

          <DashCard className="gap-4">
            <CardHeader>
              <CardTitle>Daftar akun</CardTitle>
              <CardDescription>
                Peran, organisasi, status, dan jumlah cakupan tiap akun. Akun
                sendiri tidak dapat diubah.
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
                  caption="Akun pengelola: peran, organisasi, status, cakupan, dan aksi"
                  emptyMessage="Belum ada akun."
                  plain
                />
              </div>

              <ul className="flex flex-col gap-3 lg:hidden">
              {accounts.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-col gap-3 rounded-md border border-[var(--ad-border)] p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-body font-bold text-[color:var(--ad-text)]">
                        {a.display_name}
                      </p>
                      <p className="font-mono text-annotation tracking-mono text-[color:var(--ad-muted)]">
                        <Code>{a.id}</Code>
                      </p>
                    </div>
                    <Badge variant={a.status === "active" ? "success" : "secondary"}>
                      {ACCOUNT_STATUS_LABEL[a.status]}
                    </Badge>
                  </div>
                  <label className="flex flex-col gap-1 text-caption font-bold text-[color:var(--ad-muted)]">
                    Peran
                    <Select
                      aria-label={`Peran ${a.display_name}`}
                      value={a.role === "super_admin" ? "admin" : a.role}
                      disabled={
                        accountBusy === a.id ||
                        session?.id === a.id ||
                        mutationsBlocked
                      }
                      onChange={(event) =>
                        changeRole(a.id, a.display_name, event.target.value)
                      }
                      className="min-h-[44px] w-full font-normal"
                    >
                      <option value="creator">{ROLE_LABEL.creator}</option>
                      <option value="org_admin">{ROLE_LABEL.org_admin}</option>
                      <option value="admin">{ROLE_LABEL.super_admin}</option>
                    </Select>
                  </label>
                  <label className="flex flex-col gap-1 text-caption font-bold text-[color:var(--ad-muted)]">
                    Organisasi
                    <Select
                      aria-label={`Organisasi ${a.display_name}`}
                      value={a.organization_id ?? ""}
                      disabled={
                        accountBusy === a.id ||
                        session?.id === a.id ||
                        mutationsBlocked ||
                        a.role === "super_admin"
                      }
                      onChange={(event) =>
                        changeOrganization(
                          a.id,
                          a.display_name,
                          event.target.value,
                        )
                      }
                      className="min-h-[44px] w-full font-normal"
                    >
                      <option value="">Tanpa organisasi</option>
                      {organizations.map((organization) => (
                        <option key={organization.id} value={organization.id}>
                          {organization.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <p className="text-body-sm text-[color:var(--ad-muted)]">
                    {accessGrants.filter((g) => g.account_id === a.id).length}{" "}
                    grant
                  </p>
                  <Button
                    variant="secondary"
                    block
                    loading={accountBusy === a.id}
                    disabled={
                      accountBusy === a.id ||
                      session?.id === a.id ||
                      mutationsBlocked
                    }
                    onClick={() => toggleStatus(a.id, a.display_name, a.status)}
                  >
                    {a.status === "active" ? "Nonaktifkan" : "Aktifkan"}
                  </Button>
                </li>
              ))}
            </ul>
            </CardContent>
          </DashCard>

          <DashCard className="gap-4">
            <CardHeader>
              <CardTitle>Organisasi</CardTitle>
              <CardDescription>
                Organisasi baru langsung mendapat admin pertama yang mengatur
                profil, anggota, dan undangannya. Responden dewasa dengan
                persetujuan diri dipakai sebagai awal; admin organisasi dapat
                mengubahnya di halaman Organisasi.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2">
                {organizations.map((organization) => (
                  <li
                    key={organization.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--ad-border)] bg-[var(--ad-surface)] p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-body font-bold text-[color:var(--ad-text)]">
                        {organization.name}
                      </p>
                      <p className="mt-1 font-mono text-annotation tracking-mono text-[color:var(--ad-muted)]">
                        <Code>{organization.id}</Code>
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">
                        {ORGANIZATION_TYPE_LABEL[organization.organization_type]}
                      </Badge>
                      <span className="text-caption text-[color:var(--ad-muted)]">
                        {
                          accounts.filter(
                            (a) => a.organization_id === organization.id,
                          ).length
                        }{" "}
                        akun
                      </span>
                    </div>
                  </li>
                ))}
                {organizations.length === 0 && (
                  <li className="text-body-sm text-[color:var(--ad-muted)]">
                    Belum ada organisasi.
                  </li>
                )}
              </ul>
            </CardContent>
            <CardContent className="flex flex-col gap-4">
              <Separator />
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
                      {...aria}
                      value={orgForm.organization_type}
                      onChange={(event) =>
                        setOrgForm((current) => ({
                          ...current,
                          organization_type: event.target
                            .value as OrganizationType,
                        }))
                      }
                      className="min-h-[44px] w-full"
                    >
                      {(["school", "organization"] as OrganizationType[]).map(
                        (value) => (
                          <option key={value} value={value}>
                            {ORGANIZATION_TYPE_LABEL[value]}
                          </option>
                        ),
                      )}
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
                <Banner tone="danger" title="Tidak dapat membuat organisasi">
                  {orgError}
                </Banner>
              )}
              <Button
                type="submit"
                loading={orgBusy}
                disabled={orgBusy || mutationsBlocked}
              >
                Buat organisasi
              </Button>
            </form>
            </CardContent>
          </DashCard>

          <DashCard className="gap-4">
            <CardHeader>
              <CardTitle>Izin terpisah per grant</CardTitle>
              <CardDescription>
                Setiap grant mengatur akses baca, ekspor, dan teks bebas secara
                terpisah per akun.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
            {accessGrants.map((g) => {
              const acc = accounts.find((a) => a.id === g.account_id);
              const current = grants[g.id] ?? {
                read: false,
                export: false,
                text: false,
              };
              return (
                <div
                  key={g.id}
                  className="rounded-md border border-[var(--ad-border)] bg-[var(--ad-surface)] p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-body font-bold text-[color:var(--ad-text)]">
                      {acc?.display_name ?? g.account_id}
                    </p>
                    <Badge variant="secondary">
                      <Code>{g.survey_id ?? "semua"}</Code>
                    </Badge>
                  </div>
                  <Separator className="my-3" />
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Checkbox
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
                    <Checkbox
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
                    <Checkbox
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
                </div>
              );
            })}

            <div className="rounded-md border border-dashed border-[var(--ad-border)] p-4">
              <h2 className="text-body font-bold text-[color:var(--ad-text)]">
                Tambah atau perbarui cakupan
              </h2>
              <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
                <label className="flex min-w-0 flex-col gap-1 text-caption font-bold text-[color:var(--ad-muted)]">
                  Akun
                  <Select
                    aria-label="Akun untuk cakupan baru"
                    value={scopeAccount}
                    onChange={(event) => setScopeAccount(event.target.value)}
                    className="min-h-[44px] w-full min-w-0 font-normal"
                  >
                    <option value="">Pilih akun</option>
                    {accounts
                      .filter((a) => a.role !== "super_admin")
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.display_name}
                        </option>
                      ))}
                  </Select>
                </label>
                <label className="flex min-w-0 flex-col gap-1 text-caption font-bold text-[color:var(--ad-muted)]">
                  Survei
                  <Select
                    aria-label="Survei untuk cakupan baru"
                    value={scopeSurvey}
                    onChange={(event) => setScopeSurvey(event.target.value)}
                    className="min-h-[44px] w-full min-w-0 font-normal"
                  >
                    {surveys.map((survey) => (
                      <option key={survey.id} value={survey.id}>
                        {survey.title}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <Checkbox
                  id="scope-read"
                  label="Baca jawaban individual"
                  checked={scopeRead}
                  onChange={setScopeRead}
                />
                <Checkbox
                  id="scope-export"
                  label="Ekspor data"
                  checked={scopeExport}
                  onChange={setScopeExport}
                />
                <Checkbox
                  id="scope-text"
                  label="Baca teks bebas"
                  checked={scopeText}
                  onChange={setScopeText}
                />
              </div>
              <Button
                className="mt-3"
                variant="secondary"
                loading={scopeBusy}
                disabled={
                  scopeBusy || mutationsBlocked || !scopeAccount || !scopeSurvey
                }
                onClick={() => {
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
              </Button>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
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
              </Button>
              <ActionLink to={ROUTES.adminAudit} variant="secondary">
                Lihat log perubahan izin
              </ActionLink>
            </div>
            {saved && (
              <Banner tone="success" title="Izin tersimpan">
                Perubahan berlaku pada workspace ini.
              </Banner>
            )}
            </CardContent>
          </DashCard>

          <SoftCard>
            <h2 className="text-body font-bold text-[color:var(--ad-text)]">Teks bebas</h2>
            <p className="text-body-sm text-[color:var(--ad-muted)]">
              Teks bebas dapat memuat identitas yang ditulis responden. Batasi
              dan periksa sebelum dibagikan; hanya penerima berizin yang boleh
              membacanya.
            </p>
          </SoftCard>
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

/** Aktor audit: nama akun plus ID bila dikenal, ID sebagai kode bila tidak. */
function auditColumnDefs(names: ReadonlyMap<string, string>): ColumnDef<AuditLog>[] {
  return [
    {
      accessorKey: "at",
      header: "Waktu (WIB)",
      cell: ({ row }) => formatWIB(row.original.at),
    },
    {
      accessorKey: "actor",
      header: "Aktor",
      cell: ({ row }) => (
        <span className="font-bold text-[color:var(--ad-text)]">
          <AuditActor actor={row.original.actor} names={names} />
        </span>
      ),
    },
    {
      accessorKey: "action",
      header: "Aksi",
      cell: ({ row }) => row.original.action,
    },
    {
      accessorKey: "object",
      header: "Objek",
      cell: ({ row }) => <Code>{row.original.object}</Code>,
    },
    {
      accessorKey: "outcome",
      header: "Hasil",
      cell: ({ row }) => (
        <Badge variant={AUDIT_OUTCOME_VARIANT[row.original.outcome]}>
          {row.original.outcome}
        </Badge>
      ),
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
      subtitle="Catatan aktivitas memuat aktor, aksi, objek, hasil, dan waktu tanpa isi jawaban."
    >
      <AdminDataGate subject="Log audit">
        {(data) => <AdminAuditContent data={data} />}
      </AdminDataGate>
    </Shell>
  );
}

function AdminAuditContent({ data }: { data: AdminData }) {
  const { auditLogs, accounts } = data;
  const { state } = useScreenState("admin-audit");
  const names = new Map(
    accounts.map((account) => [account.id, account.display_name]),
  );
  const auditColumns = auditColumnDefs(names);
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
          <Banner tone="info" title="Catatan aktivitas">
            Kolom dibatasi pada informasi operasional. Log tidak memuat token,
            kredensial, atau jawaban.
          </Banner>
          <DashCard className="gap-3">
            <CardHeader>
              <CardTitle>Entri operasional</CardTitle>
              <CardDescription>
                Aktor yang dikenal tampil sebagai nama beserta ID; yang tidak
                dikenal tampil sebagai ID.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={auditColumns}
                data={auditLogs}
                caption="Entri operasional: waktu, aktor, aksi, objek, dan hasil"
                emptyMessage="Belum ada entri audit."
                plain
              />
            </CardContent>
          </DashCard>
          <SoftCard>
            <h2 className="text-body font-bold text-[color:var(--ad-text)]">
              Cakupan pencatatan
            </h2>
            <ul className="flex list-inside list-disc flex-col gap-1 text-body-sm text-[color:var(--ad-muted)]">
              <li>Perubahan izin dan status.</li>
              <li>Akses jawaban individual dan penolakan akses.</li>
              <li>Publikasi, penutupan, dan ekspor beserta penerima.</li>
              <li>Event integrasi dicatat dengan ID kejadian yang tetap.</li>
            </ul>
          </SoftCard>
          <div className="flex flex-wrap gap-3">
            <ActionLink to={ROUTES.adminIntegration} variant="secondary">
              Lihat event integrasi
            </ActionLink>
            <ActionLink to={ROUTES.admin} variant="secondary">
              Kembali ke ringkasan
            </ActionLink>
          </div>
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
      header: "ID kejadian",
      cell: ({ row }) => (
        <div className="flex flex-col gap-1">
          <Code>{row.original.event_id}</Code>
          <Badge variant="secondary">
            {row.original.simulated ? "Simulasi" : "Nyata"}
          </Badge>
        </div>
      ),
    },
    {
      accessorKey: "type",
      header: "Tipe",
      cell: ({ row }) => row.original.type,
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
        <Badge variant={EVENT_STATUS_VARIANT[row.original.status]}>
          {EVENT_STATUS_LABEL[row.original.status]}
        </Badge>
      ),
    },
    {
      accessorKey: "attempts",
      header: "Percobaan",
      cell: ({ row }) => row.original.attempts,
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
                : "Ulangi event"}
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
  const down = state === "error";

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
          {down && (
            <Banner tone="danger" title="Layanan terputus">
              Alur mandiri tetap berjalan tanpa layanan integrasi. Status
              pengiriman dapat diulang setelah layanan kembali.
            </Banner>
          )}
          {retryError && (
            <Banner
              tone="danger"
              title="Pengulangan tidak membuktikan pengiriman"
            >
              {retryError}
            </Banner>
          )}
          <Banner tone="info" title="Simulasi integrasi lokal">
            Tidak ada pengiriman jaringan nyata pada MVP lokal ini. Event dan
            status di bawah adalah simulasi yang dibuat saat respons tersimpan.
          </Banner>

          <div className="grid gap-4 sm:grid-cols-2">
          <DashCard className="gap-4">
            <CardHeader>
              <CardTitle>Layanan identitas (integrasi)</CardTitle>
              <CardDescription>
                Memberi identitas dan penugasan terverifikasi serta menerima
                status pengiriman. Endpoint dan autentikasi nyata masih perlu
                disepakati.
              </CardDescription>
              <CardAction>
                <Badge variant={down ? "danger" : "success"}>
                  {down ? "Terputus" : "Simulasi aktif"}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent>
              <ul className="flex list-inside list-disc flex-col gap-1 text-body-sm text-[color:var(--ad-text)]">
                <li>
                  ID lokal dan kode individual dipakai selama daftar peserta
                  belum tersedia.
                </li>
                <li>
                  Bedakan LMS mencatat tautan dibuka dan sistem ini mencatat
                  jawaban tersimpan.
                </li>
                <li>Jangan membuat identitas kedua otomatis.</li>
              </ul>
            </CardContent>
          </DashCard>
          <DashCard className="gap-4">
            <CardHeader>
              <CardTitle>Layanan konsumen data (integrasi)</CardTitle>
              <CardDescription>
                CSV adalah jalur keluaran wajib MVP. API adalah jalur integrasi
                yang didukung rancangan; format final masih terbuka.
              </CardDescription>
              <CardAction>
                <Badge variant={down ? "danger" : "success"}>
                  {down ? "Terputus" : "Simulasi aktif"}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent>
              <ul className="flex list-inside list-disc flex-col gap-1 text-body-sm text-[color:var(--ad-text)]">
                <li>Filter cakupan dan kolom, catat penerima.</li>
                <li>
                  <Code>schema_version</Code>, versi survei, kode item, nilai
                  atau teks sesuai izin.
                </li>
                <li>
                  <Code>collection_mode</Code>: standalone (pengisian mandiri) /
                  integrated (integrasi sistem); <Code>identity_source</Code>:
                  local/module_13.
                </li>
              </ul>
            </CardContent>
          </DashCard>
          </div>

          <DashCard className="gap-3">
            <CardHeader>
              <CardTitle>Event integrasi (simulasi)</CardTitle>
              <CardDescription>
                Satu event per respons tersimpan. Mengulang memakai ID kejadian
                yang sama.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={integrationColumns({
                  busyEvent,
                  replayed,
                  locked: state === "loading",
                  onReplay: (event) => {
                    setBusyEvent(event.id);
                    setRetryError(null);
                    void replayEvent(event.id)
                      .then(() => {
                        setReplayed(event.id);
                        notify(
                          `Event ${event.event_id} diulang dengan ID yang sama.`,
                        );
                      })
                      .catch((error: unknown) => {
                        const message =
                          error instanceof Error
                            ? error.message
                            : "Event gagal diulang.";
                        setRetryError(message);
                        notify(message, "danger");
                      })
                      .finally(() => setBusyEvent(null));
                  },
                })}
                data={integrationEvents}
                caption="Event integrasi: ID kejadian, tipe, tujuan, status, dan percobaan"
                emptyMessage="Belum ada event integrasi."
                plain
              />
            </CardContent>
            <CardContent>
              <p className="text-caption text-[color:var(--ad-muted)]">
                Event selesai hanya untuk respons tersimpan. ID kejadian tetap
                dipakai saat percobaan ulang.
              </p>
            </CardContent>
          </DashCard>

          <DashCard className="gap-4">
            <CardHeader>
              <CardTitle>Mode mandiri</CardTitle>
              <CardDescription>
                Creator tetap dapat menerbitkan survei, menerima respons, melihat
                ringkasan, dan mengekspor CSV tanpa layanan modul lain.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3">
                <ActionLink to={ROUTES.respondentIntro("link-umum-demo")}>
                  Buka alur responden mandiri
                </ActionLink>
                <ActionLink to={ROUTES.admin} variant="secondary">
                  Lihat ringkasan operasional
                </ActionLink>
                <ActionLink to={ROUTES.adminAudit} variant="secondary">
                  Lihat log audit
                </ActionLink>
              </div>
            </CardContent>
          </DashCard>

          <SoftCard>
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
            <p className="text-caption text-[color:var(--ad-muted)]">
              Catatan tersimpan di peramban ini untuk referensi tim.
            </p>
          </SoftCard>
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

function RequestRow({
  request,
  onSaved,
}: {
  request: DataRequest;
  onSaved: () => void;
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
    <li className="flex flex-col gap-3 rounded-md border border-[var(--ad-border)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Code>{request.id}</Code>
          <p className="mt-1 text-caption text-[color:var(--ad-muted)]">
            {formatWIB(request.created_at)}
          </p>
        </div>
        <Badge variant="secondary">{REQUEST_LABELS[status]}</Badge>
      </div>
      <dl className="flex flex-col gap-2 text-body-sm">
        <div className="flex flex-wrap gap-x-3">
          <dt className="font-bold text-[color:var(--ad-muted)]">Jenis</dt>
          <dd className="text-[color:var(--ad-text)]">
            {DATA_REQUEST_TYPE_LABEL[request.type] ?? request.type}
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-3">
          <dt className="font-bold text-[color:var(--ad-muted)]">Kontak</dt>
          <dd className="min-w-0 break-words text-[color:var(--ad-text)]">
            {request.contact}
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-3">
          <dt className="font-bold text-[color:var(--ad-muted)]">Keterangan</dt>
          <dd className="min-w-0 break-words text-[color:var(--ad-text)]">
            {request.note ?? "—"}
          </dd>
        </div>
      </dl>
      <form className="flex flex-col gap-3" noValidate onSubmit={save}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={`${fieldId}-status`} label="Status">
            {(aria) => (
              <Select
                {...aria}
                aria-label={`Status permintaan ${request.id}`}
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as DataRequestStatus);
                  setChannelError(null);
                }}
                className="min-h-[44px] w-full"
              >
                {Object.entries(REQUEST_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
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
                  {...aria}
                  aria-label={`Kanal balasan permintaan ${request.id}`}
                  value={channel}
                  onChange={(event) => {
                    setChannel(event.target.value);
                    setChannelError(null);
                  }}
                  className="min-h-[44px] w-full"
                >
                  <option value="">Pilih kanal</option>
                  {channelOptions.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
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
          <ErrorState title="Perubahan belum tersimpan" detail={saveError} />
        )}
        <div>
          <Button
            type="submit"
            variant="secondary"
            loading={busy}
            disabled={busy}
          >
            Simpan
          </Button>
        </div>
      </form>
    </li>
  );
}

export function AdminRequestsPage() {
  const { state } = useScreenState("admin-requests");
  const { dataRequests: rows, dataRequestsError: error } = useStore();

  useEffect(() => {
    void loadDataRequests();
    return cancelDataRequestsLoad;
  }, []);

  return (
    <Shell
      kind="admin"
      title="Permintaan data"
      subtitle="Verifikasi pemohon dan tindak lanjuti akses, koreksi, penarikan, atau penghapusan tanpa membuka jawaban."
    >
      <StateView routeId="admin-requests" state={state}>
        <div className="flex flex-col gap-5">
          <Banner tone="info" title="Verifikasi sebelum tindakan">
            Kontak pada permintaan belum otomatis terverifikasi. Jangan memuat
            jawaban individual di halaman ini; catat hanya status dan ringkasan
            tindakan.
          </Banner>
          <DashCard className="gap-4">
            <CardHeader>
              <CardTitle>Daftar permintaan</CardTitle>
              <CardDescription>
                Catat keputusan dan kanal balasan; setiap simpan tercatat di log
                audit.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
            {error ? (
              <ErrorState
                title="Daftar permintaan gagal dimuat"
                detail={`${error} Antrean tidak ditampilkan sampai data berhasil dimuat.`}
                action={
                  <Button
                    variant="secondary"
                    onClick={() => void loadDataRequests()}
                  >
                    Coba lagi
                  </Button>
                }
              />
            ) : rows === null ? (
              <p role="status" className="text-body-sm text-[color:var(--ad-muted)]">
                Memuat permintaan…
              </p>
            ) : rows.length === 0 ? (
              <p className="text-body-sm text-[color:var(--ad-muted)]">
                Belum ada permintaan data.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {rows.map((request) => (
                  <RequestRow
                    key={request.id}
                    request={request}
                    onSaved={() => void loadDataRequests()}
                  />
                ))}
              </ul>
            )}
            </CardContent>
          </DashCard>
          <div>
            <ActionLink to={ROUTES.admin} variant="secondary">
              Kembali ke ringkasan
            </ActionLink>
          </div>
        </div>
      </StateView>
    </Shell>
  );
}
