# Security evidence — static reference map

Read-only references used by the report. No request/response bodies, tokens,
cookies, passwords, or secret values are reproduced.

## Requirements and documented design

| Ref | Statement used |
| --- | --- |
| `PRD.md:54` | Survey reads exactly one policy source: `platform_profile` for individual, `organizations` for org; no silent fallback to another source. |
| `PRD.md:73` | `consent_mode=guardian` requires valid guardian evidence and rejects submission when evidence is invalid. |
| `PRD.md:210` | Individual download, free text, and export require separate permissions; audit records recipient, purpose, and column filter. |
| `PRD.md:260` | Server rejects submissions when evidence is unavailable, revoked, or invalid. |
| `PRD.md:262` | Public endpoints are throttled/limited; tokens must not appear in app/proxy/analytics logs. |
| `PRD.md:263` | Small-group results are restricted when combination could identify a respondent; parameters undecided. |
| `PRD.md:273` | School authorized party verifies child status and guardian evidence reference; other deployments use authorized party. |
| `PRD.md:276` | Server derives individual/summary permissions; client cannot choose. |
| `PRD.md:288` | Notice template comes from the deployment profile; notice version is stored on the consent record. |
| `PRD.md:296` | Audit log must not contain answers, tokens, or credentials. |
| `README.md:126` | Notice version is taken from organization (`organization_id`) or platform profile, not `profile_id`. |
| `README.md:132` | Audit log is claimed append-only. |
| `README.md:149` | `profile_id` remains a profile reference, but policy is read from `organization_id`, not `profile_id`. |
| `README.md:166` | Exactly one policy source; no silent fallback. |
| `README.md:173` | Grant holders remain bound by `survey_settings`. |
| `README.md:256,355` | `COOKIE_SECURE` is documented as the HTTPS cookie switch. |
| `README.md:279` | Registration limit is described as per client address. |

## SEC-01 — policy source / tenant bypass

| Location | Fact |
| --- | --- |
| `server/routes/surveys.ts:319-325` | `profile_id` is taken from the request body; fallback is hard-coded `'p_smk'`; no tenant/role check on the selected profile. |
| `server/routes/surveys.ts:330,346` | `notice_version` is taken from `noticeVersionFor(organizationId)` (org/platform), while the survey keeps the separately selected `profile_id`. |
| `server/routes/public.ts:199-209,233,262-263` | Public context loads `profiles` by `survey.profile_id` for profile and notice. |
| `server/routes/public.ts:254,281` | `guardianRequired` is derived from that legacy profile's `consent_mode`. |
| `server/http.ts:218-234` | `surveyProfileFor()` correctly selects `organizations` or `platform_profile`; used by creator detail/bootstrap, not by public context. |
| `server/routes/surveys.ts:158` | Creator detail returns `surveyProfileFor(survey)`. |
| `server/seed-data.ts:31-32` | `org_smk` is `minor`/`guardian`; `org_perpus` is `adult`/`self`; both `notice_version=1.2`. |
| `server/seed-data.ts:171-185,234` | `s_demo2` is owned by `u_creator_a` in `org_smk` but uses `p_perpus` (adult/self). |
| `server/seed-data.ts:344` | `s_demo2` has active public link `link-umum-perpus`. |
| `server/seed-data.ts:432` | `c_perpus01` is self-consent on that link. |
| `server/seed-data.ts:90-117` | Legacy `p_smk` / `p_perpus` rows carry their own `consent_mode` and `notice_version=1.0`. |

## SEC-02 — notice mismatch / fallback

| Location | Fact |
| --- | --- |
| `server/routes/public.ts:203-208` | `noticeFor(profileId, version)` orders exact version first, otherwise latest `effective_date`, `LIMIT 1`: silent fallback. |
| `server/routes/public.ts:234,263` | Notice lookup uses `survey.profile_id`, not the version's org/platform source. |
| `server/routes/surveys.ts:329-330,346` | New version gets `notice_version` from org/platform. |
| `server/routes/surveys.ts:377-380` | Editing computes the current policy but only uses it when `createDraft` is called; an existing draft keeps its old `notice_version`. |
| `server/routes/surveys.ts:428` | Duplicate copies `sourceVersion.notice_version` instead of current policy. |
| `server/seed-data.ts:59-60` | Platform profile notice version is `2.0`. |
| `server/seed-data.ts:121-142` | Only notice rows are `p_smk`/`p_perpus` version `1.0`; no `1.2` or `2.0` row exists. |
| `server/seed-data.ts:243-245` | Seeded published versions are `1.0`, so seeded org surveys already disagree with `organizations.notice_version=1.2`. |
| `server/routes/public.ts:459-478` | Consent stores `notice_version` from the version row, not the notice row actually rendered. |
| `server/routes/surveys.ts:476-481` (publish path) | `validateForPublish` validates title/purpose/questions only; no check that a notice exists for the version's `notice_version` before publishing. |

## SEC-03 — export authorization

| Location | Fact |
| --- | --- |
| `server/http.ts:170-178` | Individual read requires grant + `allow_individual`; export requires only grant `can_export`. |
| `server/routes/surveys.ts:701-731` | Codebook export uses `canExport`; CSV export at 773-776 likewise. |
| `server/routes/surveys.ts:735-773` | CSV rows include `respondent_id`, `assignment_id`, collection/identity fields, and every answer; text is separately gated by `canReadFreeText`. |
| `server/routes/surveys.ts:782-789` | `/responses` uses `canReadIndividual` (settings-aware), proving the asymmetry. |
| `server/test/api.test.ts:550-573` | Test covers `allow_individual=0` only for `/responses`; no export assertion. |
| `README.md:173` | Claims grant holders are bound by `survey_settings`. |

## SEC-04 — guardian evidence

| Location | Fact |
| --- | --- |
| `server/routes/public.ts:447-456` | Any nonempty `guardian_evidence_ref` sets `verified`; no verification/status/revocation lookup. |
| `server/routes/public.ts:459-478` | Consent row stores the client string and `verified`. |
| `server/routes/public.ts:385-397` | Submission only checks consent status/survey/version; no guardian validity check. |
| `src/screens/Respondent.tsx:68-89,355-357` | Browser sends the entered reference and stores it in `sessionStorage`; UI text presents it as verified. |
| `server/test/api.test.ts:340-370` | Existing test passes a synthetic string and expects success. |
| `PRD.md:73,260,273` | Requires valid/revocable guardian evidence. |

## SEC-05 — login unbounded input / audit growth

| Location | Fact |
| --- | --- |
| `server/app.ts:40` | JSON limit is 512 kb. |
| `server/routes/auth.ts:66-72` | Login email and password have no length/format check before the rate-limit key; email becomes the key. |
| `server/routes/auth.ts:76-78` | Failed login inserts the raw email as `actor` via `failLogin`. |
| `server/routes/auth.ts:36-47` | `failLogin` inserts `actor` without truncation. |
| `server/migrations/001_initial.sql:213` | `audit_logs.actor` is `TEXT NOT NULL`. |
| `server/security.ts:191-209` | Rate-limit Map never sweeps; unique keys add one entry each. |
| `server/security.ts:30-38` | Password hashing is synchronous `scryptSync`. |

## SEC-06 — rate limiting / proxy / global buckets

| Location | Fact |
| --- | --- |
| `server/security.ts:196-209` | In-process Map; no cleanup, no shared store, no global cap. |
| `server/index.ts` / `server/app.ts` | No `app.set('trust proxy', …)`; no trusted-hop configuration. |
| `server/routes/auth.ts:137` | Register key is only `register:${req.ip}`, limit 5/15 min. |
| `server/routes/public.ts:513` | Invitation resolve key is only `invite-code:${req.ip}`, limit 20/10 min. |
| `server/routes/public.ts:536` | Submission key is only `submit:${req.ip}`, limit 40/10 min. |
| `server/routes/public.ts:705` | Data request key is only `data-request:${req.ip}`, limit 10/h. |
| `server/routes/auth.ts:71-72` | Login key is `login:${req.ip}:${email}`, limit 8/15 min; shared proxy IP permits targeted lockout. |
| `README.md:279` and `README.md:334-346` | Production ingress routes `/api/*` to Express; Next rewrite is the single-origin path. Both proxy the socket IP. |

## SEC-07 — shared-tab consent/draft reuse

| Location | Fact |
| --- | --- |
| `src/screens/Respondent.tsx:51-66` | Consent is read from `sessionStorage` keyed only by token. |
| `src/screens/Respondent.tsx:68-89` | Consent payload, including guardian reference, is written to `sessionStorage`. |
| `src/screens/Respondent.tsx:119-124` | Form load reuses stored consent without a new click. |
| `src/screens/Respondent.tsx:467,613` | Draft is loaded by token. |
| `src/lib/draft.ts:5-86` | Draft is `sessionStorage`, keyed only by token; `clear()` exists but is never called. |
| `src/screens/Respondent.tsx:651-686` | Successful submit stores receipt/key and navigates, but does not clear draft or consent. |
| `server/routes/public.ts:385-397` | Server accepts any granted consent for the same survey/version. |
| `server/routes/public.ts:621` | Consent `response_id` is overwritten on each accepted submission. |

## SEC-08 — consent context replay

| Location | Fact |
| --- | --- |
| `server/routes/public.ts:385-397` | Checks only `status`, `survey_id`, `version_id`; not invitation/link, not `response_id IS NULL`. |
| `server/routes/public.ts:621` | Reuse overwrites `consent_records.response_id`. |
| `server/migrations/001_initial.sql:150-163,253` | Consent row has `invitation_id`/`response_id`; `ux_consent_response` only enforces one consent per response, not a stable context binding. |

## SEC-09 — invitation code entropy / resolver

| Location | Fact |
| --- | --- |
| `server/routes/surveys.ts:572` | Code is `UND-` + 3 random bytes (6 hex chars) = 24 bits. |
| `server/routes/public.ts:519-527` | Valid code returns the raw bearer `token` and URL. |
| `server/routes/public.ts:513` | Only 20 attempts/10 min per `req.ip`; no per-code/per-survey lockout. |
| `server/routes/public.ts:522-525` | 404 vs 409 distinguishes unknown from inactive/expired code (after a correct guess). |
| `server/routes/public.ts:314-333` (public payload) | Intro reveals `invitation.code` to any holder of the invitation token. |
| `server/routes/surveys.ts:597,620` | Code is written to audit `object` on create/revoke. |

## SEC-10 — bearer token storage/URLs

| Location | Fact |
| --- | --- |
| `server/migrations/001_initial.sql:185-200,240-255` | `invitations.token` and `public_links.token` are stored raw next to `token_hash`. |
| `server/bootstrap.ts:270-300` | `SELECT *` then `token_hash: ''`; the raw `token` field remains in responses. |
| `src/app/s/[token]/page.tsx` and `src/app/s/[token]/*` | Bearer token is a URL path segment. |
| `src/screens/Respondent.tsx:668-674` | Receipt navigation keeps the token in the URL. |
| `PRD.md:262` | Tokens must not be in app/proxy/analytics logs. |

## SEC-11 — invitation code in audit

`server/routes/surveys.ts:597` (`Buat undangan`, object `${survey.id} · ${code}`) and `:620` (`Cabut undangan`, object `${survey_id} · ${invitation.code}`); `GET /org/audit` and `/admin/audit` return `object` without redaction (`server/routes/org.ts:282-301`, `server/routes/admin.ts:437-441`). PRD `296`, README `132`.

## SEC-12 — integration token

`server/routes/integration.ts:37-41` reads one global `INTEGRATION_TOKEN`; `:43-130` queries any survey/version by ID, including drafts, with no tenant/scope/rate limit; comparison is ordinary string `===`; only success path is audited. `.env.example:25` documents a fixed placeholder (value not reproduced).

## SEC-13 — cookie Secure

`server/routes/auth.ts:32-34` trusts `req.secure` or any `X-Forwarded-Proto: https`; `server/security.ts:84-93` conditionally adds `Secure`; `COOKIE_SECURE` appears only in docs/config/tests, never in server code (`README.md:256,355`, `.env.example:20`, `docker-compose.yml:42`). No `trust proxy` is configured.

## SEC-14 — audit completeness / immutability

`server/routes/admin.ts:375,430` log only `{grants: n}` / `{rows: n}` for grant changes; `server/routes/surveys.ts:664-677` summary access has no success/denial audit; `server/routes/surveys.ts:627-641` settings read has no audit; `server/routes/admin.ts:437-441` admin audit read is not audited; `README.md:132` claims append-only, but the app role owns the schema/tables (`docker/postgres/init/01-app-role.sh:6-18`; `server/index.ts:8` applies migrations as that role) and no trigger/privilege revokes UPDATE/DELETE.

## SEC-15 — super-admin self-grant

`server/routes/admin.ts:333-376` and `:382-431` accept any account ID including the caller; no self-grant/dual-control check. `server/http.ts:176-178` then grants export; `170-173` individual with grant. `server/bootstrap.ts:267-269` already gives super admins all survey distribution tokens. This defeats the "super admin does not automatically read answers" rule (README `172`, test `api.test.ts:156-159`).

## L-01 — cache headers

`Cache-Control: no-store` is present in `server/routes/auth.ts:52,60,82,214`, `server/routes/public.ts:429,494,674,688`, `server/routes/org.ts:57,167,209,302`, `server/routes/admin.ts:262`, and `server/routes/integration.ts:120`. It is absent from the entire `server/routes/surveys.ts` router (list/detail/settings/summary/responses/export/codebook) and from most admin reads (accounts/audit/integration/data requests).

## SEC-16 — small-cell summaries

`server/summary.ts:67-140` returns exact option counts, `answered`, `skipped`, `total`, and `free_text_count`; no minimum group size or suppression. `server/routes/surveys.ts:664-674` permits any `canReadAggregate` grant holder. `PRD.md:263` leaves the parameter undecided.

## L-02 — invalid invitation expiry

`server/routes/surveys.ts:566-568` accepts any string, appends `T23:59:59.000Z`, and only rejects when `Date.parse` yields a value `<= Date.now()`. `NaN <= now` is false, so an unparseable value is stored. `server/routes/public.ts:524` uses `new Date(...).getTime() < Date.now()`; `NaN < now` is false, so the invitation never expires.

## L-03 — CSV numeric over-neutralization

`server/http.ts:317-329`; `server/routes/surveys.ts:177` allows arbitrary finite option values; `server/routes/surveys.ts:776` sends every cell through `csvDocument` (default neutralization). Probe P-01.

## L-04 — session lifecycle

`server/security.ts:84-126` cookie/session attach; `server/routes/auth.ts:80,214,229` creates/destroys only the current session; `server/routes/admin.ts:73-110` role/status changes do not delete sessions; `attachSession` reads status fresh (suspend blocks) but reactivation makes existing unexpired rows valid again. No password-change/reset/revoke-all endpoint. `001_initial.sql:78-89` session rows have no revocation field.

## L-06 — DB/container/CI

`docker/postgres/init/01-app-role.sh:6-18` makes the app role database owner and grants `CREATE` on `public`; `server/index.ts:8` applies migrations as that role; no separate migrator/runtime role and no RLS. Dockerfiles use `USER node` (good) but no `read_only`, `cap_drop`, or `no-new-privileges`; images are tag-pinned, not digest-pinned. `.github/workflows/ci.yml` has no audit/SBOM/image scan; actions are tag-pinned.

## L-05 — malformed cookie

`server/security.ts:56-64` decodes every cookie with `decodeURIComponent` without catch; `server/app.ts:41-43` forwards the rejected promise to the error handler; `server/app.ts:67-71` logs and returns generic 500. Probe P-04.

## L-07 — insecure defaults/placeholders

`.env.example:14,20,25` and `README.md:256,355` contain local-only placeholders/defaults; `docker-compose.yml:8-11,40-46` contains a fixed local DB credential and `COOKIE_SECURE`/`ENABLE_HSTS` defaults. `INTEGRATION_TOKEN` is accepted verbatim if the placeholder is copied; there is no startup guard for known placeholder values. Values are intentionally not reproduced here.

## Observation — stale/dead authorization code

`server/survey-service.ts:113-150` implements a separate `permissionsFor` that does not apply `survey_settings`; `server/export.ts` imports it, but neither module is imported by any route (`grep -rn "survey-service" server` finds only `server/export.ts`). Dead code, not reachable today; it is a latent second authorization model.

## Observation — granted creator visibility

`server/http.ts:134-136` creator list is owner-only; `:137-142` grant branch is only reached for non-creator roles. `server/routes/surveys.ts` direct endpoints allow a creator with grant. `bootstrap.ts:267-269` likewise omits granted surveys. This matches `docs/audit/2026-11-20/03-role-access.md` BR-01 (functional/UI defect, not a privilege escalation).
