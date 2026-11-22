'use client';

import { useEffect, useState } from 'react';
import { Shell } from '../components/Shell';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Code,
  ConfirmDialog,
  ErrorState,
  Field,
  LoadingState,
  SectionTitle,
  Table,
  Td,
  TextInput,
  Th,
} from '../components/ui';
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
  AGE_CATEGORY_LABEL,
  CONSENT_MODE_LABEL,
  INVITATION_STATUS_LABEL,
  INVITATION_STATUS_TONE,
  ORGANIZATION_TYPE_LABEL,
  ROLE_LABEL,
} from '../lib/labels';
import { cancelOrgWorkspaceLoad, loadOrgWorkspace, useStore } from '../lib/store';
import { formatWIB } from '../lib/summary';
import type { AgeCategory, ConsentMode, OrgInvitation, OrgMember, OrgProfile, OrganizationType } from '../lib/types';

/** Pesan field per kode validasi server (PRD §1.2). */
const FIELD_FOR_CODE: Record<string, 'respondent_age_category' | 'consent_mode' | 'organization_name' | 'organization_type' | 'policy_url' | 'terms_url' | 'retention_days' | 'cross_border_transfer' | 'data_request_contact'> = {
  consent_mode_mismatch: 'consent_mode',
  validation_error: 'respondent_age_category',
};

const ORG_TYPES: OrganizationType[] = ['school', 'organization'];
const AGE_CATEGORIES: AgeCategory[] = ['adult', 'minor', 'mixed'];
const CONSENT_MODES: ConsentMode[] = ['self', 'guardian'];

interface FormState {
  organization_name: string;
  organization_type: OrganizationType;
  policy_url: string;
  terms_url: string;
  retention_days: string;
  data_request_contact: string;
  cross_border_transfer: boolean;
  respondent_age_category: AgeCategory;
  consent_mode: ConsentMode;
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
    respondent_age_category: profile.respondent_age_category,
    consent_mode: profile.consent_mode,
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
    respondent_age_category: form.respondent_age_category,
    consent_mode: form.consent_mode,
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

  const consentMismatch = (form?.respondent_age_category === 'minor' || form?.respondent_age_category === 'mixed')
    && form?.consent_mode === 'self';

  // Galat, memuat, dan data saling eksklusif: kegagalan tidak boleh tampil sebagai organisasi kosong.
  if (orgError || !org) {
    return (
      <Shell kind="admin" title="Organisasi" subtitle="Profil kebijakan, anggota, undangan, dan audit lingkup organisasi Anda.">
        {orgError ? (
          <ErrorState
            title="Data organisasi gagal dimuat"
            detail={`${orgError} Profil, anggota, undangan, dan log audit tidak ditampilkan sampai data berhasil dimuat.`}
            action={<Button variant="secondary" onClick={() => void loadOrgWorkspace()}>Coba lagi</Button>}
          />
        ) : (
          <LoadingState label="Memuat data organisasi…" rows={4} />
        )}
      </Shell>
    );
  }
  const { members, invitations, audit } = org;

  return (
    <Shell kind="admin" title="Organisasi" subtitle="Profil kebijakan, anggota, undangan, dan audit lingkup organisasi Anda.">
      <StateView
        routeId="admin-org"
        state={state}
        permissionDetail="Halaman ini hanya tersedia untuk admin organisasi."
      >
        <div className="flex flex-col gap-5">
          {state === 'success' && <SuccessBanner title="Profil tersimpan">Profil organisasi diperbarui.</SuccessBanner>}
          {state === 'validation' && <ValidationSummary items={['Responden minor wajib memakai persetujuan orang tua atau wali.', 'Nama organisasi tidak boleh kosong.']} />}

          <Card className="flex flex-col gap-4">
            <SectionTitle>Profil organisasi</SectionTitle>
            {saved && <p role="status" className="text-body-sm font-bold text-success">Tersimpan.</p>}
            {form ? (
              <div className="grid gap-4 md:grid-cols-2">
                <Field id="org-name" label="Nama organisasi" required error={fieldErrors.organization_name}>
                  {(aria) => (
                    <TextInput
                      {...aria}
                      value={form.organization_name}
                      onChange={(event) => setField('organization_name', event.target.value)}
                    />
                  )}
                </Field>
                <Field id="org-type" label="Tipe organisasi" required error={fieldErrors.organization_type}>
                  {(aria) => (
                    <select
                      {...aria}
                      value={form.organization_type}
                      onChange={(event) => setField('organization_type', event.target.value as OrganizationType)}
                      className="min-h-[52px] w-full rounded-md border border-control-border bg-n0 px-3 text-body-sm text-ink"
                    >
                      {ORG_TYPES.map((value) => (
                        <option key={value} value={value}>{ORGANIZATION_TYPE_LABEL[value]}</option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field id="org-policy" label="URL kebijakan privasi" required error={fieldErrors.policy_url}>
                  {(aria) => (
                    <TextInput
                      {...aria}
                      value={form.policy_url}
                      onChange={(event) => setField('policy_url', event.target.value)}
                    />
                  )}
                </Field>
                <Field id="org-terms" label="URL ketentuan layanan" required error={fieldErrors.terms_url}>
                  {(aria) => (
                    <TextInput
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
                    <TextInput
                      {...aria}
                      inputMode="numeric"
                      value={form.retention_days}
                      onChange={(event) => setField('retention_days', event.target.value.replace(/[^0-9]/g, ''))}
                    />
                  )}
                </Field>
                <Field id="org-contact" label="Kontak permintaan data" error={fieldErrors.data_request_contact}>
                  {(aria) => (
                    <TextInput
                      {...aria}
                      value={form.data_request_contact}
                      onChange={(event) => setField('data_request_contact', event.target.value)}
                    />
                  )}
                </Field>
                <Field id="org-age" label="Kategori usia responden" required error={fieldErrors.respondent_age_category}>
                  {(aria) => (
                    <select
                      {...aria}
                      value={form.respondent_age_category}
                      onChange={(event) => setField('respondent_age_category', event.target.value as AgeCategory)}
                      className="min-h-[52px] w-full rounded-md border border-control-border bg-n0 px-3 text-body-sm text-ink"
                    >
                      {AGE_CATEGORIES.map((value) => (
                        <option key={value} value={value}>{AGE_CATEGORY_LABEL[value]}</option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field
                  id="org-consent"
                  label="Mode persetujuan"
                  required
                  hint={consentMismatch ? 'Kategori minor atau campuran wajib memakai persetujuan orang tua atau wali.' : undefined}
                  error={fieldErrors.consent_mode ?? (consentMismatch ? 'Responden minor wajib memakai persetujuan orang tua atau wali.' : undefined)}
                >
                  {(aria) => (
                    <select
                      {...aria}
                      value={form.consent_mode}
                      onChange={(event) => setField('consent_mode', event.target.value as ConsentMode)}
                      className="min-h-[52px] w-full rounded-md border border-control-border bg-n0 px-3 text-body-sm text-ink"
                    >
                      {CONSENT_MODES.map((value) => (
                        <option key={value} value={value}>{CONSENT_MODE_LABEL[value]}</option>
                      ))}
                    </select>
                  )}
                </Field>
                <div className="md:col-span-2">
                  <Checkbox
                    id="org-cross-border"
                    label="Ada transfer data lintas negara"
                    checked={form.cross_border_transfer}
                    onChange={(next) => setField('cross_border_transfer', next)}
                  />
                  {fieldErrors.cross_border_transfer && (
                    <p role="alert" className="text-caption font-bold text-danger">{fieldErrors.cross_border_transfer}</p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-body-sm text-muted">Profil organisasi belum dimuat.</p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={onSave} loading={busy} disabled={!form || busy}>Simpan profil</Button>
              {profile && <p className="text-caption text-muted">Kode organisasi: <Code>{profile.id}</Code></p>}
            </div>
          </Card>

          <Card className="flex flex-col gap-3">
            <SectionTitle>Anggota</SectionTitle>
            <p className="text-body-sm text-muted">Hanya status creator di organisasi ini yang dapat diubah. Peran tidak dapat diubah di sini.</p>
            {members.length === 0 ? (
              <p className="text-body-sm text-muted">Belum ada anggota.</p>
            ) : (
              <Table head={['Nama', 'Email', 'Peran', 'Status', 'Aksi']}>
                {members.map((member) => (
                  <tr key={member.id}>
                    <Th>{member.display_name}<span className="mt-1 block font-mono text-annotation font-normal tracking-mono text-muted"><Code>{member.id}</Code></span></Th>
                    <Td>{member.email}</Td>
                    <Td>{ROLE_LABEL[member.role]}</Td>
                    <Td><Badge tone={member.status === 'active' ? 'success' : 'neutral'}>{ACCOUNT_STATUS_LABEL[member.status]}</Badge></Td>
                    <Td>
                      <Button
                        variant="ghost"
                        loading={memberBusy === member.id}
                        disabled={member.role !== 'creator' || memberBusy === member.id}
                        onClick={() => toggleMember(member)}
                      >
                        {member.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'}
                      </Button>
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          <Card className="flex flex-col gap-3">
            <SectionTitle>Undangan creator</SectionTitle>
            <p className="text-body-sm text-muted">
              Kode undangan dipakai sekali saat pendaftaran dan menautkan akun baru ke organisasi ini.
              Setiap kode berlaku 14 hari dan dapat dicabut sebelum dipakai.
            </p>
            <div>
              <Button variant="secondary" onClick={createInvitation} loading={invitationBusy} disabled={invitationBusy}>
                Buat kode undangan
              </Button>
            </div>
            {invitations.length === 0 ? (
              <p className="text-body-sm text-muted">Belum ada kode undangan.</p>
            ) : (
              <Table head={['Kode', 'Status', 'Dibuat', 'Kedaluwarsa', 'Aksi']}>
                {invitations.map((row) => (
                  <tr key={row.id}>
                    <Td><Code>{row.code}</Code></Td>
                    <Td><Badge tone={INVITATION_STATUS_TONE[row.status]}>{INVITATION_STATUS_LABEL[row.status]}</Badge></Td>
                    <Td>{formatWIB(row.created_at)}</Td>
                    <Td>{formatWIB(row.expires_at)}</Td>
                    <Td>
                      {row.status === 'active' ? (
                        <Button variant="ghost" disabled={invitationBusy} onClick={() => setRevokeTarget(row)}>Cabut</Button>
                      ) : (
                        <span className="text-caption text-muted">—</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          <ConfirmDialog
            open={revokeTarget !== null}
            title="Cabut kode undangan ini?"
            detail={revokeTarget
              ? `Kode ${revokeTarget.code} tidak dapat dipakai lagi untuk mendaftar. Anggota yang sudah bergabung tidak terpengaruh.`
              : ''}
            confirmLabel="Cabut kode"
            busy={invitationBusy}
            onClose={() => setRevokeTarget(null)}
            onConfirm={revokeInvitation}
          />

          <Card className="flex flex-col gap-3">
            <SectionTitle>Log audit organisasi</SectionTitle>
            {audit.length === 0 ? (
              <p className="text-body-sm text-muted">Belum ada aktivitas organisasi.</p>
            ) : (
              <Table head={['Waktu', 'Aktor', 'Tindakan', 'Objek', 'Hasil']}>
                {audit.map((row) => (
                  <tr key={row.id}>
                    <Td>{formatWIB(row.at)}</Td>
                    <Td>{row.actor}</Td>
                    <Td>{row.action}</Td>
                    <Td><Code>{row.object}</Code></Td>
                    <Td>{row.outcome}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>
      </StateView>
    </Shell>
  );
}
