import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime.js';
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime.js';
import { ToastProvider } from '../../src/components/Toast.tsx';
import { HomePage } from '../../src/screens/Landing.tsx';
import * as respondent from '../../src/screens/Respondent.tsx';
import { ResultsPage } from '../../src/screens/CreatorData.tsx';
import { PreviewPage } from '../../src/screens/CreatorCore.tsx';
import { PrivacyPage } from '../../src/screens/Public.tsx';
import * as storage from '../../src/lib/draft.ts';
import { loadBootstrap } from '../../src/lib/store.ts';
import type { BootstrapData, ConsentPayload, PublicContextData, ReceiptData } from '../../src/lib/api.ts';

class MemoryStorage implements Storage {
  #items = new Map<string, string>();
  get length() { return this.#items.size; }
  clear() { this.#items.clear(); }
  getItem(key: string) { return this.#items.get(key) ?? null; }
  key(index: number) { return [...this.#items.keys()][index] ?? null; }
  removeItem(key: string) { this.#items.delete(key); }
  setItem(key: string, value: string) { this.#items.set(key, String(value)); }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'sessionStorage', { value: new MemoryStorage(), configurable: true, writable: true });
});

const unexpectedNavigation = () => { throw new Error('Render tidak boleh melakukan navigasi'); };
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
const count = (html: string, pattern: RegExp) => [...html.matchAll(pattern)].length;
const mainOf = (html: string) => {
  const main = /<main\b[\s\S]*<\/main>/.exec(html)?.[0];
  assert.ok(main, 'Halaman harus merender <main>');
  return main;
};

/* HTML landing yang dikirim server sebelum bootstrap klien berjalan (modul store masih berisi data bawaan). */
const LANDING_SSR = mainOf(render(createElement(HomePage)));

const FIXTURE_PANEL = [/INSTRUMEN CONTOH/, /Riwayat versi/, /item pada versi aktif/, /<table\b/];

function assertNoDemoPanel(html: string, when: string) {
  for (const pattern of FIXTURE_PANEL) {
    assert.doesNotMatch(html, pattern, `${when}: landing tamu tidak boleh memuat panel contoh (${pattern})`);
  }
}

const EMPTY_BOOTSTRAP: BootstrapData = {
  account: null, surveys: [], versions: [], profiles: [], notices: [], surveyProfiles: {}, questions: [], options: [],
  invitations: [], publicLinks: [], assignments: [], settings: {}, grants: [], accounts: [], organizations: [], auditLogs: [],
  integrationEvents: [], dataRequests: [], serverTime: '2026-11-23T02:00:00Z',
};

/* ---------------- NEW-UX-C + sisa UIX-09 ---------------- */

test('NEW-UX-C: HTML SSR landing tamu tidak memuat panel contoh dari fixture klien', () => {
  assertNoDemoPanel(LANDING_SSR, 'HTML SSR');
  assert.doesNotMatch(LANDING_SSR, />Terbit</, 'HTML SSR tidak boleh menampilkan lencana "Terbit" dari data rekaan');
});

test('NEW-UX-C: bootstrap gagal tidak memunculkan panel contoh dan tata letaknya sama dengan HTML SSR', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('fetch failed'); });
  await loadBootstrap();
  const html = mainOf(render(createElement(HomePage)));
  assertNoDemoPanel(html, 'Bootstrap gagal');
  assert.equal(html, LANDING_SSR, 'Bootstrap gagal tidak boleh mengubah isi landing tamu dibanding HTML SSR');
});

test('NEW-UX-C: bootstrap tamu berhasil tidak menggeser tata letak (tidak ada blok yang muncul lalu hilang)', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ data: EMPTY_BOOTSTRAP }));
  await loadBootstrap();
  const html = mainOf(render(createElement(HomePage)));
  assertNoDemoPanel(html, 'Sesudah bootstrap tamu');
  assert.equal(html, LANDING_SSR, 'Isi landing tamu sesudah bootstrap harus sama dengan HTML SSR');
  for (const label of ['Sangat tidak setuju', 'Sangat setuju', 'Tidak sesuai', 'Sangat sesuai']) {
    assert.match(html, new RegExp(`>${label}<`), `Contoh skala tetap tampil sesudah bootstrap: ${label}`);
  }
});

test('UIX-09: panel riwayat versi tetap tampil bila sesi benar-benar memuat versi terbit dari server', async (t) => {
  const data: BootstrapData = {
    ...EMPTY_BOOTSTRAP,
    account: { id: 'u_pemilik_demo', display_name: 'Dewi Kartika', email: 'dewi@sekolah.test', role: 'creator', status: 'active', organization_id: null },
    surveys: [{
      id: 's_demo1', owner_id: 'u_pemilik_demo', profile_id: 'p_org', title: 'Umpan balik kantin', purpose: 'Evaluasi menu', object_label: 'Kantin',
      instructions: '', status: 'published', created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-20T00:00:00Z', current_version_id: 'v_kantin_1',
    }],
    versions: [
      { id: 'v_kantin_1', survey_id: 's_demo1', number: 1, status: 'published', notice_version: 'N-7', published_at: '2026-11-02T00:00:00Z', closed_at: null, question_ids: ['q_k1', 'q_k2', 'q_k3', 'q_k4'] },
    ],
    questions: ['q_k1', 'q_k2', 'q_k3', 'q_k4'].map((id, index) => ({
      id, version_id: 'v_kantin_1', code: `K0${index + 1}`, order: index + 1, type: 'short_text' as const, required: false, section: 'Umum',
      label: `Pertanyaan ${index + 1}`, hint: null, group_code: null, dimension_code: null, option_ids: [],
    })),
  };
  t.mock.method(globalThis, 'fetch', async () => Response.json({ data }));
  await loadBootstrap();
  const html = mainOf(render(createElement(HomePage)));
  assert.match(html, /INSTRUMEN CONTOH/);
  assert.match(html, /4 item pada versi aktif/, 'Panel memakai data server, bukan fixture (3 item)');
});

/* ---------------- Sisa UIX-20: status bukti ---------------- */

const PUBLIC_CTX: PublicContextData = {
  kind: 'public',
  isPublicLink: true,
  state: 'active',
  canSubmit: true,
  guardianRequired: false,
  survey: { title: 'Survei Kebiasaan Membaca', purpose: 'Memahami kebiasaan membaca siswa', object_label: 'Siswa kelas 8', instructions: '' },
  version: { number: 3, notice_version: 'N-2' },
  consent_version: 'djM',
  questions: [],
  options: [],
  profile: {
    id: 'p_smp', organization_name: 'SMP Harapan', organization_type: 'school', respondent_age_category: 'minor',
    consent_mode: 'guardian', policy_url: '/privacy', terms_url: '/terms', retention_days: 180, data_request_contact: 'tu@smpharapan.test',
    cross_border_transfer: false, notice_version: 'N-2', synthetic_placeholder: false,
  },
  notice: {
    id: 'n_smp', profile_id: 'p_smp', version: 'N-2', effective_date: '2026-11-01', purpose: 'Memahami kebiasaan membaca',
    data_categories: 'Jawaban survei', module15_usage: 'Tidak dipakai', retention_text: '180 hari', recipients: 'Guru BK',
    contact: 'tu@smpharapan.test', rights: 'Akses dan koreksi', child_data_text: 'Dengan persetujuan wali',
    cross_border_text: 'Tidak ada', synthetic_placeholder: false,
  },
  invitation: null,
};

function receipt(id: string, key: string): ReceiptData {
  return { response_id: id, survey_id: 's_baca', version_number: 3, submitted_at: '2026-11-23T03:15:00Z', status: 'submitted', idempotency_key: key };
}

test('UIX-20: bukti responden menampilkan status dengan label manusiawi, bukan enum mentah', () => {
  const stored = { receipt: receipt('r_8f2c', 'kunci-8f2c-0001'), key: 'kunci-8f2c-0001' };
  const html = render(createElement(respondent.ReceiptView, { token: 'pl_baca', ctx: PUBLIC_CTX, stored }), '/s/pl_baca/receipt');
  assert.doesNotMatch(visibleText(html), /\bsubmitted\b/, 'Status "submitted" mentah tidak boleh tampil di bukti');
  assert.match(html, /<th[^>]*>Status<\/th><td[^>]*>Terkirim<\/td>/, 'Baris Status (tabel) memakai label "Terkirim"');
  assert.match(html, /<dt[^>]*>Status<\/dt><dd[^>]*>Terkirim<\/dd>/, 'Baris Status (mobile) memakai label "Terkirim"');
});

/* ---------------- Sisa UIX-22: heading hasil di luar cakupan ---------------- */

test('UIX-22: halaman hasil untuk survei di luar cakupan memiliki tepat satu h1', () => {
  const html = render(createElement(ResultsPage, { id: 's_milik_orang_lain' }), '/creator/surveys/s_milik_orang_lain/results');
  assert.match(html, /Survei tidak ditemukan/);
  assert.equal(count(html, /<h1\b/g), 1, 'Shell dan cabang tidak ditemukan tidak boleh sama-sama merender h1');
});

/* ---------------- NEW-UX-E: pratinjau isian singkat wajib ---------------- */

const tagById = (html: string, id: string) => new RegExp(`<[a-z]+\\b[^>]*\\bid="${id}"[^>]*>`).exec(html)?.[0] ?? '';
const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];

/** Placeholder, status wajib, dan nama label dari satu textarea: label[for] bila ada id, selain itu aria-label. */
function textareaSpec(html: string, tag: string) {
  const id = attr(tag, 'id');
  const label = id ? new RegExp(`<label\\b[^>]*\\bfor="${id}"[^>]*>([\\s\\S]*?)</label>`).exec(html)?.[1] : undefined;
  return {
    placeholder: attr(tag, 'placeholder') ?? null,
    required: attr(tag, 'aria-required') === 'true' || /\srequired(?:=""|\s|>)/.test(tag),
    label: label === undefined ? attr(tag, 'aria-label') ?? null : visibleText(label),
  };
}

const textareas = (html: string) => [...html.matchAll(/<textarea\b[^>]*>/g)].map(([tag]) => tag);

test('NEW-UX-E: pratinjau isian singkat wajib sama dengan formulir responden (label, placeholder, aria-required)', async (t) => {
  const owner = { id: 'u_bk_rina', display_name: 'Rina Guru BK', email: 'rina@smpharapan.test', role: 'creator' as const, status: 'active' as const, organization_id: null };
  const questions = [
    { id: 'q_saran_wajib', code: 'SR1', order: 1, required: true, label: 'Apa yang paling membantu Anda membaca di rumah?' },
    { id: 'q_catatan', code: 'CT1', order: 2, required: false, label: 'Catatan lain untuk guru' },
  ];
  const data: BootstrapData = {
    ...EMPTY_BOOTSTRAP,
    account: owner,
    surveys: [{
      id: 's_baca', owner_id: owner.id, profile_id: 'p_smp', title: 'Survei Kebiasaan Membaca', purpose: 'Memahami kebiasaan membaca',
      object_label: 'Siswa', instructions: '', status: 'draft', created_at: '2026-11-20T00:00:00Z', updated_at: '2026-11-21T00:00:00Z', current_version_id: null,
    }],
    versions: [{ id: 'v_baca_draf', survey_id: 's_baca', number: 1, status: 'draft', notice_version: 'N-2', published_at: null, closed_at: null, question_ids: questions.map((q) => q.id) }],
    questions: questions.map((q) => ({
      ...q, version_id: 'v_baca_draf', type: 'short_text' as const, section: 'Kebiasaan', hint: null, group_code: null, dimension_code: null, option_ids: [],
    })),
  };
  t.mock.method(globalThis, 'fetch', async () => Response.json({ data }));
  await loadBootstrap();
  const preview = render(createElement(PreviewPage, { id: 's_baca' }), '/creator/surveys/s_baca/preview');
  const [requiredTag, optionalTag] = textareas(preview);
  assert.ok(requiredTag && optionalTag, `Pratinjau harus merender dua textarea: ${textareas(preview).join(' ')}`);

  const respondentHtml = (required: boolean) => render(createElement(respondent.QuestionField, {
    q: { ...data.questions[required ? 0 : 1]!, type: 'short_text' },
    token: 'pl_baca', value: { optionId: null, text: '' }, setOption: () => {}, setText: () => {}, highlightEmpty: false, options: [],
  }), '/s/pl_baca/form');
  const formRequired = respondentHtml(true);
  const formOptional = respondentHtml(false);

  const previewRequired = textareaSpec(preview, requiredTag);
  assert.equal(previewRequired.required, true, 'Textarea pratinjau untuk pertanyaan wajib harus aria-required="true"');
  assert.doesNotMatch(previewRequired.placeholder ?? '', /opsional/i, 'Placeholder pertanyaan wajib tidak boleh menyebut opsional');
  assert.deepEqual(previewRequired, textareaSpec(formRequired, textareas(formRequired)[0]!), 'Pratinjau wajib harus sama dengan formulir responden');
  assert.deepEqual(textareaSpec(preview, optionalTag), textareaSpec(formOptional, textareas(formOptional)[0]!), 'Pratinjau opsional harus sama dengan formulir responden');

  const requiredBlock = /<fieldset\b[\s\S]*?<\/fieldset>/.exec(preview)?.[0] ?? '';
  assert.match(requiredBlock, /\(wajib\)/, 'Legend pertanyaan wajib di pratinjau menyebut wajib untuk pembaca layar');
  assert.doesNotMatch(visibleText(requiredBlock), /Opsional/, 'Pertanyaan wajib di pratinjau tidak berlabel opsional');
});

/* ---------------- Sisa SEC-07/BF-08: alur ditinggalkan sebelum bukti ---------------- */

const TOKEN = 'pl_baca';

function consent(id: string, guardian = false): ConsentPayload {
  return {
    consent_id: id, respondent_click: true, basis: guardian ? 'Persetujuan wali' : 'Persetujuan diri', notice_version: 'N-2',
    guardian_evidence_status: guardian ? 'self_attested' : 'not_required', guardian_evidence_ref: guardian ? 'Surat izin 14/XI/2026' : null,
  };
}

function DraftProbe({ token, version }: { token: string; version: number }) {
  const { draft } = storage.useDraft(token, version, ['SK1', 'SR1']);
  return createElement('output', null, `${draft.SK1?.optionId ?? ''}|${draft.SR1?.text ?? ''}`);
}

const formDraft = (token: string, version = 3) =>
  renderToStaticMarkup(createElement(DraftProbe, { token, version })).replace(/<\/?output>/g, '');

/** Responden A menyetujui, mengisi teks bebas, mencoba kirim (gagal jaringan), lalu meninggalkan tab tanpa bukti. */
function abandonByA(): string {
  storage.writeConsent(TOKEN, consent('c_responden_a'));
  sessionStorage.setItem(`svara.draft.${TOKEN}.3`, JSON.stringify({
    SK1: { optionId: 'opt_sering', text: '' },
    SR1: { optionId: null, text: 'Ibu saya membacakan buku tiap malam di Jl. Kenanga 12' },
  }));
  return storage.submissionKey(TOKEN, 3, false)!;
}

test('SEC-07/BF-08: alur ditinggalkan sebelum bukti — persetujuan baru di pengantar tidak mewarisi draf, teks bebas, atau kunci kirim A', () => {
  const keyA = abandonByA();
  assert.equal(formDraft(TOKEN), 'opt_sering|Ibu saya membacakan buku tiap malam di Jl. Kenanga 12');

  // Responden B membuka pengantar di tab yang sama lalu mencatat persetujuannya sendiri.
  storage.writeConsent(TOKEN, consent('c_responden_b'));

  assert.equal(storage.readConsent(TOKEN)?.consent_id, 'c_responden_b');
  assert.equal(formDraft(TOKEN), '|', 'Formulir B tidak boleh memuat pilihan dan teks bebas responden A');
  const keyB = storage.submissionKey(TOKEN, 3, false);
  assert.ok(keyB && keyB !== keyA, 'Kiriman B tidak boleh memakai kunci kirim responden A');
});

test('SEC-07/BF-08: retry identik sebelum bukti tetap memakai kunci yang sama', () => {
  storage.writeConsent(TOKEN, consent('c_responden_a'));
  const key = storage.submissionKey(TOKEN, 3, false);
  assert.ok(key);
  assert.equal(storage.submissionKey(TOKEN, 3, false), key, 'Kirim ulang dari halaman tinjau memakai kunci yang sama');
  assert.equal(storage.submissionKey(TOKEN, 3, true), key, 'Retry-only memakai kunci yang sama');
});

test('SEC-07/BF-08: pengantar menawarkan pilihan eksplisit dan tidak menampilkan formulir persetujuan sebelum responden memilih', () => {
  abandonByA();
  assert.equal(storage.hasUnsentAttempt(TOKEN), true, 'Persetujuan, draf, dan kunci A terdeteksi sebagai isian belum terkirim');
  assert.equal(storage.hasUnsentAttempt('pl_lain'), false, 'Token lain tidak terdampak');

  const html = render(createElement(respondent.IntroView, { token: TOKEN, ctx: PUBLIC_CTX, attempt: 'unsent', onChoose: () => {}, reload: () => {} }), `/s/${TOKEN}`);
  assert.match(html, /<button[^>]*>Lanjutkan isian sebelumnya<\/button>/);
  assert.match(html, /<button[^>]*>Mulai sebagai responden baru<\/button>/);
  assert.doesNotMatch(html, /id="consent-utama"/, 'Persetujuan baru tidak dapat dicatat sebelum responden memilih');
  assert.doesNotMatch(html, /Lanjut ke formulir/);
  assert.doesNotMatch(html, /Kenanga|opt_sering/, 'Isi draf A tidak ditampilkan di pengantar');
  assert.match(html, /Memahami kebiasaan membaca/, 'Pemberitahuan tetap dapat dibaca sebelum memilih');

  const fresh = render(createElement(respondent.IntroView, { token: TOKEN, ctx: PUBLIC_CTX, attempt: 'none', onChoose: () => {}, reload: () => {} }), `/s/${TOKEN}`);
  assert.doesNotMatch(fresh, /Lanjutkan isian sebelumnya/, 'Tanpa isian tertinggal, pengantar langsung menampilkan persetujuan');
  assert.match(fresh, /<input[^>]*id="consent-utama"/);
  assert.doesNotMatch(/<input[^>]*id="consent-utama"[^>]*>/.exec(fresh)?.[0] ?? '', /\schecked=""/, 'Persetujuan dimulai belum dicentang');
});

/** Cari elemen dengan onClick dan teks tertentu di pohon elemen tanpa merender komponen anaknya. */
function findClickable(node: ReactNode, label: string): { onClick: () => void } | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findClickable(child, label);
      if (found) return found;
    }
    return undefined;
  }
  if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(node)) return undefined;
  if (node.props.onClick && node.props.children === label) return { onClick: node.props.onClick };
  return findClickable(node.props.children, label);
}

test('SEC-07/BF-08: "Mulai sebagai responden baru" menghapus persetujuan, draf, dan kunci token itu saja', () => {
  const keyA = abandonByA();
  storage.writeConsent('pl_lain', consent('c_lain'));
  const keyOther = storage.submissionKey('pl_lain', 1, false);
  const choices: string[] = [];
  const tree = respondent.UnsentAttemptChoice({ token: TOKEN, onChoose: (choice) => { choices.push(choice); } });

  findClickable(tree, 'Mulai sebagai responden baru')!.onClick();
  assert.deepEqual(choices, ['restart']);
  assert.equal(storage.readConsent(TOKEN), null, 'Persetujuan A dihapus');
  assert.equal(formDraft(TOKEN), '|', 'Draf A dihapus');
  assert.equal(storage.submissionKey(TOKEN, 3, true), null, 'Kunci kirim A dihapus');
  assert.notEqual(storage.submissionKey(TOKEN, 3, false), keyA);
  assert.equal(storage.hasUnsentAttempt(TOKEN), true, 'Kunci baru yang baru dibuat termasuk isian belum terkirim');
  assert.equal(storage.readConsent('pl_lain')?.consent_id, 'c_lain', 'Token lain tidak tersentuh');
  assert.equal(storage.submissionKey('pl_lain', 1, true), keyOther);
});

test('SEC-07/BF-08: "Lanjutkan isian sebelumnya" mempertahankan draf dan kunci sehingga retry identik memakai kunci yang sama', () => {
  const keyA = abandonByA();
  const choices: string[] = [];
  const tree = respondent.UnsentAttemptChoice({ token: TOKEN, onChoose: (choice) => { choices.push(choice); } });
  findClickable(tree, 'Lanjutkan isian sebelumnya')!.onClick();
  assert.deepEqual(choices, ['resume']);

  // Orang yang sama menyetujui ulang pemberitahuan dari pengantar sebagai kelanjutan isiannya.
  storage.writeConsent(TOKEN, consent('c_responden_a_ulang'), { resume: true });
  assert.equal(formDraft(TOKEN), 'opt_sering|Ibu saya membacakan buku tiap malam di Jl. Kenanga 12');
  assert.equal(storage.submissionKey(TOKEN, 3, false), keyA, 'Retry identik sebelum bukti memakai kunci yang sama');
});

test('SEC-07/BF-08: kirim sukses tetap menghapus isian token itu sehingga pengantar berikutnya tidak menawarkan lanjutan', () => {
  const keyA = abandonByA();
  storage.completeSubmission(TOKEN, receipt('r_a', keyA), keyA);
  assert.equal(storage.hasUnsentAttempt(TOKEN), false);
  assert.equal(storage.readReceipt(TOKEN)?.receipt.response_id, 'r_a');
});

/* ---------------- Sisa UIX-04 + NR-06: salinan wali jujur ---------------- */

const GUARDIAN_CLAIMS = /verifikasi wali|kode verifikasi|bukti wali sah|bukti yang sah|atau dicabut|bukti verifikasi/i;

test('UIX-04/NR-06: landing tidak mengklaim bukti wali diverifikasi atau sah', () => {
  const text = visibleText(LANDING_SSR);
  assert.doesNotMatch(text, GUARDIAN_CLAIMS);
});

test('UIX-04/NR-06: salinan wali di pengantar tidak menyiratkan verifikasi atau pencabutan yang tidak ada', () => {
  const source = readFileSync(new URL('../../src/screens/Respondent.tsx', import.meta.url), 'utf8');
  const offending = source.split('\n').filter((line) => GUARDIAN_CLAIMS.test(line));
  assert.deepEqual(offending, [], 'Salinan pengantar wali tidak boleh menyebut verifikasi, kode verifikasi, bukti sah, atau pencabutan');
});

test('UIX-04/NR-06: pengantar mode wali menyatakan bukti dicatat sebagai pernyataan dan tidak diverifikasi aplikasi', () => {
  const ctx: PublicContextData = { ...PUBLIC_CTX, guardianRequired: true };
  const html = render(createElement(respondent.IntroView, { token: TOKEN, ctx, attempt: 'none', onChoose: () => {}, reload: () => {} }), `/s/${TOKEN}`);
  const text = visibleText(html);
  assert.doesNotMatch(text, GUARDIAN_CLAIMS);
  assert.doesNotMatch(text, /dicabut/i, 'Tidak ada jalur pencabutan bukti wali');
  assert.match(text, /tidak memeriksa keasliannya/, 'Salinan menyatakan aplikasi tidak memverifikasi bukti wali');
  const placeholder = attr(tagById(html, 'guardian-ref'), 'placeholder') ?? '';
  assert.doesNotMatch(placeholder, /verifikasi|pengelola/i, `Placeholder tidak menyebut kode verifikasi: ${placeholder}`);
});

test('UIX-04/NR-06: kebijakan privasi tidak mewajibkan "bukti verifikasi" wali yang tidak ada', () => {
  const text = visibleText(mainOf(render(createElement(PrivacyPage), '/privacy')));
  assert.doesNotMatch(text, GUARDIAN_CLAIMS, 'Entri data anak tidak boleh mengklaim bukti wali diverifikasi');
  assert.match(text, /Data anak.*tidak diverifikasi aplikasi/, 'Entri data anak menyatakan referensi wali dicatat apa adanya');
});
