import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { after, before, test } from 'node:test';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime.js';
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime.js';
import { ToastProvider } from '../../src/components/Toast.tsx';
import { ContactChannel } from '../../src/components/ui.tsx';
import { PrivacyPage } from '../../src/screens/Public.tsx';
import { SettingsPage } from '../../src/screens/CreatorData.tsx';
import * as respondent from '../../src/screens/Respondent.tsx';
import * as store from '../../src/lib/store.ts';
import type { BootstrapData, PublicContextData } from '../../src/lib/api.ts';
import { app } from '../app.ts';
import { all, closePool, run } from '../db.ts';
import { resetTestDatabase } from './test-db.ts';
import { seedDemoIfEmpty } from '../seed-data.ts';
import { hashPassword } from '../security.ts';

process.env.NODE_ENV = 'test';
process.env.SEED_DEMO = '1';
process.env.SEED_PASSWORD = 'SvaraDemo123!';

const PASSWORD = 'SvaraDemo123!';
const unexpectedNavigation = () => {
  throw new Error('Render tidak boleh melakukan navigasi');
};
const router = {
  back: unexpectedNavigation, forward: unexpectedNavigation, refresh: unexpectedNavigation,
  hmrRefresh: unexpectedNavigation, push: unexpectedNavigation, replace: unexpectedNavigation,
  prefetch: unexpectedNavigation, bfcacheId: 'test',
};

function render(node: ReactNode, pathname = '/'): string {
  return renderToStaticMarkup(
    createElement(AppRouterContext.Provider, { value: router },
      createElement(PathnameContext.Provider, { value: pathname },
        createElement(SearchParamsContext.Provider, { value: new URLSearchParams() },
          createElement(ToastProvider, null, node)))),
  );
}

const visibleText = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

let server: Server;
let origin: string;

before(async () => {
  await resetTestDatabase();
  assert.equal(await seedDemoIfEmpty(), true, 'seed demo gelombang ini wajib berjalan');
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
  await closePool();
});

async function request(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${origin}/api/v1${path}`, {
    method,
    headers: { 'X-Svara-Client': 'web', 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as {
    code?: string;
    error?: string;
    details?: unknown;
    data?: unknown;
  };
  return { status: response.status, json, headers: response.headers };
}

async function login(email: string): Promise<string> {
  const response = await request('/auth/login', 'POST', { email, password: PASSWORD });
  assert.equal(response.status, 200, `login ${email}: ${JSON.stringify(response.json)}`);
  return response.headers.get('set-cookie')!.split(';')[0]!;
}

interface PublicIntroLike {
  version: { notice_version: string };
  notice: { version: string; purpose: string; contact: string; data_categories: string };
  profile: { id: string; data_request_contact: string | null };
}

async function publicIntro(token: string): Promise<PublicIntroLike> {
  const response = await request(`/public/surveys/${token}`);
  assert.equal(response.status, 200, `pengantar ${token}: ${JSON.stringify(response.json)}`);
  return response.json.data as PublicIntroLike;
}

/** Bootstrap lewat klien UI apa adanya; fetch relatif diarahkan ke server uji dengan cookie sesi. */
async function hydrateStore(cookie: string): Promise<BootstrapData> {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set('Cookie', cookie);
    return original(new URL(String(input), origin), { ...init, headers });
  }) as typeof fetch;
  try {
    await store.refreshBootstrap();
  } finally {
    globalThis.fetch = original;
  }
  const response = await request('/bootstrap', 'GET', undefined, { Cookie: cookie });
  assert.equal(response.status, 200);
  return response.json.data as BootstrapData;
}

/* ---------------- NR-04 ---------------- */

test('NR-04: bootstrap membawa notice dari sumber kebijakan survei, bukan baris notice profil legacy', async () => {
  const cookie = await login('creator.a@svara.local');
  const data = await hydrateStore(cookie);
  const profile = data.surveyProfiles.s_demo1;
  assert.ok(profile, 'profil kebijakan s_demo1 harus ada di payload');
  assert.equal(profile.id, 'org_smk');

  // Daftar `notices` legacy berkunci profil deployment; tidak satu pun memakai id profil kebijakan survei.
  assert.equal(data.notices.length > 0, true);
  assert.deepEqual(
    data.notices.filter((row) => row.profile_id === profile.id),
    [],
    'notice legacy tidak boleh dikunci dengan id organisasi',
  );

  const notice = data.surveyNotices?.s_demo1;
  assert.ok(notice, 'surveyNotices.s_demo1 harus terisi');
  assert.equal(notice.source, 'organization');
  // Versi notice = versi yang terpasang pada versi survei saat ini (v_demo1_2).
  assert.equal(notice.version, '1.1');
  assert.match(notice.data_categories, /Penyelenggara adalah sekolah/);

  // Sumber yang sama dengan halaman publik: katalog notice organisasi, dengan versi masing-masing
  // konteks (tautan publik memakai versi terbit 1.0, pengaturan creator memakai draf 1.1).
  const intro = await publicIntro('pl_demoTautanUmum1A');
  assert.equal(intro.notice.version, '1.0');
  assert.match(intro.notice.data_categories, /Penyelenggara adalah sekolah/);
  assert.equal(intro.notice.purpose, notice.purpose, 'teks dari katalog yang sama');
});

test('NR-04: halaman pengaturan creator menampilkan notice survei, bukan "belum tersedia"', async () => {
  const html = render(createElement(SettingsPage, { id: 's_demo1' }), '/creator/surveys/s_demo1/settings');
  const text = visibleText(html);
  assert.match(text, /Versi notice: 1\.1/, 'versi notice yang tampil harus versi sumber survei');
  assert.match(text, /Penyelenggara adalah sekolah/, 'teks notice organisasi harus tampil');
  assert.doesNotMatch(text, /Pemberitahuan untuk profil kebijakan survei ini belum tersedia/);
});

/* ---------------- UIX-08 ---------------- */

test('UIX-08: kanal kontak pengantar = data_request_contact organisasi, bukan salinan notice platform', async () => {
  await run("UPDATE organizations SET data_request_contact = 'dpo@smk-nusantara.test' WHERE id = 'org_smk'");
  await run("UPDATE platform_profile SET data_request_contact = 'privasi@svara.test' WHERE id = 'platform'");
  try {
    const intro = await publicIntro('pl_demoTautanUmum1A');
    assert.equal(intro.profile.data_request_contact, 'dpo@smk-nusantara.test');
    // Teks notice tetap menyalin alamat lama; kanal yang dipakai bukan teks itu.
    assert.equal(intro.notice.contact, 'privasi@organisasi.contoh');

    const ctx = (await request('/public/surveys/pl_demoTautanUmum1A')).json.data as PublicContextData;
    const html = render(
      createElement(respondent.IntroView, { token: 'pl_demoTautanUmum1A', ctx, attempt: 'none', onChoose: () => {}, reload: () => {} }),
      '/s/pl_demoTautanUmum1A',
    );
    const contactRow = /<dt[^>]*>Kontak<\/dt>[\s\S]*?<\/dd>/.exec(html)?.[0];
    assert.ok(contactRow, 'baris Kontak pada pemberitahuan harus dirender');
    assert.match(contactRow, /href="mailto:dpo@smk-nusantara\.test"/, 'kontak organisasi dirender sebagai mailto');
    assert.doesNotMatch(contactRow, /privasi@organisasi\.contoh/, 'alamat salinan notice tidak boleh dipakai');

    // Organisasi tanpa kontak memakai kanal platform, bukan alamat contoh yang dikarang klien.
    await run("UPDATE organizations SET data_request_contact = NULL WHERE id = 'org_smk'");
    const fallback = await publicIntro('pl_demoTautanUmum1A');
    assert.equal(fallback.profile.data_request_contact, 'privasi@svara.test');
  } finally {
    await run("UPDATE organizations SET data_request_contact = 'privasi@organisasi.contoh' WHERE id = 'org_smk'");
    await run("UPDATE platform_profile SET data_request_contact = 'privasi@organisasi.contoh' WHERE id = 'platform'");
  }
});

/* ---------------- BF-05 ---------------- */

const GOV_ORG = 'org_gov_notice';
const GOV_ADMIN = 'u_gov_admin';
const GOV_CREATOR = 'u_gov_creator';

/** Organisasi sendiri agar perubahan notice_version tidak menyentuh data seed demo. */
async function seedGovernanceOrg(): Promise<void> {
  const hash = await hashPassword(PASSWORD);
  await run(
    `INSERT INTO organizations (id, name, organization_type, policy_url, terms_url, retention_days, data_request_contact,
       cross_border_transfer, notice_version, created_at, respondent_age_category, consent_mode)
     VALUES (?, 'Yayasan Tata Kelola', 'organization', '/privacy', '/terms', 90, 'dpo@tata-kelola.test', 0, '1.1',
             '2026-11-20T00:00:00.000Z', 'adult', 'self')
     ON CONFLICT (id) DO NOTHING`,
    GOV_ORG,
  );
  for (const [version, purpose] of [['1.0', 'Tujuan notice 1.0'], ['1.1', 'Tujuan notice 1.1']]) {
    await run(
      `INSERT INTO organization_notices (id, organization_id, version, effective_date, purpose, data_categories,
         module15_usage, retention_text, recipients, contact, rights, child_data_text, cross_border_text, created_at)
       VALUES (?, ?, ?, '2026-11-20', ?, 'Kategori data', 'Modul 15', 'Retensi 90 hari', 'Penerima',
               'dpo@tata-kelola.test', 'Hak subjek', 'Data anak', 'Lintas negara', '2026-11-20T00:00:00.000Z')
       ON CONFLICT (organization_id, version) DO NOTHING`,
      `on_${GOV_ORG}_${version.replace('.', '_')}`,
      GOV_ORG,
      version,
      purpose,
    );
  }
  for (const [id, email, role] of [
    [GOV_ADMIN, 'orgadmin@tata-kelola.test', 'org_admin'],
    [GOV_CREATOR, 'kreator@tata-kelola.test', 'creator'],
  ] as const) {
    await run(
      `INSERT INTO accounts (id, email, display_name, role, status, password_hash, created_at, organization_id)
       VALUES (?, ?, ?, ?, 'active', ?, '2026-11-20T00:00:00.000Z', ?)
       ON CONFLICT (id) DO NOTHING`,
      id,
      email,
      'Pengelola Tata Kelola',
      role,
      hash,
      GOV_ORG,
    );
  }
  const published = 'v_gov_published';
  const drafts = [
    // Draf yang belum pernah dijawab: harus mengikuti notice baru.
    { survey: 's_gov_unanswered', version: 'v_gov_unanswered', status: 'draft', answered: false, notice: '1.0' },
    // Draf yang sudah punya jawaban: tetap pada notice yang disetujui responden.
    { survey: 's_gov_answered', version: 'v_gov_answered', status: 'draft', answered: true, notice: '1.0' },
  ];
  await run(
    `INSERT INTO surveys (id, owner_id, profile_id, title, purpose, object_label, instructions, status, created_at,
       updated_at, current_version_id, organization_id)
     VALUES ('s_gov_published', ?, 'p_smk', 'Survei terbit', 'Tujuan', 'Objek', '', 'published',
             '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z', NULL, ?)
     ON CONFLICT (id) DO NOTHING`,
    GOV_CREATOR,
    GOV_ORG,
  );
  await run(
    `INSERT INTO surveys (id, owner_id, profile_id, title, purpose, object_label, instructions, status, created_at,
       updated_at, current_version_id, organization_id)
     SELECT id, ?, 'p_smk', title, 'Tujuan', 'Objek', '', 'draft', '2026-11-20T00:00:00.000Z',
            '2026-11-20T00:00:00.000Z', version, ? FROM (VALUES
              ('s_gov_unanswered', 'v_gov_unanswered', 'Survei draf'),
              ('s_gov_answered', 'v_gov_answered', 'Survei draf berjawaban')
            ) AS t(id, version, title)
     ON CONFLICT (id) DO NOTHING`,
    GOV_CREATOR,
    GOV_ORG,
  );
  const versions = [
    { survey: 's_gov_published', version: published, status: 'published', notice: '1.0' },
    ...drafts,
  ];
  for (const row of versions) {
    await run(
      `INSERT INTO survey_versions (id, survey_id, number, status, notice_version, published_at, closed_at)
       VALUES (?, ?, 1, ?, ?, ?, NULL) ON CONFLICT (id) DO NOTHING`,
      row.version,
      row.survey,
      row.status,
      row.notice,
      row.status === 'published' ? '2026-11-20T01:00:00.000Z' : null,
    );
  }
}

test('BF-05: PUT /org/profile menaikkan notice_version; draf tanpa jawaban mengikuti, draf berjawaban tetap', async () => {
  await seedGovernanceOrg();
  const admin = await login('orgadmin@tata-kelola.test');

  const invalid = await request('/org/profile', 'PUT', { notice_version: '9.9' }, { Cookie: admin });
  assert.equal(invalid.status, 422, JSON.stringify(invalid.json));
  assert.equal(invalid.json.code, 'notice_version_unavailable');
  assert.deepEqual((invalid.json.details as { available_versions: string[] }).available_versions, ['1.0', '1.1']);
  const unchanged = await request('/org/profile', 'GET', undefined, { Cookie: admin });
  assert.equal((unchanged.json.data as { profile: { notice_version: string } }).profile.notice_version, '1.1');

  // Penanda "sudah punya jawaban": respons final yang menunjuk draf itu (data historis hasil impor).
  await run(
    `INSERT INTO responses (id, survey_id, version_id, respondent_id, collection_mode, identity_source,
       submitted_at, idempotency_key, assignment_id)
     VALUES ('r_gov_answered', 's_gov_answered', 'v_gov_answered', 'resp_gov', 'standalone', 'local',
             '2026-11-20T02:00:00.000Z', 'idem_gov', NULL)
     ON CONFLICT (id) DO NOTHING`,
  );

  const changed = await request('/org/profile', 'PUT', { notice_version: '1.0' }, { Cookie: admin });
  assert.equal(changed.status, 200, JSON.stringify(changed.json));
  const body = changed.json.data as {
    profile: { notice_version: string };
    notice_change: {
      from: string;
      to: string;
      drafts_followed: string[];
      drafts_kept: Array<{ version_id: string; survey_id: string; responses: number }>;
    };
  };
  assert.equal(body.profile.notice_version, '1.0');
  assert.deepEqual(
    { from: body.notice_change.from, to: body.notice_change.to },
    { from: '1.1', to: '1.0' },
  );
  assert.deepEqual(body.notice_change.drafts_followed, ['v_gov_unanswered']);
  assert.deepEqual(body.notice_change.drafts_kept, [
    { version_id: 'v_gov_answered', survey_id: 's_gov_answered', responses: 1 },
  ]);

  const drafts = await all<{ id: string; notice_version: string }>(
    "SELECT id, notice_version FROM survey_versions WHERE id IN ('v_gov_unanswered','v_gov_answered') ORDER BY id",
  );
  assert.deepEqual(drafts, [
    { id: 'v_gov_answered', notice_version: '1.0' },
    { id: 'v_gov_unanswered', notice_version: '1.0' },
  ]);
});

test('BF-05: duplikat survei mengambil notice dari sumber organisasi saat ini, bukan versi sumber', async () => {
  const admin = await login('orgadmin@tata-kelola.test');
  // Naikkan lagi ke 1.1; versi sumber survei tetap tercatat 1.0.
  const bumped = await request('/org/profile', 'PUT', { notice_version: '1.1' }, { Cookie: admin });
  assert.equal(bumped.status, 200, JSON.stringify(bumped.json));

  const creator = await login('kreator@tata-kelola.test');
  const duplicated = await request('/surveys/s_gov_published/duplicate', 'POST', {}, { Cookie: creator });
  assert.equal(duplicated.status, 201, JSON.stringify(duplicated.json));
  const surveyId = (duplicated.json.data as { survey: { id: string } }).survey.id;
  const draft = await all<{ notice_version: string }>(
    "SELECT notice_version FROM survey_versions WHERE survey_id = ? AND status = 'draft'",
    surveyId,
  );
  assert.deepEqual(draft, [{ notice_version: '1.1' }]);
});

test('UIX-08: email dirender sebagai mailto dan /privacy tidak menebak alamat contoh', () => {
  const email = render(createElement(ContactChannel, { contact: 'dpo@tata-kelola.test' }));
  assert.match(email, /href="mailto:dpo@tata-kelola\.test"/);
  const phone = render(createElement(ContactChannel, { contact: '0812-555-0100' }));
  assert.doesNotMatch(phone, /mailto:/, 'nomor telepon bukan tautan surel');
  assert.match(visibleText(render(createElement(ContactChannel, { contact: null }))), /Belum ditetapkan pengendali/);
  assert.doesNotMatch(render(createElement(PrivacyPage), '/privacy'), /privasi@organisasi\.contoh/);
});
