# Phase P14 — Report: Team Workspaces & Controlled Collaboration

Branch: `phase-p14-team-workspaces-collaboration`
Design document: `docs/phase-p14-architecture.md` (written before implementation).

Phase P14 ships **server-authoritative team workspaces with controlled
collaboration**: a user can create a workspace, invite teammates as editors or
viewers by email, move personal projects into a workspace (or create them
there), open a workspace project in the editor with an **edit lease** that
prevents two people editing at once, and get **optimistic concurrency** so a
stale save can never silently overwrite a newer version. Every authorization
decision is enforced server-side (RLS/SECURITY DEFINER RPCs in Supabase, the
mirroring in-memory mock backend); the client only ever renders decisions. A
single **read-only editor boundary** (viewer role, lease blocked, offline, or
revoked access) is enforced at the editor store, Copilot, publishing, sharing,
and the dashboard.

---

## 1. Delivered

- **Workspace model** — `workspaces` (owner + name), `workspace_members`
  (owner/editor/viewer rows for every member incl. owner),
  `workspace_invitations` (recipient-scoped, 14-day expiry, revocable,
  replaceable, rate-bounded), `workspace_projects` (server-authoritative
  schema-validated payload + monotonically increasing `revision`),
  `project_edit_leases` (short-lived renewable leases, server-issued ids).
- **Providers + service** — `WorkspaceProvider` interface implemented by
  `SupabaseWorkspaceProvider` (RPCs) and `MockHttpWorkspaceProvider` (API
  route over the in-memory mock), behind `WorkspaceService` with structured
  errors and beginner-safe copy. Provider factory reads the cloud environment;
  no backend → workspaces unavailable and hidden.
- **Dashboard** — workspace switcher (keyboard-accessible), workspace view
  with permission-aware cards, move-to-workspace, create-in-workspace, manage
  dialog (create/rename/delete/invite/roles/remove/leave/revoke invites),
  invitations panel (accept/decline), `WorkspaceProjectCard`
  (viewer badges vs owner management actions).
- **Editor session** — `useWorkspaceEditorAccess` resolves access per project
  open, fetches the server-authoritative project and re-hydrates the editor
  through the controller, acquires/holds/renews the edit lease with a
  heartbeat, pushes debounced server saves with optimistic concurrency, and
  transitions to a safe read-only state on authorization loss (member removed,
  role downgraded, lease expired) or offline.
- **Editor read-only guard** — the editor store rejects every mutation when
  the access store reports non-editable (`READONLY`), including Copilot plan
  application and inline edits; the transient `not-loaded` state means no
  mutation can slip through between mount and access resolution.
- **Permission gates** — Copilot (EDIT blocked with `COPILOT_EDIT_UNAVAILABLE`,
  ASK/readiness stay), publishing (`canPublishProject` role + editable check in
  `usePublishing.publish`), sharing (read-only gate in `ShareDialog` +
  server-side `ws_can_manage_review_links`), top-nav publish/share buttons,
  dashboard new-project/manage/duplicate/delete.
- **Collaboration UI** — read-only banner, "being edited" blocker (with holder
  name, open read-only, retry/takeover after expiry), stale-revision save
  conflict dialog (reload latest / save as personal copy / keep editing),
  workspace context chip in the top nav.
- **Offline behavior** — workspace projects open read-only from the honest
  local cache with a clear offline banner; changes need a connection.

## 2. Architecture decisions

- **Server-authoritative projects.** A workspace project's payload lives on the
  server; the device keeps only a user-scoped cache copy plus metadata
  (`workspaceId`, `userId`, `serverRevision`) that routes saves — never an
  authorization source. The server decides access on every open and save.
- **Edit lease as a UX coordination layer; optimistic concurrency as the data
  safety layer.** The lease (60s, heartbeated) makes "two humans editing at
  once" visible and recoverable; the revision check makes a stale save
  physically impossible. Both are enforced server-side; the lease is *not*
  required to save (any editor with the correct revision may) — see §23.
- **Read-only boundary at the store.** The editor store consults
  `isEditorWritable()` (the standalone access store — no circular import) for
  every mutation, giving one chokepoint that Copilot, inline editing, and all
  direct store calls share.
- **Remount-per-open dialogs.** `WorkspaceSettingsDialog` mounts its inner
  management surface fresh on every open (keyed by workspace id) so all state
  derives from props at mount — no reset/loading-from-effect hacks (see §19.1).
- **Mock/Supabase parity.** The in-memory mock enforces the same authorization
  semantics as the RLS/RPCs (membership-only reads, owner-only management,
  recipient-scoped invitations, role-scoped leases, optimistic concurrency,
  owner invariants, share gates, lease + share isolation), so the full feature
  is E2E-exercisable without credentials.

## 3. Permission matrix

| Action | Owner | Editor | Viewer | Non-member |
|---|---|---|---|---|
| Create workspace | — | — | — | ✓ |
| Rename / delete workspace | ✓ | ✗ | ✗ | ✗ |
| List members / invites | ✓ | ✗ | ✗ | ✗ |
| Invite / revoke invite | ✓ | ✗ | ✗ | ✗ |
| Change role / remove member / leave | ✓ (not self-remove) | leave only | leave only | ✗ |
| Create / duplicate workspace project | ✓ | ✓ | ✗ | ✗ |
| Edit (lease + save) | ✓ | ✓ | ✗ | ✗ |
| Delete workspace project | ✓ | ✗ | ✗ | ✗ |
| Read projects / open editor | ✓ | ✓ | ✓ (read-only) | ✗ |
| Publish | ✓ | ✓ | ✗ | ✗ |
| Create/manage review links | ✓ | ✓ | ✗ | ✗ |
| Move personal project in | ✓ | ✓ | ✗ | ✗ |

Invariants: a workspace always has an owner (owner can't be removed, can't
leave, can't be downgraded); role downgrade to viewer and member removal
immediately invalidate leases AND revoke the member's review links; removed
members' pending invitations are voided.

## 4. Edit lease architecture

- Server-issued `lease-<uuid>-<hex>` ids; one active lease per
  `(workspace_id, project_id)`; 60s TTL renewed by a heartbeat
  (`EDIT_LEASE_HEARTBEAT_MS`), auto-released on expiry, stale leases are
  replaceable.
- Holders' emails are surfaced to same-workspace members only (display name is
  derived client-side; never a device id).
- Client flow: resolve → fetch server project → role check → existing lease?
  (mine → renew, other's → read-only `being-edited`) → else acquire; heartbeat
  on an interval; release on unmount/project switch/sign-out (best-effort,
  StrictMode-safe). Heartbeat/release verify `lease_id` ownership — forged or
  foreign lease ids are rejected (`LEASE_INVALID`).
- Role downgrade / member removal delete the member's leases server-side, so
  the open editor session's next heartbeat fails and transitions to read-only.

## 5. Optimistic concurrency

- `save_workspace_project` (and the mock) succeed only when
  `revision = expectedRevision`, bumping the revision atomically; otherwise
  `STALE_REVISION` (409) and the editor surfaces the conflict dialog —
  **never an overwrite**. The revision base is re-read on every open (fresh
  server fetch) and refreshed after every successful save.
- Saves are debounced (`WORKSPACE_SAVE_DEBOUNCE_MS`) and pushed while a lease
  is held; a rejected save marks the session read-only-safe and offers
  reload-latest / save-as-personal-copy.

## 6. Personal vs workspace storage behavior

- **Personal projects**: device IndexedDB is authoritative; the workspace store
  reports `editable` with no lease; publishing/share keep their P12 semantics.
- **Workspace projects**: opening fetches the server payload, writes a fresh
  device cache copy (suppressed dirty) via the controller, and marks it with
  user-scoped workspace cache metadata. Saves route to the server. The
  dashboard lists workspace projects only inside the selected workspace view;
  export, delete, and move actions are permission-aware. Duplicates get a fresh
  server identity (new id, revision 1, no lease/links/deployments copied).
- The cache metadata is never an authorization source and is scoped by
  `userId` + `workspaceId` + `projectId` (cross-account and cross-workspace
  isolation: another account's cache metadata is treated as a personal
  project).

## 7. Offline behavior

- Offline (network error / `OFFLINE`) workspace opens stay **read-only** from
  the honest local cache with an explicit banner; edits, publishing, sharing,
  and Copilot EDIT are blocked until reconnection. No queueing of workspace
  writes (writes require the server; the local copy is never silently
  divergent).

## 8. Copilot / publishing / sharing permissions

- **Copilot**: the plan-edit boundary returns `COPILOT_EDIT_UNAVAILABLE` for
  any non-editable session with role-aware copy; ASK and readiness review stay
  available; quick-edit actions are hidden in read-only; the panel shows a
  read-only notice. Defense-in-depth behind the editor-store `READONLY` guard.
- **Publishing**: `usePublishing.publish` re-checks `canPublishProject(role)`
  and `access.mode` at the service boundary (a stale UI can't publish); the
  top-nav button is disabled in read-only.
- **Sharing**: `ShareDialog` gates read-only sessions; the server
  (`ws_can_manage_review_links` RPC / mock gate) allows review-link creation
  and management only for owner/editor members, empty enumerations otherwise;
  member removal/downgrade revokes the member's links; deleting a workspace
  project or workspace revokes its links.

## 9. Supabase schema / RLS / RPCs

- Tables: `workspaces`, `workspace_members`, `workspace_invitations`,
  `workspace_projects`, `project_edit_leases` — all RLS-enabled; direct reads
  only through narrow membership policies; **all writes via SECURITY DEFINER
  RPCs** (`search_path = public`, authenticated-only grants, never anon).
- RPC families: workspace lifecycle, members, invitations, projects
  (validate → create/list/fetch/save/delete/duplicate), leases
  (acquire/heartbeat/release/get/revoke). Payloads are schema/name/byte-bound
  validated server-side; invitation emails are recipient-scoped via
  `auth.jwt()`; lease uniqueness is `(workspace_id, project_id)`.
- Migration 2 extends the P12 share RPCs with workspace-aware gates
  (`ws_can_manage_review_links` — caller must hold owner/editor in **every**
  workspace holding the project id), member-removal/downgrade share revocation
  (`ws_revoke_member_shares`), and project/workspace-deletion share revocation
  (`ws_revoke_project_shares`).

## 10. Mock backend

- `src/features/workspaces/mock/mock-workspace-server.ts` — in-memory
  authorization-mirroring backend (sessions shared with the P6 mock cloud,
  globalThis state so two browser contexts share one "cloud" for E2E), exposed
  via `/api/workspaces/[[...path]]` (mock environment only; disabled otherwise).
- The mock share server (`mock-share-server.ts`) carries the workspace-aware
  share gate + revocation mirrors; the workspace route composes them (share
  revocation on project/workspace delete and on member removal/downgrade).

## 11. Files created

- `src/features/workspaces/` — `types.ts`, `errors.ts`, `constants.ts`,
  `permissions/workspace-permissions.ts`, `providers/` (interface, supabase,
  mock-http), `services/` (workspace-service, workspace-local-cache),
  `mock/mock-workspace-server.ts`, `store/` (workspace-dashboard-store,
  workspace-access-store), `hooks/` (useWorkspaceDashboard,
  useWorkspaceEditorAccess), `components/` (WorkspaceSwitcher,
  WorkspaceSettingsDialog, WorkspaceInvitationsPanel, WorkspaceProjectsView,
  WorkspaceProjectCard, MoveProjectDialog, CollaborationDialogs),
  `__tests__/` (mock-workspace-server, workspace-local-cache,
  workspace-permissions, workspace-ui, mock-workspace-server.test).
- `src/app/api/workspaces/[[...path]]/route.ts`
- `supabase/migrations/20260810000001_workspaces_schema.sql`,
  `20260810000002_workspace_share_gates.sql`
- `docs/phase-p14-architecture.md`, `docs/phase-p14-report.md`
- `e2e/helpers/workspaces.ts`, `e2e/workspace-collaboration.spec.ts`,
  `e2e/workspace-edit-lease.spec.ts`, `e2e/workspace-permissions.spec.ts`

## 12. Files modified

- `src/app/page.tsx` (workspace dashboard view, switcher, dialogs,
  create/move flows), `src/app/editor/[projectId]/page.tsx`
  (useWorkspaceEditorAccess + CollaborationDialogs), `src/components/editor/TopNav.tsx`
  (workspace context chip, read-only publish/share gating),
  `src/features/editor/store/editor-store.ts` (READONLY guard),
  `src/features/ai-copilot/...` (edit gate, read-only notice, QuickActions),
  `src/features/ai-editing/plan-types.ts` (`PLAN_READONLY`),
  `src/features/inline-editing/types.ts`, `src/features/publishing/...`
  (gate + `PERMISSION_DENIED`), `src/features/sharing/...` (ShareDialog gate,
  mock share server workspace gate + revocation), `e2e/helpers/runtime-audit.ts`
  (deliberate 409 tolerated).

## 13. Dependencies

None added. Reuses the existing cloud-environment factory, mock-cloud sessions,
Supabase client, project controller, IndexedDB metadata API, and the P12 share
infrastructure.

## 14. Genuine findings and fixes (security review + lint cleanup)

1. **`react-hooks/set-state-in-effect` in WorkspaceSettingsDialog.** The
   previous `await Promise.resolve(); setLoading(true)` microtask hack was
   still flagged. Restructured to an outer shell (`WorkspaceSettingsDialog`
   returns `null` when closed) that mounts `WorkspaceSettingsDialogInner`
   keyed by workspace id; the inner derives all state at mount and loads
   members/invitations in an async effect that only commits after the awaited
   fetches (cancellation-guarded). `reload()` is now handler-only. Also fixed:
   the loading spinner no longer hangs if the provider is null.
2. **MoveProjectDialog stale-state bug (pre-existing).** `targetWorkspaceId`
   was only initialized via a `prevOpen` render-phase reset, so mounting the
   dialog directly in the open state left the confirm button disabled forever
   (two component tests failed). Fixed with a lazy `useState` initializer
   covering both mount-open and toggle-open paths.
3. **Cross-workspace `project_id` lease collision (mock + Supabase).** Leases
   were keyed by `project_id` only, so a same-id project in another workspace
   could be blocked by, release, or delete the first workspace's lease.
   Fixed: leases are scoped by `(workspace_id, project_id)` everywhere
   (mock keying, migration `unique` constraint, acquire/get/delete scoping);
   `revoke_leases_for_project` now revokes per-workspace with membership
   checks (skipping, never throwing, never touching others' leases).
4. **Cross-workspace share-gate bypass surface.** `ws_can_manage_review_links`
   and the mock gate matched a project id in ANY workspace; a viewer in one
   workspace holding the same id could gain link management via another.
   Fixed: the caller must hold owner/editor in **every** workspace holding the
   id (Supabase `not exists` denying row; mock all-workspaces check).
5. **Removed/downgraded members' review links stayed live in the mock.** The
   mock's `requireOwnerOfShare` re-check blocked management, but the public
   snapshot remained resolvable, unlike the Supabase `ws_revoke_member_shares`
   patch. Fixed: route-level `revokeMemberSharesForWorkspace` on member
   removal and viewer downgrade (mirror RPC), plus `revokeActiveSharesForProject`
   wired into project/workspace deletion (mock) and
   `ws_revoke_project_shares` + patched delete RPCs (migration 2).
6. **Lint/deps cleanup.** Unused imports (`WorkspaceProjectCard`,
   `Loader2`, `useRef`, `toWorkspaceError`, `MockWorkspaceState`), missing
   `wsBusy` deps in dashboard handlers, unstable `optionEntries`/
   `footerEntries` (memoized), `useWorkspaceEditorAccess` dependency hygiene
   (`getWorkspaceProvider` dropped; `clearTimers` added; React Compiler
   inference satisfied with `user`), dead `accessStore`/`workspaceBackend`
   returns removed.

Regression tests added: lease workspace-scoping (independent same-id leases,
scoped revocation), share-gate all-workspaces rule, removed-member link
management loss, share revocation on project delete and member removal,
MoveProjectDialog mount-open behavior.

## 15. Tests

- **Workspace unit/component** — 65+ tests: mock backend authorization
  (create/list, member/owner invariants, invitations incl. recipient-scoping +
  expiry + revocation + duplicates, projects with optimistic concurrency,
  viewer/editor/non-member gating, leases incl. blocking, stale takeover,
  forgery, removal/downgrade invalidation, workspace-scoped isolation,
  share revocation mirrors), local cache isolation, permissions matrix,
  dashboard UI (switcher keyboard nav, settings dialog flows, move dialog,
  collaboration dialogs).
- **P14 E2E (3 specs)** — `workspace-collaboration` (two users share a
  workspace project, edit, save, re-open), `workspace-edit-lease` (lease
  blocks concurrent editing, hands over, rejects stale saves),
  `workspace-permissions` (roles enforced; authorization changes take effect).

## 16. Validation results (exact)

Run sequentially, never concurrently:

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | ✅ clean |
| `npm run lint` | ✅ clean (0 errors, 0 warnings) |
| `npm test` | ✅ **3782 passed** (271 files) — P13's 3708 + P14 coverage |
| `npm run build` | ✅ success (incl. `/api/workspaces/[[...path]]`) |
| P14 E2E (3 specs, chromium, workers=1) | ✅ **3/3 passed** (multiple clean runs) |
| `npm run test:e2e` (full, chromium, workers=1) | ✅ **106 passed / 2 failed → both flaky** (see §17; each passed on rerun) |
| `npm run test:e2e:matrix` | ✅ **13/13 passed** |
| `npm run test:e2e:fallback` | ✅ **1/1 passed** |
| `npm run test:export-build` | ✅ **1/1 passed** |

## 17. Incidents (documented truthfully)

- **Full-suite `test:e2e` run: 2 failures, both flaky and unrelated to P14.**
  `editor.spec.ts:210` (visibility toggle) and `inline-ai-editing.spec.ts:100`
  (suggest/accept/undo) failed in the long single-worker run; both passed when
  rerun in isolation. `editor.spec.ts:608` ("Real pipeline") also failed once
  under load and passed on two subsequent isolated runs (it performs a genuine
  provider call and is sensitive to dev-server load — same classification as
  P13 §22). No production code was changed for these.
- **Pre-existing component-test breakage surfaced by lint work.** Two
  `MoveProjectDialog` tests failed once the dialog was exercised directly —
  a genuine stale-state bug (finding §14.2), fixed with a regression test.
- **Pre-existing jsdom noise** (`HTMLCanvasElement.toDataURL` not implemented,
  `act()` warnings in my-blocks/code-import tests) is environmental and
  unchanged.

## 18. Known limitations

- `save_workspace_project` does not require the caller to hold the edit lease
  (any editor with the correct revision may save). The revision check makes
  stale overwrites impossible; the lease remains a coordination/UX layer. This
  is consistent across mock and Supabase by design.
- A same `project_id` can technically exist in two workspaces via direct API
  use (the UI never produces this). All P14 server logic now treats that case
  safely (workspace-scoped leases, all-workspaces share gate, safe-direction
  share revocation); a future `project_id` namespacing change could remove it
  entirely.
- Copilot memory is device-local and keyed by project id (P11 design); a
  shared device switching accounts could surface a previous local record for
  the same project id. Unchanged from P11 and out of P14 scope.
- Invitations match by email at acceptance time; email changes before
  acceptance invalidate pending invites.
- Rollback/cancel/delete of deployments is not re-gated for read-only sessions
  beyond the publish gate (deployment records are device-local and only
  reachable by whoever published on that device).
- No WCAG certification claim.

## 19. Genuine P15 candidates (only)

- Presence indicators / live cursor awareness for collaborators (the lease
  model exposes holder identity; a lightweight presence layer is the natural
  next step).
- Per-workspace project templates and workspace-scoped personal templates.
- Workspace audit log (member role changes, project moves/deletes) backed by
  the existing tables.
- Transfer workspace ownership (currently only delete — the last-owner
  invariant is enforced).
- Offline edit queueing with server reconciliation for workspace projects
  (explicitly out of scope for P14; requires a conflict strategy beyond
  revision checks).
