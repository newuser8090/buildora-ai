# Phase P19 — Production Observability & Operational Resilience: Architecture

Branch: `phase-p19-production-observability`
Status: **PLANNING COMPLETE — implementation follows**

---

## 1. Objective

P19 makes Buildora AI **diagnosable** in production with the existing lightweight
primitives. An operator must be able to answer: what happened, when, which
operation/subsystem, which workspace/project/session, was the failure
transient/permanent, did the system retry, was data persisted, was the user
authorized — and correlate events across frontend, API, persistence, and
collaboration layers.

**Non-goal:** external monitoring SaaS, metrics dashboards, or new infrastructure
the repository does not already need. The charter explicitly forbids speculative
infrastructure; P19 uses the existing `logger` and bounded, safe identifiers only.

---

## 2. Current observability architecture (verified in repository)

- **`src/lib/logger.ts`** — the only logging primitive. `logger.info|warn|error(tag, message, data?)`.
  - `error`: always logged; `data` shown in **development**, **dropped in production**.
  - `info`/`warn`: **development only** (silent in production).
- **P18 wired `logger.error`** into failure boundaries with codes embedded in the
  message (which survives production redaction) and safe identifiers in `data`:
  - `collab-session.ts` — room connect failure, checkpoint failure, auth loss
    while editing, transport auth error, checkpoint-retry refetch failure.
  - `supabase-presence-provider.ts` — presence join-gate rejection.
  - `project-controller.ts` — save failure, save throw, transition blocked,
    autosave failure.
- **`src/features/perf/perf-instrumentation.ts`** — transient in-memory bounded
  ring; never persisted or sent. Perf-only, not used for failure diagnostics.
- **`src/app/api/generate/route.ts`** — already uses `logger.info/warn/error`
  with the `"API"` tag (Gemini providers too).
- **Mock API routes** (`/api/collab`, `/api/presence`, `/api/workspaces`,
  `/api/share`) — use **raw `console.error("[tag] unhandled error", err)`**
  bypassing the structured logger.
- **`PublishService`** — **zero logging**; every failure boundary returns a
  structured result to the UI store only.
- **No request/operation correlation IDs exist anywhere** (verified: 0 matches
  for requestId/operationId/correlationId/traceId in `src`).
- **No health/readiness endpoints.**

---

## 3. Evidence-based gaps and risk classification

### F1 — Safe identifiers are dropped from production logs (HIGH value)

**Evidence:** `logger.ts` drops `data` in production; P18 call sites pass
`{ workspaceId, projectId }` (and collab passes no clientId) **only in `data`**.
An operator in production sees `[collab] checkpoint failed (STALE_REVISION)` but
**cannot answer "which workspace/project was affected"** — the exact P19 charter
question. P18 solved code survival by embedding codes in the message; identifiers
were left behind.

**Risk:** production incidents are unattributable to a workspace/project/session.
**Fix:** extend the logger so a **bounded allow-list of safe identifier keys**
(`workspaceId`, `projectId`, `sessionId`, `clientId`, `requestId`, `operationId`,
`code`, plus the bounded error-class token `errorName`) is serialized into the
production error line, while **everything else in `data` remains dev-only**.
Values bounded (length cap); only primitives. This one change upgrades every
existing P18 call site at once.

### F2 — Mock API routes bypass the structured logger (LOW-MEDIUM)

**Evidence:** four mock routes log raw `err` via `console.error("[…-mock]
unhandled error", err)` — raw error objects can embed stack traces / internals,
and the pattern is inconsistent with the P18 convention.

**Risk:** raw-error-object logging and inconsistent diagnostics on the E2E/dev
backend.
**Fix:** route through `logger.error` with bounded safe context only; never log
the raw error object.

### F3 — Publishing has zero observability (MEDIUM)

**Evidence:** `PublishService.publish()` has six failure returns
(PROVIDER_UNAVAILABLE, PROJECT_INVALID, EXPORT_INVALID, BUILD_FAILED,
provider DEPLOY_FAILED, CANCELLED) — none logged. The charter lists publishing
observability explicitly.

**Risk:** failed/cancelled publishes are invisible to operators; only the UI
store's transient `lastResult` knows.
**Fix:** log each failure boundary with `logger.error("publish", "publish failed
(CODE)", { projectId })` — safe identifier + bounded code. **Never** the error
message from the provider verbatim (it may embed internals).

### F4 — Collab diagnostics lack a session/tab correlation id (LOW-MEDIUM)

**Evidence:** collab diagnostics carry `workspaceId`/`projectId` but not
`clientId`, so events from the same tab (connect → checkpoint → auth-loss)
cannot be correlated.

**Fix:** include `clientId` (safe identifier) in collab diagnostics.

### Documented-as-sufficient (no change)

- **Retry observability** — the checkpoint STALE_REVISION path is bounded (≤2
  attempts) and already logs the refetch failure; the offline queue is bounded
  (count + bytes) and failures are surfaced via status/auth-loss. Documenting
  instead of adding per-attempt log noise.
- **Health/readiness endpoints** — not needed: the app has no server-side
  worker/queue state to probe beyond the platform's liveness; API routes are
  dev/mock-only backends. Adding endpoints would be speculative infrastructure
  (explicit charter non-goal).
- **Full request-ID threading (UI → API → persistence)** — no correlation IDs
  exist; building one would touch every fetch call and route. The minimal,
  evidence-driven step is F1 (safe identifiers survive production), which already
  enables cross-layer correlation by workspace/project/session. Full
  operation-ID plumbing is a **P20 candidate**.

---

## 4. Proposed P19 architecture

| # | Change | File(s) | Behavior |
| --- | --- | --- | --- |
| F1 | Logger safe-identifier allow-list | `src/lib/logger.ts` + new `src/lib/__tests__/logger.test.ts` | Production error lines append `{key=value}` for allow-listed safe keys only; dev unchanged; everything else in `data` still dev-only; values bounded |
| F2 | Mock API routes use the structured logger | `src/app/api/{collab,presence,workspaces,share}/[[...path]]/route.ts` | `logger.error("api", "… unhandled error (UNKNOWN)")` with bounded safe context; never raw `err` |
| F3 | Publish failure diagnostics | `src/features/publishing/services/publish-service.ts` + `publish-service.test.ts` regression | `logger.error("publish", "publish failed (CODE)", { projectId })` at every failure boundary |
| F4 | Collab diagnostics carry clientId | `src/features/collaboration/services/collab-session.ts` (+ existing collab tests updated) | `{ workspaceId, projectId, clientId }` on collab diagnostics |

## 5. Logging / event taxonomy

Tags (unchanged convention): `collab`, `presence`, `persist`, `api`, `publish`,
`GeminiProvider`, `GeminiPlanProvider`, `GeminiInlineProvider`, `API`.

Event categories represented by existing codes:
- **authorization rejection** — `PERMISSION_DENIED`, `SESSION_EXPIRED`, `LEASE_INVALID`, `AUTH_REQUIRED`
- **persistence failure** — `save failed`, `save threw`, `transition blocked`, `autosave failed`
- **collaboration disconnect/reconnect** — `room connect failed`, `checkpoint failed`, `transport authorization error`
- **publish/export failure** — `PROVIDER_UNAVAILABLE`, `PROJECT_INVALID`, `EXPORT_INVALID`, `BUILD_FAILED`, `DEPLOY_FAILED`, `CANCELLED`

## 6. Correlation strategy

- **Stable safe identifiers** (`workspaceId`, `projectId`, `sessionId`,
  `clientId`) are the correlation keys, now surviving production logs (F1).
- A single incident (e.g., a member removed while editing) produces a correlated
  chain: presence join-gate rejection → collab auth-loss → checkpoint failure,
  all carrying the same workspace/project and (F4) the same clientId.
- No new ID plumbing in P19; full request/operation IDs remain a P20 candidate
  with a concrete design proposed there.

## 7. Privacy / security considerations

- **Allow-list only.** Production serializes a fixed set of identifier keys
  (`workspaceId`, `projectId`, `sessionId`, `clientId`, `requestId`, `operationId`,
  `code`, `errorName`) and nothing else. `data` beyond those keys is still dropped
  in production.
- **Value bounds.** String values capped (128 chars); only string/number/boolean
  primitives; nested objects/arrays/Errors never serialized.
- **No user content** — prompts, project content, emails, tokens, raw provider
  messages are never part of any diagnostic (existing P18 rule, preserved).
- **No stack traces** in production logs; mock routes stop logging raw `err`.
- **No DoS through logging** — bounded keys, bounded values, error-path only
  (never hot paths like collab polls or keystroke saves).

## 8. Retry / recovery semantics

Unchanged by P19 (correct already): checkpoint retry bounded to ≤2 attempts with
single-flight; offline queue bounded by count+bytes; auth loss is never retried.
P19 only makes the outcomes observable (F1/F4 diagnostics).

## 9. Metrics / health-check strategy

**Explicitly none added.** Perf ring is already transient/bounded; health
endpoints are not justified (§3). Documented as a deliberate decision.

## 10. Testing strategy

- **F1:** `src/lib/__tests__/logger.test.ts` — production redaction keeps only
  allow-listed keys, truncates long values, drops non-primitives, dev still shows
  full data, `info/warn` dev-only behavior unchanged, and control characters in
  values are neutralized so a value can never inject a forged log line.
- **F2:** covered by the existing mock-route E2E runtime audit (routes must stay
  green); the change is a log-call swap with no response-shape change.
- **F3:** regression in `publish-service.test.ts` — assert the logger records the
  bounded code + projectId on each failure boundary (fake provider/storage).
- **F4:** update existing collab-session-connect.test.ts assertions to expect
  `clientId` in diagnostics (robust `calls.some()` matching).

## 11. Rollout considerations

- All changes are additive (log lines) or internal (logger serialization); no
  API response shapes, persistence, RLS, or collaboration behavior changes.
- Dev behavior of the logger is unchanged; E2E runtime audit unaffected (the
  audit matches message prefixes, not the appended safe-context suffix).
- Rollout = normal commit; no feature flags required.

## 12. Explicit non-goals

- No external observability SaaS / metrics platform.
- No health/readiness endpoints.
- No request/operation-ID plumbing (P20 candidate).
- No per-attempt retry logs beyond the existing bounded ones.
- No change to P16/P17/P18 architecture, RLS, authz, persistence, or collab.

## 13. P20 candidates (NOT started)

- Operation/request-ID correlation across UI → API → persistence/collaboration.
- External structured-log sink (log drain) once a monitoring platform decision is made.
- E2E cold-compile flake hardening (infrastructure, not product).
