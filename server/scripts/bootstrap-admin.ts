import { randomBytes } from 'node:crypto';
import { closePool, get, nowIso, run, withTx } from '../db.ts';
import { newId } from '../http.ts';
import { migrate } from '../migrate.ts';
import { noticeVersionForNewOrganization, provisionPlatformDefaults } from '../notice-provisioning.ts';
import { hashPassword, passwordPolicyError } from '../security.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Kunci audit idempoten: bootstrap ulang tidak menggandakan baris audit untuk objek yang sama. */
const PLATFORM_AUDIT = 'Bootstrap profil platform';
const ORGANIZATION_AUDIT = 'Bootstrap organisasi';

const ORGANIZATION_ADMIN = {
  displayName: 'Admin Organisasi Bootstrap',
  passwordEnv: 'BOOTSTRAP_ORGANIZATION_ADMIN_PASSWORD',
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} wajib diisi.`);
  return value;
}

/** Audit sistem sekali per (action, object): bootstrap yang dijalankan ulang tidak menambah baris. */
async function systemAudit(
  action: string,
  object: string,
  metadata: Record<string, unknown> | null,
): Promise<boolean> {
  return (
    (await run(
      `INSERT INTO audit_logs (id, actor, action, object, outcome, at, metadata, account_id)
       SELECT ?, 'system', ?, ?, 'berhasil', ?, ?, NULL
        WHERE NOT EXISTS (SELECT 1 FROM audit_logs WHERE actor = 'system' AND action = ? AND object = ?)`,
      newId('log'),
      action,
      object,
      nowIso(),
      metadata ? JSON.stringify(metadata) : null,
      action,
      object,
    )) > 0
  );
}

/**
 * Organisasi minimal untuk instalasi tanpa seed (owner NEW-PO-04). Notice awal tidak dibuat di sini: baris
 * platform ditulis `provisionPlatformDefaults` pada transaksi yang sama, dan notice organisasi berikutnya
 * dibuat lewat `POST /admin/organizations`. `retention_days` NULL = tidak ada penghapusan otomatis (BF-06).
 */
async function ensuredOrganizationId(name: string): Promise<string> {
  const existing = await get<{ id: string }>('SELECT id FROM organizations WHERE name = ? ORDER BY id LIMIT 1', name);
  if (existing) return existing.id;
  const id = newId('org');
  // notice_version mengikuti notice platform yang dibuat pada transaksi pemanggil.
  const noticeVersion = await noticeVersionForNewOrganization(null);
  await run(
    `INSERT INTO organizations (id, name, organization_type, respondent_age_category, consent_mode, policy_url,
       terms_url, retention_days, data_request_contact, cross_border_transfer, notice_version, created_at)
     VALUES (?, ?, 'organization', 'adult', 'self', '/kebijakan-privasi', '/ketentuan-layanan', NULL, NULL, NULL, ?, ?)`,
    id,
    name,
    noticeVersion,
    nowIso(),
  );
  return id;
}

/**
 * Admin organisasi wajib ada: tanpa akun `org_admin`, organisasi yang dibuat bootstrap tidak dapat diisi
 * profilnya lewat `/org/profile`. Kata sandi hanya dari env; tanpa env, kata sandi acak (tidak pernah dicetak).
 */
async function ensureOrganizationAdmin(organizationId: string): Promise<void> {
  const email = process.env.BOOTSTRAP_ORGANIZATION_ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) throw new Error('BOOTSTRAP_ORGANIZATION_ADMIN_EMAIL wajib diisi bila BOOTSTRAP_ORGANIZATION_NAME diisi.');
  if (email.length > 254 || !EMAIL_RE.test(email)) throw new Error('BOOTSTRAP_ORGANIZATION_ADMIN_EMAIL tidak valid.');
  const taken = await get<{ id: string }>('SELECT id FROM accounts WHERE email = ?', email);
  if (taken) throw new Error(`Akun ${email} (BOOTSTRAP_ORGANIZATION_ADMIN_EMAIL) sudah ada; pakai email lain.`);
  const password = process.env[ORGANIZATION_ADMIN.passwordEnv]?.trim() || randomBytes(24).toString('base64url');
  const passwordError = passwordPolicyError(password);
  if (passwordError) throw new Error(`${ORGANIZATION_ADMIN.passwordEnv} tidak valid: ${passwordError}`);
  await run(
    `INSERT INTO accounts (id, email, display_name, role, status, password_hash, created_at, organization_id)
     VALUES (?, ?, ?, 'org_admin', 'active', ?, ?, ?)`,
    newId('u'),
    email,
    ORGANIZATION_ADMIN.displayName,
    await hashPassword(password),
    nowIso(),
    organizationId,
  );
  if (!process.env[ORGANIZATION_ADMIN.passwordEnv]?.trim()) {
    console.log(
      `[admin] org_admin ${email} dibuat dengan kata sandi acak; buka tautan atur ulang kata sandi atau atur lewat super_admin.`,
    );
  }
}

async function main(): Promise<void> {
  const email = required('BOOTSTRAP_ADMIN_EMAIL').toLowerCase();
  const password = required('BOOTSTRAP_ADMIN_PASSWORD');
  const displayName = (process.env.BOOTSTRAP_ADMIN_NAME?.trim() || 'Administrator').slice(0, 120);
  const organizationName = process.env.BOOTSTRAP_ORGANIZATION_NAME?.trim() || null;

  if (email.length > 254 || !EMAIL_RE.test(email)) throw new Error('BOOTSTRAP_ADMIN_EMAIL tidak valid.');
  const passwordError = passwordPolicyError(password);
  if (passwordError) throw new Error(`BOOTSTRAP_ADMIN_PASSWORD tidak valid: ${passwordError}`);

  await migrate();
  const existing = await get<{ role: string; status: string }>('SELECT role, status FROM accounts WHERE email = ?', email);
  if (existing && existing.role !== 'super_admin') {
    throw new Error(`Akun ${email} sudah ada dengan peran ${existing.role}; bootstrap dibatalkan.`);
  }

  // Basis data tanpa seed belum punya profil platform, sehingga POST /surveys ditolak profile_missing.
  // Organisasi dan admin platfom dibuat dalam transaksi yang sama agar instalasi tidak berhenti setengah jalan.
  const result = await withTx(async () => {
    const platform = await provisionPlatformDefaults();
    if (platform) {
      await systemAudit(PLATFORM_AUDIT, 'platform', { notice_version: platform.notice_version, notice_created: platform.notice_created });
    }
    const organizationId = organizationName ? await ensuredOrganizationId(organizationName) : null;
    if (organizationId) await systemAudit(ORGANIZATION_AUDIT, organizationId, { organization_name: organizationName });
    let adminCreated = false;
    if (existing) {
      // Akun super_admin yang sudah ada tidak diubah; admin organisasi tetap dibuat bila belum ada.
      if (organizationId && !(await get<{ id: string }>('SELECT id FROM accounts WHERE organization_id = ? LIMIT 1', organizationId))) {
        await ensureOrganizationAdmin(organizationId);
        adminCreated = true;
      }
    } else {
      await run(
        'INSERT INTO accounts (id, email, display_name, role, status, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        newId('u'),
        email,
        displayName,
        'super_admin',
        'active',
        await hashPassword(password),
        nowIso(),
      );
      await systemAudit('Bootstrap admin', email, null);
      if (organizationId) {
        await ensureOrganizationAdmin(organizationId);
        adminCreated = true;
      }
    }
    return { platform, organizationId, adminCreated };
  });

  if (result.platform) {
    console.log(`[admin] profil platform awal dibuat (notice_version ${result.platform.notice_version}); sesuaikan di halaman Profil platform.`);
    console.log(
      result.platform.notice_created
        ? `[admin] notice platform ${result.platform.notice_version} dibuat dari templat; tinjau dan ganti teksnya sebelum survei dibuka untuk responden.`
        : `[admin] notice platform ${result.platform.notice_version} sudah ada dan dipakai apa adanya.`,
    );
  }
  if (result.organizationId && result.adminCreated) {
    console.log(`[admin] organisasi "${organizationName}" siap (${result.organizationId}).`);
  }
  console.log(
    existing
      ? `[admin] ${email} sudah ada sebagai super_admin (${existing.status}); akun tidak diubah.`
      : `[admin] super_admin dibuat: ${email}`,
  );
}

try {
  await main();
} catch (error) {
  console.error(`[admin] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await closePool();
}
