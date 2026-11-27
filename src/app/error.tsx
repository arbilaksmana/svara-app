'use client';

import { Card } from '../components/ui';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="grid min-h-screen place-items-center bg-n50 p-6">
      <Card className="w-full max-w-[480px]">
        <h1 className="text-h2 font-bold text-ink">Halaman gagal dimuat</h1>
        <p className="mt-2 text-body text-ink-muted">
          Terjadi gangguan saat memuat data. Sesi dan data terbaru tidak dapat diverifikasi.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 min-h-[44px] rounded-md border border-n200 bg-n0 px-4 text-body-sm font-bold text-action hover:bg-action-soft"
        >
          Coba lagi
        </button>
      </Card>
    </div>
  );
}
