/**
 * Kanal balasan permintaan data: satu daftar pilihan untuk dialog admin, plus aturan tampilan kanal
 * yang sudah tersimpan. Nilai kanonik yang dikirim ke API tidak berubah (`email`, `dianonimkan`, dst.).
 */

/** Kanal yang dipakai pengelola untuk membalas pemohon; server mencatatnya sebagai jejak balasan `response_channel`. */
export const RESPONSE_CHANNEL_LABELS: Record<string, string> = {
  email: 'Email',
  phone: 'Telepon',
  messaging: 'Pesan singkat (SMS/WhatsApp)',
  letter: 'Surat',
  in_person: 'Tatap muka',
};

/**
 * Nilai kanonis yang dicatat server, bukan pilihan balasan admin: job retensi mengganti kanal teks bebas
 * dengan `dianonimkan`. Baris lama tetap menampilkannya sebagai label manusiawi, tanpa menawarkannya
 * sebagai pilihan kanal baru.
 */
export const SYSTEM_CHANNEL_LABELS: Record<string, string> = {
  dianonimkan: 'Dianonimkan',
};

/** Label manusiawi untuk kanal tersimpan, termasuk nilai teks bebas yang dikirim lewat API langsung. */
export function channelLabel(channel: string): string {
  return RESPONSE_CHANNEL_LABELS[channel] ?? SYSTEM_CHANNEL_LABELS[channel] ?? channel;
}

/**
 * Pilihan kanal di dialog. Kanal tersimpan di luar daftar (mis. teks bebas lewat API) tetap dapat
 * dipilih agar simpan ulang tidak menggantinya; nilai sistem seperti `dianonimkan` tidak pernah
 * menjadi pilihan kanal baru.
 */
export function requestChannelOptions(
  storedChannel: string | null | undefined,
): Array<[string, string]> {
  const known = Object.entries(RESPONSE_CHANNEL_LABELS);
  if (!storedChannel || Object.hasOwn(RESPONSE_CHANNEL_LABELS, storedChannel)) {
    return known;
  }
  return [[storedChannel, channelLabel(storedChannel)], ...known];
}
