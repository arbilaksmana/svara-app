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
  Field,
  PlainLink,
  PolicyLinks,
  SectionTitle,
  TextInput,
  TextLink,
} from '../components/ui';
import { StateView, SuccessBanner, ValidationSummary } from '../components/StateView';
import { DevStateSwitcher, useScreenState } from '../lib/state';
import { useToast } from '../components/Toast';
import { signIn, useStore } from '../lib/store';
import { ROUTES } from '../lib/routes';
import { surveys } from '../lib/fixtures/surveys';
import { responses } from '../lib/fixtures/records';

/* ---------------- Landing ---------------- */

export function HomePage() {
  const { state } = useScreenState('home');
  const { session, revision } = useStore();
  void revision;
  const recent = [...surveys].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 3);

  return (
    <Shell kind="public" title={session ? `Selamat datang, ${session.name}` : 'Kelola survei dari satu tempat'} subtitle="Susun instrumen, terbitkan tautan, pantau jawaban, dan unduh hasil per versi.">
      <StateView
        routeId="home"
        state={state}
        emptyTitle="Belum ada survei"
        emptyDetail="Mulai dari draf baru untuk membuat instrumen pertama Anda."
        emptyAction={<ActionLink to={ROUTES.creator}>Buka daftar survei</ActionLink>}
      >
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <p className="font-mono text-caption font-bold tracking-mono text-n600">SURVEI</p>
              <p className="mt-2 text-h1 font-bold text-ink">{surveys.length}</p>
              <p className="text-body-sm text-muted">Total instrumen di workspace</p>
            </Card>
            <Card>
              <p className="font-mono text-caption font-bold tracking-mono text-n600">DITERBITKAN</p>
              <p className="mt-2 text-h1 font-bold text-ink">{surveys.filter((s) => s.status === 'published').length}</p>
              <p className="text-body-sm text-muted">Sedang menerima jawaban</p>
            </Card>
            <Card>
              <p className="font-mono text-caption font-bold tracking-mono text-n600">JAWABAN</p>
              <p className="mt-2 text-h1 font-bold text-ink">{responses.length}</p>
              <p className="text-body-sm text-muted">Respons final tercatat</p>
            </Card>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SectionTitle>Survei terbaru</SectionTitle>
              <TextLink to={ROUTES.creator}>Lihat semua survei</TextLink>
            </div>
            {recent.map((s) => (
              <Card key={s.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-body font-bold text-ink">{s.title}</p>
                  <p className="mt-1 text-body-sm text-muted">{s.purpose}</p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-3">
                  <Badge tone={s.status === 'published' ? 'success' : s.status === 'draft' ? 'neutral' : 'info'}>
                    {s.status === 'published' ? 'Terbit' : s.status === 'draft' ? 'Draf' : s.status === 'closed' ? 'Ditutup' : 'Arsip'}
                  </Badge>
                  <TextLink to={ROUTES.creatorEdit(s.id)}>Buka</TextLink>
                </div>
              </Card>
            ))}
          </div>

          <Card className="flex flex-col gap-3">
            <SectionTitle>Mulai dari sini</SectionTitle>
            <p className="text-body-sm text-muted">
              {session
                ? 'Lanjutkan pekerjaan pada instrumen Anda atau bagikan tautan yang sudah terbit.'
                : 'Masuk sebagai pengelola untuk menyimpan perubahan, atau langsung isi survei melalui tautan responden.'}
            </p>
            <div className="flex flex-wrap gap-3">
              <ActionLink to={session ? ROUTES.creator : ROUTES.login}>
                {session ? 'Buka workspace' : 'Masuk sebagai pengelola'}
              </ActionLink>
              <ActionLink to={ROUTES.respondentIntro('link-umum-demo')} variant="secondary">
                Isi survei sebagai responden
              </ActionLink>
              <ActionLink to={ROUTES.admin} variant="secondary">Panel administrasi</ActionLink>
            </div>
            <PolicyLinks className="mt-1" />
          </Card>
        </div>
      </StateView>
      <DevStateSwitcher routeId="home" />
    </Shell>
  );
}

/* ---------------- Login ---------------- */

export function LoginPage() {
  const { state } = useScreenState('login');
  const navigate = useNavigate();
  const notify = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const inviteInvalid = invite && !agreed;
  const formInvalid = !email || !password || inviteInvalid;

  return (
    <Shell kind="public" title="Masuk ke workspace" subtitle="Gunakan akun pengelola untuk menyusun instrumen, menerbitkan tautan, dan membaca hasil.">
      <StateView
        routeId="login"
        state={state}
        permissionDetail="Akun ini tidak memiliki peran pengelola."
        emptyAction={<ActionLink to={ROUTES.home}>Kembali ke beranda</ActionLink>}
        conflictTo={ROUTES.creator}
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            {state === 'success' && <SuccessBanner title="Berhasil masuk">Sesi Anda aktif pada peramban ini.</SuccessBanner>}
            {state === 'validation' && <ValidationSummary items={['Alamat email wajib diisi.', 'Kata sandi wajib diisi.', 'Kode undangan harus disetujui jika dipakai.']} />}
            {state === 'expired' && <Banner tone="warning" title="Sesi berakhir">Silakan masuk kembali untuk melanjutkan.</Banner>}
            {state === 'revoked' && <Banner tone="danger" title="Kode undangan tidak berlaku">Kode ini sudah dicabut atau kedaluwarsa.</Banner>}
            {state === 'error' && <Banner tone="danger" title="Tidak dapat masuk">Periksa kembali alamat email dan kata sandi Anda.</Banner>}
            {state === 'loading' && <Banner tone="neutral" title="Memeriksa kredensial">Tombol masuk dinonaktifkan sementara.</Banner>}
            {state === 'permission-denied' && <Banner tone="danger" title="Peran tidak memadai">Akses workspace memerlukan peran pengelola.</Banner>}

            <form
              className="flex flex-col gap-4"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                setSubmitted(true);
                if (formInvalid) return;
                signIn(email, email.includes('admin') ? 'admin' : 'creator');
                notify('Berhasil masuk. Selamat datang kembali.');
                navigate(ROUTES.creator);
              }}
            >
              <Field id="login-email" label="Alamat email" required>
                {(aria) => (
                  <TextInput {...aria} type="email" autoComplete="username" value={email}
                    onChange={(e) => setEmail(e.target.value)} placeholder="nama@organisasi.id" />
                )}
              </Field>
              <Field id="login-password" label="Kata sandi" required>
                {(aria) => (
                  <TextInput {...aria} type="password" autoComplete="current-password" value={password}
                    onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
                )}
              </Field>

              <Checkbox id="login-invite" label="Saya memiliki kode undangan" checked={invite} onChange={setInvite} />
              {invite && (
                <Field id="login-invite-code" label="Kode undangan" hint="Dapatkan kode dari pengelola survei.">
                  {(aria) => <TextInput {...aria} placeholder="UND-001" />}
                </Field>
              )}
              {invite && (
                <Checkbox id="login-invite-agree" label="Saya setuju menggunakan kode undangan ini." checked={agreed} onChange={setAgreed} />
              )}

              {submitted && formInvalid && !['validation', 'loading', 'error', 'permission-denied', 'expired', 'revoked'].includes(state) && (
                <p role="alert" className="text-caption font-bold text-danger">Lengkapi kolom wajib sebelum melanjutkan.</p>
              )}

              <Button type="submit" block disabled={state === 'loading'} loading={state === 'loading'}>Masuk</Button>
            </form>
            <PolicyLinks className="mt-4" />
          </Card>

          <div className="flex flex-col gap-4">
            <Card>
              <SectionTitle>Akses tanpa akun</SectionTitle>
              <p className="mt-2 text-body-sm text-muted">
                Responden tidak perlu membuat akun. Cukup buka tautan yang dibagikan pengelola survei.
              </p>
              <div className="mt-3 flex flex-col gap-2">
                <PlainLink to={ROUTES.respondentIntro('link-umum-demo')}>Buka formulir responden</PlainLink>
                <PlainLink to={ROUTES.privacy}>Kebijakan privasi</PlainLink>
                <PlainLink to={ROUTES.terms}>Ketentuan layanan</PlainLink>
              </div>
            </Card>
            <Card>
              <SectionTitle>Tentang akses</SectionTitle>
              <p className="mt-2 text-body-sm text-muted">
                Pengelola mengelola survei miliknya. Administrator memantau operasional tanpa membuka jawaban individual.
              </p>
              <div className="mt-3"><ActionLink to={ROUTES.admin} variant="secondary">Buka panel administrasi</ActionLink></div>
            </Card>
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
    <Shell kind="public" title="Halaman tidak ditemukan">
      <Card>
        <p className="text-body text-ink">Halaman yang Anda cari tidak tersedia.</p>
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
  { title: 'Identitas dan kontak', body: 'Pengendali data adalah organisasi yang menerbitkan survei. Kontak permintaan data tersedia pada pemberitahuan tiap survei.' },
  { title: 'Tujuan dan dasar pemrosesan', body: 'Mengumpulkan tanggapan survei untuk diringkas per versi. Dasar pemrosesan, termasuk persetujuan wali bila responden anak, ditetapkan pengendali sebelum data nyata.' },
  { title: 'Kategori data', body: 'Jawaban skala, isian teks singkat, kode acak peserta, waktu pengiriman, dan catatan persetujuan. Tidak meminta nama, tanggal lahir, atau nomor identitas secara default.' },
  { title: 'Penerima', body: 'Pembuat survei, petugas berizin, dan konsumen integrasi Modul 13/15 sesuai cakupan dan izin terpisah.' },
  { title: 'Retensi', body: 'Masa simpan mengikuti kebijakan retensi pengendali dan ditampilkan pada pemberitahuan tiap survei.' },
  { title: 'Hak subjek dan prosedur permintaan', body: 'Akses, koreksi, penarikan persetujuan, dan penghapusan melalui kanal resmi pengendali dengan verifikasi pemohon. Tindak lanjut dicatat tanpa memuat jawaban atau token.' },
  { title: 'Transfer lintas negara', body: 'Data diproses di dalam wilayah yang ditetapkan pengendali.' },
  { title: 'Data anak', body: 'Bila profil menetapkan responden anak, persetujuan orang tua atau wali dan bukti verifikasi wajib sebelum pengiriman baru.' },
];

const TERMS_SECTIONS = [
  { title: 'Aturan penggunaan', body: 'Gunakan layanan untuk menyusun survei, membagikan tautan, dan mengolah jawaban sesuai pemberitahuan yang berlaku.' },
  { title: 'Tanggung jawab akun creator/admin', body: 'Pembuat survei bertanggung jawab atas instrumen, pemberitahuan, dan penerima data. Hak akses diberikan per survei.' },
  { title: 'Kepemilikan konten', body: 'Konfigurasi survei milik pembuatnya. Respons final terkunci bagi responden, tetapi permintaan data oleh pihak berwenang tetap dapat diproses.' },
  { title: 'Ketersediaan', body: 'Ketersediaan layanan mengikuti kesepakatan dengan pengendali. Gangguan diumumkan melalui kanal resmi.' },
  { title: 'Batas tanggung jawab', body: 'Layanan diberikan sesuai ketentuan yang berlaku. Pertanyaan dan permintaan data disalurkan melalui kanal resmi pengendali.' },
  { title: 'Penghentian', body: 'Versi dapat ditutup atau diarsipkan. Riwayat dipertahankan sesuai retensi yang ditetapkan pengendali.' },
];

function LegalPage({ which }: { which: 'privacy' | 'terms' }) {
  const routeId = which;
  const { state } = useScreenState(routeId);
  const isPrivacy = which === 'privacy';
  const title = isPrivacy ? 'Kebijakan privasi' : 'Ketentuan layanan';
  const sections = isPrivacy ? PRIVACY_SECTIONS : TERMS_SECTIONS;

  return (
    <Shell kind="public" title={title} subtitle="Kebijakan dan ketentuan berlaku untuk seluruh survei pada workspace ini.">
      <StateView routeId={routeId} state={state}>
        <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
          <div className="flex flex-col gap-6">
            {sections.map((section) => (
              <section key={section.title} aria-labelledby={`legal-${section.title.replace(/\s/g, '-')}`}>
                <h2 id={`legal-${section.title.replace(/\s/g, '-')}`} className="text-h3 font-bold text-ink">{section.title}</h2>
                <p className="mt-2 max-w-[70ch] text-body text-muted">{section.body}</p>
              </section>
            ))}
            <PolicyLinks className="border-t border-n200 pt-4" />
          </div>
          <Card className="h-fit">
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
          </Card>
        </div>
      </StateView>
      <DevStateSwitcher routeId={routeId} />
    </Shell>
  );
}

export function PrivacyPage() { return <LegalPage which="privacy" />; }
export function TermsPage() { return <LegalPage which="terms" />; }
