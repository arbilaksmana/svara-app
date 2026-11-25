import type { Question, QuestionOption, Response } from './types';
import { optionsFor } from './fixtures/surveys';

export interface OptionFrequency {
  option: QuestionOption;
  count: number;
}

export interface QuestionSummary {
  question: Question;
  total: number;
  answered: number;
  skipped: number;
  frequencies: OptionFrequency[];
  freeTextCount: number;
}

export interface VersionSummary {
  versionId: string;
  totalResponses: number;
  questions: QuestionSummary[];
}

/** Menghitung agregat dari respons final, bukan angka hardcode (PRD §7). */
export function computeSummary(
  versionId: string,
  questions: Question[],
  responses: Response[],
): VersionSummary {
  const finalResponses = responses.filter((r) => r.version_id === versionId);
  const total = finalResponses.length;

  const questionSummaries: QuestionSummary[] = questions.map((q) => {
    if (q.type === 'short_text') {
      const values = finalResponses.map((r) => r.answers.find((a) => a.question_code === q.code));
      const freeTextCount = values.filter((a) => a && a.text !== null && a.text !== '').length;
      const answered = values.filter((a) => a && !a.skipped && a.text !== null && a.text !== '').length;
      return {
        question: q,
        total,
        answered,
        skipped: total - answered,
        frequencies: [],
        freeTextCount,
      };
    }

    const qOptions = optionsFor(q.id);
    const values = finalResponses.map((r) => r.answers.find((a) => a.question_code === q.code));
    const answered = values.filter((a) => a && !a.skipped && a.value !== null).length;
    const frequencies: OptionFrequency[] = qOptions.map((option) => ({
      option,
      count: values.filter((a) => a && !a.skipped && a.value === option.value).length,
    }));

    return {
      question: q,
      total,
      answered,
      skipped: total - answered,
      frequencies,
      freeTextCount: 0,
    };
  });

  return { versionId, totalResponses: total, questions: questionSummaries };
}

/** Persentase memakai jumlah yang menjawab item; penyebut nol tidak dibagi. */
export function percentage(count: number, answered: number): string {
  if (answered === 0) return 'Belum ada jawaban';
  return `${Math.round((count / answered) * 100)}%`;
}

const WIB = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'Asia/Jakarta',
});

/** Waktu server UTC ditampilkan WIB (PRD §5.1). */
export function formatWIB(iso: string): string {
  return `${WIB.format(new Date(iso))} WIB`;
}

const UTC_DATE = new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeZone: 'UTC' });
/** Server menormalkan tanggal saja (`YYYY-MM-DD`) menjadi akhir hari UTC. */
const END_OF_DAY_UTC = /T23:59:59(?:\.\d{1,3})?Z$/;

/**
 * Batas waktu undangan diisi perancang sebagai tanggal saja, dan server menyimpannya sebagai
 * akhir hari UTC. Konversi ke WIB menggesernya ke pagi hari berikutnya sehingga pengguna
 * melihat tanggal yang tidak pernah dipilihnya; tampilkan tanggal pilihannya, sedangkan
 * nilai berwaktu eksplisit tetap ditampilkan lengkap dalam WIB.
 */
export function formatInvitationExpiry(iso: string): string {
  if (END_OF_DAY_UTC.test(iso)) return `${UTC_DATE.format(new Date(iso))} (akhir hari)`;
  return formatWIB(iso);
}

/** Ukuran berkas untuk unggahan bukti wali; server menolak di atas 5 MB. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeZone: 'Asia/Jakarta' }).format(new Date(iso));
}
