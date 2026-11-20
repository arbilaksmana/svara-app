# Svara audit report

**Audit date:** 2026-11-20  
**Baseline:** `95eafa3cb38aac4dd32963a1ec584a2ce6821f25`  
**Verdict:** **Not ready for a pilot with real respondents. Production readiness is not verified.**  
**Scope:** product requirements, business flows, tenant/role access, UI/accessibility, security, performance, operations, and data retention. Runtime probes used local synthetic fixtures only.

## Executive result

Several P1 privacy and authorization paths violate their expected controls: consent policy and notice can come from the wrong source; arbitrary guardian evidence is accepted as verified; an export grant bypasses individual-data settings; the global integration token spans tenants; and close can leave a newer public version accepting submissions. There are also blocking UI role paths and measured slow authenticated reads. These defects, plus absent data-request verification and retention, block a real-participant pilot.

The audit did **not** exercise staging or production, real respondent data, an external target, or a production ingress. Passing unit/smoke/load checks establish only the stated local scenarios. They do not override the failed business/security/UI findings.

## Result counts

| Register | Result |
|---|---|
| `findings.csv` | 97 rows: 1 Critical, 25 High, 45 Medium, 25 Low, 1 Info. 96 Open and 1 historical-evidence item Closed. Report findings intentionally overlap across business, security, role, UI, and operations reports; these are not 97 independent root causes. |
| `requirements.csv` | 42 rows covering F-01–F-20, AC01–AC17 (some ACs grouped), and R1–R9. Row statuses: 9 Pass, 1 Pass on baseline, 1 Pass for local 1k/10k, 18 Partial, 12 Fail, 1 Not verified. |
| `scenarios.csv` | 24 scenarios: 7 PASS, 3 PARTIAL, 6 FAIL, 1 INVALID, 3 BLOCKED, 4 NOT_VERIFIED. |
| Audit reports | `01-documents.md`, `02-business-flows.md`, `03-role-access.md`, `04-uiux-accessibility.md`, `05-security-vulnerabilities.md`, `06-performance-scalability.md`, `07-operations.md`, `10-data-retention.md`. |

The security report also records seven lower-risk confirmed observations (`L-01`–`L-07`) in the unified register. Hypotheses `H-01`–`H-07` remain explicitly unverified and are not counted as confirmed findings.

## Highest-priority findings

| Severity | Finding | Evidence / reproduction | Impact |
|---|---|---|---|
| Critical | **UIX-01 / BR-01:** grant-based officer cannot use the granted survey in the UI | `03-role-access.md` §4 and `04-uiux-accessibility.md` §2; synthetic officer bootstrap/list omit the survey while API detail/summary succeed | The documented grant workflow is API-only. |
| High | **SEC-01 / SEC-02 / BF-01:** consent policy and notice resolve through legacy profile/notice data, not the survey tenant | `server/routes/public.ts:199-208,233-263`; `evidence/sec/runtime-profile-source.json`, `evidence/sec/runtime-public-checks.json` | The shown age/consent policy and notice version can differ from the organization/platform policy. |
| High | **SEC-03 / BF-07:** export grant bypasses individual-data settings | `server/http.ts:170-179`; `server/routes/surveys.ts:735-789`; `evidence/biz/biz-export-probe-2026-11-20T13-45-21-859Z.json`. With settings false, summary/responses returned 403 while CSV export returned 200 with per-response rows. | Exposes row-level identifiers and answers despite the read controls. |
| High | **SEC-04 / BF-03:** any nonempty guardian reference becomes “verified” | `server/routes/public.ts:447-456`; `evidence/sec/runtime-guardian-consent.json`. Missing reference returned 422; arbitrary reference was accepted with status `verified`. | The stored consent evidence does not establish guardian verification. |
| High | **SEC-12:** one global integration token reads across tenants and can address drafts | `server/routes/integration.ts:37-85`; `evidence/sec/runtime-api-checks.json` | No per-consumer tenant/scope boundary. |
| High | **BF-04:** close/publish lifecycle leaves public intake active | `server/routes/surveys.ts:480-483,518-529,558-563`; `evidence/biz/biz-api-probes-2026-11-20T13-43-58-462Z.json` | After a second version is published and the survey is closed, the newer link still accepts a submission. |
| High | **NEW-01:** data requests lack identity verification and enforced retention | `server/routes/public.ts:703-738`; `server/routes/admin.ts:502-524`; `10-data-retention.md` §2 | Synthetic contact/note fields are retained without verification; no retention or deletion job exists. |
| High | **PERF-01–03:** authenticated reads do work across the whole dataset | `06-performance-scalability.md` §6.3; mixed 10 VU evidence: read p95 4.76 s, bootstrap 5.27 s, summary 3.28 s, responses 3.39 s | Latency is already high at the tested local 10k profile; larger-load behavior is unverified. |
| Medium / AA failures | **UIX-11–16, UIX-22, UIX-24, UIX-25:** heading, link name, focus return, contrast, zoom/reflow, page title, and color-only state issues | `04-uiux-accessibility.md` §4–§6 and `evidence/ux/runtime-observations.json` | The inspected surfaces do not conform to WCAG 2.2 AA. Actual screen-reader and native-device behavior was not tested. |

## Verification performed

| Area | Result | Evidence and boundary |
|---|---|---|
| Baseline checks | Lint, production build, web smoke passed. `pnpm test` reported 39 passing tests and 0 failures. | `07-operations.md` §1; `evidence/ops/`. These are existing test contracts, not proof of every product requirement. |
| Dependencies | `pnpm audit --prod` found 0 production advisories; the full graph had one moderate dev-only `minimatch` advisory. | `05-security-vulnerabilities.md` §7; `evidence/sec/dependency-audit.md`; raw JSON in `evidence/sec/pnpm-audit-prod-2026-11-20.json`. No image/OS scan was performed. |
| Business/security API | Bounded probes against audit databases reproduced policy-source mismatch, guardian self-attestation, cross-context consent reuse, export-settings bypass, close/version behavior, data-request storage, integration scope, and bootstrap token exposure. | `02-business-flows.md`, `05-security-vulnerabilities.md`, `10-data-retention.md`, and `evidence/{biz,sec}/`. Synthetic data only. |
| UI/accessibility | Isolated Chromium inspection covered listed flows, failures, keyboard use, and responsive viewports including 320/390/640/768/1440px and 200% text. | `04-uiux-accessibility.md` §1; screenshots and runtime observations in `evidence/ux/`. Console errors were empty where captured; no screen-reader software or native device was used. |
| AC13, 1k profile | PASS: 30/30 HTTP 201, 30 unique responses, 600 answers, reconciled counters; HTTP p95 498.14 ms and server span p95 117 ms. | `evidence/perf/ac13-1k.json`; `06-performance-scalability.md` §5–§6. Local synthetic data. |
| AC13, 10k profile | PASS: 30/30 HTTP 201, 30 unique responses, 600 answers, reconciled counters; HTTP p95 381.12 ms and server span p95 107 ms. | `evidence/perf/ac13-10k.json`; `06-performance-scalability.md` §5–§6. Local synthetic data. |
| Mixed 10 VU | PARTIAL: 474/474 reads returned 200 and both writes reconciled, but read p95 was 4.76 s. | `evidence/perf/mixed-10.json`. Host was not fully exclusive. |
| Mixed 30 VU | INVALID as a capacity result: 2,587/6,201 requests returned 403 from unauthorized harness sessions; five valid writes reconciled; minimum free RAM was 306 MB; no 5xx. | `evidence/perf/mixed-30.json` and resource samples. Not a PASS. Higher load was stopped. |
| Query plans | EXPLAIN ANALYZE BUFFERS captured for 10 queries at each of 1k and 10k. | `evidence/perf/explain-1k.txt`, `explain-10k.txt`. This does not establish 100k performance. |
| Backup/restore | Local PostgreSQL dump/restore brought a deleted synthetic response back; a post-restore audit row could be inserted. | `evidence/ops/ac15-restore-runtime.log`. This does not prove off-site restore, deletion replay, incident readiness, or RPO/RTO. |

Performance data was additive: six demo responses were preserved. The seed summary mislabeled a 10k response/200k answer join count as 200k responses; independent counts confirmed 10,000 responses and 200,000 answers. No truncation or deletion was performed.

## Blocked and not verified

- 100k seed and large CSV export: **BLOCKED** by low available RAM and the export safety gate. The 100 VU ramp, 200 VU spike, and 20 VU/30-minute soak were **BLOCKED** after free RAM reached 306 MB during the 30 VU attempt. No high-load capacity or leak conclusion.
- Mixed 30 VU: **INVALID**, not a throughput pass, because of unauthorized-session 403s.
- Browser LCP/CLS/TTFB lab, SIGTERM during an in-flight request, standalone-container shutdown, production TLS/proxy/cookie behavior, multi-instance rate limiting, and production deployment: **NOT_VERIFIED**.
- AC16 field study with real respondents: **NOT_VERIFIED**. No real participant data was collected.
- Screen-reader software, native mobile devices, legal review, off-site/encrypted backups, and restore to another host/region: **NOT_VERIFIED**.
- The performance worker stopped its services on ports 4340–4343. Other processes were still listening on 3001, 4320, 4322, and 4331 and were not stopped. Host exclusivity cannot be claimed.

## Recommendation

**Do not pilot with real respondents or sensitive answers yet.** Resolve consent source/version and guardian verification, export authorization, integration scoping, close/version enforcement, data-request verification/retention, and the grant/org-admin UI paths first. Reconcile PRD/README authority for `org_admin`, individual-data permissions, and cross-tenant grants before implementation. Then rerun targeted scenarios with isolated test data and resource headroom. Production readiness requires a separate deployment/operations review; this audit makes no production-capacity or compliance claim.

## Deliverables

- `findings.csv` — consolidated finding register with source IDs and evidence pointers.
- `requirements.csv` — F/AC/R requirement coverage.
- `scenarios.csv` — scenario outcome and verification boundary.
- `01-documents.md` through `07-operations.md`, plus `10-data-retention.md` — detailed reports.
- `evidence/` — logs, synthetic API results, query plans, screenshots, runtime observations, and performance resource samples.

No application source, test, migration, or runtime configuration was changed for this audit closeout. Audit reports/registers/evidence are the deliverables.
