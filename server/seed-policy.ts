export interface SeedEnv {
  NODE_ENV?: string;
  SEED_DEMO?: string;
}

/**
 * Seed demo hanya boleh aktif secara eksplisit dan tidak pernah di production.
 * Nilai selain 0/1 ditolak agar salah konfigurasi tidak diam-diam menyalakan data demo.
 */
export function demoSeedEnabled(env: SeedEnv = process.env): boolean {
  const value = env.SEED_DEMO?.trim() ?? '';
  if (value === '' || value === '0') return false;
  if (value !== '1') {
    throw new Error('SEED_DEMO harus bernilai 0 atau 1.');
  }
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'SEED_DEMO=1 ditolak saat NODE_ENV=production. Gunakan `pnpm admin:bootstrap` untuk membuat admin.',
    );
  }
  return true;
}
