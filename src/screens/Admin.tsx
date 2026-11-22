'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Shell } from '../components/Shell';
import {
  ActionLink,
  Badge,
  Banner,
  Button,
  Card,
  Checkbox,
  Code,
  Divider,
  ErrorState,
  Field,
  Label,
  LoadingState,
  Muted,
  Panel,
  PlainLink,
  SectionTitle,
  Table,
  Td,
  TextInput,
  Th,
} from '../components/ui';
import { StateView, SuccessBanner, ValidationSummary } from '../components/StateView';
import { useScreenState } from '../lib/state';
import { ROUTES } from '../lib/routes';
import { accounts, accessGrants, auditLogs, integrationEvents, organizations } from '../lib/fixtures/records';
import { surveys } from '../lib/fixtures/surveys';
import { formatWIB } from '../lib/summary';
import { useToast } from '../components/Toast';
import {
  cancelAdminStatsLoad,
  cancelDataRequestsLoad,
  loadAdminStats,
  loadBootstrap,
  loadDataRequests,
  replayEvent,
  refreshBootstrap,
  saveGrants,
  setIntegrationNote,
  useStore,
} from '../lib/store';
import { adminCreateOrganization, adminSaveAccount, adminSaveGrants, ApiError, updateDataRequest, type DataRequest, type DataRequestStatus } from '../lib/api';
import { ACCOUNT_STATUS_LABEL, DATA_REQUEST_TYPE_LABEL, ORGANIZATION_TYPE_LABEL, ROLE_LABEL } from '../lib/labels';
import type { AuditOutcome, OrganizationType } from '../lib/types';

/* ---------------- Ringkasan ---------------- */

export function AdminSummaryPage() {
  const { state } = useScreenState('admin-summary');
  const { stats, statsError, error } = useStore();
  useEffect(() => {
    void loadAdminStats();
    return cancelAdminStatsLoad;
  }, []);

  const failure = stats ? null : statsError ?? error;
  const retry = () => {
    void (async () => {
      if (error) await loadBootstrap();
      await loadAdminStats();
    })();
  };

  return (
    <Shell kind="admin" title="Ringkasan operasional" subtitle="Pantau jumlah survei, respons, dan akun tanpa membuka jawaban individual.">
      {failure ? (
        <ErrorState
          title="Ringkasan operasional gagal dimuat"
          detail={`${failure} Tidak ada angka yang ditampilkan sampai data berhasil dimuat.`}
          action={<Button variant="secondary" onClick={retry}>Coba lagi</Button>}
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

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <Label>Jumlah survei</Label>
                <p className="mt-2 text-h1 font-bold text-ink">{stats.surveys}</p>
                <Muted>Termasuk draf, terbit, dan arsip.</Muted>
              </Card>
              <Card>
                <Label>Total respons final</Label>
                <p className="mt-2 text-h1 font-bold text-ink">{stats.responses}</p>
                <Muted>Agregat lintas versi.</Muted>
              </Card>
              <Card>
                <Label>Akun pengelola</Label>
                <p className="mt-2 text-h1 font-bold text-ink">{stats.accounts}</p>
                <Muted>Termasuk akun dinonaktifkan.</Muted>
              </Card>
              <Card>
                <Label>Permintaan data menunggu</Label>
                <p className="mt-2 text-h1 font-bold text-ink">{stats.pendingRequests}</p>
                <ActionLink to={ROUTES.adminRequests} variant="ghost" className="mt-2 px-0 text-body-sm underline">Buka permintaan</ActionLink>
              </Card>
            </div>

            <Banner tone="info" title="Tanpa akses jawaban individual">
              Administrator memantau operasional. Akses ke jawaban individual, ekspor, dan teks bebas diberikan terpisah.
              <div className="mt-2"><PlainLink to={ROUTES.adminAccounts}>Kelola izin akun</PlainLink></div>
            </Banner>

            <Card className="flex flex-col gap-3">
              <SectionTitle>Metrik per creator</SectionTitle>
              <Table head={['Creator', 'Survei', 'Respons']}>
                {stats.perCreator.map((creator) => (
                  <tr key={creator.id}>
                    <Th>{creator.display_name}<span className="mt-1 block font-mono text-annotation font-normal tracking-mono text-muted"><Code>{creator.id}</Code></span></Th>
                    <Td>{creator.surveys}</Td>
                    <Td>{creator.responses}</Td>
                  </tr>
                ))}
              </Table>
            </Card>

            <Card className="flex flex-col gap-3">
              <SectionTitle>Metrik per survei</SectionTitle>
              <Table head={['Survei', 'Pemilik', 'Versi', 'Respons']}>
                {stats.perSurvey.map((survey) => (
                  <tr key={survey.id}>
                    <Th>{survey.title}</Th>
                    <Td>{survey.owner}</Td>
                    <Td>{survey.versions}</Td>
                    <Td>{survey.responses}</Td>
                  </tr>
                ))}
              </Table>
            </Card>

            <div className="flex flex-wrap gap-3">
              <ActionLink to={ROUTES.adminAccounts} variant="secondary">Akun dan izin</ActionLink>
              <ActionLink to={ROUTES.adminAudit} variant="secondary">Log audit</ActionLink>
              <ActionLink to={ROUTES.adminIntegration} variant="secondary">Status integrasi</ActionLink>
            </div>
          </div>
        </StateView>
      )}

    </Shell>
  );
}

/* ---------------- Akun dan izin ---------------- */

export function AdminAccountsPage() {
  const { state } = useScreenState('admin-accounts');
  const notify = useToast();
  const { grants: storedGrants, revision, session } = useStore();
  void revision;
  const [accountBusy, setAccountBusy] = useState<string | null>(null);
  const [grants, setGrants] = useState(() =>
    Object.fromEntries(accessGrants.map((g) => [g.id, {
      read: storedGrants[g.id]?.read ?? g.can_read_individual,
      export: storedGrants[g.id]?.export ?? g.can_export,
      text: storedGrants[g.id]?.text ?? g.can_read_free_text,
    }])),
  );
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scopeAccount, setScopeAccount] = useState('');
  const [scopeSurvey, setScopeSurvey] = useState(surveys[0]?.id ?? '');
  const [scopeRead, setScopeRead] = useState(false);
  const [scopeExport, setScopeExport] = useState(false);
  const [scopeText, setScopeText] = useState(false);
  const [scopeBusy, setScopeBusy] = useState(false);
  const [orgForm, setOrgForm] = useState({
    name: '',
    organization_type: 'school' as OrganizationType,
    adminName: '',
    adminEmail: '',
    adminPassword: '',
  });
  const [orgBusy, setOrgBusy] = useState(false);
  const [orgError, setOrgError] = useState<string | null>(null);
  const mutationsBlocked = ['loading', 'validation', 'closed', 'permission-denied'].includes(state);

  useEffect(() => {
    setGrants(Object.fromEntries(accessGrants.map((grant) => [grant.id, {
      read: storedGrants[grant.id]?.read ?? grant.can_read_individual,
      export: storedGrants[grant.id]?.export ?? grant.can_export,
      text: storedGrants[grant.id]?.text ?? grant.can_read_free_text,
    }])));
  }, [revision, storedGrants]);

  const changeRole = (accountId: string, displayName: string, chosen: string) => {
    const role = chosen === 'admin' ? 'super_admin' : chosen;
    setAccountBusy(accountId);
    void adminSaveAccount(accountId, { role })
      .then(() => {
        notify(`Peran ${displayName} diperbarui.`);
        return refreshBootstrap();
      })
      .catch((error: unknown) => notify(error instanceof Error ? error.message : 'Peran gagal diubah.', 'danger'))
      .finally(() => setAccountBusy(null));
  };

  const changeOrganization = (accountId: string, displayName: string, chosen: string) => {
    setAccountBusy(accountId);
    void adminSaveAccount(accountId, { organization_id: chosen === '' ? null : chosen })
      .then(() => {
        notify(`Organisasi ${displayName} diperbarui.`);
        return refreshBootstrap();
      })
      .catch((error: unknown) => notify(error instanceof Error ? error.message : 'Organisasi gagal diubah.', 'danger'))
      .finally(() => setAccountBusy(null));
  };

  const toggleStatus = (accountId: string, displayName: string, current: string) => {
    const status = current === 'active' ? 'suspended' : 'active';
    setAccountBusy(accountId);
    void adminSaveAccount(accountId, { status })
      .then(() => {
        notify(`Status ${displayName} diperbarui.`);
        return refreshBootstrap();
      })
      .catch((error: unknown) => notify(error instanceof Error ? error.message : 'Status gagal diubah.', 'danger'))
      .finally(() => setAccountBusy(null));
  };

  const submitOrganization = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setOrgError(null);
    const name = orgForm.name.trim();
    const displayName = orgForm.adminName.trim().replace(/\s+/g, ' ');
    const email = orgForm.adminEmail.trim().toLowerCase();
    if (!name || !displayName || !email || !orgForm.adminPassword) {
      setOrgError('Nama organisasi, nama admin, email, dan kata sandi awal wajib diisi.');
      return;
    }
    setOrgBusy(true);
    void adminCreateOrganization({
      name,
      organization_type: orgForm.organization_type,
      admin: { display_name: displayName, email, password: orgForm.adminPassword },
    })
      .then((created) => {
        notify(`Organisasi ${created.organization.name} dibuat dengan admin ${created.account.display_name}.`);
        setOrgForm({ name: '', organization_type: 'school', adminName: '', adminEmail: '', adminPassword: '' });
        // Data sudah tersimpan di server; kegagalan menyegarkan snapshot tidak boleh tampil sebagai kegagalan pembuatan.
        void refreshBootstrap().catch(() => undefined);
      })
      .catch((error: unknown) => setOrgError(error instanceof Error ? error.message : 'Organisasi gagal dibuat.'))
      .finally(() => setOrgBusy(false));
  };

  return (
    <Shell kind="admin" title="Akun dan izin" subtitle="Atur siapa yang boleh membaca jawaban, mengunduh data, dan melihat teks bebas.">
      <StateView
        routeId="admin-accounts"
        state={state}
        emptyTitle="Belum ada akun"
        emptyDetail="Tambahkan akun pengelola untuk mulai mengatur izin."
        permissionDetail="Hanya super admin yang dapat mengubah peran dan izin."
      >
        <div className="flex flex-col gap-5">
          
          {state === 'success' && <SuccessBanner title="Izin diperbarui">Perubahan dicatat pada log audit tanpa memuat jawaban atau token.</SuccessBanner>}
          {state === 'validation' && <ValidationSummary items={['Setiap izin harus ditetapkan secara eksplisit.', 'Cakupan survei harus dipilih untuk petugas berizin.']} />}

          <Card className="flex flex-col gap-3">
            <SectionTitle>Daftar akun</SectionTitle>
            <div className="hidden lg:block">
            <Table head={['Akun', 'Peran', 'Organisasi', 'Status', 'Cakupan', 'Aksi']}>
              {accounts.map((a) => (
                <tr key={a.id}>
                  <Th>{a.display_name}<span className="mt-1 block font-mono text-annotation font-normal tracking-mono text-muted"><Code>{a.id}</Code></span></Th>
                  <Td>
                    <select
                      aria-label={`Peran ${a.display_name}`}
                      value={a.role === 'super_admin' ? 'admin' : a.role}
                      disabled={accountBusy === a.id || session?.id === a.id || mutationsBlocked}
                      onChange={(event) => changeRole(a.id, a.display_name, event.target.value)}
                      className="min-h-[44px] rounded-sm border border-control-border bg-n0 px-2 text-body-sm text-ink"
                    >
                      <option value="creator">{ROLE_LABEL.creator}</option>
                      <option value="org_admin">{ROLE_LABEL.org_admin}</option>
                      <option value="admin">{ROLE_LABEL.super_admin}</option>
                    </select>
                  </Td>
                  <Td>
                    <select
                      aria-label={`Organisasi ${a.display_name}`}
                      value={a.organization_id ?? ''}
                      disabled={accountBusy === a.id || session?.id === a.id || mutationsBlocked || a.role === 'super_admin'}
                      onChange={(event) => changeOrganization(a.id, a.display_name, event.target.value)}
                      className="min-h-[44px] max-w-[12rem] rounded-sm border border-control-border bg-n0 px-2 text-body-sm text-ink"
                    >
                      <option value="">Tanpa organisasi</option>
                      {organizations.map((organization) => (
                        <option key={organization.id} value={organization.id}>{organization.name}</option>
                      ))}
                    </select>
                  </Td>
                  <Td><Badge tone={a.status === 'active' ? 'success' : 'neutral'}>{ACCOUNT_STATUS_LABEL[a.status]}</Badge></Td>
                  <Td>{accessGrants.filter((g) => g.account_id === a.id).length} grant</Td>
                  <Td>
                    <Button
                      variant="ghost"
                      loading={accountBusy === a.id}
                      disabled={accountBusy === a.id || session?.id === a.id || mutationsBlocked}
                      onClick={() => toggleStatus(a.id, a.display_name, a.status)}
                    >
                      {a.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'}
                    </Button>
                  </Td>
                </tr>
              ))}
            </Table>
            </div>

            <ul className="flex flex-col gap-3 lg:hidden">
              {accounts.map((a) => (
                <li key={a.id} className="flex flex-col gap-3 rounded-md border border-n200 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-body font-bold text-ink">{a.display_name}</p>
                      <p className="font-mono text-annotation tracking-mono text-muted"><Code>{a.id}</Code></p>
                    </div>
                    <Badge tone={a.status === 'active' ? 'success' : 'neutral'}>{ACCOUNT_STATUS_LABEL[a.status]}</Badge>
                  </div>
                  <label className="flex flex-col gap-1 text-caption font-bold text-muted">
                    Peran
                    <select
                      aria-label={`Peran ${a.display_name}`}
                      value={a.role === 'super_admin' ? 'admin' : a.role}
                      disabled={accountBusy === a.id || session?.id === a.id || mutationsBlocked}
                      onChange={(event) => changeRole(a.id, a.display_name, event.target.value)}
                      className="min-h-[44px] w-full rounded-sm border border-control-border bg-n0 px-2 text-body-sm font-normal text-ink"
                    >
                      <option value="creator">{ROLE_LABEL.creator}</option>
                      <option value="org_admin">{ROLE_LABEL.org_admin}</option>
                      <option value="admin">{ROLE_LABEL.super_admin}</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-caption font-bold text-muted">
                    Organisasi
                    <select
                      aria-label={`Organisasi ${a.display_name}`}
                      value={a.organization_id ?? ''}
                      disabled={accountBusy === a.id || session?.id === a.id || mutationsBlocked || a.role === 'super_admin'}
                      onChange={(event) => changeOrganization(a.id, a.display_name, event.target.value)}
                      className="min-h-[44px] w-full rounded-sm border border-control-border bg-n0 px-2 text-body-sm font-normal text-ink"
                    >
                      <option value="">Tanpa organisasi</option>
                      {organizations.map((organization) => (
                        <option key={organization.id} value={organization.id}>{organization.name}</option>
                      ))}
                    </select>
                  </label>
                  <p className="text-body-sm text-muted">{accessGrants.filter((g) => g.account_id === a.id).length} grant</p>
                  <Button
                    variant="secondary"
                    block
                    loading={accountBusy === a.id}
                    disabled={accountBusy === a.id || session?.id === a.id || mutationsBlocked}
                    onClick={() => toggleStatus(a.id, a.display_name, a.status)}
                  >
                    {a.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'}
                  </Button>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="flex flex-col gap-4">
            <SectionTitle>Organisasi</SectionTitle>
            <p className="text-body-sm text-muted">
              Organisasi baru langsung mendapat admin pertama yang mengatur profil, anggota, dan undangannya.
              Responden dewasa dengan persetujuan diri dipakai sebagai awal; admin organisasi dapat mengubahnya di halaman Organisasi.
            </p>
            <ul className="flex flex-col gap-2">
              {organizations.map((organization) => (
                <li key={organization.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-n200 p-3">
                  <div className="min-w-0">
                    <p className="text-body font-bold text-ink">{organization.name}</p>
                    <p className="mt-1 font-mono text-annotation tracking-mono text-muted"><Code>{organization.id}</Code></p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="neutral">{ORGANIZATION_TYPE_LABEL[organization.organization_type]}</Badge>
                    <span className="text-caption text-muted">
                      {accounts.filter((a) => a.organization_id === organization.id).length} akun
                    </span>
                  </div>
                </li>
              ))}
              {organizations.length === 0 && <li className="text-body-sm text-muted">Belum ada organisasi.</li>}
            </ul>
            <Divider />
            <form className="flex flex-col gap-4" noValidate onSubmit={submitOrganization}>
              <div className="grid gap-4 md:grid-cols-2">
                <Field id="org-new-name" label="Nama organisasi" required>
                  {(aria) => (
                    <TextInput
                      {...aria}
                      value={orgForm.name}
                      onChange={(event) => setOrgForm((current) => ({ ...current, name: event.target.value }))}
                      autoComplete="organization"
                    />
                  )}
                </Field>
                <Field id="org-new-type" label="Tipe organisasi" required>
                  {(aria) => (
                    <select
                      {...aria}
                      value={orgForm.organization_type}
                      onChange={(event) => setOrgForm((current) => ({ ...current, organization_type: event.target.value as OrganizationType }))}
                      className="min-h-[52px] w-full rounded-md border border-control-border bg-n0 px-3 text-body-sm text-ink"
                    >
                      {(['school', 'organization'] as OrganizationType[]).map((value) => (
                        <option key={value} value={value}>{ORGANIZATION_TYPE_LABEL[value]}</option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field id="org-new-admin-name" label="Nama admin pertama" required>
                  {(aria) => (
                    <TextInput
                      {...aria}
                      value={orgForm.adminName}
                      onChange={(event) => setOrgForm((current) => ({ ...current, adminName: event.target.value }))}
                      autoComplete="off"
                    />
                  )}
                </Field>
                <Field id="org-new-admin-email" label="Email admin" required hint="Dipakai untuk masuk pertama kali.">
                  {(aria) => (
                    <TextInput
                      {...aria}
                      type="email"
                      value={orgForm.adminEmail}
                      onChange={(event) => setOrgForm((current) => ({ ...current, adminEmail: event.target.value }))}
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
                    <TextInput
                      {...aria}
                      type="password"
                      value={orgForm.adminPassword}
                      onChange={(event) => setOrgForm((current) => ({ ...current, adminPassword: event.target.value }))}
                      autoComplete="new-password"
                    />
                  )}
                </Field>
              </div>
              {orgError && <Banner tone="danger" title="Tidak dapat membuat organisasi">{orgError}</Banner>}
              <Button type="submit" loading={orgBusy} disabled={orgBusy || mutationsBlocked}>
                Buat organisasi
              </Button>
            </form>
          </Card>

          <Card className="flex flex-col gap-4">
            <SectionTitle>Izin terpisah per grant</SectionTitle>
            {accessGrants.map((g) => {
              const acc = accounts.find((a) => a.id === g.account_id);
              const current = grants[g.id] ?? { read: false, export: false, text: false };
              return (
                <div key={g.id} className="rounded-md border border-n200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-body font-bold text-ink">{acc?.display_name ?? g.account_id}</p>
                    <Badge tone="neutral"><Code>{g.survey_id ?? 'semua'}</Code></Badge>
                  </div>
                  <Divider />
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <Checkbox
                      id={`${g.id}-read`}
                      label="Baca jawaban individual"
                      checked={current.read}
                      onChange={(v) => setGrants((prev) => ({ ...prev, [g.id]: { ...current, read: v } }))}
                    />
                    <Checkbox
                      id={`${g.id}-export`}
                      label="Ekspor data"
                      checked={current.export}
                      onChange={(v) => setGrants((prev) => ({ ...prev, [g.id]: { ...current, export: v } }))}
                    />
                    <Checkbox
                      id={`${g.id}-text`}
                      label="Baca teks bebas"
                      checked={current.text}
                      onChange={(v) => setGrants((prev) => ({ ...prev, [g.id]: { ...current, text: v } }))}
                    />
                  </div>
                </div>
              );
            })}

            <div className="rounded-md border border-dashed border-n200 p-4">
              <SectionTitle>Tambah atau perbarui cakupan</SectionTitle>
              <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
                <label className="flex min-w-0 flex-col gap-1 text-caption font-bold text-muted">
                  Akun
                  <select
                    aria-label="Akun untuk cakupan baru"
                    value={scopeAccount}
                    onChange={(event) => setScopeAccount(event.target.value)}
                    className="min-h-[44px] w-full min-w-0 rounded-sm border border-control-border bg-n0 px-2 text-body-sm font-normal text-ink"
                  >
                    <option value="">Pilih akun</option>
                    {accounts.filter((a) => a.role !== 'super_admin').map((a) => (
                      <option key={a.id} value={a.id}>{a.display_name}</option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-0 flex-col gap-1 text-caption font-bold text-muted">
                  Survei
                  <select
                    aria-label="Survei untuk cakupan baru"
                    value={scopeSurvey}
                    onChange={(event) => setScopeSurvey(event.target.value)}
                    className="min-h-[44px] w-full min-w-0 rounded-sm border border-control-border bg-n0 px-2 text-body-sm font-normal text-ink"
                  >
                    {surveys.map((survey) => (
                      <option key={survey.id} value={survey.id}>{survey.title}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <Checkbox id="scope-read" label="Baca jawaban individual" checked={scopeRead} onChange={setScopeRead} />
                <Checkbox id="scope-export" label="Ekspor data" checked={scopeExport} onChange={setScopeExport} />
                <Checkbox id="scope-text" label="Baca teks bebas" checked={scopeText} onChange={setScopeText} />
              </div>
              <Button
                className="mt-3"
                variant="secondary"
                loading={scopeBusy}
                disabled={scopeBusy || mutationsBlocked || !scopeAccount || !scopeSurvey}
                onClick={() => {
                  const accountId = scopeAccount;
                  const surveyId = scopeSurvey;
                  const rows = accessGrants
                    .filter((grant) => grant.account_id === accountId && grant.survey_id !== surveyId)
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
                      const created = accessGrants.find((grant) => grant.account_id === accountId && grant.survey_id === surveyId);
                      if (created) {
                        setGrants((prev) => ({
                          ...prev,
                          [created.id]: { read: scopeRead, export: scopeExport, text: scopeText },
                        }));
                      }
                      notify('Cakupan izin berhasil disimpan.');
                    })
                    .catch((error: unknown) => notify(error instanceof Error ? error.message : 'Cakupan gagal disimpan.', 'danger'))
                    .finally(() => setScopeBusy(false));
                }}
              >
                Simpan cakupan
              </Button>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => {
                setBusy(true);
                void saveGrants(grants)
                  .then(() => {
                    setSaved(true);
                    notify('Izin akun berhasil disimpan.');
                  })
                  .catch((error: unknown) => notify(error instanceof Error ? error.message : 'Izin gagal disimpan.', 'danger'))
                  .finally(() => setBusy(false));
              }} disabled={state === 'loading' || state === 'validation' || state === 'closed' || busy} loading={busy}>Simpan izin</Button>
              <ActionLink to={ROUTES.adminAudit} variant="secondary">Lihat log perubahan izin</ActionLink>
            </div>
            {saved && <Banner tone="success" title="Izin tersimpan">Perubahan berlaku pada workspace ini.</Banner>}
          </Card>

          <Panel>
            <SectionTitle>Teks bebas</SectionTitle>
            <p className="mt-2 text-body-sm text-muted">
              Teks bebas dapat memuat identitas yang ditulis responden. Batasi dan periksa sebelum dibagikan; hanya penerima berizin yang boleh membacanya.
            </p>
          </Panel>
        </div>
      </StateView>
      
    </Shell>
  );
}

/* ---------------- Log audit ---------------- */

const AUDIT_OUTCOME_TONE: Record<AuditOutcome, 'success' | 'danger' | 'warning' | 'info'> = {
  berhasil: 'success',
  ditolak: 'danger',
  gagal: 'warning',
  dimulai: 'info',
};

export function AdminAuditPage() {
  const { state } = useScreenState('admin-audit');
  useEffect(() => {
    void refreshBootstrap();
  }, []);
  return (
    <Shell kind="admin" title="Log audit" subtitle="Catatan aktivitas memuat aktor, aksi, objek, hasil, dan waktu tanpa isi jawaban.">
      <StateView
        routeId="admin-audit"
        state={state}
        emptyTitle="Belum ada entri audit"
        emptyDetail="Entri muncul setelah publikasi, perubahan izin, akses individual, atau ekspor."
        permissionDetail="Log operasional hanya dapat dibaca sesuai tugas."
      >
        <div className="flex flex-col gap-5">
          
          <Banner tone="info" title="Catatan aktivitas">
            Kolom dibatasi pada informasi operasional. Log tidak memuat token, kredensial, atau jawaban.
          </Banner>
          <Card className="flex flex-col gap-3">
            <SectionTitle>Entri operasional</SectionTitle>
            <Table head={['Waktu (WIB)', 'Aktor', 'Aksi', 'Objek', 'Hasil']}>
              {auditLogs.map((log) => (
                <tr key={log.id}>
                  <Td>{formatWIB(log.at)}</Td>
                  <Td className="font-bold">{log.actor}</Td>
                  <Td>{log.action}</Td>
                  <Td><Code>{log.object}</Code></Td>
                  <Td>
                    <Badge tone={AUDIT_OUTCOME_TONE[log.outcome]}>
                      {log.outcome}
                    </Badge>
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>
          <Panel>
            <SectionTitle>Cakupan pencatatan</SectionTitle>
            <ul className="mt-2 flex list-inside list-disc flex-col gap-1 text-body-sm text-muted">
              <li>Perubahan izin dan status.</li>
              <li>Akses jawaban individual dan penolakan akses.</li>
              <li>Publikasi, penutupan, dan ekspor beserta penerima.</li>
              <li>Event integrasi dicatat dengan ID kejadian yang tetap.</li>
            </ul>
          </Panel>
          <div className="flex flex-wrap gap-3">
            <ActionLink to={ROUTES.adminIntegration} variant="secondary">Lihat event integrasi</ActionLink>
            <ActionLink to={ROUTES.admin} variant="secondary">Kembali ke ringkasan</ActionLink>
          </div>
        </div>
      </StateView>
      
    </Shell>
  );
}

/* ---------------- Integrasi ---------------- */

export function AdminIntegrationPage() {
  const { state } = useScreenState('admin-integration');
  const notify = useToast();
  const { revision, integrationNote } = useStore();
  void revision;
  const [replayed, setReplayed] = useState<string | null>(null);
  const [busyEvent, setBusyEvent] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const down = state === 'error';

  return (
    <Shell kind="admin" title="Status integrasi" subtitle="Pantau status pertukaran data dengan layanan identitas dan konsumen analitik.">
      <StateView
        routeId="admin-integration"
        state={state}
        permissionDetail="Status integrasi hanya untuk peran yang berwenang."
        conflictTo={ROUTES.adminAudit}
        errorTitle="Layanan Modul 13/15 terputus"
        errorDetail="Alur mandiri tetap berjalan meski layanan integrasi sedang terganggu."
      >
        <div className="flex flex-col gap-5">
          
          {state === 'success' && <SuccessBanner title="Event berhasil diulang">ID kejadian tetap dipakai dan tidak membuat respons kedua.</SuccessBanner>}
          {down && (
            <Banner tone="danger" title="Layanan terputus">
              Alur mandiri tetap berjalan tanpa Modul 13/15. Status pengiriman dapat diulang setelah layanan kembali.
            </Banner>
          )}
          {retryError && <Banner tone="danger" title="Pengulangan tidak membuktikan pengiriman">{retryError}</Banner>}
          <Banner tone="info" title="Simulasi integrasi lokal">
            Tidak ada pengiriman jaringan nyata pada MVP lokal ini. Event dan status di bawah adalah simulasi yang dibuat saat respons tersimpan.
          </Banner>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <SectionTitle>Modul 13 · identitas</SectionTitle>
                <Badge tone={down ? 'danger' : 'success'}>{down ? 'Terputus' : 'Simulasi aktif'}</Badge>
              </div>
              <p className="mt-2 text-body-sm text-muted">
                Memberi identitas dan penugasan terverifikasi serta menerima status pengiriman. Endpoint dan autentikasi nyata masih perlu disepakati.
              </p>
              <ul className="mt-3 flex list-inside list-disc flex-col gap-1 text-body-sm text-ink">
                <li>ID lokal dan kode individual dipakai selama daftar peserta belum tersedia.</li>
                <li>Bedakan LMS mencatat tautan dibuka dan Modul 14 mencatat jawaban tersimpan.</li>
                <li>Jangan membuat identitas kedua otomatis.</li>
              </ul>
            </Card>
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <SectionTitle>Modul 15 · konsumen data</SectionTitle>
                <Badge tone={down ? 'danger' : 'success'}>{down ? 'Terputus' : 'Simulasi aktif'}</Badge>
              </div>
              <p className="mt-2 text-body-sm text-muted">
                CSV adalah jalur keluaran wajib MVP. API adalah jalur integrasi yang didukung rancangan; format final masih terbuka.
              </p>
              <ul className="mt-3 flex list-inside list-disc flex-col gap-1 text-body-sm text-ink">
                <li>Filter cakupan dan kolom, catat penerima.</li>
                <li><Code>schema_version</Code>, versi survei, kode item, nilai atau teks sesuai izin.</li>
                <li><Code>collection_mode</Code>: standalone/integrated; <Code>identity_source</Code>: local/module_13.</li>
              </ul>
            </Card>
          </div>

          <Card className="flex flex-col gap-3">
            <SectionTitle>Event integrasi (simulasi)</SectionTitle>
            <Table head={['ID kejadian', 'Tipe', 'Tujuan', 'Status', 'Percobaan', 'Aksi']}>
              {integrationEvents.map((e) => (
                <tr key={e.id}>
                  <Th><Code>{e.event_id}</Code><span className="mt-1 block"><Badge tone="neutral">{e.simulated ? 'Simulasi' : 'Nyata'}</Badge></span></Th>
                  <Td>{e.type}</Td>
                  <Td><Code>{e.target}</Code></Td>
                  <Td>
                    <Badge tone={e.status === 'delivered' ? 'success' : e.status === 'pending' ? 'warning' : 'danger'}>
                      {e.status === 'delivered' ? 'Terkirim' : e.status === 'pending' ? 'Menunggu' : 'Gagal'}
                    </Badge>
                  </Td>
                  <Td>{e.attempts}</Td>
                  <Td>
                    <button
                      type="button"
                      onClick={() => {
                        setBusyEvent(e.id);
                        setRetryError(null);
                        void replayEvent(e.id)
                          .then(() => {
                            setReplayed(e.id);
                            notify(`Event ${e.event_id} diulang dengan ID yang sama.`);
                          })
                          .catch((error: unknown) => {
                            const message = error instanceof Error ? error.message : 'Event gagal diulang.';
                            setRetryError(message);
                            notify(message, 'danger');
                          })
                          .finally(() => setBusyEvent(null));
                      }}
                      disabled={state === 'loading' || busyEvent === e.id}
                      className="min-h-[32px] rounded-sm border border-n200 bg-n0 px-2 text-caption font-bold text-action hover:bg-action-soft disabled:text-n400"
                    >
                      {busyEvent === e.id ? 'Mengulang…' : replayed === e.id ? 'Diulang' : 'Ulangi event'}
                    </button>
                  </Td>
                </tr>
              ))}
            </Table>
            <p className="text-caption text-muted">
              Event selesai hanya untuk respons tersimpan. ID kejadian tetap dipakai saat percobaan ulang.
            </p>
          </Card>

          <Card className="flex flex-col gap-3">
            <SectionTitle>Mode mandiri</SectionTitle>
            <p className="text-body-sm text-muted">
              Creator tetap dapat menerbitkan survei, menerima respons, melihat ringkasan, dan mengekspor CSV tanpa layanan modul lain.
            </p>
            <div className="flex flex-wrap gap-3">
              <ActionLink to={ROUTES.respondentIntro('link-umum-demo')}>Buka alur responden mandiri</ActionLink>
              <ActionLink to={ROUTES.admin} variant="secondary">Lihat ringkasan operasional</ActionLink>
              <ActionLink to={ROUTES.adminAudit} variant="secondary">Lihat log audit</ActionLink>
            </div>
          </Card>

          <Panel>
            <Label>Kontak kontrak</Label>
            <div className="mt-2">
              <TextInput aria-label="Catatan kontrak" placeholder="Catatan untuk tim integrasi" value={integrationNote} onChange={(e) => setIntegrationNote(e.target.value)} />
            </div>
            <p className="mt-2 text-caption text-muted">Catatan tersimpan di peramban ini untuk referensi tim.</p>
          </Panel>
        </div>
      </StateView>
      
    </Shell>
  );
}


/* ---------------- Permintaan data ---------------- */

const REQUEST_LABELS: Record<DataRequestStatus, string> = {
  pending: 'Menunggu',
  in_progress: 'Diproses',
  handled: 'Selesai',
  rejected: 'Ditolak',
};

/** Kanal yang dipakai pengelola untuk membalas pemohon; server mencatatnya sebagai jejak balasan `response_channel`. */
const RESPONSE_CHANNEL_LABELS: Record<string, string> = {
  email: 'Email',
  phone: 'Telepon',
  messaging: 'Pesan singkat (SMS/WhatsApp)',
  letter: 'Surat',
  in_person: 'Tatap muka',
};

const CHANNEL_REQUIRED = 'Pilih kanal yang dipakai untuk membalas pemohon. Kanal ini dicatat sebagai bukti bahwa permintaan sudah dibalas.';

function RequestRow({ request, onSaved }: { request: DataRequest; onSaved: () => void }) {
  const [status, setStatus] = useState<DataRequestStatus>(request.status);
  const [note, setNote] = useState(request.outcome_note ?? '');
  const [channel, setChannel] = useState(request.response_channel ?? '');
  const [channelError, setChannelError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const notify = useToast();
  const fieldId = `request-${request.id}`;
  const channelId = `${fieldId}-channel`;
  // Kanal tersimpan di luar daftar (mis. teks bebas lewat API) tetap dapat dipilih agar simpan ulang tidak menggantinya.
  const storedChannel = request.response_channel;
  const channelOptions = storedChannel && !Object.hasOwn(RESPONSE_CHANNEL_LABELS, storedChannel)
    ? [[storedChannel, storedChannel], ...Object.entries(RESPONSE_CHANNEL_LABELS)]
    : Object.entries(RESPONSE_CHANNEL_LABELS);

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaveError(null);
    setChannelError(null);
    if (status === 'handled' && !channel) {
      setChannelError(CHANNEL_REQUIRED);
      document.getElementById(channelId)?.focus();
      return;
    }
    const outcomeNote = note.trim();
    setBusy(true);
    void updateDataRequest(
      request.id,
      status === 'handled' ? { status, outcome_note: outcomeNote, response_channel: channel } : { status, outcome_note: outcomeNote },
    )
      .then(() => {
        notify('Permintaan data diperbarui. Log audit mencatat tindakan ini.');
        onSaved();
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.code === 'response_evidence_required') {
          setChannelError(CHANNEL_REQUIRED);
          document.getElementById(channelId)?.focus();
          return;
        }
        setSaveError(error instanceof Error ? error.message : 'Permintaan data gagal diperbarui.');
      })
      .finally(() => setBusy(false));
  };

  return (
    <li className="flex flex-col gap-3 rounded-md border border-n200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Code>{request.id}</Code>
          <p className="mt-1 text-caption text-muted">{formatWIB(request.created_at)}</p>
        </div>
        <Badge tone="neutral">{REQUEST_LABELS[status]}</Badge>
      </div>
      <dl className="flex flex-col gap-2 text-body-sm">
        <div className="flex flex-wrap gap-x-3">
          <dt className="font-bold text-muted">Jenis</dt>
          <dd className="text-ink">{DATA_REQUEST_TYPE_LABEL[request.type] ?? request.type}</dd>
        </div>
        <div className="flex flex-wrap gap-x-3">
          <dt className="font-bold text-muted">Kontak</dt>
          <dd className="min-w-0 break-words text-ink">{request.contact}</dd>
        </div>
        <div className="flex flex-wrap gap-x-3">
          <dt className="font-bold text-muted">Keterangan</dt>
          <dd className="min-w-0 break-words text-ink">{request.note ?? '—'}</dd>
        </div>
      </dl>
      <form className="flex flex-col gap-3" noValidate onSubmit={save}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={`${fieldId}-status`} label="Status">
            {(aria) => (
              <select
                {...aria}
                aria-label={`Status permintaan ${request.id}`}
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as DataRequestStatus);
                  setChannelError(null);
                }}
                className="min-h-[52px] w-full rounded-md border border-control-border bg-n0 px-3 text-body-sm text-ink"
              >
                {Object.entries(REQUEST_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            )}
          </Field>
          {status === 'handled' && (
            <Field
              id={channelId}
              label="Kanal balasan"
              required
              hint="Cara Anda membalas pemohon."
              error={channelError ?? undefined}
            >
              {(aria) => (
                <select
                  {...aria}
                  aria-label={`Kanal balasan permintaan ${request.id}`}
                  value={channel}
                  onChange={(event) => {
                    setChannel(event.target.value);
                    setChannelError(null);
                  }}
                  className="min-h-[52px] w-full rounded-md border border-control-border bg-n0 px-3 text-body-sm text-ink aria-invalid:border-2 aria-invalid:border-danger"
                >
                  <option value="">Pilih kanal</option>
                  {channelOptions.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              )}
            </Field>
          )}
          <div className="sm:col-span-2">
            <Field id={`${fieldId}-note`} label="Catatan hasil">
              {(aria) => (
                <TextInput
                  {...aria}
                  aria-label={`Catatan hasil permintaan ${request.id}`}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              )}
            </Field>
          </div>
        </div>
        {saveError && <ErrorState title="Perubahan belum tersimpan" detail={saveError} />}
        <div>
          <Button type="submit" variant="secondary" loading={busy} disabled={busy}>
            Simpan
          </Button>
        </div>
      </form>
    </li>
  );
}

export function AdminRequestsPage() {
  const { state } = useScreenState('admin-requests');
  const { dataRequests: rows, dataRequestsError: error } = useStore();

  useEffect(() => {
    void loadDataRequests();
    return cancelDataRequestsLoad;
  }, []);

  return (
    <Shell kind="admin" title="Permintaan data" subtitle="Verifikasi pemohon dan tindak lanjuti akses, koreksi, penarikan, atau penghapusan tanpa membuka jawaban.">
      <StateView routeId="admin-requests" state={state}>
        <div className="flex flex-col gap-5">
          <Banner tone="info" title="Verifikasi sebelum tindakan">
            Kontak pada permintaan belum otomatis terverifikasi. Jangan memuat jawaban individual di halaman ini; catat hanya status dan ringkasan tindakan.
          </Banner>
          <Card className="flex flex-col gap-3">
            <SectionTitle>Daftar permintaan</SectionTitle>
            {error ? (
              <ErrorState
                title="Daftar permintaan gagal dimuat"
                detail={`${error} Antrean tidak ditampilkan sampai data berhasil dimuat.`}
                action={<Button variant="secondary" onClick={() => void loadDataRequests()}>Coba lagi</Button>}
              />
            ) : rows === null ? (
              <p role="status" className="text-body-sm text-muted">Memuat permintaan…</p>
            ) : rows.length === 0 ? (
              <p className="text-body-sm text-muted">Belum ada permintaan data.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {rows.map((request) => (
                  <RequestRow key={request.id} request={request} onSaved={() => void loadDataRequests()} />
                ))}
              </ul>
            )}
          </Card>
          <ActionLink to={ROUTES.admin} variant="secondary">Kembali ke ringkasan</ActionLink>
        </div>
      </StateView>
    </Shell>
  );
}
