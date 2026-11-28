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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { UserMinus } from 'runeicons-react/icons/UserMinus';
import { UserPlus } from 'runeicons-react/icons/UserPlus';
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
import type { OrgInvitation, OrgMember, OrgProfile, OrganizationType } from '../lib/types';

const SuspendedMemberIcon = withIconClass(UserMinus);
const ActivatedMemberIcon = withIconClass(UserPlus);

/** Pesan field per kode validasi server (PRD §1.2). */
const FIELD_FOR_CODE: Record<string, 'organization_name' | 'organization_type' | 'policy_url' | 'terms_url' | 'retention_days' | 'cross_border_transfer' | 'data_request_contact'> = {
  validation_error: 'organization_name',
};

interface FormState {
  organization_name: string;
  organization_type: OrganizationType;
  policy_url: string;
  terms_url: string;
  retention_days: string;
  data_request_contact: string;
  cross_border_transfer: boolean;
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
  };
}

function payloadFrom(form: FormState): OrgProfileInput {
  const retention = form.retention_days.trim();
  return {
    organization_name: form.organization_name.trim(),
    organization_type: form.organization_type,
    policy_url: form.policy_url.trim(),
    terms_url: form.terms_url.trim(),
    retention_days: retention === '' ? null : Number(retention),
    data_request_contact: form.data_request_contact.trim() || null,
    cross_border_transfer: form.cross_border_transfer,
  };
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

  const onSave = () => {
    if (!form) return;
    setBusy(true);
    setFieldErrors({});
    setSaved(false);
    void saveOrgProfile(payloadFrom(form))
      .then((result) => {
        setDraft(formFrom(result.profile));
        setSaved(true);
        notify('Profil organisasi disimpan.');
        return loadOrgWorkspace();
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.code) {
          // Tampilkan di dekat field, bukan hanya toast.
          setFieldErrors({ [FIELD_FOR_CODE[error.code] ?? 'organization_name']: error.message });
        }
        notify(error instanceof Error ? error.message : 'Profil gagal disimpan.', 'danger');
      })
      .finally(() => setBusy(false));
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
      .then(() => {
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
  const { members, invitations, audit } = org;
  const memberNames = new Map(members.map((member) => [member.id, member.display_name]));

  return (
    <Shell kind="admin" title="Organisasi" subtitle="Profil kebijakan, anggota, undangan, dan audit lingkup organisasi Anda.">
      <StateView
        routeId="admin-org"
        state={state}
        permissionDetail="Halaman ini hanya tersedia untuk admin organisasi."
      >
        <div className="flex flex-col gap-5">
          {state === 'success' && <SuccessBanner title="Profil tersimpan">Profil organisasi diperbarui.</SuccessBanner>}
          {state === 'validation' && <ValidationSummary items={['Nama organisasi tidak boleh kosong.', 'Kontak permintaan data tidak boleh kosong.']} />}

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
                    hint="Kosongkan bila masih menunggu keputusan pengendali."
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

          <Card>
            <CardHeader>
              <CardTitle>Anggota</CardTitle>
              <CardDescription>
                Hanya status creator di organisasi ini yang dapat diubah. Peran tidak dapat diubah
                di sini.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {members.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-6 text-center text-body-sm text-muted-foreground">
                  Belum ada anggota.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nama</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Peran</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-end">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {members.map((member) => (
                      <TableRow key={member.id}>
                        <TableCell>
                          <p className="font-bold text-foreground">{member.display_name}</p>
                          <p className="font-mono text-annotation tracking-mono text-muted-foreground">
                            <Code>{member.id}</Code>
                          </p>
                        </TableCell>
                        <TableCell>{member.email}</TableCell>
                        <TableCell>{ROLE_LABEL[member.role]}</TableCell>
                        <TableCell>
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
                        </TableCell>
                        <TableCell className="text-end">
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
                            loading={memberBusy === member.id}
                            disabled={member.role !== 'creator' || memberBusy === member.id}
                            onClick={() => toggleMember(member)}
                          >
                            {member.status === 'active' ? (
                              <SuspendedMemberIcon className="size-4" />
                            ) : (
                              <ActivatedMemberIcon className="size-4" />
                            )}
                          </BusyButton>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Undangan creator</CardTitle>
              <CardDescription>
                Kode undangan dipakai sekali saat pendaftaran dan menautkan akun baru ke organisasi
                ini. Setiap kode berlaku 14 hari dan dapat dicabut sebelum dipakai.
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
            <CardContent>
              {invitations.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-6 text-center text-body-sm text-muted-foreground">
                  Belum ada kode undangan.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Kode</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Dibuat</TableHead>
                      <TableHead>Kedaluwarsa</TableHead>
                      <TableHead className="text-end">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invitations.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-mono tracking-mono">
                          <Code>{row.code}</Code>
                        </TableCell>
                        <TableCell>
                          <Badge variant={INVITATION_STATUS_TONE[row.status]}>
                            {INVITATION_STATUS_LABEL[row.status]}
                          </Badge>
                        </TableCell>
                        <TableCell>{formatWIB(row.created_at)}</TableCell>
                        <TableCell>{formatWIB(row.expires_at)}</TableCell>
                        <TableCell className="text-end">
                          {row.status === 'active' ? (
                            <BusyButton
                              variant="ghost"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              disabled={invitationBusy}
                              onClick={() => setRevokeTarget(row)}
                            >
                              Cabut
                            </BusyButton>
                          ) : (
                            <span className="text-caption text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
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
              {audit.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-6 text-center text-body-sm text-muted-foreground">
                  Belum ada aktivitas organisasi.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Waktu</TableHead>
                      <TableHead>Aktor</TableHead>
                      <TableHead>Tindakan</TableHead>
                      <TableHead>Objek</TableHead>
                      <TableHead>Hasil</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {audit.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>{formatWIB(row.at)}</TableCell>
                        <TableCell>
                          <AuditActor actor={row.actor} names={memberNames} />
                        </TableCell>
                        <TableCell>{row.action}</TableCell>
                        <TableCell className="font-mono tracking-mono">
                          <Code>{row.object}</Code>
                        </TableCell>
                        <TableCell>{row.outcome}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </StateView>
    </Shell>
  );
}