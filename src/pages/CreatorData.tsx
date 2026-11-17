import { useState } from 'react';
import { useParams } from 'react-router-dom';
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
  Muted,
  Panel,
  PlainLink,
  SectionTitle,
  Table,
  Td,
  TextInput,
  Th,
} from '../components/ui';
import { StateView, StateDebugHint, SuccessBanner, ValidationSummary } from '../components/StateView';
import { DevStateSwitcher, useScreenState } from '../lib/state';
import { ROUTES } from '../lib/routes';
import { findSurvey, invitations, publicLinks, versionsFor, questionsFor } from '../lib/fixtures/surveys';
import { responses } from '../lib/fixtures/records';
import { computeSummary, percentage } from '../lib/summary';
import { SurveyNav } from './CreatorCore';
import { profileForSurvey, noticeForSurvey } from '../lib/fixtures/profiles';

function useSurveyId(): string {
  const { id } = useParams();
  return id && findSurvey(id) ? id : 's_demo1';
}

const INVITE_TONE = {
  active: 'success',
  used: 'info',
  revoked: 'danger',
  expired: 'warning',
} as const;

const INVITE_LABEL = {
  active: 'Aktif',
  used: 'Terpakai',
  revoked: 'Dicabut',
  expired: 'Kedaluwarsa',
} as const;

/* ---------------- Bagikan ---------------- */

export function SharePage() {
  const id = useSurveyId();
  const { state, link } = useScreenState('creator-share');

  const links = publicLinks.filter((l) => l.survey_id === id);
  const invites = invitations.filter((i) => i.survey_id === id);
  const [copied, setCopied] = useState<string | null>(null);

  return (
    <Shell kind="creator" routeId="creator-share" title="Bagikan survei" subtitle="Tautan umum atau undangan individual. Token dan kredensial tidak pernah ditampilkan pada log.">
      <StateView
        routeId="creator-share"
        state={state}
        emptyTitle="Belum ada tautan atau undangan"
        emptyDetail="Buat tautan umum atau undangan individual untuk mulai menerima jawaban."
        permissionDetail="Hanya pemilik survei yang dapat membuat dan mencabut undangan."
      >
        <div className="flex flex-col gap-5">
          <StateDebugHint routeId="creator-share" state={state} />
          <SurveyNav id={id} />
          {state === 'success' && <SuccessBanner title="Tautan siap dibagikan">Status tautan dan undangan diperbarui pada tampilan.</SuccessBanner>}
          {state === 'validation' && <ValidationSummary items={['Masa berlaku undangan harus diisi.', 'Kode undangan tidak boleh sama dengan kode yang sudah ada.']} />}
          {state === 'expired' && <Banner tone="warning" title="Tautan kedaluwarsa">Tautan yang kedaluwarsa tidak menerima kiriman baru.</Banner>}
          {state === 'revoked' && <Banner tone="danger" title="Undangan dicabut">Kode yang dicabut tidak dapat dipakai lagi.</Banner>}

          <Card className="flex flex-col gap-3">
            <SectionTitle>Tautan umum</SectionTitle>
            <Banner tone="info" title="Tautan umum tidak menjamin satu respons per orang">
              Jalur umum menjamin idempotensi kiriman, bukan identitas unik manusia (PRD §3). Jangan menampilkan klaim satu respons per orang pada tautan ini.
            </Banner>
            {links.length === 0 ? (
              <Muted>Belum ada tautan umum untuk survei ini.</Muted>
            ) : (
              <ul className="flex flex-col gap-3">
                {links.map((l) => (
                  <li key={l.id} className="rounded-md border border-n200 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-mono text-body-sm font-bold tracking-mono text-ink">/s/{l.token}</p>
                      <Badge tone={l.status === 'active' ? 'success' : 'warning'}>{l.status === 'active' ? 'Aktif' : 'Tidak aktif'}</Badge>
                    </div>
                    <p className="mt-2 text-caption text-muted">{l.label} · versi {l.version_id}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => setCopied(l.token)}
                        disabled={state === 'loading' || state === 'closed'}
                      >
                        {copied === l.token ? 'Tautan disalin (simulasi)' : 'Salin tautan'}
                      </Button>
                      <ActionLink to={ROUTES.respondentIntro(l.token)} variant="secondary">Buka sebagai responden</ActionLink>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SectionTitle>Undangan individual</SectionTitle>
              <Badge tone="neutral">{invites.length} kode</Badge>
            </div>
            <Divider />
            <Table head={['Kode tampilan', 'Status', 'Berlaku sampai', 'Dipakai', 'Dicabut']}>
              {invites.map((i) => (
                <tr key={i.id}>
                  <Th><Code>{i.code}</Code></Th>
                  <Td><Badge tone={INVITE_TONE[i.status]}>{INVITE_LABEL[i.status]}</Badge></Td>
                  <Td>{i.expires_at ? i.expires_at.slice(0, 10) : 'Belum ada'}</Td>
                  <Td>{i.used_at ? i.used_at.slice(0, 10) : 'Belum ada'}</Td>
                  <Td>{i.revoked_at ? i.revoked_at.slice(0, 10) : 'Belum ada'}</Td>
                </tr>
              ))}
            </Table>
            <p className="text-caption text-muted">
              Kode yang dipakai untuk mengisi berbeda dari ID pseudonim yang diekspor (PRD §6). Hash token tidak dirender.
            </p>
          </Card>

          <Card className="flex flex-col gap-3">
            <SectionTitle>Buat undangan baru (simulasi)</SectionTitle>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="penugasan-baru" label="Label penugasan">
                {(aria) => <TextInput {...aria} placeholder="Penugasan contoh 06" />}
              </Field>
              <Field id="kedaluwarsa-baru" label="Berlaku sampai" hint="Format tanggal contoh.">
                {(aria) => <TextInput {...aria} type="date" defaultValue="2026-12-31" />}
              </Field>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button disabled={state === 'loading' || state === 'closed'}>Buat kode undangan</Button>
              <ActionLink to={link(ROUTES.creatorHistory(id))} variant="secondary">Lihat riwayat versi</ActionLink>
            </div>
          </Card>
        </div>
      </StateView>
      <DevStateSwitcher routeId="creator-share" />
    </Shell>
  );
}

/* ---------------- Hasil ---------------- */

export function ResultsPage() {
  const id = useSurveyId();
  const { state } = useScreenState('creator-results');
  const survey = findSurvey(id)!;
  const versionList = versionsFor(id);
  const [versionId, setVersionId] = useState(survey.current_version_id ?? versionList[0]?.id ?? '');
  const [exportRequested, setExportRequested] = useState(false);
  const questions = questionsFor(versionId);
  const useEmpty = state === 'no-answers' || state === 'empty';
  const source = useEmpty ? [] : responses;
  const summary = computeSummary(versionId, questions, source);
  const denied = state === 'permission-denied';

  return (
    <Shell kind="creator" routeId="creator-results" title="Hasil per versi" subtitle="Distribusi per kombinasi versi, item, dan nilai opsi. Opsi tanpa pemilih tetap tampil sebagai nol (PRD §7).">
      <StateView
        routeId="creator-results"
        state={state}
        emptyTitle="Belum ada versi diterbitkan"
        emptyDetail="Hasil hanya tersedia setelah versi diterbitkan."
        permissionDetail="Unduhan jawaban individual memerlukan izin ekspor terpisah."
      >
        <div className="flex flex-col gap-5">
          <StateDebugHint routeId="creator-results" state={state} />
          <SurveyNav id={id} />

          {state === 'success' && <SuccessBanner title="Ringkasan dimuat ulang">Ringkasan dibaca dari respons final, bukan dari pratinjau.</SuccessBanner>}
          {state === 'closed' && <Banner tone="warning" title="Versi ditutup">Hasil versi yang ditutup tetap dapat dibaca sesuai retensi.</Banner>}

          <Card className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="pilih-versi" className="text-body-sm font-bold text-ink">Versi</label>
                <select
                  id="pilih-versi"
                  value={versionId}
                  onChange={(e) => setVersionId(e.target.value)}
                  className="mt-1 min-h-[52px] w-full rounded-md border border-n200 bg-n0 px-3 text-body-sm text-ink"
                >
                  {versionList.map((v) => (
                    <option key={v.id} value={v.id}>Versi {v.number} · {v.status}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col justify-end gap-2">
                <Label>Total kiriman final</Label>
                <p className="text-h2 font-bold text-ink">{summary.totalResponses}</p>
              </div>
            </div>
            <p className="text-caption text-muted">
              Pratinjau tidak menambah respons, statistik, atau ekspor. Jawaban opsional yang kosong tidak dihitung sebagai nilai nol.
            </p>
          </Card>

          {summary.questions.map((qs) => {
            const q = qs.question;
            return (
              <Card key={q.id} className="flex flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Label><Code>{q.code}</Code> · {q.section}</Label>
                    <p className="mt-1 text-body font-bold text-ink">{q.label}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone="neutral">Terjawab {qs.answered}</Badge>
                    <Badge tone="neutral">Dilewati {qs.skipped}</Badge>
                    <Badge tone="info">Total {qs.total}</Badge>
                  </div>
                </div>
                <Divider />
                {q.type === 'short_text' ? (
                  <div>
                    <p className="text-body-sm text-muted">Isian teks bebas hanya untuk penerima berizin.</p>
                    {denied ? (
                      <Banner tone="danger" title="Teks bebas tidak ditampilkan">Izin baca teks bebas terpisah dari izin ekspor.</Banner>
                    ) : (
                      <p className="mt-2 text-body-sm text-ink">
                        {qs.freeTextCount > 0 ? `${qs.freeTextCount} isian teks tersedia (konten tidak dirender di sini).` : 'Belum ada jawaban'}
                      </p>
                    )}
                  </div>
                ) : (
                  <Table head={['Nilai', 'Label opsi', 'Frekuensi', 'Persentase']}>
                    {qs.frequencies.map((f) => (
                      <tr key={f.option.id}>
                        <Th><Code>{f.option.value}</Code></Th>
                        <Td>{f.option.label}</Td>
                        <Td className="font-bold">{f.count}</Td>
                        <Td>{percentage(f.count, qs.answered)}</Td>
                      </tr>
                    ))}
                  </Table>
                )}
                {qs.answered === 0 && q.type !== 'short_text' && (
                  <Banner tone="neutral" title="Belum ada jawaban">Penyebut nol tidak dibagi; opsi tetap ditampilkan sebagai nol.</Banner>
                )}
              </Card>
            );
          })}

          <Card className="flex flex-col gap-3">
            <SectionTitle>Ekspor</SectionTitle>
            {denied ? (
              <Banner tone="danger" title="Ekspor ditolak">
                Akun ini tidak memiliki izin ekspor pada survei ini. Percobaan akses langsung ke URL tidak mengubah hasil.
              </Banner>
            ) : (
              <Banner tone="info" title="Ekspor diizinkan">
                CSV UTF-8 per versi dan kodebook. Nama tidak masuk ekspor standar; token tidak pernah diekspor.
              </Banner>
            )}
            <div className="flex flex-wrap gap-3">
              <Button
                variant="secondary"
                disabled={denied || summary.totalResponses === 0 || state === 'loading'}
                onClick={() => setExportRequested(true)}
              >
                {exportRequested ? 'Unduhan disiapkan (simulasi)' : 'Unduh CSV + kodebook'}
              </Button>
              <ActionLink to={ROUTES.adminAudit} variant="secondary">Lihat catatan ekspor pada audit</ActionLink>
            </div>
            <p className="text-caption text-muted">
              Kolom teks bebas dan jawaban individual memerlukan izin terpisah dan dicatat penerimanya (PRD §7.2).
            </p>
          </Card>
        </div>
      </StateView>
      <DevStateSwitcher routeId="creator-results" />
    </Shell>
  );
}

/* ---------------- Pengaturan ---------------- */

export function SettingsPage() {
  const id = useSurveyId();
  const { state } = useScreenState('creator-settings');
  const profile = profileForSurvey(id);
  const notice = noticeForSurvey(id);
  const [allowResults, setAllowResults] = useState(true);
  const [allowIndividual, setAllowIndividual] = useState(false);

  return (
    <Shell kind="creator" routeId="creator-settings" title="Pengaturan dan pemberitahuan" subtitle="Notice wajib tampil sebelum item pertama dan tetap tersedia setelah versi ditutup (PRD §9.3).">
      <StateView
        routeId="creator-settings"
        state={state}
        permissionDetail="Pengaturan hanya dapat diubah pemilik survei."
      >
        <div className="flex flex-col gap-5">
          <StateDebugHint routeId="creator-settings" state={state} />
          <SurveyNav id={id} />
          {state === 'success' && <SuccessBanner title="Pengaturan tersimpan pada tampilan">Perubahan tidak dikirim ke server.</SuccessBanner>}
          {state === 'validation' && <ValidationSummary items={['Kontak permintaan data wajib diisi sebelum data nyata.', 'Masa retensi wajib ditetapkan pengendali.']} />}

          <Card className="flex flex-col gap-4">
            <SectionTitle>Profil deployment</SectionTitle>
            <Table head={['Field', 'Nilai']}>
              <tr><Th>organization_name</Th><Td>{profile.organization_name}</Td></tr>
              <tr><Th>organization_type</Th><Td><Code>{profile.organization_type}</Code></Td></tr>
              <tr><Th>respondent_age_category</Th><Td><Code>{profile.respondent_age_category}</Code></Td></tr>
              <tr><Th>consent_mode</Th><Td><Code>{profile.consent_mode}</Code></Td></tr>
              <tr><Th>retention_days</Th><Td>{profile.retention_days ?? 'Belum ditetapkan (placeholder sintetis)'}</Td></tr>
              <tr><Th>data_request_contact</Th><Td>{profile.data_request_contact ?? 'Belum ditetapkan (placeholder sintetis)'}</Td></tr>
              <tr><Th>cross_border_transfer</Th><Td>{profile.cross_border_transfer === null ? 'Belum ditinjau' : String(profile.cross_border_transfer)}</Td></tr>
              <tr><Th>policy_url / terms_url</Th><Td><PlainLink to={ROUTES.privacy}>/privacy</PlainLink> · <PlainLink to={ROUTES.terms}>/terms</PlainLink></Td></tr>
            </Table>
            <Banner tone="warning" title="Nilai menunggu keputusan pengendali">
              Jangan mengisi kebijakan organisasi rekaan. Teks di atas placeholder sintetis untuk development (PRD §9.7, §14).
            </Banner>
          </Card>

          <Card className="flex flex-col gap-3">
            <SectionTitle>Pemberitahuan per survei</SectionTitle>
            <p className="font-mono text-caption tracking-mono text-muted">Versi notice: {notice.version}</p>
            <Table head={['Bagian', 'Isi']}>
              <tr><Th>Tujuan</Th><Td>{notice.purpose}</Td></tr>
              <tr><Th>Jenis data</Th><Td>{notice.data_categories}</Td></tr>
              <tr><Th>Penggunaan Modul 15</Th><Td>{notice.module15_usage}</Td></tr>
              <tr><Th>Retensi</Th><Td>{notice.retention_text}</Td></tr>
              <tr><Th>Penerima</Th><Td>{notice.recipients}</Td></tr>
              <tr><Th>Kontak</Th><Td>{notice.contact}</Td></tr>
              <tr><Th>Hak peserta</Th><Td>{notice.rights}</Td></tr>
              <tr><Th>Data anak</Th><Td>{notice.child_data_text}</Td></tr>
            </Table>
            <p className="text-caption text-muted">Perubahan material membuat versi notice baru; persetujuan lama tetap merujuk versi yang disetujui.</p>
          </Card>

          <Card className="flex flex-col gap-3">
            <SectionTitle>Akses hasil</SectionTitle>
            <Checkbox id="izin-agregat" label="Petugas berizin boleh melihat ringkasan agregat" checked={allowResults} onChange={setAllowResults} />
            <Checkbox id="izin-individual" label="Petugas berizin boleh membaca jawaban individual" checked={allowIndividual} onChange={setAllowIndividual} />
            <p className="text-caption text-muted">
              Izin baca individual, izin ekspor, dan izin teks bebas adalah tiga izin terpisah (PRD §3).
            </p>
            <div className="flex flex-wrap gap-3">
              <Button disabled={state === 'loading'} loading={state === 'loading'}>Simpan pengaturan</Button>
              <ActionLink to={ROUTES.adminAccounts} variant="secondary">Kelola izin akun</ActionLink>
            </div>
          </Card>
        </div>
      </StateView>
      <DevStateSwitcher routeId="creator-settings" />
    </Shell>
  );
}

/* ---------------- Riwayat versi ---------------- */

export function HistoryPage() {
  const id = useSurveyId();
  const { state, link } = useScreenState('creator-history');
  const versionList = versionsFor(id);

  return (
    <Shell kind="creator" routeId="creator-history" title="Riwayat versi" subtitle="Formulir yang sudah terbuka tetap mengirim ke versi lamanya; perubahan isi memerlukan versi baru (PRD §5.2).">
      <StateView
        routeId="creator-history"
        state={state}
        emptyTitle="Belum ada versi"
        emptyDetail="Versi dibuat saat publikasi pertama."
        permissionDetail="Riwayat hanya dapat dibaca pemilik survei."
      >
        <div className="flex flex-col gap-5">
          <StateDebugHint routeId="creator-history" state={state} />
          <SurveyNav id={id} />
          {state === 'success' && <SuccessBanner title="Status versi diperbarui">Penutupan dan pengarsipan hanya mengubah tampilan pada pratinjau.</SuccessBanner>}
          {state === 'closed' && <Banner tone="warning" title="Versi lama ditutup">Kiriman baru ditolak; riwayat versi lama tetap dapat dibaca.</Banner>}

          <Card className="flex flex-col gap-3">
            <SectionTitle>Daftar versi</SectionTitle>
            <Table head={['Versi', 'Status', 'Diterbitkan', 'Ditutup', 'Jumlah item']}>
              {versionList.map((v) => (
                <tr key={v.id}>
                  <Th><Code>v{v.number}</Code></Th>
                  <Td><Badge tone={v.status === 'published' ? 'success' : v.status === 'closed' ? 'warning' : 'neutral'}>{v.status}</Badge></Td>
                  <Td>{v.published_at ? v.published_at.slice(0, 10) : 'Belum ada'}</Td>
                  <Td>{v.closed_at ? v.closed_at.slice(0, 10) : 'Belum ada'}</Td>
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
            <Button variant="secondary" disabled={state === 'loading'}>Tutup versi terpilih</Button>
            <Button variant="secondary" disabled={state === 'loading'}>Arsipkan survei</Button>
            <ActionLink to={link(ROUTES.creatorResults(id))} variant="secondary">Lihat hasil per versi</ActionLink>
          </div>
        </div>
      </StateView>
      <DevStateSwitcher routeId="creator-history" />
    </Shell>
  );
}
