'use client';

import { useEffect, useState } from 'react';
import { Shell } from '../components/Shell';
import {
  ActionLink,
  Badge,
  Banner,
  Button,
  Card,
  Checkbox,
  Code,
  ConfirmDialog,
  ContactChannel,
  Divider,
  EmptyState,
  Field,
  Label,
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
import type { ConsentRequired } from '../lib/types';
import { findSurvey, versionsFor, questionsFor, publishedVersionFor } from '../lib/fixtures/surveys';
import { formatInvitationExpiry, formatWIB } from '../lib/summary';
import { getSummary, getResponses, downloadExport, printPublicLinkToken, ApiError, type VersionSummary, type IndividualResponse } from '../lib/api';
import { useToast } from '../components/Toast';
import {
  allAssignments,
  allInvitations,
  allPublicLinks,
  archiveSurvey,
  canManageAs,
  closeVersion,
  createInvitation,
  localGrantsFor,
  refreshBootstrap,
  revokeInvitation,
  saveSettings,
  surveyNoticeOf,
  surveyProfileOf,
  useStore,
} from '../lib/store';
import { MissingSurvey, SurveyNav } from './CreatorCore';
import {
  COLLECTION_MODE_LABEL,
  CONSENT_REQUIRED_LABEL,
  INVITATION_STATUS_LABEL,
  INVITATION_STATUS_TONE,
  ORGANIZATION_TYPE_LABEL,
  STATUS_LABEL,
} from '../lib/labels';

/* ---------------- Bagikan ---------------- */

export function SharePage({ id }: { id: string }) {
  const { state, link } = useScreenState('creator-share');
  const notify = useToast();
  const { revision, session } = useStore();
  void revision;
  const survey = findSurvey(id);
  const canManage = canManageAs(session, survey);
  const hasPublishedVersion = Boolean(publishedVersionFor(id));
  const canInvite = hasPublishedVersion && survey?.status !== 'closed' && survey?.status !== 'archived' && state !== 'closed';
  const [label, setLabel] = useState('');
  const [expiresAt, setExpiresAt] = useState('2026-12-31');
  const [busy, setBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [newInvite, setNewInvite] = useState<{ code: string; token: string } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; code: string } | null>(null);

  const links = allPublicLinks().filter((linkItem) => linkItem.survey_id === id);
  const invites = allInvitations().filter((invite) => invite.survey_id === id);
  const assignments = allAssignments();
  const [copied, setCopied] = useState<string | null>(null);
  const [printedLink, setPrintedLink] = useState<string | null>(null);
  const [printBusy, setPrintBusy] = useState(false);
  const [tokenConfirm, setTokenConfirm] = useState(false);

  function revealToken() {
    setPrintBusy(true);
    void printPublicLinkToken(id)
      .then((issued) => {
        setPrintedLink(issued.token);
        notify('Token tautan umum baru diterbitkan; tautan lama tidak berlaku lagi.');
        return refreshBootstrap();
      })
      .catch((error: unknown) => notify(error instanceof Error ? error.message : 'Token gagal diterbitkan.', 'danger'))
      .finally(() => setPrintBusy(false));
  }

  async function copyLink(url: string, key: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(key);
      notify('Tautan disalin ke papan klip.');
    } catch {
      setCopied(key);
      notify(`Salin tautan: ${url}`, 'info');
    }
  }

  if (!survey || !canManage) {
    return (
      <Shell kind="creator" title="Bagikan survei" subtitle="Survei tidak ditemukan.">
        <MissingSurvey />
      </Shell>
    );
  }

  const shareBody = (
    <Shell kind="creator" title="Bagikan survei" subtitle="Bagikan tautan umum atau kirim undangan individual kepada peserta.">
      <StateView
        routeId="creator-share"
        state={state}
        emptyTitle="Belum ada tautan atau undangan"
        emptyDetail="Buat tautan umum atau undangan individual untuk mulai menerima jawaban."
        permissionDetail="Hanya pemilik atau admin organisasi survei yang dapat membuat dan mencabut undangan."
      >
        <div className="flex flex-col gap-5">
          
          <SurveyNav id={id} />
          {state === 'success' && <SuccessBanner title="Tautan siap dibagikan">Salin tautan atau kirim kode undangan kepada peserta.</SuccessBanner>}
          {state === 'validation' && <ValidationSummary items={['Masa berlaku undangan harus diisi.', 'Kode undangan tidak boleh sama dengan kode yang sudah ada.']} />}
          {state === 'expired' && <Banner tone="warning" title="Tautan kedaluwarsa">Tautan yang kedaluwarsa tidak menerima kiriman baru.</Banner>}
          {state === 'revoked' && <Banner tone="danger" title="Undangan dicabut">Kode yang dicabut tidak dapat dipakai lagi.</Banner>}
          {shareError && <Banner tone="danger" title="Tindakan gagal">{shareError}</Banner>}
          {newInvite && (
            <Banner tone="success" title={`Undangan ${newInvite.code} dibuat`}>
              <div className="flex flex-wrap items-center gap-3">
                <PlainLink to={ROUTES.respondentIntro(newInvite.token)} className="min-h-[44px] break-all">/s/{newInvite.token}</PlainLink>
                <button
                  type="button"
                  onClick={() => void copyLink(`${window.location.origin}/s/${newInvite.token}`, newInvite.token)}
                  className="min-h-[44px] text-caption font-bold text-action underline decoration-1 underline-offset-4 hover:text-action-hover"
                >
                  {copied === newInvite.token ? 'Tersalin' : 'Salin tautan'}
                </button>
              </div>
            </Banner>
          )}

          <Card className="flex flex-col gap-3">
            <SectionTitle>Tautan umum</SectionTitle>
            <Banner tone="info" title="Tautan umum tidak menjamin satu respons per orang">
              Kiriman ganda dari orang yang sama dicegah, tetapi tautan umum tidak memastikan satu orang hanya mengisi sekali.
            </Banner>
            {links.length === 0 ? (
              <Muted>Belum ada tautan umum untuk survei ini. Terbitkan versi untuk membuatnya.</Muted>
            ) : (
              <ul className="flex flex-col gap-3">
                {links.map((l) => (
                  <li key={l.id} className="rounded-md border border-n200 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {printedLink && l.status === 'active' ? (
                        <p className="font-mono text-body-sm font-bold tracking-mono text-ink break-all">/s/{printedLink}</p>
                      ) : (
                        <p className="text-body-sm text-muted">Token tidak ditampilkan lagi setelah dibuat.</p>
                      )}
                      <Badge tone={l.status === 'active' ? 'success' : 'warning'}>{l.status === 'active' ? 'Aktif' : 'Tidak aktif'}</Badge>
                    </div>
                    <p className="mt-2 text-caption text-muted">{l.label}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setShareError(null);
                          setTokenConfirm(true);
                        }}
                        loading={printBusy}
                        disabled={state === 'loading' || state === 'closed' || l.status !== 'active'}
                      >
                        {printedLink ? 'Terbitkan ulang token' : 'Tampilkan token'}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => void copyLink(`${window.location.origin}/s/${printedLink}`, printedLink ?? '')}
                        disabled={!printedLink || l.status !== 'active'}
                      >
                        {printedLink && copied === printedLink ? 'Tersalin' : 'Salin tautan'}
                      </Button>
                      <ActionLink
                        to={ROUTES.respondentIntro(printedLink ?? '')}
                        variant="secondary"
                        disabled={!printedLink || l.status !== 'active'}
                        disabledReason="Tampilkan token lebih dulu"
                      >
                        Buka sebagai responden
                      </ActionLink>
                      {l.status !== 'active' && (
                        <span className="self-center text-caption text-muted">Tautan nonaktif tidak menerima jawaban.</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-caption text-muted">
              Token hanya disimpan sebagai hash. Simpan tautan yang dibagikan; menampilkan token menerbitkan token baru dan mematikan tautan sebelumnya.
            </p>
          </Card>

          <Card className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SectionTitle>Undangan individual</SectionTitle>
              <Badge tone="neutral">{invites.length} kode</Badge>
            </div>
            <Divider />
            <Table head={['Kode tampilan', 'Label / peserta', 'Status', 'Berlaku sampai', 'Dipakai', 'Dicabut', 'Aksi']}>
              {invites.map((i) => (
                <tr key={i.id}>
                  <Th>
                    <Code>{i.code}</Code>
                    {i.token && i.status === 'active' ? (
                      <div className="mt-1 flex items-center gap-3">
                        <PlainLink to={ROUTES.respondentIntro(i.token)} className="min-h-[44px]">Buka</PlainLink>
                        <button
                          type="button"
                          onClick={() => void copyLink(`${window.location.origin}/s/${i.token}`, i.token ?? '')}
                          aria-label={`Salin tautan undangan ${i.code}`}
                          className="min-h-[44px] text-caption font-bold text-action underline decoration-1 underline-offset-4 hover:text-action-hover"
                        >
                          {copied === i.token ? 'Tersalin' : 'Salin'}
                        </button>
                      </div>
                    ) : null}
                  </Th>
                  <Td>
                    {assignments.find((a) => a.id === i.assignment_id)?.label ?? 'Tanpa label'}
                    <span className="mt-1 block font-mono text-caption text-muted">{assignments.find((a) => a.id === i.assignment_id)?.participant_ref ?? '—'}</span>
                  </Td>
                  <Td><Badge tone={INVITATION_STATUS_TONE[i.status]}>{INVITATION_STATUS_LABEL[i.status]}</Badge></Td>
                  <Td>{i.expires_at ? formatInvitationExpiry(i.expires_at) : 'Belum ada'}</Td>
                  <Td>{i.used_at ? formatWIB(i.used_at) : 'Belum ada'}</Td>
                  <Td>{i.revoked_at ? formatWIB(i.revoked_at) : 'Belum ada'}</Td>
                  <Td>
                    {i.status === 'active' ? (
                      <button
                        type="button"
                        onClick={() => {
                          setShareError(null);
                          setRevokeTarget({ id: i.id, code: i.code });
                        }}
                        disabled={busy}
                        className="min-h-[44px] rounded-sm border border-danger-fill px-2 text-caption font-bold text-danger hover:bg-danger-soft disabled:opacity-60"
                      >
                        Cabut
                      </button>
                    ) : <span className="text-caption text-muted">Tidak ada aksi</span>}
                  </Td>
                </tr>
              ))}
            </Table>
            <p className="text-caption text-muted">
              Kode yang dipakai untuk mengisi berbeda dari ID pseudonim yang diekspor. Hash token tidak ditampilkan.
            </p>
          </Card>

          <Card className="flex flex-col gap-3">
            <SectionTitle>Buat undangan baru</SectionTitle>
            {!hasPublishedVersion && (
              <p className="text-caption text-muted">Terbitkan satu versi terlebih dahulu; undangan hanya dapat dibuat untuk versi terbit.</p>
            )}
            {hasPublishedVersion && !canInvite && (
              <p className="text-caption text-muted">Survei sudah ditutup atau diarsipkan, sehingga undangan baru tidak dapat dibuat.</p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="penugasan-baru" label="Label penugasan">
                {(aria) => <TextInput {...aria} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Nama kelas atau kelompok" />}
              </Field>
              <Field id="kedaluwarsa-baru" label="Berlaku sampai" hint="Kode tidak berlaku setelah tanggal ini.">
                {(aria) => <TextInput {...aria} type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />}
              </Field>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button disabled={state === 'loading' || !canInvite || busy} loading={busy} onClick={() => {
                if (!label.trim()) { notify('Isi label penugasan terlebih dahulu.', 'danger'); return; }
                setBusy(true);
                setShareError(null);
                setNewInvite(null);
                void createInvitation(id, label.trim(), expiresAt)
                  .then((created) => {
                    setLabel('');
                    setNewInvite(created);
                    notify(`Undangan ${created.code} dibuat.`);
                  })
                  .catch((error: unknown) => setShareError(error instanceof Error ? error.message : 'Undangan gagal dibuat.'))
                  .finally(() => setBusy(false));
              }}>Buat kode undangan</Button>
              <ActionLink to={link(ROUTES.creatorHistory(id))} variant="secondary">Lihat riwayat versi</ActionLink>
            </div>
          </Card>
        </div>
      </StateView>

    </Shell>
  );

  return (
    <>
      {shareBody}
      <ConfirmDialog
        open={tokenConfirm}
        title="Terbitkan token tautan umum baru?"
        detail="Tautan umum yang lama langsung berhenti berlaku dan tidak bisa dipulihkan. Salin dan simpan tautan baru setelah token ditampilkan."
        confirmLabel="Tampilkan token"
        tone="primary"
        onClose={() => setTokenConfirm(false)}
        onConfirm={() => {
          setTokenConfirm(false);
          revealToken();
        }}
      />
      <ConfirmDialog
        open={Boolean(revokeTarget)}
        title="Cabut kode undangan ini?"
        detail={revokeTarget
          ? `Kode ${revokeTarget.code} tidak dapat dipakai lagi. Responden yang sudah mengirim jawaban tidak terpengaruh.`
          : ''}
        confirmLabel="Cabut undangan"
        onClose={() => setRevokeTarget(null)}
        onConfirm={() => {
          const target = revokeTarget;
          if (!target) return;
          setRevokeTarget(null);
          void revokeInvitation(target.id)
            .then(() => notify('Undangan dicabut.'))
            .catch((error: unknown) => setShareError(error instanceof Error ? error.message : 'Undangan gagal dicabut.'));
        }}
      />
    </>
  );
}

/* ---------------- Hasil ---------------- */

export function ResultsPage({ id }: { id: string }) {
  const notify = useToast();
  const { revision, session, grants, settings, admin } = useStore();
  void revision;
  const { state } = useScreenState('creator-results');
  // Daftar survei dari bootstrap server; sebelum itu tidak ada data nyata yang boleh dirender (NEW-UX-A).
  const survey = admin?.surveys.find((entry) => entry.id === id);
  const versionList = versionsFor(id);
  const selectableVersions = versionList.filter((version) => version.status !== 'draft');
  const fallbackVersion = publishedVersionFor(id)?.id ?? selectableVersions[0]?.id ?? '';
  const [versionId, setVersionId] = useState(fallbackVersion);
  useEffect(() => {
    if (versionId && versionList.some((version) => version.id === versionId)) return;
    if (fallbackVersion) setVersionId(fallbackVersion);
  }, [versionId, fallbackVersion, versionList]);
  const [summary, setSummary] = useState<VersionSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [exportRequested, setExportRequested] = useState(false);
  // BF-07: ekspor CSV per-responden wajib menyebut penerima dan tujuan.
  const [exportRecipient, setExportRecipient] = useState('');
  const [exportPurpose, setExportPurpose] = useState('');
  const exportContextReady = exportRecipient.trim().length > 0 && exportPurpose.trim().length > 0;
  useEffect(() => { setExportRequested(false); }, [versionId]);
  const [responses, setResponses] = useState<IndividualResponse[] | null>(null);
  const [responsesError, setResponsesError] = useState<Error | null>(null);
  const [responsesBusy, setResponsesBusy] = useState(false);

  useEffect(() => {
    if (!versionId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void getSummary(id, versionId)
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error : new Error('Ringkasan gagal dimuat.'));
          setSummary(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, versionId]);

  const denied = loadError instanceof ApiError && loadError.status === 403;
  const responsesDenied = responsesError instanceof ApiError && responsesError.status === 403;
  // Grant dibaca dari bootstrap server lewat store, bukan fixture (NEW-UX-A), tetapi tetap per akun+survei.
  const myGrants = localGrantsFor(session?.id ?? '').filter((grant) => grant.survey_id === id);
  const canManage = canManageAs(session, survey);
  // Server: canExport/canReadIndividual/canExportIndividual mengembalikan true untuk pengelola (pemilik atau org_admin lingkup).
  const exportAllowed = canManage || myGrants.some((grant) => grants[grant.id]?.export);
  const individualAllowed = canManage || (myGrants.some((grant) => grants[grant.id]?.read) && Boolean(settings[id]?.allowIndividual));
  // Cermin server canReadFreeText: pengelola selalu boleh; pemegang grant butuh can_read_free_text.
  const freeTextAllowed = canManage || myGrants.some((grant) => grants[grant.id]?.text);
  // CSV memuat baris per responden: server mensyaratkan izin ekspor dan izin baca individual (canExportIndividual).
  const csvAllowed = exportAllowed && individualAllowed;
  const csvBlockedReason = !exportAllowed || csvAllowed
    ? null
    : myGrants.some((grant) => grants[grant.id]?.read)
      ? 'Pengaturan survei belum mengizinkan petugas berizin membaca jawaban individual, jadi CSV per responden tidak dapat diunduh. Kodebook tetap dapat diunduh.'
      : 'CSV memuat jawaban per responden dan memerlukan izin membaca jawaban individual. Administrator dapat memberikan izin itu; kodebook tetap dapat diunduh.';

  const loadResponses = () => {
    setResponsesBusy(true);
    setResponsesError(null);
    void getResponses(id, versionId)
      .then((data) => setResponses(data))
      .catch((error: unknown) => {
        setResponses(null);
        setResponsesError(error instanceof Error ? error : new Error('Jawaban individual gagal dimuat.'));
      })
      .finally(() => setResponsesBusy(false));
  };

  if (!survey) {
    return (
      <Shell kind="creator" title="Hasil per versi" subtitle="Survei tidak ditemukan.">
        <MissingSurvey />
      </Shell>
    );
  }

  // Draf tidak menerima kiriman; tanpa versi terbit tidak ada selector, ringkasan, atau ekspor yang bisa dipakai.
  if (selectableVersions.length === 0) {
    return (
      <Shell kind="creator" title="Hasil per versi" subtitle="Distribusi jawaban per versi. Opsi tanpa pemilih tetap ditampilkan sebagai nol.">
        <StateView
          routeId="creator-results"
          state={state}
          emptyTitle="Belum ada versi diterbitkan"
          emptyDetail="Hasil hanya tersedia setelah versi diterbitkan."
          permissionDetail="Unduhan jawaban individual memerlukan izin ekspor terpisah."
        >
          <div className="flex flex-col gap-5">
            <SurveyNav id={id} />
            <EmptyState
              title="Belum ada versi diterbitkan"
              action={canManage ? <ActionLink to={ROUTES.creatorPublish(id)}>Lanjut ke publikasi</ActionLink> : undefined}
            >
              {canManage
                ? 'Hasil dan ekspor tersedia setelah versi diterbitkan. Terbitkan draf dari halaman publikasi untuk mulai menerima jawaban.'
                : 'Hasil dan ekspor tersedia setelah pemilik atau admin organisasi menerbitkan versi.'}
            </EmptyState>
          </div>
        </StateView>
      </Shell>
    );
  }

  return (
    <Shell kind="creator" title="Hasil per versi" subtitle="Distribusi jawaban per versi. Opsi tanpa pemilih tetap ditampilkan sebagai nol.">
      <StateView
        routeId="creator-results"
        state={state}
        emptyTitle="Belum ada versi diterbitkan"
        emptyDetail="Hasil hanya tersedia setelah versi diterbitkan."
        permissionDetail="Unduhan jawaban individual memerlukan izin ekspor terpisah."
      >
        <div className="flex flex-col gap-5">
          
          <SurveyNav id={id} />

          {state === 'success' && <SuccessBanner title="Ringkasan diperbarui">Data dibaca dari respons final yang tersimpan.</SuccessBanner>}
          {state === 'closed' && <Banner tone="warning" title="Versi ditutup">Hasil versi yang ditutup tetap dapat dibaca sesuai retensi.</Banner>}

          <Card className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="pilih-versi" className="text-body-sm font-bold text-ink">Versi</label>
                <select
                  id="pilih-versi"
                  value={versionId}
                  onChange={(e) => {
                    setVersionId(e.target.value);
                    setResponses(null);
                    setResponsesError(null);
                  }}
                  className="mt-1 min-h-[52px] w-full rounded-md border border-control-border bg-n0 px-3 text-body-sm text-ink"
                >
                  {selectableVersions.map((v) => (
                    <option key={v.id} value={v.id}>Versi {v.number} · {STATUS_LABEL[v.status]}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col justify-end gap-2">
                <Label>Total kiriman final</Label>
                <p className="text-h2 font-bold text-ink">
                  {loading ? '…' : summary?.total ?? (summary?.fewer_than != null ? `< ${summary.fewer_than}` : 0)}
                </p>
              </div>
            </div>
            <p className="text-caption text-muted">
              Jawaban opsional yang kosong tidak dihitung sebagai nilai nol.
            </p>
            {loadError && !denied && <Banner tone="danger" title="Ringkasan gagal dimuat">{loadError.message}</Banner>}
            {denied && (
              <Banner tone="danger" title="Akses hasil ditolak">
                Akun ini tidak memiliki izin membaca hasil pada survei ini.
              </Banner>
            )}
            {!loading && summary?.fewer_than != null && (
              <Banner tone="info" title="Hasil kelompok kecil ditahan">
                {`Ringkasan baru ditampilkan setelah versi ini menerima sedikitnya ${summary.fewer_than} respons, agar jawaban tidak dapat menunjuk satu orang.`}
              </Banner>
            )}
          </Card>

          {summary?.items.map((item) => (
            <Card key={item.question_id} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <Label><Code>{item.code}</Code> · {item.section}</Label>
                  <p className="mt-1 text-body font-bold text-ink">{item.label}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge tone="neutral">Terjawab {item.answered}</Badge>
                  <Badge tone="neutral">Dilewati {item.skipped}</Badge>
                  <Badge tone="info">Total {item.total}</Badge>
                </div>
              </div>
              <Divider />
              {item.type === 'short_text' ? (
                <div>
                  {denied || !individualAllowed ? (
                    <>
                      <p className="text-body-sm text-muted">Isian teks bebas hanya untuk penerima berizin.</p>
                      <p className="mt-2 text-body-sm text-ink">
                        {item.free_text_count > 0 ? `${item.free_text_count} isian teks dalam dataset.` : 'Belum ada jawaban'}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-body-sm text-muted">Isian teks bebas untuk penerima berizin.</p>
                      <p className="mt-2 text-body-sm text-ink">
                        {item.free_text_count > 0 ? `${item.free_text_count} isian teks dalam dataset.` : 'Belum ada jawaban'}
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <ul className="flex flex-col">
                  {item.options.map((option) => (
                    <li key={option.option_id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-n200 py-2 last:border-0">
                      <Code>{option.value ?? '—'}</Code>
                      <span className="min-w-0 flex-1 text-body-sm text-ink">{option.label}</span>
                      <span className="text-body-sm font-bold text-ink">{option.count}</span>
                      <span className="w-12 text-right text-body-sm text-muted">
                        {item.answered === 0 ? '—' : `${Math.round((option.count / item.answered) * 100)}%`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {item.answered === 0 && item.type !== 'short_text' && (
                <Banner tone="neutral" title="Belum ada jawaban">Penyebut nol tidak dibagi; opsi tetap ditampilkan sebagai nol.</Banner>
              )}
            </Card>
          ))}
          {!loading && summary && summary.total === 0 && (
            <Banner tone="neutral" title="Belum ada respons">Versi ini belum menerima kiriman final.</Banner>
          )}

          <Card className="flex flex-col gap-3">
            <SectionTitle>Jawaban individual</SectionTitle>
            <p className="text-body-sm text-muted">
              Akses ini memerlukan izin membaca jawaban individual dan setiap pembacaan tercatat pada log audit.{' '}
              {freeTextAllowed
                ? 'Isian teks bebas hanya untuk penerima berizin; akun ini sudah memegang izin itu.'
                : 'Teks bebas hanya tampil dengan izin terpisah.'}
            </p>
            <div>
              <Button variant="secondary" loading={responsesBusy} disabled={responsesBusy || denied || !individualAllowed || !versionId} onClick={loadResponses}>
                Muat jawaban individual
              </Button>
            </div>
            {!individualAllowed && !responsesError && (
              <Banner tone="info" title="Izin baca individual diperlukan">
                Akun ini belum memiliki izin membaca jawaban individual pada survei ini.
              </Banner>
            )}
            {responsesDenied && (
              <Banner tone="danger" title="Akses jawaban individual ditolak">
                Izin baca jawaban individual tidak diberikan untuk akun ini pada survei ini.
              </Banner>
            )}
            {responsesError && !responsesDenied && (
              <Banner tone="danger" title="Jawaban individual gagal dimuat">{responsesError.message}</Banner>
            )}
            {responses && responses.length === 0 && (
              <Banner tone="neutral" title="Belum ada jawaban">Versi ini belum memiliki respons final.</Banner>
            )}
            {responses && responses.length > 0 && (
              <ul className="flex flex-col gap-3">
                {responses.map((response) => (
                  <li key={response.id} className="rounded-md border border-n200 p-3">
                    <p className="font-mono text-caption text-muted">
                      {response.id} · {formatWIB(response.submitted_at)} · {COLLECTION_MODE_LABEL[response.collection_mode] ?? response.collection_mode}
                    </p>
                    <ul className="mt-2 flex flex-col gap-1">
                      {response.answers.map((answer) => (
                        <li key={`${response.id}-${answer.question_code}`} className="grid gap-1 text-body-sm sm:grid-cols-[8rem_1fr]">
                          <span className="font-mono font-bold text-ink">{answer.question_code}</span>
                          <span className="text-ink">
                            {answer.skipped
                              ? 'Dilewati'
                              : answer.text !== null
                                ? answer.text
                                : answer.value !== null
                                  ? String(answer.value)
                                  : '—'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="flex flex-col gap-3">
            <SectionTitle>Ekspor</SectionTitle>
            {denied ? (
              <Banner tone="danger" title="Ekspor ditolak">
                Akun ini tidak memiliki izin membaca hasil pada survei ini. Percobaan akses langsung ke URL tidak mengubah hasil.
              </Banner>
            ) : !exportAllowed ? (
              <Banner tone="info" title="Izin ekspor diperlukan">
                Akun ini belum memiliki izin ekspor pada survei ini. Administrator dapat memberikan izin ekspor terpisah.
              </Banner>
            ) : csvBlockedReason ? (
              <Banner tone="info" title="Hanya kodebook yang dapat diunduh">
                <span id="alasan-csv-nonaktif">{csvBlockedReason}</span>
              </Banner>
            ) : (
              <Banner tone="info" title="Ekspor diizinkan">
                CSV UTF-8 per versi dan kodebook. Nama tidak masuk ekspor standar; token tidak pernah diekspor.
              </Banner>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="ekspor-penerima" label="Penerima data" hint="Untuk siapa ekspor ini dibuat. Wajib sebelum mengunduh CSV per-responden." required>
                {(aria) => <TextInput {...aria} maxLength={200} value={exportRecipient} onChange={(e) => setExportRecipient(e.target.value)} />}
              </Field>
              <Field id="ekspor-tujuan" label="Pemakaian data" hint="Untuk apa data dipakai. Dicatat di jejak audit." required>
                {(aria) => <TextInput {...aria} maxLength={200} value={exportPurpose} onChange={(e) => setExportPurpose(e.target.value)} />}
              </Field>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="secondary"
                disabled={!csvAllowed || denied || !summary || !summary.total || loading || busy || !exportContextReady}
                aria-describedby={!denied && csvBlockedReason ? 'alasan-csv-nonaktif' : undefined}
                loading={busy}
                onClick={() => {
                  setBusy(true);
                  void downloadExport(id, versionId, 'csv', { recipient: exportRecipient.trim(), purpose: exportPurpose.trim() })
                    .then(({ blob, filename }) => {
                      const url = URL.createObjectURL(blob);
                      const anchor = document.createElement('a');
                      anchor.href = url;
                      anchor.download = filename;
                      anchor.click();
                      URL.revokeObjectURL(url);
                      setExportRequested(true);
                      notify('CSV diunduh.');
                    })
                    .catch((error: unknown) => notify(error instanceof Error ? error.message : 'Ekspor gagal.', 'danger'))
                    .finally(() => setBusy(false));
                }}
              >
                {exportRequested ? 'CSV sudah diunduh' : 'Unduh CSV'}
              </Button>
              <Button
                variant="secondary"
                disabled={!exportAllowed || denied || !summary || loading || busy}
                onClick={() => {
                  setBusy(true);
                  void downloadExport(id, versionId, 'codebook')
                    .then(({ blob, filename }) => {
                      const url = URL.createObjectURL(blob);
                      const anchor = document.createElement('a');
                      anchor.href = url;
                      anchor.download = filename;
                      anchor.click();
                      URL.revokeObjectURL(url);
                      notify('Kodebook diunduh.');
                    })
                    .catch((error: unknown) => notify(error instanceof Error ? error.message : 'Ekspor gagal.', 'danger'))
                    .finally(() => setBusy(false));
                }}
              >
                Unduh kodebook
              </Button>
            </div>
            <p className="text-caption text-muted">
              Teks bebas dan jawaban individual memerlukan izin terpisah; aktivitas ekspor tercatat pada log audit.
            </p>
          </Card>
        </div>
      </StateView>
      
    </Shell>
  );
}

/* ---------------- Pengaturan ---------------- */

export function SettingsPage({ id }: { id: string }) {
  const notify = useToast();
  const { settings, revision, session } = useStore();
  void revision;
  const { state } = useScreenState('creator-settings');
  const profile = surveyProfileOf(id);
  // NR-04: notice dipilih server dari sumber kebijakan survei ini (`surveyNotices`), sama dengan
  // halaman publik. Daftar `notices` legacy berkunci profil, bukan survei, jadi tidak dipakai di sini.
  const notice = surveyNoticeOf(id) ?? null;
  const survey = findSurvey(id);
  const canManage = canManageAs(session, survey);
  const [allowResults, setAllowResults] = useState(settings[id]?.allowResults ?? true);
  const [allowIndividual, setAllowIndividual] = useState(settings[id]?.allowIndividual ?? false);
  const [consentRequired, setConsentRequired] = useState<ConsentRequired>(settings[id]?.consentRequired ?? 'tidak');
  const [busy, setBusy] = useState(false);
  // Bukti pendukung hanya untuk survei organisasi; survei personal selalu persetujuan diri.
  const organizationSurvey = Boolean(survey?.organization_id);

  // Sinkronkan dari server setelah bootstrap; perubahan lokal sesudahnya tetap dipakai.
  useEffect(() => {
    setAllowResults(settings[id]?.allowResults ?? true);
    setAllowIndividual(settings[id]?.allowIndividual ?? false);
    setConsentRequired(settings[id]?.consentRequired ?? 'tidak');
  }, [id, settings]);

  if (!survey || !canManage) {
    return (
      <Shell kind="creator" title="Pengaturan dan pemberitahuan" subtitle="Survei tidak ditemukan.">
        <MissingSurvey />
      </Shell>
    );
  }

  return (
    <Shell kind="creator" title="Pengaturan dan pemberitahuan" subtitle="Kelola pemberitahuan, retensi, dan hak akses hasil untuk survei ini.">
      <StateView
        routeId="creator-settings"
        state={state}
        permissionDetail="Pengaturan hanya dapat diubah pemilik atau admin organisasi survei."
      >
        <div className="flex flex-col gap-5">
          
          <SurveyNav id={id} />
          {state === 'success' && <SuccessBanner title="Pengaturan tersimpan">Hak akses hasil dan kebutuhan bukti persetujuan diperbarui.</SuccessBanner>}
          {state === 'validation' && <ValidationSummary items={['Kontak permintaan data tidak boleh kosong.', 'Masa retensi harus ditetapkan.']} />}

          <Card className="flex flex-col gap-4">
            <SectionTitle>Kebijakan yang berlaku</SectionTitle>
            {profile ? (
              <Table head={['Bagian', 'Nilai']}>
                <tr><Th>Nama organisasi</Th><Td>{profile.organization_name}</Td></tr>
                <tr><Th>Tipe organisasi</Th><Td>{ORGANIZATION_TYPE_LABEL[profile.organization_type]}</Td></tr>
                <tr><Th>Kebutuhan bukti persetujuan</Th><Td>{CONSENT_REQUIRED_LABEL[consentRequired]}</Td></tr>
                <tr><Th>Masa retensi</Th><Td>{profile.retention_days === null ? 'Mengikuti kebijakan pengendali' : `${profile.retention_days} hari`}</Td></tr>
                <tr><Th>Kontak permintaan data</Th><Td><ContactChannel contact={profile.data_request_contact} empty="Belum ditetapkan pengendali." /></Td></tr>
                <tr><Th>Transfer data lintas negara</Th><Td>{profile.cross_border_transfer === null ? 'Belum ditinjau' : profile.cross_border_transfer ? 'Ya' : 'Tidak'}</Td></tr>
                <tr><Th>Kebijakan dan ketentuan</Th><Td><PlainLink to={ROUTES.privacy} className="min-h-[44px]">Kebijakan privasi</PlainLink> · <PlainLink to={ROUTES.terms} className="min-h-[44px]">Ketentuan layanan</PlainLink></Td></tr>
              </Table>
            ) : (
              <p className="text-body-sm text-muted">Profil kebijakan survei ini belum tersedia.</p>
            )}
            <Banner tone="info" title="Sumber konfigurasi">
              {profile?.source === 'organization' ? 'Kebijakan organisasi' : 'Kebijakan platform'}
              {' · '}
              Nama, ketentuan, dan retensi dibaca dari profil kebijakan server untuk survei ini.
            </Banner>
          </Card>

          <Card className="flex flex-col gap-3">
            <SectionTitle>Pemberitahuan per survei</SectionTitle>
            {notice ? (
              <>
                <p className="font-mono text-caption tracking-mono text-muted">Versi pemberitahuan: {notice.version}</p>
                <Table head={['Bagian', 'Isi']}>
                  <tr><Th>Tujuan</Th><Td>{notice.purpose}</Td></tr>
                  <tr><Th>Jenis data</Th><Td>{notice.data_categories}</Td></tr>
                  <tr><Th>Penerusan data ke pihak lain</Th><Td>{notice.module15_usage}</Td></tr>
                  <tr><Th>Retensi</Th><Td>{notice.retention_text}</Td></tr>
                  <tr><Th>Penerima</Th><Td>{notice.recipients}</Td></tr>
                  <tr><Th>Kontak</Th><Td>{notice.contact}</Td></tr>
                  <tr><Th>Hak peserta</Th><Td>{notice.rights}</Td></tr>
                  <tr><Th>Persetujuan dengan bukti pendukung</Th><Td>{notice.child_data_text}</Td></tr>
                </Table>
              </>
            ) : (
              <p className="text-body-sm text-muted">Pemberitahuan untuk profil kebijakan survei ini belum tersedia.</p>
            )}
            <p className="text-caption text-muted">Perubahan material membuat versi notice baru; persetujuan lama tetap merujuk versi yang disetujui.</p>
          </Card>

          <Card className="flex flex-col gap-3">
            <SectionTitle>Persetujuan pada survei ini</SectionTitle>
            <Field
              id="consent-required"
              label="Kebutuhan bukti persetujuan"
              hint={
                organizationSurvey
                  ? 'Persetujuan diri cukup untuk sebagian besar survei. Pilih bukti pendukung bila organisasi perlu menyimpan berkas persetujuan di samping pernyataan responden.'
                  : 'Survei personal selalu memakai persetujuan diri. Buat survei lingkup organisasi untuk mewajibkan bukti pendukung.'
              }
            >
              {(aria) => (
                <select
                  {...aria}
                  value={consentRequired}
                  disabled={!organizationSurvey || state === 'loading' || state === 'closed'}
                  onChange={(event) => setConsentRequired(event.target.value as ConsentRequired)}
                  className="min-h-[52px] w-full rounded-md border border-control-border bg-n0 px-3 text-body-sm text-ink disabled:bg-n50 disabled:text-muted"
                >
                  <option value="tidak">{CONSENT_REQUIRED_LABEL.tidak}</option>
                  {organizationSurvey && <option value="wajib_upload">{CONSENT_REQUIRED_LABEL.wajib_upload}</option>}
                </select>
              )}
            </Field>
            <p className="text-caption text-muted">
              Bukti yang diunggah dicatat sebagai pernyataan responden, bukan verifikasi otomatis. Tanpa bukti, kiriman pada
              survei yang mewajibkannya ditolak server.
            </p>
          </Card>

          <Card className="flex flex-col gap-3">
            <SectionTitle>Akses hasil</SectionTitle>
            <Checkbox id="izin-agregat" label="Pembuat survei boleh melihat ringkasan agregat" checked={allowResults} onChange={setAllowResults} />
            <Checkbox id="izin-individual" label="Pembuat survei boleh membaca jawaban individual" checked={allowIndividual} onChange={setAllowIndividual} />
            <p className="text-caption text-muted">
              Izin baca individual, izin ekspor, dan izin teks bebas adalah tiga izin terpisah.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button disabled={state === 'loading' || state === 'closed' || busy} loading={busy} onClick={() => {
                setBusy(true);
                void saveSettings(id, allowResults, allowIndividual, organizationSurvey ? consentRequired : 'tidak')
                  .then(() => notify('Pengaturan berhasil disimpan.'))
                  .catch((error: unknown) => notify(error instanceof Error ? error.message : 'Pengaturan gagal disimpan.', 'danger'))
                  .finally(() => setBusy(false));
              }}>Simpan pengaturan</Button>
            </div>
          </Card>
        </div>
      </StateView>
      
    </Shell>
  );
}

/* ---------------- Riwayat versi ---------------- */

export function HistoryPage({ id }: { id: string }) {
  const notify = useToast();
  const { revision, session } = useStore();
  void revision;
  const { state, link } = useScreenState('creator-history');
  const survey = findSurvey(id);
  const canManage = canManageAs(session, survey);
  const versionList = versionsFor(id);
  const activeVersion = versionList.find((version) => version.status === 'published');
  const archived = survey?.status === 'archived' || state === 'closed';
  const [pending, setPending] = useState<'close' | 'archive' | null>(null);
  const [busy, setBusy] = useState(false);

  if (!survey || !canManage) {
    return (
      <Shell kind="creator" title="Riwayat versi" subtitle="Survei tidak ditemukan.">
        <MissingSurvey />
      </Shell>
    );
  }

  const historyBody = (
    <Shell kind="creator" title="Riwayat versi" subtitle="Lihat versi yang pernah diterbitkan, tutup penerimaan, atau arsipkan survei.">
      <StateView
        routeId="creator-history"
        state={state}
        emptyTitle="Belum ada versi"
        emptyDetail="Versi dibuat saat publikasi pertama."
        permissionDetail="Riwayat hanya dapat dibaca pemilik atau admin organisasi survei."
      >
        <div className="flex flex-col gap-5">
          
          <SurveyNav id={id} />
          {state === 'success' && <SuccessBanner title="Status versi diperbarui">Riwayat tetap tersimpan.</SuccessBanner>}
          {state === 'closed' && <Banner tone="warning" title="Versi lama ditutup">Kiriman baru ditolak; riwayat versi lama tetap dapat dibaca.</Banner>}

          <Card className="flex flex-col gap-3">
            <SectionTitle>Daftar versi</SectionTitle>
            <Table head={['Versi', 'Status', 'Diterbitkan', 'Ditutup', 'Jumlah item']}>
              {versionList.map((v) => (
                <tr key={v.id}>
                  <Th><Code>v{v.number}</Code></Th>
                  <Td><Badge tone={v.status === 'published' ? 'success' : v.status === 'closed' ? 'warning' : 'neutral'}>{STATUS_LABEL[v.status]}</Badge></Td>
                  <Td>{v.published_at ? formatWIB(v.published_at) : 'Belum ada'}</Td>
                  <Td>{v.closed_at ? formatWIB(v.closed_at) : 'Belum ada'}</Td>
                  <Td>{questionsFor(v.id).length}</Td>
                </tr>
              ))}
            </Table>
          </Card>

          <Card className="flex flex-col gap-3">
            <SectionTitle>Aturan siklus hidup</SectionTitle>
            <ul className="flex list-inside list-disc flex-col gap-2 text-body-sm text-ink">
              <li>Draf ke terbit menghasilkan snapshot tetap beserta tautan yang mengarah ke versi itu.</li>
              <li>Formulir A yang sedang dibuka tetap mengirim ke A selama penerimaan A masih terbuka.</li>
              <li>Penutupan menghentikan kiriman baru dan merekam waktu penutupan.</li>
              <li>Pengarsipan mengatur visibilitas pengelolaan tanpa menghapus riwayat.</li>
              <li>Salin survei tidak membawa respons, undangan, izin khusus, atau bukti persetujuan.</li>
            </ul>
            <Panel className="mt-2">
              <p className="text-body-sm font-bold text-ink">Contoh versi A dan B</p>
              <p className="mt-1 text-body-sm text-muted">
                Versi 2 berstatus draf. Formulir yang terbuka pada versi 1 tidak dipindahkan diam-diam ke versi 2.
              </p>
            </Panel>
          </Card>

          <div className="flex flex-wrap gap-3">
            <Button
              variant="danger"
              disabled={state === 'loading' || !activeVersion || busy}
              onClick={() => setPending('close')}
            >
              {activeVersion ? `Tutup versi ${activeVersion.number}` : 'Tidak ada versi aktif'}
            </Button>
            <Button
              variant="danger"
              disabled={state === 'loading' || archived || busy}
              onClick={() => setPending('archive')}
            >
              {archived ? 'Survei sudah diarsipkan' : 'Arsipkan survei'}
            </Button>
            <ActionLink to={link(ROUTES.creatorResults(id))} variant="secondary">Lihat hasil per versi</ActionLink>
          </div>
        </div>
      </StateView>

    </Shell>
  );

  return (
    <>
      {historyBody}
      <ConfirmDialog
        open={pending !== null}
        tone="danger"
        title={pending === 'archive' ? 'Arsipkan survei ini?' : `Tutup versi ${activeVersion?.number ?? ''}?`}
        detail={pending === 'archive'
          ? 'Survei disembunyikan dari daftar aktif dan semua tautan publiknya ditutup. Riwayat, respons, dan versi tetap tersimpan.'
          : 'Responden tidak dapat lagi mengirim jawaban ke versi ini. Versi yang sudah ditutup tidak dapat dibuka kembali.'}
        confirmLabel={pending === 'archive' ? 'Arsipkan survei' : 'Tutup versi'}
        busy={busy}
        onClose={() => setPending(null)}
        onConfirm={() => {
          const action = pending;
          if (!action) return;
          setBusy(true);
          const request = action === 'archive' ? archiveSurvey(id) : closeVersion(id);
          void request
            .then(() => {
              notify(action === 'archive' ? 'Survei diarsipkan. Riwayat tetap dapat dibaca.' : `Versi ${activeVersion?.number ?? ''} ditutup. Kiriman baru tidak diterima.`);
              setPending(null);
            })
            .catch((error: unknown) => notify(error instanceof Error ? error.message : 'Tindakan gagal.', 'danger'))
            .finally(() => setBusy(false));
        }}
      />
    </>
  );
}
