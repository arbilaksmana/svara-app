# 10 — Retensi, penghapusan, dan hak subjek data

- Baseline: `95eafa3cb38aac4dd32963a1ec584a2ce6821f25`.
- Sumber: `PRD.md` (F-18, F-19, §9.1, R5, keputusan F-18), `README.md` (batasan), `src/screens/Public.tsx`, `server/routes/public.ts`, `server/routes/admin.ts`, migrasi, seed.
- Metode: pembacaan source + dua permintaan data sintetis pada `svara_audit_sec`; tidak ada data pribadi nyata dan tidak ada uji penghapusan terhadap data pengguna.

## 1. Janji produk

- `PRD.md` (F-18) menetapkan pertukaran minimal antara ID internal, `assignment_id`, dan identitas untuk integrasi, dengan pemisahan metadata dari jawaban.
- `PRD.md` (F-19) meminta permintaan akses/koreksi/penarikan/penghapusan beserta status dan tindak lanjut.
- `PRD.md` (R5/§9.1) menyebut retensi per kelas data dan bukti tindakan.
- Halaman `/privacy` menyatakan: akses, koreksi, penarikan, dan penghapusan melalui kanal resmi pengendali dengan verifikasi pemohon; tindak lanjut dicatat tanpa jawaban atau token; masa simpan mengikuti kebijakan pengendali pada pemberitahuan survei.

Ketiga sumber tersebut menetapkan poke yang cukup untuk dinilai secara teknis, bukan kepatuhan hukum.

## 2. Yang ditemukan

| Area | Temuan | Severity | Bukti |
|---|---|---|---|
| Penyimpanan permintaan | `POST /api/v1/public/data-requests` menyimpan `contact` (email/nomor) dan `note` (hingga 2000 karakter) tanpa verifikasi identitas dan tanpa jalur pembuangan yang dijalankan. Permintaan dapat dibuat siapa pun hingga 10/jam/IP. | High (privasi/penipuan) | `server/routes/public.ts:703-738`; `evidence/sec/runtime-data-requests.json`; `evidence/sec/runtime-data-request-storage.txt` (4 baris, 4 kontak, 3 catatan) |
| Audit permintaan | Audit hanya menyimpan `type`; contact/note tidak masuk audit. Ini sesuai janji “tanpa jawaban/token”, tetapi nomor/email tetap data pribadi baru di tabel `data_requests`. | Medium | `runtime-data-request-storage.txt`: `audit_with_contact_pattern|0` |
| Verifikasi pemohon | Form hanya menerima “Kontak terverifikasi”; tidak ada OTP, tanda terima rahasia, atau pencocokan ke responden sebelum data dikirim/dihapus. | High | `src/screens/Public.tsx:253-260`; tidak ada endpoint verifikasi lanjutan di `public.ts` |
| Tindak lanjut | `PATCH /admin/data-requests/:id` mengubah `status`, `outcome_note`, `handled_by`, `updated_at` dan menulis audit, jadi jejak keputusan dasar ada. Yang tidak ada: verifikasi pemohon sebelum tindakan, resolusi yang mengikat ke baris respons/koreksi, dan mekanisme penghapusan aktual. | Medium–High | `server/routes/admin.ts:502-524`; skema `data_requests` |
| Kanan penghapusan vs backup | Uji restore lokal mengembalikan respons yang sudah dihapus; audit pasca-restore dapat ditambahkan (terbukti di `evidence/ops/ac15-restore-runtime.log`) tetapi tidak ada mekanisme yang menandai penghapusan sebagai wajib-replay ke setiap salinan, jadi penghapusan menyeluruh belum terbukti. | High (untuk pilot dengan data nyata) | `07-operations.md` §2 |
| Penghapusan secara otomatis | `retention_days` tersimpan di org/platform tetapi tidak ada job/endpoint yang mengeksekusi retensi per kelas data. | High | `server/routes/org.ts` (profil), tidak ada scheduler; `07-operations.md` |
| Penghapusan respons | Tidak ada jalur untuk menghapus/menganonimkan respons meskipun masih dalam retensi; tidak ada endpoint admin/data untuk itu. Hal ini belum tentu cacat jika kebijakan menyimpan semua respons sampai kontrak berakhir, tetapi belum diputuskan. | Decision needed | `PRD.md` F-18/F-19; tidak ada route |
| Kontak pengendali | `/privacy` mengarahkan ke kontak pada pemberitahuan; notifikasi seed berisi placeholder (“Lihat pemberitahuan survei”), dan `/public/policy` memakai placeholder `privasi@organisasi.contoh`. | Medium | `src/screens/Public.tsx:179`; `server/seed-data.ts:144`; `server/routes/public.ts:686-693` |
| Akses pemohon | Tidak ada endpoint untuk memeriksa status permintaan berdasarkan ID + rahasia; respons hanya memberi `id` tanpa jalur pemeriksaan publik yang aman. | Medium | `public.ts:731-738` |
| Minimisasi | `contact` disimpan verbatim dan ditampilkan ke admin (UI/UX 04); tidak ada pembatasan format, deduplikasi, atau enkripsi level kolom. | Medium | `public.ts:711-722` |

## 3. Batasan dan keputusan yang masih terbuka

1. Apakah permintaan data akan memerlukan verifikasi identitas berbasis OTP/email sebelum data dikeluarkan atau dihapus? Dari sudut keamanan, ini prasyarat untuk melayani permintaan yang berdampak.
2. Apakah `data_requests.contact` dianggap data pribadi yang boleh disimpan mentah, atau harus di-hash/dibersihkan setelah tindak lanjut?
3. Berapa masa simpan per kelas (jawaban, metadata, audit, consent, data request, backup) dan siapa pemilik job retensi?
4. Apakah penghapusan harus menghapus baris respons, atau cukup anonimkan `respondent_id`/teks sambil mempertahankan agregat?
5. Apakah backup off-site/immutable termasuk cakupan kebijakan; berapa RPO/RTO dan siapa yang mengeksekusi replay penghapusan?
6. Siapa pengendali untuk setiap survei (organisasi) vs platform, dan siapa contact point yang wajib diisi sebelum data nyata?
7. Apakah hook Modul 13/15 (hubungan integrasi yang belum selesai) dapat menerima permintaan koreksi/penghapusan dan siapa yang menjamin konsistensinya?

## 4. Rekomendasi minimum

- **P0:** sebelum pilot, tetapkan verifikasi pemohon (OTP/email ke kontak yang dapat diverifikasi atau tanda terima rahasia), endpoint status permintaan yang aman, jejak keputusan yang melengkapi `handled_by`/`outcome_note` yang sudah ada (`decision`, `resolution`, `responded_at`), serta retensi terjadwal dengan audit.
- **P0:** ganti placeholder kontak pada profil/platform dengan field wajib; validasi format email/telepon; tampilkan pada notifikasi dan `/privacy`.
- **P1:** bedakan data permintaan publik yang belum terverifikasi (TTL pendek, misalnya 30 hari tanpa tindak lanjut) dari data yang sudah diverifikasi; redaksi/hapus catatan setelah ditangani.
- **P1:** dokumentasikan prosedur restore + replay penghapusan dan uji terhadap salinan database tiruan; laporkan hasilnya sebagai bukti retensi.
- **Decision needed:** definisi penghapusan versus anonimisasi, termasuk dampak pada ringkasan agregat dan ekspor yang sudah terlanjur diunduh.

## 5. Keterbatasan bukti

- Dua permintaan sintetis dibuat; tidak ada pengujian alur verifikasi atau penghapusan karena fitur tersebut tidak ada.
- Uji restore memperlihatkan sifat snapshot, bukan prosedur operasional penyedia/managed database, off-site, enkripsi, atau kebijakan retensi cloud.
- Tidak ada wawancara pemilik kebijakan/legal; semua keputusan yang menyangkut kewajiban dan pemrosesan data tetap terbuka.
- Bukti TTL/retensi otomatis tidak dapat diuji karena tidak ada job untuk dipicu.
