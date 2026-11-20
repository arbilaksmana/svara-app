# 03 — Actors, permissions, tenant boundaries, and state rules

- Baseline: `95eafa3cb38aac4dd32963a1ec584a2ce6821f25`
- Scope: actor/permission mapping, ownership, tenancy, state-dependent actions, negative access.
- Runtime: API `4311` on `svara_audit_docs`; targeted probes E1-E3. Browser UI was not provisioned, so UI conclusions are static traces and marked as such.
- Related: document conflicts in `01-documents.md`; flow findings in `02-business-flows.md`.

## 0. Findings summary

| ID | Severity | Finding | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| BR-01 | High | A creator with an access grant can read detail/summary via API, but the survey is absent from bootstrap/list, so the UI cannot render it. | FAIL | E1 `BIZ-06`; `http.ts:122-144`, `bootstrap.ts:267-284`; `CreatorData.tsx:63,90` |
| BR-02 | High | `org_admin` can manage org surveys and read full results via API, but UI is owner-only: no editor, no share, no settings; bootstrap also omits invitations/links/assignments for org admins. | FAIL | E1 `BIZ-07`; `CreatorCore.tsx:61,230,401`; `CreatorData.tsx:63-64,90`; `bootstrap.ts:267-269` |
| BR-03 | High | Owner and org admin cannot view individual responses in the UI; `individualAllowed` requires a grant. There is no UI path for any legitimate individual reader. | FAIL | `CreatorData.tsx:339-341`; API owner read passes `http.ts:170-171` |
| BR-04 | Low | README says `super_admin` may manage all surveys; API/code denies management (metadata read only). | Documentation defect | `README.md:157`; `http.ts:108-116` |
| BR-05 | High decision | `org_admin` is absent from the PRD actor model but is a core role in README/code with management rights over other creators’ surveys. | Unresolved | PRD §3/§8; `README.md:128,155-160`; `http.ts:108-115` |
| BR-06 | Medium decision | Access grants are not tenant-bounded: a super admin can grant an account in any organization access to any survey, and the grant survives organization changes. | Unresolved | `admin.ts:383-420`; `001_initial.sql:202-209`; E3 grants |
| BR-07 | Low | Cross-org organization APIs correctly return 404; creator/org survey access correctly returns 403. | PASS | `org.ts:160-199,258-289`; tenant tests |
| BR-08 | Medium | Public links have no per-respondent identity by design; combined with consent reuse this lets a second person submit under the first consent. | PARTIAL | BF-02/BF-08; E1/E3 |
| BR-09 | Low | Suspended accounts are blocked at login and on every request, including existing sessions; role changes are read fresh per request. | PASS | `security.ts:56-95`; suspended login test |
| BR-10 | Low/Medium | `super_admin` bootstrap loads all surveys/questions and capability-bearing distribution data while management is denied: public link `url` embeds the token, and invitation rows keep plaintext `token`/`code` (only `token_hash` is blanked). | Observation; security owner should decide | `bootstrap.ts:267-301`; `http.ts:146-148` |
| BR-11 | Low | Owner keeps management after leaving the survey’s organization; survey tenant does not follow the account. | Decision | `http.ts:108-115`; `org.ts` membership update; no survey re-tenant code |
| BR-12 | Low | Revoking an already-used invitation rewrites its status to `revoked` (used_at remains), unlike organization invitations which reject used codes. | FAIL (state) | `surveys.ts:610-621`; `org.ts:269-271` |

## 1. Actor definitions

| Actor | Authentication | Organization membership | Data scope |
| --- | --- | --- | --- |
| `super_admin` | Session cookie | None required | All survey metadata; no survey management by code; no answer read without explicit grant |
| `org_admin` | Session cookie | One organization | All surveys with `organization_id = account.organization_id`; full aggregate/individual/export/free-text reads |
| Creator owner | Session cookie | Optional (`organization_id` on survey or null) | Own surveys; full manage/read/export |
| Creator grantee | Session cookie | Any/no org | Only explicit grants on a survey: metadata; aggregate if `allow_results`; individual if `can_read_individual && allow_individual`; export if `can_export`; free text if `can_read_free_text` |
| Creator peer | Session cookie | May share organization | No access to another creator’s survey unless granted |
| Suspended creator | Credentials may exist | — | Login denied; live session rejected |
| Public respondent | Capability URL (public link or invitation token) | None | Form/submit/receipt for that token; no survey listing |
| Integration service | Global bearer token | None | Read responses of any survey/version (including drafts) |
| Data requester | None | None | Public policy/privacy/data-request form |

Source: `server/http.ts:105-184`; `server/routes/auth.ts`; `server/routes/org.ts`; `server/routes/integration.ts`; `server/bootstrap.ts:231-269`.

## 2. Survey action matrix (API truth)

Legend: **ALLOW** = endpoint succeeds when other preconditions hold; **DENY** = explicit 403/404; **GRANT** = only with the stated grant/settings. “State” lists extra restrictions found in code. All authenticated endpoints still require an active session.

| Action / resource | Super admin | Org admin, same org | Org admin, other org | Owner | Grantee | Creator peer | Public/token | State / owner rule |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /surveys` (list) | ALLOW all | ALLOW org | — (role has one org) | Own only | Own only; grants omitted | Own only | DENY | No state filter |
| `GET /surveys/:id` (metadata) | ALLOW all | ALLOW org | DENY (403) | ALLOW | GRANT (any grant) | DENY | n/a | Archived/closed included |
| `POST /surveys` (create) | DENY | DENY | DENY | ALLOW if role `creator` | DENY | DENY | n/a | Org scope requires org |
| `PUT /surveys/:id` (save draft) | DENY unless owner | ALLOW org | DENY | ALLOW | DENY | DENY | n/a | Any state; archived/closed → new draft |
| `POST /surveys/:id/duplicate` | DENY unless owner | ALLOW org | DENY | ALLOW | DENY | DENY | n/a | Any source status |
| `POST /surveys/:id/publish` | DENY unless owner | ALLOW org | DENY | ALLOW | DENY | DENY | n/a | Requires valid draft; does not close old published |
| `POST /surveys/:id/close` | DENY unless owner | ALLOW org | DENY | ALLOW | DENY | DENY | n/a | Closes oldest published only; sets survey closed |
| `POST /surveys/:id/archive` | DENY unless owner | ALLOW org | DENY | ALLOW | DENY | DENY | n/a | Closes all draft/published versions and all links; survey archived |
| `GET /surveys/:id/settings` | ALLOW (metadata) | ALLOW org | DENY | ALLOW | GRANT (metadata) | DENY | n/a | Settings visible to any metadata reader |
| `PUT /surveys/:id/settings` | DENY unless owner | ALLOW org | DENY | ALLOW | DENY | DENY | n/a | No state guard |
| `POST /surveys/:id/invitations` | DENY unless owner | ALLOW org | DENY | ALLOW | DENY | DENY | n/a | Targets **oldest published**; no survey-status guard |
| `POST /invitations/:id/revoke` | DENY unless owner | ALLOW org | DENY | ALLOW | DENY | DENY | n/a | No used/expired guard; cross-survey denied |
| `GET /surveys/:id/summary` | DENY w/o grant | ALLOW | DENY | ALLOW | GRANT + `allow_results` | DENY | n/a | Any version of accessible survey |
| `GET /surveys/:id/responses` | DENY w/o grant | ALLOW | DENY | ALLOW | GRANT + `allow_individual` | DENY | n/a | Answer rows; `text` is null unless free-text grant |
| `GET /surveys/:id/export` (CSV/codebook) | DENY w/o grant | ALLOW | DENY | ALLOW | GRANT `can_export` (settings ignored) | DENY | n/a | Any version; per-response rows |
| Free text inside responses/export | DENY w/o grant | ALLOW | DENY | ALLOW | GRANT `can_read_free_text` | DENY | n/a | No settings gate |
| Public link metadata | n/a | n/a | n/a | n/a | n/a | n/a | ALLOW | No questions before consent |
| Public form/submit | n/a | n/a | n/a | n/a | n/a | n/a | ALLOW with token+consent | Closed/archived/expired → deny |
| Receipt | n/a | n/a | n/a | n/a | n/a | n/a | ALLOW only same scope+key | Cross-context 404 |

Notes:
- `canManageSurvey` is owner-first, then same-org `org_admin`; `super_admin` is deliberately not a manager (`http.ts:108-115`).
- Grants are per account+survey and not tenant-bound (`001_initial.sql:202-209`; admin grants endpoint).
- `canExport` returns true for any manager or `can_export` grant, without reading `survey_settings` (`http.ts:176-179`).
- `canReadFreeText` returns true for manager or `can_read_free_text` grant (`http.ts:181-184`).

## 3. Organization and platform actions

| Action | Super admin | Org admin | Creator | Public | Tenant/state rule |
| --- | --- | --- | --- | --- | --- |
| `GET /org/profile` | ALLOW (platform/admin flow) | ALLOW own | ALLOW own/default | n/a | Never another org |
| `PUT /org/profile` | DENY (uses admin platform route) | ALLOW own | DENY (403) | n/a | Can change age/consent/retention/contact/policy; **cannot change `notice_version`** |
| `GET /org/members` | DENY | ALLOW own | DENY | n/a | Org scoped |
| `PATCH /org/members/:id` | DENY | ALLOW own, creators only | DENY | n/a | Cannot suspend self/other org admin; cross-org 404 |
| `GET/POST/DELETE /org/invitations` | DENY | ALLOW own | DENY | n/a | Used code cannot be revoked; cross-org 404 |
| `GET /org/audit` | DENY | ALLOW own | DENY | n/a | Org-scoped audit, no raw metadata |
| `GET/PATCH /admin/accounts/:id` | ALLOW (not self-demote last active) | DENY | DENY | n/a | Last-active-super-admin guard |
| `PUT /admin/grants/:accountId` | ALLOW | DENY | DENY | n/a | Cross-tenant grants possible; replaces all grants |
| `PUT /admin/platform` | ALLOW | DENY | DENY | n/a | Cannot update `notice_version` |
| `GET /admin/audit` | ALLOW | DENY | DENY | n/a | Platform-wide |
| `PATCH /admin/data-requests/:id` | ALLOW | DENY | DENY | n/a | Status/note only; no subject key |
| `POST /admin/integration/events/:id/retry` | ALLOW | DENY | DENY | n/a | Simulation marker |
| `GET /integration/v1/.../responses` | Service token only | — | — | — | Any survey/version incl. draft; no tenant scope |

Source: `server/routes/org.ts:50-307`; `server/routes/admin.ts`; `server/routes/integration.ts`.

## 4. UI vs API matrix

The UI is a separate authorization layer with different rules. This is the core role-access defect.

| Surface | Owner | Org admin (same org) | Grantee | Creator peer | Super admin |
| --- | --- | --- | --- | --- | --- |
| `/creator` survey list | Own rows | Org rows shown, but **no manage menu** | Only own rows; granted survey absent | Own rows | `/creator` denied by guard; admin UI only |
| Editor | ALLOW | **Missing/“Survei tidak ditemukan”** | Missing (survey absent) | Missing | Denied |
| Share page | ALLOW | **Missing** | Missing | Missing | Denied |
| Settings page | ALLOW | **Missing** (nav hides manage links) | Missing | Missing | Denied |
| Aggregate results | ALLOW | ALLOW (API summary) | Missing survey | Denied | Not routed |
| Individual responses | **DENY** (`individualAllowed` requires grant) | **DENY** | DENY in practice (survey absent) | Denied | Not routed |
| CSV export button | ALLOW | **DENY** (`exportAllowed` owner-only) | DENY in practice | Denied | Not routed |
| Invitation/share data in bootstrap | Present | **Absent** (manageable IDs owner-only) | Absent | Absent | Present for all surveys |

Evidence:
- `CreatorCore.tsx:61` `canManage = serverRole === 'creator' && survey.owner_id === session.id`.
- `CreatorCore.tsx:230` list action `canManage = canCreate && owner`.
- `CreatorCore.tsx:401` editor returns “Survei tidak ditemukan” when `!isOwner`.
- `CreatorData.tsx:64,90` share is owner-only.
- `CreatorData.tsx:339-341`: `exportAllowed = isOwner || grant.export`; `individualAllowed = grant.read && settings.allowIndividual`.
- `bootstrap.ts:267-269`: invitations/links/assignments load only for `super_admin` or owner.
- E1 `BIZ-06`: officer bootstrap `surveys=[]`, list `[]`, detail 200, summary 200.
- E1 `BIZ-07`: org admin bootstrap contains `s_demo1`; invitations/links/assignments for it are all 0; responses 200.

Impact:
- `org_admin` is effectively read-only in the UI for aggregate results, despite README’s “manage organization surveys” and API capability.
- A grantee cannot use the product at all for the survey they were granted; only direct API calls work.
- Neither owner nor org admin can view individual responses; owner can export them (inconsistent with the UI’s own gate) and org admin cannot.
- The UI’s behavior cannot be inferred from the server guards; tests cover API only.

UI runtime was not available; these are static conclusions with deterministic gating. Browser verification remains **NOT_VERIFIED**.

## 5. Ownership, tenancy, and state rules

### 5.1 Ownership precedence

1. `survey.owner_id === account.id` → manage/read/export/free text regardless of organization.
2. `account.role === 'org_admin' && survey.organization_id === account.organization_id` → manage/read/export/free text.
3. `super_admin` → metadata only; no management, no answers without grant.
4. Grant → only the capabilities stored in `access_grants`, with settings applied to individual/aggregate reads.
5. Public token → capability for that version only; no account identity.

No tenant check is applied to grants; a grant is an explicit cross-tenant exception by construction. Decision D-09.

### 5.2 State-dependent access

| Resource state | Management | Aggregate | Individual/export | Public form |
| --- | --- | --- | --- | --- |
| Draft | Yes | Empty/zero (or error if no published version) | Empty | No (no link) |
| Published | Yes | Yes | Yes | Yes while active |
| Closed | Yes; save reopens as draft | Yes (retained) | Yes (retained) | Its version/link closed |
| Archived | Yes; save reopens as draft | Yes (retained) | Yes (retained) | Closed link |
| Deleted | No delete path | n/a | n/a | n/a |

Invitations:
- API create is allowed whenever the survey has any published version, even if survey status is `closed` (BF-04); the owner UI share page disables it for `closed`/`archived`.
- Revoke is allowed in any state, including used (BR-12).
- Public invitation state is derived; expired rows remain `active` in DB.

Consent/submission state:
- Consent can be created only when `canSubmit` is true for the resolved context; this rejects expired/used invitations and closed/archived links, but a survey-level `closed` with an active newer published version still passes (BF-04).
- Submit re-checks version published and invitation status inside the transaction, but not survey status, link status, or context binding.
- Consent remains `granted` after submission and after a handled data request (BF-06).

### 5.3 Organization changes

- Organization membership changes are account-only; survey `organization_id` is unchanged.
- Owner retains management after leaving the org; the previous org admin also retains same-org management.
- No UI/API path moves a survey between organizations.
- This avoids silent tenant movement (good) but creates an unspecified owner/tenant overlap; decision D-09.

## 6. Negative-access verification

| Test | Result | Evidence |
| --- | --- | --- |
| Creator peer cannot read metadata/summary/individual/export | 403 / UI missing | `api.test.ts:1248-1295`; AC03 |
| Grant-only account can read granted metadata/summary but cannot get bootstrap survey | API 200, UI absent | E1 `BIZ-06` |
| Org admin other-org member/invitation operations | 404, no existence leak | `org.ts:175-199,258-289`; org tests |
| Super admin cannot read individual without grant | 403 | `api.test.ts:1285-1289`; tenant tests |
| Suspended account cannot log in; live session rejected | 401 | `security.ts:56-95`; auth tests |
| Non-grant account cannot export | 403 | AC03/AC09 tests |
| Grant export without individual/aggregate settings | **200**, 2 rows | E2; BF-07 |
| Public receipt from another context | 404 (PASS) | E1 `BIZ-05` |
| Consent from another context | **201 accepted** | E1 `BIZ-04`; BF-02 |
| Owner/org-admin individual UI | **DENY** | `CreatorData.tsx:341` |

## 7. Finding detail

### BR-01 — Grantee cannot use the UI for a granted survey

- Requirement: PRD §9.1 (“Petugas berizin … dapat melihat hasil pada cakupan yang diberikan”); README `:160`.
- Actor: creator granted one survey (officer).
- Expected: survey appears in the grantee’s dashboard/results with only granted tabs.
- Actual: API detail/summary succeed; bootstrap/list are empty because `accessibleSurveys` returns only owned surveys for role `creator`; UI `findSurvey` therefore fails.
- Evidence: E1 `BIZ-06`; `http.ts:122-144`; `bootstrap.ts:231`; `CreatorData.tsx:63,90`.
- Impact: grant workflow is API-only; UI users cannot consume the permission.
- Confidence: High static + runtime bootstrap. Severity: High.

### BR-02 — Org admin is API-only for management/share

- Requirement: README role table `:158`, visibility `:378`; PRD silent on the role.
- Actor: org admin of `org_smk`.
- Expected: editor/share/settings for org surveys; bootstrap share data.
- Actual: API can manage (PUT/publish/close/archive/settings/invite); bootstrap `manageableSurveyIds` is owner-only, so invitations/links/assignments are absent; UI is owner-only and renders “not found”.
- Evidence: E1 `BIZ-07`; `bootstrap.ts:267-284`; `CreatorCore.tsx:61,230,401`; `CreatorData.tsx:64,90`.
- Impact: org admin can change data via API but cannot operate the product UI; support/training mismatch.
- Confidence: High static + runtime. Severity: High.
- Decision: D-01 (is org-admin management intended?).

### BR-03 — No UI path for legitimate individual readers

- Requirement: README `:171` “pemilik dan org_admin membaca penuh”; PRD §9.1.
- Actor: owner and org admin.
- Expected: individual tab visible/authorized for managers.
- Actual: `individualAllowed` = grant read + `allowIndividual`; owner/org admin have no grant, so denied even though API allows. The default settings have `allow_individual=0`, but settings are supposed to bound grants, not the owner (API already treats managers as always allowed).
- Evidence: `CreatorData.tsx:339-341`; `http.ts:170-171`; E1 summary/individual API paths.
- Impact: managers cannot inspect or correct individual data in the UI; owner can still export it, creating an inconsistent permission story.
- Confidence: High static. Severity: High.
- Related: BF-07, D-02.

### BR-04 — `super_admin` documentation overclaim

- README says “Semua survei / Mengelola semua survei”; code grants metadata read only. No management API path for super admin unless owner (which the role cannot create). Tests assert individual denial; no test asserts management.
- Impact: operational expectation mismatch; not a privilege escalation.
- Severity: Low (documentation).

### BR-05 — `org_admin` is an unratified role extension

- PRD actor table and API contract list only super admin, creator, authorized officer; PRD management is owner-only. README/code add a fourth actor with management over other creators’ surveys.
- Impact: product/legal sign-off is missing for a powerful tenant role; UI/API behavior cannot be reconciled to the PRD.
- Disposition: decision D-01; do not silently treat README as authoritative.

### BR-06 — Grants are cross-tenant capabilities

- Admin can grant any account any survey; grants have no `organization_id`, purpose, expiry, or grantor field (`001_initial.sql:202-209`).
- If a creator moves organizations, the grant remains; if a survey changes org (no path today), the grant remains.
- This may be intended for platform support, but the audit trail cannot say who granted/why and tenant isolation is bypassed by design.
- Decision D-09; coordinate with Security worker.

### BR-07 — Negative tenant tests pass

- Org member/invitation operations are scoped by `organization_id` and return 404 for other orgs.
- Survey metadata/management/summary/individual/export deny creator peers and other-org org admins. Tests at `api.test.ts:1146-1295` cover the API. No leak observed.
- PASS with the UI divergence caveat.

### BR-08 / BR-09 / BR-10 / BR-11 / BR-12

- BR-08: public link identity is intentionally absent; consent reuse is the actual failure (BF-02/BF-08).
- BR-09: session status/role is reloaded per request; PASS.
- BR-10: super-admin bootstrap loads distribution links for all surveys while management is denied; public link URLs embed tokens and invitation rows retain plaintext `token`/`code` (only `token_hash` is blanked). Not an answer read, but capability data is exposed; security worker should decide.
- BR-11: owner retention after org change is unspecified; decision D-09.
- BR-12: used-invitation revoke rewrites status; part of BF-04.

## 8. Unresolved decisions

- D-01 `org_admin` authority, including management of other creators’ surveys and UI parity.
- D-02 export vs individual/aggregate settings.
- D-09 cross-tenant grants, grant metadata (grantor/purpose/expiry), and owner/tenant behavior after org change.
- D-10 `super_admin` survey-management authority.
- D-11 whether super-admin bootstrap should include public link URLs and plaintext invitation tokens/codes for all surveys.

## 9. NOT_VERIFIED

- Browser behavior for all UI rows (no UI runtime; static gating only).
- Keyboard/focus/ARIA aspects of role-gated menus (UX worker).
- Real cross-tenant penetration test beyond the API tests and probes.
- Grant lifecycle under account suspension/deletion (no delete path for accounts).
- Super-admin grant self-assignment policy; no test asserts whether an admin may grant themselves answers (API allows).
- Integration token rotation/scope (security worker).
