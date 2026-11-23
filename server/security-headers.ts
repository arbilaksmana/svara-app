/**
 * Default keamanan transport untuk deployment produksi. Dipakai API Express (cookie sesi/responden dan
 * header HSTS) dan proxy Next (header HSTS) supaya keduanya membaca env dengan aturan yang sama.
 *
 * Aturan: produksi yang seluruh APP_ORIGIN-nya https:// memaksa cookie Secure dan mengaktifkan HSTS.
 * `COOKIE_SECURE`/`ENABLE_HSTS` yang eksplisit menang; HSTS hanya dikirim untuk permintaan HTTPS.
 * Instalasi HTTP (dev, compose lokal, deployment tanpa TLS) tidak berubah: login tetap berjalan.
 */
export const HSTS_VALUE = 'max-age=15552000; includeSubDomains';

type Env = Record<string, string | undefined>;

function explicitFlag(value: string | undefined): boolean | undefined {
  if (value?.trim() === '1') return true;
  if (value?.trim() === '0') return false;
  return undefined;
}

/** Daftar APP_ORIGIN tidak kosong dan setiap origin valid serta memakai https://. */
export function allAppOriginsHttps(env: Env): boolean {
  const origins = (env.APP_ORIGIN ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (origins.length === 0) return false;
  return origins.every((origin) => {
    try {
      return new URL(origin).protocol === 'https:';
    } catch {
      return false;
    }
  });
}

/** Ambang default aman: NODE_ENV=production dan APP_ORIGIN menunjuk HTTPS. */
export function productionHttpsDefaults(env: Env): boolean {
  return env.NODE_ENV === 'production' && allAppOriginsHttps(env);
}

/** Cookie Secure: COOKIE_SECURE=1 memaksa, 0 mematikan default produksi, kosong mengikuti default. */
export function secureCookieEnabled(env: Env, requestIsHttps: boolean): boolean {
  const override = explicitFlag(env.COOKIE_SECURE);
  if (override === true) return true;
  return requestIsHttps || (override === undefined && productionHttpsDefaults(env));
}

/** HSTS hanya untuk permintaan HTTPS; ENABLE_HSTS=1/0 menimpa default produksi. */
export function hstsEnabled(env: Env, requestIsHttps: boolean): boolean {
  const override = explicitFlag(env.ENABLE_HSTS);
  return (override ?? productionHttpsDefaults(env)) && requestIsHttps;
}

/** Satu baris peringatan start untuk produksi tanpa HTTPS; null bila tidak perlu. */
export function productionWithoutHttpsWarning(env: Env): string | null {
  if (env.NODE_ENV !== 'production' || allAppOriginsHttps(env)) return null;
  return (
    '[api] produksi berjalan tanpa HTTPS: cookie sesi tidak dipaksa Secure dan HSTS tidak dikirim. ' +
    'Set APP_ORIGIN=https://... atau COOKIE_SECURE=1/ENABLE_HSTS=1 bila TLS diterminasi di depan API.'
  );
}
