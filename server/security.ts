import { createHash, randomBytes, scrypt, timingSafeEqual, type BinaryLike } from 'node:crypto';
import { isIP } from 'node:net';
import { promisify } from 'node:util';
import type { NextFunction, Request, Response } from 'express';
import { all, get, nowIso, run } from './db.ts';
import { productionWithoutHttpsWarning as httpsWarningFor, secureCookieEnabled } from '../src/lib/security-headers.ts';

export const SESSION_COOKIE = 'svara_session';
const SESSION_HOURS = (() => {
  const value = Number(process.env.SESSION_TTL_HOURS ?? 8);
  return Number.isFinite(value) && value >= 1 && value <= 168 ? value : 8;
})();
const SESSION_MS = SESSION_HOURS * 60 * 60 * 1000;

export interface AccountRow {
  id: string;
  email: string;
  display_name: string;
  role: 'super_admin' | 'org_admin' | 'creator';
  status: 'active' | 'suspended';
  organization_id: string | null;
}

export interface AuthedRequest extends Request<Record<string, string>> {
  account?: AccountRow;
  actorId?: string;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * scrypt async berjalan di threadpool libuv sehingga hashing tidak memblokir event loop.
 * Parameter bawaan dan format `scrypt$<salt>$<hash>` sama dengan versi sinkron lama.
 */
const scryptAsync = promisify(scrypt) as (password: BinaryLike, salt: BinaryLike, keylen: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scryptAsync(password, salt, 64)).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = await scryptAsync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/** Batas atas panjang sandi; login menolak sandi lebih panjang sebelum hashing. */
export const PASSWORD_MAX_LENGTH = 256;

/** Aturan sandi akun baru dan bootstrap; pesan dipakai langsung oleh API/UI. */
export function passwordPolicyError(password: string): string | null {
  if (password.length < 12 || password.length > PASSWORD_MAX_LENGTH) {
    return 'Kata sandi harus 12-256 karakter.';
  }
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length;
  if (classes < 3) {
    return 'Kata sandi harus memakai minimal 3 dari: huruf kecil, huruf besar, angka, simbol.';
  }
  return null;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    let value: string;
    try {
      value = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      // Percent-encoding rusak (URIError): abaikan cookie ini seolah tidak dikirim.
      continue;
    }
    out[part.slice(0, index).trim()] = value;
  }
  return out;
}

export async function createSession(accountId: string): Promise<{ token: string; expiresAt: string }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_MS).toISOString();
  await run(
    'INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    sha256(token),
    accountId,
    nowIso(),
    expiresAt,
  );
  return { token, expiresAt };
}

export async function destroySession(token: string): Promise<void> {
  await run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
}

/**
 * Perubahan status akun selain aktif→aktif menghapus semua sesinya: saat ditangguhkan, dan saat
 * diaktifkan kembali agar sesi yang tersisa dari sebelum aturan ini tidak hidup lagi.
 * Panggil di transaksi yang sama dengan UPDATE status.
 */
export async function revokeSessionsOnStatusChange(accountId: string, previous: string, next: string): Promise<void> {
  if (previous === 'active' && next === 'active') return;
  await run('DELETE FROM sessions WHERE account_id = ?', accountId);
}

/**
 * `COOKIE_SECURE=1` selalu memberi `Secure`. Tanpanya: HTTPS terpercaya (`req.secure`, membaca
 * X-Forwarded-Proto hanya dari proxy yang dipercaya lewat TRUST_PROXY) atau produksi yang seluruh
 * APP_ORIGIN-nya https. `COOKIE_SECURE=0` mematikan paksaan default produksi itu.
 * Dipakai cookie sesi dan cookie responden.
 */
export function secureCookie(req: Request): boolean {
  return secureCookieEnabled(process.env, req.secure);
}

/** Peringatan satu baris saat produksi berjalan tanpa HTTPS; dibaca sekali saat start. */
export function productionWithoutHttpsWarning(): string | null {
  return httpsWarningFor(process.env);
}

export function sessionCookie(token: string, secure: boolean): string {
  const attrs = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_MS / 1000)}`,
  ];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** Pasang akun aktif dari cookie sesi; token mentah tidak pernah disimpan di basis data. */
export async function attachSession(req: AuthedRequest, _res: Response, next: NextFunction): Promise<void> {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return next();
  const row = await get<AccountRow & { expires_at: string }>(
    `SELECT a.id, a.email, a.display_name, a.role, a.status, a.organization_id, s.expires_at
       FROM sessions s JOIN accounts a ON a.id = s.account_id
      WHERE s.token_hash = ?`,
    sha256(token),
  );
  if (!row) return next();
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await destroySession(token);
    return next();
  }
  if (row.status !== 'active') return next();
  req.account = {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    role: row.role,
    status: row.status,
    organization_id: row.organization_id,
  };
  req.actorId = row.id;
  next();
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.account) {
    res.status(401).json({ error: 'Sesi tidak ditemukan. Masuk kembali untuk melanjutkan.', code: 'unauthenticated' });
    return;
  }
  if (req.account.status !== 'active') {
    res.status(403).json({ error: 'Akun ini tidak aktif.', code: 'account_inactive' });
    return;
  }
  next();
}

export function requireRole(roles: AccountRow['role'][]): (req: AuthedRequest, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    if (!req.account) {
      res.status(401).json({ error: 'Sesi tidak ditemukan.', code: 'unauthenticated' });
      return;
    }
    if (!roles.includes(req.account.role)) {
      res.status(403).json({ error: 'Peran akun ini tidak memiliki akses ke tindakan tersebut.', code: 'forbidden_role' });
      return;
    }
    next();
  };
}

// Rewrite Next ke API mengganti Host, jadi origin browser tidak lagi sama dengan host API.
// Di luar produksi izinkan origin dev standar; produksi wajib menetapkan APP_ORIGIN.
const DEV_ORIGINS = 'http://127.0.0.1:3000,http://localhost:3000';
const defaultOrigins = process.env.NODE_ENV === 'production' ? '' : DEV_ORIGINS;

const ALLOWED_ORIGINS = (process.env.APP_ORIGIN ?? defaultOrigins)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

function sameOrigin(origin: string, host: string | undefined): boolean {
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Mutasi wajib membawa header klien dan tidak boleh berasal dari origin lain.
 * Cookie SameSite=Lax saja tidak cukup sebagai pertahanan CSRF.
 */
export function csrfGuard(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const client = req.get('x-svara-client');
  if (client !== 'web') {
    res.status(403).json({ error: 'Permintaan tanpa header klien Svara ditolak.', code: 'csrf_header_required' });
    return;
  }
  const origin = req.get('origin');
  if (origin && !sameOrigin(origin, req.get('host')) && !ALLOWED_ORIGINS.includes(origin)) {
    res.status(403).json({ error: 'Origin permintaan tidak diizinkan.', code: 'origin_rejected' });
    return;
  }
  next();
}

interface Bucket {
  count: number;
  limit: number;
  resetAt: number;
}

/**
 * Bucket dikelompokkan per jenis kunci (awalan sebelum ':' pertama: `login`, `login-ip`, `consent`, ...), masing-masing
 * dengan batas jumlah kunci sendiri. Banjir kunci pilihan klien pada satu jenis (mis. token consent dari path URL)
 * tidak pernah menggeser bucket jenis lain.
 */
const spaces = new Map<string, Map<string, Bucket>>();
const RATE_LIMIT_SWEEP_MS = 60_000;
/** Entri yang diperiksa per panggilan saat menyapu atau mencari ruang; tidak bergantung pada jumlah kunci aktif. */
const RATE_LIMIT_STEP = 64;
/** Kunci aktif paling banyak per jenis kunci. */
const RATE_LIMIT_MAX_KEYS = 50_000;
/** Kunci lebih panjang (email, token path) disimpan sebagai hash agar memori per entri tetap kecil. */
const RATE_LIMIT_KEY_MAX_LENGTH = 128;
let lastSweep = 0;
let sweep: Iterator<[Map<string, Bucket>, string, Bucket]> | undefined;

function* allBuckets(): Generator<[Map<string, Bucket>, string, Bucket]> {
  for (const space of spaces.values()) {
    for (const [key, bucket] of space) yield [space, key, bucket];
  }
}

/** Hanya untuk uji. */
export function rateLimitBucketCount(): number {
  let count = 0;
  for (const space of spaces.values()) count += space.size;
  return count;
}

/** Hanya untuk uji: kosongkan limiter seperti proses yang baru start. */
export function resetRateLimits(): void {
  spaces.clear();
  sweep = undefined;
  lastSweep = 0;
}

/**
 * Identitas klien untuk limiter: `req.ip`, yaitu fungsi `trust proxy` Express dari TRUST_PROXY.
 * Tanpa TRUST_PROXY hasilnya alamat socket. TRUST_PROXY hanya berisi jaringan bernama
 * (lihat trustProxySetting): proxy-addr menelusuri X-Forwarded-For dari kanan selama hop sebelumnya
 * berada di jaringan itu dan berhenti di alamat pertama di luarnya, sedangkan koneksi langsung dari
 * luar jaringan itu dihitung per socket. Header dari proxy di jaringan itu dipakai apa adanya, jadi
 * identitas ini hanya bisa dipercaya bila proxy tersebut menambahkan atau menimpa X-Forwarded-For;
 * rewrite Next meneruskan header klien tanpa mengubahnya.
 * Entri header yang bukan alamat IP (mis. "unknown") jatuh ke alamat socket.
 */
export function clientIp(req: Request): string {
  const socket = req.socket.remoteAddress ?? 'unknown';
  const ip = req.ip;
  return ip && isIP(ip) ? ip : socket;
}

function bucketSlot(key: string): [Map<string, Bucket>, string] {
  const colon = key.indexOf(':');
  const kind = colon < 0 ? key : key.slice(0, colon);
  let space = spaces.get(kind);
  if (!space) spaces.set(kind, (space = new Map()));
  return [space, key.length > RATE_LIMIT_KEY_MAX_LENGTH ? sha256(key) : key];
}

/**
 * Sapu entri kedaluwarsa paling sering sekali per menit, bertahap: tiap panggilan memeriksa paling banyak
 * RATE_LIMIT_STEP entri dan panggilan berikutnya melanjutkan dari posisi itu.
 */
function sweepStep(now: number): void {
  if (!sweep) {
    if (now - lastSweep < RATE_LIMIT_SWEEP_MS) return;
    lastSweep = now;
    sweep = allBuckets();
  }
  for (let i = 0; i < RATE_LIMIT_STEP; i += 1) {
    const next = sweep.next();
    if (next.done) {
      sweep = undefined;
      return;
    }
    const [space, key, bucket] = next.value;
    if (bucket.resetAt < now) space.delete(key);
  }
}

/**
 * Jenis kunci penuh: lepas entri kedaluwarsa, atau entri tertua yang belum mencapai batasnya, di antara
 * RATE_LIMIT_STEP entri tertua. Bucket yang sudah menolak tidak pernah dilepas, sehingga membanjiri kunci baru
 * tidak membuka ulang percobaan yang sudah diblokir; bila semua entri itu menolak, kunci baru ikut ditolak.
 */
function makeRoom(space: Map<string, Bucket>, now: number): boolean {
  let candidate: string | undefined;
  let scanned = 0;
  for (const [key, bucket] of space) {
    if (bucket.resetAt < now) {
      space.delete(key);
      return true;
    }
    if (candidate === undefined && bucket.count < bucket.limit) candidate = key;
    if ((scanned += 1) >= RATE_LIMIT_STEP) break;
  }
  if (candidate === undefined) return false;
  space.delete(candidate);
  return true;
}

/** Pembatas percobaan di memori proses; cukup untuk satu instans lokal. */
export function rateLimit(options: { key: string; limit: number; windowMs: number }): boolean {
  const now = Date.now();
  sweepStep(now);
  const [space, id] = bucketSlot(options.key);
  const bucket = space.get(id);
  if (bucket && bucket.resetAt >= now) {
    if (bucket.count >= options.limit) return false;
    bucket.count += 1;
    return true;
  }
  // Jendela baru ditaruh di ujung peta agar urutan peta tetap urutan pembuatan bucket (dipakai makeRoom).
  if (bucket) space.delete(id);
  else if (space.size >= RATE_LIMIT_MAX_KEYS && !makeRoom(space, now)) return false;
  space.set(id, { count: 1, limit: options.limit, resetAt: now + options.windowMs });
  return true;
}

/** Kembalikan satu hitungan pada bucket yang masih berlaku, mis. percobaan yang ternyata tidak perlu dihitung. */
export function rateLimitRefund(key: string): void {
  const [space, id] = bucketSlot(key);
  const bucket = space.get(id);
  if (bucket && bucket.resetAt >= Date.now() && bucket.count > 0) bucket.count -= 1;
}

/**
 * Nilai `trust proxy` Express dari TRUST_PROXY. Mati secara default: header proxy
 * tanpa konfigurasi bisa dipalsukan klien. Hanya jaringan bernama yang diterima. `true`, rentang IP,
 * dan jumlah hop ditolak dan trust proxy dimatikan (gagal-tertutup); jumlah hop mempercayai socket dari alamat mana pun,
 * sehingga klien yang menjangkau API langsung bisa memilih identitasnya lewat X-Forwarded-For.
 */
export function trustProxySetting(value: string | undefined): false | string {
  const raw = (value ?? '').trim().toLowerCase();
  if (!raw || raw === 'false' || raw === '0') return false;
  const names = raw.split(',').map((name) => name.trim()).filter(Boolean);
  const ALLOWED = new Set(['loopback', 'linklocal', 'uniquelocal']);
  if (names.length > 0 && names.every((name) => ALLOWED.has(name))) return names.join(', ');
  const reason = names.some((name) => /^\d+$/.test(name))
    ? 'berisi jumlah hop yang mempercayai koneksi dari alamat mana pun'
    : 'tidak dikenal';
  console.warn(`[api] TRUST_PROXY ${reason} ("${value}"); trust proxy dimatikan.`);
  return false;
}

/** Kode undangan survei (UND-...) dan organisasi (ORG-...) yang dapat tertulis di baris audit lama. */
const INVITATION_CODE = /\b(UND|ORG)-[A-Z0-9_-]+/gi;

/**
 * Samarkan kode undangan pada `object`/`metadata` audit saat dibaca. Baris baru hanya memuat ID;
 * baris lama tidak diubah di basis data, jadi semua jalur baca audit wajib melewati fungsi ini.
 */
export function redactAuditRow<T extends { object: string; metadata?: string | null }>(row: T): T {
  const mask = (text: string) => text.replace(INVITATION_CODE, (_code, prefix: string) => `${prefix}-***`);
  return {
    ...row,
    object: mask(row.object),
    ...(typeof row.metadata === 'string' ? { metadata: mask(row.metadata) } : {}),
  };
}

export async function knownAccountEmails(): Promise<string[]> {
  return (await all<{ email: string }>('SELECT email FROM accounts ORDER BY email')).map((row) => row.email);
}
