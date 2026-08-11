# Phase P16 — Report: Real-Time Collaborative Editing

Branch: `phase-p16-realtime-collaborative-editing`
Design document: `docs/phase-p16-architecture.md` (written before implementation).

Phase P16 makes workspace projects **simultaneously editable**: multiple
authorized editors open the same project at the same time, make compatible
edits concurrently (including character-level text), see remote changes live
without reload, and keep per-user undo/redo. It is built on the P14
server-authoritative workspace model and the P15 presence/activity/version
stack, and replaces the P14 exclusive edit lease for ordinary editing with a
Yjs CRDT room while retaining the lease endpoints as the owner-only
**maintenance lock** (version restore / import).

---

## 1. Delivered

- **Yjs collaboration engine** — one `Y.Doc` per workspace project with a
  strict `Project ↔ Y.Doc` mapping (`collab-doc.ts`): every object → `Y.Map`,
  array → `Y.Array`, string → `Y.Text`, scalars kept plain; identity arrays
  (pages, sections, assets, block nodes) diff by stable id; minimal-op
  `reconcileProject` (idempotent — `reconcile(doc, toProject(doc))` applies
  zero ops).
- **Canonical shared state** — the room owns a canonical Yjs state (base64),
  seeded first-writer-wins and refreshed on every durable checkpoint, so all
  clients share **identical structs** (no content duplication on merge).
- **CollabSession** (`collab-session.ts`) — session lifecycle owning the
  Y.Doc, an undo-scoped `Y.UndoManager`, the transport, the editor commit
  hook, the projection loop, durable checkpoints, and the maintenance lock.
- **Editor integration** — the store routes every mutation through a single
  choke point (`withHistory`); in collaborative mode that becomes ONE CRDT
  transaction with a local origin (undo-scoped), and the projection loop
  writes the store back via `applyRemoteProject` behind the
  `beginRemoteProjection/endRemoteProjection` flag so the persistence
  controller never treats a remote projection as a local edit.
- **Transports** — mock (HTTP polling over `/api/collab/rooms/...`, state in
  the dev-server process shared across browser contexts) and Supabase
  (Realtime Broadcast + RPCs, mirroring the mock contract).
- **Honest sync UI** — `CollabStatusIndicator` in the TopNav (Synced /
  Syncing / Offline / Reconnecting / Error, always text — never color alone),
  plus a batched, debounced remote-change hint (no per-character toasts).
- **P14 transition** — ordinary editing no longer requires the exclusive
  lease; the lease endpoints remain and the maintenance lock (owner-only)
  coordinates destructive operations (restore). P15 presence stays truthful
  (both editors show "editing" now), activity stays meaningful, versions stay
  checkpoint-based, restore stays safely exclusive.

## 2. Canonical-state design (the central discovery)

The core P16 problem: two editors each open the same project and build a
`Y.Doc` from the durable base locally. When their first updates merge, the two
docs share content but have **different struct IDs** for identical values
(`initFromProject` builds fresh structs on each client). Applying update A to
doc B therefore creates *duplicate* content instead of converging.

The fix is a **canonical shared Yjs state** owned by the room:

- `POST /rooms/[ws]/[pid]/seed` — the first editor/owner to join uploads its
  init state; **first writer wins** (atomic in the mock via a single check-then-set
  in the server process; the Supabase path stores the canonical state row with
  the same one-row semantic). A loser receives the winner's state and re-applies
  it via `Y.applyUpdate` — identical structs from that point on.
- Every durable checkpoint (`POST /rooms/.../checkpoint` with the encoded
  converged state) refreshes the canonical state **before** pruning the log, so
  late joiners and reloads converge to the identical struct set.
- Version restore **resets the room** (canonical state cleared, log pruned,
  frontier bumped) so every client re-inits from the restored durable base.

This is why independently initialized Yjs docs are unsafe and why the room
seed is mandatory: without it, concurrent merges duplicate content and
reloads can show blank or doubled state.

## 3. Yjs/CRDT design

- **Text** — strings are `Y.Text`; `diffText` computes a minimal
  common-prefix/suffix middle replace, applied as Y.Text delete+insert inside
  the caller's transaction. Yjs merges concurrent edits by position (YATA):
  A inserts "beautiful " at 6 while B inserts "!" at 11 in "Hello world" →
  deterministic "Hello beautiful world!" — no last-write-wins whole-string
  loss. Proven by `collab-doc.test.ts` text-concurrency tests and the
  `realtime-text-collaboration` E2E.
- **Structure** — identity arrays sync by id: insert/delete/move/update with
  a cursor scan. Concurrent inserts both survive in deterministic document
  order; the normalizer renumbers section `order` contiguously and prunes
  orphans/cycles/duplicates deterministically.
- **Reorder bug + fix (genuine bug found in-session)** — Yjs v13
  `Y.Array.delete()` returns `void`, and an already-integrated child type
  cannot simply be deleted and reinserted (its `_prelimContent` is nulled on
  first integration, so re-insert throws). The old move path destructured the
  delete return and re-inserted the same live element. Fixed by rebuilding the
  moved element from its **current merged** JSON (`yjsToJson` of the live
  element) and inserting fresh structs at the target position. Concurrent
  edits to *other* elements survive; edits inside the moved element follow the
  documented structural delete-wins policy. Locked in by the
  "concurrent move/reorder is deterministic and never duplicates" regression
  test in `collab-doc.test.ts`.
- **Projection** — every read runs through `normalizeProject` (deterministic,
  idempotent, bounded — depth 12 / 1000 nodes / 10k chars) so malformed or
  hostile remote state can never crash the editor or produce an invalid tree.

## 4. Undo isolation

- `Y.UndoManager` is constructed with `trackedOrigins = { localOrigin }` where
  `localOrigin = "collab-local:{clientId}"`. Local store mutations become one
  CRDT transaction with that origin; remote updates apply with
  `"collab-remote:{actor}"` and are never tracked.
- Undo/redo route through the commit hook to the Yjs manager — a user undoes
  only their own work; remote changes never enter a peer's undo stack.
- The editor store's `canUndo/canRedo` delegate to the session's manager while
  collab is active, so the TopNav/undo UI stays honest.
- `collab-undo.test.ts` covers: A's undo leaves B's concurrent edit intact,
  remote updates never pollute the local stack, an AI-style multi-op
  transaction undoes as one logical action, redo restores only local work.

## 5. Reconnect / offline

- **Bounded offline queue** (count 256 / 2 MB) in the mock transport: offline
  sends queue locally (Yjs updates are idempotent); on reconnect the queue
  flushes **before** applying room updates, then normal polling resumes. The
  E2E `realtime-reconnect.spec.ts` forces disconnect/reconnect via the
  test-controls bridge (`__buildoraCollabTestControls`, mock/dev only) and
  asserts both clients converge with no duplicate updates and no lost edits.
- **Rebase** — a poll that falls behind the pruned frontier returns
  `rebase: true` with the durable base; the client re-inits from the base
  (never a silent gap, never a fake overwrite).
- **Permission loss blocks queued uploads** — every send/checkpoint is
  server-authorized; a removed/downgraded member's queued or in-flight
  updates are rejected (403/`PERMISSION_DENIED`), the session stops, and the
  editor transitions to an honest read-only state. Verified by
  `realtime-permissions.spec.ts` (downgrade/removal while open, forged sends).

## 6. Permissions

| Action | Owner | Editor | Viewer | Non-member |
|---|---|---|---|---|
| Join / poll room | ✅ | ✅ | ✅ (live read-only) | ✗ |
| Seed canonical state | ✅ | ✅ | ✗ | ✗ |
| Send updates / checkpoint | ✅ | ✅ | ✗ | ✗ |
| Maintenance lock (restore/import) | ✅ | ✗ | ✗ | ✗ |

- Actor is always derived from the session token — a forged
  `actorClientId`/workspace/project/user in the body is ignored or rejected.
- Size caps on updates/state (256 KB decoded) reject oversized payloads.
- Cross-workspace/project isolation via scoped keys + membership checks on
  every handler.

## 7. P14/P15 integration

- **P14 lease → maintenance lock.** Ordinary editing no longer acquires the
  exclusive lease; the session is editable as soon as access resolves to
  editor/owner. The lease endpoints remain for backward compatibility and are
  reused as the owner-only maintenance lock for restore/import (the restore
  dialog acquires it around the destructive operation; concurrent realtime
  writes pause with `LOCKED` and resume after unlock).
- **P15 presence** — both simultaneous editors show "editing" (server-truthful,
  never self-claimed); viewers show "viewing". Updated `workspace-presence`
  E2E asserts both-editing cross-observation.
- **P15 versions** — durable checkpoints are the version/activity integration:
  each checkpoint is the schema-validated canonical projection saved with
  optimistic concurrency; identical saves stay silent (no redundant version,
  no duplicate `project.saved`); restore resets the room so every client
  rebases from the restored durable base (a genuine bug was found and fixed
  here — see §12.3).

## 8. Persistence / checkpointing / compaction

- **Checkpoint** — debounced (1.5 s) durable save of the projection with
  `expectedRevision` optimistic concurrency and one bounded STALE retry
  (refetch revision, retry once); on success the local IndexedDB cache +
  metadata are refreshed and the room is checkpointed (canonical state
  refreshed, log pruned to the frontier).
- **Compaction** — the room retains at most 200 updates; every checkpoint
  advances `checkpointSeq` and prunes below it; the canonical state is
  refreshed **before** pruning so a late joiner always has a full state to
  apply. Polls behind the frontier get a rebase, never a silent gap.
- **Restore atomicity** — restore writes a pre-restore safety version, applies
  the snapshot as a new revision, records `project.version_restored`, and
  resets the room in the same server transaction (mock) — a failed checkpoint
  can never lose the update history, and the canonical state is cleared so
  late joiners cannot apply pre-restore structs.
- **Supabase parity** — the migration mirrors the mock: room state row,
  size-bounded `bytea` updates (`octet_length` > 256 KB rejected), first-seed
  wins, checkpoint pruning, owner-only lock RPC, membership-gated reads.

## 9. Files created

- `docs/phase-p16-architecture.md`
- `src/app/api/collab/[[...path]]/route.ts` (mock-only room backend)
- `src/features/collaboration/` — `types.ts`, `editor-commit-hook.ts`,
  `crdt/collab-doc.ts`, `crdt/text-diff.ts`, `crdt/tree-normalizer.ts`,
  `services/collab-session.ts`, `services/collab-session-registry.ts`,
  `hooks/useCollaborationSession.ts`, `store/collab-ui-store.ts`,
  `components/CollabStatusIndicator.tsx`,
  `transport/collab-transport.ts`, `transport/collab-transport-factory.ts`,
  `transport/mock-http-collab-transport.ts`,
  `transport/supabase-collab-transport.ts`,
  `__tests__/collab-doc.test.ts`, `collab-undo.test.ts`,
  `collab-security.test.ts`, `collab-room.test.ts`,
  `collab-session-connect.test.ts`
- `e2e/helpers/collab.ts`, `e2e/realtime-collaboration.spec.ts`,
  `e2e/realtime-text-collaboration.spec.ts`, `e2e/realtime-structure.spec.ts`,
  `e2e/realtime-undo.spec.ts`, `e2e/realtime-reconnect.spec.ts`,
  `e2e/realtime-permissions.spec.ts`
- `supabase/migrations/20260813000001_collab_updates.sql`

## 10. Files modified

- `package.json` / `package-lock.json` — added `yjs`
- `src/app/editor/[projectId]/page.tsx` — `useCollaborationSession`
- `src/components/editor/TopNav.tsx` — `CollabStatusIndicator`
- `src/features/editor/store/editor-store.ts` — collab commit routing,
  `applyRemoteProject`, `clearCollaborativeProjection`, undo delegation
- `src/features/persistence/services/project-controller.ts` —
  `isRemoteProjection` guard on the store subscription
- `src/features/workspaces/` — `types.ts`, `errors.ts`,
  `mock/mock-workspace-server.ts` (collab rooms + restore room reset),
  `components/RestoreVersionDialog.tsx` (maintenance lock),
  `hooks/useWorkspaceEditorAccess.ts` (no exclusive lease; maintenance lock)
- P14/P15 E2E specs updated for P16 semantics: `workspace-edit-lease.spec.ts`,
  `workspace-presence.spec.ts`, `workspace-version-history.spec.ts`,
  `workspace-collaboration.spec.ts`
- `e2e/helpers/workspaces.ts` — 20 s waits (cold-compile headroom, no assertion
  changes)
- `vitest.config.ts` — `testTimeout: 10_000` (pre-existing load-sensitive
  `userEvent.type` tests; timeout only, no assertion changes)

## 11. Security review (post-implementation)

Reviewed every P16 surface against the architecture checklist (§38/§39):

- **Canonical room state** — first-writer seed atomic (mock: in-process
  check-then-set; Supabase: single canonical row); workspace/project/member
  scoped; malformed base64/state rejected (`PAYLOAD_INVALID`) or caught on
  apply; canonical state size-capped; bounded log (200) + pruned frontier.
- **CRDT / structure** — hostile payloads cannot crash the projection
  (normalizer bounds + repair; prototype-pollution keys dropped — tested);
  no duplicate/orphan/cyclic nodes (normalizer prunes deterministically —
  tested); move/reorder deterministic (regression-tested); delete-vs-edit
  policy documented (structure delete wins; text merges); simultaneous
  inserts deterministic.
- **Text** — same-field concurrent edits retain both contributions (no
  last-write-wins whole-string loss) — unit + E2E proven.
- **Undo** — local-user only; remote edits excluded; correct Yjs transaction
  origin; AI multi-op transactions undo as one action.
- **Checkpoint/compaction** — canonical state persisted **before** pruning;
  failed checkpoint cannot lose history (save must succeed first); update log
  bounded.
- **Permissions** — viewer cannot send/seed/checkpoint; removed members
  blocked; downgraded editors blocked; queued offline updates cannot upload
  after permission loss; forged role/workspace/project/user denied — all
  covered by `collab-room.test.ts` + `realtime-permissions.spec.ts`.
- **Lifecycle** — project/workspace/account switch + sign-out tear down the
  old session (cleanup registered on every effect run — StrictMode-safe);
  old `Y.Doc` observers detached before `destroy()`; `UndoManager` rebound to
  the current doc on canonical-state re-init; test-control global cleared on
  teardown.
- **Privacy** — collab state/updates contain only the project payload:
  no auth tokens, review/share tokens, Copilot memory, recovery snapshots,
  deployment secrets, or unnecessary member metadata (the payload shape is the
  same validated Project used everywhere; asserted by construction).
- **Export/publish** — no Yjs internals leak (no `yjs` imports in
  publishing/export; publish/export read the validated store project, which is
  the normalized canonical projection).

**Findings fixed this session:**

1. **Genuine bug — commit-hook leak on connect failure (high value).**
   `CollabSession.start()` registers the commit hook *before* joining the
   room so the user can type during the connect window. If `connect()` then
   throws (server down / session expiry race), the old code returned with the
   hook still registered — every subsequent store mutation routed into a
   disconnected session (`pendingLocalProject` last-wins, no checkpoint, no
   dirty flag) and edits were silently lost until unmount. Fixed by
   unregistering the hook in the connect `catch` so the editor falls back to
   the standard local persistence path. Regression test added
   ("a failed connect unregisters the commit hook") in
   `collab-session-connect.test.ts`.
2. **Minor — size caps measured the base64 string, not the decoded payload.**
   Seed/send/checkpoint caps used `TextEncoder().encode(base64).length`,
   admitting ~192 KB of decoded state under a 256 KB cap and mismatching the
   Supabase `octet_length(bytea)` contract. Fixed by decoding before
   measuring (malformed base64 → `PAYLOAD_INVALID`); fixtures updated to real
   oversized base64 while preserving the exact `PAYLOAD_TOO_LARGE` assertion.

## 12. Genuine findings and fixes (this session)

1. **Yjs reorder crash (genuine CRDT bug)** — see §3. Fixed by rebuilding the
   moved element from current merged content; regression test added.
2. **Connect-window edit loss (genuine product bug)** — see §11 finding 1
   (replay of pre-connect edits was already handled; the connect-failure path
   was not). Fixed + regression test.
3. **Version restore room reset (genuine integration bug, found via E2E).**
   `workspace-version-history.spec.ts` failed after restore: the server and
   room were correct but a stale client could re-project pre-restore content.
   Root cause was two-fold: the restore path now resets the room (canonical
   state cleared, log pruned, frontier bumped) so every client rebases from
   the restored base — and the mock restore handler was verified to clear
   `canonicalState` + `updates` (with `collab-room.test.ts` coverage:
   "restore clears the canonical state and prunes the log"). The remaining
   E2E failures were traced to a degraded dev server (see §14) — after a
   fresh server the spec passed unchanged (33.0 s).
4. **Dev-server degradation vs cold compiles** — the first `version-history`
   failures were cold webpack compiles (13.5 s `/`, 6.5 s `/api/workspaces`,
   6.1 s `/api/share`) blowing 10 s helper waits; bumped helper waits to 20 s
   (no assertion changes) and warmed routes before E2E runs.
5. **Pre-existing load-sensitive unit tests** — `import-project-dialog*.test.tsx`
   long-string `userEvent.type` tests crossed Vitest's 5 s default per-test
   timeout only under full-suite CPU contention (pass in isolation every
   time; git-clean; unrelated to P16). Fixed with `testTimeout: 10_000` in
   `vitest.config.ts` (infrastructure change only — zero assertion changes).

## 13. Validation results (exact)

Run sequentially, never concurrently:

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | ✅ clean |
| `npm run lint` | ✅ clean (0 errors, 0 warnings) |
| `npm test` | ✅ **3907 passed** (280 files) — includes 58 collaboration tests (5 files) |
| `npm run build` | ✅ success |
| P16 E2E (6 specs, chromium, workers=1) | ✅ **6/6 passed** (collaboration, text-collaboration, structure, undo, reconnect, permissions) |
| P14/P15 regression E2E (4 specs) | ✅ **4/4 passed** (edit-lease, presence, version-history, collaboration) |
| `npm run test:e2e` (full, chromium, workers=1) | ✅ **117/117 passed** (11.9 m) |
| `npm run test:e2e:matrix` | ✅ **13/13 passed** (4.4 m) |
| `npm run test:e2e:fallback` | ✅ **1/1 passed** (16.8 s) |
| `npm run test:export-build` | ✅ **1/1 passed** on rerun (first attempt timed out on a cold `npm install` inside the generated temp project — environment flake, same code, rerun green in 71 s) |

## 14. Environmental / session incidents

- **Session expiry mid-regression.** The full `test:e2e` suite was running in
  the background (one log) when the previous session expired. On resume the
  process had already **completed: 117/117 passed** — no duplicate run needed.
- **Degraded dev server.** After ~4,700 log lines of HMR churn, the long-lived
  webpack server produced nondeterministic workspace/version flows (cold
  compiles mid-test, a B-dashboard that never signed up). Stopped the stale
  server, started one fresh server, warmed routes, and reran — all P16 and
  P14/P15 specs passed.
- **Cold-compile timeouts.** First hits of `/`, `/api/workspaces`, `/api/share`,
  and `/api/collab` took 6–14 s on Windows; helper waits were raised to 20 s
  (timeout only, no assertion changes) so full regression runs are not flaky
  against cold compiles.
- **export-build cold npm install.** The first `test:export-build` attempt
  exceeded the 180 s test budget during `npm install` in the generated temp
  project; the rerun passed in 71 s (network/cache dependent, not product).
- **Pre-existing unit-test flake.** See §12.5 — fixed via timeout headroom.

## 15. Known limitations

- Moves/reorders of a section concurrently being edited inside: edits inside
  the moved element follow the documented delete-wins structural policy
  (concurrent edits to *other* elements always survive).
- The offline path is bounded by design: exceeding the queue cap drops excess
  edits, and the session falls back to rebase-from-checkpoint on reconnect
  (never a corrupt merge).
- Supabase Realtime end-to-end verification requires a live project with
  credentials; semantics are validated through the mirroring mock (repo
  convention).
- One session per tab (per `(workspace project × tab)`); presence/cursors are
  P15/P16-separate concerns (presence remains lease-derived/truthful, remote
  cursors are not shipped).
- No WCAG certification claim.

## 16. Genuine P17 candidates (only)

- Remote cursors / selection sharing, offline-first local persistence of the
  CRDT with full offline-merge (beyond the bounded queue), presence on the
  dashboard workspace view, cross-project realtime awareness, Supabase
  Realtime live verification with credentials, version visual diffing.
  P17 not started.
