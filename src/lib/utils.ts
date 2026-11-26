import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Skala teks DESIGN.md (`text-caption`, `text-body-sm`, ...) bukan kelompok bawaan tailwind-merge:
 * tanpa didaftarkan, `text-caption` dianggap kelas *warna*, jadi terhapus setiap kali berdampingan
 * dengan kelas warna seperti `text-[color:var(--ad-muted)]` dan teks membesar satu langkah.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        { text: ['display', 'h1', 'h2', 'h3', 'body', 'body-sm', 'caption', 'annotation'] },
      ],
    },
  },
});

/** Gabungkan kelas Tailwind dengan konflik terakhir-menang (dipakai komponen src/components/ui/). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
