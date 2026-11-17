import { useSyncExternalStore } from 'react';
import {
  surveys,
  versions,
  questions,
  options,
  invitations,
  publicLinks,
} from './fixtures/surveys';
import { accessGrants, integrationEvents } from './fixtures/records';
import type {
  Survey,
  SurveyVersion,
  Question,
  QuestionOption,
  Invitation,
  PublicLink,
  EventStatus,
} from './types';

/**
 * Penyimpanan kerja sisi klien. Tidak ada server: semua perubahan bertahan di
 * localStorage peramban dan koleksi fixture disinkronkan di tempat supaya
 * helper domain (findSurvey, questionsFor, computeSummary) tetap berlaku.
 */

const KEY = 'svara.workspace.v1';

export interface Session {
  name: string;
  email: string;
  role: 'creator' | 'admin';
}

export interface SettingsState {
  allowResults: boolean;
  allowIndividual: boolean;
  savedAt: string | null;
}

export interface GrantState {
  read: boolean;
  export: boolean;
  text: boolean;
}

export interface DraftState {
  title: string;
  codes: Record<string, string>;
  savedAt: string;
}

interface Stored {
  session: Session | null;
  surveys: Survey[];
  versions: SurveyVersion[];
  questions: Question[];
  options: QuestionOption[];
  invitations: Invitation[];
  publicLinks: PublicLink[];
  settings: Record<string, SettingsState>;
  grants: Record<string, GrantState>;
  drafts: Record<string, DraftState>;
  events: Record<string, { attempts: number; status: EventStatus }>;
  integrationNote: string;
}

export interface Snapshot {
  revision: number;
  session: Session | null;
  settings: Record<string, SettingsState>;
  grants: Record<string, GrantState>;
  drafts: Record<string, DraftState>;
  integrationNote: string;
}

function initial(): Stored {
  return {
    session: null,
    surveys: surveys.map((s) => ({ ...s })),
    versions: versions.map((v) => ({ ...v })),
    questions: questions.map((q) => ({ ...q, option_ids: [...q.option_ids] })),
    options: options.map((o) => ({ ...o })),
    invitations: invitations.map((i) => ({ ...i })),
    publicLinks: publicLinks.map((l) => ({ ...l })),
    settings: {},
    grants: Object.fromEntries(
      accessGrants.map((g) => [
        g.id,
        { read: g.can_read_individual, export: g.can_export, text: g.can_read_free_text },
      ]),
    ),
    drafts: {},
    events: Object.fromEntries(
      integrationEvents.map((e) => [e.id, { attempts: e.attempts, status: e.status }]),
    ),
    integrationNote: '',
  };
}

let data: Stored = initial();
try {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    const parsed = JSON.parse(raw) as Partial<Stored>;
    data = { ...data, ...parsed };
  }
} catch {
  // Penyimpanan rusak atau tidak tersedia: mulai dari data awal.
}

function syncCollections(): void {
  surveys.splice(0, surveys.length, ...data.surveys);
  versions.splice(0, versions.length, ...data.versions);
  questions.splice(0, questions.length, ...data.questions);
  options.splice(0, options.length, ...data.options);
  invitations.splice(0, invitations.length, ...data.invitations);
  publicLinks.splice(0, publicLinks.length, ...data.publicLinks);
  for (const g of accessGrants) {
    const next = data.grants[g.id];
    if (next) {
      g.can_read_individual = next.read;
      g.can_export = next.export;
      g.can_read_free_text = next.text;
    }
  }
  for (const e of integrationEvents) {
    const next = data.events[e.id];
    if (next) {
      e.attempts = next.attempts;
      e.status = next.status;
    }
  }
}

syncCollections();



let revision = 0;
let snapshot: Snapshot = buildSnapshot();
const listeners = new Set<() => void>();

function buildSnapshot(): Snapshot {
  revision += 1;
  return {
    revision,
    session: data.session,
    settings: data.settings,
    grants: data.grants,
    drafts: data.drafts,
    integrationNote: data.integrationNote,
  };
}

function emit(): void {
  syncCollections();
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Mode privat atau kuota penuh: state tetap hidup selama sesi ini.
  }
  snapshot = buildSnapshot();
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Berlangganan perubahan agar komponen ikut merender setelah aksi. */
export function useStore(): Snapshot {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

/* ---------------- Aksi ---------------- */

export function signIn(email: string, role: 'creator' | 'admin' = 'creator'): void {
  const local = email.split('@')[0] ?? 'pengelola';
  const name = local.replace(/[._-]+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase()) || 'Pengelola';
  data.session = { name, email, role };
  emit();
}

export function signOut(): void {
  data.session = null;
  emit();
}

export function saveDraft(surveyId: string, title: string, codes: Record<string, string>): string {
  const survey = data.surveys.find((s) => s.id === surveyId);
  const savedAt = new Date().toISOString();
  if (survey) {
    survey.title = title;
    survey.updated_at = savedAt;
  }
  data.drafts = { ...data.drafts, [surveyId]: { title, codes, savedAt } };
  emit();
  return savedAt;
}

/** Membuat draf baru beserta versi draf dan dua item salinan. */
export function createSurvey(title = 'Survei baru'): string {
  const stamp = Date.now().toString(36);
  const id = `s_${stamp}`;
  const versionId = `v_${stamp}`;
  const now = new Date().toISOString();
  const profileId = data.surveys[0]?.profile_id ?? 'p_perpus';

  const source = data.questions
    .filter((q) => q.version_id === 'v_demo1_1' && q.type === 'likert')
    .slice(0, 2);

  const newQuestions: Question[] = [];
  const newOptions: QuestionOption[] = [];
  source.forEach((q, index) => {
    const qid = `q_${stamp}_${index}`;
    const srcOpts = data.options.filter((o) => o.question_id === q.id);
    const optIds = srcOpts.map((_, i) => `${qid}_opt${i + 1}`);
    srcOpts.forEach((o, i) => {
      newOptions.push({ ...o, id: optIds[i] ?? `${qid}_opt${i + 1}`, question_id: qid });
    });
    newQuestions.push({
      ...q,
      id: qid,
      version_id: versionId,
      code: `Q${String(index + 1).padStart(2, '0')}`,
      order: index + 1,
      label: q.label,
      hint: 'Ubah teks pertanyaan sesuai kebutuhan survei.',
      option_ids: optIds,
    });
  });

  data.surveys.push({
    id,
    owner_id: 'u_creator_a',
    profile_id: profileId,
    title,
    purpose: 'Jelaskan tujuan pengumpulan jawaban pada survei ini.',
    object_label: '',
    instructions: 'Pilih satu jawaban pada setiap pernyataan.',
    status: 'draft',
    created_at: now,
    updated_at: now,
    current_version_id: versionId,
  });
  data.versions.push({
    id: versionId,
    survey_id: id,
    number: 1,
    status: 'draft',
    notice_version: '1.0',
    published_at: null,
    closed_at: null,
    question_ids: newQuestions.map((q) => q.id),
  });
  data.questions.push(...newQuestions);
  data.options.push(...newOptions);
  emit();
  return id;
}

export function publishVersion(surveyId: string): string | null {
  const survey = data.surveys.find((s) => s.id === surveyId);
  const draft = [...data.versions]
    .reverse()
    .find((v) => v.survey_id === surveyId && v.status === 'draft');
  if (!survey || !draft) return null;

  const now = new Date().toISOString();
  draft.status = 'published';
  draft.published_at = now;
  survey.status = 'published';
  survey.current_version_id = draft.id;
  survey.updated_at = now;

  const token = `tautan-${Date.now().toString(36)}`;
  data.publicLinks.push({
    id: `pl_${Date.now().toString(36)}`,
    survey_id: surveyId,
    version_id: draft.id,
    token,
    url: `/s/${token}`,
    label: `Tautan umum · ${survey.title}`,
    status: 'active',
    expires_at: null,
  });
  emit();
  return token;
}

export function createInvitation(surveyId: string, _label: string, expiresAt: string): string {
  const version = data.versions.find((v) => v.id === data.surveys.find((s) => s.id === surveyId)?.current_version_id);
  const seq = String(data.invitations.length + 1).padStart(3, '0');
  const code = `UND-${seq}`;
  data.invitations.push({
    id: `inv_${Date.now().toString(36)}`,
    assignment_id: `a_${Date.now().toString(36)}`,
    survey_id: surveyId,
    version_id: version?.id ?? '',
    code,
    status: 'active',
    expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
    used_at: null,
    revoked_at: null,
    token_hash: `hash-${Date.now().toString(36)}`,
  });
  emit();
  return code;
}

export function revokeInvitation(invitationId: string): void {
  const invitation = data.invitations.find((i) => i.id === invitationId);
  if (!invitation || invitation.status !== 'active') return;
  invitation.status = 'revoked';
  invitation.revoked_at = new Date().toISOString();
  emit();
}

export function closeVersion(versionId: string): void {
  const version = data.versions.find((v) => v.id === versionId);
  if (!version || version.status === 'closed') return;
  version.status = 'closed';
  version.closed_at = new Date().toISOString();
  const survey = data.surveys.find((s) => s.current_version_id === versionId);
  if (survey) survey.status = 'closed';
  emit();
}

export function archiveSurvey(surveyId: string): void {
  const survey = data.surveys.find((s) => s.id === surveyId);
  if (!survey) return;
  survey.status = 'archived';
  emit();
}

export function saveSettings(surveyId: string, allowResults: boolean, allowIndividual: boolean): void {
  data.settings = {
    ...data.settings,
    [surveyId]: { allowResults, allowIndividual, savedAt: new Date().toISOString() },
  };
  emit();
}

export function saveGrants(next: Record<string, GrantState>): void {
  data.grants = { ...next };
  emit();
}

export function replayEvent(eventId: string): void {
  const current = data.events[eventId];
  data.events = {
    ...data.events,
    [eventId]: { attempts: (current?.attempts ?? 0) + 1, status: 'delivered' },
  };
  emit();
}

export function setIntegrationNote(note: string): void {
  data.integrationNote = note;
  emit();
}
