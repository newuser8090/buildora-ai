# Phase P16 — Real-Time Collaborative Editing: Architecture

Branch: `phase-p16-realtime-collaborative-editing`
Status: **Design document — written before implementation, per the P16 critical rule.**

---

## 1. Product goal

Buildora workspace projects become **simultaneously editable**. Multiple authorized
workspace editors can open the same project at the same time, see each other, make
compatible edits concurrently (including character-level text), see remote changes
live without reload, and keep per-user undo/redo. P14 permission boundaries, P15
presence/activity/version history, publishing, export, AI, and personal projects all
remain correct.

## 2. Why P16 is now possible

- P14 built server-authoritative workspace projects with optimistic concurrency
  (revision + `expectedRevision`) and an **exclusive edit lease** that made
  simultaneous editing impossible by design.
- P15 added live presence (server-derived modes), a durable activity feed, and
  server-backed version history with restore-as-new-revision.
- The editor already funnels **every** mutation through a single store boundary
  (`useEditorStore` actions → `withHistory(state, mutate)`), with pure, validated
  structure helpers (page/section/block/inline-field). This makes a single choke
  point for CRDT interception feasible without rewriting the editor.
- The provider abstraction (mock HTTP + Supabase) and the deterministic
  mock-cloud architecture (state in the dev-server process, shared across browser
  contexts) give us a proven harness for multi-user E2E.

## 3. Collaboration data model

A workspace project gets a **collaborative document** (a `Y.Doc`) whose shape
mirrors the canonical `Project`:

```
Y.Doc root (Y.Map)
  id: string                     (scalar — immutable)
  name: Y.Text                   (collaborative text)
  createdAt / updatedAt: string  (scalars — server metadata)
  theme: Y.Map                   (nested maps/arrays/scalars; strings → Y.Text)
  siteSettings: Y.Map            (same rules as theme)
  assets: Y.Array of Y.Map       (each asset has a stable id)
  pages: Y.Array of Y.Map
    page: Y.Map
      id: string
      title: Y.Text
      slug: string
      meta: Y.Map
      sections: Y.Array of Y.Map
        section: Y.Map
          id: string
          type: string
          order: number
          visible: boolean
          props: Y.Map           (recursive: objects→Y.Map, arrays→Y.Array, strings→Y.Text, numbers/bools→scalar)
          styles: Y.Map          (same rules as props)
```

**Uniform string rule:** every JSON string becomes a `Y.Text` node (character-level
CRDT merge); numbers, booleans, and nulls are plain scalars. This makes text
editing — headlines, nav links, feature lists, pricing, FAQ, block-tree text — truly
collaborative with zero per-field special-casing. `href`, `assetId`, `slug`, and
other "identity-ish" strings are still `Y.Text` (they merge deterministically;
validation at projection clamps invalid output), but they are not user-edited
character-by-character in practice.

## 4. CRDT/OT/operation-log decision

**CRDT (conflict-free replicated data type), using the YATA family via Yjs.**
Chosen over OT and over custom operation logs:

- **OT** requires a central serialization point, per-operation transforms, and a
  server that understands every operation type. We have a *tree of heterogeneous
  content* (pages/sections/blocks/text/props); OT transforms for that shape are an
  entire research project.
- **CRDT** gives commutative, associative, idempotent merges — exactly the
  "never lose a collaborator's change" guarantee P16 requires, with no central
  ordering authority.
- A custom operation log (P14-style revision bumps) is what we already have; it
  cannot merge concurrent text/structure edits without last-write-wins loss.

## 5. Library/dependency decision

**Yjs (`yjs` ^13.6.32)** — the only new runtime dependency.

| Criterion | Yjs | Automerge 2 |
|---|---|---|
| Runtime | Pure JS (~18 KB gzipped core) | Rust→WASM (~320 KB gzipped) |
| Undo scoped per user | **`Y.UndoManager` with `trackedOrigins`** | Not built in — custom |
| Collaborative text | `Y.Text` (YATA), mature | Peritext, evolving |
| Structured doc | `Y.Map`/`Y.Array` nested | POJOs in `change()` |
| Offline/reconnect | updates merge idempotently | branch/merge model |
| Ecosystem/maturity | Industry standard (Proton, AFFiNE, Jupyter, Gitbook) | Growing (Ink & Switch) |
| Bundle/SSR risk in Next.js | None (pure JS) | WASM init + bundling |

`Y.UndoManager`'s origin-scoped undo is the deciding factor: P16 requires "A's undo
must not undo B's work," and Yjs provides exactly that with `trackedOrigins = {local}`.
Yjs runs identically in browser and Node, so the mock backend can also merge updates
deterministically (it can even hold its own `Y.Doc` when useful). Version 13.6.32 is
the current stable (verified via npm); dependency is `yjs` + `lib0` (transitive).

## 6. Why that model was chosen

1. **No corruption risk in the tree.** Yjs arrays/maps converge even under
   concurrent add/delete/move; combined with a deterministic normalization layer
   (see §7) the invariant guarantees in the prompt hold.
2. **Per-user undo for free.** `Y.UndoManager` + transaction origins is the exact
   P16 requirement, battle-tested in production editors.
3. **Deterministic mock parity.** Yjs is pure JS — the mock server can apply the
   same updates as the browser, making multi-context E2E deterministic.
4. **Text collaboration.** `Y.Text` merges concurrent edits character-wise
   ("Hello world" + "beautiful" + "!" → deterministic combined text).
5. **Offline/reconnect.** Updates are idempotent; a rejoining client applies a
   snapshot + queued updates and converges.

## 7. Canonical collaborative document

One `Y.Doc` per workspace project, keyed `collab:{workspaceId}:{projectId}`. The
doc is **the live source of truth** while a collaborative session is open. Durable
state (see §26) is derived from it. The doc contains **only project content** — no
members, roles, tokens, emails, presence, or awareness data (§37 privacy).

## 8. Project ↔ collaborative document mapping

- `initFromProject(doc, project)` — build/replace the doc from a canonical Project
  (used on open, version restore, import).
- `toProject(doc)` — pure projection `Y.Doc → Project` (plain JSON, deterministic),
  then **validate + normalize** (see §7/§27) before anything consumes it.
- `reconcileProject(doc, nextProject)` — compute the current JSON state, diff it
  against the desired `nextProject`, and apply minimal Yjs ops in **one local
  transaction**. This is the single write path for local edits (see §14).
- The projection is the **only** way the editor store receives document state
  (`applyRemoteProject`), so remote and local application share one validator.

## 9. Node identity model

Identity is preserved from the existing model — **no re-derivation from array
index, ever**:

- **Page identity:** existing `page-*` ids (`createPageId`).
- **Section identity:** existing `section-*` ids (`createSectionId`).
- **Block identity:** existing `block-*` ids (`createBlockId`) inside
  `BlockTree.rootIds`/`nodes` — the block tree already has stable ids and
  `parentId` links, which Yjs maps 1:1 (see §13).
- **Asset identity:** existing asset ids.

New objects are created through the same factories; collisions are impossible by
construction (timestamp + counter) and the normalizer rejects/repairs any duplicate
it ever sees (defense in depth).

## 10. Page identity

Pages are `Y.Array` elements whose `id` is a scalar inside the page `Y.Map`. Array
diffing is **id-stable**: reconcile matches old/new by `id` and applies
insert/delete/move operations, never index arithmetic. Concurrent page insert at
the same position → both pages survive in deterministic order. Route slugs are
re-derived by the existing `resolveUniqueSlug` at projection when a rename creates a
conflict; concurrent renames converge to one deterministic slug per unique title
(see §11).

## 11. Section identity

Sections live in `page.sections` (`Y.Array`), matched by `id` for reconcile. The
`order` field is recomputed deterministically at projection
(`normalizeSectionOrders`), so concurrent reorders converge even if intermediate
states disagree. Singleton policy (header/footer) is re-validated at projection:
duplicates created by races are resolved deterministically (keep the first by id
order) and this is a documented, bounded repair (never invented content).

## 12. Block identity

`BlockTree` (`rootIds: string[]`, `nodes: Record<id, BlockNode>` with `parentId` +
`children`) maps to Yjs as: `props.tree → Y.Map { rootIds: Y.Array<string>, nodes:
Y.Map<id → Y.Map> }`. Block ops (insert/delete/move/duplicate/props/style) flow
through the existing `applyBlockOperation` engine (validates before commit), then
the folded `BlockTree` reaches the doc via the normal `commitBlockTree` path — one
reconcile transaction. The block tree normalizer (§7/§30) enforces: unique ids, one
parent, no dangling children, no cycles, valid roots.

## 13. Text collaboration model

- Every string is a `Y.Text`. Edits arrive as **minimal text diffs** computed by
  `diffText(oldString, newString)` (common-prefix/suffix extraction → a single
  `delete+insert` in the middle) and applied inside the local transaction.
- Because Yjs merges `Y.Text` operations by character position (YATA), two users
  editing the same field concurrently both survive: "Hello world" → A inserts
  "beautiful " at position 6, B inserts "!" at 11 → converged "Hello beautiful
  world!".
- The existing inline editor (`updateEditableFieldValue`) commits whole values; in
  collaborative mode that commit becomes a text diff (not a whole-string LWW
  replace), preserving concurrent contributions.
- `href`/asset strings are `Y.Text` too but are not character-edited by users;
  validation at projection clamps malformed output.

## 14. Tree collaboration model

The **editor store remains the mutation API** (all existing validation, pure
helpers, AI plan application, block engine). A **collab commit hook** intercepts the
store's single commit boundary:

- `withHistory(state, mutate)` — if a collab hook is registered, the computed next
  Project is sent to `hook.applyLocalProject(nextProject)` which calls
  `reconcileProject(doc, nextProject)` in one transaction with origin
  `local:{clientId}`. No local history push.
- The doc observer fires `toProject(doc)` → validated/normalized Project →
  `useEditorStore.applyRemoteProject(project)` which replaces `project` +
  `history.present` **without** pushing to `history.past` and **without** marking
  dirty for remote changes.
- `updateSection*`, `updateEditableFieldValue`, `commitBlockTree`, `applyAiEditPlan`,
  asset ops, page ops, site settings — all funnel through the same hook, so the
  **entire existing mutation surface is collaborative automatically**.
- Feedback-loop prevention: the observer's `applyRemoteProject` writes the store
  directly (not through a mutation action); the reconcile path never re-enters
  store actions. Local writes set dirty (→ checkpoint); remote writes do not.

## 15. Move/reorder semantics

Reorders are id-stable `Y.Array` moves. Two users moving the same section → both
operations merge deterministically (Yjs array semantics); the final order is one
deterministic order, and `normalizeSectionOrders` rewrites `order` fields at
projection. A concurrent "move to container Y" vs "move to container Z" for a block
resolves to exactly **one** parent (Yjs `children` arrays converge; the normalizer
enforces single-parent and drops duplicate references deterministically).

## 16. Delete/update races

**Deletion wins for structure** (documented policy). A section/block/page deleted
concurrently with an edit inside it → the element is gone; edits targeting deleted
nodes apply to Yjs tombstones and do not resurrect content. This matches the
recommended policy and is testable.

## 17. Concurrent insert semantics

Concurrent inserts at the same `Y.Array`/`Y.Text` position all survive; ordering is
deterministic (Yjs client-ordering). The normalizer then applies schema-safe
repairs (e.g., section `order` renumbering) without inventing content.

## 18. Concurrent page operations

Create/rename/reorder/delete page merge per §10/§15. Route slugs: `toProject`
re-runs `resolveUniqueSlug` against the projected page list, so two pages racing to
the same slug deterministically become `/about` and `/about-2` per existing naming
rules (no duplicate routes exported).

## 19. Concurrent site-settings edits

`siteSettings` maps to `Y.Map` with `Y.Text` leaves — **field-level merge** by
construction: A changes favicon, B changes SEO description → both survive. The
sanitizer (`sanitizeSiteSettings`) runs at projection. No whole-object LWW.

## 20. Undo/redo architecture

- **Personal projects / read-only previews / non-collab flows:** the existing
  editor history stack (past/present/future) is untouched.
- **Collaborative workspace sessions:** a `Y.UndoManager` is bound to the doc's
  shared types with `trackedOrigins = new Set([LOCAL_ORIGIN])`. Only transactions
  originated by **this client** are captured; remote transactions (origin
  `remote:{clientId}`) never enter the undo stack. The editor store's
  `undo/redo/canUndo/canRedo` route to the UndoManager when a hook is registered.
- Local undo reverts the client's last transaction(s); the result flows through the
  normal observer → projection → store, so B's work is preserved while A's is
  reverted.

## 21. Local undo vs global history

Local undo = `Y.UndoManager` (this client's transactions only). There is **no**
global history stack in collaborative mode; the store `history` mirrors
`present` for compatibility but `past`/`future` are inert. The UI undo button and
Ctrl/Cmd+Z keep working; semantics are per-user, per the product requirement.

## 22. Presence/cursor relationship

Reuses P15 presence unchanged (same sessions, TTL, heartbeat, display-safe shapes).
Presence **mode** is re-derived in P16: instead of the lease, the server derives
`editing` from *collab room membership + role* (editor/owner with an active room
session = editing; everyone else = viewing). The optional `activePageId` is added
to presence so chips can show "editing Home". **No cursor coordinates, no selection
sharing** (out of scope; §20 of the prompt).

## 23. Offline/reconnect strategy

- Local edits while disconnected are applied to the local `Y.Doc` and queued as
  binary updates in a **bounded queue** (default 256 updates / 2 MB, configurable).
- On reconnect: apply any updates received from the room (idempotent), then flush
  the local queue. Yjs guarantees convergence; duplicates are no-ops.
- If the queue overflows or reconnect cannot converge (e.g., a reset), the session
  re-syncs from the durable checkpoint (see §26) — an honest full re-base, not a
  silent overwrite.
- UI status: `Synced / Syncing / Offline / Reconnecting / Error` (§31).

## 24. Conflict handling

There are **no CRDT conflicts by construction** (convergent merge). The remaining
conflict surface is **durable checkpoint writes** (optimistic concurrency):
`saveWorkspaceProject(expectedRevision)` can return `STALE_REVISION` when two
editors checkpoint near-simultaneously. Handling: refetch the current revision and
retry (bounded, 2 attempts) — content is already converged, so the retry succeeds
and P15 dedupe makes the second save a no-op (no duplicate version, no duplicate
activity). True authorization conflicts (role changed) still surface the existing
P14 conflict UI.

## 25. Server persistence

Durable state stays **server-authoritative on the workspace project payload**
(P14/P15 model), not on CRDT internals:

- Live edits converge in the `Y.Doc` (realtime).
- A **checkpoint** writes the validated projection (`toProject(doc)` → Project) to
  the workspace project via the existing save path, bumping the revision and
  creating/deduplicating P15 versions + `project.saved` activity.
- Checkpoint triggers: debounced idle after local changes (~1.5–3 s), explicit
  Save, before publish/export, before version restore, and on session end.
- A stale browser session can never overwrite newer merged state: checkpoints use
  `expectedRevision` + retry, and the doc merge itself is idempotent.

## 26. Snapshot/checkpoint strategy

- **Live layer:** the room relays binary Yjs updates (bounded, see §39). Late
  joiners replay updates since the last checkpoint and converge without a full
  re-download.
- **Durable layer:** the canonical Project payload at each checkpoint (which P15
  version history already snapshots with content-hash dedupe + retention 50).
- Room update logs are **pruned at every checkpoint** (updates ≤ checkpoint seq are
  dropped); this bounds log growth to "updates since last checkpoint".
- No CRDT internals are ever persisted to the workspace payload/versions — the
  durable format remains the schema-validated Project (P13 portability guarantee).

## 27. Project schema validation

`toProject(doc)` output **must** pass `AnySectionSchema` (per section) and the
canonical Project shape before any consumer uses it (editor store, checkpoint,
publish, export, version snapshot). Validation failures never persist/publish: the
session surfaces an error and stops until the doc is repaired (normalizer) or the
client re-syncs.

## 28. Version history

P15 version history is unchanged: versions are created by the **checkpoint** path
(autosave dedupe by content hash, explicit actions always record). Collaborative
changes between checkpoints are grouped into one version — no per-keystroke
versions. `project.version_created` / `project.saved` activity stays meaningful
(§29). Restore/import remain version-history operations coordinated by the
maintenance lock (§46/§47).

## 29. Activity

**No per-operation activity.** `project.saved` fires only when a checkpoint creates
a version (already P15 behavior — identical saves are silent). This naturally
batches collaborative work into meaningful "X saved changes" events with
server-derived actors. No new activity types are added for character/structure
operations.

## 30. Save semantics

In collaborative mode, **"save" means checkpoint** (durable snapshot), not
"transmit my local state". Realtime already syncs continuously. UI copy updates:
the save indicator reflects sync status (`Synced`/`Syncing`/`Offline`/…), and the
explicit Save button force-checkpoints. The stale "saved at …" copy is replaced
with honest sync status when a room is active.

## 31. Sync status

New `CollabSyncStatus` in the collab UI store: `"idle" | "connecting" | "synced" |
"syncing" | "offline" | "reconnecting" | "error"`. Derived from transport state +
queued-update count + last checkpoint result. Rendered as text in the TopNav
(`data-testid="collab-sync-status"`) — never color alone (§73).

## 32. Offline editing

Bounded offline editing is supported (Yjs local doc + queue). Full offline
guarantees (long sessions, multiple devices offline merging later) are **not**
promised in P16 beyond Yjs's inherent idempotent merge; the honest boundary is: the
local queue is bounded, and on overflow/session expiry the client re-bases from the
durable checkpoint. This narrow behavior is documented (not "offline-first").

## 33. Reconnect

A edits offline, B edits online, A reconnects: A's queued updates merge with B's
via Yjs → both survive → converge → checkpoint. Tested in E2E (§68 of prompt) and
unit tests. No full-project overwrite.

## 34. Multi-tab

Same user, same project, two tabs → two distinct Yjs clientIds. Update dedupe is
inherent (Yjs). Presence dedupe is per-sessionId (P15). Undo is per-tab (each tab's
UndoManager captures only its own local origin). No corruption.

## 35. Role change while open

Editor → viewer while the editor is open: the transport/session observes the access
store (P14 server-resolved). Outgoing sends stop, the queue is cleared (never
uploaded after downgrade), the UI transitions to read-only live view (realtime
subscription may remain — viewer realtime, §41). The server rejects any send from a
non-editor (mock + RLS), so a malicious/buggy client cannot mutate after downgrade.

## 36. Member removal

Server purges the room session and rejects all sends. The client's next
send/poll/heartbeat returns 403 → session transitions to the honest read-only state
(reuse the P14/P15 unauthorized transition). Queued updates are discarded, never
uploaded. The local editor shows the existing "no longer has access" banner.

## 37. Authorization

Never trust `workspaceId`/`projectId`/`userId`/`role` from the client:

- **Join** requires: authenticated + workspace member + project accessible
  (mock `requireMember`; Supabase `ws_join_collab` SECURITY DEFINER RPC — realtime
  channels do not evaluate table RLS, same pattern as `ws_join_presence`).
- **Send** additionally requires editor/owner (mock `requireEditor`; Supabase RLS
  on the updates table grants insert to editor/owner only, actor forced to
  `auth.uid()`).
- Viewers can join/subscribe (receive) but every send is rejected server-side.
- Cross-workspace/project join is denied; the room key is scoped and re-checked.

## 38. Malicious update handling

Remote updates are **untrusted**. Defenses:

- Update size/rate limits at the transport and room (mock + RLS constraints).
- Every remote update is applied to the local `Y.Doc` (Yjs is safe against
  malformed encodings — it validates state vectors and ignores unknown/duplicate
  ops), then **projection validation** runs: `toProject` + `AnySectionSchema` +
  the normalizer (which strips unknown keys, clamps depth/node/text counts, rejects
  dangerous URLs via the existing asset/URL validators at the point the content is
  consumed, e.g. publish/export).
- Prototype-pollution keys (`__proto__`, `constructor`, `prototype`) are stripped by
  the JSON walkers.
- No executable props exist in the model (schema is data-only).

## 39. Resource limits

| Limit | Value (mock + client, mirrored in RLS/SQL where possible) |
|---|---|
| Max update message | 256 KB (mock rejects larger; Supabase realtime message limit) |
| Update frequency | Client throttle (~100 ms burst coalescing; mock rate-limit per room) |
| Document size | Workspace project max 8 MB (existing gate) applied to projection |
| Node count | Block tree ≤ 1,000 nodes (projection normalizer clamps, drops extras deterministically) |
| Text size | Per-string ≤ 10,000 chars (existing field limits preserved at projection) |
| Depth | ≤ 12 levels in props/tree (normalizer clamps) |
| Awareness payload | Not used in P16 (no cursors/awareness state) |
| Offline queue | ≤ 256 updates / 2 MB |
| Room update log | Pruned at checkpoint; ≤ 4 MB between checkpoints |

## 40. Project room access

Room join = authenticated + member + project accessible + viewer-or-above. Sending
mutation updates requires editor/owner. Viewers receive updates but never send. The
same rules apply in mock and Supabase.

## 41. Viewer realtime mode

Viewers join the room in subscribe-only mode: `toProject(doc)` applies to the store
(they see live changes), `isEditorWritable()` remains false (all store mutations
blocked — existing P14 gate), and the transport never sends. No mutation path can
bypass this (store gate + server gate).

## 42. AI Copilot

Copilot **EDIT** plans already commit through `applyAiEditPlan` → the collab commit
hook → **one reconcile transaction** with origin `local:{clientId}`. Other
collaborators see the resulting changes arrive as a normal merged update. ASK /
EXPLAIN are non-mutating and unaffected.

## 43. AI atomicity

The whole selected plan applies as **one transaction** (one reconcile), so other
users never observe a half-applied plan, and the initiating user's Undo reverts the
plan as one logical action (UndoManager captures the single transaction).

## 44. Generation / import

Generation, template application, code import, and block-library inserts produce
large changes. They are applied as **bounded reconcile transactions** (one local
transaction per logical action) — no thousands of tiny network operations. The
existing import/generation code paths are unchanged; only the commit boundary is
intercepted.

## 45. Version restore

Restore is a project-wide replacement → coordinated by the **maintenance lock**:

1. Owner acquires the project maintenance lock (reuses the P14 lease infrastructure
   under a maintenance-lock semantic; server-side, bounded TTL).
2. While locked, room sends are rejected with `LOCKED` (mock) / RLS-equivalent
   (Supabase); collaborating clients show a maintenance banner and stop editing.
3. Restore applies as a new revision (P15 semantics unchanged).
4. The room doc is **reset** to the restored checkpoint (`initFromProject`), room
   update logs are cleared, and clients re-sync from the restored state.
5. Lock released.

No concurrent updates are accepted blindly during restore.

## 46. Project import / replacement

Any near-whole-project replacement (import package, large template) uses the same
maintenance lock path (§45) instead of the ordinary (removed) edit lease. Ordinary
collaborative editing never claims the maintenance lock.

## 47. Maintenance lock

`ProjectMaintenanceLock` — a repurposing of the P14 lease rows/endpoints, exposed
via new provider methods `acquireMaintenanceLock` / `releaseMaintenanceLock` /
`getMaintenanceLock`. Owner-only, TTL-bounded, exclusive. **Ordinary editing is
never called "locked"**; the UI says "Performing a maintenance operation".

## 48. Recovery

P9 recovery (local IndexedDB snapshots) is unchanged for personal projects. For
collaborative workspace projects, restoring a recovery snapshot **never** silently
overwrites peers: recovery offers (a) restore as a personal copy, or (b) owner
maintenance restore through §45. The local recovery snapshot is never pushed to the
room automatically.

## 49. Publishing

Publishing reads the **validated durable checkpoint** (the server payload) — not a
transient local projection. Before publish, the session ensures the doc is synced
and checkpointed (the existing publish flow already fetches the server project).
P8/P13 privacy guarantees are untouched.

## 50. Export

Export uses the canonical projected Project (`toProject(doc)` → validated), never
CRDT internals, update logs, awareness, presence, roles, or realtime tokens. The
P13 package format is unchanged.

## 51. Personal projects

Personal projects keep the **existing editor store/history** exactly as today. No
CRDT infrastructure is loaded, initialized, or wired (lazy — see §72). The collab
hook is only registered for workspace collaborative sessions.

## 52. Backward compatibility

Existing P14/P15 workspace projects open unchanged: the collab doc is created
**lazily from the canonical project snapshot** on first collaborative open. The
durable payload format, version snapshots, and revision semantics are untouched, so
older clients/projects keep working. No destructive migration.

## 53. Supabase schema

One new table + RPCs (minimal, per the prompt):

- `workspace_project_collab_updates` — append-only room update log
  (`id, workspace_id, project_id, seq bigint, update bytea, actor_user_id,
  created_at`). RLS: members can SELECT; inserts only via SECURITY DEFINER RPC
  (`append_collab_update`, editor/owner, actor = `auth.uid()`, size-bounded);
  pruned by the checkpoint RPC.
- RPCs: `ws_join_collab` (membership gate for realtime), `append_collab_update`,
  `list_collab_updates` (after seq), `collab_checkpoint` (write payload + prune).
- Maintenance lock reuses the existing lease table/RPCs under a `maintenance` flag.

No other tables. Durable project state stays in the existing workspace project
payload.

## 54. RLS

- Only workspace members may read collab updates.
- Insert requires editor/owner; actor is always `auth.uid()` (never client-supplied).
- Cross-workspace/project access denied (workspace_id checked against membership).
- Removed/downgraded members lose insert immediately (role check inside RPC).
- Realtime channel join gated by `ws_join_collab` (channels ignore table RLS).

## 55. Mock backend

The mock reproduces production guarantees deterministically:

- Room state lives on the dev-server's globalThis mock cloud (shared across browser
  contexts, like P6/P14/P15). Room = `{ seq, updates: Map<seq, base64>, checkpointSeq,
  members, lock }`.
- Endpoints under `/api/collab/[[...path]]` (mock env only): join, send, poll,
  checkpoint, lock, reset.
- Transport is **asynchronous on purpose**: clients poll on a short interval
  (~500 ms) — no fake synchronous semantics. E2E helpers use deterministic
  `waitForCollabSynced` polling, never arbitrary sleeps.
- Role enforcement, size limits, retention, maintenance lock, and deletion cleanup
  mirror the RLS/RPC semantics.

## 56. Collaboration test harness

`e2e/helpers/collab.ts` provides explicit hooks:

- `waitForCollabSynced(page, state)` — polls the collab UI store/status.
- `disconnectCollaboration(page)` / `reconnectCollaboration(page)` — test-only
  transport controls (mock) exposed via a guarded `window.__buildoraCollabTest`
  handle, used by the reconnect E2E.
- `collabRoomState(page, ws, project)` — read the mock room (seq, update count) for
  deterministic assertions.
- Two-context flows reuse the P14 workspace helpers (sign up, workspace, invite,
  open project).

## 57. Unit tests — CRDT document

`src/features/collaboration/__tests__/` cover (applied in different orders, both
clients converge to identical output):

- text insert/delete merge (including the "Hello world" spec case),
- independent field edits merge,
- block insert/delete/move,
- concurrent move (one final parent),
- delete-vs-edit (deletion wins),
- insert at same index (both survive, deterministic order),
- section reorder, page reorder, page delete, site-settings field merge,
- deterministic final normalized output across op orders.

## 58. Property / invariant tests

Seeded randomized/table-driven sequences over the document model assert, after
every prefix: no cycles, no dangling parent references, no duplicate children,
every child has one parent, roots valid, ids unique, `AnySectionSchema` passes,
normalized output identical across operation orders. (Same seeded PRNG approach as
existing structure tests.)

## 59. Unit tests — undo

- A edits, B edits, A undo → only A's change reverts; B's survives.
- A applies an AI plan transaction, A undo → the entire plan rolls back logically.
- Redo restores A's action; remote transactions never appear in local undo.

## 60. Unit tests — offline / reconnect

Disconnect → local edit → remote edit → reconnect → merge → dedupe → no lost
content; queue bounds; queue-flush-on-reconnect; re-base on checkpoint when
required.

## 61. Unit tests — permissions

Viewer receives updates but cannot send; editor can; removed member cannot
send/read; role downgrade rejects future mutations (client + mock-server enforced).

## 62. Unit tests — security

Hostile: oversized update, invalid block type, prototype key, unsafe URL, invalid
tree, deep tree, excessive text, forged actor, forged room, forged role, update
after membership removal. All rejected or normalized deterministically; no
prototype pollution.

## 63. Component tests

CollabSyncIndicator states, collaborator presence with active page, viewer live
read-only, reconnect state, maintenance banner, permission-loss transition,
maintenance-lock dialog, error/reconnect UX, keyboard/aria behavior.

## 64–69. Required E2E (chromium, workers=1)

- `e2e/realtime-collaboration.spec.ts` — two contexts join; A edits headline; B sees
  live; B edits another section; A sees it; reloads converge; audit clean.
- `e2e/realtime-text-collaboration.spec.ts` — A and B edit the same text with
  deterministic controlled timing; both contributions survive; both converge;
  reload retains merged text; no corruption.
- `e2e/realtime-structure.spec.ts` — A adds/reorders a block while B edits/inserts
  another; both survive; tree valid; converge; reload converges; no duplicate ids.
- `e2e/realtime-undo.spec.ts` — A edits, B edits, both see combined; A undo removes
  only A's action; B's remains; redo restores; converge.
- `e2e/realtime-reconnect.spec.ts` — A goes offline, edits locally, B edits online,
  A reconnects → both converge, no duplicate, reload stable.
- `e2e/realtime-permissions.spec.ts` — viewer live but can't edit; downgrade stops
  mutation; removal loses access + queued changes not uploaded; cross-workspace
  room join denied; audit clean.

## 70. P15 regression

Presence still works (mode now collab-derived); activity stays batch/meaningful
(checkpoint-only `project.saved`); version history stays bounded with restore safe
(via maintenance lock); the P15 E2E specs are updated where lease-derived assertions
no longer apply (presence mode expectations) and otherwise unchanged. P14 specs
updated: `workspace-edit-lease` now asserts maintenance-lock semantics; any
"blocked by lease" assertions become "simultaneous editing" assertions.

## 71. Performance

- Collab engine lazy-loaded (dynamic import) only for workspace editor sessions.
- Reconcile computes minimal ops; projection is debounced per microtask
  (coalesced); React re-renders follow the existing store subscription granularity
  (no whole-project re-render per keystroke beyond what the editor already does for
  a single value change).
- Update coalescing: burst of text ops → one binary update per ~100 ms.
- Benchmarks: editor startup adds < 50 ms (Yjs doc init), update size ≈ tens–hundreds
  of bytes for text edits.

## 72. Lazy loading

The collaboration module is loaded only when a workspace project opens with a
session-eligible role (dynamic `import("@/features/collaboration/…")`). Dashboard,
personal projects, public share viewer, exported sites never load it. Bundle impact
≈ +18 KB gzipped (Yjs) only for collaborative editor sessions.

## 73. Accessibility

Sync status exposed as text (`aria-live="polite"`), collaborator chips have
aria-labels, the collaborator popover is keyboard accessible, read-only transitions
are announced, maintenance banner is a focusable dialog. Never state-by-color.

## 74. Mobile

Collaborator list collapses to a compact "+N" chip; sync status text remains
visible; TopNav never overflows (chips hidden behind the account menu on small
screens). No cursor UI is attempted on mobile.

## 75. Security review (pre-implementation checklist)

Authorization: room IDOR, forged workspace/project/role, removed/downgraded member,
queued changes after removal. Updates: malicious/oversized payloads, replay
(idempotent Yjs), duplicate updates (idempotent), stale snapshots, corrupted
incremental updates. CRDT: prototype pollution, cycles, invalid trees, node/text
explosion, unexpected keys. Realtime: subscription leakage, StrictMode duplicate
subscriptions, reconnect duplication, account/project/workspace switch cleanup.
Offline: queue limits, unauthorized queued uploads. Privacy: collab data excludes
member lists, emails, Copilot memory, review tokens, auth tokens, deployment
credentials, recovery data. AI: Copilot cannot bypass the permission path. Export:
CRDT internals excluded. — Reviewed after implementation; every genuine finding
fixed with a regression test.

## 76. Final focused review (pre-implementation checklist)

Feedback loops, duplicate local/remote apply, stale projections, render storms,
memory leaks, subscription leaks, awareness leaks (none), update-log growth,
offline-queue growth, snapshot compaction, undo origin, AI origin, import origin,
reconnect races, project-switch races, role-change races, deletion races, version
restore coordination, misleading sync copy, accessibility, mobile, dead code,
scope creep.

## 77. Validation

`npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`, then the 6 P16
E2E specs (chromium, workers=1), then sequential regressions:
`test:e2e` → `test:e2e:matrix` → `test:e2e:fallback` → `test:export-build`.
Never concurrent. Long suites run in the background with polling.

## 78. Non-goals (explicit)

- Cursor/pointer sharing, selection overlays, Figma-style cursors.
- Voice/video/chat, comments anchored to selections.
- Team billing, approvals, branch/merge workflows, audit exports.
- Full offline-first with long multi-device offline merge guarantees.
- CRDT internals in any durable format.
- P17.

## 79. Completion criteria

Multiple editors edit simultaneously; same-text concurrent edits converge;
structural concurrent edits converge; no tree corruption; per-user undo; remote
updates never pollute local undo; viewer realtime read-only; downgrade/removal
enforced immediately; reconnect converges safely; no whole-project LWW overwrite;
bounded updates; durable state survives reload; P15 activity/version history useful;
P14 permissions authoritative; AI edits through the collab path; personal projects
unaffected; export/publish privacy-safe; Supabase production path exists; mock E2E
deterministic; unit/component/P16 E2E green; full regressions green;
tsc/lint/build green; `docs/phase-p16-report.md` complete; P17 not started.

## 80. Genuine P17+ candidates (only)

Visual per-user text cursors/selection, awareness-based "X is typing", full
offline-first with durable local CRDT storage, version branching/merge, collab
awareness in dashboards, cross-project presence, Supabase realtime live verification
with credentials, block-level fine-grained locking, undo timeline per collaborator.
