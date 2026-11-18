# Svara · Modul 14

Aplikasi full-stack untuk membuat survei berskala, menerbitkan versi tetap, mengumpulkan respons dengan persetujuan, dan menyajikan hasil agregat serta ekspor terbatas.

> Data awal **sintetis**. Tidak ada pekerjaan lapangan, peserta nyata, atau klaim kepatuhan hukum di repositori ini. Skrip AC13/AC15/AC16 adalah **DEMO ONLY**, bukan bukti kapasitas produksi atau audit pihak ketiga.

Sumber kebenaran produk: `PRD.md` dan `DESIGN.md`.

## Menjalankan

Prasyarat: Node.js 24 atau lebih baru, PostgreSQL 16/17, pnpm 11.

```bash
pnpm install
docker compose up -d db      # PostgreSQL lokal 127.0.0.1:5432 (role aplikasi non-superuser)
export DATABASE_URL='postgres://svara:svara_dev_password@127.0.0.1:5432/svara'
SEED_DEMO=1 pnpm db:reset    # reset schema + migrasi + data sintetis
pnpm dev                     # API 127.0.0.1:3001 + Next.js 127.0.0.1:3000
```

PowerShell: `$env:DATABASE_URL='postgres://svara:svara_dev_password@127.0.0.1:5432/svara'; $env:SEED_DEMO='1'; pnpm db:reset`.

Buka `http://127.0.0.1:3000`. `DATABASE_URL` adalah satu-satunya sumber data runtime. Tidak ada fallback SQLite.

`pnpm dev` menjalankan dua proses: Express di `:3001` dan Next.js di `:3000`. Browser hanya memanggil origin web; rewrite Next meneruskan `/api/:path*` ke `API_ORIGIN`.

Produksi lokal:

```bash
pnpm build
pnpm start          # API :3001 + Next production :3000; migrasi berjalan saat startup API
```

Server menjalankan migrasi versioned sebelum menerima permintaan. Untuk basis data kosong, jalankan `pnpm admin:bootstrap` agar ada akun admin.

### Ingress produksi

Pisahkan trafik di reverse proxy/load balancer:

| Path | Tujuan |
| --- | --- |
| `/api/*` | Express (`api:3001`) |
| semua path lain | Next.js (`web:3000`) |

Dengan pembagian ini Next tidak memproksikan API di produksi. Rewrite `/api/:path*` tetap ada untuk pengembangan dan deployment satu-origin; jangan mengandalkannya sebagai jalur produksi.

## Migrasi basis data

- `server/migrations/*.sql` diterapkan berurutan dan dicatat di `schema_migrations` (versi + checksum).
- Runner (`server/migrate.ts`) memakai advisory lock, satu transaksi per migrasi, dan rollback bila gagal.
- `pnpm db:migrate` menerapkan migrasi yang belum ada.
- `SEED_DEMO=1 pnpm db:reset` menghapus schema `public`, menerapkan semua migrasi, lalu memuat data sintetis.
- `pnpm test` memakai basis data uji terpisah (`TEST_DATABASE_URL`), me-reset schema, lalu menjalankan migrasi.
- Migrasi mengubah checksum yang sudah tercatat akan ditolak; buat file migrasi baru, jangan edit yang sudah dirilis.
- Data SQLite lama tidak diimpor otomatis oleh perubahan ini. Ekspor/impor data nyata harus dilakukan sebagai prosedur terpisah dengan verifikasi.

## Docker

Tiga layanan terpisah: `web` (Next.js standalone), `api` (Express), `db` (Postgres).

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
- Rewrite web dibekukan saat build (`API_ORIGIN_BUILD`, default `http://api:3001`). Untuk produksi, arahkan ingress `/api/*` langsung ke `api` seperti tabel di atas.
- Port host hanya bind ke `127.0.0.1:3000` (web), `127.0.0.1:3001` (api), dan `127.0.0.1:5432` (db); letakkan reverse proxy/TLS di depan web.
- Set `APP_ORIGIN` ke origin publik web (boleh beberapa origin dipisah koma), lalu `COOKIE_SECURE=1` dan `ENABLE_HSTS=1` setelah HTTPS aktif.
- Jangan set `SEED_DEMO=1` di production; container API memakai `NODE_ENV=production` dan akan menolak startup.

Perintah verifikasi:

```bash
pnpm typecheck      # next typegen + TypeScript web + server
pnpm lint           # ESLint
pnpm test           # typecheck + migrasi + suite HTTP + seed gate (butuh PostgreSQL uji)
pnpm build          # typecheck + next build
pnpm db:migrate     # terapkan migrasi ke DATABASE_URL
SMOKE_WEB_ORIGIN=http://127.0.0.1:3000 \
  SMOKE_EMAIL=admin@example.org SMOKE_PASSWORD='...' \
  pnpm smoke:web    # root, login, CSP nonce, rewrite health, login + bootstrap
```

## Konfigurasi

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
| `APP_ORIGIN` | `http://127.0.0.1:3000` | Origin yang diizinkan untuk mutasi; pisahkan beberapa origin dengan koma |
| `COOKIE_SECURE` | `0` | Set `1` di belakang HTTPS |
| `ENABLE_HSTS` | `0` | Set `1` hanya setelah deployment HTTPS siap |
| `SESSION_TTL_HOURS` | `8` | Umur sesi (jam) |
| `INTEGRATION_TOKEN` | kosong | Bearer untuk `/api/v1/integration/survey-data`; tanpa nilai, endpoint selalu menolak |
| `SEED_DEMO` | `0` | Harus `1` untuk memuat data demo; ditolak saat `NODE_ENV=production` |
| `SEED_PASSWORD` | kata sandi seed lokal | Sandi akun sintetis; hanya dipakai bila `SEED_DEMO=1` |
| `AC15_ADMIN_DATABASE_URL` | `DATABASE_URL` | Koneksi berizin `CREATE DATABASE` untuk demo AC15 |

Contoh ada di `.env.example`. Jangan commit nilai rahasia produksi.

## Bootstrap admin produksi

Server tidak lagi mengisi basis data kosong dengan akun demo secara otomatis. Untuk deployment baru, buat admin pertama secara eksplisit:

```bash
BOOTSTRAP_ADMIN_EMAIL=admin@example.org \
BOOTSTRAP_ADMIN_NAME=Administrator \
BOOTSTRAP_ADMIN_PASSWORD='Sandi-Kuat-Dari-Secret-Manager-2026!' \
pnpm admin:bootstrap
```

- `BOOTSTRAP_ADMIN_PASSWORD` minimal 12 karakter dan memakai minimal 3 dari: huruf kecil, huruf besar, angka, simbol.
- Script idempoten: email yang sudah menjadi `super_admin` tidak ditimpa.
- Jangan menaruh sandi nyata di shell history, `.env` yang ter-commit, atau argumen command line; gunakan secret manager/environment.
- `NODE_ENV=production SEED_DEMO=1` akan menghentikan startup. Data demo hanya untuk lokal/CI.

## Arsitektur

- `server/` — Express 5, PostgreSQL via `pg` Pool (semua akses data async), migrasi versioned, cookie sesi HttpOnly, hash kata sandi `scrypt`, header `X-Svara-Client` untuk mutasi, pembatasan laju kiriman, audit append-only.
- `server/db.ts` — `all/get/run/withTx` async. Transaksi memakai satu client lewat `AsyncLocalStorage`; query di dalam `withTx` otomatis ikut transaksi dan rollback saat error.
- `server/migrations/` — skema 21 tabel dengan foreign key, unique constraint, dan indeks; `schema_migrations` mencatat versi + checksum.
- `src/app/` — Next.js App Router (React 19, Node runtime) untuk semua rute UI; `src/screens/` menyimpan komponen layar lama tanpa perubahan perilaku.
- `src/proxy.ts` — konvensi `middleware` Next.js 16: nonce CSP per request (tanpa `unsafe-inline` pada `script-src`), `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, dan HSTS saat `ENABLE_HSTS=1`.
- `src/lib/server/guards.ts` — guard role server untuk `/creator` dan `/admin`: baca cookie sesi, panggil `/api/v1/bootstrap` di `API_INTERNAL_URL`, redirect ke `/auth/login` bila belum masuk. Tidak mengimpor store klien.
- `src/lib/api.ts` — kontrak HTTP; `src/lib/store.ts` — snapshot untuk render dan aksi, tetap memuat bootstrap di klien dan mengirim semua mutasi ke `/api/v1`.
- Respons publik disimpan dengan kunci idempotensi dan bukti yang hanya dapat dibuka dengan kunci yang sama.
- Persetujuan wajib tercatat di server sebelum metadata formulir atau pengiriman diproses.
- Izin baca individual, ekspor, dan teks bebas terpisah per akun dan survei. Ekspor tanpa izin ditolak `403` dan dicatat.

### Rute

UI mempertahankan URL lama:

`/`, `/auth/login`, `/privacy`, `/terms`, `/creator`, `/creator/surveys/[id]/{edit,preview,publish,share,results,settings,history}`, `/s/[token]/{,form,review,receipt}`, `/admin`, `/admin/{accounts,audit,integration,requests}`, dan 404 untuk path lain. `/s/[token]/*` tetap publik tanpa guard.

`super_admin` yang membuka `/creator` mendapat tampilan “Akses ditolak”, dan peran creator yang membuka `/admin` juga ditolak; ini sama dengan guard klien sebelumnya.

### Akun sintetis

Dibuat hanya oleh `SEED_DEMO=1 pnpm db:reset` (atau `SEED_DEMO=1 pnpm db:seed`). Sandi berasal dari `SEED_PASSWORD`; bila tidak diset, nilai demo lokal adalah `SvaraDemo123!` (hanya untuk data sintetis; jangan dipakai di production).

| Email | Peran | Cakupan awal |
| --- | --- | --- |
| `creator.a@svara.local` | creator | Pemilik `s_demo1`, `s_demo2`, `s_demo4` |
| `creator.b@svara.local` | creator | Pemilik `s_demo3` |
| `officer@svara.local` | authorized_officer | Grant baca/ekspor/teks pada `s_demo1` |
| `admin@svara.local` | super_admin | Operasional; tidak otomatis boleh membaca jawaban |
| `suspended@svara.local` | creator (suspended) | Ditolak saat masuk |

### Tautan sintetis

- `link-umum-demo` — survei SMK, mode wali, notice sintetis.
- `link-umum-perpus` — survei perpustakaan, persetujuan diri.
- `undangan-demo` — undangan satu kali.
- Kode undangan individual juga dapat dibuka dari halaman masuk lewat “Saya memiliki kode undangan”.

## Bukti demo

Demo memakai `DATABASE_URL` yang menunjuk basis data bernama test/demo (ditolak untuk nama lain) dan me-reset schema-nya. `pnpm test` memakai `TEST_DATABASE_URL`.

```bash
pnpm demo:ac13     # 30 kiriman paralel, 20 item, tulis docs/test-evidence/ac13-load.json
pnpm demo:ac15     # pg_dump, hapus satu respons, recreate DB, pg_restore, tulis docs/test-evidence/ac15-restore.json
pnpm demo:ac16     # tiga responden sintetis + rekonsiliasi CSV
```

### AC15: prosedur pg_dump/pg_restore

Demo membuat basis data sementara sendiri, bukan memakai ulang data yang ada:

```bash
export AC15_ADMIN_DATABASE_URL='postgres://postgres:postgres_admin_dev@127.0.0.1:5432/postgres'
export DATABASE_URL='postgres://svara:svara_dev_password@127.0.0.1:5432/svara_test'
pnpm demo:ac15
```

Perintah yang diuji (dokumentasi operasional; ganti nama basis data/berkas):

```bash
pg_dump --dbname="$DATABASE_URL" --format=custom --file=backup.dump
# ...basis data dibuat ulang kosong...
pg_restore --dbname="$DATABASE_URL" --clean --if-exists --no-owner --no-privileges backup.dump
```

- Default `AC15_ADMIN_DATABASE_URL` adalah `DATABASE_URL`; role tersebut butuh izin `CREATE DATABASE`.
- Bila `pg_dump`/`pg_restore` tidak ada di PATH, skrip memakai image `postgres:17-alpine` via Docker (`AC15_PG_IMAGE` untuk override).
- Restore mengembalikan isi cadangan. Penghapusan data yang diminta setelah restore harus diulang dan dicatat; restore bukan alat penghapusan permanen.
- Bukti ini tidak menguji cadangan terenkripsi, off-site, RPO/RTO, atau prosedur insiden.

Semua keluaran berlabel **DEMO ONLY**. AC13 bukan uji kapasitas; AC15 bukan prosedur insiden; AC16 bukan studi lapangan. Angka dan keterbatasan ada di `docs/test-evidence/`.

## Batasan yang disengaja

- Integrasi Modul 13/15 disimulasikan; tidak ada jaringan lintas layanan nyata.
- Tidak ada email, SMS, atau verifikasi identitas responden.
- Retensi, kontak pengendali, dan transfer lintas negara tetap `null` sampai pengendali menetapkannya.
- Teks kebijakan adalah template sintetis, bukan nasihat hukum.
- Rate limit disimpan di proses; deployment multi-instance memerlukan penyimpanan bersama.
- Backup demo memakai `VACUUM INTO` lokal; belum ada enkripsi, off-site, atau uji RPO/RTO.
