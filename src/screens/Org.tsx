'use client';

import { useEffect, useState } from 'react';
import { Shell } from '../components/Shell';
import { Code } from '../components/ui';
import { BusyButton } from '../components/BusyButton';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { Badge } from '../components/ui/badge';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card';
import { CheckboxField } from '../components/ui/checkbox';
import { DataTable } from '../components/data-table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Field } from '../components/ui/field';
import { Input } from '../components/ui/input';
import { Skeleton } from '../components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Check } from 'runeicons-react/icons/Check';
import { Copy } from 'runeicons-react/icons/Copy';
import { UserMinus } from 'runeicons-react/icons/UserMinus';
import { UserPlus } from 'runeicons-react/icons/UserPlus';
import { X } from 'runeicons-react/icons/X';
import { withIconClass } from '../components/rune-icon';
import { StateView, SuccessBanner, ValidationSummary } from '../components/StateView';
import { useScreenState } from '../lib/state';
import { useToast } from '../components/Toast';
import {
  ApiError,
  inviteOrgMember,
  revokeOrgInvitation,
  saveOrgProfile,
  setOrgMemberStatus,
  type OrgProfileInput,
} from '../lib/api';
import {
  ACCOUNT_STATUS_LABEL,
  INVITATION_STATUS_LABEL,
  INVITATION_STATUS_TONE,
  ORGANIZATION_TYPE_LABEL,
  ORGANIZATION_TYPES,
  ROLE_LABEL,
} from '../lib/labels';
import { cancelOrgWorkspaceLoad, loadOrgWorkspace, useStore } from '../lib/store';
import { AuditActor } from './Admin';
import { formatWIB } from '../lib/summary';
import { cn } from '../lib/utils';
import type { ColumnDef } from '@tanstack/react-table';
import type { OrgAuditRow, OrgInvitation, OrgMember, OrgProfile, OrganizationType } from '../lib/types';

const SuspendedMemberIcon = withIconClass(UserMinus);
const ActivatedMemberIcon = withIconClass(UserPlus);
const CopyIcon = withIconClass(Copy);
const CheckIcon = withIconClass(Check);
const XIcon = withIconClass(X);

/** Pesan field per kode validasi server (PRD §1.2). */
const FIELD_FOR_CODE: Record<string, 'organization_name' | 'organization_type' | 'policy_url' | 'terms_url' | 'retention_days' | 'cross_border_transfer' | 'data_request_contact' | 'notice_version'> = {
  validation_error: 'organization_name',
  notice_version_unavailable: 'notice_version',
};

interface FormState {
  organization_name: string;
  organization_type: OrganizationType;
  policy_url: string;
  terms_url: string;
  retention_days: string;
  data_request_contact: string;
  cross_border_transfer: boolean;
  notice_version: string;
}

function formFrom(profile: OrgProfile): FormState {
  return {
    organization_name: profile.organization_name,
    organization_type: profile.organization_type,
    policy_url: profile.policy_url,
    terms_url: profile.terms_url,
    retention_days: profile.retention_days === null ? '' : String(profile.retention_days),
    data_request_contact: profile.data_request_contact ?? '',
    cross_border_transfer: profile.cross_border_transfer === 1,
    notice_version: profile.notice_version,
  };
}

/** notice_version hanya dikirim bila berubah: versi terpasang yang tidak berubah tidak perlu divalidasi ulang katalog. */
function payloadFrom(form: FormState, profile: OrgProfile): OrgProfileInput {
  const retention = form.retention_days.trim();
  const payload: OrgProfileInput = {
    organization_name: form.organization_name.trim(),
    organization_type: form.organization_type,
    policy_url: form.policy_url.trim(),
    terms_url: form.terms_url.trim(),
    retention_days: retention === '' ? null : Number(retention),
    data_request_contact: form.data_request_contact.trim() || null,
    cross_border_transfer: form.cross_border_transfer,
  };
  if (form.notice_version !== profile.notice_version) payload.notice_version = form.notice_version;
  return payload;
}

/** Cermin aturan server (BF-06): batas baru selalu lebih pendek bila sebelumnya tanpa batas. */
function isRetentionShrink(current: number | null, next: number | null): boolean {
  return next !== null && (current === null || next < current);
}

function retentionLabel(days: number | null): string {
  return days === null ? 'tanpa batas' : `${days} hari`;
}

function memberColumns(toggle: (member: OrgMember) => void, busyId: string | null): ColumnDef<OrgMember>[] {
  return [
    {
      accessorKey: 'display_name',
      header: 'Nama',
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="font-bold text-foreground">{row.original.display_name}</p>
          <p className="font-mono text-annotation tracking-mono text-muted-foreground">
            <Code>{row.original.id}</Code>
          </p>
        </div>
      ),
    },
    { accessorKey: 'email', header: 'Email' },
    {
      id: 'role',
      header: 'Peran',
      enableSorting: false,
      cell: ({ row }) => ROLE_LABEL[row.original.role],
    },
    {
      id: 'status',
      header: 'Status',
      enableSorting: false,
      cell: ({ row }) => {
        const member = row.original;
        return (
          <Badge
            variant={member.status === 'active' ? 'success' : 'secondary'}
            className="gap-1.5"
            title={ACCOUNT_STATUS_LABEL[member.status]}
          >
            <span
              aria-hidden="true"
              className={cn(
                'size-1.5 rounded-full',
                member.status === 'active' ? 'bg-emerald-600' : 'bg-muted-foreground',
              )}
            />
            {member.status === 'active' ? (
              ACCOUNT_STATUS_LABEL[member.status]
            ) : (
              <>
                <SuspendedMemberIcon className="size-3" />
                <span className="sr-only">{ACCOUNT_STATUS_LABEL[member.status]}</span>
              </>
            )}
          </Badge>
        );
      },
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      enableHiding: false,
      /** Aksi tetap terjangkau saat tabel bergulir horizontal di layar sempit. */
      meta: { className: 'sticky right-0 z-10 border-l border-border bg-card sm:static sm:border-l-0' },
      cell: ({ row }) => {
        const member = row.original;
        return (
          <div className="flex justify-end">
            <BusyButton
              variant="ghost"
              size="icon"
              className={
                member.status === 'active'
                  ? 'text-destructive hover:bg-destructive/10 hover:text-destructive'
                  : 'text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800'
              }
              aria-label={`${member.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'} ${member.display_name}`}
              title={`${member.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'} ${member.display_name}`}
              loading={busyId === member.id}
              disabled={member.role !== 'creator' || busyId === member.id}
              onClick={() => toggle(member)}
            >
              {member.status === 'active' ? (
                <SuspendedMemberIcon className="size-4" />
              ) : (
                <ActivatedMemberIcon className="size-4" />
              )}
            </BusyButton>
          </div>
        );
      },
    },
  ];
}

function invitationColumns(
  copyCode: (code: string) => void,
  askRevoke: (row: OrgInvitation) => void,
  busy: boolean,
): ColumnDef<OrgInvitation>[] {
  return [
    {
      accessorKey: 'code',
      header: 'Kode',
      enableSorting: false,
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-1 font-mono tracking-mono">
          <Code>{row.original.code}</Code>
          {row.original.status === 'active' && (
            <BusyButton
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={`Salin kode undangan ${row.original.code}`}
              title="Salin kode"
              onClick={() => copyCode(row.original.code)}
            >
              <CopyIcon className="size-3.5" />
            </BusyButton>
          )}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      enableSorting: false,
      cell: ({ row }) => (
        <Badge variant={INVITATION_STATUS_TONE[row.original.status]}>
          {INVITATION_STATUS_LABEL[row.original.status]}
        </Badge>
      ),
    },
    {
      accessorKey: 'created_at',
      header: 'Dibuat',
      cell: ({ row }) => formatWIB(row.original.created_at),
    },
    {
      accessorKey: 'expires_at',
      header: 'Kedaluwarsa',
      cell: ({ row }) => formatWIB(row.original.expires_at),
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      enableHiding: false,
      meta: { className: 'sticky right-0 z-10 border-l border-border bg-card sm:static sm:border-l-0' },
      cell: ({ row }) =>
        row.original.status === 'active' ? (
          <div className="flex justify-end">
            <BusyButton
              variant="ghost"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={busy}
              onClick={() => askRevoke(row.original)}
            >
              Cabut
            </BusyButton>
          </div>
        ) : (
          <span className="block text-end text-caption text-muted-foreground">—</span>
        ),
    },
  ];
}

function auditColumns(names: Map<string, string>): ColumnDef<OrgAuditRow>[] {
  return [
    {
      accessorKey: 'at',
      header: 'Waktu',
      cell: ({ row }) => formatWIB(row.original.at),
    },
    {
      id: 'actor',
      header: 'Aktor',
      enableSorting: false,
      cell: ({ row }) => <AuditActor actor={row.original.actor} names={names} />,
    },
    {
      accessorKey: 'action',
      header: 'Tindakan',
    },
    {
      accessorKey: 'object',
      header: 'Objek',
      enableSorting: false,
      cell: ({ row }) => (
        <span className="font-mono tracking-mono">
          <Code>{row.original.object}</Code>
        </span>
      ),
    },
    {
      accessorKey: 'outcome',
      header: 'Hasil',
      enableSorting: false,
    },
  ];
}

export function AdminOrgPage() {
  const notify = useToast();
  const { state } = useScreenState('admin-org');
  const { org, orgError } = useStore();
  const profile = org?.profile ?? null;
  const [draft, setDraft] = useState<FormState | null>(null);
  // Formulir mengikuti profil server sampai pengguna mengubahnya.
  const form = draft ?? (profile ? formFrom(profile) : null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [memberBusy, setMemberBusy] = useState<string | null>(null);
  const [invitationBusy, setInvitationBusy] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<OrgInvitation | null>(null);
  const [shrinkPayload, setShrinkPayload] = useState<OrgProfileInput | null>(null);
  const [freshInvitation, setFreshInvitation] = useState<OrgInvitation | null>(null);

  useEffect(() => {
    // Muat sekali saat halaman dibuka; aksi pengguna memuat ulang secara eksplisit.
    void loadOrgWorkspace();
    return cancelOrgWorkspaceLoad;
  }, []);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setDraft((current) => {
      const base = current ?? (profile ? formFrom(profile) : null);
      return base ? { ...base, [key]: value } : base;
    });
    setFieldErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key as string];
      return next;
    });
    setSaved(false);
  };

  const performSave = (payload: OrgProfileInput, confirmShrink = false) => {
    setBusy(true);
    setFieldErrors({});
    setSaved(false);
    const body = confirmShrink ? { ...payload, confirm_retention_shrink: true } : payload;
    void saveOrgProfile(body)
      .then((result) => {
        setDraft(formFrom(result.profile));
        setSaved(true);
        setShrinkPayload(null);
        notify('Profil organisasi disimpan.');
        return loadOrgWorkspace();
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.code === 'retention_shrink_confirmation_required') {
          // Server tetap meminta konfirmasi (mis. profil berubah di sesi lain): buka dialog yang sama.
          setShrinkPayload(payload);
          return;
        }
        if (error instanceof ApiError && error.code) {
          // Tampilkan di dekat field, bukan hanya toast.
          setFieldErrors({ [FIELD_FOR_CODE[error.code] ?? 'organization_name']: error.message });
        }
        notify(error instanceof Error ? error.message : 'Profil gagal disimpan.', 'danger');
      })
      .finally(() => setBusy(false));
  };

  const onSave = () => {
    if (!form || !profile) return;
    const payload = payloadFrom(form, profile);
    const nextRetention = payload.retention_days === undefined ? profile.retention_days : payload.retention_days;
    // BF-06: memperpendek masa simpan menghapus data lama pada run retensi berikutnya, jadi
    // konfirmasi destruktif dimuka; server tetap menjadi penjaga terakhir lewat confirm_retention_shrink.
    if (isRetentionShrink(profile.retention_days, nextRetention ?? null)) {
      setShrinkPayload(payload);
      return;
    }
    performSave(payload);
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      notify('Kode undangan disalin ke papan klip.');
    } catch {
      notify(`Salin kode undangan: ${code}`, 'info');
    }
  };

  const toggleMember = (member: OrgMember) => {
    const status = member.status === 'active' ? 'suspended' : 'active';
    setMemberBusy(member.id);
    void setOrgMemberStatus(member.id, status)
      .then((updated) => {
        notify(`Status ${updated.display_name} diperbarui.`);
        return loadOrgWorkspace();
      })
      .catch((error: unknown) => notify(error instanceof Error ? error.message : 'Status gagal diubah.', 'danger'))
      .finally(() => setMemberBusy(null));
  };

  const createInvitation = () => {
    setInvitationBusy(true);
    void inviteOrgMember()
      .then((invitation) => {
        setFreshInvitation(invitation);
        notify('Kode undangan organisasi dibuat.');
        return loadOrgWorkspace();
      })
      .catch((error: unknown) => notify(error instanceof Error ? error.message : 'Undangan gagal dibuat.', 'danger'))
      .finally(() => setInvitationBusy(false));
  };

  const revokeInvitation = () => {
    const target = revokeTarget;
    if (!target) return;
    setRevokeTarget(null);
    setInvitationBusy(true);
    void revokeOrgInvitation(target.id)
      .then(() => {
        notify('Kode undangan dicabut.');
        return loadOrgWorkspace();
      })
      .catch((error: unknown) => notify(error instanceof Error ? error.message : 'Undangan gagal dicabut.', 'danger'))
      .finally(() => setInvitationBusy(false));
  };

  // Galat, memuat, dan data saling eksklusif: kegagalan tidak boleh tampil sebagai organisasi kosong.
  if (orgError || !org) {
    return (
      <Shell kind="admin" title="Organisasi" subtitle="Profil kebijakan, anggota, undangan, dan audit lingkup organisasi Anda.">
        {orgError ? (
          <Alert variant="destructive" className="flex flex-col items-start gap-3">
            <AlertTitle>Data organisasi gagal dimuat</AlertTitle>
            <AlertDescription className="text-body-sm">
              <p>
                {orgError} Profil, anggota, undangan, dan log audit tidak ditampilkan sampai data
                berhasil dimuat.
              </p>
              <BusyButton
                variant="outline"
                className="mt-3"
                onClick={() => void loadOrgWorkspace()}
              >
                Coba lagi
              </BusyButton>
            </AlertDescription>
          </Alert>
        ) : (
          <div aria-busy="true" aria-live="polite" className="flex flex-col gap-3">
            <p className="text-body-sm text-muted-foreground">Memuat data organisasi…</p>
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-20 w-full rounded-xl" />
            ))}
          </div>
        )}
      </Shell>
    );
  }
  const { members, invitations, audit, notices, invitationTtlDays } = org;
  const memberNames = new Map(members.map((member) => [member.id, member.display_name]));
  // Versi terpasang yang tidak ada di katalog tetap dapat dipilih agar pemilih tidak kosong;
  // server menolak versi di luar katalog saat penyimpanan.
  const noticeVersions = notices.some((row) => row.version === profile?.notice_version) || !profile
    ? notices
    : [...notices, { version: profile.notice_version, effective_date: '' }];

  return (
    <Shell kind="admin" title="Organisasi" subtitle="Profil kebijakan, anggota, undangan, dan audit lingkup organisasi Anda.">
      <StateView
        routeId="admin-org"
        state={state}
        permissionDetail="Halaman ini hanya tersedia untuk admin organisasi."
      >
        <div className="flex flex-col gap-5">
          {state === 'success' && <SuccessBanner title="Profil tersimpan">Profil organisasi diperbarui.</SuccessBanner>}
          {state === 'validation' && <ValidationSummary items={['Nama organisasi tidak boleh kosong.', 'URL kebijakan privasi tidak boleh kosong.']} />}

          <Card>
            <CardHeader>
              <CardTitle>Profil organisasi</CardTitle>
              <CardDescription>
                Data ini tampil pada halaman survei dan dipakai saat responden meminta akses atau
                penghapusan data.
              </CardDescription>
              {profile && (
                <CardAction>
                  <span className="text-caption text-muted-foreground">
                    Kode organisasi: <Code>{profile.id}</Code>
                  </span>
                </CardAction>
              )}
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {saved && (
                <p role="status" className="text-body-sm font-bold text-emerald-700">
                  Tersimpan.
                </p>
              )}
              {form ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <Field id="org-name" label="Nama organisasi" required error={fieldErrors.organization_name}>
                    {(aria) => (
                      <Input
                        {...aria}
                        value={form.organization_name}
                        onChange={(event) => setField('organization_name', event.target.value)}
                      />
                    )}
                  </Field>
                  <Field id="org-type" label="Tipe organisasi" required error={fieldErrors.organization_type}>
                    {(aria) => (
                      <Select
                        value={form.organization_type}
                        onValueChange={(value) => setField('organization_type', value as OrganizationType)}
                      >
                        <SelectTrigger {...aria} aria-label="Tipe organisasi" className="h-11 w-full">
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
                  <Field id="org-policy" label="URL kebijakan privasi" required error={fieldErrors.policy_url}>
                    {(aria) => (
                      <Input
                        {...aria}
                        value={form.policy_url}
                        onChange={(event) => setField('policy_url', event.target.value)}
                      />
                    )}
                  </Field>
                  <Field id="org-terms" label="URL ketentuan layanan" required error={fieldErrors.terms_url}>
                    {(aria) => (
                      <Input
                        {...aria}
                        value={form.terms_url}
                        onChange={(event) => setField('terms_url', event.target.value)}
                      />
                    )}
                  </Field>
                  <Field
                    id="org-retention"
                    label="Masa retensi (hari)"
                    hint="Kosongkan bila masih menunggu keputusan pengendali. Memperpendek masa simpan menghapus data yang lebih tua pada run retensi berikutnya dan meminta konfirmasi."
                    error={fieldErrors.retention_days}
                  >
                    {(aria) => (
                      <Input
                        {...aria}
                        inputMode="numeric"
                        value={form.retention_days}
                        onChange={(event) =>
                          setField('retention_days', event.target.value.replace(/[^0-9]/g, ''))
                        }
                      />
                    )}
                  </Field>
                  <Field id="org-contact" label="Kontak permintaan data" error={fieldErrors.data_request_contact}>
                    {(aria) => (
                      <Input
                        {...aria}
                        value={form.data_request_contact}
                        onChange={(event) => setField('data_request_contact', event.target.value)}
                      />
                    )}
                  </Field>
                  {noticeVersions.length > 0 && (
                    <Field
                      id="org-notice-version"
                      label="Versi pemberitahuan responden"
                      hint="Draf yang belum pernah dijawab mengikuti versi baru; versi yang sudah disetujui responden tidak berubah."
                      error={fieldErrors.notice_version}
                    >
                      {(aria) => (
                        <Select
                          value={form.notice_version}
                          onValueChange={(value) => setField('notice_version', value)}
                        >
                          <SelectTrigger {...aria} aria-label="Versi pemberitahuan responden" className="h-11 w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {noticeVersions.map((row) => (
                              <SelectItem key={row.version} value={row.version}>
                                Versi {row.version}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </Field>
                  )}
                  <div className="md:col-span-2">
                    <CheckboxField
                      id="org-cross-border"
                      label="Ada transfer data lintas negara"
                      checked={form.cross_border_transfer}
                      onChange={(next) => setField('cross_border_transfer', next)}
                      invalid={Boolean(fieldErrors.cross_border_transfer)}
                      describedBy={fieldErrors.cross_border_transfer ? 'org-cross-border-error' : undefined}
                    />
                    {fieldErrors.cross_border_transfer && (
                      <p id="org-cross-border-error" role="alert" className="text-caption font-bold text-destructive">
                        {fieldErrors.cross_border_transfer}
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-body-sm text-muted-foreground">Profil organisasi belum dimuat.</p>
              )}
              <div>
                <BusyButton onClick={onSave} loading={busy} disabled={!form || busy}>
                  Simpan profil
                </BusyButton>
              </div>
            </CardContent>
          </Card>

          <Dialog open={shrinkPayload !== null} onOpenChange={(next) => !next && !busy && setShrinkPayload(null)}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Perpendek masa retensi?</DialogTitle>
                <DialogDescription>
                  {shrinkPayload && profile
                    ? `Masa retensi berubah dari ${retentionLabel(profile.retention_days)} menjadi ${retentionLabel(shrinkPayload.retention_days ?? null)}. Data yang lebih tua dari batas baru akan dihapus pada run retensi berikutnya dan tidak dapat dikembalikan.`
                    : ''}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <BusyButton variant="outline" onClick={() => setShrinkPayload(null)} disabled={busy}>
                  Batal
                </BusyButton>
                <BusyButton
                  variant="destructive"
                  loading={busy}
                  onClick={() => shrinkPayload && performSave(shrinkPayload, true)}
                >
                  Perpendek retensi
                </BusyButton>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Card>
            <CardHeader>
              <CardTitle>Anggota</CardTitle>
              <CardDescription>
                Hanya status creator di organisasi ini yang dapat diubah. Peran tidak dapat diubah
                di sini.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={memberColumns(toggleMember, memberBusy)}
                data={members}
                caption="Anggota organisasi: peran, status, dan aksi"
                emptyMessage="Belum ada anggota."
                filterPlaceholder="Cari nama atau email"
                filterText={(member) => `${member.display_name} ${member.email} ${ROLE_LABEL[member.role]}`}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Undangan creator</CardTitle>
              <CardDescription>
                Kode undangan dipakai sekali saat pendaftaran dan menautkan akun baru ke organisasi
                ini. Setiap kode berlaku {invitationTtlDays} hari dan dapat dicabut sebelum dipakai.
              </CardDescription>
              <CardAction>
                <BusyButton
                  variant="secondary"
                  onClick={createInvitation}
                  loading={invitationBusy}
                  disabled={invitationBusy}
                >
                  Buat kode undangan
                </BusyButton>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {freshInvitation && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2">
                  <CheckIcon aria-hidden="true" className="size-4 shrink-0 text-emerald-700" />
                  <p className="min-w-0 flex-1 text-body-sm text-foreground">
                    Kode undangan baru:{' '}
                    <span className="font-mono tracking-mono">
                      <Code>{freshInvitation.code}</Code>
                    </span>
                  </p>
                  <BusyButton
                    variant="outline"
                    size="sm"
                    onClick={() => void copyCode(freshInvitation.code)}
                  >
                    <CopyIcon aria-hidden="true" className="size-3.5" />
                    Salin kode
                  </BusyButton>
                  <BusyButton
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label="Tutup pemberitahuan kode baru"
                    onClick={() => setFreshInvitation(null)}
                  >
                    <XIcon className="size-4" />
                  </BusyButton>
                </div>
              )}
              <DataTable
                columns={invitationColumns((code) => void copyCode(code), setRevokeTarget, invitationBusy)}
                data={invitations}
                caption="Kode undangan creator: status, masa berlaku, dan aksi"
                emptyMessage="Belum ada kode undangan."
                filterPlaceholder="Cari kode undangan"
                filterText={(row) => `${row.code} ${INVITATION_STATUS_LABEL[row.status]}`}
              />
            </CardContent>
          </Card>

          <Dialog open={revokeTarget !== null} onOpenChange={(next) => !next && setRevokeTarget(null)}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Cabut kode undangan ini?</DialogTitle>
                <DialogDescription>
                  {revokeTarget
                    ? `Kode ${revokeTarget.code} tidak dapat dipakai lagi untuk mendaftar. Anggota yang sudah bergabung tidak terpengaruh.`
                    : ''}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <BusyButton variant="outline" onClick={() => setRevokeTarget(null)}>
                  Batal
                </BusyButton>
                <BusyButton
                  variant="destructive"
                  loading={invitationBusy}
                  onClick={revokeInvitation}
                >
                  Cabut kode
                </BusyButton>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Card>
            <CardHeader>
              <CardTitle>Log audit organisasi</CardTitle>
              <CardDescription>
                Tindakan anggota dan perubahan profil tercatat di sini sampai data retensi
                diberlakukan.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={auditColumns(memberNames)}
                data={audit}
                caption="Log audit organisasi: waktu, aktor, tindakan, dan hasil"
                emptyMessage="Belum ada aktivitas organisasi."
                filterPlaceholder="Cari tindakan atau objek"
                filterText={(row) => `${row.action} ${row.object} ${row.actor} ${row.outcome}`}
              />
            </CardContent>
          </Card>
        </div>
      </StateView>
    </Shell>
  );
}
