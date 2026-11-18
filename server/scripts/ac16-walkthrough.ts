/**
 * DEMO ONLY — walkthrough sintetis AC16: tiga responden, ekspor CSV, rekonsiliasi.
 * Bukan studi lapangan dan bukan bukti persetujuan/legitimasi.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const PORT = 3198;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const DB_PATH = resolve(tmpdir(), 'svara-ac16-walkthrough.sqlite');
const EVIDENCE_JSON = resolve('docs/test-evidence/ac16-walkthrough.json');
const EVIDENCE_MD = resolve('docs/test-evidence/ac16-walkthrough.md');

interface ApiResult {
  status: number;
  body: Record<string, unknown>;
  text: string;
  bytes: Uint8Array;
}

let cookie = '';
let stopping = false;

async function call(
  path: string,
  init: { method?: string; body?: unknown; key?: string; raw?: boolean } = {},
): Promise<ApiResult> {
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
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = { raw: text };
  }
  return { status: response.status, body, text, bytes };
}

function data<T>(result: ApiResult): T {
  if (result.status >= 400) throw new Error(`HTTP ${result.status}: ${result.text}`);
  return result.body.data as T;
}

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

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]!;
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

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

  const token = 'link-umum-demo';
  const createdIds: string[] = [];
  const patterns = [
    { AD01: 4, TS01: 5, K02: 'Contoh sintetis satu' },
    { AD01: 3, TS01: 4, K02: 'Contoh sintetis dua' },
    { AD01: 2, TS01: 2, K02: 'Contoh sintetis tiga' },
  ];

  for (const [index, pattern] of patterns.entries()) {
    const consent = data<{ consent_id: string }>(
      await call(`/public/surveys/${token}/consent`, {
        method: 'POST',
        body: {
          respondent_click: true,
          eligibility: true,
          guardian_evidence_ref: `DEMO-AC16-WALI-${index + 1}`,
        },
      }),
    );
    const form = data<{
      version: { id: string };
      questions: Array<{ id: string; code: string }>;
      options: Array<{ id: string; question_id: string; value: number }>;
    }>(await call(`/public/surveys/${token}/form?consent_id=${encodeURIComponent(consent.consent_id)}`));
    const optionId = (code: string, value: number): string | null => {
      const question = form.questions.find((item) => item.code === code);
      if (!question) return null;
      return form.options.find((option) => option.question_id === question.id && option.value === value)?.id ?? null;
    };
    const receipt = data<{ response_id: string }>(
      await call(`/public/surveys/${token}/responses`, {
        method: 'POST',
        key: `ac16-demo-${index + 1}-abcdef`,
        body: {
          consent_id: consent.consent_id,
          version_id: form.version.id,
          answers: [
            { question_code: 'AD01', option_id: optionId('AD01', pattern.AD01) },
            { question_code: 'TS01', option_id: optionId('TS01', pattern.TS01) },
            { question_code: 'K02', text: pattern.K02 },
          ],
        },
      }),
    );
    createdIds.push(receipt.response_id);
  }

  data(await call('/auth/login', {
    method: 'POST',
    body: { email: 'officer@svara.local', password: 'SvaraDemo123!' },
  }));
  const summary = data<{
    total: number;
    items: Array<{ code: string; answered: number; options: Array<{ value: number | null; count: number }> }>;
  }>(await call('/surveys/s_demo1/summary?version=v_demo1_1'));
  const csv = await call('/surveys/s_demo1/export?version=v_demo1_1&format=csv');
  if (csv.status !== 200) throw new Error(`ekspor gagal: ${csv.text}`);
  const rows = parseCsv(csv.text);
  const header = rows[0] ?? [];
  const body = rows.slice(1);
  const adIndex = header.indexOf('AD01');
  if (adIndex < 0) throw new Error('kolom AD01 tidak ditemukan');

  const counts = new Map<number, number>();
  for (const row of body) {
    const value = Number(row[adIndex]);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const summaryAd = summary.items.find((item) => item.code === 'AD01');
  const matches = summaryAd?.options.every((option) => (counts.get(Number(option.value)) ?? 0) === option.count) ?? false;
  const versions = new Set(body.map((row) => row[header.indexOf('survey_version')]));
  const createdInCsv = createdIds.every((id) => body.some((row) => row[header.indexOf('response_id')] === id));

  if (body.length !== summary.total) throw new Error(`baris CSV ${body.length} != ringkasan ${summary.total}`);
  if (!matches) throw new Error('frekuensi AD01 pada CSV tidak cocok dengan ringkasan');
  if (versions.size !== 1 || !versions.has('1') && !versions.has('v_demo1_1')) {
    throw new Error(`versi CSV tidak tunggal: ${[...versions].join(', ')}`);
  }
  if (!createdInCsv) throw new Error('respons sintetis tidak semuanya muncul di CSV');

  const report = {
    label: 'DEMO ONLY — data sintetis; bukan studi lapangan, bukan bukti efektivitas.',
    generated_at: new Date().toISOString(),
    environment: { node: process.version, platform: `${process.platform} ${process.arch}`, storage: 'SQLite' },
    scenario: { respondents: 3, survey: 's_demo1', version: 'v_demo1_1', patterns },
    reconciliation: {
      summary_total: summary.total,
      csv_rows: body.length,
      created_response_ids: createdIds,
      all_created_ids_present: createdInCsv,
      survey_version_values: [...versions],
      ad01_matches_summary: matches,
      ad01_csv_counts: Object.fromEntries([...counts.entries()].sort(([a], [b]) => a - b)),
      ad01_summary_counts: summaryAd?.options.map((option) => ({ value: option.value, count: option.count })),
      csv_bom: csv.bytes[0] === 0xef && csv.bytes[1] === 0xbb && csv.bytes[2] === 0xbf,
    },
    limitations: [
      'Tidak ada peserta nyata, sekolah nyata, atau persetujuan legal.',
      'Tidak menguji jaringan, perangkat lapangan, atau kerahasiaan statistik.',
      'Hasil hanya untuk demonstrasi alur dan rekonsiliasi CSV.',
    ],
  };

  mkdirSync(resolve('docs/test-evidence'), { recursive: true });
  writeFileSync(EVIDENCE_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(
    EVIDENCE_MD,
    [
      '# AC16 — Demo walkthrough sintetis',
      '',
      '**DEMO ONLY.** Data sintetis. Dokumen ini bukan studi lapangan, bukan bukti efektivitas, dan bukan pengganti persetujuan etik/legal.',
      '',
      '## Skenario',
      '',
      'Tiga responden sintetis mengisi tautan umum `s_demo1` versi `v_demo1_1` dengan pola jawaban berbeda, lalu petugas berizin mengekspor CSV versi tersebut.',
      '',
      '## Rekonsiliasi',
      '',
      `- Total ringkasan: ${summary.total}`,
      `- Baris CSV: ${body.length}`,
      `- ID respons demo hadir di CSV: ${createdInCsv ? 'ya' : 'tidak'}`,
      `- Nilai \`survey_version\` di CSV: ${[...versions].join(', ')}`,
      `- Frekuensi AD01 cocok dengan ringkasan: ${matches ? 'ya' : 'tidak'}`,
      `- CSV memakai BOM UTF-8: ${report.reconciliation.csv_bom ? 'ya' : 'tidak'}`,
      '',
      '## Batas',
      '',
      ...report.limitations.map((item) => `- ${item}`),
      '',
      `Bukti terstruktur: \`${EVIDENCE_JSON}\`.`,
      '',
    ].join('\n'),
    'utf8',
  );

  console.log(JSON.stringify(report, null, 2));
  console.log(`\nBukti ditulis ke ${EVIDENCE_JSON} dan ${EVIDENCE_MD}`);
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
