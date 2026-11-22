import { closePool, get, nowIso, run, withTx } from '../db.ts';
import { newId } from '../http.ts';
import { migrate } from '../migrate.ts';
import { provisionPlatformDefaults } from '../notice-provisioning.ts';
import { hashPassword, passwordPolicyError } from '../security.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} wajib diisi.`);
  return value;
}

async function systemAudit(action: string, object: string, metadata: Record<string, unknown> | null): Promise<void> {
  await run(
    'INSERT INTO audit_logs (id, actor, action, object, outcome, at, metadata, account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    newId('log'),
    'system',
    action,
    object,
    'berhasil',
    nowIso(),
    metadata ? JSON.stringify(metadata) : null,
    null,
  );
}

async function main(): Promise<void> {
  const email = required('BOOTSTRAP_ADMIN_EMAIL').toLowerCase();
  const password = required('BOOTSTRAP_ADMIN_PASSWORD');
  const displayName = (process.env.BOOTSTRAP_ADMIN_NAME?.trim() || 'Administrator').slice(0, 120);

  if (email.length > 254 || !EMAIL_RE.test(email)) {
    throw new Error('BOOTSTRAP_ADMIN_EMAIL tidak valid.');
  }
  const passwordError = passwordPolicyError(password);
  if (passwordError) throw new Error(`BOOTSTRAP_ADMIN_PASSWORD tidak valid: ${passwordError}`);

  await migrate();
  const existing = await get<{ role: string; status: string }>('SELECT role, status FROM accounts WHERE email = ?', email);
  if (existing && existing.role !== 'super_admin') {
    throw new Error(`Akun ${email} sudah ada dengan peran ${existing.role}; bootstrap dibatalkan.`);
  }

  // Basis data tanpa seed belum punya profil dan notice platform, sehingga organisasi baru ditolak
  // notice_source_missing. Langkah ini juga berjalan bila super_admin sudah ada (bootstrap ulang).
  const platform = await withTx(async () => {
    const created = await provisionPlatformDefaults();
    if (created) await systemAudit('Bootstrap profil platform', 'platform', { ...created });
    return created;
  });
  if (platform) {
    console.log(`[admin] profil platform awal dibuat (notice_version ${platform.notice_version}); sesuaikan di halaman Profil platform.`);
    console.log(
      platform.notice_created
        ? `[admin] notice platform ${platform.notice_version} dibuat dari templat; tinjau dan ganti teksnya sebelum survei dibuka untuk responden.`
        : `[admin] notice platform ${platform.notice_version} sudah ada dan dipakai apa adanya.`,
    );
  }

  if (existing) {
    console.log(`[admin] ${email} sudah ada sebagai super_admin (${existing.status}); akun tidak diubah.`);
    return;
  }

  await withTx(async () => {
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
  });

  console.log(`[admin] super_admin dibuat: ${email}`);
}

try {
  await main();
} catch (error) {
  console.error(`[admin] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await closePool();
}
