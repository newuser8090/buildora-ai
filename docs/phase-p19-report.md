# Phase P19 — Production Observability & Operational Resilience: Report

Branch: `phase-p19-production-observability`
Status: **COMPLETE** — P20 NOT started.

---

## 1. Starting baseline

- Working tree clean on `phase-p19-production-observability`, created from merged master
  containing P16 (realtime collaborative editing), P17 (production hardening), P18
  (production readiness & operational reliability).
- P18 final validation: 3926/3926 unit tests; full E2E 116/117 (1 proven pre-existing
  environmental flake); matrix 13/13; fallback 1/1; export-build 1/1.
- P18 fixed the observability gap at *failure boundaries* (logger wired into collab
  connect/checkpoint/auth-loss, presence join rejection, persistence save errors) with
  error codes embedded in messages — but the logger still **dropped all `data` in
  production**, so safe identifiers (workspaceId/projectId) never reached operators.

## 2. Evidence-driven audit (what P19 actually found)

Verified in the repository before any change:

| # | Finding | Evidence |
| --- | --- | --- |
| F1 | **Safe identifiers are dropped from production logs.** P18 passes `{ workspaceId, projectId }` in `data` only; `logger.ts` drops `data` in production — an operator sees `[collab] checkpoint failed (STALE_REVISION)` but cannot answer "which workspace/project" (the charter's core question). | `src/lib/logger.ts` (`if (isDev) ... else console.error(msg)`); P18 call sites verified in `project-controller.ts`, `collab-session.ts`, `supabase-presence-provider.ts`. |
| F2 | **Mock API routes bypass the structured logger** — raw `console.error("[…] unhandled error", err)` in `/api/collab`, `/api/presence`, `/api/workspaces`, `/api/share`. Raw error objects can embed stack traces/internals; inconsistent with the P18 convention. | Verified in all four `src/app/api/**/[[...path]]/route.ts` files. |
| F3 | **Publishing has zero observability.** `PublishService.publish()` has six failure returns (PROVIDER_UNAVAILABLE, PROJECT_INVALID, EXPORT_INVALID, BUILD_FAILED, DEPLOY_FAILED, CANCELLED) — none logged. Failed/cancelled publishes are invisible to operators. | `src/features/publishing/services/publish-service.ts` — zero logger call sites. |
| F4 | **Collab diagnostics lack a tab/session correlation id** — connect → checkpoint → auth-loss events for the same tab cannot be correlated. | `collab-session.ts` diagnostics carry workspaceId/projectId but no clientId. |

Documented as sufficient (no change): retry observability (checkpoint retry bounded ≤2,
offline queue bounded, outcomes already surfaced); health/readiness endpoints (no
server-side worker/queue state to probe — adding endpoints would be speculative
infrastructure, an explicit charter non-goal); full request-ID plumbing (would touch every
fetch/route — minimal evidence-driven step is F1, which already enables cross-layer
correlation by workspace/project/session; full operation-ID threading is a P20 candidate).

## 3. Implemented changes

### F1 — Logger safe-identifier allow-list (`src/lib/logger.ts`)

- Production error lines now append `{key=value}` for a **bounded allow-list** of safe
  keys only: `workspaceId`, `projectId`, `sessionId`, `clientId`, `requestId`,
  `operationId`, `code`, `errorName`. Everything else in `data` stays dev-only.
- Value bounds: 128-char cap; string/number(finite)/boolean primitives only; nested
  objects, arrays, and Errors are never serialized.
- **Log-injection hardening:** ALL control characters neutralized — C0 (`\u0000-\u001f`),
  DEL (`\u007f`), and C1 (`\u0080-\u009f`, incl. NEL `\u0085` which some log consumers
  treat as a line break) — replaced with `?`, so a value can never break the log line or
  forge a second log entry.
- Dev behavior unchanged (full `data` logged in development); `info`/`warn` remain
  dev-only.
- This one change upgrades **every existing P18 call site at once** — `{ projectId }`,
  `{ workspaceId, projectId }` payloads now survive production redaction.

### F2 — Mock API routes use the structured logger (4 routes)

- `/api/collab`, `/api/presence`, `/api/workspaces`, `/api/share` `errorResponse`
  helpers now log through `logger.error("api", "… unhandled error (UNKNOWN)", { code,
  errorName })` — bounded message + error class token (`err.constructor.name` /
  `typeof`), **never** the raw error object.
- `errorName` is allow-listed (F1) so the error-class detail survives production
  redaction; it is derived from a JS identifier / fixed typeof string, hence bounded and
  non-sensitive.
- HTTP response shapes/status codes are unchanged (domain errors still return their
  JSON; only the unhandled-path log call changed).

### F3 — Publish failure diagnostics (`publish-service.ts`)

- Centralized a `fail(code, message)` helper that logs `logger.error("publish",
  "publish failed (CODE)", { projectId })` before returning the same structured failure.
- `logger.error` also on deployment failure and unexpected-exception paths. Provider
  messages are **never** logged verbatim.
- Verified behavior-neutral: returned result objects/shapes unchanged.

### F4 — Collab diagnostics carry `clientId` (`collab-session.ts`)

- Collab failure diagnostics (connect failure, checkpoint failure, auth-loss, transport
  auth error, checkpoint-retry refetch failure) now include `clientId`, enabling
  per-tab event correlation.

## 4. Regression tests added/updated

- `src/lib/__tests__/logger.test.ts` (new, **11 tests**): production redaction keeps
  only allow-listed keys and drops tokens/emails/content/prompts/stack traces; 128-char
  truncation; non-primitives never flattened; empty-context suffix; string data payloads
  tolerated; C0/C1 control-character neutralization (fake log line can never become a
  second `console.error`); C1 (NEL) coverage; finite-number/boolean scalars under
  allow-listed keys; dev full-data behavior; dev-only info/warn; production silence.
- `src/features/publishing/__tests__/publish-service.test.ts` (+1): asserts the logger
  records the bounded code + projectId at failure boundaries and never the raw provider
  message.
- `src/features/collaboration/__tests__/collab-session-connect.test.ts` (updated):
  diagnostics assertions now expect `clientId` (robust `calls.some()` matching).
- **Pre-existing flake fixed:** `src/features/my-blocks/__tests__/my-block-file.test.ts`
  "is deterministic across two builds" compared byte-identical JSON including the LIVE
  `exportedAt` timestamp (ms resolution) — a genuine test-design race (two builds
  straddling a millisecond boundary differ by 1ms; observed once in the full suite:
  `.873Z` vs `.872Z`). Corrected the assertion to compare deterministic content +
  ordering while asserting `exportedAt` is present and valid on both builds — the
  documented contract ("same library always exports the same file") is about content,
  not the export moment. Stable 30/30 across 5 consecutive runs. Source untouched
  (my-blocks is not P19-scoped).

## 5. Security review (final)

Review of the complete P19 diff (allow-list serialization, mock-route logger swap,
publish diagnostics, collab clientId). Findings and dispositions:

1. **C1 control chars escaped sanitization** (genuine, low) — initial regex covered only
   `\u0000-\u001f\u007f`; NEL `\u0085` and other C1 controls (`\u0080-\u009f`) could be
   treated as line breaks by some log consumers. **Fixed:** regex extended to
   `[\u0000-\u001f\u007f-\u009f]`, with a dedicated C1 regression test.
2. **`errorName` dropped in production** (genuine inconsistency discovered during
   review) — the four routes passed `errorName` in `data`, but it was not allow-listed,
   so the exact error-class detail the review asked to restore was silently redacted.
   **Fixed:** `errorName` added to `PROD_SAFE_KEYS` (bounded constructor-name/typeof
   token, same contract as `code`), with test coverage.
3. **Numeric/boolean primitive branch untested** (minor) — **Fixed:** new test asserts
   finite numbers and booleans serialize under allow-listed keys, non-finite (Infinity/
   NaN) never serialize, and non-allow-listed keys are dropped even as scalars.
4. **Message channel not sanitized** (defense-in-depth, no current exploit) — the
   `message` string is logged verbatim; all current call sites use static templates with
   bounded codes (P18/P19 convention). Documented as call-site discipline; a structural
   message sanitizer was deliberately not added (would alter dev behavior and is not
   needed by any current call site).
5. **CANCELLED logged at error level** — user-initiated cancel is logged at `error`
   (documented decision in the architecture doc §3 F3; there is no metrics platform, so
   no error-rate distortion). Accepted as designed.

Non-findings (verified): allow-list is module-constant (cannot be widened by caller data
shapes); values bounded and sanitized; no token/secret/content/prompt/email/stack-trace
can enter production logs; no raw provider messages logged; no RLS/authz/persistence/
collaboration behavior changed; log volume bounded to error paths (never hot paths like
collab polls or keystroke saves); runtime-audit E2E interaction unchanged (regex-based
benign matching tolerates the appended safe-context suffix; the new `[api]` messages fire
only on unhandled exceptions — the same trigger set as the previous raw `console.error`).

## 6. Validation (final, exact)

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | PASS |
| `npm run lint` | PASS |
| `npm test` (full unit suite) | **3940/3940 passed** (77.9s) |
| `npm run build` | PASS |
| Affected P19 E2E batch (11 specs) | **11/11 passed** (2.7m) |
| `npm run test:e2e` (full suite) | **116 passed / 1 failed** (13.0m) |
| `npm run test:e2e:matrix` | **13/13 passed** (1.4m) |
| `npm run test:e2e:fallback` | **1/1 passed** (7.4s) |
| `npm run test:export-build` | **1/1 passed** (58.3s) |
| Final security review | PASS (findings above fixed + regression-tested) |
| Final focused code review | PASS (2 review passes; findings above) |

### Full-suite failure classification (evidence)

The single `test:e2e` failure: `e2e/block-browser.spec.ts:103` "unknown search terms show
a friendly empty state" — the failure is in the shared helper
`e2e/helpers/projects.ts:70` (`createSaaSProjectAndOpenEditor`): the "Welcome to
Buildora" heading was not visible within 10s (project-load/hydration timing in
full-suite context). Evidence it is **pre-existing/environmental, not a P19 regression**:

- The failing path executes **zero P19 code** (block-browser UI + shared project helper;
  no collab/presence/share/publish API calls; P19 changes are logger error-branch wiring
  + allow-list serialization + collab clientId — none on this path).
- **Passes alone: 7/7** (20.1s).
- Identical flake class documented in P16 §13 and proven in P18 via stash A/B (random
  specs — ai-copilot:30, my-blocks, my-blocks-visual-library, realtime-structure —
  failing in full-suite context on hydration/timing, passing alone, uncorrelated with
  the diff).
- P19 also hit the **known realtime-undo pairing flake** once in the intermediate
  affected-batch run (passed alone 10.7s, passed 11/11 in the final batch run) — same
  documented class.

## 7. Known limitations & operational assumptions

- **No request/operation-ID plumbing** — cross-layer correlation is by
  workspace/project/session/clientId (which now survive production logs); a single
  UI-initiated operation cannot yet be traced end-to-end as one ID. Deferred (P20
  candidate).
- **Message content is call-site discipline** — messages are static templates with
  bounded codes; no structural enforcement that future call sites never embed
  provider-derived strings. Documented; revisit if a call site ever needs it.
- **Log volume** is error-path only; there is no metrics aggregation, so per-subsystem
  error rates require external log tooling (deferred — no monitoring platform decision
  has been made).
- **Mock-route diagnostics fire only in dev/E2E** (routes are disabled in production
  builds) — production diagnosis relies on the Supabase path services
  (collab-session, presence provider, project-controller), all covered by F1/F4.
- **CANCELLED publish logs at error** — intentional (documented), no metric distortion
  in the absence of a metrics platform.

## 8. Deferred work

- Full operation/request-ID correlation across UI → API → persistence/collaboration.
- External structured-log sink / metrics aggregation once a monitoring platform is
  chosen.
- E2E cold-compile/hydration flake hardening (infrastructure, not product).

## 9. P20 candidates (NOT started)

- **Operation/request-ID correlation** (design in `docs/phase-p19-architecture.md`
  §13): a safe `operationId`/`requestId` threaded through client mutation paths into
  diagnostics, using the existing allow-list keys — no new infrastructure.
- **Structured log drain** once a monitoring platform decision is made.
- **E2E infrastructure hardening** for the documented cold-compile flake class.
- **Health/readiness endpoint** only if the app ever gains server-side worker/queue
  state worth probing.

## 10. Git state

- Branch: `phase-p19-production-observability`.
- Working tree contains only the intended P19 changes: 9 modified files (4 mock routes,
  logger, publish-service, collab-session, 3 test files incl. the my-blocks test fix)
  + 2 new files (`src/lib/__tests__/logger.test.ts`, `docs/phase-p19-architecture.md`).
- Nothing committed or pushed (per project workflow; awaiting instruction).
- **P20 NOT started.** Phase P19 complete.
