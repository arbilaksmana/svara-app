'use client';

import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BrandMark } from '../components/Brand';
import { Shell } from '../components/Shell';
import {
  Banner,
  Button,
  Checkbox,
  ErrorSummary,
  Field,
  PlainLink,
  TextInput,
} from '../components/ui';
import { useScreenState } from '../lib/state';
import { useToast } from '../components/Toast';
import { register } from '../lib/store';
import { ApiError } from '../lib/api';
import { ROUTES } from '../lib/routes';

export function RegisterPage() {
  const { state } = useScreenState('register');
  const router = useRouter();
  const notify = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  // Pratinjau ?state=validation menampilkan keadaan yang sama dengan kirim formulir kosong.
  const [submitted, setSubmitted] = useState(state === 'validation');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  const messages = {
    name: name.trim().length < 2 ? 'Nama minimal 2 karakter.' : undefined,
    email: !email.trim() ? 'Email wajib diisi.' : undefined,
    password: !password
      ? 'Kata sandi wajib diisi.'
      : password.length < 12
        ? 'Kata sandi minimal 12 karakter.'
        : undefined,
    confirmation: !confirmation
      ? 'Ulangi kata sandi wajib diisi.'
      : confirmation !== password
        ? 'Konfirmasi kata sandi tidak sama.'
        : undefined,
    terms: acceptedTerms ? undefined : 'Persetujuan kebijakan dan ketentuan wajib dicentang.',
  };
  const errors = Object.entries(messages).flatMap(([key, message]) => (message ? [{ id: `register-${key}`, message }] : []));
  const fieldErrors: Partial<typeof messages> = submitted ? messages : {};
  // Ringkasan dibekukan per percobaan kirim agar alert tidak diumumkan ulang setiap kali pengguna mengetik.
  const [summary, setSummary] = useState(() => (submitted ? errors : []));

  return (
    <Shell kind="public" title="Buat akun" chromeless>
      <div className="grid flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)]">
        <div className="relative z-10 flex flex-col bg-n0 lg:rounded-tr-lg lg:rounded-br-lg">
          <div className="flex flex-1 flex-col justify-center px-5 pb-12 pt-6 sm:px-8 lg:px-14">
            <div className="mx-auto flex w-full max-w-[380px] flex-col gap-7">
              <div className="flex justify-center">
                <Link href={ROUTES.home} className="inline-flex min-h-[44px] items-center gap-2.5 text-h3 font-bold text-ink">
                  <BrandMark className="size-8" />
                  <span>Svara</span>
                </Link>
              </div>

              <h1 className="text-center text-h2 font-bold text-ink">Buat akun</h1>

              {summary.length > 0 && <ErrorSummary ref={summaryRef} title="Periksa data akun" errors={summary} />}
              {error && (
                <Banner tone="danger" title="Tidak dapat membuat akun">
                  {error}
                </Banner>
              )}

              <form
                className="flex flex-col gap-4"
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  flushSync(() => {
                    setSubmitted(true);
                    setError(null);
                    setSummary(errors);
                  });
                  if (errors.length > 0) {
                    summaryRef.current?.focus();
                    return;
                  }
                  setBusy(true);
                  void register({
                    name: name.trim().replace(/\s+/g, ' '),
                    email: email.trim().toLowerCase(),
                    password,
                    acceptTerms: acceptedTerms,
                    invite_code: inviteCode.trim() || undefined,
                  })
                    .then(() => {
                      notify('Akun dibuat. Selamat datang di Svara.');
                      router.push(ROUTES.creator);
                    })
                    .catch((cause: unknown) => {
                      setError(
                        cause instanceof ApiError
                          ? cause.message
                          : 'Koneksi ke server gagal. Coba lagi beberapa saat lagi.',
                      );
                    })
                    .finally(() => setBusy(false));
                }}
              >
                <Field id="register-name" label="Nama" required error={fieldErrors.name} announceError={false}>
                  {(aria) => (
                    <TextInput
                      {...aria}
                      autoComplete="name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Nama lengkap"
                    />
                  )}
                </Field>

                <Field id="register-email" label="Email" required error={fieldErrors.email} announceError={false}>
                  {(aria) => (
                    <TextInput
                      {...aria}
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="nama@organisasi.id"
                    />
                  )}
                </Field>

                <Field
                  id="register-password"
                  label="Kata sandi"
                  required
                  error={fieldErrors.password}
                  announceError={false}
                  hint={fieldErrors.password ? undefined : 'Minimal 12 karakter; gunakan minimal 3 dari huruf kecil, huruf besar, angka, atau simbol.'}
                >
                  {(aria) => (
                    <TextInput
                      {...aria}
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="••••••••"
                    />
                  )}
                </Field>

                <Field id="register-confirmation" label="Ulangi kata sandi" required error={fieldErrors.confirmation} announceError={false}>
                  {(aria) => (
                    <TextInput
                      {...aria}
                      type="password"
                      autoComplete="new-password"
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                      placeholder="••••••••"
                    />
                  )}
                </Field>

                <Field
                  id="register-invite"
                  label="Kode undangan organisasi"
                  hint="Opsional. Isi bila admin organisasi memberi kode agar akun Anda masuk ke organisasi tersebut."
                >
                  {(aria) => (
                    <TextInput
                      {...aria}
                      autoComplete="off"
                      value={inviteCode}
                      onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
                      placeholder="ORG-XXXX"
                    />
                  )}
                </Field>

                <div className="flex flex-col gap-1">
                  <Checkbox
                    id="register-terms"
                    checked={acceptedTerms}
                    onChange={setAcceptedTerms}
                    invalid={Boolean(fieldErrors.terms)}
                    describedBy={fieldErrors.terms ? 'register-terms-error' : undefined}
                    label={(
                      <>
                        Saya menyetujui{' '}
                        <Link href={ROUTES.privacy} className="font-bold text-action underline decoration-1 underline-offset-4 hover:text-action-hover">
                          kebijakan privasi
                        </Link>{' '}
                        dan{' '}
                        <Link href={ROUTES.terms} className="font-bold text-action underline decoration-1 underline-offset-4 hover:text-action-hover">
                          ketentuan layanan
                        </Link>.
                      </>
                    )}
                  />
                  {fieldErrors.terms && (
                    <p id="register-terms-error" className="text-caption font-bold text-danger">{fieldErrors.terms}</p>
                  )}
                </div>

                <Button type="submit" block loading={busy} disabled={busy || state === 'loading'}>
                  Buat akun
                </Button>
              </form>

              <p className="text-center text-body-sm text-ink-muted">
                Sudah punya akun? <PlainLink to={ROUTES.login} className="min-h-[44px]">Masuk</PlainLink>
              </p>
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
