/**
 * DEMO ONLY — simulasi beban lokal, bukan bukti kapasitas produksi.
 * Membuat survei 20 item, menerbitkan tautan umum, lalu mengirim 30 respons
 * paralel dengan kunci idempotensi berbeda ke satu tautan.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const PORT = 3199;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const DB_PATH = resolve(tmpdir(), 'svara-ac13-load.sqlite');
const EVIDENCE_PATH = resolve('docs/test-evidence/ac13-load.json');

interface ApiResult {
  status: number;
  body: Record<string, unknown>;
}

let cookie = '';

async function call(path: string, init: { method?: string; body?: unknown; key?: string } = {}): Promise<ApiResult> {
  const headers: Record<string, string> = { 'X-Svara-Client': 'web' };
  if (cookie) headers.Cookie = cookie;
  if (init.key) headers['Idempotency-Key'] = init.key;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${BASE}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0] ?? '';
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = { raw: text };
  }
  return { status: response.status, body };
}

function data<T>(result: ApiResult): T {
  if (result.status >= 400) throw new Error(`HTTP ${result.status}: ${JSON.stringify(result.body)}`);
  return result.body.data as T;
}

let stopping = false;

async function waitForServer(child: ChildProcess): Promise<void> {
  const signal = new Promise<void>((resolveSignal) => {
    let output = '';
    const onData = (chunk: unknown) => {
      output += String(chunk);
      if (output.includes('Svara berjalan')) resolveSignal();
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('exit', (code) => {
      if (!stopping) throw new Error(`server demo berhenti (kode ${code}): ${output}`);
    });
  });
  await signal;
}

const p95 = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
};

const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    DB_PATH,
    COOKIE_SECURE: '0',
    APP_ORIGIN: `http://127.0.0.1:${PORT}`,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

try {
  rmSync(DB_PATH, { force: true });
  rmSync(`${DB_PATH}-wal`, { force: true });
  rmSync(`${DB_PATH}-shm`, { force: true });
  await waitForServer(server);

  data(await call('/auth/login', {
    method: 'POST',
    body: { email: 'creator.a@svara.local', password: 'SvaraDemo123!' },
  }));

  const created = data<{ survey: { id: string } }>(
    await call('/surveys', {
      method: 'POST',
      body: { title: 'Simulasi beban 20 item', purpose: 'DEMO ONLY: uji kiriman paralel.', profile_id: 'p_smk' },
    }),
  );
  const surveyId = created.survey.id;

  const questions = Array.from({ length: 20 }, (_, index) => ({
    code: `Q${String(index + 1).padStart(2, '0')}`,
    type: 'likert',
    required: true,
    section: 'Simulasi',
    label: `Pernyataan simulasi ${index + 1}`,
    hint: null,
    group_code: null,
    dimension_code: null,
    direction: null,
    options: [
      { label: 'Sangat tidak setuju', value: 1 },
      { label: 'Tidak setuju', value: 2 },
      { label: 'Setuju', value: 3 },
      { label: 'Sangat setuju', value: 4 },
    ],
  }));

  data(await call(`/surveys/${surveyId}`, {
    method: 'PUT',
    body: {
      title: 'Simulasi beban 20 item',
      purpose: 'DEMO ONLY: uji kiriman paralel.',
      object_label: 'Simulasi',
      instructions: 'Pilih satu jawaban.',
      profile_id: 'p_smk',
      questions,
    },
  }));

  const published = data<{ publicLink: { token: string }; version: { id: string } }>(
    await call(`/surveys/${surveyId}/publish`, { method: 'POST' }),
  );
  const token = published.publicLink.token;
  const detail = data<{
    questions: Array<{ code: string; options: Array<{ id: string; value: number }> }>;
  }>(await call(`/surveys/${surveyId}`));
  const optionsByCode = new Map(
    detail.questions.map((question) => [
      question.code,
      question.options.reduce<Record<number, string>>((acc, option) => {
        acc[option.value] = option.id;
        return acc;
      }, {}),
    ]),
  );

  const consents = await Promise.all(
    Array.from({ length: 30 }, () =>
      call(`/public/surveys/${token}/consent`, {
        method: 'POST',
        body: { respondent_click: true, eligibility: true, guardian_evidence_ref: 'DEMO-AC13-WALI' },
      }),
    ),
  );
  const consentIds = consents.map((result) =>
    (data<{ consent_id: string }>(result)).consent_id,
  );

  const startedAt = performance.now();
  const submissions = await Promise.all(
    consentIds.map(async (consentId, index) => {
      const sendStarted = performance.now();
      const result = await call(`/public/surveys/${token}/responses`, {
        method: 'POST',
        key: `ac13-${index}-${String(performance.now())}`,
        body: {
          consent_id: consentId,
          version_id: published.version.id,
          answers: questions.map((question) => ({
            question_code: question.code,
            option_id: optionsByCode.get(question.code)?.[(index % 4) + 1] ?? null,
          })),
        },
      });
      return { status: result.status, elapsedMs: performance.now() - sendStarted, result };
    }),
  );
  const totalElapsedMs = performance.now() - startedAt;

  const responseIds = new Set(
    submissions.map(({ result }) => (data<{ response_id: string }>(result)).response_id),
  );
  const statuses = submissions.map(({ status }) => status);
  const durations = submissions.map(({ elapsedMs }) => elapsedMs);

  if (statuses.some((status) => status !== 201)) {
    throw new Error(`ada kiriman gagal: ${JSON.stringify(statuses)}`);
  }
  if (responseIds.size !== 30) {
    throw new Error(`ID unik ${responseIds.size}, seharusnya 30`);
  }

  const summary = data<{ total: number; items: Array<{ answered: number }> }>(
    await call(`/surveys/${surveyId}/summary?version=${published.version.id}`),
  );
  if (summary.total < 30) throw new Error(`ringkasan hanya ${summary.total} respons`);

  const report = {
    label: 'DEMO ONLY — simulasi beban lokal, bukan bukti kapasitas produksi',
    generated_at: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      cpu_count: (await import('node:os')).cpus().length,
      server: `127.0.0.1:${PORT}`,
      storage: 'SQLite node:sqlite',
    },
    scenario: { concurrent_submissions: 30, items_per_survey: 20, keys: 'distinct' },
    results: {
      http_201: statuses.filter((status) => status === 201).length,
      unique_response_ids: responseIds.size,
      summary_total: summary.total,
      answered_per_item: summary.items.map((item) => item.answered),
      p95_commit_ms: Number(p95(durations).toFixed(2)),
      total_wall_ms: Number(totalElapsedMs.toFixed(2)),
      max_commit_ms: Number(Math.max(...durations).toFixed(2)),
    },
    limitations: [
      'Tidak mengukur jaringan nyata, TLS, atau batas produksi.',
      'Server, basis data, dan klien berjalan di mesin yang sama.',
      'Angka hanya bukti demo AC13, bukan hasil uji lapangan.',
    ],
  };

  mkdirSync(resolve('docs/test-evidence'), { recursive: true });
  writeFileSync(EVIDENCE_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nBukti ditulis ke ${EVIDENCE_PATH}`);
} finally {
  stopping = true;
  server.kill();
  await new Promise<void>((resolveExit) => {
    if (server.exitCode !== null) resolveExit();
    else server.once('exit', () => resolveExit());
  });
  rmSync(DB_PATH, { force: true });
  rmSync(`${DB_PATH}-wal`, { force: true });
  rmSync(`${DB_PATH}-shm`, { force: true });
}
