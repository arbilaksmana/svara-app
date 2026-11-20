# PERF static query inventory

Captured: 2026-11-20T13:50:01Z · commit `95eafa3c` · DB `svara_audit_perf` · status **STATIC_ONLY_NO_LOAD**

Counts below are derived from source for **N = 20 items**, owner role, warm pool. Session attach (`server/security.ts:attachSession`) adds 1 query to authenticated requests. Actual number of rows returned and planner behavior must be measured after the coordinator gate; counts are not timings.

## Hot path: public-link respondent journey

| Step | Endpoint | Queries | Notes |
|---|---|---:|---|
| Intro | `GET /public/surveys/:token` | 6 + N = 26 | `resolvePublicContext` loads version, survey, profile, notice, questions, then **one option query per question**, even though the response body drops questions/options (`includeQuestions=false`, `public.ts:426-430`) |
| Consent | `POST /public/surveys/:token/consent` | 8 + N = 28 | context again + consent insert + audit insert |
| Form | `GET /public/surveys/:token/form` | 7 + N = 27 | context again + consent lookup |
| Submit | `POST /public/surveys/:token/responses` | 17 + 3N = 77 | context 26 + consent 1 + answer option validation N + tx 28 + success audit 1 |
| **Journey** | | **158** | one respondent, 20 items, 4 requests |

Reference: `server/routes/public.ts:226-283` (context), `:324-424` (parseAnswers), `:533-700` (submit transaction), `:703-760` (data request).

Submit transaction (`server/routes/public.ts:555-700`): advisory xact lock → attempt lookup → version status → respondent insert → response insert → **N single-row answer inserts** → consent update → attempt insert → integration event insert → receipt select. Commit is separate from the post-commit audit insert, so a successful submit causes **two commits**.

Invitation flow adds an invitation lookup, assignment lookup, existing-response lookup and an invitation row lock: roughly +4 queries and one serialized row per invitation.

Rate-limit caps on this path (process-local, `server/security.ts:196-210`): consent `30/min` per IP+token, submit `40/10min` per IP, invite resolve `20/10min` per IP. Behind a proxy without `trust proxy`, all clients share the proxy's IP.

## Authenticated bootstrap

`GET /bootstrap` is the dominant authenticated read.

For one creator owning one survey with one version and 20 questions:
- 9 base queries: surveys, versions, questions, options, invitations, public links, assignments, grants, settings
- `summaryFor(version)` = 3 + 2N = **43** queries
- 1 survey profile query
- **≈ 53 queries per bootstrap**

`summaryFor` per question runs an option-count query and an answered-count query (`server/summary.ts:52-110`). For a `super_admin`, bootstrap runs `summaryFor` for **every version of every survey** (`server/bootstrap.ts:345-356`) plus accounts, organizations, audit 250, integration 250, data requests 250. Super-admin cost therefore grows with the entire installation's answer volume, not with the operator's own data.

Bootstrap `summaries` is **never consumed by the client**: `src/lib/api.ts:100` only declares the field; no component reads it. The results screen fetches `/surveys/:id/summary` separately.

Every protected Next page calls bootstrap twice:
1. server guard `requireCreator`/`requireAdmin` fetches `/bootstrap` only to obtain `account` (`src/lib/server/guards.ts:19-45`)
2. client `AppProviders` calls `loadBootstrap()` after hydration (`src/components/AppProviders.tsx`)

Every mutation triggers another full bootstrap via `refreshBootstrap()` (11 call sites in `src/lib/store.ts`).

## Read/aggregate endpoints

| Endpoint | Queries (owner) | Data touched |
|---|---:|---|
| `GET /surveys/:id/summary` | ≈ 46 + session | full version answers, 2 queries/item |
| `GET /surveys/:id/responses?limit=100` | 5 + session | **all answers of the version**, regardless of the 100-response page (`surveys.ts:795-801`) |
| `GET /surveys/:id/export` | 6 + session | **all responses + all answers**, then a single CSV string (`surveys.ts:715-775`) |
| `GET /admin/stats` | 6 + session | 4 counts + per-creator and per-survey fan-out joins (`admin.ts` stats handler) |
| `GET /org/audit` | 1 + session | organization audit ordered by `at`; no matching composite index |
| `GET /integration/survey-data` | ≈ 7 | count + ordered page with OFFSET, then page answers only |

`server/export.ts` contains a second export implementation (`responsesForVersion` → one query per response via `Promise.all`) that is not used by HTTP routes or tests. It is dead weight and a misleading design example, not a runtime cost today.

## Concurrency and locking

- One pool per API process, defaults `max=10`, idle 10s, acquire timeout 5s (`server/db.ts:23-29`). Two replicas = 20 connections; no global budget guard.
- No `statement_timeout`, no `query_timeout`, no per-request deadline. A slow summary/export can hold a pool slot indefinitely; later requests wait up to 5s and then surface as generic 500.
- Submit uses `pg_advisory_xact_lock(hashtextextended(scope:key,0))` held until commit; duplicate concurrent submissions serialize for the full transaction duration.
- Transactions are READ COMMITTED; 40001/40P01 are mapped to 503 but not retried.
- No deadlock/serialization retry loop.

## Event loop / buffering

- `scryptSync` on login, register, password change, organization creation (`server/security.ts:30-40`) blocks the event loop for the whole hash. Concurrent logins serialize.
- CSV export builds the complete document in memory (`csvDocument`) and `res.send`s it; no streaming, no backpressure, no abort handling. Client disconnect does not cancel the queries or the string build.
- API responses are not compressed (no `compression` middleware in `server/app.ts`); bootstrap/export JSON/CSV travel uncompressed from the API. Next static assets use Next's own compression.
- `express.json({limit:'512kb'})` parses every API request before routing.

## Next.js

- Root layout sets `export const runtime = 'nodejs'` and `export const dynamic = 'force-dynamic'`; `prerender-manifest.json` contains only `/_global-error`. Every page is server-rendered per request.
- Every page load calls the API bootstrap twice (guard + client), so TTFB and API load are coupled.
- Client bundle (Next diagnostics, uncompressed / gzip-9 / brotli): creator results 608,274 / 179,741 / 155,826 bytes; admin 581,585 / 171,509 / 148,442; public form 580,929 / 172,226 / 149,120; login 548,650 / 163,671 / 141,353.
- Existing `.next` build has `/api` rewrite baked to `127.0.0.1:4321`, not the perf gateway. Perf topology must route `/api/*` at the gateway and must not let a browser hit Next `/api` directly.
- `scripts/dev.mjs` hardcodes 3000/3001; perf must start API and `next start` explicitly on 4341/4342 and 4343.

## Session / process-local state

- Sessions are DB-backed (`sessions.token_hash` PK), so two replicas share logins. Each authenticated request does one session+account join; no cache.
- Expired sessions are only deleted when that exact token is presented; `ix_sessions_expires` exists but no sweep job exists. Table grows one row per login until manual cleanup.
- Rate-limit buckets are an unbounded `Map` in one process (`server/security.ts:196-210`); keys include IP and email/token. No TTL sweep. Two replicas double every limit; a restart resets them.
- No business state (drafts, responses, counters) is held in process memory, so horizontal read scale-out is otherwise safe.

## Shutdown / deployment / CI

- API: `server.close()` then pool close, with a hard `setTimeout(5_000).unref()` (`server/index.ts:27-35`). In-flight exports longer than 5s are killed; no readiness drain.
- `/api/v1/health` runs `SELECT 1` through the same pool; saturation makes liveness fail. Docker healthcheck every 30s.
- API container runs `tsx server/index.ts` (no compiled build), production NODE_ENV, 0.0.0.0 bind. Compose has no resource limits or stop grace customization; Docker default 10s covers the app's 5s cap.
- Web container is Next standalone; healthcheck GET `/auth/login` (dynamic SSR, no API call).
- CI runs typecheck, six test files, two Docker builds and one browser smoke; no load, no query-count or bundle-size budget, no threshold.

## Index gaps (details in `static-index-inventory.txt`)

- `public_links.token_hash`, `invitations.token_hash`: lookup columns have no index (indexes are on raw `token`).
- `responses(version_id, submitted_at, id)`: ordered pagination/export sorts.
- `answers(option_id)` / `answers(question_id)`: summary aggregation.
- `audit_logs(organization_id, at DESC)`: org audit.
- `surveys(owner_id)`, `surveys(organization_id)`, `surveys(updated_at)`: lists/admin stats.
- `integration_events(at)`, `data_requests(created_at)`: admin lists.

All EXPLAIN/ANALYZE work is deferred to the gated dynamic phase.
