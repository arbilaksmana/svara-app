import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fail } from './http.ts';

/**
 * SEC-04/BF-03: bukti wali disimpan di disk, bukan di basis data. Nama berkas di disk
 * diturunkan dari ID consent (acak), tidak pernah dari nama kiriman klien; nama asli
 * hanya dicatat di kolom untuk ditampilkan pada layar moderasi.
 */
export const GUARDIAN_EVIDENCE_MAX_BYTES = 5 * 1024 * 1024;

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export type GuardianEvidenceMime = (typeof ALLOWED_MIME)[number];

export interface GuardianEvidenceUpload {
  buffer: Buffer;
  mime: GuardianEvidenceMime;
  fileName: string | null;
  size: number;
}

export function guardianEvidenceDir(): string {
  const configured = process.env.GUARDIAN_EVIDENCE_DIR?.trim();
  return resolve(configured || './var/guardian-evidence');
}

/** ID consent berasal dari URL pada route unduhan; hanya bentuk ID acak yang boleh menjadi path. */
export function guardianEvidencePath(consentId: string): string {
  if (!/^c_[A-Za-z0-9]+$/u.test(consentId)) fail(404, 'evidence_not_found', 'Bukti wali tidak ditemukan.');
  return resolve(guardianEvidenceDir(), `${consentId}.bin`);
}

function sniffMime(buffer: Buffer): GuardianEvidenceMime | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (buffer.length >= 5 && buffer.toString('latin1', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

function sanitizeFileName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const base = raw.split(/[\\/]/u).pop() ?? '';
  const cleaned = Array.from(base)
    .filter((char) => char.charCodeAt(0) > 0x1f && char.charCodeAt(0) !== 0x7f)
    .join('')
    .trim()
    .slice(0, 200);
  return cleaned || null;
}

/**
 * Batas ukuran diperiksa dari panjang base64 sebelum dekode, lalu dari panjang buffer
 * sesudahnya. MIME klien hanya diterima bila cocok dengan penanda isi berkas.
 */
export function decodeGuardianEvidence(raw: unknown, declaredMime: unknown, declaredName: unknown): GuardianEvidenceUpload {
  if (typeof raw !== 'string' || raw.trim() === '') {
    fail(422, 'invalid_evidence', 'Lampirkan berkas bukti persetujuan wali.');
  }
  if (declaredMime !== undefined && typeof declaredMime !== 'string') {
    fail(422, 'invalid_evidence', 'Jenis berkas bukti wali tidak dikenali.');
  }
  const declared = typeof declaredMime === 'string' ? declaredMime.trim().toLowerCase() : '';
  if (declared && !ALLOWED_MIME.includes(declared as GuardianEvidenceMime)) {
    fail(422, 'invalid_evidence', 'Berkas bukti wali harus JPG, PNG, WebP, atau PDF.');
  }

  const payload = raw.trim().replace(/^data:[^,]*,/u, '').replace(/\s+/gu, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(payload) || payload.length % 4 !== 0) {
    fail(422, 'invalid_evidence', 'Isi berkas bukti wali bukan base64 yang sah.');
  }
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  const estimated = (payload.length / 4) * 3 - padding;
  if (estimated > GUARDIAN_EVIDENCE_MAX_BYTES) {
    fail(422, 'invalid_evidence', 'Berkas bukti wali melebihi 5 MB.');
  }

  const buffer = Buffer.from(payload, 'base64');
  if (buffer.length > GUARDIAN_EVIDENCE_MAX_BYTES) {
    fail(422, 'invalid_evidence', 'Berkas bukti wali melebihi 5 MB.');
  }
  const mime = sniffMime(buffer);
  if (!mime) fail(422, 'invalid_evidence', 'Isi berkas tidak cocok dengan JPG, PNG, WebP, atau PDF.');
  if (declared && declared !== mime) {
    fail(422, 'invalid_evidence', 'Jenis berkas tidak cocok dengan isinya.');
  }
  return { buffer, mime, fileName: sanitizeFileName(declaredName), size: buffer.length };
}

export async function writeGuardianEvidence(consentId: string, upload: GuardianEvidenceUpload): Promise<void> {
  const path = guardianEvidencePath(consentId);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, upload.buffer, { mode: 0o600 });
}

export async function removeGuardianEvidence(consentId: string): Promise<void> {
  await unlink(guardianEvidencePath(consentId)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

export async function readGuardianEvidence(consentId: string): Promise<Buffer | null> {
  try {
    return await readFile(guardianEvidencePath(consentId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
