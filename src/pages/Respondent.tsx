import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
  Field,
  Label,

  Panel,
  PlainLink,
  PolicyLinks,
  SectionTitle,
  Table,
  Td,
  TextArea,

  Th,
} from '../components/ui';
import { StateView, StateDebugHint, SuccessBanner, ValidationSummary } from '../components/StateView';
import { DevStateSwitcher, useScreenState } from '../lib/state';
import { ROUTES } from '../lib/routes';
import { optionsFor, questionsFor, resolveToken } from '../lib/fixtures/surveys';
import { profileForSurvey, noticeForSurvey } from '../lib/fixtures/profiles';
import { receiptFixture } from '../lib/fixtures/records';
import { useToast } from '../components/Toast';
import { formatWIB } from '../lib/summary';
import { RECEIPT_KEY, useDraft } from '../lib/draft';
import type { Question } from '../lib/types';

const INVITE_LABEL_ID: Record<string, string> = {
  active: 'Aktif', used: 'Terpakai', revoked: 'Dicabut', expired: 'Kedaluwarsa',
};

function useContext() {
  const { token = 'link-umum-demo' } = useParams();
  return { token, ctx: resolveToken(token) };
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
        <p className="text-body text-ink">Token pada URL tidak cocok dengan fixture pratinjau.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <ActionLink to={ROUTES.respondentIntro('link-umum-demo')}>Buka tautan umum contoh</ActionLink>
          <ActionLink to={ROUTES.home} variant="secondary">Kembali ke beranda</ActionLink>
        </div>
      </Card>
    </Shell>
  );
}

/* ---------------- Pengantar + notice ---------------- */

export function IntroPage() {
  const { token, ctx } = useContext();
  const { state } = useScreenState('respondent-intro');
  const [consent, setConsent] = useState(false);
  const [guardianEvidence, setGuardianEvidence] = useState(false);
  const [eligibility, setEligibility] = useState(false);

  if (!ctx) return <MissingToken />;
  const { survey, version, isPublicLink, invitation } = ctx;
  const profile = profileForSurvey(survey.id);
  const notice = noticeForSurvey(survey.id);
  const guardianRequired = profile.consent_mode === 'guardian';
  const blocked = ['closed', 'expired', 'revoked', 'permission-denied', 'error', 'loading'].includes(state);
  const consentComplete = consent && eligibility && (!guardianRequired || guardianEvidence);

  return (
    <Shell kind="respondent" title={survey.title} subtitle={`Pengantar dan pemberitahuan · versi ${version.number}`}>
      <StateView
        routeId="respondent-intro"
        state={state}
        permissionDetail="Akses ke tautan ini tidak tersedia untuk konteks Anda."
      >
        <div className="mx-auto flex max-w-[720px] flex-col gap-5">
          <Progress step={1} />
          <StateDebugHint routeId="respondent-intro" state={state} />
          {state === 'success' && <SuccessBanner title="Persetujuan tercatat">Lanjutkan ke formulir.</SuccessBanner>}
          {state === 'validation' && <ValidationSummary items={['Persetujuan wajib belum lengkap.', 'Konfirmasi kelayakan konteks belum dicentang.']} />}

          <Panel className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">Versi {version.number}</Badge>
              <Badge tone={isPublicLink ? 'neutral' : 'info'}>{isPublicLink ? 'Tautan umum' : 'Undangan individual'}</Badge>
              <Badge tone={guardianRequired ? 'warning' : 'neutral'}>{guardianRequired ? 'Mode wali' : 'Persetujuan diri'}</Badge>
            </div>
            <p className="text-body-sm text-ink">
              Formulir ini merujuk ke <Code>{version.id}</Code>. Versi yang ditampilkan tidak berubah selama halaman terbuka.
            </p>
          </Panel>

          <Card className="flex flex-col gap-3">
            <SectionTitle>Pemberitahuan sebelum item pertama</SectionTitle>
            <p className="font-mono text-caption tracking-mono text-muted">Versi notice Versi {notice.version} · berlaku {notice.effective_date}</p>
            <Table head={['Hal', 'Keterangan']}>
              <tr><Th>Tujuan</Th><Td>{notice.purpose}</Td></tr>
              <tr><Th>Jenis data</Th><Td>{notice.data_categories}</Td></tr>
              <tr><Th>Penggunaan Modul 15</Th><Td>{notice.module15_usage}</Td></tr>
              <tr><Th>Retensi</Th><Td>{notice.retention_text}</Td></tr>
              <tr><Th>Penerima</Th><Td>{notice.recipients}</Td></tr>
              <tr><Th>Kontak</Th><Td>{notice.contact}</Td></tr>
              <tr><Th>Hak Anda</Th><Td>{notice.rights}</Td></tr>
              <tr><Th>Data anak</Th><Td>{notice.child_data_text}</Td></tr>
              <tr><Th>Transfer lintas negara</Th><Td>{notice.cross_border_text}</Td></tr>
            </Table>
            <Banner tone="info" title="Tentang pemberitahuan ini">
              Pemberitahuan dapat dibaca tanpa akun dan tetap tersedia setelah versi survei ditutup.
            </Banner>
            <PolicyLinks className="border-t border-n200 pt-3" />
          </Card>

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
                  Survei ini ditujukan untuk responden anak. Kiriman baru ditolak bila bukti verifikasi wali belum tersedia atau dicabut.
                </p>
                <div className="mt-2">
                  <Checkbox
                    id="consent-wali"
                    label="Bukti wali telah diverifikasi."
                    checked={guardianEvidence}
                    onChange={setGuardianEvidence}
                  />
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
            <ActionLink
              to={ROUTES.respondentForm(token)}
              block
              disabled={!consentComplete || blocked}
            >
              Lanjut ke formulir
            </ActionLink>
            {!consentComplete && !blocked && (
              <p role="status" className="text-caption font-bold text-danger">
                Tombol dinonaktifkan sampai persetujuan lengkap{guardianRequired ? ' dan bukti wali sah' : ''}.
              </p>
            )}
            <PolicyLinks className="mt-2" />
          </div>
        </div>
      </StateView>
      <DevStateSwitcher routeId="respondent-intro" />
    </Shell>
  );
}

/* ---------------- Formulir ---------------- */

function QuestionField({
  q,
  token,
  value,
  setOption,
  setText,
  highlightEmpty,
}: {
  q: Question;
  token: string;
  value: { optionId: string | null; text: string };
  setOption: (code: string, optionId: string) => void;
  setText: (code: string, text: string) => void;
  highlightEmpty: boolean;
}) {
  const opts = optionsFor(q.id);
  const empty = q.required && (q.type === 'likert' ? value.optionId === null : value.text.trim() === '');
  const showError = highlightEmpty && empty;

  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-n200 p-4" aria-describedby={showError ? `err-${q.id}` : undefined}>
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
        <Field id={`${token}-${q.id}-text`} label="Jawaban singkat" hint={q.hint ?? 'Opsional.'}>
          {(aria) => (
            <TextArea
              {...aria}
              value={value.text}
              onChange={(e) => setText(q.code, e.target.value)}
              placeholder="Tulis jawaban singkat…"
            />
          )}
        </Field>
      )}
      {q.type !== 'likert' && showError && (
        <p id={`err-${q.id}`} role="alert" className="text-caption font-bold text-danger">Item wajib ini belum diisi.</p>
      )}
    </fieldset>
  );
}

export function FormPage() {
  const { token, ctx } = useContext();
  const { state, link } = useScreenState('respondent-form');
  const versionId = ctx?.version.id ?? '';
  const items = questionsFor(versionId);
  const { draft, setOption, setText } = useDraft(token, items.map((q) => q.code));
  const [checked, setChecked] = useState(false);

  const emptyRequired = items.filter((q) =>
    q.required && (q.type === 'likert' ? draft[q.code]?.optionId == null : (draft[q.code]?.text ?? '').trim() === ''),
  );
  const answeredCount = items.filter((q) =>
    q.type === 'likert' ? draft[q.code]?.optionId != null : (draft[q.code]?.text ?? '').trim() !== '',
  ).length;
  const blocked = ['closed', 'expired', 'revoked', 'permission-denied', 'error', 'loading'].includes(state);

  if (!ctx) return <MissingToken />;
  const { survey, version, isPublicLink } = ctx;

  return (
    <Shell kind="respondent" title={`Formulir · ${survey.title}`} subtitle={`Versi ${version.number} · ${items.length} item · ${isPublicLink ? 'tautan umum' : 'undangan individual'}`}>
      <StateView
        routeId="respondent-form"
        state={state}
        permissionDetail="Konteks akses untuk tautan ini tidak valid."
      >
        <div className="mx-auto flex max-w-[720px] flex-col gap-5">
          <Progress step={2} />
          <StateDebugHint routeId="respondent-form" state={state} />

          <Panel className="flex flex-col gap-2">
            <p className="text-body-sm font-bold text-ink">Versi 1 terkunci untuk formulir ini</p>
            <p className="text-body-sm text-muted">
              Bila versi baru diterbitkan, formulir yang sudah terbuka tetap mengirim ke versi <Code>{version.id}</Code> selama penerimaannya masih terbuka.
            </p>
          </Panel>

          {state === 'validation' && (
            <ValidationSummary items={['Item wajib kosong harus diisi.', 'Opsi yang dipilih harus berasal dari versi formulir ini.']} />
          )}
          {checked && emptyRequired.length > 0 && state === 'default' && (
            <ValidationSummary items={emptyRequired.map((q) => `Item ${q.code} wajib belum diisi.`)} />
          )}
          {(state === 'error') && (
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
                highlightEmpty={checked || state === 'validation'}
              />
            ))}
          </Card>

          <Card className="flex flex-col gap-3">
            <SectionTitle>Progres dan koneksi</SectionTitle>
            <p className="text-body-sm text-ink">
              Terjawab {answeredCount} dari {items.length} item.
            </p>
            <div className="h-2 w-full overflow-hidden rounded-full bg-n100" role="progressbar" aria-valuenow={answeredCount} aria-valuemin={0} aria-valuemax={items.length} aria-label="Progres pengisian">
              <div className="h-full bg-action" style={{ width: `${items.length ? (answeredCount / items.length) * 100 : 0}%` }} />
            </div>
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
      <DevStateSwitcher routeId="respondent-form" />
    </Shell>
  );
}

/* ---------------- Tinjau ---------------- */

export function ReviewPage() {
  const { token, ctx } = useContext();
  const notify = useToast();
  const { state, link } = useScreenState('respondent-review');
  const navigate = useNavigate();
  const versionId = ctx?.version.id ?? '';
  const items = questionsFor(versionId);
  const { draft } = useDraft(token, items.map((q) => q.code));
  const [submitting, setSubmitting] = useState(false);

  const rows = items.map((q) => {
    const value = draft[q.code] ?? { optionId: null, text: '' };
    const opt = q.type === 'likert' ? optionsFor(q.id).find((o) => o.id === value.optionId) : undefined;
    const empty = q.required && !opt && value.text.trim() === '';
    return { q, value, opt, empty };
  });
  const emptyCount = rows.filter((r) => r.empty).length;
  const blocked = ['closed', 'expired', 'revoked', 'permission-denied', 'error', 'loading', 'conflict'].includes(state);

  if (!ctx) return <MissingToken />;
  const { survey, version } = ctx;
  return (
    <Shell kind="respondent" title="Tinjau jawaban" subtitle="Periksa kembali jawaban sebelum mengirim. Respons final tidak dapat diubah setelah terkirim.">
      <StateView
        routeId="respondent-review"
        state={state}
        permissionDetail="Konteks pengiriman tidak cocok dengan tautan ini."
        conflictTo={ROUTES.respondentReceipt(token)}
      >
        <div className="mx-auto flex max-w-[720px] flex-col gap-5">
          <Progress step={3} />
          <StateDebugHint routeId="respondent-review" state={state} />
          {state === 'validation' && <ValidationSummary items={['Item kosong ditandai di bawah.', 'Periksa kembali opsi sebelum mengirim.']} />}
          {emptyCount > 0 && state === 'default' && (
            <ValidationSummary items={rows.filter((r) => r.empty).map((r) => `Item ${r.q.code} masih kosong.`)} />
          )}

          <Card className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SectionTitle>{survey.title}</SectionTitle>
              <Badge tone="info">Versi {version.number} · <Code>{version.id}</Code></Badge>
            </div>
            <Divider />
            <Table head={['Item', 'Jawaban', 'Status']}>
              {rows.map(({ q, value, opt, empty }) => (
                <tr key={q.id}>
                  <Th><Code>{q.code}</Code><span className="mt-1 block text-caption font-normal text-muted">{q.label}</span></Th>
                  <Td>
                    {opt ? (
                      <><span className="font-mono font-bold">{opt.value}</span> · {opt.label}</>
                    ) : value.text.trim() !== '' ? (
                      'Isian teks tersedia (tidak ditampilkan di sini).'
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
            <p className="text-caption text-muted">
              Isian teks bebas tidak dirender pada tinjauan untuk menjaga minimisasi tampilan.
            </p>
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
                onClick={() => {
                  setSubmitting(true);
                  try { sessionStorage.setItem(RECEIPT_KEY, JSON.stringify({ token, at: new Date().toISOString() })); } catch { /* abaikan */ }
                  window.setTimeout(() => {
                    setSubmitting(false);
                    notify('Jawaban terkirim. Bukti pengiriman siap dilihat.');
                    navigate(link(ROUTES.respondentReceipt(token)));
                  }, 450);
                }}
              >
                Kirim jawaban
              </Button>
              <ActionLink to={ROUTES.respondentForm(token)} variant="secondary" disabled={blocked}>Perbaiki jawaban</ActionLink>
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
      <DevStateSwitcher routeId="respondent-review" />
    </Shell>
  );
}

/* ---------------- Bukti ---------------- */

export function ReceiptPage() {
  const { token, ctx } = useContext();
  const notify = useToast();
  const { state, link } = useScreenState('respondent-receipt');
  const [retried, setRetried] = useState(false);
  if (!ctx) return <MissingToken />;
  const { version } = ctx;

  return (
    <Shell kind="respondent" title="Bukti pengiriman" subtitle="ID bukti dan waktu server ditampilkan setelah transaksi final.">
      <StateView
        routeId="respondent-receipt"
        state={state}
        conflictTo={ROUTES.respondentReceipt(token)}
      >
        <div className="mx-auto flex max-w-[720px] flex-col gap-5">
          <Progress step={4} />
          <StateDebugHint routeId="respondent-receipt" state={state} />
          {state === 'success' && <SuccessBanner title="Bukti berhasil dipulihkan">Retry identik mengembalikan bukti yang sama, bukan respons kedua.</SuccessBanner>}
          {state === 'conflict' && (
            <Banner tone="warning" title="Retry dengan kunci yang sama">
              Kunci yang sama dan isi sama mengembalikan bukti lama. Kunci sama dengan isi berubah ditolak.
            </Banner>
          )}

          <Card className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SectionTitle>Respons final terkunci</SectionTitle>
              <Badge tone="success">Terkirim</Badge>
            </div>
            <Table head={['Field', 'Nilai']}>
              <tr><Th>ID bukti</Th><Td><Code>{receiptFixture.response_id}</Code></Td></tr>
              <tr><Th>Versi</Th><Td><Code>{version.id}</Code> · versi {version.number}</Td></tr>
              <tr><Th>Waktu server</Th><Td>{formatWIB(receiptFixture.submitted_at)}</Td></tr>
              <tr><Th>Status</Th><Td>terkirim</Td></tr>
              <tr><Th>Kunci pengiriman</Th><Td><Code>{receiptFixture.idempotency_key}</Code></Td></tr>
            </Table>
            <p className="text-caption text-muted">
              Token, kredensial, dan isi jawaban tidak ditampilkan pada bukti maupun log audit.
            </p>
          </Card>

          <Card className="flex flex-col gap-3">
            <SectionTitle>Retry setelah waktu tunggu</SectionTitle>
            <p className="text-body-sm text-muted">
              Bila jaringan gagal sesudah commit, klien mengirim ulang dengan kunci yang sama dan menerima bukti yang sama.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button variant="secondary" onClick={() => { setRetried(true); notify('Bukti yang sama berhasil dipulihkan.'); }} disabled={state === 'loading'} loading={state === 'loading'}>
                {retried ? 'Bukti sama dipulihkan' : 'Pulihkan bukti'}
              </Button>
              <ActionLink to={ROUTES.respondentIntro(token)} variant="secondary">Kembali ke pengantar</ActionLink>
            </div>
            {retried && (
              <Banner tone="success" title="Bukti identik">
                <Code>{receiptFixture.response_id}</Code> dikembalikan tanpa membuat respons kedua.
              </Banner>
            )}
          </Card>

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
      <DevStateSwitcher routeId="respondent-receipt" />
    </Shell>
  );
}
