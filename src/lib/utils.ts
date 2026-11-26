import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Gabungkan kelas Tailwind dengan konflik terakhir-menang (dipakai komponen src/components/ui/). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
