# Svara

Aplikasi survei berbasis versi. Creator menyusun instrumen, menerbitkan tautan per versi, mengumpulkan jawaban dengan persetujuan, lalu membaca hasil agregat dan mengekspor data sesuai izin tiap akun.

Repo ini memuat kode lengkap yang bisa dijalankan sendiri: UI Next.js, API Express, skema PostgreSQL, data demo sintetis, dan skrip verifikasi. Seluruh basis data bersifat sintetis. Tidak ada peserta nyata, pekerjaan lapangan, atau klaim kepatuhan hukum, jadi proyek ini bukan produk siap pakai.

**Daftar isi**

- [Fitur](#fitur)
- [Teknologi](#teknologi)
- [Mulai cepat](#mulai-cepat)
- [Alur pemakaian](#alur-pemakaian)
- [Arsitektur](#arsitektur)
- [Rute](#rute)
- [Keamanan dan privasi](#keamanan-dan-privasi)
- [Organisasi dan lingkup](#organisasi-dan-lingkup)
- [Konfigurasi](#konfigurasi)
- [Basis data dan migrasi](#basis-data-dan-migrasi)
- [Menjalankan](#menjalankan)
- [Pengujian](#pengujian)
- [Deployment](#deployment)
- [Akun dan tautan demo](#akun-dan-tautan-demo)
- [Skrip demo](#skrip-demo)
- [Dokumentasi](#dokumentasi)
- [Batasan](#batasan-yang-disengaja)
- [Lisensi](#lisensi)

## Fitur

| Area | Isi |
| --- | --- |
| Instrumen | Editor pertanyaan Likert, pilihan tunggal, dan isian singkat; kode item unik; validasi sebelum simpan dan sebelum terbit |
| Versi | Terbitkan, duplikasi, tutup, dan arsipkan versi; tautan selalu menunjuk satu versi tetap |
| Distribusi | Tautan umum dan undangan individual berkode, dengan status, masa berlaku, dan pencabutan |
| Pengumpulan | Persetujuan tercatat di server, kiriman idempoten, bukti terima yang dapat dibuka kembali |
| Hasil | Agregat per versi, ekspor CSV, dan codebook per versi |
| Organisasi | Dua lingkup survei (individual dan organisasi), profil kebijakan per organisasi, anggota dan suspend, undangan creator, audit organisasi |
| Akses | Sesi cookie HttpOnly, guard peran di server, izin baca/ekspor/teks bebas per akun dan survei, audit log append-only dengan `account_id` dan `organization_id` |
| UI | Tata letak responsif dari lebar ponsel, navigasi keyboard, dialog konfirmasi native, pesan galat terhubung ke field |

## Teknologi

- Next.js 16 (App Router, React 19) untuk UI dan middleware CSP.
- Express 5 untuk API, aturan akses, dan audit.
- PostgreSQL 17 dengan migrasi SQL versioned, diakses lewat `pg` Pool.
- Tailwind CSS 4, TypeScript, pnpm.
- Docker Compose untuk basis data lokal dan deployment `web` / `api` / `db`.

## Mulai cepat

Prasyarat: Node.js 24 atau lebih baru, PostgreSQL 16/17, dan Docker Desktop untuk basis data lokal. Repo ini memakai npm (tanpa `packageManager`), jadi `npm install`/`npm run dev` adalah jalur utama; `pnpm` dan `npm` sama-sama bisa karena dependensi ditaruh di `node_modules` biasa.

```bash
npm install
docker compose up -d db
export DATABASE_URL='postgres://svara:svara_dev_password@127.0.0.1:5432/svara'
SEED_DEMO=1 npm run db:reset
npm run dev
```

PowerShell:

```powershell
$env:DATABASE_URL='postgres://svara:svara_dev_password@127.0.0.1:5432/svara'
$env:SEED_DEMO='1'
npm run db:reset
npm run dev
```

`npm run dev` menjalankan dua layanan sekaligus (API `:3001` dan Web `:3000`) lewat `scripts/dev.mjs`. Sebelum mulai script memeriksa `DATABASE_URL`, koneksi PostgreSQL di `127.0.0.1:5432`, dan port kosong, lalu berhenti dengan pesan jelas kalau salah satunya gagal. Ini mencegah galat `ECONNREFUSED 127.0.0.1:3001` di halaman masuk saat API tidak ikut hidup. Ctrl+C mematikan keduanya, termasuk proses anak di Windows.

Buka `http://127.0.0.1:3000` dan masuk sebagai `creator.a@svara.local` dengan sandi `SvaraDemo123!`. Daftar survei berisi tiga contoh milik akun itu. Buka salah satunya untuk melihat editor, publikasi, tautan responden, dan hasil.

Tanpa `SEED_DEMO=1` basis data tetap kosong dan admin pertama dibuat lewat `pnpm admin:bootstrap`.

## Alur pemakaian

1. Creator menyusun draf instrumen: judul, tujuan, petunjuk, pertanyaan, opsi, dan kode item.
2. Draf diterbitkan menjadi versi tetap. Tautan umum dan undangan menunjuk versi itu.
3. Responden membuka tautan, membaca pemberitahuan, memberi persetujuan, mengisi, lalu menerima bukti kirim.
4. Creator membaca hasil agregat per versi. Teks bebas, jawaban individual, dan ekspor memerlukan izin terpisah.
5. Perubahan berikutnya membuat versi baru; versi lama tetap terbaca dan dapat ditutup.

## Arsitektur

```text
Browser
  |
  v
Next.js :3000  --rewrite /api/:path*-->  Express :3001  -->  PostgreSQL 17
rute UI, metadata,                       sesi, izin,         satu-satunya
middleware CSP nonce                     audit, migrasi      sumber data
```

Next.js merender UI di server dan memanggil API lewat rewrite `/api/:path*`. Express memegang seluruh aturan akses, transaksi, dan audit. PostgreSQL adalah satu-satunya sumber data runtime.

### Peta kode

```text
server/          Express: rute API, migrasi SQL, seed, skrip demo, uji
src/app/         Rute Next.js, layout, metadata
src/proxy.ts     Middleware: CSP nonce dan header keamanan
src/screens/     Layar per area: creator, responden, admin
src/components/  Shell, navigasi, dialog, toast, primitif UI
src/lib/         Klien API, store bootstrap, guard navigasi, util
docs/            Bukti uji demo
scripts/         Smoke test web
```

- `server/db.ts` menyediakan `all/get/run/withTx` async. Transaksi memakai satu client lewat `AsyncLocalStorage`, jadi query di dalam `withTx` ikut rollback saat error.
- `server/migrations/` berisi skema 21 tabel dengan foreign key, unique constraint, dan indeks; `schema_migrations` mencatat versi dan checksum.
- `src/lib/server/guards.ts` membaca cookie sesi lalu memanggil `/api/v1/bootstrap` untuk guard peran di server component.
- `src/components/CreatorBootGate.tsx` menahan layar creator sampai bootstrap selesai, sehingga tidak merender data kosong.
- `src/lib/navigation-guard.tsx` memblokir navigasi saat draf belum tersimpan (`window.confirm` untuk tautan, `beforeunload` untuk reload/tab).
- `src/components/ui.tsx` memuat primitif bersama: `Field` dengan `aria-invalid`/`aria-describedby`, `ActionLink` dengan `disabledReason`, `ConfirmDialog` berbasis `<dialog>` native, dan `Toast` dengan `role="alert"` untuk galat.

## Rute

`/`, `/auth/login`, `/auth/register`, `/privacy`, `/terms`, `/creator`, `/creator/surveys/[id]/{edit,preview,publish,share,results,settings,history}`, `/s` (kode undangan), `/s/[token]`, `/s/[token]/form`, `/s/[token]/review`, `/s/[token]/receipt`, `/admin`, `/admin/{accounts,platform,audit,integration,requests,org}`, dan 404 untuk path lain.

`/s` dan `/s/[token]/*` publik tanpa guard. `/creator` menolak `super_admin`, `/admin` hanya untuk `super_admin`, dan `/admin/org` hanya untuk `org_admin` yang terikat organisasi. Setiap route `/creator/surveys/[id]/*` memeriksa kepemilikan dan merender "Survei tidak ditemukan" untuk survei milik akun lain.

## Keamanan dan privasi

- Sesi cookie HttpOnly dengan TTL, hash kata sandi `scrypt`, dan header `X-Svara-Client` untuk mutasi.
- Persetujuan wajib tercatat di server sebelum metadata formulir atau pengiriman diproses. `notice_version` diambil dari sumber kebijakan survei: `organizations` untuk survei berlingkup organisasi, `platform_profile` untuk survei individual.
- Izin baca individual, ekspor, dan teks bebas terpisah per akun dan survei. Ekspor tanpa izin ditolak `403` dan dicatat.
- Satu-satunya peran akun adalah `super_admin`, `org_admin`, dan `creator`. Responden tidak memakai akun; peran `authorized_officer` sudah tidak ada dan ditolak `422` oleh `PATCH /admin/accounts/:id`.
- Lingkup `/org/*` selalu diambil dari sesi (`accounts.organization_id`), tidak pernah dari body atau query; akun tanpa organisasi ditolak `403`.
- Setiap baris audit mencatat `account_id` pelaku dan `organization_id` dari sesi, sehingga baca jawaban individual, ekspor CSV, dan ekspor kodebook dapat ditelusuri per organisasi. `super_admin` tanpa organisasi menulis `organization_id` NULL.
- Respons publik disimpan dengan kunci idempotensi; bukti hanya dapat dibuka dengan kunci yang sama.
- Rate limit login dan pengiriman, audit log append-only, CSP nonce tanpa `unsafe-inline` pada `script-src`, serta `X-Frame-Options`, `Referrer-Policy`, dan `Permissions-Policy`.
- Hapus pertanyaan, tutup versi, arsipkan survei, dan cabut undangan meminta konfirmasi eksplisit.

## Organisasi dan lingkup

Tenancy bersandar pada dua tabel kebijakan dan dua kolom kepemilikan:

- `organizations` berisi satu baris per organisasi pelanggan: `name`, `organization_type`, `respondent_age_category`, `consent_mode`, `policy_url`, `terms_url`, `retention_days`, `data_request_contact`, `cross_border_transfer`, dan `notice_version` (`server/migrations/005_organizations.sql:5-16`, `server/migrations/006_organization_profile.sql:4-5`).
- `platform_profile` hanya boleh berisi satu baris ber-`id='platform'` (`CHECK (id = 'platform')`) dan tidak memiliki `respondent_age_category` maupun `consent_mode` (`server/migrations/005_organizations.sql:18-30`).
- `accounts.organization_id` dan `surveys.organization_id` menautkan akun dan survei ke organisasi; keduanya dapat NULL (`server/migrations/005_organizations.sql:32-33`).

### Lingkup survei saat dibuat

`POST /surveys` menerima `owner_scope`: `individual` atau `organization`; nilai lain ditolak `422` dan nilai kosong berarti `individual` (`server/routes/surveys.ts:309-313`). Hanya `creator` yang boleh membuat survei (`server/routes/surveys.ts:306`).

- `individual` menyimpan `surveys.organization_id = NULL`; survei menjadi milik pembuatnya (`server/routes/surveys.ts:318`).
- `organization` menyalin `accounts.organization_id` akun pembuat ke survei; akun tanpa organisasi ditolak `403` (`server/routes/surveys.ts:315-318`).
- `surveys.profile_id` tetap wajib dan masih merujuk baris `profiles` sintetis (`server/routes/surveys.ts:319-328`). Kebijakan yang dipakai survei dibaca dari `organization_id`, bukan dari `profile_id`.

Di UI, `/creator` menampilkan kontrol "Lingkup" di samping tombol "Buat draf baru" hanya bila akun terikat organisasi, dan nilai awalnya `organization`; akun tanpa organisasi tidak melihat kontrol itu dan selalu membuat survei individu. Pilihan itu dikirim sebagai `owner_scope`, dan baris survei menampilkan "Lingkup organisasi" atau "Lingkup individu" (`src/screens/CreatorCore.tsx:167-184`, `src/lib/api.ts:163-167`).

Apa artinya untuk visibilitas (`server/http.ts:108-144`):

| Akun | Daftar survei | Mengelola |
| --- | --- | --- |
| `super_admin` | Semua survei | Semua survei |
| `org_admin` | Survei dengan `organization_id` organisasinya | Survei organisasinya saja; survei `organization_id` NULL tidak pernah jatuh ke `org_admin` |
| `creator` | Survei miliknya | Survei miliknya |
| Selain itu | Survei yang diberi grant | Tidak ada, hanya grant |

Mengelola berarti pemilik (`owner_id`) atau `org_admin` dari organisasi survei; akun tanpa organisasi tidak dapat mengelola lewat jalur `org_admin` (`server/http.ts:108-116`). Creator rekan satu organisasi tidak otomatis melihat atau mengelola survei rekan tersebut; jalurnya tetap grant per survei.

### Sumber kebijakan dan notice

- Setiap survei membaca tepat satu sumber kebijakan, dipilih dari `surveys.organization_id`: baris `organizations` bila tidak NULL, baris `platform_profile` bila NULL. Tidak ada fallback diam-diam ke profil lain (`server/http.ts:191-201`, `server/http.ts:218-234`, dipakai `server/routes/surveys.ts:158`).
- `notice_version` versi yang diterbitkan berasal dari sumber yang sama saat draf dibuat (`server/routes/surveys.ts:329-330`).

### Siapa boleh membaca jawaban dan teks bebas

- Pemilik survei dan `org_admin` organisasi survei itu membaca penuh: jawaban individual, teks bebas, agregat, ekspor, dan kodebook (`server/http.ts:169-184`).
- `super_admin` tidak otomatis membaca jawaban individual; tanpa grant permintaan ditolak `403` (`server/http.ts:170-174`, diuji di `server/test/api.test.ts:1026-1029`).
- Pemegang grant tetap terikat `survey_settings`: grant `can_read_individual` hanya berlaku bila `allow_individual` aktif, dan grant `can_read_aggregate` hanya berlaku bila `allow_results` aktif (`server/http.ts:154-178`).
- Setiap baca individual dan ekspor dicatat dengan `account_id` pelaku serta `organization_id` sesi, berhasil maupun ditolak (`server/http.ts:297-305`, diuji di `server/test/api.test.ts:1030-1054`).

### Permukaan admin organisasi

`/admin/org` adalah satu layar untuk `org_admin`: profil organisasi, anggota dan suspend, kode undangan creator beserta pencabutannya, dan log audit organisasi (`src/app/admin/org/page.tsx:10-14`, `src/screens/Org.tsx:366-410`). Semua endpoint memakai awalan `/api/v1` dan hanya menerima `org_admin` yang terikat organisasi:

| Endpoint | Perilaku |
| --- | --- |
| `GET /org/profile` | Akun berorganisasi mendapat profil organisasinya; akun tanpa organisasi (termasuk `super_admin`) mendapat `platform_profile` dengan `source: 'platform'` (`server/routes/org.ts:50-66`) |
| `PUT /org/profile` | Hanya `org_admin` berorganisasi; field yang tidak dikirim mempertahankan nilai tersimpan, dan `respondent_age_category` minor/mixed dengan `consent_mode=self` ditolak `422 consent_mode_mismatch` (`server/routes/org.ts:67-159`) |
| `GET /org/members` | Daftar akun dengan `organization_id` sesi; cache `no-store` (`server/routes/org.ts:160-174`) |
| `PATCH /org/members/:id` | Hanya status `active`/`suspended` untuk anggota berperan `creator` di organisasi sendiri; akun di luar organisasi dijawab `404` agar keberadaannya tidak bocor (`server/routes/org.ts:175-199`) |
| `GET /org/invitations` | Daftar maksimal 50 kode terbaru organisasi sesi (`INVITATION_LIST_LIMIT`); status `active`/`used`/`revoked`/`expired` dihitung dari kolom waktu dengan prioritas used > revoked > expired > active, bukan disimpan (`server/routes/org.ts:200-220`) |
| `POST /org/invitations` | Membuat satu kode `ORG-...` sekali pakai untuk organisasi sesi, berlaku 14 hari (`server/routes/org.ts:221-257`) |
| `DELETE /org/invitations/:id` | Mencabut kode yang belum terpakai; kode terpakai ditolak `409 invitation_used`, kode organisasi lain dijawab `404 invitation_not_found`, pencabutan ulang tetap `200` (`server/routes/org.ts:258-291`) |
| `GET /org/audit` | Baris audit organisasi tanpa metadata mentah; `limit` 1-500, default 100 (`server/routes/org.ts:292-307`) |

Lingkup organisasi diambil dari sesi lewat `requireOrgScope`, bukan dari body atau query, dan akun tanpa organisasi ditolak `403` sebelum data apa pun disentuh (`server/routes/org.ts:151-156`).

### Onboarding creator lewat kode undangan organisasi

1. `org_admin` membuat kode di `/admin/org` lewat `POST /org/invitations` dan membagikannya secara manual; setiap kode berlaku tepat 14 hari sejak dibuat (`expires_at` wajib terisi, termasuk untuk baris lama yang di-backfill migrasi 009) dan dapat dicabut dari tabel undangan sebelum terpakai (`server/routes/org.ts:221-291`).
2. Pendaftar mengisi kolom "Kode undangan organisasi" di `/auth/register`; UI mengirimnya sebagai `invite_code` (`src/screens/Register.tsx:103`, `src/screens/Register.tsx:185`).
3. `POST /auth/register` mencari kode lalu menolak `422 invalid_invite_code` bila kode asing, sudah dipakai, dicabut, atau kedaluwarsa — alasan spesifik tidak dibocorkan (`server/routes/auth.ts:147-159`). Akun baru berperan `creator` dengan `organization_id` dari undangan, lalu kode ditandai terpakai di transaksi yang sama; guard `WHERE` menutup balapan dengan pencabutan (`server/routes/auth.ts:162-192`).
4. Tanpa `invite_code`, akun dibuat tanpa organisasi.

### Menetapkan lingkup akun

`super_admin` menetapkan organisasi sebuah akun lewat `PATCH /admin/accounts/:id` dengan `organization_id` berupa id organisasi atau `null` (`server/routes/admin.ts:85-116`). Aturannya:

- id yang tidak ada di `organizations` ditolak `422 unknown_organization`;
- `org_admin` tanpa organisasi ditolak `422 organization_required`, karena guard `/org/*` membaca `accounts.organization_id`;
- akun `super_admin` tidak boleh terikat organisasi: `422 super_admin_scope`, termasuk saat akun berorganisasi dipromosikan;
- setiap perubahan dicatat pada log audit dengan `metadata.organization_id` (`server/routes/admin.ts:115`).

Di `/admin/accounts`, kolom "Organisasi" memuat daftar dari `bootstrap.organizations` yang hanya dikirim ke `super_admin` (`server/bootstrap.ts:317-321`), dan pemilih peran kini mencakup `org_admin` (`src/screens/Admin.tsx:206-236`). Memindahkan akun tidak mengubah `surveys.organization_id` yang sudah ada: survei tetap milik organisasi tempat ia dibuat.

### Membuat organisasi baru

Onboarding satu langkah lewat `POST /admin/organizations` (`server/routes/admin.ts:132`): organisasi dan admin pertamanya dibuat dalam satu transaksi, sehingga tidak ada organisasi tanpa pengelola. Body wajib memuat `name`, `organization_type` (`school` atau `organization`), dan `admin` berisi `display_name`, `email`, serta `password`.

- `organization_type` selain dua nilai itu ditolak `422 validation_error`; `admin.password` mengikuti kebijakan yang sama dengan pendaftaran (`422 weak_password`).
- Email yang sudah terdaftar ditolak `409 email_taken`; untuk akun lama, tautkan lewat `PATCH /admin/accounts/:id`.
- `respondent_age_category`/`consent_mode` opsional dengan default `adult`/`self`; kombinasi minor/mixed dengan `self` ditolak `422 consent_mode_mismatch` (PRD §1.2).
- `policy_url`/`terms_url` default ke halaman `/kebijakan-privasi` dan `/ketentuan-layanan`, lalu dapat diubah `org_admin` lewat `PUT /org/profile`.
- Akun admin hasil onboarding belum mencatat persetujuan kebijakan (`consent_version` NULL) karena belum ada yang menyetujui.
- Respons memuat `organization` dan `account` (tanpa hash kata sandi); perubahan dicatat pada log audit `Buat organisasi` dengan `metadata.admin_account_id`.

Di `/admin/accounts`, kartu "Organisasi" menampilkan organisasi beserta jumlah akunnya dan formulir pembuatan; setelah sukses daftar akun serta opsi organisasi ikut diperbarui lewat `refreshBootstrap`.

### Profil platform

`platform_profile` dipakai survei dan akun tanpa organisasi, dan `super_admin` mengubahnya lewat `/admin/platform` (`src/app/admin/platform/page.tsx`). Endpoint-nya ada di router admin sehingga otomatis hanya untuk `super_admin` (`server/routes/admin.ts:45`):

| Endpoint | Perilaku |
| --- | --- |
| `GET /admin/platform-profile` | Membaca satu baris `id='platform'` dengan cache `no-store`; 404 `profile_missing` bila baris tidak ada |
| `PUT /admin/platform-profile` | Field yang tidak dikirim mempertahankan nilai tersimpan; `organization_name`, `organization_type`, `policy_url`, `terms_url` wajib; `retention_days` bilangan bulat >= 0 atau null; `cross_border_transfer` hanya `boolean` (null "belum diputuskan" berasal dari seed dan tidak dapat dikembalikan lewat API); setiap perubahan diaudit `Ubah profil platform` |

`notice_version` dan `updated_at` tidak dapat diubah dari sini: `notice_version` naik saat teks kebijakan berubah, `updated_at` diisi server. Profil ini tidak memiliki `respondent_age_category` maupun `consent_mode`, karena aturan persetujuan hanya didefinisikan per organisasi. Perubahan di sini tidak menyentuh baris `organizations`; `GET /org/profile` untuk akun berorganisasi tetap membaca organisasinya.

### Belum tersedia

- `org_admin` belum dapat mengubah peran anggota, hanya status creator (`server/routes/org.ts:175-199`).

## Konfigurasi

Semua konfigurasi dibaca dari environment. Contoh ada di `.env.example`; jangan commit nilai rahasia produksi.

| Variabel | Default | Keterangan |
| --- | --- | --- |
| `PORT` | `3000` web, `3001` API | Port HTTP per layanan |
| `HOST` | `127.0.0.1` | Alamat bind API |
| `API_INTERNAL_URL` | `http://127.0.0.1:3001` | Basis URL bootstrap untuk guard server component |
| `API_ORIGIN` | `http://127.0.0.1:3001` | Target rewrite `/api/:path*`; dibekukan saat `next build` |
| `API_ORIGIN_BUILD` | `http://api:3001` | Nilai `API_ORIGIN` untuk build image web Docker Compose |
| `DATABASE_URL` | wajib | Koneksi PostgreSQL runtime; tidak ada fallback SQLite |
| `PG_POOL_MAX` | `10` | Batas koneksi pool (1-50) |
| `PG_IDLE_TIMEOUT_MS` | `10000` | Batas idle koneksi |
| `PG_CONNECTION_TIMEOUT_MS` | `5000` | Batas waktu membuka koneksi |
| `TEST_DATABASE_URL` | kosong | Basis data uji terpisah untuk `pnpm test` dan demo |
| `APP_ORIGIN` | `http://127.0.0.1:3000,http://localhost:3000` di luar production; kosong di production | Origin yang diizinkan untuk mutasi; pisahkan beberapa origin dengan koma. Wajib diisi di production karena rewrite mengganti Host |
| `COOKIE_SECURE` | `0` | Set `1` di belakang HTTPS |
| `ENABLE_HSTS` | `0` | Set `1` hanya setelah deployment HTTPS siap |
| `SESSION_TTL_HOURS` | `8` | Umur sesi (jam) |
| `INTEGRATION_TOKEN` | kosong | Bearer untuk `/api/v1/integration/survey-data`; tanpa nilai, endpoint selalu menolak |
| `SEED_DEMO` | `0` | Harus `1` untuk memuat data demo; ditolak saat `NODE_ENV=production` |
| `SEED_PASSWORD` | kata sandi seed lokal | Sandi akun sintetis; hanya dipakai bila `SEED_DEMO=1` |
| `AC15_ADMIN_DATABASE_URL` | `DATABASE_URL` | Koneksi berizin `CREATE DATABASE` untuk demo AC15 |

### Bootstrap admin

Server tidak mengisi basis data kosong dengan akun demo. Untuk deployment baru, buat admin pertama secara eksplisit:

```bash
BOOTSTRAP_ADMIN_EMAIL=admin@example.org \
BOOTSTRAP_ADMIN_NAME=Administrator \
BOOTSTRAP_ADMIN_PASSWORD='Sandi-Kuat-Dari-Secret-Manager-2026!' \
pnpm admin:bootstrap
```

`BOOTSTRAP_ADMIN_PASSWORD` minimal 12 karakter dan memakai minimal 3 dari: huruf kecil, huruf besar, angka, simbol. Script idempoten: email yang sudah menjadi `super_admin` tidak ditimpa. Jangan menaruh sandi nyata di shell history, `.env` yang ter-commit, atau argumen command line; gunakan secret manager atau environment. `NODE_ENV=production SEED_DEMO=1` menghentikan startup.

### Registrasi creator

`/auth/register` membuat akun baru dengan peran `creator`, memasang sesi, dan mengarahkan ke `/creator`. Backend memberlakukan email unik, sandi 12-256 karakter dengan minimal tiga kelas karakter, persetujuan kebijakan/ketentuan, rate limit per alamat IP, dan mencatat registrasi ke audit log.

Versi dan waktu persetujuan disimpan di `accounts.consent_version` dan `accounts.consent_accepted_at`, serta metadata audit `Registrasi`. Naikkan `CURRENT_CONSENT_VERSION` di `server/routes/auth.ts` ketika teks kebijakan privasi atau ketentuan layanan berubah; akun lama tetap `NULL` karena dibuat sebelum bukti persetujuan ada.

Registrasi publik belum memverifikasi email dan tidak membuat grant baca jawaban. Super admin mengatur peran, status, dan grant lewat `/admin/accounts`; akun yang disuspend tidak dapat masuk. Organisasi akun baru hanya dapat ditentukan saat pendaftaran lewat `invite_code`; super admin belum dapat menetapkannya lewat `/admin/accounts`.

## Basis data dan migrasi

- `server/migrations/*.sql` diterapkan berurutan dan dicatat di `schema_migrations` (versi + checksum).
- Runner (`server/migrate.ts`) memakai advisory lock, satu transaksi per migrasi, dan rollback bila gagal.
- `pnpm db:migrate` menerapkan migrasi yang belum ada.
- `SEED_DEMO=1 pnpm db:reset` menghapus schema `public`, menerapkan semua migrasi, lalu memuat data sintetis.
- `pnpm test` memakai basis data uji terpisah (`TEST_DATABASE_URL`), me-reset schema, lalu menjalankan migrasi.
- Migrasi yang mengubah checksum yang sudah tercatat ditolak; buat file migrasi baru, jangan edit yang sudah dirilis.
- Masa berlaku kode undangan organisasi (`organization_invitations.expires_at`) wajib terisi sejak `009_organization_invitation_expiry_backfill.sql`. Migrasi itu mengisi baris lama dengan `created_at + 14 hari` (ISO-8601 UTC) lalu memasang `NOT NULL`; tidak ada lagi kode tanpa batas.
- Data SQLite lama tidak diimpor otomatis. Ekspor/impor data nyata harus jadi prosedur terpisah dengan verifikasi.

## Menjalankan

```bash
npm run dev     # API :3001 + Next.js :3000 (dev server, hot reload)
npm run build
npm start       # API + Next production, migrasi berjalan saat startup API
```

Kedua perintah menjalankan dua proses lewat `scripts/dev.mjs`: Express di `:3001` dan Next.js di `:3000`. Browser hanya memanggil origin web; rewrite Next meneruskan `/api/:path*` ke `API_ORIGIN`. Menjalankan `next start` atau `next dev` sendirian berarti tidak ada API, dan halaman masuk akan melaporkan "Permintaan tidak dapat diselesaikan" (`ECONNREFUSED 127.0.0.1:3001`).

Kalau port dilaporkan terpakai, hentikan proses lama dulu: `netstat -ano | findstr :3001` lalu `taskkill /PID <pid> /T /F` di Windows.

Migrasi berjalan saat startup API sebelum menerima permintaan. Untuk basis data kosong, jalankan `pnpm admin:bootstrap`.

## Pengujian

```bash
pnpm typecheck      # next typegen + TypeScript web + server
pnpm lint           # ESLint
pnpm build          # typecheck + next build
pnpm db:migrate     # terapkan migrasi ke DATABASE_URL
SMOKE_WEB_ORIGIN=http://127.0.0.1:3000 \
  SMOKE_EMAIL=admin@example.org SMOKE_PASSWORD='...' \
  pnpm smoke:web    # root, login, CSP nonce, rewrite health, login + bootstrap
```

Suite memakai basis data uji terpisah; tanpa `TEST_DATABASE_URL` skrip berhenti sebelum menyentuh data apa pun.

```bash
docker compose exec db psql -U postgres -c 'CREATE DATABASE svara_test OWNER svara'   # sekali saja
TEST_DATABASE_URL='postgres://svara:svara_dev_password@127.0.0.1:5432/svara_test' pnpm test
```

`pnpm test` menjalankan `typecheck`, uji migrasi, suite HTTP, dan gate seed/policy. CI (`.github/workflows/ci.yml`) menjalankan migrasi, lint, `pnpm test`, `pnpm build`, lalu build image Docker dan smoke test terhadap API produksi.

Jika Docker Desktop tidak berjalan, semua login mengembalikan `500` karena API kehilangan koneksi PostgreSQL; itu kegagalan lingkungan, bukan bug UI.

## Deployment

Tiga layanan terpisah: `web` (Next.js standalone), `api` (Express), dan `db` (Postgres).

```bash
docker compose build
docker compose up -d db
docker compose run --rm \
  -e BOOTSTRAP_ADMIN_EMAIL=admin@example.org \
  -e BOOTSTRAP_ADMIN_NAME=Administrator \
  -e BOOTSTRAP_ADMIN_PASSWORD='Sandi-Kuat-Dari-Secret-Manager-2026!' \
  api tsx server/scripts/bootstrap-admin.ts
docker compose up -d
```

- `db` memakai `postgres:17-alpine` dengan healthcheck dan volume `svara_pgdata`.
- Peran aplikasi `svara` dibuat oleh `docker/postgres/init/01-app-role.sh`: LOGIN, bukan superuser, tanpa CREATEDB/CREATEROLE; hanya memiliki basis data `svara`.
- `POSTGRES_PASSWORD`, `POSTGRES_USER`, dan `POSTGRES_DB` dapat dioverride; `DATABASE_URL` aplikasi dirakit dari nilai yang sama.
- `api` menjalankan `tsx server/index.ts` pada `:3001`, tanpa static hosting.
- `web` menjalankan output `standalone` Next.js pada `:3000`; guard server membaca `API_INTERNAL_URL=http://api:3001`.
- Rewrite web dibekukan saat build (`API_ORIGIN_BUILD`, default `http://api:3001`).
- Port host hanya bind ke `127.0.0.1:3000` (web), `127.0.0.1:3001` (api), dan `127.0.0.1:5432` (db); letakkan reverse proxy/TLS di depan web.
- Set `APP_ORIGIN` ke origin publik web (boleh beberapa origin dipisah koma), lalu `COOKIE_SECURE=1` dan `ENABLE_HSTS=1` setelah HTTPS aktif.
- Jangan set `SEED_DEMO=1` di production; container API memakai `NODE_ENV=production` dan menolak startup.

### Ingress produksi

Pisahkan trafik di reverse proxy/load balancer:

| Path | Tujuan |
| --- | --- |
| `/api/*` | Express (`api:3001`) |
| semua path lain | Next.js (`web:3000`) |

Dengan pembagian ini Next tidak memproksikan API di produksi. Rewrite `/api/:path*` tetap ada untuk pengembangan dan deployment satu-origin; jangan mengandalkannya sebagai jalur produksi.

## Akun dan tautan demo

Dibuat hanya oleh `SEED_DEMO=1 pnpm db:reset` atau `SEED_DEMO=1 pnpm db:seed`. Sandi berasal dari `SEED_PASSWORD`; default lokal `SvaraDemo123!`. Ada enam akun, dua organisasi sintetis (`org_smk`, `org_perpus`), dan satu profil platform sintetis.

| Email | Peran | Organisasi | Cakupan awal |
| --- | --- | --- | --- |
| `creator.a@svara.local` | creator | `org_smk` | Pemilik `s_demo1`, `s_demo2`, `s_demo4` |
| `creator.b@svara.local` | creator | `org_perpus` | Pemilik `s_demo3` |
| `officer@svara.local` | creator | `org_smk` | Bukan pemilik `s_demo1`, tetapi memegang grant baca individual/ekspor/teks pada `s_demo1` |
| `orgadmin@svara.local` | org_admin | `org_smk` | Mengelola profil, anggota, undangan, dan audit `org_smk`; membaca penuh survei `org_smk` |
| `admin@svara.local` | super_admin | Tidak ada | Operasional; tidak otomatis boleh membaca jawaban |
| `suspended@svara.local` | creator (suspended) | Tidak ada | Ditolak saat masuk |

Organisasi sintetis (`server/seed-data.ts:30-33`):

| ID | Nama | Tipe | Kategori usia | Mode persetujuan | Notice |
| --- | --- | --- | --- | --- | --- |
| `org_smk` | SMK Nusantara (sintetis) | `school` | `minor` | `guardian` | `1.2` |
| `org_perpus` | Perpustakaan Kota (sintetis) | `organization` | `adult` | `self` | `1.2` |

`platform_profile` berisi satu baris `id='platform'` bernama "Svara (sintetis)" dengan `notice_version='2.0'` (`server/seed-data.ts:48-62`). Notice organisasi sengaja berbeda dari notice platform agar sumber notice dapat dibuktikan. Semua survei seed berada di `org_smk` atau `org_perpus` (`server/seed-data.ts:234`), jadi akun tanpa organisasi (super admin) hanya melihat platform profile pada `GET /org/profile`.

- `link-umum-demo`: survei SMK, mode wali, pemberitahuan sintetis.
- `link-umum-perpus`: survei perpustakaan, persetujuan diri.
- `undangan-demo`: undangan satu kali.
- Kode undangan individual juga bisa dibuka dari halaman masuk lewat "Saya memiliki kode undangan".

## Skrip demo

Tiga skrip memeriksa perilaku non-fungsional pada data sintetis. Semua keluaran berlabel DEMO ONLY: AC13 bukan uji kapasitas, AC15 bukan prosedur insiden, dan AC16 bukan studi lapangan. Kode `ACxx` merujuk butir penerimaan di `PRD.md`.

Demo memakai `DATABASE_URL` yang menunjuk basis data bernama test/demo (ditolak untuk nama lain) dan me-reset schema-nya.

```bash
pnpm demo:ac13     # 30 kiriman paralel, 20 item, tulis docs/test-evidence/ac13-load.json
pnpm demo:ac15     # pg_dump, hapus satu respons, recreate DB, pg_restore, tulis docs/test-evidence/ac15-restore.json
pnpm demo:ac16     # tiga responden sintetis + rekonsiliasi CSV
```

### Prosedur AC15: pg_dump dan pg_restore

```bash
export AC15_ADMIN_DATABASE_URL='postgres://postgres:postgres_admin_dev@127.0.0.1:5432/postgres'
export DATABASE_URL='postgres://svara:svara_dev_password@127.0.0.1:5432/svara_test'
pnpm demo:ac15
```

Perintah yang diuji (ganti nama basis data/berkas sesuai kebutuhan):

```bash
pg_dump --dbname="$DATABASE_URL" --format=custom --file=backup.dump
# ...basis data dibuat ulang kosong...
pg_restore --dbname="$DATABASE_URL" --clean --if-exists --no-owner --no-privileges backup.dump
```

- Default `AC15_ADMIN_DATABASE_URL` adalah `DATABASE_URL`; role tersebut butuh izin `CREATE DATABASE`.
- Bila `pg_dump`/`pg_restore` tidak ada di PATH, skrip memakai image `postgres:17-alpine` via Docker (`AC15_PG_IMAGE` untuk override).
- Restore mengembalikan isi cadangan. Penghapusan data yang diminta setelah restore harus diulang dan dicatat; restore bukan alat penghapusan permanen.
- Bukti ini tidak menguji cadangan terenkripsi, off-site, RPO/RTO, atau prosedur insiden.

Angka dan keterbatasan tiap skrip ada di `docs/test-evidence/`.

## Dokumentasi

- [PRD.md](PRD.md): kebutuhan produk dan butir penerimaan `ACxx`.
- [DESIGN.md](DESIGN.md): token warna, tipografi, radius, dan spesifikasi komponen.
- [docs/test-evidence/](docs/test-evidence/): keluaran skrip demo AC13, AC15, AC16, dan tangkapan layar.

## Batasan yang disengaja

- Integrasi ke sistem lain (pengumpulan data lintas layanan) disimulasikan; tidak ada jaringan lintas layanan nyata.
- Tidak ada email, SMS, atau verifikasi identitas responden.
- Retensi, kontak pengendali, dan transfer lintas negara tetap `null` sampai pengendali menetapkannya.
- Teks kebijakan adalah template sintetis, bukan nasihat hukum.
- Rate limit disimpan di proses; deployment multi-instance memerlukan penyimpanan bersama.
- Backup demo memakai `VACUUM INTO` lokal; belum ada enkripsi, off-site, atau uji RPO/RTO.

## Lisensi

Repo ini belum menyertakan lisensi. Semua hak dipegang pemilik repo sampai lisensi ditambahkan.
