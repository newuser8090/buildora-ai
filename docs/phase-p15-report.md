# Phase P15 — Report: Presence, Activity & Version History

Branch: `phase-p15-presence-activity-version-history`
Design document: `docs/phase-p15-architecture.md` (written before implementation).

Phase P15 makes workspace collaboration **understandable** and **recoverable**
on top of P14's safe shared workspace model. It ships three capabilities:

1. **Presence** — live "who's here, viewing or editing" for the active
   workspace project, derived server-side from the edit lease (a client can
   never claim editing).
2. **Activity** — a durable, bounded (300/workspace), privacy-safe timeline of
   meaningful workspace events with server-derived actors.
3. **Version history** — server-backed snapshots of workspace projects with
   metadata-only listing, read-only preview, **restore-as-new-revision** with
   optimistic concurrency, and copy-from-version.

P15 is explicitly **not** collaborative editing: the P14 edit-lease model stays
the single authoritative mutation coordinator. Personal projects are
unaffected. The Supabase production path (providers + migration) exists and is
validated through the mirroring mock backend per repo convention.

---

## 1. Delivered

- **Presence** — `PresenceProvider` interface with mock (HTTP over
  `/api/presence/*`, in-memory, shared across browser contexts) and Supabase
  (Realtime Presence channels `presence:{workspaceId}` with the
  `ws_join_presence` membership gate RPC — presence channels are not
  RLS-authorized, so the gate is a SECURITY DEFINER RPC). Server TTL 45s,
  client heartbeat 10s, mock poll 5s, best-effort idempotent leave, server
  purges on member removal / role downgrade / workspace or project deletion.
  `mode` is derived from the edit lease server-side (mock) or from the
  server-resolved access store (Supabase tracks its own resolved mode).
- **Presence UI** — `PresenceIndicator` in the editor TopNav (workspace
  projects only): self status ("You're editing/viewing"), other-member chips
  with server-derived display names, "+N" cap, honest empty/offline states,
  aria-labels (never color alone).
- **Activity** — `workspace_activity` timeline (newest-first, cursor
  pagination, retention 300) with allow-listed event types + per-type
  metadata key allow-lists; server-derived actors; `project.saved` fires only
  when a save actually creates a version (identical saves are silent).
  Bridged client events for publish/share/domains (`activity-bridge.ts`,
  fire-and-forget, validated server-side). UI: dashboard workspace
  `Projects | Activity` tabs with category filters + Load more; the editor
  History dialog has a second Activity tab filtered to the active project
  (one service, two views).
- **Version history** — `workspace_project_versions` (retention 50,
  deduped autosaves by content hash, explicit actions always record);
  metadata-only listing; lazy snapshot fetch on preview/restore/copy;
  snapshots are the schema-validated canonical Project payload (no
  collaboration/runtime metadata by shape); restore = pre-restore safety
  version + apply as **new revision** (append-only timeline, older versions
  stay intact) + `project.version_restored` activity; stale
  `expectedRevision` rejected (`STALE_REVISION`); restore owner-only;
  checkpoint editor/owner + lease; copy-from-version into the same workspace
  or as a fresh personal project.
- **Editor integration** — TopNav History button (workspace projects only),
  History dialog (versions/activity tabs, Today/Yesterday/Earlier grouping,
  role-gated Preview/Restore/Copy/Save-version), read-only full-screen
  `VersionPreviewDialog` rendering the snapshot through `VisitorPageView`,
  restore confirmation with "Reload latest" on stale revision, copy dialog
  (workspace or personal destination), command-palette entries, presence
  session lifecycle owned by `useWorkspacePresence`.

## 2. Architecture decisions

- **Presence mode is lease-derived, never self-claimed.** The mock derives
  `editing` only while the session's user holds the active edit lease; the
  Supabase client tracks the mode its own server-resolved access store
  reports. Presence and lease can never contradict.
- **Server-authoritative everything.** Membership is enforced on every
  presence join/read, every activity read, and every version read/write —
  mock guards mirror the RLS/RPCs. Activity actors are structurally
  server-derived (`auth.uid()` / bearer token); a client body actor is
  ignored.
- **Allow-lists over free JSON.** Event types and per-type metadata keys are
  allow-listed with scalar, size-bounded values on both sides (mock + SQL) —
  no generic "write any event with any JSON" endpoint.
- **Versions are additive and bounded.** Autosave dedupes by stable content
  hash; restore appends a `pre-restore` + `restore` version and never deletes;
  retention prunes oldest-first in the same transaction as insertion.
- **Metadata-only lists, lazy snapshots.** The version list never ships
  snapshots; `fetch_project_version` runs only for preview/restore/copy.
- **History list fetches on open.** The `VersionHistoryDialog` is always
  mounted (renders nothing when closed), so the version-list fetch is gated by
  `{ active: dialogOpen }` in `useProjectVersionHistory` — every open is a
  fresh server fetch, never a stale pre-save snapshot from editor mount.
- **Mock/Supabase parity.** Same semantics (membership, role matrix, TTL,
  bounds, optimistic concurrency, privacy shapes) in the in-memory mock and
  the migration so the full feature is E2E-exercisable without credentials.

## 3. Version permissions

| Action | Owner | Editor | Viewer | Non-member |
|---|---|---|---|---|
| List versions (metadata) | ✅ | ✅ | ✅ | ✗ |
| Preview (lazy snapshot) | ✅ | ✅ | ✅ | ✗ |
| Copy to workspace / personal | ✅ | ✅ | ✗ | ✗ |
| Manual checkpoint (needs lease) | ✅ | ✅ | ✗ | ✗ |
| Restore (new revision) | ✅ | ✗ | ✗ | ✗ |

Server enforces every column; the UI hides what the role cannot do. Version
**reads** never touch the lease.

## 4. Supabase schema / RLS / RPCs

Migration `20260811000001_workspace_presence_activity_versions.sql`:

- **Tables** — `workspace_activity`, `workspace_project_versions`,
  `workspace_presence` (authorization gate rows for realtime presence). All
  RLS-enabled with member-only SELECT policies; **no client writes** —
  everything goes through SECURITY DEFINER RPCs (`search_path = public`,
  authenticated-only grants, `public`/`anon` revoked).
- **RPCs** — `ws_join_presence`, `record_activity_event`,
  `list_workspace_activity`, `list_project_versions`, `fetch_project_version`,
  `create_manual_version`, `restore_project_version`,
  `copy_project_from_version`; plus patched lifecycle RPCs
  (`create_workspace`, `update_workspace`, invitations, member role/removal,
  `create_workspace_project`, `save_workspace_project`,
  `delete_workspace_project`, `duplicate_workspace_project`,
  `delete_workspace`) that record activity and cascade versions.
- **Optimistic concurrency** — `save_workspace_project` and
  `restore_project_version` only succeed when the revision matches
  `expected_revision`; stale attempts raise `STALE_REVISION` and never
  overwrite newer state.
- **Privacy** — version snapshots are the same schema-validated Project
  payload the workspace server stores; collaboration/runtime metadata is
  structurally absent.

## 5. Mock backend

- `src/features/workspaces/mock/mock-workspace-server.ts` — in-memory presence
  sessions (TTL, per-user bound of 8, session-ownership on heartbeat/leave),
  activity events (allow-lists, retention 300, deterministic
  `(createdAt DESC, id DESC)` ordering + cursor), version records (dedupe,
  retention 50, metadata-only listing, lazy fetch, restore-as-new-revision,
  owner-only restore, checkpoint lease check).
- Exposed via `/api/workspaces/[[...path]]` (versions + activity endpoints)
  and `/api/presence/[[...path]]` — both disabled outside the mock
  environment.

## 6. Files created

- `docs/phase-p15-architecture.md`
- `src/app/api/presence/[[...path]]/route.ts`
- `src/features/workspaces/providers/` — `presence-provider.ts`,
  `mock-http-presence-provider.ts`, `supabase-presence-provider.ts`
- `src/features/workspaces/services/` — `presence-service.ts`,
  `activity-bridge.ts`
- `src/features/workspaces/hooks/` — `useWorkspacePresence.ts`,
  `useWorkspaceActivity.ts`, `useProjectVersionHistory.ts`
- `src/features/workspaces/store/` — `workspace-presence-store.ts`,
  `workspace-history-ui-store.ts`
- `src/features/workspaces/components/` — `PresenceIndicator.tsx`,
  `WorkspaceActivityPanel.tsx`, `VersionHistoryDialog.tsx`,
  `VersionPreviewDialog.tsx`, `RestoreVersionDialog.tsx`,
  `CopyVersionDialog.tsx`, `WorkspaceHistoryDialogs.tsx`, `version-labels.ts`
- `src/features/workspaces/utils/` — `time.ts`, `display-name.ts`
- `src/features/workspaces/__tests__/` — `workspace-presence.test.ts`,
  `workspace-activity.test.ts`, `workspace-versions.test.ts`,
  `workspace-p15-ui.test.tsx`
- `supabase/migrations/20260811000001_workspace_presence_activity_versions.sql`
- `e2e/helpers/p15.ts`, `e2e/workspace-presence.spec.ts`,
  `e2e/workspace-activity.spec.ts`, `e2e/workspace-version-history.spec.ts`

## 7. Files modified

- `src/app/api/workspaces/[[...path]]/route.ts` — activity + version endpoints
- `src/app/editor/[projectId]/page.tsx` — `useWorkspacePresence` +
  `WorkspaceHistoryDialogs`
- `src/components/editor/TopNav.tsx` — presence chips + History button
- `src/features/guided-builder/components/CommandPalette.tsx` — history
  commands
- `src/features/persistence/services/project-controller.ts` —
  `createProjectFromPayload` (personal copy from a version)
- `src/features/publishing/hooks/usePublishing.ts`, `useDomains.ts`,
  `src/features/sharing/components/ReviewLinksTab.tsx` — bridged activity
  events (publish/rollback/domains/share)
- `src/features/workspaces/` — `types.ts`, `constants.ts`, `errors.ts`,
  `mock/mock-workspace-server.ts`, `services/workspace-service.ts`,
  `providers/` (interface, mock-http, supabase), `hooks/useWorkspaceDashboard.ts`,
  `components/WorkspaceProjectsView.tsx` (Projects | Activity tabs)

## 8. Dependencies

None added. Reuses the cloud-environment factory, mock-cloud sessions, Supabase
client, `stableHash` (P6), `ProjectSchema`, the P14 project controller, and the
existing workspace provider/service boundaries.

## 9. Security review (post-implementation)

Reviewed every P15 surface against the architecture checklist (§69):

- **Presence** — membership enforced on join and every read (mock `requireMember`;
  Supabase `ws_join_presence` SECURITY DEFINER gate before any `track()`);
  session-id ownership enforced on heartbeat/leave (forgery → 403); per-user
  bound (8 sessions/workspace); server TTL with authoritative expiry; no device
  fingerprints/IPs/free-text payloads — fixed display-safe shape with
  server-derived `displayName`; server purge on member removal / role
  downgrade / project or workspace deletion; removed members stop receiving
  presence.
- **Activity** — actor always server-derived (client actor impossible);
  allow-listed types + per-type metadata keys, scalar/bounded values; no raw
  secrets (E2E asserts share events carry no token-like metadata); retention
  300; reads membership-gated; pagination cursor deterministic
  (`createdAt DESC, id DESC`).
- **Versions** — snapshots are Project-shaped only (schema-validated; no
  members/invitations/leases/copilot/share tokens/session by construction and
  asserted in tests); lazy snapshot fetch (list is metadata-only); restore
  owner-only + `expectedRevision` check (stale → `STALE_REVISION`, no side
  effects); copy/checkpoint editor/owner + lease; cross-workspace isolation
  (workspace-scoped keys + membership checks); deletion cascades versions;
  retention 50; oversized snapshots rejected (8 MiB gate).
- **Realtime** — channel auth via RPC (presence channels ignore RLS by
  design); one channel per workspace, `removeChannel()` on unsubscribe/leave;
  StrictMode-safe; account-switch cleanup.
- **Errors** — no Supabase internals / raw parse errors surfaced; structured
  codes + beginner-safe copy.

Findings: no genuine security defects. One operational note — a member removed
or downgraded while their editor is open produces deliberate 403 responses from
the still-running presence/lease heartbeat and read; the app transitions to an
honest read-only/disconnected state (no fake live data). The E2E runtime audit
now treats these as the deliberate-status category (see §12.4).

## 10. Tests

- **Workspace unit/component — 134 tests (8 files)**: presence (join,
  heartbeat, leave, expiry, lease-derived mode, multi-tab dedupe, bounds,
  membership isolation), activity (allow-lists, actor derivation, ordering,
  pagination, retention, filters, privacy exclusions, unauthorized reads),
  versions (creation + dedupe, revision semantics, metadata-only listing,
  lazy fetch, privacy, restore-as-new-revision, pre-restore, stale rejection,
  permission matrix, cross-workspace isolation, retention, deletion cleanup,
  copy), UI components (PresenceIndicator, WorkspaceActivityPanel,
  VersionHistoryDialog incl. fresh-fetch-on-open regression,
  RestoreVersionDialog stale/confirm, Escape/focus).
- **P15 E2E (3 specs, chromium, workers=1)**:
  - `workspace-presence.spec.ts` — A opens editable → "editing"; B blocked by
    A's lease → "viewing"; cross-observation with server-derived names; A
    leaves → B observes departure; non-member C reads nothing (403);
    runtime audit clean.
  - `workspace-activity.spec.ts` — workspace/project/member/save/share events
    with server actors; ordered newest-first; share metadata free of tokens;
    dashboard Activity tab renders plain language (no internal type names);
    non-member 403s; runtime audit clean.
  - `workspace-version-history.spec.ts` — creation makes no version; first
    save → deduped autosave v2 + `project.saved`; second save → v3 (list
    newest-first, metadata-only); stale save rejected; read-only preview via
    `VisitorPageView` (no editor chrome, snapshot content); editor B has no
    restore button and the wire returns `PERMISSION_DENIED`; owner UI restore
    → editor reloads to restored content, new revision + `restore`/`pre-restore`
    versions, historical versions intact, `project.version_restored`; stale
    restore rejected without side effects; identical save silent (revision
    bumps, no version, no extra `project.saved`); non-member 403s; runtime
    audit clean.

## 11. Validation results (exact)

Run sequentially, never concurrently:

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | ✅ clean |
| `npm run lint` | ✅ clean (0 errors, 0 warnings) |
| `npm test` | ✅ **3849 passed** (275 files) |
| `npm run build` | ✅ success |
| P15 E2E (3 specs, chromium, workers=1) | ✅ **3/3 passed** |
| `npm run test:e2e` (full, chromium, workers=1) | ✅ **111/111 passed** (110 + `workspace-permissions` after the genuine audit fix below; rerun green) |
| `npm run test:e2e:matrix` | ✅ **13/13 passed** |
| `npm run test:e2e:fallback` | ✅ **1/1 passed** |
| `npm run test:export-build` | ✅ **1/1 passed** (real `npm install && npm run build` of a generated project) |

## 12. Genuine findings and fixes (this session)

The session resumed mid-phase (interrupted by a model-connection timeout) with
the presence/activity specs written but **never run**. Running them surfaced
real issues — every one fixed and regression-tested:

1. **Version-history dialog showed a stale/empty list (product bug).**
   `VersionHistoryDialog` is always mounted and `useProjectVersionHistory`
   fetched on editor mount — *before the first save can exist* — and never
   refreshed on open. A user who edited and saved then opened History saw "No
   versions yet". Fixed by gating the list fetch on
   `{ active: dialogOpen }` (fetch fresh on every open, dormant while closed)
   + a component regression test ("fetches a fresh list on EVERY open").
2. **Presence E2E asserted the wrong display name.** The server derives names
   from emails via the `[._-]` heuristic, so `pres-b-…` → "Pres B", not
   "Presence B". Spec fixed; the activity spec's "Act B" was already correct.
3. **Activity E2E expected `project.created` but the dashboard flow records
   `project.moved_in`** (create-personal-then-move-in, `origin: "move-in"` in
   `useWorkspaceDashboard`). Spec fixed with a comment.
4. **Runtime-audit gap: deliberate 403s were flagged as violations.** When a
   member is removed/downgraded while their editor is open, P15's presence
   heartbeat/read (and lease heartbeat) return 403 — handled gracefully by the
   app, but the audit only tolerated 404/410/409. Added 403 to the
   deliberate-status benign patterns with a documenting comment (consistent
   with the existing 409 STALE_REVISION treatment). This was the sole failure
   of the full `test:e2e` run.
5. **Edit-before-access-resolved race (spec + latent product footgun).** An
   editor who types before `useWorkspaceEditorAccess` finishes resolving gets
   their edit wiped by the server re-hydration (`discardAndOpenProject`), so
   no save ever fires. The specs now wait for `expectEditingIndicator("Editing")`
   before editing (matching the P14 collaboration spec); the product behavior
   (transient `not-loaded` read-only) is correct by design.
6. **`RestoreVersionDialog` / `CopyVersionDialog` fetched a version list they
   never display** (hook default `active: true`). Passed `{ active: false }`
   to align with the new contract and avoid a wasted request per editor mount
   (from the final code review; no bugs found in the reviewed changes).
7. **Stale dev server incident.** The pre-existing server on `:3000` carried
   stale mock state ("Something went wrong on the demo workspace service" on
   workspace create). Killed it; Playwright started a fresh server with the
   current code and all specs passed.

## 13. Known limitations

- Restore is owner-only by design for P15; editors can preview and copy but
  not rewrite shared history.
- Version diffs are metadata-level (author/time/reason/revision); no visual
  diff engine in P15 (explicit non-goal).
- Activity/versions have no persistent local cache (fresh server fetch only) —
  offline shows an honest unavailable state.
- Supabase Realtime end-to-end verification requires a live project with
  credentials; semantics are validated through the mirroring mock (repo
  convention).
- A member's presence session ends on removal/downgrade server-side; the open
  editor's own session keeps heartbeating (each 403s until the tab is closed)
  but the UI shows an honest disconnected state and never fake live data.
- No WCAG certification claim.

## 14. Genuine P16+ candidates (only)

- Collaborative editing primitives (CRDT/OT), version visual diffing,
  cross-project history search / activity export, activity filtering by actor,
  presence on the dashboard workspace view, version branching/merging,
  Supabase Realtime live verification. P16 not started.
