# Spesifikasi Kebutuhan Sistem & PRD Implementasi — Modul 14

**Produk:** Pembuat survei dengan skoring dasar otomatis

**Dokumen:** Gabungan Spesifikasi Kebutuhan Sistem Modul 14 v1.4 (9 November 2026) dan PRD implementasi

**Versi gabungan:** 1.2 — 17 November 2026

**Status:** Siap untuk implementasi dan pengujian dengan data sintetis.

**Pengguna dokumen:** AI pengembang, tim capstone, penguji, dan pengelola studi kasus.

**Sifat dokumen:** Satu-satunya acuan produk dan implementasi. Seluruh keputusan ruang lingkup, kebutuhan fungsional, aturan data, risiko, kriteria uji, dan acuan laporan dari kedua dokumen sumber sudah dimuat di sini. Acuan standar pada §15 hanya diperlukan untuk penulisan laporan, bukan untuk memahami perilaku produk.

**Prioritas:** P1 adalah syarat penerimaan MVP. P2 dikerjakan setelah alur inti stabil. XLSX bersifat opsional.

---

## 0. Cara AI menggunakan dokumen ini

1. Petakan kemampuan yang sudah ada di repositori. Pertahankan konvensi teknologi dan migrasi yang sudah dipakai.
2. Jika proyek baru, usulan awal adalah Next.js/React dengan TypeScript dan PostgreSQL. Supabase dapat dipakai untuk autentikasi atau basis data. Pemilihan hosting untuk data responden adalah keputusan operasional tersendiri.
3. Implementasikan per tahap pada §12. Setiap tahap harus dapat dijalankan dari antarmuka aplikasi dengan data sintetis. Laporkan fitur yang benar-benar berjalan, cara menjalankannya, hasil uji, dan ketergantungan yang masih terbuka.
4. Gunakan konfigurasi terpisah untuk layanan simulasi dan layanan nyata. Rahasia hanya di lingkungan server. Sertakan contoh variabel lingkungan tanpa nilai kredensial.
5. Gunakan tujuh keputusan tim pada §2 sebagai dasar. Nama rute, bentuk respons JSON, batas teknis seperti panjang teks, dan rancangan tabel di dokumen ini adalah usulan implementasi yang boleh disesuaikan dengan repositori. Pertahankan perilaku, keterlacakan, dan hasil uji.
6. Pertanyaan kepada pemilik produk diperlukan bila perubahan memengaruhi lingkup penilaian, pemrosesan data responden, atau kontrak nyata antartim. Selesaikan pekerjaan mandiri yang bisa diuji sambil menunggu keputusan eksternal.

---

## 1. Hasil yang harus dicapai

Bangun aplikasi web tempat seorang *creator* dapat membuat survei, mengatur pertanyaan, menerbitkan tautan atau undangan individual, menerima jawaban, dan mengunduh data. Responden dapat mengisi dari ponsel tanpa membuat akun pada mode mandiri. Satu demonstrasi harus dapat dijalankan ketika Modul 13 dan 15 sama-sama tidak tersedia.

Produk adalah pembuat survei generik. Studi kasus di SMK Lugina Rancaekek menilai adopsi teknologi dan technostress saat siswa menggunakan Figma untuk tugas UI/UX. Simpan topik ini sebagai contoh konfigurasi. Editor, model data, dashboard, dan ekspor harus dapat dipakai untuk topik lain. Demonstrasikan dengan survei kedua tentang pengalaman menggunakan perpustakaan sekolah.

**Batas keluaran.** Jawaban Likert menyimpan angka yang dipilih. Dashboard menghitung frekuensi tiap pilihan per item. Modul 15 mengolah profil gabungan dengan hasil asesmen Modul 13. Skor konstruk, normalisasi 0–100, kategori tingkat, diagnosis, rekomendasi pembinaan, dan keputusan kelulusan berada di luar MVP. Bukti penyesuaian terhadap matriks topik berasal dari transkrip bimbingan. Instrumen studi kasus masih menunggu penetapan.

**Batas produk.** MVP mencakup Likert fleksibel dan jawaban singkat. Penilaian portofolio berada pada Modul 13. Indeks konstruk, kategori psikologis, diagnosis, rekomendasi pembinaan, dan pengujian statistik instrumen berada di luar MVP.

### 1.1 Posisi generik dan studi kasus

Web ini adalah produk generik: creator dapat mengganti topik, objek, item, skala, jumlah opsi, dan identitas visual tanpa mengubah kode, skema data, atau format ekspor. Tidak ada kolom, rute, label, atau kode item khusus Figma di model data, API, editor, atau ekspor.

Studi kasus SMK Lugina Rancaekek adalah deployment pertama, bukan default produk. Yang bersifat contoh: topik Figma/UI-UX/technostress, item AD01/TS01/K02, dan skala 1–5 pada fixture. Yang mengikat untuk pilot ini: kebutuhan persetujuan disertai bukti pendukung per survei, kebijakan sekolah, dan prosedur UU PDP. Deployment lain memakai aturan persetujuan dan retensi yang setara tanpa mewarisi istilah sekolah. Aplikasi tidak menyimpan kategori umur responden dan tidak menurunkan kebutuhan bukti dari umur.

| Lapisan | Sifat | Contoh |
| --- | --- | --- |
| **Inti produk** | Wajib generik | Editor, versi, undangan, respons, dashboard, ekspor, API |
| **Konfigurasi studi kasus** | Contoh yang dapat diganti | Topik Figma, AD01/TS01/K02, skala 1–5 |
| **Kewajiban deployment SMK** | Mengikat untuk pilot ini | `consent_required='wajib_upload'` pada survei yang dipilih, kebijakan sekolah, UU PDP |

### 1.2 Profil kebijakan per lingkup

Ada dua sumber kebijakan: `platform_profile` (satu baris untuk platform, dikelola operator platform) dan `organizations` (satu baris per organisasi pelanggan). Survei memakai `platform_profile` bila `surveys.organization_id` NULL, dan baris `organizations` yang ditunjuk bila tidak NULL. Setiap survei membaca tepat satu sumber, dipilih oleh lingkupnya saat survei dibuat; tidak ada fallback diam-diam ke sumber lain. Tidak ada asumsi sekolah di kode; studi kasus SMK hanya salah satu baris `organizations`.

Field minimal dan lokasinya:

| Field | `organizations` | `platform_profile` | Default generik |
| --- | --- | --- | --- |
| `organization_name` | `name` | `organization_name` | Teks bebas |
| `organization_type` | Ya | Ya | `organization` |
| `policy_url` | Ya | Ya | `/privacy` |
| `terms_url` | Ya | Ya | `/terms` |
| `retention_days` | Ya | Ya | Wajib diisi sebelum data nyata |
| `data_request_contact` | Ya | Ya | Wajib diisi sebelum data nyata |
| `cross_border_transfer` | Ya | Ya | `false` sampai ditinjau |
| `notice_version` | Ya | Ya | Mengikuti template notice yang berlaku |

Aturan:
- Profil kebijakan (organisasi atau platform) hanya menyimpan teks dan kanal kebijakan. Kebutuhan bukti persetujuan **bukan** bagian profil; nilainya milik survei (`surveys.consent_required`, lihat §5 dan §6).
- Profil tidak menyimpan kategori umur responden maupun mode persetujuan. Migrasi 024 membuang `organizations.consent_mode`; migrasi 025 membuang `profiles.consent_mode`, `profiles.respondent_age_category`, dan `organizations.respondent_age_category`.
- `policy_url` dan `terms_url` harus dapat diakses tanpa login.
- Profil hanya mengubah policy, consent, dan teks UI; tidak mengubah skema respons atau format ekspor.
- Development memakai organisasi dan profil platform sintetis. Profil produksi diisi pengendali sebelum data nyata. `platform_profile` hanya boleh berisi satu baris (`CHECK (id = 'platform')`).

---

## 2. Keputusan ruang lingkup

| Keputusan | Konsekuensi yang dapat diuji |
| --- | --- |
| **Skoring dasar** | Nilai asli Likert dan distribusi per item. Kode dimensi disimpan untuk analisis lanjutan. |
| **MVP mandiri** | Creator dapat menerbitkan survei, menerima respons, melihat ringkasan, dan mengekspor CSV tanpa layanan modul lain. |
| **Kode individual** | Studi kasus memakai undangan per peserta dan penugasan. Daftar peserta dan ID bersama Modul 13 belum tersedia. |
| **Studi kasus Figma** | Instrumen belum ditetapkan. Contoh item digunakan untuk menguji fungsi. |
| **Privasi** | Penanggung jawab, izin hasil individual, retensi, dan prosedur organisasi (pada studi kasus: sekolah) belum ditetapkan. Pengembangan memakai data sintetis. |
| **Pertukaran data** | CSV wajib. API dapat dipakai untuk integrasi. Format final tim Modul 15 belum tersedia. |
| **Target kinerja** | 30 pengiriman serentak, masing-masing 20 item, p95 waktu server maksimal 3 detik, tanpa kehilangan atau duplikasi respons sah. |

**Dasar penyesuaian.** Matriks topik mencantumkan skor per dimensi dan kategori tingkat otomatis. Bimbingan 5 November, terutama menit 40–48, memberi contoh keluaran berupa frekuensi pilihan dan ekspor jawaban. Tim memilih cakupan skoring dasar untuk MVP. Bukti arahan pembimbing berupa transkrip. Pengesahan tertulis perubahan matriks belum tersedia.

---

## 3. Aktor, izin, dan tanggung jawab

| Aktor | Operasi yang tersedia | Pemeriksaan pada server |
| --- | --- | --- |
| **Super admin** | Kelola akun dan peran, pantau jumlah survei dan respons, baca log operasional sesuai tugas | Role tidak otomatis memberikan akses ke jawaban individual |
| **Creator** | Buat/salin survei, kelola versi, publikasi, tutup, arsip, lihat agregat milik sendiri | Periksa kepemilikan objek pada setiap permintaan |
| **Admin organisasi** | Kelola profil organisasinya, anggota dan suspend, kode undangan creator, log audit organisasi, tinjau bukti pendukung; mengelola survei ber-`organization_id` organisasinya dan membaca jawaban individualnya | Hanya `org_admin` yang terikat organisasi; survei tanpa organisasi (NULL) tidak pernah jatuh kepadanya (keputusan produk 2026-11-23) |
| **Responden mandiri** | Buka tautan atau undangan, baca pemberitahuan, jawab, tinjau, kirim, dan terima bukti | Token/versi harus aktif untuk pengiriman baru. Jalur umum menjamin idempotensi kiriman, bukan identitas unik manusia |
| **Layanan Modul 13** | Berikan identitas dan penugasan terverifikasi; terima status pengiriman | Autentikasi layanan, cakupan minimum, ID stabil |
| **Layanan Modul 15** | Ambil data yang diizinkan melalui API atau konsumsi CSV | Filter cakupan dan kolom di server; catat akses dan penerima |

### 3.1 Peta rumah per peran

| Peran | Rumah setelah masuk | Halaman lain yang boleh dibuka |
| --- | --- | --- |
| Super admin (`admin` di UI) | `/admin` | Seluruh `/admin/*` |
| Admin organisasi (`org_admin`) | `/admin/org` | `/admin/org/evidence` dan `/creator` (daftar survei organisasinya, editor, publikasi, hasil) |
| Creator | `/creator` | Survei miliknya atau yang memberinya izin |

Peta rumah ditetapkan satu kali di `homeForRole` (`src/lib/routes.ts`) dan dipakai layar masuk, landing, serta tautan beranda `Shell`. `org_admin` **boleh** membuka `/creator` untuk mengelola survei organisasinya; sidebar organisasi memuat entri `Organisasi`, `Bukti pendukung`, dan `Daftar survei`, dan sorot menu mengikuti path halaman (tidak menyorot dua entri sekaligus).

**Pemberian izin.** Izin baca jawaban individual, izin ekspor, dan izin teks bebas adalah tiga izin terpisah yang diberikan **per akun dan per survei** (`access_grants`, dengan penerima, tujuan, dan masa berlaku). Satu-satunya pemberi izin hari ini adalah **Super Admin**: seluruh rute `/admin/*` dijaga `requireRole(['super_admin'])` (`server/routes/admin.ts`), termasuk `PUT /admin/grants/:accountId`. Creator dan admin organisasi tidak dapat memberikan izin kepada akun lain.

**Pembacaan jawaban individual (keputusan 2026-11-24).** Pemilik survei dan `org_admin` organisasi survei itu membaca jawaban individual sebagai pengendali, tanpa grant: keduanya sudah memegang kendali atas survei dan kebijakan organisasinya, sehingga grant kepada diri sendiri tidak menegakkan batas apa pun. Grant tetap wajib bagi pihak lain (petugas berizin, creator rekan, layanan Modul 15), terikat pengaturan survei dan dipisah per izin baca, ekspor, serta teks bebas. Super admin tetap tidak otomatis; akses individualnya diperiksa terpisah.

Uji izin melalui akses langsung ke URL/API, termasuk ketika seseorang mengganti ID objek. Identitas yang dikirim oleh browser tidak menentukan peran atau kepemilikan.

**Tanggung jawab antarmodul.** Creator memiliki dan mengelola beberapa survei. Responden mengisi melalui tautan umum atau undangan individual; mode mandiri tidak mensyaratkan akun. Alur identitas terintegrasi Modul 13 disiapkan sebagai kontrak (lihat §8.1), belum menjadi jalur MVP. Modul 13 adalah sumber identitas dan konteks penugasan jika tersedia; aturan milestone dan kelulusan berada pada sistem pembelajaran. Modul 15 menerima data yang diizinkan, menggabungkannya dengan hasil asesmen Modul 13 (pada studi kasus: asesmen UI/UX), dan melakukan analitik profil serta rekomendasi.

---

## 4. Ruang lingkup fungsional dan keterlacakan

| ID SRS | Prioritas | Perilaku yang harus tersedia |
| --- | --- | --- |
| F-01–04 | P1 | Login pengelola, otorisasi server, daftar survei per pemilik, CRUD draf, buat/salin/arsip, editor judul, bagian, pertanyaan, kode, urutan, dan kewajiban |
| F-05–07 | P1 untuk Likert dan teks; P2 untuk pilihan tunggal | Skala Likert numerik 1–N dengan label dan nilai per opsi yang dapat diatur per pertanyaan; jawaban singkat opsional/wajib; pilihan tunggal kategorikal (contoh MVP cukup memakai isian kendala opsional) |
| F-08–10 | P1 | Pratinjau tanpa data/respons produksi, publikasi versi tetap, tautan, pemberitahuan, tinjau, dan kirim |
| F-11–13 | P1 | Validasi versi, undangan, item, dan nilai; respons final per transaksi; dashboard menampilkan total kiriman, frekuensi, dan jumlah yang menjawab tiap item per versi |
| F-14, F-17 | P1 | CSV UTF-8 per versi dan kodebook yang dapat dibaca Modul 15; unduhan individual pihak selain pemilik dan `org_admin` organisasi membutuhkan izin khusus yang hanya dapat diberikan Super Admin; XLSX opsional |
| F-15, F-16 | P1 mode mandiri; P2 integrasi nyata | Alur mandiri lengkap dan identitas lokal; kontrak serta uji simulasi Modul 13 tersedia untuk pengembangan paralel |
| F-18–19 | P1 | Catat dasar pemrosesan dan bukti persetujuan sesuai konteks; audit perubahan izin/status, akses individual, publikasi, penolakan akses, dan ekspor |
| F-20 | P2 | Pembaruan otomatis dashboard; pada MVP ringkasan yang dimuat ulang sudah akurat setelah transaksi tersimpan |

P1 merupakan prioritas penerimaan MVP. P2 dapat dilaksanakan setelah alur inti stabil. XLSX merupakan perluasan opsional. Survei akhir, prasyarat portofolio, dan kewajiban tiap milestone mengikuti keputusan Modul 13 ketika integrasi dipakai.

---

## 5. Alur dan antarmuka

| Layar | Tindakan utama | Keadaan yang perlu ditangani |
| --- | --- | --- |
| Login dan daftar survei | Masuk; cari/filter; buat, salin, atau buka survei sendiri | Belum memiliki survei, login gagal, sesi kedaluwarsa |
| Editor | Judul, tujuan, petunjuk, bagian, kode item unik, tipe, nilai/label, urutan, dan kewajiban | Draf belum lengkap boleh disimpan; publikasi menyebut item yang perlu diperbaiki |
| Pratinjau/publikasi | Tinjau tampilan responden; publikasikan; pilih tautan umum atau undangan individual | Data pratinjau tidak masuk ke transaksi, statistik, atau ekspor |
| Undangan | Buat penugasan dan kode per peserta, tetapkan kedaluwarsa, cabut kode | Daftar simulasi lokal cukup selama belum ada identitas Modul 13 |
| Formulir ponsel | Baca tujuan dan pemberitahuan, konfirmasi kelayakan konteks, isi, tinjau, kirim | Item wajib kosong, opsi tak sah, undangan dicabut, versi ditutup, koneksi putus |
| Bukti pengiriman | Tampilkan ID bukti dan waktu server setelah transaksi final | Retry setelah waktu tunggu habis dapat memulihkan bukti yang sama |
| Hasil dan ekspor | Pilih versi, lihat jumlah kiriman dan distribusi tiap item; unduh sesuai izin | Nol respons, item dilewati, ekspor terbatas hak akses |
| Panel super admin | Pantau metrik per creator, kelola peran, beri izin per akun/survei, dan audit | Akses jawaban individual diperiksa terpisah |
| Pengaturan survei | Pilih kebutuhan bukti persetujuan (`tidak`/`wajib_upload`, hanya untuk survei organisasi) dan izin hasil | Survei personal selalu `tidak`; perubahan berlaku pada pengantar berikutnya |

Pada seluler, gunakan satu kolom, label opsi terbaca, pesan kesalahan dekat item, fokus keyboard jelas, dan penanda wajib dalam teks. Pertahankan nilai formulir setelah validasi gagal selama halaman masih terbuka. Sediakan tinjauan sebelum kirim. Respons final terkunci. Gaya visual dapat mengikuti sistem desain Modul 13 bila sudah tersedia.

### 5.1 Alur creator dan responden

Creator menyusun draf atau menyalin survei, lalu mengisi tujuan, objek, petunjuk, pertanyaan, label, skala, dan urutan. Pratinjau terpisah dari data produksi. Publikasi membuat versi tetap dan tautan. Perubahan isi memerlukan versi baru. Penutupan menghentikan pengiriman baru. Arsip mempertahankan riwayat sesuai retensi.

Responden membuka formulir, membaca pemberitahuan, mengikuti mekanisme persetujuan yang berlaku, menjawab, dan meninjau. Sistem memeriksa versi yang ditampilkan, periode, izin, dan item wajib. Setelah transaksi berhasil, responden menerima bukti dan respons final terkunci. Waktu server dicatat dalam UTC dan ditampilkan dalam WIB.

**Kebutuhan bukti persetujuan per survei.** `surveys.consent_required` bernilai `tidak` (default; persetujuan diri cukup) atau `wajib_upload` (persetujuan harus disertai bukti pendukung). Nilai dibaca dari survei saat pengantar dibuka, bukan dari profil organisasi. Hanya survei organisasi (`organization_id` terisi) yang boleh `wajib_upload`; permintaan untuk survei personal ditolak `422 consent_required_personal`. Pada survei `wajib_upload` tanpa bukti, `POST /public/surveys/{token}/consent` ditolak `422 guardian_evidence_required` dengan pesan generik "Untuk survei ini, persetujuan perlu disertai bukti pendukung."; bukti yang dikirim untuk survei `tidak` ditolak `422 invalid_evidence`. Bukti tetap dicatat sebagai pernyataan sendiri (`self_attested`); **tidak ada verifikasi wajib**, dan layar `/admin/org/evidence` bersifat tinjauan, bukan gerbang pemblokir. Badge pengantar memakai istilah netral: "Persetujuan diri" atau "Dengan bukti pendukung".

Pada gangguan API, antarmuka menjelaskan statusnya. Undangan mandiri hanya dapat digunakan jika mode itu diaktifkan. Respons lokal tidak dipadankan dengan peserta LMS berdasarkan nama. Gangguan setelah penyimpanan tidak membatalkan respons.

### 5.2 Siklus hidup

- **Draf → terbit.** Publikasi memerlukan konfigurasi item valid dan menghasilkan snapshot tetap beserta tautan yang mengarah ke versi tersebut.
- **Terbit → versi berikutnya.** Edit substansial membuat draf baru tanpa menutup versi terbit. Publikasi versi baru menutup versi terbit sebelumnya, sehingga hanya versi terbaru yang menerima kiriman baru. Formulir lama tidak dialihkan ke versi baru.
- **Terbit → ditutup → arsip.** Penutupan survei menutup semua versi terbit dan tautan umum yang masih aktif untuk versi tersebut. Rekam waktu penutupan dan pertahankan riwayat sesuai retensi. Pengarsipan mengatur visibilitas pengelolaan.
- **Salin survei.** Salin konfigurasi ke draf baru. Respons, identitas, izin khusus, bukti persetujuan/verifikasi (pada studi kasus: bukti pendukung), dan undangan tidak ikut disalin.
- **Gangguan integrasi.** Tampilkan status yang dapat dipahami responden. Sediakan akses mandiri hanya jika diaktifkan untuk survei tersebut. Catat mode dan sumber identitas; hindari membuat identitas kedua otomatis.

---

## 6. Data dan invariannya

| Entitas | Isi minimum | Aturan |
| --- | --- | --- |
| **UserProfile, AccessGrant** | ID akun, role, status; jenis izin, lingkup survei/penugasan | Akun pengelola berbeda dari identitas responden |
| **Survey, SurveyVersion** | Pemilik, judul, tujuan, status, `organization_id`, `consent_required`; ID/nomor versi, konfigurasi tetap, waktu terbit/tutup | Nomor versi unik per survei; formulir selalu merujuk ID versi pasti. `consent_required ∈ {tidak, wajib_upload}`, dan `wajib_upload` hanya untuk survei ber-`organization_id` |
| **Question, QuestionOption** | Versi, kode, urutan, tipe, wajib, bagian, `group_code` dan `dimension_code` opsional; label dan nilai pilihan | Kode unik per versi. Opsi dan skala terikat ke item versi itu; opsi harus milik item yang dijawab |
| **PublicLink, Assignment, Invitation** | Versi, periode aktif; penugasan, peserta, hash token, kedaluwarsa, pencabutan, dan pemakaian | Tautan umum dapat dipakai banyak responden. Undangan individual hanya dapat dipakai untuk peserta dan penugasan terkait. Konsumsi token saat transaksi berhasil |
| **Respondent, IdentityMap** | ID internal acak/stabil; sumber identitas, ID eksternal opsional | Batasi akses tabel pemetaan. ID eksternal hanya diisi dari sumber terverifikasi. Tautan umum tidak menjamin satu respons per orang |
| **ConsentRecord** | Peserta/konteks versi, versi pemberitahuan, dasar, status, waktu, referensi/berkas bukti persetujuan bila diwajibkan survei | Pertahankan riwayat perubahan status. Pisahkan klik responden dari bukti persetujuan. Status bukti awal `self_attested`; `verified`/`rejected` hanya hasil tinjauan, bukan syarat kiriman |
| **Response, Answer** | ID bukti, versi, peserta/penugasan bila ada, `collection_mode`, `identity_source`, waktu UTC; nilai numerik asli atau teks | Satu jawaban per item per respons. Versi pertanyaan dan opsi harus konsisten. Respons final terkunci. `assignment_id` terisi = masuk lewat undangan |
| **SubmissionAttempt** | Kunci retry, lingkup pengiriman, sidik isi, ID bukti | Kunci yang sama dan isi sama mengembalikan bukti lama. Kunci sama dengan isi berbeda ditolak |
| **IntegrationEvent, AuditLog** | ID kejadian, tujuan, status, percobaan ulang; aktor, aksi, objek, hasil, waktu | Event selesai hanya untuk respons tersimpan. Log tidak memuat token, kredensial, atau jawaban |

Terapkan relasi dan batasan unik pada basis data. Satu respons per peserta **per penugasan individual**, termasuk saat dua tab atau dua permintaan bersaing. Jangan menerapkan batasan tersebut pada seluruh responden tautan umum. Kode yang dapat dipakai untuk mengisi harus berbeda dari ID pseudonim yang diekspor.

### 6.1 Transaksi pengiriman

1. Verifikasi konteks akses dan identitas/kepemilikan percobaan. Periksa retry yang sudah berhasil sebelum menolak akibat undangan telah dipakai. Hanya pemegang konteks pengiriman yang sama dapat memulihkan bukti.
2. Untuk kiriman baru, periksa versi aktif, periode, kelayakan persetujuan, undangan, tipe item, opsi, kelengkapan, dan kesesuaian nilai terhadap versi. Abaikan klaim skor atau identitas dari klien yang tidak didukung konfigurasi.
3. Di dalam satu transaksi, lindungi undangan dari penggunaan serentak, tulis bukti dan jawaban, konsumsi undangan, simpan hasil idempotensi, dan catat event bila perlu. Jika gagal, batalkan semua perubahan.
4. Setelah commit, kembalikan bukti. Jika jaringan gagal sesudah commit, klien mengirim ulang dengan kunci yang sama. Jika pengiriman ke LMS gagal, retry event secara terpisah dengan ID kejadian yang tetap.
5. Ringkasan dibaca dari respons final. Bila memakai cache, sediakan rekonsiliasi dengan data final. Kegagalan pembaruan dashboard tidak mengubah bukti kirim.

---

## 7. Skoring dan ekspor

Hitung distribusi per kombinasi versi, item, dan nilai opsi. Simpan nilai opsi yang dipilih pada versi formulir. Tampilkan opsi tanpa pemilih sebagai nol. Jawaban opsional yang kosong tidak dihitung sebagai nilai nol. Persentase per pilihan, jika digunakan, memakai jumlah yang menjawab item tersebut. Untuk penyebut nol, tampilkan "Belum ada jawaban". Jawaban teks tidak mendapat skor. Pisahkan hasil antarversi. Informasi arah item dan pembalikan item, jika relevan, disimpan di kodebook untuk analisis lanjutan; nilai yang dipilih tetap tersimpan.

**Contoh fixture skoring (kode item mengikuti studi kasus):** Ada lima respons final. Nilai AD01 adalah 2, 4, 4, 5, dan kosong. Total kiriman 5, terjawab 4, dilewati 1, total pengisi AD01 empat. Frekuensi opsi 1–5 adalah 0, 1, 0, 2, 1. Opsi 4 memperoleh 50% dari responden yang menjawab AD01.

### 7.1 CSV standar

UTF-8, satu baris per respons, satu ekspor per versi. Urutkan item sesuai instrumen. Kolom tetap lalu kolom jawaban; dua kolom pembeda ditambahkan **di akhir daftar kolom tetap**, sebelum kolom jawaban:

- `organisasi` — `surveys.organization_id` bila survei milik organisasi, selain itu literal `publik`. Nilai dibaca sekali per ekspor dari baris survei; batch respons tidak membaca `surveys` lagi.
- `cara_masuk` — `undangan` bila `assignment_id` terisi, `tautan_umum` bila kosong.

Kolom minimum dan satu baris sintetis:

```csv
response_id,respondent_id,survey_id,survey_version,assignment_id,collection_mode,identity_source,submitted_at,organisasi,cara_masuk,AD01,TS01,K02
r_demo01,p_demo01,s_demo,1,a_demo,standalone,local,2026-11-09T05:00:00Z,org_demo,undangan,4,2,""
```

Kolom K02 kosong ditulis sebagai field kosong. Nama tidak masuk ekspor standar. Jangan mengekspor token pada keluaran standar.

### 7.2 Kodebook

Kodebook memuat versi, kode, teks item, tipe, nilai dan label, arti nilai kosong, kelompok/dimensi, serta aturan arah jika tersedia. Sertakan teks bebas hanya untuk penerima berizin. Pastikan koma, tanda petik, dan baris baru dalam teks tidak merusak struktur CSV. Perlakukan teks yang tampak seperti formula sebagai teks aman saat dibuka di spreadsheet tanpa menimpa jawaban asli di database.

Unduhan individual, teks bebas, dan ekspor memerlukan izin terpisah. Catat penerima, tujuan ekspor, dan filter kolom.

---

## 8. Kontrak API dan integrasi

Gunakan awalan `/api/v1`. Klien menerima pesan yang dapat ditindaklanjuti tanpa rincian basis data atau identitas peserta lain.

| Metode dan rute | Otorisasi | Perilaku |
| --- | --- | --- |
| GET/POST `/surveys` | Creator | Daftar sendiri atau buat draf. Badan boleh memuat `owner_scope` (`individual`/`organization`) dan `consent_required`; `wajib_upload` pada survei personal ditolak `422 consent_required_personal` |
| PUT `/surveys/{id}` | Creator pemilik | Simpan metadata dan konfigurasi draf; pertahankan versi terbit |
| POST `/surveys/{id}/publish` | Creator pemilik | Validasi, bekukan versi, terbitkan tautan |
| POST `/surveys/{id}/close` atau `/surveys/{id}/archive` | Creator pemilik | Ubah status dengan validasi dan audit |
| POST `/surveys/{id}/assignments` | Creator berwenang | Buat penugasan dan undangan individual |
| GET `/public/surveys/{token}` | Responden dengan akses | Kembalikan formulir versi aktif dan pemberitahuan |
| POST `/public/surveys/{token}/responses` | Responden; `Idempotency-Key` | Validasi dan simpan atomik, kembalikan bukti |
| GET/PUT `/surveys/{id}/settings` | Pemilik/`org_admin` | Izin hasil (`allowResults`, `allowIndividual`) dan `consent_required`; field yang tidak dikirim mempertahankan nilai tersimpan |
| GET `/surveys/{id}/summary` | Pemilik berizin | Distribusi agregat per versi |
| GET `/surveys/{id}/export` | Izin ekspor pada objek | CSV/kodebook per versi, catat ekspor dan filter kolom |
| GET `/integration/survey-data` | Layanan Modul 15 berizin | Skema berversi, filter versi, pembatasan kolom, paginasi jika perlu |

**Contoh kiriman dan bukti sintetis.** Nilai yang disimpan diturunkan dari konfigurasi opsi pada server. Header `Idempotency-Key` dipertahankan pada setiap retry kiriman tersebut.

```json
{"version_id":"v_demo1","answers":[{"question_code":"AD01","option_id":"ad01_opt4"},{"question_code":"TS01","option_id":"ts01_opt2"}]}
```

```json
{"response_id":"r_demo01","version_id":"v_demo1","submitted_at":"2026-11-09T05:00:00Z","status":"submitted"}
```

**Kesalahan usulan:** 401 untuk layanan tanpa autentikasi, 403 untuk hak tidak memadai, 409 untuk konflik kiriman/kunci, 410 untuk tautan ditutup atau kedaluwarsa, 422 untuk item tidak valid. Pada akses publik gunakan pesan umum jika alasan yang terlalu rinci memungkinkan penelusuran peserta.

### 8.1 Kontrak Modul 13

Simulasikan identitas peserta, penugasan, dan penerimaan event pada adapter layanan. Nama endpoint eksternal dan mekanisme autentikasi masih perlu disepakati antartim. Bedakan LMS mencatat tautan dibuka dari Modul 14 mencatat jawaban tersimpan. Contoh event ke layanan terotorisasi:

```json
{"schema_version":1,"event_id":"ev_demo01","type":"survey.submitted","assignment_id":"a_demo","respondent_id":"p_demo01","submitted_at":"2026-11-09T05:00:00Z"}
```

### 8.2 Kontrak Modul 15

CSV merupakan jalur keluaran wajib MVP. API adalah jalur integrasi yang didukung rancangan. Sediakan fixture konsumen dengan `schema_version`, versi survei, kode item, nilai atau teks sesuai izin, serta ID peserta yang dapat dipadankan melalui kontrak.

**Arti `collection_mode` dan `identity_source`.** Kedua kolom menjelaskan **cara proses kiriman berjalan** dan **asal identitas responden**, bukan hubungan responden dengan organisasi:

- `collection_mode` — `standalone` bila kiriman diproses oleh Modul 14 sendiri (tautan umum atau undangan yang dibuat di Modul 14); `integrated` disiapkan untuk kiriman yang diproses lewat layanan Modul 13.
- `identity_source` — `local` bila identitas peserta dibuat Modul 14; `module_13` bila identitas datang dari layanan terverifikasi Modul 13.

MVP hanya menghasilkan `standalone`/`local`. Asal kiriman per baris ditandai kolom CSV `cara_masuk` (`undangan`/`tautan_umum`, lihat §7.1). Relasi responden–organisasi (misalnya keanggotaan, kelas, atau unit kerja responden) **tidak** dicatat pada MVP; ia menjadi roadmap dan, bila disepakati, memerlukan skema tersendiri. Pisahkan hasil uji fixture dari hasil integrasi nyata. Kontrak diuji dengan simulasi sampai antartim menyepakati format nyata. Format eksternal final masih terbuka.

---

## 9. Keamanan dan pelindungan data

1. **Tujuan dan minimisasi.** Dokumentasikan data yang diperlukan untuk undangan, persetujuan, pengisian, audit, dan ekspor. Gunakan ID internal. Jangan meminta nama, tanggal lahir, nomor identitas, atau salinan dokumen identitas pihak berwenang secara default hanya karena tersedia kolom; pada studi kasus, contohnya NIS dan identitas wali.
2. **Persetujuan dengan bukti pendukung (per survei).** Pengendali memutuskan survei mana yang memerlukan bukti pendukung (`surveys.consent_required='wajib_upload'`; hanya untuk survei organisasi). Server menolak persetujuan baru pada survei itu bila bukti belum diisi. Aplikasi tidak mencatat kategori umur responden dan tidak menurunkan kebutuhan bukti dari umur; dasar pemrosesan tetap tanggung jawab pengendali per instrumen.
3. **Hak dan retensi.** Tampilkan tujuan, penerima, kontak, kebijakan retensi, dan mekanisme permintaan. Sediakan proses terotorisasi untuk akses, koreksi data pribadi, penarikan, dan penghapusan. Catat tindak lanjut terhadap ekspor dan cadangan. Respons terkunci bagi responden tetap memungkinkan penanganan permintaan oleh pihak berwenang.
4. **Operasi.** Gunakan HTTPS, penyimpanan dan cadangan terenkripsi, akses server per objek, rahasia layanan di luar klien, serta log akses/penolakan. Terapkan pembatasan percobaan pada endpoint publik. Hindari token pada log aplikasi, proxy, dan analitik; jangan mengirim jawaban melalui broadcast umum.
5. **Agregasi.** Untuk kelompok kecil, terapkan pembatasan tampilan sesuai kebijakan pengendali. Ringkasan per versi (total dan hitungan per pertanyaan, termasuk isian teks) ditahan sampai versi itu menerima 5 respons (SEC-16, `SUMMARY_MIN_RESPONSES`); parameter keluaran per kelompok (pada studi kasus: sekolah) belum ditetapkan, dan ambang 5 belum menggantikannya. Jangan menggunakan filter sempit untuk mengungkap satu responden.
6. **Insiden.** Isolasi akses terdampak, cabut kredensial, pertahankan bukti minimum, eskalasi ke pengendali, dan catat pemulihan. Ikuti prosedur pemberitahuan pada §9.2 dan Pasal 46 UU PDP.
7. **Sebelum pilot.** Tetapkan pengendali/prosesor, kontak, alur bukti persetujuan (pada studi kasus: bukti pendukung pada survei yang dipilih), penilaian dampak, penerima individual, masa simpan, prosedur hak subjek, lokasi pemrosesan, dan persetujuan instrumen. Jangan mengisi pengaturan yang belum disepakati dengan kebijakan organisasi rekaan (pada studi kasus: sekolah). Gunakan data sintetis untuk development dan pengujian.

**Dasar hukum data anak.** Pengendali menetapkan tujuan, dasar pemrosesan, penerima, penanggung jawab, dan jadwal retensi sebelum uji lapangan. UU 27/2022 Pasal 4 dan 25 menggolongkan data pribadi anak sebagai data pribadi spesifik dan mensyaratkan persetujuan orang tua dan/atau wali. Pasal 34 mengatur penilaian dampak untuk pemrosesan berisiko tinggi, termasuk data pribadi spesifik dan pencocokan kelompok data. Rencanakan penilaian dampak sebelum pilot.

### 9.1 Kontrol sepanjang siklus survei

| Tahap | Kontrol yang dibangun dan diuji |
| --- | --- |
| **Pengumpulan** | Tampilkan tujuan, jenis data, penggunaan oleh Modul 15, retensi, kontak, dan hak peserta. Pada survei `wajib_upload`, persetujuan baru ditolak sampai referensi atau berkas bukti diisi; berkas hanya disimpan bila survei mewajibkannya. Tinjauan pengelola (`/admin/org/evidence`) bersifat opsional dan tidak memblokir kiriman. Hindari salinan identitas pihak lain jika referensi bukti memadai. |
| **Identitas** | Gunakan kode acak untuk undangan dan ID peserta terpisah untuk pencocokan. Rahasiakan pemetaan dan batasi aksesnya. Data berkode tetap dapat mengidentifikasi responden selama pemetaan tersedia. |
| **Penyimpanan** | Terapkan HTTPS, enkripsi penyimpanan dan cadangan, kredensial layanan di server, pembatasan per pemilik dan penugasan, serta pencatatan akses. Pisahkan lingkungan uji sintetis dari produksi. |
| **Pemakaian** | Super admin melihat metrik operasional; creator melihat agregat sendiri. Jawaban individu, teks bebas, dan unduhan memerlukan izin terpisah. Batasi tampilan kelompok kecil bila kombinasi kelompok dan jawaban dapat mengungkap responden. |
| **Pembagian** | CSV disalurkan melalui unduhan berizin dan API melalui kredensial layanan dengan cakupan minimum. Catat penerima serta tujuan ekspor. Teks bebas dapat memuat identitas yang ditulis responden; batasi dan periksa sebelum dibagikan. |
| **Akhir siklus** | Sediakan kanal permintaan akses, koreksi, penarikan persetujuan, dan penghapusan. Verifikasi pemohon, catat tindak lanjut, sinkronkan dengan penerima, dan dokumentasikan penanganan cadangan. Frekuensi pembersihan mengikuti retensi yang ditetapkan. |

### 9.2 Respons insiden

Petugas mencatat waktu dan gejala, membatasi akses terdampak, mencabut token/kredensial, menjaga bukti minimum, dan segera mengeskalasi ke pengendali. Pengendali menilai data dan subjek terdampak, mendokumentasikan mitigasi, dan mengoordinasikan pemberitahuan. Jika terjadi kegagalan pelindungan data pribadi, Pasal 46 UU 27/2022 mewajibkan pemberitahuan tertulis paling lambat 3 × 24 jam kepada subjek data pribadi dan lembaga. Cantumkan data yang terungkap, kapan dan bagaimana terungkap, serta penanganan dan pemulihan. Dalam keadaan tertentu diperlukan pemberitahuan kepada masyarakat.

Sesudah pemulihan, uji ulang kontrol yang gagal, perbarui register, dan dokumentasikan keputusan pengendali. Hasil uji kinerja, tingkat risiko sisa, dan kepatuhan operasional diisi berdasarkan bukti pelaksanaan.

### 9.3 Permukaan privasi dan dokumen kebijakan

**Notice per survei (wajib).** Sebelum item pertama, tampilkan pemberitahuan yang menyebut tujuan, jenis data, penggunaan oleh Modul 15, retensi, penerima, kontak, hak peserta, dan versi pemberitahuan. Notice memakai template dari profil deployment. Simpan `notice_version` pada `ConsentRecord`. Jika persetujuan wajib belum lengkap, server menolak kiriman. Notice harus dapat dibaca tanpa login dan tetap tersedia setelah versi survei ditutup.

**Halaman kebijakan privasi dan ketentuan layanan (permukaan standar).** Sediakan `/privacy` dan `/terms` yang dapat diakses tanpa login dan ditautkan dari footer, halaman form, serta layar bukti. Isi dibaca dari profil deployment; default generik boleh memakai template, sedangkan teks final untuk pilot disetujui pengendali.

Isi minimum `/privacy`: identitas dan kontak pengendali/prosesor, tujuan dan dasar pemrosesan, kategori data, penerima (termasuk Modul 13/15), retensi, hak subjek, prosedur permintaan, transfer lintas negara bila ada, ketentuan data anak, serta tanggal dan versi berlaku.

Isi minimum `/terms`: aturan penggunaan, tanggung jawab akun creator/admin, kepemilikan konten, ketersediaan, batas tanggung jawab, dan penghentian. ToS bukan pengganti notice persetujuan; kepatuhan isi tetap keputusan legal pengendali.

**Kanal permintaan data.** Sediakan jalur untuk akses, koreksi, penarikan, dan penghapusan. Verifikasi pemohon, catat waktu dan tindakan, serta jangan memuat jawaban atau token di log. Kanal boleh berupa form, email resmi, atau kombinasi; kontaknya harus tampil di notice dan `/privacy`.

**Versi dan perubahan.** Perubahan material membuat versi notice baru. Persetujuan lama tetap merujuk versi yang disetujui; halaman global menampilkan tanggal berlaku. Jangan mengubah teks notice secara retroaktif.

**Konteks SMK.** Notice ramah anak; kebutuhan bukti pendukung ditetapkan per survei pada pilot; kebijakan sekolah harus disetujui pengendali. Notice tidak menyebut kategori umur responden. Gunakan placeholder berlabel sintetis sampai teks disahkan.

---

## 10. Risiko, standar, dan bukti mutu

### 10.1 Register risiko

Prioritas awal merupakan penilaian desain. Tim meninjau register setiap iterasi dan sebelum uji lapangan. PIC di bawah merupakan usulan peran. Catat tanggal, status, bukti kontrol, sisa risiko, dan penanggung jawab yang menerima atau meminta perbaikan.

| ID dan prioritas | Risiko | Uji atau bukti perlakuan | Kontrol tambahan | PIC usulan |
| --- | --- | --- | --- | --- |
| **R1 • tinggi** | Layanan atau peserta belum tersedia; API/daftar peserta terlambat | Seluruh demo mandiri lulus dengan layanan Modul 13/15 dimatikan; uji alur mandiri dan kontrak dengan data sintetis; laporkan simulasi terpisah dari integrasi nyata | Mode mandiri tidak bergantung layanan luar; adapter simulasi untuk kontrak | Koordinator integrasi |
| **R2 • tinggi** | Identitas tertukar atau kode bocor; peserta salah dipadankan | Dua peserta bernama sama tidak dipadankan otomatis; kode dicabut ditolak; uji dua pengiriman serentak dengan satu kode | ID stabil, token sekali pakai, masa berlaku, pencabutan; jangan cocokkan berdasarkan nama | Backend |
| **R3 • tinggi** | Kiriman ganda atau hilang | Percobaan serentak dan timeout sebelum/sesudah commit; cocokkan bukti dan jumlah jawaban; pulihkan bukti yang sama | Transaksi atomik, kunci unik per peserta/penugasan, idempotensi | Backend/QA |
| **R4 • tinggi** | Akses di luar izin atau CSV tersebar | Uji dua akun, endpoint langsung, cakupan layanan, dan catatan penerima; creator lain tidak dapat mengunduh hasil di luar penugasannya | Periksa izin server pada ringkasan, jawaban, unduhan, dan API; catat penerima ekspor | Backend/QA |
| **R5 • tinggi** | Persetujuan tanpa bukti yang diwajibkan survei | Uji `wajib_upload` menolak persetujuan tanpa bukti dan menolak berkas pada survei `tidak`; bukti berstatus `rejected` tetap tidak memblokir respons karena tinjauan bukan gate | Pilih `wajib_upload` hanya pada survei organisasi yang membutuhkan bukti; pemberitahuan sebelum pengisian; tinjauan pengelola dengan audit | Pengendali/sekolah |
| **R6 • tinggi** | Identifikasi melalui komentar atau kelompok kecil | Periksa kolom ekspor, hak teks bebas, dan filter kelompok | Batasi teks bebas, kontrol penerima, tinjau kelompok kecil; ekspor standar tanpa nama | Pengelola data |
| **R7 • sedang** | Versi berubah atau skor salah ditafsirkan; instrumen berubah | Uji A/B, rekonsiliasi, keterangan interpretasi di dashboard/kodebook; periksa kodebook per versi | Publikasi membekukan versi; simpan nilai asli; dokumentasikan batas interpretasi | Pemilik produk |
| **R8 • tinggi** | Retensi berlebih atau cadangan gagal | Simulasikan restore dan pastikan penghapusan terdokumentasi tetap dihormati; uji penghapusan setelah restore | Jadwal retensi per kelas data; uji pemulihan sintetis | Operasional |
| **R9 • tinggi** | Kebocoran kredensial atau akses jawaban | Latihan pencabutan, penggantian kunci, penelusuran log, dan eskalasi; simulasi pelaporan | Cabut akses, rotasi kunci, isolasi jalur terdampak, aktifkan prosedur insiden | Operasional/pengendali |

**Contoh keterlacakan R4.** Creator mencoba mengunduh hasil responden di luar penugasannya. Dampak keamanan berupa terbukanya jawaban individual. Dampak privasi bagi responden berupa pengungkapan jawaban sensitif (contoh: pengalaman technostress) kepada pihak yang tidak berwenang. Hubungkan R4 ke F-14/F-17 dan F-18/F-19, lalu uji dengan dua akun creator. Bukti lulus berupa penolakan server dan log audit tanpa isi jawaban. Pemilik risiko menilai sisa risiko salinan CSV setelah unduhan sah.

**Contoh keterlacakan R5.** Persetujuan tercatat pada survei `wajib_upload` tanpa bukti. Uji berdasarkan data sintetis bahwa `POST /public/surveys/{token}/consent` menolak tanpa referensi/berkas (`422 guardian_evidence_required`) dan menerima pernyataan sendiri beserta bukti (`self_attested`). Pengendali menetapkan survei mana yang mewajibkan bukti, tata cara tinjauannya, dan retensi berkas sebelum pilot studi kasus.

### 10.2 Penerapan standar

Edisi acuan dipilih per 9 November 2026. Tim membatasi evaluasi pada proses, karakteristik produk, dan kontrol yang relevan dengan Modul 14. Setiap bukti mencantumkan versi aplikasi, tanggal, pelaksana, hasil aktual, dan tindak lanjut.

| Acuan dan peran | Penerapan dan bukti dalam laporan |
| --- | --- |
| **ISO/IEC/IEEE 12207:2026 • proses siklus hidup** | Petakan kebutuhan F-01–20 ke keputusan desain, perubahan kode, verifikasi, dan validasi pengguna. Catat perubahan versi, hasil serah terima, dan rencana pemeliharaan. Proses dapat diterapkan iteratif. |
| **ISO/IEC 25010:2023 • model mutu produk** | Pilih karakteristik berdasarkan tujuan MVP. Hubungkan setiap karakteristik terpilih dengan skenario, metrik, target, dan bukti aktual. Alasan pemilihan dicatat pada metodologi. |
| **ISO/IEC 27001:2022 beserta Amd 1:2024 • keamanan informasi** | Tetapkan aset, ancaman, dan dampak terhadap kerahasiaan, integritas, dan ketersediaan. Catat pemilik risiko, perlakuan, kontrol, bukti uji, dan keputusan mengenai risiko sisa. |
| **ISO/IEC 27701:2025 • manajemen privasi** | Petakan pemrosesan dari undangan sampai penghapusan. Catat tujuan, peran pengendali/prosesor, subjek, data, akses, penerima CSV/API, retensi, dan penanganan permintaan. |
| **UU 27/2022 tentang Pelindungan Data Pribadi • dasar hukum** | Hubungkan alur data dengan kewajiban yang relevan. Siapkan bukti persetujuan yang diwajibkan per survei, penilaian dampak, dan prosedur insiden sesuai §9. |

**Batas penerapan.** Laporan mendokumentasikan penerapan terpilih pada capstone. Pemeriksaan klausul menyeluruh dan sertifikasi sistem manajemen organisasi berada di luar ruang lingkup proyek. Pada studi kasus, skor survei pengalaman siswa menggunakan Figma dan evaluasi mutu aplikasi Modul 14 merupakan dua pengukuran dengan objek berbeda.

### 10.3 Bukti mutu produk

| Mutu produk yang dipilih | Bukti penerimaan Modul 14 |
| --- | --- |
| **Functional suitability** | Bandingkan frekuensi tiap opsi, item kosong, dan ekspor versi yang sama dengan hitungan manual. Semua hasil contoh harus cocok. |
| **Performance efficiency** | Jalankan skenario 30 kiriman serentak × 20 item. Target p95 waktu server ≤3 detik. Simpan catatan lingkungan dan pengukuran. |
| **Reliability** | Simulasikan timeout sebelum/sesudah commit. Buktikan bukti kirim yang sama dapat dipulihkan dan seluruh respons sah tersimpan tepat satu kali. |
| **Security** | Uji pembatasan akses lintas creator serta ekspor melalui API. Catat penolakan dan periksa log dari kebocoran token atau jawaban. |
| **Interaction capability** | Amati responden membuka formulir di ponsel, memahami skala, memperbaiki item wajib, dan menyelesaikan kiriman. Catat keberhasilan tugas dan bantuan yang dibutuhkan. |
| **Compatibility** | Untuk interoperabilitas, buka CSV pada spreadsheet dan uji kontrak API dengan konsumen simulasi. Uji dengan Modul 15 nyata dicatat ketika tersedia. |

---

## 11. Uji penerimaan

| ID | Skenario | Lulus jika |
| --- | --- | --- |
| AC01 | Creator membuat dua survei dengan topik berbeda (contoh: Figma dan perpustakaan) | Keduanya memakai editor yang sama; konfigurasi skala dapat berbeda |
| AC02 | Pratinjau, salin, lalu publikasikan | Pratinjau tidak menambah respons; salinan tidak membawa undangan, jawaban, atau izin sensitif |
| AC03 | Dua akun dan percobaan mengganti ID | Akses lintas pemilik ditolak pada halaman dan API |
| AC04 | Form A terbuka ketika B diterbitkan | Respons A tetap masuk ke A jika terbuka; kiriman baru A ditolak setelah A ditutup |
| AC05 | Item wajib kosong, opsi item lain, angka di luar konfigurasi | Pesan menunjukkan item, tidak ada data parsial, dan undangan belum terpakai |
| AC06 | Dua tab, undangan sama | Maksimal satu respons final per peserta dan penugasan |
| AC07 | Retry identik dan retry dengan isi berubah | Bukti sama dapat dipulihkan untuk retry identik; isi berubah dengan kunci sama ditolak |
| AC08 | Fixture AD01 pada §7 | Distribusi, penyebut, total, dan CSV cocok dengan hitungan manual |
| AC09 | Ekspor jawaban teks dengan koma, baris baru, dan awalan formula | File terbaca, hak kolom diterapkan, teks aman, nilai asli di basis data utuh |
| AC10 | Layanan terputus | Alur mandiri berjalan; pengiriman status dapat diulang tanpa membuat respons kedua |
| AC11 | Formulir responden dari ponsel dan keyboard | Pengguna dapat membaca skala, memperbaiki validasi, meninjau, dan menerima bukti; label, kontras, pesan validasi, dan fokus keyboard terverifikasi |
| AC12 | Bukti pendukung (studi kasus) dan pencabutan simulasi | Permintaan ditangani sesuai status, akses diaudit, log bebas jawaban dan kredensial; token dicabut ditolak; unduhan tanpa izin ditolak; penarikan dan penghapusan data sintetis tercatat |
| AC17 | `consent_required` per survei | Survei organisasi `wajib_upload` menolak persetujuan tanpa bukti dan menerima pernyataan sendiri + bukti; survei personal menolak `wajib_upload` dengan 422; badge pengantar memakai istilah netral |
| AC18 | Rumah per peran | `org_admin` mendarat di `/admin/org`, super admin di `/admin`, creator di `/creator`; sidebar `org_admin` menyorot tepat satu entri untuk `/admin/org`, `/admin/org/evidence`, dan `/creator` |
| AC13 | 30 kiriman serentak, 20 item per kiriman | p95 waktu server dari penerimaan hingga bukti commit ≤3 detik; 30 ID respons unik dan 600 jawaban sah lengkap; catat lingkungan dan tidak ada kehilangan/duplikasi |
| AC14 | Konsumen Modul 15 simulasi | Pencocokan ID dan pembacaan skema berhasil tanpa nama atau token; catatan uji menyebut simulasi; CSV/kodebook terbaca di spreadsheet dan nilai asli diperiksa |
| AC15 | Penanganan risiko operasional | Catatan uji restore, penanganan penghapusan setelah restore, dan latihan insiden tersedia sebelum pilot |
| AC16 | Uji lapangan | Instrumen dan prosedur organisasi sudah ditetapkan (pada studi kasus: sekolah); creator membuat instrumen yang ditelaah untuk tugas studi kasus (contoh: Figma); keterpahaman skala, keberhasilan kirim, dan rekonsiliasi CSV terdokumentasi; hasil aktual dicatat setelah pengisian responden nyata; validitas instrumen dibuktikan terpisah |
| AC17 | Permukaan privasi | Notice tampil sebelum submit; `notice_version` tersimpan; submit diblokir jika persetujuan wajib belum lengkap; `/privacy` dan `/terms` serta kanal permintaan data dapat diakses tanpa login; log bebas jawaban dan token |

Simpan waktu, versi aplikasi, lingkungan, data masukan, hasil aktual, selisih dari target, dan tindakan perbaikan. Simpan bukti per langkah untuk alur dan akses. Untuk AC13 gunakan peserta berbeda dan item terisi penuh sehingga hasil yang diharapkan adalah 30 respons dan 600 jawaban. Tambahkan pengujian retry secara terpisah. Jangan menandai skenario lulus dari tampilan statis, atau mengisi data pengukuran contoh sebagai hasil nyata.

---

## 12. Urutan implementasi dan hasil serah terima

| Tahap | Pekerjaan | Hasil yang bisa diperiksa |
| --- | --- | --- |
| 1. Fondasi | Siapkan struktur proyek, migrasi, konfigurasi lingkungan, seed sintetis, autentikasi/role, dan pembatasan pemilik | Login creator A/B, daftar survei terisolasi, cara menjalankan dari basis data kosong |
| 2. Editor | Implementasikan draf, salin, Likert/teks, pratinjau, publikasi, dan versi tetap | Creator menerbitkan dua topik; versi lama dapat direproduksi |
| 3. Pengisian | Form publik, notice/consent, penugasan/kode, status kelayakan, tinjau, transaksi, dan bukti | Demo mandiri end-to-end; AC04–07, AC11, AC17, dan uji penolakan persetujuan |
| 4. Hasil | Dashboard agregat, ekspor aman, kodebook, audit akses, dan rekonsiliasi | Fixture dan CSV cocok, kontrol akses individual teruji |
| 5. Pertukaran data | Adapter Modul 13, event status, dan fixture konsumen Modul 15 | API simulasi dapat diuji ketika sistem luar tidak tersedia |
| 6. Evaluasi | Kinerja, kegagalan jaringan, restore, risiko sisa, pengujian seluler, dan dokumentasi | Laporan hasil aktual dan daftar masalah dengan bukti |
| 7. Pilot (studi kasus) | Tetapkan kebijakan dan instrumen dengan sekolah; lakukan uji responden (siswa pada studi kasus) saat prasyarat tersedia | Bukti penggunaan nyata dilaporkan terpisah dari demonstrasi |

### 12.1 Urutan kerja dan prasyarat

1. Rancang halaman creator, super admin, dan formulir seluler, ERD, undangan, otorisasi, dan kontrak CSV. Selaraskan token desain dengan Modul 13 bila tersedia.
2. Implementasikan alur mandiri dengan data sintetis. Uji versi, transaksi, skor, audit, akses, API simulasi, dan kinerja. Simpan bukti uji serta data masukan yang dapat direproduksi.
3. Sebelum pengisian responden (siswa pada studi kasus), tetapkan pihak berwenang, penilaian dampak, pemberitahuan, prosedur persetujuan, retensi, penerima data, dan kontak insiden. Tetapkan instrumen serta tugas studi kasus (contoh: Figma). Catat kesepakatan ID dan format dengan tim lain ketika tersedia.
4. Untuk laporan, pisahkan hasil uji perangkat lunak, hasil uji layanan simulasi, hasil integrasi nyata, dan temuan penggunaan oleh responden. Cantumkan batasan studi kasus serta ruang lingkup skoring yang disepakati.

**Paket serah terima MVP:** sumber dan migrasi yang dapat dijalankan ulang, petunjuk setup lokal, seed sintetis, konfigurasi contoh tanpa rahasia, skenario atau skrip uji, CSV serta kodebook contoh, kontrak integrasi dan batasannya, register risiko, serta catatan hasil pengujian. Cantumkan versi aplikasi yang menghasilkan setiap bukti.

**Instruksi awal untuk AI:** mulai dari tahap 1, verifikasi alur melalui antarmuka, lanjutkan sesuai prioritas P1, dan laporkan hasil setiap tahap dengan ID penerimaan yang sesuai. Pertahankan contoh Figma pada konfigurasi studi kasus agar sistem tetap generik.

---

## 13. Studi kasus dan konfigurasi contoh

Creator menetapkan objek "penggunaan Figma saat menyelesaikan tugas desain UI/UX".

- **AD01:** "Figma membantu saya menyelesaikan tugas desain yang diberikan."
- **TS01:** "Saya merasa terbebani ketika harus memakai beberapa fitur Figma untuk tugas tersebut."
- **K02:** isian opsional mengenai kendala.

Ketiganya adalah data contoh untuk uji perangkat lunak. Item lapangan, dimensi, label skala, dan sumber adaptasi menunggu penetapan instrumen.

Uji fleksibilitas memakai survei kedua dengan topik berbeda, skala empat opsi, dan komentar singkat. Verifikasi tidak ada label Figma, UI/UX, atau technostress yang tertanam dalam editor, formulir, dan ekspor generik.

---

## 14. Keputusan eksternal yang masih terbuka

| Keputusan | Pemilik yang perlu dilibatkan | Cara melanjutkan sekarang |
| --- | --- | --- |
| Instrumen, objek tugas Figma, dan sumber adaptasi | Tim capstone, pembimbing, dan sekolah | Gunakan item demonstrasi berlabel sintetis untuk pengembangan |
| ID/daftar peserta, autentikasi, dan endpoint Modul 13 | Tim Modul 13 dan 14 | Gunakan ID lokal, kode individual, dan adapter simulasi |
| Format skema nyata serta penerima terotorisasi Modul 15 | Tim Modul 14/15 dan pengendali | Penuhi kontrak CSV/fixture per versi; dokumentasikan pemetaan yang perlu disepakati |
| Penanggung jawab, kebutuhan bukti persetujuan per survei, akses individual, retensi, hosting, dan prosedur insiden | Sekolah dan pengendali yang ditetapkan | Pisahkan lingkungan sintetis; siapkan konfigurasi dan bukti uji sebelum data nyata |
| Alur bukti persetujuan: unggahan responden dan tinjauan `org_admin` | Pengendali dan sekolah | Responden mengunggah berkas (maks. 5 MB; JPG, PNG, WebP, PDF) atau mengisi referensi; status awal `self_attested`, lalu `verified`/`rejected` oleh `org_admin` dengan audit. Status tidak memblokir kiriman; retensi berkas belum ditetapkan |
| Relasi responden–organisasi (keanggotaan, kelas, unit kerja) | Pengendali dan tim modul | Roadmap, bukan MVP; memerlukan skema dan keputusan tujuan pemrosesan tersendiri |

Keputusan sekolah yang masih terbuka: pihak pengendali/prosesor dan kontak, siapa di sekolah yang berwenang memutuskan status bukti (alur unggah–tinjauan sudah tersedia), penerima individual, masa simpan per jenis data dan retensi berkas bukti, penanganan permintaan, lokasi hosting dan cadangan. Tinjau transfer lintas negara jika penyedia memproses data di luar Indonesia (Pasal 56 UU 27/2022).

Pengesahan tertulis perubahan matriks topik belum tersedia; bukti arahan pembimbing berupa transkrip. Instrumen studi kasus masih menunggu penetapan.

---

## 15. Sumber keputusan dan acuan normatif

**Sumber keputusan:** Matriks topik Modul 13–15; PRD v1.1 dan SRS v1.0 (23 Oktober 2026); transkrip bimbingan dan Spesifikasi v1.2 (5 November 2026); tujuh keputusan validasi tim (9 November 2026).

**Regulasi:** Republik Indonesia. Undang-Undang Nomor 27 Tahun 2022 tentang Pelindungan Data Pribadi, khususnya Pasal 4, 20–25, 34–39, 40–46, dan 56. Naskah resmi: https://peraturan.bpk.go.id/Details/229798/uu-no-27-tahun-2022

**Rujukan standar resmi:**

- ISO/IEC 25010:2023 — https://iso.org/standard/78176.html
- ISO/IEC/IEEE 12207:2026 — https://webstore.iec.ch/en/publication/113447
- ISO/IEC 27001:2022 — https://iso.org/standard/27001 · Amd 1:2024 — https://iso.org/standard/88435.html
- ISO/IEC 27701:2025 — https://webstore.iec.ch/en/publication/110123

---

## Lampiran A. Peta dokumen sumber

| Bagian sumber | Lokasi di dokumen ini |
| --- | --- |
| SRS: Keputusan ruang lingkup, dasar penyesuaian | §2 |
| SRS §1 Alur produk dan tanggung jawab | §3, §5 |
| SRS §2 Kebutuhan fungsional dan skoring | §4, §7 |
| SRS §3 Data dan kontrak integrasi | §6, §8 |
| SRS §4 Pelindungan data sepanjang siklus | §9 |
| SRS §5 Register risiko | §10.1 |
| SRS §6 Pengujian penerimaan dan insiden | §11, §9.2 |
| SRS §7 Studi kasus, urutan pelaksanaan, sumber | §13, §12.1, §15 |
| SRS §8 dan §8.1 Acuan serta bukti mutu | §10.2, §10.3 |
| PRD §1 Hasil, §2 Cara AI, §3 Aktor | §1, §0, §3 |
| PRD §4 Ruang lingkup, §5 Alur, §6 Data | §4, §5, §6 |
| PRD §7 Skoring, §8 API, §9 Keamanan | §7, §8, §9 |
| PRD §10 Risiko, §11 Uji, §12 Urutan | §10, §11, §12 |
| PRD §13 Keputusan terbuka | §14 |
