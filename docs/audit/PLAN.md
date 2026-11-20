# Rencana audit total Svara

Tanggal rencana: 2026-11-20. Status: rencana untuk persetujuan, bukan laporan hasil audit.

## 1. Tujuan dan batas keputusan

Audit menilai kesesuaian proses bisnis, alur setiap aktor, kualitas UI/UX, keamanan dan kerentanan, integritas data, performa, skalabilitas, serta kesiapan operasional terhadap dokumen dan implementasi aktual.

Keluaran akhir harus menjawab secara terpisah:

1. Apakah kebutuhan produk dan aturan bisnis diterapkan konsisten?
2. Apakah setiap aktor dapat menyelesaikan tugasnya melalui UI, termasuk jalur gagal dan pemulihan?
3. Apakah UI, API, dan database menerapkan izin yang sama, termasuk antarorganisasi?
4. Apakah data terkumpul, terhitung, diekspor, ditarik, dan dihapus sesuai aturan?
5. Kerentanan apa yang benar-benar terkonfirmasi, apa prasyaratnya, dan bagaimana membuktikannya secara aman?
6. Berapa kapasitas yang terukur pada lingkungan uji, apa batasnya, dan apa penghambat scale-up/scale-out?
7. Apa yang masih menghalangi demo sintetis, pilot data nyata, dan produksi? Ketiganya bukan satu tingkat kesiapan.

Audit bersifat read-only terhadap kode aplikasi. Aktivitas dinamis boleh membuat dan mengubah data sintetis hanya di lingkungan milik audit. Tidak ada perbaikan otomatis, perubahan requirement diam-diam, commit, push, PR, merge, publikasi temuan, atau pengujian terhadap production.

## 2. Baseline yang sudah diperiksa untuk menyusun rencana

- Repo: `D:/Programming/svara-app`, GitHub `arbilaksmana/svara-app`.
- Baseline sumber: `95eafa3cb38aac4dd32963a1ec584a2ce6821f25` pada `main`.
- Stack dalam manifest: Next.js `16.4.6`, React `19.3.1`, Express `^5.3.0`, PostgreSQL melalui `pg`, Tailwind 4, TypeScript, pnpm `11.5.2`.
- Tiga role akun yang didokumentasikan: `super_admin`, `org_admin`, `creator`. Petugas berizin merupakan akun yang diberi grant, bukan role keempat. Responden dan layanan integrasi adalah aktor terpisah dari role akun.
- `PRD.md` versi gabungan 1.2 mencakup F-01 sampai F-20, AC01 sampai AC17, risiko R1 sampai R9, dan keputusan eksternal yang masih terbuka.
- Dokumen produk yang ditemukan: `PRD.md`, `README.md`, `DESIGN.md`, `passport-design-system.md`.
- Konfigurasi dan bukti yang ikut menjadi bahan audit: `.env.example`, `next.config.ts`, `src/proxy.ts`, kedua Dockerfile, `docker-compose.yml`, `.github/workflows/ci.yml`, sembilan migrasi SQL, lima file suite pengujian, skrip smoke/demo, serta 19 artefak dalam `docs/test-evidence/`.
- Instruksi repo dan panduan Next.js terpasang merupakan aturan kerja, bukan bukti penerimaan produk.

### Mengapa kelulusan sebelumnya belum cukup

Ini catatan scoping, bukan daftar kerentanan terkonfirmasi:

| Sumber | Observasi awal | Konsekuensi untuk audit |
| --- | --- | --- |
| `README.md:51` dan `package.json:53` | README menyebut npm tanpa `packageManager`; manifest menetapkan `pnpm@11.5.2` | Verifikasi setup dari dokumen terhadap manifest, lockfile, Docker, dan CI |
| `README.md:408-427,444` dan `server/scripts/ac15-restore.ts` | Prosedur menggunakan pg_dump/pg_restore; bagian batasan masih menyebut VACUUM INTO | Cari dokumentasi yang tertinggal dari migrasi PostgreSQL |
| `PRD.md:100-105,210` dan `README.md:169-174` | PRD memisahkan izin individual/ekspor/teks; README menyebut pemilik dan org_admin membaca penuh | Rekonsiliasi kebijakan izin; jangan otomatis menyebutnya bug atau menganggap README mengganti PRD |
| `docs/test-evidence/ac13-load.json:2-11,44-51` | Hasil lama berlabel demo lokal; klien, server, dan DB berada di mesin sama | Tidak menjadi bukti kapasitas produksi atau hasil baseline terbaru |
| `server/scripts/ac13-load.ts:143-168,200` | Nilai bernama p95_commit_ms dihitung dari waktu fetch pada klien | Pisahkan latensi HTTP dari waktu server sampai commit; jangan mengulang nama metrik sebagai fakta |
| `docs/test-evidence/ac15-restore.json:44-59` | Restore mengembalikan respons yang sebelumnya dihapus; enkripsi/off-site/RPO/RTO tidak diuji | Audit replay penghapusan dan prosedur pemulihan, bukan hanya keberhasilan restore |
| `docs/test-evidence/ac16-walkthrough.md:3,18-24` | Walkthrough sintetis, bukan studi lapangan; satu link bukti memakai path worktree lama | AC16 lapangan tidak boleh diluluskan dari simulasi; cek portabilitas artefak |
| `README.md:443` | Rate limit didokumentasikan berada di proses | Verifikasi kontrol pada beberapa instance dan dampaknya pada perlindungan endpoint publik |

Audit akan membaca seluruh dokumen tersebut, bukan hanya bagian yang dipakai untuk scoping ini. Dokumen sumber historis yang hanya disebut dalam PRD tidak dianggap tersedia tanpa ditemukan dan diperiksa.

## 3. Metode dan standar bukti

### 3.1 Tiga lapisan verifikasi

Setiap kebutuhan ditelusuri melalui:

`requirement -> aturan domain/izin -> route dan kontrol UI -> endpoint -> query/constraint/transaksi -> hasil aktual -> bukti`

- Analisis statis menjelaskan mekanisme dan potensi masalah.
- Uji runtime membuktikan perilaku UI/API pada konteks yang ditentukan.
- Pemeriksaan database membuktikan efek, isolasi, atomicity, jumlah, dan rekonsiliasi data.

Kehadiran tombol, guard, header, nama test ACxx, atau hasil scan bersih tidak cukup untuk menyatakan kebutuhan lulus.

### 3.2 Status hasil

Setiap skenario memakai `PASS`, `FAIL`, `PARTIAL`, `BLOCKED`, atau `NOT_APPLICABLE` beserta alasan. Skenario yang tidak dijalankan diberi `NOT_VERIFIED`, tidak diubah menjadi PASS.

Setiap temuan memuat:

- ID stabil dan kategori; severity serta confidence terpisah.
- Requirement/dokumen yang terkait, aktor, organisasi, dan prasyarat.
- Expected versus actual; lokasi `file:line` dan endpoint/layar.
- Langkah reproduksi minimal dan bukti UI/HTTP/DB atau hasil pengukuran.
- Dampak pada pengguna, bisnis, kerahasiaan, integritas, ketersediaan, atau biaya.
- Akar penyebab, usulan perbaikan minimum, test penerimaan, dan dependensi.
- Status terkonfirmasi, hipotesis yang belum terbukti, gap kebijakan, atau batas verifikasi.

Satu akar penyebab menjadi satu temuan dengan seluruh lokasi terdampak. Ringkasan dapat menampilkan 15 temuan teratas; register lengkap tidak memiliki batas jumlah temuan.

### 3.3 Acuan yang dipakai

- `PRD.md` untuk kebutuhan dan kriteria penerimaan; konflik dengan README/implementasi dilaporkan, bukan diselesaikan diam-diam.
- `DESIGN.md` sebagai arah desain Svara. `passport-design-system.md` sebagai referensi sumber; adaptasi Svara dan aksesibilitas tidak dibatalkan demi menyalin sumber.
- WCAG 2.2 A/AA untuk aksesibilitas; heuristik usability tidak disamakan dengan pelanggaran WCAG.
- OWASP ASVS dan WSTG serta kategori risiko API sebagai daftar kontrol terpilih. Versi dan referensi primer dicatat saat audit; tidak ada klaim sertifikasi atau cakupan ASVS penuh tanpa matriks kontrol.
- Dokumentasi Next.js yang terpasang di `node_modules/next/dist/docs/`, PostgreSQL, Node.js, dan Express yang sesuai versi.
- Rujukan resmi dalam PRD untuk UU PDP dan standar ISO. Audit teknis memetakan kontrol dan bukti; tidak menyatakan kepatuhan hukum atau sertifikasi organisasi.

### 3.4 Skill yang digunakan

Metodenya menggabungkan analisis domain dan traceability, tinjauan UX dengan pengujian visual, keyboard dan aksesibilitas, threat modeling dan uji keamanan terkontrol, strategi pengujian kontrak/invariant, serta verifikasi terukur terhadap versi Next.js yang terpasang.

Untuk evaluasi UI, arah dibaca dari `DESIGN.md`: aplikasi survei berorientasi tugas dengan permukaan netral dan biru aksi; dial evaluasi ENERGY 1, RHYTHM 2, MOTION 1. Audit tidak membuat aset atau melakukan redesign.

## 4. Tahap A: dokumen, requirement, dan bukti lama

### Cakupan

1. Inventaris seluruh dokumen lokal yang ditemukan, termasuk PDF/DOCX/XLSX bila ada; catat nama, versi, tanggal, pemilik/sumber, dan status tersedia/hanya dirujuk.
2. Baca penuh PRD, README, DESIGN, ekstraksi Passport, konfigurasi deployment, instruksi setup, dan laporan/bukti historis yang relevan.
3. Pecah F-01 sampai F-20, AC01 sampai AC17, aturan lintasbagian PRD, dan risiko R1 sampai R9 menjadi persyaratan yang dapat diuji.
4. Cocokkan dengan implementasi saat ini, test yang benar-benar menguji kontrak, dan bukti yang dihasilkan.
5. Periksa setup dari lingkungan kosong, package manager, versi, rute, jumlah tabel, migrasi, environment, ingress, akun demo, bootstrap, dan perintah operasional.
6. Tinjau konsistensi privacy/terms/notice dengan profil platform/organisasi dan status sintetis.
7. Periksa provenance bukti: commit aplikasi, tanggal, lingkungan, input, metode pengukuran, hasil aktual, link relatif yang dapat dibuka, dan batasan.
8. Pisahkan P1, P2, fitur opsional, batasan yang disengaja, defect implementasi, dan keputusan eksternal. Tidak semua ketidakhadiran fitur adalah bug.

### Keluaran

- Register dokumen dan konflik keputusan.
- Matriks requirement dengan kolom ID, sumber, prioritas, aktor, UI/API/DB, skenario, bukti, hasil, dan gap.
- Daftar bukti lama yang masih berguna, perlu diperbarui, atau tidak cukup untuk klaimnya.
- Daftar keputusan produk/legal/integrasi yang memerlukan pemilik keputusan; tidak diisi dengan kebijakan rekaan.

## 5. Tahap B: proses bisnis, state machine, dan integritas data

### Proses utama

- Bootstrap platform dan onboarding organisasi beserta admin pertama.
- Registrasi creator individual dan melalui kode undangan organisasi.
- Pembuatan survei individual versus organisasi; kepemilikan, perpindahan organisasi akun, suspend, dan konsekuensi pada survei yang sudah ada.
- Penyusunan draf, validasi parsial, pratinjau, publikasi snapshot, versi berikutnya, penutupan, pengarsipan, dan salinan.
- Distribusi melalui tautan umum, undangan responden individual, dan identitas/penugasan integrasi.
- Notice, persetujuan diri, bukti wali, perubahan notice, pencabutan, dan kelayakan pengiriman.
- Form, tinjauan, submit, transaksi, idempotensi, bukti, dan pemulihan setelah koneksi gagal.
- Ringkasan, akses individual, free text, CSV, codebook, dan pertukaran data berizin.
- Permintaan hak subjek, retensi, penarikan/penghapusan, penerima data, dan cadangan.

### Invariant dan kasus batas wajib

1. Snapshot terbit tidak berubah ketika draf berikutnya diedit; respons A tidak berpindah ke B.
2. Close, revoke, expiry, dan consent invalid menolak kiriman baru tanpa merusak retry sah yang sudah commit.
3. Undangan organisasi untuk membuat akun berbeda dari undangan responden untuk mengisi survei. Nama, model, izin, status, dan masa berlaku tidak tercampur.
4. Satu undangan responden hanya menghasilkan satu respons final per peserta/penugasan meskipun dua tab/permintaan bersaing.
5. Kunci dan isi identik memulihkan bukti yang sama; kunci sama dengan isi berubah ditolak; konteks lain tidak dapat mengambil bukti.
6. Respons, jawaban, pemakaian undangan, consent terkait, hasil idempotensi, dan event konsisten dalam transaksi. Error tidak meninggalkan data parsial.
7. Publish bersaing dengan publish/edit/close; register bersaing dengan register/revoke; submit bersaing dengan submit/close/revoke. Harus ada hasil final yang dapat dijelaskan.
8. Opsi dan question berasal dari versi yang sama; field berlebih/duplikat, opsi item lain, teks sangat panjang, dan nilai di luar skala tidak merusak data.
9. Salinan tidak membawa respons, undangan, grant sensitif, atau bukti persetujuan.
10. Ringkasan memperhitungkan opsi nol, item dilewati, penyebut nol, dan skala berbeda; nilai asli tetap tersimpan.
11. CSV, codebook, ringkasan, dan data individual konsisten per versi, hak kolom, urutan item, waktu UTC/WIB, dan formula escaping.
12. Perubahan organisasi akun tidak diam-diam memindah tenant survei atau membuka data bekas organisasi di luar kebijakan.
13. Notice historis dan consent menunjuk versi yang benar; perubahan profil tidak membuat persetujuan lama terlihat menyetujui teks baru.
14. Tautan umum menjamin idempotensi percobaan, bukan satu manusia satu respons; UI dan dokumen tidak boleh mengklaim sebaliknya.

Keluaran: peta proses, state-transition table dengan aktor/guard/efek/audit, hasil uji invariant, dan rekonsiliasi database.

## 6. Tahap C: alur pengguna dan matriks izin tiap aktor

Semua alur kritis dijalankan melalui antarmuka nyata, dilengkapi permintaan API langsung. Menyembunyikan menu tidak dianggap sebagai otorisasi.

| Aktor/konteks | Alur yang diuji | Jalur negatif dan pemulihan |
| --- | --- | --- |
| Super admin | Bootstrap dari DB kosong; login; buat organisasi + admin; kelola akun, status, role, dan organisasi; profil platform; audit; permintaan data; integrasi | Tidak mendapat jawaban individual hanya karena role; perubahan status pada sesi aktif; akun/organisasi invalid; perpindahan scope; tindakan terhadap diri sendiri/admin terakhir dinilai terhadap kebijakan yang disepakati |
| Org admin A/B | Login dan landing yang tepat; profil organisasi; consent policy; anggota/suspend; buat/salin kode onboarding; used/revoked/expired; audit; kelola survei organisasi sesuai kontrak | ID organisasi lain; spoof organization_id; creator individual; stale session; revoke bersaing register; kode lama setelah migrasi; profil minor/mixed dengan self |
| Creator pemilik individual | Registrasi tanpa kode; login; draf; edit; preview; publish; share; close/archive; versi; hasil; settings/history | Draf tidak lengkap, publish invalid, lost update, keluar dengan perubahan belum disimpan, sesi habis, API gagal |
| Creator pemilik organisasi | Registrasi memakai kode; buat survei organisasi atau individual; lifecycle yang sama | Tidak mendapat akses ke creator rekan hanya karena satu organisasi; perbedaan kebijakan profil dan cakupan; perpindahan organisasi akun |
| Creator bukan pemilik/petugas ber-grant | Buka survei yang ditugaskan; agregat; individual; ekspor; free text sesuai kombinasi grant | Semua kombinasi can_read_aggregate/can_read_individual/can_export/can_read_text dan survey_settings yang memengaruhinya; pencabutan grant; ID versi/survei lain; URL langsung tanpa menu |
| Responden umum | Buka link; notice; persetujuan diri; jawab; validasi; review; kirim; buka kembali bukti | Tanpa consent, salah versi/opsi, data kosong, link tutup/expired/revoked, back/reload, offline, timeout sebelum/sesudah commit, dua tab |
| Responden undangan/wali | Masuk melalui kode; kelayakan/bukti wali; form; submit satu kali; receipt | Bukti belum diverifikasi/ditarik, consent milik konteks lain, token digunakan dua pihak, retry setelah digunakan, expired/revoked |
| Layanan Modul 13 simulasi | Identitas/assignment terverifikasi; event hanya setelah commit; retry event stabil; mode mandiri saat layanan mati | Identitas dari browser tidak dipercaya; salah token/scope; kegagalan layanan tidak membuat respons kedua |
| Layanan Modul 15 simulasi | Baca schema/CSV sesuai versi; pemetaan ID; kolom yang diizinkan; pembatasan/paginasi bila diperlukan | Tidak ada nama/token tanpa kontrak; scope tidak sah; free text tanpa izin; data lintasversi/tenant |
| Pemohon hak data tanpa login dan petugas penangan | Baca privacy/terms; ajukan akses/koreksi/penarikan/penghapusan; status dan tindak lanjut | Identitas pemohon harus diverifikasi sebelum tindakan; jangan mengubah data milik orang lain hanya dari ID; minimisasi log dan replay penghapusan setelah restore |

### Dataset pengujian

Minimal dua organisasi dengan kebijakan berbeda (adult/self dan minor/guardian), org_admin tiap organisasi, super_admin, creator pemilik dan nonpemilik pada organisasi yang sama/berbeda, creator tanpa organisasi, akun suspended, sesi expired/revoked, serta grant yang dapat dicabut. Gunakan beberapa versi, survei kosong/berisi/besar, tautan aktif/tutup, dan undangan aktif/used/revoked/expired.

Nama role di database, label role di UI, dan capability harus dicatat terpisah. Matriks membedakan actor x action x resource x owner/tenant x state, bukan hanya tiga baris role.

## 7. Tahap D: UI/UX, aksesibilitas, dan kualitas interaksi

### Cakupan layar

Inventaris semua route Next.js aktual dan semua keadaan yang didefinisikan, termasuk landing, login/register, creator list/editor/preview/publish/share/results/settings/history, semua layar admin, org admin, responden code/intro/form/review/receipt, privacy/terms, 404, serta error boundary.

### Pemeriksaan per flow dan komponen bersama

- Arsitektur informasi, orientasi pengguna, konsistensi istilah workspace/organisasi/survei/versi/kode, label dan CTA.
- Hierarki aksi, kepadatan, discoverability fitur, keterbacaan skala, waktu/tanggal, status, dan hak akses.
- Empty/loading/error/validation/success/permission-denied/expired/conflict; pesan harus sesuai kegagalan backend dan memberi cara pulih.
- Simpan draf, unsaved-change guard, double submit, busy state, perubahan data dari tab lain, reload/back/forward/deep link.
- Konfirmasi destruktif, Escape, backdrop, focus trap dan focus return; status loading tidak menghilangkan konteks.
- Form label/help/error association, required dalam teks, autocomplete, copy/paste/password manager, urutan fokus dan fokus error.
- Keyboard-only dari awal sampai tugas selesai; semua aksi pointer mempunyai jalur keyboard.
- Semantik landmark/heading/table/radio group, accessible name/role/state, live announcement, skip link, route-change focus.
- Ukur kontras pasangan yang benar-benar dirender termasuk state fokus/disabled/overlay; jangan menyalin rasio token sebagai hasil runtime.
- Reflow, zoom 200%, font resize, teks panjang/ID, tabel besar, target sentuh, safe area, reduced motion, dan forced colors jika tersedia.
- Konsistensi token terhadap DESIGN.md; temuan berdasarkan kegagalan tugas atau aturan yang nyata, bukan selera mengganti font/radius.

### Matriks viewport dan browser

- Setiap route utama: desktop 1440px dan mobile 390px, dengan screenshot serta console/network.
- Seluruh flow kritis: 320px dan zoom 200%; tablet 768px/1024px dan desktop lebar pada layout yang berubah.
- Setiap state yang tersedia memiliki baris coverage; state yang tidak berhasil direproduksi tetap NOT_VERIFIED.
- Chromium sebagai baseline. Firefox/WebKit dan perangkat nyata ditambahkan jika runtime tersedia; emulasi viewport Chromium bukan bukti iOS Safari/Android fisik.
- Axe atau alat setara untuk pemeriksaan otomatis; keyboard manual dan accessibility tree tetap wajib.
- NVDA/screen reader aktual jika dapat dijalankan. Accessibility tree saja tidak membuktikan pengumuman screen reader.

Keluaran memuat tabel temuan lintas aksesibilitas/layout/writing/typography/colors/UI, skor visual per flow, screenshot, rekaman langkah dan hasil, serta coverage. Skor rata-rata tinggi tidak meniadakan blocker aksesibilitas.

Audit UX oleh agen adalah evaluasi heuristik dan walkthrough, bukan riset pengguna nyata. Task success, bantuan, waktu tugas, dan keterpahaman responden nyata hanya dilaporkan bila sesi pengguna sungguhan tersedia dengan prosedur sah. AC16 tidak diluluskan dengan data sintetis.

## 8. Tahap E: kontrol keamanan dan privasi

### Threat model

Petakan aset (jawaban, identitas/pemetaan, consent, sesi, token undangan, integration key, audit, ekspor, cadangan), aktor, entry point, trust boundary, dan aliran data dari browser sampai DB/ekspor/integrasi.

Tinjau ancaman terhadap kerahasiaan, integritas, ketersediaan, dan penyalahgunaan proses bisnis. Catat pihak yang dapat menyerang, prasyarat, dampak, kontrol yang ditemukan, dan bukti efektivitasnya.

### Kontrol yang diaudit

1. Login/register/logout, scrypt dan parameternya, validasi password, cookie HttpOnly/Secure/SameSite, TTL, session fixation, invalidasi suspend/perubahan role, recovery dan verifikasi email bila ada atau bila ketiadaannya memengaruhi tujuan produk.
2. Otorisasi setiap endpoint dan route server: ownership, tenant, grant, admin-versus-data permission, default deny, dan cache/context yang tidak bocor antaruser.
3. Origin/CSRF/CORS, custom mutation header, preflight, content type, trusted proxy/IP derivation, dan jalur ingress web versus API langsung.
4. Token undangan, idempotency key, integration secret: randomness, normalisasi, collision, penyimpanan/hash, lifecycle, pembatasan percobaan, dan pencabutan.
5. Validasi parameter/path/query/body, ukuran/jumlah item, parameterisasi SQL, error sanitization, serta respons untuk objek yang tidak boleh ditemukan.
6. CSP/nonce, browser caching, XSS dan HTML/URL sink, framing, referrer, serta token pada URL/log/analitik/history.
7. Jawaban individual, free text, ekspor, kodebook, metadata bootstrap, audit, dan integration response sesuai least privilege dan minimisasi.
8. Consent/notice historis, wali, pemetaan identitas, retensi, hak subjek, kelompok kecil, serta konfigurasi yang belum layak untuk data nyata.
9. Pengelolaan secret, default environment, seed produksi, bootstrap, DB role/privilege, network binding, container user/image, dan pipeline CI.
10. Audit log: actor/scope/result, append-only enforcement, penolakan akses, redaction jawaban/kode/kredensial, dan kejadian keamanan yang bisa ditindaklanjuti.
11. Artefak build/client bundle/source map dan environment publik tidak mengandung secret server.
12. Dependency langsung/transitif serta supply chain CI/container.

Kontrol dinilai terhadap ancaman dan penggunaan aktual. Tidak otomatis meminta penggantian scrypt, penambahan MFA, Redis, atau Kubernetes tanpa risiko dan kebutuhan yang terbukti.

## 9. Tahap F: validasi vulnerability defensif

### Pemeriksaan statis dan scan

- Telusuri input ke sink berbahaya dan pemeriksaan izin menggunakan LSP/code intelligence jika tersedia.
- Jalankan audit dependensi dari lockfile yang tepat dan catat advisory, versi terpasang, tanggal database advisory, severity, serta status production/dev.
- Verifikasi applicability, reachability, konfigurasi terdampak, dan mitigasi. Hasil scanner belum menjadi exploit terkonfirmasi.
- Tinjau secret pada source/config/artefak; pencarian historis bila diperlukan dibatasi pada repo milik user, hasil disensor.
- Pemindaian image/SBOM bila Docker dan alat tersedia; kegagalan alat dicatat sebagai gap, bukan hasil bersih.

### Uji negatif terkontrol

- IDOR/BOLA lintas pemilik dan organisasi; eskalasi role/function; mass assignment account/org/grant/status.
- SQL injection, stored/reflected XSS, formula injection CSV, header/URL injection, open redirect, path traversal atau SSRF hanya jika jalur/sink terkait ada.
- Enumeration akun/kode/objek; replay sesi/consent/idempotency; pembacaan bukti dari konteks lain.
- Race register/revoke, claim satu kode, grant revoke versus read/export, close versus submit, dan perubahan notice/kelayakan.
- Resource exhaustion yang dibatasi: body besar, input banyak, hash password, regex/JSON, bootstrap/agregat/ekspor mahal; jangan menjalankan DoS tidak terbatas.
- Pembatasan rate limit pada satu instance dan beberapa instance, termasuk header proxy yang dapat dikontrol penyerang.

Setiap vulnerability terkonfirmasi memiliki reproduksi minimal pada data sintetis, expected/actual, dampak, CWE bila relevan, dan CVSS dengan vektor serta asumsi bila dapat dinilai. Informasi yang tidak cukup tetap menjadi hipotesis atau kontrol belum terverifikasi. Tidak melakukan exfiltration, menulis persistence, atau menyerang layanan eksternal.

## 10. Tahap G: performa, kapasitas, dan scalability

### 10.1 Pisahkan tiga klaim

1. Kelulusan kontrak MVP: AC13.
2. Kapasitas terukur pada mesin/topologi/dataset uji tertentu.
3. Kesiapan scale-out dan kebutuhan perubahan arsitektur.

Tidak mengekstrapolasi 30 request lokal menjadi kapasitas ribuan pengguna atau angka produksi. VU/concurrency, arrival rate, dan RPS dilaporkan terpisah.

### 10.2 Baseline dan instrumentasi

Gunakan production build, bukan next dev. Catat commit, versi runtime/DB, CPU/RAM, pool, jumlah instance, network path, warm/cold, ukuran dataset, dan lokasi generator beban.

Ukur:

- HTTP p50/p95/p99, throughput, error, timeout, 429, dan retry; expected rejection dipisahkan dari kegagalan sistem.
- Waktu server dari penerimaan sampai commit dan sampai respons, bila instrumentasi noninvasif tersedia.
- CPU, RSS/heap, event-loop delay, GC bila tersedia, pool active/idle/wait, query latency/count, DB CPU/I/O, lock wait/deadlock, dan ukuran respons.
- Jika waktu commit murni tidak dapat diukur tanpa mengubah aplikasi, laporkan HTTP sebagai proxy/upper bound beserta batasnya; jangan beri label p95 server-commit.
- Query plan `EXPLAIN (ANALYZE, BUFFERS)` pada database audit, khususnya bootstrap, list, detail, summary, individual, export, audit, dan integration. DML hanya pada data audit dengan pengendalian transaksi.

### 10.3 Skenario wajib

| Skenario | Bentuk pengujian | Yang harus dibuktikan |
| --- | --- | --- |
| AC13 | 30 kiriman serentak, masing-masing 20 item dan konteks sah berbeda | p95 server sampai bukti commit <=3 detik jika terukur; tepat 30 respons unik dan 600 jawaban sah, tanpa data parsial/duplikat |
| Concurrency correctness | Satu undangan/kunci dipakai bersaing, retry identik/berubah, close/revoke saat trafik | Integritas tetap benar walau respons ditolak, tertunda, atau client timeout |
| Mixed workload | Form baca/submit bersamaan dengan dashboard, list, audit, dan ekspor | Latensi submit, fairness, serta efek query/report berat pada pool dan lock |
| Dataset bertumbuh | Profil sintetis sekitar 1.000, 10.000, dan 100.000 respons dengan 20 item; tenant/versi/skew ditentukan eksplisit | Perubahan latency, query plan, ukuran bootstrap/payload, memori, dan kebutuhan pagination/index |
| Ramp | 30 -> 100 -> 300 concurrent clients secara bertahap, arrival rate juga dicatat | Titik saturasi lokal dan bottleneck, bukan janji seluruh tingkat akan lulus |
| Spike dan recovery | Lonjakan singkat dalam cap yang sama lalu trafik normal | Sistem menolak secara terkendali dan pulih tanpa kebocoran koneksi/data |
| Soak | Beban stabil 30 menit pada tingkat yang aman dari ramp | Tren memori, pool, throughput, latency, pertumbuhan audit/event, dan pemulihan |
| Dua replica API | Dua proses ke satu DB melalui distribusi trafik lokal terkontrol | Konsistensi sesi, limiter, idempotensi, transaksi, migrasi startup, dan kapasitas koneksi |
| Frontend | Landing/login, editor instrumen besar, form 20+ item, results besar | TTFB, LCP/CLS dan respons interaksi, ukuran JS/payload, waterfall, hydration/render, dan request bootstrap berulang |

Jumlah tenant/survei dan skew dirancang sebelum seed, bukan dibuat seolah tiga profil di atas mewakili traffic production yang belum diketahui. Dataset yang lebih besar dan soak berjam-jam memerlukan lingkungan terpisah dan persetujuan resource tambahan.

### 10.4 Review arsitektur skalabilitas

- Query N+1, scan/sort besar, agregasi per versi, indeks komposit, pagination, dan payload bootstrap yang tumbuh tak terbatas.
- Batas pool per proses versus budget koneksi total (`replica x pool + proses lain`); lock/transaction duration dan long-running export.
- State lokal proses, cache/invalidation/nonce, session store, retry/event delivery, dan dependency pada sticky session.
- Efek CSP nonce/dynamic rendering, client boundary, fetch waterfall, caching data sensitif, serta static asset/CDN.
- Node synchronous CPU work, serialisasi CSV, buffering, backpressure dan pembatalan saat klien terputus.
- Readiness, graceful shutdown, rolling restart/migration, timeout, request size, dan admission control.
- Growth retensi/audit/event, backup duration/restore window, dan beban noisy neighbor antarorganisasi.

Rekomendasi harus menyebut pemicu terukur, perubahan paling kecil yang menyelesaikan bottleneck, risiko konsistensi, perkiraan dampak yang belum diukur, dan cara verifikasi. Redis/queue/read replica/partition/microservice bukan rekomendasi default.

### 10.5 Batas keselamatan beban

Satu pemilik menjalankan load test; tidak bersamaan dengan worker lain yang memakai CPU/DB berat pada host sama. Awali smoke kecil dan disk/memory budget. Hentikan kenaikan beban pada pelanggaran integritas pertama, ketidakstabilan host, kehabisan ruang, atau 5xx tak terduga >1% selama dua menit. Abort bukan PASS; catat batas dan hasil terakhir yang valid.

Nilai SLO selain AC13 belum ditetapkan produk. Usulan seperti API baca p95 <500ms, error tak terduga <1%, LCP <=2,5s dan CLS <=0,1 dipisahkan dari acceptance resmi. INP lapangan tidak dapat disimpulkan dari Lighthouse satu kali; hasil lab interaksi diberi label lab.

## 11. Tahap H: operasional, reliability, dan kesiapan data nyata

- Uji migrate dari DB kosong dan upgrade data lama, checksum/advisory lock/rollback, serta startup dua instance secara aman.
- Verifikasi Docker production, ingress /api langsung versus rewrite development, header/cookie/proxy, DB least privilege, secret, dan seed nonaktif.
- Gangguan DB/API/integrasi; koneksi gagal sebelum/sesudah commit; restart terkontrol dan pemulihan bukti/event.
- Backup/restore pada DB audit; data yang dihapus setelah snapshot tidak boleh diam-diam dianggap tetap terhapus setelah restore. Uji prosedur replay penghapusan dan auditnya.
- Ukur durasi restore lokal; RPO/RTO produksi tidak diada-adakan. Periksa kebijakan off-site/encryption dan bukti konfigurasi bila tersedia.
- Tinjau retensi per kelas data, jadwal pembersihan, penerima ekspor, pemetaan identitas, dan kanal hak subjek.
- Tabletop insiden pada data sintetis: deteksi, scope, revoke/rotate, bukti minimum, pemulihan, dan eskalasi. Ini bukan latihan organisasi nyata tanpa partisipasi penanggung jawab.
- Pilot gate: pengendali/prosesor, kontak, instrumen, bukti wali, DPIA/penilaian dampak, retensi, lokasi hosting, transfer lintas negara, penerima data, dan keputusan antarmodul.

Keputusan eksternal yang belum ada tidak menghalangi audit teknis yang dapat dijalankan, tetapi tetap menghalangi verdict pilot/produksi yang memerlukannya.

## 12. Lingkungan dan pengamanan eksekusi

### Isolasi

- Satu checkout audit terpisah dari main, dipatok pada SHA baseline, tanpa memperbaiki source.
- Jangan memakai DB `svara` atau `svara_test` milik pekerjaan lain. Buat DB audit bernama eksplisit dan verifikasi nama, host, owner, serta sifat sintetis sebelum reset/restore.
- DB terpisah untuk suite, flow, UI, security, performance, dan restore. Role destructive hanya memiliki privilege pada resource audit.
- Port contoh yang direservasi setelah cek ketersediaan: flow API 4311; UI gateway/API/Next 4320/4321/4322; security API 4331; performance gateway/API replicas/Next 4340/4341+4342/4343. Jangan menyentuh 5173 atau server user 3000/3001.
- Setiap environment UI/performance memakai gateway same-origin milik audit: `/api/*` menuju API environment itu dan path lain menuju Next. Ini menghindari satu production build yang rewrite API-nya membeku saat build mengirim trafik semua worker ke DB yang sama. `API_INTERNAL_URL` diatur per proses Next; gateway lokal tidak diklaim membuktikan TLS/ingress produksi nyata.
- `scripts/dev.mjs` mengunci 3000/3001; lingkungan audit memakai launcher proses langsung/harness terisolasi, bukan mengubah launcher utama.
- Siapkan seed sintetis lebih dahulu; server production dijalankan dengan SEED_DEMO nonaktif. Jangan mengakali larangan seed production.
- Browser memakai context/profile audit, bukan sesi login user. Bersihkan cookie/storage antaraktor; kunci storage lama hanya dibersihkan jika masih relevan dengan implementasi saat audit.
- Semua skrip pembantu berada di folder sementara di luar source. Script tidak boleh menimpa bukti historis di docs/test-evidence.

### Rangkaian pemeriksaan

Koordinator menjalankan lint, suite, build produksi, dan smoke satu kali pada baseline audit setelah review statis awal dan sebelum pengukuran runtime terpadu. `pnpm test` sudah mencakup typecheck; jangan menggandakan typecheck tanpa kebutuhan. Build juga punya typecheck bawaan dan dicatat sebagai bagian perintah build.

```text
pnpm lint
pnpm test                 # TEST_DATABASE_URL = DB suite milik audit
pnpm build               # production web build pada checkout audit
pnpm smoke:web           # SMOKE_WEB_ORIGIN = origin audit
pnpm audit --json         # advisory snapshot, bukan bukti aplikasi bebas vulnerability
```

Seluruh environment sensitif diisi secara lokal, tidak disalin ke laporan. Perintah demo AC13/15/16 tidak dijalankan mentah jika akan me-reset DB bersama atau menimpa artefak lama; gunakan harness audit dengan target DB dan output sendiri.

Uji negatif dan pengukuran tambahan adalah probe terarah berdasarkan skenario, bukan alasan menjalankan suite penuh berulang. Error yang dilaporkan user menjadi repro; tidak perlu menjalankan ulang hanya untuk mengonfirmasi laporan tersebut.

### Batas izin

Approval audit mencakup pembuatan checkout/run/worker dan resource lokal audit yang dijelaskan, seed sintetis, build, browser, scan defensif, serta load yang dibatasi di atas. Tidak mencakup perubahan source, penghapusan resource non-audit, mematikan proses user, biaya cloud, production traffic, publikasi, commit/push/merge, atau pembersihan paksa worktree. Cleanup resource milik audit hanya dilakukan setelah bukti disimpan; cleanup Orca yang mengubah state diminta terpisah.

## 13. Orkestrasi yang diusulkan

Pola Orca: R5, supervised wave dengan koordinator sebagai pemilik integrasi.

- Repo ID: `380750e6-d16e-46cb-874b-a8fa1ad335c4`.
- Base ref: `95eafa3cb38aac4dd32963a1ec584a2ce6821f25` (main saat rencana dibuat), bukan HEAD yang bergerak saat worker mulai.
- Worktree: `audit-total`; branch yang diminta `arbilaksmana/audit-total`. Receipt Orca menjadi sumber nama/path aktual; tidak menebak saat ada suffix/konflik.
Empat worker `omp`, model `dittoo/deepseek/deepseek-v4.1-flash-1017`, effort `max` sesuai pilihan eksplisit user. Koordinator melakukan rekonsiliasi dan verifikasi temuan lintasdomain, tidak menganggap laporan worker sudah terbukti.
- Semua worker membaca source yang sama tanpa mengeditnya. Kepemilikan laporan dan evidence tidak overlap.
- Worker tidak menjalankan perintah Orca yang mengubah state, commit/push, build/lint/full suite, formatter, atau perbaikan. Probe runtime terarah hanya pada resource yang diberikan.

### Pembagian pekerjaan

| Pemilik | Scope | File laporan yang boleh ditulis | Resource dinamis |
| --- | --- | --- | --- |
| Koordinator | Baseline/inventaris; matriks kontrak bersama; provisioning; suite/build/smoke; reliability/ops; validasi silang; laporan final | 00-scope.md, 07-operations.md, REPORT.md, register CSV dan manifest evidence | DB suite/restore; proses dan resource audit yang diprovision |
| DocsBusiness | Dokumen penuh, requirement, proses bisnis, state machine, izin/flow API tiap role | 01-documents.md, 02-business-flows.md, 03-role-access.md dan evidence prefix biz | DB flow, API 4311 |
| UiUx | Walkthrough UI seluruh aktor/routes/states, enam domain interface, WCAG, mobile/keyboard | 04-uiux-accessibility.md dan evidence prefix ux | DB UI, gateway/API/Next 4320/4321/4322, browser audit |
| Security | Threat model, kontrol, dataflow, dependency/image review, PoC negatif | 05-security-vulnerabilities.md dan evidence prefix sec | DB security, API 4331 |
| Performance | Analisis query/render/topologi; lalu pengukuran beban pada slot eksklusif | 06-performance-scalability.md dan evidence prefix perf | DB performance, gateway/API replicas/Next 4340/4341+4342/4343 |

### Urutan dan gate

1. Koordinator membekukan baseline, menyalin PLAN.md ke checkout audit, lalu menyiapkan inventaris, requirement/role matrix awal, environment, dan instruksi bersama. Konflik kebijakan diberi label terbuka, bukan diubah. Semua worker mulai dari review statis; probe UI/API baru dibuka setelah koordinator mengumumkan build dan environment masing-masing siap.
2. Empat worker mulai pada wave yang sama. DocsBusiness/UI/Security dapat melakukan probe pada DB terpisah. Performance pada wave ini hanya review statis dan menyusun workload/query plan; belum menjalankan load.
3. Koordinator menjalankan pemeriksaan dasar sekali pada slot yang tidak mengacaukan pengukuran. Browser dan probe memanfaatkan build/proses yang disiapkan koordinator.
4. Ketika probe berat lain selesai, buka gate load untuk Performance. Dataset, cap beban, instrumentasi, dan health resource diperiksa sebelum ramp/soak/replica.
5. Koordinator menjalankan reliability/restore secara serial, memvalidasi temuan kritis dengan reproduksi minimum bila bukti worker belum cukup, menggabungkan temuan dengan akar penyebab sama menjadi satu register, dan memeriksa traceability.
6. Susun verdict dan backlog perbaikan. Tidak memperbaiki di tengah audit agar hasil tetap merujuk baseline yang sama.

Monitoring memakai notifikasi Orca `worker_done`, `escalation`, dan `question`. Tidak memakai polling loop/watch script yang mengonsumsi inbox; panduan Orca terpasang sudah menyediakan auto-delivery. Ringkasan hasil per worker dikirim setelah bukti diperiksa.

### Perintah state-changing yang dimintakan persetujuan

Belum dijalankan. Bentuk PowerShell, memakai executable yang terdeteksi pada sesi ini. File spesifikasi worker akan ditulis di Temp setelah approval; isinya harus mencakup target, scope, larangan edit, ownership, environment, skenario, bukti, dan acceptance dari rencana ini.

```powershell
& 'C:\Users\arbil\AppData\Local\Programs\orca\resources\bin\orca.exe' worktree create --repo id:380750e6-d16e-46cb-874b-a8fa1ad335c4 --name audit-total --branch arbilaksmana/audit-total --base-branch 95eafa3cb38aac4dd32963a1ec584a2ce6821f25 --no-parent --setup skip --json

& 'C:\Users\arbil\AppData\Local\Programs\orca\resources\bin\orca.exe' orchestration run-create --objective 'Audit total Svara baseline 95eafa3: dokumen, bisnis, role flows, UIUX, security, vulnerability, performance, scalability, operasi; tanpa perbaikan atau commit' --json
& 'C:\Users\arbil\AppData\Local\Programs\orca\resources\bin\orca.exe' orchestration run-show --id <run_id_dari_receipt> --json
& 'C:\Users\arbil\AppData\Local\Programs\orca\resources\bin\orca.exe' orchestration worker-start --run <run_id_dari_receipt> --worktree name:audit-total --agent omp --model dittoo/deepseek/deepseek-v4.1-flash-1017 --effort max --task-title DocsBusiness --spec-file 'C:\Users\arbil\AppData\Local\Temp\svara-audit-total-docs-business.txt' --json
& 'C:\Users\arbil\AppData\Local\Programs\orca\resources\bin\orca.exe' orchestration worker-start --run <run_id_dari_receipt> --worktree name:audit-total --agent omp --model dittoo/deepseek/deepseek-v4.1-flash-1017 --effort max --task-title UiUx --spec-file 'C:\Users\arbil\AppData\Local\Temp\svara-audit-total-uiux.txt' --json
& 'C:\Users\arbil\AppData\Local\Programs\orca\resources\bin\orca.exe' orchestration worker-start --run <run_id_dari_receipt> --worktree name:audit-total --agent omp --model dittoo/deepseek/deepseek-v4.1-flash-1017 --effort max --task-title Security --spec-file 'C:\Users\arbil\AppData\Local\Temp\svara-audit-total-security.txt' --json
& 'C:\Users\arbil\AppData\Local\Programs\orca\resources\bin\orca.exe' orchestration worker-start --run <run_id_dari_receipt> --worktree name:audit-total --agent omp --model dittoo/deepseek/deepseek-v4.1-flash-1017 --effort max --task-title Performance --spec-file 'C:\Users\arbil\AppData\Local\Temp\svara-audit-total-performance.txt' --json
```

Jika receipt memakai nama berbeda, selector diganti dengan address persis dari receipt untuk resource yang sama. Jika model ditolak, jangan mengganti diam-diam; laporkan error dan minta keputusan. Setup skip menghindari hook instalasi tersembunyi; instalasi dependency dengan lockfile pada checkout audit dilakukan koordinator sebagai prasyarat yang dicatat.
Setiap worker dimulai berurutan setelah `worktree create`/`run-create` mengembalikan receipt. Ganti `<run_id_dari_receipt>` dengan Run ID aktual. Jika `name:audit-total` ambigu, gunakan selector/address persis dari receipt. Tidak ada checkout path yang ditebak.

Efek samping yang disetujui harus eksplisit: satu checkout/branch lokal baru, satu Run, empat worker, dependency/build cache, beberapa DB/proses/port lokal audit, trafik sintetis terbatas, serta laporan dan bukti baru. Tidak ada perubahan source, remote branch, atau server user.

## 14. Hasil serah terima

Folder yang diusulkan: `docs/audit/2026-11-20/` pada checkout audit.

```text
00-scope.md
01-documents.md
02-business-flows.md
03-role-access.md
04-uiux-accessibility.md
05-security-vulnerabilities.md
06-performance-scalability.md
07-operations.md
REPORT.md
requirements.csv
scenarios.csv
findings.csv
risk-register.csv
evidence/manifest.json
evidence/{biz,ux,sec,perf,ops}/...
```

- REPORT.md: verdict per area, counts per status/severity, blocker, keputusan eksternal, dan prioritas perbaikan.
- requirements.csv: setiap kebutuhan P1/P2/opsional, aturan lintasbagian, AC dan risiko memiliki status serta tautan bukti.
- scenarios.csv: setiap aktor/tenant/state dan hasil runtime/DB, termasuk NOT_VERIFIED.
- findings.csv: register lengkap; ID dapat memakai DOC/BIZ/FLOW/UX/SEC/PERF/OPS.
- risk-register.csv: likelihood, impact, evidence, kontrol, residual risk, usulan pemilik, dan keputusan yang masih dibutuhkan.
- Evidence: screenshot, request/response yang disensor, hasil SQL/counts, query plan, data pengukuran mentah dan ringkasan, versi alat, exit code dan timestamp.
- Backlog P0/P1/P2/P3 dipisahkan dari severity teknis. Usulan kelompok PR menyebut akar masalah, dependensi, dan acceptance, tanpa langsung membuat PR.

Bukti tidak memuat password, cookie, token mentah, secret, jawaban nyata, atau data pribadi user. Artefak yang sensitif tidak dipublikasikan. Source/staging user tetap tidak disentuh.

## 15. Severity, verdict, dan kriteria selesai

### Severity

- Critical: jalur eksploitasi terkonfirmasi dengan dampak luas seperti pengambilalihan atau kebocoran lintastenant; prasyarat dan blast radius harus dibuktikan.
- High: akses tak sah, integritas/kehilangan data, consent bypass, tugas inti terblokir, atau blocker aksesibilitas yang terkonfirmasi.
- Medium: kegagalan fungsi/UX/performance bermakna dengan dampak terbatas atau mitigasi yang nyata.
- Low: ketidakkonsistenan/dokumentasi/polish terbatas tanpa menghambat tugas utama.
- Informational/decision required: gap keputusan atau hardening yang belum menjadi defect; tidak otomatis dibesar-besarkan menjadi vulnerability.

Priority menggabungkan severity, kemungkinan terjadi, cakupan, exposure, dan dependensi. Severity tidak diturunkan hanya karena lingkungan sekarang sintetis; exploitability production tetap diberi asumsi eksplisit.

### Audit selesai bila

1. Seluruh dokumen yang ditemukan memiliki status dibaca dan hubungan terhadap requirement; sumber yang tidak tersedia tercatat.
2. F-01 sampai F-20, AC01 sampai AC17, serta risiko R1 sampai R9 mempunyai baris traceability dan hasil, termasuk PARTIAL/BLOCKED/NOT_VERIFIED.
3. Semua aktor, route, tindakan bisnis utama, tenant boundary, serta state kritis mempunyai coverage atau batas verifikasi yang eksplisit.
4. Temuan didukung lokasi dan bukti yang cukup; hipotesis, kontrol belum teruji, dan kelemahan operasional tidak tercampur dengan vulnerability terkonfirmasi.
5. UI dinilai dari runtime; data final direkonsiliasi; metrik performa memiliki definisi, lingkungan, dataset, dan raw evidence.
6. Tidak ada temuan yang disembunyikan karena cap ringkasan, skor rata-rata, atau test lama yang hijau.
7. Laporan memberikan verdict terpisah: kesesuaian bisnis, usability/accessibility, security, kapasitas terukur/scale-out, demo sintetis, pilot data nyata, dan produksi.
8. Resource/proses audit teridentifikasi, bukti tersimpan, serta cleanup yang belum diizinkan tercatat.

Lengkap berarti semua scope mempunyai hasil atau batas bukti yang jujur. Itu tidak berarti semua skenario lulus, semua risiko hilang, atau platform terbukti aman untuk skala tanpa batas.

## 16. Status persetujuan

Rencana ini dibuat dari inspeksi read-only terhadap baseline, dokumen dan panduan alat. Audit runtime, vulnerability probe, load test, pembuatan worktree, dan peluncuran worker belum dimulai.

Persetujuan yang diminta berikutnya: jalankan audit sesuai scope dan pengamanan ini, tanpa perbaikan kode dan tanpa commit/push. Perubahan scope, target di luar resource audit, atau perbaikan harus memiliki persetujuan terpisah.
