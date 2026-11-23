import { Badge } from './ui';

/**
 * Referensi bukti wali dicatat apa adanya. Tanpa jalur verifikasi yang menandai
 * evidence_ref sebagai sah, satu-satunya status yang mungkin untuk catatan baru
 * adalah `self_attested`; `verified` hanya boleh berasal dari verifikasi pihak
 * berwenang, bukan dari isian responden.
 */
export function guardianEvidencePresentation(status: string): { text: string; badge: string } {
  switch (status) {
    case 'verified':
      return { text: 'Pengelola telah memverifikasi bukti wali.', badge: 'Terverifikasi pengelola' };
    case 'self_attested':
      return { text: 'Dinyatakan oleh wali, belum diverifikasi.', badge: 'Dinyatakan wali (belum diverifikasi)' };
    case 'pending':
      return { text: 'Bukti wali menunggu verifikasi.', badge: 'Menunggu verifikasi' };
    case 'rejected':
      // Keputusan operator tercatat, tetapi gelombang ini tidak memblokir respons yang sudah disetujui.
      return { text: 'Bukti wali ditolak pengelola organisasi.', badge: 'Ditolak pengelola' };
    case 'revoked':
      return { text: 'Bukti wali dicabut.', badge: 'Dicabut' };
    case 'not_required':
      return { text: 'Tidak diperlukan untuk survei ini.', badge: 'Tidak diperlukan' };
    default:
      return { text: 'Status bukti wali tidak dikenal.', badge: 'Status tidak dikenal' };
  }
}

export function GuardianEvidenceSummary({ status }: { status: string }) {
  const { text, badge } = guardianEvidencePresentation(status);
  return (
    <div>
      <dt className="text-caption font-bold text-muted">Bukti wali</dt>
      <dd className="mt-1 flex flex-wrap items-center gap-2 text-ink">
        <span>{text}</span>
        <Badge tone={status === 'verified' ? 'success' : status === 'revoked' ? 'danger' : 'neutral'}>{badge}</Badge>
      </dd>
    </div>
  );
}
