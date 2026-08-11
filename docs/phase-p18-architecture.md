# Phase P18 — Production Readiness & Operational Reliability

Status: Planning → Implementation
Baseline: P17 merged into master (`2f69bab`), branch `phase-p18-production-readiness` created from that exact state.

---

## 1. P18 objective

Make Buildora AI production-ready from an **operational reliability** perspective: the system must behave predictably under partial outages, not merely on the happy path. P18 is evidence-driven — every change is anchored in a concrete failure mode observed in the repository, with a regression test. P18 does **not** add product features, does **not** redesign working architecture, and does **not** weaken any existing security, authorization, persistence, collaboration, or test guarantee.

The audit focused on the six gaps defined by the phase brief:

1. "passes tests locally"
2. "works against the mock transport"
3. "works against real Supabase"
4. "survives production deployment"
5. "fails safely under partial outages"
6. "can actually be diagnosed by a developer/operator"

---

## 2. Current system baseline

Verified from the repository (not assumed):

- **Branch/state:** `phase-p18-production-readiness`, clean tree, P17 merged (`git log master -3` → P17 squash present).
- **Collaboration (P16/P17):** `CollabSession` owns Y.Doc + undo + transport + commit hook + projection + debounced checkpoints; both transports implement bounded offline queues, channel-epoch reconnect protection, and authorization-error propagation (P17 F1–F4).
- **Workspaces (P14/P15):** provider-boundary services (`WorkspaceService`, `getPresenceProvider`) behind `getCloudEnvironment()` selection; mock HTTP + Supabase providers with strict server-side authorization (RLS + SECURITY DEFINER RPCs / mock enforcement).
- **Persistence:** `ProjectController` → `AutosaveCoordinator` → IndexedDB; transition guard blocks on failed flush; recovery snapshots (P9); version history (P15).
- **Publishing (P7/P8):** server-only Vercel client resolution (`real`/`mock`/`unavailable`), structured results, deployment records in IndexedDB.
- **Config (P6):** `getCloudEnvironment()` local-first resolution; secrets server-only.
- **Tests:** 3,916 unit tests / 281 files; 117 E2E + matrix + fallback + export-build at the P17 gate.

---

## 3. P16 → P17 → P18 transition

P17 hardened the collaboration transport (room durability, session-end checkpoint, pre-connect edit fallback, offline queue, epoch guard, rate limit, state-shape versioning). P18 does not re-do that work. It audits the layers **around** and **above** the transport:

- provider parity (mock vs Supabase presence),
- diagnosability of production failures (observability),
- the remaining failure-matrix areas that P17 did not touch.

---

## 4. Production-risk inventory (evidence-based)

### Findings (genuine → fixed in P18)

| ID | Area | Finding | Evidence | Severity |
|----|------|---------|----------|----------|
| F1 | 2 (mock/Supabase parity) | **Supabase presence heartbeat wipes `projectId` (and resets `joinedAt`).** `SupabasePresenceProvider.heartbeat()` re-tracks with `projectId: null` + a fresh `joinedAt`. The mock preserves both across heartbeats (only TTL refreshes). After the first 10 s heartbeat on the production path, the user's presence payload loses its project scope → `PresenceIndicator` (which filters `s.projectId === projectId`) stops showing the user for the active project, and `getPresence(ws, projectId)` returns nothing. Divergence between mock and Supabase behavior with a user-visible failure on the production path. | `supabase-presence-provider.ts` heartbeat() vs `mock-workspace-server.ts` `handleHeartbeatPresence`/`handleJoinPresence` (`joinedAt: existing?.joinedAt ?? nowIso()`); `PresenceIndicator.tsx` project filter | **High** |
| F2 | 5 (observability) | **The project's logger is completely unused; every production failure is silent.** `src/lib/logger.ts` exists (errors always logged, data stripped in prod, non-errors dev-only) but has **zero** call sites in feature code. Collab connect failures, checkpoint failures, auth-loss transitions, presence gate rejections and persistence errors are all swallowed by `catch {}`/best-effort — a developer/operator cannot diagnose any of them. | `grep logger -g src -g '!*test*'` → 0 matches; `CollabSession.start/runCheckpoint/handleSendFailure`, `SupabasePresenceProvider.join`, `ProjectController` all swallow failures silently | **Medium** (charter Area 5 explicitly: "Add lightweight structured diagnostics where justified … Prefer the project's existing logging infrastructure") |

### Reviewed and found correct (documented, no change)

- **Area 1 — config/secrets:** server-only secrets (`GEMINI_API_KEY`, `VERCEL_API_TOKEN`) never `NEXT_PUBLIC_`; anon key is the only client-exposed secret; mock transport only when `NEXT_PUBLIC_CLOUD_PROVIDER=mock` or `NODE_ENV=development`; production without creds → `none` (local-only) / `unavailable` (publishing hidden, never a broken action). E2E secret-exposure test exists.
- **Area 2 — collab transport parity:** offline queues, flush ordering (local-first), auth-error propagation, channel-epoch guard — parity established in P17 and locked by `supabase-collab-transport.test.ts` + `collab-room.test.ts`.
- **Area 3 — failure recovery:** workspace service maps every provider failure to structured codes; collab session distinguishes auth loss (→ honest read-only) from transient network (→ offline status); checkpoint retries STALE_REVISION once via refetch; session-end checkpoint + connect-failure fallback (P17 F2/F2b). Non-idempotent ops (publish, restore) are not auto-retried — correct.
- **Area 4 — user-safe states:** `makeWorkspaceError`/`toWorkspaceError` never leak raw provider messages; `mapError` converts PGRST/RLS/JWT/rate-limit to safe copy; publish store distinguishes success/failure views; `saveNow` marks unsaved honestly when the coordinator hasn't caught up.
- **Area 6 — durability:** mutation → commit hook → Y.Doc → durable append RPC → debounced checkpoint → version. An un-checkpointed edit survives reload because the **append** is durable immediately; reconnect replays from base + log. Covered by `realtime-reconnect`/`realtime-text-collaboration` reload assertions. beforeunload warns for the local path. Remaining honest limitation (documented): bounded offline queues are in-memory — offline edits beyond the cap or a tab closed before flush are dropped by design (bounded, idempotent, never corrupting).
- **Area 7 — migrations:** RLS on every private table; SECURITY DEFINER + `set search_path = public`; grants to `authenticated` only; bounded retention (300 activity / 50 versions); allow-listed activity metadata; optimistic concurrency (STALE_REVISION) on save/restore; first-writer-wins seed. One lenient point documented (not fixed): `ws_collab_append_update` does not require the project row to exist (the mock lazily creates rooms too) — pruned at checkpoint, not a security boundary.
- **Area 8 — resource safety:** offline queues capped by count + bytes; update payload capped (256 KB) client- and server-side; per-room send rate limit (P17 F4); poll/heartbeat intervals cleared on unmount; single-flight checkpoints; no unbounded arrays/timers found.
- **Area 9 — security re-review:** actor always `auth.uid()`; membership checks on every read; invitation tokens server-generated; presence join gated by SECURITY DEFINER RPC; no client-trusted roles; no secret exposure; error mapping prevents information leakage. No new findings.
- **Area 10 — E2E failure scenarios:** reload durability, reconnect, permission revocation, structure convergence already covered by the 6 realtime specs. P18 adds no redundant E2E; the F1 regression is unit-level (fake Supabase client) because the mock path never had the bug.

---

## 5. Prioritized hardening areas

1. **F1 — Supabase presence parity** (genuine bug, user-visible on production path).
2. **F2 — observability wiring** (charter-mandated diagnosability; zero new dependencies — the logger already exists).
3. Documentation of everything reviewed-and-correct (this document + report) so future phases do not re-litigate.

---

## 6. Architecture decisions

- **D1 — Presence `projectId`/`joinedAt` state lives on the channel entry.** The Supabase provider already caches one `ChannelEntry` per workspace; the joined project scope and first-seen timestamp are remembered there at `join()` time and reused by every `heartbeat()` — mirroring the mock's server-side session, which preserves `projectId` and `joinedAt` across heartbeats. No interface change (the `heartbeat` signature is unchanged); no new payload fields.
- **D2 — Diagnostics use the existing logger, at failure boundaries only.** `logger.error` is wired into the highest-value silent failure points: collab connect failure, checkpoint failure, send auth-loss, transport auth error, presence join gate rejection, persistence save/transition errors. Safe identifiers + error codes only — never project content, tokens, or user data (the logger already strips data in production). No new monitoring dependency.
- **D3 — No new E2E for F1.** The bug exists only on the Supabase provider; E2E runs the mock path. A unit test with the injected fake Supabase client (existing convention) is the correct regression vehicle.

---

## 7. Security boundaries

Unchanged by P18. The presence heartbeat fix re-tracks **the same fixed-shape payload** with the user's own stored scope — it never accepts client-supplied scope at heartbeat time, and authorization still requires the `ws_join_presence` SECURITY DEFINER RPC to have succeeded. Diagnostics log codes/identifiers only, never secrets or content (and the logger redacts data in production).

---

## 8. Failure/recovery model

Already sound (audited): transient failures surface as offline/reconnecting status; authorization failures transition to honest read-only; checkpoints retry once on STALE_REVISION; session-end checkpoints and connect-failure fallbacks persist un-checkpointed edits. P18 adds only the **diagnosability** layer on top (F2).

---

## 9. Persistence/data-integrity strategy

Unchanged (audited correct). Local edits are durable via autosave + recovery snapshots; workspace edits are durable via append-RPC + checkpoint + version history. Documented limitation: bounded in-memory offline queues may drop excess offline edits by design.

---

## 10. Collaboration reliability strategy

Unchanged from P16/P17 (bounded queues, epoch guard, auth propagation, single-flight checkpoints). P18 verifies mock/Supabase parity for **presence** (the last provider pair without parity tests) and fixes F1.

---

## 11. API hardening strategy

API surface reviewed: `/api/collab` is mock-gated (`env.kind !== "mock"` → 404); body size caps; bearer-token actor derivation; structured error envelopes. No changes needed.

---

## 12. Publishing safety strategy

Unchanged (audited correct): mode resolution can never select mock in production; failed publishes surface as failure views; no dangerous auto-retries.

---

## 13. Testing strategy

- **F1:** new `supabase-presence-provider.test.ts` — fake Supabase client (per P17 convention) verifying `heartbeat()` preserves `projectId` + `joinedAt` and updates only `mode`, across multiple heartbeats; join stores the scope; `buildPresenceList` surfaces it project-scoped.
- **F2:** unit assertions that the logger is invoked at the wired failure boundaries (collab connect failure, checkpoint failure, send auth-loss, presence join rejection, persistence save failure) with a safe tag; existing behavior unchanged.
- Full P18 gates run sequentially afterward (tsc, lint, unit, build, affected E2E, full E2E, matrix, fallback, export-build).

---

## 14. Performance considerations

The F1 fix adds one string + timestamp per channel entry (constant memory per workspace). The F2 fix adds error-path-only `console.error` calls — zero hot-path cost (the collab send path and polling loops are untouched).

---

## 15. Observability considerations

After F2, these become diagnosable in production:

- collaboration connection lifecycle (connect failure, auth-loss transitions),
- checkpoint failures (with the error code),
- presence gate rejections,
- persistence save/transition failures.

All through the existing `logger` (errors always logged, data stripped in production). No secrets, tokens, or content are ever logged.

---

## 16. Explicit non-goals

- No new product features, no editor UI redesign, no AI changes.
- No replacement of the CRDT/Yjs collaboration architecture.
- No new monitoring platform/dependency.
- No changes to RLS or SECURITY DEFINER functions (nothing wrong found).
- No changes to the transport offline-queue/epoch logic (P17-verified).
- No new E2E specs for scenarios already covered by the 6 realtime specs.
- P19 is **not** started.

---

## 17. P18 implementation phases

1. **Phase 1 — F1:** fix `SupabasePresenceProvider` heartbeat; add `supabase-presence-provider.test.ts`; run targeted tests.
2. **Phase 2 — F2:** wire `logger.error` into collab/presence/persistence failure boundaries; add regression tests; run targeted tests.
3. **Phase 3 — Validation:** tsc → lint → full unit suite → build → affected E2E → full E2E → matrix → fallback → export-build.
4. **Phase 4 — Review & docs:** focused code review + security re-review; write `docs/phase-p18-report.md`; confirm git status and that P19 was not started.

---

## 18. P18 exit criteria

- [ ] F1 fixed + regression test passing
- [ ] F2 wired + regression tests passing
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run lint` clean
- [ ] `npm test` full suite green
- [ ] `npm run build` green
- [ ] Affected E2E (presence + realtime) green
- [ ] Full E2E regression green
- [ ] Matrix / fallback / export-build green
- [ ] Security re-review complete (no new findings)
- [ ] `docs/phase-p18-report.md` written with exact totals
- [ ] P19 not started
