/** Satu sumber untuk semua tautan. Tidak ada hardcoded href di komponen. */

export const ROUTE_IDS = [
  'home',
  'login',
  'register',
  'creator-list',
  'creator-edit',
  'creator-preview',
  'creator-publish',
  'creator-share',
  'creator-results',
  'creator-settings',
  'creator-history',
  'respondent-code',
  'respondent-intro',
  'respondent-form',
  'respondent-review',
  'respondent-receipt',
  'admin-summary',
  'admin-accounts',
  'admin-audit',
  'admin-integration',
  'admin-requests',
  'admin-org',
  'admin-org-evidence',
  'privacy',
  'terms',
  'notfound',
] as const;

export type RouteId = (typeof ROUTE_IDS)[number];

export const SURVEY_IDS = ['s_demo1', 's_demo2'] as const;
export type SurveyId = (typeof SURVEY_IDS)[number];

export const DEMO_TOKENS = ['link-umum-demo', 'link-umum-perpus', 'undangan-demo', 'undangan-perpus'] as const;

export const ROUTES = {
  home: '/',
  login: '/auth/login',
  register: '/auth/register',
  creator: '/creator',
  creatorEdit: (id: string) => `/creator/surveys/${id}/edit`,
  creatorPreview: (id: string) => `/creator/surveys/${id}/preview`,
  creatorPublish: (id: string) => `/creator/surveys/${id}/publish`,
  creatorShare: (id: string) => `/creator/surveys/${id}/share`,
  creatorResults: (id: string) => `/creator/surveys/${id}/results`,
  creatorSettings: (id: string) => `/creator/surveys/${id}/settings`,
  creatorHistory: (id: string) => `/creator/surveys/${id}/history`,
  respondentCode: '/s',
  respondentIntro: (token: string) => `/s/${token}`,
  respondentForm: (token: string) => `/s/${token}/form`,
  respondentReview: (token: string) => `/s/${token}/review`,
  respondentReceipt: (token: string) => `/s/${token}/receipt`,
  admin: '/admin',
  adminAccounts: '/admin/accounts',
  adminAudit: '/admin/audit',
  adminIntegration: '/admin/integration',
  adminRequests: '/admin/requests',
  adminOrg: '/admin/org',
  adminOrgEvidence: '/admin/org/evidence',
  privacy: '/privacy',
  terms: '/terms',
} as const;

/**
 * Rumah per peran; satu-satunya peta "sesudah masuk mendarat di mana". `org_admin` mengelola
 * organisasinya di `/admin/org` dan survei organisasinya di `/creator` (tautan sidebar).
 */
export type HomeRole = 'admin' | 'org_admin' | 'creator';

export function homeForRole(role: HomeRole | null | undefined): string {
  if (role === 'admin') return ROUTES.admin;
  if (role === 'org_admin') return ROUTES.adminOrg;
  return ROUTES.creator;
}

/** Simpan ?state= saat berpindah halaman agar satu skenario bisa diikuti. */
export function withState(to: string, state: string | null): string {
  if (!state || state === 'default') return to;
  return `${to}${to.includes('?') ? '&' : '?'}state=${encodeURIComponent(state)}`;
}
