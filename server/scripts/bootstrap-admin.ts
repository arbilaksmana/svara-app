import { db, ensureSchema, get, nowIso, run, withTx } from '../db.ts';
import { newId } from '../http.ts';
import { hashPassword } from '../security.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} wajib diisi.`);
  return value;
}

function assertStrongPassword(password: string): void {
  if (password.length < 12 || password.length > 256) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD harus 12-256 karakter.');
  }
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length;
  if (classes < 3) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD harus memakai minimal 3 dari: huruf kecil, huruf besar, angka, simbol.');
  }
}

function main(): void {
  const email = required('BOOTSTRAP_ADMIN_EMAIL').toLowerCase();
  const password = required('BOOTSTRAP_ADMIN_PASSWORD');
  const displayName = (process.env.BOOTSTRAP_ADMIN_NAME?.trim() || 'Administrator').slice(0, 120);

  if (email.length > 254 || !EMAIL_RE.test(email)) {
    throw new Error('BOOTSTRAP_ADMIN_EMAIL tidak valid.');
  }
  assertStrongPassword(password);

  ensureSchema();
  const existing = get<{ role: string; status: string }>('SELECT role, status FROM accounts WHERE email = ?', email);
  if (existing) {
    if (existing.role === 'super_admin') {
      console.log(`[admin] ${email} sudah ada sebagai super_admin (${existing.status}); tidak ada perubahan.`);
      return;
    }
    throw new Error(`Akun ${email} sudah ada dengan peran ${existing.role}; bootstrap dibatalkan.`);
  }

  withTx(() => {
    run(
      'INSERT INTO accounts (id, email, display_name, role, status, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      newId('u'),
      email,
      displayName,
      'super_admin',
      'active',
      hashPassword(password),
      nowIso(),
    );
    run(
      'INSERT INTO audit_logs (id, actor, action, object, outcome, at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
      newId('log'),
      'system',
      'Bootstrap admin',
      email,
      'berhasil',
      nowIso(),
      null,
    );
  });

  console.log(`[admin] super_admin dibuat: ${email}`);
}

try {
  main();
} catch (error) {
  console.error(`[admin] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  db.close();
}
