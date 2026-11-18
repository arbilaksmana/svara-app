# Svara · Modul 14

Aplikasi full-stack untuk membuat survei berskala, menerbitkan versi tetap, mengumpulkan respons dengan persetujuan, dan menyajikan hasil agregat serta ekspor terbatas.

> Data awal **sintetis**. Tidak ada pekerjaan lapangan, peserta nyata, atau klaim kepatuhan hukum di repositori ini. Skrip AC13/AC15/AC16 adalah **DEMO ONLY**, bukan bukti kapasitas produksi atau audit pihak ketiga.

Sumber kebenaran produk: `PRD.md` dan `DESIGN.md`.

## Menjalankan

Prasyarat: Node.js 24 atau lebih baru (memakai `node:sqlite`), pnpm 11.

```bash
pnpm install
pnpm db:reset       # buat data sintetis di data/svara.sqlite
pnpm dev            # API 127.0.0.1:3001 + Vite 127.0.0.1:5173
```

Produksi lokal:

```bash
pnpm build
pnpm start          # API + dist pada 127.0.0.1:3000
```

Perintah verifikasi:

```bash
pnpm typecheck      # TypeScript web + server
pnpm lint           # ESLint
pnpm test           # typecheck + suite HTTP end-to-end
pnpm build          # typecheck + Vite
```

## Konfigurasi

| Variabel | Default | Keterangan |
| --- | --- | --- |
| `PORT` | `3000` saat `--serve`, `3001` saat API dev | Port HTTP |
| `HOST` | `127.0.0.1` | Alamat bind |
| `DB_PATH` | `data/svara.sqlite` | Lokasi SQLite; dibuat dan di-seed bila kosong |
| `APP_ORIGIN` | `http://127.0.0.1:3000` | Origin yang diizinkan untuk mutasi |
| `COOKIE_SECURE` | `0` | Set `1` di belakang HTTPS |
| `SESSION_TTL_HOURS` | `8` | Umur sesi (jam) |
| `INTEGRATION_TOKEN` | kosong | Bearer untuk `/api/v1/integration/survey-data`; tanpa nilai, endpoint selalu menolak |
| `SEED_PASSWORD` | kata sandi seed lokal | Sandi akun sintetis saat basis data dibuat |

Contoh ada di `.env.example`. Jangan commit nilai rahasia produksi.

## Arsitektur

- `server/` — Express 5, `node:sqlite`, cookie sesi HttpOnly, hash kata sandi `scrypt`, header `X-Svara-Client` untuk mutasi, pembatasan laju kiriman, audit append-only.
- `src/` — React 19 + Vite + Tailwind v4; seluruh data bisnis dibaca dari API, bukan `localStorage`.
- `src/lib/api.ts` — kontrak HTTP; `src/lib/store.ts` — snapshot untuk render dan aksi.
- Respons publik disimpan dengan kunci idempotensi dan bukti yang hanya dapat dibuka dengan kunci yang sama.
- Persetujuan wajib tercatat di server sebelum metadata formulir atau pengiriman diproses.
- Izin baca individual, ekspor, dan teks bebas terpisah per akun dan survei. Ekspor tanpa izin ditolak `403` dan dicatat.

### Akun sintetis

Dibuat oleh `pnpm db:reset`. Sandi berasal dari `SEED_PASSWORD`; bila tidak diset, nilai demo lokal adalah `SvaraDemo123!` (hanya untuk data sintetis; ganti atau hapus sebelum deployment).

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
