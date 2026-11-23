-- SEC-10/BR-06 (BR-10 jalur bootstrap): token tautan umum dan token undangan tersimpan mentah.
--
-- `public_links.token` dan `invitations.token` adalah salinan plaintext dari kredensial yang sudah
-- di-hash di `token_hash`. Salinan itu (1) muncul di setiap dump/backup, (2) diisi ke payload bootstrap
-- super admin, dan (3) membuat path `/s/:token` dapat dicocokkan ke kolom plaintext. Sejak rilis ini
-- token hanya keluar sekali saat diterbitkan: respons publish (`publicLink.token`) dan respons
-- `POST /surveys/:id/invitations`; pencetakan ulang memakai `POST /surveys/:id/public-link/token`.
--
-- Perubahan:
-- - drop index unik `public_links_token_key` lalu kolom `public_links.token`;
-- - drop index unik `invitations_token_key` lalu kolom `invitations.token`.
-- `token_hash` tetap menjadi satu-satunya pembanding, dengan indeks `ix_*_token_hash` dari migrasi awal.
--
-- Data lama: tautan yang sudah beredar tetap berlaku karena pembacaan hanya memakai `token_hash`;
-- token mentahnya tidak dapat ditampilkan lagi dari basis data (itu tujuannya) dan dapat dicetak ulang
-- lewat rute di atas. Tidak ada baris yang dihapus; penerimaan undangan memakai `invitations.code`.
--
-- Idempoten: `IF EXISTS` pada constraint dan kolom. `DROP COLUMN` ikut menghapus index uniknya bila
-- constraint unik lama tidak bernama (instalasi yang dibuat sebelum penamaan constraint eksplisit).
ALTER TABLE public_links DROP CONSTRAINT IF EXISTS public_links_token_key;
ALTER TABLE public_links DROP COLUMN IF EXISTS token;

ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_token_key;
ALTER TABLE invitations DROP COLUMN IF EXISTS token;
