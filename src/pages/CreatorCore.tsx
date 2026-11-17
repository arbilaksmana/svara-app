import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useParams } from 'react-router-dom';
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
  Field,
  Label,
  Muted,
  Panel,
  PlainLink,
  SectionTitle,
  Table,
  Td,
  TextArea,
  TextInput,
  Th,
} from '../components/ui';
import { StateView, StateDebugHint, SuccessBanner, ValidationSummary } from '../components/StateView';
import { DevStateSwitcher, useScreenState } from '../lib/state';
import { ROUTES } from '../lib/routes';
import { findSurvey, questionsFor, optionsFor, surveys, versionsFor } from '../lib/fixtures/surveys';
import { formatWIB } from '../lib/summary';
import { profileForSurvey } from '../lib/fixtures/profiles';
import { useToast } from '../components/Toast';
import { createSurvey, publishVersion, saveDraft, useStore } from '../lib/store';

const STATUS_TONE = {
  draft: 'neutral',
  published: 'success',
  closed: 'warning',
  archived: 'neutral',
} as const;

const STATUS_LABEL = {
  draft: 'Draf',
  published: 'Terbit',
  closed: 'Ditutup',
  archived: 'Arsip',
} as const;

function useSurveyId(): string {
  const { id } = useParams();
  return id && findSurvey(id) ? id : 's_demo1';
}

export function SurveyNav({ id }: { id: string }) {
  const links = [
    { to: ROUTES.creatorEdit(id), label: 'Editor' },
    { to: ROUTES.creatorPreview(id), label: 'Pratinjau' },
    { to: ROUTES.creatorPublish(id), label: 'Publikasi' },
    { to: ROUTES.creatorShare(id), label: 'Bagikan' },
    { to: ROUTES.creatorResults(id), label: 'Hasil' },
    { to: ROUTES.creatorSettings(id), label: 'Pengaturan' },
    { to: ROUTES.creatorHistory(id), label: 'Riwayat' },
  ];
  return (
    <nav aria-label="Navigasi survei" className="mb-5 flex gap-1 overflow-x-auto border-b border-n200 pb-2">
      {links.map((l) => (
        <ActionLink key={l.to} to={l.to} variant="ghost" className="shrink-0 px-3 text-body-sm">
          {l.label}
        </ActionLink>
      ))}
    </nav>
  );
}

/* ---------------- Daftar survei ---------------- */

export function CreatorListPage() {
  const { state, link } = useScreenState('creator-list');
  const navigate = useNavigate();
  const notify = useToast();
  const { revision } = useStore();
  void revision;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'semua' | 'draft' | 'published' | 'closed' | 'archived'>('semua');
  const visible = surveys.filter((s) => s.status !== 'draft' || s.id === 's_demo3');

  const rows = visible.filter((s) => {
    const matchQuery = query === '' || s.title.toLowerCase().includes(query.toLowerCase());
    const matchFilter = filter === 'semua' || s.status === filter;
    return matchQuery && matchFilter;
  });

  return (
    <Shell kind="creator" title="Daftar survei" subtitle="Kelola seluruh instrumen Anda, dari draf hingga versi yang diterbitkan.">
      <StateView
        routeId="creator-list"
        state={state}
        emptyTitle="Belum memiliki survei"
        emptyDetail="Buat draf pertama untuk mulai menyusun pertanyaan dan skala."
        emptyAction={<ActionLink to={ROUTES.creatorEdit('s_demo1')}>Buka editor draf</ActionLink>}
        permissionDetail="Daftar survei milik creator lain tidak dapat dibaca."
      >
        <div className="flex flex-col gap-5">
          <StateDebugHint routeId="creator-list" state={state} />
          {state === 'success' && (
            <SuccessBanner title="Draf tersimpan">
              <ActionLink to={ROUTES.creatorEdit('s_demo1')} variant="secondary">Buka editor</ActionLink>
            </SuccessBanner>
          )}
          {state === 'closed' && <Banner tone="warning" title="Ada versi yang ditutup">Survei dengan versi tertutup masih dapat dibaca riwayatnya.</Banner>}

          <Card className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <Field id="cari-survei" label="Cari survei" hint="Cari berdasarkan judul survei.">
                {(aria) => (
                  <TextInput
                    {...aria}
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Cari judul…"
                  />
                )}
              </Field>
            </div>
            <div className="min-w-0 sm:w-48">
              <label htmlFor="filter-status" className="text-body-sm font-bold text-ink">Status</label>
              <select
                id="filter-status"
                value={filter}
                onChange={(e) => setFilter(e.target.value as typeof filter)}
                className="mt-1 min-h-[52px] w-full rounded-md border border-n200 bg-n0 px-3 text-body-sm text-ink"
              >
                <option value="semua">Semua</option>
                <option value="draft">Draf</option>
                <option value="published">Terbit</option>
                <option value="closed">Ditutup</option>
                <option value="archived">Arsip</option>
              </select>
            </div>
            <Button onClick={() => {
              const newId = createSurvey();
              notify('Draf baru dibuat.');
              navigate(link(ROUTES.creatorEdit(newId)));
            }}>Buat draf baru</Button>
          </Card>

          {rows.length === 0 && query !== '' ? (
            <div className="rounded-lg border border-dashed border-n200 bg-n50 p-6">
              <p className="text-h3 font-bold text-ink">Hasil pencarian kosong</p>
              <p className="mt-1 text-body-sm text-muted">Tidak ada survei yang cocok dengan “{query}”.</p>
              <button
                type="button"
                onClick={() => setQuery('')}
                className="mt-3 min-h-[44px] rounded-md border border-n200 bg-n0 px-4 text-body-sm font-bold text-action hover:bg-action-soft"
              >
                Hapus kata kunci
              </button>
            </div>
          ) : (
            <Card className="overflow-hidden">
              <Table head={['Judul', 'Status', 'Versi', 'Diperbarui', 'Aksi']}>
                {rows.map((s) => {
                  const vs = versionsFor(s.id);
                  return (
                    <tr key={s.id}>
                      <Th>
                        <span className="block">{s.title}</span>
                        <span className="mt-1 block text-caption text-muted">{vs.length} versi · diperbarui {s.updated_at.slice(0, 10)}</span>
                      </Th>
                      <Td><Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge></Td>
                      <Td>{vs.length} versi</Td>
                      <Td>{s.updated_at.slice(0, 10)}</Td>
                      <Td>
                        <div className="flex flex-col gap-1">
                          <PlainLink to={link(ROUTES.creatorEdit(s.id))}>Buka editor</PlainLink>
                          <PlainLink to={link(ROUTES.creatorResults(s.id))}>Lihat hasil</PlainLink>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </Table>
            </Card>
          )}

          <div className="flex flex-wrap gap-3">
            <ActionLink to={ROUTES.creatorShare('s_demo1')} variant="secondary">Bagikan survei</ActionLink>
            <ActionLink to={ROUTES.creatorHistory('s_demo1')} variant="secondary">Lihat riwayat versi</ActionLink>
          </div>
        </div>
      </StateView>
      <DevStateSwitcher routeId="creator-list" />
    </Shell>
  );
}

/* ---------------- Editor ---------------- */

export function EditorPage() {
  const id = useSurveyId();
  const notify = useToast();
  const { drafts, revision } = useStore();
  void revision;
  const survey = findSurvey(id)!;
  const { state } = useScreenState('creator-edit');
  const versions = versionsFor(id);
  const activeVersion = versions.find((v) => v.id === survey.current_version_id) ?? versions[0];
  const items = activeVersion ? questionsFor(activeVersion.id) : [];
  const [title, setTitle] = useState(drafts[id]?.title ?? survey.title);
  const [codes, setCodes] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map((q) => [q.id, drafts[id]?.codes[q.id] ?? q.code])),
  );
  const [saved, setSaved] = useState<string | null>(null);

  const duplicate = Object.values(codes).filter((c, i, arr) => arr.indexOf(c) !== i);
  const missingLabel = items.filter((q) => q.label.trim() === '');
  const issues: string[] = [
    ...(title.trim() === '' ? ['Judul survei belum diisi.'] : []),
    ...(duplicate.length > 0 ? [`Kode item duplikat: ${[...new Set(duplicate)].join(', ')}.`] : []),
    ...(missingLabel.length > 0 ? [`Item tanpa label: ${missingLabel.map((q) => q.code).join(', ')}.`] : []),
  ];
  if (state === 'validation') {
    issues.push('Draf belum lengkap: periksa kembali kode dan label item.');
  }

  return (
    <Shell kind="creator" title="Editor instrumen" subtitle="Susun judul, petunjuk, kode item, dan urutan. Draf tersimpan di peramban ini.">
      <StateView
        routeId="creator-edit"
        state={state}
        emptyTitle="Belum ada pertanyaan"
        emptyDetail="Draf ini belum memiliki item. Tambahkan bagian dan pertanyaan sebelum diterbitkan."
        emptyAction={<ActionLink to={ROUTES.creatorPublish(id)} variant="secondary">Lihat validasi publikasi</ActionLink>}
        permissionDetail="Hanya pemilik survei yang dapat mengubah draf ini."
      >
        <div className="flex flex-col gap-5">
          <StateDebugHint routeId="creator-edit" state={state} />
          <SurveyNav id={id} />

          {state === 'success' && <SuccessBanner title="Draf disimpan">Perubahan tersimpan dan tetap tersedia saat Anda kembali.</SuccessBanner>}
          {(issues.length > 0) && (
            <ValidationSummary items={issues} />
          )}
          {saved && <Banner tone="success" title="Draf tersimpan">Disimpan pukul {formatWIB(saved)}.</Banner>}

          <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
            <div className="flex min-w-0 flex-col gap-5">
              <Card className="flex flex-col gap-4">
                <SectionTitle>Metadata survei</SectionTitle>
                <Field id="judul-survei" label="Judul survei" required>
                  {(aria) => <TextInput {...aria} value={title} onChange={(e) => setTitle(e.target.value)} />}
                </Field>
                <Field id="tujuan-survei" label="Tujuan" hint="Ditampilkan pada pemberitahuan responden.">
                  {(aria) => <TextArea {...aria} defaultValue={survey.purpose} />}
                </Field>
                <Field id="petunjuk-survei" label="Petunjuk pengisian">
                  {(aria) => <TextArea {...aria} defaultValue={survey.instructions} />}
                </Field>
              </Card>

              <Card className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <SectionTitle>Urutan pertanyaan</SectionTitle>
                  <Badge tone="info">Versi {activeVersion?.number ?? 'Belum ada'}</Badge>
                </div>
                <Divider />
                {items.length === 0 ? (
                  <Muted>Belum ada item pada versi ini.</Muted>
                ) : (
                  <ol className="flex flex-col gap-4">
                    {items.map((q) => (
                      <li key={q.id} className="rounded-md border border-n200 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <Label>{q.section}</Label>
                            <p className="mt-1 text-body font-bold text-ink">{q.order}. {q.label}</p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Badge tone={q.required ? 'danger' : 'neutral'}>{q.required ? 'Wajib' : 'Opsional'}</Badge>
                            <Badge tone="neutral">{q.type === 'likert' ? `Likert ${optionsFor(q.id).length} opsi` : 'Isian singkat'}</Badge>
                          </div>
                        </div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <Field id={`code-${q.id}`} label="Kode item" hint="Unik per versi.">
                            {(aria) => (
                              <TextInput
                                {...aria}
                                value={codes[q.id] ?? q.code}
                                onChange={(e) => setCodes((prev) => ({ ...prev, [q.id]: e.target.value }))}
                                className="font-mono"
                              />
                            )}
                          </Field>
                          <div>
                            <Label>Tipe</Label>
                            <p className="mt-2 text-body-sm text-ink">{q.type === 'likert' ? 'Likert numerik' : 'Jawaban singkat'}</p>
                            {q.dimension_code && <p className="mt-1 text-caption text-muted">Dimensi: <Code>{q.dimension_code}</Code></p>}
                          </div>
                        </div>
                        {q.type === 'likert' && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {optionsFor(q.id).map((o) => (
                              <Badge key={o.id} tone="neutral">
                                <Code>{o.value}</Code> · {o.label}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </Card>
            </div>

            <div className="flex flex-col gap-4">
              <Panel className="h-fit">
                <SectionTitle>Profil deployment</SectionTitle>
                <p className="mt-2 text-body-sm text-ink">{profileForSurvey(id).organization_name}</p>
                <p className="mt-2 text-caption text-muted">
                  Mode persetujuan: <Code>{profileForSurvey(id).consent_mode}</Code>
                </p>
              </Panel>
              <Panel className="h-fit">
                <SectionTitle>Tindakan</SectionTitle>
                <div className="mt-3 flex flex-col gap-2">
                  <Button variant="secondary" block onClick={() => {
                    const at = saveDraft(id, title, codes);
                    setSaved(at);
                    notify('Draf berhasil disimpan.');
                  }}>Simpan draf</Button>
                  <ActionLink to={ROUTES.creatorPreview(id)} variant="secondary" block>Lihat pratinjau</ActionLink>
                  <ActionLink to={ROUTES.creatorPublish(id)} block>Lanjut ke publikasi</ActionLink>
                </div>
                <p className="mt-3 text-caption text-muted">
                  Menyalin survei tidak membawa respons, undangan, atau bukti persetujuan.
                </p>
              </Panel>
            </div>
          </div>
        </div>
      </StateView>
      <DevStateSwitcher routeId="creator-edit" />
    </Shell>
  );
}

/* ---------------- Pratinjau ---------------- */

export function PreviewPage() {
  const id = useSurveyId();
  const survey = findSurvey(id)!;
  const { state, link } = useScreenState('creator-preview');
  const version = versionsFor(id).find((v) => v.id === survey.current_version_id) ?? versionsFor(id)[0];
  const items = version ? questionsFor(version.id) : [];

  return (
    <Shell kind="creator" title="Pratinjau tampilan responden" subtitle="Pratinjau terpisah dari data produksi.">
      <StateView
        routeId="creator-preview"
        state={state}
        emptyTitle="Belum ada item untuk dipratinjau"
        emptyDetail="Tambahkan pertanyaan pada editor terlebih dahulu."
        permissionDetail="Pratinjau hanya tersedia bagi pemilik survei."
      >
        <div className="flex flex-col gap-5">
          <StateDebugHint routeId="creator-preview" state={state} />
          <SurveyNav id={id} />
          <Banner tone="info" title="Mode pratinjau">
            Jawaban di sini hanya untuk memeriksa tampilan. Tidak ada yang tercatat sebagai respons.
          </Banner>
          {state === 'validation' && <ValidationSummary items={['Pada simulasi ini satu item wajib belum berlabel.', 'Periksa nilai opsi sebelum publikasi.']} />}
          {state === 'success' && <SuccessBanner title="Pratinjau selesai">Lanjutkan ke publikasi untuk menerbitkan versi.</SuccessBanner>}

          <Card className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <SectionTitle>{survey.title}</SectionTitle>
                <p className="mt-1 text-body-sm text-muted">{survey.purpose}</p>
              </div>
              <Badge tone="info">Versi {version?.number ?? 'Belum ada'} · <Code>{version?.id}</Code></Badge>
            </div>
            <Divider />
            {items.map((q) => (
              <fieldset key={q.id} className="flex flex-col gap-2 border-0 p-0">
                <legend className="text-body font-bold text-ink">
                  {q.order}. {q.label} {q.required && <span className="text-danger">*</span>}
                </legend>
                {q.type === 'likert' ? (
                  <div className="flex flex-wrap gap-2">
                    {optionsFor(q.id).map((o) => (
                      <label key={o.id} className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md border border-n200 px-3 text-body-sm text-ink">
                        <input type="radio" name={`preview-${q.id}`} className="size-5 accent-action" />
                        {o.label} <span className="font-mono text-caption text-muted">({o.value})</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <TextArea aria-label={q.label} placeholder="Isian singkat (opsional)" />
                )}
                {q.hint && <p className="text-caption text-muted">{q.hint}</p>}
              </fieldset>
            ))}
          </Card>

          <div className="flex flex-wrap gap-3">
            <ActionLink to={ROUTES.creatorPublish(id)}>Lanjut ke publikasi</ActionLink>
            <ActionLink to={link(ROUTES.creatorResults(id))} variant="secondary">Lihat hasil</ActionLink>
          </div>
        </div>
      </StateView>
      <DevStateSwitcher routeId="creator-preview" />
    </Shell>
  );
}

/* ---------------- Publikasi ---------------- */

export function PublishPage() {
  const id = useSurveyId();
  const notify = useToast();
  const { revision, session } = useStore();
  void revision;
  const survey = findSurvey(id)!;
  const { state, link } = useScreenState('creator-publish');
  const [confirm, setConfirm] = useState(false);
  const [publishedToken, setPublishedToken] = useState<string | null>(null);
  const items = questionsFor(survey.current_version_id ?? '');
  const blocking = state === 'validation' || state === 'closed' || state === 'permission-denied' || state === 'error' || state === 'loading';

  return (
    <Shell kind="creator" title="Publikasi versi" subtitle="Terbitkan versi tetap dan bagikan tautan kepada responden.">
      <StateView
        routeId="creator-publish"
        state={state}
        permissionDetail="Publikasi hanya dapat dilakukan pemilik survei."
      >
        <div className="flex flex-col gap-5">
          <StateDebugHint routeId="creator-publish" state={state} />
          <SurveyNav id={id} />

          {state === 'success' && (
            <SuccessBanner title="Versi diterbitkan">
              Tautan responden siap dibagikan.
              <div className="mt-2"><ActionLink to={ROUTES.creatorShare(id)} variant="secondary">Kelola tautan</ActionLink></div>
            </SuccessBanner>
          )}
          {state === 'validation' && (
            <ValidationSummary items={[
              'Item wajib tanpa label harus diperbaiki.',
              'Kode item duplikat dalam satu versi harus unik.',
              'Nilai opsi harus berada pada konfigurasi versi.',
            ]} />
          )}

          <Card className="flex flex-col gap-4">
            <SectionTitle>Pemeriksaan sebelum terbit</SectionTitle>
            <Table head={['Pemeriksaan', 'Hasil']}>
              <tr><Th>Judul dan tujuan</Th><Td><Badge tone="success">Lengkap</Badge></Td></tr>
              <tr><Th>Jumlah item</Th><Td>{items.length} item</Td></tr>
              <tr><Th>Kode unik per versi</Th><Td>{state === 'validation' ? <Badge tone="danger">Duplikat</Badge> : <Badge tone="success">Unik</Badge>}</Td></tr>
              <tr><Th>Label tiap item</Th><Td>{state === 'validation' ? <Badge tone="danger">Ada yang kosong</Badge> : <Badge tone="success">Lengkap</Badge>}</Td></tr>
              <tr><Th>Versi pemberitahuan</Th><Td><Code>1.0</Code></Td></tr>
            </Table>
            {state === 'closed' && <Banner tone="warning" title="Versi ini ditutup">Publikasi baru memerlukan draf versi berikutnya.</Banner>}
          </Card>

          <Card className="flex flex-col gap-3">
            <Checkbox
              id="konfirmasi-terbit"
              label="Saya memahami bahwa perubahan isi setelah terbit memerlukan versi baru."
              checked={confirm}
              onChange={setConfirm}
            />
            <div className="flex flex-wrap gap-3">
              <Button disabled={!confirm || blocking} loading={state === 'loading'} onClick={() => {
                const token = publishVersion(id);
                if (!token) { notify('Tidak ada draf yang dapat diterbitkan.', 'danger'); return; }
                setPublishedToken(token);
                notify('Versi diterbitkan dan tautan dibuat.');
              }}>
                Terbitkan versi
              </Button>
              <ActionLink to={ROUTES.creatorEdit(id)} variant="secondary">Kembali ke editor</ActionLink>
              <ActionLink to={link(ROUTES.creatorShare(id))} variant="secondary" disabled={!publishedToken}>
                Kelola tautan
              </ActionLink>
            </div>
            <p className="text-caption text-muted">
              {session ? `Diterbitkan oleh ${session.name}. ` : ''}Perubahan isi setelah terbit memerlukan versi baru.
            </p>
            {publishedToken && (
              <Banner tone="success" title="Tautan responden">
                <PlainLink to={ROUTES.respondentIntro(publishedToken)}>/s/{publishedToken}</PlainLink>
                <div className="mt-2"><ActionLink to={ROUTES.creatorShare(id)} variant="secondary">Buka halaman pembagian</ActionLink></div>
              </Banner>
            )}
          </Card>
        </div>
      </StateView>
      <DevStateSwitcher routeId="creator-publish" />
    </Shell>
  );
}
