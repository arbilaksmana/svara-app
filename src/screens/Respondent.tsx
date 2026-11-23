'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Shell } from '../components/Shell';
import {
  ActionLink,
  Badge,
  Banner,
  BlockedNotice,
  Button,
  Card,
  Checkbox,
  Code,
  ConfirmDialog,
  Divider,
  Field,
  Label,

  Panel,
  PlainLink,
  PolicyLinks,
  SectionTitle,
  Table,
  Td,
  TextArea,
  TextInput,
  Th,
} from '../components/ui';
import { StateView, SuccessBanner, ValidationSummary } from '../components/StateView';
import { useScreenState } from '../lib/state';
import { ROUTES } from '../lib/routes';
import { useToast } from '../components/Toast';
import { GuardianEvidenceSummary } from '../components/GuardianEvidence';
import { formatWIB } from '../lib/summary';
import { RECEIPT_STATUS_LABEL } from '../lib/labels';
import {
  attemptGateNeeded,
  clearFlowEntry,
  completeSubmission,
  discardAttempt,
  hasDraft,
  hasUnsentAttempt,
  markFlowEntry,
  readConsent,
  readReceipt,
  saveReceipt,
  submissionKey,
  useDraft,
  writeConsent,
  type StoredReceipt,
} from '../lib/draft';
import {
  ApiError,
  createConsent,
  getReceipt,
  publicContext,
  publicForm,
  submitResponse,
  type ConsentPayload,
  type PublicContextData,
  type ReceiptData,
} from '../lib/api';

const INVITE_LABEL_ID: Record<string, string> = {
  active: 'Aktif', used: 'Terpakai', revoked: 'Dicabut', expired: 'Kedaluwarsa',
};

interface PublicPage {
  token: string;
  ctx: PublicContextData | null;
  loading: boolean;
  loadError: Error | null;
  reload: () => void;
}

function usePublicPage(token: string, view: 'intro' | 'form' | 'review' = 'intro'): PublicPage {
  const [ctx, setCtx] = useState<PublicContextData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    const consent = view === 'intro' ? null : readConsent(token);
    const request = consent && view !== 'intro' ? publicForm(token, consent.consent_id, view) : publicContext(token);
    void request
      .then((data) => {
        if (!cancelled) setCtx(data);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setCtx(null);
          setLoadError(error instanceof Error ? error : new Error('Tautan tidak dapat dimuat.'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, view, reloadCount]);

  return { token, ctx, loading, loadError, reload: () => setReloadCount((count) => count + 1) };
}

function isInvitationUsed(ctx: PublicContextData): boolean {
  return ctx.state === 'used' || ctx.invitation?.status === 'used';
}

function serverState(ctx: PublicContextData): 'default' | 'closed' | 'expired' | 'revoked' {
  if (ctx.state === 'active' || ctx.state === 'used') return 'default';
  return ctx.state;
}

function PublicLoading() {
  return (
    <Shell kind="respondent" title="Memuat tautan">
      <Card>
        <p className="text-body font-bold text-ink" aria-busy="true">Memeriksa tautan dan versi…</p>
      </Card>
    </Shell>
  );
}

interface LoadFailure {
  title: string;
  detail: string;
  retry?: boolean;
  blockedState?: 'closed' | 'expired' | 'revoked';
  next?: 'intro' | 'receipt';
}

const BLOCKED_CODES: Record<string, LoadFailure['blockedState']> = {
  link_revoked: 'revoked',
  link_expired: 'expired',
  submission_revoked: 'revoked',
  submission_expired: 'expired',
  submission_closed: 'closed',
};

const CONSENT_CODES = new Set([
  'consent_required', 'consent_context_mismatch', 'consent_already_used', 'consent_expired', 'guardian_evidence_required',
]);

/** UIX-07: hanya gangguan jaringan atau server sementara yang ditawari "Coba lagi"; status tautan final tidak. */
function loadFailure(error: Error): LoadFailure {
  if (!(error instanceof ApiError) || error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500) {
    return {
      title: 'Gangguan koneksi atau server',
      detail: 'Periksa koneksi internet Anda, lalu coba lagi.',
      retry: true,
    };
  }
  if (error.status === 404) {
    return {
      title: 'Tautan tidak dikenal',
      detail: 'Alamat ini tidak cocok dengan survei mana pun. Periksa kembali tautannya atau minta tautan baru dari pengelola survei.',
    };
  }
  const blockedState = BLOCKED_CODES[error.code];
  if (blockedState) {
    return { title: 'Tautan sudah tidak aktif', detail: 'Tautan ini tidak lagi menerima jawaban baru.', blockedState };
  }
  if (error.code === 'submission_used') {
    return {
      title: 'Undangan individual sudah dipakai',
      detail: 'Satu undangan hanya menerima satu respons final.',
      next: 'receipt',
    };
  }
  if (CONSENT_CODES.has(error.code)) {
    return {
      title: 'Persetujuan perlu dicatat ulang',
      detail: 'Persetujuan untuk sesi ini tidak berlaku lagi. Buka pengantar, baca pemberitahuan, lalu setujui kembali untuk melanjutkan.',
      next: 'intro',
    };
  }
  return {
    title: 'Tautan tidak dapat dibuka',
    detail: 'Tautan ini tidak dapat dipakai saat ini. Hubungi pengelola survei bila Anda yakin tautannya benar.',
  };
}

export function PublicLoadError({ token, error, onRetry }: { token: string; error: Error; onRetry: () => void }) {
  const failure = loadFailure(error);
  return (
    <Shell kind="respondent" title={failure.retry ? 'Survei belum dapat dimuat' : 'Tautan tidak dapat dibuka'}>
      <Card>
        <div role="alert">
          <p className="text-body font-bold text-ink">{failure.title}</p>
          <p className="mt-2 text-body-sm text-muted">{failure.detail}</p>
        </div>
        {failure.blockedState && <div className="mt-4"><BlockedNotice state={failure.blockedState} /></div>}
        <div className="mt-4 flex flex-wrap gap-3">
          {failure.retry && <Button onClick={onRetry}>Coba lagi</Button>}
          {failure.next === 'intro' && <ActionLink to={ROUTES.respondentIntro(token)}>Buka pengantar</ActionLink>}
          {failure.next === 'receipt' && <ActionLink to={ROUTES.respondentReceipt(token)}>Lihat bukti pengiriman</ActionLink>}
          <ActionLink to={ROUTES.home} variant="secondary">Kembali ke beranda</ActionLink>
        </div>
      </Card>
    </Shell>
  );
}

function Progress({ step }: { step: 1 | 2 | 3 | 4 }) {
  const labels = ['Pengantar', 'Formulir', 'Tinjau', 'Bukti'];
  return (
    <ol className="mb-5 flex flex-wrap gap-2" aria-label="Progres pengisian">
      {labels.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3 | 4;
        const current = n === step;
        const done = n < step;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              aria-current={current ? 'step' : undefined}
              className={`grid size-7 place-items-center rounded-full font-mono text-caption font-bold ${
                current ? 'bg-action text-n0' : done ? 'bg-success-soft text-success' : 'bg-n100 text-n600'
              }`}
            >
              {n}
            </span>
            <span className={`text-body-sm ${current ? 'font-bold text-ink' : 'text-muted'}`}>{label}</span>
            {i < labels.length - 1 && <span aria-hidden="true" className="text-n400">·</span>}
          </li>
        );
      })}
    </ol>
  );
}

function MissingToken() {
  return (
    <Shell kind="respondent" title="Tautan tidak dikenal">
      <Card>
        <p className="text-body text-ink">Token pada URL tidak cocok dengan tautan aktif mana pun.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <ActionLink to={ROUTES.home} variant="secondary">Kembali ke beranda</ActionLink>
        </div>
      </Card>
    </Shell>
  );
}

/* ---------------- Pengantar + notice ---------------- */

/** `unsent`: tab menyimpan isian token ini yang belum dikirim dan responden belum memilih; `resumed`: memilih melanjutkan. */
export type IntroAttempt = 'none' | 'unsent' | 'resumed';

export function IntroPage({ token }: { token: string }) {
  const { ctx, loading, loadError, reload } = usePublicPage(token);
  // Dibaca dari penyimpanan tab sesudah mount; disimpan di sini agar pilihan responden bertahan saat konteks dimuat ulang.
  const [attempt, setAttempt] = useState<IntroAttempt | null>(null);

  useEffect(() => {
    setAttempt(hasUnsentAttempt(token) ? 'unsent' : 'none');
  }, [token]);

  if (loading || attempt === null) return <PublicLoading />;
  if (loadError) return <PublicLoadError token={token} error={loadError} onRetry={reload} />;
  if (!ctx) return <MissingToken />;
  return (
    <IntroView
      token={token}
      ctx={ctx}
      attempt={attempt}
      onChoose={(choice) => setAttempt(choice === 'resume' ? 'resumed' : 'none')}
      reload={reload}
    />
  );
}

/**
 * SEC-07/BF-08: isian yang ditinggalkan sebelum bukti tidak diteruskan diam-diam ke orang berikutnya di tab yang sama.
 * "Mulai sebagai responden baru" menghapus persetujuan, draft, dan kunci kirim token ini; "Lanjutkan" mempertahankannya
 * sehingga retry identik sebelum bukti tetap memakai kunci yang sama.
 */
export function UnsentAttemptChoice({ token, onChoose }: { token: string; onChoose: (choice: 'resume' | 'restart') => void }) {
  const [confirming, setConfirming] = useState(false);

  const restart = () => {
    setConfirming(false);
    discardAttempt(token);
    onChoose('restart');
  };

  return (
    <UnsentAttemptChoiceView
      confirming={confirming}
      onResume={() => onChoose('resume')}
      onRequestRestart={() => {
        // Persetujuan atau kunci kirim saja tidak memuat jawaban, jadi tidak perlu konfirmasi.
        if (hasDraft(token)) setConfirming(true);
        else restart();
      }}
      onCancelRestart={() => setConfirming(false)}
      onConfirmRestart={restart}
    />
  );
}

export function UnsentAttemptChoiceView({
  confirming,
  onResume,
  onRequestRestart,
  onCancelRestart,
  onConfirmRestart,
}: {
  confirming: boolean;
  onResume: () => void;
  onRequestRestart: () => void;
  onCancelRestart: () => void;
  onConfirmRestart: () => void;
}) {
  return (
    <>
      <Card className="flex flex-col gap-3">
        <SectionTitle>Ada isian yang belum dikirim</SectionTitle>
        <p className="text-body-sm text-muted">
          Tab ini masih menyimpan persetujuan atau jawaban untuk survei ini yang belum dikirim. Bila itu isian Anda,
          lanjutkan; jawaban yang tersimpan muncul lagi setelah Anda menyetujui pemberitahuan. Bila bukan, mulai sebagai
          responden baru agar isian itu dihapus dari tab ini.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={onResume}>Lanjutkan isian sebelumnya</Button>
          <Button variant="secondary" onClick={onRequestRestart}>
            Mulai sebagai responden baru
          </Button>
        </div>
      </Card>
      <ConfirmDialog
        open={confirming}
        title="Hapus isian yang belum dikirim?"
        detail="Persetujuan, jawaban, dan kunci kirim yang tersimpan di tab ini akan dihapus untuk survei ini. Isian yang sudah dikirim tidak terpengaruh."
        confirmLabel="Hapus isian"
        onClose={onCancelRestart}
        onConfirm={onConfirmRestart}
      />
    </>
  );
}

export function IntroView({
  token,
  ctx,
  attempt,
  onChoose,
  reload,
}: {
  token: string;
  ctx: PublicContextData;
  attempt: IntroAttempt;
  onChoose: (choice: 'resume' | 'restart') => void;
  reload: () => void;
}) {
  // Muat ulang intro membatalkan konteks lama: kosongkan pilihan agar responden menyetujui ulang notice yang tampil.
  const consentVersion = ctx.consent_version;
  useEffect(() => {
    setConsent(false);
    setEligibility(false);
    setGuardianEvidence(false);
    setGuardianRef('');
    setConsentError(null);
  }, [consentVersion]);
  const { state } = useScreenState('respondent-intro');
  const router = useRouter();
  const notify = useToast();
  const [consent, setConsent] = useState(false);
  const [guardianEvidence, setGuardianEvidence] = useState(false);
  const [guardianRef, setGuardianRef] = useState('');
  const [eligibility, setEligibility] = useState(false);
  const [busy, setBusy] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);

  const { survey, version, isPublicLink, invitation, notice, guardianRequired } = ctx;
  const effectiveState = state === 'default' ? serverState(ctx) : state;
  const usedInvite = isInvitationUsed(ctx);
  const blocked = ['closed', 'expired', 'revoked', 'permission-denied', 'error', 'loading'].includes(effectiveState) || usedInvite;
  const consentComplete = state === 'success' || (consent && eligibility && (!guardianRequired || (guardianEvidence && guardianRef.trim().length > 0)));
  // Persetujuan baru tidak dapat dicatat sebelum responden memilih nasib isian yang tertinggal di tab ini.
  const choosing = attempt === 'unsent' && !blocked;
  const wasChoosing = useRef(choosing);
  useEffect(() => {
    // Kartu pilihan diganti kartu persetujuan: pindahkan fokus agar tidak jatuh ke body.
    if (wasChoosing.current && !choosing) document.getElementById('consent-kelayakan')?.focus();
    wasChoosing.current = choosing;
  }, [choosing]);

  return (
    <Shell kind="respondent" title={survey.title} subtitle={`Pengantar dan pemberitahuan · versi ${version.number}`}>
      <StateView
        routeId="respondent-intro"
        state={effectiveState}
        permissionDetail="Akses ke tautan ini tidak tersedia untuk konteks Anda."
      >
        <div className="mx-auto flex max-w-[720px] flex-col gap-5">
          <Progress step={1} />
          
          {usedInvite && <Banner tone="warning" title="Undangan individual sudah dipakai">Satu undangan hanya menerima satu respons final. Buka tautan bukti bila perlu memeriksa pengiriman sebelumnya.</Banner>}
          {effectiveState === 'success' && <SuccessBanner title="Persetujuan tercatat">Lanjutkan ke formulir.</SuccessBanner>}
          {effectiveState === 'validation' && <ValidationSummary items={['Persetujuan wajib belum lengkap.', 'Konfirmasi kelayakan konteks belum dicentang.']} />}

          <Panel className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">Versi {version.number}</Badge>
              <Badge tone={isPublicLink ? 'neutral' : 'info'}>{isPublicLink ? 'Tautan umum' : 'Undangan individual'}</Badge>
              <Badge tone={guardianRequired ? 'warning' : 'neutral'}>{guardianRequired ? 'Mode wali' : 'Persetujuan diri'}</Badge>
            </div>
            <p className="text-body-sm text-ink"><span className="font-bold">Tujuan survei:</span> {survey.purpose}</p>
            <p className="text-caption text-muted">Objek: {survey.object_label}</p>
          </Panel>

          <Card className="flex flex-col gap-3">
            <SectionTitle>Pemberitahuan sebelum item pertama</SectionTitle>
            <p className="font-mono text-caption tracking-mono text-muted">Pemberitahuan versi {notice.version} · berlaku {notice.effective_date}</p>
            <dl className="flex flex-col gap-3">
              {[
                ['Tujuan', notice.purpose],
                ['Jenis data', notice.data_categories],
                ['Penggunaan Modul 15', notice.module15_usage],
                ['Retensi', notice.retention_text],
                ['Penerima', notice.recipients],
                ['Kontak', notice.contact],
                ['Hak Anda', notice.rights],
                ['Data anak', notice.child_data_text],
                ['Transfer lintas negara', notice.cross_border_text],
              ].map(([term, detail]) => (
                <div key={term} className="border-b border-n200 pb-3 last:border-0 last:pb-0">
                  <dt className="text-caption font-bold text-muted">{term}</dt>
                  <dd className="mt-1 break-words text-body-sm text-ink">{detail}</dd>
                </div>
              ))}
            </dl>
            <Banner tone="info" title="Tentang pemberitahuan ini">
              Pemberitahuan dapat dibaca tanpa akun dan tetap tersedia setelah versi survei ditutup.
            </Banner>
            <PolicyLinks className="border-t border-n200 pt-3" />
          </Card>

          {choosing ? (
            <UnsentAttemptChoice
              token={token}
              onChoose={(choice) => {
                if (choice === 'restart') notify('Isian sebelumnya dihapus dari tab ini.');
                onChoose(choice);
              }}
            />
          ) : (
            <>
              <Card className="flex flex-col gap-3">
                <SectionTitle>Persetujuan</SectionTitle>
                <Checkbox
                  id="consent-kelayakan"
                  label="Saya mengonfirmasi kelayakan konteks pengisian ini."
                  checked={eligibility}
                  onChange={setEligibility}
                />
                <Checkbox
                  id="consent-utama"
                  label={<>Saya telah membaca pemberitahuan di atas dan menyetujui pemrosesan jawaban untuk tujuan survei ini.</>}
                  checked={consent}
                  onChange={setConsent}
                />
                {guardianRequired && (
                  <div className="rounded-md border border-warning-soft bg-n50 p-3">
                    <p className="text-body-sm font-bold text-ink">Bukti wali wajib</p>
                    <p className="mt-1 text-body-sm text-muted">
                      Survei ini ditujukan untuk responden anak. Kiriman baru ditolak bila pernyataan wali belum dicentang atau
                      referensi bukti persetujuan belum diisi. Aplikasi mencatat referensi itu apa adanya dan tidak memeriksa keasliannya.
                    </p>
                    <div className="mt-2 flex flex-col gap-2">
                      <Checkbox
                        id="consent-wali"
                        label="Saya menyatakan memiliki bukti persetujuan wali. Statusnya dicatat sebagai pernyataan, belum diverifikasi pengelola."
                        checked={guardianEvidence}
                        onChange={setGuardianEvidence}
                      />
                      <Field id="guardian-ref" label="Referensi bukti persetujuan wali" required>
                        {(aria) => (
                          <TextInput
                            {...aria}
                            value={guardianRef}
                            onChange={(e) => setGuardianRef(e.target.value)}
                            placeholder="Contoh: surat izin orang tua/wali 12/XI/2026"
                          />
                        )}
                      </Field>
                    </div>
                  </div>
                )}
                {!guardianRequired && (
                  <p className="text-caption text-muted">Persetujuan diri tetap mencatat ConsentRecord dan versi notice.</p>
                )}
                {invitation && (
                  <p className="text-caption text-muted">
                    Undangan individual: <Code>{invitation.code}</Code>. Status <Badge tone={invitation.status === 'active' ? 'success' : 'neutral'}>{INVITE_LABEL_ID[invitation.status]}</Badge>
                  </p>
                )}
              </Card>

              <div className="flex flex-col gap-2">
                {consentError && <Banner tone="danger" title="Persetujuan gagal dicatat">{consentError}</Banner>}
                <Button
                  block
                  disabled={!consentComplete || blocked || busy}
                  loading={busy}
                  onClick={() => {
                    setBusy(true);
                    setConsentError(null);
                    void createConsent(token, ctx.consent_version, guardianRequired ? guardianRef.trim() : null)
                      .then((record) => {
                        writeConsent(token, {
                          consent_id: record.consent_id,
                          respondent_click: true,
                          basis: record.basis,
                          notice_version: record.notice_version,
                          guardian_evidence_status: guardianRequired ? 'self_attested' : 'not_required',
                          guardian_evidence_ref: guardianRequired ? guardianRef.trim() : null,
                        }, { resume: attempt === 'resumed' });
                        markFlowEntry(token);
                        router.push(ROUTES.respondentForm(token));
                      })
                      .catch((error: unknown) => {
                        // SEC-02: versi/notice berganti di antara intro dan klik setuju — muat ulang intro tanpa pesan teknis.
                        if (error instanceof ApiError && error.code === 'notice_changed') {
                          reload();
                          return;
                        }
                        setConsentError(
                          error instanceof ApiError ? error.message : 'Koneksi gagal. Coba lagi sebelum mengisi formulir.',
                        );
                      })
                      .finally(() => setBusy(false));
                  }}
                >
                  Lanjut ke formulir
                </Button>
                {!consentComplete && !blocked && (
                  <p role="status" className="text-caption font-bold text-danger">
                    Tombol dinonaktifkan sampai persetujuan lengkap{guardianRequired ? ', pernyataan wali dicentang, dan referensi bukti diisi' : ''}.
                  </p>
                )}
                <PolicyLinks className="mt-2" />
              </div>
            </>
          )}
        </div>
      </StateView>
      
    </Shell>
  );
}

/* ---------------- Formulir ---------------- */

export function QuestionField({
  q,
  token,
  value,
  setOption,
  setText,
  highlightEmpty,
  options,
}: {
  q: PublicContextData['questions'][number];
  token: string;
  value: { optionId: string | null; text: string };
  setOption: (code: string, optionId: string) => void;
  setText: (code: string, text: string) => void;
  highlightEmpty: boolean;
  options: Array<{ id: string; value: number | null; label: string }>;
}) {
  const opts = options;
  const empty = q.required && (q.type === 'likert' ? value.optionId === null : value.text.trim() === '');
  const showError = highlightEmpty && empty;

  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-n200 p-4" aria-describedby={showError && q.type === 'likert' ? `err-${q.id}` : undefined}>
      <legend className="px-1 text-body font-bold text-ink">
        {q.order}. {q.label} {q.required && <span className="text-danger">*</span>}
        {q.required && <span className="sr-only"> (wajib)</span>}
      </legend>
      <Label><Code>{q.code}</Code> · {q.section}</Label>
      {q.type === 'likert' ? (
        <div className="flex flex-col gap-2">
          {opts.map((o) => (
            <label
              key={o.id}
              htmlFor={`${token}-${q.id}-${o.id}`}
              className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-md border px-3 text-body-sm text-ink ${
                value.optionId === o.id ? 'border-action bg-action-soft' : 'border-n200 hover:bg-n50'
              }`}
            >
              <input
                id={`${token}-${q.id}-${o.id}`}
                type="radio"
                name={`${token}-${q.id}`}
                value={o.id}
                checked={value.optionId === o.id}
                onChange={() => setOption(q.code, o.id)}
                className="size-5 shrink-0 accent-action"
              />
              <span className="font-mono text-caption font-bold text-n700">{o.value}</span>
              <span>{o.label}</span>
            </label>
          ))}
          {showError && (
            <p id={`err-${q.id}`} role="alert" className="text-caption font-bold text-danger">
              Item wajib ini belum dipilih. Pesan ditampilkan dekat item dan nilai lain tetap tersimpan.
            </p>
          )}
        </div>
      ) : (
        <ShortTextAnswer
          id={`${token}-${q.id}-text`}
          required={q.required}
          hint={q.hint}
          error={showError ? 'Item wajib ini belum diisi.' : undefined}
          value={value.text}
          onChange={(text) => setText(q.code, text)}
        />
      )}
    </fieldset>
  );
}

/** Isian singkat formulir responden; pratinjau creator memakai komponen yang sama agar label dan status wajibnya identik. */
export function ShortTextAnswer({
  id,
  required,
  hint,
  error,
  value,
  onChange,
}: {
  id: string;
  required: boolean;
  hint: string | null;
  error?: string;
  value?: string;
  onChange?: (text: string) => void;
}) {
  return (
    <Field
      id={id}
      label="Jawaban singkat"
      required={required}
      hint={hint ?? (required ? undefined : 'Opsional.')}
      error={error}
      announceError={false}
    >
      {(aria) => (
        <TextArea
          {...aria}
          value={value}
          onChange={onChange && ((e) => onChange(e.target.value))}
          placeholder="Tulis jawaban singkat…"
        />
      )}
    </Field>
  );
}

export function FormPage({ token }: { token: string }) {
  const { ctx, loading, loadError, reload } = usePublicPage(token, 'form');
  const { state, link } = useScreenState('respondent-form');
  const router = useRouter();
  const items = ctx ? [...ctx.questions].sort((a, b) => a.order - b.order) : [];
  const { draft, setOption, setText } = useDraft(token, ctx?.version.number ?? null, items.map((q) => q.code));
  const [checked, setChecked] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const [consent, setConsent] = useState<ConsentPayload | null>(null);
  const [consentReady, setConsentReady] = useState(false);
  // Dibaca sekali saat mount; kedatangan berikutnya (reload/deep link) kembali digerbangi karena tanda alur
  // sekali pakai dihapus di effect di bawah. Render awal tetap memuat sampai persetujuan terbaca.
  const [attemptGate, setAttemptGate] = useState(() => attemptGateNeeded(token));

  useEffect(() => {
    setConsent(readConsent(token));
    setConsentReady(true);
  }, [token]);

  useEffect(() => {
    clearFlowEntry(token);
  }, [token]);

  useEffect(() => {
    if (!consentReady || !ctx) return;
    const effective = state === 'default' ? serverState(ctx) : state;
    if (!consent && effective === 'default') router.replace(ROUTES.respondentIntro(token));
  }, [consentReady, consent, ctx, state, token, router]);

  const emptyRequired = items.filter((q) =>
    q.required && (q.type === 'likert' ? draft[q.code]?.optionId == null : (draft[q.code]?.text ?? '').trim() === ''),
  );
  useEffect(() => {
    if (checked && emptyRequired.length > 0) summaryRef.current?.focus();
  }, [checked, emptyRequired.length]);
  const answeredCount = items.filter((q) =>
    q.type === 'likert' ? draft[q.code]?.optionId != null : (draft[q.code]?.text ?? '').trim() !== '',
  ).length;

  if (loading) return <PublicLoading />;
  if (loadError) return <PublicLoadError token={token} error={loadError} onRetry={reload} />;
  if (!ctx) return <MissingToken />;
  if (!consentReady) return <PublicLoading />;
  const { survey, version, isPublicLink } = ctx;
  const effectiveState = state === 'default' ? serverState(ctx) : state;
  const usedInvite = isInvitationUsed(ctx);
  const blocked = ['closed', 'expired', 'revoked', 'permission-denied', 'error', 'loading'].includes(effectiveState) || usedInvite || !consent;

  if (attemptGate && consent && effectiveState === 'default') {
    return (
      <Shell kind="respondent" title={`Formulir · ${survey.title}`} subtitle="Isian sebelumnya belum diselesaikan.">
        <div className="mx-auto w-full max-w-[720px]">
          <UnsentAttemptChoice
            token={token}
            onChoose={(choice) => {
              if (choice === 'restart') {
                router.replace(ROUTES.respondentIntro(token));
                return;
              }
              setAttemptGate(false);
            }}
          />
        </div>
      </Shell>
    );
  }

  if (!consent && effectiveState === 'default') {
    return <PublicLoading />;
  }
  return (
    <Shell kind="respondent" title={`Formulir · ${survey.title}`} subtitle={`Versi ${version.number} · ${items.length} item · ${isPublicLink ? 'tautan umum' : 'undangan individual'}`}>
      <StateView
        routeId="respondent-form"
        state={effectiveState}
        permissionDetail="Konteks akses untuk tautan ini tidak valid."
      >
        <div className="mx-auto flex max-w-[720px] flex-col gap-5">
          <Progress step={2} />
          
          {usedInvite && <Banner tone="warning" title="Undangan individual sudah dipakai">Satu undangan hanya menerima satu respons final. Buka tautan bukti bila perlu memeriksa pengiriman sebelumnya.</Banner>}

          {effectiveState === 'validation' && (
            <ValidationSummary items={['Item wajib kosong harus diisi.', 'Opsi yang dipilih harus berasal dari versi formulir ini.']} />
          )}
          {checked && emptyRequired.length > 0 && effectiveState === 'default' && (
            <div ref={summaryRef} tabIndex={-1} className="outline-none">
              <ValidationSummary items={emptyRequired.map((q) => `Item ${q.code} wajib belum diisi.`)} />
            </div>
          )}
          {(effectiveState === 'error') && (
            <Banner tone="danger" title="Koneksi terputus">
              Jawaban yang sudah diketik tetap tersimpan di perangkat selama halaman terbuka. Coba kirim ulang setelah koneksi kembali.
              Gangguan setelah penyimpanan tidak membatalkan respons.
            </Banner>
          )}
          {state === 'success' && <SuccessBanner title="Isian tersimpan sementara">Lanjut ke tinjauan sebelum kirim.</SuccessBanner>}

          <Card className="flex flex-col gap-4">
            <SectionTitle>Petunjuk</SectionTitle>
            <p className="text-body-sm text-muted">{survey.instructions || 'Pilih satu jawaban pada setiap pernyataan.'}</p>
            <Divider />
            {items.map((q) => (
              <QuestionField
                key={q.id}
                q={q}
                token={token}
                value={draft[q.code] ?? { optionId: null, text: '' }}
                setOption={setOption}
                setText={setText}
                highlightEmpty={checked || effectiveState === 'validation'}
                options={ctx.options.filter((option) => option.question_id === q.id).sort((a, b) => a.order - b.order)}
              />
            ))}
          </Card>

          <Card className="flex flex-col gap-3">
            <SectionTitle>Progres dan koneksi</SectionTitle>
            <p className="text-body-sm text-ink">
              Terjawab {answeredCount} dari {items.length} item.
            </p>
            <progress
              className="h-2 w-full appearance-none overflow-hidden rounded-full border-0 bg-n100 accent-action [&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-action [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-n100 [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-action"
              value={answeredCount}
              max={Math.max(items.length, 1)}
              aria-label="Progres pengisian"
            />
            <button
              type="button"
              onClick={() => setChecked(true)}
              className="min-h-[44px] w-fit rounded-md border border-n200 bg-n0 px-4 text-body-sm font-bold text-action hover:bg-action-soft"
            >
              Periksa kelengkapan
            </button>
            <PolicyLinks />
          </Card>

          <div className="flex flex-col gap-2">
            <ActionLink
              to={ROUTES.respondentReview(token)}
              block
              disabled={blocked || emptyRequired.length > 0}
              onClick={() => markFlowEntry(token)}
            >
              Tinjau jawaban
            </ActionLink>
            {emptyRequired.length > 0 && !blocked && (
              <p role="status" className="text-caption font-bold text-danger">
                Lengkapi {emptyRequired.length} item wajib sebelum meninjau.
              </p>
            )}
            <ActionLink to={ROUTES.respondentIntro(token)} variant="secondary" block>
              Kembali ke pengantar
            </ActionLink>
            <PlainLink to={link(ROUTES.home)}>Tinggalkan formulir</PlainLink>
          </div>
        </div>
      </StateView>
      
    </Shell>
  );
}

/* ---------------- Tinjau ---------------- */

export function ReviewPage({ token }: { token: string }) {
  const { ctx, loading, loadError, reload } = usePublicPage(token, 'review');
  const notify = useToast();
  const { state, link } = useScreenState('respondent-review');
  const router = useRouter();
  const items = ctx ? [...ctx.questions].sort((a, b) => a.order - b.order) : [];
  const { draft } = useDraft(token, ctx?.version.number ?? null, items.map((q) => q.code));
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [consent, setConsent] = useState<ConsentPayload | null>(null);
  const [consentReady, setConsentReady] = useState(false);
  // Sama dengan formulir: gerbang hanya untuk kedatangan langsung dengan isian tertinggal.
  const [attemptGate, setAttemptGate] = useState(() => attemptGateNeeded(token));

  useEffect(() => {
    setConsent(readConsent(token));
    setConsentReady(true);
  }, [token]);

  useEffect(() => {
    clearFlowEntry(token);
  }, [token]);

  useEffect(() => {
    if (!consentReady || !ctx) return;
    const effective = state === 'default' ? serverState(ctx) : state;
    if (!consent && effective === 'default') router.replace(ROUTES.respondentIntro(token));
  }, [consentReady, consent, ctx, state, token, router]);

  const rows = items.map((q) => {
    const value = draft[q.code] ?? { optionId: null, text: '' };
    const opt = q.type === 'likert' ? ctx?.options.find((o) => o.question_id === q.id && o.id === value.optionId) : undefined;
    const empty = q.required && (q.type === 'likert' ? !opt : value.text.trim() === '');
    return { q, value, opt, empty };
  });
  const emptyCount = rows.filter((r) => r.empty).length;

  if (loading) return <PublicLoading />;
  if (loadError) return <PublicLoadError token={token} error={loadError} onRetry={reload} />;
  if (!ctx) return <MissingToken />;
  if (!consentReady) return <PublicLoading />;
  const { survey, version } = ctx;
  const retryOnly = ctx.retryOnly === true;
  const effectiveState = state === 'default' && !retryOnly ? serverState(ctx) : state;
  const usedInvite = isInvitationUsed(ctx);
  const blocked = ['closed', 'expired', 'revoked', 'permission-denied', 'error', 'loading', 'conflict'].includes(effectiveState) || !consent || (usedInvite && !retryOnly);

  if (attemptGate && consent && effectiveState === 'default') {
    return (
      <Shell kind="respondent" title="Tinjau jawaban" subtitle="Isian sebelumnya belum diselesaikan.">
        <div className="mx-auto w-full max-w-[720px]">
          <UnsentAttemptChoice
            token={token}
            onChoose={(choice) => {
              if (choice === 'restart') {
                router.replace(ROUTES.respondentIntro(token));
                return;
              }
              setAttemptGate(false);
            }}
          />
        </div>
      </Shell>
    );
  }

  if (!consent && effectiveState === 'default') {
    return <PublicLoading />;
  }

  const onSubmit = () => {
    if (!consent) {
      setSubmitError('Persetujuan tidak ditemukan. Buka kembali pengantar dan lengkapi persetujuan.');
      return;
    }
    const key = submissionKey(token, version.number, retryOnly);
    if (!key) {
      setSubmitError('Kunci pengiriman sebelumnya tidak tersedia di sesi ini.');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    const answers = rows.flatMap(({ q, value }): Array<{ question_code: string; option_id?: string; text?: string }> => {
      if (q.type === 'likert') {
        return value.optionId ? [{ question_code: q.code, option_id: value.optionId }] : [];
      }
      return value.text.trim() !== '' ? [{ question_code: q.code, text: value.text.trim() }] : [];
    });
    void submitResponse(token, key, consent.consent_id, answers)
      .then((receipt) => {
        completeSubmission(token, receipt, key);
        notify('Jawaban terkirim. Bukti pengiriman siap dilihat.');
        router.push(link(ROUTES.respondentReceipt(token)));
      })
      .catch((error: unknown) => {
        const message =
          error instanceof ApiError
            ? error.code === 'already_submitted'
              ? 'Undangan ini sudah digunakan untuk satu respons final.'
              : error.message
            : 'Koneksi gagal. Jawaban Anda tetap tersimpan di perangkat ini; coba kirim ulang.';
        setSubmitError(message);
        notify(message, 'danger');
      })
      .finally(() => setSubmitting(false));
  };
  return (
    <Shell kind="respondent" title="Tinjau jawaban" subtitle="Periksa kembali jawaban sebelum mengirim. Respons final tidak dapat diubah setelah terkirim.">
      <StateView
        routeId="respondent-review"
        state={effectiveState}
        permissionDetail="Konteks pengiriman tidak cocok dengan tautan ini."
        conflictTo={ROUTES.respondentReceipt(token)}
      >
        <div className="mx-auto flex max-w-[720px] flex-col gap-5">
          <Progress step={3} />
          
          {retryOnly ? (
            <Banner tone="info" title="Respons sudah terkirim">Kirim ulang jawaban yang sama untuk membuka bukti pengiriman. Respons final tidak dapat diubah.</Banner>
          ) : usedInvite && <Banner tone="warning" title="Undangan individual sudah dipakai">Satu undangan hanya menerima satu respons final. Buka tautan bukti bila perlu memeriksa pengiriman sebelumnya.</Banner>}
          {effectiveState === 'validation' && <ValidationSummary items={['Item kosong ditandai di bawah.', 'Periksa kembali opsi sebelum mengirim.']} />}
          {emptyCount > 0 && effectiveState === 'default' && (
            <ValidationSummary items={rows.filter((r) => r.empty).map((r) => `Item ${r.q.code} masih kosong.`)} />
          )}
          {submitError && <Banner tone="danger" title="Pengiriman gagal">{submitError}</Banner>}
          {!consent && <Banner tone="warning" title="Persetujuan belum tercatat">Kembali ke pengantar untuk melengkapi persetujuan sebelum mengirim.</Banner>}

          <Card className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SectionTitle>{survey.title}</SectionTitle>
              <Badge tone="info">Versi {version.number}</Badge>
            </div>
            <Divider />
            <div className="hidden sm:block">
              <Table head={['Item', 'Jawaban', 'Status']}>
                {rows.map(({ q, value, opt, empty }) => (
                  <tr key={q.id}>
                    <Th><Code>{q.code}</Code><span className="mt-1 block text-caption font-normal text-muted">{q.label}</span></Th>
                    <Td>
                      {opt ? (
                        <><span className="font-mono font-bold">{opt.value}</span> · {opt.label}</>
                      ) : value.text.trim() !== '' ? (
                        <span className="break-words">{value.text}</span>
                      ) : (
                        <span className="text-muted">Kosong</span>
                      )}
                    </Td>
                    <Td>
                      {empty ? <Badge tone="danger">Perlu diperbaiki</Badge>
                        : opt || value.text.trim() !== '' ? <Badge tone="success">Terjawab</Badge>
                          : <Badge tone="neutral">Dilewati (opsional)</Badge>}
                    </Td>
                  </tr>
                ))}
              </Table>
            </div>
            <ul className="flex flex-col gap-3 sm:hidden">
              {rows.map(({ q, value, opt, empty }) => (
                <li key={q.id} className="rounded-md border border-n200 p-3">
                  <p className="font-mono text-caption font-bold text-ink"><Code>{q.code}</Code></p>
                  <p className="mt-1 text-body-sm text-ink">{q.label}</p>
                  <p className="mt-2 break-words text-body-sm text-ink">
                    {opt ? <><span className="font-mono font-bold">{opt.value}</span> · {opt.label}</> : value.text.trim() || <span className="text-muted">Kosong</span>}
                  </p>
                  <div className="mt-2">
                    {empty ? <Badge tone="danger">Perlu diperbaiki</Badge>
                      : opt || value.text.trim() !== '' ? <Badge tone="success">Terjawab</Badge>
                        : <Badge tone="neutral">Dilewati (opsional)</Badge>}
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-caption text-muted">
              Jawaban Anda ditampilkan pada tinjauan ini. Teks bebas tidak dimuat pada halaman publik lain.
            </p>
          </Card>

          <Card className="flex flex-col gap-3">
            <SectionTitle>Persetujuan dan pemberitahuan</SectionTitle>
            <dl className="grid gap-3 text-body-sm sm:grid-cols-2">
              <div><dt className="text-caption font-bold text-muted">Versi notice</dt><dd className="mt-1 text-ink">{consent?.notice_version ?? 'Tidak tercatat'}</dd></div>
              <div><dt className="text-caption font-bold text-muted">Dasar persetujuan</dt><dd className="mt-1 text-ink">{consent?.basis ?? 'Tidak tercatat'}</dd></div>
              <div><dt className="text-caption font-bold text-muted">Klik responden</dt><dd className="mt-1 text-ink">{consent?.respondent_click ? 'Tercatat' : 'Tidak tercatat'}</dd></div>
              <div><dt className="text-caption font-bold text-muted">Kelayakan konteks</dt><dd className="mt-1 text-ink">Terkonfirmasi pada pengantar</dd></div>
              <GuardianEvidenceSummary status={consent?.guardian_evidence_status ?? 'not_required'} />
            </dl>
          </Card>

          <Card className="flex flex-col gap-3">
            <SectionTitle>Kirim</SectionTitle>
            <p className="text-body-sm text-muted">
              Sistem memeriksa versi yang ditampilkan, periode, izin, persetujuan, dan kelengkapan item sebelum kirim.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                disabled={blocked || emptyCount > 0}
                loading={submitting}
                onClick={onSubmit}
              >
                {retryOnly ? 'Kirim ulang jawaban' : 'Kirim jawaban'}
              </Button>
              <ActionLink to={ROUTES.respondentForm(token)} variant="secondary" disabled={blocked || retryOnly} onClick={() => markFlowEntry(token)}>Perbaiki jawaban</ActionLink>
            </div>
            {(blocked || emptyCount > 0) && (
              <p role="status" className="text-caption font-bold text-danger">
                Kirim dinonaktifkan. {emptyCount > 0 ? `${emptyCount} item wajib masih kosong. ` : ''}Periksa status akses di atas.
              </p>
            )}
            <PolicyLinks className="mt-2" />
          </Card>
        </div>
      </StateView>
      
    </Shell>
  );
}

/* ---------------- Bukti ---------------- */

export function ReceiptPage({ token }: { token: string }) {
  const { ctx, loading, loadError, reload } = usePublicPage(token);
  const [stored, setStored] = useState<StoredReceipt | null | undefined>(undefined);

  useEffect(() => {
    setStored(readReceipt(token));
  }, [token]);

  if (loading || stored === undefined) return <PublicLoading />;
  if (loadError) return <PublicLoadError token={token} error={loadError} onRetry={reload} />;
  if (!ctx) return <MissingToken />;
  return <ReceiptView key={token} token={token} ctx={ctx} stored={stored} />;
}

/** Halaman bukti untuk satu token; `stored` adalah bukti token ini yang tersimpan di tab, bila ada. */
export function ReceiptView({ token, ctx, stored }: { token: string; ctx: PublicContextData; stored: StoredReceipt | null }) {
  const notify = useToast();
  const { state, link } = useScreenState('respondent-receipt');
  const [receipt, setReceipt] = useState<ReceiptData | null>(stored?.receipt ?? null);
  const [storedKey, setStoredKey] = useState(stored?.key ?? '');
  const [retried, setRetried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [recoverId, setRecoverId] = useState('');
  const [recoverKey, setRecoverKey] = useState('');
  const [recoverChecked, setRecoverChecked] = useState(false);

  const recover = (responseId: string, key: string) => {
    setBusy(true);
    setRetryError(null);
    void getReceipt(token, responseId, key)
      .then((next) => {
        saveReceipt(token, next, key);
        setReceipt(next);
        setStoredKey(key);
        setRetried(true);
        notify('Bukti yang sama berhasil dipulihkan.');
      })
      .catch((error: unknown) => {
        // Server hanya memulihkan bukti untuk sesi browser yang mencatat persetujuannya.
        const message = error instanceof ApiError && error.status === 404
          ? 'ID bukti dan kunci pengiriman tidak cocok dengan pengiriman dari browser ini.'
          : error instanceof Error ? error.message : 'Bukti gagal dipulihkan.';
        setRetryError(message);
        notify(message, 'danger');
      })
      .finally(() => setBusy(false));
  };

  const onRecover = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRecoverChecked(true);
    if (recoverId.trim() && recoverKey.trim()) recover(recoverId.trim(), recoverKey.trim());
  };

  return (
    <Shell kind="respondent" title="Bukti pengiriman" subtitle="ID bukti dan waktu server ditampilkan setelah transaksi final.">
      <StateView
        routeId="respondent-receipt"
        state={state}
        conflictTo={ROUTES.respondentReceipt(token)}
      >
        <div className="mx-auto flex max-w-[720px] flex-col gap-5">
          <Progress step={4} />
          
          {state === 'success' && <SuccessBanner title="Bukti berhasil dipulihkan">Retry identik mengembalikan bukti yang sama, bukan respons kedua.</SuccessBanner>}
          {state === 'conflict' && (
            <Banner tone="warning" title="Retry dengan kunci yang sama">
              Kunci yang sama dan isi sama mengembalikan bukti lama. Kunci sama dengan isi berubah ditolak.
            </Banner>
          )}
          {retryError && <Banner tone="danger" title="Bukti gagal dipulihkan">{retryError}</Banner>}

          <Card className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SectionTitle>Respons final terkunci</SectionTitle>
              <Badge tone={receipt ? 'success' : 'neutral'}>{receipt ? 'Terkirim' : 'Belum ada bukti'}</Badge>
            </div>
            {receipt ? (
              <>
                <div className="hidden sm:block">
                  <Table head={['Field', 'Nilai']}>
                    <tr><Th>ID bukti</Th><Td><Code>{receipt.response_id}</Code></Td></tr>
                    <tr><Th>Versi</Th><Td>{receipt.version_number}</Td></tr>
                    <tr><Th>Waktu server</Th><Td>{formatWIB(receipt.submitted_at)}</Td></tr>
                    <tr><Th>Status</Th><Td>{RECEIPT_STATUS_LABEL[receipt.status] ?? receipt.status}</Td></tr>
                    <tr><Th>Kunci pengiriman</Th><Td><Code>{receipt.idempotency_key}</Code></Td></tr>
                  </Table>
                </div>
                <dl className="grid gap-3 sm:hidden">
                  <div><dt className="text-caption font-bold text-muted">ID bukti</dt><dd className="mt-1 break-all"><Code>{receipt.response_id}</Code></dd></div>
                  <div><dt className="text-caption font-bold text-muted">Versi</dt><dd className="mt-1">{receipt.version_number}</dd></div>
                  <div><dt className="text-caption font-bold text-muted">Waktu server</dt><dd className="mt-1">{formatWIB(receipt.submitted_at)}</dd></div>
                  <div><dt className="text-caption font-bold text-muted">Status</dt><dd className="mt-1">{RECEIPT_STATUS_LABEL[receipt.status] ?? receipt.status}</dd></div>
                  <div><dt className="text-caption font-bold text-muted">Kunci pengiriman</dt><dd className="mt-1 break-all"><Code>{receipt.idempotency_key}</Code></dd></div>
                </dl>
              </>
            ) : (
              <p className="text-body-sm text-muted">
                Bukti untuk tautan ini tidak tersimpan di tab ini. Bila jawaban sudah terkirim dan Anda mencatat ID bukti
                serta kunci pengiriman dari halaman bukti, pulihkan bukti di bawah.
              </p>
            )}
            <p className="text-caption text-muted">
              Token, kredensial, dan isi jawaban tidak ditampilkan pada bukti maupun log audit.
            </p>
          </Card>

          {receipt ? (
            <Card className="flex flex-col gap-3">
              <SectionTitle>Retry setelah waktu tunggu</SectionTitle>
              <p className="text-body-sm text-muted">
                Bila jaringan gagal sesudah commit, klien mengirim ulang dengan kunci yang sama dan menerima bukti yang sama.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button variant="secondary" onClick={() => recover(receipt.response_id, storedKey)} disabled={state === 'loading' || busy} loading={busy}>
                  {retried ? 'Bukti sama dipulihkan' : 'Pulihkan bukti'}
                </Button>
                <ActionLink to={ROUTES.respondentIntro(token)} variant="secondary">Kembali ke pengantar</ActionLink>
              </div>
              {retried && (
                <Banner tone="success" title="Bukti identik">
                  <Code>{receipt.response_id}</Code> dikembalikan tanpa membuat respons kedua.
                </Banner>
              )}
            </Card>
          ) : (
            <Card className="flex flex-col gap-3">
              <SectionTitle>Pulihkan bukti</SectionTitle>
              <p className="text-body-sm text-muted">
                Pemulihan hanya berhasil di browser yang sama dengan yang dipakai saat mengirim, sebelum browser itu ditutup.
                Pemulihan tidak membuat respons baru.
              </p>
              <form className="flex flex-col gap-3" noValidate onSubmit={onRecover}>
                <Field id="receipt-response-id" label="ID bukti" required error={recoverChecked && !recoverId.trim() ? 'Isi ID bukti.' : undefined}>
                  {(aria) => (
                    <TextInput {...aria} value={recoverId} onChange={(e) => setRecoverId(e.target.value)} autoComplete="off" spellCheck={false} />
                  )}
                </Field>
                <Field id="receipt-key" label="Kunci pengiriman" required error={recoverChecked && !recoverKey.trim() ? 'Isi kunci pengiriman.' : undefined}>
                  {(aria) => (
                    <TextInput {...aria} value={recoverKey} onChange={(e) => setRecoverKey(e.target.value)} autoComplete="off" spellCheck={false} />
                  )}
                </Field>
                <div className="flex flex-wrap gap-3">
                  <Button type="submit" variant="secondary" loading={busy}>Pulihkan bukti</Button>
                  <ActionLink to={ROUTES.respondentIntro(token)} variant="secondary">Kembali ke pengantar</ActionLink>
                </div>
              </form>
              <p className="text-caption text-muted">
                Bila pemulihan gagal, hubungi pengelola survei{ctx.notice.contact ? `: ${ctx.notice.contact}` : ' melalui kontak pada pemberitahuan survei.'}
              </p>
            </Card>
          )}

          <Card className="flex flex-col gap-3">
            <SectionTitle>Setelah pengiriman</SectionTitle>
            <p className="text-body-sm text-muted">
              Jawaban final tidak dapat diubah oleh responden. Permintaan akses, koreksi, penarikan, atau penghapusan tetap diproses pihak berwenang melalui kanal resmi.
            </p>
            <PolicyLinks className="mt-1" />
            <div className="flex flex-wrap gap-3">
              <PlainLink to={link(ROUTES.home)}>Kembali ke beranda</PlainLink>
              <PlainLink to={ROUTES.privacy}>Baca kebijakan privasi</PlainLink>
            </div>
          </Card>
        </div>
      </StateView>
      
    </Shell>
  );
}
