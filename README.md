# Svara · Modul 14

Aplikasi full-stack untuk membuat survei berskala, menerbitkan versi tetap, mengumpulkan respons dengan persetujuan, dan menyajikan hasil agregat serta ekspor terbatas.

> Data awal **sintetis**. Tidak ada pekerjaan lapangan, peserta nyata, atau klaim kepatuhan hukum di repositori ini. Skrip AC13/AC15/AC16 adalah **DEMO ONLY**, bukan bukti kapasitas produksi atau audit pihak ketiga.

Sumber kebenaran produk: `PRD.md` dan `DESIGN.md`.

## Menjalankan

Prasyarat: Node.js 24 atau lebih baru (memakai `node:sqlite`), pnpm 11.

```bash
pnpm install
SEED_DEMO=1 pnpm db:reset   # buat data sintetis di data/svara.sqlite
pnpm dev                    # API 127.0.0.1:3001 + Vite 127.0.0.1:5173
```

PowerShell: `$env:SEED_DEMO='1'; pnpm db:reset`.

Produksi lokal:

```bash
pnpm build
pnpm start          # API + dist pada 127.0.0.1:3000
```

Jika `DB_PATH` masih kosong, jalankan `pnpm admin:bootstrap` lebih dulu agar ada akun admin.

## Docker

```bash
docker compose build
docker compose run --rm \
  -e BOOTSTRAP_ADMIN_EMAIL=admin@example.org \
  -e BOOTSTRAP_ADMIN_NAME=Administrator \
  -e BOOTSTRAP_ADMIN_PASSWORD='sandi-kuat-dari-secret-manager' \
  app tsx server/scripts/bootstrap-admin.ts
docker compose up -d
```

- Data SQLite tersimpan di volume `svara_data`.
- Port hanya bind ke `127.0.0.1:3000`; letakkan reverse proxy/TLS di depannya.
- Set `APP_ORIGIN` ke origin publik, lalu `COOKIE_SECURE=1` dan `ENABLE_HSTS=1` setelah HTTPS aktif.
- Jangan set `SEED_DEMO=1` di production; container memakai `NODE_ENV=production` dan akan menolak startup.

Perintah verifikasi:

```bash
pnpm typecheck      # TypeScript web + server
pnpm lint           # ESLint
pnpm test           # typecheck + suite HTTP end-to-end + seed gate
pnpm build          # typecheck + Vite
```

## Konfigurasi

| Variabel | Default | Keterangan |
| --- | --- | --- |
| `PORT` | `3000` saat `--serve`, `3001` saat API dev | Port HTTP |
| `HOST` | `127.0.0.1` | Alamat bind |
| `DB_PATH` | `data/svara.sqlite` | Lokasi SQLite; dibuat bila belum ada |
| `APP_ORIGIN` | `http://127.0.0.1:3000` | Origin yang diizinkan untuk mutasi |
| `COOKIE_SECURE` | `0` | Set `1` di belakang HTTPS |
| `ENABLE_HSTS` | `0` | Set `1` hanya setelah deployment HTTPS siap |
| `SESSION_TTL_HOURS` | `8` | Umur sesi (jam) |
| `INTEGRATION_TOKEN` | kosong | Bearer untuk `/api/v1/integration/survey-data`; tanpa nilai, endpoint selalu menolak |
| `SEED_DEMO` | `0` | Harus `1` untuk memuat data demo; ditolak saat `NODE_ENV=production` |
| `SEED_PASSWORD` | kata sandi seed lokal | Sandi akun sintetis; hanya dipakai bila `SEED_DEMO=1` |

Contoh ada di `.env.example`. Jangan commit nilai rahasia produksi.

## Bootstrap admin produksi

Server tidak lagi mengisi basis data kosong dengan akun demo secara otomatis. Untuk deployment baru, buat admin pertama secara eksplisit:

```bash
BOOTSTRAP_ADMIN_EMAIL=admin@example.org \
BOOTSTRAP_ADMIN_NAME=Administrator \
BOOTSTRAP_ADMIN_PASSWORD='sandi-kuat-dari-secret-manager' \
pnpm admin:bootstrap
```

- `BOOTSTRAP_ADMIN_PASSWORD` minimal 12 karakter dan memakai minimal 3 dari: huruf kecil, huruf besar, angka, simbol.
- Script idempoten: email yang sudah menjadi `super_admin` tidak ditimpa.
- Jangan menaruh sandi nyata di shell history, `.env` yang ter-commit, atau argumen command line; gunakan secret manager/environment.
- `NODE_ENV=production SEED_DEMO=1` akan menghentikan startup. Data demo hanya untuk lokal/CI.

## Arsitektur

- `server/` — Express 5, `node:sqlite`, cookie sesi HttpOnly, hash kata sandi `scrypt`, header `X-Svara-Client` untuk mutasi, pembatasan laju kiriman, audit append-only.
- `src/` — React 19 + Vite + Tailwind v4; seluruh data bisnis dibaca dari API, bukan `localStorage`.
- `src/lib/api.ts` — kontrak HTTP; `src/lib/store.ts` — snapshot untuk render dan aksi.
- Respons publik disimpan dengan kunci idempotensi dan bukti yang hanya dapat dibuka dengan kunci yang sama.
- Persetujuan wajib tercatat di server sebelum metadata formulir atau pengiriman diproses.
- Izin baca individual, ekspor, dan teks bebas terpisah per akun dan survei. Ekspor tanpa izin ditolak `403` dan dicatat.

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

```bash
pnpm demo:ac13     # 30 kiriman paralel, 20 item, tulis docs/test-evidence/ac13-load.json
pnpm demo:ac15     # cadangan, hapus, pulihkan, tulis docs/test-evidence/ac15-restore.json
pnpm demo:ac16     # tiga responden sintetis + rekonsiliasi CSV
```

Semua keluaran berlabel **DEMO ONLY**. AC13 bukan uji kapasitas; AC15 bukan prosedur insiden; AC16 bukan studi lapangan. Angka dan keterbatasan ada di `docs/test-evidence/`.

## Batasan yang disengaja

- Integrasi Modul 13/15 disimulasikan; tidak ada jaringan lintas layanan nyata.
- Tidak ada email, SMS, atau verifikasi identitas responden.
- Retensi, kontak pengendali, dan transfer lintas negara tetap `null` sampai pengendali menetapkannya.
- Teks kebijakan adalah template sintetis, bukan nasihat hukum.
- Rate limit disimpan di proses; deployment multi-instance memerlukan penyimpanan bersama.
- Backup demo memakai `VACUUM INTO` lokal; belum ada enkripsi, off-site, atau uji RPO/RTO.
