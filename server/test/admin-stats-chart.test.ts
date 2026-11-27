import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { after, before, test } from 'node:test';
import { closeTestDatabase, resetTestDatabase } from './test-db.ts';
import { recordQueries } from './query-log.ts';

// Impor dinamis: test-db.ts wajib menetapkan DATABASE_URL sebelum app/db dimuat (batas pemuatan modul tes).
const { app } = await import('../app.ts');
const { run } = await import('../db.ts');
const { seedDemoIfEmpty } = await import('../seed-data.ts');

/*
 * Batas WIB vs UTC: WIB = UTC+7 tanpa DST. Respons pukul 00:00 WIB tersimpan sebagai
 * 17:00 UTC hari sebelumnya; bucket tetap harus jatuh pada hari WIB-nya, bukan hari UTC.
 */
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Waktu dinding WIB `HH:mm` pada `daysAgo` hari lalu, sebagai `Date` UTC nyata. */
function wibDaysAgo(daysAgo: number, hour: number, minute: number): Date {
  const wib = new Date(Date.now() + WIB_OFFSET_MS);
  return new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate() - daysAgo, hour, minute) - WIB_OFFSET_MS);
}

/** Waktu dinding WIB `HH:mm` pada `day` bulan `monthsAgo` bulan lalu (day=1 untuk awal bulan). */
function wibMonthsAgo(monthsAgo: number, day: number, hour: number, minute: number): Date {
  const wib = new Date(Date.now() + WIB_OFFSET_MS);
  return new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth() - monthsAgo, day, hour, minute) - WIB_OFFSET_MS);
}

const submitted: Date[] = [
  wibDaysAgo(0, 0, 0),
  wibDaysAgo(0, 1, 15),
  wibDaysAgo(0, 23, 30),
  wibDaysAgo(1, 23, 30),
  wibDaysAgo(6, 12, 0),
  wibDaysAgo(7, 12, 0),
  wibDaysAgo(29, 12, 0),
  wibDaysAgo(30, 12, 0),
  wibMonthsAgo(0, 1, 0, 0),
  wibMonthsAgo(1, 15, 23, 30),
  wibMonthsAgo(5, 1, 0, 0),
  wibMonthsAgo(6, 28, 23, 30),
];

/** Kunci bucket WIB dari `Date` untuk rentang tertentu — acuan independen dari SQL. */
function pointFor(range: string, date: Date): string {
  const wib = new Date(date.getTime() + WIB_OFFSET_MS).toISOString();
  if (range === 'today') return `${wib.slice(0, 10)}T${wib.slice(11, 13)}`;
  if (range === '6m') return wib.slice(0, 7);
  return wib.slice(0, 10);
}

/** Deret bucket penuh rentang, dihitung dari jam WIB saat tes berjalan. */
function bucketKeys(range: string): string[] {
  const wib = new Date(Date.now() + WIB_OFFSET_MS);
  if (range === 'today') {
    const day = wib.toISOString().slice(0, 10);
    return Array.from({ length: 24 }, (_, hour) => `${day}T${String(hour).padStart(2, '0')}`);
  }
  if (range === '6m') {
    return Array.from({ length: 6 }, (_, index) => {
      const date = new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth() - (5 - index), 1));
      return date.toISOString().slice(0, 7);
    });
  }
  const days = range === '7d' ? 7 : 30;
  return Array.from({ length: days }, (_, index) =>
    new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate() - (days - 1 - index))).toISOString().slice(0, 10),
  );
}

function expectedChart(range: string): Array<{ point: string; responses: number }> {
  const counts = new Map(bucketKeys(range).map((point) => [point, 0]));
  for (const date of submitted) {
    const point = pointFor(range, date);
    if (counts.has(point)) counts.set(point, (counts.get(point) ?? 0) + 1);
  }
  return [...counts].map(([point, responses]) => ({ point, responses }));
}

let server: Server | undefined;
let base = '';
let adminCookie = '';

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.SEED_DEMO = '1';
  await resetTestDatabase();
  await seedDemoIfEmpty();
  // Kosongkan respons seed agar hitungan bucket hanya berasal dari batas WIB yang diuji.
  // Jawaban dan percobaan kirim ikut terhapus lewat ON DELETE CASCADE.
  await run('DELETE FROM responses');
  for (const [index, date] of submitted.entries()) {
    await run(
      "INSERT INTO respondents (id, source, external_ref, created_at) VALUES (?, 'public_link', NULL, ?)",
      `p_chart_${index}`,
      date.toISOString(),
    );
    await run(
      `INSERT INTO responses (id, survey_id, version_id, assignment_id, respondent_id, collection_mode, identity_source, submitted_at, idempotency_key)
       VALUES (?, 's_demo1', 'v_demo1_1', NULL, ?, 'standalone', 'local', ?, ?)`,
      `r_chart_${index}`,
      `p_chart_${index}`,
      date.toISOString(),
      `chart-key-${index}`,
    );
  }

  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}/api/v1`;
  const login = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Svara-Client': 'web' },
    body: JSON.stringify({ email: 'admin@svara.local', password: 'SvaraDemo123!' }),
  });
  assert.equal(login.status, 200, await login.clone().text());
  adminCookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!;
});

after(async () => {
  if (server) {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    server.close((error) => (error ? reject(error) : resolve()));
    await promise;
  }
  await closeTestDatabase();
});

async function stats(range?: string): Promise<Response> {
  return fetch(`${base}/admin/stats${range === undefined ? '' : `?range=${range}`}`, {
    headers: { Cookie: adminCookie, 'X-Svara-Client': 'web' },
  });
}

interface StatsChartPayload {
  data: { chart: Array<{ point: string; responses: number }> };
}

/** Batas JSON server: assert bentuk minimum setelah parse, lalu kembalikan deret bertipe. */
async function chartFor(range?: string): Promise<Array<{ point: string; responses: number }>> {
  const response = await stats(range);
  assert.equal(response.status, 200);
  const payload = (await response.json()) as StatsChartPayload;
  assert.ok(Array.isArray(payload.data?.chart), 'payload chart wajib berupa array');
  return payload.data.chart;
}

test('range tak dikenal ditolak 400 dan default 30d', async () => {
  const invalid = await stats('1y');
  assert.equal(invalid.status, 400);
  const body = (await invalid.json()) as { code?: string; error?: string };
  assert.equal(body.code, 'validation_error');
  assert.match(body.error ?? '', /range/);

  const missingChart = await chartFor();
  assert.equal(missingChart.length, 30);
  assert.deepEqual(await chartFor('30d'), missingChart);
});

test('chart: 24 bucket per jam WIB hari ini, termasuk respons yang jatuh di tanggal UTC sebelumnya', async () => {
  const chart = await chartFor('today');
  const expected = expectedChart('today');

  assert.equal(chart.length, 24);
  assert.equal(chart[0]!.point, bucketKeys('today')[0]);
  assert.equal(chart[23]!.point, bucketKeys('today')[23]);
  assert.deepEqual(chart, expected);
  // Hanya jam 00, 01, dan 23 yang berisi (jam 00 bisa berisi dua saat tanggal 1);
  // bucket kosong wajib nol, bukan hilang.
  assert.ok(chart[0]!.responses >= 1);
  assert.equal(chart[1]!.responses, 1);
  assert.equal(chart[23]!.responses, 1);
  assert.deepEqual(chart.slice(2, 23).map((row) => row.responses), Array(21).fill(0));
});

test('chart: 7 bucket harian tanpa hari di luar jendela dan tanpa bucket kosong yang hilang', async () => {
  const chart = await chartFor('7d');
  const expected = expectedChart('7d');

  assert.equal(chart.length, 7);
  assert.equal(chart[0]!.point, bucketKeys('7d')[0]);
  assert.equal(chart[6]!.point, bucketKeys('7d')[6]);
  assert.deepEqual(chart, expected);
  assert.ok(chart.some((row) => row.responses === 0), 'hari tanpa respons tetap hadir bernilai 0');
  // Hari ke-7 sebelum hari ini berada di luar jendela, sehingga tidak menambah total.
  assert.equal(
    chart.reduce((sum, row) => sum + row.responses, 0),
    submitted.filter((date) => bucketKeys('7d').includes(pointFor('7d', date))).length,
  );
});

test('chart: 30 bucket harian menjumlahkan semua respons dalam jendela', async () => {
  const chart = await chartFor('30d');
  const expected = expectedChart('30d');

  assert.equal(chart.length, 30);
  assert.equal(chart[0]!.point, bucketKeys('30d')[0]);
  assert.equal(chart[29]!.point, bucketKeys('30d')[29]);
  assert.deepEqual(chart, expected);
  assert.ok(chart.some((row) => row.responses === 0));
});

test('chart: 6 bucket bulanan memakai batas bulan WIB, bukan bulan UTC', async () => {
  const chart = await chartFor('6m');
  const expected = expectedChart('6m');

  assert.equal(chart.length, 6);
  assert.equal(chart[0]!.point, bucketKeys('6m')[0]);
  assert.equal(chart[5]!.point, bucketKeys('6m')[5]);
  assert.deepEqual(chart, expected);
  // Awal bulan berjalan pukul 00:00 WIB = 17:00 UTC bulan sebelumnya dan tetap masuk bucket bulan WIB.
  assert.ok(chart[5]!.responses >= 1);
  assert.ok(chart.some((row) => row.responses === 0));
});

test('chart: satu query agregat per rentang', async () => {
  for (const range of ['today', '7d', '30d', '6m']) {
    const { result, queries } = await recordQueries(() => stats(range));
    assert.equal(result.status, 200);
    const chartQueries = queries.filter((query) => /generate_series/i.test(query.sql) && /\bFROM responses\b/i.test(query.sql));
    assert.equal(chartQueries.length, 1, `rentang ${range} harus memakai satu query deret`);
  }
});