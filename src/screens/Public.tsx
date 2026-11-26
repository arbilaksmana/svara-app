'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BrandMark } from '../components/Brand';
import { Shell } from '../components/Shell';
import {
  ActionLink,
  Banner,
  Button,
  Card,
  ContactChannel,
  Field,
  PlainLink,
  PolicyLinks,
  SectionTitle,
  TextInput,
} from '../components/ui';
import { StateView, SuccessBanner, ValidationSummary } from '../components/StateView';
import { useScreenState } from '../lib/state';
import { useToast } from '../components/Toast';
import { signIn } from '../lib/store';
import { ApiError, getPublicPolicy, submitDataRequest } from '../lib/api';
import { ROUTES, homeForRole } from '../lib/routes';

/* ---------------- Login ---------------- */

export function LoginPage() {
  const { state } = useScreenState('login');
  const router = useRouter();
  const notify = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const formInvalid = !email || !password;

  return (
    <Shell kind="public" title="Masuk ke workspace" chromeless>
      <div className="grid flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)]">
        <div className="relative z-10 flex min-w-0 flex-col bg-n0 lg:rounded-tr-lg lg:rounded-br-lg">
          <div className="flex flex-1 flex-col justify-center px-5 pb-12 pt-6 sm:px-8 lg:px-14">
            <div className="mx-auto flex w-full max-w-[360px] flex-col gap-7">
              <div className="flex justify-center">
                <Link href={ROUTES.home} className="inline-flex min-h-[44px] items-center gap-2.5 text-h3 font-bold text-ink">
                  <BrandMark className="size-8" />
                  <span>Svara</span>
                </Link>
              </div>
              <StateView
        routeId="login"
        state={state}
        permissionDetail="Akun ini tidak memiliki peran pengelola."
        emptyAction={<ActionLink to={ROUTES.home}>Kembali ke beranda</ActionLink>}
        conflictTo={ROUTES.creator}
      >
              <div className="flex flex-col gap-5">
            <h1 className="text-center text-h2 font-bold text-ink wrap-break-word">Masuk ke workspace</h1>
            {state === 'success' && <SuccessBanner title="Berhasil masuk">Sesi Anda aktif pada peramban ini.</SuccessBanner>}
            {state === 'validation' && <ValidationSummary items={['Email wajib diisi.', 'Kata sandi wajib diisi.']} />}
            {state === 'expired' && <Banner tone="warning" title="Sesi berakhir">Silakan masuk kembali untuk melanjutkan.</Banner>}
            {state === 'revoked' && <Banner tone="danger" title="Sesi tidak berlaku">Sesi ini sudah dicabut atau tidak lagi berlaku. Silakan masuk kembali.</Banner>}
            {state === 'error' && <Banner tone="danger" title="Tidak dapat masuk">Periksa kembali alamat email dan kata sandi Anda.</Banner>}
            {state === 'loading' && <Banner tone="neutral" title="Memeriksa kredensial">Tombol masuk dinonaktifkan sementara.</Banner>}
            {state === 'permission-denied' && <Banner tone="danger" title="Peran tidak memadai">Akses workspace memerlukan peran pengelola.</Banner>}

            {authError && <Banner tone="danger" title="Tidak dapat masuk">{authError}</Banner>}
            <form
              className="flex flex-col gap-4"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                setSubmitted(true);
                setAuthError(null);
                if (formInvalid) return;
                setBusy(true);
                void signIn(email, password)
                  .then((session) => {
                    notify('Berhasil masuk. Selamat datang kembali.');
                    router.push(homeForRole(session.role));
                  })
                  .catch((error: unknown) => {
                    setAuthError(
                      error instanceof ApiError
                        ? error.message
                        : 'Koneksi ke server gagal. Periksa kembali alamat email dan kata sandi Anda.',
                    );
                  })
                  .finally(() => setBusy(false));
              }}
            >
              <Field id="login-email" label="Email" required>
                {(aria) => (
                  <TextInput
                    {...aria}
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="nama@organisasi.id"
                    aria-invalid={submitted && !email}
                    aria-describedby={submitted && !email ? 'login-email-error' : aria['aria-describedby']}
                  />
                )}
              </Field>
              {submitted && !email && (
                <p id="login-email-error" role="alert" className="text-caption font-bold text-danger">Email wajib diisi.</p>
              )}
              <Field id="login-password" label="Kata sandi" required>
                {(aria) => (
                  <TextInput
                    {...aria}
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    aria-invalid={submitted && !password}
                    aria-describedby={submitted && !password ? 'login-password-error' : aria['aria-describedby']}
                  />
                )}
              </Field>
              {submitted && !password && (
                <p id="login-password-error" role="alert" className="text-caption font-bold text-danger">Kata sandi wajib diisi.</p>
              )}

              <Button type="submit" block disabled={busy || state === 'loading'} loading={busy || state === 'loading'}>Masuk</Button>
            </form>

            <p className="text-center text-body-sm text-muted">
              Belum punya akun? <PlainLink to={ROUTES.register} className="min-h-[44px]">Daftar</PlainLink>
            </p>

              </div>
            </StateView>
            </div>
          </div>
        </div>

        <div aria-hidden="true" className="relative hidden lg:-ml-4 lg:block">
          {/* Foto: Declan Sun / Unsplash (lisensi Unsplash). */}
          <img
            src="/login-sky.jpg"
            alt=""
            width={1600}
            height={1200}
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
          />
        </div>
      </div>
    </Shell>
  );
}

/* ---------------- 404 ---------------- */

export function NotFoundPage() {
  return (
    <Shell kind="public" title="Halaman tidak ditemukan">
      <Card>
        <p className="text-body text-ink">Halaman yang Anda cari tidak tersedia.</p>
        <p className="mt-2 text-body-sm text-muted">Periksa kembali alamat tautan. Bila Anda menerima kode undangan survei, buka undangan dengan kode itu.</p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <ActionLink to={ROUTES.home}>Kembali ke beranda</ActionLink>
          <ActionLink to={ROUTES.respondentCode} variant="secondary">Buka undangan</ActionLink>
        </div>
      </Card>
      
    </Shell>
  );
}

/* ---------------- Kebijakan ---------------- */

const PRIVACY_SECTIONS = [
  { title: 'Identitas dan kontak', body: 'Pengendali data adalah organisasi yang menerbitkan survei. Kanal permintaan datanya ditampilkan pada kartu kanal di halaman ini; pemberitahuan tiap survei mencatat kanal organisasi yang sama.' },
  { title: 'Tujuan dan dasar pemrosesan', body: 'Mengumpulkan tanggapan survei untuk diringkas per versi. Dasar pemrosesan, termasuk persetujuan disertai bukti pendukung bila diwajibkan survei, ditetapkan pengendali sebelum data nyata.' },
  { title: 'Kategori data', body: 'Jawaban skala, isian teks singkat, kode acak peserta, waktu pengiriman, dan catatan persetujuan. Tidak meminta nama, tanggal lahir, atau nomor identitas secara default.' },
  { title: 'Penerima', body: 'Pembuat survei, petugas berizin, dan sistem mitra yang terhubung sesuai cakupan dan izin terpisah.' },
  { title: 'Retensi', body: 'Masa simpan mengikuti kebijakan retensi pengendali dan ditampilkan pada pemberitahuan tiap survei.' },
  { title: 'Hak subjek dan prosedur permintaan', body: 'Akses, koreksi, penarikan persetujuan, dan penghapusan melalui kanal resmi pengendali dengan verifikasi pemohon. Tindak lanjut dicatat tanpa memuat jawaban atau token.' },
  { title: 'Transfer lintas negara', body: 'Data diproses di dalam wilayah yang ditetapkan pengendali.' },
  { title: 'Persetujuan dengan bukti pendukung', body: 'Bila survei mewajibkan bukti pendukung, kiriman baru ditolak sampai pernyataan persetujuan dan referensi buktinya diisi. Referensi dan berkas dicatat apa adanya dan tidak diverifikasi aplikasi.' },
];

const TERMS_SECTIONS = [
  { title: 'Aturan penggunaan', body: 'Gunakan layanan untuk menyusun survei, membagikan tautan, dan mengolah jawaban sesuai pemberitahuan yang berlaku.' },
  { title: 'Tanggung jawab akun creator/admin', body: 'Pembuat survei bertanggung jawab atas instrumen, pemberitahuan, dan penerima data. Hak akses diberikan per survei.' },
  { title: 'Kepemilikan konten', body: 'Konfigurasi survei milik pembuatnya. Respons final terkunci bagi responden, tetapi permintaan data oleh pihak berwenang tetap dapat diproses.' },
  { title: 'Ketersediaan', body: 'Ketersediaan layanan mengikuti kesepakatan dengan pengendali. Gangguan diumumkan melalui kanal resmi.' },
  { title: 'Batas tanggung jawab', body: 'Layanan diberikan sesuai ketentuan yang berlaku. Pertanyaan dan permintaan data disalurkan melalui kanal resmi pengendali.' },
  { title: 'Penghentian', body: 'Versi dapat ditutup atau diarsipkan. Riwayat dipertahankan sesuai retensi yang ditetapkan pengendali.' },
];


function DataRequestForm() {
  const [type, setType] = useState('access');
  const [contact, setContact] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string } | null>(null);

  if (result) {
    return (
      <div className="mt-4">
        <Banner tone="success" title="Permintaan diterima">
          Nomor permintaan <span className="font-mono">{result.id}</span>. Pengelola akan memverifikasi kontak sebelum menindaklanjuti. Log tidak memuat jawaban atau token.
        </Banner>
      </div>
    );
  }

  return (
    <form
      className="mt-4 flex flex-col gap-3 border-t border-n200 pt-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        if (!contact.trim()) {
          setError('Kontak wajib diisi agar pengelola dapat memverifikasi dan menindaklanjuti.');
          return;
        }
        setBusy(true);
        void submitDataRequest({ type, contact: contact.trim(), note: note.trim() || undefined })
          .then((request) => setResult({ id: request.id }))
          .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Permintaan tidak dapat dikirim. Coba lagi.'))
          .finally(() => setBusy(false));
      }}
    >
      <div>
        <Field id="data-request-type" label="Jenis permintaan" required>
          {(aria) => (
            <select
              {...aria}
              value={type}
              onChange={(event) => setType(event.target.value)}
              className="min-h-[44px] w-full rounded-md border border-control-border bg-n0 px-3 text-body text-ink"
            >
              <option value="access">Akses data</option>
              <option value="correction">Koreksi data</option>
              <option value="withdrawal">Penarikan persetujuan</option>
              <option value="deletion">Penghapusan data</option>
            </select>
          )}
        </Field>
      </div>
      <div>
        <Field id="data-request-contact" label="Kontak terverifikasi" hint="Email atau nomor yang dapat dihubungi pengelola." required>
          {(aria) => (
            <TextInput
              {...aria}
              value={contact}
              onChange={(event) => setContact(event.target.value)}
              autoComplete="email"
            />
          )}
        </Field>
      </div>
      <div>
        <Field id="data-request-note" label="Keterangan" hint="Jangan tulis jawaban survei atau data sensitif di sini.">
          {(aria) => (
            <textarea
              {...aria}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              className="w-full rounded-md border border-control-border bg-n0 px-3 py-2 text-body text-ink"
            />
          )}
        </Field>
      </div>
      {error && <Banner tone="danger" title="Permintaan gagal dikirim">{error}</Banner>}
      <Button type="submit" variant="secondary" block loading={busy} disabled={busy}>Kirim permintaan</Button>
    </form>
  );
}

function LegalPage({ which }: { which: 'privacy' | 'terms' }) {
  const routeId = which;
  const { state } = useScreenState(routeId);
  const isPrivacy = which === 'privacy';
  const title = isPrivacy ? 'Kebijakan privasi' : 'Ketentuan layanan';
  const sections = isPrivacy ? PRIVACY_SECTIONS : TERMS_SECTIONS;
  // UIX-08: kanal kontak deployment dibaca dari server; tidak ada alamat contoh yang ditebak di klien.
  const [contact, setContact] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!isPrivacy) return;
    let cancelled = false;
    void getPublicPolicy()
      .then((policy) => {
        if (!cancelled) setContact(policy.data_request_contact);
      })
      .catch(() => {
        if (!cancelled) setContact(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isPrivacy]);

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
              Akses, koreksi, penarikan persetujuan, dan penghapusan melalui kanal pengendali berikut. Verifikasi pemohon dicatat; log tidak memuat jawaban atau token.
            </p>
            <p className="mt-2 text-body-sm font-bold text-ink">
              <ContactChannel
                contact={contact ?? null}
                empty={contact === undefined ? 'Memuat kanal kontak…' : 'Kanal kontak pengendali belum ditetapkan.'}
              />
            </p>
            <p className="mt-1 text-caption text-muted">
              Kanal organisasi yang menerbitkan survei Anda tercatat pada pemberitahuan sebelum item pertama dan dapat dibuka dari tautan survei.
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <PlainLink to={isPrivacy ? ROUTES.terms : ROUTES.privacy}>
                {isPrivacy ? 'Ketentuan layanan' : 'Kebijakan privasi'}
              </PlainLink>
              <PlainLink to={ROUTES.home}>Beranda</PlainLink>
            </div>
            {isPrivacy && <DataRequestForm />}
          </Card>
        </div>
      </StateView>
      
    </Shell>
  );
}

export function PrivacyPage() { return <LegalPage which="privacy" />; }
export function TermsPage() { return <LegalPage which="terms" />; }
