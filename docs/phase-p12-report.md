# Phase P12 — Report: Share Links & Review Experience

Branch: `phase-p12-share-and-review`
Design document: `docs/phase-p12-architecture.md` (written before implementation).

Phase P12 ships **safe external review sharing**: an owner creates an
unguessable, expirable, revocable **read-only review link** backed by a
sanitized server-stored projection of their website; an anonymous viewer opens
`/share/[token]` with zero editor access and can optionally leave plain-text,
bounded, page-scoped feedback; the owner manages links (copy / revoke /
regenerate) and reviews feedback (grouped by page, resolve / reopen / delete /
jump) from one canonical surface. Nothing about sharing ever touches project
content, exports, or duplicates, and project deletion revokes everything.

This is a **controlled review experience** — no multiplayer editing, no CRDT,
no presence, no reviewer editing (all explicitly out of scope).

---

## 1. Delivered

- **Token model** — 32 random bytes (256-bit entropy, base64url, non-sequential,
  never derived from the project id), injectable RNG for tests, SHA-256 hash
  stored server-side only (`token.ts`).
- **Sanitized projection** — `buildShareProjection` whitelists only what is
  needed to render the site (name/theme/siteSettings/pages/assets), validates
  every section with `validateSectionSafe` (drops invalid), blanks the canonical
  project id, strips timestamps, removes prototype-pollution keys, enforces a
  4 MB serialized cap (`projection/sanitize-share-projection.ts`).
- **Mock backend + API route** — in-memory share cloud on `globalThis`
  (P6 pattern), exposed via `/api/share/[[...path]]` with owner bearer sessions
  shared with the P6 mock cloud; enforces ownership, hash-only token storage,
  revocation/expiry on every resolve, per-share comment rate limit +
  duplicate guard, feedback gating, and lifecycle cleanup.
- **Providers** — `ShareLinkProvider` interface with `MockHttpShareProvider`
  (dev/test) and `SupabaseShareProvider` (real backend via RPCs); the UI only
  ever talks to the provider boundary.
- **Public route** — `/share/[token]` renders through the EXISTING visitor
  architecture (`VisitorPageView` + `SectionAssetProvider` +
  `computePageRoutes` + `classifyPreviewLink` + `useRegisterDefaultSections`);
  no editor bundles, no editor chrome, safe navigation, beginner copy for
  invalid / expired / revoked, `no-store` fetches.
- **Feedback** — `FeedbackSheet` (anonymous viewer, optional/required name,
  bounded plain-text body, page-scoped, rate-limited, success confirmation);
  `ReviewFeedbackTab` (owner panel: grouped by page, resolve / reopen / delete
  with confirmation, jump to page/section, honest "This section/page no longer
  exists" states).
- **Owner management** — `ShareDialog` (canonical surface, lazy-loaded) with
  beginner create form (allow feedback, require name, expiry presets
  Never/24h/7d/30d) and the `ReviewLinksTab` manage list (status, created date,
  expiry, feedback count, last-opened timestamp-only, copy / revoke /
  regenerate with confirmations).
- **Editor + dashboard integration** — TopNav **Share** button, Command Palette
  actions (Share this website / Manage review links / Review feedback),
  `useShareSnapshotSync` (debounced best-effort live-projection refresh, inert
  offline and without active shares), dashboard **Shared** badge via ONE batch
  request (`useShareBadges`, session-cached, silent on failure), and the
  `Manage sharing` quick action (`/editor/[id]?share=1`).
- **Lifecycle** — `lazyShareCleanup` on project delete (server-side revoke +
  comment deletion AND device-cache purge of raw tokens/share ids, best-effort,
  never blocks the delete); exports and duplicates provably contain no share
  data.
- **Supabase migration** — `20260809000001_share_review_schema.sql`:
  `share_links` + `review_comments` tables, RLS, SECURITY DEFINER owner RPCs,
  public `resolve_share` / `submit_review_comment`, minimal grants.
- **Tests** — 93 unit/component tests + 3 deterministic mock-backed E2E suites.

---

## 2. Architecture decisions (summary)

- **LIVE-PROJECTION model (§15):** the link always shows the latest sanitized
  projection the owner pushed (at creation, then debounced on edits). The
  server can never read the owner's IndexedDB, so a sanitized push is both the
  only correct option and the safety boundary (a public token can never reach
  canonical project storage).
- **Raw tokens never persisted server-side** — only SHA-256 hashes; the raw
  token is returned exactly once (create / regenerate) and cached only on the
  owner's device for copy convenience.
- **Anonymous viewers, owner-only management** — viewer access is scoped
  strictly by token; every owner endpoint is session-scoped to `auth.uid()`
  (RLS) / the mock session. No shadow accounts.
- **One canonical share surface** — TopNav, palette, and dashboard all open the
  same `ShareDialog`.
- **No second website renderer** — the public route reuses the visitor
  rendering stack used by preview/thumbnails.

---

## 3. Share-link model

`ShareLink { id, projectId, status, feedbackEnabled, requireName, expiresAt,
createdAt, updatedAt, lastOpenedAt, feedbackCount }` — service metadata stored
server-side only; never in `ProjectSchema`, never in `.buildora.json`, never in
IndexedDB project records. `ShareLinkWithToken` (raw token + URL) is returned
exactly once at create/regenerate. Expiry presets: Never / 24h / 7d / 30d.

## 4. Token design

- 32 bytes → 43-char base64url (`[A-Za-z0-9_-]{43}`), `crypto.getRandomValues`
  (Node `randomBytes` fallback), injectable for tests.
- Stored as `sha256(token)` (mock + `share_token_hash()` RPC). A DB leak cannot
  be replayed.
- `isValidShareToken` shape-checks (40–64 chars, alphabet) before hashing.
- Regeneration rotates the hash (old token dies immediately). Revocation is a
  status flip checked on EVERY public resolve and comment submit.

## 5. Public projection model

`ShareProjection` = Project-shaped (so `VisitorPageView` renders unchanged) with
`id` blanked, no timestamps, only whitelisted keys, invalid sections dropped,
pollution keys stripped, 4 MB cap. Excludes: auth state, account metadata,
cloud-sync records, deployment data, recovery snapshots, Copilot
conversations/memory, personal templates, My Blocks, dashboard metadata, tokens,
hashes, and comments. `projectName` capped at 120 chars. The public resolve
envelope additionally blanks `share.projectId` (canonical project id is never
public — verified by E2E).

## 6. Review / feedback model

`ReviewComment { id, shareId, projectId, pageId?, sectionId?, authorName?,
body, createdAt, resolvedAt? }` — plain text, body ≤ 2000 chars, name ≤ 60,
trimmed, whitelisted fields only, rendered as React text nodes (no
`dangerouslySetInnerHTML` anywhere). Writes require an active, non-expired share
with `feedbackEnabled`. Per-share rate limit (mock: 20/10 min + 60 s duplicate
guard; Supabase: duplicate guard via RPC, burst protection delegated to edge
protection — documented limitation).

## 7. Owner management UX

Canonical `ShareDialog` → create form (feedback toggle, name-required toggle,
expiry presets) → create → projection pushed → "Your review link is ready" with
copy + selectable fallback ("Review link copied"); manage list shows status
(Active / Expired / Stopped), created date, expiry, feedback count, last-opened
(timestamp only, only when tracked), Copy / Stop link (confirmation) /
Regenerate (confirmation, old link dies immediately). Offline → "You're
offline. Reconnect to create or manage review links." Signed out → in-place
sign-in. Unconfigured → "Review links aren't set up for this app yet."

## 8. Public viewer UX

Slim review chrome (Review link badge, project name, page switcher, optional
"Leave feedback") above the site; safe internal navigation + external
`http(s)`/`mailto`/`tel` new-tab + blocked `javascript:`/`vbscript:`/`data:`.
Error states: invalid → "This review link isn't working."; revoked → "This
review link is no longer available."; expired → "This review link has expired."
Feedback sheet: name (optional/required), page-scoped textarea, send → success
confirmation. Footer: "Made with Buildora".

## 9. Backend / provider architecture

UI → `ShareLinkService` (error mapping to beginner copy, malformed-response
degradation) → `ShareLinkProvider` (`mock` | `supabase`, chosen by the P6 cloud
environment). Mock state lives on `globalThis` (shared by every route bundle in
the dev server) so two browser contexts share one "cloud" — what makes
cross-device E2E possible.

## 10. Mock backend

`mock/mock-share-server.ts` + `src/app/api/share/[[...path]]/route.ts`. All
owner handlers require a valid P6 session and verify `ownerId`; public handlers
are token-gated. The route is disabled unless the cloud environment is `mock`
and production builds never expose it (`getCloudEnvironment().kind !== "mock"`
→ 404 envelope).

## 11. Supabase schema / RLS / RPCs

Tables `share_links` (token_hash unique, status check, projection jsonb,
feedback_count, last_opened_at) and `review_comments` (FK cascade). RLS on both;
direct table writes forbidden for clients; owners select only their own rows
(`share_links` by `auth.uid() = owner_id`; `review_comments` via
`exists(share_links …)`. SECURITY DEFINER owner RPCs each begin with an
`auth.uid()` check and verify the target share belongs to the caller; public
RPCs (`resolve_share`, `submit_review_comment`) are granted to `anon` and
enforce status + expiry + feedback + bounds server-side. Grants are minimal
(`authenticated` for owner RPCs, `anon` for the two public RPCs).

## 12. Revocation / expiration

Server-enforced on every resolve and comment submit; browser clock never
trusted. Revoked → 410 REVOKED; expired → 410 EXPIRED. Public fetches use
`cache: "no-store"`; revocation can never be defeated by client caching.

## 13. Caching behavior

- Public resolve: `no-store` (browser + route), so revoked/expired links fail
  immediately on refresh (verified by E2E).
- Dashboard badges: one batch request per load, module-level session cache,
  cleared on sign-out; offline/failure → silent no-badges.
- Device share cache (localStorage): share ids per project + raw tokens for
  copy convenience; NEVER an authorization source; purged on revoke,
  regenerate (old token), and project deletion.

## 14. Project lifecycle interactions

- **Export:** `.buildora` exports contain no tokens, comments, or review data
  (tested, including a cached token present on-device).
- **Duplicate:** a copy starts unshared — no share rows for the new id (tested).
- **Delete:** `lazyShareCleanup` revokes all of the project's active links,
  deletes its comments (server-side), and purges the device cache; failure is
  best-effort and never blocks the delete, never pretends success.
- **Sign-out:** public links stay valid (tied to the server record, not the
  browser session); the owner simply loses management access until sign-in.

## 15. Security / privacy guarantees

256-bit tokens hashed at rest; owner-only management (RLS/session);
token-scoped anonymous reads; no project enumeration; cross-project access
impossible (token → one share row → one projection; verified by unit + E2E);
plain-text bounded feedback with no HTML execution; prototype-pollution keys
rejected; request-size caps; no raw backend errors surfaced; no IP/fingerprint
tracking (last-opened is a timestamp only); no analytics disguised as review
functionality; canonical project id never in the public response.

---

## 16. Security review — findings and fixes (this phase)

The Phase P12 security + final code review covered: token entropy/leakage/
persistence, authorization (owner-only, anonymous limits), expiry, projection
boundaries, feedback safety, URL/navigation safety, cache, lifecycle
(export/duplicate/delete/sign-out), Supabase RLS/grants, mock/real parity,
error leakage, stale React state, races, unmounted requests, a11y, mobile
layout, dialog stacking, N+1 requests, and editor-bundle loading on the public
route. Genuine findings and fixes:

### Finding 1 — public resolve leaked the canonical project id (fixed)

**Issue.** The mock's `handleResolveShare` returned `share.projectId` = the real
canonical project id, contradicting the architecture doc ("public view response
contains no project id") and the Supabase `resolve_share` RPC (which returns
`''`). The mock was more permissive than the real backend, and the E2E security
spec asserted the leak.

**Fix.** The mock now blanks `projectId` in the public share info; the E2E
security spec asserts `projectId === ""` and proves cross-project isolation via
`shareId` + projection name instead. Unit tests updated.

### Finding 2 — a created link could be "ready" while 404ing for viewers (fixed)

**Issue.** `ReviewLinksTab.handleCreate` ignored the `pushSnapshot` result (and
skipped it entirely when `buildShareProjection` failed), so the "Your review
link is ready" card could appear for a link with no projection — viewers would
see "This review link isn't working."

**Fix.** When the projection cannot be built or pushed, the just-created link is
best-effort revoked, an honest error is shown, and the ready card is never
presented. Regression test added.

### Finding 3 — device cache survived project deletion (fixed)

**Issue.** `lazyShareCleanup` only performed server-side cleanup; cached raw
tokens and share ids for the deleted project remained in localStorage.

**Fix.** `lazyShareCleanup` now also purges the project's cached share ids and
raw tokens (best-effort, even if the server call fails). Regression test added.

### Finding 4 — Supabase `update_share_link` could not clear an expiry (fixed)

**Issue.** `coalesce(p_expires_at, expires_at)` made `null` ("Never") a no-op,
while the mock cleared the expiry — a mock/real parity gap in the provider
contract. (No UI path calls `updateShare` today; the API surface is now honest.)

**Fix.** Added `p_clear_expiry boolean default false` to the RPC; the Supabase
provider passes it when the "Never" preset resolves to null. Grant updated.

### Finding 5 — missing Escape handling / focus gaps on viewer + confirm surfaces (fixed)

**Issue.** The feedback sheet and the revoke/regenerate/delete confirmation
overlays did not close on Escape (spec §38 requires app-consistent Escape).

**Fix.** Escape now closes the feedback sheet and cancels each confirmation.

### Finding 6 — dashboard badge cache leaked across accounts (fixed)

**Issue.** `useShareBadges` module-level `badgeCache` was never cleared on
sign-out, so a previous account's "Shared" state could leak into the next
sign-in (badges are owner-scoped server-side).

**Fix.** The cache is cleared and badges reset whenever the auth status is not
"signed-in".

### Finding 7 — comment on a deleted page showed a dead "Jump to page" (fixed)

**Issue.** Only the deleted-section case was handled; a comment whose page was
removed still rendered a jump button that silently no-opped.

**Fix.** The jump button is hidden and an honest "This page no longer exists"
badge is shown (mirroring the section treatment).

### Checklist verdicts

- Token entropy/leakage/persistence — ✅ (256-bit, hash-only at rest, raw shown
  once, device cache purged on revoke/regenerate/delete, never in exports).
- Authorization — ✅ owner-only RPCs/RLS + session checks; anonymous limited to
  resolve + submit.
- Expiration — ✅ server-enforced in both providers, no browser-clock trust.
- Public projection — ✅ whitelisted, id blanked, no auth/account/provider/
  deployment/sync/recovery/Copilot/template/My-Blocks data.
- Feedback — ✅ plain text, bounded, server-validated, rate-limited, no
  dangerouslySetInnerHTML, pollution keys rejected, oversized rejected.
- URL/navigation safety — ✅ javascript:/vbscript:/unsafe data: blocked; safe
  http/https/mailto/tel/internal preserved (existing `classifyPreviewLink`).
- Cache — ✅ no-store on public resolve; server authorization authoritative.
- Lifecycle — ✅ export/duplicate/delete/sign-out all correct (tested).
- Supabase/RLS — ✅ owner-scoped everywhere; minimal grants; no service-role
  secret in client code.
- Mock/real parity — ✅ same essential permission model; documented nuances:
  Supabase truncates oversized comment bodies (left(...,2000)) while the mock
  rejects (both bound input); Supabase burst rate limiting delegated to edge
  protection.
- Errors — ✅ beginner-safe copy everywhere; raw backend errors never shown.

---

## 17. Incidents (documented truthfully)

### Cold-start Next/webpack worker crash (environmental)

The first full `test:e2e` attempt failed its very first test with the Next.js
dev overlay "Jest worker encountered 2 child process exceptions" — a dev-server
worker crash on a cold start under load. The same test passes in isolation and
in the clean full run. Not a code regression.

### Playwright worker crash storm from concurrent runs (environmental, operator error)

A full-regression run degraded into "worker process exited unexpectedly
(code=3221225794 = STATUS_DLL_INIT_FAILED)" across 39/100 tests — every failure
identical, spanning all feature areas. Root cause: earlier tooling left multiple
Playwright/Chromium processes running concurrently on a resource-constrained
machine; Chromium workers could no longer spawn. All processes were killed,
Chrome instances were terminated, and the full regression was rerun cleanly
(single worker, no other suites running). The affected specs all pass in
isolation and in the clean rerun.

---

## 18. Final validation results

### Post-fix gates (final state, this session)

- `npx tsc --noEmit` — clean
- `npm run lint` — clean
- `npm test` — 3,656 passed (264 files; 93 sharing unit/component tests included)
- `npm run build` — success (`/share/[token]` and `/api/share/[[...path]]` compiled)
- P12 E2E (`share-review`, `share-feedback`, `share-security`) — 3/3 passed
- Full regression `test:e2e` — 100 passed (11.3 min, single worker, clean run)
- `test:e2e:matrix` — 13 passed (prompt matrix incl. arabic/japanese/injection)
- `test:e2e:fallback` — 1 passed
- `test:export-build` — 1 passed (generated project `npm install && npm run build` succeeds)

---

## 19. Tests

- **Unit/component (93):** token (entropy/format/hash/isValid), projection
  sanitizer (whitelist, invalid-section drop, pollution keys, id blanking,
  size cap), mock backend (create/list/update/revoke/regenerate, expiry,
  rate limit, duplicate guard, feedback gating, ownership, resolve,
  lifecycle cleanup, status batch), mock HTTP provider (envelope mapping,
  no raw-error leak), service error mapping, lifecycle isolation (export /
  duplicate / delete + device-cache purge), ShareDialog, ReviewLinksTab
  (create + settings + manage + revoke-on-push-failure), ReviewFeedbackTab
  (resolve/reopen/delete, deleted-section state, jump), FeedbackSheet
  (bounds, success, error states).
- **E2E (3 suites, deterministic mock backend):**
  - `share-review.spec.ts` — owner create → second-context viewer renders
    read-only → editor controls absent → safe navigation → revoke → viewer
    refresh shows "no longer available" → runtime audit clean.
  - `share-feedback.spec.ts` — viewer comment (with name) → owner panel →
    jump → resolve → reopen → delete → viewer cannot reach owner endpoints →
    runtime audit clean.
  - `share-security.spec.ts` — fake/expired/revoked tokens denied;
    feedback-disabled writes denied; malicious `<script>` comment stored and
    rendered as text with no execution; cross-project isolation (A's token
    never resolves B, no project id in the public response); public envelope
    hygiene; unknown endpoints return safe envelopes.

---

## 20. Files created

- `docs/phase-p12-architecture.md`
- `src/features/sharing/` — `types.ts`, `constants.ts`, `errors.ts`,
  `token.ts`, `utils/share-format.ts`, `store/share-ui-store.ts`,
  `projection/sanitize-share-projection.ts`,
  `mock/mock-share-server.ts`,
  `providers/share-link-provider.ts`, `providers/mock-http-share-provider.ts`,
  `providers/supabase-share-provider.ts`,
  `services/share-link-service.ts`, `services/share-local-cache.ts`,
  `services/lazy-share-cleanup.ts`,
  `hooks/useShareBadges.ts`, `hooks/useShareSnapshotSync.ts`,
  `components/ShareDialog.tsx`, `components/ReviewLinksTab.tsx`,
  `components/ReviewFeedbackTab.tsx`, `components/FeedbackSheet.tsx`
- `src/app/share/[token]/page.tsx`
- `src/app/api/share/[[...path]]/route.ts`
- `src/features/sharing/__tests__/` — `token.test.ts`,
  `sanitize-share-projection.test.ts`, `mock-share-server.test.ts`,
  `mock-http-share-provider.test.ts`, `share-link-service.test.ts`,
  `share-lifecycle.test.ts`
- `src/features/sharing/components/__tests__/` — `ShareDialog.test.tsx`,
  `ReviewLinksTab.test.tsx`, `ReviewFeedbackTab.test.tsx`,
  `FeedbackSheet.test.tsx`
- `e2e/helpers/share.ts`, `e2e/share-review.spec.ts`,
  `e2e/share-feedback.spec.ts`, `e2e/share-security.spec.ts`
- `supabase/migrations/20260809000001_share_review_schema.sql`

## 21. Files modified

- `src/components/editor/TopNav.tsx` (Share button)
- `src/features/guided-builder/components/CommandPalette.tsx` (share actions)
- `src/app/editor/[projectId]/page.tsx` (lazy ShareDialog, snapshot-sync hook,
  `?share=1` handling)
- `src/app/page.tsx` (dashboard badge + manage-sharing action)
- `src/features/projects/components/ProjectCard.tsx` (Shared badge,
  Manage sharing)
- `src/features/persistence/services/project-controller.ts` (delete →
  `lazyShareCleanup`)
- `src/features/projects/services/project-service.ts` (delete →
  `lazyShareCleanup`)
- `e2e/helpers/runtime-audit.ts` (410 revoked/expired is a designed response)

## 22. Dependencies

None added. Uses existing `node:crypto` (Node), Web Crypto (browser),
`@supabase/supabase-js` (already present), and the P6 mock cloud/session.

## 23. Migrations

`supabase/migrations/20260809000001_share_review_schema.sql` — additive:
`share_links` + `review_comments`, RLS, SECURITY DEFINER RPCs, minimal grants.
No IndexedDB change (share data never lives locally).

---

## 24. Known limitations

- **Supabase comment rate limiting** is delegated to edge protection/provider
  limits (the RPC enforces the duplicate guard and bounds; the mock enforces a
  real per-share 20/10-min limit). Documented in the architecture.
- **Post-creation expiry editing** is not surfaced in the UI today (the manage
  list shows expiry read-only). The `updateShare` provider surface exists and
  is parity-correct; the architecture's "change expiry at any time" is a P13
  candidate.
- **Snapshot freshness** for links created on another device is best-effort:
  the editor pushes refreshes only for shares the local device knows about
  (per-device cache). A share always renders at least the projection pushed at
  creation.
- **Comment body truncation** (Supabase `left(...,2000)`) vs rejection (mock)
  — both bound input.
- No WCAG certification claim.

---

## 25. Genuine P13 candidates (only)

- Post-creation share-settings editing in the manage list (expiry extend /
  feedback toggle) — the API surface already supports it.
- Section-anchored feedback UI for viewers (the schema stores `sectionId` and
  the owner panel already jumps to it).
- Share-link inbox/notifications when feedback arrives (explicitly deferred).
