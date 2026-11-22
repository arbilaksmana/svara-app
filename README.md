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
| Versi | Hanya versi terbit terbaru yang menerima kiriman. Tautan umum yang ditutup karena versi baru terbit atau karena survei ditutup membuka versi terbit terbaru pada survei yang sama. Tautan survei yang pernah diarsipkan, tautan yang dicabut atau kedaluwarsa, dan tautan yang ditutup sebelum migrasi 014 tanpa alasan tercatat (`closed_reason` kosong) tetap ditutup |
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

Prasyarat: Node.js 24 atau lebih baru, pnpm 11.5.2 (dikunci di `packageManager`, bisa lewat `corepack enable`), PostgreSQL 16/17, dan Docker Desktop untuk basis data lokal.

```bash
pnpm install --frozen-lockfile
docker compose up -d db
export DATABASE_URL='postgres://svara:svara_dev_password@127.0.0.1:5432/svara'
SEED_DEMO=1 pnpm db:reset
pnpm dev
```

PowerShell:

```powershell
$env:DATABASE_URL='postgres://svara:svara_dev_password@127.0.0.1:5432/svara'
$env:SEED_DEMO='1'
pnpm db:reset
pnpm dev
```

`pnpm dev` menjalankan dua layanan sekaligus (API `:3001` dan Web `:3000`) lewat `scripts/dev.mjs`. Sebelum mulai script memeriksa `DATABASE_URL`, koneksi PostgreSQL di `127.0.0.1:5432`, dan port kosong, lalu berhenti dengan pesan jelas kalau salah satunya gagal. Ini mencegah galat `ECONNREFUSED 127.0.0.1:3001` di halaman masuk saat API tidak ikut hidup. Ctrl+C mematikan keduanya, termasuk proses anak di Windows.

Buka `http://127.0.0.1:3000` dan masuk sebagai `creator.a@svara.local` dengan sandi `SvaraDemo123!`. Daftar survei berisi tiga contoh milik akun itu. Buka salah satunya untuk melihat editor, publikasi, tautan responden, dan hasil.

Tanpa `SEED_DEMO=1` basis data tetap kosong dan admin pertama dibuat lewat `pnpm admin:bootstrap`.

## Alur pemakaian

1. Creator menyusun draf instrumen: judul, tujuan, petunjuk, pertanyaan, opsi, dan kode item.
2. Draf diterbitkan menjadi versi tetap. Tautan umum versi sebelumnya membuka versi terbit terbaru, kecuali tautan survei yang pernah diarsipkan, tautan yang dicabut atau kedaluwarsa, dan tautan yang ditutup sebelum migrasi 014 tanpa alasan; undangan individual tetap terikat pada versinya dan tampil **Ditutup** setelah versinya tidak lagi terbit.
3. Responden membuka tautan, membaca pemberitahuan, memberi persetujuan, mengisi, lalu menerima bukti kirim.
4. Creator membaca hasil agregat per versi. Teks bebas, jawaban individual, dan ekspor memerlukan izin terpisah.
5. Publikasi menutup versi terbit sebelumnya. Jika tidak ada versi terbit, tautan umum tidak menerima kiriman baru.

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
- `server/migrations/` berisi skema 30 tabel (migrasi `001`–`019`, di luar `schema_migrations`) dengan foreign key, unique constraint, dan indeks; `schema_migrations` mencatat versi dan checksum. `server/test/migrations.test.ts` memeriksa jumlah tabel itu.
- `src/lib/server/guards.ts` membaca cookie sesi lalu memanggil `/api/v1/auth/me` (hanya sesi, tanpa bootstrap penuh) untuk guard peran di server component.
- `src/components/CreatorBootGate.tsx` menahan layar creator sampai bootstrap selesai, sehingga tidak merender data kosong.
- `src/lib/navigation-guard.tsx` memblokir navigasi saat draf belum tersimpan (`window.confirm` untuk tautan, `beforeunload` untuk reload/tab).
- `src/components/ui.tsx` memuat primitif bersama: `Field` dengan `aria-invalid`/`aria-describedby`, `ActionLink` dengan `disabledReason`, `ConfirmDialog` berbasis `<dialog>` native, dan `Toast` dengan `role="alert"` untuk galat.

## Rute

`/`, `/auth/login`, `/auth/register`, `/privacy`, `/terms`, `/creator`, `/creator/surveys/[id]/{edit,preview,publish,share,results,settings,history}`, `/s` (kode undangan), `/s/[token]`, `/s/[token]/form`, `/s/[token]/review`, `/s/[token]/receipt`, `/admin`, `/admin/{accounts,platform,audit,integration,requests,org}`, dan 404 untuk path lain.

`/s` dan `/s/[token]/*` publik tanpa guard. `/creator` menolak `super_admin`, `/admin` hanya untuk `super_admin`, dan `/admin/org` hanya untuk `org_admin` yang terikat organisasi. Setiap route `/creator/surveys/[id]/*` memeriksa kepemilikan dan merender "Survei tidak ditemukan" untuk survei milik akun lain.

## Keamanan dan privasi

- Sesi cookie HttpOnly dengan TTL, hash kata sandi `scrypt` async (threadpool libuv, tidak memblokir event loop), dan header `X-Svara-Client` untuk mutasi. Cookie dengan percent-encoding rusak diabaikan seperti tidak ada sesi, bukan `500`.
- Menangguhkan akun lewat `PATCH /admin/accounts/:id` atau `PATCH /org/members/:id` menghapus semua sesinya di transaksi yang sama. Mengaktifkan kembali tidak menghidupkan cookie lama; pemilik akun harus masuk ulang.
- Semua respons `/api` membawa `Cache-Control: no-store` dari satu middleware di `server/app.ts`, termasuk penolakan dan `404`, agar data sesi tidak tersimpan di cache browser atau proxy.
- Login menolak email yang formatnya tidak valid atau lebih dari 254 karakter dan kata sandi lebih dari 256 karakter dengan `422 validation_error` generik, sebelum rate limit, query akun, hashing, dan audit. Audit login gagal hanya menyimpan email ternormalisasi yang lolos batas itu.
- Persetujuan wajib tercatat di server sebelum metadata formulir atau pengiriman diproses. `notice_version` diambil dari sumber kebijakan survei: `organizations` untuk survei berlingkup organisasi, `platform_profile` untuk survei individual.
- Persetujuan responden hanya berlaku pada versi, tautan atau undangan, dan sesi browser saat persetujuan dicatat. Klien API perlu meneruskan cookie HttpOnly `svara_respondent` dari penerbitan persetujuan ke permintaan formulir dan kiriman.
- Persetujuan mengizinkan satu respons final dalam 24 jam. Retry identik dari sesi yang sama tetap mengembalikan bukti yang sama. Jika persetujuan lama belum dipakai saat migrasi `012`, responden harus mencatat persetujuan baru; migrasi tidak mengubah bukti kiriman lama.
- Izin baca individual, ekspor, dan teks bebas terpisah per akun dan survei. Ekspor tanpa izin ditolak `403` dan dicatat.
- Permintaan data dari formulir publik di `/privacy` tercatat `pending`. `PATCH /admin/data-requests/:id` menolak status `handled` tanpa `response_channel` (`422 response_evidence_required`); kanal balasan, `responded_by`, dan `responded_at` menjadi jejak bahwa pemohon sudah dibalas. Di `/admin/requests`, status **Selesai** meminta kanal balasan sebelum disimpan, dan kanal yang sudah tersimpan tetap terpilih saat baris dibuka lagi.
- Satu-satunya peran akun adalah `super_admin`, `org_admin`, dan `creator`. Responden tidak memakai akun; peran `authorized_officer` sudah tidak ada dan ditolak `422` oleh `PATCH /admin/accounts/:id`.
- Lingkup `/org/*` selalu diambil dari sesi (`accounts.organization_id`), tidak pernah dari body atau query; akun tanpa organisasi ditolak `403`.
- Setiap baris audit mencatat `account_id` pelaku dan `organization_id` dari sesi, sehingga baca jawaban individual, ekspor CSV, dan ekspor kodebook dapat ditelusuri per organisasi. `super_admin` tanpa organisasi menulis `organization_id` NULL.
- Audit `Buat undangan`/`Cabut undangan` mencatat `<survey_id> · <invitation_id>`, bukan kode `UND-...`, karena kode dapat ditukar menjadi token lewat `POST /public/invitations/resolve`. Baris audit lama yang masih memuat kode undangan (`UND-...`/`ORG-...`) disamarkan menjadi `UND-***`/`ORG-***` saat dibaca lewat `/admin/audit`, `/org/audit`, dan bootstrap; isi tabel `audit_logs` tidak diubah.
- `expires_at` undangan individual harus `YYYY-MM-DD` (berlaku sampai 23:59:59 UTC hari itu) atau tanggal-waktu ISO-8601 berzona (`Z`/`±hh:mm`) di masa depan; nilai lain, termasuk tanggal yang tidak ada seperti `2026-02-30`, ditolak `422 validation_error`. Nilai tersimpan yang tidak dapat diurai diperlakukan kedaluwarsa oleh endpoint publik.
- Undangan individual yang sudah dipakai tidak dapat dicabut (`409 invitation_used`) dan tetap berstatus `used`, sama dengan kode undangan organisasi; pencabutan ulang undangan yang sudah dicabut tetap `200`.
- Pemulihan bukti memerlukan kunci idempotensi dan sesi responden yang mengonsumsi persetujuan. Setelah memuat ulang halaman tinjau, sesi itu dapat mengirim ulang jawaban identik dengan kunci yang sama tanpa membuat respons baru; formulir pengisian tetap terkunci.
- Rate limit login dan pengiriman, audit log append-only, CSP nonce tanpa `unsafe-inline` pada `script-src`, serta `X-Frame-Options`, `Referrer-Policy`, dan `Permissions-Policy`.
- Hapus pertanyaan, tutup versi, arsipkan survei, dan cabut undangan meminta konfirmasi eksplisit.

## Organisasi dan lingkup

Tenancy bersandar pada dua tabel kebijakan dan dua kolom kepemilikan:

- `organizations` berisi satu baris per organisasi pelanggan: `name`, `organization_type`, `respondent_age_category`, `consent_mode`, `policy_url`, `terms_url`, `retention_days`, `data_request_contact`, `cross_border_transfer`, dan `notice_version` (`server/migrations/005_organizations.sql`, `server/migrations/006_organization_profile.sql`).
- `platform_profile` hanya boleh berisi satu baris ber-`id='platform'` (`CHECK (id = 'platform')`) dan tidak memiliki `respondent_age_category` maupun `consent_mode` (`server/migrations/005_organizations.sql`).
- `accounts.organization_id` dan `surveys.organization_id` menautkan akun dan survei ke organisasi; keduanya dapat NULL (`server/migrations/005_organizations.sql`).

### Lingkup survei saat dibuat

`POST /surveys` (`server/routes/surveys.ts`) menerima `owner_scope`: `individual` atau `organization`; nilai lain, termasuk string kosong, ditolak `422`, dan tanpa `owner_scope` berarti `individual`. Hanya `creator` yang boleh membuat survei; peran lain ditolak `403 forbidden_role`.

- `individual` menyimpan `surveys.organization_id = NULL`; survei menjadi milik pembuatnya.
- `organization` menyalin `accounts.organization_id` akun pembuat ke survei; akun tanpa organisasi ditolak `403 forbidden_scope`.
- `surveys.profile_id` tetap wajib dan masih merujuk baris `profiles` sintetis. Kebijakan yang dipakai survei dibaca dari `organization_id`, bukan dari `profile_id`.

Di UI, `/creator` menampilkan kontrol "Lingkup" di samping tombol "Buat draf baru" hanya bila akun terikat organisasi, dan nilai awalnya `organization`; akun tanpa organisasi tidak melihat kontrol itu dan selalu membuat survei individu. Pilihan itu dikirim sebagai `owner_scope`, dan baris survei menampilkan "Lingkup organisasi" atau "Lingkup individu" (`CreatorListPage` di `src/screens/CreatorCore.tsx`, `createSurvey` di `src/lib/api.ts`).

Apa artinya untuk visibilitas (`canManageSurvey` dan `accessibleSurveys` di `server/http.ts`):

| Akun | Daftar survei | Mengelola |
| --- | --- | --- |
| `super_admin` | Semua survei | Semua survei |
| `org_admin` | Survei dengan `organization_id` organisasinya | Survei organisasinya saja; survei `organization_id` NULL tidak pernah jatuh ke `org_admin` |
| `creator` | Survei miliknya dan survei yang diberi grant ke akun itu | Survei miliknya saja; grant tidak memberi hak kelola |
| Selain itu | Survei yang diberi grant | Tidak ada, hanya grant |

Mengelola berarti pemilik (`owner_id`) atau `org_admin` dari organisasi survei; akun tanpa organisasi tidak dapat mengelola lewat jalur `org_admin` (`canManageSurvey`). Creator rekan satu organisasi tidak otomatis melihat atau mengelola survei rekan tersebut; jalurnya tetap grant per survei.

`GET /surveys` dan bootstrap memakai daftar yang sama, terurut `updated_at DESC, id`, tanpa baris duplikat bila pemilik juga memiliki grant. Data distribusi di bootstrap (`invitations`, `publicLinks`, `assignments`) tetap terbatas pada survei yang dapat dikelola, bukan seluruh survei yang terlihat.

Daftar creator memberi label "Diberikan akses" pada survei bukan miliknya. Baris tersebut hanya menawarkan "Lihat hasil"; navigasi surveinya hanya "Hasil", tanpa Editor, Pratinjau, Publikasi, Bagikan, Pengaturan, atau Riwayat. Hak baca hasil dan ekspor tetap diperiksa API sesuai grant dan pengaturan survei.

### Perubahan pertanyaan setelah ada jawaban

`PUT /surveys/:id` mengembalikan `data.instrumentChange: { changed, affectedResponses }`. Instrumen dibandingkan dengan versi terakhir yang pernah terbit (termasuk yang sudah ditutup), atau draf yang ada bila belum pernah terbit. Jumlah, kode, tipe, teks, wajib/tidak, serta label dan nilai opsi termasuk instrumen; urutan pertanyaan/opsi dan metadata survei (`title`, `purpose`, `object_label`, `instructions`) tidak termasuk.

`affectedResponses` menghitung submission pada versi yang pernah terbit dengan instrumen berbeda dari pertanyaan yang dikirim, hanya ketika `changed` bernilai `true`. Versi historis yang instrumennya identik tidak dihitung. Jawaban dan versi terbit tidak dipindahkan, dihapus, atau ditulis ulang. Simpan ulang pertanyaan identik tidak membuat draf baru dan tidak mengganti ID pertanyaan; perubahan urutan tetap disimpan sebagai draf tanpa sinyal perubahan instrumen.

Editor memeriksa dampak lebih dahulu dengan `PUT /surveys/:id?preview=true`, yang tidak menyimpan metadata, pertanyaan, draf, atau audit penyimpanan. Jika jumlah terdampak lebih dari nol, dialog menyebut jumlah jawaban dan ketidaksebandingan jawaban lama dengan versi baru. **Batal** mempertahankan edit lokal tanpa menyimpan; **Tetap simpan draf** menyimpan lewat `PUT` biasa. Perubahan tanpa jawaban tidak memerlukan konfirmasi. Pemeriksaan dan penyimpanan merupakan dua permintaan; jumlah dapat bertambah bila ada submission di antaranya, dan respons penyimpanan menghitung ulang dampaknya.

### Sumber kebijakan dan notice

- Setiap survei membaca tepat satu sumber kebijakan, dipilih dari `surveys.organization_id`: baris `organizations` bila tidak NULL, baris `platform_profile` bila NULL. Tidak ada fallback diam-diam ke profil lain (`noticeVersionFor` dan `surveyProfileFor` di `server/http.ts`; `surveyProfileFor` dipakai detail survei dan bootstrap).
- `notice_version` versi yang diterbitkan berasal dari sumber yang sama saat draf dibuat (`noticeVersionFor`, dipanggil `POST /surveys` dan `PUT /surveys/:id` saat draf dibuat).
- Publish menolak `422 notice_version_unavailable` bila notice versi draf belum tersedia di sumbernya, sehingga tidak ada versi terbit yang tautannya langsung gagal.
- Migrasi `018_notice_survey_profile_backfill.sql` mengoreksi backfill `013` untuk data hasil upgrade: notice lingkup diisi dari teks yang dulu ditampilkan per survei (`surveys.profile_id`, versi persis atau notice terbaru profil itu) di bawah label `survey_versions.notice_version`; `notice_version` organisasi/platform yang belum dipakai survei diisi dari profil default `POST /surveys`. Sumbernya tercatat di `organization_notice_sources`/`platform_notice_sources` (`survey_profile`); baris yang sudah ada tidak ditimpa, dan survei berprofil tanpa notice tetap gagal-tertutup (`500 notice_version_unavailable`).
- Migrasi `019_close_superseded_published_versions.sql` merapikan data dari `main`, yang publish-nya tidak menutup versi terbit sebelumnya. Untuk setiap survei dengan lebih dari satu versi `published`, hanya versi bernomor terbesar yang tetap terbit; versi terbit lain menjadi `closed` (`closed_at` = waktu migrasi), dan tautan publiknya yang masih `active` dan belum kedaluwarsa menjadi `closed` dengan `closed_reason = 'superseded'` sehingga menyajikan versi terbit terbaru. Respons, persetujuan, undangan, isi instrumen, dan status survei tidak diubah; undangan pada versi yang ditutup tampil `closed`. Idempoten; survei dengan satu versi terbit tidak tersentuh.

### Siapa boleh membaca jawaban dan teks bebas

- Pemilik survei dan `org_admin` organisasi survei itu membaca penuh: jawaban individual, teks bebas, agregat, ekspor, dan kodebook (`canManageSurvey`, dipakai `canReadIndividual`, `canExport`, dan `canReadFreeText` di `server/http.ts`).
- `super_admin` tidak otomatis membaca jawaban individual; tanpa grant permintaan ditolak `403` (`canReadIndividual` tidak punya jalur `super_admin`; diuji di test "Lingkup organisasi: pemilik, org_admin, dan isolasi antar organisasi" pada `server/test/api.test.ts`).
- Pemegang grant tetap terikat `survey_settings`: grant `can_read_individual` hanya berlaku bila `allow_individual` aktif, dan grant apa pun memberi baca agregat hanya bila `allow_results` aktif (`canReadIndividual`, `canReadAggregate`).
- Setiap baca individual dan ekspor dicatat dengan `account_id` pelaku serta `organization_id` sesi, berhasil maupun ditolak (`audit` di `server/http.ts`, diuji di test yang sama).
- Ekspor CSV memuat baris per responden, jadi memerlukan izin ekspor sekaligus izin baca individual yang berlaku (`canExportIndividual`). Pemegang grant `can_export` tanpa `can_read_individual`, atau dengan `allow_individual` mati, mendapat `403 forbidden_export_individual`; kodebook cukup dengan izin ekspor. Halaman hasil menonaktifkan **Unduh CSV** beserta alasannya untuk akun seperti itu, sementara **Unduh kodebook** tetap aktif.
- Audit ekspor CSV fail-closed: baris `Mulai ekspor CSV` ditulis sebelum byte pertama dikirim (gagal ditulis → `500` tanpa data), lalu hasil akhir (selesai atau terputus) dicatat sesudahnya. Metadata mencatat nama berkas, kolom, dan header `Accept` permintaan; penerima dan tujuan berkas setelah diunduh tidak dicatat.

### Permukaan admin organisasi

`/admin/org` adalah satu layar untuk `org_admin`: profil organisasi, anggota dan suspend, kode undangan creator beserta pencabutannya, dan log audit organisasi (`src/app/admin/org/page.tsx`, `AdminOrgPage` di `src/screens/Org.tsx`). Semua endpoint ada di `server/routes/org.ts`, memakai awalan `/api/v1`, dan hanya menerima `org_admin` yang terikat organisasi:

| Endpoint | Perilaku |
| --- | --- |
| `GET /org/profile` | Akun berorganisasi mendapat profil organisasinya; akun tanpa organisasi (termasuk `super_admin`) mendapat `platform_profile` dengan `source: 'platform'` |
| `PUT /org/profile` | Hanya `org_admin` berorganisasi; field yang tidak dikirim mempertahankan nilai tersimpan, dan `respondent_age_category` minor/mixed dengan `consent_mode=self` ditolak `422 consent_mode_mismatch` |
| `GET /org/members` | Daftar akun dengan `organization_id` sesi; cache `no-store` |
| `PATCH /org/members/:id` | Hanya status `active`/`suspended` untuk anggota berperan `creator` di organisasi sendiri; akun di luar organisasi dijawab `404` agar keberadaannya tidak bocor; penangguhan menghapus semua sesi anggota |
| `GET /org/invitations` | Daftar maksimal 50 kode terbaru organisasi sesi (`INVITATION_LIST_LIMIT`); status `active`/`used`/`revoked`/`expired` dihitung dari kolom waktu dengan prioritas used > revoked > expired > active, bukan disimpan |
| `POST /org/invitations` | Membuat satu kode `ORG-...` sekali pakai untuk organisasi sesi, berlaku 14 hari |
| `DELETE /org/invitations/:id` | Mencabut kode yang belum terpakai; kode terpakai ditolak `409 invitation_used`, kode organisasi lain dijawab `404 invitation_not_found`, pencabutan ulang tetap `200` |
| `GET /org/audit` | Baris audit organisasi tanpa metadata mentah; `limit` 1-500, default 100 |

Lingkup organisasi diambil dari sesi lewat `requireOrgScope`, bukan dari body atau query, dan akun tanpa organisasi ditolak `403` sebelum data apa pun disentuh.

### Onboarding creator lewat kode undangan organisasi

1. `org_admin` membuat kode di `/admin/org` lewat `POST /org/invitations` dan membagikannya secara manual; setiap kode berlaku tepat 14 hari sejak dibuat (`expires_at` wajib terisi, termasuk untuk baris lama yang di-backfill migrasi 009) dan dapat dicabut dari tabel undangan sebelum terpakai (`DELETE /org/invitations/:id`).
2. Pendaftar mengisi kolom "Kode undangan organisasi" di `/auth/register`; UI mengirimnya sebagai `invite_code` (`RegisterPage` di `src/screens/Register.tsx`).
3. `POST /auth/register` mencari kode lalu menolak `422 invalid_invite_code` bila kode asing, sudah dipakai, dicabut, atau kedaluwarsa — alasan spesifik tidak dibocorkan (`server/routes/auth.ts`). Akun baru berperan `creator` dengan `organization_id` dari undangan, lalu kode ditandai terpakai di transaksi yang sama; guard `WHERE` menutup balapan dengan pencabutan.
4. Tanpa `invite_code`, akun dibuat tanpa organisasi.

### Menetapkan lingkup akun

`super_admin` menetapkan organisasi sebuah akun lewat `PATCH /admin/accounts/:id` dengan `organization_id` berupa id organisasi atau `null` (`server/routes/admin.ts`). Aturannya:

- id yang tidak ada di `organizations` ditolak `422 unknown_organization`;
- `org_admin` tanpa organisasi ditolak `422 organization_required`, karena guard `/org/*` membaca `accounts.organization_id`;
- akun `super_admin` tidak boleh terikat organisasi: `422 super_admin_scope`, termasuk saat akun berorganisasi dipromosikan;
- setiap perubahan dicatat pada log audit dengan `metadata.organization_id`.

Di `/admin/accounts`, kolom "Organisasi" memuat daftar dari `bootstrap.organizations` yang hanya dikirim ke `super_admin` (`buildBootstrap` di `server/bootstrap.ts`), dan pemilih peran kini mencakup `org_admin` (`AdminAccountsPage` di `src/screens/Admin.tsx`). Memindahkan akun tidak mengubah `surveys.organization_id` yang sudah ada: survei tetap milik organisasi tempat ia dibuat.

### Membuat organisasi baru

Onboarding satu langkah lewat `POST /admin/organizations` (`server/routes/admin.ts`): organisasi dan admin pertamanya dibuat dalam satu transaksi, sehingga tidak ada organisasi tanpa pengelola. Body wajib memuat `name`, `organization_type` (`school` atau `organization`), dan `admin` berisi `display_name`, `email`, serta `password`.

- `organization_type` selain dua nilai itu ditolak `422 validation_error`; `admin.password` mengikuti kebijakan yang sama dengan pendaftaran (`422 weak_password`).
- Email yang sudah terdaftar ditolak `409 email_taken`; untuk akun lama, tautkan lewat `PATCH /admin/accounts/:id`.
- `respondent_age_category`/`consent_mode` opsional dengan default `adult`/`self`; kombinasi minor/mixed dengan `self` ditolak `422 consent_mode_mismatch` (PRD §1.2).
- `policy_url`/`terms_url` default ke halaman `/kebijakan-privasi` dan `/ketentuan-layanan`, lalu dapat diubah `org_admin` lewat `PUT /org/profile`.
- Akun admin hasil onboarding belum mencatat persetujuan kebijakan (`consent_version` NULL) karena belum ada yang menyetujui.
- Notice awal organisasi disediakan eksplisit dalam transaksi yang sama (`provisionNoticesForNewOrganization` di `server/notice-provisioning.ts`), bukan fallback saat dibaca: tanpa `notice_profile_name` (payload UI), notice platform untuk `notice_version` organisasi disalin ke `organization_notices` (sumber `platform`); dengan `notice_profile_name`, notice profil legacy bernama itu yang disalin (sumber `legacy`). Nama organisasi tidak dicocokkan ke profil legacy.
- `notice_version` opsional; default mengikuti versi yang berlaku di sumbernya (`platform_profile.notice_version` atau `profiles.notice_version` profil legacy yang dipilih). Versi yang tidak tersedia ditolak `422 notice_version_unavailable` dengan `details.available_platform_versions`, tanpa menyimpan organisasi maupun admin; katalog sumber yang belum dimigrasi menghasilkan `500 notice_catalog_missing`.
- Log audit `Buat organisasi` juga mencatat `metadata.notice_version`, `metadata.notice_source` (`platform`/`legacy`), dan `metadata.notice_count`.
- Respons memuat `organization` dan `account` (tanpa hash kata sandi); perubahan dicatat pada log audit `Buat organisasi` dengan `metadata.admin_account_id`.

Di `/admin/accounts`, kartu "Organisasi" menampilkan organisasi beserta jumlah akunnya dan formulir pembuatan; setelah sukses daftar akun serta opsi organisasi ikut diperbarui lewat `refreshBootstrap`.

### Profil platform

`platform_profile` dipakai survei dan akun tanpa organisasi, dan `super_admin` mengubahnya lewat `/admin/platform` (`src/app/admin/platform/page.tsx`). Endpoint-nya ada di router admin sehingga otomatis hanya untuk `super_admin` (`requireRole(['super_admin'])` pada `adminRouter` di `server/routes/admin.ts`):

| Endpoint | Perilaku |
| --- | --- |
| `GET /admin/platform-profile` | Membaca satu baris `id='platform'` dengan cache `no-store`; 404 `profile_missing` bila baris tidak ada |
| `PUT /admin/platform-profile` | Field yang tidak dikirim mempertahankan nilai tersimpan; `organization_name`, `organization_type`, `policy_url`, `terms_url` wajib; `retention_days` bilangan bulat >= 0 atau null; `cross_border_transfer` hanya `boolean` (null "belum diputuskan" berasal dari seed dan tidak dapat dikembalikan lewat API); setiap perubahan diaudit `Ubah profil platform` |

`notice_version` dan `updated_at` tidak dapat diubah dari sini: `notice_version` naik saat teks kebijakan berubah, `updated_at` diisi server. Profil ini tidak memiliki `respondent_age_category` maupun `consent_mode`, karena aturan persetujuan hanya didefinisikan per organisasi. Perubahan di sini tidak menyentuh baris `organizations`; `GET /org/profile` untuk akun berorganisasi tetap membaca organisasinya.

### Belum tersedia

- `org_admin` belum dapat mengubah peran anggota, hanya status creator (`PATCH /org/members/:id`).

## Konfigurasi

Semua konfigurasi dibaca dari environment. Contoh ada di `.env.example`; jangan commit nilai rahasia produksi.

| Variabel | Default | Keterangan |
| --- | --- | --- |
| `PORT` | `3000` web, `3001` API | Port HTTP per layanan |
| `HOST` | `127.0.0.1` | Alamat bind API |
| `API_INTERNAL_URL` | `http://127.0.0.1:3001` | Basis URL `/auth/me` untuk guard server component |
| `API_ORIGIN` | `http://127.0.0.1:3001` | Target rewrite `/api/:path*`; dibekukan saat `next build` |
| `API_ORIGIN_BUILD` | `http://api:3001` | Nilai `API_ORIGIN` untuk build image web Docker Compose |
| `DATABASE_URL` | wajib | Koneksi PostgreSQL runtime; tidak ada fallback SQLite |
| `PG_POOL_MAX` | `10` | Batas koneksi pool (1-50) |
| `PG_IDLE_TIMEOUT_MS` | `10000` | Batas idle koneksi |
| `PG_CONNECTION_TIMEOUT_MS` | `5000` | Batas waktu membuka koneksi |
| `TEST_DATABASE_URL` | kosong | Basis data uji terpisah untuk `pnpm test` dan demo |
| `APP_ORIGIN` | `http://127.0.0.1:3000,http://localhost:3000` di luar production; kosong di production | Origin yang diizinkan untuk mutasi; pisahkan beberapa origin dengan koma. Wajib diisi di production karena rewrite mengganti Host |
| `TRUST_PROXY` | kosong (mati) | Jaringan proxy yang header `X-Forwarded-For`/`X-Forwarded-Proto`-nya dipercaya untuk `req.ip` (identitas klien limiter) dan `req.secure`. Kosong/`0` = mati: header diabaikan dan limiter menghitung per alamat koneksi. Nilai yang diterima: `loopback`, `linklocal`, `uniquelocal`, atau gabungan koma (`loopback, uniquelocal`). Jumlah hop (`1`, `2`), `true`/`*`, rentang IP, dan nilai lain tidak diterima: API mencetak peringatan saat start dan mematikan trust proxy (header diabaikan), karena jumlah hop mempercayai koneksi dari alamat mana pun. Isi hanya bila ingress tepercaya di depan API menambahkan atau menimpa `X-Forwarded-For` dan `X-Forwarded-Proto`. Rewrite Next dan jalur compose web→api tidak melakukannya; tanpa ingress seperti itu, biarkan kosong dan pakai `COOKIE_SECURE=1` untuk HTTPS. Lihat [Header proxy dan `TRUST_PROXY`](#header-proxy-dan-trust_proxy) |
| `COOKIE_SECURE` | `0` | `1` = cookie sesi `svara_session` dan cookie responden `svara_respondent` selalu memakai `Secure`. Set `1` di setiap deployment HTTPS, termasuk di belakang reverse proxy/TLS terminator atau rewrite Next; inilah cara yang benar bila `TRUST_PROXY` kosong. `0`/kosong = kedua cookie memakai `Secure` hanya bila `req.secure` benar: TLS langsung ke API, atau `X-Forwarded-Proto: https` dari ingress di jaringan `TRUST_PROXY`. Jangan mengisi `TRUST_PROXY` hanya demi `X-Forwarded-Proto` bila tidak ada ingress yang menambahkan atau menimpa header proxy, karena klien lalu bisa memalsukan `X-Forwarded-For` untuk limiter. Header `X-Forwarded-Proto` dari klien tanpa `TRUST_PROXY` diabaikan |
| `ENABLE_HSTS` | `0` | Set `1` hanya setelah deployment HTTPS siap |
| `SESSION_TTL_HOURS` | `8` | Umur sesi (jam) |
| `INTEGRATION_TOKEN` | kosong | Bearer untuk `/api/v1/integration/survey-data`; tanpa nilai, endpoint selalu menolak. Versi yang pernah terbit (termasuk yang sudah ditutup) tetap terbaca dan respons memuat `survey_version_status`; draf dan survei di luar cakupan organisasi `404` |
| `INTEGRATION_ORGANIZATION_ID` | kosong | ID organisasi cakupan `INTEGRATION_TOKEN`. Saat startup API, hash token dicatat di `integration_token_scopes` untuk organisasi ini; token tanpa cakupan ditolak `403 forbidden_service_scope` |
| `DATA_REQUEST_RETENTION_DAYS` | `365` | Masa simpan permintaan data dalam hari (bilangan bulat >= 1) untuk `pnpm retention:data-requests`; nilai tidak valid menghentikan skrip dengan exit code 1 |
| `EXPORT_BATCH_SIZE` | `500` | Jumlah respons per batch saat ekspor CSV di-stream; hanya dapat menurunkan dari 500 dan dipakai test untuk memaksa banyak batch. Biarkan kosong di deployment |
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

Pada basis data tanpa seed, `pnpm admin:bootstrap` juga membuat profil platform (nama `Svara`, tipe `platform`, `/privacy`, `/terms`, `notice_version` `1.0`) dan notice platform `1.0` bila profil platform belum ada; tanpa profil platform, `POST /admin/organizations` ditolak `409 notice_source_missing`. Menjalankan ulang bootstrap untuk `super_admin` yang sudah ada tetap mengisi profil platform yang belum ada tanpa mengubah akun, dan tercatat di audit sebagai `Bootstrap profil platform`. Profil dan notice yang sudah ada tidak pernah ditimpa.

Teks notice awal adalah **templat**: setiap field diawali `[Templat awal: wajib ditinjau pengelola platform; bukan teks hukum final]` dan tidak memuat ketentuan wali/anak. Templat ini wajib diganti sebelum survei dibuka untuk responden dan sebelum membuat organisasi pertama (organisasi baru menyalin notice platform untuk `notice_version`-nya); belum ada UI maupun API penyunting notice. Selama belum ada persetujuan responden yang menunjuk notice itu (`consent_notice_versions`), teks templat boleh diganti langsung di `platform_notices`. Setelah ada persetujuan, jangan mengubah baris yang sudah dipakai (PRD: teks notice tidak diubah secara retroaktif): tambahkan baris notice dengan `version` baru, lalu naikkan `platform_profile.notice_version` (atau `organizations.notice_version` beserta baris `organization_notices`-nya) lewat SQL. Draf yang dibuat sesudahnya memakai versi baru, sedangkan versi terbit dan persetujuan lama tetap menunjuk teks yang dulu ditampilkan.

Pembuatan survei (`POST /surveys`) masih mewajibkan minimal satu baris profil deployment legacy di tabel `profiles` (`surveys.profile_id` NOT NULL); di basis data tanpa seed creator mendapat `409 profile_missing` sampai baris itu tersedia. Perilaku ini sama dengan `main` dan akan diperbaiki terpisah.

### Registrasi creator

`/auth/register` membuat akun baru dengan peran `creator`, memasang sesi, dan mengarahkan ke `/creator`. Backend memberlakukan email unik, sandi 12-256 karakter dengan minimal tiga kelas karakter, persetujuan kebijakan/ketentuan, rate limit per alamat IP, dan mencatat registrasi ke audit log.

Versi dan waktu persetujuan disimpan di `accounts.consent_version` dan `accounts.consent_accepted_at`, serta metadata audit `Registrasi`. Naikkan `CURRENT_CONSENT_VERSION` di `server/routes/auth.ts` ketika teks kebijakan privasi atau ketentuan layanan berubah; akun lama tetap `NULL` karena dibuat sebelum bukti persetujuan ada.

Registrasi publik belum memverifikasi email dan tidak membuat grant baca jawaban. Super admin mengatur peran, status, dan grant lewat `/admin/accounts`; akun yang disuspend tidak dapat masuk dan sesinya yang sedang berjalan dihapus. Organisasi akun baru ditentukan saat pendaftaran lewat `invite_code`, atau kemudian oleh super admin lewat kolom "Organisasi" di `/admin/accounts` (lihat "Menetapkan lingkup akun").

## Basis data dan migrasi

- `server/migrations/*.sql` diterapkan berurutan dan dicatat di `schema_migrations` (versi + checksum).
- Runner (`server/migrate.ts`) memakai advisory lock, satu transaksi per migrasi, dan rollback bila gagal.
- `pnpm db:migrate` menerapkan migrasi yang belum ada.
- `SEED_DEMO=1 pnpm db:reset` menghapus schema `public`, menerapkan semua migrasi, lalu memuat data sintetis.
- `pnpm test` memakai basis data uji terpisah (`TEST_DATABASE_URL`), me-reset schema, lalu menjalankan migrasi.
- Migrasi yang mengubah checksum yang sudah tercatat ditolak; buat file migrasi baru, jangan edit yang sudah dirilis.
- `pnpm retention:data-requests` menganonimkan permintaan data yang lebih tua dari `DATA_REQUEST_RETENTION_DAYS` (default 365 hari): `contact` diganti `anon:<hash>`, `note` dikosongkan, dan `anonymized_at` diisi; `id`, `type`, `status`, dan `created_at` dipertahankan. Baris yang sudah dianonimkan tidak disentuh lagi, jadi skrip aman dijalankan berulang. Skrip belum dijadwalkan otomatis; jalankan dari penjadwal deployment.
- Masa berlaku kode undangan organisasi (`organization_invitations.expires_at`) wajib terisi sejak `009_organization_invitation_expiry_backfill.sql`. Migrasi itu mengisi baris lama dengan `created_at + 14 hari` (ISO-8601 UTC) lalu memasang `NOT NULL`; tidak ada lagi kode tanpa batas.
- Data SQLite lama tidak diimpor otomatis. Ekspor/impor data nyata harus jadi prosedur terpisah dengan verifikasi.

## Menjalankan

```bash
pnpm dev     # API :3001 + Next.js :3000 (dev server, hot reload)
pnpm build
pnpm start   # API + Next production, migrasi berjalan saat startup API
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

### Header proxy dan `TRUST_PROXY`

Express membaca `X-Forwarded-For` dan `X-Forwarded-Proto` hanya dari koneksi yang alamatnya ada di jaringan `TRUST_PROXY`, lalu memakai isi header itu apa adanya. `X-Forwarded-For` ditelusuri dari kanan, dan alamat pertama di luar jaringan itu menjadi identitas klien limiter (entri yang bukan alamat IP jatuh ke alamat koneksi). Koneksi langsung dari luar jaringan itu tetap dihitung per koneksi.

Karena itu `TRUST_PROXY` hanya aman bila semua trafik ke API melewati ingress tepercaya yang menambahkan atau menimpa kedua header. Rewrite Next tidak melakukannya: Next meneruskan `X-Forwarded-For` dan `X-Forwarded-Proto` dari klien apa adanya dan tidak menambahkan alamat yang dilihatnya. Dengan `TRUST_PROXY=loopback` di belakang rewrite Next, atau `uniquelocal` di belakang container web Docker Compose, satu klien bisa mengganti `X-Forwarded-For` di setiap permintaan dan tidak pernah kena batas percobaan masuk.

| Jalur ke API | `TRUST_PROXY` |
| --- | --- |
| Klien terhubung langsung ke API | kosong |
| Rewrite Next tanpa ingress (`pnpm dev`, `pnpm start`, Docker Compose web→api) | kosong |
| Ingress tepercaya → API, atau ingress → Next → API, dengan API menerima koneksi dari host yang sama | `loopback` |
| Ingress tepercaya → API, atau ingress → web → API, di jaringan privat seperti jaringan Docker Compose | `uniquelocal` |

- Di setiap deployment HTTPS set `COOKIE_SECURE=1`, apa pun nilai `TRUST_PROXY`.
- Ingress paling depan sebaiknya menimpa header, mis. nginx `proxy_set_header X-Forwarded-For $remote_addr;` dan `proxy_set_header X-Forwarded-Proto $scheme;`. Bila ingress hanya menambahkan (`$proxy_add_x_forwarded_for`), klien yang alamatnya juga berada di jaringan `TRUST_PROXY`, mis. klien intranet dengan `uniquelocal`, ikut dianggap proxy dan bisa memalsukan alamatnya.
- Tanpa ingress, semua klien yang lewat rewrite Next berbagi satu alamat di limiter, mis. kiriman publik 40 per 10 menit untuk seluruh kelas. Mengisi `TRUST_PROXY` untuk memisahkannya justru membuka pemalsuan di atas; pasang ingress bila limiter perlu menghitung per klien.
- `docker-compose.yml` tidak meneruskan `TRUST_PROXY` ke service `api`. Tambahkan sendiri hanya setelah ingress seperti di atas terpasang.

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

Organisasi sintetis (`seedDemoIfEmpty` di `server/seed-data.ts`):

| ID | Nama | Tipe | Kategori usia | Mode persetujuan | Notice |
| --- | --- | --- | --- | --- | --- |
| `org_smk` | SMK Nusantara (sintetis) | `school` | `minor` | `guardian` | `1.2` |
| `org_perpus` | Perpustakaan Kota (sintetis) | `organization` | `adult` | `self` | `1.2` |

`platform_profile` berisi satu baris `id='platform'` bernama "Svara (sintetis)" dengan `notice_version='2.0'`. Notice organisasi sengaja berbeda dari notice platform agar sumber notice dapat dibuktikan. Semua survei seed berada di `org_smk` atau `org_perpus`, jadi akun tanpa organisasi (super admin) hanya melihat platform profile pada `GET /org/profile`.

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
- Rate limit disimpan di proses dengan pembersihan entri kedaluwarsa; deployment multi-instance memerlukan penyimpanan bersama.
- Backup demo memakai `VACUUM INTO` lokal; belum ada enkripsi, off-site, atau uji RPO/RTO.

## Lisensi

Repo ini belum menyertakan lisensi. Semua hak dipegang pemilik repo sampai lisensi ditambahkan.
