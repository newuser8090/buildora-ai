# Phase P21 — Post-Release Hardening & Operational Resilience: Architecture

Branch: `phase-p21-post-release-hardening`
Status: **Audit complete — evidence-driven findings; fixes follow in `docs/phase-p21-report.md`.**

---

## 1. P21 objective

P20 declared Buildora AI **RELEASE READY** and shipped the production rate
limiter for `/api/generate`, security headers, the dev-gated force-local
header, and the missing env-var documentation. P21 is the first post-release
hardening phase: find and eliminate **genuine post-release reliability,
recovery, security, and operational weaknesses** that could cause a production
incident even though the release gates pass.

P21 is **not** a feature sprint. Every change is evidence-driven (current
behavior → failure → fix → regression test) and every finding is classified
P0/P1/P2/P3. **P21 implements P0/P1 findings only**, plus a P2 only when the
fix is small, risk is clearly reduced, regression coverage is straightforward,
and it does not expand scope. P3 findings are documented only.

## 2. P20 baseline (verified in the repository)

- Branch `phase-p21-post-release-hardening` cut from merged master containing
  P16–P20. Working tree clean at audit start (`git status`). P20 merged at HEAD.
- P20 shipped: `generate-rate-limit.ts` (production-only, 60/min/client, XFF-
  keyed, bounded 10k-key map), `security-headers.ts` + `next.config.ts`
  wiring, `isTestForceLocalHeader` (dev-only), `.env.example` documentation.
- P20 final validation: 3960/3960 unit; smoke 37/37; matrix 13/13; fallback
  1/1; export-build 1/1; full E2E 115/117 (2 documented pre-existing
  environmental flakes, evidence-classified).
- P19 baseline: safe-identifier allow-list logging, structured diagnostics in
  the four mock routes, publish failure diagnostics, collab clientId
  correlation. All re-verified present in code during this audit.

## 3. Operational risk inventory (what could cause a production incident)

Audited surfaces (each inspected in code, never from reports alone):

| Surface | Files | Post-release incident risk |
|---|---|---|
| Collab connect (mock + Supabase transports) | `mock-http-collab-transport.ts`, `supabase-collab-transport.ts` | Connect failures must be truthful + diagnosable; auth-vs-transient must be distinguishable |
| Collab session lifecycle | `collab-session.ts`, `useCollaborationSession.ts` | Dead sessions, duplicate sessions, stranded local-only editing, reconnect behavior |
| Workspace open/reload authority | `useWorkspaceEditorAccess.ts`, `project-controller.ts` | Server copy is authoritative on reload — local-only edits can be silently discarded |
| Publishing deploy | `publish-idempotency.ts`, `vercel/deploy/route.ts` | Retry/duplicate protection, deploy rate-limit memory |
| Generation endpoint | `api/generate/route.ts`, `generate-rate-limit.ts`, gemini providers | Cost abuse, 429 behavior, provider-failure observability |
| Persistence | `project-controller.ts`, `autosave-coordinator.ts` | False success, transition safety, retry |
| Mock backend | `mock-workspace-server.ts` | Dev/E2E memory hygiene (stale rooms, rate-limit state) |
| Observability | `logger.ts`, route call sites | Sensitive content, incident-useful codes, production-visible failures |
| Migrations | 8 SQL files | Rollback safety, app/DB version compatibility |

## 4. Reliability surfaces (audited results)

- **Supabase-unavailable / API-timeout / network interruption:** the workspace
  access hook resolves offline → honest read-only from the local cache; the
  collab transports surface `NETWORK_FAILED`/`OFFLINE` → offline status with
  bounded offline queues (256/2 MB) on both transports; checkpoints retry once
  on STALE; publishing persists intermediate/final states (never a false
  success). **Correct — no change.**
- **Collaboration transport failure:** reconnect ordering (queue → catch-up)
  and the channel-epoch guard (P17 F3) verified intact.
- **Generation provider failure:** Gemini → rule-based fallback, single
  bounded retry inside the provider. **Gap found — the fallback is invisible
  in production** (the log line is `warn`, which is dev-only) — see finding F3.
- **Publishing provider failure:** six failure returns, all logged (P19 F3)
  with bounded codes, never raw provider messages. **Correct.**
- **Storage failure / malformed server response:** structured error codes
  mapped to user-safe copy; persistence errors block transitions and surface
  save-status error. **Correct.**
- **Expired authentication / revoked authorization:** session/lease invalidation
  verified across workspaces, collab, presence, share. **One divergence found:
  connect-time authorization loss on the mock path is indistinguishable from a
  generic failure** — see finding F1.

## 5. Recovery surfaces (audited results)

- Checkpoint failure → bounded STALE retry; session-end checkpoint; connect-
  failure edit fallback (P17 F2b); beforeunload guard; dirty-flush blocks
  transitions; recovery snapshots; version history; rollback requires
  confirmation. All verified intact.
- **Gap found:** a *transient* collab connect failure strands the session in a
  dead state permanently (no retry, no teardown). The editor continues with
  local-only persistence — the status bar shows "Saved" (IndexedDB) while the
  workspace copy stays stale — and a reload re-fetches the server copy,
  **silently discarding those local edits** with no failure signal. See
  finding F2.

## 6. Security surfaces (audited results)

- Actor always server-derived; RLS + SECURITY DEFINER RPCs; optimistic
  concurrency; membership/owner/editor gates on every handler; share tokens
  stored as hashes; no IDOR/cross-workspace enumeration (re-verified).
- **Security under failure:** queued writes after permission loss are rejected
  server-side and surface honest read-only; stale rooms reset on restore;
  replay/duplicate ops guarded (publish idempotency, share duplicate guard,
  Yjs idempotence). **Correct.**
- **Connect-time authorization loss (member removed while a session is
  joining):** handled on the Supabase transport (code preserved → read-only
  transition) but **broken on the mock transport** (code swallowed → local
  editing continues with status "error"). Divergence, untestable in E2E — see
  finding F1.

## 7. Incident scenarios (the ones this phase must handle)

| # | Scenario | Authority after failure | Current verdict |
|---|---|---|---|
| A | edit → connection loss → refresh | server copy + room log | Correct (offline queue + checkpoint) |
| B | edit → offline → reconnect | converged room | Correct (queue flush before catch-up) |
| C | edit → checkpoint failure → retry | server revision | Correct (bounded STALE retry) |
| D | edit → authorization loss | read-only, no upload | Correct (server rejects; honest UI) |
| D′ | **authorization loss at connect (join)** | read-only | **Mock broken (F1)** |
| E | edit → publish → provider failure | persisted statuses | Correct (no false success) |
| F | edit → close editor/session | session-end checkpoint | Correct |
| G | edit → server restart → reopen | server copy (authoritative) | **Divergence when collab never connected (F2)** |
| H | two clients edit → one disconnects → reconnects | converged room | Correct (reconnect E2E) |

## 8. Findings (evidence-based; full detail in the report)

| # | Area | Severity | Finding | Fix |
|---|---|---|---|---|
| F1 | 1/6/8 | P2 | `MockHttpCollabTransport.connect()` swallows the underlying workspace error code and rethrows `new Error("collab connect failed")` → diagnostics log `room connect failed (UNKNOWN)`; the mock path cannot distinguish connect-time PERMISSION_DENIED/SESSION_EXPIRED from a transient failure, diverging from the Supabase transport (which preserves codes) and leaving the connect-time authorization-loss path untestable in E2E | Rethrow the original error in `connect()` (keep the `error` phase) |
| F2 | 1/5/4 | P2 | Transient collab connect failure strands a dead session forever; local-only edits show "Saved" but are silently discarded on reload (server copy is authoritative on reopen) | Bounded backoff reconnect in `useCollaborationSession` (fresh transport per attempt; auth codes still → read-only; permanent codes → current fallback) |
| F3 | 8 | P2 | Gemini provider failure → rule-based fallback is invisible in production (`logger.warn` is dev-only); the top-level catch lacks the P18 bounded-code convention (raw message as dev-only data) | Log the fallback at error level with a bounded provider-error code; embed an error-class token in the catch message; add `Retry-After` to the 429 |
| F4 | 3/7 | P2 | `deployAttempts` in `publish-idempotency.ts` grows without bound (no expired-key sweep), unlike the generate limiter (10k-key bound) — unbounded rate-limit memory on a production path | Bounded sweep mirroring `generate-rate-limit.ts` |
| F5 | 3 | P3 (trivially safe) | `handleDeleteWorkspace` in the mock does not cascade `collabRooms`/`collabSendAttempts` (dev/E2E memory hygiene) | Add the cascade + regression test |
| F6 | 7 | P3 (trivially safe) | `/api/generate` 429 lacks a `Retry-After` header (standard operational hint) | Add `Retry-After: 60` to the 429 response |

## 9. Investigation order

1. Area 2/1 — collab connect path (F1) and session lifecycle (F2).
2. Area 8 — generation observability (F3) + logger call-site audit.
3. Area 3/7 — rate-limit memory (F4) + mock state hygiene (F5).
4. Area 7 — 429 behavior (F6) and rate-limiter re-verification.
5. Area 5 — data-recovery verification against the existing E2E set.
6. Area 9 — rollback assessment (migrations audit; documented, no change).

## 10. Regression tests planned (Area 10 — incident-style, risk-corresponding)

- F1: unit test asserting the mock transport's `connect()` rejects with the
  preserved workspace error code (auth and network cases).
- F2: hook-level tests — transient connect failure schedules a bounded retry
  that re-joins and connects; auth failure transitions to read-only with no
  retry; permanent failure keeps the local fallback; retry budget is bounded.
- F3: logger-asserted tests that the Gemini-failure fallback emits a
  production-visible error line with a bounded code (no raw message), the
  catch embeds an error-class token, and the 429 includes `Retry-After`.
- F4: deploy rate-limit bounded-memory sweep test (expired keys evicted, map
  capped).
- F5: mock workspace-deletion cascade test (rooms + send-attempt entries
  removed).

## 11. Explicit non-goals

- **No CRDT/architecture rewrite.** P16's canonical-state design is verified
  correct; F2 is a lifecycle fix, not a transport redesign.
- **No database rewrite / RLS changes / auth weakening.**
- **No UI redesign.** No new failure banners; existing honest states suffice.
- **No distributed idempotency or external rate limiter** (per-instance
  best-effort remains documented).
- **No new E2E specs for scenarios already covered** by realtime-reconnect /
  realtime-permissions / production-publishing — the incident test set is
  unit-level and corresponds 1:1 to the identified risks.
- **P22 is NOT started.**
