# Phase P14 — Architecture Decisions: Team Workspaces & Controlled Collaboration

Branch: `phase-p14-team-workspaces-collaboration`
Written before implementation. This document reconciles the Phase P14
specification with the actual repository state (Phases P1–P13 all merged) and
records every design decision the phase is built on.

---

## 1. Phase goal

Buildora currently supports individual ownership and external read-only review
(P12). P14 introduces **authenticated team collaboration on the same project**:

1. create / belong to a **workspace** (team),
2. invite authenticated collaborators,
3. assign clear roles (OWNER / EDITOR / VIEWER),
4. share projects with workspace members,
5. let permitted members **edit** projects safely,
6. prevent unauthorized edits,
7. coordinate edits with an **edit-lease (checkout) model** — explicitly NOT
   real-time simultaneous editing,
8. show who owns / has access to a project,
9. remove / revoke access,
10. preserve project integrity, history, recovery, publishing, and local-first
    behavior.

P14 is **controlled multi-user access with safe edit ownership/coordination**,
not CRDT/OT/live-cursors/Google-Docs-style editing.

## 2. User problems solved

1. A user cannot let a teammate edit the same site without sharing a device or
   exporting/importing `.buildora.json` files by hand.
2. There is no ownership concept above "the account that created the project",
   so "team website" workflows (agency, small business, student group) have no
   home.
3. There is no way to grant read-only access to an authenticated account, or to
   revoke a collaborator after they joined.
4. There is no coordination guard, so two people editing the same project
   could silently overwrite each other.
5. Existing external review (P12) is anonymous and one-way; it cannot serve
   "invite my teammate to edit".

## 3. Workspace model

```ts
interface Workspace {
  id: string;          // server-owned uuid
  name: string;        // ≤ 80 chars, trimmed
  ownerId: string;     // creator; the initial OWNER
  createdAt: string;
  updatedAt: string;
  /** Denormalized projections for lists. */
  memberCount?: number;
  projectCount?: number;
  /** Role of the CURRENT user (owner | editor | viewer) — populated server-side. */
  memberRole?: WorkspaceRole;
}
```

- Minimal P14 model. No description/avatar/icon metadata (deferred).
- A workspace always has exactly one `ownerId` (the creator). Ownership
  transfer is **not** in scope (documented deferral).

## 4. Membership model

```ts
type WorkspaceRole = "owner" | "editor" | "viewer";

interface WorkspaceMember {
  workspaceId: string;
  userId: string;
  email: string;       // profile join (never exposed to other members beyond management UI)
  role: WorkspaceRole;
  joinedAt: string;
}

interface WorkspaceInvitation {
  id: string;
  workspaceId: string;
  workspaceName: string;   // snapshot for the invite list
  invitedBy: string;       // user id
  recipientEmail: string;  // normalized lowercase; never exposed to other members
  role: "editor" | "viewer";  // you cannot invite an owner
  status: "pending" | "accepted" | "revoked" | "expired";
  createdAt: string;
  expiresAt: string;       // 14 days (constant)
  acceptedAt?: string | null;
}
```

- The owner row lives on the workspace (`ownerId`), not in the member table
  (mirrors the P6 shared-library pattern).
- Roles are exactly three: **OWNER, EDITOR, VIEWER**. No ADMIN.

## 5. Roles/permissions (centralized, deterministic)

Central helpers in `src/features/workspaces/permissions/workspace-permissions.ts`
(the single source of truth — UI never re-implements these inline):

| Capability | OWNER | EDITOR | VIEWER |
|---|---|---|---|
| Rename / delete workspace | ✅ | ❌ | ❌ |
| Invite / remove members / change roles | ✅ | ❌ | ❌ |
| See member list | ✅ | ❌ | ❌ |
| Leave workspace | ❌ (must delete) | ✅ | ✅ |
| Create project in workspace | ✅ | ✅ | ❌ |
| Move personal project into workspace | ✅ | ✅ | ❌ |
| Edit workspace projects | ✅ | ✅ | ❌ |
| Save workspace projects | ✅ | ✅ | ❌ |
| Preview workspace projects | ✅ | ✅ | ✅ |
| Publish workspace projects | ✅ | ✅ (documented) | ❌ |
| Manage custom domains | ✅ | ❌ | ❌ |
| Create/manage review links | ✅ | ✅ (documented) | ❌ |
| Delete workspace project | ✅ | ❌ | ❌ |
| Duplicate workspace project | ✅ | ✅ | ❌ |
| Copy workspace project to personal | ✅ | ❌ | ❌ |

Key helper functions (all take a role; server remains authoritative):

- `canManageWorkspace(role)` — rename/delete workspace, members, invites.
- `canInviteMembers(role)` — alias of manage.
- `canCreateProjects(role)`, `canMoveProjects(role)`.
- `canEditProject(role)`, `canSaveProject(role)`.
- `canDeleteProject(role)`.
- `canPublishProject(role)` — EDITOR granted (documented decision, see §31).
- `canManageDomains(role)` — owner only.
- `canManageReviewLinks(role)` — owner + editor (documented, see §33).
- `canDuplicateProject(role)`, `canCopyToPersonal(role)`.

## 6. Project ownership model

- A project is either **personal** (owned by exactly one account, local-first,
  unchanged from P1–P13) or **workspace-owned** (owned by a workspace).
- Ownership metadata: a `workspace_projects` server row is the authoritative
  record. A small **local cache metadata** record
  (`{ workspaceId, userId, serverRevision, serverUpdatedAt }`) is stored per
  device so the dashboard can label/filter and the editor knows how to route
  saves — but it is **never an authorization source**.
- **Backward compatibility:** existing P1–P13 projects have no workspace
  metadata and remain personal by default. No destructive migration.

## 7. Project sharing model

- Sharing a project = making it a **workspace project**: server stores a
  validated project payload with a server revision; every workspace member
  with the right role can access it.
- There is no per-project ACL beyond workspace membership: membership in the
  workspace grants access to every project in that workspace (viewers see all,
  editors can edit all, owner manages all). Per-project permission lists are an
  explicit non-goal.

## 8. Invitation model

- **In-app invitations only** (consistent with P6/P12; no email delivery — the
  product has no mail service, and the spec forbids faking email).
- Owner invites by email + role (editor/viewer). Recipient-scoped: acceptance
  requires `auth.email() == invitation.recipientEmail` (server-enforced).
- Expiry 14 days; owner can revoke a pending invite; re-inviting replaces any
  prior pending invite for the same workspace+email (double-invite safe).
- "Invite yourself" and "already a member" are rejected server-side.
- The recipient sees pending invitations in the dashboard "Invitations" panel.

## 9. Access-revocation model

- Removing a member deletes the membership row (immediate). Every workspace
  project access call re-checks membership server-side, so future access is
  denied immediately.
- Any **active edit lease** held by the removed member is revoked server-side;
  the client detects revocation on heartbeat/save (403) and transitions to a
  safe read-only/closed state without waiting for a reload.
- Workspace deletion revokes nothing extra — deleting the workspace removes its
  project rows (server-side cascade). Owner-only action, with a confirmation
  dialog.

## 10. Editor access model

One central runtime guard: `EditorAccessContext`:

```ts
interface EditorAccessContext {
  mode: "editable" | "readonly";
  reason?: "viewer" | "being-edited" | "offline" | "unauthorized" | "not-loaded";
  /** When "being-edited": the other member's name. Never device ids. */
  editedBy?: string;
}
```

- Stored in `src/features/workspaces/store/workspace-access-store.ts` (Zustand,
  standalone — no editor-store dependency, so the editor store can import it
  without a cycle).
- The editor store's mutation actions check `isEditorWritable()` at the top and
  return `{ ok: false, error: { code: "READONLY", … } }` (or early-return for
  void mutations). This is **one central boundary** — not dozens of scattered
  UI conditions. UI hiding is cosmetic; the store guard is the real boundary.
- Manual editing AND AI editing AND inline editing AND undo/redo mutations all
  route through the guarded actions.

## 11. Edit coordination strategy — EDIT LEASE (checkout) model

Chosen over a permanent lock: a **short-lived, renewable edit lease**.

```
ProjectEditLease {
  projectId: string;
  workspaceId: string;
  leaseId: string;      // random, server-issued
  userId: string;       // server sets from the session — never client-supplied
  acquiredAt: string;
  expiresAt: string;    // acquiredAt + LEASE_DURATION_MS (60s)
  heartbeatAt: string;
}
```

- An editor opening a workspace project attempts to **acquire** a lease. If the
  current user already holds one, it is renewed. If another user holds an
  **active** lease → denied; the UI shows "Currently being edited by <name>".
- Lease is renewed by a **heartbeat** (~ every 20s) while the editable project
  is active in the editor; it stops on unmount, sign-out, project switch.
- **Automatic expiry** (60s without heartbeat) makes stale leases recoverable —
  a crashed browser never leaves a permanent lock.
- Server time is authoritative; a forged lease id / user id is rejected.
- **Takeover**: only allowed after expiry (server rejects `forceTakeover` on an
  active lease). No arbitrary editor can kick an active editor.

## 12. Save/version/conflict strategy — optimistic concurrency

- Every workspace project has a server `revision` (int, starts at 1). It is
  **distinct** from the editor-history revision, the local IndexedDB revision,
  and deployment revisions.
- Saves use **optimistic concurrency**:
  `UPDATE workspace_projects SET payload=…, revision=revision+1 WHERE project_id=… AND revision = expectedRevision`.
  Affected rows = 0 → `STALE_REVISION`.
- On `STALE_REVISION` the editor shows: **"This project changed since you
  opened it."** with choices: **Reload latest** · **Save a personal copy** ·
  (dismiss to review). No automatic merge.
- Server saves are debounced (~1.5 s) on project revision change, only while
  the workspace project is open AND the lease is held AND the mode is editable.
- Saves also flow to the local IndexedDB cache (so the latest cached copy is
  always on-device) — the server is authoritative for cross-member reads.

## 13. Cloud/local-first interaction

- **Personal projects: unchanged** — fully local-first (IndexedDB), exactly as
  P1–P13.
- **Workspace projects: server-authoritative with a local cache.** The server
  stores the validated payload; the device keeps a cache copy for offline
  read-only and fast re-open. The workspace feature never touches the P6 cloud
  sync engine (My Blocks only) and never converts personal projects to
  cloud-first.
- The dashboard "Personal" view lists only non-workspace local projects; the
  workspace view lists server workspace projects (authoritative), merged with
  local cache for offline read-only labels.

## 14. Offline behavior

- Workspace project opens from the local cache **read-only** when offline:
  banner copy "You're offline. Shared projects are read-only until you
  reconnect."
- Editing shared workspace projects requires connectivity (lease + concurrency
  guarantees). No offline collaborative writes are promised.
- Personal projects remain editable offline (unchanged).

## 15. Recovery implications

- Personal recovery snapshots (P9) are unchanged.
- For workspace projects, local recovery snapshots may exist per user/device,
  but restoring must **not** silently overwrite shared server state: if the
  snapshot's server revision is behind the current server revision, restore
  requires an explicit path (the save-conflict dialog's "Save a personal copy"
  semantics). No direct stale-push over shared state.

## 16. History/undo implications

- Editor undo/redo (history stack) is per-session, unchanged, and local.
- Undo/redo **mutations** are disabled in readonly mode (the guard also covers
  undo/redo so a viewer cannot rewind a shared project visually into a state
  that contradicts the server).
- Server revisions are write-side only; they never feed the editor history
  stack.

## 17. Publishing permissions

- OWNER: publish (existing behavior). EDITOR: publish is **granted** and
  documented (agencies commonly need editors to ship updates). VIEWER: cannot
  publish.
- Provider (Vercel) credentials remain tied to the authenticated owner's
  account/provider architecture — they are never shared with workspace members
  (deployments/domains stay out of `ProjectSchema` and out of the workspace
  payload).

## 18. Custom domains

- Owner-only: a viewer/editor cannot add/remove a production domain. The
  Publish/Launch UI hides domain management unless the role is OWNER.

## 19. Share-link permissions

- Workspace project review links obey workspace permissions: OWNER and EDITOR
  can create/manage links (documented); VIEWER cannot. Existing P12 public
  viewer behavior is unchanged (links stay valid; sign-out does not invalidate
  them).
- The Share surface is hidden/disabled for readonly editor sessions.

## 20. Template/package implications

- Personal templates (P9) and `.buildora-template` packages (P13) remain
  **personal** — never auto-exposed to workspaces.
- Creating a project from a personal/imported template inside a workspace
  creates a **workspace project copy** (fresh identity through the canonical
  creation path, then pushed to the workspace). No template-access leak.

## 21. Project duplication/import implications

- Duplicating a workspace project: fresh project id, fresh server identity,
  **no edit lease, no review links, no deployment history, no comments**
  copied; permissions inherited from the destination workspace.
- Importing `.buildora.json` always creates a **personal** project (unchanged);
  the user may then move it into a workspace.

## 22. Project deletion implications

- Deleting a personal project: unchanged local behavior + existing P12 share
  cleanup.
- Deleting a workspace project: server row removed (owner-only), local cache +
  thumbnails + copilot memory + share data cleaned best-effort (reuses the
  existing cleanup hooks).
- Deleting a workspace: cascades workspace_projects + members + invitations +
  leases server-side; local caches for those projects are cleaned
  best-effort. Requires confirmation and last-owner safeguards.

## 23. Auth/provider architecture

- Reuses the existing `AuthService` (Supabase / mock) and `getSessionUser()`
  provider pattern (P6/P12). No new auth mechanism.
- The workspace provider is a **new provider abstraction** (`WorkspaceProvider`,
  P6/P12 style) with `mock` (dev/E2E HTTP backend) and `supabase`
  implementations. The UI only talks to the provider boundary via
  `WorkspaceService`.
- Sign-out: best-effort release of any active lease, clear the workspace access
  store + any workspace-sensitive UI cache; **never** delete workspace data
  remotely; local personal data unchanged.

## 24. Mock backend parity

- The mock backend (`mock/mock-workspace-server.ts` on `globalThis` +
  `/api/workspaces/[[...path]]/route.ts`) enforces the **same** permission
  model as Supabase RLS/RPCs:
  - membership-only reads; owner-only management; editor/viewer gating;
  - recipient-scoped invitations; role-scoped lease acquisition;
  - `expectedRevision` optimistic concurrency; stale-write rejection;
  - no cross-workspace enumeration.
- Parity-sensitive behaviors (viewer mutation denial, stale save rejection,
  owner invariants) have dedicated unit tests so E2E cannot pass against a mock
  that accepts what Supabase would reject.

## 25. Supabase schema

One additive migration `20260810000001_workspaces_schema.sql`:

- `workspaces` — `id uuid pk`, `owner_id uuid fk profiles`, `name text`,
  `created_at`, `updated_at`.
- `workspace_members` — `workspace_id uuid fk cascade`, `user_id uuid fk
  profiles cascade`, `role text check (owner,editor,viewer)`, `joined_at`,
  `pk (workspace_id, user_id)`. (Owner row is on the workspace; owner may also
  appear for join-date ordering.)
- `workspace_invitations` — `id uuid pk`, `workspace_id uuid fk cascade`,
  `invited_by uuid`, `email text`, `role text`, `status text`,
  `token_hash text` (unused for in-app flow; kept for parity), `created_at`,
  `expires_at`, `accepted_at`.
- `workspace_projects` — `workspace_id uuid fk cascade`, `project_id text`,
  `payload jsonb` (validated Project), `revision int not null`,
  `name text`, `created_by uuid`, `created_at`, `updated_at`,
  `pk (workspace_id, project_id)`. `project_id` is the client-generated
  canonical project id (stable across devices).
- `project_edit_leases` — `project_id text`, `workspace_id uuid`,
  `lease_id text pk`, `user_id uuid`, `acquired_at`, `expires_at`,
  `heartbeat_at`.

## 26. RLS

- RLS enabled on all four private tables; direct table access for clients is
  disabled except owner-scoped selects through SECURITY DEFINER RPCs.
- Members can only see workspaces they belong to; viewers cannot mutate
  projects; editors cannot manage membership; invitations are recipient-scoped
  (`auth.jwt() ->> 'email'`); lease acquisition requires editor+ role; project
  updates require edit permission AND a valid lease; deletion is owner-only.
- No predictable-id bypass: all id checks happen inside RPCs with
  `auth.uid()` membership verification.

## 27. SECURITY DEFINER RPCs

Every RPC verifies: `auth.uid()` present → workspace exists → caller
membership/role → target project belongs to the workspace → invitation
recipient where applicable. Grants are minimal (`execute` to `authenticated`
only, never `anon`). No generic privileged mutation RPCs.

## 28. Mock backend parity

Covered in §24. The mock enforces the essential permission rules with the same
error codes; parity tests exist.

## 29. Dashboard

- Header gains a **workspace switcher** (Personal / <workspace>…): scopes the
  project grid. Workspace view shows only that workspace's projects.
- Project cards show a small workspace context chip on workspace projects; a
  read-only badge for viewers; permission-aware actions (§30).
- Workspace data is **lazy-fetched** (never blocks personal-dashboard startup).

## 30. Project card actions

- Personal owner: existing actions unchanged.
- Workspace projects: actions filtered by the current role — viewer: Open /
  Preview only; editor: Open/Edit, Duplicate, Save-as-template (personal copy),
  Move-out copy (if allowed); owner: everything incl. Delete, Manage sharing.
- Server remains authoritative for every action.

## 31. Publishing permissions

Documented decision: **EDITOR may publish.** VIEWER cannot (button hidden and
the Launch Center gated). See §17.

## 32. Custom domains

Owner-only (§18). Domain management UI is hidden for non-owners.

## 33. Review links

OWNER + EDITOR can create/manage review links for workspace projects
(documented). VIEWER cannot. Public viewer behavior unchanged.

## 34. Personal templates / packages

See §20 — no template-access leak; workspace projects created from templates
are independent copies.

## 35. Project duplication

See §21. Server-side duplicate creates a fresh row (new project id, revision 1,
created_by = current user); no lease/links/deployments/comments copied.

## 36. Move/copy between personal and workspace

- **Personal → workspace**: explicit "Move to workspace" flow (owner/editor
  with create permission). Only the authenticated owner of the personal
  project can move it. On server success the local copy is removed (with
  confirmation); on failure the local project remains intact.
- **Workspace → personal copy**: "Save a personal copy" is available to
  members with edit/duplicate permission and creates a fresh personal copy
  (COPY semantics — never silently removes the shared project). Viewers cannot
  copy a private workspace project.

## 37. Recovery

See §15. Workspace restore paths never overwrite newer shared state silently.

## 38. Copilot memory

- P11 Copilot memory stays **per user/local** — never synced through the
  workspace payload. Default safest choice, documented.

## 39. Project export

- `.buildora` exports and `.buildora-template` packages contain **no**
  workspace membership, invitations, leases, member emails, auth data, or role
  assignments (by construction: those live outside `ProjectSchema`; covered by
  privacy tests).

## 40. Account sign-out

Best-effort lease release, workspace access store reset, workspace-sensitive
UI caches cleared; remote workspace data never deleted; local personal data
retained per existing policy. No workspace content leaks into another
account's dashboard cache (server-authoritative reads + user-scoped metadata).

## 41. Cache isolation

- Local workspace cache metadata is scoped by **user id + workspace id +
  project id**. The workspace access store resets on sign-out/account switch.
- The dashboard "Personal" list filters by the current user's non-workspace
  metadata. Explicit tests cover cross-account and cross-workspace isolation.

## 42–45. Member removal / role change / heartbeat / takeover

Covered in §9–§11 plus:

- Role change editor→viewer while a project is open: the client releases the
  lease, next save/heartbeat is rejected (403), UI transitions to read-only.
- Heartbeat: bounded interval (20 s), only while an editable workspace project
  is active, stops on unmount/sign-out/project switch; tolerates transient
  network failure; expires on browser crash. No runaway timers (cleanup tests).

## 46. Editor UI

- TopNav shows the workspace name and an **Editing / Read only** chip; when
  another member holds the lease: "Currently being edited by <name>".
- No fake presence rows, no avatar stacks.

## 47. Accessibility

- Workspace switcher keyboard-accessible (native select/buttons with labels);
  member tables are semantic lists with labelled role selectors; invitation
  dialog labelled; read-only status announced via `aria-live`; lease-conflict
  dialog keyboard-accessible (Escape to close, focus trap); confirmation
  dialogs accessible; status never conveyed by color alone.

## 48. Responsive UX

Workspace dashboard, member management, invitation flow, read-only banner, and
lease-conflict dialog verified on desktop/tablet/mobile. No horizontal
overflow (full-width bottom sheets on small viewports, dialogs on desktop).

## 49. Performance

- Personal-dashboard startup never waits on workspace network calls
  (workspace data lazy-fetched when the switcher opens or a workspace is
  selected).
- One `listWorkspaceProjects` call per workspace view (no N+1 permission
  requests — role is resolved once and cached for the view).
- Lease heartbeat 20 s; server save debounced 1.5 s — never per keystroke.

## 50. Instrumentation

`recordPerf` marks (deterministic counts, local only):
`workspace_switch`, `workspace_project_open`, `workspace_lease_acquired`,
`workspace_lease_blocked`, `workspace_project_saved`. No external analytics.

## 51–55. Testing strategy

- **Unit — permissions:** every role×capability in §5 (manage/invite/roles/
  remove/edit/delete; editor denied owner-only; viewer fully read-only),
  tested at the permission-helper AND service/mock level.
- **Unit — leases:** acquire, heartbeat, release, expiry, stale takeover,
  active-lease denial, member-removal invalidation, role-downgrade
  invalidation, cross-project/cross-workspace isolation, forged-lease
  rejection, server-time behavior.
- **Unit — concurrency:** expected revision succeeds; stale rejected; stale
  never overwrites; retry-after-reload succeeds.
- **Unit — cache/privacy:** account A cache invisible to B; workspace A cache
  invisible to workspace B; sign-out clears sensitive cache; exports exclude
  workspace metadata; personal templates not exposed; Copilot memory not
  shared.
- **Component:** workspace switcher, create workspace, invite member, role
  selector, remove member, read-only editor state, lease blocker, stale-lease
  takeover, permission-aware project card, workspace project creation,
  move-to-workspace flow, authorization loss while open.

## 56–59. E2E strategy (deterministic mock backend)

- `e2e/workspace-collaboration.spec.ts` — A signs up → creates workspace →
  creates/moves project in → invites B (editor) → B accepts → B sees workspace
  → B edits → save persists → A reloads and sees B's change → permissions
  verified → runtime audit clean.
- `e2e/workspace-edit-lease.spec.ts` (two browser contexts) — A opens editable
  + acquires lease; B opens and sees read-only/"being edited"; B cannot mutate;
  A exits/releases; B acquires and edits; stale-revision overwrite prevented;
  runtime audit clean.
- `e2e/workspace-permissions.spec.ts` — viewer cannot edit/publish; editor
  cannot manage members; removed member loses access; role downgrade takes
  effect; cross-workspace access denied; sign-out/account switch does not leak
  cache.
- `e2e/workspace-privacy.spec.ts` — export excludes member data; Copilot
  memory private; review tokens unchanged; no auth/member secrets in client
  payloads; account cache isolation (folded into permissions where clean).

## 60. Validation gates

`npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build` → P14 E2E
(sequential, chromium, workers=1) → `npm run test:e2e` → `test:e2e:matrix` →
`test:e2e:fallback` → `test:export-build`. Suites never run concurrently.
Windows webpack workaround (`npm run dev -- --webpack`) already configured.

## 61. Security review

Explicit review checklist: IDOR, workspace/project enumeration, role bypass,
forged memberships/invitations/leases, stale-lease reuse, optimistic
concurrency bypass, owner-removal edge cases, cross-account cache leakage,
cross-workspace leakage, authorization loss while open, RLS parity,
SECURITY DEFINER correctness, invitation recipient enforcement, project-export
privacy, Copilot-memory privacy, raw backend error leakage, client-side secret
leakage, race conditions, heartbeat cleanup, sign-out cleanup. Genuine
findings become regression tests.

## 62. Final review

Permission duplication, stale React state, races, heartbeat leaks, interval
cleanup, project-switch cleanup, account-switch cleanup, double invites,
duplicate membership, ownership invariants, dialog stacking, accessibility,
responsive layout, loading/error states, misleading collaboration copy, bundle
impact, dead code, scope creep.

## 63. Migration strategy

- IndexedDB: **no version bump** — workspace cache uses the existing
  dashboard-metadata mechanism plus the provider backend. (Metadata is an
  arbitrary record keyed per project; no store-count test drift.)
- Supabase: one additive migration (above). Non-destructive.
- Mock backend: new module + route on `globalThis`, sharing the P6 session
  store.

## 64. Scope boundaries

**In:** workspaces, membership, roles, in-app invitations, workspace projects
(server-authoritative), move/create/duplicate flows, edit leases + heartbeat +
takeover, read-only editor mode with a central mutation guard, optimistic
concurrency + stale-save dialog, AI Copilot gating, publishing/domain/review
permission gating, export privacy, cache isolation, mock + Supabase providers,
RLS/RPC migration, tests, docs.

**Explicitly OUT (unchanged):** CRDT, OT, live cursors, presence, real-time
simultaneous editing, comments tied to live selections, billing/seats, SSO,
SCIM, org hierarchy, approval workflows, audit logs, notifications/email
delivery, ownership transfer, P15.

## 65. Completion criteria

Workspaces exist; members can be invited; roles enforced (server +
centralized helpers); workspace projects exist; authorized editors edit;
viewers genuinely read-only (store guard, not just UI); simultaneous editing
coordinated via leases; stale saves cannot overwrite newer shared state;
account/workspace cache isolation works; member removal/role downgrade take
effect live; Copilot cannot bypass permissions; publishing/share/domain
permissions enforced; exports exclude collaboration metadata; local personal
projects unaffected; mock E2E deterministic; Supabase/RLS production path
exists; unit/component tests pass; P14 E2E passes; full regression passes;
tsc/lint/build pass; `docs/phase-p14-report.md` complete; P15 not started.

## 66. Genuine P15+ deferrals (only)

- Workspace ownership transfer and multi-owner workspaces.
- Per-project ACLs / granular sharing.
- Live presence / awareness dots (requires real-time infra).
- Workspace-scoped Copilot memory or shared style notes (needs privacy
  decision).
- Email delivery for invitations/notifications.
- Enterprise orgs, seats, SSO, SCIM.
- Audit logs.
