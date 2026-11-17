import type { ReactNode } from 'react';
import type { RouteId } from '../lib/routes';
import type { StateCode } from '../lib/state';
import { useScreenState } from '../lib/state';
import {
  ActionLink,
  BlockedNotice,
  EmptyState,
  ErrorState,
  LoadingState,
  PermissionDenied,

} from './ui';

/**
 * Menangani state generik yang perlakuannya sama di semua layar.
 * State default, validation, no-answers, dan success diteruskan ke children
 * agar tiap halaman bisa menampilkan perlakuan spesifiknya.
 */
export function StateView({
  routeId,
  state,
  children,
  emptyTitle = 'Belum ada data',
  emptyDetail,
  emptyAction,
  permissionDetail = 'Akun ini tidak memiliki izin untuk objek yang diminta.',
  conflictTo,
  errorTitle,
  errorDetail,
}: {
  routeId: RouteId;
  state: StateCode;
  children: ReactNode;
  emptyTitle?: string;
  emptyDetail?: ReactNode;
  emptyAction?: ReactNode;
  permissionDetail?: string;
  conflictTo?: string;
  errorTitle?: string;
  errorDetail?: string;
}) {
  const { setState } = useScreenState(routeId);


  switch (state) {
    case 'loading':
      return <LoadingState />;

    case 'error':
      return (
        <div className="flex flex-col gap-4">
          <ErrorState
            title={errorTitle ?? 'Data contoh tidak dapat dimuat'}
            detail={errorDetail ?? 'Terjadi gangguan pada lapisan tampilan. Tidak ada rincian basis data yang ditampilkan.'}
            action={
              <button
                type="button"
                onClick={() => setState('default')}
                className="min-h-[44px] rounded-md border border-n200 bg-n0 px-4 text-body-sm font-bold text-action hover:bg-action-soft"
              >
                Muat ulang tampilan
              </button>
            }
          />
          {children}
        </div>
      );

    case 'permission-denied':
      return <PermissionDenied detail={permissionDetail} />;

    case 'closed':
    case 'expired':
    case 'revoked':
      return <div className="flex flex-col gap-4"><BlockedNotice state={state} />{children}</div>;

    case 'conflict':
      return (
        <div className="flex flex-col gap-4">
          <BlockedNotice state="conflict" />
          {children}
          {conflictTo && (
            <ActionLink to={conflictTo} variant="secondary">
              Pulihkan bukti yang sama
            </ActionLink>
          )}
        </div>
      );

    case 'empty':
      return (
        <EmptyState title={emptyTitle} action={emptyAction}>
          {emptyDetail ?? 'Belum ada entri. Gunakan tautan yang tersedia untuk memulai.'}
        </EmptyState>
      );

    case 'search-empty':
      return (
        <EmptyState
          title="Hasil pencarian kosong"
          action={
            <button
              type="button"
              onClick={() => setState('default')}
              className="min-h-[44px] rounded-md border border-n200 bg-n0 px-4 text-body-sm font-bold text-action hover:bg-action-soft"
            >
              Hapus filter
            </button>
          }
        >
          Tidak ada survei yang cocok dengan kata kunci. Ubah kata kunci atau hapus filter untuk melihat semua entri.
        </EmptyState>
      );

    case 'default':
    case 'validation':
    case 'no-answers':
    case 'success':
    default:
      return <>{children}</>;
  }
}

export function SuccessBanner({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div role="status" className="mb-4 rounded-md border border-success-soft bg-success-soft p-4">
      <p className="text-body font-bold text-success">{title}</p>
      <div className="mt-1 text-body-sm text-ink">{children}</div>
    </div>
  );
}

export function ValidationSummary({ items }: { items: string[] }) {
  return (
    <div role="alert" className="mb-4 rounded-md border border-danger-fill bg-danger-soft p-4">
      <p className="text-body font-bold text-danger">Perlu diperbaiki sebelum melanjutkan</p>
      <ul className="mt-2 flex list-inside list-disc flex-col gap-1 text-body-sm text-ink">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
      <p className="mt-2 text-caption text-muted">Nilai yang sudah diisi tetap tersimpan selama halaman masih terbuka.</p>
    </div>
  );
}

/** Hint state tidak ditampilkan pada permukaan produk; ?state= tetap bekerja. */
export function StateDebugHint(_props: { routeId: RouteId; state: StateCode }): null {
  return null;
}
