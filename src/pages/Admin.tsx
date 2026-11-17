import { useState } from 'react';
import { Shell } from '../components/Shell';
import {
  ActionLink,
  Badge,
  Banner,
  Button,
  Card,
  Checkbox,
  Code,
  Divider,
  Label,
  Muted,
  Panel,
  PlainLink,
  SectionTitle,
  Table,
  Td,
  TextInput,
  Th,
} from '../components/ui';
import { StateView, StateDebugHint, SuccessBanner, ValidationSummary } from '../components/StateView';
import { DevStateSwitcher, useScreenState } from '../lib/state';
import { ROUTES } from '../lib/routes';
import { accounts, accessGrants, auditLogs, integrationEvents, responses } from '../lib/fixtures/records';
import { surveys } from '../lib/fixtures/surveys';
import { formatWIB } from '../lib/summary';

/* ---------------- Ringkasan ---------------- */

export function AdminSummaryPage() {
  const { state } = useScreenState('admin-summary');
  return (
    <Shell kind="admin" routeId="admin-summary" title="Ringkasan operasional" subtitle="Super admin melihat metrik operasional, bukan jawaban individual (PRD §3).">
      <StateView
        routeId="admin-summary"
        state={state}
        emptyTitle="Belum ada survei"
        emptyDetail="Metrik akan muncul setelah ada survei dan respons pada fixture."
        permissionDetail="Akses ringkasan memerlukan peran super admin."
      >
        <div className="flex flex-col gap-5">
          <StateDebugHint routeId="admin-summary" state={state} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <Label>Jumlah survei</Label>
              <p className="mt-2 text-h1 font-bold text-ink">{surveys.length}</p>
              <Muted>Termasuk draf, terbit, dan arsip.</Muted>
            </Card>
            <Card>
              <Label>Total respons final</Label>
              <p className="mt-2 text-h1 font-bold text-ink">{responses.length}</p>
              <Muted>Agregat lintas versi.</Muted>
            </Card>
            <Card>
              <Label>Akun pengelola</Label>
              <p className="mt-2 text-h1 font-bold text-ink">{accounts.length}</p>
              <Muted>Termasuk akun dinonaktifkan.</Muted>
            </Card>
          </div>

          <Banner tone="info" title="Tanpa akses jawaban individual">
            Peran super admin tidak otomatis memberi akses ke jawaban individual. Izin baca individual, ekspor, dan teks bebas diperiksa terpisah.
            <div className="mt-2"><PlainLink to={ROUTES.adminAccounts}>Kelola izin akun</PlainLink></div>
          </Banner>

          <Card className="flex flex-col gap-3">
            <SectionTitle>Metrik per creator</SectionTitle>
            <Table head={['Creator', 'Survei', 'Respons', 'Cakupan']}>
              <tr>
                <Th>Pengelola A</Th>
                <Td>{surveys.filter((s) => s.owner_id === 'u_creator_a').length}</Td>
                <Td>{responses.filter((r) => r.survey_id !== 's_demo3').length}</Td>
                <Td>Agregat milik sendiri</Td>
              </tr>
              <tr>
                <Th>Pengelola B</Th>
                <Td>{surveys.filter((s) => s.owner_id === 'u_creator_b').length}</Td>
                <Td>0</Td>
                <Td>Agregat milik sendiri</Td>
              </tr>
            </Table>
          </Card>

          <div className="flex flex-wrap gap-3">
            <ActionLink to={ROUTES.adminAccounts} variant="secondary">Akun dan izin</ActionLink>
            <ActionLink to={ROUTES.adminAudit} variant="secondary">Log audit</ActionLink>
            <ActionLink to={ROUTES.adminIntegration} variant="secondary">Status integrasi</ActionLink>
          </div>
        </div>
      </StateView>
      <DevStateSwitcher routeId="admin-summary" />
    </Shell>
  );
}

/* ---------------- Akun dan izin ---------------- */

export function AdminAccountsPage() {
  const { state } = useScreenState('admin-accounts');
  const [grants, setGrants] = useState(() =>
    Object.fromEntries(accessGrants.map((g) => [g.id, {
      read: g.can_read_individual,
      export: g.can_export,
      text: g.can_read_free_text,
    }])),
  );
  const [saved, setSaved] = useState(false);

  return (
    <Shell kind="admin" routeId="admin-accounts" title="Akun dan izin" subtitle="Izin baca individual, izin ekspor, dan izin teks bebas adalah tiga izin terpisah (PRD §3, §9.1).">
      <StateView
        routeId="admin-accounts"
        state={state}
        emptyTitle="Belum ada akun"
        emptyDetail="Tambahkan akun pengelola untuk mulai mengatur izin."
        permissionDetail="Hanya super admin yang dapat mengubah peran dan izin."
      >
        <div className="flex flex-col gap-5">
          <StateDebugHint routeId="admin-accounts" state={state} />
          {state === 'success' && <SuccessBanner title="Izin diperbarui pada tampilan">Perubahan dicatat pada log audit tanpa memuat jawaban atau token.</SuccessBanner>}
          {state === 'validation' && <ValidationSummary items={['Setiap izin harus ditetapkan secara eksplisit.', 'Cakupan survei wajib dipilih untuk petugas berizin.']} />}

          <Card className="flex flex-col gap-3">
            <SectionTitle>Daftar akun</SectionTitle>
            <Table head={['Akun', 'Peran', 'Status', 'Cakupan']}>
              {accounts.map((a) => (
                <tr key={a.id}>
                  <Th>{a.display_name}<span className="mt-1 block font-mono text-annotation font-normal tracking-mono text-muted"><Code>{a.id}</Code></span></Th>
                  <Td><Code>{a.role}</Code></Td>
                  <Td><Badge tone={a.status === 'active' ? 'success' : 'neutral'}>{a.status === 'active' ? 'Aktif' : 'Dinonaktifkan'}</Badge></Td>
                  <Td>{accessGrants.filter((g) => g.account_id === a.id).length} grant</Td>
                </tr>
              ))}
            </Table>
          </Card>

          <Card className="flex flex-col gap-4">
            <SectionTitle>Izin terpisah per grant</SectionTitle>
            {accessGrants.map((g) => {
              const acc = accounts.find((a) => a.id === g.account_id);
              const current = grants[g.id] ?? { read: false, export: false, text: false };
              return (
                <div key={g.id} className="rounded-md border border-n200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-body font-bold text-ink">{acc?.display_name ?? g.account_id}</p>
                    <Badge tone="neutral"><Code>{g.survey_id ?? 'semua'}</Code></Badge>
                  </div>
                  <Divider />
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <Checkbox
                      id={`${g.id}-read`}
                      label="Baca jawaban individual"
                      checked={current.read}
                      onChange={(v) => setGrants((prev) => ({ ...prev, [g.id]: { ...current, read: v } }))}
                    />
                    <Checkbox
                      id={`${g.id}-export`}
                      label="Ekspor data"
                      checked={current.export}
                      onChange={(v) => setGrants((prev) => ({ ...prev, [g.id]: { ...current, export: v } }))}
                    />
                    <Checkbox
                      id={`${g.id}-text`}
                      label="Baca teks bebas"
                      checked={current.text}
                      onChange={(v) => setGrants((prev) => ({ ...prev, [g.id]: { ...current, text: v } }))}
                    />
                  </div>
                </div>
              );
            })}
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => setSaved(true)} disabled={state === 'loading'} loading={state === 'loading'}>Simpan izin</Button>
              <ActionLink to={ROUTES.adminAudit} variant="secondary">Lihat log perubahan izin</ActionLink>
            </div>
            {saved && <Banner tone="success" title="Perubahan izin tersimpan pada tampilan">Tidak ada pemeriksaan izin server pada pratinjau.</Banner>}
          </Card>

          <Panel>
            <SectionTitle>Teks bebas</SectionTitle>
            <p className="mt-2 text-body-sm text-muted">
              Teks bebas dapat memuat identitas yang ditulis responden. Batasi dan periksa sebelum dibagikan; hanya penerima berizin yang boleh membacanya (PRD §9.1, R6).
            </p>
          </Panel>
        </div>
      </StateView>
      <DevStateSwitcher routeId="admin-accounts" />
    </Shell>
  );
}

/* ---------------- Log audit ---------------- */

export function AdminAuditPage() {
  const { state } = useScreenState('admin-audit');
  return (
    <Shell kind="admin" routeId="admin-audit" title="Log audit" subtitle="Log memuat aktor, aksi, objek, hasil, dan waktu. Tidak ada token, kredensial, atau isi jawaban (PRD §6, §9.1).">
      <StateView
        routeId="admin-audit"
        state={state}
        emptyTitle="Belum ada entri audit"
        emptyDetail="Entri muncul setelah publikasi, perubahan izin, akses individual, atau ekspor."
        permissionDetail="Log operasional hanya dapat dibaca sesuai tugas."
      >
        <div className="flex flex-col gap-5">
          <StateDebugHint routeId="admin-audit" state={state} />
          <Banner tone="info" title="Minimisasi isi log">
            Kolom di bawah sengaja dibatasi. Tidak ada kolom token, kredensial, atau jawaban.
          </Banner>
          <Card className="flex flex-col gap-3">
            <SectionTitle>Entri operasional</SectionTitle>
            <Table head={['Waktu (WIB)', 'Aktor', 'Aksi', 'Objek', 'Hasil']}>
              {auditLogs.map((log) => (
                <tr key={log.id}>
                  <Td>{formatWIB(log.at)}</Td>
                  <Td className="font-bold">{log.actor}</Td>
                  <Td>{log.action}</Td>
                  <Td><Code>{log.object}</Code></Td>
                  <Td>
                    <Badge tone={log.outcome === 'berhasil' ? 'success' : log.outcome === 'ditolak' ? 'danger' : 'warning'}>
                      {log.outcome}
                    </Badge>
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>
          <Panel>
            <SectionTitle>Cakupan pencatatan</SectionTitle>
            <ul className="mt-2 flex list-inside list-disc flex-col gap-1 text-body-sm text-muted">
              <li>Perubahan izin dan status.</li>
              <li>Akses jawaban individual dan penolakan akses.</li>
              <li>Publikasi, penutupan, dan ekspor beserta penerima.</li>
              <li>Event integrasi dicatat dengan ID kejadian yang tetap.</li>
            </ul>
          </Panel>
          <div className="flex flex-wrap gap-3">
            <ActionLink to={ROUTES.adminIntegration} variant="secondary">Lihat event integrasi</ActionLink>
            <ActionLink to={ROUTES.creatorResults('s_demo1')} variant="secondary">Kembali ke hasil</ActionLink>
          </div>
        </div>
      </StateView>
      <DevStateSwitcher routeId="admin-audit" />
    </Shell>
  );
}

/* ---------------- Integrasi ---------------- */

export function AdminIntegrationPage() {
  const { state } = useScreenState('admin-integration');
  const [replayed, setReplayed] = useState<string | null>(null);
  const down = state === 'error';

  return (
    <Shell kind="admin" routeId="admin-integration" title="Status Modul 13 dan 15" subtitle="Seluruh status di sini simulasi. Satu demonstrasi harus tetap berjalan ketika kedua modul tidak tersedia (PRD §1, R1).">
      <StateView
        routeId="admin-integration"
        state={state}
        permissionDetail="Status integrasi hanya untuk peran yang berwenang."
        conflictTo={ROUTES.adminAudit}
        errorTitle="Layanan Modul 13/15 terputus"
        errorDetail="Alur mandiri tetap berjalan. Tidak ada kredensial atau endpoint nyata pada pratinjau."
      >
        <div className="flex flex-col gap-5">
          <StateDebugHint routeId="admin-integration" state={state} />
          {state === 'success' && <SuccessBanner title="Event diulang dengan ID kejadian tetap">Retry event terpisah dari respons; tidak membuat respons kedua.</SuccessBanner>}
          {down && (
            <Banner tone="danger" title="Layanan terputus">
              Alur mandiri tetap berjalan tanpa Modul 13/15. Status pengiriman dapat diulang setelah layanan kembali.
            </Banner>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <SectionTitle>Modul 13 · identitas</SectionTitle>
                <Badge tone={down ? 'danger' : 'warning'}>{down ? 'Terputus' : 'Simulasi'}</Badge>
              </div>
              <p className="mt-2 text-body-sm text-muted">
                Memberi identitas dan penugasan terverifikasi serta menerima status pengiriman. Endpoint dan autentikasi nyata masih perlu disepakati.
              </p>
              <ul className="mt-3 flex list-inside list-disc flex-col gap-1 text-body-sm text-ink">
                <li>ID lokal dan kode individual dipakai selama daftar peserta belum tersedia.</li>
                <li>Bedakan LMS mencatat tautan dibuka dan Modul 14 mencatat jawaban tersimpan.</li>
                <li>Jangan membuat identitas kedua otomatis.</li>
              </ul>
            </Card>
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <SectionTitle>Modul 15 · konsumen data</SectionTitle>
                <Badge tone={down ? 'danger' : 'warning'}>{down ? 'Terputus' : 'Simulasi'}</Badge>
              </div>
              <p className="mt-2 text-body-sm text-muted">
                CSV adalah jalur keluaran wajib MVP. API adalah jalur integrasi yang didukung rancangan; format final masih terbuka.
              </p>
              <ul className="mt-3 flex list-inside list-disc flex-col gap-1 text-body-sm text-ink">
                <li>Filter cakupan dan kolom, catat penerima.</li>
                <li><Code>schema_version</Code>, versi survei, kode item, nilai atau teks sesuai izin.</li>
                <li><Code>collection_mode</Code>: standalone/integrated; <Code>identity_source</Code>: local/module_13.</li>
              </ul>
            </Card>
          </div>

          <Card className="flex flex-col gap-3">
            <SectionTitle>Event (simulasi)</SectionTitle>
            <Table head={['ID kejadian', 'Tipe', 'Tujuan', 'Status', 'Percobaan', 'Aksi']}>
              {integrationEvents.map((e) => (
                <tr key={e.id}>
                  <Th><Code>{e.event_id}</Code></Th>
                  <Td>{e.type}</Td>
                  <Td><Code>{e.target}</Code></Td>
                  <Td>
                    <Badge tone={e.status === 'delivered' ? 'success' : e.status === 'pending' ? 'warning' : 'danger'}>
                      {e.status === 'delivered' ? 'Terkirim' : e.status === 'pending' ? 'Menunggu' : 'Gagal'}
                    </Badge>
                  </Td>
                  <Td>{e.attempts}</Td>
                  <Td>
                    <button
                      type="button"
                      onClick={() => setReplayed(e.id)}
                      disabled={state === 'loading'}
                      className="min-h-[32px] rounded-sm border border-n200 bg-n0 px-2 text-caption font-bold text-action hover:bg-action-soft disabled:text-n400"
                    >
                      {replayed === e.id ? 'Diulang' : 'Ulangi event'}
                    </button>
                  </Td>
                </tr>
              ))}
            </Table>
            <p className="text-caption text-muted">
              Event selesai hanya untuk respons tersimpan. ID kejadian tetap dipakai saat retry; hasil simulasi dipisahkan dari integrasi nyata.
            </p>
          </Card>

          <Card className="flex flex-col gap-3">
            <SectionTitle>Mode mandiri</SectionTitle>
            <p className="text-body-sm text-muted">
              Creator tetap dapat menerbitkan survei, menerima respons, melihat ringkasan, dan mengekspor CSV tanpa layanan modul lain.
            </p>
            <div className="flex flex-wrap gap-3">
              <ActionLink to={ROUTES.respondentIntro('link-umum-demo')}>Buka alur responden mandiri</ActionLink>
              <ActionLink to={ROUTES.creatorResults('s_demo1')} variant="secondary">Lihat ringkasan</ActionLink>
              <ActionLink to={ROUTES.adminAudit} variant="secondary">Lihat log audit</ActionLink>
            </div>
          </Card>

          <Panel>
            <Label>Kontak kontrak</Label>
            <div className="mt-2">
              <TextInput aria-label="Catatan kontrak" placeholder="Format skema final menunggu kesepakatan tim" readOnly />
            </div>
            <p className="mt-2 text-caption text-muted">Nilai ini contoh tampilan, bukan kredensial atau endpoint nyata.</p>
          </Panel>
        </div>
      </StateView>
      <DevStateSwitcher routeId="admin-integration" />
    </Shell>
  );
}
