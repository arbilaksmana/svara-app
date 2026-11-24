/**
 * L-07: nilai contoh `.env.example` tidak boleh dipakai sebagai rahasia. Deployment yang menyalin
 * `.env.example` apa adanya akan menyalakan pencatatan cakupan token integrasi dan seed akun demo
 * dengan kredensial yang tertulis di repo. Deteksi dilakukan saat startup, sebelum migrasi/seed,
 * sehingga proses berhenti dengan pesan jelas alih-alih berjalan dengan rahasia publik.
 */
const PLACEHOLDER_SECRETS: Readonly<Record<string, string>> = {
  INTEGRATION_TOKEN: 'ubah-token-integrasi-lokal',
  SEED_PASSWORD: 'ubah-sandi-seed-lokal',
};

/** Pesan galat untuk rahasia yang persis sama dengan nilai contoh, atau `null` bila aman. */
export function placeholderSecretsProblem(env: Record<string, string | undefined>): string | null {
  const offending = Object.entries(PLACEHOLDER_SECRETS)
    .filter(([name, placeholder]) => env[name]?.trim() === placeholder)
    .map(([name]) => name);
  if (offending.length === 0) return null;
  return `${offending.join(', ')} masih berisi nilai contoh dari .env.example. Ganti dengan nilai acak sebelum menjalankan API.`;
}
