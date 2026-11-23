import { execFileSync } from 'node:child_process';

export interface EvidenceProvenance {
  commit: string;
  tree: 'clean' | 'dirty' | 'unknown';
}

/**
 * Asal artefak bukti demo: commit dan keadaan working tree saat skrip dijalankan. Artefak lama tanpa
 * blok ini tidak dapat dihubungkan ke revisi mana pun (temuan audit C-14), jadi semua skrip demo
 * menulisnya ke berkas JSON masing-masing.
 */
export function evidenceProvenance(): EvidenceProvenance {
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
    return { commit, tree: status ? 'dirty' : 'clean' };
  } catch {
    return { commit: 'unknown', tree: 'unknown' };
  }
}
