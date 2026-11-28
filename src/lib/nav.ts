/** Entri navigasi: tujuan rute dan label yang tampil. `aliases` ikut menyorot entri untuk rute turunan di luar prefix `to`. */
export type NavEntry = { to: string; label: string; aliases?: readonly string[] };

/** Normalisasi path: buang query/hash dan garis miring penutup (kecuali akar). */
export function navPath(value: string): string {
  const path = value.split(/[?#]/u)[0] ?? '';
  return path.length > 1 ? path.replace(/\/+$/u, '') : path;
}

/**
 * Entri yang sorot: kecocokan path sama persis, atau awalan path utuh (`/admin/org` juga menaungi
 * `/admin/org/evidence`). Bila beberapa cocok, yang terpanjang menang agar tidak ada sorot ganda.
 */
export function activeNavTo(entries: NavEntry[], pathname: string): string | undefined {
  const path = navPath(pathname);
  let best: { entry: NavEntry; length: number } | undefined;
  for (const entry of entries) {
    for (const target of [entry.to, ...(entry.aliases ?? [])]) {
      const to = navPath(target);
      if (path === to || path.startsWith(to === '/' ? '/' : `${to}/`)) {
        if (!best || to.length > best.length) best = { entry, length: to.length };
      }
    }
  }
  return best?.entry.to;
}
