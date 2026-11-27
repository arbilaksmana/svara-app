# Bukti visual — dashboard Ringkasan admin (gaya shadcn)

Diambil dari worktree `admin-dashboard-shadcn-2` pada dev server terisolasi
(`next dev -p 4100`, API `:4101`, database `svara_admin2` di container `svara-app-db-1`)
dengan data seed demo + 18 respons historis tambahan (Jun–Okt 2026) di database uji
itu saja, supaya grafik 6 bulan dan badge tren terisi nyata.

App belum punya mode gelap; halaman admin hanya dirender terang, termasuk saat OS memakai
`prefers-color-scheme: dark`.

Chrome admin (sidebar + header) kini dipakai keenam halaman; pill lama hanya bertahan
di luar `/admin`.

| Berkas | Isi |
| --- | --- |
| `ringkasan-desktop-1440-light.png` | `/admin` desktop 1440 — empat kartu KPI (label + angka saja), tren 6 bulan dengan pemilih rentang, tabel per pembuat/survei |
| `akun-izin-desktop-1440-light.png` | `/admin/accounts` desktop — tabel akun, peran, organisasi, 6 akun seed |
| `profil-platform-desktop-1440-light.png` | `/admin/platform` desktop — kartu profil platform |
| `log-audit-desktop-1440-light.png` | `/admin/audit` desktop — filter + DataTable, 40 entri operasional |
| `integrasi-desktop-1440-light.png` | `/admin/integration` desktop — kartu event, 3 event simulasi |
| `permintaan-data-desktop-1440-light.png` | `/admin/requests` desktop — kartu permintaan menunggu (1 permintaan seed) |
| `log-audit-tablet-768-light.png` | `/admin/audit` tablet 768 — tabel 6 kolom muat tanpa geser, petunjuk geser tersembunyi |
| `ringkasan-mobile-390-light.png` | `/admin` mobile 390, halaman penuh |
| `ringkasan-mobile-390-drawer-light.png` | Mobile 390, drawer navigasi terbuka |
| `akun-izin-mobile-390-light.png` | `/admin/accounts` mobile 390, halaman penuh (daftar kartu, tabel hanya ≥1024px) |
| `audit-mobile-390-light.png` | `/admin/audit` mobile 390 — tabel menggeser + petunjuk geser tampil |
| `admin-accounts-desktop-1440-pill-light.png` | Pembanding sebelum restyle: `/admin/accounts` masih pill + sidebar lama |
| `admin-accounts-mobile-390-pill-light.png` | Pembanding sebelum restyle: `/admin/accounts` mobile, pill lama |
| `creator-desktop-1440-pill-light.png` | Pembanding: `/creator` tidak berubah |
| `responden-desktop-1440-pill-light.png` | Pembanding: tautan publik responden tidak berubah |

Yang diuji lewat browser pada halaman Ringkasan mobile 390:

- Tombol menu membuka drawer (`aria-expanded=true`, `role="dialog"`, `aria-modal="true"`),
  body terkunci (`overflow: hidden`), Escape menutup dan mengembalikan fokus.
- Menavigasi ke "Akun & izin" dari drawer menutup drawer, membuka kunci body, dan halaman
  tujuan merender chrome baru (`nav[aria-label="Navigasi admin"]`).
- Menu akun di footer drawer memuat "Keluar"; menekannya keluar sesi (cookie hilang)
  dan mengarahkan ke landing.
- Data table: klik header mengubah `aria-sort`, toggle "Kolom" menyembunyikan kolom,
  pagination dan pilihan baris per halaman berfungsi.
- Kartu KPI sengaja hanya label + angka: tanpa lencana tren, keterangan kaki kartu, dan tautan
  "Buka permintaan". Diukur di 1440: keempat kartu 106px, teks kartu `label | angka`.
- Chevron pemilih rentang menghadap ke atas selama daftar terbuka dan kembali ke bawah setelah
  fokus hilang/nilai berubah/Escape (dicek di DOM: `rotate-180` benar saat fokus, `none` setelahnya).
- Pemilih rentang grafik "Tren respons" selalu tampil. Selama server belum mengirim `chart`
  (kondisi server saat ini), kartu menampilkan agregat bulanan beserta keterangan eksplisit dan
  pilihan 6 bulan; di mode preview `chart` mengikuti rentang dan keterangan hilang.

Kontras batas kontrol (UIX-14): `<input>` dan `<select>` memakai token
`--color-control-border` (`#8d919c`, 3,15:1 terhadap `--color-n0`) sesuai tabel token
`DESIGN.md`, bukan `--color-n300` dengan kontras 1,4:1.

Skala tipografi: `cn()` (tailwind-merge) tidak mengenal ukuran kustom `text-caption`,
`text-body-sm`, dan seterusnya, jadi kelas itu terhapus setiap kali berdampingan dengan kelas
warna `text-[color:var(--ad-…)]` — teks membesar satu langkah (badge dan header tabel 16px,
bukan 12px). `src/lib/utils.ts` kini mendaftarkan ukuran DESIGN.md sebagai kelompok `font-size`,
dan warna ditulis dengan petunjuk `color:`. Diukur di DOM: badge, `<th>`, keterangan baris, dan
tombol pagination kembali 12px; warna teks tetap.

Petunjuk geser tabel tidak lagi memakai ambang viewport: `useOverflowX` (ResizeObserver pada
kontainer geser) menampilkan petunjuk hanya saat `scrollWidth > clientWidth`, dan `min-w` tabel
dihitung dari kolom yang **terlihat**, bukan semua kolom. Menyembunyikan kolom lewat menu
"Kolom" di 390px: tabel 4 kolom (544px) menggeser + petunjuk; setelah tinggal 3 kolom `min-w`
hilang (0px), tabel muat, petunjuk hilang. Diukur juga:
`/admin/audit` 768px muat → petunjuk tidak ada; 700px dan 390px menggeser → petunjuk ada;
`/admin/accounts` 1024px menggeser (sidebar 256px) → petunjuk ada, 900px muat → tidak ada.

Ukuran target sentuh: select, tombol (default/sm/icon), item dropdown, header tabel yang bisa
diurutkan, dan tautan navigasi admin semuanya ≥44px. Diukur di DOM 390px: tidak ada kontrol
interaktif di bawah 44px selain tautan lompat-ke-konten yang memang `sr-only`.

Glif urut netral memakai `--ad-icon-low` (`#686b74`, 5,2:1) menggantikan `opacity-50` yang
hanya 2,1:1, sehingga tetap ≥3:1 sebagai grafik.

Chrome admin tidak lagi berkedip pill: pada muat keras `/admin/requests` 390px, sampel DOM
pertama (50 ms) sudah memuat `nav[aria-label="Navigasi admin"]` dan pill lama tidak pernah
muncul (`ready` dari store dipakai sebelum peran diketahui).
