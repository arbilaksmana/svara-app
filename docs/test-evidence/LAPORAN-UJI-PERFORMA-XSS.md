# Laporan Uji — Performa Muat Data dan Simulasi XSS

| Item | Nilai |
| --- | --- |
| Tanggal uji | 20 November 2026 |
| Aplikasi | Svara — Next.js 16.4.6, React 19.3.1, Express 5, PostgreSQL 17 |
| Lingkungan | Windows 10.0.26200 x64, Node v24.15.0, Chromium (omp managed) |
| Build | `next build` + `next start` (production), API `tsx server/index.ts`, PostgreSQL Docker |
| Basis data | Seed sintetis: 6 respons / 18 jawaban; uji muat: +300 respons / +700 jawaban → **306 respons / 718 jawaban** |
| Sifat data | Seluruhnya sintetis, bukan data peserta nyata |

Angka pada laporan ini berlaku untuk mesin lokal dan bukan SLA produksi. Tidak ada throttle jaringan, CDN, atau pembatasan CPU pada pengujian. Setelah pengujian, basis data dikembalikan ke seed awal (6 respons); tangkapan layar dan JSON hasil tetap disimpan sebagai bukti.

## Ringkasan eksekutif

- **Performa:** seluruh endpoint API yang diuji memiliki p95 di bawah **81 ms** (langsung) dan **79 ms** melalui rewrite Next. Waktu halaman sampai data siap berada di **134–241 ms (p50)** dan **≤ 347 ms (p95)** pada dataset 306 respons. Tidak ada error HTTP pada 30 sampel berurutan maupun 5 ronde uji paralel.
- **XSS:** payload `<script>`, `<img onerror>`, dan `<svg onload>` berhasil disimpan mentah di PostgreSQL, tetapi **tidak dieksekusi** di halaman review responden maupun halaman hasil kreator. Output di-encode sebagai teks (`innerHTML` berisi `&lt;script&gt;`), marker eksekusi tetap `undefined`, dan tidak ada elemen probe yang dibuat. **Hasil: PASS.**

---

## 1. Uji performa muat data

### 1.1 Metodologi

1. Basis data di-reset ke seed demo (`SEED_DEMO=1 pnpm db:reset`), lalu aplikasi dijalankan dari build produksi.
2. **Baseline** diukur pada 6 respons.
3. Dataset uji muat ditambahkan lewat `scripts/perf-seed-300.sql`: +300 respons pada `s_demo1` / `v_demo1_1`, masing-masing 2 jawaban Likert dan sepertiga memiliki jawaban teks K02.
4. **API:** 3 pemanasan + 30 sampel berurutan per endpoint, diukur dengan `fetch` + `performance.now()` sampai body selesai dibaca. Diukur dua jalur: langsung ke Express (`:3001`) dan lewat rewrite Next (`:3100/api/v1/...`).
5. **Halaman:** 2 pemanasan + 7 sampel per halaman. Metrik `dataReadyMs` adalah waktu dari navigasi sampai elemen penanda data muncul di DOM (dicek dengan `waitForFunction`, polling 25 ms), sehingga mencakup render server, hidrasi, dan fetch data klien. LCP diambil dari PerformanceObserver. Halaman creator diukur dengan sesi `creator.a@svara.local`; public form diukur setelah consent `link-umum-demo` tercatat di sesi browser.
6. **Konkurensi:** 5 ronde; setiap ronde mengirim 50 request `public-context` atau 20 request `bootstrap` secara bersamaan.

Dataset uji muat diterapkan dengan:

```bash
docker exec -i svara-app-db-1 psql -U svara -d svara < scripts/perf-seed-300.sql
```

### Definisi label dan metrik

| Label di grafik | Endpoint | Isi yang dimuat | Peran dalam pengujian |
| --- | --- | --- | --- |
| **Health** | `GET /api/v1/health` | `SELECT 1` ke PostgreSQL; respons `{"ok":true}` ±20 B | Kontrol/baseline: memastikan API dan DB hidup. Tidak memuat data bisnis. |
| **Public context** | `GET /api/v1/public/surveys/:token` | Konteks tautan publik: survei, versi, status `canSubmit`, mode persetujuan wali, profil, notice, invitation/assignment. Pertanyaan dan opsi belum dimuat. | Panggilan pertama saat responden membuka `/s/<token>` (halaman pengantar). Ukuran ±2 KB. |
| **Bootstrap** | `GET /api/v1/bootstrap` | State awal workspace user login: akun, survei, versi, pertanyaan, opsi, settings, grants, `summaries`, dan data admin bila role-nya admin. | Dimuat sekali oleh app shell setelah login; dashboard dan halaman hasil memakai payload yang sama. Ukuran ±20,7 KB. |
| **Summary** | `GET /api/v1/surveys/:id/summary?version=...` | Agregat hasil satu versi: jumlah kiriman final dan hitungan per pertanyaan/opsi. | Data ringkasan yang ditampilkan di halaman hasil. |
| **Responses (100)** | `GET /api/v1/surveys/:id/responses?version=...` | Daftar jawaban individual, dibatasi 100 baris per request; teks bebas hanya disertakan bila viewer punya izin. | Dipakai tombol **Muat jawaban individual**. |
| **Export CSV** | `GET /api/v1/surveys/:id/export?format=csv` | Seluruh jawaban pada versi tersebut dalam bentuk CSV. | Ekspor hasil untuk diolah di luar aplikasi. |

- **p50** adalah median: 50% request selesai lebih cepat dari angka tersebut. **p95** adalah persentil 95: 95% request selesai lebih cepat, sehingga menunjukkan ekor latensi (request lambat), bukan rata-rata.
- **“Langsung”** berarti request memanggil Express di `:3001`; **“via web/rewrite”** berarti request melewati Next.js di `:3100` lalu diteruskan ke Express. Selisih keduanya menunjukkan biaya proxy/rewrite.
- **“Seed (6 respons)”** dan **“Uji muat (306 respons)”** adalah ukuran dataset. Health dan public context tidak membaca tabel respons, sehingga grafiknya relatif datar; summary, responses, export, dan `summaries` di bootstrap ikut terpengaruh jumlah data.
- **Bootstrap bukan muatan per halaman.** Payload ini adalah state awal aplikasi setelah login; halaman dashboard dan hasil membacanya dari store yang sama. Karena itu biayanya muncul di kedua halaman dan menjadi komponen terbesar pada jalur kreator.

### 1.2 Latensi API langsung (Express `:3001`)

| Endpoint | Baseline p50 | Baseline p95 | 306 respons p50 | 306 respons p95 | Ukuran respons (306) |
| --- | ---: | ---: | ---: | ---: | ---: |
| `GET /health` | 2,66 ms | 5,94 ms | 2,28 ms | 4,34 ms | 20 B |
| `GET /public/surveys/link-umum-perpus` | 16,85 ms | 23,80 ms | 9,44 ms | 11,37 ms | 2.040 B |
| `GET /bootstrap` | 49,46 ms | 80,69 ms | 47,44 ms | 74,65 ms | 20.702 B |
| `GET /surveys/s_demo1/summary` | 10,97 ms | 15,02 ms | 13,45 ms | 17,43 ms | 1.579 B |
| `GET /surveys/s_demo1/responses` (limit 100) | 9,50 ms | 12,94 ms | 11,35 ms | 13,37 ms | 47.602 B |
| `GET /surveys/s_demo1/export?format=csv` (306 baris) | 9,96 ms | 12,42 ms | 15,48 ms | 22,71 ms | 29.747 B |

Catatan: `public-context` baseline lebih lambat daripada dataset 306. Endpoint ini tidak membaca tabel respons, sehingga selisih tersebut bukan efek penambahan data; nilainya adalah variasi pengukuran lokal.

### 1.3 Latensi API lewat rewrite Next (`:3100`)

| Endpoint | 306 respons p50 | 306 respons p95 |
| --- | ---: | ---: |
| `GET /api/v1/health` | 3,33 ms | 5,09 ms |
| `GET /api/v1/public/surveys/link-umum-perpus` | 12,49 ms | 19,47 ms |
| `GET /api/v1/bootstrap` | 49,17 ms | 78,18 ms |
| `GET /api/v1/surveys/s_demo1/summary` | 14,23 ms | 23,91 ms |
| `GET /api/v1/surveys/s_demo1/responses` (limit 100) | 14,62 ms | 26,99 ms |
| `GET /api/v1/surveys/s_demo1/export?format=csv` | 15,56 ms | 23,70 ms |

Pada dataset 306 respons, rewrite menambah sekitar **0,1–3,3 ms** pada p50 dibanding panggilan langsung.

### 1.4 Waktu muat halaman (production build, 306 respons)

| Halaman | Data siap p50 | Data siap p95 | LCP median |
| --- | ---: | ---: | ---: |
| Public intro `/s/link-umum-perpus` | 133,9 ms | 170,3 ms | 68 ms |
| Login `/auth/login` | 136,8 ms | 165,8 ms | 88 ms |
| Creator dashboard `/creator` | 208,3 ms | 328,4 ms | 132 ms |
| Creator results `/creator/surveys/s_demo1/results` | 241,2 ms | 347,1 ms | 204 ms |
| Public form `/s/link-umum-demo/form` | 137,0 ms | 181,4 ms | 68 ms |

Halaman publik juga memanggil `/bootstrap`; pada pengukuran satu sampel, `public-context` selesai dalam 42,9 ms dan `bootstrap` 71,2 ms. Dashboard dan halaman hasil adalah halaman terberat karena memuat bootstrap + ringkasan versi.

Request 100 jawaban individual (47,6 KB) di halaman hasil selesai dalam **23,4 ms** menurut resource timing; render daftar berjalan setelah respons tersebut diterima.

### 1.5 Konkurensi

| Skenario | Paralel | Throughput rata-rata | p50 per request* | Error |
| --- | ---: | ---: | ---: | ---: |
| `public-context`, baseline | 50 | 394 req/s | 102,2 ms | 0 |
| `public-context`, 306 respons | 50 | 534 req/s | 77,3 ms | 0 |
| `bootstrap`, baseline | 20 | 106 req/s | 181,5 ms | 0 |
| `bootstrap`, 306 respons | 20 | 83 req/s | 233,2 ms | 0 |

\* Median dari p50 tiap ronde. Pada beban paralel, request mengantre di pool PostgreSQL (maks. 10 koneksi), sehingga latensi per request naik; tidak ada penolakan atau error.

### 1.6 Grafik

![Latensi API langsung: baseline vs 306 respons](perf/chart-api-latency.png)

![Waktu muat halaman dan data siap](perf/chart-page-load.png)

### 1.7 Bukti tangkapan layar

Halaman hasil dengan 306 respons final:

![Creator results 306 respons](perf/01-results-306.png)

100 jawaban individual dimuat dari endpoint `responses`:

![Jawaban individual](perf/02-individual-answers.png)

Dashboard kreator dan halaman publik yang diukur:

![Creator dashboard](perf/03-creator-dashboard.png)

![Public intro](perf/04-public-intro.png)

### 1.8 Interpretasi dan batasan

- Semua operasi baca yang diuji selesai **di bawah 100 ms p95** di API dan **di bawah 350 ms p95** sampai data tampil di halaman.
- Penambahan 300 respons menaikkan ukuran respons `responses` (3,3 KB → 47,6 KB) dan `export` (0,8 KB → 29,7 KB). Dampak ke `summary` kecil (p50 10,97 → 13,45 ms).
- `bootstrap` adalah biaya tetap terbesar pada halaman creator (p50 ±47 ms, 20,7 KB). Optimasi berikutnya yang masuk akal adalah memuat ringkasan per survei secara lazy, bukan di bootstrap.
- Pengujian ini **bukan uji kapasitas**: hanya satu instans API, satu PostgreSQL lokal, tanpa latency jaringan, tanpa CDN, dan tanpa device mobile. Angka konkurensi dipengaruhi oleh pool 10 koneksi dan mesin yang sama dengan browser/DB.

---

## 2. Simulasi XSS pada formulir survei

### 2.1 Tujuan dan ruang lingkup

Menguji apakah input responden pada pertanyaan teks bebas dapat menjadi **stored XSS** ketika ditampilkan kembali ke responden (halaman review) dan ke kreator (halaman hasil). Pengujian memakai tautan publik `link-umum-demo`, versi `v_demo1_1`, pertanyaan **K02** (`short_text`, opsional), mode persetujuan wali.

### 2.2 Payload

```html
<script>window.__xss_s=1</script><img src=x id=xss-i onerror="window.__xss_i=1"><svg id=xss-v onload="window.__xss_v=1"></svg>
```

Payload mencakup tiga vektor: eksekusi `<script>`, handler `onerror` pada `<img>`, dan handler `onload` pada `<svg>`. Setiap vektor menulis marker berbeda ke `window`, sehingga eksekusi dapat dideteksi tanpa alert.

### 2.3 Langkah

1. Buka `/s/link-umum-demo`, isi persetujuan (kelayakan, persetujuan utama, bukti wali + referensi), lalu lanjut ke formulir.
2. Pilih jawaban Likert AD01 dan TS01, tempel payload ke K02, lalu buka halaman tinjauan.
3. Kirim jawaban; buat bukti pengiriman `r_dc7ef6cb2027d97d`.
4. Masuk sebagai `creator.a@svara.local` dan buka **Hasil** survei `s_demo1`, lalu **Muat jawaban individual**. Untuk pengujian ini, grant `g_01` sementara diberi izin baca individual + teks agar payload terlihat di UI (seed default tidak memberi izin teks ke pemilik).
5. Periksa DOM dan marker eksekusi di halaman review dan hasil.

### 2.4 Hasil pemeriksaan

| Pemeriksaan | Hasil | Bukti |
| --- | --- | --- |
| Payload tersimpan di PostgreSQL | **Ya, mentah**, 126 karakter | `answers.text` untuk `r_dc7ef6cb2027d97d` / K02 |
| `<script>` dieksekusi | **Tidak** | `window.__xss_s === undefined` |
| `<img onerror>` dieksekusi | **Tidak** | `window.__xss_i === undefined` |
| `<svg onload>` dieksekusi | **Tidak** | `window.__xss_v === undefined` |
| Elemen probe dibuat di DOM | **Tidak** | `#xss-i` dan `#xss-v` tidak ada; 0 node `<script>` memuat payload |
| Payload tampil sebagai teks | **Ya** | `textContent` berisi payload; `innerHTML` berisi `&lt;script&gt;…` |
| Halaman review responden | **Terenkode** | Screenshot 02 |
| Halaman hasil kreator | **Terenkode** | Screenshot 04 |
| Sink HTML berbahaya di `src/` + `server/` | **0 temuan** | `dangerouslySetInnerHTML`, `innerHTML`, `insertAdjacentHTML`, `srcdoc` |
| CSP halaman | `script-src 'self' 'nonce-…' 'strict-dynamic'` | Tanpa `unsafe-inline`; `object-src 'none'`, `base-uri 'self'` |
| Header tambahan | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin` | Respons halaman produksi |

Nilai DOM yang diamati pada halaman hasil:

```text
<span>
  <script>window.__xss_s=1</script><img src=x id=xss-i onerror="window.__xss_i=1"><svg id=xss-v onload="window.__xss_v=1"></svg>
</span>

innerHTML:
&lt;script&gt;window.__xss_s=1&lt;/script&gt;&lt;img src=x id=xss-i onerror="window.__xss_i=1"&gt;&lt;svg id=xss-v onload="window.__xss_v=1"&gt;&lt;/svg&gt;
```

### 2.5 Bukti gambar

Payload ditempel ke formulir survei:

![Payload di formulir K02](xss/01-form-payload.png)

Halaman tinjauan menampilkan payload sebagai teks, bukan HTML aktif:

![Payload di halaman review](xss/02-review-payload.png)

Pengiriman diterima dan menghasilkan bukti final:

![Bukti pengiriman](xss/03-receipt.png)

Payload yang sama tampil sebagai teks pada jawaban individual di halaman hasil kreator:

![Payload di hasil kreator](xss/04-results-payload.png)

Ringkasan hasil uji:

![Ringkasan hasil XSS](xss/05-summary.png)

Data mentah hasil uji tersimpan di [`xss/xss-results.json`](xss/xss-results.json).

### 2.6 Analisis

- **Input tidak disanitasi.** API menyimpan teks apa adanya. Ini terlihat dari isi kolom `answers.text` yang identik dengan payload.
- **Output di-encode dengan benar.** React/JSX merender `{answer.text}` sebagai text node. Browser tidak mem-parsing tag menjadi elemen, sehingga `innerHTML` berisi entitas (`&lt;`) dan tidak ada handler yang terpasang.
- **Tidak ada sink HTML.** Pemindaian `src/` dan `server/` tidak menemukan `dangerouslySetInnerHTML`, `innerHTML`, `insertAdjacentHTML`, atau `srcdoc`.
- **Pertahanan berlapis.** CSP produksi membatasi script ke origin sendiri + nonce dan `strict-dynamic`, tanpa `unsafe-inline`; `nosniff` dan `X-Frame-Options: DENY` juga aktif.
- **Kesimpulan:** stored XSS tidak berhasil pada jalur yang diuji. Ini adalah **PASS**, bukan karena input dibersihkan, melainkan karena encoding output dan CSP berjalan.

### 2.7 Risiko sisa dan rekomendasi

1. **Payload mentah tetap tersimpan.** Jika suatu saat teks bebas dirender lewat `dangerouslySetInnerHTML`, markdown renderer, template email, atau integrasi pihak ketiga, payload menjadi stored XSS aktif. Pertahankan kontrak “teks bebas selalu text node” dan tambahkan uji regresi.
2. **Ekspor CSV** memuat teks mentah. Ini bukan XSS, tetapi spreadsheet dapat menafsirkan nilai yang dimulai `=`, `+`, `-`, atau `@` sebagai formula. Belum diuji di sini; pertimbangkan prefix escape saat ekspor teks bebas.
3. **Sanitasi server opsional.** Validasi/allowlist karakter dapat mengurangi payload yang tersimpan, tetapi jangan menggantikan encoding output.
4. **Uji regresi otomatis.** Tambahkan test yang mengirim payload ke K02, membuka halaman review dan hasil, lalu memastikan `window.__xss_*` tidak terdefinisi, tidak ada `#xss-i`/`#xss-v` atau node `<script>` yang memuat payload, dan `innerHTML` mengandung `&lt;script&gt;`.
5. **CSP produksi** sudah baik. Jangan menambah `unsafe-inline`; pertahankan nonce per request.

---

## 3. Kesimpulan

| Aspek | Hasil |
| --- | --- |
| Waktu muat data (API) | Lulus — p95 ≤ 80,7 ms langsung; ≤ 78,2 ms via rewrite |
| Waktu muat halaman (306 respons) | Lulus — data siap 134–241 ms p50; ≤ 347 ms p95 |
| Beban paralel | Tidak ada error; antrean terlihat pada 50/20 request paralel |
| Stored XSS pada form survei | **Lulus** — payload tersimpan, tetapi terenkode dan tidak dieksekusi |
| Bukti | JSON mentah + 5 screenshot XSS + 4 screenshot performa + 2 grafik |

Batasan utama: pengukuran dilakukan di satu mesin lokal, tanpa latency jaringan dan tanpa perangkat nyata. Hasil ini cukup untuk menunjukkan perilaku aplikasi dan pertahanan XSS, tetapi tidak boleh dipakai sebagai jaminan kapasitas produksi.

## Lampiran

- Harness API: [`scripts/perf-api.mjs`](../../scripts/perf-api.mjs)
- Dataset uji muat: [`scripts/perf-seed-300.sql`](../../scripts/perf-seed-300.sql)
- Hasil mentah performa: [`perf/performance-api-baseline.json`](perf/performance-api-baseline.json), [`perf/performance-api-load-300.json`](perf/performance-api-load-300.json), [`perf/page-loads-prod-306.json`](perf/page-loads-prod-306.json)
- Hasil mentah XSS: [`xss/xss-results.json`](xss/xss-results.json)

### Reproduksi singkat

```bash
# 1. Basis data demo
SEED_DEMO=1 DATABASE_URL='postgres://svara:svara_dev_password@127.0.0.1:5432/svara' pnpm db:reset

# 2. API + web produksi
APP_ORIGIN='http://127.0.0.1:3100,http://localhost:3100' \
DATABASE_URL='postgres://svara:svara_dev_password@127.0.0.1:5432/svara' \
PORT=3001 node --import tsx server/index.ts
API_ORIGIN='http://127.0.0.1:3001' node_modules/.bin/next build
API_ORIGIN='http://127.0.0.1:3001' node_modules/.bin/next start -p 3100

# 3. Baseline performa
node scripts/perf-api.mjs --label baseline

# 4. Dataset 300 respons + ulangi
docker exec -i svara-app-db-1 psql -U svara -d svara < scripts/perf-seed-300.sql
node scripts/perf-api.mjs --label load-300
```
