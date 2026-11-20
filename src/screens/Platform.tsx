'use client';

import { useEffect, useState } from 'react';
import { Shell } from '../components/Shell';
import {
  Banner,
  Button,
  Card,
  Checkbox,
  Code,
  Field,
  SectionTitle,
  TextInput,
} from '../components/ui';
import { StateView, SuccessBanner, ValidationSummary } from '../components/StateView';
import { useScreenState } from '../lib/state';
import { useToast } from '../components/Toast';
import { ORGANIZATION_TYPE_LABEL } from '../lib/labels';
import { getPlatformProfile, savePlatformProfile, type PlatformProfileInput } from '../lib/api';
import type { OrganizationType, PlatformProfile } from '../lib/types';

const ORG_TYPES: OrganizationType[] = ['school', 'organization'];
/** Seed menyimpan organization_type 'platform'; tampilkan apa adanya agar select tidak berbohong. */
const PLATFORM_TYPES = ['platform', ...ORG_TYPES] as const;
type PlatformType = (typeof PLATFORM_TYPES)[number];
const PLATFORM_TYPE_LABEL: Record<PlatformType, string> = {
  platform: 'Platform',
  ...ORGANIZATION_TYPE_LABEL,
};

interface FormState {
  organization_name: string;
  organization_type: PlatformType;
  policy_url: string;
  terms_url: string;
  retention_days: string;
  data_request_contact: string;
  cross_border_transfer: boolean;
}

function formFrom(profile: PlatformProfile): FormState {
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

export function AdminPlatformPage() {
  const notify = useToast();
  const { state } = useScreenState('admin-platform');
  const [profile, setProfile] = useState<PlatformProfile | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    void getPlatformProfile()
      .then((loaded) => {
        setProfile(loaded);
        setForm(formFrom(loaded));
        setLoadError(null);
      })
      .catch((error: unknown) => setLoadError(error instanceof Error ? error.message : 'Profil platform gagal dimuat.'));
  }, []);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setSaved(false);
    setFieldErrors((current) => ({ ...current, [key]: '' }));
    setForm((current) => (current ? { ...current, [key]: value } : current));
  };

  const onSave = () => {
    if (!form) return;
    const errors: Record<string, string> = {};
    if (!form.organization_name.trim()) errors.organization_name = 'Nama organisasi wajib diisi.';
    if (!form.policy_url.trim()) errors.policy_url = 'URL kebijakan privasi wajib diisi.';
    if (!form.terms_url.trim()) errors.terms_url = 'URL ketentuan layanan wajib diisi.';
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const retention = form.retention_days.trim();
    const payload: PlatformProfileInput = {
      organization_name: form.organization_name.trim(),
      organization_type: form.organization_type,
      policy_url: form.policy_url.trim(),
      terms_url: form.terms_url.trim(),
      retention_days: retention === '' ? null : Number(retention),
      data_request_contact: form.data_request_contact.trim() || null,
    };
    // Hanya kirim transfer lintas negara bila berubah, agar nilai "belum diputuskan" (NULL) tidak berubah jadi "tidak".
    if (profile && form.cross_border_transfer !== (profile.cross_border_transfer === 1)) {
      payload.cross_border_transfer = form.cross_border_transfer;
    }
    setBusy(true);
    void savePlatformProfile(payload)
      .then((updated) => {
        setProfile(updated);
        setForm(formFrom(updated));
        setSaved(true);
        notify('Profil platform tersimpan.');
      })
      .catch((error: unknown) => notify(error instanceof Error ? error.message : 'Profil platform gagal disimpan.', 'danger'))
      .finally(() => setBusy(false));
  };

  return (
    <Shell kind="admin" title="Profil platform" subtitle="Kebijakan, kontak, dan retensi untuk akun yang tidak terikat organisasi.">
      <StateView
        routeId="admin-platform"
        state={state}
        permissionDetail="Halaman ini hanya tersedia untuk super admin."
      >
        <div className="flex flex-col gap-5">
          {state === 'success' && <SuccessBanner title="Profil tersimpan">Profil platform diperbarui.</SuccessBanner>}
          {state === 'validation' && <ValidationSummary items={['Nama organisasi tidak boleh kosong.', 'URL kebijakan dan ketentuan wajib diisi.']} />}
          {loadError && <Banner tone="danger" title="Profil platform tidak dapat dimuat">{loadError}</Banner>}

          <Card className="flex flex-col gap-4">
            <SectionTitle>Profil platform</SectionTitle>
            <p className="text-body-sm text-muted">
              Dipakai akun tanpa organisasi dan survei yang tidak terikat organisasi. Anggota organisasi memakai profil organisasinya sendiri.
            </p>
            {saved && <p role="status" className="text-body-sm font-bold text-success">Tersimpan.</p>}
            {form ? (
              <div className="grid gap-4 md:grid-cols-2">
                <Field id="platform-name" label="Nama organisasi" required error={fieldErrors.organization_name}>
                  {(aria) => (
                    <TextInput
                      {...aria}
                      value={form.organization_name}
                      onChange={(event) => setField('organization_name', event.target.value)}
                    />
                  )}
                </Field>
                <Field id="platform-type" label="Tipe organisasi" required>
                  {(aria) => (
                    <select
                      {...aria}
                      value={form.organization_type}
                      onChange={(event) => setField('organization_type', event.target.value as PlatformType)}
                      className="min-h-[52px] w-full rounded-md border border-control-border bg-n0 px-3 text-body-sm text-ink"
                    >
                      {PLATFORM_TYPES.map((value) => (
                        <option key={value} value={value}>{PLATFORM_TYPE_LABEL[value]}</option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field id="platform-policy" label="URL kebijakan privasi" required error={fieldErrors.policy_url}>
                  {(aria) => (
                    <TextInput
                      {...aria}
                      value={form.policy_url}
                      onChange={(event) => setField('policy_url', event.target.value)}
                    />
                  )}
                </Field>
                <Field id="platform-terms" label="URL ketentuan layanan" required error={fieldErrors.terms_url}>
                  {(aria) => (
                    <TextInput
                      {...aria}
                      value={form.terms_url}
                      onChange={(event) => setField('terms_url', event.target.value)}
                    />
                  )}
                </Field>
                <Field
                  id="platform-retention"
                  label="Masa retensi (hari)"
                  hint="Kosongkan bila masih menunggu keputusan pengendali."
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
                <Field id="platform-contact" label="Kontak permintaan data">
                  {(aria) => (
                    <TextInput
                      {...aria}
                      value={form.data_request_contact}
                      onChange={(event) => setField('data_request_contact', event.target.value)}
                    />
                  )}
                </Field>
                <div className="md:col-span-2">
                  <Checkbox
                    id="platform-cross-border"
                    label="Ada transfer data lintas negara"
                    checked={form.cross_border_transfer}
                    onChange={(next) => setField('cross_border_transfer', next)}
                  />
                </div>
              </div>
            ) : (
              !loadError && <p className="text-body-sm text-muted">Profil platform belum dimuat.</p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={onSave} loading={busy} disabled={!form || busy}>Simpan profil</Button>
              {profile && (
                <p className="text-caption text-muted">
                  Versi notice <Code>{profile.notice_version}</Code> · diperbarui {profile.updated_at.slice(0, 10)}
                </p>
              )}
            </div>
          </Card>
        </div>
      </StateView>
    </Shell>
  );
}
