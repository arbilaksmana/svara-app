import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shell } from '../components/Shell';
import {
  ActionLink,
  Badge,
  Banner,
  Button,
  Card,
  Checkbox,
  Code,
  Field,
  Muted,
  Panel,
  PlainLink,
  PolicyLinks,
  SectionTitle,
  TextInput,
} from '../components/ui';
import { StateView, StateDebugHint, SuccessBanner, ValidationSummary } from '../components/StateView';
import { DevStateSwitcher, useScreenState } from '../lib/state';
import { ROUTES } from '../lib/routes';
import { surveys } from '../lib/fixtures/surveys';
import { profileForSurvey } from '../lib/fixtures/profiles';

/* ---------------- Landing ---------------- */

export function HomePage() {
  const { state, link } = useScreenState('home');
  return (
    <Shell kind="public" routeId="home" title="Pembuat survei dengan skoring dasar otomatis">
      <StateView
        routeId="home"
        state={state}
        emptyTitle="Belum ada survei contoh"
        emptyDetail="Fixture belum dimuat. Tautan ke masing-masing peran tetap tersedia di bawah."
      >
        <div className="flex flex-col gap-6">
          <StateDebugHint routeId="home" state={state} />
          <Panel>
            <p className="text-body font-bold text-ink">Pratinjau seluruh antarmuka sebelum backend.</p>
            <p className="mt-1 text-body-sm text-muted">
              Semua data berasal dari fixture lokal. Tidak ada API, basis data, autentikasi nyata, email, atau integrasi Modul 13/15.
              Tampilan ini bukan bukti lulus AC01 sampai AC17.
            </p>
          </Panel>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card>
              <SectionTitle>Creator</SectionTitle>
              <Muted>Susun instrumen, terbitkan versi, bagikan tautan, dan baca ringkasan agregat.</Muted>
              <div className="mt-4 flex flex-col gap-2">
                <ActionLink to={ROUTES.creator} block>Buka daftar survei</ActionLink>
                <ActionLink to={ROUTES.login} variant="secondary" block>Masuk pengelola</ActionLink>
              </div>
            </Card>
            <Card>
              <SectionTitle>Responden</SectionTitle>
              <Muted>Baca pemberitahuan, isi formulir, tinjau, lalu terima bukti pengiriman.</Muted>
              <div className="mt-4 flex flex-col gap-2">
                <ActionLink to={ROUTES.respondentIntro('link-umum-demo')} block>Buka tautan umum A</ActionLink>
                <ActionLink to={ROUTES.respondentIntro('link-umum-perpus')} variant="secondary" block>Buka tautan umum B</ActionLink>
              </div>
            </Card>
            <Card>
              <SectionTitle>Super admin</SectionTitle>
              <Muted>Pantau metrik operasional tanpa akses ke jawaban individual.</Muted>
              <div className="mt-4">
                <ActionLink to={ROUTES.admin} block>Buka ringkasan admin</ActionLink>
              </div>
            </Card>
          </div>

          <div>
            <SectionTitle>Dua konfigurasi contoh, komponen yang sama</SectionTitle>
            <div className="mt-3 flex flex-col gap-3">
              {surveys.filter((s) => s.id !== 's_demo3' && s.id !== 's_demo4').map((s) => {
                const profile = profileForSurvey(s.id);
                return (
                  <Card key={s.id} className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-body font-bold text-ink">{s.title}</p>
                      <p className="mt-1 text-body-sm text-muted">{s.purpose}</p>
                      <p className="mt-2 flex flex-wrap gap-2">
                        <Badge tone="info"><Code>{s.id}</Code></Badge>
                        <Badge tone={profile.consent_mode === 'guardian' ? 'warning' : 'neutral'}>
                          consent: {profile.consent_mode}
                        </Badge>
                        <Badge tone="neutral">{profile.respondent_age_category}</Badge>
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                      <ActionLink to={ROUTES.creatorEdit(s.id)} variant="secondary">Lihat editor</ActionLink>
                      <PlainLink to={ROUTES.respondentIntro(s.id === 's_demo2' ? 'link-umum-perpus' : 'link-umum-demo')}>
                        Lihat formulir
                      </PlainLink>
                    </div>
                  </Card>
                );
              })}
            </div>
            <p className="mt-3 text-caption text-muted">
              Kode item, topik, dan skala hanya berada di fixture dan halaman contoh ini, bukan di komponen generik.
            </p>
          </div>

          <Card className="flex flex-col gap-3">
            <SectionTitle>State yang bisa dicoba</SectionTitle>
            <p className="text-body-sm text-muted">
              Tambahkan <Code>?state=</Code> pada URL atau pakai pemilih state saat development. Contoh:
            </p>
            <ul className="flex list-inside list-disc flex-col gap-1 text-body-sm text-ink">
              <li><PlainLink to={link(`${ROUTES.creatorResults('s_demo1')}?state=no-answers`)}>Hasil tanpa respons</PlainLink></li>
              <li><PlainLink to={link(`${ROUTES.respondentForm('undangan-demo')}?state=revoked`)}>Undangan dicabut</PlainLink></li>
              <li><PlainLink to={link(`${ROUTES.adminIntegration}?state=error`)}>Layanan terputus</PlainLink></li>
            </ul>
            <PolicyLinks className="mt-2" />
          </Card>
        </div>
      </StateView>
      <DevStateSwitcher routeId="home" />
    </Shell>
  );
}

/* ---------------- Login ---------------- */

export function LoginPage() {
  const { state, link } = useScreenState('login');
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const inviteInvalid = invite && !agreed;
  const formInvalid = !email || !password || inviteInvalid;

  return (
    <Shell kind="public" routeId="login" title="Masuk sebagai pengelola" subtitle="F-01: login pengelola. Akun publik pendaftaran tidak termasuk dalam pratinjau ini.">
      <StateView
        routeId="login"
        state={state}
        permissionDetail="Akun ini tidak memiliki peran pengelola pada lingkungan contoh."
        emptyAction={<ActionLink to={ROUTES.home}>Kembali ke beranda</ActionLink>}
        conflictTo={ROUTES.creator}
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            {state === 'success' && (
              <SuccessBanner title="Sesi contoh dibuat">
                <ActionLink to={ROUTES.creator} variant="secondary">Lanjut ke daftar survei</ActionLink>
              </SuccessBanner>
            )}
            {state === 'validation' && (
              <ValidationSummary items={['Alamat email contoh wajib diisi.', 'Kata sandi contoh wajib diisi.', 'Kode undangan harus disetujui bika dipakai.']} />
            )}
            {state === 'expired' && <Banner tone="warning" title="Sesi kedaluwarsa">Silakan masuk kembali. Tidak ada kredensial yang disimpan pada pratinjau.</Banner>}
            {state === 'revoked' && <Banner tone="danger" title="Kode undangan dicabut">Kode tidak dapat dipakai lagi untuk masuk.</Banner>}
            {state === 'error' && <Banner tone="danger" title="Login gagal">Kredensial contoh tidak cocok. Coba lagi atau gunakan tautan beranda.</Banner>}
            {state === 'loading' && <Banner tone="neutral" title="Memeriksa sesi">Tombol masuk dinonaktifkan sementara.</Banner>}
            {state === 'permission-denied' && <Banner tone="danger" title="Peran tidak memadai">Akses ke konsol creator memerlukan peran pengelola.</Banner>}

            <form
              className="flex flex-col gap-4"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                setSubmitted(true);
                if (formInvalid) return;
                navigate(link(ROUTES.creator));
              }}
            >
              <Field id="login-email" label="Alamat email contoh" required hint="Gunakan nilai apa pun; tidak ada autentikasi nyata.">
                {(aria) => (
                  <TextInput
                    {...aria}
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="pengelola@contoh.invalid"
                  />
                )}
              </Field>
              <Field id="login-password" label="Kata sandi contoh" required hint="Nilai tidak dikirim ke mana pun.">
                {(aria) => (
                  <TextInput
                    {...aria}
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                )}
              </Field>

              <Checkbox
                id="login-invite"
                label="Saya memiliki kode undangan"
                checked={invite}
                onChange={setInvite}
              />
              {invite && (
                <Field id="login-invite-code" label="Kode undangan" hint="Kode tampilan dari halaman Bagikan. Token tidak dimasukkan di sini.">
                  {(aria) => <TextInput {...aria} placeholder="UND-01-AKTIF" />}
                </Field>
              )}
              {invite && (
                <Checkbox
                  id="login-invite-agree"
                  label="Saya setuju memakai kode undangan ini sesuai ketentuan."
                  checked={agreed}
                  onChange={setAgreed}
                />
              )}

              {submitted && formInvalid && !['validation', 'loading', 'error', 'permission-denied', 'expired', 'revoked'].includes(state) && (
                <p role="alert" className="text-caption font-bold text-danger">Lengkapi kolom wajib sebelum melanjutkan.</p>
              )}

              <Button type="submit" block disabled={state === 'loading'} loading={state === 'loading'}>
                Masuk ke konsol
              </Button>
            </form>
            <PolicyLinks className="mt-4" />
          </Card>

          <div className="flex flex-col gap-4">
            <Panel>
              <SectionTitle>Batas pratinjau</SectionTitle>
              <ul className="mt-2 flex list-inside list-disc flex-col gap-2 text-body-sm text-muted">
                <li>Tidak ada autentikasi nyata, sesi server, atau pemeriksaan peran di server.</li>
                <li>Uji izin lintas akun (AC03) memerlukan backend.</li>
                <li>Kode undangan di sini hanya ilustrasi tampilan.</li>
              </ul>
            </Panel>
            <Panel>
              <SectionTitle>Akses tanpa login</SectionTitle>
              <p className="mt-2 text-body-sm text-muted">Halaman kebijakan dan formulir responden dapat dibuka tanpa akun.</p>
              <div className="mt-3 flex flex-col gap-2">
                <PlainLink to={ROUTES.privacy}>Kebijakan privasi</PlainLink>
                <PlainLink to={ROUTES.terms}>Ketentuan layanan</PlainLink>
                <PlainLink to={ROUTES.respondentIntro('link-umum-demo')}>Buka formulir responden</PlainLink>
              </div>
            </Panel>
          </div>
        </div>
      </StateView>
      <DevStateSwitcher routeId="login" />
    </Shell>
  );
}

/* ---------------- 404 ---------------- */

export function NotFoundPage() {
  return (
    <Shell kind="public" routeId="notfound" title="Halaman tidak ditemukan">
      <Card>
        <p className="text-body text-ink">Rute yang diminta tidak ada dalam peta pratinjau.</p>
        <p className="mt-2 text-body-sm text-muted">Gunakan tautan berikut untuk kembali ke alur yang tersedia.</p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <ActionLink to={ROUTES.home}>Kembali ke beranda</ActionLink>
          <ActionLink to={ROUTES.creator} variant="secondary">Daftar survei</ActionLink>
        </div>
      </Card>
      <DevStateSwitcher routeId="notfound" />
    </Shell>
  );
}

/* ---------------- Kebijakan ---------------- */

const PRIVACY_SECTIONS = [
  { title: 'Identitas dan kontak', body: 'Nama organisasi, pengendali, prosesor, dan kontak permintaan data diambil dari profil deployment. Nilai pada pratinjau ini berlabel placeholder sintetis dan belum disetujui pengendali.' },
  { title: 'Tujuan dan dasar pemrosesan', body: 'Mengumpulkan tanggapan survei untuk diringkas per versi. Dasar pemrosesan, termasuk persetujuan wali bila responden anak, ditetapkan pengendali sebelum data nyata.' },
  { title: 'Kategori data', body: 'Jawaban skala, isian teks singkat, kode acak peserta, waktu pengiriman, dan catatan persetujuan. Tidak meminta nama, tanggal lahir, atau nomor identitas secara default.' },
  { title: 'Penerima', body: 'Pembuat survei, petugas berizin, dan konsumen integrasi Modul 13/15 sesuai cakupan dan izin terpisah.' },
  { title: 'Retensi', body: 'Masa simpan mengikuti profil deployment. Profil contoh A belum ditetapkan; profil contoh B memakai 90 hari sintetis.' },
  { title: 'Hak subjek dan prosedur permintaan', body: 'Akses, koreksi, penarikan persetujuan, dan penghapusan melalui kanal resmi pengendali dengan verifikasi pemohon. Tindak lanjut dicatat tanpa memuat jawaban atau token.' },
  { title: 'Transfer lintas negara', body: 'Tidak diaktifkan sampai ada peninjauan dan keputusan pengendali.' },
  { title: 'Data anak', body: 'Bila profil menetapkan responden anak, persetujuan orang tua atau wali dan bukti verifikasi wajib sebelum pengiriman baru.' },
];

const TERMS_SECTIONS = [
  { title: 'Aturan penggunaan', body: 'Pratinjau ini hanya untuk melihat antarmuka dengan data sintetis. Tidak boleh dipakai untuk mengumpulkan data responden nyata.' },
  { title: 'Tanggung jawab akun creator/admin', body: 'Pembuat survei bertanggung jawab atas instrumen, pemberitahuan, dan penerima data. Pemeriksaan kepemilikan dan peran nyata berada pada server.' },
  { title: 'Kepemilikan konten', body: 'Konfigurasi survei milik pembuatnya. Respons final terkunci bagi responden, tetapi permintaan data oleh pihak berwenang tetap dapat diproses.' },
  { title: 'Ketersediaan', body: 'Pratinjau statis tidak menjanjikan ketersediaan layanan, kinerja, atau pemulihan insiden.' },
  { title: 'Batas tanggung jawab', body: 'Tidak ada jaminan kepatuhan, keamanan, atau kinerja yang diklaim dari tampilan statis. Bukti mutu diisi setelah pengujian nyata.' },
  { title: 'Penghentian', body: 'Versi dapat ditutup atau diarsipkan. Riwayat dipertahankan sesuai retensi yang ditetapkan pengendali.' },
];

function LegalPage({ which }: { which: 'privacy' | 'terms' }) {
  const routeId = which;
  const { state } = useScreenState(routeId);
  const isPrivacy = which === 'privacy';
  const title = isPrivacy ? 'Kebijakan privasi' : 'Ketentuan layanan';
  const sections = isPrivacy ? PRIVACY_SECTIONS : TERMS_SECTIONS;

  return (
    <Shell kind="public" routeId={routeId} title={title} subtitle="Dapat diakses tanpa login. Teks berikut template generik berlabel sintetis, bukan dokumen legal yang disahkan.">
      <StateView routeId={routeId} state={state}>
        <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
          <div className="flex flex-col gap-6">
            <Banner tone="warning" title="Placeholder sintetis">
              Isi final, penanggung jawab, kontak, retensi, dan prosedur ditetapkan pengendali sebelum pilot (PRD §9.3, §14).
            </Banner>
            {sections.map((section) => (
              <section key={section.title} aria-labelledby={`legal-${section.title.replace(/\s/g, '-')}`}>
                <h2 id={`legal-${section.title.replace(/\s/g, '-')}`} className="text-h3 font-bold text-ink">{section.title}</h2>
                <p className="mt-2 max-w-[70ch] text-body text-muted">{section.body}</p>
              </section>
            ))}
            <PolicyLinks className="border-t border-n200 pt-4" />
          </div>
          <Panel className="h-fit">
            <SectionTitle>Kanal permintaan data</SectionTitle>
            <p className="mt-2 text-body-sm text-muted">
              Akses, koreksi, penarikan persetujuan, dan penghapusan melalui kontak pada profil deployment. Verifikasi pemohon dicatat; log tidak memuat jawaban atau token.
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <PlainLink to={isPrivacy ? ROUTES.terms : ROUTES.privacy}>
                {isPrivacy ? 'Ketentuan layanan' : 'Kebijakan privasi'}
              </PlainLink>
              <PlainLink to={ROUTES.home}>Beranda</PlainLink>
            </div>
          </Panel>
        </div>
      </StateView>
      <DevStateSwitcher routeId={routeId} />
    </Shell>
  );
}

export function PrivacyPage() { return <LegalPage which="privacy" />; }
export function TermsPage() { return <LegalPage which="terms" />; }
