# 06 — Performance & Scalability

**Audit:** Svara · commit `95eafa3cb38aac4dd32963a1ec584a2ce6821f25` · 2026-11-20
**Owner:** performance/scalability static analysis, workload design, and gated dynamic run
**Dynamic measurements:** **COMPLETE WITH BLOCKED HIGH-LOAD CHECKS** — gate exclusive dibuka koordinator (`task_d891e6600c3f`), lalu dijalankan AC13 1k/10k, EXPLAIN ANALYZE, mixed 10 VU, dan satu percobaan mixed 30 VU. AC13 1k/10k **PASS** dan rekonsiliasi **PASS**; 100k/export **BLOCKED** (free RAM <3,5 GB; export tidak disetujui), sedangkan ramp 100 VU, spike 200, dan soak 20 VU/30m **BLOCKED** karena free RAM min 306 MB pada 30 VU — bukan PASS.
**Static artifacts:** `evidence/perf/static-baseline.json`, `evidence/perf/static-query-inventory.md`, `evidence/perf/static-index-inventory.txt`, `evidence/perf/gate-status.json`.

| Area | Status |
|---|---|
| Review query, indeks, pool, transaksi | **COMPLETE (static)** |
| Review aggregation/export, event loop, buffering | **COMPLETE (static)** |
| Review Next.js rendering/fetch/bundle | **COMPLETE (static + existing build artifact)** |
| Review process-local state, rate limit, session | **COMPLETE (static)** |
| Review shutdown, container, ingress, CI | **COMPLETE (static)** |
| Definisi workload, dataset, safety | **COMPLETE** |
| Official AC13 (30 × 20, p95 receive→commit ≤3 s) | **PASS pada 1k dan 10k (lokal)** |
| Measured local capacity | **PARTIAL (10 VU read; high-load BLOCKED)** |
| Scale-out readiness | **PARTIAL (static + 10 VU evidence)** |

> Gate membuka 1k/10k dan beban terbatas; 100k tidak di-seed, export tidak dijalankan, dan tidak ada uji SIGTERM container. Angka runtime hanya untuk host/topologi/dataset di §5–§6; jangan diekstrapolasi ke produksi atau 100k. Klaim lama `docs/test-evidence/ac13-load.json` tidak dipakai sebagai bukti AC13 resmi (lihat §6).

---

## 1. Ringkasan eksekutif

1. **Bootstrap adalah biaya terbesar dan sebagian murni sia-sia.** `GET /bootstrap` menjalankan `summaryFor` untuk setiap versi yang bisa dibaca akun (`server/bootstrap.ts:345-356`), padahal field `summaries` tidak pernah dibaca klien (`src/lib/api.ts:100` hanya mendeklarasikan tipe). Untuk creator dengan 1 survei/1 versi/20 item ≈ **53 query**; untuk `super_admin` biayanya menjadi **O(seluruh jawaban di instalasi)**. Bootstrap dipanggil **dua kali per page load** (guard server + klien) dan **sekali lagi setelah setiap mutasi**.
2. **Summary dan halaman jawaban individual melakukan pekerjaan yang tumbuh dengan seluruh dataset, bukan dengan data yang ditampilkan.** `summaryFor` memakai 2 query per item yang menyentuh semua jawaban versi; `GET /surveys/:id/responses?limit=100` memuat **semua jawaban versi** sebelum memotong 100 respons (`server/routes/surveys.ts:795-801`). Di 100k respons × 20 item, satu page view menyentuh ±2 juta baris.
3. **Export bersifat all-in-memory dan tidak bisa dibatalkan.** Seluruh respons + jawaban dimaterialisasi, lalu CSV raksasa dibangun sebagai satu string, tanpa streaming/backpressure/abort; API juga tidak mengompresi respons. Ini kandidat OOM dan penyebab shutdown 5 detik memotong request.
4. **Rate limiter tidak siap multi-instance dan salah alamat di belakang ingress.** Map proses-lokal tanpa TTL (`server/security.ts:196-210`), key memakai `req.ip` tanpa `trust proxy`. Di belakang gateway, semua responden menjadi satu IP: **40 submit/10 menit untuk seluruh sistem**, 30 consent/menit per token, 5 registrasi/15 menit. README sendiri mencatat keterbatasan ini.
5. **Indeks untuk jalur terpanas belum ada.** Lookup `public_links.token_hash` dan `invitations.token_hash` tidak punya indeks (indeks yang ada justru pada `token` mentah); pagination `responses` tidak punya `(version_id, submitted_at, id)`; agregasi summary tidak punya indeks `answers(question_id/option_id)`. Semua perlu dibuktikan dengan `EXPLAIN (ANALYZE, BUFFERS)` setelah gate, bukan langsung ditambahkan.

---

## 2. Baseline lingkungan (statis)

Diambil 2026-11-20T13:50:01Z. Detail lengkap: `evidence/perf/static-baseline.json`.

| Item | Nilai |
|---|---|
| OS / CPU / RAM | Windows 10.0.26200 · Ryzen 7 5800H · 16 logical CPU · 14.188 MB |
| RAM tersedia saat capture | 2.389 MB (probe audit lain aktif) |
| Node / pnpm / Next / React | 24.15.0 · 11.5.2 · 16.4.6 · 19.3.1 |
| Docker VM | 3.916 MB RAM, 16 CPU; `svara-app-db-1` 160 MiB / 3.824 GiB |
| PostgreSQL | 17.12, container, `127.0.0.1:5432` |
| DB audit | `svara_audit_perf`, 25 tabel, 9 migrasi, 9,2 MB |
| Baris awal DB | 6 akun, 4 survei, 4 versi, 6 respons, 18 jawaban (demo dari probe sebelumnya) |
| Pool app | `PG_POOL_MAX=10`, idle 10 s, acquire 5 s, **tanpa statement_timeout** |
| Build web | `.next` BUILD_ID `3RzZi-drCTjszTT7A99TF`, 2026-11-20 20:42 +0700 — **dikonfirmasi koordinator dari commit `95eafa3`** |
| Rewrite `/api` di build | `http://127.0.0.1:4321` — **bukan** gateway perf |
| Port terpakai probe lain | `127.0.0.1:4311` |
| Port perf | 4340 gateway, 4341 API-A, 4342 API-B, 4343 Next — bebas saat capture statis; saat run dinamis 4320/4322/4331 masih listening (lihat §5.1) |

DB sudah berisi seed demo. Rencana dataset perf karena itu **aditif** (tidak truncate), agar data probe lain tidak hilang.

Kemampuan yang diverifikasi: koneksi dari `127.0.0.2`/`127.0.0.3` ke server loopback diterima dan `remoteAddress` sesuai. Ini dipakai untuk memisahkan bucket rate limit saat load langsung ke API (bukan lewat gateway).

---

## 3. Temuan

Severity = risiko arsitektural sebelum pengukuran; **dampak kuantitatif untuk temuan yang diuji ada di §6**, temuan lain tetap static/hipotesis.

### PERF-01 — Bootstrap menghitung summary semua versi; hasilnya tidak dipakai klien

**Severity:** High · **Confidence:** high (static) · **Impact:** **MEASURED** — bootstrap p95 5,27 s pada mixed 10 VU/10k (§6.3); query per request tidak diinstrumentasi.
**Bukti:** `server/bootstrap.ts:231-356` (semua survei/versi + loop `summaryFor`), `server/summary.ts:52-110`, `src/lib/api.ts:100` (field hanya tipe), `src/components/AppProviders.tsx:14` dan `src/lib/server/guards.ts:19-45` (dua bootstrap per page), `src/lib/store.ts` (`refreshBootstrap` 11 call site).

- Creator, 1 survei/1 versi/20 item: 9 query base + `summaryFor` 43 query + 1 profil ≈ **53 query per bootstrap**.
- Page creator = guard bootstrap + client bootstrap ≈ **106 query**, sebelum data layar apa pun.
- Setiap simpan/publish/close/archive memicu bootstrap penuh lagi.
- `super_admin` melihat **semua versi semua survei**; biaya bootstrap tumbuh dengan total jawaban instalasi, bukan dengan pekerjaan operator. Satu page admin dapat memicu puluhan `summaryFor` dan ratusan scan jawaban.
- `summaryFor` sendiri 2 query/item; di 100k×20, tiap query menyentuh hingga 2 juta jawaban (hipotesis planner: seq scan/hash join; harus dibuktikan).

**Aksi minimal (belum dilakukan):** hapus loop `summaries` dari bootstrap; guard server memakai `GET /auth/me` yang sudah ada (hanya sesi, tanpa bootstrap); summary diambil lazy saat layar hasil memilih versi. Kontrak `BootstrapData.summaries` tidak dipakai klien, jadi ini bukan perubahan perilaku UI.
**Trigger terukur untuk eksekusi:** bootstrap p95 > 500 ms pada dataset 10k, **atau** satu bootstrap super-admin > 2 s, **atau** query `summaryFor` menyumbang > 30% DB time pada sampling.

### PERF-02 — `summaryFor` N+1 dan agregasi tanpa indeks

**Severity:** High · **Confidence:** high (static) · **Impact:** **MEASURED** — summary p95 3,28 s; plan 10k satu query opsi 70 ms, jadi latency didominasi fan-out/antrean, bukan satu query.
**Bukti:** `server/summary.ts:52-110`. Per item: (a) hitung opsi dengan `answers.option_id = question_options.id` dan `answers.response_id IN (responses versi)`, (b) hitung terjawab dengan join `answers`→`responses` dan `question_id`. Tidak ada indeks `answers(option_id)` maupun `answers(question_id)`; indeks yang ada `(response_id)` dan `(response_id, question_code)`.

Total 3 + 2N query (43 untuk 20 item). Semua menyentuh seluruh jawaban versi; total kerja per summary = O(N × jawaban versi). Ini yang membuat bootstrap dan layar hasil memburuk seiring pertumbuhan respons.

**Aksi minimal:** satu query agregat per versi (`SELECT question_id, option_id, count(*) … WHERE responses.version_id=? GROUP BY 1,2`) + satu query answered, lalu susun struktur di aplikasi; indeks tambahan hanya jika plan menunjukkan kebutuhan. **Trigger:** summary p95 > 1 s di 10k, atau `shared_blks_read` > 500k per request.

### PERF-03 — Halaman jawaban individual memuat semua jawaban versi

**Severity:** High · **Confidence:** high (static) · **Impact:** **MEASURED** — `responses?limit=100` p95 3,39 s pada mixed 10 VU/10k.
**Bukti:** `server/routes/surveys.ts:795-801`. `LIMIT`/`OFFSET` hanya membatasi `responses`, sedangkan `answerRows([version.id])` mengambil **semua** jawaban versi, lalu memetakannya ke 100 respons. Payload kecil, kerja DB/memori besar dan terus tumbuh. Di 100k×20, request pertama halaman memuat ±2 juta baris.

**Aksi minimal:** filter jawaban dengan ID respons yang sudah dipaginasi (pola yang sudah dipakai endpoint integrasi), bukan seluruh versi. Tambahkan indeks urutan hanya jika `EXPLAIN` menunjukkan sort mahal. **Trigger:** page pertama p95 > 500 ms di 10k, atau rows read > 50k per request.

### PERF-04 — Export all-in-memory, tanpa streaming/abort/kompresi

**Severity:** High · **Confidence:** high (static), dampak memori hipotesis · **Impact:** NOT_VERIFIED
**Bukti:** `server/routes/surveys.ts:715-775` (semua respons + semua jawaban + `csvDocument([header, ...rows])` + `res.send`), `server/export.ts` (implementasi kedua, N+1, tidak dipakai route/test), `server/app.ts` (tidak ada middleware kompresi).

- CSV dibangun sebagai satu string; puncak memori ≈ objek respons + objek jawaban + array baris + string final. Estimasi kasar 100k×20: **1–1,5 GB** (hipotesis; harus diukur).
- Tidak ada `req.on('close')`/abort; klien putus tidak membatalkan query atau pembangunan string.
- Tidak ada backpressure; `res.send` mengirim buffer besar sekaligus.
- Shutdown hard 5 detik dapat memotong export yang sedang berjalan (lihat PERF-12).

**Aksi minimal:** streaming CSV per batch (keyset pagination atau cursor), hormati `close`, dan batasi `Content-Length`/baris. **Trigger:** export 10k > 5 s, puncak RSS > 1 GB, atau host available < 1 GB saat export. Jika export 10k < 250 ms dan < 300 MB, redesign belum dibuktikan perlu.

### PERF-05 — Perjalanan responden mengulang resolusi konteks dan opsi

**Severity:** Medium · **Confidence:** high (static) · **Impact:** **PARTIAL** — AC13 30 concurrent p95 498/381 ms, di bawah trigger 1 s; query/request belum dikonfirmasi `pg_stat_statements`.
**Bukti:** `server/routes/public.ts:226-283` (context: 6+N query, selalu memuat pertanyaan+opsi), `:426-430` (intro membuang pertanyaan/opsi yang sudah diambil), `:487-490` (form mengulang), `:533-700` (submit mengulang context, lalu `parseAnswers` mengambil opsi lagi per item, lalu 20 INSERT jawaban satu per satu).

| Langkah | Query (N=20) |
|---|---:|
| Intro | 26 |
| Consent | 28 |
| Form | 27 |
| Submit | 77 |
| **Total journey** | **158** |

Submit juga menghasilkan **dua commit** (transaksi + audit setelah commit). Ini bukan correctness issue, tetapi biaya round-trip dan WAL/fsync berlipat.

**Aksi minimal:** satu query join pertanyaan+opsi per versi (bukan per item), satu snapshot versi immutable yang di-cache dengan invalidasi publish/close, dan multi-row INSERT jawaban. **Trigger:** submit p95 > 1 s pada 30 concurrent, atau > 50 query/request pada sampling (static count sudah 77; pengukuran menentukan apakah ini bottleneck nyata).

### PERF-06 — Rate limit proses-lokal, tanpa `trust proxy`, Map tanpa batas

**Severity:** High untuk produksi multi-instance/ingress · **Confidence:** high (static) · **Impact:** **PARTIAL** — AC13 30 submit lewat gateway sukses; 41/10m, 429, dan bypass/shared-store belum diuji.
**Bukti:** `server/security.ts:196-210` (Map global, tanpa sweep, komentar “cukup untuk satu instans lokal”), `server/routes/auth.ts:71-72,137`, `server/routes/public.ts:438,513,536,705`, `README.md:443`.

- Key: `login:{ip}:{email}` 8/15 mnt, `register:{ip}` 5/15 mnt, `consent:{ip}:{token}` 30/mnt, `invite-code:{ip}` 20/10 mnt, `submit:{ip}` 40/10 mnt, `data-request:{ip}` 10/jam.
- Express tidak memakai `trust proxy`; di belakang gateway `req.ip` = IP gateway. Artinya **semua pengguna nyata berbagi satu kuota** (submit 40/10 menit untuk seluruh sistem; registrasi 5/15 menit).
- Dua instance = kuota 2× dan keputusan tidak konsisten; restart mereset kuota.
- Map tidak pernah dipangkas: setiap IP/email/token baru menambah entry permanen selama proses hidup.

**Aksi minimal:** rate limit di gateway dengan identitas klien tepercaya, atau store bersama; bila tetap di app, set `trust proxy` hanya untuk gateway dan beri TTL sweep pada Map. **Trigger:** 429 muncul untuk responden sah berbeda di belakang gateway, atau uji dua instance menunjukkan bypass/inkonsistensi.
**Konsekuensi pengujian:** AC13 (30 submit) masih muat di kuota 40/10 menit, tetapi ramp >40 submit/10 menit dari satu IP akan 429. Load langsung ke API memakai source IP loopback berbeda (sudah diverifikasi); load lewat gateway sengaja dipakai untuk mendokumentasikan perilaku ini, bukan dianggap kegagalan sistem.

### PERF-07 — Indeks hilang pada jalur terpanas

**Severity:** Medium · **Confidence:** high (static), dampak menunggu plan · **Impact:** **PARTIAL** — plan 1k/10k captured; `token_hash` seq scan pada 11 baris, `answers` seq scan 221k; tidak ada index change.
**Bukti:** `evidence/perf/static-index-inventory.txt` dan pemetaan query.

| Jalur | Predikat/urutan | Indeks sekarang | Gap |
|---|---|---|---|
| Semua request publik | `public_links.token_hash = ?` | unique `token` | **tidak ada indeks token_hash** |
| Semua request invitation | `invitations.token_hash = ?` | unique `token` | **tidak ada indeks token_hash** |
| Pagination/export | `version_id/survey_id … ORDER BY submitted_at` | single-column | `(version_id, submitted_at, id)` |
| Summary | `answers.option_id`, `answers.question_id` + versi | `(response_id)`, `(response_id, code)` | `answers(question_id/option_id)` |
| Org audit | `organization_id=? ORDER BY at DESC` | `ix_audit_at` | `(organization_id, at DESC)` |
| Daftar survei | `owner_id`/`organization_id ORDER BY updated_at` | PK saja | `(owner_id, updated_at)`, `(organization_id, updated_at)` |
| Admin stats | join `surveys.owner_id` | PK saja | `(owner_id)` |

**Aksi minimal:** jalankan `EXPLAIN (ANALYZE, BUFFERS)` pada dataset 1k/10k/100k lebih dulu; tambah indeks hanya yang plan-nya menunjukkan seq scan/sort mahal. Kandidat paling aman secara logika adalah indeks `token_hash`, tetapi tetap harus dibuktikan dengan plan (tabel kecil bisa membuat seq scan lebih murah).
**Trigger:** seq scan > 1.000 baris per request publik, atau sort > 10k baris pada pagination/export.

### PERF-08 — Pool tanpa statement timeout; saturasi berubah menjadi 500 dan health gagal

**Severity:** Medium · **Confidence:** medium-high (static pg semantics) · **Impact:** **NOT SATURATED** — max 28 koneksi (dua pool + sampler), 0 lock waiter, 0×5xx; >40 concurrent submit belum diuji.
**Bukti:** `server/db.ts:23-29` (`max=10`, `connectionTimeoutMillis=5000`, tanpa `statement_timeout`/`query_timeout`), `server/app.ts:45-54` (health `SELECT 1` memakai pool yang sama), `server/http.ts:32-44` (error tak dikenal → 500).

- Tidak ada batas waktu eksekusi per query. Summary/export bisa menahan koneksi selama beberapa detik–puluhan detik; 10 koneksi habis → request lain menunggu acquire sampai 5 detik lalu 500 generik.
- Health memakai pool yang sama; saat saturasi health ikut gagal → container terlihat unhealthy, padahal tujuan health adalah liveness.
- Tidak ada endpoint/metric pool wait; saturasi hanya terlihat dari 500 dan `pg_stat_activity`.
- Dua replika = 20 koneksi; belum ada anggaran koneksi global (pool × replika + migration/seed).

**Aksi minimal:** set `statement_timeout` untuk endpoint baca berat, batasi konkurensi endpoint berat, dan pisahkan health dari pool kerja atau beri timeout singkat. **Trigger:** pool wait > 0 atau 5xx > 1% saat ramp; health gagal saat load.

### PERF-09 — `scryptSync` memblokir event loop

**Severity:** Medium · **Confidence:** high (static) · **Impact:** NOT_VERIFIED
**Bukti:** `server/security.ts:30-40`; dipakai login (`auth.ts:76`), registrasi (`auth.ts:171`), ubah password, dan pembuatan organisasi admin.

Setiap hash berjalan sinkron di thread request. Login burst akan menyerialkan CPU dan menaikkan latency semua request lain, termasuk public submit. Tidak menyentuh jalur AC13 (responden tidak login), tetapi relevan untuk ramp/spike login dan operasi admin.

**Aksi minimal:** gunakan `scrypt` async atau worker thread. **Trigger:** 10 login concurrent → p99 > 1 s, atau event-loop p99 > 100 ms selama burst login.

### PERF-10 — Payload bootstrap tidak dibatasi dan API tidak mengompresi

**Severity:** Medium · **Confidence:** high (static) · **Impact:** **MEASURED (latency)** — bootstrap p95 5,27 s; ukuran payload/`JSON.stringify` block belum diukur terpisah.
**Bukti:** `server/bootstrap.ts:231-460` (semua survei, versi, pertanyaan, opsi, undangan, public link, assignment, grant, settings; untuk super-admin + akun/org/audit 250/event 250/data request 250), `server/app.ts` (tanpa `compression`), `next.config.ts:12-18` (rewrite).

Tidak ada pagination pada koleksi bootstrap. Jumlah query dan ukuran payload tumbuh dengan jumlah survei × versi × pertanyaan, ditambah 250 baris untuk tiga daftar admin. Tanpa kompresi, payload ini dikirim apa adanya dari Express; `JSON.stringify` juga berjalan di event loop. Di instalasi dengan banyak survei, ini bisa menjadi MB dan puluhan ms block.

**Aksi minimal:** ukur ukuran payload dan waktu serialisasi per profil; kompresi di gateway (bukan perubahan app) jika transfer terbukti menjadi bagian latency; pagination hanya jika pengukuran menunjukkan kebutuhan. **Trigger:** bootstrap response > 200 KB atau `JSON.stringify` > 50 ms event-loop block.

### PERF-11 — Next.js seluruhnya dinamis; guard server menambah satu bootstrap penuh

**Severity:** Medium · **Confidence:** high (static; TTFB belum diukur) · **Impact:** NOT_VERIFIED
**Bukti:** `src/app/layout.tsx:8-9` (`force-dynamic`), `.next/prerender-manifest.json` (hanya `/_global-error`), `src/lib/server/guards.ts:19-45`, `src/components/AppProviders.tsx:14`.

Tidak ada static shell: setiap page butuh SSR + proxy nonce. Guard server melakukan fetch `/bootstrap` penuh hanya untuk mengecek akun, lalu klien mengulang bootstrap. TTFB halaman creator karenanya ≥ latensi bootstrap (dan dapat jauh lebih besar saat summary berat).

First-load JS dari build yang ada (raw / gzip-9 / brotli): creator results 608.274 / 179.741 / 155.826 B; admin 581.585 / 171.509 / 148.442 B; public form 580.929 / 172.226 / 149.120 B; login 548.650 / 163.671 / 141.353 B; CSS 35.150 B; 13 file font 304.756 B (subset unicode-range; runtime biasanya mengunduh sebagian).

**Aksi minimal:** guard memakai `/auth/me` (menghilangkan satu bootstrap penuh); jangan mengubah arsitektur data klien sebelum TTFB/LCP diukur. **Trigger:** TTFB creator − TTFB halaman anonim > 300 ms, atau guard bootstrap > 100 ms.

### PERF-12 — Shutdown 5 detik tanpa drain; retensi tidak ada

**Severity:** Low–Medium · **Confidence:** high (static) · **Impact:** NOT_VERIFIED
**Bukti:** `server/index.ts:27-35` (`server.close`, hard exit 5.000 ms), `Dockerfile.api`/`docker-compose.yml` (tanpa stop grace/resource limit), `server/security.ts` (session expiry lazy), tidak ada job retensi untuk `audit_logs`, `integration_events`, `data_requests`, `sessions`.

- In-flight export > 5 detik akan dipotong saat SIGTERM; tidak ada readiness drain, jadi load balancer masih mengirim request sampai proses mati.
- Health = liveness, bukan readiness; tidak ada endpoint drain.
- Sesi kedaluwarsa hanya dihapus saat token itu dipakai; tabel tumbuh satu baris per login.
- Audit/event/data request tumbuh tanpa batas; daftar admin memakai LIMIT 250 dengan sort, tetapi org audit tidak punya indeks komposit.

**Aksi minimal:** readiness + drain window > durasi export maksimum, atau batasi export; putuskan retensi sebagai keputusan produk; sweep sesi kedaluwarsa. **Trigger:** shutdown dengan export in-flight > 5 s, atau tabel audit > 1 juta baris.

### PERF-13 — CI tidak punya anggaran performa; ada kode export mati

**Severity:** Low · **Confidence:** high (static)
**Bukti:** `.github/workflows/ci.yml` (typecheck, 6 test, 2 Docker build, smoke browser; tanpa load/query count/bundle budget), `server/export.ts` (tidak dipakai route/test).

**Aksi minimal:** setelah baseline stabil, tambahkan budget query-count/bundle hanya jika ada regresi nyata; hapus `server/export.ts` agar tidak menjadi contoh implementasi kedua. Bukan blocker.

---

## 4. Analisis per lapisan

### 4.1 Query dan indeks

- 24 tabel aplikasi + `schema_migrations`. Indeks yang ada didominasi PK/unique; hanya 12 indeks sekunder.
- Lookup token publik memakai hash tetapi indeks unique berada di kolom `token` mentah — mismatch yang membuat setiap resolusi publik menjadi seq scan.
- Semua query memakai placeholder `?` yang diterjemahkan ke `$n`; tidak ada ORM/query builder, jadi query count dapat dihitung dari source (lihat `static-query-inventory.md`).
- Tidak ada `EXPLAIN`/plan cache yang disimpan repo. Plan harus diambil pada dataset nyata setelah gate.

### 4.2 Pool dan transaksi

- Satu `pg.Pool` per proses, `max=10`, `application_name='svara'`.
- `withTx` memakai `AsyncLocalStorage`, `BEGIN/COMMIT/ROLLBACK`, tanpa savepoint; transaksi bersarang memakai transaksi yang sama.
- Submit memakai advisory xact lock per `scope:idempotency-key`; duplikat konkuren menunggu transaksi pertama selesai. Lock dilepas saat commit/rollback.
- Tidak ada retry untuk `40001`/`40P01`; dipetakan ke 503.
- Tidak ada `statement_timeout`, `idle_in_transaction_session_timeout`, atau query timeout di app. `connectionTimeoutMillis` hanya membatasi acquire.
- Tidak ada connection budget global; dua API + seed/migration masih di bawah `max_connections=100`, tetapi formula ini harus dijaga saat replika bertambah.

### 4.3 Agregasi dan export

- Summary: O(V × N) query dan O(N × jawaban versi) kerja; tidak ada cache.
- Individual: O(jawaban versi) per page, bukan O(page size).
- Export: O(respons + jawaban) memori + satu string; tidak ada streaming.
- Admin stats: join fan-out `surveys × survey_versions × responses` lalu `COUNT(DISTINCT)`; tumbuh dengan jumlah respons dan versi.
- Integrasi: `COUNT(*)` + `ORDER BY submitted_at, id OFFSET ?`; OFFSET dalam memperburuk seiring halaman.
- `server/export.ts` menduplikasi logika dengan N+1 `Promise.all` (satu query per respons) dan tidak dipakai HTTP/test — dead code.

### 4.4 Node event loop dan buffering

- `scryptSync` sinkron; CSV dan `JSON.stringify` besar sinkron; tidak ada worker/stream.
- Tidak ada kompresi respons API; `express.json` 512 KB per request.
- `response` besar dibangun sebelum dikirim; tidak ada `res.flush`, cursor, atau generator.
- Logika bisnis tidak menyimpan state di memori (kecuali rate-limit Map), sehingga scale-out baca secara arsitektur mungkin.

### 4.5 Next.js

- Root layout `force-dynamic` + proxy nonce → semua route SSR; hanya `_global-error` prerender.
- Halaman adalah client component yang memanggil API dari browser; guard server melakukan satu fetch bootstrap tambahan.
- Build `.next` yang ada memiliki rewrite `/api` ke `127.0.0.1:4321` (lingkungan UI), bukan gateway perf. Gateway audit **wajib** menangani `/api/*`; jika tidak, request akan salah diarahkan.
- Bundle first-load 548–608 KB raw (141–180 KB gzip); font 305 KB total subset. Belum ada pengukuran transfer/LCP runtime.

### 4.6 State proses, rate limit, sesi

- Sesi DB-backed (PK `token_hash`) → login konsisten lintas replika; satu join per request terautentikasi.
- Rate limit satu-satunya state bisnis di memori; tidak ada TTL/sweep, tidak ada store bersama.
- Tidak ada state draf/response di memori; idempotensi dan lock memakai DB, jadi dua replika aman secara correctness.
- Migrasi memakai advisory lock; dua replika yang start bersamaan akan menyerialkan migrasi (baik), tetapi replika kedua siap lebih lambat.

### 4.7 Shutdown, container, ingress, CI

- API: SIGTERM/SIGINT → `server.close`, tutup pool, hard exit 5 s. Tidak ada readiness/drain.
- API image menjalankan `tsx server/index.ts`; bukan hasil kompilasi. Runtime overhead transparan, tetapi berarti build API = build image, bukan build TS.
- Compose tanpa `mem_limit`/`cpus`/`stop_grace_period`; DB container tanpa limit, tetapi Docker VM hanya 3,8 GB.
- Health API = `SELECT 1`; health web = SSR `/auth/login`. Keduanya bukan readiness fungsional.
- CI tidak mengukur performa; tidak ada gate untuk query count, bundle, atau latency.

---

## 5. Workload, eksekusi, dan gate

### 5.1 Gate dan batas eksekusi

**Gate dibuka** oleh koordinator melalui dispatch `task_d891e6600c3f` (2026-11-20). Izin: AC13 30×20 pada 1k/10k, EXPLAIN, mixed/ramp maksimum 30 dan 100 VU (300 dihilangkan), satu spike 200 bila RAM stabil, soak 20 VU maksimum 30 menit, dan total window ≤ 2,5 jam. **Tidak disetujui/diblokir:** seed 100k, export CSV/responses, 300 VU, dan uji SIGTERM container (tidak ada image Linux terisolasi).

Kondisi aktual saat eksekusi:

1. **Host:** Windows 11 10.0.26200, Node v24.15.0, 14.188 MB RAM, disk C: 77 GB bebas. Free RAM 3.963 MB sebelum service, 2.026 MB setelah API+Next+gateway, dan minimum **306 MB** saat percobaan mixed 30 VU. Setelah service perf dihentikan, free RAM sempat 1.729 MB, lalu pengamatan akhir **492 MB** dengan proses audit lain masih hidup; angka akhir ini bukan kondisi idle host yang bersih.
2. **DB:** `current_database()='svara_audit_perf'`, `127.0.0.1:5432`, owner `svara`, PostgreSQL 17.12, `max_connections=100`, `shared_buffers=128MB`, ukuran 69 MB sebelum load dan 71 MB sesudah. Tidak ada operasi ke `svara`, `svara_test`, atau `svara_audit_sec`.
3. **Data:** seed aditif 1k/10k sudah selesai; 6 respons demo dipertahankan. Tidak ada truncate/drop. 100k **tidak di-seed**.
4. **Build:** `.next/BUILD_ID=3RzZi-drCTjszTT7A99TF`, commit `95eafa3`; dikonfirmasi koordinator, tidak ada build ulang.
5. **Topologi:** API 4341/4342, Next 4343, gateway 4340; `/api/*` round-robin ke API, path lain ke Next. `APP_ORIGIN=http://127.0.0.1:4340`; `API_INTERNAL_URL=http://127.0.0.1:4341` (guard server).
6. **Tidak ada edit source/test/migration/config/script.** Harness tetap di `%TEMP%\svara-audit-perf\`; hanya evidence/report yang ditulis di repo.
7. **Deviasi host:** port 4320, 4322, 4331, dan **3001** masih listening dari proses audit lain (`svara-audit-gateway.mjs`, Next standalone, API security ke `svara_audit_sec`, dan satu API `--import tsx server/index.ts`) meskipun koordinator menyatakan sudah berhenti. Tidak ada koneksi established saat netstat, tetapi 3001 memiliki banyak koneksi TIME_WAIT (baru menerima traffic); beban/DB proses itu tidak diketahui. Tidak ada request harness ke 3001/4320/4321/4322/4331. Hasil di bawah adalah host **tidak sepenuhnya eksklusif**; kontensi tidak dapat dikesampingkan.

AC13 1k/10k, EXPLAIN, dan mixed dijalankan 14:44–15:00 UTC. Tidak ada 5xx dari gateway; kegagalan 403 pada satu percobaan mixed dijelaskan di §6.3.

### 5.2 Topologi

```
browser/CDP ──► 127.0.0.1:4340 gateway
                  ├─ /api/*  ──round-robin──► 127.0.0.1:4341 API-A ─┐
                  │                          ► 127.0.0.1:4342 API-B ─┤
                  └─ others ───────────────► 127.0.0.1:4343 Next    │
                                                                     ▼
                                                    127.0.0.1:5432 svara_audit_perf
```

- Direct-to-API load memakai source IP loopback berbeda untuk memisahkan bucket rate limit; ini **bukan** representasi ingress dan harus dilabeli demikian.
- Gateway load memakai satu IP (perilaku ingress saat ini) untuk mengukur dampak PERF-06.

Start aktual (tanpa secret; kedua replika memakai DB yang sama):

```sh
# API A/B (satu proses per port; pool 10 masing-masing)
PORT=4341 HOST=127.0.0.1 NODE_ENV=production DATABASE_URL="$PERF_DATABASE_URL" \
PG_POOL_MAX=10 APP_ORIGIN=http://127.0.0.1:4340 SEED_DEMO=0 \
node --import tsx server/index.ts
# ulangi dengan PORT=4342

# Next production preview; guard server menunjuk API perf, bukan gateway/UI 4320-4321
API_INTERNAL_URL=http://127.0.0.1:4341 node_modules/.bin/next start -H 127.0.0.1 -p 4343

# Gateway audit (script sementara, bukan file repo)
node "$TEMP/svara-audit-perf/gateway.cjs" --listen=127.0.0.1:4340 \
  --api=127.0.0.1:4341,127.0.0.1:4342 --web=127.0.0.1:4343
```

- AC13 dan mixed memakai gateway; tidak ada direct-to-API load yang diklaim sebagai ingress. Gateway menambahkan satu hop loopback dan mencatat upstream per request.
- Next 16 mencetak peringatan bahwa `next start` tidak cocok dengan `output: standalone`; halaman tetap 200. Perilaku image standalone Docker **NOT_VERIFIED**.
- `API_INTERNAL_URL` adalah env guard server; rewrite `/api` yang dibekukan saat build tetap ke 4321, jadi gateway wajib menangani `/api/*` (dan memang melakukannya; 4321 tidak menerima request).

### 5.3 Dataset sintetis

Aditif, deterministik, `ON CONFLICT DO NOTHING` (bukan truncate). Angka di bawah adalah **respons/jawaban**, bukan baris join:

| Profil | Versi | Respons | Jawaban | Status |
|---|---|---:|---:|---|
| 1k | `v_perf_1k` published | 1.000 | 20.000 | dijalankan; setelah load 1.030 / 20.600 |
| 10k | `v_perf_10k` published | 10.000 | 200.000 | dijalankan; setelah load 10.037 / 200.740 |
| 100k | `v_perf_100k` + `v_perf_100k_old` | — | — | **BLOCKED / tidak di-seed** |
| tenant B | `v_perf_b_10k` | — | — | tidak di-seed |

- Sebelum load: 11.006 respons total (11.000 perf + 6 demo) dan 220.018 jawaban. Sesudah load: 11.073 respons dan 221.358 jawaban; 0 respons perf dengan jumlah jawaban ≠ 20.
- 100k tidak dijalankan karena free RAM < 3,5 GB; export juga tidak dijalankan. Tidak ada truncate/drop; 6 respons demo dipertahankan.
- Seed mengisi `respondents`, `responses`, `answers`, dan sejumlah consent granted untuk kapasitas; consent/attempt/event/audit per submit dibuat oleh API saat load.
- **Defect harness (dicatat, tidak diulang sebagai count):** ringkasan seed mencetak `responses=200000` untuk profil 10k karena memakai `count(*)` atas `responses LEFT JOIN answers` (10.000 × 20 baris join). Count sebenarnya diverifikasi independen: `count(DISTINCT r.id)=10.000`, `count(a.id)=200.000`. Data tidak rusak; hanya label metrik yang salah.
- Token public link mentah tidak masuk report/evidence; hanya hash 8 karakter. Peta kolom seed divalidasi read-only terhadap `information_schema` (18 tabel, 0 masalah).
- `ANALYZE` dijalankan oleh seed; plan 10k menunjukkan estimasi 10.030 respons, konsisten dengan count aktual.

Batasan dataset: data sintetis tidak mewakili distribusi jawaban nyata, teks panjang, atau consent history penuh; hasil hanya lab lokal.

### 5.4 Skenario dan status eksekusi

| ID | Skenario | Status | Bukti / catatan |
|---|---|---|---|
| W0 | Smoke | **PARTIAL** | Public context 1k `active/canSubmit=true`; mixed read smoke 7/7 200. Tidak ada uji invalid 4xx formal. |
| W1 | **AC13 resmi** | **PASS 1k, PASS 10k** | 30×201, 30 ID unik, 600 jawaban, attempts/consents/events/audits = 30, 0 duplikat; p95 http 498/381 ms. |
| W2 | Mixed read+write | **PARTIAL** | 10 VU/120 s bersih: 474/474 200; 2 submit 201 dan rekonsiliasi 2/2. 30 VU/300 s **INVALID** karena 2.587 403 dari sesi tanpa grant; bukan PASS. |
| W3 | Ramp 30→100 | **BLOCKED** | 30 VU dicoba (bukan ramp); free RAM min 306 MB. 100 VU tidak dijalankan karena risiko OOM. |
| W4 | Spike 200 | **BLOCKED** | RAM tidak stabil pada 30 VU (min 306 MB); spike tidak dijalankan. |
| W5 | Soak 20 VU/30m | **BLOCKED** | Tidak dijalankan; free RAM < 1 GB pada 30 VU dan RSS API mencapai 740 MB. Tidak ada klaim kebocoran. |
| W6 | Export/aggregate | **BLOCKED** | Export tidak disetujui dan tidak dijalankan; 100k tidak di-seed. |
| W7 | Dua replika | **PARTIAL** | AC13 lewat gateway round-robin; 201 terbagi 70/69 antara 4341/4342, rekonsiliasi pass. Uji key sama lintas instance tidak dijalankan. |
| W8 | Gateway/rate limit | **PARTIAL** | AC13 30 submit lewat gateway sukses; tidak ada 429. Batas 41 submit/10 menit tidak diuji. |
| W9 | Frontend lab | **NOT_VERIFIED** | Hanya `GET /` lewat gateway 200/14 ms; tidak ada lab browser, LCP/CLS, atau bundle runtime. |
| W10 | Shutdown | **NOT_VERIFIED** | Tidak ada runtime Linux terisolasi; SIGTERM container tidak diuji. |
| W11 | Query plans | **PASS** | `EXPLAIN (ANALYZE, BUFFERS)` 10 query pada 1k dan 10k; read-only. |

Aturan AC13 yang dipakai:
- Consents dibuat lewat API tepat 30 per profil; limit 30/menit/token tidak menghasilkan 429.
- Setiap submit memakai `Idempotency-Key` unik 8–128 karakter; 30 respons unik per profil.
- `http_total_ms` = waktu klien dari sebelum fetch sampai body selesai; ini **upper bound konservatif** untuk receive→commit, bukan commit.
- `server_audit_span_ms` = `audit_logs.at` − `responses.submitted_at` untuk pasangan `response_id`; ini server-clock, mencakup sisa transaksi + commit + insert audit, tetapi **bukan** commit murni dan tidak mencakup context/parse sebelum transaksi.
- Jangan menyebut `http_total` sebagai “commit p95”.

Persentil: nearest-rank; n=30 → p95 = order statistik ke-29, p99 = maksimum. Untuk mixed, n jauh lebih besar; metode tetap nearest-rank dan dilaporkan bersama n.

### 5.5 Metrik dan sampling

| Sumber | Metode | Interval |
|---|---|---|
| Klien | `performance.now()` per request, status, bytes, error class | per request |
| Gateway | duration + upstream + status, log JSONL (token di-redact) | per request |
| API | preload `--require` (tanpa edit source): `monitorEventLoopDelay`, `memoryUsage`, `cpuUsage`, GC observer | 5 s |
| PostgreSQL | `pg_stat_activity` (conns/active/idle/lock waiters) + `pg_stat_database` (xact/blks hit/read) + ukuran DB | 200 ms selama run |
| Host | `os.freemem()` dari sampler Node; `Get-Process`/working set sebelum-sesudah; disk `df` | 200 ms; before-after |
| Server DB timing | `submitted_at` vs `audit.at` per response | per sukses |

`pg_stat_statements` hanya dipakai bila sudah terpasang; tidak akan dipasang tanpa persetujuan gate.

Catatan sampler: pada Windows, timer resolution default ±15,6 ms membuat `monitorEventLoopDelay` idle p50 ≈ 15,5 ms (terukur pada self-test mock). Jangan menafsirkan p50 sebagai delay aplikasi; laporkan p99/max dan delta terhadap baseline idle, atau nyatakan keterbatasan ini bila API berjalan di Windows.

### 5.6 Rekonsiliasi data

Setelah setiap skenario submit, hitung **per versi target** (bukan global):

```sql
SELECT count(*) FROM responses WHERE version_id = :v;
SELECT count(*) FROM answers a JOIN responses r ON r.id=a.response_id WHERE r.version_id = :v;
SELECT count(*) FROM submission_attempts WHERE scope = :scope;
SELECT count(*) FROM integration_events WHERE response_id IN (...);
SELECT count(*) FROM audit_logs WHERE object_id LIKE :survey_prefix;
SELECT count(*) FROM consent_records WHERE version_id = :v AND status='granted';
```

Wajib: jumlah respons = sukses 201; jumlah jawaban = 20 × respons; tidak ada `answers.skipped=1` untuk AC13; tidak ada response/attempt ganda; consent terhubung tepat satu; tidak ada event/audit hilang. Kegagalan rekonsiliasi = **FAIL/ABORT**, bukan PASS.

### 5.7 Abort dan keselamatan

Hentikan skenario dan tandai **NOT_VERIFIED/FAILED** bila salah satu terjadi:

- integritas data gagal sekali pun;
- 5xx tak terduga > 1% selama 2 menit berturut-turut;
- host available RAM < 1 GB, Docker VM > 3,5 GB, OOM/restart container;
- disk bebas < 5 GB;
- koneksi PG > 80 atau pool wait terus-menerus;
- API p95 > 10 s selama 2 menit, atau event-loop p99 > 1 s sustained;
- load generator error/timeout > 5% selama 1 menit (kecuali skenario 429 yang diharapkan);
- ada proses probe lain di port/DB target;
- tanda korupsi/duplikasi/partial response.

Load yang di-abort **tidak boleh** dilaporkan sebagai lulus. Hentikan juga bila window koordinator habis.

**Pelanggaran ambang aktual:** pada mixed 30 VU, free RAM mencapai **306 MB** (<1 GB). Ekspansi ke 100 VU, spike 200, dan soak 20 VU/30m dihentikan. Run 30 VU sudah selesai sebelum keputusan itu; submit-nya direkonsiliasi, tetapi latency read-nya **INVALID** karena 2.587×403. Tidak ada 5xx/OOM/integrity failure, tetapi run tersebut tidak dilaporkan sebagai PASS kapasitas.

### 5.8 Evidence yang ditulis

Semua di `docs/audit/2026-11-20/evidence/perf/`:

- `dynamic-preflight.json` — commit, BUILD_ID, Node/PG, host, pool, topologi, count dataset, defect seed.
- `ac13-1k.json`, `ac13-10k.json` — 30 sampel per request + ringkasan + rekonsiliasi.
- `mixed-10.json`, `mixed-30.json` — sampel read/write; `mixed-30` diberi status INVALID.
- `explain-1k.txt`, `explain-10k.txt` — EXPLAIN (ANALYZE, BUFFERS).
- `samples/api-a.jsonl`, `samples/api-b.jsonl` — event-loop/memori/CPU per 5 s.
- `samples/*-resources.jsonl` — free RAM, koneksi/active/lock, xact/blks, ukuran DB per 200 ms.
- `samples/gateway.jsonl` — status/upstream/durasi per request (token di-redact).
- `logs/api-a.log`, `logs/api-b.log`, `logs/next.log`, `logs/gateway.log`.
- `seed-run.log`, `preseed-counts.txt`, `postseed-counts.txt` — bukti seed aditif dan defect label `responses=200000` (bukan 200k respons).
- `perf-manifest.json` — daftar artefak + sha256 + status per skenario.

Redaksi: cookie, password, token publik mentah, dan header otorisasi tidak pernah ditulis; token di URL diganti `sha256:8`. Response ID sintetis boleh.

---

## 6. Hasil pengukuran dan pemisahan klaim kapasitas

Semua angka adalah hasil lokal 2026-11-20 pada topologi §5.2, dataset §5.3, dan build §5.1. Artefak mentah: `evidence/perf/ac13-1k.json`, `ac13-10k.json`, `mixed-10.json`, `mixed-30.json`, `explain-1k.txt`, `explain-10k.txt`, `dynamic-preflight.json`, `samples/`, dan `logs/`.

### 6.1 AC13 30 × 20

| Profil | n | Status | p50 | p95 | p99 / max | Wall | Throughput | Rekonsiliasi |
|---|---:|---|---:|---:|---:|---:|---:|---|
| 1k | 30 | 30×201 | 389,37 ms | **498,14 ms** | 500,59 ms | 506 ms | 59,29 rps | **PASS**: 30 respons, 600 jawaban, 30 attempt/consent/event/audit |
| 10k | 30 | 30×201 | 323,48 ms | **381,12 ms** | 387,94 ms | 390 ms | 76,92 rps | **PASS**: 30 respons, 600 jawaban, 30 attempt/consent/event/audit |

Keduanya di bawah target p95 `http_total` ≤ 3.000 ms. Ini **bukan** klaim commit 3 detik: yang diukur adalah waktu klien sampai body diterima. n=30 kecil; p99 = maksimum. Tidak ada 429, 5xx, timeout, atau response ID duplikat.

### 6.2 Client HTTP vs server-side span

| Profil | Client p95 | Server span p50 | Server span p95 | Server span max |
|---|---:|---:|---:|---:|
| 1k | 498,14 ms | 106 ms | 117 ms | 117 ms |
| 10k | 381,12 ms | 91 ms | 107 ms | 118 ms |

`server_span` = `audit_logs.at − responses.submitted_at` untuk 30 respons yang sama. `submitted_at` di-set sebelum insert jawaban; span mencakup sisa transaksi + commit + insert audit, tetapi **bukan** durasi commit murni dan tidak mencakup context/parse sebelum transaksi. Client p95 lebih tinggi dari span karena antrean koneksi, gateway, respons, dan event loop. Jangan menyebut angka client sebagai commit.

### 6.3 Mixed read+write dan memori

**10 VU / 120 s (valid; semua 200):**

| Endpoint | n | p50 | p95 | max |
|---|---:|---:|---:|---:|
| Semua read | 474 | 2.385,89 ms | **4.762,94 ms** | 6.608,81 ms |
| `bootstrap` | 195 | 3.480,78 ms | **5.273,60 ms** | 6.608,81 ms |
| `summary` | 143 | 2.054,17 ms | **3.276,81 ms** | 3.764,79 ms |
| `responses?limit=100` | 87 | 2.136,22 ms | **3.394,70 ms** | 4.900,66 ms |
| `surveys` list | 49 | 559,43 ms | 1.423,72 ms | 1.589,84 ms |

- Semua 474 request read 200; tidak ada 4xx/5xx.
- 2 submit 201, 40 jawaban, 2 attempt/consent/event/audit, rekonsiliasi **PASS**. Submit p50 8.532 ms (hanya 2 sampel; jangan disebut p95 yang stabil) menunjukkan write ikut tertahan saat read load.
- Free RAM min 1.450 MB; DB conn max 28 (pool 10+10+sampler), active max 28, lock waiter 0; disk tetap 77 GB.
- API event-loop p99 max **464 ms**, max **1.089 ms**, CPU max 60,1% satu core, RSS max 462 MB; baseline idle p99 ±20–25 ms.

**30 VU / 300 s (INVALID untuk latency read):**

- 6.201 request: 3.614×200 dan **2.587×403**. 403 berasal dari sesi `perf.1k/100k/officer` yang tidak punya grant pada `s_perf_10k`; hanya `perf.10k` yang berhak. Karena campuran status tidak homogen, p95 4.688 ms **tidak dipakai** sebagai latency read yang valid.
- 5 submit 201, 100 jawaban, 5 attempt/consent/event/audit, rekonsiliasi **PASS**.
- Free RAM min **306 MB**, max 1.724 MB; API RSS max 740 MB; event-loop p99 max 451 ms, max **1.432 ms**; CPU max 79,2% satu core; 5xx 0.
- Percobaan ini dihentikan sebagai bukti kelayakan beban tinggi: 100 VU, spike 200, dan soak 20 VU/30m tidak dijalankan karena headroom memori tidak aman. Kegagalan 403 adalah kesalahan desain beban (sesi tanpa grant), bukan kegagalan integritas data. Karena 2.587 read adalah 403 ringan, free RAM 306 MB adalah **batas bawah** tekanan; 30 VU read penuh berpotensi lebih berat.

Gateway mencatat 4.119×200, 139×201, 2.587×403, **0×5xx**. 139×201 = 72 consent + 67 submit; ini konsisten dengan AC13 (60 submit), mixed 30 (5 submit + 10 consent), dan mixed 10 (2 submit + 2 consent). 201 terbagi **70 ke 4341 / 69 ke 4342**, jadi AC13 benar-benar melewati dua replika. Tidak ada request `/api` yang diarahkan ke Next 4321.

### 6.4 Query plans

`EXPLAIN (ANALYZE, BUFFERS)` 10 query, read-only, 30 s statement timeout. Ringkasan 10k:

| Query | Waktu | Plan utama |
|---|---:|---|
| `public_links` by `token_hash` | 3 ms | Seq Scan 11 baris (tabel kecil; planner memilih seq, bukan index) |
| `invitations` by `token_hash` | 2 ms | Seq Scan 0 baris |
| `responses` page 100, urut `submitted_at` | 14 ms | Seq Scan 10.030 baris + Sort + Limit |
| semua `answers` untuk versi | 64 ms | Hash Join; Seq Scan 221.218 baris |
| summary opsi satu pertanyaan | 70 ms | Seq Scan 221.215 jawaban + hash join 10.030 respons |
| summary answered satu pertanyaan | 30 ms | Parallel Seq Scan jawaban |
| org audit | 2 ms | Seq Scan (0 baris pada org uji) |
| admin stats per survey | 34 ms | Index Scan `ix_responses_survey` + join |
| surveys by owner | 2 ms | Seq Scan 1 baris |
| count respons per versi | 3 ms | Index Only Scan `ix_responses_version` |

Pada 10k, bottleneck query bukan satu query lambat (semua ≤70 ms); masalah utama ada di **fan-out + payload + event loop**. Seq Scan pada `answers` masuk akal untuk membaca 200k baris; index tambahan belum terbukti perlu pada dataset ini. Rencana 1k lebih cepat (answers 45 ms, summary 38 ms). Index tidak diubah.

### 6.5 Integritas dan resource

- Global sebelum load: 11.006 respons / 220.018 jawaban. Sesudah: **11.073 respons / 221.358 jawaban**; 1k 1.030/20.600, 10k 10.037/200.740. Selisih tepat 67 respons dan 1.340 jawaban dari AC13 (60/1.200) + mixed (7/140).
- 0 respons perf dengan jumlah jawaban ≠ 20; tidak ada response ID duplikat; setiap run punya attempt/consent/event/audit = jumlah sukses.
- Global attempt 73 = 67 run + 6 demo; event 69 = 67 run + 2 demo; audit 67. Consent granted 172, linked 67; 105 unlinked adalah consent seed/kapasitas dan sisa mixed yang tidak dipakai — bukan kegagalan submit.
- DB 69 → 71 MB; disk tetap 77 GB; PostgreSQL 17.12, pool 10/proses, max_connections 100. Tidak ada lock waiter atau ungranted lock pada sampel.
- Event loop AC13: p99 ≤24,95 ms, max 41,58 ms; jauh di bawah mixed. Peak mixed: p99 464 ms, max 1.432 ms. RSS API max 740 MB (sampel dalam proses; working set Windows saat henti 57–77 MB — angka RSS konservatif).
- Tidak ada 5xx, OOM, restart container, atau kegagalan rekonsiliasi. Free RAM min 306 MB adalah alasan **BLOCKED**, bukan PASS, untuk beban tinggi.

### 6.6 Bottleneck dan rekomendasi minimal

**Bottleneck terukur:** jalur baca terautentikasi, terutama `bootstrap` (payload/fan-out besar), lalu `summary`/`responses`. Pada 10 VU bersih, p95 read 4,76 s dan bootstrap 5,27 s; event-loop p99 464 ms; CPU 60% satu core. AC13 write path tetap cepat (p95 381–498 ms) karena hanya 30 submit dan tidak membawa payload baca besar. Ini konsisten dengan temuan statis: bootstrap menggabungkan profiles/notices/surveys/versions/questions/options/grants/accounts/audit/summaries; summary memakai query per pertanyaan; tidak ada kompresi/streaming.

**Rekomendasi (tanpa perubahan source di audit ini):**
1. Sebelum menaikkan ke >10 pembaca terautentikasi bersamaan pada 10k, kurangi payload/fan-out bootstrap (pagination/ETag/pisahkan summary) dan ukur ulang. Trigger terukur: mixed 10 VU p95 read >3 s (sudah teramati 4,76 s).
2. Jangan menjalankan 100 VU, spike 200, atau soak 20 VU/30m sampai free RAM ≥1 GB pada 30 VU dan event-loop p99 <100 ms. Trigger saat ini gagal: free RAM min 306 MB, p99 451 ms.
3. Tambahkan index `answers(question_id)`/`answers(option_id)` hanya jika plan 100k (setelah disetujui) menunjukkan Seq Scan yang dominan; pada 10k belum ada bukti kebutuhan.
4. Rate limit proses-lokal belum menjadi bottleneck pada run ini (tidak ada 429), tetapi belum aman untuk banyak replika/ingress; uji 41 submit/10 menit dan shared store sebelum klaim scale-out. Ini risiko statis, bukan hasil terukur.

### 6.7 Pemisahan klaim

| Klaim | Status sekarang | Aturan |
|---|---|---|
| **Official AC13** (30 kiriman serentak × 20 item, p95 server ≤ 3 s) | **PASS pada 1k dan 10k (lokal)** | 30×201 + 600 jawaban + rekonsiliasi tepat + p95 `http_total` 498/381 ms pada dataset/topologi dicatat. `http_total` adalah upper bound, bukan commit murni; `server_span` 117/107 ms dilaporkan terpisah. |
| **Measured local capacity** | **PARTIAL** | AC13 write 1k/10k PASS; mixed read 10 VU p95 4,76 s; 30 VU read invalid (403) dan memori min 306 MB; 100 VU/spike/soak BLOCKED. Hanya berlaku untuk host/topologi/dataset ini. |
| **Scale-out readiness** | **PARTIAL** | Siap: AC13 lewat gateway round-robin ke kedua API, sesi DB, idempotensi DB, advisory lock. Belum: rate limit proses-lokal, payload baca besar, event-loop p99 464 ms, tanpa batas memori/statement timeout/kompresi. |
| **Production capacity** | **TIDAK DIKLAIM** | Satu host lab, loopback, tanpa TLS/ingress nyata, dataset sintetis. |

Bukti AC13 lama `docs/test-evidence/ac13-load.json` (2026-11-18, DB `svara_demo_ac13`, server 3199) **tidak memenuhi** definisi audit ini: field `p95_commit_ms` berasal dari durasi fetch klien, bukan waktu server sampai commit; dataset demo; tanpa rekonsiliasi 600 jawaban per versi; tanpa plan/pool/DB metrics. Boleh disebut sebagai demo historis, bukan bukti AC13 resmi.

---

## 7. Keterbatasan dan status NOT_VERIFIED/BLOCKED

- **BLOCKED (resource):** 100k seed, export CSV/responses, ramp 100 VU, spike 200, dan soak 20 VU/30m. Alasan terukur: free RAM min 306 MB pada mixed 30 VU, API RSS max 740 MB, event-loop p99 max 464 ms. Tidak ada OOM/5xx, tetapi headroom tidak aman.
- **INVALID (bukan PASS):** mixed 30 VU/300 s menghasilkan 2.587×403 karena sesi tanpa grant. Write-nya (5 submit) valid dan direkonsiliasi, tetapi latency read campuran tidak dipakai. Tidak ada 5xx.
- **NOT_VERIFIED:** frontend lab (LCP/CLS/TTFB browser), standalone Docker/Next, SIGTERM/container, rate-limit 429 dan shared store, idempotensi key sama lintas replika, `pg_stat_statements`, TLS/ingress/CDN/autoscaling.
- **Host tidak sepenuhnya eksklusif:** port 4320/4322/4331 dan **3001** masih listening (gateway audit, Next standalone, API security ke `svara_audit_sec`, dan satu API `--import tsx`) meskipun koordinator menyatakan berhenti. Tidak ada koneksi established saat netstat, tetapi 3001 punya banyak TIME_WAIT (baru menerima traffic); beban/DB proses itu tidak diketahui dan proses tidak dihentikan. Kontensi tidak dapat dikesampingkan dan membatasi klaim.
- **Satu host lab:** Windows + Docker Desktop/WSL2, loopback, dataset sintetis, tanpa TLS/jaringan nyata/disk fsync produksi. Hasil tidak boleh diekstrapolasi ke produksi atau 100k.
- **Sampel kecil:** AC13 n=30; p99 = maksimum. Mixed submit hanya 2 sampel; p50-nya observasi, bukan estimasi stabil. Persentil nearest-rank.
- **Timer Windows:** resolusi ±15,6 ms; event-loop p50 idle bukan latency aplikasi. Gunakan p99/max dan delta baseline.
- **Build/DB:** BUILD_ID `3RzZi-drCTjszTT7A99TF` dari commit `95eafa3`; rewrite `/api` build tetap ke 4321, sehingga gateway wajib menangani `/api/*` (dan melakukannya). 6 respons demo dipertahankan; rekonsiliasi per run, bukan global.
- **Defect harness:** ringkasan seed salah melabeli `responses=200000` untuk 10k (join count); true count 10.000. Tidak diulang sebagai count di report.
- **Tidak ada source/test/migration/config/script yang diubah.** Semua service perf dihentikan setelah run; evidence mentah dipertahankan.

---

## 8. Checklist eksekusi (ringkas untuk koordinator)

- [x] Gate exclusive dibuka (`task_d891e6600c3f`); batas 1k/10k, AC13, EXPLAIN, mixed/ramp, spike, soak, 2,5 jam.
- [x] DB identity `svara_audit_perf` terverifikasi; seed aditif 1k/10k; 6 demo dipertahankan; tidak menyentuh `svara`/`svara_test`/`svara_audit_sec`.
- [x] Build provenance `3RzZi-drCTjszTT7A99TF` dari `95eafa3`.
- [x] Gateway same-origin: `/api/*` → 4341/4342, other → 4343; tidak ada `/api` ke Next 4321; 0×5xx.
- [x] AC13 1k/10k PASS + rekonsiliasi 30/600 + p95 498/381 ms.
- [x] EXPLAIN ANALYZE BUFFERS 1k/10k captured.
- [x] Mixed 10 VU valid + 2 submit reconciled; mixed 30 VU dicatat INVALID (403).
- [ ] 100k/export **BLOCKED** (free RAM < 3,5 GB; export tidak disetujui).
- [ ] Ramp 100/spike 200/soak 20 VU×30m **BLOCKED** (free RAM min 306 MB pada 30 VU).
- [ ] Frontend lab **NOT_VERIFIED**; hanya `GET /` 200/14 ms lewat gateway.
- [ ] SIGTERM/standalone container **NOT_VERIFIED** (tidak ada image Linux terisolasi).
- [x] Service perf dihentikan; port 4340–4343 free; evidence + report preserved. Port 3001/4320/4322/4331 milik proses lain masih listening dan tidak disentuh.
- [ ] Perbaikan source hanya di luar audit ini; tidak ada perubahan sekarang.

Urutan yang dieksekusi: preflight → AC13 1k → AC13 10k → EXPLAIN 1k/10k → mixed 10 VU → mixed 30 VU (invalid) → stop. 100k, export, ramp 100, spike, soak, frontend lab, dan SIGTERM tidak dijalankan; semuanya dilabeli BLOCKED/NOT_VERIFIED, bukan PASS.
