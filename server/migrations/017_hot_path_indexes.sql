-- PERF-07 (audit 2026-11-20): indeks untuk jalur terpanas yang plan-nya terbukti membaik pada
-- dataset 10.000 respons × 20 butir (EXPLAIN ANALYZE sebelum/sesudah di laporan worker data-path).
-- Hanya menambah indeks; tidak ada tabel atau query yang berubah. IF NOT EXISTS agar aman diulang.

-- Resolusi token publik/undangan mencari token_hash, sedangkan indeks unique ada di kolom token mentah.
CREATE INDEX IF NOT EXISTS ix_public_links_token_hash ON public_links (token_hash);
CREATE INDEX IF NOT EXISTS ix_invitations_token_hash ON invitations (token_hash);

-- Batch ekspor keyset (submitted_at, id), halaman jawaban, dan pagination integrasi per versi
-- membaca urutan indeks alih-alih mengurutkan seluruh respons versi.
CREATE INDEX IF NOT EXISTS ix_responses_version_submitted ON responses (version_id, submitted_at, id);

-- Audit organisasi: WHERE organization_id = ? ORDER BY at DESC, id DESC LIMIT ?.
-- Baris tanpa organisasi (aksi publik) tidak pernah dibaca lewat jalur ini, jadi indeks parsial.
CREATE INDEX IF NOT EXISTS ix_audit_org_at ON audit_logs (organization_id, at DESC, id DESC)
  WHERE organization_id IS NOT NULL;
