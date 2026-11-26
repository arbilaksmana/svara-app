import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { after, before, test } from 'node:test';
import { Client } from 'pg';
import { closeTestDatabase, databaseUrl } from './test-db.ts';
import { app } from '../app.ts';
import { migrate, resetSchema } from '../migrate.ts';

process.env.NODE_ENV = 'test';

const MIGRATION_019 = '019_close_superseded_published_versions.sql';
const MIGRATION_020 = '020_guardian_evidence_moderation.sql';
const MIGRATION_021 = '021_access_grant_provenance.sql';
const MIGRATION_022 = '022_drop_plaintext_link_tokens.sql';
const MIGRATION_023 = '023_integration_token_expiry.sql';
const MIGRATION_024 = '024_survey_consent_requirement.sql';

let server: Server;
let origin: string;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server) {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    server.close((error) => (error ? reject(error) : resolve()));
    await promise;
  }
  await closeTestDatabase();
});

async function request(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${origin}/api/v1${path}`, {
    method,
    headers: { 'X-Svara-Client': 'web', 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as { code?: string; error?: string; data?: unknown };
  return { status: response.status, json, headers: response.headers };
}

async function sql<T extends Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return (await client.query<T>(text, params)).rows;
  } finally {
    await client.end();
  }
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

interface PublicIntro {
  state: string;
  canSubmit: boolean;
  consent_version: string;
  version: { number: number };
}

/**
 * Deployment main (95eafa3) pada skema 009. Publish main tidak menutup versi terbit sebelumnya, close main
 * hanya menutup versi terbit pertama (urut number) beserta tautannya, dan PUT setelah publish membuat draf
 * baru sebagai current_version_id. Nama, token, dan teks sengaja tidak sama dengan seed demo.
 */
const ORG = 'org_7c1e4b9a20d35f86';
const TOKENS = {
  layananV1: 'pl_layananV1XXXXXXX',
  layananV2: 'pl_layananV2XXXXXXX',
  mandiriV1: 'pl_mandiriV1XXXXXXX',
  mandiriV2: 'pl_mandiriV2XXXXXXX',
  mandiriV3: 'pl_mandiriV3XXXXXXX',
  tunggal: 'pl_tunggalXXXXXXXXX',
  ditutupV1: 'pl_ditutupV1XXXXXXX',
  ditutupV2: 'pl_ditutupV2XXXXXXX',
  ditutupV3: 'pl_ditutupV3XXXXXXX',
};
const INVITATION_TOKEN = 'mainInvitationYYYYYYYYYY';

interface VersionSpec {
  number: number;
  status: 'published' | 'closed' | 'draft';
  published_at: string | null;
  closed_at: string | null;
  questions: Array<{ code: string; type: 'likert' | 'short_text'; label: string }>;
  link?: { token: string; status: 'active' | 'closed'; expires_at: string | null };
}

interface SurveySpec {
  id: string;
  owner: string;
  organization: string | null;
  title: string;
  status: 'published' | 'closed';
  notice_version: string;
  versions: VersionSpec[];
  current: number;
}

const likert = (label: string) => ({ code: 'Q1', type: 'likert' as const, label });

const SURVEYS: SurveySpec[] = [
  {
    // Diterbitkan dua kali di main: v1 dan v2 sama-sama terbit, satu respons sudah masuk ke v1.
    id: 's_4f2a9c1e7b3d6058',
    owner: 'u_peneliti',
    organization: ORG,
    title: 'Survei layanan konseling',
    status: 'published',
    notice_version: '1.0',
    current: 2,
    versions: [
      {
        number: 1, status: 'published', published_at: '2026-10-03T02:00:00.000Z', closed_at: null,
        questions: [likert('Jadwal konseling mudah didapat')],
        link: { token: TOKENS.layananV1, status: 'active', expires_at: null },
      },
      {
        number: 2, status: 'published', published_at: '2026-10-20T02:00:00.000Z', closed_at: null,
        questions: [likert('Jadwal konseling mudah didapat'), { code: 'Q2', type: 'short_text', label: 'Saran untuk konselor' }],
        link: { token: TOKENS.layananV2, status: 'active', expires_at: null },
      },
    ],
  },
  {
    // Survei platform yang diterbitkan tiga kali lalu diedit lagi: current_version_id menunjuk draf v4.
    // Tautan v1 sudah lewat expires_at tetapi barisnya masih 'active'.
    id: 's_9b0d3e6a1c4f7285',
    owner: 'u_mandiri',
    organization: null,
    title: 'Kebiasaan membaca warga',
    status: 'published',
    notice_version: '3.1',
    current: 4,
    versions: [
      {
        number: 1, status: 'published', published_at: '2026-09-05T01:00:00.000Z', closed_at: null,
        questions: [likert('Saya membaca buku setiap pekan')],
        link: { token: TOKENS.mandiriV1, status: 'active', expires_at: '2026-10-15T00:00:00.000Z' },
      },
      {
        number: 2, status: 'published', published_at: '2026-09-20T01:00:00.000Z', closed_at: null,
        questions: [likert('Saya membaca buku atau artikel setiap pekan')],
        link: { token: TOKENS.mandiriV2, status: 'active', expires_at: null },
      },
      {
        number: 3, status: 'published', published_at: '2026-10-01T01:00:00.000Z', closed_at: null,
        questions: [likert('Saya membaca bacaan panjang setiap pekan')],
        link: { token: TOKENS.mandiriV3, status: 'active', expires_at: null },
      },
      { number: 4, status: 'draft', published_at: null, closed_at: null, questions: [likert('Draf yang belum terbit')] },
    ],
  },
  {
    // Hanya satu versi terbit: tidak boleh tersentuh.
    id: 's_2e8f5a0b9d1c3647',
    owner: 'u_peneliti',
    organization: ORG,
    title: 'Evaluasi pelatihan relawan',
    status: 'published',
    notice_version: '1.0',
    current: 1,
    versions: [
      {
        number: 1, status: 'published', published_at: '2026-10-11T05:00:00.000Z', closed_at: null,
        questions: [likert('Materi pelatihan relevan')],
        link: { token: TOKENS.tunggal, status: 'active', expires_at: null },
      },
    ],
  },
  {
    // Close main menutup v1 saja (versi terbit pertama) dan status survei menjadi 'closed'; v2 dan v3 tetap terbit.
    id: 's_6d1b8e3f0a5c2794',
    owner: 'u_peneliti',
    organization: ORG,
    title: 'Pendataan peminjaman ruang',
    status: 'closed',
    notice_version: '1.0',
    current: 3,
    versions: [
      {
        number: 1, status: 'closed', published_at: '2026-09-01T03:00:00.000Z', closed_at: '2026-10-25T03:00:00.000Z',
        questions: [likert('Ruang tersedia saat dibutuhkan')],
        link: { token: TOKENS.ditutupV1, status: 'closed', expires_at: null },
      },
      {
        number: 2, status: 'published', published_at: '2026-09-15T03:00:00.000Z', closed_at: null,
        questions: [likert('Ruang tersedia saat diperlukan')],
        link: { token: TOKENS.ditutupV2, status: 'active', expires_at: null },
      },
      {
        number: 3, status: 'published', published_at: '2026-10-02T03:00:00.000Z', closed_at: null,
        questions: [likert('Ruang tersedia sesuai jadwal')],
        link: { token: TOKENS.ditutupV3, status: 'active', expires_at: null },
      },
    ],
  },
];

const [LAYANAN, MANDIRI, TUNGGAL, DITUTUP] = SURVEYS as [SurveySpec, SurveySpec, SurveySpec, SurveySpec];
const versionId = (survey: SurveySpec, number: number) => `v_${survey.id}_${number}`;

async function seedMainDeployment(): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO platform_profile (id, organization_name, organization_type, policy_url, terms_url, retention_days,
         data_request_contact, cross_border_transfer, notice_version, updated_at)
       VALUES ('platform', 'Svara Riset', 'platform', '/privacy', '/terms', NULL, 'privasi@svara-riset.id', 0, '3.1',
               '2026-09-01T00:00:00.000Z')`,
    );
    await client.query(`
      INSERT INTO profiles (id, organization_name, organization_type, respondent_age_category, consent_mode,
        policy_url, terms_url, retention_days, data_request_contact, cross_border_transfer, notice_version, synthetic_placeholder)
      VALUES ('p_kampus', 'Universitas Tepian Danau', 'organization', 'adult', 'self', '/privacy', '/terms', 180,
              'privasi@tepian.ac.id', 0, '1.0', 0);
      INSERT INTO notices (id, profile_id, version, effective_date, purpose, data_categories, module15_usage,
        retention_text, recipients, contact, rights, child_data_text, cross_border_text, synthetic_placeholder)
      VALUES ('n_kampus_10', 'p_kampus', '1.0', '2026-08-01', 'Tujuan Tepian 1.0', 'Kategori Tepian 1.0', 'Modul 15 Tepian 1.0',
              'Retensi Tepian 1.0', 'Penerima Tepian 1.0', 'privasi@tepian.ac.id', 'Hak Tepian 1.0',
              'Responden dewasa dengan persetujuan diri.', 'Tidak ada transfer lintas negara.', 0);
    `);
    await client.query(
      `INSERT INTO organizations (id, name, organization_type, policy_url, terms_url, retention_days, data_request_contact,
         cross_border_transfer, notice_version, created_at)
       VALUES ($1, 'Lembaga Riset Tepian', 'organization', '/kebijakan-privasi', '/ketentuan-layanan', NULL, NULL, NULL, '1.0',
               '2026-09-02T02:00:00.000Z')`,
      [ORG],
    );
    await client.query(
      `INSERT INTO accounts (id, email, display_name, role, status, password_hash, created_at, organization_id)
       VALUES ('u_peneliti', 'peneliti@tepian.example.org', 'Peneliti Tepian', 'creator', 'active', 'scrypt$x$y',
               '2026-09-02T03:00:00.000Z', $1),
              ('u_mandiri', 'pembaca@example.org', 'Kreator Mandiri', 'creator', 'active', 'scrypt$x$y',
               '2026-09-03T03:00:00.000Z', NULL)`,
      [ORG],
    );
    for (const survey of SURVEYS) {
      await client.query(
        `INSERT INTO surveys (id, owner_id, profile_id, title, purpose, object_label, instructions, status, created_at,
           updated_at, current_version_id, organization_id)
         VALUES ($1, $2, 'p_kampus', $3, 'Tujuan survei', 'Peserta', '', $4, '2026-09-01T00:00:00.000Z',
                 '2026-10-25T00:00:00.000Z', NULL, $5)`,
        [survey.id, survey.owner, survey.title, survey.status, survey.organization],
      );
      await client.query('INSERT INTO survey_settings (survey_id, allow_results, allow_individual) VALUES ($1, 1, 0)', [survey.id]);
      for (const version of survey.versions) {
        const id = versionId(survey, version.number);
        await client.query(
          `INSERT INTO survey_versions (id, survey_id, number, status, notice_version, published_at, closed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, survey.id, version.number, version.status, survey.notice_version, version.published_at, version.closed_at],
        );
        for (const [index, question] of version.questions.entries()) {
          const questionId = `q_${id}_${question.code}`;
          await client.query(
            `INSERT INTO questions (id, version_id, code, ord, type, required, section, label, hint, group_code, dimension_code, direction)
             VALUES ($1, $2, $3, $4, $5, 1, 'Bagian 1', $6, NULL, NULL, NULL, NULL)`,
            [questionId, id, question.code, index + 1, question.type, question.label],
          );
          if (question.type === 'likert') {
            await client.query(
              `INSERT INTO question_options (id, question_id, ord, label, value)
               VALUES ($1, $3, 1, 'Tidak setuju', 1), ($2, $3, 2, 'Setuju', 2)`,
              [`${questionId}_1`, `${questionId}_2`, questionId],
            );
          }
        }
        if (version.link) {
          await client.query(
            // Penyiapan main (export helper, bukan uji upgrade) berjalan sebelum 022, jadi kolom `token`
            // mentah yang masih ada di skema tujuannya ikut diisi.
            `INSERT INTO public_links (id, survey_id, version_id, token, token_hash, label, status, expires_at, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [`pl_${id}`, survey.id, id, version.link.token, hash(version.link.token), `Tautan umum · ${survey.title}`,
              version.link.status, version.link.expires_at, version.published_at],
          );
        }
      }
      await client.query('UPDATE surveys SET current_version_id = $1 WHERE id = $2', [versionId(survey, survey.current), survey.id]);
    }

    // Respons lama lewat tautan v1 survei layanan (jalur kirim main) dan undangan individual pada v1.
    const v1 = versionId(LAYANAN, 1);
    await client.query(`
      INSERT INTO respondents (id, source, external_ref, created_at) VALUES ('rsp_8a3f1c', 'public_link', NULL, '2026-10-10T03:00:00.000Z');
      INSERT INTO responses (id, survey_id, version_id, assignment_id, respondent_id, collection_mode, identity_source, submitted_at, idempotency_key)
      VALUES ('r_5c9e2a', '${LAYANAN.id}', '${v1}', NULL, 'rsp_8a3f1c', 'standalone', 'local', '2026-10-10T03:00:00.000Z', 'idem-lama-7f3a91c2');
      INSERT INTO answers (id, response_id, question_id, question_code, option_id, value, text, skipped)
      VALUES ('ans_5c9e2a_q1', 'r_5c9e2a', 'q_${v1}_Q1', 'Q1', 'q_${v1}_Q1_2', 2, NULL, 0);
      INSERT INTO consent_records (id, survey_id, version_id, notice_version, basis, status, recorded_at, respondent_click,
        guardian_evidence_status, guardian_evidence_ref, invitation_id, response_id)
      VALUES ('c_5c9e2a', '${LAYANAN.id}', '${v1}', '1.0', 'Persetujuan diri', 'granted', '2026-10-10T02:58:00.000Z', 1,
              'not_required', NULL, NULL, 'r_5c9e2a');
      INSERT INTO submission_attempts (id, scope, idempotency_key, payload_hash, response_id, created_at)
      VALUES ('sa_5c9e2a', 'public:pl_${v1}', 'idem-lama-7f3a91c2', 'hash-lama', 'r_5c9e2a', '2026-10-10T03:00:00.000Z');
      INSERT INTO assignments (id, survey_id, version_id, label, participant_ref)
      VALUES ('as_3d7b0e', '${LAYANAN.id}', '${v1}', 'Peserta 014', 'P-014');
    `);
    await client.query(
      `INSERT INTO invitations (id, assignment_id, survey_id, version_id, code, token, token_hash, status, expires_at,
         used_at, revoked_at, created_at)
       VALUES ('inv_3d7b0e', 'as_3d7b0e', $1, $2, 'UND-7QK2MX', $3, $4, 'active', '2030-01-01T00:00:00.000Z', NULL, NULL,
               '2026-10-05T03:00:00.000Z')`,
      [LAYANAN.id, v1, INVITATION_TOKEN, hash(INVITATION_TOKEN)],
    );
  } finally {
    await client.end();
  }
}

/** Data historis yang tidak boleh diubah migrasi: respons, persetujuan, undangan, dan isi instrumen tiap versi. */
async function historical() {
  return {
    responses: await sql('SELECT * FROM responses ORDER BY id'),
    answers: await sql('SELECT * FROM answers ORDER BY id'),
    // 020 menambah kolom bukti wali; yang harus utuh adalah kolom historis yang sudah ada di 018.
    consents: await sql(
      `SELECT id, survey_id, version_id, notice_version, basis, status, recorded_at, respondent_click,
              guardian_evidence_status, guardian_evidence_ref, invitation_id, public_link_id,
              respondent_session_hash, response_id
         FROM consent_records ORDER BY id`,
    ),
    respondents: await sql('SELECT * FROM respondents ORDER BY id'),
    attempts: await sql('SELECT * FROM submission_attempts ORDER BY id'),
    assignments: await sql('SELECT * FROM assignments ORDER BY id'),
    // SEC-10: kolom `token` mentah dihapus 022; sisanya harus utuh.
    invitations: await sql(
      `SELECT id, assignment_id, survey_id, version_id, code, status, expires_at, used_at, revoked_at, created_at
         FROM invitations ORDER BY id`,
    ),
    questions: await sql('SELECT * FROM questions ORDER BY id'),
    options: await sql('SELECT * FROM question_options ORDER BY id'),
    // 024 menambah `consent_required` (default 'tidak'); yang dibandingkan adalah kolom yang sudah ada di 018.
    surveys: await sql(
      `SELECT id, owner_id, profile_id, organization_id, title, purpose, object_label, instructions, status,
              created_at, updated_at, current_version_id
         FROM surveys ORDER BY id`,
    ),
  };
}

interface LifecycleLink extends Record<string, unknown> {
  id: string;
  survey_id: string;
  version_id: string;
  label: string;
  status: string;
  expires_at: string | null;
  created_at: string;
  closed_reason: string | null;
}

/**
 * SEC-10: kolom `token` mentah dihapus migrasi 022, jadi baris tautan dibandingkan pada kolom yang
 * memang harus tetap utuh setelah migrasi.
 */
async function lifecycle(): Promise<{ versions: Array<Record<string, unknown>>; links: LifecycleLink[] }> {
  return {
    versions: await sql('SELECT * FROM survey_versions ORDER BY id'),
    links: await sql<LifecycleLink>(
      `SELECT id, survey_id, version_id, label, status, expires_at, created_at, closed_reason
         FROM public_links ORDER BY id`,
    ),
  };
}

async function versionStatuses(survey: SurveySpec) {
  return (await sql<{ number: number; status: string }>(
    'SELECT number, status FROM survey_versions WHERE survey_id = $1 ORDER BY number',
    [survey.id],
  )).map(({ number, status }) => `v${number}:${status}`);
}

async function linkState(survey: SurveySpec, number: number) {
  const [row] = await sql<{ status: string; closed_reason: string | null }>(
    'SELECT status, closed_reason FROM public_links WHERE version_id = $1',
    [versionId(survey, number)],
  );
  return row;
}

async function intro(token: string): Promise<PublicIntro> {
  const response = await request(`/public/surveys/${token}`);
  assert.equal(response.status, 200, `GET /public/surveys/${token}: ${JSON.stringify(response.json)}`);
  return response.json.data as PublicIntro;
}

let migrationStartedAt = '';
let historicalBefore: Awaited<ReturnType<typeof historical>>;
let tunggalBefore: Awaited<ReturnType<typeof lifecycle>>;

test('upgrade main → 019: tautan v1 survei yang terbit dua kali menyajikan v2 dan kiriman baru tersimpan di v2', async () => {
  await resetSchema();
  await migrate({ to: '009' });
  await seedMainDeployment();
  await migrate({ to: '018' });
  historicalBefore = await historical();
  tunggalBefore = {
    versions: (await lifecycle()).versions.filter((row) => row.survey_id === TUNGGAL.id),
    links: (await lifecycle()).links.filter((row) => row.survey_id === TUNGGAL.id),
  };
  migrationStartedAt = new Date().toISOString();
  await migrate();

  const opened = await intro(TOKENS.layananV1);
  assert.equal(opened.version.number, 2, 'tautan v1 menyajikan versi terbit terbaru (v2)');
  assert.equal(opened.state, 'active');

  const consent = await request(`/public/surveys/${TOKENS.layananV1}/consent`, 'POST', {
    version_id: opened.consent_version,
    respondent_click: true,
    eligibility: true,
  });
  assert.equal(consent.status, 201, `consent lewat tautan v1: ${JSON.stringify(consent.json)}`);
  const session = consent.headers.get('set-cookie')!.split(';')[0]!;
  const consentId = (consent.json.data as { consent_id: string }).consent_id;
  const form = await request(`/public/surveys/${TOKENS.layananV1}/form?consent_id=${consentId}`, 'GET', undefined, { Cookie: session });
  assert.equal(form.status, 200, JSON.stringify(form.json));
  const questions = (form.json.data as { questions: Array<{ code: string; label: string }> }).questions;
  assert.deepEqual(questions.map(({ code }) => code), ['Q1', 'Q2'], 'formulir memuat pertanyaan v2');

  const submitted = await request(`/public/surveys/${TOKENS.layananV1}/responses`, 'POST', {
    consent_id: consentId,
    answers: [{ question_code: 'Q1', text: '2' }, { question_code: 'Q2', text: 'Ruang tunggu lebih tenang' }],
  }, { Cookie: session, 'Idempotency-Key': 'upgrade-019-layanan-v1' });
  assert.equal(submitted.status, 201, `kiriman lewat tautan v1: ${JSON.stringify(submitted.json)}`);
  assert.equal((submitted.json.data as { version_number: number }).version_number, 2);
  const stored = await sql<{ version_id: string }>('SELECT version_id FROM responses WHERE id = $1', [
    (submitted.json.data as { response_id: string }).response_id,
  ]);
  assert.deepEqual(stored, [{ version_id: versionId(LAYANAN, 2) }], 'respons baru tersimpan pada v2');

  const legacy = await sql('SELECT * FROM responses WHERE version_id = $1 ORDER BY id', [versionId(LAYANAN, 1)]);
  assert.deepEqual(legacy, historicalBefore.responses.filter((row) => row.version_id === versionId(LAYANAN, 1)), 'respons lama v1 tetap ada');

  assert.deepEqual(await versionStatuses(LAYANAN), ['v1:closed', 'v2:published']);
  assert.deepEqual(await linkState(LAYANAN, 1), { status: 'closed', closed_reason: 'superseded' });
  assert.deepEqual(await linkState(LAYANAN, 2), { status: 'active', closed_reason: null });
  const [closedV1] = await sql<{ closed_at: string }>('SELECT closed_at FROM survey_versions WHERE id = $1', [versionId(LAYANAN, 1)]);
  assert.ok(closedV1!.closed_at >= migrationStartedAt && closedV1!.closed_at <= new Date().toISOString(),
    `closed_at diisi waktu migrasi: ${closedV1!.closed_at}`);
  assert.match(closedV1!.closed_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'format sama dengan nowIso()');
});

test('019 mengikuti aturan publish untuk survei lain: tiga versi terbit, tautan kedaluwarsa, survei ditutup main, survei tunggal', async () => {
  assert.deepEqual(await versionStatuses(MANDIRI), ['v1:closed', 'v2:closed', 'v3:published', 'v4:draft']);
  // Publish tidak menyentuh tautan yang sudah lewat expires_at; responden tetap melihat 'expired'.
  assert.deepEqual(await linkState(MANDIRI, 1), { status: 'active', closed_reason: null });
  assert.equal((await intro(TOKENS.mandiriV1)).state, 'expired');
  assert.deepEqual(await linkState(MANDIRI, 2), { status: 'closed', closed_reason: 'superseded' });
  const mandiriV2 = await intro(TOKENS.mandiriV2);
  assert.deepEqual([mandiriV2.state, mandiriV2.version.number], ['active', 3], 'v2 menyajikan v3, bukan draf v4');
  assert.deepEqual([(await intro(TOKENS.mandiriV3)).state, (await intro(TOKENS.mandiriV3)).version.number], ['active', 3]);

  // Status survei tidak diubah: survei yang ditutup main tetap tertutup, versi terbit terakhirnya tetap tercatat.
  assert.deepEqual(await versionStatuses(DITUTUP), ['v1:closed', 'v2:closed', 'v3:published']);
  assert.equal((await sql<{ status: string }>('SELECT status FROM surveys WHERE id = $1', [DITUTUP.id]))[0]!.status, 'closed');
  assert.deepEqual(await linkState(DITUTUP, 1), { status: 'closed', closed_reason: null });
  assert.deepEqual(await linkState(DITUTUP, 2), { status: 'closed', closed_reason: 'superseded' });
  assert.deepEqual(await linkState(DITUTUP, 3), { status: 'active', closed_reason: null });
  for (const token of [TOKENS.ditutupV1, TOKENS.ditutupV2, TOKENS.ditutupV3]) {
    const state = await intro(token);
    assert.deepEqual([state.state, state.canSubmit], ['closed', false], token);
  }
  const [ditutupV1] = await sql<{ closed_at: string }>('SELECT closed_at FROM survey_versions WHERE id = $1', [versionId(DITUTUP, 1)]);
  assert.equal(ditutupV1!.closed_at, '2026-10-25T03:00:00.000Z', 'closed_at versi yang sudah ditutup tidak ditimpa');

  const tunggal = await lifecycle();
  assert.deepEqual(
    { versions: tunggal.versions.filter((row) => row.survey_id === TUNGGAL.id), links: tunggal.links.filter((row) => row.survey_id === TUNGGAL.id) },
    tunggalBefore,
    'survei dengan satu versi terbit tidak tersentuh',
  );
  assert.deepEqual([(await intro(TOKENS.tunggal)).state, (await intro(TOKENS.tunggal)).version.number], ['active', 1]);

  // Undangan individual v1 mengikuti publish: barisnya tetap (diasersi di bawah), tetapi sejak KP-04/NR-05
  // formulir publik menyajikan versi terbit terbaru; persetujuan v1 tidak lagi berlaku (SEC-02).
  const invitation = await intro(INVITATION_TOKEN);
  assert.deepEqual([invitation.state, invitation.canSubmit, invitation.version.number], ['active', true, 2]);
  const after = await historical();
  assert.deepEqual(after.invitations, historicalBefore.invitations, 'undangan tidak diubah');
  assert.deepEqual(after.surveys, historicalBefore.surveys, 'baris survei tidak diubah');
  for (const key of ['consents', 'responses', 'answers', 'respondents', 'attempts'] as const) {
    const before = historicalBefore[key].map((row) => JSON.stringify(row));
    assert.deepEqual(after[key].filter((row) => before.includes(JSON.stringify(row))).length, before.length, `${key} lama tetap utuh`);
  }
  for (const key of ['assignments', 'questions', 'options'] as const) {
    assert.deepEqual(after[key], historicalBefore[key], `${key} tidak diubah`);
  }
});

test('019 idempoten: dijalankan ulang tidak mengubah apa pun lagi', async () => {
  const before = { ...(await lifecycle()), ...(await historical()) };
  assert.deepEqual(await migrate(), [], 'migrasi kedua tidak menerapkan ulang 019');
  await sql('DELETE FROM schema_migrations WHERE version = $1', [MIGRATION_019]);
  assert.deepEqual(await migrate(), [MIGRATION_019], 'menerapkan ulang 019');
  assert.deepEqual({ ...(await lifecycle()), ...(await historical()) }, before);
});

test('B1: 019 tidak gagal karena expires_at tak terurai pada tautan aktif', async () => {
  await resetSchema();
  await migrate({ to: '009' });
  await seedMainDeployment();
  await migrate({ to: '018' });
  // Data yang pernah diedit manual: tautan survei lain dan tautan versi yang akan ditutup memuat tanggal tak terurai.
  await sql('UPDATE public_links SET expires_at = $1 WHERE token_hash = $2', ['bukan-tanggal', hash(TOKENS.tunggal)]);
  await sql('UPDATE public_links SET expires_at = $1 WHERE token_hash = $2', ['', hash(TOKENS.layananV1)]);
  assert.deepEqual(
    await migrate(),
    [MIGRATION_019, MIGRATION_020, MIGRATION_021, MIGRATION_022, MIGRATION_023, MIGRATION_024],
    'migrasi 019-024 tetap berjalan',
  );
  assert.deepEqual(await linkState(TUNGGAL, 1), { status: 'active', closed_reason: null }, 'tautan survei tunggal tidak tersentuh');
  // Tanggal tak terurai diperlakukan seperti resolver publik: belum kedaluwarsa, jadi ikut ditutup sebagai superseded.
  assert.deepEqual(await linkState(LAYANAN, 1), { status: 'closed', closed_reason: 'superseded' });
});
