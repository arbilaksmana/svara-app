'use client';

import type { ComponentProps, ReactNode } from 'react';
import { Spinner } from './ui';
import { Button } from './ui/button';

/**
 * Tombol aksi dasbor dengan spinner: varian lama dipetakan ke Button shadcn,
 * `loading` mengatur disabled dan `aria-busy`.
 */
export function BusyButton({
  loading = false,
  variant = 'primary',
  children,
  ...rest
}: Omit<ComponentProps<typeof Button>, 'variant'> & {
  loading?: boolean;
  variant?: ComponentProps<typeof Button>['variant'] | 'primary' | 'danger';
  children?: ReactNode;
}) {
  const mapped = variant === 'primary' ? 'default' : variant === 'danger' ? 'destructive' : variant;
  return (
    <Button {...rest} variant={mapped} disabled={rest.disabled ?? loading} aria-busy={loading || undefined}>
      {loading && <Spinner />}
      {children}
    </Button>
  );
}