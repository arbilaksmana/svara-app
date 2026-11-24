/**
 * DEMO ONLY — simulasi beban lokal, bukan bukti kapasitas produksi.
 * Membuat survei 20 item, menerbitkan tautan umum, lalu mengirim 30 respons
 * paralel dengan kunci idempotensi berbeda ke satu tautan.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sourceBaseline, resetDemoDatabase, stopServer, waitForServer } from './demo-db.ts';

const PORT = 3199;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const EVIDENCE_PATH = resolve('docs/test-evidence/ac13-load.json');
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'SvaraDemo123!';

interface ApiResult {
  status: number;
  body: Record<string, unknown>;
  cookie: string;
}

let cookie = '';

async function call(path: string, init: { method?: string; body?: unknown; key?: string; cookie?: string } = {}): Promise<ApiResult> {
  const headers: Record<string, string> = { 'X-Svara-Client': 'web' };
  const requestCookie = path.startsWith('/public/surveys/') ? init.cookie : cookie;
  if (requestCookie) headers.Cookie = requestCookie;
  if (init.key) headers['Idempotency-Key'] = init.key;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${BASE}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const issuedCookie = response.headers.get('set-cookie')?.split(';')[0] ?? '';
  if (path === '/auth/login' && issuedCookie) cookie = issuedCookie;
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = { raw: text };
  }
  return { status: response.status, body, cookie: issuedCookie };
}

function data<T>(result: ApiResult): T {
  if (result.status >= 400) throw new Error(`HTTP ${result.status}: ${JSON.stringify(result.body)}`);
  return result.body.data as T;
}

const p95 = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
};

const database = await resetDemoDatabase();
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    DATABASE_URL: database.databaseUrl,
    SEED_DEMO: '1',
    COOKIE_SECURE: '0',
    APP_ORIGIN: `http://127.0.0.1:${PORT}`,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

try {
  await waitForServer(server, 'server demo AC13');

  data(await call('/auth/login', {
    method: 'POST',
    body: { email: 'creator.a@svara.local', password: SEED_PASSWORD },
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

  // SEC-02: persetujuan wajib menyebut versi yang benar-benar dirender (token buram dari intro).
  const intro = data<{ consent_version: string }>(await call(`/public/surveys/${token}`));
  const consents = await Promise.all(
    Array.from({ length: 30 }, () =>
      call(`/public/surveys/${token}/consent`, {
        method: 'POST',
        body: {
          respondent_click: true,
          eligibility: true,
          version_id: intro.consent_version,
          guardian_evidence_ref: 'DEMO-AC13-WALI',
        },
      }),
    ),
  );

  const startedAt = performance.now();
  const submissions = await Promise.all(
    consents.map(async (consent, index) => {
      const consentId = data<{ consent_id: string }>(consent).consent_id;
      const sendStarted = performance.now();
      const result = await call(`/public/surveys/${token}/responses`, {
        method: 'POST',
        cookie: consent.cookie,
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
      baseline: sourceBaseline(),
      platform: `${process.platform} ${process.arch}`,
      cpu_count: (await import('node:os')).cpus().length,
      server: `127.0.0.1:${PORT}`,
      storage: 'PostgreSQL via pg Pool',
      postgres_server_version: database.serverVersion,
      database: new URL(database.databaseUrl).pathname.replace(/^\//, ''),
    },
    scenario: { concurrent_submissions: 30, items_per_survey: 20, keys: 'distinct' },
    results: {
      http_201: statuses.filter((status) => status === 201).length,
      unique_response_ids: responseIds.size,
      summary_total: summary.total,
      answered_per_item: summary.items.map((item) => item.answered),
      // Durasi ini diukur di klien: fetch sampai respons kiriman diterima, termasuk jaringan loopback,
      // antrean event loop, dan jalur submit server (resolve konteks + transaksi). Bukan lama commit DB.
      p95_submit_client_ms: Number(p95(durations).toFixed(2)),
      total_wall_ms: Number(totalElapsedMs.toFixed(2)),
      max_submit_client_ms: Number(Math.max(...durations).toFixed(2)),
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
  await stopServer(server);
}
