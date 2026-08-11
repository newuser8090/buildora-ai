# Phase P17 — Report: Production Hardening

Branch: `phase-p17-production-hardening`
Design document: `docs/phase-p17-architecture.md` (written after the repository audit).

Phase P17 is the production-hardening phase between the P16 collaboration
foundation and the next feature phase. It did **not** add product features. It
audited the architecture for the highest-value production risks and fixed the
genuine ones with regression tests. Every change below is evidence-driven
(current behavior → failure → fix → regression test). P16 functionality and its
validation baseline are preserved.

---

## 1. Delivered fixes (all with regression tests)

### F1 — The mock collab room no longer drops un-checkpointed updates

**Current behavior (before):** `handleCollabSend` shifted the oldest retained
update off the log when it exceeded 200 entries — **without** advancing the
checkpoint frontier or refreshing the canonical state. The rebase contract only
triggers when `afterSeq < checkpointSeq`, so a client polling inside the shifted
window received neither the dropped updates nor a rebase.

**Failure/risk:** silent partial content loss and client divergence — the exact
guarantee P16 exists to protect. Realistic trigger: a reconnect flush of the
256-update offline queue pushes the log over the cap in one burst. The mock
violated the documented "pruned only at checkpoint" contract and broke
mock↔Supabase parity (the Supabase log is pruned only by `ws_collab_checkpoint`).

**Fix:** the shift is gone; the log is pruned only at checkpoint
(`advanceCollabCheckpoint`), mirroring the Supabase path exactly. Growth between
checkpoints is bounded by the 1.5 s checkpoint debounce; the new per-room send
ceiling (F4) bounds floods.

**Regression test:** `collab-room.test.ts` — 250 sends with no checkpoint; a
member polling/joining from the frontier still receives **every** update.

### F2 — Session-end checkpoint (documented trigger now implemented)

**Current behavior (before):** `CollabSession.stop()` cleared the checkpoint
timer and disconnected without a final save. Architecture §25 documents "on
session end" as a checkpoint trigger.

**Failure/risk:** the durable workspace payload and P15 version history could
lag behind the last edits by the debounce window (or indefinitely when the
session ended inside the window).

**Fix:** `stop()` runs a best-effort `checkpoint()` **before** teardown, gated on
`hasUncheckpointedLocalChanges && !authLost && connected && canSend` — so a clean
session makes no noisy save (scope churn / StrictMode double-mount safe), and an
authorization-lost session never attempts a doomed save. Checkpoints are now
single-flight (a debounced checkpoint already in flight during `stop()` is
awaited, never duplicated into a STALE_REVISION refetch/retry).

**Regression test:** `collab-session-connect.test.ts` — an unsynced session
stopped before the debounce fires saves exactly once; a clean session stop makes
no save call.

### F2b — Connect-failure path no longer strands pre-connect edits

**Current behavior (before):** pre-connect edits were applied to the store under
the remote-projection flag, so the persistence controller never marked them
dirty or scheduled an autosave. If `connect()` then failed, the hook was
unregistered but the edits stayed un-persisted (`dirty` false) — reload/close
silently dropped them.

**Fix:** on connect failure, the pending local project is re-committed through
the normal store path (`setProject` + `setDirty`) so the standard local
persistence persists it — the honest fallback. If access became read-only
mid-connect, `setProject` no-ops and the edit is deliberately **not** persisted
(matching the documented "changes after permission loss are never uploaded"
rule). No server write and no role escalation is involved — this is the local
adapter only.

**Regression test:** `collab-session-connect.test.ts` — connect failure with a
pre-connect edit → hook unregistered, store dirty, edit preserved.

### F3 — Supabase collab transport gained the bounded offline queue (parity)

**Current behavior (before):** only the mock transport queued offline sends
(256 / 2 MB, flush on reconnect). The Supabase transport dropped a send whose
RPC failed — a documented-contract deviation (§23/§32) only the mock honored.

**Fix:** the Supabase transport now mirrors the mock: offline sends (channel
CLOSED) queue locally with the same bounded caps, flush **before** room
catch-up on re-subscribe, and authorization errors are **never** queued — they
propagate (and a flush that hits `PERMISSION_DENIED`/`SESSION_EXPIRED`/
`LEASE_INVALID` surfaces the auth error instead of silently re-queuing forever).
While implementing, a genuine race was found and fixed: a stale in-flight
`SUBSCRIBED` catch-up could flip a genuinely-offline transport back to
`connected` (skipping the queue). A channel-epoch guard now prevents stale
completions from overriding a newer close/error.

**Regression tests:** new `supabase-collab-transport.test.ts` — offline
queue/flush ordering, bounded-cap drop, auth-error propagation (both on direct
send and during flush), plus a connect smoke test (all against an injected fake
Supabase client — no credentials, repo convention).

### F4 — Per-room send rate limit (mock, architecture §39 now honored)

**Current behavior (before):** §39 documents a mock per-room rate limit; only
invitations used `rateLimited`. A compromised editor client could flood the room
log with tiny updates (log growth + poll amplification for peers).

**Fix:** `handleCollabSend` applies a per-room ceiling (2400 / 60 s — generous
enough to never trip legitimate typing, AI-plan bursts, or the 256-update
reconnect flush; tight enough to bound a flood). The budget is per-room, so a
flood in one project cannot starve another.

**Regression test:** `collab-room.test.ts` — a 2400-send flood trips
`RATE_LIMITED`; a different room in the same workspace is unaffected.

## 2. Stale-state hardening (found during validation)

The mock backend holds cross-context state on `globalThis`
(`buildora.mockWorkspaceState.v1`). When a long-lived dev server hot-recompiled
the newer module (with the new `collabSendAttempts` state field) over an older
global state, every collab send crashed (`rateLimited(undefined, …)`) and 9/10
collab E2E specs failed. Two-part fix, both committed:

1. The mock-state global key was bumped to **v2** — the shape changed, so the
   versioned key must too; a hot-recompiled module can no longer receive a stale
   shape. This is a genuine stale-state fix for the dev/test infrastructure.
2. Validation hygiene (matching the P16 §14 convention): kill stale dev servers,
   warm routes before E2E, and run the full suite as one continuous invocation on
   a fresh server. The 9 failures were reproduced as purely environmental (fresh
   server → spec green), never a product regression.

## 3. Files changed

- `src/features/workspaces/mock/mock-workspace-server.ts` — F1 retention, F4
  rate limit, `collabSendAttempts` state field, global-key bump to v2.
- `src/features/collaboration/services/collab-session.ts` — F2 session-end
  checkpoint + single-flight checkpoints, F2b connect-failure fallback,
  `authLost`/`hasUncheckpointedLocalChanges` flags.
- `src/features/collaboration/transport/supabase-collab-transport.ts` — F3
  offline queue + flush, channel-epoch guard, flush auth-error propagation.
- `src/features/collaboration/transport/mock-http-collab-transport.ts` — flush
  auth-error propagation (parity with F3).
- `src/features/collaboration/__tests__/collab-room.test.ts` — F1 + F4 tests.
- `src/features/collaboration/__tests__/collab-session-connect.test.ts` — F2 +
  F2b tests.
- `src/features/collaboration/__tests__/supabase-collab-transport.test.ts` — NEW
  F3 test file (5 tests).
- `docs/phase-p17-architecture.md`, `docs/phase-p17-report.md`.

## 4. Security review (post-implementation)

Re-verified every touched surface against the architecture checklist:

- **Actor identity** — always server-derived (session token / `auth.uid()`);
  forged `actorClientId`/role/workspace/project in request bodies remain ignored
  or rejected. F1–F4 do not alter this.
- **F2/F2b** — the session-end checkpoint uses the existing
  `saveWorkspaceProject` path (editor/owner, actor from session). Viewers can
  never trigger it (`canSend` gate). The connect-failure fallback writes to the
  **local** persistence adapter only — no server write, no role escalation; if
  access became read-only mid-connect, `setProject` no-ops and the edit is
  deliberately not persisted.
- **F3** — only transient (offline-phase) failures queue; authorization errors
  propagate; queued uploads after permission loss are rejected by the server
  regardless and now also surface the honest read-only transition during a
  flush.
- **F4** — rate limiting is applied after `requireEditor`, so it never weakens
  auth; it only bounds an authorized flood. The Supabase boundary is documented
  (no native RPC rate limit; bounded by per-update size caps + checkpoint
  pruning).
- **Mock parity** — the mock and Supabase collab paths now share identical
  retention (prune at checkpoint only), offline-queue semantics, and
  auth-error handling.

## 5. Validation results (exact)

Run sequentially, never concurrently:

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | ✅ clean |
| `npm run lint` | ✅ clean (0 errors, 0 warnings) |
| `npm test` | ✅ **3916 passed** (281 files) — includes 9 new P17 regression tests |
| `npm run build` | ✅ success |
| Affected collab E2E (10 specs) | ✅ **10/10 passed** (collaboration, text, structure, undo, reconnect, permissions, edit-lease, presence, version-history, collaboration) |
| `npm run test:e2e` (full) | ✅ **117/117 passed** (12.2 m) |
| `npm run test:e2e:matrix` | ✅ **13/13 passed** (2.9 m) |
| `npm run test:e2e:fallback` | ✅ **1/1 passed** |
| `npm run test:export-build` | ✅ **1/1 passed** (52.9 s) |

## 6. Environmental incidents (all resolved, none product)

- **Stale dev server (9 E2E failures).** A long-lived dev server on port 3000
  was reused by Playwright; its mock-state global predated the new
  `collabSendAttempts` field, so the new rate-limit code crashed on every collab
  send. Killed the server, bumped the global key to v2 (permanent fix), re-ran —
  all green. See §2.
- **Basher 600 s clamp vs the 12-minute suite.** The full E2E run was relaunched
  detached (`nohup` + log) and polled; it completed 117/117.
- **Browser "Target crashed" during the interrupted run** — resource pressure
  from the orphaned processes; after a full process cleanup and a fresh server
  the suite ran clean to 117/117 with zero crashes.

## 7. Known limitations (unchanged from P16)

- Moves/reorders of a section being concurrently edited inside follow the
  documented delete-wins structural policy.
- Offline editing is bounded by design (queue caps; rebase-from-checkpoint on
  overflow) — not offline-first.
- Supabase Realtime end-to-end verification still requires a live project with
  credentials; the Supabase transport semantics are validated through the
  mirroring mock + the new injected-client unit tests (repo convention).
- P17 does not start P18 (cursors, offline-first local CRDT storage, dashboard
  presence, Supabase live verification, version diffing, etc.).
