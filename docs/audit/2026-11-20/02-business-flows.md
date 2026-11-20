# 02 — Business flows, state transitions, and invariants

- Baseline: `95eafa3cb38aac4dd32963a1ec584a2ce6821f25`
- Scope: product flows, business rules, lifecycle/state transitions, consent, submission, export, retention, integration.
- Runtime: `127.0.0.1:4311` / `svara_audit_docs`; targeted synthetic probes E1-E3. No full suite, build, or load run.
- Related: document conflicts in `01-documents.md`; actor/permission matrix in `03-role-access.md`.

## 0. Findings summary

| ID | Severity | Finding | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| BF-01 | High | Public form displays legacy `profiles`/`notices` policy, not the survey’s organization/platform source; consent mode and notice version can be wrong. | FAIL | E1 `BIZ-01/02`, E3; `public.ts:199-208,233-234,255,262-263,281` |
| BF-02 | High | Consent is bound only to survey+version; it can be reused by another context/person, and `response_id` is overwritten so an earlier response has no consent link. | FAIL | E1 `BIZ-04`, E3; `public.ts:385-398,451-470` |
| BF-03 | High | Guardian consent is “verified” by any non-empty respondent-supplied reference; no verification, withdrawal, or evidence history. UI tells the respondent it is verified. | FAIL | E1, E3; `public.ts:456,468`, `Respondent.tsx:81,319,764` |
| BF-04 | High | Publish leaves the old version published; close closes the oldest published version; after “close” the newest link still accepts responses; invitations target the oldest published version and can be created after close. | FAIL | E1 `BIZ-03`, E3; `surveys.ts:480-483,518-529,558-563` |
| BF-05 | Medium | Notice/version governance is not implementable through the API: `notice_version` cannot be changed by organization/platform update; material profile changes are retroactive under the same version; duplicate carries the source version’s notice. | PARTIAL | `org.ts:115-131`, `admin.ts:304-317`, `surveys.ts:428` |
| BF-06 | Medium | Withdrawal/deletion is recorded as a generic request with no subject/response/consent key and no automated status effect; consent has no withdrawal transition; retention days are stored but never applied. | PARTIAL | E3; `001_initial.sql:150-163,235-245`; `admin.ts:488-521` |
| BF-07 | Medium | Export-only grant ignores `allow_results`/`allow_individual`; 2 per-response rows were exported while summary/individual reads returned 403. Export audit lacks recipient/purpose/column filter. | PARTIAL (policy decision) | E2, E3; `http.ts:176-179`, `surveys.ts:728,734-773` |
| BF-08 | Medium | Public-link idempotency key and consent are stored per token+version with no reset; a second respondent on the same browser inherits the first consent and collides on the first key. | FAIL (static UI) | `Respondent.tsx:60-96,519`; API scope `public.ts:557-573` |
| BF-09 | Medium | Integration endpoint is simulation-only, uses one global token that can read any survey/version including drafts, and never emits free text. | PARTIAL (P2 scope) | `integration.ts:9-75`; AC14 test |
| BF-10 | Medium | `/public/policy` reads legacy profiles; `/privacy` is static and does not display the actual controller identity/contact. | PARTIAL | E1 `BIZ-09`; `public.ts:681-697`, `Public.tsx:178-188,306` |
| BF-11 | Low/Medium | Documentation/evidence drift (tables, package manager, VACUUM INTO, super-admin claim, AC16 old path/provenance, AC08 fixture) can mislead operators and auditors. | PARTIAL | `01-documents.md` conflict register |
| BF-12 | Low | Respondent form footer hard-codes “Versi 1” for every version. | FAIL (copy) | `Respondent.tsx:519` |

No open Critical finding: the repository is explicitly synthetic/non-production, and no real-person data was observed. Severity reflects pilot-readiness impact if real data were introduced without fixing the flow.

## 1. Flow map

### 1.1 Account and organization onboarding

1. Public registration accepts email/password or an organization invitation code (`POST /auth/register`).
2. With a code, the server locks/validates the invitation, creates the account in that organization, and consumes the code in one transaction (`auth.ts:86-145`).
3. Login issues an opaque session cookie; every authenticated request reloads account role and status, so suspension blocks a live session (`security.ts:56-95`).
4. `org_admin` may invite creators, list/revoke invitations, list/suspend creators, update the organization profile, and read organization audit (`org.ts:50-307`).

Verdict: PASS for the implemented flow. The organization/actor model itself is an extension beyond the PRD (see BR-06 / D-01).

### 1.2 Survey authoring and publication

1. Creator creates a survey; individual scope has `organization_id=null`, organization scope uses the creator’s org (`surveys.ts:304-340`).
2. A draft version is created with `notice_version` from the *scope* source (`noticeVersionFor`), but `profile_id` defaults to the legacy `p_smk` row unless the request supplies one (`surveys.ts:322-345`).
3. Editor save writes metadata/questions/options into the draft; copy creates a new survey and a draft from `current_version_id`; archive closes all versions and links (`surveys.ts:371-452,540-557`).
4. Publish validates the draft, marks it published, creates one public link, records the publication timestamp, and audits (`surveys.ts:454-518`).
5. Editing a published survey creates a new draft; the published snapshot is not mutated (`surveys.ts:371-400`). This part matches the PRD.

Verdict: PASS for draft/publish snapshot; FAIL for policy source (BF-01) and version lifecycle after a second publish (BF-04).

### 1.3 Distribution

1. A published version can have one public link, reusable by many respondents (`001_initial.sql:131-141`; `surveys.ts:484-495`).
2. An invitation creates a fresh assignment plus a one-use token; both plaintext `token` and `token_hash` are stored in the invitation row (`surveys.ts:558-604`; `001_initial.sql:116-129`). Token-at-rest handling belongs to the Security worker.
3. Expiry/revocation state is derived at read time; expired invitations remain `active` in the DB but present as expired (`public.ts:240-247`; `bootstrap.ts:279`).
4. Revoking a survey invitation does not reject an already-used invitation; it rewrites status to `revoked` while `used_at` remains (`surveys.ts:610-621`). Organization invitations correctly reject a used code (`org.ts:269-271`). This state asymmetry is part of BF-04.

### 1.4 Public intake and consent

1. `GET /public/surveys/:token` resolves invitation or public link, survey/version, state, profile, notice, and consent requirement. Questions are withheld until a granted consent is supplied (`public.ts:226-317`).
2. Consent requires eligibility and respondent click; guardian evidence is “required” when the profile says minor/guardian (`public.ts:432-485`).
3. `POST consent` inserts a single `consent_records` row with `basis`, `notice_version`, `guardian_evidence_*`, and `status='granted'` (`public.ts:451-483`).
4. Form access then checks only `consent.survey_id`, `consent.version_id`, and `status==='granted'` (`public.ts:385-398`). It does not compare invitation/assignment/link/respondent context.
5. UI builds consent client-side and writes `guardian_evidence_status='verified'` whenever the evidence-ref string is non-empty (`Respondent.tsx:74-83`); the server independently sets `verified` for any non-empty ref (`public.ts:456,468`). The review screen then prints “Terverifikasi” (`Respondent.tsx:764`).

Verdict: consent gate exists, but evidence and context binding fail (BF-02/BF-03).

### 1.5 Submission, idempotency, receipt

1. Submission requires `Idempotency-Key`; scope is `invitation:<assignment>` or `public:<link>` (`public.ts:559-563`).
2. Same key + same payload returns the stored receipt; same key + different payload returns 409; a per-scope advisory lock serializes concurrent attempts (`public.ts:565-643`).
3. In the transaction the handler re-reads the version published state, invitation state (active/unused), and consent, then inserts attempt/response/answers/event (`public.ts:585-643`).
4. Receipt lookup requires the same scope + key; a public-link receipt cannot be fetched through an invitation context (`public.ts:660-675`; E1 `BIZ-05` PASS).
5. Every response gets a random `respondent_id`; assignment uniqueness prevents two responses for one invitation (`001_initial.sql:165-178`).

Verdict: PASS for atomicity/idempotency/receipt scope; consent preconditions are under-bound (BF-02). A submit racing close is discussed in §4.4.

### 1.6 Results, individual reads, export

1. Summary defaults to the newest published version; any version ID is accepted after ownership check. Denominators are per item, with `answered/skipped`, zero-count options preserved, and free-text count (`summary.ts`; `surveys.ts:664-678`).
2. Individual responses require `canReadIndividual`; managers (owner/org admin) always qualify, grants additionally require `allow_individual` (`http.ts:155-171`).
3. CSV/codebook require `canExport`; export rows include `respondent_id`/`response_id` and pseudonymous assignment data. Free-text columns require `canReadFreeText`; without it short-text questions are dropped (`surveys.ts:697-780`; `export.ts`).
4. Export audit records survey, version, rows, and `includeText` only (`surveys.ts:773`). No recipient, purpose, or column filter.
5. Runtime: with `allow_results=0` and `allow_individual=0`, an export-only grant still returned a 2-row CSV while summary and individual endpoints returned 403 (E2, E3).

Verdict: aggregate/CSV correctness PASS; authorization policy for export PARTIAL (BF-07).

### 1.7 Close, archive, duplicate

1. Close finds the first published version ordered by number, closes it, closes that version’s links, and sets survey status `closed` (`surveys.ts:518-537`).
2. If two versions are published, close affects only the older one. The newest version and its public link remain active; the API still allows a new invitation because the invitation route never checks survey status (`surveys.ts:558-563`; owner UI share disables it after close).
3. Archive closes every draft/published version and all links, sets survey `archived` (`surveys.ts:540-557`).
4. Saving an archived or closed survey creates a new draft and sets survey status `draft`, so archive/close are reversible by editing (`surveys.ts:375-400`). This is not documented as a product transition.

Verdict: FAIL for close semantics (BF-04); archive→draft requires a decision (D-03).

### 1.8 Policy, data requests, retention

1. `/public/policy` returns every legacy profile and notice; the contact is the first non-null legacy contact, with a placeholder fallback (`public.ts:681-697`).
2. `/data-requests` accepts type/contact/note without a survey/response/consent identifier; admin can set `pending → handled` with a note (`public.ts:699-718`; `admin.ts:488-521`).
3. `retention_days` is stored on platform/organization profiles but is not read by any query, job, or route (`rg retention_days` shows schema/auth only).
4. `/privacy` is static copy; it does not render the controller identity/contact (`Public.tsx:178-188`).

Verdict: PARTIAL; manual process is a legitimate pre-pilot limit, but the UI/records do not meet the stated controller-contact and traceable-deletion rules (BF-06/BF-10).

### 1.9 Module 15 integration

1. `GET /integration/v1/surveys/:id/versions/:versionId/responses` requires a bearer token common to the service (`integration.ts:9-35`).
2. Any survey/version ID is accepted; draft versions are not excluded. One token grants the whole dataset.
3. Responses include question code, option ID/value, answer version, and pseudonymous IDs; free-text values are never returned (`integration.ts:55-75`).
4. Submission inserts a `delivered`, `simulated=1` event in the same transaction; admin retry can only mark a failed-looking event (`public.ts:628-636`; `admin.ts:523-549`).

Verdict: PARTIAL; explicitly simulated, but token scope and draft exposure need a decision (BF-09 / D-07).

## 2. State machines

### 2.1 Survey

| From | To | Trigger | Guards | Actual side effects |
| --- | --- | --- | --- | --- |
| none | `draft` | `POST /surveys` | creator | survey + draft version + settings |
| `draft` | `published` | `POST /publish` | manager, valid draft | version published, link created, audit |
| `published` | `published` | `PUT /surveys/:id` | manager | new draft, `current_version_id` changes, old version stays published |
| `published` | `closed` | `POST /close` | manager | only oldest published version closed; survey closed |
| `closed` | `draft` | `PUT /surveys/:id` | manager | new draft, survey status draft (reopen path undocumented) |
| `archived` | `draft` | `PUT /surveys/:id` | manager | new draft, survey status draft (undocumented restore) |
| any | `archived` | `POST /archive` | manager | all draft/published versions closed, all links closed |
| `archived` | `archived` | `POST /archive` | manager | repeated archive allowed; no state guard |

DB stores status as free text with no `CHECK` (`001_initial.sql:54-66`); application transitions are the only guard.

### 2.2 Version

| From | To | Trigger | Guard | Notes |
| --- | --- | --- | --- | --- |
| none | `draft` | create/edit/copy | manager | `(survey_id, number)` unique |
| `draft` | `published` | publish | manager, valid questions | one public link per version |
| `published` | `closed` | close/archive | manager | close only oldest; a second publish leaves the first open |
| `draft` | `closed` | archive | manager | no reopen |
| `closed` | any | — | — | terminal in DB; only a new draft can be published |

### 2.3 Invitation

| From | To | Trigger | Guard | Notes |
| --- | --- | --- | --- | --- |
| none | `active` | `POST /surveys/:id/invitations` | manager; any published version | picks oldest published; no survey-state guard |
| `active` | `used` | successful submission | active, unused, version matches | `used_at` set |
| `active` | `revoked` | `POST /invitations/:id/revoke` | manager | **already-used invitations are also rewritten to revoked** |
| `active` | `expired` (derived) | read time | `expires_at < now` | DB status stays active |
| `used` | `used` | duplicate submit | transaction | 409/409 receipt; no second response |

### 2.4 Public link

| From | To | Trigger | Guard | Notes |
| --- | --- | --- | --- | --- |
| none | `active` | publish | manager | one per version |
| `active` | `closed` | close/archive of its version | manager | other versions unaffected |
| `active` | `expired` (derived) | read time | `expires_at` | no DB update |

### 2.5 Consent

| From | To | Trigger | Guard | Actual |
| --- | --- | --- | --- | --- |
| none | `granted` | `POST consent` | context can submit; eligibility/click; guardian ref as needed | row inserted |
| `granted` | `granted` | successful submit | survey+version+status only | `response_id` set; later reuse overwrites it |
| `granted` | `withdrawn` | — | no endpoint | not implemented |
| — | history | — | — | one mutable row; no status history |

### 2.6 Data request and integration event

| Entity | Transition | Guard | Effect |
| --- | --- | --- | --- |
| Data request | `pending → handled` | super admin | status + outcome note; no consent/response mutation, no subject key |
| Integration event | `delivered` | submission transaction | rows exist iff response exists |
| Integration event | `delivered → failed` | super admin retry | simulation-only marker; no consumer replay |

## 3. Invariants — PRD §6 trace

The PRD table is not numbered; IDs below are audit-local.

| ID | Invariant | Trace | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| I-01 | Account and respondent are distinct | Separate `accounts`/`respondents`; response stores `respondent_id` | PASS | `001_initial.sql:37-45,143-148,165-175` |
| I-02 | Publication fixes version, questions, link | Snapshot version; links per version | PASS | `surveys.ts:454-495`; AC02/AC04 tests |
| I-03 | Chosen option belongs to the item | Server finds option within question | PASS | `public.ts:353-379`; AC05 |
| I-04 | Invitation belongs to participant/assignment and is consumed once | Token hash, assignment unique, `used_at`/status checked in tx | PASS | `001_initial.sql:108-129,165-178`; AC06 |
| I-05 | Public link supports many respondents, not one human | Link has no used flag; response count unlimited | PASS | schema; AC13 demo |
| I-06 | One answer per item per response | Unique `(response_id, question_code)` | PASS | `001_initial.sql:180-189` |
| I-07 | One final response per assignment under concurrency | Unique `responses.assignment_id`; invitation row lock | PASS | AC06 test |
| I-08 | Consent before form and before final submit | Questions withheld; submit validates consent | PASS | `public.ts:385-398`; AC05 |
| I-09 | Consent belongs to context, survey, version; history preserved | Version checked; context ignored; no history | **FAIL** | BF-02; E1/E3 |
| I-10 | Identical retry returns same result; changed payload rejected | Scoped advisory lock + key + payload hash | PASS | AC07; E1 `BIZ-05` |
| I-11 | Event completes only after response stored | Event insert in same transaction | PASS (simulation) | `public.ts:628-636` |
| I-12 | Audit/logs exclude tokens, credentials, answers | Audit metadata is counts/IDs/actions; integration token not logged | PASS | `audit.ts`; reviewed calls |
| I-13 | Tenant/visibility separation | API owner/org/grant checks; UI divergence | PASS (API), FAIL (UI) | AC03/tenant tests; BR-01/02/03 |
| I-14 | Final response is immutable | No update/delete endpoint; transaction inserts only | PASS | route inventory; schema |
| I-15 | Respondent click separated from guardian evidence/verification | One self-asserted record; UI labels verified | **FAIL** | BF-03 |

## 4. Critical edge cases

### 4.1 Publish B while A is open

Implementation: A remains published, B is published, both links active. The PRD explicitly allows an already-open A to keep accepting while B is published. **This part is intended.**

Consequence: “published” is not unique per survey, but every route that needs “the” published version disagrees:
- publish uses the draft;
- close uses the oldest published;
- invitations use the oldest published;
- summary/responses/export use the newest published (`http.ts:256-264` vs `surveys.ts:480-483,518-529,558-563`).

### 4.2 Close after B is published

Reproduced in E1 `BIZ-03`, DB in E3:
- after publishing v2: `v1=published`, `v2=published`;
- new invitation created: `version_id = v1` (old);
- `POST close`: `v1=closed`, survey=`closed`, `v2=published`, v2 link=`active`;
- new consent and response on the v2 link: **201** after survey status `closed`;
- new invitation after close: **201** via API (targets v2); the owner UI share page disables invitations when survey status is `closed`/`archived` (`CreatorData.tsx:66`), so this is API-reachable and not the normal UI path.

Therefore “close survey” does not stop new submissions, and “current version” for invitations is the oldest, not the newest.

### 4.3 Consent reuse and lost response linkage

Reproduced: a granted consent created for the v2 public link was accepted by an invitation for the same version; both submissions returned 201. DB:
- 2 responses for the probe version;
- 1 consent row;
- 1 response has a consent link, the other has none;
- the consent’s `invitation_id` is null despite being used by an invitation submission.

The server checks only survey/version/status (`public.ts:385-398`). It never compares `consent.invitation_id`, assignment, respondent, or link. On reuse, it updates `consent.response_id` to the latest response, destroying the earlier audit link.

### 4.4 Submit racing close

Static: submit re-reads the version status inside its transaction (`public.ts:585-589`) but does not lock the version/survey row; close updates the version and survey without coordinating with in-flight submissions. A submission that read `published` before close could insert and commit after close. This can linearize as “submit before close”, so it is not reported as a proven defect, but the final stored state can be a response on a closed version. No deterministic probe was run; concurrency remains **NOT_VERIFIED** for this edge.

### 4.5 Revoke after use

`POST /invitations/:id/revoke` lacks a used/expiry check (`surveys.ts:610-621`). A used invitation can become `revoked` while `used_at` and the response remain. Public context still resolves to `used` because it checks for an existing response first (`public.ts:236-240`), so access is not reopened; the status/audit record is corrupted. Organization invitation revocation rejects used codes (`org.ts:269-271`), making the inconsistency explicit.

### 4.6 Export vs `survey_settings`

`canExport` is independent of `allow_results`/`allow_individual` (`http.ts:176-179`). E2: settings both off; summary 403; individual responses 403; CSV 200 with 2 per-response rows. The separate PRD export permission can justify this, but then the settings copy and README must say that export is an independent data-egress permission. Current docs do not. Decision D-02.

### 4.7 Shared device / second respondent

Client state is keyed by token only (consent) or token+version (idempotency key):
- `readConsent(token)` loads the first respondent’s granted consent (`Respondent.tsx:74-83`);
- the key is stored once per token+version and never cleared after receipt (`Respondent.tsx:60-96,660`);
- the receipt page only links back to the introduction (`Respondent.tsx:905`); it does not clear the stored consent or key on “start another respondent”.

On a school kiosk/shared phone, respondent 2 either inherits respondent 1’s consent or submits with the same key and a different payload → 409. Server idempotency is correct; the client key lifetime makes a legitimate multi-respondent public link unusable without clearing storage. No browser runtime was available; verdict is static, UI runtime **NOT_VERIFIED**.

### 4.8 Notice/version provenance

- `surveys.profile_id` remains `p_smk` for every newly created survey unless the client sends a profile ID; the UI does not offer that field (`surveys.ts:322-325`; `api.ts` create call).
- Public form loads `profiles` by `profile_id` and falls back to `p_smk`; notice lookup falls back to the latest notice when the exact version is absent (`public.ts:199-208,262-263`).
- Individual-scope survey: detail/bootstrap says `platform`, public says `SMK Nusantara` with minor/guardian; stored `notice_version=2.0`, rendered notice `1.0`.
- Organization-scope survey for `org_perpus`: detail says `org_perpus` adult/self; public says `p_smk` minor/guardian; stored notice `1.2`, rendered `1.0`.
- Consent rows store the version field from the survey version (1.2/2.0), while the respondent saw notice text 1.0. This defeats “notice_version asal usulnya dapat dibuktikan”.

Notice updates also cannot be published: org/platform PUT omits `notice_version`, and no notice-text endpoint exists (BF-05). Duplicating a survey copies the source version’s notice version, not the current policy (`surveys.ts:428`).

### 4.9 Archive → draft

Saving an archived survey creates a draft and sets status `draft` (`surveys.ts:375-400`). This may be a useful restore path, but it is not in PRD/README. It also means archive is not terminal; no separate “restore” audit action exists. Decision D-03.

### 4.10 Tenant change

Account organization changes are handled by admin; surveys keep their stored `organization_id`. Owners keep ownership. This avoids silently moving tenant data, but an owner who leaves an organization retains management of that organization’s survey, and a new org admin can manage it. The policy is not stated; decision D-09.

## 5. Finding detail

### BF-01 — Public policy/notice source is legacy, not the survey scope

- Requirement: PRD §1.2 (“survei memakai … organisasi yang ditunjuk atau `platform_profile`”; no fallback), §9.1/§9.2; README `:129-154,166`.
- Actor/scope: public respondent; every survey.
- Expected: individual → platform profile (self consent default), organization → that organization row (e.g. `org_perpus`, adult/self); notice version matches the source.
- Actual: public endpoints read `profiles` by `surveys.profile_id` (`p_smk` fallback); individual shows SMK/minor/guardian, organization Perpus shows SMK/minor/guardian; consent version 2.0/1.2 but displayed notice 1.0.
- Evidence: E1 `BIZ-01/02`, E3 surveys/consent; `public.ts:199-208,233-234,255,262-263,281`; README `:149,166`.
- Impact: informed consent is obtained under the wrong controller/age/consent mode; “no fallback” claim is false.
- Confidence: High (API + DB + code). Severity: High.
- Related: BF-10, D-06.

### BF-02 — Consent is not bound to its context and is destructively reused

- Requirement: PRD §6 (consent belongs to a context; another context cannot retrieve proof), AC12 (consent from another context), §9.1 (history/withdrawal).
- Actor/scope: public link and invitation respondents; same survey/version.
- Expected: reject a consent created for another invitation/link/respondent; preserve per-response consent links and status history.
- Actual: any granted consent for the same survey+version passes; public-link consent accepted by invitation; same consent returned two 201 responses; only one response retains a consent link; `invitation_id` remains null.
- Evidence: E1 `BIZ-04`, E3 (`responses=2`, `responses_with_consent=1`, `with_invitation_id=0`); `public.ts:385-398,451-470,621`.
- Impact: cannot prove which response had which consent; a second person can submit under the first person’s consent.
- Confidence: High. Severity: High.
- Related: BF-03, BF-08, BR-08.

### BF-03 — Guardian evidence is self-asserted and labelled verified

- Requirement: PRD §1.2 (“verifikasi bukti dan pemberitahuan sebelum pengisian”), §6 (“pisahkan klik responden dari bukti persetujuan/verifikasi”), §9.1, AC12/R5.
- Actor/scope: minor/guardian-mode survey respondent.
- Expected: server-side verification artifact (verifier, time, status) or rejection until verified; withdrawal/history.
- Actual: UI fabricates `guardian_evidence_status='verified'` from a non-empty string (`Respondent.tsx:81`); server sets `verified` for any non-empty `guardian_evidence_ref` (`public.ts:456,468`); review page says “Terverifikasi” (`Respondent.tsx:764`); no verifier identity, no verification record, no withdrawal route.
- Evidence: E1 consent response, E3 `verified_guardian=1`; UI/API code.
- Impact: child-data consent control is cosmetic; cannot evidence valid guardian permission.
- Confidence: High. Severity: High.
- Related: R5, AC12.

### BF-04 — Close/publish/invitation lifecycle is inconsistent

- Requirement: PRD §5.1/5.2 (“penutupan menghentikan pengiriman”; versioned A/B behavior), AC04/R7.
- Actor/scope: manager; survey with two published versions.
- Expected: a survey-level close stops every open version/link; “current” version is newest published; invitations target the current version; post-close invitation creation is blocked unless a new version is explicitly opened.
- Actual: publish v2 leaves v1 published; close closes v1 only; survey `closed`, v2/link active; v2 accepts consent+response 201; invitations created after v2 publish target v1; invitations created after close return 201 via API (target v2; owner UI share disables them); revoke can rewrite a used invitation to revoked.
- Evidence: E1 `BIZ-03`, E3 versions/links/invitations; `surveys.ts:480-483,518-529,558-563,610-621`.
- Impact: operators believe the survey is closed while data collection continues; old-version invitations can be issued.
- Confidence: High (runtime). Severity: High.
- Related: BF-05, D-03, D-08.

### BF-05 — Notice/version governance is not implementable

- Requirement: PRD §9.1 (material notice change → new version; no retroactive notice change), F-18/AC17.
- Actual: organization/platform PUT can change age category, consent mode, retention, policy URLs, but not `notice_version`; no notice-text endpoint; notice lookup silently falls back to another version; duplicate copies the old version.
- Evidence: `org.ts:115-131`, `admin.ts:304-317`, `public.ts:262-263`, `surveys.ts:428`.
- Impact: respondents can consent under an old/mismatched notice version; operators cannot publish a corrected notice through the product.
- Confidence: High. Severity: Medium/High governance.
- Decision: D-06.

### BF-06 — Withdrawal, deletion, and retention are not enforced

- Requirement: PRD §6 consent status history, §9.2 withdrawal/deletion, R8; AC12.
- Actual: data request has no survey/response/consent key (`data_requests` columns), admin only changes status/note; consent has no withdrawn state; `retention_days` is never consumed; no purge job or documented manual runbook in repo.
- Evidence: E3 `data_request_columns`, `data_requests`; `admin.ts:488-521`; `001_initial.sql:150-163,235-245`.
- Impact: data-subject requests cannot be reliably matched or proven executed; retention is aspirational.
- Confidence: High (absence), external procedure unknown. Severity: Medium.
- Disposition: partly intended pre-pilot limit; decision D-05.

### BF-07 — Export permission bypasses settings and audit is incomplete

- Requirement: PRD §7.2 (recipient, purpose, filter), §9.1 (separate export permission), README `:173` (settings gate).
- Actual: export-only grant with settings off returned 2 per-response rows (200) while summary/individual returned 403; export audit has `{rows, includeText}` only.
- Evidence: E2, E3 `export_audit`; `http.ts:176-179`; `surveys.ts:728,773`.
- Impact: `allow_individual` does not prevent row-level egress if an export grant exists; cannot reconstruct who exported why.
- Confidence: High. Severity: Medium (policy ambiguity; D-02).

### BF-08 — Shared-device public link key/consent lifecycle

- Requirement: PRD §5.2 (public link reusable by many), F-10/F-12, invariant 10 (idempotency), R3.
- Actual: consent keyed by token, idempotency key by token+version, both sessionStorage; no reset after receipt; second respondent inherits consent or hits 409 with a changed payload.
- Evidence: static `Respondent.tsx:60-96,519,660`; API scope `public.ts:557-573`.
- Impact: public links fail for sequential respondents on one device; consent linkage is further degraded.
- Confidence: High static; UI runtime **NOT_VERIFIED**. Severity: Medium.

### BF-09 — Integration token scope and simulation

- Requirement: PRD §8/§14, AC10/AC14; R1.
- Actual: one global bearer token reads any survey/version, drafts included; endpoint returns no free text; events are always `delivered`/simulated; no pagination; admin retry does not call a consumer.
- Evidence: `integration.ts:9-75`; `api.test.ts:913-961`.
- Impact: acceptable for simulation, not sufficient for a real Module 15 connection; least-privilege/tenant scope unresolved.
- Confidence: High. Severity: Medium (P2). Decision D-07.

### BF-10 — Data-request channel has legacy/static policy content

- Requirement: PRD §9.2, AC17.
- Actual: `/public/policy` returns legacy `profiles`/`notices` and the first non-null legacy contact, falling back to the placeholder `privasi@organisasi.contoh`; `/privacy` is static and does not display controller identity/contact; static page says contact is in the survey notice, which may itself be wrong (BF-01).
- Evidence: E1 `BIZ-09`; `public.ts:681-697`; `Public.tsx:178-188,306`.
- Impact: data subjects may not know the actual controller or how to reach them; privacy content is not deployment-specific.
- Confidence: High. Severity: Medium.

### BF-11 — Documentation/evidence drift

See `01-documents.md` C-06/C-07/C-08/C-14/C-15 and BF-11. This is a documentation defect, not a behavior claim; it becomes material when operators use README for backup/tooling or auditors use AC13/15/16 as baseline evidence. In particular, `ac16-walkthrough.json` has `summary`, `csv`, and `response_ids` set to `null` while the Markdown asserts 8 summary/8 CSV rows, so the synthetic reconciliation is not reproducible from its structured artifact.

### BF-12 — Hard-coded version label

- Actual: respondent form footer always says “Versi 1 terkunci untuk formulir ini” (`Respondent.tsx:519`), including v2/public v2.
- Expected: display the resolved version number.
- Impact: low, but undermines confidence in version explanation/receipt.
- Severity: Low. Confidence: High static.

## 6. Unresolved decisions

- D-01 org-admin role authority and whether it may manage other creators’ surveys (PRD silent).
- D-02 export vs `allow_individual`/`allow_results` policy.
- D-03 archived/closed survey restore path and audit semantics.
- D-04 guardian verification authority/artifact and withdrawal procedure.
- D-05 data-subject verification, deletion, retention, and evidence-of-deletion procedure.
- D-06 notice version/text publication mechanism and retroactivity rule.
- D-07 integration token scope, draft visibility, and pagination.
- D-08 shared-device multi-respondent behavior and consent reset.
- D-09 cross-org grants and owner retention after organization change.
- D-10 super-admin survey-management authority (README vs PRD).

## 7. NOT_VERIFIED

- Real-time/browser behavior for BF-08 and the UI-only role findings (no UI runtime on a provisioned port).
- Close-vs-submit and revoke-vs-use concurrency under simultaneous requests (static analysis only; no deterministic stress).
- Real Module 15 consumer behavior; simulation only.
- Retention/deletion/withdrawal execution and restore-after-delete; external runbook absent.
- AC11/AC13/AC15/AC16 (owned by UX/Perf/Ops; synthetic evidence only).
- Legal validity of guardian verification/consent; external.
