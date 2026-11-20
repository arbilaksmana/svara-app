'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BrandMark } from '../components/Brand';
import { Shell } from '../components/Shell';
import {
  Banner,
  Button,
  Checkbox,
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
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameMissing = name.trim().length < 2;
  const emailMissing = !email.trim();
  const passwordMissing = !password;
  const passwordTooShort = password.length > 0 && password.length < 12;
  const confirmationMissing = !confirmation;
  const confirmationMismatch = confirmation.length > 0 && confirmation !== password;
  const termsMissing = !acceptedTerms;
  const invalid = nameMissing
    || emailMissing
    || passwordMissing
    || passwordTooShort
    || confirmationMissing
    || confirmationMismatch
    || termsMissing;

  const nameError = submitted && nameMissing ? 'Nama minimal 2 karakter.' : undefined;
  const emailError = submitted && emailMissing ? 'Email wajib diisi.' : undefined;
  const passwordError = submitted && passwordMissing
    ? 'Kata sandi wajib diisi.'
    : submitted && passwordTooShort
      ? 'Kata sandi minimal 12 karakter.'
      : undefined;
  const confirmationError = submitted && confirmationMissing
    ? 'Ulangi kata sandi wajib diisi.'
    : submitted && confirmationMismatch
      ? 'Konfirmasi kata sandi tidak sama.'
      : undefined;
  const termsError = submitted && termsMissing ? 'Persetujuan kebijakan dan ketentuan wajib dicentang.' : undefined;

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

              {state === 'validation' && (
                <Banner tone="danger" title="Periksa data akun">
                  Lengkapi nama, email, kata sandi, dan persetujuan.
                </Banner>
              )}
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
                  setSubmitted(true);
                  setError(null);
                  if (invalid) return;
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
                <Field id="register-name" label="Nama" required error={nameError}>
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

                <Field id="register-email" label="Email" required error={emailError}>
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
                  error={passwordError}
                  hint={passwordError ? undefined : 'Minimal 12 karakter; gunakan minimal 3 dari huruf kecil, huruf besar, angka, atau simbol.'}
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

                <Field id="register-confirmation" label="Ulangi kata sandi" required error={confirmationError}>
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
                    invalid={Boolean(termsError)}
                    describedBy={termsError ? 'register-terms-error' : undefined}
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
                  {termsError && (
                    <p id="register-terms-error" role="alert" className="text-caption font-bold text-danger">{termsError}</p>
                  )}
                </div>

                <Button type="submit" block loading={busy} disabled={busy || state === 'loading'}>
                  Buat akun
                </Button>
              </form>

              <p className="text-center text-body-sm text-muted">
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
