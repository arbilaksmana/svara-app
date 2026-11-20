# Security evidence — dependency advisory check

- Baseline lockfile: `pnpm-lock.yaml` at `95eafa3cb38aac4dd32963a1ec584a2ce6821f25`
- Run window: `2026-11-20T13:44Z`–`2026-11-20T13:46Z` (UTC)
- Tool: `pnpm audit` (pnpm `11.5.2`), no package installed or upgraded
- Raw results: `pnpm-audit-all-2026-11-20.json`, `pnpm-audit-prod-2026-11-20.json`

## Commands

```sh
pnpm audit --json
pnpm audit --prod --json
pnpm why minimatch
```

## Result — all dependencies

| Field | Value |
| --- | --- |
| Advisories | 1 moderate, 0 low/high/critical |
| Package | `minimatch` |
| Installed version | `10.2.6` |
| Vulnerable range | `>=7.0.0 <11.0.1` |
| Patched version | `>=11.0.1` |
| Advisory | GHSA-g3hv-75wg-m249 (CWE-405) |
| Source | https://github.com/advisories/GHSA-g3hv-75wg-m249 |
| Environment | **dev** (`dev: true`); 7 paths, all through `typescript-eslint` |
| Dependency count | 345 total / 208 dev / 99 prod / 88 optional |

Paths are `typescript-eslint → @typescript-eslint/{eslint-plugin,parser,utils,type-utils,typescript-estree} → minimatch`.

## Result — production dependency graph

```json
{"advisories":{},"metadata":{"vulnerabilities":{"info":0,"low":0,"moderate":0,"high":0,"critical":0},"dependencies":95,"devDependencies":0,"optionalDependencies":42,"totalDependencies":137}}
```

No production advisory was returned against the pinned lockfile at the run
timestamp.

## Reachability / applicability

- `typescript-eslint` and `minimatch` are **not** in the API production image:
  `Dockerfile.api` installs with `--prod`. The web build installs the full
  lockfile (dev dependencies are needed for `next build`), but the runtime image
  copies only `.next/standalone` plus `static`/`public`; it does not copy the
  build `node_modules` tree. Next's standalone tracing is expected to exclude
  lint tooling, but the image was not scanned. The API/Next runtime does not
  import `minimatch`.
- The advisory affects glob-pattern processing in lint tooling. Repository
  lint patterns are developer-controlled; no HTTP/API input reaches this code.
  A malicious changed `eslint.config.*` could cause a lint-time DoS, not a
  production data or auth compromise.
- **This is a scanner result, not a confirmed exploit.** No reproduction was
  attempted; no package was installed.

## CI / supply-chain observations (static, `.github/workflows/ci.yml`)

- `pnpm install --frozen-lockfile` is used (good).
- No `pnpm audit`, OSV scan, SBOM, provenance, or image scan step.
- Actions are pinned to mutable major tags (`actions/checkout@v4`,
  `pnpm/action-setup@v4`, `actions/setup-node@v4`), not commit SHAs.
- Service image `postgres:17-alpine` and runtime base images
  `node:24-bookworm-slim` are tag-pinned, not digest-pinned.
- API image installs `tsx` globally from npm without a lockfile integrity entry
  (`Dockerfile.api`), after the frozen-lockfile app install.
- `permissions: contents: read` limits the workflow token (good).
- The workflow contains a fixed local CI database password; it is test-only and
  not a production secret, but it demonstrates why production credentials must
  never reuse workflow defaults.
