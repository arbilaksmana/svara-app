'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shell } from '../components/Shell';
import { Button, Card, Field, PlainLink, PolicyLinks, TextInput } from '../components/ui';
import { ApiError, resolveInvitationCode } from '../lib/api';
import { ROUTES } from '../lib/routes';

export function RespondentCodePage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Shell kind="public" title="Buka undangan" chromeless>
      <div className="mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center gap-6 px-5 py-12">
        <div className="text-center">
          <p className="font-mono text-caption font-bold tracking-mono text-n600">RESPONDEN</p>
          <h1 className="mt-2 text-h2 font-bold text-ink">Buka undangan</h1>
          <p className="mt-2 text-body-sm text-muted">
            Masukkan kode undangan yang Anda terima. Tidak perlu akun.
          </p>
        </div>

        <Card className="p-5 sm:p-6">
          <form
            className="flex flex-col gap-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = code.trim();
              setError(null);
              if (!trimmed) {
                setError('Masukkan kode undangan yang Anda terima.');
                return;
              }
              setBusy(true);
              void resolveInvitationCode(trimmed)
                .then((result) => router.push(ROUTES.respondentIntro(result.token)))
                .catch((reason: unknown) => {
                  setError(
                    reason instanceof ApiError
                      ? reason.message
                      : 'Kode undangan tidak dapat diperiksa saat ini.',
                  );
                })
                .finally(() => setBusy(false));
            }}
          >
            <Field
              id="respondent-code"
              label="Kode undangan"
              hint="Contoh format: UND-XXXXXX."
              error={error ?? undefined}
              required
            >
              {(aria) => (
                <TextInput
                  {...aria}
                  value={code}
                  onChange={(event) => {
                    setCode(event.target.value);
                    if (error) setError(null);
                  }}
                  autoComplete="one-time-code"
                  autoCapitalize="characters"
                  spellCheck={false}
                  placeholder="UND-XXXXXX"
                />
              )}
            </Field>
            <Button type="submit" block loading={busy} disabled={busy}>
              Buka undangan
            </Button>
          </form>
        </Card>

        <div className="flex flex-col items-center gap-3 text-center">
          <p className="max-w-[38ch] text-caption text-muted">
            Punya tautan langsung dari creator? Buka tautan itu; kode tidak diperlukan.
          </p>
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-2">
            <PlainLink to={ROUTES.home} className="min-h-[44px]">Kembali ke beranda</PlainLink>
            <PlainLink to={ROUTES.login} className="min-h-[44px]">Masuk sebagai pengelola</PlainLink>
          </div>
          <PolicyLinks className="justify-center" />
        </div>
      </div>
    </Shell>
  );
}
