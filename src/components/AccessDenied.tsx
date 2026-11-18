import { ActionLink, Card } from './ui';
import { ROUTES } from '../lib/routes';

/** Tampilan sama dengan guard klien sebelumnya; dirender di server sebelum data dimuat. */
export function AccessDenied({ detail }: { detail: string }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-[640px] flex-col justify-center gap-4 p-6">
      <Card>
        <h1 className="text-h2 font-bold text-ink">Akses ditolak</h1>
        <p className="mt-2 text-body text-muted">{detail}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <ActionLink to={ROUTES.home}>Kembali ke beranda</ActionLink>
          <ActionLink to={ROUTES.login} variant="secondary">Masuk dengan akun lain</ActionLink>
        </div>
      </Card>
    </div>
  );
}
