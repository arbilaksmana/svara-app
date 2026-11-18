'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
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
import { StateView, SuccessBanner, ValidationSummary } from '../components/StateView';
import { useScreenState } from '../lib/state';
import { ROUTES } from '../lib/routes';
import { findSurvey, questionsFor, optionsFor, surveys, versionsFor, editorVersionFor, draftVersionFor } from '../lib/fixtures/surveys';
import { formatWIB } from '../lib/summary';
import { profileForSurvey } from '../lib/fixtures/profiles';
import { CONSENT_MODE_LABEL, STATUS_LABEL } from '../lib/labels';
import { useToast } from '../components/Toast';
import { ApiError } from '../lib/api';
import { createSurvey, duplicateVersion, publishVersion, saveDraft, useStore } from '../lib/store';

const STATUS_TONE = {
  draft: 'neutral',
  published: 'success',
  closed: 'warning',
  archived: 'neutral',
} as const;

function MissingSurvey() {
  return (
    <Card>
      <h1 className="text-h2 font-bold text-ink">Survei tidak ditemukan</h1>
      <p className="mt-2 text-body text-muted">Survei ini tidak ada dalam cakupan akun Anda.</p>
      <div className="mt-4"><ActionLink to={ROUTES.creator}>Kembali ke daftar survei</ActionLink></div>
    </Card>
  );
}

export function SurveyNav({ id }: { id: string }) {
  const pathname = usePathname() ?? '';
  const { session } = useStore();
  const survey = findSurvey(id);
  const canManage = Boolean(session?.serverRole === 'creator' && survey?.owner_id === session.id);
  const links = canManage
    ? [
        { to: ROUTES.creatorEdit(id), label: 'Editor' },
        { to: ROUTES.creatorPreview(id), label: 'Pratinjau' },
        { to: ROUTES.creatorPublish(id), label: 'Publikasi' },
        { to: ROUTES.creatorShare(id), label: 'Bagikan' },
        { to: ROUTES.creatorResults(id), label: 'Hasil' },
        { to: ROUTES.creatorSettings(id), label: 'Pengaturan' },
        { to: ROUTES.creatorHistory(id), label: 'Riwayat' },
      ]
    : [{ to: ROUTES.creatorResults(id), label: 'Hasil' }];
  return (
    <div className="mb-5">
      <nav aria-label="Navigasi survei" className="flex flex-wrap gap-1 border-b border-n200 pb-2">
        {links.map((l) => (
          <ActionLink
            key={l.to}
            to={l.to}
            variant="ghost"
            className="px-3 text-body-sm aria-[current=page]:bg-n100 aria-[current=page]:text-action"
            ariaCurrent={pathname === l.to ? 'page' : undefined}
          >
            {l.label}
          </ActionLink>
        ))}
      </nav>
    </div>
  );
}

/* ---------------- Daftar survei ---------------- */

export function CreatorListPage() {
  const { state, link } = useScreenState('creator-list');
  const router = useRouter();
  const notify = useToast();
  const { revision, session } = useStore();
  void revision;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'semua' | 'draft' | 'published' | 'closed' | 'archived'>('semua');
  const [busy, setBusy] = useState(false);
  const [duplicating, setDuplicating] = useState<string | null>(null);
  const canCreate = session?.serverRole === 'creator';
  const visible = surveys;

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
            <Button
              disabled={busy || !canCreate || state === 'closed'}
              loading={busy}
              onClick={() => {
                setBusy(true);
                void createSurvey()
                  .then((newId) => {
                    notify('Draf baru dibuat.');
                    router.push(link(ROUTES.creatorEdit(newId)));
                  })
                  .catch((error: unknown) => notify(error instanceof Error ? error.message : 'Draf gagal dibuat.', 'danger'))
                  .finally(() => setBusy(false));
              }}
            >
              {canCreate ? 'Buat draf baru' : 'Hanya creator dapat membuat survei'}
            </Button>
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
                  const canManage = canCreate && s.owner_id === session?.id;
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
                        <div className="flex flex-col items-start gap-1">
                          {canManage && <PlainLink to={link(ROUTES.creatorEdit(s.id))}>Buka editor</PlainLink>}
                          <PlainLink to={link(ROUTES.creatorResults(s.id))}>Lihat hasil</PlainLink>
                          {canManage && <Button
                            variant="ghost"
                            className="px-0 text-action underline"
                            loading={duplicating === s.id}
                            disabled={duplicating !== null || state === 'closed'}
                            onClick={() => {
                              setDuplicating(s.id);
                              void duplicateVersion(s.id)
                                .then((newId) => {
                                  notify('Survei disalin tanpa respons, undangan, atau izin khusus.');
                                  router.push(link(ROUTES.creatorEdit(newId)));
                                })
                                .catch((error: unknown) => notify(error instanceof Error ? error.message : 'Survei gagal disalin.', 'danger'))
                                .finally(() => setDuplicating(null));
                            }}
                          >
                            Salin survei
                          </Button>}
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </Table>
            </Card>
          )}

        </div>
      </StateView>
      
    </Shell>
  );
}

/* ---------------- Editor ---------------- */

interface EditableOption {
  key: string;
  label: string;
  value: string;
}

interface EditableQuestion {
  key: string;
  code: string;
  type: 'likert' | 'short_text' | 'single_choice';
  required: boolean;
  section: string;
  label: string;
  hint: string;
  group_code: string;
  dimension_code: string;
  options: EditableOption[];
}

let editorKeyCounter = 0;
function nextEditorKey(prefix: string): string {
  editorKeyCounter += 1;
  return `${prefix}-${editorKeyCounter}`;
}

function editableQuestionsFor(versionId: string, drafts: Record<string, { codes: Record<string, string> }>, surveyId: string): EditableQuestion[] {
  return questionsFor(versionId).map((question) => ({
    key: question.id,
    code: drafts[surveyId]?.codes[question.id] ?? question.code,
    type: question.type,
    required: question.required,
    section: question.section,
    label: question.label,
    hint: question.hint ?? '',
    group_code: question.group_code ?? '',
    dimension_code: question.dimension_code ?? '',
    options: optionsFor(question.id).map((option) => ({
      key: option.id,
      label: option.label,
      value: String(option.value ?? 0),
    })),
  }));
}

function blankQuestion(): EditableQuestion {
  return {
    key: nextEditorKey('q'),
    code: '',
    type: 'likert',
    required: true,
    section: 'Bagian 1',
    label: '',
    hint: '',
    group_code: '',
    dimension_code: '',
    options: [
      { key: nextEditorKey('o'), label: '', value: '1' },
      { key: nextEditorKey('o'), label: '', value: '2' },
    ],
  };
}

export function EditorPage({ id }: { id: string }) {
  const notify = useToast();
  const { drafts, revision } = useStore();
  void revision;
  const survey = findSurvey(id);
  const { state } = useScreenState('creator-edit');
  const activeVersion = editorVersionFor(id);
  const [title, setTitle] = useState(drafts[id]?.title ?? survey?.title ?? '');
  const [purpose, setPurpose] = useState(survey?.purpose ?? '');
  const [instructions, setInstructions] = useState(survey?.instructions ?? '');
  const [editorQuestions, setEditorQuestions] = useState<EditableQuestion[]>(() =>
    activeVersion ? editableQuestionsFor(activeVersion.id, drafts, id) : [],
  );
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const duplicate = editorQuestions
    .map((question) => question.code.trim().toUpperCase())
    .filter((code, index, list) => code !== '' && list.indexOf(code) !== index);
  const missingLabel = editorQuestions.filter((question) => question.label.trim() === '');
  const invalidOptions = editorQuestions.filter((question) => {
    if (question.type === 'short_text') return question.options.length > 0;
    return question.options.length < 2 || question.options.some((option) => option.label.trim() === '');
  });
  const issues: string[] = [
    ...(title.trim() === '' ? ['Judul survei belum diisi.'] : []),
    ...(editorQuestions.length === 0 ? ['Minimal satu pertanyaan diperlukan.'] : []),
    ...(duplicate.length > 0 ? [`Kode item duplikat: ${[...new Set(duplicate)].join(', ')}.`] : []),
    ...(missingLabel.length > 0 ? [`Item tanpa label: ${missingLabel.map((q) => q.code || '(tanpa kode)').join(', ')}.`] : []),
    ...(invalidOptions.length > 0
      ? [`Opsi belum lengkap pada: ${invalidOptions.map((q) => q.code || '(tanpa kode)').join(', ')}. Pilihan non-teks memerlukan minimal dua opsi berlabel.`]
      : []),
  ];
  if (state === 'validation') {
    issues.push('Draf belum lengkap: periksa kembali kode, label, dan opsi item.');
  }

  if (!survey) {
    return (
      <Shell kind="creator" title="Editor instrumen" subtitle="Survei tidak ditemukan.">
        <MissingSurvey />
      </Shell>
    );
  }

  const patchQuestion = (key: string, patch: Partial<EditableQuestion>) => {
    setEditorQuestions((current) => current.map((question) => (question.key === key ? { ...question, ...patch } : question)));
  };

  const patchOption = (questionKey: string, optionKey: string, patch: Partial<EditableOption>) => {
    setEditorQuestions((current) =>
      current.map((question) =>
        question.key === questionKey
          ? {
              ...question,
              options: question.options.map((option) => (option.key === optionKey ? { ...option, ...patch } : option)),
            }
          : question,
      ),
    );
  };

  const moveQuestion = (index: number, delta: -1 | 1) => {
    setEditorQuestions((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(index, 1);
      if (moved) next.splice(target, 0, moved);
      return next;
    });
  };

  const onSave = () => {
    setBusy(true);
    setSaveError(null);
    void saveDraft(id, {
      title,
      purpose,
      object_label: survey.object_label,
      instructions,
      questions: editorQuestions.map((question, index) => ({
        code: question.code.trim() || `Q${String(index + 1).padStart(2, '0')}`,
        type: question.type,
        required: question.required,
        section: question.section.trim() || 'Bagian 1',
        label: question.label.trim(),
        hint: question.hint.trim() || null,
        group_code: question.group_code.trim() || null,
        dimension_code: question.dimension_code.trim() || null,
        direction: null,
        options: question.type === 'short_text'
          ? []
          : question.options.map((option, optionIndex) => ({
              label: option.label,
              value: Number(option.value) || optionIndex + 1,
            })),
      })),
    })
      .then((at) => {
        setSaved(at);
        notify('Draf berhasil disimpan.');
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Draf gagal disimpan.';
        setSaveError(message);
        notify(message, 'danger');
      })
      .finally(() => setBusy(false));
  };

  return (
    <Shell kind="creator" title="Editor instrumen" subtitle="Susun judul, petunjuk, kode item, dan urutan. Draf tersimpan di server." bottomInset>
      <StateView
        routeId="creator-edit"
        state={state}
        emptyTitle="Belum ada pertanyaan"
        emptyDetail="Draf ini belum memiliki item. Tambahkan bagian dan pertanyaan sebelum diterbitkan."
        emptyAction={<ActionLink to={ROUTES.creatorPublish(id)} variant="secondary">Lihat validasi publikasi</ActionLink>}
        permissionDetail="Hanya pemilik survei yang dapat mengubah draf ini."
      >
        <div className="flex flex-col gap-5">
          
          <SurveyNav id={id} />

          {state === 'success' && <SuccessBanner title="Draf disimpan">Perubahan tersimpan dan tetap tersedia saat Anda kembali.</SuccessBanner>}
          {(issues.length > 0) && (
            <ValidationSummary items={issues} />
          )}
          {saved && <Banner tone="success" title="Draf tersimpan">Disimpan {formatWIB(saved)}.</Banner>}
          {saveError && <Banner tone="danger" title="Draf gagal disimpan">{saveError}</Banner>}

          <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
            <div className="flex min-w-0 flex-col gap-5">
              <Card className="flex flex-col gap-4">
                <SectionTitle>Metadata survei</SectionTitle>
                <Field id="judul-survei" label="Judul survei" required>
                  {(aria) => <TextInput {...aria} value={title} onChange={(e) => setTitle(e.target.value)} />}
                </Field>
                <Field id="tujuan-survei" label="Tujuan" hint="Ditampilkan pada pemberitahuan responden.">
                  {(aria) => <TextArea {...aria} value={purpose} onChange={(e) => setPurpose(e.target.value)} />}
                </Field>
                <Field id="petunjuk-survei" label="Petunjuk pengisian">
                  {(aria) => <TextArea {...aria} value={instructions} onChange={(e) => setInstructions(e.target.value)} />}
                </Field>
              </Card>

              <Card className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <SectionTitle>Pertanyaan</SectionTitle>
                  <div className="flex items-center gap-2">
                    <Badge tone="info">Versi {activeVersion?.number ?? 'Belum ada'}</Badge>
                    <Button variant="secondary" onClick={() => setEditorQuestions((current) => [...current, blankQuestion()])}>
                      Tambah pertanyaan
                    </Button>
                  </div>
                </div>
                <Divider />
                {editorQuestions.length === 0 ? (
                  <Muted>Belum ada item pada versi ini. Tambahkan pertanyaan pertama sebelum menyimpan atau menerbitkan.</Muted>
                ) : (
                  <ol className="flex flex-col gap-4">
                    {editorQuestions.map((question, index) => (
                      <li key={question.key} className="rounded-md border border-n200 p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 flex-1">
                            <Label>{question.section || 'Bagian 1'}</Label>
                            <p className="mt-1 text-body font-bold text-ink">{index + 1}. {question.label || 'Pertanyaan tanpa label'}</p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button variant="ghost" disabled={index === 0} onClick={() => moveQuestion(index, -1)} aria-label={`Naikkan pertanyaan ${index + 1}`}>Naik</Button>
                            <Button variant="ghost" disabled={index === editorQuestions.length - 1} onClick={() => moveQuestion(index, 1)} aria-label={`Turunkan pertanyaan ${index + 1}`}>Turun</Button>
                            <Button
                              variant="ghost"
                              onClick={() => setEditorQuestions((current) => current.filter((item) => item.key !== question.key))}
                              aria-label={`Hapus pertanyaan ${index + 1}`}
                            >
                              Hapus
                            </Button>
                          </div>
                        </div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <Field id={`code-${question.key}`} label="Kode item" hint="Unik per versi.">
                            {(aria) => (
                              <TextInput
                                {...aria}
                                value={question.code}
                                onChange={(e) => patchQuestion(question.key, { code: e.target.value })}
                                className="font-mono"
                              />
                            )}
                          </Field>
                          <div className="flex flex-col gap-1">
                            <Label htmlFor={`type-${question.key}`}>Tipe pertanyaan</Label>
                            <select
                              id={`type-${question.key}`}
                              value={question.type}
                              onChange={(e) => {
                                const type = e.target.value as EditableQuestion['type'];
                                const options = type === 'short_text'
                                  ? []
                                  : question.options.length >= 2
                                    ? question.options
                                    : [
                                        { key: nextEditorKey('o'), label: '', value: '1' },
                                        { key: nextEditorKey('o'), label: '', value: '2' },
                                      ];
                                patchQuestion(question.key, { type, options });
                              }}
                              className="min-h-[44px] rounded-sm border border-n300 bg-n0 px-3 text-body-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
                            >
                              <option value="likert">Likert numerik</option>
                              <option value="single_choice">Pilihan tunggal</option>
                              <option value="short_text">Isian singkat</option>
                            </select>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-col gap-3">
                          <Field id={`label-${question.key}`} label="Label pertanyaan" required>
                            {(aria) => (
                              <TextInput {...aria} value={question.label} onChange={(e) => patchQuestion(question.key, { label: e.target.value })} />
                            )}
                          </Field>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <Field id={`section-${question.key}`} label="Bagian">
                              {(aria) => (
                                <TextInput {...aria} value={question.section} onChange={(e) => patchQuestion(question.key, { section: e.target.value })} />
                              )}
                            </Field>
                            <Field id={`hint-${question.key}`} label="Petunjuk item">
                              {(aria) => (
                                <TextInput {...aria} value={question.hint} onChange={(e) => patchQuestion(question.key, { hint: e.target.value })} />
                              )}
                            </Field>
                            <Field id={`group-${question.key}`} label="Kode grup" hint="Opsional.">
                              {(aria) => (
                                <TextInput {...aria} value={question.group_code} onChange={(e) => patchQuestion(question.key, { group_code: e.target.value })} className="font-mono" />
                              )}
                            </Field>
                            <Field id={`dimension-${question.key}`} label="Dimensi" hint="Opsional.">
                              {(aria) => (
                                <TextInput {...aria} value={question.dimension_code} onChange={(e) => patchQuestion(question.key, { dimension_code: e.target.value })} className="font-mono" />
                              )}
                            </Field>
                          </div>
                          <Checkbox
                            id={`required-${question.key}`}
                            label="Wajib dijawab"
                            checked={question.required}
                            onChange={(checked) => patchQuestion(question.key, { required: checked })}
                          />
                        </div>
                        {question.type !== 'short_text' && (
                          <div className="mt-4 rounded-sm border border-n200 bg-n50 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <Label>Opsi dan nilai skala</Label>
                              <Button
                                variant="ghost"
                                onClick={() =>
                                  patchQuestion(question.key, {
                                    options: [
                                      ...question.options,
                                      { key: nextEditorKey('o'), label: '', value: String(question.options.length + 1) },
                                    ],
                                  })
                                }
                              >
                                Tambah opsi
                              </Button>
                            </div>
                            <div className="mt-2 flex flex-col gap-2">
                              {question.options.map((option, optionIndex) => (
                                <div key={option.key} className="flex flex-wrap items-end gap-2">
                                  <div className="min-w-[180px] flex-1">
                                    <Field id={`option-label-${option.key}`} label={`Label opsi ${optionIndex + 1}`}>
                                      {(aria) => (
                                        <TextInput {...aria} value={option.label} onChange={(e) => patchOption(question.key, option.key, { label: e.target.value })} />
                                      )}
                                    </Field>
                                  </div>
                                  <div className="w-24">
                                    <Field id={`option-value-${option.key}`} label="Nilai">
                                      {(aria) => (
                                        <TextInput
                                          {...aria}
                                          type="number"
                                          value={option.value}
                                          onChange={(e) => patchOption(question.key, option.key, { value: e.target.value })}
                                          className="font-mono"
                                        />
                                      )}
                                    </Field>
                                  </div>
                                  <Button
                                    variant="ghost"
                                    onClick={() => patchQuestion(question.key, { options: question.options.filter((item) => item.key !== option.key) })}
                                    aria-label={`Hapus opsi ${optionIndex + 1}`}
                                  >
                                    Hapus
                                  </Button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </Card>
            </div>

            <div className="flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
              <Panel className="h-fit">
                <SectionTitle>Profil deployment</SectionTitle>
                <p className="mt-2 text-body-sm text-ink">{profileForSurvey(id).organization_name}</p>
                <p className="mt-2 text-caption text-muted">
                  Mode persetujuan: {CONSENT_MODE_LABEL[profileForSurvey(id).consent_mode]}
                </p>
              </Panel>
              <Panel className="h-fit">
                <SectionTitle>Tindakan</SectionTitle>
                <div className="mt-3 flex flex-col gap-2">
                  <Button variant="secondary" block onClick={onSave} loading={busy} disabled={busy || state === 'loading' || state === 'closed'}>Simpan draf</Button>
                  <ActionLink to={ROUTES.creatorPreview(id)} variant="secondary" block>Lihat pratinjau</ActionLink>
                  <ActionLink to={ROUTES.creatorPublish(id)} block>Lanjut ke publikasi</ActionLink>
                </div>
                <p className="mt-3 text-caption text-muted">
                  Menyalin survei tidak membawa respons, undangan, atau bukti persetujuan.
                </p>
              </Panel>
            </div>
          </div>

          <div role="region" aria-label="Aksi editor" className="fixed inset-x-0 bottom-0 z-20 border-t border-n200 bg-n0 px-4 py-3 lg:hidden">
            <div className="mx-auto grid max-w-[1200px] grid-cols-2 gap-2">
              <Button variant="secondary" block onClick={onSave} loading={busy} disabled={busy || state === 'loading' || state === 'closed'}>Simpan draf</Button>
              <ActionLink to={ROUTES.creatorPublish(id)} block>Publikasi</ActionLink>
            </div>
          </div>
        </div>
      </StateView>
      
    </Shell>
  );
}

/* ---------------- Pratinjau ---------------- */

export function PreviewPage({ id }: { id: string }) {
  const survey = findSurvey(id);
  const { state, link } = useScreenState('creator-preview');
  const version = editorVersionFor(id);
  const items = version ? questionsFor(version.id) : [];

  if (!survey) {
    return (
      <Shell kind="creator" title="Pratinjau tampilan responden" subtitle="Survei tidak ditemukan.">
        <MissingSurvey />
      </Shell>
    );
  }

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
                {q.type !== 'short_text' ? (
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
      
    </Shell>
  );
}

/* ---------------- Publikasi ---------------- */

export function PublishPage({ id }: { id: string }) {
  const notify = useToast();
  const { revision, session } = useStore();
  void revision;
  const survey = findSurvey(id);
  const { state, link } = useScreenState('creator-publish');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishBlockers, setPublishBlockers] = useState<string[]>([]);
  const [publishedToken, setPublishedToken] = useState<string | null>(null);
  const version = draftVersionFor(id) ?? editorVersionFor(id);
  const items = version ? questionsFor(version.id) : [];
  const duplicateCodes = items
    .map((item) => item.code.trim().toUpperCase())
    .filter((code, index, list) => code !== '' && list.indexOf(code) !== index);
  const emptyLabels = items.filter((item) => item.label.trim() === '');
  const badOptions = items.filter((item) => {
    const options = optionsFor(item.id);
    if (item.type === 'short_text') return options.length > 0;
    return options.length < 2 || options.some((option) => option.label.trim() === '');
  });
  const blockers = [
    ...(survey?.title.trim() ? [] : ['Judul survei wajib diisi.']),
    ...(survey?.purpose.trim() ? [] : ['Tujuan survei wajib diisi.']),
    ...(items.length > 0 ? [] : ['Minimal satu pertanyaan diperlukan.']),
    ...(duplicateCodes.length > 0 ? [`Kode item duplikat: ${[...new Set(duplicateCodes)].join(', ')}.`] : []),
    ...(emptyLabels.length > 0 ? [`Label kosong pada: ${emptyLabels.map((item) => item.code).join(', ')}.`] : []),
    ...(badOptions.length > 0 ? [`Opsi belum lengkap pada: ${badOptions.map((item) => item.code).join(', ')}.`] : []),
  ];
  const blocking = blockers.length > 0 || state === 'closed' || state === 'permission-denied' || state === 'error' || state === 'loading';

  if (!survey) {
    return (
      <Shell kind="creator" title="Publikasi versi" subtitle="Survei tidak ditemukan.">
        <MissingSurvey />
      </Shell>
    );
  }

  return (
    <Shell kind="creator" title="Publikasi versi" subtitle="Terbitkan versi tetap dan bagikan tautan kepada responden.">
      <StateView
        routeId="creator-publish"
        state={state}
        permissionDetail="Publikasi hanya dapat dilakukan pemilik survei."
      >
        <div className="flex flex-col gap-5">
          
          <SurveyNav id={id} />

          {state === 'success' && (
            <SuccessBanner title="Versi diterbitkan">
              Tautan responden siap dibagikan.
              <div className="mt-2"><ActionLink to={ROUTES.creatorShare(id)} variant="secondary">Kelola tautan</ActionLink></div>
            </SuccessBanner>
          )}
          {blockers.length > 0 && <ValidationSummary items={blockers} />}
          {publishBlockers.length > 0 && <ValidationSummary items={publishBlockers} />}
          {state === 'validation' && blockers.length === 0 && (
            <ValidationSummary items={['Pemeriksaan manual diminta. Periksa kembali seluruh item sebelum menerbitkan.']} />
          )}

          <Card className="flex flex-col gap-4">
            <SectionTitle>Pemeriksaan sebelum terbit</SectionTitle>
            <Table head={['Pemeriksaan', 'Hasil']}>
              <tr><Th>Judul dan tujuan</Th><Td>{survey.title.trim() && survey.purpose.trim() ? <Badge tone="success">Lengkap</Badge> : <Badge tone="danger">Belum lengkap</Badge>}</Td></tr>
              <tr><Th>Jumlah item</Th><Td>{items.length} item</Td></tr>
              <tr><Th>Kode unik per versi</Th><Td>{duplicateCodes.length === 0 ? <Badge tone="success">Unik</Badge> : <Badge tone="danger">Duplikat</Badge>}</Td></tr>
              <tr><Th>Label tiap item</Th><Td>{emptyLabels.length === 0 ? <Badge tone="success">Lengkap</Badge> : <Badge tone="danger">Ada yang kosong</Badge>}</Td></tr>
              <tr><Th>Opsi pilihan</Th><Td>{badOptions.length === 0 ? <Badge tone="success">Lengkap</Badge> : <Badge tone="danger">Perlu diperbaiki</Badge>}</Td></tr>
            </Table>
          {state === 'closed' && <Banner tone="warning" title="Versi ini ditutup">Publikasi baru memerlukan draf versi berikutnya.</Banner>}
          {publishError && <Banner tone="danger" title="Publikasi gagal">{publishError}</Banner>}
          </Card>

          <Card className="flex flex-col gap-3">
            <Checkbox
              id="konfirmasi-terbit"
              label="Saya memahami bahwa perubahan isi setelah terbit memerlukan versi baru."
              checked={confirm}
              onChange={setConfirm}
            />
            <div className="flex flex-wrap gap-3">
              <Button disabled={!confirm || blocking || busy} loading={busy} onClick={() => {
                setBusy(true);
                setPublishError(null);
                setPublishBlockers([]);
                void publishVersion(id)
                  .then((token) => {
                    if (!token) {
                      notify('Tidak ada draf yang dapat diterbitkan.', 'danger');
                      return;
                    }
                    setPublishedToken(token);
                    notify('Versi diterbitkan dan tautan dibuat.');
                  })
                  .catch((error: unknown) => {
                    const message = error instanceof Error ? error.message : 'Versi gagal diterbitkan.';
                    if (error instanceof ApiError) {
                      const details = error.details as { errors?: unknown } | undefined;
                      if (Array.isArray(details?.errors)) {
                        setPublishBlockers(details.errors.filter((item): item is string => typeof item === 'string'));
                      }
                    }
                    setPublishError(message);
                    notify(message, 'danger');
                  })
                  .finally(() => setBusy(false));
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
      
    </Shell>
  );
}
