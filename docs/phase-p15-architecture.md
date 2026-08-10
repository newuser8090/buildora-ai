# Phase P15 — Architecture: Presence, Activity & Version History

Branch: `phase-p15-presence-activity-version-history`
Design written before implementation, following P9–P14 conventions.

---

## 1. Phase goal

P14 gave teams a *safe* shared workspace (server-authoritative projects, edit
leases, optimistic concurrency, read-only viewers) but collaboration still feels
transactional. P15 makes workspace collaboration **understandable** (who is here,
what changed) and **recoverable** (browse history, preview, restore, copy).

Three capabilities:

1. **Presence** — who currently has a workspace/project open, viewing or editing.
2. **Activity** — a durable, bounded, privacy-safe timeline of meaningful workspace events.
3. **Version history** — server-backed snapshots of workspace projects with
   metadata-only listing, read-only preview, safe restore (new revision), and copy.

P15 is explicitly **not** collaborative editing: the P14 edit-lease model remains
the single authoritative mutation coordinator. No CRDT/OT/live cursors/selections.

## 2. User problems solved

| Problem | P15 answer |
| --- | --- |
| "Is anyone else in this project right now?" | Presence chips in the editor TopNav |
| "Why am I blocked from editing?" | Presence shows who holds the lease *and* who is viewing |
| "What has been happening in this workspace?" | Workspace Activity panel |
| "Who made these changes?" | Activity actor names (server-derived) |
| "I need yesterday's version back" | Version history list |
| "Show me the old version before I restore it" | Read-only version preview |
| "Restoring must not clobber newer work" | Expected-revision check + safety version + restore = new revision |
| "I want the old design without touching the shared project" | Copy-from-version |
| "Publish / share / member events should be visible" | Activity taxonomy covers them |

## 3. Presence model

```ts
interface WorkspacePresence {
  workspaceId: string;
  projectId: string | null;   // null = workspace-wide presence (dashboard)
  userId: string;             // authenticated user id (never device ids)
  sessionId: string;          // client-generated, one per open tab
  mode: "viewing" | "editing";
  joinedAt: string;           // ISO (server clock)
  lastSeenAt: string;         // ISO (server clock)
}
```

Display-safe projection returned to clients additionally carries
`displayName` (server-derived from the member email, never the raw email
unless no name can be derived).

## 4. Presence identity/privacy model

- Identity is the **authenticated user id**; the server resolves membership.
- **No** device fingerprints, IP addresses, browser metadata, or payload passthrough.
- `displayName` is derived server-side (same `emailToName` style as P14 lease
  holder names) and only for members of the same workspace.
- Presence payloads are a **fixed allow-listed shape**; clients cannot broadcast
  arbitrary JSON (mock server builds the payload; Supabase `track()` sends only
  `{ sessionId, mode, displayName }`).

## 5. Presence transport

Abstracted behind a `PresenceProvider` (mirrors P6/P12/P14 provider pattern):

```ts
interface PresenceProvider {
  kind: "mock" | "supabase";
  join(input: { workspaceId; projectId?; sessionId }): Promise<void>;
  heartbeat(sessionId: string): Promise<void>;
  leave(sessionId: string): Promise<void>;
  getPresence(workspaceId, projectId?): Promise<WorkspacePresence[]>;
  subscribe(workspaceId, projectId?, onPresence): () => void;
}
```

- **Mock** (`MockHttpPresenceProvider`): deterministic HTTP transport over
  `/api/presence/*` backed by the dev-server in-memory presence store
  (globalThis). Two browser contexts share the dev-server process → two-account
  presence E2E works. Subscription is a no-op; the hook polls `getPresence`.
- **Supabase** (`SupabasePresenceProvider`): Realtime Presence channels
  `presence:{workspaceId}`. Presence channels are NOT RLS-authorized by
  Supabase Realtime (RLS authorization applies only to `postgres_changes`
  channels), so membership is enforced by a server RPC before any `track()`:
  `ws_join_presence(workspace_id)` (SECURITY DEFINER, `ws_is_member` check)
  must succeed for the client to track. A non-member's join RPC raises
  `PERMISSION_DENIED` and the client never tracks. `track({ sessionId, mode,
  displayName })`, `untrack()`, `removeChannel()` on cleanup.

## 6. Presence TTL/heartbeat

- **TTL: 45 s** since the last heartbeat (`PRESENCE_TTL_MS`).
- Client heartbeats every **10 s** while a workspace is open.
- The client polls the presence list every **5 s** (mock env; Supabase uses the
  realtime channel instead).
- Expiry is server-authoritative: reads prune expired sessions; expired
  sessions disappear without any client action (crash-safe).
- Best-effort `leave()` on unmount / project switch / workspace switch /
  sign-out; `leave` is idempotent and never blocks navigation.

## 7. Viewer vs editor presence

`mode` is **derived server-side from the edit lease**, never trusted from the
client:

- viewer role → `viewing`
- editor/owner without the active lease (blocked by another editor) → `viewing`
- editor/owner holding the active lease → `editing`
- If the lease is lost while open (heartbeat failure / role change), the next
  presence read flips the session to `viewing`.

Workspace-wide presence (`projectId = null`) is always `viewing`.

## 8. Workspace-wide vs project-specific presence

- **Workspace-wide** (`projectId = null`): the dashboard workspace view could
  show who is in the workspace; the editor does not show these.
- **Project-specific**: the editor TopNav shows presence for the **active
  project** only. The presence store tracks one active scope at a time and
  cleans up on scope change.
- `getPresence(workspaceId, projectId?)` filters by project when given.

## 9. Activity-event model

```ts
type WorkspaceActivityType =
  | "workspace.created" | "workspace.renamed"
  | "member.invited" | "member.joined" | "member.role_changed" | "member.removed"
  | "project.created" | "project.moved_in" | "project.renamed"
  | "project.saved" | "project.duplicated" | "project.deleted"
  | "project.version_created" | "project.version_restored"
  | "publish.completed" | "publish.rollback"
  | "share.created" | "share.revoked"
  | "domain.attached" | "domain.removed";

interface WorkspaceActivityEvent {
  id: string;
  workspaceId: string;
  projectId: string | null;
  actorUserId: string;             // SERVER-DERIVED from the session — never client-supplied
  type: WorkspaceActivityType;
  createdAt: string;
  metadata: Record<string, string | number | boolean>; // allow-listed, small, typed
}
```

Structured events only — never raw log lines, never project JSON.

## 10. Activity categories

- **Workspace**: created, renamed.
- **Members**: invited, joined, role_changed, removed.
- **Projects**: created, moved_in, renamed, saved (version-creating save),
  duplicated, deleted, version_created (manual checkpoint), version_restored.
- **Publishing**: publish.completed, publish.rollback.
- **Sharing**: share.created, share.revoked.
- **Domains**: domain.attached, domain.removed.

No keystroke events. `project.saved` fires **only** when a save actually creates
a version (content changed) — identical-content autosaves are silent.

## 11. Activity retention

- **Latest 300 events per workspace**, newest preserved deterministically
  (`created_at DESC, id DESC`).
- Pruning happens inside the same server transaction that inserts (mock:
  `splice` after push; Supabase: `record_activity_event` calls
  `prune_workspace_activity` in a `SECURITY DEFINER` function).
- Mock and Supabase enforce the same bound.

## 12. Activity UI

- **Dashboard → workspace view**: `Projects | Activity` tabs
  (`WorkspaceActivityPanel`).
- Editor → version history dialog gets a second **Activity** tab filtered to
  the active project (one service, two views — no duplicate history systems).
- Each event renders: actor name, human action sentence, project name (when
  relevant), relative time, lightweight icon.
- **Never** expose internal event type strings verbatim; the UI maps types to
  copy (e.g. `member.role_changed` → "changed Alex's role to Viewer").

## 13. Project activity

`WorkspaceActivityPanel` (dashboard) supports an **All / Projects / Members /
Publishing / Sharing** filter; the editor History dialog filters by the active
project. Both use `WorkspaceService.listActivity` with the same cursor +
allow-list — a single underlying data model.

## 14. Version history — what it is (and is not)

| System | Owner | Purpose | Relation |
| --- | --- | --- | --- |
| Editor undo history | in-memory store | step back individual edits | untouched |
| Local recovery snapshots | IndexedDB | crash recovery of the last known good | untouched |
| Deployment history | publishing storage | production rollbacks | untouched |
| Cloud-sync markers | cloud sync | device merge bookkeeping | untouched |
| **Workspace version history** | **server** | **shared, auditable project snapshots** | **new in P15** |

Personal projects keep their existing local systems; P15 version history is
workspace-project only.

## 15. Version creation

Versions are created server-side at meaningful points:

1. **Successful workspace remote save** with changed content → reason
   `autosave` (deduped by content hash — see §17).
2. **Publish success** → reason `publish` (server `save` path also stamps this
   when the publish bridge records it).
3. **Manual "Save version" checkpoint** → reason `checkpoint` with an optional
   bounded label.
4. **Pre-restore safety snapshot** → reason `pre-restore`.

No per-keystroke snapshots. Autosave versions are skipped when the content hash
equals the latest version's hash (identical saves create nothing).

## 16. Version record

```ts
interface ProjectVersionMeta {
  id: string;
  workspaceId: string;
  projectId: string;
  revision: number;      // project revision captured at version time
  createdBy: string;     // user id (server-derived)
  createdAt: string;
  reason: "autosave" | "publish" | "checkpoint" | "pre-restore" | "restore";
  label?: string;        // manual checkpoint label (bounded, sanitized)
  contentHash: string;
}

interface ProjectVersionFull extends ProjectVersionMeta {
  project: Project;      // validated canonical Project payload
}
```

Snapshots are the **same validated Project payload** the workspace server
already stores (ProjectSchema) — collaboration/runtime metadata is structurally
absent (see §18).

## 17. Version creation strategy (dedupe)

- Content hash = `stableHash` (P6 `cloud-sync/hash.ts`) over the canonical
  validated Project payload. Deterministic across devices.
- Autosave: **skip** if hash equals the latest version's hash.
- Explicit actions (checkpoint with label, publish, restore, pre-restore) always
  create a version — auditability over compactness.
- `revision` recorded on the version is the project's revision at creation time
  (before it increments).

## 18. Version snapshot privacy

Snapshots contain only canonical `Project` content (schema-validated).
Excluded by construction and asserted by tests:

- workspace members / invitations / edit leases / presence sessions
- auth/session data
- Copilot memory / conversations / style notes
- recovery snapshots
- share raw tokens / review comments
- deployment/domain provider secrets
- cloud-sync queues/markers
- device metadata

## 19. Version retention

- **Latest 50 versions per workspace project**, newest preserved
  deterministically (insert order).
- Pruning removes the oldest while the project's current content is **never**
  deleted — a project's active state always outlives its history.
- The active project itself is never a version that can be pruned (versions are
  separate rows; the project row is untouched by pruning).

## 20. Version list UI

`VersionHistoryDialog` in the editor (History button, workspace projects only):

- groups **Today / Yesterday / Earlier**
- each entry: author name, time, reason sentence ("Saved changes",
  "Published", "Manual checkpoint — Before homepage redesign",
  "Before restoring version 8", "Restored from version 8"), revision number
- **metadata only** — snapshots are never fetched for the list
- per-permission actions: Preview (all members), Restore (owner),
  Copy (owner/editor), manual "Save version" (editor/owner)

No Git terminology anywhere.

## 21. Restore version

Explicit, confirmed, concurrency-safe. Server flow (`restore_project_version`):

1. Load current project (revision `R`, hash `Hc`).
2. **Verify `expectedRevision === R`** — else `STALE_REVISION`
   ("This project changed while you were reviewing history.").
3. Load target version `V` (snapshot `S`).
4. **Safety version**: if `Hc !== hash(S)`, insert a `pre-restore` version of
   the current state (preserves what restore overwrites).
5. Apply `S` as the project payload; `revision = R + 1`.
6. Insert a `restore` version of `S` (auditable, unless identical to the latest
   hash — explicit restores always create the record).
7. Record `project.version_restored` activity (metadata: source version, new
   revision).

Client flow: flush local saves → confirm in dialog → call restore with
`expectedRevision` = current server revision → on success reload the editor
(server content is authoritative; a full reload is honest and deterministic).

## 22. Restore is not time-travel deletion

Restoring version 8 creates **version 15 = restored content from version 8**
(plus a `pre-restore` safety version of the state before restore). Versions
9–14 remain in the timeline. Nothing is deleted; the timeline is append-only.

## 23. Copy from version

- **Same workspace**: `copy_project_from_version` (owner/editor) creates a fresh
  project record (new project id, new page/section ids, new revision 1, creator
  = current user) whose payload is the target snapshot. No lease/links/history
  copied.
- **Personal copy**: the client fetches the snapshot and creates a personal
  project via the project controller with fresh identities (new project/page/
  section ids), then navigates to it. Allowed for owner/editor (server enforces
  the fetch; the personal create is local persistence).

## 24. Restore permissions

| Role | List versions | Preview | Copy (workspace) | Copy (personal) | Manual checkpoint | Restore shared state |
| --- | --- | --- | --- | --- | --- | --- |
| Owner | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Editor | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ (owner-only for P15) |
| Viewer | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

Server enforces every column; the UI hides what the role cannot do.

## 25. Version diff summary

No full visual diff engine in P15. The list shows **metadata only** (author,
time, reason, revision). Where the infrastructure makes it trivial we show a
deterministic short summary (page title changes + section count changes between
a version and its predecessor) computed client-side **only** when the previous
snapshot is already loaded; otherwise metadata only. Never fabricated prose.

## 26. Activity + version integration

- Version creation → `project.saved` (autosave) or `project.version_created`
  (manual checkpoint) activity.
- Restore → `project.version_restored` activity.
- Pre-restore safety snapshots do **not** create their own activity event
  (they are an internal audit record, visible as a version entry).

## 27. Edit-lease interaction

The P14 lease stays authoritative:

- Manual checkpoint and restore of a shared project require the session to hold
  the active edit lease (or at minimum be `editable` for checkpoint). The mock
  enforces `requireEditor`; the Supabase RPCs check role + lease.
- A viewer can never restore. An editor blocked by another active editor can
  never restore shared state.
- Version **reads** (list/preview) never touch the lease.

## 28. Optimistic concurrency

- Restore requires `expectedRevision` = the current server revision.
- A stale restore fails with `STALE_REVISION` and the UI shows
  "This project changed while you were reviewing history." with **Reload latest**.
- Workspace saves already enforce expected revision (P14); version creation is
  additive and never conflicts with saves.

## 29. Presence + lease

- **Lease** answers: who has write control (P14, unchanged).
- **Presence** answers: who is open/viewing (P15).
- Presence mode is *derived from* the lease server-side so the two never
  contradict: "Alex is editing" (lease) vs "Alex is viewing" (open, no lease)
  are truthful and distinct.

## 30. Authorization loss

If a member is removed (or the workspace deleted) while they have the editor
open:

- presence session ends (leave + server-side purge on member removal)
- activity + version reads fail with `PERMISSION_DENIED`; cached UI state is
  cleared
- the P14 access store transitions to `readonly/unauthorized`; save/lease
  heartbeats stop

## 31. Role change

Owner→editor or editor→viewer while open:

- presence may remain (viewing); the session's editing status is revoked
  server-side via the lease check
- restore/checkpoint controls disappear from the UI; write RPCs reject
- the P14 lease invalidation path runs (heartbeat failure → read-only)

## 32. Workspace deletion

Deleting a workspace (mock `handleDeleteWorkspace` / Supabase
`delete_workspace`) cascades:

- presence sessions for the workspace are removed
- activity events for the workspace are removed
- versions for all of its projects are removed
- leases, projects, invitations, shares already cascade (P14)

No orphaned accessible history.

## 33. Project deletion

Deleting a workspace project:

- versions for the project are removed (snapshots are deleted — never retained
  after the project is gone)
- activity events **for that project** are retained if the workspace still
  exists (metadata-only, no snapshots — "project deleted" tombstone remains
  visible in the workspace timeline)
- presence sessions for the project are removed

## 34. Personal projects

Personal projects are **unaffected**: no presence, no workspace activity, no
version history UI. Their existing editor-undo, recovery, and local persistence
continue unchanged. Copy-from-version *into* a personal project is supported
(the source is workspace, the destination is personal).

## 35. Offline

- Presence: heartbeat stops; presence UI shows the P14 offline read-only state
  and **never fakes live presence** (no stale chips without a fresh poll).
- Activity/versions: unavailable; the UI shows a clear offline state with no
  cached fake data (no persistent cache for activity/versions in P15 — fresh
  server fetch only).
- Cached project readability follows P14 policy unchanged.

## 36. Supabase Realtime

Requirements honored (per Supabase docs research):

- one channel per `(workspaceId)` — `presence:{workspaceId}`
- `removeChannel()` on unmount / scope switch / sign-out (StrictMode-safe)
- no duplicate subscriptions (channel instance cached per scope in a ref)
- **authorization**: presence channels are NOT RLS-authorized by Realtime
  (RLS applies only to `postgres_changes`), so membership is enforced by the
  `ws_join_presence(workspace_id)` SECURITY DEFINER RPC that must succeed
  before any `track()`. Non-members are rejected server-side.
- Realtime never replaces RLS; data reads still go through RPCs

## 37. Mock realtime

- `MockHttpPresenceProvider` + `/api/presence/*` route backed by the
  dev-server in-memory store (globalThis).
- Two browser contexts with different accounts observe each other's presence
  through the shared store.
- Membership enforced on every join/read; presence never leaks across
  workspaces; the UI polls (5 s) for deterministic E2E without websockets.

## 38. Supabase schema

New migration `20260811000001_workspace_presence_activity_versions.sql`:

- `workspace_activity` (id, workspace_id, project_id?, actor_user_id, type,
  metadata jsonb, created_at; index `(workspace_id, created_at desc, id desc)`)
- `workspace_project_versions` (id, workspace_id, project_id, revision,
  created_by, created_at, reason, label?, content_hash, snapshot jsonb; index
  `(workspace_id, project_id, created_at desc)`)
- `workspace_presence` (workspace_id pk — authorization-only rows backing the
  `ws_join_presence` membership gate; no client writes)
- RPCs (all `SECURITY DEFINER`, actor from `auth.uid()`):
  `record_activity_event`, `list_workspace_activity`,
  `list_project_versions`, `fetch_project_version`, `create_manual_version`,
  `restore_project_version`, `copy_project_from_version`,
  `prune_workspace_activity`, `prune_project_versions`
- Patches: `save_workspace_project` creates a deduped `autosave` version +
  `project.saved` activity; `delete_workspace_project` cascades versions +
  presence; `delete_workspace` cascades activity/versions/presence.

## 39. RLS

- `workspace_activity` SELECT: member of the workspace. No client INSERT/
  UPDATE/DELETE policies — only SECURITY DEFINER RPCs write.
- `workspace_project_versions` SELECT: member of the workspace owning the
  project. No client writes — RPCs only.
- `workspace_presence` SELECT: member. No client writes. Membership for
  presence is additionally enforced by the `ws_join_presence` RPC (Realtime
  presence channels do not evaluate table RLS).
- No cross-workspace access anywhere; forged workspace/project ids denied by
  membership checks.

## 40. Activity event creation

- `actor_user_id` is always `auth.uid()` (mock: bearer token) — a client body
  actor is **ignored**.
- `type` must be in the allow-list; anything else → `INVALID_INPUT`.
- `metadata` allow-listed keys with scalar values only; oversized payloads
  rejected.
- No generic `create_activity_event(any JSON)` endpoint.

## 41. Realtime security (tested)

- non-member cannot subscribe/read presence
- removed member stops receiving presence (server purge)
- account A cannot see workspace B's presence/activity/versions
- project-scoped presence correctly scoped
- forged workspace/project ids denied (404/403, never a leak)

## 42. Presence abuse bounds

- Heartbeat frequency: client 10 s; server ignores joins beyond
  `MAX_PRESENCE_SESSIONS_PER_USER` (8) per workspace.
- Payload bounded: fixed shape, no arbitrary JSON.
- Display name server-derived; no free-text presence fields.

## 43. Display names

- Presence/activity show the authenticated display name when available; the
  auth model here is email-based, so the server derives a friendly name from
  the email local-part (same heuristic as P14 lease holders).
- Raw email is shown only where the existing product already shows it
  (member management). Never expose profile metadata beyond what collaboration
  UI needs.

## 44. Local cache

- **No persistent cache** for activity or versions in P15 (fresh paginated
  server fetch; a stale cache is worse than none and adds isolation surface).
- Presence state is a transient in-memory store scoped by the active
  `(userId, workspaceId, projectId)`; it resets on scope/sign-out change.
- The P14 workspace cache-metadata discipline is untouched.

## 45. Activity pagination

- `list_workspace_activity(workspace_id, beforeTs?, beforeId?, limit=30)`
- deterministic order: `createdAt DESC, id DESC` tie-breaker
- returns `nextCursor` (ts+id) when more remain; UI "Load more"

## 46. Version pagination

- `list_project_versions` returns **metadata only** (no snapshots), bounded to
  the retention window (50). No pagination needed at 50, but the RPC supports
  `limit/before` for future-proofing.
- Snapshots are fetched only on Preview/Restore/Copy (`fetch_project_version`).

## 47. Snapshot size

- Version snapshots reuse the existing `WORKSPACE_PROJECT_MAX_BYTES` (8 MiB)
  enforcement — the payload was already size-validated at save time.
- Manual/restore versions reuse the same serialization gate. Reject
  pathological oversized state.

## 48. Content hashing

- `stableHash` from `@/features/cloud-sync/hash` (canonicalized, deterministic,
  already proven for duplicate detection in P6).
- Same hash + same logical state → no redundant autosave version.
- Exceptions documented: explicit checkpoints/publish/restore always record.

## 49. Manual checkpoint

- "Save version" in the version history dialog.
- Optional label: max 80 chars, plain text, trimmed/sanitized, never HTML.
- Creates a `checkpoint` version + `project.version_created` activity.
- Requires an editable session (editor/owner with lease per §27).

## 50. Version history UI

`VersionHistoryDialog` (editor TopNav → History, workspace projects only):

- Today / Yesterday / Earlier grouping
- each row: author avatar/initials, name, relative time, reason, revision #
- actions: Preview (all), Restore (owner), Copy (owner/editor), Save version
  (editors/owner, inline at the top)
- clear "Viewing version from Aug 10, 2026" banner in preview mode with
  "Return to current version"
- accessible, Escape closes, focus restored

## 51. Activity UI

`WorkspaceActivityPanel` (dashboard workspace view, Activity tab):

- filters: All / Projects / Members / Publishing / Sharing
- "Load more" pagination (30/page)
- empty + offline states; permission-safe (viewers see the timeline)
- dashboard header keeps one Activity entry point (no five new buttons)

## 52. Editor integration

TopNav gains **one** compact group for workspace projects:

`[Presence chips] [History]`

- Presence chips replace nothing; they sit inside the existing P14 workspace
  context pill area.
- History opens the version history dialog (workspace projects only; hidden for
  personal projects).
- The existing recovery (backups) button is unchanged and clearly distinct.

## 53. Command palette

Two commands added to the existing palette (they fit the architecture):

- "Open version history" (workspace projects)
- "Save a version" (workspace projects, editor/owner)

## 54. Accessibility

- Presence: chips have `aria-label`s; text state ("You're editing", "Alex is
  viewing") not color alone.
- Activity: semantic list (`<ul>/<li>`), understandable timestamps, keyboard
  navigation, "Load more" is a real button.
- Version history: labelled preview action, accessible restore confirmation
  (role=dialog, aria-modal), Escape support, focus restoration on close,
  read-only preview announced ("Viewing version from …").
- All dialogs trap/focus per existing repo dialog conventions.

## 55. Responsive

Verified at desktop/tablet/mobile: presence chips truncate with "+N",
activity panel is fluid, version history + preview + restore confirmation are
scrollable dialogs with no horizontal overflow.

## 56. Performance

- Version list = metadata only; snapshots fetched lazily.
- Presence: bounded updates (5 s poll / realtime), no per-second heartbeat.
- Activity: paginated, no unbounded loads.
- Member display data batched (one presence payload includes display names;
  no N+1 user lookups).
- Unmounted/hidden views unsubscribe (presence poll stops on scope change;
  history dialog fetches on open).
- History dialog lazy-mounts (only when opened).

## 57. Instrumentation

Local `recordPerf` marks (best-effort, never wall-clock-asserted):

`presence_connected`, `presence_first_update`, `history_open`,
`version_preview_loaded`, `version_restored`, `workspace_activity_loaded`.

No external analytics.

## 58. Unit tests — presence

join, heartbeat, leave, expiry, viewer/editing mode derivation, lease-driven
mode changes, project switch cleanup, workspace switch cleanup, sign-out
cleanup, StrictMode duplicate-subscription prevention (hook test), removed-member
rejection, cross-workspace isolation, multi-tab session behavior (separate
session ids, UI dedupe by user), bounded sessions.

## 59. Unit tests — activity

event-type allow-list, actor derived server-side (forged actor ignored),
metadata allow-list, ordering (ts desc, id desc), pagination/cursor, retention
(300), project filtering, workspace filtering, member/role events, publishing/
share events (bridge), privacy exclusions (no secrets in metadata), unauthorized
read denied, non-member denied, raw error leakage absent.

## 60. Unit tests — versions

creation, dedupe on same content, correct revision, snapshot schema validation,
privacy exclusions, retention pruning (50), metadata-only listing (no snapshot
in payload), lazy snapshot fetch, preview, restore creates new revision, old
versions preserved, safety version before restore, stale-revision restore
rejected, permission matrix (viewer/editor/owner), cross-workspace access
denied, deleted-project handling (404 + cascade), oversized snapshot rejected,
prototype-pollution payload rejected.

## 61. Unit tests — security

forged actor id ignored; forged workspace/project id denied; stale membership
denied; viewer restore denied; editor restore denied; malformed snapshot
rejected; oversized snapshot rejected; prototype-pollution payload rejected;
collaboration metadata absent from snapshots (no members/invites/leases/copilot/
share tokens/session); presence payload fixed-shape.

## 62. Component tests

PresenceIndicator (editing/viewing/offline/empty, accessibility),
WorkspaceActivityPanel (filters, pagination, empty/offline, permission-aware),
VersionHistoryDialog (grouping, actions per role, Save version), VersionPreview
(banner, read-only, Return), RestoreVersionDialog (confirmation, stale error),
loading/error states, focus/Escape behavior.

## 63. E2E — presence (`e2e/workspace-presence.spec.ts`)

Two authenticated contexts (mock backend shared via dev server):

1. A opens a workspace project
2. B opens the same project
3. A sees B present; B sees A present
4. A holds the lease → B sees "A is editing"
5. A exits the project → B observes A leave (deterministic leave + expiry)
6. account/workspace isolation (a third account / another workspace sees nothing)
7. runtime-audit clean

## 64. E2E — activity (`e2e/workspace-activity.spec.ts`)

1. A creates workspace + project
2. invite B; B joins; B edits/saves
3. A publishes (mock provider) / creates a review link
4. open workspace Activity
5. verify ordered events with actor names
6. verify pagination/filter behavior
7. unauthorized account cannot read activity (404/403)
8. runtime-audit clean

## 65. E2E — version history (`e2e/workspace-version-history.spec.ts`)

1. create/open workspace project (initial content → v1)
2. modify + save (v2)
3. open version history → 2+ entries
4. preview older version → read-only banner; current project unchanged
5. restore older version → new revision; newer versions still listed
6. collaborator reload sees restored content
7. stale save cannot overwrite the restored version (STALE_REVISION path)
8. runtime-audit clean

## 66. E2E — version permissions (within `workspace-version-history.spec.ts`)

viewer: preview yes / restore no; editor: preview yes / restore no (owner-only);
owner: restore yes; removed member: no history access.

## 67. Regression requirements

All P14 (leases, permissions, workspace E2E), P13 portability, P12 sharing,
P11 Copilot memory, P10 Copilot, P9 recovery/templates, P8 publishing/domains,
P7 readiness, P6 cloud sync, My Blocks, import, editor history, export, AI
generation — must keep passing. P15 touches only additive surfaces.

## 68. Validation

`npx tsc --noEmit` · `npm run lint` · `npm test` · `npm run build`; then the 3
P15 E2E specs sequentially (chromium, workers=1); then full regressions
sequentially (`test:e2e`, `test:e2e:matrix`, `test:e2e:fallback`,
`test:export-build`). Never run heavy Playwright suites concurrently; background
one run and poll if it exceeds tool timeouts.

## 69. Security review (post-implementation checklist)

Presence: cross-workspace leakage, removed-member subscription, spoofed
identity, spoofed editing mode, heartbeat abuse, stale presence, duplicate
subscriptions, sign-out cleanup.
Activity: actor spoofing, arbitrary event injection, metadata leakage,
retention, unauthorized reads, cross-project/workspace access, raw secrets.
Versions: snapshot privacy, malicious payload, oversized snapshots, stale
revision restore, unauthorized restore, enumeration, deletion cleanup,
cross-workspace access, pruning correctness.
Realtime: subscription authorization, account-switch cleanup, StrictMode
duplicate channels, unmount cleanup.
Errors: no Supabase internals, no raw JSON parse errors, no hidden identifiers.

## 70. Final review checklist

Subscription/interval leaks, timers, stale closures, duplicate events, repeated
version creation, activity noise, stale member names, account/workspace/project
switch behavior, permission changes while open, deleted-project behavior,
dialog stacking, focus restoration, mobile UX, bundle impact, lazy loading,
N+1 calls, dead code, misleading "live" copy, scope creep into CRDT.

## 71. Explicit non-goals

No CRDT, no OT, no live cursors/selections/typing indicators, no simultaneous
field-level mutation merging, no team billing, no analytics, no enterprise audit
exports, no branching/merging, no Git semantics, no approval workflows, no P16.

## 72. Completion criteria

- project/workspace presence works and is permission-scoped
- viewing/editing modes truthful (lease-derived)
- stale presence expires
- bounded/paginated activity; actor spoofing impossible
- version history with privacy-safe snapshots; preview; restore = new revision;
  stale restore cannot overwrite newer state
- P14 leases remain authoritative
- removed users lose realtime/history access
- personal projects unaffected
- deterministic mock E2E; Supabase production path exists (providers +
  migration; validated via mock E2E per repo convention)
- unit/component tests pass; P15 E2E passes; full regressions pass;
  tsc/lint/build pass
- `docs/phase-p15-report.md` written
- P16 not started

## 73. Genuine P16+ candidates (not in scope)

- Collaborative editing primitives (CRDT/OT) — explicitly deferred.
- Version diff visualization (visual diff engine over section tree).
- Cross-project history search / workspace-wide activity export.
- Activity filtering by actor, version branching/merging.
- Presence on the dashboard workspace view (P15 ships project presence only).
- Supabase Realtime end-to-end verification against a live project (requires
  credentials; mock covers semantics in CI).
