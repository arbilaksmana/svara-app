-- Tautan publik ditutup oleh tiga jalur berbeda, dan hanya satu di antaranya boleh dilayani ulang
-- ke versi terbit yang lebih baru oleh remap di routes/public.ts. Sebelum ini status 'closed' saja
-- tidak dapat membedakan penutupan karena versi baru (3c9b72c) dari penutupan oleh arsip/penutupan
-- survei yang dulu menimpa tautan berstatus revoked.
--
-- NULL = penutupan lain atau tidak diketahui; remap hanya berlaku untuk 'superseded'.
ALTER TABLE public_links ADD COLUMN IF NOT EXISTS closed_reason TEXT;
