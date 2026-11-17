# Svara · Pembuat Survei Modul 14

> **Status: aplikasi antarmuka interaktif dengan penyimpanan lokal.** Data awal berasal dari fixture. Aksi seperti masuk, membuat draf, menyimpan editor, menerbitkan versi, membuat dan mencabut undangan, menyalin tautan, mengunduh CSV, menyimpan izin, serta mengulang event bekerja dan bertahan di `localStorage` peramban. Tidak ada API, basis data, autentikasi server, email, atau integrasi Modul 13/15 yang nyata.
>
> **Dokumen ini BUKAN bukti lulus AC01 sampai AC17.** Matriks di bawah memetakan *tampilan* state, bukan hasil uji penerimaan. Tidak ada metrik kinerja, hasil uji lapangan, atau klaim kepatuhan yang dilaporkan di sini.

Sumber kebenaran:

| Dokumen | Peran |
| --- | --- |
| `PRD.md` | Perilaku produk, aturan data, izin, batas MVP |
| `DESIGN.md` | Warna, tipografi, spacing, radius, shadow, pola komponen |

Kedua dokumen tidak diubah. `passport-design-system.md` adalah lampiran ekstraksi sumber desain, bukan acuan implementasi.

**Verifikasi yang benar-benar dijalankan:** `pnpm lint`, `pnpm typecheck`, `pnpm build` lulus; `pnpm dev` dan `pnpm preview` membuka seluruh rute tanpa error konsol; visual diperiksa pada 390px dan 1440px tanpa overflow horizontal; alur klik login, buat draf, simpan, terbitkan, salin, cabut, unduh CSV, simpan izin, ulang event, kirim jawaban, dan keluar diuji di browser. Ini bukan hasil uji kinerja, integrasi nyata, atau uji lapangan.


---

## 1. Cara menjalankan

```bash
pnpm install
pnpm dev          # http://localhost:5173
pnpm preview      # setelah pnpm build
pnpm lint
pnpm typecheck
pnpm build
```

| Script | Isi |
| --- | --- |
| `dev` | `vite` |
| `build` | `tsc --noEmit && vite build` |
| `preview` | `vite preview` |
| `typecheck` | `tsc --noEmit` |
| `lint` | `eslint .` |
Stack: Vite 7, React 19, TypeScript `strict`, Tailwind CSS v4 (`@tailwindcss/vite`, CSS-first `@theme`), React Router v7 (`react-router-dom`), font `@fontsource-variable/inter` dan `@fontsource-variable/jetbrains-mono`. Tidak ada `tailwind.config.js`, tidak ada direktif `@tailwind`, tidak ada Next.js, tidak ada library UI tambahan.

`pnpm-workspace.yaml` memuat `allowBuilds: esbuild: true` dan `onlyBuiltDependencies` agar pnpm 11 menjalankan postinstall `esbuild` dan `@tailwindcss/oxide`. Ini hanya konfigurasi paket, bukan kredensial.


### Pemetaan token ke `@theme`

Semua token di `src/index.css` berasal dari `DESIGN.md` §Quick Start. Tidak ada token baru.

- Warna: `--color-n0` sampai `--color-n800`, `--color-dark`, `--color-action*`, `--color-danger*`, `--color-success*`, `--color-warning-soft`, `--color-analytic*`, `--color-usp-text`.
- Tipografi: `--font-sans` = Inter Variable, `--font-mono` = JetBrains Mono Variable, `--text-display/h1/h2/h3/body/body-sm/caption/annotation` beserta `--*-line-height`.
- Spacing: `--spacing: 4px` menjadi pengali, sehingga `p-1` = 4px (`--space-0`), `p-2` = 8px (`--space-1`), `p-3` = 12px, `p-4` = 16px, `p-6` = 24px, `p-8` = 32px, `p-12` = 48px, `p-16` = 64px, `p-24` = 96px, `p-32` = 128px. Ini skala 8px yang sama dengan `DESIGN.md` §Spacing.
- Radius: `--radius-none/sm/md/lg/full` = 0/4/8/16/999px.
- Shadow: `--shadow-raised` dan `--shadow-overlay` = level 01 dan 02.
- Global: `:focus-visible` 3px aksen, target minimum 44px, `prefers-reduced-motion`, `scroll-padding-block-start` untuk header sticky.

---

## 2. Peta rute

Semua tautan memakai `ROUTES` di `src/lib/routes.ts`. `:id` dan `:token` memakai nilai fixture. Rute `*` menangani 404.

| # | Rute | Layar | `routeId` |
| --- | --- | --- | --- |
| 1 | `/` | Landing produk: hero, kemampuan inti, persetujuan, alur kerja, dua konfigurasi contoh, FAQ, penutup | `home` |
| 2 | `/auth/login` | Login pengelola/siswa | `login` |
| 3 | `/creator` | Daftar survei | `creator-list` |
| 4 | `/creator/surveys/:id/edit` | Editor instrumen | `creator-edit` |
| 5 | `/creator/surveys/:id/preview` | Pratinjau | `creator-preview` |
| 6 | `/creator/surveys/:id/publish` | Publikasi | `creator-publish` |
| 7 | `/creator/surveys/:id/share` | Bagikan | `creator-share` |
| 8 | `/creator/surveys/:id/results` | Hasil per versi | `creator-results` |
| 9 | `/creator/surveys/:id/settings` | Pengaturan dan notice | `creator-settings` |
| 10 | `/creator/surveys/:id/history` | Riwayat versi | `creator-history` |
| 11 | `/s/:token` | Pengantar dan notice | `respondent-intro` |
| 12 | `/s/:token/form` | Formulir | `respondent-form` |
| 13 | `/s/:token/review` | Tinjau | `respondent-review` |
| 14 | `/s/:token/receipt` | Bukti | `respondent-receipt` |
| 15 | `/admin` | Ringkasan | `admin-summary` |
| 16 | `/admin/accounts` | Akun dan izin | `admin-accounts` |
| 17 | `/admin/audit` | Log audit | `admin-audit` |
| 18 | `/admin/integration` | Status Modul 13/15 | `admin-integration` |
| 19 | `/privacy` | Kebijakan privasi (tanpa login) | `privacy` |
| 20 | `/terms` | Ketentuan layanan (tanpa login) | `terms` |
| `*` | lainnya | 404 dengan tautan pulang | `notfound` |

Rute akun publik (`/auth/register`, `/auth/verify`, `/auth/forgot`, `/auth/reset`) **sengaja tidak dibangun**: F-01 hanya mewajibkan login pengelola dan tidak ada screen-map yang menyertai perluasan scope.

Nilai contoh untuk tautan: `:id` = `s_demo1` atau `s_demo2`; `:token` = `link-umum-demo` atau `undangan-demo`.

---

## 3. Daftar fixture

Dua set memakai **komponen yang sama**. Kode item dan nama studi kasus hanya ada di `src/lib/fixtures/*` dan halaman contoh (`/`), tidak pernah di komponen generik.

| Set | `DeploymentProfile` | Survei | Instrumen | Consent |
| --- | --- | --- | --- | --- |
| 1 · SMK / Figma | `organization_type=school`, `respondent_age_category=minor`, `consent_mode=guardian`, `retention_days=null`, `data_request_contact=null`, `cross_border_transfer=null` | `s_demo1` | Likert 1 sampai 5 pada AD01 dan TS01, isian singkat opsional K02 | Wajib bukti wali |
| 2 · Perpustakaan | `organization_type=organization`, `respondent_age_category=adult`, `consent_mode=self`, `retention_days=90`, `data_request_contact` kontak sintetis, `cross_border_transfer=false` | `s_demo2` | Skala 4 opsi pada P01 dan P02, komentar singkat opsional K01 | Persetujuan diri |

Nilai yang belum ditetapkan pengendali ditampilkan dengan bahasa netral pada pengaturan; tidak ada kebijakan organisasi rekaan.

Tipe di `src/lib/types.ts`: `DeploymentProfile`, `Survey`, `SurveyVersion`, `Question`, `QuestionOption`, `Assignment`, `Invitation`, `Response`, `ConsentRecord`, `AuditLog`, plus `Answer`, `Account`, `AccessGrant`, `IntegrationEvent`, `Notice`.

Fixture agregat mengikuti PRD §7: 5 respons final, nilai AD01 = 2, 4, 4, 5, kosong. Ringkasan dihitung dari fixture oleh `src/lib/summary.ts` (bukan angka hardcode): total 5, terjawab 4, dilewati 1, frekuensi opsi 1 sampai 5 = 0, 1, 0, 2, 1.

### Perilaku interaktif

`src/lib/store.ts` menyimpan perubahan di `localStorage` dan menyinkronkan koleksi fixture di tempat, sehingga `findSurvey`, `questionsFor`, dan `computeSummary` tetap membaca data terkini. Komponen berlangganan lewat `useSyncExternalStore`; umpan balik aksi memakai `ToastProvider`.

| Aksi | Hasil yang terlihat |
| --- | --- |
| Masuk / keluar | Nama akun dan peran tampil di header; sesi bertahan saat halaman dimuat ulang |
| Buat draf baru | Survei, versi draf, dan item salinan dibuat; langsung membuka editor |
| Simpan draf | Judul dan kode item tersimpan, dengan cap waktu |
| Terbitkan versi | Status berubah, tautan responden baru dibuat dan ditampilkan |
| Salin tautan | URL absolut ditulis ke papan klip; tombol berubah menjadi "Tersalin" |
| Buat / cabut undangan | Baris baru muncul; status berubah menjadi "Dicabut" |
| Tutup versi / arsipkan | Status versi dan survei diperbarui, riwayat tetap terbaca |
| Unduh CSV | File CSV UTF-8 nyata diunduh per versi, dengan header kode item |
| Simpan pengaturan / izin | Nilai tersimpan dan dipakai ulang saat halaman dibuka |
| Ulangi event | Jumlah percobaan bertambah dengan ID kejadian tetap |
| Kirim jawaban | Bukti ditampilkan; retry memulihkan bukti yang sama |

Reset ke data awal: hapus kunci `svara.workspace.v1` dari `localStorage` peramban.


---

## 4. Matriks layar × state

Legenda kolom: **D** default · **E** empty · **SE** search-empty (hasil cari kosong) · **L** loading · **X** error · **V** validation · **P** permission-denied · **C** closed · **EX** expired · **R** revoked · **K** conflict (409) · **NA** no-answers ("Belum ada jawaban") · **S** success.

`●` = state tersedia dan punya perlakuan tampilan yang berbeda. `·` = tidak relevan, jatuh ke default.

| Layar (`routeId`) | D | E | SE | L | X | V | P | C | EX | R | K | NA | S |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `home` | ● | ● | · | ● | ● | · | · | · | · | · | · | · | · |
| `login` | ● | · | · | ● | ● | ● | ● | · | ● | ● | · | · | ● |
| `creator-list` | ● | ● | ● | ● | ● | · | ● | ● | · | · | · | · | ● |
| `creator-edit` | ● | ● | · | ● | ● | ● | ● | · | · | · | · | · | ● |
| `creator-preview` | ● | ● | · | ● | ● | ● | ● | ● | ● | · | · | · | ● |
| `creator-publish` | ● | · | · | ● | ● | ● | ● | ● | · | · | · | · | ● |
| `creator-share` | ● | ● | · | ● | ● | ● | ● | ● | ● | ● | · | · | ● |
| `creator-results` | ● | ● | · | ● | ● | · | ● | ● | · | · | · | ● | ● |
| `creator-settings` | ● | · | · | ● | ● | ● | ● | · | · | · | · | · | ● |
| `creator-history` | ● | ● | · | ● | ● | · | ● | ● | · | · | · | · | ● |
| `respondent-intro` | ● | · | · | ● | ● | ● | ● | ● | ● | ● | · | · | ● |
| `respondent-form` | ● | · | · | ● | ● | ● | ● | ● | ● | ● | · | · | ● |
| `respondent-review` | ● | · | · | ● | ● | ● | ● | ● | ● | ● | ● | · | ● |
| `respondent-receipt` | ● | · | · | ● | ● | · | · | · | · | · | ● | · | ● |
| `admin-summary` | ● | ● | · | ● | ● | · | ● | · | · | · | · | · | · |
| `admin-accounts` | ● | ● | · | ● | ● | ● | ● | · | · | · | · | · | ● |
| `admin-audit` | ● | ● | · | ● | ● | · | ● | · | · | · | · | · | · |
| `admin-integration` | ● | · | · | ● | ● | · | ● | · | · | · | ● | · | ● |
| `privacy` | ● | · | · | ● | ● | · | · | · | · | · | · | · | · |
| `terms` | ● | · | · | ● | ● | · | · | · | · | · | · | · | · |
| `notfound` | ● | · | · | · | · | · | · | · | · | · | · | · | · |

Cakupan minimum yang diminta: `default`, `empty`, `loading`, `error`, `validation`, `permission-denied`, `closed`, `expired`, `revoked`, `conflict`, `no-answers` semuanya hadir pada layar yang relevan.

### Detail perlakuan per state

| State | Perlakuan tampilan | Dampak pada aksi utama |
| --- | --- | --- |
| `default` | Konten fixture normal | Aktif |
| `empty` | `EmptyState` dengan penjelasan dan tautan aksi | Aksi utama diganti ke tautan pembuat |
| `search-empty` | `EmptyState` khusus pencarian, kata kunci ditampilkan | Tetap bisa menghapus filter |
| `loading` | Skeleton baris dan `aria-busy` | `disabled` + spinner |
| `error` | `ErrorState` pesan umum, tanpa rincian basis data | `disabled` + tautan muat ulang |
| `validation` | Ringkasan kesalahan, penanda dekat item, nilai isian tetap | `disabled` sampai diperbaiki |
| `permission-denied` | Panel "Akses ditolak", tanpa jawaban individual | `disabled` |
| `closed` | Banner "Versi ditutup" + waktu penutupan | `disabled` + pesan jelas |
| `expired` | Banner "Tautan kedaluwarsa" | `disabled` + pesan jelas |
| `revoked` | Banner "Undangan dicabut" | `disabled` + pesan jelas |
| `conflict` | Panel 409, tautan "Pulihkan bukti" ke bukti yang sama | Kirim baru `disabled`, pulihkan aktif |
| `no-answers` | "Belum ada jawaban" pada tiap item, penyebut tidak dibagi nol | Ekspor `disabled` |
| `success` | Banner sukses + tautan hasil/bukti | Aksi lanjutan aktif |

---

## 5. Cara memaksa state

```
/creator/surveys/s_demo1/results?state=no-answers
/s/undangan-demo/form?state=revoked
/admin/integration?state=error
```

- Query `?state=<kode>` dibaca `ScreenStateProvider`. Kode tidak dikenal atau tidak termasuk daftar layar jatuh ke `default`.
- `StateLink` meneruskan `?state=` antarhalaman sehingga satu skenario bisa diikuti dari awal sampai akhir.
- **State switcher hanya dirender saat `import.meta.env.DEV`**, dan diciutkan menjadi `<details>` berlabel "Mode pengembangan" di kaki halaman. Tidak ada kontrol debug pada build produksi (`pnpm build` / `pnpm preview`).
- Daftar state yang diizinkan per layar ada di `ROUTE_STATES` dalam `src/lib/state.tsx`, sama persis dengan matriks di atas.

---

## 6. Peta aturan perilaku ke layar

| Aturan | Tempat terlihat |
| --- | --- |
| Pratinjau tidak menambah respons, statistik, atau ekspor | `creator-preview` banner "Data pratinjau tidak disimpan"; `creator-results` catatan bahwa pratinjau tidak dihitung |
| Form terbuka tetap memakai versi lama | `respondent-form` banner "Versi 1 terkunci untuk formulir ini"; `creator-history` catatan A tetap ke A |
| Versi ditutup, tautan kedaluwarsa, undangan dicabut | `state=closed/expired/revoked` pada form, tinjau, intro: submit `disabled` + pesan |
| Consent wajib | `respondent-intro`: checkbox persetujuan mengontrol tombol lanjut |
| Guardian mode butuh bukti wali | `respondent-intro` set 1: status bukti wali harus "Terverifikasi (simulasi)" |
| Status undangan individual | `creator-share`: aktif, terpakai, dicabut, kedaluwarsa |
| Tautan umum tidak mengklaim satu respons per orang | `creator-share`: teks eksplisit bahwa tautan umum menjamin idempotensi kiriman, bukan identitas unik |
| Total, terjawab, dilewati, frekuensi, opsi nol tetap tampil | `creator-results`: tabel `src/lib/summary.ts` |
| Ekspor diizinkan vs ditolak, teks bebas hanya penerima berizin | `creator-results` state `success` vs `permission-denied` |
| `/privacy` dan `/terms` dari footer, intro, bukti | `PolicyLinks` dipakai di ketiganya |
| Tanpa token, isi jawaban, atau kredensial di log/audit | `admin-audit`: kolom hanya aktor, aksi, objek, hasil, waktu |
| Tombol utama punya `disabled`/`loading` | `Button` dan `ActionLink` di `src/components/ui.tsx` |

Nilai formulir yang diketik disimpan di `sessionStorage` lokal supaya tinjauan dan bukti bisa diikuti dengan klik. Ini bukan penyimpanan server.

---

## 7. Alasan keputusan visual

Design Read: konsol internal pembuat survei plus formulir seluler, kanvas netral satu aksen biru, **ENERGY 1 / RHYTHM 1 / MOTION 1**.

| Keputusan | Alasan satu baris |
| --- | --- |
| Kanvas putih, teks `#303135`, satu biru `#0064D2` | DESIGN.md menetapkan aksen tunggal secara fungsional, bukan dekoratif. |
| Biru hanya pada satu aksi utama per layar | Memudahkan creator tahu tindakan yang mengubah data. |
| Inter Variable untuk UI, JetBrains Mono untuk kode | Keterlacakan adalah inti produk, dan mono membedakan kode item dari prosa. |
| Kode versi dan kode item dalam mono sebagai motif identitas | Diulang di editor, hasil, ekspor, dan bukti sehingga terasa milik produk ini. |
| Tabel dan baris data, bukan kartu grid fitur | Isi produk memang data survei, bukan materi pemasaran. |
| Radius 4/8/16/999 px bertingkat | Hirarki kontrol kecil, input, kartu, dan status mengikuti DESIGN.md. |
| Shadow hanya pada panel yang benar-benar melayang | DESIGN.md membatasi elevation ke tiga level. |
| Tanpa ikon generik, tanpa ilustrasi | Alat data tidak butuh dekorasi; status disampaikan oleh teks dan warna yang lolos kontras. |
| Header sticky + `scroll-padding-block-start` | Anchors dan fokus tidak tertutup header saat formulir panjang di 390px. |
| MOTION 1, `prefers-reduced-motion` | Hanya hover dan spinner yang bergerak; DESIGN.md mewajibkan penghormatan preferensi. |

Tidak ada statistik, testimoni, klaim keamanan, atau badge pemasaran. Semua angka berasal dari fixture yang bisa dihitung ulang.

---

## 8. Batasan dan langkah berikutnya

**Gap yang memang disengaja:**

1. Tidak ada backend. Kiriman, pencabutan, publikasi, dan ekspor hanya mengubah state lokal atau berpindah rute.
2. Idempotensi, transaksi atomik, dan batasan unik (PRD §6.1, AC04 sampai AC07) belum dapat dibuktikan tanpa server.
3. Kinerja 30 kiriman serentak (AC13), uji lapangan (AC16), dan prosedur insiden (AC15) berada di luar preview statis.
4. Teks notice, retensi, kontak, dan bukti wali memakai placeholder sintetis sampai pengendali menetapkan (PRD §14).
5. Kontrak Modul 13/15 hanya berupa status simulasi pada `/admin/integration`.
6. `/privacy` dan `/terms` memakai template generik berlabel sintetis, bukan teks legal yang disahkan.

**Langkah berikutnya setelah preview disetujui:** tentukan instrumen dan pengendali (§14), lalu bangun tahap 1 sampai 4 PRD §12 dengan backend nyata sebelum mengklaim AC apa pun.
