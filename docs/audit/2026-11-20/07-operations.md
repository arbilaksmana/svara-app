# 07 — Operasi, reliability, dan kesiapan lingkungan

- Baseline: `95eafa3cb38aac4dd32963a1ec584a2ce6821f25`.
- Semua runtime uji lokal memakai data sintetis dan database khusus `svara_audit_*`. Tidak diuji pada staging atau produksi.
- Rujukan: `01-documents.md` (konflik/requirement), `05-security-vulnerabilities.md` (container, CI, secrets), `06-performance-scalability.md` (kapasitas dan shutdown).

## 1. Baseline yang dijalankan koordinator

| Check | Hasil | Bukti |
|---|---|---|
| Dependency setup | `pnpm install --frozen-lockfile` berhasil; 266 paket ditambahkan di checkout audit; lockfile dinyatakan up-to-date | Log tool instalasi; `package.json`, `pnpm-lock.yaml` |
| Lint | `pnpm lint`, exit 0 | `evidence/ops/lint.log` |
| Typecheck + migrasi + API + ekspor + versi + seed | `pnpm test`, exit 0; 5 migrasi + 25 API + 1 ekspor + 1 ringkasan versi + 7 seed-policy = 39 test pass, 0 fail | `evidence/ops/test.log` |
| Production build | `API_ORIGIN=http://127.0.0.1:4321 pnpm build`, exit 0; Next standalone output dibuat dari baseline yang dipatok | `evidence/ops/build.log`; `evidence/perf/gate-status.json` |
| Web smoke | `node scripts/smoke-web.mjs`, exit 0; root/login/CSP nonce/API rewrite/login/bootstrap lulus | `evidence/ops/smoke.log` |
| Advisory scan | `pnpm audit --json`: 1 moderate advisory `minimatch@10.2.6`, hanya dev dependency `typescript-eslint`; `pnpm audit --prod --json`: 0 advisory | `evidence/ops/pnpm-audit.json`; Security report §5 |
| Database compatibility | Migrate mengaplikasikan `001..009`; Postgres 17.12 | `evidence/ops/restore-migrate.log`; `evidence/ops/restore-seed.log` |

Angka 39 merupakan jumlah test yang dilaporkan Node test runner di lima proses suite, bukan cakupan 39 fitur bisnis. Hasil pass menunjukkan kontrak yang sudah diuji saja; ia tidak meniadakan temuan audit. Contoh: suite test menutup sebagian aturan owner-scope/bootstrap, tetapi tidak memanggil halaman public untuk membuktikan notice yang dilihat responden, maupun menguji ekspor terhadap setiap kombinasi grant dan settings.

### Smoke split web/API

Preview produksi lokal menggunakan API khusus `svara_audit_ui`, Next standalone, dan gateway audit same-origin. Hasil:

| Interaksi | Hasil |
|---|---|
| `GET /` | 200 |
| `GET /auth/login` | 200 |
| CSP nonce | Ditemukan pada 14 elemen script dalam hasil smoke |
| `GET /api/v1/health` melalui rewrite | 200 |
| Login synthetic admin | Lulus |
| Authenticated `/bootstrap` | Lulus sebagai `super_admin` |

Artefak smoke mentah: `evidence/ops/smoke.log`. `scripts/smoke-web.mjs` menguji alur smoke singkat, bukan semua tombol, semua role, consent, response/export, atau accessibility. Screenshot dan keyboard coverage dimiliki UI/UX worker.

## 2. Backup/restore sintetis

Koordinator menyiapkan `svara_audit_restore`, menjalankan migrasi 009, dan seed sintetis. Uji runtime langsung di kontainer PostgreSQL lokal:

1. Snapshot jumlah awal `responses=6`, `answers=18`, `audit_logs=8`.
2. `pg_dump -Fc` menghasilkan dump custom 55,644 byte.
3. Hapus satu respons sintetis (`r_demo01`) pada DB audit: `responses=5`, `answers=15`; target tidak ditemukan.
4. `pg_restore --clean --if-exists --no-owner --no-privileges` mengembalikan `responses=6`, `answers=18`; target ada kembali.
5. Insert satu audit pasca-restore: query menemukan satu event dengan ID audit pengujian.

Bukti: `evidence/ops/ac15-restore-runtime.log`. Uji ini membuktikan sifat dasar restore lokal dan bahwa snapshot memunculkan kembali row yang sebelumnya dihapus. Replay setelah restore dapat menambah audit, tetapi prosedur penghapusan tidak punya identitas permintaan/pemilik subjek untuk menentukan row mana yang harus dihapus. Uji ini **bukan** bukti latihan insiden, penghapusan terotorisasi end-to-end, integritas audit penghapusan, cadangan terenkripsi/off-site, ketersediaan credential pemulihan, target RPO/RTO, atau pemulihan di host/region berbeda. Artefak demo historis `docs/test-evidence/ac15-restore.json` tidak ditimpa.

## 3. Konfigurasi dan temuan operasional

| Temuan | Bukti dan dampak | Status |
|---|---|---|
| Setup README tidak sejalan dengan manifest | README memandu npm/no `packageManager`; manifest mengunci pnpm 11.5.2. `pnpm install --frozen-lockfile` pada checkout audit berhasil. Onboarding developer dapat memilih jalur dan lockfile yang berbeda. | Terkonfirmasi |
| Panduan restore memuat instruksi SQLite lama | README mengakhiri bagian backup PostgreSQL dengan `VACUUM INTO`; prosedur aktif menggunakan `pg_dump`/`pg_restore`. Operator yang mengikuti langkah terakhir akan memakai mekanisme untuk engine berbeda. | Terkonfirmasi |
| Lingkungan Compose memakai default khusus lokal | Compose menyediakan password PostgreSQL, callback/origin, cookie, HSTS, token integrasi, serta database/port default; ini berguna untuk demo lokal tetapi bukan profil produksi yang aman secara otomatis. Tidak ada pengujian pada deployment production atau validasi startup bahwa placeholder telah diganti. | Default dikonfirmasi; produksi NOT_VERIFIED |
| Cookie/TLS deployment belum dibuktikan | Compose default `COOKIE_SECURE=0`, `ENABLE_HSTS=0`; deployment HTTPS, TLS termination, proxy trust, cookie `Secure`, forwarded headers, access-log redaction belum diuji. Security audit menemukan `COOKIE_SECURE` tidak dipakai dan `Secure` bergantung pada header proxy yang dikendalikan klien. | Perlu konfigurasi + runtime validation sebelum pilot internet |
| Health check bukan readiness transaksi | API health melakukan `SELECT 1` lewat pool kerja yang sama; web health memeriksa halaman login. Keduanya tidak membuktikan bahwa migrasi/seed/business path siap. Pool saturation dapat mengganggu health tanpa endpoint drain terpisah. | Static-proven; dampak load menunggu pengukuran |
| Tidak ada batas resource atau stop grace eksplisit di Compose | Tidak ada batas memory/CPU/DB pool global atau `stop_grace_period`. API memasang timer keluar 5 detik saat SIGTERM; request panjang dapat terpotong bila melebihi masa itu. Runtime shutdown saat in-flight request tidak diuji. | Static-proven; runtime NOT_VERIFIED |
| CI memverifikasi proses, bukan kesiapan produksi | GitHub CI menjalankan migration/lint/test/build/container build dan smoke browser, memakai Postgres lokal sementara. Tidak ada deploy stage, staging parity, migration rollback test pada volume produksi, secret deployment, backup schedule, SLO, restore/offsite verification, image scan atau performance budget. Security report merinci aksi pinning/image. | File CI ditinjau; operasi produksi NOT_VERIFIED |
| Migrasi baru kompatibel pada DB audit bersih | `001..009` berhasil di suite dan DB restore; tes upgrade 008→009 mengisi masa berlaku undangan lama. Tidak ada validasi upgrade terhadap salinan backup produksi atau volume berisi data nyata. | PASS untuk test fixture; production migration NOT_VERIFIED |
| Retensi dan penghapusan tidak berjalan otomatis | `retention_days` disimpan tetapi tidak ada job enforcement; permintaan publik tidak mengikat subjek/response/consent. Backup restore dapat mengembalikan data yang sudah dihapus. | Gap produk/proses; blocker sebelum data nyata bila kebijakan mensyaratkan penghapusan |
| Dependensi runtime bersih pada snapshot advisory | Production tree `pnpm audit --prod` bersih pada waktu scan; satu advisory moderate ditemukan hanya di lint dependency. Tidak ada OS/image CVE scan karena scanner tidak tersedia/tidak dipasang. | Dependency audit selesai; image scan NOT_VERIFIED |

## 4. Batas kesiapan

### Demo sintetis lokal

`pnpm test`, build, smoke, database Postgres, seed sintetis, dan backup/restore lokal berjalan pada baseline. Ini membuktikan jalur terpilih di lingkungan satu mesin.

### Pilot dengan peserta atau data sensitif

Belum siap dinyatakan. Temuan consent/guardian, notice/policy, export permissions, proses subjek data, retensi, dan keputusan pemilik kebijakan perlu diselesaikan/diputuskan lebih dahulu. Tanggung jawab pengendali, verifikasi wali, contact point, tujuan penerima ekspor, dan jadwal retensi belum ditetapkan oleh dokumen yang ditemukan. Tidak ada kesimpulan legal/compliance.

### Produksi internet / multi-instance

Tidak diverifikasi dan tidak boleh disimpulkan dari compose lokal atau smoke. Masih perlu model ingress/TLS/proxy yang nyata, secret/credential/rotation, rate-limit/shared state, resource budget/pool budget, metrik/log/alert, backup off-site encryption + latihan restore + target RPO/RTO, readiness/drain, migrasi saat deploy, dan pengukuran beban yang lolos gate.

## 5. Belum diverifikasi

- Uji restore pada cadangan enkripsi/off-site atau region/host terpisah.
- Penghapusan yang diverifikasi pemohon, replay penghapusan setelah restore, dan bukti keutuhan audit yang cocok ke subjek/respons.
- Prosedur incident response, alerting, on-call, access-log/proxy retention dan redaction.
- Production cookie/TLS/HSTS/CSP melalui ingress browser nyata.
- Resource limits, pool maksimum untuk jumlah replica, graceful shutdown dengan in-flight API/export.
- Kinerja dari lokasi responden yang representatif dan layanan eksternal Modul 13/15 nyata.
- Backup cadence, usia salinan, kegagalan cadangan, RPO/RTO dan pemilik keputusan.
- Image vulnerability scan/SBOM/provenance dan deployment pipeline.

- Run dinamis performa selesai: AC13 1k/10k PASS dan mixed 10 VU read PASS; mixed 30 VU INVALID akibat 2.587 status 403, sedangkan skenario high-load BLOCKED saat RAM bebas minimum 306 MB. Service perf 4340–4343 dihentikan; port 3001/4320/4322/4331 masih dipakai proses lain. Detail di `06-performance-scalability.md` §5–§8.
