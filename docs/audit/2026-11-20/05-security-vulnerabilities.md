# 05 — Security, vulnerabilities, dependencies, and deployment

- Baseline: `95eafa3cb38aac4dd32963a1ec584a2ce6821f25`
- Date: 2026-11-20 (UTC)
- Scope: threat model, identity/session, authorization, tokens, consent, input/error paths, headers, data exposure, secrets, DB/container, CI/dependency supply chain.
- Result: **STATIC REVIEW + PURE-FUNCTION PROBES + TARGETED SYNTHETIC HTTP/API CHECKS**. The security worker used static analysis; coordinator later exercised API/bootstrap/integration paths on `svara_audit_sec`; business-flow probes in `evidence/biz/` independently exercised public consent, close, and export behavior.
- Runtime limit: all API checks used local synthetic accounts/data at port `4331` or the isolated business API at `4311`. No staging/production, user session, external host, or real participant data was touched. Full session lifecycle, ingress/proxy, scanner/image, concurrency and DoS checks remain unverified.
- Evidence: `docs/audit/2026-11-20/evidence/sec/`.
- Related audits: `03-role-access.md` (UI/API role access), `06-performance-scalability.md` (rate-limit capacity). This report covers the security consequence and does not re-audit their UI/throughput scope.

## 0. Findings at a glance

“Confirmed” means code path was established from the pinned tree; where runtime corroboration exists, the exact synthetic request and result are cited separately. It is not an exploit against a deployed system.

| ID | Sev. | Conf. | Finding | Verdict |
| --- | --- | --- | --- | --- |
| SEC-01 | High | High | Public consent mode/notice comes from a legacy `profiles` row, not the survey tenant; guardian requirements diverge | Confirmed static + runtime API |
| SEC-02 | High | High | Consent notice silently falls back to an older version; stored `notice_version` differs from rendered version | Confirmed static + runtime API |
| SEC-03 | High | High | Grant `can_export` bypasses `survey_settings.allow_individual`, exporting row IDs and answers denied by `/responses` | Confirmed static + runtime API/CSV |
| SEC-04 | High | High | Guardian evidence is marked “verified” from any nonempty client string, without verification | Confirmed static + runtime consent |
| SEC-05 | Medium | High | Unauthenticated login accepts ~500 KB emails/passwords, writes the email to `audit_logs.actor`, and keys an unbounded in-memory map | Confirmed static + probe |
| SEC-06 | Medium | Medium | Rate limiting is process-local, has no `trust proxy`; behind the documented ingress all clients share one IP and one global bucket | Confirmed static; deployment impact inferred |
| SEC-07 | Medium | High | Shared-tab consent/draft/receipt reuse: `sessionStorage` is not cleared; a later person can submit under the prior consent or see the prior receipt | Confirmed static |
| SEC-08 | Medium | High | Consent is bound only to survey/version; it can be replayed across invitation/public contexts and `response_id` is overwritten | Confirmed static + runtime API |
| SEC-09 | Medium | High | Invitation code is 24-bit (`UND-` + 3 random bytes); the resolver returns the raw bearer token and has only a per-IP limit | Confirmed static |
| SEC-10 | Medium | High | Invitation/public-link bearer tokens are stored raw and exposed in URLs/bootstrap | Confirmed static + runtime bootstrap |
| SEC-11 | Low | High | Invitation codes are written to audit `object` and returned by `/admin/audit`, contradicting the “no tokens in audit” rule | Confirmed static |
| SEC-12 | High | High | One global `INTEGRATION_TOKEN` reads identity/answers across tenants and can select draft versions; no per-consumer scope | Confirmed static + limited runtime API (draft returned 0 rows)
| SEC-13 | Low | Medium | `COOKIE_SECURE` is documented but unused; cookie `Secure` trusts any client-supplied `X-Forwarded-Proto` | Confirmed static; deployment result not verified |
| SEC-14 | Low | High | Audit records grant counts, not targets/permissions; table is writable by the app role, so “append-only” is not enforced | Confirmed static |
| SEC-15 | Medium | High | Super admin can grant themselves `can_read_individual`/`can_export` to any survey; no self-grant or dual-control check | Confirmed static |
| SEC-16 | Low | High | Summary returns exact counts including groups of one; no small-cell suppression | Confirmed static |
| L-01…L-07 | Low | High | Cache headers, invalid expiry, CSV numeric formatting, session lifecycle, malformed cookie, container/CI hardening, default placeholders | Confirmed static/probe |
| H-01…H-07 | — | — | Race, brute-force feasibility, proxy logs, CSP/browser, DB backups, image CVEs, email timing | NOT_VERIFIED / hypothesis |

## 1. Scope, limits, and method

**In scope (read-only):** `server/`, `src/`, `docker/`, `docker-compose.yml`, `Dockerfile.*`, `.github/workflows/`, `pnpm-lock.yaml`, `PRD.md`, `README.md`, migrations, and synthetic seed data.

**Out of scope / not exercised:** production, staging, `svara`, `svara_test`, user sessions, unrelated hosts, real data, external targets. No source, test, config, dependency, or existing evidence was modified. No full test/build/lint/formatter/load test.

**Method:** static dataflow from route → authorization helper → SQL → response/UI; exact `file:line` evidence; four bounded pure-function probes using an unreachable dummy DSN (`probes.md`); dependency advisory query against the pinned lockfile only. In the minimal sequences below, every mutating `/api` request is assumed to carry `X-Svara-Client: web`; without it `csrfGuard` returns 403 before the route (`server/security.ts:176-181`).

**What “confirmed” does not mean:** no HTTP request was sent to the API, no DB row was read or written, and no browser was driven. Exploit steps below are the minimal sequence that the code says would work; they remain **NOT_VERIFIED** at runtime.

## 2. Threat model and dataflow

### 2.1 Assets

| Asset | Why it matters | Where |
| --- | --- | --- |
| Survey answers, including optional free text | Can contain identifiers or sensitive opinions; export is the highest-value data | `answers`, `/surveys/:id/export`, `/responses` |
| `respondent_id` / `assignment_id` | Links responses across questions and to a named assignment; defeats anonymity | responses/CSV/integration |
| Consent and guardian evidence | Legal/ethical basis; guardian mode is required for minors | `consent_records`, public consent/submit |
| Invitation and public-link tokens/codes | Bearer access to submit; code is a second bearer credential | invitations, public_links, `/s/:token` |
| Session cookie | Creator/org-admin/super-admin authority | `sessions`, `Set-Cookie` |
| Integration token | Reads all survey data, including drafts | `INTEGRATION_TOKEN` |
| Audit log | Accountability; must not contain tokens/answers | `audit_logs`, `/admin/audit`, `/org/audit` |
| DB/CI credentials and deployment config | Lateral movement, data access | env, compose, workflow |
| Small-group aggregates | Can re-identify a single respondent | `server/summary.ts` |

### 2.2 Actors and prerequisites

| Actor | Prerequisite | Capability |
| --- | --- | --- |
| Anonymous internet | Network access | Register, login attempts, public link/invite resolution, data-request form |
| Respondent with link/token | Invitation/public-link URL or code | Consent, read form, submit once per context |
| Invited respondent with code | 24-bit code (or leaked URL) | Resolve to bearer token; submit |
| Creator in tenant A | Self-registered account attached to org A | Create surveys; choose arbitrary `profile_id`; manage own surveys |
| Org admin | Existing org account | Manage all surveys in org; read aggregate/individual/export according to helpers |
| Grantee (creator/other) | Super-admin/owner grant | Read/export selected survey; settings intended to constrain |
| Super admin | Privileged account | All surveys, accounts, grants, raw distribution tokens; **not** answers by default |
| Integration consumer | Global `INTEGRATION_TOKEN` | All survey/version response data |
| CI contributor / dependency attacker | Repo or package access | Poison lint/build or image; no runtime data unless secret reachable |
| Network/log observer | Ingress/proxy/analytics access | Bearer tokens in URL paths, cookies if TLS terminated incorrectly |

### 2.3 Trust boundaries and dataflow

```
Browser (untrusted)
  ├─ public /s/:token ───────────────► Next :3000 ──rewrite /api──► Express :3001
  │     consent, form, submit, receipt                         │
  ├─ creator/admin UI (session cookie) ────────────────────────┤
  │     bootstrap, CRUD, summary, responses, export, audit    │
  └─ /s (invite code) ── resolve ──► raw invitation token ─────┘
                                                               │
Express ── parameterized SQL ──► PostgreSQL (app role = DB owner)
   │                               ├─ accounts/sessions/consents
   │                               ├─ surveys/versions/questions/answers
   │                               └─ invitations/public_links (raw token + hash)
   ├─ INTEGRATION_TOKEN ──► all surveys/versions, including drafts
   ├─ console/error logs (no body by default)
   └─ audit_logs (mutable by app role)

Ingress / TLS / logs (production boundary): /api/* -> Express; / -> Next.
CI: GitHub Actions -> install/build -> Docker images -> registry -> deploy.
```

**Boundary conclusions:** tenant separation is enforced on creator/org-admin management paths (`organization_id` / owner checks), but not on the public consent-policy lookup (`SEC-01`) or the integration API (`SEC-12`). The public token is the primary capability; revocation and consent binding are weaker than the management path.

### 2.4 Attacker → asset → prerequisite → control → impact

| Attacker | Asset | Prerequisite | Intended control | Actual impact / finding |
| --- | --- | --- | --- | --- |
| Anonymous internet | Accounts, audit, process memory | Network | Registration limits, login policy, bounded input | Account/DB/memory growth (`SEC-05`); global registration lockout behind ingress (`SEC-06`) |
| Respondent holding a link | Answers, consent | Valid token | Consent + one-response idempotency + rate limit | Can reuse prior consent/shared tab (`SEC-07/08`); no guardian verification (`SEC-04`) |
| Code guesser | Invitation bearer token | 24-bit code or leak | 20 attempts/10 min/IP | Weak credential + raw token disclosure (`SEC-09/10`) |
| Creator in tenant A | Tenant B policy/notice, minor consent | Creator account | Policy source derived from tenant | Arbitrary `profile_id` selects guardian/self and foreign policy (`SEC-01`); notice mismatch (`SEC-02`) |
| Grantee | Row-level identities/answers | Grant + account | `can_read_individual` + `allow_individual` | Export bypasses both (`SEC-03`) |
| Org admin | Own-tenant data | Org account | `organization_id` filter | Not directly broken in reviewed paths; UI/API gaps cross-referenced to `03-role-access.md` |
| Super admin | All answers | Admin account | No automatic answer access; grants | Self-grant + all distribution tokens (`SEC-15`, `SEC-10`) |
| Integration consumer | All survey/version data | Global token | Scoped service credential | Global read, including drafts (`SEC-12`) |
| DB/log/backup observer | Bearer tokens, identity/answers | Infra read | Hashing/redaction/immutability | Raw tokens, URLs, audit codes (`SEC-10/11/14`) |
| CI/dependency attacker | Build/runtime | Repo/package access | Lockfile, review, scans | No audit/SBOM/image scan; mutable tags (`L-06`) |
| Small-group analyst | Re-identification | Aggregate access | Threshold/suppression | Exact n=1 cells (`SEC-16`) |

## 3. Control assessment

| Control | Verdict | Evidence / note |
| --- | --- | --- |
| Password hashing | PASS | scrypt, random 16-byte salt, timing-safe compare (`security.ts:10-41`); sync cost documented in SEC-05 |
| Session token entropy/storage | PASS | 32 random bytes; only SHA-256 hash stored (`security.ts:67-77`); no password change/revoke-all |
| Cookie flags | PARTIAL | HttpOnly/SameSite=Lax/path; `Secure` conditional and `COOKIE_SECURE` unused (`SEC-13`) |
| CSRF | PARTIAL | custom `x-svara-client` + Origin/Host check; no CORS; same-origin XSS would bypass (`security.ts:172-189`) |
| SQL injection | PASS | all observed queries parameterized; dynamic `IN` placeholders only (`surveys.ts:746-750`, `admin.ts:400-408`) |
| XSS | PASS (static) | React escaping; no `dangerouslySetInnerHTML`/`eval`; CSP nonce+strict-dynamic on pages (`proxy.ts`) |
| CSP/headers | PARTIAL | page nonce CSP + XFO/Referrer/Permissions (`src/proxy.ts:13-23`); API equivalents (`app.ts:28-38`); HSTS opt-in; browser behavior not tested |
| Authentication/registration | PARTIAL | generic errors, strong password policy; no email verification/MFA; login input unbounded (`SEC-05`) |
| Session lifecycle | PARTIAL | expiry/status checked per request; deactivation blocks, reactivation revives old rows; no password/global revoke (`L-04`) |
| Role authorization | PARTIAL | management helpers are sound; super-admin self-grant (`SEC-15`) |
| Object authorization | FAIL | export bypasses settings (`SEC-03`); public policy source is arbitrary (`SEC-01`) |
| Tenant isolation | PARTIAL | org-admin/creator management scoped; public policy and integration are not |
| Grants | PARTIAL | individual permission checks settings; export does not; self-grant possible |
| Origin/CSRF | PASS with caveat | no CORS; custom header requirement; same-origin only; see CSRF row |
| Rate limiting | FAIL | in-memory, no sweep, no trust proxy, global buckets behind ingress (`SEC-05/06`) |
| Idempotency | PARTIAL | unique `(scope,key)` + payload hash conflict 409 + receipt requires same scope/key/response (`public.ts:539-569,660-675`); concurrency not tested (H-01) |
| Invitation/token lifecycle | FAIL | 24-bit code, raw token storage/URLs, code in audit, no rotation (`SEC-09/10/11`) |
| Consent integrity | FAIL | arbitrary profile, silent notice fallback, self-attested guardian, weak binding (`SEC-01/02/04/08`) |
| Input validation/error paths | PARTIAL | limits on many strings, generic errors; login unbounded, invalid expiry, malformed cookie 500 |
| Data minimization | PARTIAL | free text/identity optional; raw tokens, identity in exports/integration |
| Audit | PARTIAL | success/denial coverage incomplete; grant details missing; mutable table (`SEC-14`) |
| Secrets | PARTIAL | env-based, no committed `.env`; placeholders/defaults and no startup guard (`L-07`) |
| Dependencies | PASS (prod) | `pnpm audit --prod` clean; one dev-only `minimatch` advisory (`dependency-audit.md`) |
| CI/supply chain | PARTIAL | frozen lockfile and least-privilege token; mutable tags, no audit/SBOM/image scan (`L-06`) |
| DB permissions | PARTIAL | app role owns schema/tables; no RLS/append-only trigger (`SEC-14`, `L-06`) |
| Container | PARTIAL | non-root `node`; no read-only/cap-drop/no-new-privileges; tag-pinned (`L-06`) |
| Backups/logs | NOT VERIFIED | no backup, log, or ingress evidence provided |
| Small-group privacy | FAIL | exact counts, no suppression (`SEC-16`); threshold undecided in PRD |

**Positive controls verified statically:** password hashing uses `scrypt` with a random salt and `timingSafeEqual` (`security.ts:10-38`); every observed SQL statement is parameterized, including dynamic `IN` lists; the submission path uses a transaction, `FOR UPDATE` on invitations, unique `(scope,idempotency_key)`, a payload hash, and a receipt check bound to the same scope/key/response (`public.ts:539-583,660-675`); React rendering has no `dangerouslySetInnerHTML`/`eval`; management helpers consistently filter creator/org-admin by owner/`organization_id`; CSRF relies on a custom header plus Origin/Host and no CORS. These are not findings, but they bound the impact of the failures above.

## 4. Confirmed findings

### SEC-01 — Public consent policy is selected from arbitrary `profiles`, enabling guardian/tenant bypass

**Severity:** High · **Confidence:** High · **Status:** Confirmed static + runtime API on synthetic fixture

**Route:** `POST /api/v1/surveys` → `GET /api/v1/public/surveys/:token[/form]`

**Evidence:**
- `server/routes/surveys.ts:319-325` accepts any `profile_id` and only checks that the row exists; the fallback is hard-coded `p_smk`.
- `server/routes/surveys.ts:330,346` derives `notice_version` from `organization_id`, but stores the chosen `profile_id` beside it.
- `server/routes/public.ts:199-208,233,254,262-263` loads `profiles` by `survey.profile_id`; `guardianRequired` is `profile.consent_mode === 'guardian'`; notice is also selected by that profile.
- The correct helper exists but is not used here: `server/http.ts:218-234` selects `organizations` or `platform_profile`.
- Seed proof: `server/seed-data.ts:31-32` has `org_smk` guardian/minor and `org_perpus` self/adult; `:171-185,234` puts `s_demo2` in `org_smk` with `p_perpus`; `:344` gives it an active public link; `:432` records self-consent.
- Runtime on the isolated fixture: `GET /public/surveys/link-umum-demo` returns the legacy `p_smk` profile (guardian) for an `org_smk` survey (`evidence/sec/runtime-profile-source.json`). The business probe captured the inverse case: an `org_perpus` adult/self survey renders the `p_smk` guardian policy (`evidence/biz/biz-api-probes-2026-11-20T13-43-58-462Z.json:43-60`).

**Expected (PRD `54`, README `126,149,166`):** policy/consent mode is read from exactly one source selected by `organization_id` (org) or `platform_profile` (individual). No silent fallback to a different source.

**Actual:** any creator can set `profile_id` to any profile, including another tenant’s. The public form renders that profile’s `consent_mode`, `policy_url`, and notice; the survey remains in the creator’s organization. Omitting `profile_id` does not use the platform profile — it falls back to hard-coded `p_smk` (guardian), so an individual survey can silently require/claim a school guardian policy.

**Static repro (not executed):**
1. Log in as `u_creator_a` (`org_smk`, guardian/minor).
2. `POST /api/v1/surveys` with `owner_scope:"organization"`, `profile_id:"p_perpus"` (adult/self), title/purpose and a complete question set.
3. Publish, open the public link, `GET /public/surveys/<token>/form`.
4. Code returns `guardianRequired=false` (or `p_smk` fallback if omitted), not the org’s guardian requirement; a respondent can consent as an adult/self in a minor setting.

**Impact:** consent/legal basis and age-appropriate safeguards can be bypassed; one tenant can display another tenant’s policy/notice; the audit trail records a consent that did not match the controlling organization. This is a policy-integrity and confidentiality-adjacent high risk, not merely a UI inconsistency.

**CWE:** CWE-863 (incorrect authorization), CWE-213 (exposure of sensitive information due to incompatible policies).
**CVSS:** not scored; impact depends on respondent population and deployment policy.

**Mitigation:** derive the profile solely from `survey.organization_id`/platform; remove `profile_id` from the create/update contract (or validate it equals the derived profile); reject if `profile_id` is not the policy source. Add a DB invariant/trigger if legacy rows must remain. Backfill seeded surveys before relying on the UI.
**Verification:** create two org surveys (minor/guardian and adult/self), try cross-profile IDs; assert `guardianRequired` and notice source match `organization_id`, and that a mismatched `profile_id` is 422. Add tests for omitted/foreign `profile_id`.

### SEC-02 — Silent notice fallback and version mismatch invalidate consent evidence

**Severity:** High · **Confidence:** High · **Status:** Confirmed static; runtime divergence captured in business fixture

**Routes:** public context/form/consent; survey create/edit/duplicate/publish.

**Evidence:**
- `server/routes/public.ts:203-208`: `noticeFor(profileId, version)` orders an exact version first, otherwise latest `effective_date` with `LIMIT 1` and no failure.
- `server/routes/public.ts:234,263,465`: notice is selected from `survey.profile_id`; consent stores `context.version.notice_version`, not the notice row actually rendered.
- `server/routes/surveys.ts:329-330,346` sets the new version’s `notice_version` from org/platform; `:377-380` computes the current policy on edit but only uses it when creating a missing draft — an existing draft keeps its old `notice_version`; `:428` copies the source version on duplicate; `:476-481` publishes without checking that a notice exists for that version.
- Seed proof: platform `notice_version='2.0'` (`server/seed-data.ts:59-60`); only notice versions are `1.0` (`:121-142`); seeded published versions are `1.0` (`:243-245`); orgs say `1.2` (`:31-32`). Thus seeded org surveys already show a notice different from `organizations.notice_version`.
- Runtime: `evidence/biz/biz-api-probes-2026-11-20T13-43-58-462Z.json:15-60` shows rendered notice `1.0` where the required version is `2.0` (individual survey) and `1.2` (org survey). The coordinator's standalone seed link rendered `1.0`/`1.0`, so the fallback itself was not re-exercised there (`evidence/sec/runtime-public-checks.json`).

**Expected (PRD `54,288`, README `126,166`):** the exact notice for the survey’s policy source/version is available; if not, fail closed and do not record consent.

**Actual:** a missing version silently renders the latest older notice; the consent record says the required version (e.g. `1.2`) even though the person saw `1.0`. Editing an existing draft recomputes the current policy version but does not update the version’s notice; duplicate copies a stale version.

**Static repro (not executed):**
1. Org `org_smk` has `notice_version='1.2'`; only `n_smk` version `1.0` exists.
2. Create/publish a survey; version `notice_version='1.2'`.
3. `GET /public/surveys/<token>/form` → `notice.version='1.0'`, `version.notice_version='1.2'`.
4. POST consent → `consent.notice_version='1.2'`; the rendered notice was `1.0`. No error is returned.

**Impact:** informed-consent evidence is not trustworthy; a data subject may consent to a materially different notice; compliance/audit cannot reconstruct what was shown. This is independent of SEC-01 (even a correctly selected profile can miss the version).

**CWE:** CWE-345 (insufficient verification of data authenticity), CWE-863 (incorrect authorization).
**CVSS:** not scored; legal/privacy impact, no direct code execution.

**Mitigation:** make `noticeFor` exact-only and fail closed (`422/409 notice_unavailable`); store `notice_id` (and rendered version) on consent, not just a copied string; on create/edit/duplicate/publish, require a notice for the effective policy source/version or block publication; migrate/seed all required versions. If fallback is intentional, record the actual fallback version and display a warning — but PRD says no silent fallback.
**Verification:** query the public form for every `(source, notice_version)`; assert exact row or failure. Submit consent and assert `notice_id`/version equals the response’s `notice.version`. Test missing/renamed platform notice.

### SEC-03 — Grant `can_export` bypasses `allow_individual`, exposing identity and answers

**Severity:** High · **Confidence:** High · **Status:** Confirmed static + runtime on synthetic grant/CSV fixture

**Routes:** `GET /api/v1/surveys/:id/export`, `GET /api/v1/surveys/:id/export/codebook`, `GET /api/v1/surveys/:id/responses`.

**Evidence:**
- `server/http.ts:170-178`: individual read requires grant `can_read_individual` **and** settings `allow_individual`; export requires only grant `can_export`.
- `server/routes/surveys.ts:701-731` codebook and `:735-776` CSV both use `canExport`; CSV includes `respondent_id`, `assignment_id`, collection/identity fields, and every answer (`:735-773`); free text alone is separately gated (`:762-767`).
- `/responses` at `:782-789` uses the settings-aware `canReadIndividual`, proving the asymmetry.
- The existing test covers `allow_individual=0` only for `/responses` (`server/test/api.test.ts:550-573`), not export.
- README `173` claims grant holders remain bound by `survey_settings`.
- Runtime: `evidence/biz/biz-export-probe-2026-11-20T13-45-21-859Z.json` records settings `allowResults=false, allowIndividual=false`, `summary=403`, `responses=403`, yet `export=200` with per-response IDs and answers. This is the strongest end-to-end confirmation in the audit.

**Expected:** a grant is constrained by both its flags and survey settings; `allow_individual=0` means no row-level identity/answers even for an exporter.

**Actual:** a grantee with `can_export` and `can_read_individual=false` can download respondent IDs and answers while the same account is denied `/responses`; setting `allow_individual=0` does not stop the export.

**Static repro (not executed):**
1. Super admin `PUT /admin/grants/<account>` with `{grants:[{survey_id:"s_demo1", can_read_individual:false, can_export:true, can_read_free_text:false}]}`.
2. Owner sets `PUT /surveys/s_demo1/settings {allow_results:false, allow_individual:false}`.
3. Grantee `GET /surveys/s_demo1/responses` → 403 (correct).
4. Grantee `GET /surveys/s_demo1/export` → 200 CSV with `respondent_id`/`assignment_id` and answer values (actual; free text excluded if flag false).

**Impact:** direct confidentiality breach of row-level data; settings become a false control; exported copies leave the tenant and are hard to revoke. This is the highest-impact API authorization defect in the tree.

**CWE:** CWE-863 (incorrect authorization), CWE-213 (policy mismatch).
**CVSS:** `CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N` (base 6.5) — grant is a low-privileged authenticated prerequisite; scope unchanged because the data is within the same application. Treat as indicative, not a runtime score.

**Mitigation:** make `canExport` require `can_read_individual && settings.allow_individual` for row-level exports; alternatively define a separate `allow_export` setting and have owners explicitly enable it. Apply the same predicate to codebook only if it reveals individual mappings; always gate row-level identity. Audit successful exports with recipient/purpose/columns (PRD `210`). Update tests for export with all grant/settings combinations.
**Verification:** matrix test `{owner, org_admin, grantee} × {allow_individual 0/1} × {can_read_individual 0/1} × {can_export 0/1}` on `/responses`, `/export`, `/export/codebook`; assert no row data when either gate is false. Re-run after fixing.

### SEC-04 — Guardian consent is self-attested; any nonempty string becomes “verified”

**Severity:** High · **Confidence:** High · **Status:** Confirmed static + runtime API

**Route:** `POST /api/v1/public/surveys/:token/consent` → submit.

**Evidence:**
- `server/routes/public.ts:447-456`: `guardian_evidence_ref` is only trimmed; if guardian mode and nonempty, `guardianStatus='verified'`.
- No lookup of a verifier, verification record, expiry, revocation, or child/guardian relationship; the string is stored verbatim (`:459-478`).
- Submission (`:385-397`) checks only consent `status`, `survey_id`, `version_id`; it never rechecks guardian evidence.
- Client stores the same string and presents it as verified (`src/screens/Respondent.tsx:68-89,355-357`); an existing test passes a synthetic value (`server/test/api.test.ts:340-370`).
- PRD `73,260,273` requires valid/revocable evidence.
- Runtime: omitting the reference is rejected (`422 guardian_evidence_required`, `evidence/sec/runtime-public-checks.json`); any arbitrary string is accepted (`201`, `guardian_evidence_status=verified`, `evidence/sec/runtime-guardian-consent.json`).

**Expected:** guardian mode requires evidence verified by the authorized party; invalid/unavailable/revoked evidence rejects consent and submission.

**Actual:** a respondent can type `x` (or any string) and the API records `guardian_evidence_status='verified'`; the browser labels it verified.

**Static repro (not executed):**
1. Open the `s_demo1` public link (profile `p_smk`, guardian mode).
2. `POST /public/surveys/<token>/consent` with `respondent_click:true`, `eligibility:true`, `guardian_evidence_ref:"x"`.
3. Response `201` and `guardian_evidence_status:"verified"`; `POST /responses` accepts the consent.
4. Expected: `422`/`403` until a verifier/evidence record is validated.

**Impact:** the core minor-protection control is cosmetic; false attestations are stored as verified consent, creating legal/ethical exposure and misleading audit evidence. This is a high integrity/consent finding, not a theoretical hardening item.

**CWE:** CWE-345 (insufficient verification), CWE-863.
**CVSS:** not scored; depends on respondent population/legal regime.

**Mitigation:** store guardian evidence as an opaque reference to a server-side verification record (`guardian_verifications` with verifier, method, timestamp, expiry, status); require `verified` and unexpired at consent and again at submission; reject arbitrary client strings; support revoke and re-verify. If a real verification integration is out of scope, disable guardian mode rather than treating free text as verified.
**Verification:** consent with empty/random/expired/revoked references; assert 4xx; submit after revoke; assert 409. Add an authorization test that only the verifier role can create/revoke evidence.

### SEC-05 — Unauthenticated login allows oversized identifiers/passwords and unbounded audit/map growth

**Severity:** Medium · **Confidence:** High · **Status:** Confirmed static + probe P-02/P-03

**Route:** `POST /api/v1/auth/login`.

**Evidence:**
- JSON body limit is 512 KB (`server/app.ts:40`); login accepts any string email and password (`server/routes/auth.ts:66-67`) with no max length/format check.
- The email becomes a rate-limit key (`:71`) and the raw actor of a failed-login audit row (`:36-47,76-78`).
- `audit_logs.actor` is `TEXT NOT NULL` (`server/migrations/001_initial.sql:213`); there is no truncation.
- The rate-limit map never sweeps (`server/security.ts:191-209`); a probe with 100k unique keys retained ~10 MB (`probes.md` P-03).
- `scryptSync` costs ~36 ms per existing-account attempt and hashes the unbounded password input (probe P-02); 8 attempts/15 min per email still serialize on the single event loop.

**Expected:** login should reject oversized/malformed identifiers before rate limiting and persistence; audit fields should be bounded/redacted.

**Actual:** one unauthenticated request can write a ~500 KB actor row and create a ~500 KB map key; unique emails bypass the per-email bucket. Repeated requests grow the table and process memory without a global cap.

**Static repro (not executed):**
1. `POST /auth/login` with `email = "A".repeat(500000)`, `password = "B".repeat(500000)`.
2. Code trims/lowercases the email, keys `login:<ip>:<500k>`, finds no account, inserts `audit_logs.actor` with the 500k string, returns 401. For a synthetic known account, the same request reaches `scryptSync` with the 500k password.
3. Repeat with distinct large emails; each is a new bucket; map/table grow. No account is needed for the audit/map path.

**Impact:** storage exhaustion and memory growth (availability), audit-log pollution, unnecessary PII storage, and avoidable synchronous CPU work on known-account attempts. With a shared proxy IP, the per-email key also enables targeted lockout (covered in SEC-06).

**CWE:** CWE-400 (uncontrolled resource consumption), CWE-799 (improper control of interaction frequency).
**CVSS:** `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L` (base 5.3) — bounded per request but repeatable; availability only. Indicative.

**Mitigation:** enforce RFC 5322-ish email length (e.g. 254 bytes), a bounded password length (e.g. 256 bytes), and a bounded email shape before rate limiting; cap/truncate audit `actor` (or log a hash); add a global/per-IP request bucket and a sweep/eviction cap to the map; prefer a shared limiter and an async hash (or a fixed dummy hash) to avoid blocking the loop. Do not log raw 500 KB identifiers.
**Verification:** send 256/1k/512KB emails and passwords; assert 422 before audit insert, before map insert, and before `scrypt` for oversized passwords. Load-test 100k keys with a cap; assert memory bounded. Test that a legitimate 254-byte address and 256-byte password still work.

### SEC-06 — Process-local limiter + no `trust proxy` collapses clients into one global bucket

**Severity:** Medium · **Confidence:** Medium (code high; production ingress not verified) · **Status:** Confirmed static; impact inferred

**Routes:** register, login, invite resolve, consent, submit, data-request.

**Evidence:**
- `server/security.ts:196-209`: module-global `Map`, no cleanup, reset only on next call for the same key.
- No `app.set('trust proxy', …)` anywhere in `server/`; `req.ip` is therefore the socket peer.
- Registration key is only `register:${req.ip}` (5/15 min, `server/routes/auth.ts:137`); invitation resolve `invite-code:${req.ip}` (20/10 min, `public.ts:513`); submission `submit:${req.ip}` (40/10 min, `:536`); data request `data-request:${req.ip}` (10/h, `:705`).
- README `279` describes registration as per client address; `README.md:334-346` documents the ingress routing `/api/*` to Express. Both proxies emit the socket/gateway IP unless hop trust is configured.
- Overlaps `06-performance-scalability.md` PERF-06; that report covers capacity, this one covers the security/availability effect.

**Expected:** limits key on a trusted client identity, with a bounded shared store; one client cannot exhaust another’s quota.

**Actual:** behind the documented ingress, every real client appears as one IP. Five registrations/15 min (or 20 resolves, 40 submits) exhaust the global bucket; legitimate users receive 429. An attacker can also target a known email’s login bucket when sharing that IP.

**Static repro (not executed):**
1. Deploy per README ingress (TLS proxy → Express).
2. From five different public clients, submit registrations within 15 min; all share the proxy socket IP.
3. The sixth request from any client gets `rate_limited` for registration. Same for 21st resolve / 41st submit in the window.
4. Direct-to-API clients do not reproduce this; hence deployment is a prerequisite.

**Impact:** denial of registration/submission (availability) and targeted login lockout; a single attacker can starve the shared bucket. Without a sweep, every unique login email also grows process memory (SEC-05).

**CWE:** CWE-770 (allocation without limits), CWE-799, CWE-307 (improper restriction of excessive attempts).
**CVSS:** not scored; deployment-dependent availability.

**Mitigation:** terminate rate limits at the ingress with a verified client identity, or configure `trust proxy` for only the ingress hops and derive the client IP correctly; use a shared Redis/DB limiter for multi-instance; add per-email + per-IP + global caps and an eviction/sweep policy. Keep a small per-token consent bucket separate.
**Verification:** two clients behind the proxy should have independent buckets; 5 registrations from A must not block B. Confirm `req.ip` under the real ingress, not just direct-to-API. Test restart/multi-instance consistency.

### SEC-07 — Shared-tab consent/draft/receipt reuse

**Severity:** Medium · **Confidence:** High (static) · **Status:** Confirmed static; browser NOT_VERIFIED

**Surface:** respondent UI, `/s/:token` form/review/receipt.

**Evidence:**
- Consent is read from `sessionStorage` by token (`src/screens/Respondent.tsx:56-66`) and the form load reuses it without a new click (`:119-124`); the payload includes `guardian_evidence_ref` (`:68-89`).
- Draft is persisted in `sessionStorage` under a global key, indexed by token (`src/lib/draft.ts:5-86`); `clear()` exists but is never called.
- Successful submit stores receipt/key and navigates, but does not clear consent/draft (`src/screens/Respondent.tsx:651-686`).
- Receipt data and idempotency key are **global**, not token-keyed (`RECEIPT_DATA_KEY`, `RECEIPT_KEY_KEY` at `:53-54,105-112,668-669,810-812`).
- Server accepts any granted consent for the same survey/version (`server/routes/public.ts:385-397`); `response_id` is overwritten on reuse (`:621`).

**Expected:** a new respondent on a shared device/tab starts with no prior consent, draft, or receipt; one person’s data is not disclosed to the next.

**Actual:** a kiosk/shared tab that remains open after respondent A submits shows A’s consent as already granted to respondent B (same URL), pre-fills A’s draft, and `/receipt` can display A’s response ID/version/time/idempotency key even for a different token. B can submit without a fresh consent click.

**Static repro (not executed):**
1. In one tab, A opens a public link, consents, types answers, submits.
2. Without closing the tab, B opens the same link (or just the receipt route) in that tab.
3. `readConsent(token)` returns A’s consent; `useDraft` loads A’s answers; receipt renders A’s stored receipt. `clear()` is never called.
4. B can submit; server sees a valid consent for the same survey/version.

**Impact:** privacy breach on shared/kiosk devices and consent integrity (B’s submission is linked to A’s consent). The receipt leak is client-side, but it exposes response IDs and timing. This is a real shared-device scenario, not a theoretical XSS.

**CWE:** CWE-539 (persistent client-side session data), CWE-200 (exposure of sensitive information).
**CVSS:** not scored; physical/shared-device prerequisite.

**Mitigation:** clear consent/draft/receipt keys on successful submit and on intro entry; scope every key by token **and** survey/version; show a “start new respondent” action; for receipts, key by token/response ID and verify server-side before display. Consider a short-lived server-side consent/session binding rather than only `sessionStorage`.
**Verification:** browser test: A submits, B opens the same tab; assert no consent/draft/receipt is shown and B cannot submit without a new consent. Use a fresh profile/incognito as a control.

### SEC-08 — Consent can be replayed across contexts and overwrites `response_id`

**Severity:** Medium · **Confidence:** High · **Status:** Confirmed static + runtime on synthetic fixture (replay cross-context accepted; `response_id` rewritten)

**Route:** `POST /api/v1/public/surveys/:token/responses`.

**Evidence:**
- `requireConsent` checks only `status='granted'`, `survey_id`, `version_id` (`server/routes/public.ts:385-397`); it ignores `invitation_id`, link, `response_id`, and consent age.
- Submission then `UPDATE consent_records SET response_id = ? WHERE id = ?` (`:621`), so a reused consent is re-pointed to the later response.
- Schema has `invitation_id`/`response_id` but no binding to the invitation/link context (`server/migrations/001_initial.sql:150-163`). `ux_consent_response` (line 253) keeps one consent per response, but does not stop a consent row from being reassigned to another response.
- Runtime: `evidence/biz/biz-api-probes-2026-11-20T13-43-58-462Z.json:108-126` shows a public-link consent accepted for an invitation submission and then reused by a second public submission; both `201`, with the consent relinked. `consent_reused_after_first_accepted_submit=true`.

**Expected:** a consent is bound to the respondent/context and one final response; it cannot authorize a different invitation/link or be reassigned.

**Actual:** if a consent ID is reused with another token for the same survey/version, submission succeeds and the consent row now points at the second response. The first response’s consent association is lost.

**Static repro (not executed):**
1. A consents on invitation/link A; receive `consent_id`.
2. B uses the same `consent_id` with link B (same survey/version) and submits.
3. Server accepts; `consent_records.response_id` becomes B’s response. No 409.
4. Expected: consent is invalid for B’s context/response.

**Impact:** consent evidence is misattributed; one person’s consent can authorize another’s submission; audit/consent traceability is corrupted. Requires a leaked/reused consent ID or a shared client (SEC-07), so impact is medium.

**CWE:** CWE-639 (authorization bypass through user-controlled key), CWE-863.
**CVSS:** not scored; prerequisite is a valid consent ID.

**Mitigation:** bind consent to `invitation_id`/`public_link_id` and a server-side respondent/session identifier; atomically `UPDATE ... WHERE response_id IS NULL` and reject if already bound; validate consent age and guardian status at submit; never overwrite. Keep `ux_consent_response` and add a unique context binding.
**Verification:** reuse consent across links/invitations and after a response; assert 409. Attempt concurrent submits with the same consent; assert exactly one binding.

### SEC-09 — Invitation code has 24 bits and resolves to a raw bearer token

**Severity:** Medium · **Confidence:** High on weakness; Medium on exploitability · **Status:** Confirmed static; brute force NOT run

**Routes:** `POST /api/v1/public/invitations/resolve`, code display in intro.

**Evidence:**
- `server/routes/surveys.ts:572`: `UND-` + `randomBytes(3)` = 6 hex chars = 24 bits (16.7M space).
- `server/routes/public.ts:519-527`: correct code returns the raw `token` and `/s/${token}`.
- Only `invite-code:${req.ip}` 20/10 min (`:513`); no per-code/per-survey lockout, no CAPTCHA, no global code-attempt budget.
- 404 vs 409 distinguishes unknown from inactive/expired after a correct guess (`:522-527`).
- The intro payload reveals the code to any invitation-token holder (`server/routes/public.ts:306-318`); if a code is shared/screenshotted, it is a second bearer credential.

**Expected:** an invitation secret should have ≥128 bits (like the 18-byte token at `surveys.ts:573`) or a per-code attempt budget that makes guessing infeasible; the resolver should not turn a short code into an unlimited bearer.

**Actual:** 24-bit codes are brute-forceable in a distributed campaign; per-IP limits only slow it. This is a credential-strength weakness, not a claim that a code was cracked.

**Static repro (not executed):**
1. Call resolve with an unknown code; 404.
2. With an active code, 200 + raw token; use token at `/s/<token>`.
3. 20 attempts/10 min/IP. Across many source IPs, the 24-bit space becomes reachable; no per-code lockout or alerting exists.

**Impact:** unauthorized submission/assignment takeover if a code is guessed or leaked; only one response per invitation, but it can consume a participant’s slot and inject data. Medium, with a targeted high-value invitation raising impact.

**CWE:** CWE-330 (insufficient randomness), CWE-307.
**CVSS:** `CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:L/A:N` (base 5.1) — high attack complexity/distributed prerequisite; indicative only.

**Mitigation:** use at least 128 bits for the code (or a code + PIN), rotate/expire quickly, rate-limit per code and per survey in addition to IP, add a global attempt budget/alert, and avoid returning the raw token from a guessable code (exchange it for a one-time session). Do not display the code in an unrestricted intro if it is a credential.
**Verification:** code-length/entropy test; attempt 100 wrong codes from one IP → 429; assert per-code lockout; verify a correct code after limit; check that the code cannot be resolved after use/revoke.

### SEC-10 — Invitation/public-link bearer tokens are stored raw and exposed in URLs/bootstrap

**Severity:** Medium · **Confidence:** High · **Status:** Confirmed static; raw-token bootstrap exposure confirmed at runtime, log/backup exposure NOT_VERIFIED

**Evidence:**
- `server/migrations/001_initial.sql:122-123,135-136`: `token TEXT NOT NULL UNIQUE` beside `token_hash`; raw token persists.
- `server/routes/surveys.ts:573,591-592` and `:493-500` generate/store raw tokens; `/s/[token]` pages put them in URL paths.
- `server/bootstrap.ts:270-300` `SELECT *`, blanks `token_hash` but leaves `token`; public links add `url:/s/${row.token}`.
- Receipt navigation preserves the token (`src/screens/Respondent.tsx:668-674`).
- Public links are created with `expires_at NULL` on publish (`server/routes/surveys.ts:493-500`); no default expiry/rotation.
- PRD `262` says tokens must not appear in app/proxy/analytics logs.
- Runtime: `evidence/sec/runtime-api-checks.json` shows super-admin `/bootstrap` returning 5 invitation rows with nonempty raw `token` fields and 2 public-link entries whose URLs embed the raw token.

**Expected:** store only a hash; return the raw token once at creation; don't bootstrap it; use short-lived/exchangeable links and set expiry.

**Actual:** anyone with DB/backup read access can use every token; super-admin bootstrap returns them; URL paths commonly reach proxy/access/analytics logs. The hash column provides no protection while the raw column is retained.

**Static repro (not executed):** as owner or super admin, `GET /bootstrap`; inspect `invitations[].token` and `publicLinks[].url` (raw). For DB, `SELECT token FROM invitations LIMIT 1` / `public_links` after creating one; expected no raw token. Open `/s/<token>` and inspect the request path in the browser/ingress log.

**Impact:** bearer takeover of submissions and (for public links) unlimited responses until the link is closed; token leakage via logs/backups/history. Medium, rising if logs are broadly accessible or links never expire.

**CWE:** CWE-522 (insufficiently protected credentials), CWE-200 (exposure of sensitive information in URLs/logs).
**CVSS:** not scored; depends on DB/log exposure.

**Mitigation:** drop the raw `token` column after an initial one-time display/email; bootstrap only IDs/status/URLs that are safe; set finite expiry and rotation; redact `/s/:token` in ingress/analytics logs (use a short opaque path ID or POST exchange); add a token revocation endpoint. For receipts, use an unguessable response receipt key, not the survey token.
**Verification:** inspect bootstrap/DB after creation; assert no raw token returned after creation; grep ingress logs for `/s/`; test expiry/rotation/revoke.

### SEC-11 — Invitation code written to audit and returned by `/admin/audit`

**Severity:** Low · **Confidence:** High · **Status:** Confirmed static

**Routes:** `POST /surveys/:id/invitations`, `POST /invitations/:id/revoke`; `GET /admin/audit`, `GET /org/audit`.

**Evidence:** `server/routes/surveys.ts:597` (`Buat undangan`, object `${survey.id} · ${code}`) and `:620` (`Cabut undangan`, object `${survey_id} · ${invitation.code}`); `server/routes/admin.ts:437-441` returns `SELECT *` rows, including `object`, with no redaction; `server/routes/org.ts:296-301` also returns `object` to the org admin. PRD `296`, README `132`.

**Expected:** audit logs contain no tokens/codes/credentials.

**Actual:** invitation codes are durable in audit; a reader can call the public resolver to exchange a code for the raw token. This is a direct violation of the documented audit contract; the incremental risk is lower because the reader is already an admin who manages the survey (and super admins receive raw tokens via bootstrap), but the no-token rule is still broken.

**Static repro (not executed):** create or revoke an invitation, then `GET /admin/audit` (or `/org/audit`); the `object` contains `UND-…`. POST that code to `/public/invitations/resolve` and receive a raw token. Expected: audit object contains only the invitation/survey ID or a hash, and cannot be exchanged for a token from the log alone.

**Impact:** audit-log readers/exporters gain invitation access; the audit trail itself becomes a credential store. Low incremental risk because super admins already receive raw tokens via bootstrap (`SEC-10`), but the explicit no-token rule is broken.

**CWE:** CWE-532 (insertion of sensitive information into log).
**CVSS:** not scored; privileged prerequisite.

**Mitigation:** log invitation IDs or a hash, never the code; redact `object`/`metadata` at the API boundary; add a denylist/pattern test for tokens; rotate any codes already logged.
**Verification:** create/revoke an invitation; assert audit `object` contains no `UND-`/token; call `/admin/audit` and grep the response. Add a unit test around the audit helper.

### SEC-12 — Global integration token reads any survey/version, including drafts

**Severity:** High · **Confidence:** High · **Status:** Confirmed static + limited runtime API (global token read another tenant's survey; draft version accepted)

**Route:** `GET /api/v1/integration/survey-data?survey_id=…` (and version/limit/offset).

**Evidence:**
- `server/routes/integration.ts:37-41`: one global `process.env.INTEGRATION_TOKEN`; `Authorization` must equal `Bearer <token>` exactly; ordinary string comparison.
- `:43-85`: any `survey_id` and any version ID/number, including draft; no tenant/scope restriction, no per-consumer identity.
- Returns `respondent_id`, `submitted_at`, `assignment_id`, and all answer values/option IDs (`:129-143`); free text is omitted and the response is labelled `simulated:true`, but the data is real.
- No rate limit on this router; only the success path writes an audit/event row (`:101-118`); failures are not audited.
- `.env.example:25` documents a fixed placeholder; `server/app.ts` has no startup guard rejecting known placeholders.
- Runtime: `evidence/sec/runtime-api-checks.json` — the single integration token read `s_demo2` (2 answers, respondent IDs) with no tenant identity; an unauthenticated call returns `401`; the draft-version request returned `200` with zero rows, which still establishes that a draft version is addressable rather than denied.

**Expected:** a service credential is scoped to one consumer/tenant/survey set, rate-limited, rotated, and audited for success and denial; drafts should not be readable unless explicitly allowed.

**Actual:** one token compromises every survey in the deployment and can enumerate versions including unpublished drafts; a leaked/default token is a full data breach.

**Static repro (not executed):** with `Authorization: Bearer $INTEGRATION_TOKEN`, call `/integration/survey-data?survey_id=s_demo1&version=v_demo1_2` (draft) and `/…?survey_id=s_demo2`; expected 403/404 or tenant-scoped empty, actual rows with `respondent_id`/answers. Repeat from a second “consumer” with the same token; no way to distinguish them. Runtime was not available.

**Impact:** confidentiality breach of all survey response identities/answers; draft exposure can reveal unpublished instruments. High if the token is deployed/leaked; the code behavior is confirmed.

**CWE:** CWE-863 (incorrect authorization / missing scope). A known placeholder would additionally be CWE-798; the tree does not prove a deployed placeholder, so it is not scored as one.
**CVSS:** `CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:N/A:N` (4.9) for a leaked token; with the placeholder, effective privilege can be lower. Indicative only.

**Mitigation:** replace the global token with per-consumer credentials (client ID + secret/hash, scopes, tenant, allowed survey/version, expiry, rotation); deny drafts by default; enforce a rate limit and audit denials; validate secret length/entropy at startup and refuse known placeholders; use constant-time comparison. Remove `simulated:true` if the data is real, so consumers do not underestimate it.
**Verification:** two consumers must not read each other’s surveys; draft access 403; wrong/expired token 401 + audit; rate-limit test; startup with placeholder must fail closed.

### SEC-13 — `COOKIE_SECURE` is unused and `Secure` trusts client `X-Forwarded-Proto`

**Severity:** Low · **Confidence:** Medium (code high; deployment unknown) · **Status:** Confirmed static, runtime NOT_VERIFIED

**Evidence:** `server/routes/auth.ts:32-34` returns `req.secure || req.get('x-forwarded-proto') === 'https'`; `server/security.ts:84-93` conditionally appends `Secure`; `COOKIE_SECURE` appears only in README/docs/config (`README.md:256,355`, `.env.example:20`), never in `server/`. HSTS is also opt-in (`server/app.ts:35-37`, `proxy.ts:38-40`). No `trust proxy` is configured.

**Expected:** the documented `COOKIE_SECURE` switch controls the flag; behind a TLS terminator the proxy sets a trusted forwarded proto; HSTS is enabled in production.

**Actual:** setting `COOKIE_SECURE=1` does nothing. If the TLS terminator does not set `X-Forwarded-Proto`, the session cookie is issued without `Secure` even on an HTTPS deployment. Conversely, any client can send `X-Forwarded-Proto: https` to get a `Secure` cookie over HTTP (not a confidentiality bypass by itself, but the signal is spoofable).

**Static repro (not executed):** run behind the actual TLS proxy with `COOKIE_SECURE=1` and no `X-Forwarded-Proto`; log in and inspect `Set-Cookie`: no `Secure`. Add `X-Forwarded-Proto: https` to a direct HTTP login: `Secure` appears. Expected: `COOKIE_SECURE=1` always adds `Secure`; the proxy’s trusted protocol is used, not an arbitrary client header.

**Impact:** session cookie may traverse HTTP or be stored without the Secure attribute; deployment-dependent. Low because the documented ingress normally sets the header and may redirect HTTP.

**CWE:** CWE-614 (sensitive cookie without Secure), CWE-807 (reliance on untrusted input).
**CVSS:** not scored; conditional on deployment.

**Mitigation:** use `COOKIE_SECURE` (or `NODE_ENV=production`) to force the flag; configure `trust proxy` for the exact ingress hops and read `req.secure`/`req.protocol`; always set `Secure` + `__Host-` prefix in production; enable HSTS at the ingress and app.
**Verification:** behind the actual proxy, inspect `Set-Cookie` over HTTP/HTTPS; `COOKIE_SECURE=1` must add `Secure`; remove/forge XFP and confirm it cannot weaken the cookie.

### SEC-14 — Audit is not append-only and omits grant/denial detail

**Severity:** Low · **Confidence:** High · **Status:** Confirmed static

**Evidence:** `server/routes/admin.ts:375,430` log only `{grants:n}`/`{rows:n}`; `server/routes/surveys.ts:664-677` summary access has no success/denial audit; settings read `:627-641` is unaudited; `/admin/audit` read `admin.ts:437-441` is unaudited. `README.md:132` claims append-only; the app role owns the schema/tables (`docker/postgres/init/01-app-role.sh:6-18`; `server/index.ts:8` applies migrations as that role) and no trigger/privilege revokes UPDATE/DELETE.

**Expected:** grant changes record target, permissions, actor, recipient/purpose/column filter; denied sensitive reads are recorded; the app cannot rewrite audit history.

**Actual:** a grants change is only a count; a successful export/summary is not fully attributed; the app role can UPDATE/DELETE audit rows. This weakens forensics, not direct access.

**Static repro (not executed):** change a grant and read `/admin/audit`: metadata is `{grants:n}`, with no account/survey/flags. As the app role, issue `UPDATE audit_logs SET outcome='berhasil' WHERE id=…` or `DELETE`; the DB owner role permits it. Expected: a detailed immutable entry, and UPDATE/DELETE denied.

**Impact:** inability to reconstruct who granted/exported what; insider activity can be erased with app credentials. Low but material for a consent-heavy system.

**CWE:** CWE-778 (insufficient logging), CWE-732 (incorrect permission assignment).
**CVSS:** not scored.

**Mitigation:** append-only audit table with insert-only runtime role, hash chaining/WORM export, and no UPDATE/DELETE; log before/after grant diffs (account, survey, flags), export recipient/purpose/columns, summary access, denied authorizations, and admin audit reads; separate migrator/auditor roles.
**Verification:** attempt UPDATE/DELETE as the app role (should fail); inspect a grant change and an export log for target/permissions; confirm denied export is logged.

### SEC-15 — Super admin can self-grant answer access

**Severity:** Medium · **Confidence:** High · **Status:** Confirmed static

**Routes:** `PUT /admin/grants/:id` (single) and `PUT /admin/grants` (bulk).

**Evidence:** `server/routes/admin.ts:333-376` and `:382-431` accept any account ID including the caller; no self-grant/dual-control check. `server/http.ts:176-178` then grants export; `:170-173` individual with grant. `server/bootstrap.ts:267-269` already gives super admins all distribution tokens. `README.md:172` and `server/test/api.test.ts:156-159` assert super admins do not automatically read answers.

**Expected:** super admin can administer grants but cannot unilaterally grant themselves answer access; a second approver or explicit owner consent is required.

**Actual:** a super admin can add a grant to their own account and immediately read/export any survey, defeating the intended separation.

**Static repro (not executed):** as super admin, `PUT /admin/grants/<own-id>` with `{grants:[{survey_id:"s_demo1",can_read_individual:true,can_export:true,can_read_free_text:true}]}`, then `GET /surveys/s_demo1/responses` and `/export`. Both succeed; expected 403/approval gate. The same works with any survey via the bulk route.

**Impact:** insider confidentiality breach and loss of the “super admin cannot read answers by default” guarantee. Medium; requires super-admin compromise/insider.

**CWE:** CWE-269 (improper privilege management), CWE-863.
**CVSS:** not scored; privileged prerequisite.

**Mitigation:** reject self-grants and grants to other super admins unless an owner/dual approval exists; require a reason/ticket and second approver; alert on super-admin access; separate “admin” and “data reader” roles. Consider break-glass with time-bound approval and audit.
**Verification:** self-grant request → 403; peer grant without approval → 403; approved grant → 200 + audit; super-admin `/responses` before approval → 403.

### SEC-16 — Summary exact counts enable small-group re-identification

**Severity:** Low · **Confidence:** High · **Status:** Confirmed static

**Route:** `GET /surveys/:id/summary`.

**Evidence:** `server/summary.ts:67-140` returns exact option counts, `answered`, `skipped`, `total`, and `free_text_count`; no minimum group size or suppression. Any `canReadAggregate` grant holder can call it (`server/routes/surveys.ts:664-674`). PRD `263` says small-group restrictions are required but leaves the parameter undecided.

**Expected:** suppress/flatten cells below a threshold (and complementary cells), especially when combined with assignment labels/timing; do not reveal free-text presence for a single respondent.

**Actual:** `total=1` and per-option counts expose a single person’s answers; `free_text_count` reveals whether they wrote text. Combined with assignment IDs/timestamps, this can identify the respondent.

**Static repro (not executed):** seed a survey/version with one response (`s_demo1` v1 has five); select one option and one text answer; `GET /surveys/s_demo1/summary`. Response is `total:1`, the selected option `count:1`, and `free_text_count:1`; expected suppression/flattening below the agreed threshold.

**Impact:** privacy/re-identification in small classes/teams; low severity because it requires aggregate access and small groups, but it is a direct product risk.

**CWE:** CWE-359 (exposure of private information), CWE-200.
**CVSS:** not scored.

**Mitigation:** set a documented minimum (e.g. n≥5), suppress small cells and complementary cells, hide free-text counts below the threshold, and consider differential privacy/noise for small groups; enforce the threshold server-side, not only in UI. Product decision needed (PRD `263`).
**Verification:** seed n=1/n=2/n=5 groups; assert no exact count/free-text presence below threshold; test complementary suppression. Get owner sign-off on the threshold.

## 5. Low-risk confirmed gaps

These are confirmed code behaviors with lower impact or deployment prerequisites, not speculative scanner output. **Severity/confidence:** L-01–L-06 Low/High (static; the L-01 cache effect and L-06 CVE impact were not observed); L-07 Low/Medium (deployment-dependent). For each row, **expected** is the control named in the fix column and **actual** is the behavior in the evidence column; the repro column is the minimal static/probe sequence.

| ID | Finding | Evidence / repro | Impact | Fix / verification |
| --- | --- | --- | --- | --- |
| L-01 | Survey/admin read responses omit `Cache-Control: no-store` | `surveysRouter` has no no-store; the admin router sets it only at `admin.ts:262` — accounts/audit/data-request reads lack it. Auth/public/org mostly set it. | Shared/browser cache may retain authenticated JSON; no shared-cache proof | Set no-store on all authenticated APIs; test response headers; browser cache check |
| L-02 | Invalid invitation expiry is accepted and becomes non-expiring | `surveys.ts:566-568` accepts any string, appends `T23:59:59Z`; `NaN <= now` false. Resolver `public.ts:524` `NaN < now` false. | Invitation never expires | Validate ISO date/date-time and future bound; test `2026-99-99`; assert 422 |
| L-03 | Export neutralizes negative numerics | `server/http.ts:317-329`; probe P-01: `-1` → `'-1` | Data-integrity/formatting, not formula bypass | Only neutralize leading `=+-@` for strings, not numeric values; add unit cases |
| L-04 | No password/global session revocation; reactivation revives old sessions | `security.ts:100-126` reads status fresh; `auth.ts:80,214,229` creates/destroys only the current session; no password reset/change endpoint | Reactivated account reuses old rows; no global logout | Add `revoked_at`/session version, delete sessions on suspend/password change; test |
| L-05 | Malformed cookie causes 500 | `security.ts:56-64` unguarded `decodeURIComponent`; probe P-04; `app.ts:67-71` generic 500 | Noise/error-path fingerprint; no data leak observed | Catch URIError, ignore bad cookie; test `Cookie: a=%E0%A4%A` |
| L-06 | Container/CI/DB hardening gaps | Dockerfiles non-root but no read-only/cap-drop/no-new-privileges; images tag-pinned; CI actions tag-pinned; no audit/SBOM/image scan; app role is DB owner (`docker/postgres/init/01-app-role.sh:6-18`) | Supply-chain/privilege escalation surface; no confirmed exploit | Digest-pin images/actions; add audit/SBOM/Trivy; split migrator/runtime roles; add `read_only`, `cap_drop`, `no-new-privileges`; verify |
| L-07 | Local placeholders/defaults and no startup guard | `.env.example:14,20,25`, `README.md:256,355`, `docker-compose.yml:8-11,40-46`; `INTEGRATION_TOKEN` accepted verbatim; no known-placeholder rejection | A copied placeholder becomes a real credential/config; local defaults may reach deployment | Startup validation rejecting known defaults; generate secrets; document required env; test placeholder boot fails |

## 6. Hypotheses, control gaps, and NOT_VERIFIED coverage

These are **not** counted as confirmed findings. Each is either a race/feasibility question or a surface not reachable with the provided environment.

| ID | Statement | Why not confirmed | Next safe check |
| --- | --- | --- | --- |
| H-01 | Close/revoke can race a submission: `freshVersion` is read outside a lock, and public-link status is checked before the write transaction. An invitation is locked/rechecked (`public.ts:574-583`), but a public link is not. | No DB/API; race requires concurrency and row locks; static reading cannot prove a lost update. | On `svara_audit_sec`: close/revoke while a submission is prepared; assert no response after close; use `FOR UPDATE` on version/link. |
| H-02 | Distributed guessing of the 24-bit invitation code is practical for high-value invitations. | No brute force was run; per-IP limit and IP diversity determine feasibility. | Bounded synthetic test only; never external targets; measure attempts before 429. |
| H-03 | Login timing/response differences enumerate known emails (scrypt only for existing accounts). | Code suggests it; no timing measurement was taken; generic error is used. | Local synthetic accounts; measure distributions; compare unknown vs known; fix with dummy hash. |
| H-04 | Ingress/proxy/analytics logs record `/s/<token>` paths. | No proxy/log access or configuration evidence. | Review ingress config/log retention; grep redacted logs; do not print tokens. |
| H-05 | DB backups retain raw bearer tokens and audit rows indefinitely. | No backup configuration/evidence. | Review backup policy/retention/encryption; restore to an isolated audit DB only if authorized. |
| H-06 | Container images contain vulnerable OS/npm packages. | No scanner (`trivy`/`grype`) installed; no image pull authorized. | Install scanner only with approval; scan digest-pinned images; record CVE/package/applicability. |
| H-07 | CSP/browser and cookie behavior break or weaken controls under the real ingress. | No browser/proxy; `proxy.ts` sets nonce CSP, but API/Next header interaction was not observed. | Browser test with dev/prod build; inspect console CSP violations and `Set-Cookie`; test `next dev`/standalone. |

**NOT_VERIFIED coverage (explicit):**
- Live login/session lifecycle (cookie issuance, expiry, logout, deactivation/reactivation).
- CSRF from a real cross-site page and a real browser; CORS preflight behavior.
- Rate limiting behind the real ingress; multi-instance behavior; `req.ip` value.
- CSP nonce/strict-dynamic compatibility; HSTS; Secure cookie in the deployed topology.
- DB role privileges, RLS absence effects, backup contents/retention, audit immutability at runtime.
- Proxy/access/analytics logs for tokens; CDN/browser caching of API JSON.
- Container image CVEs, SBOM, registry signatures; CI artifact provenance.
- Full secret history; only tracked-file pattern scanning was done.
- Any destructive/concurrency/DoS test; none was run.

**Not treated as vulnerabilities (product/process gaps):** no MFA, no email verification, no password reset/revoke-all, no account lockout beyond IP buckets, no retention automation, no data-subject identity proof for `/data-requests`, and no owner approval workflow for grants beyond super-admin action. These are real product decisions, but not code-level exploits in this scope. The no-password-reset absence also means no password-change session invalidation path exists to test (`L-04`).

## 7. Dependencies and supply chain

**Run:** `2026-11-20T13:44Z`–`13:46Z` UTC; pnpm `11.5.2`; pinned `pnpm-lock.yaml`. No package installed. Full raw JSON: `evidence/sec/pnpm-audit-{all,prod}-2026-11-20.json`.

**All dependencies:** one moderate advisory, `minimatch@10.2.6`, range `>=7 <11.0.1`, patched `11.0.1`, advisory GHSA-g3hv-75wg-m249, CWE-405, source `https://github.com/advisories/GHSA-g3hv-75wg-m249`. All paths are `typescript-eslint` → `minimatch`; `dev:true`.

**Production graph:** `pnpm audit --prod` returned `0` advisories (95 prod / 42 optional; 137 total).

**Applicability:** `typescript-eslint`/`minimatch` are lint-time only, not imported by the API or Next runtime. `Dockerfile.api` installs with `--prod`; the web build installs the full lockfile for `next build`, but the runtime copies only standalone/static/public, not the build `node_modules` tree. The image was not scanned. Repository lint patterns are developer-controlled; no HTTP input reaches `minimatch`. **This is a scanner result, not a confirmed exploit.** No reproduction attempted. CI has no `pnpm audit` step, so the advisory would not be surfaced automatically.

**Supply-chain observations:** frozen lockfile install is good; actions and images are tag-pinned, not SHA/digest-pinned; no SBOM/provenance/image scan; API image installs global `tsx` from npm outside the frozen app lockfile; `permissions: contents: read` is good. The workflow has a fixed local DB password (test-only; value not reproduced). See `dependency-audit.md`, `L-06`.

## 8. Deployment, database, and secrets

- **DB role:** the app role is the database owner and has `CREATE` on `public`; `server/index.ts:8` applies migrations at startup. No separate migrator/runtime role, no RLS. A compromised API has DDL + DML rights, including audit UPDATE/DELETE (`SEC-14`).
- **Containers:** both run as `node` (good). No `read_only`, `cap_drop`, `no-new-privileges`; images/base tags are not digest-pinned. Compose publishes DB/API ports in the local profile (dev only, but a deployed variant must not).
- **Secrets:** no `.env` in the tree; no private-key/PAT pattern found; local placeholders exist in `.env.example`, README, compose, CI. No startup guard rejects known placeholders; `INTEGRATION_TOKEN` is accepted verbatim. No secret-manager integration or rotation evidence.
- **CI:** `pnpm install --frozen-lockfile`, build, and tests; no security gate/audit/SBOM/image scan; mutable action tags. A dependency compromise or malicious lockfile change is not checked beyond code review.
- **Image scan:** NOT_VERIFIED (no scanner installed; no image pull). No scanner result is presented as a vulnerability.

## 9. Prioritized remediation

**P0 (before any pilot with real respondents):**
1. SEC-01: derive policy source from `organization_id`/platform; reject foreign `profile_id`; backfill seed.
2. SEC-03: gate row-level export on `can_read_individual && allow_individual`; add setting for export if needed.
3. SEC-04: replace self-attested guardian strings with a verifiable/revocable server-side record; fail closed.
4. SEC-02: exact notice lookup, fail closed, store `notice_id`/rendered version.
5. SEC-12: per-consumer scoped integration credentials; deny drafts; rate limit + audit.
6. NEW-01: honour the retention/erasure strategy in `PRD.md:259-263` and the privacy page's promise, or correct both. Data requests are currently stored with raw contact/note (unverified) while no enforced, ephemeral data minimization exists; see `10-data-retention.md` and `07-operations.md`.

**P1 (next):**
7. SEC-06: trusted-proxy client identity and shared limiter; per-email/per-IP/global caps; sweep.
8. SEC-05: email length/format bounds, audit truncation, user-visible rate limits.
9. SEC-09/10/11: ≥128-bit code, hash-only token storage, token expiry/rotation/redaction, no code in audit.
10. SEC-15: block self-grants/dual control; alert on super-admin data access.
11. SEC-08: bind consent to context and one response; stop overwriting.
12. SEC-07: clear/scope consent, draft, and receipt storage; shared-device UX.

**P2 (hardening/decision):**
13. SEC-13: honor `COOKIE_SECURE`, trusted proxy, `__Host-` + Secure, HSTS.
14. SEC-14: append-only audit with insert-only role and detailed grant/export/denial records.
15. SEC-16: document/enforce small-cell threshold and complementary suppression.
16. L-01…L-07: cache headers, expiry validation, CSV numeric handling, session revocation, cookie parse, CI/image/DB hardening, placeholder guards.
17. Add CI gates: `pnpm audit --prod`, SBOM, image scan, digest/SHA pinning, secret scanning; keep the dev advisory triaged.

## 10. Evidence index and reproduction

| File | Contents |
| --- | --- |
| `evidence/sec/environment.md` | Probe gate as originally reported; superseded for runtime by the files below |
| `evidence/sec/static-refs.md` | Exhaustive `file:line` map for every finding and requirement |
| `evidence/sec/probes.md` | P-01 CSV, P-02 scrypt timing, P-03 rate-map growth, P-04 malformed cookie |
| `evidence/sec/dependency-audit.md` | Audit commands, advisory table, prod result, reachability, CI observations |
| `evidence/sec/pnpm-audit-all-2026-11-20.json` | Raw `pnpm audit --json` output (1 moderate dev-only advisory) |
| `evidence/sec/pnpm-audit-prod-2026-11-20.json` | Raw production-only audit output (0 advisories) |
| `evidence/sec/runtime-api-checks.json` | Integration-token cross-tenant read, draft addressability, unauthenticated 401, bootstrap raw-token exposure |
| `evidence/sec/runtime-public-checks.json` | Public context notice/profile, rejected consent without guardian evidence, data-request CSRF 403, 201 without echoing private fields |
| `evidence/sec/runtime-guardian-consent.json` | Arbitrary guardian reference accepted as `verified` (201) |
| `evidence/sec/runtime-profile-source.json` | Public payload served from legacy `profiles`, org id mismatch |
| `evidence/sec/runtime-data-requests.json` | Two synthetic data requests accepted (201), policy placeholder |
| `evidence/sec/runtime-data-request-storage.txt` | Counts of stored identity fields in `data_requests`; zero emails in audit metadata |

Reproduction now covers both static traces and the bounded synthetic API checks above. Still unexecuted: cross-site CSRF, browser cookie/TLS behaviour under a real ingress, concurrency races (H-01), distributed code guessing (H-02), timing-based enumeration (H-03), proxy log inspection (H-04), backup content review (partially covered by the restore drill in `07-operations.md` but not by this report), and any image scan (H-06). All involve either infrastructure not present in the audit or an unapproved destructive load.

## 11. Residual risk

Even after P0/P1, the following remain: no MFA/email verification/password reset; single global integration secret until rotated; no enforcement of audit immutability at the DB layer; no image/SBOM evidence; no browser/proxy verification; no retention automation; and no decided small-cell threshold. These are explicit residual risks, not silent assumptions. The security posture is strongest on password hashing, parameterized SQL, CSRF shape, and tenant-scoped management helpers; it is weakest on consent-policy source, export settings, guardian evidence, and token lifecycle.
