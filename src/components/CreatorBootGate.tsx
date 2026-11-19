'use client';

import type { ReactNode } from 'react';
import { loadBootstrap, useStore } from '../lib/store';
import { Button, ErrorState, LoadingState } from './ui';

/** Menahan layar creator sampai bootstrap selesai agar fixture tidak tampil sebagai data server. */
export function CreatorBootGate({ children }: { children: ReactNode }) {
  const { ready, error } = useStore();

  if (!ready) {
    return (
      <div className="mx-auto w-full max-w-[1200px] px-4 py-8 lg:px-6">
        <LoadingState label="Memuat workspace…" rows={4} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto w-full max-w-[1200px] px-4 py-8 lg:px-6">
        <ErrorState
          title="Workspace tidak dapat dimuat"
          detail={error}
          action={<Button variant="secondary" onClick={() => void loadBootstrap()}>Coba lagi</Button>}
        />
      </div>
    );
  }

  return <>{children}</>;
}
