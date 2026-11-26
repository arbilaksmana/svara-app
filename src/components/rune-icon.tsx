import type { ComponentType } from 'react';
import type { IconProps } from 'runeicons-react';

/**
 * Adapter ikon Runeicons (runeicons-react) ke API gaya lucide yang dipakai komponen kita:
 * className untuk ukuran/warna Tailwind (ikon Rune memakai stroke="currentColor"; svg dirender 100%).
 * Impor per-ikon dari 'runeicons-react/icons/<Nama>' menjaga bundle tetap kecil (sideEffects:false).
 * Ikon berlisensi Apache-2.0 (https://github.com/Runeicons/runeicons).
 */
export function withIconClass(Icon: ComponentType<IconProps>) {
  return function RuneIconAdapter({
    className,
    'aria-hidden': ariaHidden,
  }: {
    className?: string;
    'aria-hidden'?: boolean | 'true' | 'false';
  }) {
    return (
      <span
        aria-hidden={ariaHidden ?? true}
        className={`inline-flex shrink-0 [&>svg]:h-full [&>svg]:w-full${className ? ` ${className}` : ''}`}
      >
        <Icon size={24} />
      </span>
    );
  };
}

/** Ikon hasil adapter: className ukuran/warna + aria-hidden, seperti ikon lucide sebelumnya. */
export type ClassIcon = ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;