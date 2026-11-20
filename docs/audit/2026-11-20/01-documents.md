# 01 — Documents, requirements, and conflicts

- Baseline: `arbilaksmana/svara-app` @ `95eafa3cb38aac4dd32963a1ec584a2ce6821f25` (2026-11-20 19:30:56 +0700)
- Audit date: 2026-11-20
- Workers: DocsBusiness slice (documents, product requirements, business rules, state transitions, actor/permission mapping)
- Mode: read-only source review; targeted synthetic API/DB probes only. No source, test, migration, README, or existing evidence changes.
- Runtime: API `127.0.0.1:4311` against database `svara_audit_docs` (name verified before mutation). `svara` and `svara_test` were not contacted.
- Test baseline: not run by this worker (`pnpm test`, build, lint, and formatter are coordinator-owned).
- Confidence scale: High = code + runtime + DB, or exact test assertion; Medium = code or test only, or one conflicting claim; Low = documentation inference.

## 0. Result in one paragraph

The documents mostly agree on the product shape: versioned surveys, immutable published snapshots, token-scoped invitations, server-side consent, idempotent submission, per-version aggregate/export, and a three-role account model. The implementation departs from the stated product rules in five material places: (1) the public form reads the legacy `profiles`/`notices` rows instead of the organization/platform policy source, so respondents can see the wrong controller, consent mode, and notice version; (2) consent is validated only by survey+version, so it can be reused across contexts and by a second person on one device; (3) guardian evidence is self-asserted and immediately labelled “verified”; (4) close/publish/invitation lifecycle treats the oldest published version as current, leaving the newest version accepting responses after the survey is marked closed; and (5) the UI cannot show grant-only surveys or individual results to owners/org admins even though the API allows both. Documentation drift also exists (role model, table count, package manager, backup command, super-admin claims, and evidence provenance). These are reported as findings, not silently resolved.

## 1. Document register

| ID | Document | Declared status / date | Role in this audit | Verdict |
| --- | --- | --- | --- | --- |
| DOC-01 | `PRD.md` | Version 1.2, 17 Nov 2026; 447 lines | Primary product requirement and acceptance criteria (`F-01..F-20`, `AC01..AC17`, `R1..R9`) | Authoritative for intended behavior |
| DOC-02 | `README.md` | Undated implementation/operations guide; 448 lines | Secondary source for implemented behavior, roles, routes, tenancy, demo limits | Useful but contains stale and internally contradictory claims |
| DOC-03 | `DESIGN.md` | Style reference adapted from Passport on 2026-11-17 | Visual tokens, typography, layout, component states | Visual authority only; no business rules |
| DOC-04 | `passport-design-system.md` | Upstream style reference; not a Svara product document | Source material for `DESIGN.md` | Non-binding for Svara requirements |
| DOC-05 | `docs/audit/PLAN.md` | Audit protocol, 2026-11-20 | Audit scope, seeds, evidence rules, report contracts | Controls this audit, not product scope |
| DOC-06 | `docs/test-evidence/ac13-load.json` | DEMO ONLY, generated 2026-11-18 | Local 30-submission load demo | Not capacity proof; not tied to baseline commit |
| DOC-07 | `docs/test-evidence/ac15-restore.json` | DEMO ONLY, generated 2026-11-18 | Local `pg_dump`/`pg_restore` demo | Not incident/RPO proof; not tied to baseline commit |
| DOC-08 | `docs/test-evidence/ac16-walkthrough.{md,json}` | DEMO ONLY, generated 2026-11-18 | Synthetic walkthrough and CSV reconciliation | Not a field study (`AC16` itself remains unmet by design); structured JSON has `summary`, `csv`, `response_ids` = `null`, so the Markdown reconciliation claims are unsupported by the structured artifact |
| DOC-09 | `docs/test-evidence/next-*.png/webp` | Files dated 2026-11-20 | UI screenshots | No commit, viewport matrix manifest, or browser version recorded |
| DOC-10 | `package.json` | `packageManager: pnpm@11.5.2`; Node 24 engine | Tooling and scripts | Conflicts with README’s npm/no-`packageManager` statement |
| DOC-11 | `.env.example`, `docker-compose.yml`, `Dockerfile.api`, `Dockerfile.web`, `.github/workflows/ci.yml`, `docker/postgres/init/01-app-role.sh` | Configuration, not requirements | Deployment and operational expectations | Reviewed for claims relevant to business flows; ops details deferred to Ops worker |
| DOC-12 | `server/migrations/001..009` | Authoritative schema history | DB-enforced business constraints | Source of truth where application and docs diverge on persistence |
| DOC-13 | `server/test/*.test.ts` | 5 test files | Executable evidence of intended contracts | Strong for covered paths; gaps listed in §7 |
| DOC-14 | `server/seed-data.ts` | Synthetic demo data | Scenario fixtures | Does not exactly reproduce the PRD §7 AD01 fixture |

### Authority order used

1. `PRD.md` for intended product behavior, privacy rules, and acceptance criteria.
2. `README.md` for deliberate extensions and implementation/operations detail only when it does not contradict the PRD; contradictions are registered below.
3. Migrations and tests for what the system actually enforces.
4. Runtime probe/DB result for actual behavior at the baseline.
5. Design documents for presentation only.

## 2. Conflict register

Each conflict is stated as a document-vs-document or document-vs-code difference. No side is chosen silently.

| ID | Conflict | Evidence | Impact | Disposition |
| --- | --- | --- | --- | --- |
| C-01 | PRD’s actor model has no `org_admin`; PRD §8 grants survey management to “Creator pemilik”. README and code introduce `org_admin` with management rights over every survey in its organization, including other creators’ surveys. | PRD §3/§8 (no `org_admin`; API table lines 220-226); `README.md:128,155-160,378`; `server/http.ts:108-115` | Tenancy/authorization model is an extension, not a PRD-approved rule. An org admin can publish/close/archive/settings-change another creator’s survey. | **Unresolved product decision D-01.** Implementation is internally consistent with README but not with PRD. |
| C-02 | README says `super_admin` may manage all surveys; code allows management only for owner or same-org `org_admin`. | `README.md:157`; `server/http.ts:108-116`; `server/routes/surveys.ts:371,457,521,540,561` | README overstates admin capability. No security hole (less privilege), but a false operational claim. | Documentation defect (BF-11). |
| C-03 | README says every `/creator/surveys/[id]/*` route checks ownership and renders “not found”, while also saying `org_admin` manages organization surveys. UI enforces owner-only, so `org_admin` cannot manage the surveys the role table says it manages. | `README.md:121,158,378`; `src/screens/CreatorCore.tsx:61,230`; `src/screens/CreatorData.tsx:64,90` | Org-admin management is API-only; UI denies it. | **Finding BR-02** (03-role-access). Needs decision: update UI or narrow README/PRD. |
| C-04 | README says each survey reads exactly one policy source (`organizations` or `platform_profile`) with no fallback, and admits `surveys.profile_id` is legacy. Public form still reads `profiles`/`notices` by `profile_id`, with a hard-coded `p_smk` fallback. | `README.md:149,166`; `server/routes/public.ts:199-208,233-234,255,262-263,281`; `server/routes/surveys.ts:322-325` | Public respondents can see the wrong controller, age category, consent mode, and notice version. Directly affects informed consent. | **Finding BF-01** (02-business-flows), High. |
| C-05 | README says grant holders remain bounded by `survey_settings`: `can_read_individual` only when `allow_individual`, `can_read_aggregate` only when `allow_results`. Code’s `canExport` ignores both settings, so an export-only grant can export per-response rows while individual/aggregate reads are denied. | `README.md:173`; `server/http.ts:163-179`; `server/routes/surveys.ts:697-704,734-773`; evidence E1 `BIZ-08`, E2 | Export is a separate PRD permission, so this may be intended; the documents do not say so explicitly. Current behavior is nevertheless surprising and can defeat the purpose of `allow_individual`. | **Decision D-02.** Finding BF-07, Medium. |
| C-06 | README says the schema has 21 tables; migrations test asserts 24 application tables; live audit DB has 24 application tables plus `schema_migrations` (25 total). | `README.md:111`; `server/test/migrations.test.ts:37`; live query 2026-11-20 | Stale count; mild documentation trust issue. | Documentation defect (BF-11). |
| C-07 | README says the repo uses npm “without `packageManager`”; `package.json` declares `packageManager: pnpm@11.5.2`, and several README commands use pnpm. | `README.md:44-51,281-304`; `package.json` | Onboarding path ambiguity; commands still work in practice. | Documentation defect (BF-11). |
| C-08 | README’s AC15 section documents `pg_dump`/`pg_restore`, then ends with a SQLite-era `VACUUM INTO` statement. | `README.md:420-427,444` | Backup guidance is contradictory; the real demo script and `ac15-restore.json` use `pg_dump`. | Documentation defect (BF-11); Ops worker owns R8 evidence. |
| C-09 | PRD requires consent status history and separation of respondent click from guardian verification. Schema keeps one mutable consent row; no withdrawal/status-history route exists; guardian status is set to `verified` from any non-empty respondent-supplied string. | PRD §6 (ConsentRecord) and §9.1; `server/migrations/001_initial.sql:150-163`; `server/routes/public.ts:451-470`; `src/screens/Respondent.tsx:81,319,764`; evidence E1/E3 | Consent evidence cannot be audited as a history, and “verified” is not a verified fact. | **Finding BF-03 / BF-02**, High. |
| C-10 | PRD says closing stops new submissions. The close route closes only the first published version found (oldest), sets the survey to `closed`, and leaves any newer published version and its link active. | PRD §5.1, §5.2; `server/routes/surveys.ts:518-529,480-483,558-563`; evidence E1 `BIZ-03`, E3 | A survey can display `closed` while a form still accepts responses; new invitations can still target an old version or be created after close. | **Finding BF-04**, High. |
| C-11 | PRD §8 lists only “Creator pemilik” for update/publish/close/archive; code also allows same-org `org_admin`. | PRD §8 API table; `server/http.ts:108-115` | Same governance extension as C-01. | Decision D-01. |
| C-12 | PRD §7.2 requires recording export recipient, export purpose, and column filter. CSV/codebook audit metadata records only `rows` and `includeText`; no recipient/purpose/filter fields, and no data-request/purpose input. | PRD §7.2; `server/routes/surveys.ts:728,773`; evidence E3 `export_audit` | Cannot reconstruct who exported what and why from audit alone. | **Finding BF-07**, Medium. |
| C-13 | PRD §9.1 requires notice changes to create new notice versions and not change notice text retroactively. Organization/platform profile updates can change age category, consent mode, retention, and policy URLs but cannot update `notice_version`; platform update also excludes it. | PRD §9.1; `server/routes/org.ts:115-131`; `server/routes/admin.ts:304-317`; `server/migrations/005_organizations.sql:5-16` | Policy can change retroactively under the same notice version; there is no API path to publish a new notice version or notice text. | **Finding BF-05**, Medium/High governance. |
| C-14 | Evidence is demo-only and cannot be tied to the audited commit: `AC13`/`AC15`/`AC16` JSON have no commit field, were generated 2026-11-18 in other worktrees/DBs, and the AC16 Markdown points to the old `migrate-postgres` absolute path. AC16’s Markdown reconciliation says total 8 and CSV rows 8, while its structured JSON has `summary: null`, `csv: null`, `response_ids: null`; the scenario’s three new respondents and the unexplained baseline five cannot be reconciled from the artifact. | `docs/test-evidence/ac13-load.json`; `ac15-restore.json`; `ac16-walkthrough.md` (path line 27); `ac16-walkthrough.json`; baseline commit date | AC16’s structured evidence does not support its prose claims. AC13/AC15 are real but not baseline-attributable. None can be used as proof for this commit without rerun. | Auditability defect (BF-11); AC13/AC15/AC16 statuses set accordingly. |
| C-15 | PRD’s AC08 fixture expects AD01 values `2,4,4,5,empty` (counts 0,1,0,2,1, skipped 1); seed contains `4,2,4,5,3` (counts 0,1,1,2,1, skipped 0). No AC08-specific evidence artifact exists. | PRD §7 fixture; `server/seed-data.ts:410-424`; live summary evidence E1/E3 | Summary formula is correct for the seed, but the exact AC08 fixture is not exercised or evidenced. | **AC08 PARTIAL**, not a formula defect. |
| C-16 | README calls audit logs “append-only”; no database trigger or rule prevents update/delete, and the application has no deletion endpoint in normal flows. | `README.md:38,132`; migrations have no trigger on `audit_logs` | Append-only is application convention, not DB-enforced. Security worker owns R9; business auditability still affected. | Cross-worker note; not counted as a business FAIL. |
| C-17 | README/PRD require a visible data-request channel and controller contact. `/privacy` is static, does not display the actual controller identity/contact, and says contact is in each survey notice; `/public/policy` reads legacy profiles and falls back to the placeholder `privasi@organisasi.contoh`, not organizations/platform_profile. | PRD §9.2; `src/screens/Public.tsx:178-188,306`; `server/routes/public.ts:681-697`; evidence E1 `BIZ-09` | Data-subject contact may be absent or wrong for the deployment. | **Finding BF-10**, Medium. |
| C-18 | README says six demo accounts; live seed has six. This one matches. | `README.md:374-380`; live query | No conflict. | Closed check. |
| C-19 | README says owner and org admin read individual answers, free text, aggregate, export, and codebook; API allows managers, but UI gates individual reads on a grant and export on ownership, so owner is denied individual and org admin is denied individual/export in the UI. | `README.md:171,378`; `server/http.ts:163-184`; `src/screens/CreatorData.tsx:339-341` | UI/API permission divergence; managers cannot use documented read capabilities from the product UI. | **Finding BR-02/BR-03** (03-role-access). |

## 3. Requirement traceability — F-01..F-20

The PRD only groups features (`F-01…F-04`, etc.); it does not define each individual `F` item. The row split below is `[INFERENCE]` from the group labels and §5-§8; this is a PRD precision gap, not an implementation finding.

| ID | Requirement (inferred where marked) | Implementing surface | Evidence | Verdict | Confidence |
| --- | --- | --- | --- | --- | --- |
| F-01 | Account login, session, and recovery from an invalid session | `server/routes/auth.ts:1-248`; `server/security.ts:40-115`; login/register tests | `api.test.ts:123,1021`; API probe logins E1 | PASS | High |
| F-02 | Server-side authorization per role and object | `server/http.ts:108-184`; `server/app.ts:21-52`; tenant tests | `api.test.ts:1146-1246`; E1 `BIZ-06/07` | PASS (mechanism); role-scope conflict C-01 | High |
| F-03 | Survey list scoped to the actor | `server/http.ts:122-144`; `server/bootstrap.ts:231,267` | E1 `BIZ-06` (grantee list empty) | PASS for owner/org scope; grants not listed (BR-01) | High |
| F-04 | Draft create/edit/copy/archive and editor fields | `server/routes/surveys.ts:304-452`; `src/screens/CreatorCore.tsx` | `api.test.ts:201-346`; static UI | PASS; archived→draft save is undocumented (D-03) | High |
| F-05 | Likert item, options, required/optional | `server/routes/surveys.ts:160-230`; `server/summary.ts`; respondent UI | AC07/AC08 tests; summary probe | PASS | High |
| F-06 | Short-text item and separate free-text permission | `server/routes/surveys.ts:160-230,710-741`; `server/routes/public.ts` answer parsing | AC09 tests; code | PASS for API permission; export/settings caveat BF-07 | High |
| F-07 | Single-choice item (P2) | `server/routes/surveys.ts:31,167`; `CreatorCore.tsx:597`; summary/export paths | Static; no dedicated test | PASS (implemented), coverage thin | Medium |
| F-08 | Preview separate from production data | `src/screens/CreatorCore.tsx` preview route; no preview API writes | Static; no test asserting response count | PASS (client-only preview) | Medium |
| F-09 | Publication freezes version and link | `server/routes/surveys.ts:454-511`; `api.test.ts:291-346` | AC02/AC04 tests | PASS for snapshot; lifecycle defect BF-04 | High |
| F-10 | Public link/invitation notice, review, submit | `server/routes/public.ts:226-283,285-360,540-658`; `src/screens/Respondent.tsx` | AC05/06/07/13 tests; E1 | PARTIAL: source/notice and consent defects | High |
| F-11 | Validate version, invitation, item, option, required values | `server/routes/public.ts:330-382,543-589`; `api.test.ts:348-462` | AC05/06/07 tests | PASS | High |
| F-12 | Atomic final response, attempt, invitation consumption | `server/routes/public.ts:557-643`; unique indexes in 001 | AC06/07/13 tests; E3 | PASS for transaction; consent linkage separate | High |
| F-13 | Aggregate dashboard per version with zero/skip denominators | `server/summary.ts`; `server/routes/surveys.ts:664-678` | `report-versions.test.ts:102`; live summary | PASS formula; AC08 fixture/evidence gap C-15 | High |
| F-14 | CSV/codebook per version with rights and audit | `server/routes/surveys.ts:697-780`; `server/export.ts` | AC09 tests; E2/E3 | PARTIAL: export audit lacks recipient/purpose/filter (C-12) | High |
| F-15 | Standalone flow and local pseudonymous identity | `server/routes/public.ts:585-606`; `server/seed-data.ts`; README | AC13/AC16 demo evidence | PASS for standalone/local identity | High |
| F-16 | Module 13/15 contract simulation | `server/routes/integration.ts`; `integration_events`; admin retry | AC14 test; code | PARTIAL: simulation-only, one global token, no per-survey scope | High |
| F-17 | Individual download requires explicit permission | `server/http.ts:169-179`; `server/routes/surveys.ts:782-810` | AC09/AC12 tests; E1/E2 | PARTIAL: API enforced; UI blocks legitimate readers (BR-03) | High |
| F-18 | Consent record with version, basis, status, evidence | `server/routes/public.ts:432-485`; `consent_records` schema | AC05/AC12 tests; E1/E3 | FAIL: reuse, no history, self-asserted guardian evidence | High |
| F-19 | Audit of permissions, status, individual reads, publish, denials, exports | `server/audit.ts`; calls across routes | AC12 test; E3 | PARTIAL: coverage good; export metadata incomplete; append-only not DB-enforced | High |
| F-20 | Reload shows accurate state; no stale auto-refresh promise (P2) | Bootstrap/store fetch; no polling | Static | PASS for reload; real-time refresh not implemented (documented P2) | Medium |

## 4. Acceptance criteria — AC01..AC17

| AC | Expected | Evidence reviewed | Verdict | Notes |
| --- | --- | --- | --- | --- |
| AC01 | Two creators, ownership, two surveys, different topics | `api.test.ts:123-160`; E1 | PASS | API + ownership tests; UI not browser-run |
| AC02 | Preview/copy/publish; copy excludes responses/grants/consent/invitations | `api.test.ts:201-290`; `server/routes/surveys.ts:402-450` | PASS | Copy creates new survey + draft from `current_version_id`; no responses/grants copied. Notice version carried from source (BF-05 note). |
| AC03 | Public link, expiry, revocation, direct-URL denial | `api.test.ts:464-498,1146-1246`; E1 | PASS | Cross-org and non-grant API denials verified |
| AC04 | A remains serving while open; A rejects after close | `api.test.ts:291-346`; E1 `BIZ-03`; E3 | PARTIAL | Test confirms the old link still resolves to A after B is drafted; it does not submit to A. Survey close leaves the newest published version accepting; invitations target oldest. See BF-04. |
| AC05 | Required/foreign-option/out-of-range validation; no partial data; invitation unused | `api.test.ts:348-462` | PASS | Required and option checks inside transaction; no partial response on 422 |
| AC06 | Two tabs, same invitation → max one final response | `api.test.ts:447-452`; unique `responses.assignment_id` | PASS | Also DB unique index |
| AC07 | Identical retry returns receipt; changed payload same key rejected | `api.test.ts:432-445`; E1 `BIZ-05` | PASS | Receipt scope separation also verified for cross-context |
| AC08 | AD01 fixture distribution/denominator/CSV matches manual count | `report-versions.test.ts:102`; live summary; `seed-data.ts:410-424` | PARTIAL | Formula correct; seed differs from PRD fixture and no AC08 evidence artifact (C-15) |
| AC09 | CSV escaping/formula neutralization; column rights; DB original intact | `api.test.ts:499-619`; `server/export.ts` | PASS | Export settings ambiguity is BF-07, not a CSV correctness failure |
| AC10 | Standalone works when service down; status retry without second response | Simulation code/tests; no real service | PARTIAL | Standalone passes; integration is simulated only; failed-event retry is a state transition, not a network retry of the same consumer |
| AC11 | Mobile/keyboard labels, contrast, validation, focus, receipt | UI/UX worker; screenshots `docs/test-evidence/next-*` | NOT_VERIFIED | Not assessed by this worker; no browser baseline run |
| AC12 | Guardian evidence, withdrawal, audit, revoked token, unauthorized download | E1 `BIZ-04`; E3; `api.test.ts:620-708` | FAIL | Guardian evidence self-asserted; consent reused across contexts; withdrawal/deletion has no enforced data path; downloads API-enforced |
| AC13 | 30 concurrent, 20 items, p95 ≤3s, 600 answers, unique IDs | `docs/test-evidence/ac13-load.json` | NOT_VERIFIED | DEMO ONLY, 30×? items claims 20 but 30 answered per item; generated before baseline; Perf worker owns rerun |
| AC14 | Simulated Module 15 matching IDs/schema; no names/tokens | `api.test.ts:913-961`; integration code | PARTIAL | Simulation and column limits pass; global service token and simulation-only evidence (F-16) |
| AC15 | Restore test, post-restore deletion handling, incident drill | `docs/test-evidence/ac15-restore.json`; README AC15 | NOT_VERIFIED | DEMO ONLY; no incident drill; README backup conflict C-08; Ops worker owns |
| AC16 | Real field study with real respondents, instrument review, CSV reconciliation | `docs/test-evidence/ac16-walkthrough.*` | NOT_APPLICABLE | PRD explicitly requires real respondents; artifact is synthetic and self-labels “not field study”. Its JSON has null summary/CSV IDs, so even the synthetic reconciliation is not structurally evidenced. Cannot be marked PASS. |
| AC17 | Notice before submit; notice version stored; consent blocks submit; privacy/terms/data request public; logs clean | E1 `BIZ-01/02/04`; E3; `public.ts`; `Public.tsx` | PARTIAL | Consent gate works. Public notice is legacy 1.0 while stored version is 1.2/2.0; `/privacy` lacks actual controller contact. See BF-01/BF-10. |

## 5. Risks — R1..R9

| Risk | Intended control | Observed evidence | Verdict | Owner / note |
| --- | --- | --- | --- | --- |
| R1 service/participant unavailable | Standalone mode; simulated adapter; label simulation | Standalone works; integration endpoint is simulated; no real outage test | PARTIAL | Integration coordinator; simulation is deliberate scope limit, not a defect |
| R2 identity/code leakage or mismatch | One-use token, expiry, revoke, no name matching | Invitation tests, public link many-use design; consent cross-context is R5/consent, not identity swap | PASS (identity), PARTIAL (consent) | Security/backend |
| R3 duplicate/lost submission | Atomic transaction, unique assignment, idempotency | AC06/07/13 tests pass; 30 parallel unique; close/v1-v2 race remains | PARTIAL | BF-04 lifecycle; concurrency close/submit not stress-tested |
| R4 out-of-scope access / CSV spread | Server checks every summary/response/export; export audit | Cross-org/non-grant tests pass; export ignores settings; audit lacks recipient/purpose | PARTIAL | BF-07; security worker |
| R5 child data without valid guardian evidence | Separate verification; reject unverified/withdrawn | Guardian status set from any non-empty ref; no withdrawal; UI says “verified” | FAIL | **BF-03**, highest business risk |
| R6 re-identification via free text/small groups | Separate text permission; recipient controls; small-group review | Text permission enforced; no small-group suppression implementation; policy parameter external | PARTIAL | Controller decision; not a code defect for pilot |
| R7 wrong version/score | Immutable publication; original values; codebook per version | Snapshot tests pass; close/invitation version bug can keep wrong version active | PARTIAL | BF-04 |
| R8 over-retention/backup failure | Retention schedule; restore/delete drill | `retention_days` stored but not enforced; AC15 demo only; no deletion-after-restore process | PARTIAL | Ops/controller external; intended pre-pilot limit |
| R9 credential/answer disclosure | Session/token hygiene, audit, incident drill | No credential/token evidence recorded; incident drill absent; append-only not DB-enforced | NOT_VERIFIED | Security/Ops worker owns; no business finding guessed |

## 6. Intended scope limits vs defects vs external decisions

**Intended limits (do not treat as implementation failures):**

- Synthetic-only data; no real participants, field study, or legal compliance claim (`README.md:1-7`; PRD §0/§12).
- Module 13/15 integration is explicitly simulated (`server/routes/integration.ts` response `simulated: true`; AC14).
- Retention schedule, controller identity, guardian verification process, small-group suppression threshold, hosting/TLS/backup policy are external decisions (PRD §9.1/§9.2/§14; README limitations).
- P2 features (single-choice, auto-refresh) are not MVP blockers; single-choice is implemented, auto-refresh is not.
- `AC16` cannot pass in a synthetic repo by definition.

**Defects (reproducible behavior contradicts a stated rule):**

- BF-01 public policy/notice source and version.
- BF-02 consent context/reuse and lost per-response linkage.
- BF-03 guardian evidence self-attestation.
- BF-04 close/publish/invitation lifecycle.
- BR-01/BR-02/BR-03 UI/API role divergence.
- BF-08 shared-device idempotency/consent reuse.
- BF-11 stale/contradictory documentation where it changes operator/developer action.
- BF-12 hard-coded “Versi 1” in respondent UI.

**Unresolved business decisions:**

- D-01: Is `org_admin` an approved actor with management rights over other creators’ surveys? PRD lacks the role.
- D-02: May an export-only grant export per-response data when `allow_individual` and/or `allow_results` are off? Current code says yes; README gates only reads.
- D-03: Is an archived survey allowed to return to `draft` on edit, and is that a documented restore path?
- D-04: Who verifies guardian evidence, and what server-side artifact constitutes verification/withdrawal?
- D-05: What is the retention/deletion SLA and data-subject verification procedure? No code path enforces it.
- D-06: Does `notice_version` change through organization/platform profile updates, a separate notice table, or a deployment process? Current API cannot change it.
- D-07: May the integration service token read any survey/version (including drafts), or must it be scoped per survey/version?
- D-08: Are public links expected to support sequential respondents on one shared device without clearing browser storage?
- D-09: Is cross-organization survey access by explicit admin grant permitted, or should grants be tenant-bounded?
- D-10: Should `super_admin` manage surveys, as README says, or remain operational-only, as PRD says?

## 7. Coverage gaps and NOT_VERIFIED

| Item | Why not verified | What would verify it |
| --- | --- | --- |
| Browser behavior for role-gated screens | No UI runtime on a provisioned port; source/static trace only | Playwright/login as owner, org_admin, grantee, super_admin against the audit UI |
| AC11 accessibility | UI/UX worker owns; screenshots are not interaction evidence | Keyboard + screen-reader + responsive audit on baseline |
| AC13 load | Perf worker owns; existing evidence is demo-only and pre-baseline | Rerun on this commit with recorded environment and 600 answers |
| AC15 restore/incident | Ops worker owns; existing evidence demo-only | Baseline restore, deletion-after-restore drill, incident exercise |
| AC16 field study | Requires real respondents and institutional review | Cannot be produced by this audit |
| Delete/withdrawal and retention enforcement | No implementation path; external procedure undefined | Controller-approved runbook plus code path or documented manual process |
| Notice version publication | No API exists | Product decision + implementation |
| Export recipient/purpose | No fields in request/audit | Product decision + implementation |
| Real Module 15 integration | Deliberately simulated | External contract and service |

## 8. Evidence index

| Evidence | Path | Content |
| --- | --- | --- |
| E1 | `docs/audit/2026-11-20/evidence/biz/biz-api-probes-2026-11-20T13-43-58-462Z.json` | 10 targeted API probes: profile source, consent reuse, close lifecycle, receipt scope, grantee/org-admin bootstrap, export permission, policy, data request |
| E2 | `docs/audit/2026-11-20/evidence/biz/biz-export-probe-2026-11-20T13-45-21-859Z.json` | Export-only grant vs `allow_results=0`/`allow_individual=0`; aggregate/individual denied while 2-row CSV exported |
| E3 | `docs/audit/2026-11-20/evidence/biz/biz-db-checks-2026-11-20T13-45-48-945Z.json` | DB state for probe survey: legacy profile vs scope, version/link statuses, consent reuse/overwrite, invitations, export audit metadata |
| E4 | `docs/test-evidence/ac13-load.json` | Existing demo load evidence (pre-baseline) |
| E5 | `docs/test-evidence/ac15-restore.json` | Existing demo restore evidence (pre-baseline) |
| E6 | `docs/test-evidence/ac16-walkthrough.{md,json}` | Existing synthetic walkthrough; old absolute path in Markdown; JSON summary/CSV/response IDs are null |

No credentials, cookies, tokens, or real-person data are recorded in E1-E3. Probe mutations are limited to synthetic rows in `svara_audit_docs`.

## 9. Report handoff

- Business-flow findings and invariant trace: `02-business-flows.md`.
- Actor/resource/tenant/state permission matrix: `03-role-access.md`.
- Cross-worker overlap: BF-01/BF-02/BF-03/BF-10 (privacy/consent/legal), BF-06 (legal/ops), BF-07/BF-09 (security/export/integration), BF-04 (state/quality), BF-08/BF-12 (UX copy/interaction), BF-11 (docs), E4-E6 (perf/ops); BR-01/BR-02/BR-03 (UI/API authorization parity).
