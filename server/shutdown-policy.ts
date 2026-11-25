/** Batas paksa keluar saat shutdown (OPS-08). Default 5000 ms sama dengan batas keras lama. */
export const SHUTDOWN_FORCE_EXIT_DEFAULT_MS = 5_000;

/**
 * Nilai tidak valid tidak boleh membuat proses tidak pernah keluar: jatuh ke default dengan satu
 * peringatan. Batas atas 120 s; docker-compose memberi stop_grace_period lebih panjang dari nilai ini.
 */
export function shutdownForceExitMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env.SHUTDOWN_FORCE_EXIT_MS?.trim() ?? '';
  if (raw === '') return SHUTDOWN_FORCE_EXIT_DEFAULT_MS;
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 120_000) return Math.floor(parsed);
  console.warn(
    `[api] SHUTDOWN_FORCE_EXIT_MS tidak valid (${JSON.stringify(raw)}); memakai default ${SHUTDOWN_FORCE_EXIT_DEFAULT_MS} ms.`,
  );
  return SHUTDOWN_FORCE_EXIT_DEFAULT_MS;
}
