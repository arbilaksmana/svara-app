# Security evidence — environment and probe gate

- Baseline: `95eafa3cb38aac4dd32963a1ec584a2ce6821f25`
- Captured: `2026-11-20T13:54:27Z` (UTC)
- Workspace: `C:/Users/arbil/orca/workspaces/svara-app/audit-total`
- Node: `v24.15.0`; pnpm: `11.5.2`

## Runtime gate

| Requirement | Observation | Consequence |
| --- | --- | --- |
| `svara_audit_sec` DSN | No `SVARA_AUDIT_SEC` value in process environment | No audit DB session opened |
| API on port `4331` | No listener on TCP `4331` | No HTTP security probe executed |
| `psql` client | Not present on PATH | No direct DB query performed |
| Docker containers visible | Only `svara-app-db-1` was listed; it was **not** inspected, queried, or modified | `svara` / `svara_test` not accessed |
| API/web user services | Ports `3000`, `3001`, `4311`, `4341` were not called | No user session or unrelated audit DB touched |
| Image vulnerability scanner | `trivy`, `grype`, `syft`, `hadolint` absent | Image/SBOM scan NOT_VERIFIED; no scanner installed |

No SQL migration, schema change, seed, reset, or data write was executed. Only
read-only filesystem inspection and pure-function probes (below) were run.

## Secret pattern scan (paths/counts only; values not reproduced)

- No `.env` file exists outside `node_modules`.
- No `BEGIN ... PRIVATE KEY`, AWS access-key, GitHub PAT, Slack token, or
  `sk_live_` pattern was found in tracked source/config/docs.
- No raw session cookie, bearer token, `UND-` invitation code, or JWT-shaped
  string was found in `docs/test-evidence/` by pattern scan.
- `.next/` is present as a prior build artifact. Literal local defaults
  (database password, integration placeholder, seed password) were **not**
  found in it. This is not a full secret-history scan; see report §7.

Placeholders and local-only defaults do exist in `.env.example`, `README.md`,
`docker-compose.yml`, and the CI workflow. They are referenced by path in the
report without reproducing their values.

## Limitations

- Browser/CSP/header behavior, ingress/access-log capture, multi-instance
  rate-limit behavior, DB privileges/backups, and the live API were not
  exercised. Each is listed as NOT_VERIFIED in the report.
- The absence of a finding in this evidence directory is not evidence of
  absence; it means the path was not reached with the provided environment.
