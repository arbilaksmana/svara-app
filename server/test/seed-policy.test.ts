import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoSeedEnabled } from '../seed-policy.ts';

const ROOT = resolve('.');
const INDEX = join(ROOT, 'server', 'index.ts');
const SEED = join(ROOT, 'server', 'seed.ts');
const BOOTSTRAP = join(ROOT, 'server', 'scripts', 'bootstrap-admin.ts');

function tempDb(): { dir: string; db: string } {
  const dir = mkdtempSync(join(tmpdir(), 'svara-seed-gate-'));
  return { dir, db: join(dir, 'test.sqlite') };
}

function run(script: string, env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, ['--import', 'tsx', script], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 20_000,
  });
}

function accountCount(dbPath: string): number {
  const db = new DatabaseSync(dbPath);
  try {
    const row = db.prepare('SELECT COUNT(*) AS count FROM accounts').get() as { count: number };
    return row.count;
  } finally {
    db.close();
  }
}

function waitForServer(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = '';
    const onData = (chunk: unknown) => {
      output += String(chunk);
      if (output.includes('Svara berjalan')) resolve();
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('exit', (code) => reject(new Error(`server berhenti (kode ${code}): ${output}`)));
  });
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.kill();
  await exited;
}

test('seed demo hanya aktif dengan SEED_DEMO=1 dan ditolak di production', () => {
  assert.equal(demoSeedEnabled({ NODE_ENV: 'test' }), false);
  assert.equal(demoSeedEnabled({ NODE_ENV: 'test', SEED_DEMO: '0' }), false);
  assert.equal(demoSeedEnabled({ NODE_ENV: 'test', SEED_DEMO: '1' }), true);
  assert.throws(() => demoSeedEnabled({ NODE_ENV: 'test', SEED_DEMO: 'true' }), /SEED_DEMO/);
  assert.throws(() => demoSeedEnabled({ NODE_ENV: 'production', SEED_DEMO: '1' }), /production/);
});

test('CLI seed menolak berjalan tanpa SEED_DEMO=1', () => {
  const temp = tempDb();
  try {
    const result = run(SEED, {
      NODE_ENV: 'test',
      DB_PATH: temp.db,
      SEED_DEMO: '0',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SEED_DEMO=1/);
    assert.equal(existsSync(temp.db), false);
  } finally {
    rmSync(temp.dir, { recursive: true, force: true });
  }
});

test('CLI seed memuat data demo saat diaktifkan eksplisit', () => {
  const temp = tempDb();
  try {
    const result = run(SEED, {
      NODE_ENV: 'test',
      DB_PATH: temp.db,
      SEED_DEMO: '1',
      SEED_PASSWORD: 'TestPassword123!',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(accountCount(temp.db), 5);
  } finally {
    rmSync(temp.dir, { recursive: true, force: true });
  }
});

test('server start tanpa SEED_DEMO tidak membuat akun demo', { timeout: 15_000 }, async () => {
  const temp = tempDb();
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'test', DB_PATH: temp.db, PORT: '3198' };
  delete env.SEED_DEMO;
  const child = spawn(process.execPath, ['--import', 'tsx', INDEX], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForServer(child);
    assert.equal(accountCount(temp.db), 0);
  } finally {
    await stopServer(child);
    rmSync(temp.dir, { recursive: true, force: true });
  }
});

test('server menolak SEED_DEMO=1 di production', () => {
  const temp = tempDb();
  try {
    const result = run(INDEX, {
      NODE_ENV: 'production',
      DB_PATH: temp.db,
      SEED_DEMO: '1',
      PORT: '3199',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SEED_DEMO=1 ditolak/);
  } finally {
    rmSync(temp.dir, { recursive: true, force: true });
  }
});

test('bootstrap admin membuat super_admin sekali tanpa menimpa akun', () => {
  const temp = tempDb();
  try {
    const env = {
      NODE_ENV: 'test',
      DB_PATH: temp.db,
      BOOTSTRAP_ADMIN_EMAIL: 'root@example.org',
      BOOTSTRAP_ADMIN_NAME: 'Root Operator',
      BOOTSTRAP_ADMIN_PASSWORD: 'StrongPass123!',
    };
    const first = run(BOOTSTRAP, env);
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /super_admin dibuat/);
    assert.equal(accountCount(temp.db), 1);

    const second = run(BOOTSTRAP, env);
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /sudah ada/);
    assert.equal(accountCount(temp.db), 1);
  } finally {
    rmSync(temp.dir, { recursive: true, force: true });
  }
});

test('bootstrap admin menolak kata sandi lemah', () => {
  const temp = tempDb();
  try {
    const result = run(BOOTSTRAP, {
      NODE_ENV: 'test',
      DB_PATH: temp.db,
      BOOTSTRAP_ADMIN_EMAIL: 'root@example.org',
      BOOTSTRAP_ADMIN_PASSWORD: 'pendek',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /12-256 karakter/);
  } finally {
    rmSync(temp.dir, { recursive: true, force: true });
  }
});
