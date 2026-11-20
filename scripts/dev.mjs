#!/usr/bin/env node
// Jalankan `npm run dev` dari folder repo. Script ini memeriksa prasyarat lokal
// (PostgreSQL, port, variabel lingkungan) sebelum API/Web mulai, lalu meneruskan Ctrl+C.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import net from 'node:net';
import { parseArgs } from 'node:util';

const API_PORT = 3001;
const WEB_PORT = 3000;
const { values: flags } = parseArgs({ options: { dev: { type: 'boolean', default: false } } });
const DEVELOPMENT = flags.dev;

function readEnvFile() {
  if (!existsSync('.env')) return {};
  const values = {};
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return values;
}

function listening(port) {
  const { promise, resolve } = Promise.withResolvers();
  const socket = net.connect({ host: '127.0.0.1', port });
  socket.setTimeout(1000);
  socket.once('connect', () => {
    socket.destroy();
    resolve(true);
  });
  socket.once('timeout', () => {
    socket.destroy();
    resolve(false);
  });
  socket.once('error', () => resolve(false));
  return promise;
}

const env = { ...readEnvFile(), ...process.env };
const problems = [];
const occupied = [];

if (!env.DATABASE_URL) {
  problems.push('DATABASE_URL kosong. Salin .env.example ke .env, atau ekspor DATABASE_URL di shell.');
} else if (env.DATABASE_URL.includes('@db:')) {
  problems.push('DATABASE_URL menunjuk host `db`, yang hanya ada di dalam Docker Compose. Untuk dev lokal pakai 127.0.0.1:5432.');
} else if (!(await listening(5432))) {
  problems.push('PostgreSQL tidak menerima koneksi di 127.0.0.1:5432. Jalankan `docker compose up -d db`.');
}

if (await listening(WEB_PORT)) occupied.push(WEB_PORT);
if (await listening(API_PORT)) occupied.push(API_PORT);
if (occupied.length === 2) {
  problems.push(`Port ${WEB_PORT} dan ${API_PORT} sudah dipakai, berarti aplikasi ini sudah berjalan. Buka http://127.0.0.1:${WEB_PORT}.`);
} else if (occupied.length === 1) {
  const [port] = occupied;
  problems.push(`Port ${port} masih dipakai proses lain (mungkin sesi dev sebelumnya). Hentikan proses itu dulu.`);
}

if (problems.length > 0) {
  console.error('\n[dev] Belum bisa dijalankan:\n');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('\n[dev] Setelah diperbaiki, jalankan ulang `npm run dev`.\n');
  process.exit(1);
}

const children = [];
let stopping = false;
// Di Windows child.kill() hanya membunuh shell pembungkus; matikan seluruh pohon proses
// supaya API dan Web tidak tertinggal sehingga dev berikutnya kena "port sudah dipakai".
function killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
}

function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null || !child.pid) continue;
    killTree(child.pid);
    child.kill();
  }
  process.exit(code);
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(0));

function run(name, command, args) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env, shell: process.platform === 'win32' });
  children.push(child);
  const forward = (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) if (line.trim()) console.log(`[${name}] ${line}`);
  };
  child.stdout.on('data', forward);
  child.stderr.on('data', forward);
  child.once('exit', (code) => {
    if (stopping) return;
    console.error(`[dev] proses ${name} berhenti (kode ${code ?? 'null'}).`);
    stop(code ?? 1);
  });
  child.once('error', (error) => {
    console.error(`[dev] gagal menjalankan ${name}: ${error.message}`);
    stop(1);
  });
}

const bin = (name) => {
  const path = join('node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name);
  if (!existsSync(path)) {
    console.error(`\n[dev] ${path} tidak ada. Jalankan \`npm install\` lebih dulu.\n`);
    process.exit(1);
  }
  return path;
};

const tsx = bin('tsx');
const next = bin('next');

console.log(`[dev] API http://127.0.0.1:${API_PORT} + Web http://127.0.0.1:${WEB_PORT}. Berhenti dengan Ctrl+C.`);
run('api', tsx, [...(DEVELOPMENT ? ['watch'] : []), 'server/index.ts']);
run('web', next, [DEVELOPMENT ? 'dev' : 'start', '-p', String(WEB_PORT)]);
