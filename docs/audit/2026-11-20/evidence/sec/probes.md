# Security evidence — tightly scoped pure-function probes

All probes imported production modules with a deliberately unreachable dummy
DSN (`postgres://probe:probe@127.0.0.1:1/probe`) only to satisfy module load.
No query, connection, server, user session, or real database was used.

## P-01 — CSV formula neutralization also rewrites negative numeric values

Command (excerpt):

```sh
DATABASE_URL='postgres://probe:probe@127.0.0.1:1/probe' \
  pnpm exec tsx -e "import {csvCell} from './server/http.ts'; ..."
```

Output:

```json
[
  {"input":-1,"output":"'-1"},
  {"input":-1.5,"output":"'-1.5"},
  {"input":"=1+1","output":"'=1+1"},
  {"input":"+1","output":"'+1"},
  {"input":"@x","output":"'@x"},
  {"input":"\t=cmd","output":"'\t=cmd"},
  {"input":"normal","output":"normal"},
  {"input":"a,b","output":"\"a,b\""},
  {"input":"  =1","output":"  =1"}
]
```

Findings:

- Formula-like text is neutralized (`=`, `+`, `-`, `@`, tab, CR) — control works.
- Negative numeric option values are also prefixed with `'`, so `-1` exports as
  text `'-1`. This is a data-integrity side effect, not a formula bypass.
- A leading space before `=` is not neutralized. It is not treated as a formula
  by Excel in the normal case; not claimed as an exploit.

## P-02 — scryptSync blocks the event loop

Command: five sequential `hashPassword('CorrectHorseBattery9!')` calls using the
same exported function used by login/registration.

```json
{"runs_ms":[37,36,36,36,35],"avg_ms":36}
```

Observation: ~36 ms of synchronous CPU per hash on this host. The API has one
Node event loop; concurrent login attempts for existing accounts serialize this
work. This supports the CPU-amplification note in SEC-05; no concurrent load
test was run.

## P-03 — Rate-limit buckets are retained for unique keys

Command: 100,000 calls to the exported `rateLimit()` with distinct keys, then a
heap measurement. No window expiry wait was needed: the function never removes
keys except when the same key is presented again.

```json
{"keys":100000,"heap_delta_mb":10,"malformed_cookie":"URIError"}
```

Observation: ~10 MB retained for 100k synthetic keys in this process. The map is
module-global and has no sweep. A login key contains the raw email
(`server/routes/auth.ts:71`), so large/unique emails amplify retention; see
SEC-05/SEC-06.

## P-04 — Malformed session cookie throws instead of being ignored

`parseCookies('a=%E0%A4%A')` threw `URIError` (captured in the same probe).
`attachSession()` calls `parseCookies(req.headers.cookie)` without a local
try/catch; Express forwards the rejected promise to the API error handler,
which logs and returns a generic 500.
