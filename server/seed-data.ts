import { get, nowIso, run, withTx } from './db.ts';
import { hashPassword, sha256 } from './security.ts';
import { demoSeedEnabled } from './seed-policy.ts';

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'SvaraDemo123!';

function bool(value: boolean): number {
  return value ? 1 : 0;
}

function addYears(date: string, years: number): string {
  const next = new Date(date);
  next.setUTCFullYear(next.getUTCFullYear() + years);
  return next.toISOString();
}

/**
 * Seed demo idempoten: hanya berjalan dengan SEED_DEMO=1 dan tidak pernah di production.
 * Tidak ada nama, email, atau jawaban dari orang nyata.
 */
export async function seedDemoIfEmpty(): Promise<boolean> {
  if (!demoSeedEnabled()) return false;
  const existing = await get<{ count: number }>('SELECT COUNT(*) AS count FROM accounts');
  if (existing && existing.count > 0) return false;

  await withTx(async () => {
    const createdAt = '2026-11-01T00:00:00Z';
    // Dua organisasi sintetis agar isolasi lingkup org_admin dapat dibuktikan.
    // notice_version organisasi sengaja berbeda dari platform agar sumber notice dapat dibuktikan.
    const organizations: Array<[string, string, string, string, string, string]> = [
      ['org_smk', 'SMK Nusantara (sintetis)', 'school', 'minor', 'guardian', '1.2'],
      ['org_perpus', 'Perpustakaan Kota (sintetis)', 'organization', 'adult', 'self', '1.2'],
    ];
    for (const [id, name, type, ageCategory, consentMode, noticeVersion] of organizations) {
      await run(
        `INSERT INTO organizations (id, name, organization_type, respondent_age_category, consent_mode,
          policy_url, terms_url, retention_days, data_request_contact, cross_border_transfer, notice_version, created_at)
         VALUES (?, ?, ?, ?, ?, '/privacy', '/terms', NULL, 'privasi@organisasi.contoh', 0, ?, ?)`,
        id,
        name,
        type,
        ageCategory,
        consentMode,
        noticeVersion,
        createdAt,
      );
    }
    await run(
      `INSERT INTO platform_profile (id, organization_name, organization_type, policy_url, terms_url, retention_days,
        data_request_contact, cross_border_transfer, notice_version, updated_at)
       VALUES ('platform', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'Svara (sintetis)',
      'platform',
      '/privacy',
      '/terms',
      null,
      'privasi@organisasi.contoh',
      0,
      // Selaras dengan notices/notice_version profil deployment versi 2.0.
      '2.0',
      createdAt,
    );

    const accounts: Array<[string, string, string, string, string, string, string | null]> = [
      ['u_admin', 'admin@svara.local', 'Rani Wijaya', 'super_admin', 'active', SEED_PASSWORD, null],
      ['u_creator_a', 'creator.a@svara.local', 'Andi Pratama', 'creator', 'active', SEED_PASSWORD, 'org_smk'],
      ['u_creator_b', 'creator.b@svara.local', 'Sinta Maharani', 'creator', 'active', SEED_PASSWORD, 'org_perpus'],
      ['u_petugas', 'officer@svara.local', 'Dedi Kurniawan', 'creator', 'active', SEED_PASSWORD, 'org_smk'],
      ['u_orgadmin', 'orgadmin@svara.local', 'Maya Kusuma', 'org_admin', 'active', SEED_PASSWORD, 'org_smk'],
      ['u_nonaktif', 'suspended@svara.local', 'Bayu Setiawan', 'creator', 'suspended', SEED_PASSWORD, null],
    ];
    for (const [id, email, name, role, status, password, organizationId] of accounts) {
      await run(
        'INSERT INTO accounts (id, email, display_name, role, status, password_hash, created_at, organization_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        id,
        email,
        name,
        role,
        status,
        await hashPassword(password),
        createdAt,
        organizationId,
      );
    }

    await run(
      `INSERT INTO profiles (id, organization_name, organization_type, respondent_age_category, consent_mode,
        policy_url, terms_url, retention_days, data_request_contact, cross_border_transfer, notice_version, synthetic_placeholder)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'p_smk',
      'SMK Nusantara (sintetis)',
      'school',
      'minor',
      'guardian',
      '/privacy',
      '/terms',
      null,
      null,
      null,
      '1.0',
      1,
    );
    await run(
      `INSERT INTO profiles (id, organization_name, organization_type, respondent_age_category, consent_mode,
        policy_url, terms_url, retention_days, data_request_contact, cross_border_transfer, notice_version, synthetic_placeholder)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'p_perpus',
      'Perpustakaan Kota (sintetis)',
      'organization',
      'adult',
      'self',
      '/privacy',
      '/terms',
      90,
      'privasi@organisasi.contoh',
      0,
      '1.0',
      1,
    );

    const notices: Array<[string, string, string, string, string, string, string, string]> = [
      [
        'n_smk',
        'p_smk',
        '1.0',
        '2026-11-17',
        'Tujuan survei dinyatakan oleh pembuat survei pada setiap instrumen.',
        'Jawaban pada skala, isian teks singkat, kode acak peserta, waktu pengiriman, dan catatan persetujuan. Tidak meminta nama, tanggal lahir, atau nomor identitas.',
        'Ringkasan dan data yang diizinkan dapat diteruskan ke konsumen analitik melalui API terbatas.',
        'Mengikuti kebijakan retensi pengendali (belum ditetapkan).',
      ],
      [
        'n_perpus',
        'p_perpus',
        '1.0',
        '2026-11-17',
        'Tujuan survei dinyatakan oleh pembuat survei pada setiap instrumen.',
        'Jawaban pada skala, komentar singkat, kode acak peserta, waktu pengiriman, dan catatan persetujuan.',
        'Ringkasan dan data yang diizinkan dapat diteruskan ke konsumen analitik melalui API terbatas.',
        '90 hari sejak pengiriman.',
      ],
    ];
    for (const [id, profile, version, effective, purpose, categories, module15, retention] of notices) {
      await run(
        `INSERT INTO notices (id, profile_id, version, effective_date, purpose, data_categories, module15_usage,
          retention_text, recipients, contact, rights, child_data_text, cross_border_text, synthetic_placeholder)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        id,
        profile,
        version,
        effective,
        purpose,
        categories,
        module15,
        retention,
        profile === 'p_smk'
          ? 'Pembuat survei, petugas berizin, dan penerima integrasi sesuai cakupan.'
          : 'Pembuat survei dan petugas berizin pada survei ini.',
        profile === 'p_smk' ? 'Lihat pemberitahuan survei' : 'privasi@organisasi.contoh',
        'Akses, koreksi, penarikan persetujuan, dan penghapusan melalui kanal resmi pengendali.',
        profile === 'p_smk'
          ? 'Persetujuan orang tua atau wali dan bukti verifikasi wajib sebelum pengiriman baru.'
          : 'Profil ini ditujukan untuk responden dewasa dengan persetujuan diri.',
        'Tidak ada transfer lintas negara.',
      );
    }

    // Pemberitahuan per lingkup survei. Versi harus mencakup notice_version yang dipakai versi
    // survei seed (1.0/1.1) dan notice_version organisasi (1.2) agar permintaan publik tidak
    // jatuh ke notice versi lain.
    const noticeBodies: Record<string, { text: string; recipients: string; childData: string; contact: string }> = {
      org_smk: {
        text: 'Jawaban pada skala, isian teks singkat, kode acak peserta, waktu pengiriman, dan catatan persetujuan. Penyelenggara adalah sekolah pada profil organisasi.',
        recipients: 'Pembuat survei, petugas berizin, dan penerima integrasi sesuai cakupan pengendali.',
        childData: 'Responden berusia di bawah usia dewasa; persetujuan orang tua atau wali wajib sebelum pengiriman.',
        contact: 'privasi@organisasi.contoh',
      },
      org_perpus: {
        text: 'Jawaban pada skala, komentar singkat, kode acak peserta, waktu pengiriman, dan catatan persetujuan. Penyelenggara adalah organisasi pada profil organisasi.',
        recipients: 'Pembuat survei dan petugas berizin pada survei ini.',
        childData: 'Profil ini ditujukan untuk responden dewasa dengan persetujuan diri.',
        contact: 'privasi@organisasi.contoh',
      },
      platform: {
        text: 'Jawaban pada skala, isian teks singkat, kode acak peserta, waktu pengiriman, dan catatan persetujuan. Survei mandiri dikelola pembuatnya di bawah kebijakan platform.',
        recipients: 'Pembuat survei dan petugas berizin pada survei ini.',
        childData: 'Persetujuan wali wajib bila penyelenggara menetapkan mode wali.',
        contact: 'privasi@organisasi.contoh',
      },
    };
    const noticeScopes: Array<{ org: string; version: string }> = [
      { org: 'org_smk', version: '1.0' },
      { org: 'org_smk', version: '1.1' },
      { org: 'org_smk', version: '1.2' },
      { org: 'org_perpus', version: '1.0' },
      { org: 'org_perpus', version: '1.1' },
      { org: 'org_perpus', version: '1.2' },
    ];
    for (const scope of noticeScopes) {
      const body = noticeBodies[scope.org]!;
      await run(
        `INSERT INTO organization_notices (id, organization_id, version, effective_date, purpose, data_categories,
          module15_usage, retention_text, recipients, contact, rights, child_data_text, cross_border_text, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        `on_${scope.org}_${scope.version.replace('.', '_')}`,
        scope.org,
        scope.version,
        '2026-11-17',
        'Tujuan survei dinyatakan oleh pembuat survei pada setiap instrumen.',
        body.text,
        'Ringkasan dan data yang diizinkan dapat diteruskan ke konsumen analitik melalui API terbatas.',
        scope.org === 'org_perpus' ? '90 hari sejak pengiriman.' : 'Mengikuti kebijakan retensi pengendali (belum ditetapkan).',
        body.recipients,
        body.contact,
        'Akses, koreksi, penarikan persetujuan, dan penghapusan melalui kanal resmi pengendali.',
        body.childData,
        'Tidak ada transfer lintas negara.',
        createdAt,
      );
    }
    for (const version of ['1.0', '1.1', '1.2', '2.0']) {
      const body = noticeBodies.platform!;
      await run(
        `INSERT INTO platform_notices (id, version, effective_date, purpose, data_categories, module15_usage,
          retention_text, recipients, contact, rights, child_data_text, cross_border_text, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        `pn_${version.replace('.', '_')}`,
        version,
        '2026-11-17',
        'Tujuan survei dinyatakan oleh pembuat survei pada setiap instrumen.',
        body.text,
        'Ringkasan dan data yang diizinkan dapat diteruskan ke konsumen analitik melalui API terbatas.',
        'Mengikuti kebijakan retensi pengendali (belum ditetapkan).',
        body.recipients,
        body.contact,
        'Akses, koreksi, penarikan persetujuan, dan penghapusan melalui kanal resmi pengendali.',
        body.childData,
        'Tidak ada transfer lintas negara.',
        createdAt,
      );
    }

    const surveys: Array<[string, string, string, string, string, string, string, string, string, string]> = [
      [
        's_demo1',
        'u_creator_a',
        'p_smk',
        'Pengalaman penggunaan alat bantu tugas',
        'Mengumpulkan tanggapan atas penggunaan alat bantu tugas desain UI/UX pada lingkungan belajar.',
        'Alat bantu tugas desain',
        'Pilih satu jawaban pada setiap pernyataan. Isian kendala boleh dikosongkan.',
        'published',
        '2026-11-02T02:00:00Z',
        '2026-11-12T07:30:00Z',
      ],
      [
        's_demo2',
        'u_creator_a',
        'p_perpus',
        'Kepuasan layanan perpustakaan',
        'Mengetahui pengalaman pengunjung terhadap layanan pinjam dan ruang baca.',
        'Layanan perpustakaan',
        'Pilih tingkat kesesuaian pada tiap pernyataan. Komentar singkat bersifat opsional.',
        'published',
        '2026-11-05T04:00:00Z',
        '2026-11-10T03:00:00Z',
      ],
      [
        's_demo3',
        'u_creator_b',
        'p_perpus',
        'Survei kepuasan anggota',
        'Draf belum memiliki pertanyaan.',
        'Belum ditetapkan',
        '',
        'draft',
        '2026-11-14T09:00:00Z',
        '2026-11-14T09:00:00Z',
      ],
      [
        's_demo4',
        'u_creator_a',
        'p_perpus',
        'Evaluasi layanan semester lalu',
        'Contoh survei dengan versi yang sudah ditutup.',
        'Layanan lama',
        '',
        'archived',
        '2026-10-01T01:00:00Z',
        '2026-11-01T01:00:00Z',
      ],
    ];
    for (const [id, owner, profile, title, purpose, objectLabel, instructions, status, created, updated] of surveys) {
      await run(
        `INSERT INTO surveys (id, owner_id, profile_id, title, purpose, object_label, instructions, status, created_at, updated_at, current_version_id, organization_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        owner,
        profile,
        title,
        purpose,
        objectLabel,
        instructions,
        status,
        created,
        updated,
        null,
        owner === 'u_creator_b' ? 'org_perpus' : 'org_smk',
      );
      await run(
        'INSERT INTO survey_settings (survey_id, allow_results, allow_individual) VALUES (?, 1, 1)',
        id,
      );
    }

    const versions: Array<[string, string, number, string, string, string | null, string | null]> = [
      ['v_demo1_1', 's_demo1', 1, 'published', '1.0', '2026-11-03T03:00:00Z', null],
      ['v_demo1_2', 's_demo1', 2, 'draft', '1.1', null, null],
      ['v_demo2_1', 's_demo2', 1, 'published', '1.0', '2026-11-06T05:00:00Z', null],
      ['v_demo4_1', 's_demo4', 1, 'closed', '1.0', '2026-10-02T02:00:00Z', '2026-11-01T01:00:00Z'],
    ];
    for (const row of versions) {
      await run(
        `INSERT INTO survey_versions (id, survey_id, number, status, notice_version, published_at, closed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ...row,
      );
    }
    await run('UPDATE surveys SET current_version_id = ? WHERE id = ?', 'v_demo1_2', 's_demo1');
    await run('UPDATE surveys SET current_version_id = ? WHERE id = ?', 'v_demo2_1', 's_demo2');
    await run('UPDATE surveys SET current_version_id = ? WHERE id = ?', 'v_demo4_1', 's_demo4');

    const questions: Array<[string, string, string, number, string, boolean, string, string, string | null, string | null, string | null]> = [
      ['q_ad01', 'v_demo1_1', 'AD01', 1, 'likert', true, 'Bagian 1 · Penerimaan', 'Alat bantu ini membantu saya menyelesaikan tugas yang diberikan.', null, null, 'adopsi'],
      ['q_ts01', 'v_demo1_1', 'TS01', 2, 'likert', true, 'Bagian 1 · Penerimaan', 'Saya merasa terbebani ketika harus memakai beberapa fitur alat bantu tersebut.', null, null, 'beban'],
      ['q_k02', 'v_demo1_1', 'K02', 3, 'short_text', false, 'Bagian 2 · Kendala', 'Ceritakan kendala yang Anda temui (opsional).', 'Jangan tuliskan nama atau data identitas lain.', null, null],
      ['q_ad01_v2', 'v_demo1_2', 'AD01', 1, 'likert', true, 'Bagian 1 · Penerimaan', 'Alat bantu ini membantu saya menyelesaikan tugas yang diberikan.', 'Versi draf baru, belum diterbitkan.', null, 'adopsi'],
      ['q_ts01_v2', 'v_demo1_2', 'TS01', 2, 'likert', true, 'Bagian 1 · Penerimaan', 'Saya merasa terbebani ketika harus memakai beberapa fitur alat bantu tersebut.', 'Versi draf baru, belum diterbitkan.', null, 'beban'],
      ['q_p01', 'v_demo2_1', 'P01', 1, 'likert', true, 'Bagian 1 · Layanan', 'Proses peminjaman mudah saya ikuti.', null, null, 'proses'],
      ['q_p02', 'v_demo2_1', 'P02', 2, 'likert', true, 'Bagian 1 · Layanan', 'Ruang baca nyaman digunakan.', null, null, 'fasilitas'],
      ['q_k01', 'v_demo2_1', 'K01', 3, 'short_text', false, 'Bagian 2 · Komentar', 'Saran singkat untuk layanan (opsional).', 'Jangan tuliskan nama atau data identitas lain.', null, null],
      ['q_old01', 'v_demo4_1', 'L01', 1, 'likert', true, 'Bagian 1', 'Pernyataan pada versi lama yang sudah ditutup.', null, null, null],
    ];
    for (const [id, version, code, ord, type, required, section, label, hint, group, dimension] of questions) {
      await run(
        `INSERT INTO questions (id, version_id, code, ord, type, required, section, label, hint, group_code, dimension_code, direction)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        id,
        version,
        code,
        ord,
        type,
        bool(required),
        section,
        label,
        hint,
        group,
        dimension,
      );
    }

    const fiveLabels = ['Sangat tidak setuju', 'Tidak setuju', 'Netral', 'Setuju', 'Sangat setuju'];
    const fourLabels = ['Tidak sesuai', 'Kurang sesuai', 'Sesuai', 'Sangat sesuai'];
    const likert = async (questionId: string, count: number, labels: string[]) => {
      for (let i = 1; i <= count; i += 1) {
        await run(
          'INSERT INTO question_options (id, question_id, ord, label, value) VALUES (?, ?, ?, ?, ?)',
          `${questionId}_opt${i}`,
          questionId,
          i,
          labels[i - 1] ?? String(i),
          i,
        );
      }
    };
    for (const id of ['q_ad01', 'q_ts01', 'q_ad01_v2', 'q_ts01_v2', 'q_old01']) await likert(id, 5, fiveLabels);
    for (const id of ['q_p01', 'q_p02']) await likert(id, 4, fourLabels);

    await run(
      `INSERT INTO assignments (id, survey_id, version_id, label, participant_ref) VALUES
       ('a_demo01', 's_demo1', 'v_demo1_1', 'Kelas A · 01', 'lokal-01'),
       ('a_demo02', 's_demo1', 'v_demo1_1', 'Kelas A · 02', 'lokal-02'),
       ('a_demo03', 's_demo1', 'v_demo1_1', 'Kelas A · 03', 'lokal-03'),
       ('a_demo04', 's_demo1', 'v_demo1_1', 'Kelas A · 04', 'lokal-04'),
       ('a_demo05', 's_demo1', 'v_demo1_1', 'Kelas A · 05', 'lokal-05'),
       ('a_demo06', 's_demo1', 'v_demo1_1', 'Kelas Uji · 06', 'lokal-06'),
       ('a_perpus01', 's_demo2', 'v_demo2_1', 'Penugasan perpustakaan 01', 'lokal-p01')`,
    );

    const invitations: Array<[string, string, string, string, string, string, string, string | null, string | null, string | null]> = [
      ['inv_01', 'a_demo06', 's_demo1', 'v_demo1_1', 'undangan-demo', 'UND-01-AKTIF', 'active', '2026-12-31T00:00:00Z', null, null],
      ['inv_02', 'a_demo01', 's_demo1', 'v_demo1_1', 'undangan-terpakai', 'UND-02-TERPAKAI', 'used', '2026-12-31T00:00:00Z', '2026-11-09T05:00:00Z', null],
      ['inv_03', 'a_demo03', 's_demo1', 'v_demo1_1', 'undangan-dicabut', 'UND-03-DICABUT', 'revoked', '2026-12-31T00:00:00Z', null, '2026-11-10T02:00:00Z'],
      ['inv_04', 'a_demo04', 's_demo1', 'v_demo1_1', 'undangan-kedaluwarsa', 'UND-04-KEDALUWARSA', 'expired', '2026-11-08T00:00:00Z', null, null],
      ['inv_p01', 'a_perpus01', 's_demo2', 'v_demo2_1', 'undangan-perpus', 'UND-P01-AKTIF', 'active', '2026-12-31T00:00:00Z', null, null],
    ];
    for (const [id, assignment, survey, version, token, code, status, expires, used, revoked] of invitations) {
      await run(
        `INSERT INTO invitations (id, assignment_id, survey_id, version_id, code, token, token_hash, status, expires_at, used_at, revoked_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        assignment,
        survey,
        version,
        code,
        token,
        sha256(token),
        status,
        expires,
        used,
        revoked,
        '2026-11-04T02:10:00Z',
      );
    }

    const links: Array<[string, string, string, string, string, string]> = [
      ['pl_demo1', 's_demo1', 'v_demo1_1', 'link-umum-demo', 'Tautan umum · survei utama', 'active'],
      ['pl_demo2', 's_demo2', 'v_demo2_1', 'link-umum-perpus', 'Tautan umum · perpustakaan', 'active'],
    ];
    for (const [id, survey, version, token, label, status] of links) {
      await run(
        `INSERT INTO public_links (id, survey_id, version_id, token, token_hash, label, status, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
        id,
        survey,
        version,
        token,
        sha256(token),
        label,
        status,
        '2026-11-03T03:00:00Z',
      );
    }

    const responses: Array<[string, string, string, string, string, string, string, string]> = [
      ['r_demo01', 's_demo1', 'v_demo1_1', 'a_demo01', 'p_demo01', 'standalone', 'local', '2026-11-09T05:00:00Z'],
      ['r_demo02', 's_demo1', 'v_demo1_1', 'a_demo02', 'p_demo02', 'standalone', 'local', '2026-11-09T05:04:00Z'],
      ['r_demo03', 's_demo1', 'v_demo1_1', 'a_demo03', 'p_demo03', 'standalone', 'local', '2026-11-09T05:08:00Z'],
      ['r_demo04', 's_demo1', 'v_demo1_1', 'a_demo04', 'p_demo04', 'standalone', 'local', '2026-11-09T05:12:00Z'],
      ['r_demo05', 's_demo1', 'v_demo1_1', 'a_demo05', 'p_demo05', 'standalone', 'local', '2026-11-09T05:16:00Z'],
      ['r_perpus01', 's_demo2', 'v_demo2_1', 'a_perpus01', 'p_perpus01', 'standalone', 'local', '2026-11-10T03:10:00Z'],
    ];
    for (const [id, survey, version, assignment, respondent, mode, source, submitted] of responses) {
      await run(
        `INSERT INTO responses (id, survey_id, version_id, assignment_id, respondent_id, collection_mode, identity_source, submitted_at, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        survey,
        version,
        assignment,
        respondent,
        mode,
        source,
        submitted,
        `key-${id}`,
      );
      await run(
        'INSERT INTO submission_attempts (id, scope, idempotency_key, payload_hash, response_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        `sa_${id}`,
        `${version}:${assignment}`,
        `key-${id}`,
        sha256(`seed:${id}`),
        id,
        submitted,
      );
    }

    const answer = async (responseId: string, code: string, questionId: string, optionValue: number | null, text: string | null = null) => {
      const optionId = optionValue === null ? null : `${questionId}_opt${optionValue}`;
      const skipped = optionValue === null && (text === null || text === '');
      await run(
        `INSERT INTO answers (id, response_id, question_id, question_code, option_id, value, text, skipped)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        `ans_${responseId}_${code}`,
        responseId,
        questionId,
        code,
        optionId,
        optionValue,
        text,
        bool(skipped),
      );
    };
    await answer('r_demo01', 'AD01', 'q_ad01', 4);
    await answer('r_demo01', 'TS01', 'q_ts01', 2);
    await answer('r_demo01', 'K02', 'q_k02', null, 'Perlu panduan singkat.');
    await answer('r_demo02', 'AD01', 'q_ad01', 2);
    await answer('r_demo02', 'TS01', 'q_ts01', 3);
    await answer('r_demo02', 'K02', 'q_k02', null);
    await answer('r_demo03', 'AD01', 'q_ad01', 4);
    await answer('r_demo03', 'TS01', 'q_ts01', 5);
    await answer('r_demo03', 'K02', 'q_k02', null, 'Koneksi lambat.');
    await answer('r_demo04', 'AD01', 'q_ad01', 5);
    await answer('r_demo04', 'TS01', 'q_ts01', 1);
    await answer('r_demo04', 'K02', 'q_k02', null);
    await answer('r_demo05', 'AD01', 'q_ad01', 3);
    await answer('r_demo05', 'TS01', 'q_ts01', 4);
    await answer('r_demo05', 'K02', 'q_k02', null);
    await answer('r_perpus01', 'P01', 'q_p01', 3);
    await answer('r_perpus01', 'P02', 'q_p02', 2);
    await answer('r_perpus01', 'K01', 'q_k01', null, 'Tambahkan jam buka.');

    const consents: Array<[string, string, string, string, string, string, string, boolean, string, string | null]> = [
      ['c_demo01', 's_demo1', 'v_demo1_1', '1.0', 'Persetujuan wali', 'granted', '2026-11-09T04:58:00Z', true, 'self_attested', 'ref-wali-sintetis-01'],
      ['c_demo02', 's_demo1', 'v_demo1_1', '1.0', 'Persetujuan wali', 'pending', '2026-11-09T05:02:00Z', false, 'pending', null],
      ['c_perpus01', 's_demo2', 'v_demo2_1', '1.0', 'Persetujuan diri', 'granted', '2026-11-10T03:08:00Z', true, 'not_required', null],
    ];
    for (const [id, survey, version, notice, basis, status, recorded, click, guardian, ref] of consents) {
      await run(
        `INSERT INTO consent_records (id, survey_id, version_id, notice_version, basis, status, recorded_at, respondent_click, guardian_evidence_status, guardian_evidence_ref)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        survey,
        version,
        notice,
        basis,
        status,
        recorded,
        bool(click),
        guardian,
        ref,
      );
    }

    const grants: Array<[string, string, string, boolean, boolean, boolean]> = [
      ['g_01', 'u_creator_a', 's_demo1', false, true, false],
      ['g_02', 'u_petugas', 's_demo1', true, true, true],
      ['g_03', 'u_creator_b', 's_demo3', false, false, false],
      ['g_04', 'u_creator_a', 's_demo2', false, true, false],
    ];
    for (const [id, account, surveyId, read, exportData, text] of grants) {
      await run(
        'INSERT INTO access_grants (id, account_id, survey_id, can_read_individual, can_export, can_read_free_text) VALUES (?, ?, ?, ?, ?, ?)',
        id,
        account,
        surveyId,
        bool(read),
        bool(exportData),
        bool(text),
      );
    }

    const audit: Array<[string, string, string, string, string, string]> = [
      ['log_01', 'u_creator_a', 'Publikasi versi', 's_demo1 · v1', 'berhasil', '2026-11-03T03:00:00Z'],
      ['log_02', 'u_creator_a', 'Buat undangan', 's_demo1 · penugasan', 'berhasil', '2026-11-04T02:10:00Z'],
      ['log_03', 'u_petugas', 'Baca jawaban individual', 's_demo1 · v1', 'berhasil', '2026-11-10T06:00:00Z'],
      ['log_04', 'u_creator_b', 'Unduh hasil', 's_demo1 · v1', 'ditolak', '2026-11-10T06:05:00Z'],
      ['log_05', 'u_creator_a', 'Cabut undangan', 's_demo1 · kode', 'berhasil', '2026-11-10T02:00:00Z'],
      ['log_06', 'layanan-15', 'Ambil skema', 's_demo1 · v1', 'gagal', '2026-11-11T01:00:00Z'],
      ['log_07', 'u_admin', 'Ubah peran akun', 'akun u_creator_b', 'berhasil', '2026-11-12T04:00:00Z'],
      ['log_08', 'u_creator_a', 'Ekspor CSV', 's_demo1 · v1', 'berhasil', '2026-11-12T07:30:00Z'],
    ];
    for (const [id, actor, action, object, outcome, at] of audit) {
      await run(
        `INSERT INTO audit_logs (id, actor, action, object, outcome, at, account_id)
         VALUES (?, ?, ?, ?, ?, ?, (SELECT id FROM accounts WHERE id = CAST(? AS text)))`,
        id,
        actor,
        action,
        object,
        outcome,
        at,
        actor,
      );
    }

    const events: Array<[string, string, string, string, string, number, string, boolean, string | null, string | null]> = [
      ['ie_01', 'ev_demo01', 'survey.submitted', 'module_13', 'delivered', 1, '2026-11-09T05:00:02Z', true, 'r_demo01', null],
      ['ie_02', 'ev_demo02', 'survey.submitted', 'module_13', 'pending', 2, '2026-11-09T05:04:02Z', true, 'r_demo03', 'Timeout simulasi'],
      ['ie_03', 'ev_demo03', 'survey-data.read', 'module_15', 'failed', 3, '2026-11-11T01:00:00Z', true, null, 'Kredensial layanan belum disepakati'],
    ];
    for (const [id, eventId, type, target, status, attempts, at, simulated, responseId, lastError] of events) {
      await run(
        `INSERT INTO integration_events (id, event_id, type, target, status, attempts, at, simulated, response_id, last_error, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        id,
        eventId,
        type,
        target,
        status,
        attempts,
        at,
        bool(simulated),
        responseId,
        lastError,
      );
    }

    await run(
      `INSERT INTO data_requests (id, type, contact, note, status, created_at, updated_at, handled_by, outcome_note)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
      'dr_demo01',
      'access',
      'privasi@organisasi.contoh',
      'Permintaan akses data sintetis untuk demonstrasi.',
      'pending',
      nowIso(),
      nowIso(),
    );
  });

  return true;
}

export { SEED_PASSWORD, addYears };
