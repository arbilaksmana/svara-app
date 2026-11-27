/**
 * MODE PREVIEW UI (dev-only). Aktif HANYA saat NEXT_PUBLIC_UI_MOCK=1.
 * Menyediakan payload kanonis agar komponen React asli (/admin Ringkasan) dirender
 * tanpa backend/DB/login. Tidak dipakai pada build normal; nilai default mati.
 * Berkas ini hanya impor sisi klien; modul data preview ada di mock-preview-client.ts.
 */
import type { AdminStats } from './api';
import { MOCK_ACCOUNT, MOCK_BOOTSTRAP, MOCK_DATA_REQUESTS, MOCK_PLATFORM_PROFILE } from './mock-preview-client';

export const MOCK_STATS: AdminStats = {
  accounts: 6,
  surveys: 4,
  responses: 253,
  pendingRequests: 1,
  perCreator: [
    { id: 'u_creator_a', display_name: 'Andi Pratama', surveys: 3, responses: 120 },
    { id: 'u_creator_b', display_name: 'Sinta Maharani', surveys: 2, responses: 84 },
    { id: 'u_petugas', display_name: 'Dedi Kurniawan', surveys: 1, responses: 31 },
    { id: 'u_creator_c', display_name: 'Rina Safitri', surveys: 1, responses: 18 },
    { id: 'u_creator_d', display_name: 'Fajar Nugroho', surveys: 1, responses: 9 },
    { id: 'u_creator_e', display_name: 'Ayu Lestari', surveys: 1, responses: 4 },
  ],
  perSurvey: [
    { id: 's_1', title: 'Kepuasan Layanan Kampus', owner: 'Andi Pratama', versions: 3, responses: 76 },
    { id: 's_2', title: 'Umpan Balik Perpustakaan', owner: 'Sinta Maharani', versions: 2, responses: 54 },
    { id: 's_3', title: 'Survei Keselamatan Lab', owner: 'Dedi Kurniawan', versions: 1, responses: 31 },
    { id: 's_4', title: 'Survei Beasiswa Semester Ganjil', owner: 'Rina Safitri', versions: 1, responses: 40 },
    { id: 's_5', title: 'Survei Kebiasaan Belajar', owner: 'Petugas Lapangan', versions: 2, responses: 22 },
    { id: 's_6', title: 'Survei Iklim Kelas', owner: 'Andi Pratama', versions: 1, responses: 15 },
    { id: 's_7', title: 'Survei Kesiapan Kerja', owner: 'Sinta Maharani', versions: 1, responses: 5 },
  ],
};

/**
 * Deret grafik per rentang untuk mode preview: 'today' per jam, '7d'/'30d' per hari.
 * Jendela 7 hari memakai ekor deret 30 hari agar angka antar rentang konsisten.
 */
/** Rentang awal pemilih grafik di layar Ringkasan (`useState<ChartRange>('30d')`). */
const DEFAULT_RANGE = '30d';

const HOURLY_TODAY = [
  0, 0, 0, 0, 0, 0, 0, 1, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];
const DAILY_30 = [
  1, 0, 2, 3, 1, 0, 1, 2, 4, 3, 2, 1, 0, 2, 3, 5, 4, 3, 2, 1, 2, 0, 0, 2, 4, 1, 3, 2, 1, 2,
];

/** Kunci hari lokal 'YYYY-MM-DD', format yang sama dengan kunci titik server. */
function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Deret titik per rentang: 'today' per jam, '30d' per hari. Payload server tidak
 * membawa `chart`, jadi mode preview mengisi deret rentang awal layar ('30d') agar grafik terisi.
 */
function chartForRange(range: string): Array<{ point: string; responses: number }> {
  const now = new Date();
  if (range === 'today') {
    const day = dayKey(now);
    return HOURLY_TODAY.map((responses, hour) => ({
      point: `${day}T${String(hour).padStart(2, '0')}`,
      responses,
    }));
  }
  return DAILY_30.map((responses, index) => {
    const date = new Date(now);
    date.setDate(date.getDate() - (DAILY_30.length - 1 - index));
    return { point: dayKey(date), responses };
  });
}

export const UI_MOCK = process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_UI_MOCK === '1';

/** Balasan kanonis untuk path yang dipakai layar Ringkasan; null = tidak di-mock. */
export function mockResponse(path: string, method: string): unknown | null {
  if (!UI_MOCK) return null;
  if (path === '/bootstrap') return MOCK_BOOTSTRAP;
  if (path === '/auth/me') return { account: MOCK_ACCOUNT };
  if (path === '/auth/login' && method === 'POST') return { account: MOCK_ACCOUNT };
  if (path === '/admin/stats') return { ...MOCK_STATS, chart: chartForRange(DEFAULT_RANGE) };
  if (path === '/auth/logout' && method === 'POST') return {};
  if (path === '/admin/requests' || path === '/admin/data-requests') return MOCK_DATA_REQUESTS;
  if (path === '/admin/platform-profile') return { profile: MOCK_PLATFORM_PROFILE };
  return null;
}
