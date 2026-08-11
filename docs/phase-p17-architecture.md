# Phase P17 — Production Hardening: Architecture

Branch: `phase-p17-production-hardening`
Status: **Design document — written after the repository audit, before implementation.**

---

## 1. P17 objective

P17 is a **production-hardening phase**. It does not add product features. It takes
the architecture established through P16 (real-time collaborative editing on a
server-authoritative workspace model) and eliminates the highest-value production
risks: silent data divergence, lost edits at session boundaries, offline-relay
parity gaps, and authorization/DoS surfaces. Every change is evidence-driven:
current behavior → failure/risk → why it matters → affected architecture → fix →
regression test. Anything already correct is left alone.

## 2. Current system baseline (verified against the repository)

- **Branch:** `phase-p17-production-hardening`, working tree clean, based on the
  P16 merge (`b648556`). P16 is fully merged into master.
- **Editor:** Zustand store (`editor-store.ts`) funnels every mutation through
  `withHistory`/`commitLocalProject` — the single commit boundary intercepted by
  the collab commit hook in collaborative mode.
- **Persistence:** `ProjectController` → `AutosaveCoordinator` (3 s debounce,
  revision-tracked, single-project scoped) → IndexedDB adapter. Transitions block
  on dirty flush; recovery snapshots + thumbnails are non-blocking.
- **Collaboration (P16):** one `Y.Doc` per workspace project; canonical shared
  state seeded first-writer-wins; `CollabSession` owns doc/undo/transport/hook/
  projection/checkpoint; mock (HTTP polling, dev-server state) and Supabase
  (Realtime Broadcast + RPC) transports; bounded offline queue (256 updates /
  2 MB) in the **mock** transport; maintenance lock for restore/import.
- **Workspaces:** server-authoritative mock + Supabase (SECURITY DEFINER RPCs,
  RLS, `auth.uid()`), P14 RBAC, P15 presence/activity/versions.
- **Publishing:** local deployment records + provider adapters; client-side
  in-flight lock + server-side idempotency; rollback requires confirmation.
- **Validation baseline (P16):** tsc / lint / 3,907 unit tests / build / 6 P16
  E2E / 117 full E2E / matrix / fallback / export-build all green.

## 3. P16 → P17 transition

P16 shipped the collaboration engine and a strong test suite. P17 does not
replace the CRDT architecture or the canonical-state model. It audits the
**failure modes around that engine** — the places where a real production
deployment would lose data or diverge silently — and fixes the genuine ones with
regression tests. No P16 functionality is removed; no public behavior changes
without a concrete reason.

## 4. Production-risk inventory (audit findings)

The audit inspected persistence, collaboration (session/transports/room/RLS),
workspace authorization, publishing, and the API routes. Findings below are
labeled by evidence strength.

### 4.1 Genuine findings — will fix with regression tests

**F1. Mock room update-log shift silently drops un-checkpointed updates
(data-divergence window).**

- *Current behavior:* `handleCollabSend` (mock-workspace-server.ts) drops the
  oldest retained update when the room log exceeds 200 (`room.updates.shift()`),
  **without** advancing `checkpointSeq` or refreshing `canonicalState`.
- *Failure/risk:* the rebase contract only triggers when `afterSeq <
  checkpointSeq`. A client polling with `afterSeq` inside the shifted window
  receives neither the dropped updates nor a rebase. The dropped updates were
  never durably checkpointed, so a late joiner or a connected peer silently
  misses content — the exact "never lose a collaborator's change" guarantee P16
  exists to protect. Realistic trigger: a reconnect flush of the 256-update
  offline queue pushes the log over the cap in one burst.
- *Why it matters:* silent partial content loss + divergence between clients;
  the mock violates the documented "pruned only at checkpoint" contract
  (architecture §26/§39) and breaks mock↔Supabase parity (the Supabase log is
  pruned only by `ws_collab_checkpoint`).
- *Fix:* remove the shift; prune only at checkpoint (`advanceCollabCheckpoint`),
  exactly mirroring the Supabase path. Growth between checkpoints is bounded by
  the 1.5 s checkpoint debounce in practice.
- *Regression test:* `collab-room.test.ts` — 201+ sends with no checkpoint; a
  member joining/polling from the frontier still receives **every** update; no
  silent loss.

**F2. No session-end checkpoint (documented trigger missing).**

- *Current behavior:* `CollabSession.stop()` clears the checkpoint timer and
  disconnects without a final checkpoint. The architecture (§25) lists "on
  session end" as a checkpoint trigger.
- *Failure/risk:* the durable workspace payload and P15 version history lag
  behind the last edits by the debounce window (or indefinitely when the session
  ends within the window). Consumers of the server payload (reload, dashboard
  state, version snapshots) can be stale by the last ~1.5 s of work.
- *Fix:* track `hasUncheckpointedLocalChanges`; on `stop()` (connected + canSend
  + not auth-lost + unsynced) run a best-effort `checkpointNow()` **before**
  tearing down. No-op when nothing is unsynced (no noisy saves on scope churn).
- *Regression test:* session with local changes stops before the debounce fires
  → a durable save was attempted with the projected state; a session with no
  changes makes no save call.

**F2b. Connect-failure path leaves pre-connect edits unpersisted (edit-loss
window).**

- *Current behavior:* `applyLocal` always runs `applyProjection()` (store gets
  the edit under the remote-projection flag) and, when `!connected`, stores the
  pending project. If `connect()` then fails, `start()` unregisters the hook and
  returns — the store **has** the user's pre-connect edits but `dirty` is false
  and no autosave was ever scheduled (the remote-projection flag suppressed the
  persistence subscription). Reload/close silently drops them.
- *Why it matters:* the P16 fix stopped *routing future mutations* into a dead
  session but did not make the *already-taken* edits durable.
- *Fix:* in the connect-failure catch, re-commit the pending local project
  through the normal store path (`setProject` + `setDirty`) so the autosave
  coordinator persists it locally (the honest fallback path).
- *Regression test:* `collab-session-connect.test.ts` — connect failure with a
  pre-connect edit → store dirty + local save scheduled.

**F3. Supabase collab transport lacks the bounded offline queue (parity gap).**

- *Current behavior:* the mock transport queues offline sends (256 / 2 MB) and
  flushes on reconnect (architecture §23/§32); the Supabase transport drops a
  send whose RPC fails — there is no queue and no replay on reconnect.
- *Failure/risk:* after a Supabase outage, offline edits exist only in the local
  doc and reach peers via the next checkpoint + their own re-subscribe, not
  live. Not permanent loss (checkpoints capture them durably), but a documented
  contract deviation that only the mock honors.
- *Fix:* mirror the mock's bounded queue + flush-on-reconnect in the Supabase
  transport (queue only while the channel is offline; authorization errors
  still propagate). Unit-tested against a mocked Supabase client.
- *Regression test:* new `supabase-collab-transport.test.ts` — offline sends
  queue (bounded), flush on re-subscribe, bounded-cap drop, authorization
  errors never queue.

### 4.2 Contract/defense gaps — will fix (cheap, honors documented contracts)

**F4. No per-room send rate limit in the mock room (architecture §39 documents
"mock rate-limit per room" but none exists).**

- A compromised editor client could flood the room log with tiny updates
  (log growth, poll amplification for peers). The size cap exists; frequency
  does not. Fix: `rateLimited` per room with a generous ceiling (never trips
  legit E2E/typing) in `handleCollabSend`; document the Supabase boundary (no
  native RPC rate limit — bounded by per-update size + log pruning).

### 4.3 Audited and correct — leave alone (documented)

- **Persistence transitions** (`project-controller`): dirty-flush blocking,
  safe delete order, revision tracking — correct, covered by tests.
- **Workspace authorization** (mock `requireMember/requireOwner/requireEditor`;
  Supabase SECURITY DEFINER + `ws_is_member/ws_role/ws_is_owner`; actor always
  `auth.uid()`; client role never trusted): correct.
- **Collab RLS migration:** join/list member-gated, append/checkpoint
  editor/owner, lock owner-only, size caps on decoded bytes, seed first-writer-
  wins via `ON CONFLICT DO NOTHING`, canonical state refreshed before pruning.
- **Version restore:** owner-only RPC + optimistic concurrency; mock restore
  resets the room (canonical state cleared, log pruned, frontier bumped).
- **Publishing:** publish uses the live (projected) store content — correct
  content by construction; client in-flight lock + server idempotency; rollback
  confirmation. Publishing does not mutate project content.
- **Update dedupe / replay:** Yjs idempotence; seq dedupe in both transports;
  malformed updates ignored; prototype-pollution keys stripped by normalizer.
- **Offline queue bounds + permission-loss discard:** already correct.

## 5. Prioritized hardening areas

1. **Collaboration data integrity (F1)** — never silently drop an un-checkpointed
   update; prune only at checkpoint (Supabase parity).
2. **Collaboration session boundaries (F2 + F2b)** — session-end checkpoint;
   connect-failure edit fallback.
3. **Offline/reconnect parity (F3)** — Supabase transport offline queue.
4. **API robustness (F4)** — per-room send rate limit in the mock.
5. **Security re-review** of the touched surfaces (auth never weakened).
6. **Documentation** — P17 architecture + report.

## 6. Architecture decisions

- **D1 — The room never drops what it hasn't durably saved.** Retention policy =
  "prune at checkpoint" on both transports. Memory in the dev-server mock is
  bounded by the checkpoint debounce; correctness is never traded for a cap.
- **D2 — Session teardown is durable.** `stop()` finalizes unsynced local work
  before disconnect (best-effort; no-op when clean). Scope churn never causes
  noisy saves.
- **D3 — Connect failure falls back to standard persistence honestly.** The
  store's pre-connect edits become a normal local autosave (recovery-visible),
  and no mutation is routed into a dead session (P16 fix preserved).
- **D4 — Offline behavior is transport-uniform.** The Supabase transport gets the
  same bounded queue + flush ordering as the mock (queue first, then catch-up).
- **D5 — No schema/migration changes.** F1–F4 are behavioral fixes in the mock
  server, the session, and the transports. The Supabase migration already
  encodes the correct contract; no RLS change is needed.

## 7. Security boundaries (unchanged, re-verified)

- Actor identity is always server-derived (session token / `auth.uid()`); forged
  `actorClientId`, role, workspace, project in the request body are ignored or
  rejected. F1/F2/F4 do not touch this.
- F2b must not bypass authorization: the connect-failure fallback writes to the
  **local** persistence adapter only — it is not a server write and requires no
  role escalation. A viewer never sends (the hook is only registered for
  canSend), so F2b cannot be triggered by a viewer.
- F3 queues only transient (offline) failures; authorization errors propagate
  and trigger the existing read-only transition — queued uploads after
  permission loss remain impossible (server rejects every send regardless).
- No new client-trusted inputs are introduced.

## 8. Failure/recovery model

| Failure | Recovery |
|---|---|
| Room log at cap (F1) | Never dropped — log pruned only at checkpoint; late joiners replay from the frontier |
| Session ends with unsynced edits (F2) | Final best-effort checkpoint before disconnect |
| Connect fails with pre-connect edits (F2b) | Store falls back to standard autosave (local, recovery-visible) |
| Supabase outage mid-edit (F3) | Offline queue (bounded) flushed on re-subscribe; idempotent Yjs merge |
| Authorized flood of sends (F4) | Per-room rate limit (mock); Supabase bounded by size caps + pruning |

## 9. Persistence/data-integrity strategy

- The canonical Project payload remains the only durable format; no CRDT
  internals are persisted.
- F1 restores the "checkpoint = the only prune event" invariant; F2 restores
  "session end = a checkpoint trigger"; F2b restores "an edit is never left in a
  store without a persistence path".
- Any change touching the save path (F2/F2b) ships with a regression test.

## 10. Collaboration reliability strategy

- Preserve the Yjs/canonical-state model untouched. Fix the *retention*, *session
  boundary*, and *offline-parity* semantics around it.
- F1: identical behavior on both transports (prune at checkpoint only).
- F2: session-end durability for the debounce window.
- F3: uniform offline queue semantics across transports.

## 11. API hardening strategy

- F4 adds the documented per-room rate limit to the mock collab backend.
- Body parsing, size caps (decoded bytes), auth derivation, and member checks
  are already correct in `/api/collab`; re-verified during implementation.

## 12. Publishing safety strategy

- Audited: publish reads the live projected store content (correct by
  construction), never mutates the project, uses client in-flight lock +
  server-side idempotency, and rollback requires confirmation. No changes.
- Documented boundary: a collaborative session's durable checkpoint may lag the
  live projection by ≤ the debounce window; publishing uses the live projection,
  so published content is never stale.

## 13. Testing strategy

- **F1:** `collab-room.test.ts` — no-checkpoint overflow keeps every update
  reachable; poll/join from the frontier sees all; checkpoint pruning still
  bounds the log.
- **F2:** `collab-session-connect.test.ts` — unsynced session stop triggers a
  final save; clean session stop does not.
- **F2b:** same file — connect failure with pre-connect edits marks the store
  dirty and schedules a local save.
- **F3:** new `supabase-collab-transport.test.ts` (mocked Supabase client) —
  queue/ flush / cap / auth-error propagation.
- **F4:** `collab-room.test.ts` — burst of sends beyond the ceiling is
  `RATE_LIMITED`; normal rates pass.
- **Regression gates:** `npx tsc --noEmit` → `npm run lint` → `npm test` →
  `npm run build`; affected collab E2E (realtime-collaboration,
  realtime-reconnect, realtime-permissions); then the full E2E regression
  (`test:e2e`, `test:e2e:matrix`, `test:e2e:fallback`, `test:export-build`)
  sequentially. Expensive suites run sequentially, never concurrently.

## 14. Performance considerations

- F1: removing the shift has negligible cost; the log is pruned at each
  checkpoint as before, so steady-state memory is unchanged (bounded between
  checkpoints by the debounce).
- F2: one extra save per session end **only when unsynced** — no per-keystroke
  cost, no scope-churn noise.
- F3: queue operations are O(1) pushes; flush is the same bounded loop as the
  mock.
- F4: `rateLimited` is a small timestamp scan per send (generous ceiling).

## 15. Observability considerations

- No new observability infrastructure is added (no new dependencies).
- Existing honest status (Synced/Syncing/Offline/Reconnecting/Error) remains the
  user-visible signal; F2/F3 keep that status truthful (a final checkpoint on
  stop never misreports).
- Console errors in the mock API routes remain the dev signal for handler
  failures.

## 16. Explicit non-goals

- No new product features; no P18 work (cursors, offline-first local CRDT
  storage, dashboard presence, Supabase Realtime live verification, etc.).
- No CRDT/architecture replacement; no canonical-state model changes.
- No schema/RLS migration changes.
- No redesign of publishing, version history, presence, or recovery.
- No dependency additions.
- No changes to tests merely to make new work pass; existing tests are preserved.

## 17. P17 implementation phases

1. **F1** — mock room retention: remove pre-checkpoint shift + regression test.
2. **F2 + F2b** — session-end checkpoint + connect-failure edit fallback +
   regression tests.
3. **F3** — Supabase transport offline queue + unit tests.
4. **F4** — per-room send rate limit (mock) + test.
5. **Security re-review** of the touched surfaces.
6. **Validation** — tsc/lint/unit/build, affected E2E, full E2E regression.
7. **Documentation** — this document + `docs/phase-p17-report.md`.

## 18. P17 exit criteria

- F1–F4 implemented with regression tests; no P16 test removed.
- `npx tsc --noEmit` clean; `npm run lint` clean; `npm test` clean; `npm run
  build` clean.
- Affected collab E2E specs green; full E2E regression green (`test:e2e`,
  `test:e2e:matrix`, `test:e2e:fallback`, `test:export-build`).
- Security review complete (authorization boundaries unchanged/strengthened).
- `docs/phase-p17-report.md` written. P18 not started.
