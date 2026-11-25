'use client';

import { useEffect } from 'react';
import { Shell } from '../components/Shell';
import {
  ActionLink,
  Badge,
  Card,
  Code,
  Divider,
  Panel,
  PlainLink,
  PolicyLinks,
  Table,
  Td,
  TextLink,
  Th,
} from '../components/ui';
import { StateView } from '../components/StateView';
import { useScreenState } from '../lib/state';
import { ROUTES } from '../lib/routes';
import { useStore } from '../lib/store';
import { versionsFor, questionsFor } from '../lib/fixtures/surveys';

const CAPABILITIES = [
  {
    title: 'Skala fleksibel dan isian singkat',
    detail: 'Jumlah opsi, label, dan nilai diatur per pertanyaan. Isian teks boleh wajib atau opsional.',
    to: () => ROUTES.creatorEdit('s_demo1'),
    action: 'Buka editor',
  },
  {
    title: 'Versi terkunci saat terbit',
    detail: 'Publikasi membekukan konfigurasi. Formulir yang sudah terbuka tetap mengirim ke versinya.',
    to: () => ROUTES.creatorHistory('s_demo1'),
    action: 'Lihat riwayat versi',
  },
  {
    title: 'Hasil per versi, opsi nol tetap tampil',
    detail: 'Frekuensi tiap pilihan, jumlah terjawab, dan jumlah dilewati. Penyebut nol tidak dibagi.',
    to: () => ROUTES.creatorResults('s_demo1'),
    action: 'Lihat contoh hasil',
  },
  {
    title: 'Ekspor CSV tanpa token',
    detail: 'Satu berkas per versi berisi kode item, bukan nama. Token tidak pernah masuk ekspor.',
    to: () => ROUTES.creatorResults('s_demo1'),
    action: 'Buka ekspor',
  },
];

const FLOW = [
  { step: 'Susun', detail: 'Judul, tujuan, bagian, kode item, dan urutan.', to: () => ROUTES.creatorEdit('s_demo1') },
  { step: 'Terbitkan', detail: 'Validasi item, lalu bekukan menjadi versi tetap.', to: () => ROUTES.creatorPublish('s_demo1') },
  { step: 'Bagikan', detail: 'Tautan umum atau undangan individual per peserta.', to: () => ROUTES.creatorShare('s_demo1') },
  { step: 'Baca hasil', detail: 'Ringkasan per versi, lalu unduh CSV sesuai izin.', to: () => ROUTES.creatorResults('s_demo1') },
];

/** Contoh label skala yang statis: bagian ini tidak bergantung pada data survei yang diganti bootstrap. */
const SCALE_5 = ['Sangat tidak setuju', 'Tidak setuju', 'Netral', 'Setuju', 'Sangat setuju'];
const SCALE_4 = ['Tidak sesuai', 'Kurang sesuai', 'Sesuai', 'Sangat sesuai'];

const FAQ = [
  {
    q: 'Apa bedanya draf dan versi terbit?',
    a: 'Draf masih bisa diubah kapan saja tanpa memengaruhi jawaban. Publikasi membekukan konfigurasi menjadi versi tetap dengan nomor sendiri.',
  },
  {
    q: 'Formulir sudah terbuka, lalu versi baru terbit. Jawaban masuk ke mana?',
    a: 'Ke versi yang sedang dibuka. Formulir tidak dipindahkan diam-diam ke versi baru; kiriman baru ke versi lama ditolak setelah versi itu ditutup.',
  },
  {
    q: 'Apakah tautan umum menjamin satu respons per orang?',
    a: 'Tidak. Tautan umum mencegah jawaban ganda dari kiriman yang sama, tetapi tidak memastikan satu orang hanya mengisi sekali. Batas satu respons per peserta hanya berlaku pada undangan individual.',
  },
  {
    q: 'Siapa yang bisa melihat jawaban individual?',
    a: 'Izin baca jawaban individual, izin ekspor, dan izin teks bebas diberikan terpisah per akun dan per survei.',
  },
];

export function HomePage() {
  const { state } = useScreenState('home');
  const { session, ready, error } = useStore();
  const demoVersions = versionsFor('s_demo1');
  // NEW-UX-C: sebelum bootstrap berhasil modul survei masih berisi fixture klien, jadi panel tidak dirender di SSR,
  // saat bootstrap gagal, maupun untuk tamu (bootstrap tamu tanpa survei). Panel hanya membaca versi terbit dari server.
  const activeDemo = ready && !error && session ? demoVersions.find((v) => v.status === 'published') : undefined;

  // Tautan navbar tamu memakai hash; gulir manual saat hash berubah.
  useEffect(() => {
    const scrollToHash = () => {
      const hash = window.location.hash;
      if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
    };
    scrollToHash();
    window.addEventListener('hashchange', scrollToHash);
    return () => window.removeEventListener('hashchange', scrollToHash);
  }, []);

  return (
    <Shell kind="public" title="Svara" hideHeading>
      <StateView
        routeId="home"
        state={state}
        emptyTitle="Belum ada survei untuk ditampilkan"
        emptyDetail="Mulai dari draf baru untuk membuat instrumen pertama Anda."
        emptyAction={<ActionLink to={ROUTES.creator}>Buka daftar survei</ActionLink>}
      >
        <div className="flex flex-col gap-16 lg:gap-24">
          {/* Hero */}
          <section aria-labelledby="hero-title" className={`grid gap-10 lg:items-center ${activeDemo ? 'lg:grid-cols-[1.05fr_0.95fr]' : ''}`}>
            <div className="flex min-w-0 flex-col items-start gap-5">
              <p className="font-mono text-caption font-bold tracking-mono text-n600">PEMBUAT SURVEI</p>
              <h1 id="hero-title" className="text-h1 font-bold leading-[1.12] text-ink wrap-anywhere lg:text-[46px]">
                Susun instrumen sekali.
                <span className="block text-n600">Terbitkan per versi.</span>
              </h1>
              <p className="max-w-[52ch] text-body text-muted">
                Kelola pertanyaan berskala dan isian singkat, bekukan menjadi versi, kirim tautan atau undangan,
                lalu baca ringkasan per versi. Tanpa mengubah kode untuk tiap topik.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <ActionLink to={session ? (session.role === 'admin' ? ROUTES.admin : ROUTES.creator) : ROUTES.login}>
                  {session ? 'Buka workspace' : 'Masuk sebagai pengelola'}
                </ActionLink>
                <ActionLink to={ROUTES.respondentIntro('link-umum-demo')} variant="secondary">
                  Lihat contoh formulir
                </ActionLink>
                <PlainLink to={ROUTES.respondentCode} className="min-h-[44px]">Punya kode undangan?</PlainLink>
              </div>
              <PolicyLinks />
            </div>

            {/* Panel produk dari data nyata, bukan tangkapan layar rekaan. */}
            {activeDemo && (
            <Card className="flex min-w-0 flex-col gap-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono text-caption font-bold tracking-mono text-n600">INSTRUMEN CONTOH</p>
                  <p className="mt-1 text-body font-bold text-ink">Riwayat versi</p>
                </div>
                <Badge tone="success">Terbit</Badge>
              </div>
              <Divider />
              <div className="min-w-0">
                <Table head={['Versi', 'Status', 'Item']}>
                  {demoVersions.map((v) => (
                    <tr key={v.id}>
                      <Th><Code>v{v.number}</Code></Th>
                      <Td>
                        <Badge tone={v.status === 'published' ? 'success' : v.status === 'draft' ? 'neutral' : 'warning'}>
                          {v.status === 'published' ? 'Terbit' : v.status === 'draft' ? 'Draf' : 'Ditutup'}
                        </Badge>
                      </Td>
                      <Td>{questionsFor(v.id).length} item</Td>
                    </tr>
                  ))}
                </Table>
              </div>
              <p className="text-caption text-muted">
                {questionsFor(activeDemo.id).length} item pada versi aktif.
                Formulir yang sudah terbuka tetap memakai versinya sendiri.
              </p>
            </Card>
            )}
          </section>

          {/* Kemampuan inti */}
          <section aria-labelledby="kemampuan" className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <h2 id="kemampuan" className="text-h2 font-bold text-ink wrap-anywhere">Yang membedakan dari formulir biasa</h2>
              <p className="max-w-[65ch] text-body text-muted">
                Empat hal yang dipakai setiap hari oleh pengelola survei.
              </p>
            </div>
            <div className="flex flex-col">
              {CAPABILITIES.map((item, i) => (
                <div
                  key={item.title}
                  className={`grid gap-2 py-5 sm:grid-cols-[auto_1fr_auto] sm:items-start sm:gap-6 ${i > 0 ? 'border-t border-n200' : ''}`}
                >
                  <span className="font-mono text-caption font-bold tracking-mono text-n600">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="min-w-0">
                    <p className="text-body font-bold text-ink">{item.title}</p>
                    <p className="mt-1 max-w-[62ch] text-body-sm text-muted">{item.detail}</p>
                  </div>
                  <TextLink to={item.to()}>{item.action}</TextLink>
                </div>
              ))}
            </div>
          </section>

          {/* Jalur data dan persetujuan */}
          <section aria-labelledby="persetujuan" className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <h2 id="persetujuan" className="text-h2 font-bold text-ink wrap-anywhere">Persetujuan mengikuti kebijakan organisasi</h2>
              <p className="max-w-[65ch] text-body text-muted">
                Satu profil organisasi menentukan teks pemberitahuan dan syarat persetujuan. Tidak ada asumsi sektor di dalam kode.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Panel className="flex flex-col gap-2">
                <p className="text-body font-bold text-ink">Pemberitahuan sebelum item pertama</p>
                <p className="text-body-sm text-muted">
                  Tujuan, jenis data, penerima, retensi, kontak, dan hak peserta tampil sebelum pengisian.
                </p>
              </Panel>
              <Panel className="flex flex-col gap-2">
                <p className="text-body font-bold text-ink">Persetujuan sesuai kebijakan organisasi</p>
                <p className="text-body-sm text-muted">
                  Bila organisasi mewajibkan persetujuan orang tua atau wali, kiriman ditolak sampai pernyataan wali dan referensi
                  buktinya diisi. Referensi dicatat apa adanya, tidak diverifikasi aplikasi.
                </p>
              </Panel>
              <Panel className="flex flex-col gap-2">
                <p className="text-body font-bold text-ink">Izin dibaca terpisah</p>
                <p className="text-body-sm text-muted">
                  Baca jawaban individual, ekspor, dan teks bebas adalah tiga izin berbeda.
                </p>
              </Panel>
            </div>
            <p className="text-caption text-muted">
              Nilai retensi, kontak, dan pengendali ditetapkan organisasi. Halaman ini tidak mengklaim sertifikasi apa pun.
            </p>
          </section>

          {/* Alur kerja */}
          <section aria-labelledby="alur" className="flex flex-col gap-4">
            <h2 id="alur" className="text-h2 font-bold text-ink wrap-anywhere">Dari instrumen kosong ke hasil terbaca</h2>
            <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {FLOW.map((f, i) => (
                <li key={f.step} className="flex flex-col gap-2 rounded-lg border border-n200 p-4">
                  <span className="font-mono text-caption font-bold tracking-mono text-n600">
                    LANGKAH {i + 1}
                  </span>
                  <p className="text-body font-bold text-ink">{f.step}</p>
                  <p className="text-body-sm text-muted">{f.detail}</p>
                  <TextLink to={f.to()}>Coba di aplikasi</TextLink>
                </li>
              ))}
            </ol>
          </section>

          {/* Dua bentuk skala */}
          <section aria-labelledby="contoh" className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <h2 id="contoh" className="text-h2 font-bold text-ink wrap-anywhere">Satu aplikasi, dua bentuk skala</h2>
              <p className="max-w-[65ch] text-body text-muted">
                Jumlah titik dan label diatur per pertanyaan. Skala 5 titik menyediakan jawaban tengah, skala 4 titik
                memaksa peserta memilih arah.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Card className="flex min-w-0 flex-col gap-3">
                <div className="self-start"><Badge tone="neutral">Skala 5 titik</Badge></div>
                <p className="text-body font-bold text-ink">Dengan titik tengah</p>
                <ul className="flex flex-col gap-1.5">
                  {SCALE_5.map((label) => (
                    <li
                      key={label}
                      className="inline-flex min-h-[36px] items-center rounded-sm border border-n200 px-3 text-body-sm text-n600"
                    >
                      {label}
                    </li>
                  ))}
                </ul>
                <p className="text-body-sm text-muted">Satu jawaban wajib per item. Nilai dan label disimpan bersama.</p>
              </Card>
              <Card className="flex min-w-0 flex-col gap-3">
                <div className="self-start"><Badge tone="neutral">Skala 4 titik</Badge></div>
                <p className="text-body font-bold text-ink">Tanpa titik tengah</p>
                <ul className="flex flex-col gap-1.5">
                  {SCALE_4.map((label) => (
                    <li
                      key={label}
                      className="inline-flex min-h-[36px] items-center rounded-sm border border-n200 px-3 text-body-sm text-n600"
                    >
                      {label}
                    </li>
                  ))}
                </ul>
                <p className="text-body-sm text-muted">Cocok bila jawaban netral tidak diinginkan. Item tetap boleh dilewati.</p>
              </Card>
            </div>
          </section>

          {/* FAQ */}
          <section aria-labelledby="faq" className="flex flex-col gap-4">
            <h2 id="faq" className="text-h2 font-bold text-ink wrap-anywhere">Pertanyaan yang sering muncul</h2>
            <div className="flex flex-col">
              {FAQ.map((item, i) => (
                <details key={item.q} className={`group py-4 ${i > 0 ? 'border-t border-n200' : ''}`}>
                  <summary className="flex min-h-[44px] cursor-pointer items-center justify-between gap-4 text-body font-bold text-ink">
                    {item.q}
                    <span aria-hidden="true" className="font-mono text-caption text-n400 group-open:hidden">+</span>
                    <span aria-hidden="true" className="hidden font-mono text-caption text-n400 group-open:inline">−</span>
                  </summary>
                  <p className="mt-2 max-w-[70ch] text-body-sm text-muted">{item.a}</p>
                </details>
              ))}
            </div>
          </section>

          {/* Penutup */}
          <section aria-labelledby="penutup" className="flex flex-col items-start gap-4 rounded-lg border border-n200 bg-n50 p-6 lg:p-8">
            <h2 id="penutup" className="text-h2 font-bold text-ink wrap-anywhere">Siap menyusun instrumen pertama?</h2>
            <p className="max-w-[60ch] text-body text-muted">
              Masuk sebagai pengelola untuk membuat draf, atau isi contoh formulir lebih dulu untuk melihat alur responden.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <ActionLink to={session ? (session.role === 'admin' ? ROUTES.admin : ROUTES.creator) : ROUTES.login}>
                  {session ? 'Buka workspace' : 'Masuk sebagai pengelola'}
                </ActionLink>
              <ActionLink to={ROUTES.respondentIntro('link-umum-demo')} variant="secondary">
                Isi contoh formulir
              </ActionLink>
            </div>
          </section>
        </div>
      </StateView>
      
    </Shell>
  );
}
