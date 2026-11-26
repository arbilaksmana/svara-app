# Bukti visual — dashboard Ringkasan admin (gaya shadcn)

Diambil dari worktree `admin-dashboard-shadcn-2` pada dev server terisolasi
(`next dev -p 4100`, API `:4101`, database `svara_admin2` di container `svara-app-db-1`)
dengan data seed demo + 18 respons historis tambahan (Jun–Okt 2026) di database uji
itu saja, supaya grafik 6 bulan dan badge tren terisi nyata.

| Berkas | Isi |
| --- | --- |
| `ringkasan-desktop-1440-light.png` | `/admin` desktop 1440, tema terang |
| `ringkasan-desktop-1440-dark.png` | `/admin` desktop 1440, tema gelap (`prefers-color-scheme: dark`) |
| `ringkasan-mobile-390-light.png` | `/admin` mobile 390, halaman penuh |
| `ringkasan-mobile-390-drawer-light.png` | Mobile 390, drawer navigasi terbuka |
| `ringkasan-mobile-390-drawer-dark.png` | Mobile 390, drawer terbuka, tema gelap |
| `admin-accounts-desktop-1440-pill-light.png` | Pembanding: `/admin/accounts` masih pill + sidebar lama |
| `admin-accounts-mobile-390-pill-light.png` | Pembanding: `/admin/accounts` mobile, pill lama |
| `creator-desktop-1440-pill-light.png` | Pembanding: `/creator` tidak berubah |
| `responden-desktop-1440-pill-light.png` | Pembanding: tautan publik responden tidak berubah |

Yang diuji lewat browser pada halaman Ringkasan mobile 390:

- Tombol menu membuka drawer (`aria-expanded=true`, `role="dialog"`, `aria-modal`),
  body terkunci (`overflow: hidden`), Escape menutup dan mengembalikan fokus.
- Menu akun di footer drawer memuat "Keluar"; menekannya keluar sesi (cookie hilang)
  dan mengarahkan ke landing.
- Menavigasi ke "Akun & izin" dari drawer menutup drawer dan halaman tujuan
  merender pill lama (bukan chrome baru).
- Data table: klik header mengubah `aria-sort`, toggle "Kolom" menyembunyikan kolom,
  pagination dan pilihan baris per halaman berfungsi.
