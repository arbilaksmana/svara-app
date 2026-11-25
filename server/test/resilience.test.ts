import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { closeTestDatabase, databaseUrl, resetTestDatabase } from './test-db.ts';

/**
 * PERF-08: pool wajib membatasi statement_timeout; query lambat dibatalkan server (57014),
 * bukan menggantung dan menghabiskan koneksi pool.
 * OPS-08: batas paksa shutdown bisa dikonfigurasi lewat SHUTDOWN_FORCE_EXIT_MS; nilai tidak
 * valid jatuh ke default 5000 dengan satu peringatan, tidak pernah membuat proses abadi.
 */

const ROOT = resolve('.');
const PORT = 3293;

after(async () => {
  await closeTestDatabase();
});

function captureOutput(child: ChildProcess): () => string {
  let output = '';
  const grab = (chunk: unknown) => {
    output += String(chunk);
  };
  child.stdout?.on('data', grab);
  child.stderr?.on('data', grab);
  return () => output;
}

async function waitForServer(child: ChildProcess, output: () => string): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const onData = () => {
    if (output().includes('Svara berjalan')) resolve();
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
  child.once('exit', (code) => reject(new Error(`server berhenti (kode ${code}): ${output()}`)));
  const timer = setTimeout(() => reject(new Error(`server tidak siap dalam 20 s: ${output()}`)), 20_000).unref();
  try {
    await promise;
  } finally {
    clearTimeout(timer);
    child.stdout?.off('data', onData);
    child.stderr?.off('data', onData);
  }
}

/**
 * SIGINT asli tidak bisa dikirim lintas proses di Windows (libuv mengubahnya menjadi terminate
 * tanpa handler), jadi proses anak meneruskan tulisan stdin 'SIGINT' ke process.emit. Handler
 * shutdown yang diuji adalah kode produksi yang sama; hanya pemicunya yang lewat stdin.
 */
function startApi(env: NodeJS.ProcessEnv): ChildProcess {
  return spawn(process.execPath, [
    '--import', 'tsx', '--eval',
    "process.stdin.setEncoding('utf8');process.stdin.on('data',(d)=>{if(String(d).includes('SIGINT'))process.emit('SIGINT')});process.stdin.resume();await import(process.argv[1]);",
    pathToFileURL(join(ROOT, 'server', 'index.ts')).href,
  ], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'test', PORT: String(PORT), ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/**
 * Koneksi dengan header HTTP yang belum lengkap tetap dihitung "active" oleh server.close(),
 * sehingga shutdown hanya bisa selesai lewat jalur keluar paksa; exit 1 membuktikan batasnya.
 */
async function holdActiveConnection(): Promise<net.Socket> {
  const socket = net.connect(PORT, '127.0.0.1');
  socket.on('error', () => {}); // server memutus koneksi saat keluar paksa
  await once(socket, 'connect');
  socket.write('GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n');
  return socket;
}

async function shutdownOutcome(child: ChildProcess, output: () => string): Promise<{ code: number | null; elapsedMs: number }> {
  const socket = await holdActiveConnection();
  const exited = once(child, 'exit');
  const started = performance.now();
  child.stdin?.write('SIGINT\n');
  const [code] = await exited;
  const elapsedMs = performance.now() - started;
  socket.destroy();
  assert.ok(output().includes('Svara berjalan'), `server harus sudah siap: ${output()}`);
  return { code: typeof code === 'number' ? code : null, elapsedMs };
}

test('PERF-08: koneksi pool memakai statement_timeout dari PG_STATEMENT_TIMEOUT_MS', { timeout: 30_000 }, async (t) => {
  process.env.PG_STATEMENT_TIMEOUT_MS = '200';
  try {
    await resetTestDatabase();
    // Import dinamis wajib: db.ts membaca env saat modul dimuat, jadi PG_STATEMENT_TIMEOUT_MS
    // harus terpasang lebih dulu; import statis di kepala berkas akan membekukan konfigurasi lama.
    const { get } = await import('../db.ts');
    const setting = await get<{ setting: string }>("SELECT current_setting('statement_timeout') AS setting");
    assert.equal(setting?.setting, '200ms', 'statement_timeout pool harus mengikuti PG_STATEMENT_TIMEOUT_MS');

    // 200 ms khusus uji: bukti deterministik tanpa membuat suite lambat. Tanpa batas pool (cd032da),
    // pg_sleep(1) selesai normal dan test ini gagal.
    const started = performance.now();
    await assert.rejects(
      get('SELECT pg_sleep(1)'),
      (error: unknown) => {
        assert.ok(error && typeof error === 'object' && 'code' in error);
        assert.equal(error.code, '57014', 'query harus dibatalkan server (query_canceled)');
        return true;
      },
      'pg_sleep melebihi statement_timeout harus ditolak, bukan menggantung',
    );
    const elapsedMs = performance.now() - started;
    t.diagnostic(`pg_sleep(1) dibatalkan setelah ${elapsedMs.toFixed(0)} ms (batas 200 ms)`);
    assert.ok(elapsedMs < 900, `pembatalan harus terjadi jauh sebelum pg_sleep selesai: ${elapsedMs} ms`);
  } finally {
    delete process.env.PG_STATEMENT_TIMEOUT_MS;
  }
});

test('OPS-08: env kosong tetap memakai batas paksa 5000 ms', { timeout: 30_000 }, async () => {
  await resetTestDatabase();
  const child = startApi({ SHUTDOWN_FORCE_EXIT_MS: '' });
  const output = captureOutput(child);
  try {
    await waitForServer(child, output);
    const { code, elapsedMs } = await shutdownOutcome(child, output);
    assert.equal(code, 1, 'koneksi aktif yang tertahan harus diakhiri jalur keluar paksa');
    assert.ok(elapsedMs >= 4_500 && elapsedMs < 9_000, `batas default 5 s, terukur ${elapsedMs.toFixed(0)} ms`);
    assert.doesNotMatch(output(), /SHUTDOWN_FORCE_EXIT_MS/, 'env kosong bukan nilai tidak valid; tanpa peringatan');
  } finally {
    if (child.exitCode === null) child.kill();
  }
});

test('OPS-08: SHUTDOWN_FORCE_EXIT_MS valid dipakai sebagai batas paksa', { timeout: 30_000 }, async () => {
  await resetTestDatabase();
  const child = startApi({ SHUTDOWN_FORCE_EXIT_MS: '300' });
  const output = captureOutput(child);
  try {
    await waitForServer(child, output);
    const { code, elapsedMs } = await shutdownOutcome(child, output);
    assert.equal(code, 1);
    assert.ok(elapsedMs < 2_000, `batas 300 ms harus dipakai, terukur ${elapsedMs.toFixed(0)} ms`);
    assert.doesNotMatch(output(), /SHUTDOWN_FORCE_EXIT_MS/, 'nilai valid tidak memunculkan peringatan');
  } finally {
    if (child.exitCode === null) child.kill();
  }
});

for (const invalid of ['abc', '-5', '0']) {
  test(`OPS-08: SHUTDOWN_FORCE_EXIT_MS tidak valid (${JSON.stringify(invalid)}) jatuh ke default dengan peringatan`, { timeout: 30_000 }, async () => {
    await resetTestDatabase();
    const child = startApi({ SHUTDOWN_FORCE_EXIT_MS: invalid });
    const output = captureOutput(child);
    try {
      await waitForServer(child, output);
      assert.match(output(), /SHUTDOWN_FORCE_EXIT_MS/, 'nilai tidak valid harus memunculkan satu peringatan');
      const { code, elapsedMs } = await shutdownOutcome(child, output);
      assert.equal(code, 1);
      assert.ok(elapsedMs >= 4_500 && elapsedMs < 9_000, `default 5 s harus tetap dipakai, terukur ${elapsedMs.toFixed(0)} ms`);
    } finally {
      if (child.exitCode === null) child.kill();
    }
  });
}
