# Phase P21 — Post-Release Hardening & Operational Resilience

**Branch:** `phase-p21-post-release-hardening`
**Status:** ✅ **POST-RELEASE HARDENING COMPLETE**

---

## 1. Executive summary

P21 is the first post-release hardening phase. The P20 release gates were
confirmed intact, then the operational surfaces were audited with an
evidence-driven eye for genuine production-incident risks — not speculative
features, not redesigns, not refactors for style.

The audit found **no P0 (release-blocking) findings** and **no new P1
(serious production-incident) findings** beyond what P16–P20 already fixed.
Five genuine P2 operational weaknesses were found and fixed with full
regression coverage. Everything else was classified and documented.

All release gates remain green:

- `tsc --noEmit` — clean
- `npm run lint` — clean
- Unit suite — **3983/3983 passed** (+23 new P21 regression tests)
- `npm run build` — clean
- E2E affected batch — **44/44 passed**
- E2E matrix — **13/13 passed**
- E2E fallback — **1/1 passed**
- E2E export-build — **1/1 passed**
- Full remaining E2E suite — **87/87 passed**
- Security review — passed
- Code review — passed

## 2. P20 baseline

Verified in the repository (not merely from reports):

- `/api/generate` production rate limiter present and enforced in
  `NODE_ENV=production` only (60/min/client fixed window, per-client keys
  derived from the first `X-Forwarded-For` entry, bounded to 64 chars).
- Security headers middleware present (`src/lib/security-headers.ts`).
- `x-buildora-force-local` test override correctly gated to
  dev/test (`isTestForceLocalHeader` returns false in production).
- Generation env-var requirements documented.
- Working tree began clean on `phase-p21-post-release-hardening` with P20
  merged at HEAD.

## 3. Audit methodology

The audit followed the ten P21 areas with direct code inspection and
targeted searches — never trusting historical reports alone:

1. Production failure recovery (each dependency outage → UI truthfulness)
2. Retry safety / idempotency (saves, checkpoints, collab sends, publish,
   generation, workspace mutations, sharing)
3. Queue / backpressure / resource safety (bounded queues, in-memory maps,
   session registry, rate-limit state)
4. Session / lifecycle resilience (connect → active → offline → reconnect →
   auth-lost → stop; mount → unmount → remount)
5. Data recovery (incident scenarios A–H, authoritative-state question)
6. Security under failure (auth loss mid-operation, stale membership,
   queued writes after revocation, replay)
7. Generation endpoint hardening (P20 rate limiter re-verification)
8. Observability → incident response (correlation ids, bounded codes,
   sensitive-content exclusion)
9. Deployment / rollback safety (migrations, app/db version compat)
10. Incident-style regression testing (deterministic risk-to-test mapping)

## 4. Findings

### F1 — Mock collab transport swallows connect error codes (P2)

**Risk:** `mock-http-collab-transport.ts` converted every connect failure
into `new Error("collab connect failed")`, discarding the workspace error
code that the Supabase transport preserves. On the mock path (used by E2E
and dev), a connect-time authorization loss (`PERMISSION_DENIED` /
`SESSION_EXPIRED`) was indistinguishable from a transient outage — the
P18 diagnostic contract and the connect-time auth-loss transition were
broken on that path.

**Classification:** P2 (dev/mock path divergence; the Supabase production
path was already correct). Fixed because the fix is small, reduces risk,
and is trivially regression-tested.

### F2 — Transient connect failure strands a dead session forever (P2)

**Risk:** A transient outage exactly at project open (server restart /
network blip) left a session with collab status "error" while local
persistence continued to work — and the status bar's "Saved" reflects
IndexedDB, not the workspace copy. The workspace access hook treats the
server copy as authoritative on every open, so a later reload **silently
discards those local-only edits** with no failure signal. Compounding it,
`CollabSession.start()` resolves on connect failure (the fallback design),
so the owning hook could not even observe the failure through the promise.

**Classification:** P2 (requires a transient outage exactly at open; the
Supabase path is only mock/E2E divergent on error codes). Fixed with a
bounded reconnect (3 attempts, 2s/4s/8s backoff) that classifies codes:
auth loss → honest read-only (never retried); transient → bounded retry;
permanent → local fallback retained.

### F3 — Gemini provider failures silent in production (P2)

**Risk:** The `/api/generate` fallback log line was `logger.warn`, which is
dev-only in this codebase. A paid-provider outage (Gemini down / missing
key / timeout) therefore produced **no production log at the failure
boundary** — the P19 observability goal is not met where it matters most
(cost + availability). Additionally, the route's catch path embedded raw
error messages in the message channel, which is logged verbatim in
production — violating the P18/P19 "static template + bounded code"
convention and the Area 8 sensitive-content exclusion.

**Classification:** P2 (observability gap at a paid-provider boundary;
not a user-visible data loss). Fixed with ERROR-level bounded diagnostics
and a `boundedErrorToken` that never carries raw provider text.

### F4 — Unbounded deploy rate-limit memory (P2)

**Risk:** `publish-idempotency.ts` deploy rate-limit map had no bound. The
key is per-project so ordinary traffic is bounded, but a crafted request
sequence could grow the map without limit on a long-lived instance — the
same class of memory-DoS vector P20 addressed for the generate limiter.

**Classification:** P2. Fixed with a time-based sweep + oldest-key eviction
cap, mirroring `boundAttempts` in the generate limiter.

### F5 — Mock workspace deletion leaks collab rooms (P2)

**Risk:** `handleDeleteWorkspace` in the mock server deleted the project
row but left `state.collabRooms` and `state.collabSendAttempts` entries
behind. Dev/mock only, but it produced stale-room behavior in E2E
lifecycle tests (a deleted workspace's room still joinable).

**Classification:** P2 (dev/mock only). Fixed with a cascade delete.

### Noted and documented (no fix — P3 / by design)

- **Rate-limit key trust:** the first `X-Forwarded-For` entry is only
  trustworthy when a trusted proxy/CDN overwrites it (Vercel does). Already
  documented in `generate-rate-limit.ts`; the map bound limits the damage
  from key rotation. (P3: external limiter for multi-instance enforcement.)
- **No distributed idempotency infrastructure:** no genuine need was
  demonstrated (each operation already has a retry-safe path; publish has
  `storeIdempotency`). Not introduced, per scope rule.
- **Mock server presence TTL / lease expiry:** already bounded by TTL
  sweeps (verified).

## 5. P0/P1/P2/P3 classification

| ID | Severity | Area | Fixed? |
|----|----------|------|--------|
| F1 | P2 | 1/4 (connect error codes) | ✅ |
| F2 | P2 | 4/5 (bounded reconnect) | ✅ |
| F3 | P2 | 8 (production observability) | ✅ |
| F4 | P2 | 3 (bounded memory) | ✅ |
| F5 | P2 | 3 (mock cascade cleanup) | ✅ |
| — | P3 | 7 (external/distributed rate limiter) | documented |
| — | P3 | 9 (multi-instance idempotency) | documented |
| — | P0/P1 | none found | — |

No P0/P1 findings were manufactured; none existed beyond the P16–P20 fixes
already merged.

## 6. Fixes

### F1 — `mock-http-collab-transport.ts`
Connect failures now preserve the workspace error code (thrown as a
`WorkspaceError` with the original code) instead of a generic message,
matching the Supabase transport's contract.

### F2 — `collab-session.ts` + `useCollaborationSession.ts`
- `CollabSession` gained an `onConnectError(code)` callback. `start()`
  still resolves on connect failure (fallback design preserved), but now
  surfaces the code to the owning hook.
- The hook classifies the code:
  - `PERMISSION_DENIED` / `SESSION_EXPIRED` → honest read-only transition,
    never retried (server is the authority).
  - `NETWORK_FAILED` / `OFFLINE` / `RATE_LIMITED` / `MALFORMED_RESPONSE` /
    `UNKNOWN` → bounded reconnect: fresh transport, max 3 attempts,
    delays 2s/4s/8s. Budget shared per scope; scope switch resets it.
  - Anything else → local fallback retained (retry cannot help).
- Timer lifecycle is safe: the pending timer is cleared on scope change and
  unmount; the `sessionRef.current !== session` guard prevents reconnect
  work after teardown; attempt counter is reset per scope.

### F3 — `/api/generate` route + rate limiter
- `boundedErrorToken(err)` exported: uppercase ProviderError code → JS
  identifier (constructor name/typeof) → `"UNKNOWN"`. Never raw messages.
- Gemini fallback failure logged at **ERROR** (production-visible) with the
  bounded token; the catch path uses `unexpected error (<token>)`.
- 429 response now carries `Retry-After: <window seconds>`.

### F4 — `publish-idempotency.ts`
- Deploy rate-limit map bounded: when over cap, expired keys swept first,
  then insertion-oldest evicted. `RATE_WINDOW_MS` exported for tests.

### F5 — `mock-workspace-server.ts`
- `handleDeleteWorkspace` cascades deletion of `collabRooms` and
  `collabSendAttempts` entries for the workspace.

## 7. Regression tests (+23)

| Test file | Covers |
|-----------|--------|
| `src/features/collaboration/__tests__/mock-http-collab-transport.test.ts` (new) | F1: connect error code preserved (PERMISSION_DENIED / SESSION_EXPIRED round-trip); generic code mapped |
| `src/features/collaboration/hooks/__tests__/useCollaborationSession.test.tsx` (new) | F2: transient connect failure → bounded reconnect (fresh transport, attempt budget shared per scope, backoff delay grows then stops at cap); auth-loss connect failure → read-only, **no** reconnect; teardown guard; timer cleared on scope change |
| `src/app/api/generate/__tests__/route.test.ts` (new) | F3: 429 carries `Retry-After`; `boundedErrorToken` output bounded/non-sensitive (code, constructor name, `UNKNOWN` fallback, no raw message leakage) |
| `src/features/publishing/server/__tests__/publish-idempotency.test.ts` (new) | F4: map bounded — expired keys swept, active windows not evicted (no bypass), oldest-key eviction under cap |
| `src/features/workspaces/__tests__/mock-workspace-server.test.ts` (extended) | F5: workspace deletion removes collab room + send-attempt entries |

Existing suites still pass (collab-session-connect, supabase-collab-transport,
generate-rate-limit, publish-service, logger, security-headers).

## 8. Failure-recovery results

| Scenario | Result |
|----------|--------|
| Connect failure at open (transient) | Bounded reconnect now restores the room (F2); without recovery the editor stays honestly on local persistence with collab status "error" |
| Connect failure at open (auth loss) | Read-only transition, no retry, no queued sends (F2) |
| Send failure (auth loss while connected) | Existing P18 path: logged once, `authLost` set, session-end checkpoint skipped |
| Send failure (network) | Status "offline"; doc retains changes; next checkpoint retries |
| Checkpoint failure | Bounded code logged; STALE_REVISION refetch+retry once; auth codes trigger read-only; LOCKED re-schedules |
| Malformed update | Ignored; convergence guaranteed by next snapshot/checkpoint cycle |
| Provider failure (Gemini) | Rule-based fallback; now visible to operators (F3) |
| Publish provider failure | Existing error classification (PROVIDER_* codes) + idempotent retry guard |

## 9. Retry/idempotency results

- **Publish:** `storeIdempotency` keyed by project+hash — duplicate deploy
  requests return the stored result instead of double-deploying.
- **Checkpoints:** single-flight (`inFlightCheckpoint`), debounced, bounded
  STALE_REVISION retry.
- **Collab sends:** local-origin transactions broadcast exactly once;
  remote origins never re-broadcast; reconnect re-syncs via poll.
- **Generation:** HTTP-level retry is client-driven; the route itself does
  not retry provider calls (fallback instead); 429 now has `Retry-After`.
- **F2 reconnect:** bounded (3 attempts), never re-enters a dead scope,
  never duplicates listeners (fresh transport + session per attempt).
- No operation was found that could corrupt state or double-charge a
  provider when performed twice; no distributed idempotency infrastructure
  was needed.

## 10. Resource-bound results

- Generate rate-limit map: capped (10k keys) with expired-first sweep.
- Deploy rate-limit map: now capped (F4).
- Collab room log: pruned on durable checkpoint; rebase sent to
  behind-frontier pollers.
- Presence: TTL-based, membership-scoped, swept.
- Session registry: single active session; cleared on teardown.
- Timers/intervals: checkpoint timer cleared on stop; reconnect timer
  cleared on scope change/unmount (F2).
- No unbounded growth, no leaked timers, no duplicate queued work found
  after F2/F4/F5.

## 11. Security review

- No authorization check was weakened anywhere; all P21 changes preserve
  or strengthen failure-path honesty.
- Auth-loss mid-operation (removed member): session stops, pending sends
  rejected server-side, session-end checkpoint skipped — no unauthorized
  mutation occurs (verified in existing realtime-permissions E2E).
- Rate-limit state is per-instance and not cross-tenant shared; key rotation
  is bounded by the map cap.
- Logging: no secrets/tokens/cookies/prompts/project contents in any new
  log line; `boundedErrorToken` guarantees bounded identifiers only.
- F1 preserved error-code propagation without adding sensitive fields.
- No input-validation changes weakened any schema.

## 12. Observability review

- Correlation identifiers available on collab diagnostics: workspaceId,
  projectId, clientId (existing P18 pattern). Generate route: bounded codes
  + timings + source; requestId correlation is via platform logs.
- All failure paths now embed bounded error codes in the message channel
  (survives production redaction), including the previously-silent Gemini
  fallback boundary (F3).
- Logs remain bounded; no unbounded repetition (auth-loss logged once per
  incident; F2 retries log per attempt at connect only).

## 13. Deployment / rollback assessment

- `supabase/migrations/20260813000001_collab_updates.sql` (latest): all
  `create or replace` / `if not exists`; FK cascades — **non-destructive,
  rollback-safe**. Earlier migrations verified additive.
- No new environment variables were introduced by P21 (the existing
  `BUILDORA_FORCE_LOCAL_GENERATION` and P20 vars are unchanged).
- Old application against new database: compatible (additive schema only).
- New application against old database: compatible.
- **Rollback assumption documented:** a deployment can be rolled back by
  reverting the app while leaving the additive schema in place; no
  destructive migration ordering exists.

## 14. Full validation results

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | ✅ clean |
| `npm run lint` | ✅ clean |
| `npx vitest run` (full unit) | ✅ **3983/3983** (+23 vs P20's 3960) |
| `npm run build` | ✅ clean |
| Affected E2E batch (collab/workspace/AI/fallback, 23 specs) | ✅ **44/44** |
| `npm run test:e2e:matrix` | ✅ **13/13** |
| `npm run test:e2e:fallback` | ✅ **1/1** |
| `npm run test:export-build` | ✅ **1/1** |
| Full remaining E2E suite (33 specs, all other spec files) | ✅ **87/87** |

One dev server was used for all E2E gates (fresh, running P21 code; the
stale pre-P21 server was killed first).

## 15. E2E failures and evidence

**None.** Zero failures across all E2E gates — no flakes, no classification
needed. The first background full-suite launch was aborted before starting
due to shell quoting of `--grep-invert`; the remaining suite was then run
explicitly by spec-file list (all non-affected specs) and passed 87/87.

## 16. Remaining non-blocking risks

- **P3:** Distributed / multi-instance rate limiting (single-instance
  best-effort today; documented).
- **P3:** `X-Forwarded-For` trust depends on proxy/CDN overwriting; map
  bounds the abuse surface.
- **P3:** Fairness note in the generate limiter — under sustained key
  rotation, insertion-oldest keys evict first (legit clients just get a
  fresh bucket).
- **P3:** Mock-server collab room retention until workspace deletion
  (dev-only; E2E-relevant only).
- **P3:** F2 reconnect budget is per-scope; a user who stays in one project
  through a >~14s outage keeps the local fallback until next open (honest,
  documented behavior).

## 17. Operational recommendations

1. Deploy behind a proxy/CDN that overwrites `X-Forwarded-For` (Vercel
   does) so the generate rate limit keys on real client addresses.
2. Alert on the "Gemini failed, falling back" ERROR line — it now fires in
   production and marks paid-provider health.
3. Keep the collab diagnostics (workspaceId/projectId/clientId + bounded
   code) in the structured log pipeline; they are sufficient to correlate a
   room-level incident.
4. For multi-instance deployments, plan the P3 external rate limiter before
   scaling out horizontally.

## 18. P22 candidates (documented only — NOT started)

1. Distributed rate limiting for `/api/generate` (P3).
2. Multi-instance idempotency for publish deploys (P3).
3. Optional: client-driven `Retry-After`-aware retry/backoff in the
   generation UI (currently the client surfaces 429 directly).

## 19. Final P21 status

- Release baseline intact ✅
- Genuine P0/P1 operational risks: none found beyond P16–P20 ✅
- P2 fixes all regression-covered ✅
- Lifecycle / retry-idempotency / failure-recovery / security-under-failure /
  resource bounds verified ✅
- Generation rate limiting re-verified ✅
- Observability incident-useful at the previously-silent boundary ✅
- Rollback assumptions documented ✅
- Full validation green (tsc / lint / unit / build / all E2E gates) ✅
- Security review passed ✅
- `docs/phase-p21-report.md` written ✅
- No debug artifacts remain; working tree contains only intended P21 changes ✅
- P22 has **not** started ✅

**POST-RELEASE HARDENING COMPLETE.**
