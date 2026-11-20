// Harness uji beban API Svara (lokal). Bukan uji kapasitas produksi.
// Pemakaian: node scripts/perf-api.mjs --label baseline
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const API = process.env.PERF_API ?? 'http://127.0.0.1:3001';
const WEB = process.env.PERF_WEB ?? 'http://127.0.0.1:3100';
const SAMPLES = Number(process.env.PERF_SAMPLES ?? 30);
const WARMUP = 3;
const label = process.argv.includes('--label') ? process.argv[process.argv.indexOf('--label') + 1] : 'run';
const email = process.env.PERF_EMAIL ?? 'creator.a@svara.local';
const password = process.env.PERF_PASSWORD ?? 'SvaraDemo123!';

async function login() {
  const response = await fetch(`${API}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Svara-Client': 'web' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(`login ${response.status}: ${await response.text()}`);
  return response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
}

async function timed(url, cookie) {
  const started = performance.now();
  const response = await fetch(url, {
    headers: cookie ? { Cookie: cookie, 'X-Svara-Client': 'web' } : undefined,
  });
  const body = await response.arrayBuffer();
  return { ms: performance.now() - started, status: response.status, bytes: body.byteLength };
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))];
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const variance = sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sorted.length;
  return {
    n: sorted.length,
    min_ms: +sorted[0].toFixed(2),
    p50_ms: +at(0.5).toFixed(2),
    mean_ms: +mean.toFixed(2),
    p95_ms: +at(0.95).toFixed(2),
    max_ms: +sorted[sorted.length - 1].toFixed(2),
    sd_ms: +Math.sqrt(variance).toFixed(2),
  };
}

const cookie = await login();
const endpoints = [
  ['health', '/api/v1/health', false],
  ['public-context', '/api/v1/public/surveys/link-umum-perpus', false],
  ['bootstrap', '/api/v1/bootstrap', true],
  ['summary', '/api/v1/surveys/s_demo1/summary?version=v_demo1_1', true],
  ['responses-100', '/api/v1/surveys/s_demo1/responses?version=v_demo1_1', true],
  ['export-csv', '/api/v1/surveys/s_demo1/export?version=v_demo1_1&format=csv', true],
];

const results = { label, generatedAt: new Date().toISOString(), samples: SAMPLES, modes: {}, concurrency: {} };

for (const [mode, base] of [['direct', API], ['via-web', WEB]]) {
  results.modes[mode] = {};
  for (const [key, path, needsAuth] of endpoints) {
    const url = `${base}${path}`;
    for (let i = 0; i < WARMUP; i += 1) await timed(url, needsAuth ? cookie : undefined);
    const timings = [];
    let bytes = 0;
    let status = 0;
    for (let i = 0; i < SAMPLES; i += 1) {
      const sample = await timed(url, needsAuth ? cookie : undefined);
      timings.push(sample.ms);
      bytes = sample.bytes;
      status = sample.status;
    }
    results.modes[mode][key] = { ...stats(timings), status, response_bytes: bytes };
    console.log(`${mode.padEnd(7)} ${key.padEnd(15)} p50=${results.modes[mode][key].p50_ms}ms p95=${results.modes[mode][key].p95_ms}ms ${status} ${bytes}B`);
  }
}

async function burst(name, count, path, needsAuth) {
  const rounds = [];
  for (let round = 0; round < 5; round += 1) {
    const started = performance.now();
    const settled = await Promise.all(
      Array.from({ length: count }, () => timed(`${API}${path}`, needsAuth ? cookie : undefined)),
    );
    const wall = performance.now() - started;
    rounds.push({
      wall_ms: +wall.toFixed(2),
      throughput_rps: +((count / wall) * 1000).toFixed(2),
      errors: settled.filter((sample) => sample.status !== 200).length,
      latency: stats(settled.map((sample) => sample.ms)),
    });
  }
  const walls = rounds.map((round) => round.wall_ms);
  results.concurrency[name] = {
    requests_per_round: count,
    rounds,
    wall_p50_ms: stats(walls).p50_ms,
    wall_max_ms: stats(walls).max_ms,
    rps_mean: +(rounds.reduce((sum, round) => sum + round.throughput_rps, 0) / rounds.length).toFixed(2),
  };
  console.log(`burst ${name}: ${count} req x5, mean ${results.concurrency[name].rps_mean} rps`);
}

await burst('public-context-50', 50, '/api/v1/public/surveys/link-umum-perpus', false);
await burst('bootstrap-20', 20, '/api/v1/bootstrap', true);

mkdirSync('docs/test-evidence/perf', { recursive: true });
const out = `docs/test-evidence/perf/performance-api-${label}.json`;
writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
console.log(`wrote ${out}`);
