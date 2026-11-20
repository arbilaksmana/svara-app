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
| Akses | Sesi cookie HttpOnly, guard peran di server, izin baca/ekspor/teks bebas per akun dan survei, audit log append-only |
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

`/`, `/auth/login`, `/auth/register`, `/privacy`, `/terms`, `/creator`, `/creator/surveys/[id]/{edit,preview,publish,share,results,settings,history}`, `/s` (kode undangan), `/s/[token]`, `/s/[token]/form`, `/s/[token]/review`, `/s/[token]/receipt`, `/admin`, `/admin/{accounts,audit,integration,requests}`, dan 404 untuk path lain.

`/s` dan `/s/[token]/*` publik tanpa guard. `/creator` menolak `super_admin`, `/admin` menolak peran creator. Setiap route `/creator/surveys/[id]/*` memeriksa kepemilikan dan merender "Survei tidak ditemukan" untuk survei milik akun lain.

## Keamanan dan privasi

- Sesi cookie HttpOnly dengan TTL, hash kata sandi `scrypt`, dan header `X-Svara-Client` untuk mutasi.
- Persetujuan wajib tercatat di server sebelum metadata formulir atau pengiriman diproses.
- Izin baca individual, ekspor, dan teks bebas terpisah per akun dan survei. Ekspor tanpa izin ditolak `403` dan dicatat.
- Respons publik disimpan dengan kunci idempotensi; bukti hanya dapat dibuka dengan kunci yang sama.
- Rate limit login dan pengiriman, audit log append-only, CSP nonce tanpa `unsafe-inline` pada `script-src`, serta `X-Frame-Options`, `Referrer-Policy`, dan `Permissions-Policy`.
- Hapus pertanyaan, tutup versi, arsipkan survei, dan cabut undangan meminta konfirmasi eksplisit.

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

Registrasi publik belum memverifikasi email dan tidak membuat grant baca jawaban. Super admin mengatur peran, status, dan grant lewat `/admin/accounts`; akun yang disuspend tidak dapat masuk.

## Basis data dan migrasi

- `server/migrations/*.sql` diterapkan berurutan dan dicatat di `schema_migrations` (versi + checksum).
- Runner (`server/migrate.ts`) memakai advisory lock, satu transaksi per migrasi, dan rollback bila gagal.
- `pnpm db:migrate` menerapkan migrasi yang belum ada.
- `SEED_DEMO=1 pnpm db:reset` menghapus schema `public`, menerapkan semua migrasi, lalu memuat data sintetis.
- `pnpm test` memakai basis data uji terpisah (`TEST_DATABASE_URL`), me-reset schema, lalu menjalankan migrasi.
- Migrasi yang mengubah checksum yang sudah tercatat ditolak; buat file migrasi baru, jangan edit yang sudah dirilis.
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

Dibuat hanya oleh `SEED_DEMO=1 pnpm db:reset` atau `SEED_DEMO=1 pnpm db:seed`. Sandi berasal dari `SEED_PASSWORD`; default lokal `SvaraDemo123!`.

| Email | Peran | Cakupan awal |
| --- | --- | --- |
| `creator.a@svara.local` | creator | Pemilik `s_demo1`, `s_demo2`, `s_demo4` |
| `creator.b@svara.local` | creator | Pemilik `s_demo3` |
| `officer@svara.local` | authorized_officer | Grant baca/ekspor/teks pada `s_demo1` |
| `admin@svara.local` | super_admin | Operasional; tidak otomatis boleh membaca jawaban |
| `suspended@svara.local` | creator (suspended) | Ditolak saat masuk |

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
