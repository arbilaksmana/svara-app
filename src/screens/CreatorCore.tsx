'use client';

import { useEffect, useRef, useState, type MouseEvent } from 'react';
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
  ConfirmDialog,
  Divider,
  EmptyState,
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
import { findSurvey, questionsFor, optionsFor, surveys, versionsFor, editorVersionFor, draftVersionFor, publishedVersionFor } from '../lib/fixtures/surveys';
import { formatWIB } from '../lib/summary';
import { CONSENT_MODE_LABEL, STATUS_LABEL } from '../lib/labels';
import { useToast } from '../components/Toast';
import { ApiError, previewSurveyChange, type SurveyPayload, type SurveyScope } from '../lib/api';
import { NavigationGuardProvider } from '../lib/navigation-guard';
import { ShortTextAnswer } from './Respondent';
import { allPublicLinks, canManageAs, createSurvey, duplicateVersion, publishVersion, saveDraft, surveyProfileOf, useStore } from '../lib/store';

const STATUS_TONE = {
  draft: 'neutral',
  published: 'success',
  closed: 'warning',
  archived: 'neutral',
} as const;

export function MissingSurvey() {
  return (
    <Card>
      <h2 className="text-h2 font-bold text-ink">Survei tidak ditemukan</h2>
      <p className="mt-2 text-body text-muted">Survei ini tidak ada dalam cakupan akun Anda.</p>
      <div className="mt-4"><ActionLink to={ROUTES.creator}>Kembali ke daftar survei</ActionLink></div>
    </Card>
  );
}

export function SurveyNav({ id }: { id: string }) {
  const pathname = usePathname() ?? '';
  const { session } = useStore();
  const survey = findSurvey(id);
  const canManage = canManageAs(session, survey);
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
  const [scopeChoice, setScopeChoice] = useState<SurveyScope | null>(null);
  const [busy, setBusy] = useState(false);
  const [duplicating, setDuplicating] = useState<string | null>(null);
  const canCreate = session?.serverRole === 'creator';
  const scope: SurveyScope = scopeChoice ?? (session?.organizationId ? 'organization' : 'individual');
  const scopeHint =
    scope === 'organization'
      ? 'Lingkup organisasi: admin organisasi ikut mengelola dan melihat hasil.'
      : 'Lingkup individu: hanya Anda yang mengelola; admin organisasi tidak melihatnya.';
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

          <Card className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
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
            <div className="min-w-0 lg:w-48">
              <label htmlFor="filter-status" className="text-body-sm font-bold text-ink">Status</label>
              <select
                id="filter-status"
                value={filter}
                onChange={(e) => setFilter(e.target.value as typeof filter)}
                className="mt-1 min-h-[52px] w-full rounded-md border border-control-border bg-n0 px-3 text-body-sm text-ink"
              >
                <option value="semua">Semua</option>
                <option value="draft">Draf</option>
                <option value="published">Terbit</option>
                <option value="closed">Ditutup</option>
                <option value="archived">Arsip</option>
              </select>
            </div>
            {session?.organizationId ? (
              <div className="min-w-0 lg:w-48">
                <label htmlFor="new-survey-scope" className="text-body-sm font-bold text-ink">Lingkup</label>
                <select
                  id="new-survey-scope"
                  value={scope}
                  onChange={(e) => setScopeChoice(e.target.value as SurveyScope)}
                  aria-describedby="new-survey-scope-hint"
                  className="mt-1 min-h-[52px] w-full rounded-md border border-control-border bg-n0 px-3 text-body-sm text-ink"
                >
                  <option value="organization">Organisasi</option>
                  <option value="individual">Individu</option>
                </select>
              </div>
            ) : null}
            {session?.organizationId ? (
              <p id="new-survey-scope-hint" className="text-caption text-muted lg:order-last lg:basis-full">{scopeHint}</p>
            ) : null}
            <Button
              disabled={busy || !canCreate || state === 'closed'}
              loading={busy}
              onClick={() => {
                setBusy(true);
                void createSurvey(scope)
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

          {rows.length === 0 ? (
            query !== '' ? (
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
              <EmptyState
                title={filter === 'semua' ? 'Belum memiliki survei' : 'Tidak ada survei pada status ini'}
              >
                {filter === 'semua'
                  ? 'Buat draf pertama untuk mulai menyusun pertanyaan dan skala.'
                  : 'Ubah filter status untuk melihat survei lain.'}
              </EmptyState>
            )
          ) : (
            <Card className="overflow-hidden">
              <Table head={['Judul', 'Status', 'Versi', 'Diperbarui', 'Aksi']}>
                {rows.map((s) => {
                  const vs = versionsFor(s.id);
                  const canManage = canManageAs(session, s);
                  return (
                    <tr key={s.id}>
                      <Th className="w-[38%]">
                        <span className="block">{s.title}</span>
                        <span className="mt-1 block text-caption text-muted">{canCreate && !canManage ? 'Diberikan akses · ' : ''}{vs.length} versi · {s.organization_id ? 'Lingkup organisasi' : 'Lingkup individu'} · diperbarui {formatWIB(s.updated_at)}</span>
                      </Th>
                      <Td><Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge></Td>
                      <Td>{vs.length} versi</Td>
                      <Td>{formatWIB(s.updated_at)}</Td>
                      <Td>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
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
  direction: string | null;
  options: EditableOption[];
}

type PendingDelete =
  | { kind: 'question'; key: string; label: string }
  | { kind: 'option'; questionKey: string; key: string; label: string };

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
    direction: question.direction ?? null,
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
    direction: null,
    options: [
      { key: nextEditorKey('o'), label: '', value: '1' },
      { key: nextEditorKey('o'), label: '', value: '2' },
    ],
  };
}

export function EditorPage({ id }: { id: string }) {
  const notify = useToast();
  const { drafts, revision, session } = useStore();
  const profile = surveyProfileOf(id);
  void revision;
  const survey = findSurvey(id);
  const canManage = canManageAs(session, survey);
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
  const [attempted, setAttempted] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [pendingSave, setPendingSave] = useState<{ payload: SurveyPayload; snapshot: string; affectedResponses: number } | null>(null);
  const saveTriggerRef = useRef<HTMLButtonElement | null>(null);
  const baselineRef = useRef<string | null>(null);
  const snapshot = JSON.stringify({ title, purpose, instructions, editorQuestions });

  useEffect(() => {
    if (baselineRef.current === null) {
      baselineRef.current = snapshot;
      return;
    }
    setDirty(snapshot !== baselineRef.current);
  }, [snapshot]);

  useEffect(() => {
    if (pendingSave || busy || !saveTriggerRef.current) return;
    saveTriggerRef.current.focus();
    saveTriggerRef.current = null;
  }, [pendingSave, busy]);

  const duplicate = editorQuestions
    .map((question) => question.code.trim().toUpperCase())
    .filter((code, index, list) => code !== '' && list.indexOf(code) !== index);
  const duplicateSet = new Set(duplicate);
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
  const showIssues = attempted || state === 'validation';

  if (!survey || !canManage) {
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

  const persistDraft = async (payload: SurveyPayload, savedSnapshot: string) => {
    const at = await saveDraft(id, payload);
    baselineRef.current = savedSnapshot;
    setDirty(false);
    setSaved(at);
    setPendingSave(null);
    notify('Draf berhasil disimpan.');
  };

  const reportSaveError = (error: unknown) => {
    const message = error instanceof Error ? error.message : 'Draf gagal disimpan.';
    setSaveError(message);
    notify(message, 'danger');
  };

  const onSave = (event: MouseEvent<HTMLButtonElement>) => {
    const trigger = event.currentTarget;
    setAttempted(true);
    setSaveError(null);
    if (editorQuestions.length === 0) return;
    setBusy(true);
    const payload: SurveyPayload = {
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
        direction: question.direction,
        options: question.type === 'short_text'
          ? []
          : question.options.map((option, optionIndex) => ({
              label: option.label,
              value: option.value.trim() === '' ? optionIndex + 1 : Number(option.value),
            })),
      })),
    };
    void previewSurveyChange(id, payload)
      .then(async ({ instrumentChange }) => {
        if (instrumentChange.changed && instrumentChange.affectedResponses > 0) {
          saveTriggerRef.current = trigger;
          setPendingSave({ payload, snapshot, affectedResponses: instrumentChange.affectedResponses });
          return;
        }
        await persistDraft(payload, snapshot);
      })
      .catch(reportSaveError)
      .finally(() => setBusy(false));
  };

  return (
    <>
      <NavigationGuardProvider dirty={dirty} message="Perubahan editor belum disimpan. Tinggalkan halaman ini?">
        <Shell kind="creator" title="Editor instrumen" subtitle="Susun judul, petunjuk, kode item, dan urutan. Draf tersimpan di server." bottomInset>
          <StateView
        routeId="creator-edit"
        state={state}
        emptyTitle="Belum ada pertanyaan"
        emptyDetail="Draf ini belum memiliki item. Tambahkan bagian dan pertanyaan sebelum diterbitkan."
        emptyAction={<ActionLink to={ROUTES.creatorPublish(id)} variant="secondary">Lihat validasi publikasi</ActionLink>}
        permissionDetail="Hanya pemilik atau admin organisasi survei yang dapat mengubah draf ini."
      >
        <div className="flex flex-col gap-5">
          
          <SurveyNav id={id} />

          {state === 'success' && <SuccessBanner title="Draf disimpan">Perubahan tersimpan dan tetap tersedia saat Anda kembali.</SuccessBanner>}
          {showIssues && issues.length > 0 && (
            <ValidationSummary items={issues} />
          )}
          {saved && <Banner tone="success" title="Draf tersimpan">Disimpan {formatWIB(saved)}.</Banner>}
          {saveError && <Banner tone="danger" title="Draf gagal disimpan">{saveError}</Banner>}

          <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
            <div className="flex min-w-0 flex-col gap-5">
              <Card className="flex flex-col gap-4">
                <SectionTitle>Metadata survei</SectionTitle>
                <Field
                  id="judul-survei"
                  label="Judul survei"
                  required
                  error={showIssues && title.trim() === '' ? 'Judul survei wajib diisi.' : undefined}
                >
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
                              className="text-danger hover:bg-danger-soft"
                              onClick={() => setPendingDelete({
                                kind: 'question',
                                key: question.key,
                                label: question.label || `Pertanyaan ${index + 1}`,
                              })}
                              aria-label={`Hapus pertanyaan ${index + 1}`}
                            >
                              Hapus
                            </Button>
                          </div>
                        </div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <Field
                            id={`code-${question.key}`}
                            label="Kode item"
                            hint="Unik per versi."
                            error={showIssues && duplicateSet.has(question.code.trim().toUpperCase()) ? 'Kode item duplikat pada versi ini.' : undefined}
                          >
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
                              className="min-h-[44px] rounded-sm border border-control-border bg-n0 px-3 text-body-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
                            >
                              <option value="likert">Likert numerik</option>
                              <option value="single_choice">Pilihan tunggal</option>
                              <option value="short_text">Isian singkat</option>
                            </select>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-col gap-3">
                          <Field
                            id={`label-${question.key}`}
                            label="Label pertanyaan"
                            required
                            error={showIssues && question.label.trim() === '' ? 'Label pertanyaan wajib diisi.' : undefined}
                          >
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
                                    <Field
                                      id={`option-label-${option.key}`}
                                      label={`Label opsi ${optionIndex + 1}`}
                                      error={showIssues && option.label.trim() === '' ? 'Label opsi wajib diisi.' : undefined}
                                    >
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
                                    className="text-danger hover:bg-danger-soft"
                                    onClick={() => setPendingDelete({
                                      kind: 'option',
                                      questionKey: question.key,
                                      key: option.key,
                                      label: option.label || `Opsi ${optionIndex + 1}`,
                                    })}
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
                <p className="mt-2 text-body-sm text-ink">{profile?.organization_name ?? 'Belum dimuat'}</p>
                <p className="mt-2 text-caption text-muted">
                  Mode persetujuan: {profile?.consent_mode ? CONSENT_MODE_LABEL[profile.consent_mode] : 'Belum ditetapkan'}
                </p>
                <p className="mt-1 text-annotation text-muted">
                  {profile?.source === 'organization'
                    ? 'Kebijakan organisasi'
                    : profile?.source === 'platform'
                      ? 'Kebijakan platform'
                      : 'Sumber kebijakan belum tersedia'}
                </p>
              </Panel>
              <Panel className="h-fit">
                <SectionTitle>Tindakan</SectionTitle>
                <div className="mt-3 flex flex-col gap-2">
                  <Button variant="primary" block onClick={onSave} loading={busy} disabled={busy || state === 'loading' || state === 'closed'}>Simpan draf</Button>
                  {dirty && <p className="text-caption font-bold text-danger">Perubahan belum disimpan.</p>}
                  <ActionLink to={ROUTES.creatorPreview(id)} variant="secondary" block disabled={dirty} disabledReason="Simpan draf atau batalkan perubahan terlebih dahulu">Lihat pratinjau</ActionLink>
                  <ActionLink to={ROUTES.creatorPublish(id)} variant="secondary" block disabled={dirty} disabledReason="Simpan draf atau batalkan perubahan terlebih dahulu">Lanjut ke publikasi</ActionLink>
                </div>
                <p className="mt-3 text-caption text-muted">
                  Simpan draf sebelum membuka pratinjau atau publikasi. Menyalin survei tidak membawa respons, undangan, atau bukti persetujuan.
                </p>
              </Panel>
            </div>
          </div>

          <div role="region" aria-label="Aksi editor" className="fixed inset-x-0 bottom-0 z-20 border-t border-n200 bg-n0 px-4 py-3 lg:hidden">
            <div className="mx-auto grid max-w-[1200px] grid-cols-2 gap-2">
              <Button variant="primary" block onClick={onSave} loading={busy} disabled={busy || state === 'loading' || state === 'closed'}>Simpan draf</Button>
              <ActionLink to={ROUTES.creatorPublish(id)} variant="secondary" block disabled={dirty} disabledReason="Simpan draf atau batalkan perubahan terlebih dahulu">Publikasi</ActionLink>
            </div>
          </div>
        </div>
      </StateView>

        </Shell>
      </NavigationGuardProvider>
      <ConfirmDialog
        open={pendingSave !== null}
        title="Simpan perubahan pertanyaan?"
        detail={`${new Intl.NumberFormat('id-ID').format(pendingSave?.affectedResponses ?? 0)} jawaban terdampak. Jawaban lama tidak akan sebanding dengan versi baru. Jawaban yang sudah masuk tetap tersimpan.`}
        confirmLabel="Tetap simpan draf"
        tone="primary"
        busy={busy}
        onClose={() => setPendingSave(null)}
        onConfirm={() => {
          if (!pendingSave) return;
          setSaveError(null);
          setBusy(true);
          void persistDraft(pendingSave.payload, pendingSave.snapshot)
            .catch(reportSaveError)
            .finally(() => setBusy(false));
        }}
      />
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={pendingDelete?.kind === 'option' ? 'Hapus opsi ini?' : 'Hapus pertanyaan ini?'}
        detail={pendingDelete
          ? `“${pendingDelete.label}” akan dihapus dari draf. Perubahan baru tersimpan setelah Anda menekan Simpan draf.`
          : ''}
        confirmLabel="Hapus"
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return;
          if (pendingDelete.kind === 'question') {
            setEditorQuestions((current) => current.filter((question) => question.key !== pendingDelete.key));
            notify('Pertanyaan dihapus dari draf.');
          } else {
            setEditorQuestions((current) => current.map((question) => (
              question.key === pendingDelete.questionKey
                ? { ...question, options: question.options.filter((option) => option.key !== pendingDelete.key) }
                : question
            )));
            notify('Opsi dihapus dari draf.');
          }
          setPendingDelete(null);
        }}
      />
    </>
  );
}

/* ---------------- Pratinjau ---------------- */

export function PreviewPage({ id }: { id: string }) {
  const survey = findSurvey(id);
  const { session, revision } = useStore();
  void revision;
  const canManage = canManageAs(session, survey);
  const { state, link } = useScreenState('creator-preview');
  const version = editorVersionFor(id);
  const items = version ? questionsFor(version.id) : [];

  if (!survey || !canManage) {
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
        permissionDetail="Pratinjau hanya tersedia bagi pemilik atau admin organisasi survei."
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
                  {q.required && <span className="sr-only"> (wajib)</span>}
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
                  <ShortTextAnswer id={`preview-${q.id}-text`} required={q.required} hint={q.hint} />
                )}
                {q.type !== 'short_text' && q.hint && <p className="text-caption text-muted">{q.hint}</p>}
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
  const canManage = canManageAs(session, survey);
  const { state, link } = useScreenState('creator-publish');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishBlockers, setPublishBlockers] = useState<string[]>([]);
  const [publishedToken, setPublishedToken] = useState<string | null>(null);
  const draft = draftVersionFor(id);
  const hasDraft = Boolean(draft);
  const published = publishedVersionFor(id);
  // Tautan aktif versi terbit dibaca dari bootstrap agar kontrol berbagi tetap ada setelah halaman dimuat ulang.
  const shareToken = publishedToken
    ?? allPublicLinks().find((item) => item.survey_id === id && item.version_id === published?.id && item.status === 'active')?.token
    ?? null;
  const version = draft ?? editorVersionFor(id);
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
  const blocking = !hasDraft || blockers.length > 0 || state === 'closed' || state === 'permission-denied' || state === 'error' || state === 'loading';

  if (!survey || !canManage) {
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
        permissionDetail="Publikasi hanya dapat dilakukan pemilik atau admin organisasi survei."
      >
        <div className="flex flex-col gap-5">
          
          <SurveyNav id={id} />

          {state === 'success' && (
            <SuccessBanner title="Versi diterbitkan">
              Tautan responden siap dibagikan.
              <div className="mt-2"><ActionLink to={ROUTES.creatorShare(id)} variant="secondary">Kelola tautan</ActionLink></div>
            </SuccessBanner>
          )}
          {!hasDraft && (
            <Banner tone="info" title="Tidak ada draf untuk diterbitkan">
              Semua versi sudah terbit atau ditutup. Buat draf baru dari editor sebelum menerbitkan versi berikutnya.
            </Banner>
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
              disabled={!hasDraft || Boolean(publishedToken)}
            />
            <div className="flex flex-wrap gap-3">
              <Button disabled={!confirm || blocking || busy || Boolean(publishedToken)} loading={busy} onClick={() => {
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
                {publishedToken ? 'Versi sudah diterbitkan' : hasDraft ? 'Terbitkan versi' : 'Tidak ada draf'}
              </Button>
              <ActionLink to={ROUTES.creatorEdit(id)} variant="secondary">Kembali ke editor</ActionLink>
              <ActionLink to={link(ROUTES.creatorShare(id))} variant="secondary" disabled={!shareToken && !published} disabledReason="Terbitkan satu versi terlebih dahulu">
                Kelola tautan
              </ActionLink>
            </div>
            <p className="text-caption text-muted">
              {session ? `Diterbitkan oleh ${session.name}. ` : ''}Perubahan isi setelah terbit memerlukan versi baru.
            </p>
            {shareToken && (
              <Banner tone={publishedToken ? 'success' : 'info'} title="Tautan responden">
                <PlainLink to={ROUTES.respondentIntro(shareToken)}>/s/{shareToken}</PlainLink>
                <div className="mt-2"><ActionLink to={ROUTES.creatorShare(id)} variant="secondary">Buka halaman pembagian</ActionLink></div>
              </Banner>
            )}
          </Card>
        </div>
      </StateView>
      
    </Shell>
  );
}
