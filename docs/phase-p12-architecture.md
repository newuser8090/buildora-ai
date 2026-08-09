# Phase P12 — Architecture Decisions: Share Links & Review Experience

Branch: `phase-p12-share-and-review`
Written before implementation. This document reconciles the Phase P12
specification with the actual repository state (Phases K/M/L/N/O/P1–P11 all
merged) and records every design decision the phase is built on.

---

## 1. P12 product goal

Let a Buildora user share a **read-only preview** of their website with another
person using an unguessable review link, gather **lightweight review feedback**
(page-level comments), manage (revoke / regenerate / expire) those links, and
never expose editor controls, private project internals, provider secrets, or
cloud data.

This is a **controlled review experience**, not multiplayer editing.

## 2. User problems solved

1. A user wants feedback on their work-in-progress site from a friend or
   client without granting editor access and without publishing publicly.
2. The only current sharing-like surface is **production publishing** (P7/P8),
   which is heavyweight, public-by-default, and implies "this is my live site".
3. The only current "visitor" rendering is `/preview/[projectId]`, which loads
   the project from the owner's **own IndexedDB** — useless to another person.
4. There is no way to collect structured, page-anchored feedback inside the
   product, and no way to revoke access once a link has been shared.

P12 solves: safe link creation → controlled view → structured feedback →
management (expiry / revoke / regenerate) → clean lifecycle (delete /
duplicate / export never leak sharing).

## 3. Sharing model

- **Read-only.** Reviewers can view the website and (optionally) leave
  comments. They can never edit, never see editor chrome, never see block
  trees, inspectors, AI controls, or account controls.
- **Link-scoped.** Access is granted by possession of an unguessable share
  token. There are no roles, teams, or memberships.
- **Owner-only management.** Only the authenticated project owner can create,
  list, update, revoke, regenerate, or delete share links and comments.
- **Not publishing.** A review link is visually and conceptually distinct from
  the published live site (P7/P8). Copy never claims a review link is a live
  public site.

## 4. Review model

- Reviewers leave **page-level comments** with an optional section anchor and
  an optional display name. No pixel coordinates, no arbitrary element
  annotations (spec §7 keeps the first version simple and robust).
- Comments are **plain text**, bounded, sanitized, rate-limited server-side,
  and rendered as React text nodes only.
- Owners manage comments in one canonical panel: grouped by page, open /
  resolved, resolve / reopen, delete, and **jump to the page/section** when it
  still exists. Deleted sections show "This section no longer exists." — a
  comment is never silently re-attached elsewhere.

## 5. Authentication model

- **Owner:** must be signed in (existing P6 auth; Supabase or mock) for all
  cloud-backed share management. Ownership is enforced server-side by the
  session's user id (RLS in Supabase, session checks in the mock).
- **Viewer:** no Buildora account required. Anonymous access is scoped
  strictly by the share token.
- **No shadow accounts.** Anonymous commenters supply an optional (or
  required, per share settings) display name; nothing is persisted about them
  except that name plus the comment text and time.
- **Sign-out does not invalidate links** (§35): public validity is tied to the
  server record, never to an active browser session.

## 6. Anonymous vs authenticated viewer behavior

| Capability | Anonymous viewer | Authenticated owner |
|---|---|---|
| View the shared website | ✅ (token) | ✅ (management UI) |
| Leave feedback | ✅ only when `feedbackEnabled` | n/a (owner doesn't review own site via this flow) |
| Manage links | ❌ | ✅ |
| Read/manage comments | ❌ | ✅ |
| See private project data | ❌ (sanitized projection only) | ✅ (their own project) |

## 7. Token/link model

- The share URL is `https://<host>/share/<rawToken>`.
- **Raw token:** 32 random bytes (`crypto.getRandomValues`, injectable for
  tests), encoded base64url → **256 bits of entropy**, non-sequential,
  collision-resistant, never derived from the project id. The project id is
  NEVER used as public authorization.
- **At rest:** the server stores only `token_hash = sha256(rawToken)`. A
  database leak does not yield usable tokens (hash is not reversible and the
  raw token is never persisted by the server).
- **Public id:** the share also has a separate public `id` (uuid) used by
  owner management endpoints; the raw token is only ever returned at creation
  / regeneration time and is never leaked into exports or project content.
- The raw token is not a privileged credential (it carries no account
  authority); it is the review capability itself, equivalent to an unlisted
  link. Nothing else is embedded in the URL.

## 8. Revocation model

- Revoke sets `status = 'revoked'` on the server record (immediate, durable).
- Every public resolve re-checks the server record: revoked → the route shows
  "This review link is no longer available." Expired → "This review link has
  expired."
- **No stale content survives normal API calls** and no client cache overrides
  server authorization: the public view endpoint responds `Cache-Control:
  no-store` and the share page fetches with `cache: "no-store"`.
- Revocation does not delete comments (owner can still review them via the
  panel); project deletion cascades both (§34).

## 9. Data exposure boundaries

A share exposes ONLY a **sanitized projection** (see §14) of the website
content needed to render it. Explicitly excluded from any shared
representation:

- auth/session state, account metadata, email (never shown to viewers)
- cloud-sync queues/records, device ids, sync cursors
- deployment secrets, provider tokens, Vercel credentials
- recovery snapshots, personal templates, My Blocks library
- Copilot conversations / style memory (P10/P11) — never in the projection
- dashboard metadata, thumbnail records
- share tokens, token hashes, comment data (comments are only readable by the
  owner through the authenticated panel)

## 10. Preview rendering architecture

- **Reuse, don't rebuild.** The public share page renders through the existing
  visitor architecture:
  - `VisitorPageView` (visible sections via the section registry, no editor
    chrome) wrapped in `SectionAssetProvider` (assets come from the
    projection, not the editor store — the pattern thumbnails already use),
  - `computePageRoutes` for page routing,
  - `classifyPreviewLink` / `safeAnchorHref` for safe navigation
    (internal routes, external `http(s)` new-tab, `mailto`/`tel`, blocked
    `javascript:`/`vbscript:`/`data:text/html`),
  - `useRegisterDefaultSections` so the section registry is populated outside
    the editor.
- The share page adds only a minimal review chrome: a slim bar (project name,
  page switcher, "Leave feedback" button) and the feedback sheet. No editor
  bundles are loaded on the public route.

## 11. Comments/feedback model

```ts
interface ReviewComment {
  id: string;            // uuid
  shareId: string;
  projectId: string;
  pageId?: string;
  sectionId?: string;
  authorName?: string;
  body: string;          // plain text, ≤ 2000 chars, trimmed
  createdAt: string;     // ISO
  resolvedAt: string | null;
}
```

- Bounds: `body` ≤ 2000 chars, `authorName` ≤ 60 chars, ≤ 1 comment per
  submission; whitelisted fields only (prototype-pollution keys rejected).
- Writes allowed only when the share has `feedbackEnabled` and is active /
  not expired (server-enforced in both providers).
- Rendered as React text — `dangerouslySetInnerHTML` is never used for
  comments anywhere in the phase.

## 12. Project ownership rules

- A share link is owned by the user who created it and is scoped to exactly
  one `projectId`.
- Only the owner can create/list/update/revoke/regenerate links and
  manage comments for their own projects (server-enforced: `auth.uid()` in
  RLS, session token in the mock).
- A token for project A can never reveal project B (server looks up the share
  row by token hash and returns only that row's projection).
- Cross-project access is impossible by construction and covered by unit +
  E2E security tests.

## 13. Persistence/backend model

- Projects are **local-first** (IndexedDB) and are deliberately NOT synced to
  the cloud (P6 syncs only My Blocks + collections). Therefore the server can
  never "fetch the current project" — this is the decisive architectural fact
  for §15.
- Share links + comments are **service metadata stored server-side only**
  (Supabase tables / mock in-memory state). They are never part of
  `ProjectSchema`, never in `.buildora.json`, never in IndexedDB project
  records, never in the website export.
- The owner's editor **pushes a sanitized projection** (§14) to the server at
  share creation and refreshes it (debounced, best-effort, offline-tolerant)
  while the project has active shares.

## 14. Public project snapshot (projection)

**Decision: the share links to a sanitized server-stored projection of the
project**, refreshed from the owner's editor. Rationale: (a) the canonical
project storage is the owner's IndexedDB, which the server cannot read; (b)
the spec explicitly prefers this when "snapshotting is architecturally
safer" — here it is the only correct option, and it doubles as the safe
containment boundary (a public token can never reach arbitrary canonical
project storage because the server only ever stores the sanitized copy).

`buildShareProjection(project)` produces a **Project-shaped** object (so the
existing `VisitorPageView` works unchanged) that:

- keeps `name`, `theme`, `siteSettings` (public site content only),
  `pages` (id/title/slug/sections), and `assets` (data URLs needed to render
  images; bounded by existing asset upload caps),
- **validates every section** with `validateSectionSafe` and drops invalid
  sections (mirroring the export pipeline's stance); pages with zero valid
  sections keep a valid empty page list,
- **blanks the project id** (a public response never carries the canonical
  project id) and strips all timestamps,
- rejects/omits any key that is not part of the whitelisted shape
  (prototype-pollution keys included),
- is size-bounded (assets are already individually capped at upload; the
  serialized projection is capped server-side and oversized pushes are
  rejected with a clear code).

## 15. Snapshot semantics (LIVE vs SNAPSHOT)

**Decision: LIVE-PROJECTION.** Users expect "share my current website". The
server stores the latest sanitized projection the owner pushed, so the link
always reflects the most recent upload. Mechanics:

- **At share creation:** the dialog pushes the current in-memory project
  projection synchronously before confirming, so a freshly shared link always
  renders the site.
- **On later edits:** a `useShareSnapshotSync` hook (mounted in the editor
  shell, inert when no active shares exist or offline) pushes a fresh
  projection when the project revision changes (debounced ~1.5 s,
  best-effort; failures are logged silently and never affect editing).
- The server stores `projectionRevision` (the project revision the snapshot
  was built from) so redundant pushes are cheap to skip.

This is not a literal live fetch of the canonical project (impossible
client-side), but it is live in every user-visible sense, is deterministic
for E2E, and is documented honestly in the UI ("Shows the latest saved
version of this website").

## 16. API surface

All owner endpoints require a valid session (RLS / bearer). The public view
endpoint is anonymous and token-gated. Responses use the established
`{ ok, data } / { ok: false, error: { code, message } }` envelope; every code
maps to beginner-safe copy client-side (§37).

| Method / path (mock) | Supabase | Purpose |
|---|---|---|
| `POST /api/share` | RPC `create_share_link` | create link (settings + initial projection) → returns `{ id, url, rawToken, expiresAt }` |
| `GET /api/share?projectId=` | select (owner) | list links for project |
| `GET /api/share/batch?projectIds=` | select (owner, one query) | dashboard "Shared" badges |
| `PATCH /api/share/[id]` | RPC `update_share_link` | change `feedbackEnabled` / `requireName` / `expiresAt` |
| `POST /api/share/[id]/snapshot` | RPC `push_share_snapshot` | owner pushes updated projection |
| `POST /api/share/[id]/regenerate` | RPC `regenerate_share_link` | new raw token (old invalid immediately) → returns new `{ url, rawToken }` |
| `POST /api/share/[id]/revoke` | RPC `revoke_share_link` | revoke (immediate) |
| `GET /api/share/[id]/feedback` | RPC `list_review_comments` | owner reads comments |
| `POST /api/share/[id]/feedback` | RPC `submit_review_comment` | anonymous submit (token + share id, rate-limited) |
| `PATCH /api/share/[id]/feedback/[cid]` | RPC `set_comment_resolved` | owner resolve/reopen |
| `DELETE /api/share/[id]/feedback/[cid]` | RPC `delete_review_comment` | owner delete |
| `GET /api/share/view/[token]` | fn `resolve_share(token)` (anon) | public resolve → projection + public share info or error code |
| `POST /api/share/delete-project-data` | RPC `delete_share_data_for_project` | lifecycle: revoke all + delete comments |

## 17. RLS / security model (Supabase)

Two new tables (migration `20260809000001_share_review_schema.sql`):

- `share_links` — `id uuid pk`, `owner_id uuid fk profiles on delete cascade`,
  `project_id text not null`, `token_hash text not null unique`,
  `status text check ('active','revoked')`, `feedback_enabled bool`,
  `require_name bool`, `expires_at timestamptz null`,
  `created_at / updated_at / last_opened_at timestamptz`,
  `feedback_count int`, `projection jsonb`, `projection_revision int`,
  `projection_updated_at timestamptz`.
- `review_comments` — `id uuid pk`, `share_id uuid fk share_links on delete
  cascade`, `project_id text`, `page_id text`, `section_id text`,
  `author_name text`, `body text not null`, `created_at`,
  `resolved_at timestamptz null`.

Policies / functions (mirroring the P6 style):

- RLS enabled on both tables. Direct table access:
  - `share_links`: owner select only; no client insert/update/delete (all
    writes go through SECURITY DEFINER owner RPCs that set `token_hash` and
    enforce `auth.uid() = owner_id`).
  - `review_comments`: owner select via `exists(share_links where
    owner_id = auth.uid())`; no client writes (RPCs only).
- `resolve_share(p_token text)` — SECURITY DEFINER, `grant execute to anon`:
  computes `sha256(p_token)`, returns the share row + projection ONLY when
  `status='active' and (expires_at is null or expires_at > now())`. Updates
  `last_opened_at` (privacy-conscious: a timestamp only, never an IP or
  fingerprint). Returns distinct error codes for invalid/expired/revoked.
  The function never returns `token_hash` or `owner_id` in its result shape.
- `submit_review_comment(p_token, p_share_id, p_page_id, p_section_id,
  p_author_name, p_body)` — SECURITY DEFINER, `grant execute to anon`:
  resolves the share by token hash, requires active + not expired +
  `feedback_enabled`, validates bounds (body ≤ 2000, name ≤ 60, trimmed,
  pollution keys rejected), inserts, increments `feedback_count`.
  Production rate limiting is delegated to edge protection / provider limits
  (documented limitation — the mock enforces a real per-share limit).
- Owner RPCs (`create_share_link`, `update_share_link`, `revoke_share_link`,
  `regenerate_share_link`, `push_share_snapshot`, `list_review_comments`,
  `set_comment_resolved`, `delete_review_comment`,
  `delete_share_data_for_project`) all begin with
  `if auth.uid() is null then raise exception ... end if;` and verify the
  target share's `owner_id = auth.uid()` before touching it.
- **No project enumeration:** `share_links` is not selectable by anyone but
  the owner; anonymous access is possible only through `resolve_share`.

## 18. Abuse / threat model

| Threat | Mitigation |
|---|---|
| Token guessing | 256-bit random tokens, hashed at rest, uniqueness enforced |
| Revoked/expired link reuse | Every resolve re-checks server state (no-store) |
| Cross-project access | Token → single share row → single projection; no joins by project id |
| Anonymous spam | Per-share rate limit (mock: enforced; Supabase: documented limitation), bounded body, request-size caps, duplicate-submission guard on consecutive identical body+name within the window |
| HTML/script injection | Plain-text storage; React text rendering; no `dangerouslySetInnerHTML` |
| Prototype pollution | Whitelisted body parsing + pollution-key rejection on both providers |
| Project-id guessing | Project ids never authorize anything |
| Oversized payloads | Body ≤ 2 KB, name ≤ 60, projection size cap, route request-text cap |
| Provider/backend error leakage | Structured codes mapped to beginner copy; raw messages never rendered |
| Client cache defeating revocation | `no-store` on public endpoints + fetches |
| Exports/duplicates leaking tokens | Share data is service metadata, never in project content (tested) |
| Offline owner bypass | Link creation/management requires connectivity (UI shows offline copy); local editing is unaffected |

## 19. Expiry model

- `expiresAt` is stored server-side and enforced on every public resolve and
  every comment submit. Browser time is never trusted.
- Presets: Never / 24 hours / 7 days / 30 days. Owner can change expiry for an
  active link at any time (including extending an expired one).
- Expired links show "This review link has expired." on the public route and
  are visibly marked "Expired" in the owner's management list. Owner actions:
  update expiry (reactivates) or regenerate (new token, settings retained).
- Expiry never deletes data; it only gates access. Comments remain
  accessible to the owner.

## 20. Offline behavior

- The editor remains fully local-first: opening, editing, saving, preview,
  undo, AI, export — none depend on sharing.
- Creating/managing links, pushing snapshots, submitting feedback, and the
  dashboard badge fetch all require connectivity. The share dialog shows
  "You're offline. Reconnect to create or manage review links." Snapshot
  pushes are skipped offline and resume on the next save when online.
- A previously opened public page that goes offline keeps rendering what it
  already has (no refetch needed for display).

## 21. UX flows

**Owner — create (spec §2):** TopNav **Share** (or palette "Share this
website") → canonical `ShareDialog` → optional settings (Allow feedback,
Require name, Expiry) → **Create review link** → snapshot pushed → link shown
with **Copy** → "Review link copied" (Clipboard API; on failure a selectable
text field + copy fallback) → Done.

**Owner — manage:** `ShareDialog` → Manage tab → active/expired links list:
created date, expiry, feedback count, last opened (only when tracked —
explicit, timestamp-only), Copy / Revoke (with confirmation) / Regenerate
(confirmation: "This makes the old link stop working."). Revoked → gone from
list. Offline → offline copy. Not signed in → sign-in prompt (opens the
existing auth dialog).

**Owner — review feedback:** palette "Review feedback" or a link row action →
`ReviewFeedbackDialog`: comments grouped by page, open first; each shows
author (if supplied), date, text, Resolve / Reopen, Delete (with
confirmation). **Jump:** clicking a comment with `pageId` opens that page in
the editor; with `sectionId` also selects the section if it exists — else the
comment shows "This section no longer exists." and jump selects the page.

**Viewer:** `/share/[token]` → slim bar (project name + "Review link" badge,
page switcher, optional "Leave feedback") → site renders with safe
navigation → "Leave feedback" opens the sheet: optional name (required when
the share requires it), page-scoped textarea (pre-filled with the current
page), submit → success confirmation → comment appears in owner's panel.

**Public error states:** invalid token → "This review link isn't working.";
revoked → "This review link is no longer available."; expired → "This review
link has expired."; project deleted → revoked path; feedback disabled →
feedback control hidden; rate limited → "Too many comments — please wait a
moment and try again."

## 22. Accessibility

- ShareDialog / feedback sheet / review panel: labelled inputs (name, comment
  textarea, expiry select, toggles), visible focus, `aria-live` status for
  loading/created/copied/submitted, Escape closes (consistent with app
  dialogs), focus returns to the trigger on close, no focus trap beyond the
  modal itself.
- Status is never conveyed by color alone (text labels accompany badges).
- Feedback textarea is labelled; review comments are navigable list items
  with accessible actions; sheets are mobile-friendly (bottom sheet on small
  viewports, centered dialog on desktop).
- No WCAG certification claim is made.

## 23. Performance

- The Share surface is **lazy-loaded** (`next/dynamic`) — editor startup and
  the manual-edit hot path never import sharing code. The snapshot-sync hook
  is tiny and inert without active shares.
- **No N+1 on the dashboard:** one batch request per dashboard load for all
  visible project ids, cached for the session; offline/failure → no badges
  (silent).
- Public share page imports only the shared visitor rendering modules — no
  editor-only bundles.
- Snapshot pushes are revision-gated + debounced (never per keystroke).

## 24. Error handling

All failures surface as beginner copy with a recovery path; raw backend
errors are never displayed. Mapped states (§37): offline, revoked, expired,
invalid token, project deleted, feedback disabled, rate limited, server
unavailable, malformed response, permission denied. The service maps
provider errors to typed `ShareError` codes; UI components render the
corresponding copy. Every owner mutation failure leaves the dialog usable and
offers Retry.

## 25. Testing strategy

- **Domain unit (vitest):** token creation/entropy/validation/hash
  (injectable RNG), projection sanitizer (exclusions, invalid-section
  dropping, pollution keys, id blanking, size cap), comment validation
  (bounds/trim/pollution), expiry/revoke/regenerate/ownership logic in the
  mock handlers, provider service error mapping, malformed-response
  handling, rate limiting, lifecycle hooks (export contains no share data;
  duplicate creates no share data; delete revokes).
- **Security unit:** fake token denied, revoked denied, expired denied,
  cross-project token denied, anonymous management denied, comment HTML
  stays text, oversized rejected, feedback-disabled writes rejected,
  projection excludes private fields.
- **Component (vitest + testing-library):** ShareDialog (create, copy,
  expiry, feedback toggle, list, revoke confirmation, regenerate), public
  share error states, feedback form, owner review panel (resolve/reopen/
  delete, deleted-section state), accessibility basics.
- **E2E (playwright, mock backend, deterministic):**
  `e2e/share-review.spec.ts`, `e2e/share-feedback.spec.ts`,
  `e2e/share-security.spec.ts` (see §26).
- Full regression: tsc, lint, vitest, build, `test:e2e`, `test:e2e:matrix`,
  `test:e2e:fallback`, `test:export-build` — sequential, never concurrent
  Playwright.

## 26. E2E scenarios

**share-review.spec.ts:** owner creates/opens project (deterministic mock
auth) → Share → create review link → copy link → open in a **second browser
context** (fresh device, no IndexedDB) → site renders → editor controls
absent → safe navigation across pages → owner revokes → viewer refreshes →
"no longer available" → no runtime errors (runtime-audit helper).

**share-feedback.spec.ts:** owner creates share with feedback enabled →
viewer opens link → leaves feedback (with name) → owner opens Review panel →
comment appears → jump to page/section → resolve → reopen → delete → viewer
cannot hit owner management endpoints (401/403 envelope) → runtime audit
clean.

**share-security.spec.ts:** fake token denied; expired token denied
(injected via mock state); revoked denied; feedback-disabled write denied;
malicious comment (`<script>` text) stored and rendered as text; token for
project A cannot read project B; public view response contains no project id,
no editor state, no token hash; no raw backend errors rendered.

## 27. Migration strategy

- IndexedDB: **no change** — share data never lives locally. No database
  version bump.
- Supabase: one additive migration `20260809000001_share_review_schema.sql`
  creating `share_links` + `review_comments`, RLS, SECURITY DEFINER
  functions, grants (`authenticated` for owner RPCs, `anon` for
  `resolve_share` + `submit_review_comment`). Non-destructive; existing
  tables untouched.
- Mock backend: new module + route, state on `globalThis` (same pattern as
  P6), sessions shared with the P6 mock cloud state.

## 28. Scope boundaries

**In scope:** share links (create/list/copy/revoke/regenerate/expire),
sanitized live projection, public `/share/[token]` route reusing the visitor
renderer, page-level feedback with optional name + section anchor, owner
review panel, dashboard "Shared" badge, editor Share entry (TopNav + command
palette), mock + Supabase providers, RLS migration, lifecycle integration
(export/duplicate/delete), tests, docs.

**Explicitly out of scope (unchanged from the spec):** multiplayer editing,
CRDT, live cursors, presence, reviewer editing, pixel-coordinate comments,
public template marketplace, billing, analytics dashboards, team workspaces,
roles beyond what review links need, notifications/email delivery, P13.

## 29. Completion criteria

- Owner can create a review link; viewer opens it without editor access.
- Link is unguessable (256-bit), hashed at rest, revoked/expired links fail
  server-side immediately.
- Feedback can be enabled/disabled; reviewer feedback is safe (bounded,
  plain text, rate-limited); owner can manage it and jump to locations.
- Cross-project access impossible; exports contain no share data;
  duplication creates no share access; deletion revokes/cleans sharing.
- Local editing unaffected offline; mock-backed E2E deterministic.
- tsc clean, lint clean, unit/component tests pass, production build
  succeeds, P12 E2E green, full regression green.
- `docs/phase-p12-report.md` written. P13 not started.
