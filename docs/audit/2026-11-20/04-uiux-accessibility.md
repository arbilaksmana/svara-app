# 04 — UI/UX and accessibility audit

- Baseline: `95eafa3cb38aac4dd32963a1ec584a2ce6821f25`
- Scope: whole-product UI/UX and WCAG 2.2 A/AA review across public flows, creator/org-admin/admin surfaces, and respondent states.
- Runtime: isolated audit UI at `http://127.0.0.1:4322` (Next), API at `http://127.0.0.1:4321` (`/api/v1/health` → `200 {ok:true}`), production build, seeded audit database.
- Related reports: `03-role-access.md` (BR-01…BR-04), `02-business-flows.md` (BF-03, BF-08, BF-10), `05-security-vulnerabilities.md` (SEC-04).
- Method: real Chromium sessions in an isolated profile; DOM/computed-style inspection, accessibility-tree snapshots, keyboard activation, network-failure injection, 320/390/640/768/1440 viewports, 200% text zoom. Visual results below come from runtime, not source inference.

## 0. Verdict

**Not conformant with WCAG 2.2 AA on the inspected surfaces.** Happy paths are visually coherent, forms use semantic fieldsets/labels, focus rings and 44px targets are largely present, and the public response flow can be completed keyboard-only. The failures that matter most are not cosmetic:

1. the documented grant-based officer has no usable survey workspace;
2. owner and org-admin UI capability checks contradict the API, blocking individual reads and org-admin management;
3. admin bootstrap/stats failures silently render guest navigation and stale fixture counts, including `0` pending data requests;
4. guardian “verification” is a self-attested checkbox plus free text, displayed as “Terverifikasi”;
5. transient public/admin failures often drop users into dead ends without retry;
6. there are confirmed AA failures for form boundaries (1.4.11), landing annotations (1.4.3), 200% text at 320px (1.4.4), mobile home-link naming (2.4.4/4.1.2), and heading structure (1.3.1).

The verdict applies only to routes, roles, viewports, and states listed in §1. It does not claim screen-reader conformance, native-device validation, or coverage outside this report.

## 1. Coverage

Legend: **S** screenshot, **D** DOM/computed style, **A** accessibility snapshot, **K** keyboard, **N** network abort/injection, **C** console, **V** viewport matrix.

| Surface | Actors / roles | States exercised | Viewports | Tools | Key evidence |
| --- | --- | --- | --- | --- | --- |
| `/` landing | guest; anonymous bootstrap | default; empty demo table; long page | 1440, 390, 320 | S, D, C, V | `landing-desktop-1440.png`, `landing-mobile-390.png`, `landing-mobile-320.png` |
| `/auth/login` | guest | default; empty validation; network failure | 1440, 390, 320 | S, D, A, K, C | `login-desktop-1440.png` |
| `/auth/register` | guest → creator | default; empty validation; keyboard submit; 5 simultaneous errors | 1440, 390 | S, D, A, K | `register-desktop-1440.png`, `register-mobile-390.png` |
| `/privacy`, `/terms` | guest | default; data-request form; mobile reflow | 1440, 390, 320 | S, D, A | `privacy-desktop-1440.png`, `public-320-privacy.png` |
| `/s/[token]` intro | public link; invitation; guardian mode | consent default; missing/incomplete consent; used invitation; load failure | 1440, 390 | S, D, A, K, N, C | `respondent-intro-desktop-1440.png`, `respondent-invitation-mobile-390.png` |
| `/s/[token]/form` | public; invitation | empty; complete; required errors; keyboard-only completion; 200% text | 1440, 390, 320 | S, D, A, K, C | `respondent-form-320-200pct-text.png` |
| `/s/[token]/review` | public | default; guardian display; submit | 1440 | S, D, A, K, N | `respondent-review-desktop.png` |
| `/s/[token]/receipt` | public; invitation | success; lost session storage; retry disabled | 1440, 390 | S, D, K, C | `respondent-receipt-desktop.png`, `respondent-receipt-lost-storage.png`, `respondent-receipt-mobile-390.png` |
| `/creator` | owner creator; new creator; officer; org admin | default; empty list; direct denied routes | 1440, 390 | S, D, A | `creator-list-desktop-1440.png`, `officer-creator-list-404.png`, `orgadmin-lands-creator-1440.png` |
| `/creator/surveys/[id]/{edit,preview,publish,share,settings,history}` | owner; officer; org admin | default; publish; reloaded publish; denied direct route | 1440, 390 | S, D, A, K | `editor-mobile-390.png`, `publish-share-dead-control.png`, `share-desktop-1440.png` |
| `/creator/surveys/[id]/results` | owner; officer; org admin | aggregate; individual denied; zero-version; permission denied | 1440, 390 | S, D, N, C | `results-owner-desktop-1440.png`, `results-no-version-desktop.png` |
| `/admin` summary | super admin | default; bootstrap failure; stats failure | 1440, 768, 640 | S, D, A, N | `admin-summary-desktop-1440.png`, `admin-summary-tablet-768.png`, `admin-bootstrap-failure-fixtures.png` |
| `/admin/accounts` | super admin | default; role/organization controls | 1440 | S, D, A | `admin-accounts-desktop-1440.png` |
| `/admin/{audit,integration,requests,platform}` | super admin | default; request-load failure; dead-end links | 1440 | S, D, N | `admin-audit-dead-end.png`, `admin-requests-error-empty.png` |
| `/admin/org` | org admin | default; profile/member load failure | 1440 | S, D, A, N | `orgadmin-org-desktop-1440.png`, `orgadmin-org-load-failure.png` |
| 404 / unknown route | guest | default | 1440 | S, D | `404-desktop.png` |
| Route error boundary | any | not triggered | — | static only | `src/app/error.tsx` |

Additional runtime measurements are in `evidence/ux/runtime-observations.json`. Network-failure probes used test-only request aborts; console errors were empty where captured, but absence of console output is not treated as proof of a correct state. No production or real-user session was touched.

## 2. Roles versus actors

The product has three account roles (`creator`, `org_admin`, `super_admin`) but more behavioral actors. The audit treats them separately:

| Account role | Actual actor in this audit | UI consequence |
| --- | --- | --- |
| `creator` | Owner of a survey | Full creator workspace |
| `creator` | Grantee / “officer” (not owner) | Survey absent from list and all detail routes; no grant workspace |
| `creator` | New account without surveys | Generic empty state; expected |
| `org_admin` | Organization manager | Sees org surveys but gets owner-only controls |
| `super_admin` | Platform operator | Admin surfaces; no survey-management surface |
| unauthenticated | Public respondent / guardian | Token-scoped public flow |
| unauthenticated | Data requester | Static privacy page and data-request form |

This role/actor split is the root of UIX-01 and UIX-03. It is not just a permission bug: the navigation model has no place for a grant-scoped actor, and the “owner” predicate is reused as the universal manage predicate.

## 3. Findings

Severity reflects user/product impact in this audit. “WCAG” means a criterion failure; “UX” means a functional, content, or heuristic concern that is not itself a WCAG failure.

| ID | Severity | Finding | Type |
| --- | --- | --- | --- |
| UIX-01 | Critical | Grant-based officer cannot open the granted survey | UX/functional |
| UIX-02 | High | Admin bootstrap/stats failure renders guest nav and false fixture KPIs | UX/state integrity |
| UIX-03 | High | UI capability checks contradict API for owner and org-admin reads/manage | UX/functional |
| UIX-04 | High | Guardian verification is self-attested and shown as verified | Privacy/UX |
| UIX-05 | Medium | Publish page loses its only direct share control after reload | UX/state |
| UIX-06 | Medium | Receipt recovery dead-ends after storage loss | UX/recovery |
| UIX-07 | Medium | Public survey load failure offers no retry | UX/recovery |
| UIX-08 | Medium | Privacy contact chain ends at a placeholder | Content/privacy |
| UIX-09 | Medium | Public landing shows an empty demo table under “Terbit” | UX/public trust |
| UIX-10 | Medium | Admin header overflows at 640–768px, clipping “Keluar” | Responsive UX |
| UIX-11 | Medium | Register page has no heading (zero `h1`) | WCAG 1.3.1 |
| UIX-12 | Medium | Mobile header home link has no accessible name | WCAG 2.4.4/4.1.2 |
| UIX-13 | Medium | Closing mobile menu with Escape drops focus to `body` | WCAG 2.4.3 / UX |
| UIX-14 | Medium | Select/textarea boundaries are 1.37:1 | WCAG 1.4.11 |
| UIX-15 | Medium | Landing step annotations are 2.12:1 | WCAG 1.4.3 |
| UIX-16 | Medium | 200% text at 320px clips the survey heading | WCAG 1.4.4 |
| UIX-17 | Medium | Zero-version results show a blank selector and contradictory export banner | UX/state |
| UIX-18 | Medium | Org/admin load failures collapse into empty data with no retry | UX/recovery |
| UIX-19 | Low | Super-admin audit/integration links dead-end in creator guard | UX/navigation |
| UIX-20 | Low | Raw enums and ISO date strings appear in user-facing UI | Content/UX |
| UIX-21 | Medium | Required short-text questions would be labelled optional and lack required/error semantics | WCAG 3.3.2/4.1.2 (latent) |
| UIX-22 | Low | “Survey not found” renders two `h1` elements | WCAG 1.3.1 |
| UIX-23 | Medium | Validation renders five concurrent alerts without moving focus | UX/AT heuristic |
| UIX-24 | Low | 404 retains the generic site title; secondary CTA targets an authenticated route | WCAG 2.4.2 / UX |
| UIX-25 | Low | Desktop nav active state is color-only | WCAG 1.4.1 |

### UIX-01 — Grant-based officer cannot open the granted survey (Critical)

**Type:** UX/functional role coverage. Related: `03-role-access.md` BR-01, `02-business-flows.md` BIZ-06.

**Basis:** `README.md:378` documents `officer@svara.local` as a creator who is not owner of `s_demo1` but holds individual/export/free-text grants. `README.md:159-160` says non-owners with a grant can see the survey through the grant. The UI instead filters the visible survey set to owner records and has no grant-scoped list.

**Evidence:**
- `src/screens/CreatorCore.tsx:351` resolves `findSurvey(id)` from the hydrated, visibility-filtered set; `:352` computes `isOwner`; `:401` returns `MissingSurvey` when not owner.
- `src/screens/CreatorCore.tsx:61` and `:230` use `serverRole === 'creator' && owner_id === session.id` as the manage predicate.
- Runtime: officer `/creator` → “Belum memiliki survei”; direct `/creator/surveys/s_demo1/results` → “Survei tidak ditemukan”; `GET /api/v1/surveys/s_demo1/summary` → `200`.
- Screenshots: `officer-creator-list-404.png`, `new-creator-survey-404.png`.

**Repro:**
1. Sign in as the grant officer.
2. Observe `/creator`.
3. Open `/creator/surveys/s_demo1/results` directly.
4. In the same session, fetch the summary endpoint.

**Runtime evidence:** console errors `[]` on both pages; network bootstrap `200`; summary `200`. There is no security denial to explain the UI outcome; the data is simply absent from the client’s survey store.

**Impact:** the documented reviewer/grantee actor cannot use the product at all for the granted survey. This makes the “grant-based officer” coverage claim false and prevents the only non-owner read role from validating the UI.

**Fix direction:** add a grant-scoped survey surface (or include granted surveys in the creator list with capability flags); stop deriving visibility from ownership alone.

### UIX-02 — Admin bootstrap/stats failure renders guest nav and false fixture KPIs (High)

**Type:** UX/state integrity. Not a WCAG failure.

**Evidence:**
- `src/screens/Admin.tsx:40-43` reads the admin-screen state and starts `adminStats()`, setting stats to `null` on failure.
- `src/screens/Admin.tsx:64` renders responses as `stats?.responses ?? 0`; `:74` renders pending requests as `stats?.pendingRequests ?? 0`; `:69` falls back to `accounts.length`.
- Admin pages have no equivalent of `CreatorBootGate`; `src/components/Shell.tsx:288` derives navigation from the current session, so a failed bootstrap produces guest navigation while the admin page still renders.
- Runtime with bootstrap + stats aborted: header shows “Masuk”, KPIs show `4` surveys, `0` responses, `5` accounts, `0` pending requests; no error banner or retry. Normal values at the same seed are `4` surveys, `7` responses, `7` accounts, `1` pending request.
- Screenshots: `admin-bootstrap-failure-fixtures.png`, `admin-bootstrap-stats-failure.png`.

**Repro:** sign in as super admin; abort `**/api/v1/bootstrap` and `**/api/v1/admin/stats`; reload `/admin`.

**Runtime evidence:** requests aborted by the test harness; no error UI and no retry. The page does not distinguish “zero” from “unknown”.

**Impact:** during a transient outage an operator sees a logged-out header and plausible but false operational numbers, including “0 permintaan data menunggu”. That can hide a pending privacy request and undermines trust in the dashboard more than a visible error would.

**Fix direction:** gate admin routes on bootstrap like creator routes; preserve a distinct error state; never coerce unknown counts to zero.

### UIX-03 — UI capability checks contradict API for owner and org-admin reads/manage (High)

**Type:** UX/functional authorization presentation. Related: `03-role-access.md` BR-02/BR-03, `02-business-flows.md` BF-07.

**Basis:** the server grants survey managers (owner and same-org org admin) full aggregate/individual/export/free-text reads, and permits org admins to manage org surveys (`README.md:162,171-172,378`; `server/http.ts:169-184`; role matrix in `03-role-access.md`). The UI reconstructs authorization from ownership plus grants and drops manager capability.

| Actor / surface | UI behavior | Server policy | Evidence |
| --- | --- | --- | --- |
| Owner, individual responses | “Izin baca individual diperlukan”; button disabled | `GET /responses` → `200` | `CreatorData.tsx:340-341,480,484-486`; runtime owner responses API `200` |
| Owner, CSV export | Enabled | Allowed | `CreatorData.tsx:340,547` |
| Org admin, individual/export | Denied; no export path | Manager read/export allowed | `CreatorData.tsx:340-341,540-547,570`; org-admin summary API `200` |
| Org admin, editor/share/settings | Only “Lihat hasil” in list; direct edit → “Survei tidak ditemukan” | Manage allowed | `CreatorCore.tsx:61,230,242-243,401`; screenshot `orgadmin-edit-denied.png` |

**Evidence:**
- `src/screens/CreatorData.tsx:340` sets `exportAllowed = isOwner || grant.export`; `:341` sets `individualAllowed` only from a grant plus `allowIndividual`.
- `src/screens/CreatorCore.tsx:61` sets `canManage` only for role `creator` and owner; the list at `:230-243` hides edit/duplicate for org admins.
- Runtime owner results: banner “Izin baca individual diperlukan”, disabled individual button, enabled CSV; `GET /api/v1/surveys/s_demo1/responses?version=v_demo1_1` → `200`.
- Runtime org admin: `/creator` shows org survey but only “Lihat hasil”; `/creator/surveys/s_demo1/edit` → “Survei tidak ditemukan”; summary API `200`.
- Screenshots: `results-owner-desktop-1440.png`, `orgadmin-lands-creator-1440.png`, `orgadmin-edit-denied.png`.

**Repro (owner):** sign in as `creator.a`; open `s_demo1` results; compare the individual button with a direct responses request.
**Repro (org admin):** sign in as `orgadmin`; open `/creator`; then open the edit URL for `s_demo1`.

**Runtime evidence:** no console errors; the relevant API calls return `200`. This is a client-side capability-model defect, not a server denial.

**Impact:** owners cannot inspect the individual answers they are entitled to; org admins cannot manage or export org surveys despite being told they can. The result is a product that is read-only where it should be writable and partially blind where it should be fully readable.

**Fix direction:** use server-provided effective capabilities per survey (manage/read aggregate/read individual/export/free text) as the single UI source of truth, including org-admin manager status.

### UIX-04 — Guardian verification is self-attested and shown as verified (High)

**Type:** Privacy/consent UX. Related: `02-business-flows.md` BF-03, `05-security-vulnerabilities.md` SEC-04.

**Evidence:**
- `src/screens/Respondent.tsx:319-325` presents a checkbox labelled “Bukti wali telah diverifikasi.” plus a free-text “Referensi bukti persetujuan wali”.
- `src/screens/Respondent.tsx:81` turns any nonempty reference into `guardian_evidence_status: 'verified'` client-side; `:764` displays “Terverifikasi” on review when that status is present.
- Server confirmation: `server/routes/public.ts:451-456` only checks the reference is nonempty, then writes `guardianStatus = 'verified'`; no verifier, record, expiry, or revocation exists.
- Runtime guardian flow completed and review displayed “Terverifikasi”; screenshots `respondent-intro-desktop-1440.png`, `respondent-review-desktop.png`.

**Repro:** open the guardian-mode public link, check the guardian box, enter any string such as `x`, continue to review.

**Runtime evidence:** UI completes the path; no validation error or console error is raised. The browser presents a verified state that the user created by typing a string.

**Impact:** a core child-protection control is cosmetic and the UI actively tells the respondent it is verified. This is a legal/ethical exposure and a misleading consent record, not merely a copy defect.

**Fix direction:** require a server-verified guardian evidence record (verifier, method, timestamp, expiry, revocation) before consent/submission; never label free text as verified. If no verification integration exists, disable guardian mode rather than presenting a false attestation.

### UIX-05 — Publish page loses its only direct share control after reload (Medium)

**Type:** UX/state.

**Evidence:**
- `src/screens/CreatorCore.tsx:873` stores the published token only in component state.
- `:984-985` renders “Kelola tautan” as an `ActionLink` disabled when `!publishedToken`; a disabled `ActionLink` is a non-focusable `span` (`ui.tsx` disabled path), not a link.
- After reload on the publish page, the control is `span[aria-disabled=true]` with no `href` and no `tabindex`; the primary button still says “Terbitkan versi” if a draft exists.
- Screenshot: `publish-share-dead-control.png`.

**Repro:** sign in as owner; open a survey’s publish page; reload; inspect the “Kelola tautan” control.

**Runtime evidence:** DOM shows a disabled `span`, not a link; console has no errors. The separate “Bagikan” tab remains a workaround, which is why this is Medium rather than blocking.

**Impact:** the success path tells the creator to manage the link, then removes the control on the next visit. A creator may re-publish a version to recover the state, creating an unintended new version.

**Fix direction:** load the existing public link from bootstrap/shared data and keep the share action available whenever a published version exists; do not tie it to in-memory publish response state.

### UIX-06 — Receipt recovery dead-ends after storage loss (Medium)

**Type:** UX/recovery. Related: `02-business-flows.md` BF-08.

**Evidence:**
- `src/screens/Respondent.tsx:53-54` stores receipt data and key only in `sessionStorage`; `:823-835` uses them for retry.
- When both are absent, `:886-889` says “Bukti tidak ditemukan di perangkat ini… hubungi pengelola dengan ID bukti”, but the retry button at `:902-903` is disabled when `!receipt`, and there is no field to enter a response ID or key.
- The only adjacent actions are “Kembali ke pengantar” and static links; no contact channel is rendered.
- Screenshot: `respondent-receipt-lost-storage.png`.

**Repro:** complete a response; clear `sessionStorage`; reload the receipt URL.

**Runtime evidence:** header says “Belum ada bukti”, “Pulihkan bukti” is disabled, and no input exists; no console/network error.

**Impact:** a respondent who needs proof of submission after a tab/browser restart cannot recover it through the UI, even though the server exposes an idempotent recovery endpoint. The copy tells them to use an ID but provides no way to submit it.

**Fix direction:** provide a recovery form for response ID plus key (or a signed receipt URL), and render a real controller contact path.

### UIX-07 — Public survey load failure offers no retry (Medium)

**Type:** UX/recovery.

**Evidence:**
- `src/screens/Respondent.tsx:165-176` renders “Tautan gagal dimuat” with the raw error message and only “Kembali ke beranda”.
- No retry button or automatic revalidation is present; the page does not distinguish a transient network failure from a dead link beyond the message.
- Runtime with the public survey request aborted: the error card rendered; console errors `[]`; network request aborted by the harness.
- Screenshot: `respondent-load-error-no-retry.png`.

**Repro:** block `**/api/v1/public/surveys/**`, open a valid public survey URL.

**Runtime evidence:** UI is stable, no JavaScript exception; the only recovery is manual browser reload/home navigation.

**Impact:** a respondent on a flaky mobile connection loses the session path and may abandon the survey. This is especially costly because public respondents have no account or dashboard.

**Fix direction:** add “Coba lagi” that re-fetches the current token, and only route home for definitive 404/410 states.

### UIX-08 — Privacy contact chain ends at a placeholder (Medium)

**Type:** Content/privacy UX. Related: `02-business-flows.md` BF-10.

**Evidence:**
- `/privacy` says “Kontak permintaan data tersedia pada pemberitahuan tiap survei” (`src/screens/Public.tsx:179`).
- The notice renders `notice.contact` verbatim (`src/screens/Respondent.tsx:279`); in the audit seed that value is the string “Lihat pemberitahuan survei” (`server/seed-data.ts:144`) — self-referential and not a contact channel.
- The public privacy page offers a data-request form with a “Kontak terverifikasi” field, but no controller email/phone or link to the notice for the current survey.
- Screenshots: `privacy-desktop-1440.png`, `respondent-intro-desktop-1440.png`.

**Repro:** open `/privacy`; follow the instruction to the notice on the demo survey.

**Runtime evidence:** no console/network errors; the dead end is content-driven.

**Impact:** a respondent cannot exercise access/correction/withdrawal rights using the channel the policy names. This is a privacy-rights dead end, not just an empty field.

**Fix direction:** populate a real controller contact in seed/organization profile, validate it, and render it as a `mailto:`/`tel:` link with a fallback route to the data-request form.

### UIX-09 — Public landing shows an empty demo table under “Terbit” (Medium)

**Type:** UX/public trust.

**Evidence:**
- `src/screens/Landing.tsx:81` derives demo rows from `versionsFor('s_demo1')`; `:137` renders a success badge “Terbit”; `:142-156` maps versions but has no empty branch and prints `questionsFor(...).length` as “0 item pada versi aktif”.
- Anonymous bootstrap returns `surveys: []`, `versions: []`, `questions: []` (`server/bootstrap.ts:206-228`), and the store replaces fixtures with those arrays (`src/lib/store.ts:154-172`). The landing still renders the table shell and “Terbit”.
- Runtime anonymous: 0 table rows, badge “Terbit”, text “0 item pada versi aktif”; console errors `[]`.
- Screenshot: `landing-desktop-1440.png`.

**Repro:** use a fresh anonymous session, open `/`, wait for bootstrap.

**Impact:** the public homepage presents a broken demo to prospects and respondents. The contradiction (“Terbit” with zero items) undermines trust in the product’s core claim.

**Fix direction:** hide the demo table until demo data exists, or serve a curated public demo payload; do not render a published badge for an empty dataset.

### UIX-10 — Admin header overflows at 640–768px, clipping “Keluar” (Medium)

**Type:** Responsive UX. Not a 1.4.10 failure at the measured widths, because 1.4.10 targets 320px reflow; the tablet breakpoint is still visibly broken.

**Evidence:**
- `src/components/Shell.tsx:117` uses `w-[calc(100%-3.5rem)] sm:w-fit`; `:135` shows the desktop nav at `sm` (640px). The full admin nav plus “Keluar” does not fit.
- Runtime: at 640px `document.scrollWidth=722` (client 640), “Keluar” clipped; at 768px `scrollWidth=788` (client 768).
- Screenshot: `admin-header-640-overflow.png`.

**Repro:** sign in as super admin; set viewport to 640×900.

**Runtime evidence:** no console errors; horizontal overflow is observable in the header and page.

**Impact:** the sign-out control is partially off-screen and the page scrolls horizontally on common tablet widths. The mobile menu does not take over until below 640px, leaving a broken middle band.

**Fix direction:** switch to the compact menu below `lg`, allow the nav to wrap, or reduce gaps/widths; test 640–1024 explicitly.

### UIX-11 — Register page has no heading (zero `h1`) (Medium)

**Type:** WCAG 1.3.1 Info and Relationships (A).

**Evidence:**
- `src/screens/Register.tsx:66` uses `<Shell kind="public" title="Buat akun" chromeless>`.
- `src/components/Shell.tsx:318-325` renders no heading at all in the chromeless branch; the `title` prop is unused there.
- Runtime accessibility scan on `/auth/register`: `h1` count `0`; there is no visible or programmatic page heading.
- Screenshot: `register-desktop-1440.png`, `register-mobile-390.png`.

**Repro:** open `/auth/register`; inspect headings or navigate by heading in a screen-reader/browser outline.

**Runtime evidence:** no console errors; the issue is structural.

**Impact:** screen-reader users get a form with no page-level heading; the document outline starts at the first field. The title is only in the browser tab/metadata.

**Fix direction:** render an `h1` in the chromeless content (“Buat akun”) or give Shell a chromeless heading option/sr-only title. The existing `hideHeading` prop shows the codebase already has the concept.

### UIX-12 — Mobile header home link has no accessible name (Medium)

**Type:** WCAG 2.4.4 Link Purpose (A), 4.1.2 Name/Role/Value (A).

**Evidence:**
- `src/components/Shell.tsx:53-63` renders the wordmark link with `BrandMark` plus `<span className="hidden sm:inline">Svara</span>`.
- `src/components/Brand.tsx:1-9` uses `alt=""` on the logo image.
- At 390px the span is `display:none`; the link has no text alternative. Accessibility snapshot: `link (unnamed)`.
- Screenshot: `admin-header-mobile-390.png`.

**Repro:** open any page at 390px; inspect the top-left home link in the accessibility tree.

**Impact:** screen-reader and voice-control users cannot identify the home link on mobile. The same link is named on desktop, so this is breakpoint-specific.

**Fix direction:** add `aria-label="Svara"` to the link or an `sr-only` “Svara” span; keep the visible wordmark behavior.

### UIX-13 — Closing mobile menu with Escape drops focus to `body` (Medium)

**Type:** WCAG 2.4.3 Focus Order (A) / keyboard UX.

**Evidence:**
- `src/components/Shell.tsx:90-105` handles Escape by only `setMenuOpen(false)`; it does not restore focus to the trigger.
- The trigger is rendered at `:145-153`; the menu at `:199-204` is a plain absolute nav, not a modal with focus management.
- Runtime: focus a menu link, press Escape; `document.activeElement` becomes `BODY`.
- Screenshot: `admin-mobile-menu-open.png`.

**Repro:** at 390px, open the menu with the keyboard, Tab to a link, press Escape.

**Runtime evidence:** focus lands on `BODY`; no console error.

**Impact:** keyboard and screen-reader users lose their place after closing the menu and must traverse from the top again. This is especially disruptive in a long admin workspace.

**Fix direction:** keep a ref to the trigger and focus it on Escape/close; optionally trap focus inside the popover while open.

### UIX-14 — Select/textarea boundaries are 1.37:1 (Medium)

**Type:** WCAG 1.4.11 Non-text Contrast (AA).

**Evidence:**
- The design token `--color-control-border: #8d919c` is 3.15:1 on white and would pass; `--color-n200: #d8dce8` is 1.37:1 on white (`src/app/globals.css:7,11`).
- The base `TextInput`/`TextArea` use the passing token (`src/components/ui.tsx:262,271`), but these controls override it with `border-n200`:
  - privacy data-request select/text area: `src/screens/Public.tsx:242,272`;
  - creator status/scope selects: `src/screens/CreatorCore.tsx:158,170`;
  - results version select: `src/screens/CreatorData.tsx:396`;
  - admin role/org/grants/request selects: `src/screens/Admin.tsx:254,486,500,834`.
- Computed runtime border: `rgb(216, 220, 232)` on white = 1.37:1.

**Repro:** inspect any affected select/textarea on the named screens; compare computed border to background.

**Impact:** low-vision users cannot reliably locate empty form controls, especially on the public data-request and admin forms. The failure is repairable by using the existing `control-border` token.

**Fix direction:** remove the `border-n200` overrides or change them to `border-control-border`; add a token-level test for non-text contrast.

### UIX-15 — Landing step annotations are 2.12:1 (Medium)

**Type:** WCAG 1.4.3 Contrast Minimum (AA).

**Evidence:**
- `src/screens/Landing.tsx:176` renders “01”–“04” and `:228` renders “LANGKAH 1”–“LANGKAH 4” with `text-n400`.
- `--color-n400: #aeb2be` (`src/app/globals.css:12`); computed at runtime as `rgb(174, 178, 190)` on white = **2.12:1**.
- Text is 12px normal/bold mono, below the 18.66px large-text threshold, so 4.5:1 applies.
- Screenshot: `landing-desktop-1440.png`.

**Repro:** inspect the step numbers and labels on `/`.

**Impact:** the sequence labels that explain the workflow are effectively unreadable for low-vision users; the adjacent white text is fine, so the hierarchy looks intentional but fails contrast.

**Fix direction:** use `n600` (5.32:1) or darker for meaningful annotations; reserve `n400` for decorative/large surface accents.

### UIX-16 — 200% text at 320px clips the survey heading (Medium)

**Type:** WCAG 1.4.4 Resize Text (AA).

**Evidence:**
- Survey title is rendered in `src/components/Shell.tsx:356` with `text-h1` (2.375rem fixed; `src/app/globals.css:49-50`); no `overflow-wrap`/`word-break` exists in the shell or global CSS.
- At 320px viewport with root font-size 200%: `document.scrollWidth=475`, heading `scrollWidth=459` vs `clientWidth=288`; the long seed title is clipped at the right edge.
- Screenshot: `respondent-form-320-200pct-text.png`.
- Normal 320px reflow passes on `/`, `/privacy`, `/auth/login` (`scrollWidth=320`).

**Repro:** open the public form at 320px; set browser text size to 200% (or root font-size 200%); observe the heading.

**Runtime evidence:** visual clipping is captured; no console error.

**Impact:** low-vision respondents lose the survey title and part of the context at the required 200% text size.

**Fix direction:** allow heading wrapping (`overflow-wrap:anywhere`, `text-wrap:balance`) and relax the fixed 2.375rem size at narrow/large-text conditions; verify 320px @ 200%.

### UIX-17 — Zero-version results show a blank selector and contradictory export banner (Medium)

**Type:** UX/state.

**Evidence:**
- For a survey with no non-draft version, `src/screens/CreatorData.tsx:292-296` leaves `versionId` empty; `:387-397` renders an empty `<select>` with no placeholder/disabled explanation.
- `:540-547` still renders “Ekspor diizinkan” because the owner passes `exportAllowed`, while both export buttons are disabled by `!summary || summary.total === 0` (`:547`, `:570`).
- No “belum ada versi” empty state is rendered in this branch.
- Runtime `creator.b` → `s_demo3/results`: version options `0`, total `0`, banner “Ekspor diizinkan”, CSV and codebook disabled.
- Screenshot: `results-no-version-desktop.png`.

**Repro:** sign in as `creator.b`; open `s_demo3` results.

**Runtime evidence:** no summary request is made because `versionId` is empty; no console error. The UI looks loaded but explains nothing.

**Impact:** creators see a blank, non-functional results page and a permission banner that contradicts the disabled controls; they cannot tell whether the survey has no published version, no responses, or an error.

**Fix direction:** render an explicit “Belum ada versi terbit” empty state, disable/hide the export card, and explain the required next action (publish a version).

### UIX-18 — Org/admin load failures collapse into empty data with no retry (Medium)

**Type:** UX/recovery/consistency. Related but distinct from UIX-02: this is user-facing empty-state collapse, not KPI fallback.

**Evidence:**
- Org page: `src/screens/Org.tsx:105-119` loads profile/members/invitations/audit via one `Promise.all`; on failure it shows only a toast. The profile card then says “Profil organisasi belum dimuat” (`:328`) while members say “Belum ada anggota” (`:340`) and activity says “Belum ada aktivitas organisasi” (`:414`); there is no retry control, and “Simpan profil” is disabled because `form` is null (`:331`).
- Requests page: `src/screens/Admin.tsx:884-897` sets `rows=[]` and an error banner; the body at `:900-904` then also renders “Belum ada permintaan data.” No retry button exists.
- Screenshots: `orgadmin-org-load-failure.png`, `admin-requests-error-empty.png`.

**Repro:** sign in as org admin with `/api/v1/org/**` aborted, or as super admin with `/api/v1/admin/data-requests` aborted; reload the page.

**Runtime evidence:** network requests aborted by the harness; the UI shows both an error and an empty state. No retry is available in-place.

**Impact:** an outage looks like an empty organization/queue, and the user cannot recover without a full reload. On the org page, “empty members” next to “profile not loaded” is actively misleading.

**Fix direction:** model loading/error/empty as mutually exclusive states; preserve error state and offer “Coba lagi”; do not render empty-list copy when the fetch failed.

### UIX-19 — Super-admin audit/integration links dead-end in creator guard (Low)

**Type:** UX/navigation. Related: `03-role-access.md` BR-04.

**Evidence:**
- `src/screens/Admin.tsx:641` links “Kembali ke hasil” to `/creator/surveys/s_demo1/results`; `:769` links “Lihat ringkasan” to the same creator route.
- Super admin is rejected by the creator guard; runtime click lands on “Akses ditolak” (screenshot `admin-audit-dead-end.png`).
- `README.md:157` says super admin may manage all surveys, but `server/http.ts:108-116` deliberately makes super admin non-manager. The links encode the documentation overclaim.

**Repro:** sign in as super admin; open `/admin/audit`; click “Kembali ke hasil”.

**Runtime evidence:** creator page renders AccessDenied; no console/network error. This is a route-link mismatch.

**Impact:** operators following audit context hit an authorization wall; the navigation suggests a capability that does not exist.

**Fix direction:** remove the creator-route links or route to an admin-readable survey summary that respects the no-answer-read rule; align README with the actual manager model.

### UIX-20 — Raw enums and ISO date strings appear in user-facing UI (Low)

**Type:** Content/UX consistency.

**Evidence:**
- Admin role selector options are raw `creator`, `org_admin`, `admin` (`src/screens/Admin.tsx:256-259`).
- Org members table prints `member.role` raw (`src/screens/Org.tsx:347`).
- Data-request detail prints `request.type` raw (`src/screens/Admin.tsx:816`).
- Receipt prints `receipt.status` raw (`src/screens/Respondent.tsx:873`).
- Creator lists render `updated_at.slice(0, 10)` (`src/screens/CreatorCore.tsx:239`, `CreatorData.tsx:195-196`) and platform shows `updated_at.slice(0, 10)` (`Platform.tsx:213`), mixing Indonesian labels with ISO dates and no WIB time.
- Screenshots: `admin-accounts-desktop-1440.png`, `results-owner-desktop-1440.png`, `respondent-receipt-desktop.png`.

**Repro:** inspect the named tables/selects.

**Runtime evidence:** no console/network involvement; content is directly visible.

**Impact:** inconsistent language and time format reduce scanability and make audit/status interpretation slower. `admin` as a visible role is especially ambiguous because the stored role is `super_admin`.

**Fix direction:** centralize label/date formatters; use Indonesian role/type/status labels and `formatWIB` for timestamps (already present elsewhere).

### UIX-21 — Required short-text questions would be labelled optional and lack required/error semantics (Medium)

**Type:** WCAG 3.3.2 Labels or Instructions (A), 4.1.2 Name/Role/Value (A), 1.3.1. Latent: no seeded required short-text question, so runtime NOT_VERIFIED.

**Evidence:**
- `src/screens/Respondent.tsx:444` renders every short-text field with `hint={q.hint ?? 'Opsional.'}` even when `q.required` is true.
- The `Field` wrapper is not given `required={q.required}`, so `src/components/ui.tsx:240-252` omits the visible `*`, sr-only “(wajib)”, and required semantics.
- The error at `:456` is rendered outside `Field` and is not included in `aria-describedby`/`aria-invalid` for the textarea.
- Runtime coverage cannot trigger this with the current seed because it has no required short-text item; static source is deterministic.

**Repro (after adding/selecting a required short-text question):** open the form; inspect the field’s required state, hint, and error association.

**Impact:** a required short-text item would tell the respondent it is optional and would not expose its required/invalid state to assistive technology. This is a correctness trap for future content, not just styling.

**Fix direction:** pass `required` and `error` through `Field`; derive the hint from required state; associate the error via `aria-describedby` and set `aria-required`/`required`.

### UIX-22 — “Survey not found” renders two `h1` elements (Low)

**Type:** WCAG 1.3.1.

**Evidence:**
- `src/screens/CreatorCore.tsx:47-55` (`MissingSurvey`) renders `<h1>Survei tidak ditemukan</h1>`.
- All denied survey routes wrap it in `Shell` with `title="…"`, which renders another `h1` at `src/components/Shell.tsx:356`.
- Runtime direct denied route: `h1` count = 2.
- Screenshot: `new-creator-survey-404.png`.

**Repro:** open a survey you cannot access (officer/org-admin edit path).

**Impact:** heading navigation shows two equal top-level headings, splitting the page’s structure.

**Fix direction:** use an `h2` inside `MissingSurvey` or use `hideHeading` on the wrapping Shell for error states.

### UIX-23 — Validation renders five concurrent alerts without moving focus (Medium)

**Type:** UX/AT heuristic; not a WCAG failure by itself (errors are identified), but it affects recovery and announcements.

**Evidence:**
- Runtime empty submit on `/auth/register`: five `role="alert"` nodes render simultaneously (“Nama minimal 2 karakter”, “Email wajib diisi”, “Kata sandi wajib diisi”, “Ulangi kata sandi wajib diisi”, “Persetujuan… wajib dicentang”); focus remains on `BUTTON:Buat akun`.
- `src/screens/Register.tsx:213` plus `src/components/ui.tsx` field errors create the alerts; the toast layer adds a nested polite live region (`src/components/Toast.tsx:36-44`).
- No focus transfer to the first invalid field occurs.

**Repro:** open `/auth/register`; press Enter on an empty submit.

**Runtime evidence:** five alerts, active element remains the submit button; no console error.

**Impact:** screen-reader users may hear a burst of five alerts with no context, and keyboard users must Shift+Tab backwards through the form to find the first error. The visual error layout is clear, so this is accessibility/recovery polish, not a content failure.

**Fix direction:** use one summary alert plus field-level descriptions, focus the summary or first invalid field, and avoid nesting alert/status roles inside a live region.

### UIX-24 — 404 retains the generic site title; secondary CTA targets an authenticated route (Low)

**Type:** WCAG 2.4.2 Page Titled (A) / UX.

**Evidence:**
- `src/app/not-found.tsx:3-4` renders `NotFoundPage` with no metadata; the root default title is “Svara · Pembuat Survei” (`src/app/layout.tsx:11-19`), not a 404 title. Runtime title: “Svara · Pembuat Survei”.
- `src/screens/Public.tsx:160-168` offers “Kembali ke beranda” and “Daftar survei”; the latter points to `/creator`, which is authenticated. Static guard behavior sends guests to login, not a public list.
- Screenshot: `404-desktop.png`.

**Repro:** open `/does-not-exist`.

**Runtime evidence:** title inspected in DOM; no console error.

**Impact:** browser tabs/history and screen readers do not identify the error page; the secondary action is not useful for anonymous visitors.

**Fix direction:** export 404 metadata/title (“Halaman tidak ditemukan · Svara”) and swap the secondary CTA for a public destination or conditionally show it only when authenticated.

### UIX-25 — Desktop nav active state is color-only (Low)

**Type:** WCAG 1.4.1 Use of Color (A).

**Evidence:**
- `src/components/Shell.tsx:67-76`: active item uses `text-n0` and inactive uses `text-n400`; no weight, underline, background, or shape change. `aria-current="page"` helps AT but not low-vision/color-perception users.
- Screenshot: `landing-desktop-1440.png`, `creator-list-desktop-1440.png`.

**Repro:** compare active/inactive top-nav items on a desktop page.

**Impact:** active location is hard to perceive without color/luminance discrimination; the workspace sidebar already uses a background pill, so the pattern is inconsistent.

**Fix direction:** add an underline, weight change, or background pill in addition to color.

## 4. WCAG 2.2 AA criterion results (inspected surfaces)

| Criterion | Result | Finding |
| --- | --- | --- |
| 1.3.1 Info and Relationships | FAIL | UIX-11, UIX-22 |
| 1.4.1 Use of Color | FAIL | UIX-25 |
| 1.4.3 Contrast (Minimum) | FAIL | UIX-15 |
| 1.4.4 Resize Text | FAIL | UIX-16 |
| 1.4.10 Reflow | PASS at 320 on `/`, `/privacy`, `/auth/login`; not comprehensively retested | — |
| 1.4.11 Non-text Contrast | FAIL | UIX-14 |
| 2.4.2 Page Titled | FAIL on 404 | UIX-24 |
| 2.4.3 Focus Order | FAIL in mobile-menu close | UIX-13 |
| 2.4.4 Link Purpose | FAIL for mobile home link | UIX-12 |
| 3.3.1 Error Identification | PASS in observed forms (errors are visible/textual) | UIX-23 is announcement/recovery UX |
| 3.3.2 Labels or Instructions | PARTIAL/latent | UIX-21 |
| 4.1.2 Name, Role, Value | FAIL for mobile home link; latent required-field semantics | UIX-12, UIX-21 |
| 4.1.3 Status Messages | RISK (not a confirmed failure) | UIX-23 |

Not assessed as failures: visible focus rings (`:focus-visible` in `globals.css`), target size (primary controls are 44px; table retry control is 32px, above the 24px AA minimum), reduced motion (global `prefers-reduced-motion` rule), table header scoping, and the native `<dialog>` focus trap.

## 5. Checks that passed or were acceptable

- **Keyboard completion:** public consent → form → review → receipt completed with Tab/Shift+Tab, Space, and Enter only; radio groups, checkbox labels, and buttons activated correctly.
- **Form semantics:** login/register/policy/preview use explicit labels, required markers, inline errors, and fieldset/legend for respondent questions. Validation is textual, not color-only.
- **Focus visibility:** global `:focus-visible` 2px action outline is present; primary controls are keyboard reachable.
- **Skip link and main focus:** “Lewati ke konten utama” is present; route changes focus `<main tabIndex="-1">`.
- **Dialog:** version-close uses a native modal `<dialog>` with focus containment; Escape closes it.
- **Loading:** creator pages use `CreatorBootGate` and do not render empty survey data while bootstrap is pending; public pages show a status message and the form remains blocked until context loads.
- **Tables:** header cells use `scope="col"`, row headers `scope="row"`, and horizontal wrappers are keyboard-scrollable with an accessible label.
- **Reduced motion:** `@media (prefers-reduced-motion: reduce)` sets animation/transition durations to near-zero (`src/app/globals.css:178`).
- **Normal 320px reflow:** landing, privacy, and login have `scrollWidth === clientWidth === 320`; the public 320 privacy screenshot is clean.
- **Copy/error clarity:** most server errors are surfaced in Indonesian; permission and validation messages are near the relevant controls.

## 6. NOT_VERIFIED and limits

- **No screen-reader software run.** Accessibility-tree snapshots and DOM semantics were inspected; actual NVDA/JAWS/VoiceOver speech, verbosity, and live-region ordering are **NOT_VERIFIED**. UIX-23 is therefore a heuristic/AT risk, not a confirmed announcement failure.
- **No route error-boundary trigger.** `src/app/error.tsx` was reviewed statically only; focus/announcement behavior after a thrown route error is **NOT_VERIFIED**.
- **Dev-only state matrix not usable in production.** `?state=` handling is gated to non-production, so `loading/empty/permission-denied/success/conflict` screens were inspected where reachable (real data, network failure, denied URLs) rather than through the synthetic matrix.
- **RTL not tested.** The product has no RTL locale in the audit environment; logical properties are used in most places, but physical `pr-4`, `text-left`, and fixed left/right positioning remain in tables and the mobile menu. This is not a claimed failure.
- **Long-string coverage is partial.** The real seed survey title exposed the 200% clipping defect; other arbitrary long labels/translations were not fuzzed.
- **No automated accessibility/contrast scanner.** Ratios were computed from rendered computed styles; no axe/Lighthouse claim is made.
- **No native mobile devices.** 390/320 responsive emulation only.
- **No notifications/SMTP, payment, native app, or background retry surfaces** exist in scope.
- **Guardian/receipt/role findings are UI-verified**, but associated server-side policy defects are owned by `02`, `03`, and `05`; this report does not re-score them.

## 7. Evidence index

Screenshots are under `docs/audit/2026-11-20/evidence/ux/screenshots/`.

| Evidence | Used for |
| --- | --- |
| `landing-desktop-1440.png`, `landing-mobile-390.png`, `landing-mobile-320.png` | Landing data/contrast/nav |
| `login-desktop-1440.png`, `register-desktop-1440.png`, `register-mobile-390.png` | Auth semantics/validation |
| `privacy-desktop-1440.png`, `public-320-privacy.png` | Legal pages/reflow |
| `respondent-intro-desktop-1440.png`, `respondent-invitation-mobile-390.png` | Consent/notice/invitation |
| `respondent-review-desktop.png`, `respondent-receipt-desktop.png`, `respondent-receipt-mobile-390.png` | Guardian display/receipt |
| `respondent-form-320-200pct-text.png` | 200% text failure |
| `respondent-load-error-no-retry.png`, `respondent-receipt-lost-storage.png` | Public recovery dead ends |
| `creator-list-desktop-1440.png`, `editor-mobile-390.png`, `share-desktop-1440.png` | Creator baseline |
| `results-owner-desktop-1440.png`, `results-no-version-desktop.png` | Results permissions/empty state |
| `officer-creator-list-404.png`, `new-creator-survey-404.png` | Grantee denial/double heading |
| `orgadmin-lands-creator-1440.png`, `orgadmin-edit-denied.png` | Org-admin capability gap |
| `publish-share-dead-control.png` | Lost share control |
| `admin-summary-desktop-1440.png`, `admin-summary-tablet-768.png`, `admin-header-640-overflow.png` | Admin baseline/tablet overflow |
| `admin-bootstrap-failure-fixtures.png`, `admin-bootstrap-stats-failure.png` | Admin failure state |
| `admin-accounts-desktop-1440.png` | Raw role labels/controls |
| `admin-audit-dead-end.png`, `admin-requests-error-empty.png` | Admin links/load failure |
| `orgadmin-org-desktop-1440.png`, `orgadmin-org-load-failure.png` | Org admin baseline/failure |
| `admin-header-mobile-390.png`, `admin-mobile-menu-open.png` | Mobile naming/menu focus |
| `404-desktop.png` | 404 surface |
| `runtime-observations.json` | Measured DOM/network/contrast values |
