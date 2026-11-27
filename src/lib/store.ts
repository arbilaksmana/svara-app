'use client';

import { useSyncExternalStore } from 'react';
import {
  surveys,
  versions,
  questions,
  options,
  assignments,
  invitations,
  publicLinks,
} from './fixtures/surveys';
import { profiles } from './fixtures/profiles';
import {
  accounts,
  accessGrants,
  auditLogs,
  integrationEvents,
  organizations,
} from './fixtures/records';
import * as api from './api';
import type { AdminStats, ChartRange, DataRequest, SurveyScope } from './api';
import type {
  Account,
  AccessGrant,
  Assignment,
  AuditLog,
  DeploymentProfile,
  ConsentRequired,
  EventStatus,
  SurveyNotice,
  SurveyProfile,
  IntegrationEvent,
  Invitation,
  OrgAuditRow,
  OrgInvitation,
  OrgMember,
  OrgProfile,
  OrganizationSummary,
  PublicLink,
  Question,
  QuestionOption,
  Role,
  Survey,
  SurveyVersion,
} from './types';

const NOTE_KEY = 'svara.integration.note.v1';

export interface Session {
  id: string;
  name: string;
  email: string;
  /** Peran UI: admin (super_admin), org_admin, atau creator. */
  role: 'creator' | 'org_admin' | 'admin';
  serverRole: Role;
  organizationId: string | null;
}

export interface SettingsState {
  allowResults: boolean;
  allowIndividual: boolean;
  /** `tidak` | `wajib_upload`; hanya survei organisasi boleh `wajib_upload`. */
  consentRequired: ConsentRequired;
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

export interface OrgWorkspace {
  profile: OrgProfile;
  members: OrgMember[];
  invitations: OrgInvitation[];
  audit: OrgAuditRow[];
}

/**
 * Data layar super admin, disalin dari bootstrap server. `null` sampai bootstrap berhasil: array modul
 * masih berisi fixture klien sebelum itu, dan ID fixture bisa sama dengan ID seed nyata.
 */
export interface AdminData {
  accounts: Account[];
  organizations: OrganizationSummary[];
  accessGrants: AccessGrant[];
  auditLogs: AuditLog[];
  integrationEvents: IntegrationEvent[];
  surveys: Survey[];
}

export interface Snapshot {
  revision: number;
  ready: boolean;
  error: string | null;
  session: Session | null;
  settings: Record<string, SettingsState>;
  grants: Record<string, GrantState>;
  drafts: Record<string, DraftState>;
  integrationNote: string;
  stats: AdminStats | null;
  statsError: string | null;
  org: OrgWorkspace | null;
  orgError: string | null;
  dataRequests: DataRequest[] | null;
  dataRequestsError: string | null;
  admin: AdminData | null;
}

let session: Session | null = null;
let ready = false;
let error: string | null = null;
let stats: Snapshot['stats'] = null;
let statsError: string | null = null;
/** Nomor permintaan ringkasan terakhir; respons lama tidak boleh menimpa UI. */
let statsRequest = 0;
let org: OrgWorkspace | null = null;
let orgError: string | null = null;
let orgRequest = 0;
let dataRequestList: DataRequest[] | null = null;
let dataRequestsError: string | null = null;
let dataRequestsRequest = 0;
let adminData: AdminData | null = null;
let settings: Record<string, SettingsState> = {};
let grants: Record<string, GrantState> = {};
let drafts: Record<string, DraftState> = {};
/** Profil kebijakan per survei dari bootstrap; kosong sampai bootstrap berhasil. */
let surveyProfiles: Record<string, SurveyProfile> = {};
/** Notice per survei dari sumber kebijakan yang sama dengan halaman publik. */
let surveyNotices: Record<string, SurveyNotice | null> = {};
let integrationNote = '';
try {
  integrationNote = localStorage.getItem(NOTE_KEY) ?? '';
} catch {
  integrationNote = '';
}

let revision = 0;
let snapshot: Snapshot = buildSnapshot();
const listeners = new Set<() => void>();

function buildSnapshot(): Snapshot {
  revision += 1;
  return {
    revision,
    ready,
    error,
    session,
    settings,
    grants,
    drafts,
    integrationNote,
    stats,
    statsError,
    org,
    orgError,
    dataRequests: dataRequestList,
    dataRequestsError,
    admin: adminData,
  };
}

function emit(): void {
  snapshot = buildSnapshot();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useStore(): Snapshot {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

function replace<T>(target: T[], next: T[]): void {
  target.splice(0, target.length, ...next);
}

function mapSession(account: (Account & { email?: string }) | null): Session | null {
  if (!account) return null;
  return {
    id: account.id,
    name: account.display_name,
    email: account.email ?? '',
    role: account.role === 'super_admin' ? 'admin' : account.role === 'org_admin' ? 'org_admin' : 'creator',
    serverRole: account.role,
    organizationId: account.organization_id ?? null,
  };
}

function hydrate(data: api.BootstrapData): void {
  replace(surveys, data.surveys);
  replace(
    versions,
    data.versions.map((version) => ({
      ...version,
      question_ids: version.question_ids ?? [],
    })),
  );
  replace(
    questions,
    data.questions.map((question) => ({
      ...question,
      order: question.order ?? question.ord ?? 0,
      required: Boolean(question.required),
      option_ids: question.option_ids ?? [],
    })),
  );
  replace(options, data.options);
  replace(assignments, data.assignments);
  // SEC-10: server tidak lagi mengirim token pada bootstrap; nilai kosong menjaga bentuk tipe untuk fixture
  // lama. Undangan hanya dapat dibuka dari tautan yang sudah dibagikan, tautan umum dicetak ulang lewat
  // `printPublicLinkToken`.
  replace(
    invitations,
    data.invitations.map((invitation) => ({
      ...invitation,
      token: '',
      status: invitation.status as Invitation['status'],
    })),
  );
  replace(
    publicLinks,
    data.publicLinks.map((link) => ({
      ...link,
      token: '',
      url: '',
      status: link.status as PublicLink['status'],
    })),
  );

  for (const key of Object.keys(profiles)) delete profiles[key];
  for (const profile of data.profiles) profiles[profile.id] = profile;
  surveyProfiles = { ...data.surveyProfiles };
  surveyNotices = { ...(data.surveyNotices ?? {}) };

  replace(accounts, data.accounts);
  replace(organizations, data.organizations ?? []);
  replace(accessGrants, data.grants);
  replace(auditLogs, data.auditLogs);
  replace(
    integrationEvents,
    data.integrationEvents.map((event) => ({
      ...event,
      status: event.status as EventStatus,
    })),
  );
  adminData = {
    accounts: [...accounts],
    organizations: [...organizations],
    accessGrants: [...accessGrants],
    auditLogs: [...auditLogs],
    integrationEvents: [...integrationEvents],
    surveys: [...surveys],
  };

  settings = Object.fromEntries(
    Object.entries(data.settings).map(([surveyId, value]) => [
      surveyId,
      {
        allowResults: value.allowResults,
        allowIndividual: value.allowIndividual,
        consentRequired: value.consentRequired,
        savedAt: data.serverTime,
      },
    ]),
  );
  grants = Object.fromEntries(
    data.grants.map((grant) => [
      grant.id,
      {
        read: grant.can_read_individual,
        export: grant.can_export,
        text: grant.can_read_free_text,
      },
    ]),
  );
  session = mapSession(data.account);
}

export async function loadBootstrap(): Promise<void> {
  try {
    error = null;
    const data = await api.bootstrap();
    hydrate(data);
    ready = true;
  } catch (cause) {
    ready = true;
    error = cause instanceof Error ? cause.message : 'Data workspace tidak dapat dimuat.';
    // Sesi tetap valid walau bootstrap gagal: `/auth/me` membaca cookie tanpa data workspace,
    // sehingga shell masih dapat menampilkan navigasi dan tombol Keluar.
    if (!session) {
      try {
        const { account } = await api.me();
        if (account) session = mapSession(account);
      } catch {
        // Tanpa sesi yang terbaca, shell menampilkan jalur masuk biasa.
      }
    }
  }
  emit();
}

export async function refreshBootstrap(): Promise<void> {
  const data = await api.bootstrap();
  hydrate(data);
  emit();
}

export async function signIn(email: string, password: string): Promise<Session> {
  const result = await api.login(email, password);
  session = mapSession(result.account);
  if (!session) throw new Error('Akun tidak dikenali.');
  const data = await api.bootstrap();
  hydrate(data);
  ready = true;
  error = null;
  emit();
  return session;
}

export async function register(input: api.RegisterInput): Promise<Session> {
  const result = await api.register(input);
  session = mapSession(result.account);
  if (!session) throw new Error('Akun tidak dikenali.');
  const data = await api.bootstrap();
  hydrate(data);
  ready = true;
  error = null;
  emit();
  return session;
}

export async function signOut(): Promise<void> {
  try {
    await api.logout();
  } finally {
    session = null;
    settings = {};
    grants = {};
    drafts = {};
    stats = null;
    statsError = null;
    statsRequest += 1;
    adminData = null;
    emit();
  }
}

export async function createSurvey(ownerScope: SurveyScope, title = 'Survei baru'): Promise<string> {
  const detail = await api.createSurvey(title, ownerScope);
  await refreshBootstrap();
  return detail.survey.id;
}

export async function saveDraft(surveyId: string, payload: api.SurveyPayload): Promise<string> {
  const detail = await api.saveSurvey(surveyId, payload);
  const savedAt = new Date().toISOString();
  const codes: Record<string, string> = {};
  for (const question of detail.questions) codes[question.id] = question.code;
  drafts = { ...drafts, [surveyId]: { title: payload.title, codes, savedAt } };
  await refreshBootstrap();
  return savedAt;
}

export async function publishVersion(surveyId: string): Promise<string | null> {
  const result = await api.publishSurvey(surveyId);
  await refreshBootstrap();
  return result.publicLink.token || null;
}

export async function duplicateVersion(surveyId: string): Promise<string> {
  const detail = await api.duplicateSurvey(surveyId);
  await refreshBootstrap();
  return detail.survey.id;
}

export async function createInvitation(
  surveyId: string,
  label: string,
  expiresAt: string,
): Promise<{ code: string; token: string }> {
  const result = await api.createInvitation(surveyId, label, expiresAt);
  await refreshBootstrap();
  return { code: result.invitation.code, token: result.token };
}

export async function revokeInvitation(invitationId: string): Promise<void> {
  await api.revokeInvitation(invitationId);
  await refreshBootstrap();
}

export async function closeVersion(surveyId: string): Promise<void> {
  await api.closeSurvey(surveyId);
  await refreshBootstrap();
}

export async function archiveSurvey(surveyId: string): Promise<void> {
  await api.archiveSurvey(surveyId);
  await refreshBootstrap();
}

export async function saveSettings(
  surveyId: string,
  allowResults: boolean,
  allowIndividual: boolean,
  consentRequired: ConsentRequired,
): Promise<void> {
  await api.saveSettings(surveyId, allowResults, allowIndividual, consentRequired);
  settings = {
    ...settings,
    [surveyId]: { allowResults, allowIndividual, consentRequired, savedAt: new Date().toISOString() },
  };
  emit();
}

export async function saveGrants(next: Record<string, GrantState>): Promise<void> {
  if (!adminData) throw new Error('Data akun belum dimuat dari server. Muat ulang halaman, lalu coba lagi.');
  const byAccount = new Map<string, Array<{
    survey_id: string | null;
    can_read_individual: boolean;
    can_export: boolean;
    can_read_free_text: boolean;
  }>>();
  for (const grant of adminData.accessGrants) {
    const state = next[grant.id] ?? {
      read: grant.can_read_individual,
      export: grant.can_export,
      text: grant.can_read_free_text,
    };
    const list = byAccount.get(grant.account_id) ?? [];
    list.push({
      survey_id: grant.survey_id,
      can_read_individual: state.read,
      can_export: state.export,
      can_read_free_text: state.text,
    });
    byAccount.set(grant.account_id, list);
  }
  for (const [accountId, list] of byAccount) {
    await api.adminSaveGrants(accountId, list);
  }
  grants = { ...next };
  await refreshBootstrap();
}

export async function replayEvent(eventId: string): Promise<void> {
  await api.adminRetryEvent(eventId);
  await refreshBootstrap();
}

export async function loadAdminStats(range: ChartRange = '30d'): Promise<void> {
  const request = ++statsRequest;
  stats = null;
  statsError = null;
  emit();
  try {
    const next = await api.adminStats(range);
    if (request !== statsRequest) return;
    stats = next;
  } catch (cause) {
    if (request !== statsRequest) return;
    statsError = cause instanceof Error ? cause.message : 'Ringkasan operasional tidak dapat dimuat.';
  }
  emit();
}

/** Dipanggil saat layar dilepas; respons yang tiba setelahnya tidak boleh mengubah state. */
export function cancelAdminStatsLoad(): void {
  statsRequest += 1;
}

/**
 * Profil, anggota, undangan, dan audit organisasi dimuat sekaligus. Data lama tetap tampil selama
 * pemuatan ulang; galat disimpan terpisah agar layar menawarkan "Coba lagi", bukan daftar kosong.
 */
export async function loadOrgWorkspace(): Promise<void> {
  const request = ++orgRequest;
  orgError = null;
  emit();
  try {
    const [profile, members, invitationList, audit] = await Promise.all([
      api.getOrgProfile(),
      api.getOrgMembers(),
      api.listOrgInvitations(),
      api.getOrgAudit(),
    ]);
    if (request !== orgRequest) return;
    org = { profile: profile.profile, members, invitations: invitationList.invitations, audit };
  } catch (cause) {
    if (request !== orgRequest) return;
    orgError = cause instanceof Error ? cause.message : 'Data organisasi tidak dapat dimuat.';
  }
  emit();
}

/** Dipanggil saat layar organisasi dilepas: respons yang tertunda diabaikan dan data tidak dibawa ke sesi berikutnya. */
export function cancelOrgWorkspaceLoad(): void {
  orgRequest += 1;
  org = null;
  orgError = null;
  emit();
}

export async function loadDataRequests(): Promise<void> {
  const request = ++dataRequestsRequest;
  dataRequestsError = null;
  emit();
  try {
    const next = await api.getDataRequests();
    if (request !== dataRequestsRequest) return;
    dataRequestList = next;
  } catch (cause) {
    if (request !== dataRequestsRequest) return;
    dataRequestsError = cause instanceof Error ? cause.message : 'Daftar permintaan data tidak dapat dimuat.';
  }
  emit();
}

/** Sama dengan cancelOrgWorkspaceLoad untuk antrean permintaan data super admin. */
export function cancelDataRequestsLoad(): void {
  dataRequestsRequest += 1;
  dataRequestList = null;
  dataRequestsError = null;
  emit();
}

export function setIntegrationNote(note: string): void {
  integrationNote = note;
  try {
    localStorage.setItem(NOTE_KEY, note);
  } catch {
    // Catatan tetap hidup selama sesi ini.
  }
  emit();
}

export function localSettingsFor(surveyId: string): SettingsState | undefined {
  return settings[surveyId];
}

export function localGrantsFor(accountId: string): AccessGrant[] {
  return accessGrants.filter((grant) => grant.account_id === accountId);
}

export function sessionRole(): Role | null {
  return session?.serverRole ?? null;
}

export function isAdmin(): boolean {
  return session?.role === 'admin';
}

export function isCreator(): boolean {
  return session?.role === 'creator' && session.serverRole === 'creator';
}

/**
 * Cermin `canManageSurvey` di server/http.ts: pemilik mengelola surveinya sendiri,
 * org_admin mengelola survei organisasinya. Survei tanpa organisasi (NULL) tidak pernah
 * jatuh ke org_admin.
 */
export function canManageAs(
  session: Session | null,
  survey: Pick<Survey, 'owner_id' | 'organization_id'> | null | undefined,
): boolean {
  if (!session || !survey) return false;
  if (survey.owner_id === session.id) return true;
  return (
    session.serverRole === 'org_admin' &&
    session.organizationId !== null &&
    survey.organization_id != null &&
    survey.organization_id === session.organizationId
  );
}

export function ensureAccount(account: Account | undefined): Account | undefined {
  return account;
}

/** Data admin terbaru dari server di luar render (mis. setelah `await refreshBootstrap()`); `null` sebelum bootstrap berhasil. */
export function currentAdminData(): AdminData | null {
  return adminData;
}

export function allAccounts(): Account[] {
  return adminData?.accounts ?? [];
}

export function allAuditLogs(): AuditLog[] {
  return adminData?.auditLogs ?? [];
}

export function allIntegrationEvents(): IntegrationEvent[] {
  return adminData?.integrationEvents ?? [];
}

/** Profil kebijakan survei dari server. Tidak ada fallback ke profil lain. */
export function surveyProfileOf(surveyId: string): SurveyProfile | undefined {
  return surveyProfiles[surveyId];
}

/**
 * Notice untuk satu survei, dipilih server dari sumber kebijakan survei itu. `null` berarti versi
 * notice survei ini belum tersedia di sumbernya, bukan pilihan dari profil lain.
 */
export function surveyNoticeOf(surveyId: string): SurveyNotice | null | undefined {
  return surveyNotices[surveyId];
}

export function allProfiles(): DeploymentProfile[] {
  return Object.values(profiles);
}

export function allQuestions(): Question[] {
  return questions;
}

export function allOptions(): QuestionOption[] {
  return options;
}

export function allVersions(): SurveyVersion[] {
  return versions;
}

export function allAssignments(): Assignment[] {
  return assignments;
}

export function allInvitations(): Invitation[] {
  return invitations;
}

export function allPublicLinks(): PublicLink[] {
  return publicLinks;
}

export type { Survey, SurveyVersion, Question, QuestionOption, Assignment, Invitation, PublicLink };
