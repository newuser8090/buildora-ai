# Phase P8 Report — Production Publishing

Branch: `phase-p8-production-publishing`
Status: ✅ Complete — all regression suites green

---

## 1. Overview

Phase P8 takes publishing from "demo" to **real production hosting** by
shipping a Vercel provider behind the existing Phase P7 provider abstraction.
Users can publish their exported site to the public internet, connect a custom
domain, inspect deployment details, roll back to an older build, and delete
their live site — while the beginner-first "put my site online" flow stays the
single, safe entry point.

Scope footprint (working tree): ~30 modified files plus **52 new files**
(12 server API routes, the Vercel provider + server adapter, the custom-domain
feature, deployment-details UI, and their tests) across `src/features/publishing`,
`src/app/api/publish`, the editor/dashboard surfaces, and the e2e suite.
Design decisions are recorded in `docs/phase-p8-architecture.md`.

---

## 2. Features delivered

### 2.1 Real Vercel provider (`providers/vercel-provider.ts` + `server/`)
- Provider id `"vercel"` with capabilities `realHosting`, `customDomains`,
  `rollback`, `deploymentLogs`, `cancelDeployment`, `deleteDeployment`,
  `previewDeployments` (see §I of the architecture doc); the generic UI stays
  free of provider-specific strings.
- Client adapter re-runs the P7 export generator on the publish snapshot
  (same deterministic hash), POSTs the files to Buildora's
  `/api/publish/vercel/deploy`, then polls the deployment to `live`.
- Server side: session-verified route handlers, zod request validation with
  caps (2,000 files / 25 MB total / 5 MB per file), per-path sanitization,
  SHA-1 file manifest, idempotency registry (≤90 s identical publishes),
  `VercelApiClient → ProviderHttpClient` with injectable transport.
- Dev/E2E runs against the in-process `MockVercelServer` (same wire contract);
  with no `VERCEL_API_TOKEN` the provider reports "not configured" and the app
  never asks a normal user for a token. Tokens stay server-only.

### 2.2 Custom domains (`domain/`)
- `DomainSetupDialog` with beginner-safe input validation (hostname syntax
  only, no protocol/path, lowercase, private/reserved/localhost rejected),
  structured DNS instructions (`DomainInstructions`), and status polling
  (`DomainStatusCard`).
- `domain-service` / `domain-storage` / `domain-utils` + `useDomains` hook;
  domains stored in the new IndexedDB **`deploymentDomains` store (DB v6 → v7)**,
  treated as deployment infrastructure — never exported/imported with the
  project, never part of undo history.
- One primary domain per project in P8 (first verified); multiple domains are
  stored and listed.

### 2.3 Deployment management
- `DeploymentDetailsDialog`: status, live URLs, provider details, build
  timestamps (sanitized stage state, no secrets), and capability-driven
  actions (Open / Copy / Republish / Roll back / Cancel / Delete).
- Rollback via `POST /v1/projects/{projectId}/rollback/{deploymentId}` — never
  faked, never touches editor content; the publishing-history e2e now verifies
  the rolled-back deployment carries the Current badge and rises to the top.
- `publish-concurrency.ts` (client-side in-flight registry) and
  `publish-idempotency.ts` (server-side) prevent duplicate production deploys.

### 2.4 Beginner-first surfaces
- **Dashboard delete**: deleting a project with a live site never silently
  kills production — the dialog shows an explicit amber opt-in ("Also remove
  the published site") backed by `remove-published-site.ts`; provider failure
  surfaces after local deletion so the user knows the site may still be online.
- **TopNav**: the Publish button reads the live status — "Publish updates"
  when there are unpublished changes; a transient "Link copied." notice
  confirms clipboard shares.
- **Command palette**: Open my live site, Copy my live link, Connect a custom
  domain, Check my domain status, Restore an older published version.
- **Coach panel**: deterministic live/domain coach card (publish updates,
  connect a domain, domain still connecting).
- **Launch Center**: live-status section with the active URL, provider label,
  and last-publish time; the history action becomes "Manage publishing".

### 2.5 Data model & compatibility
- `DeploymentRecord` gains only optional, backward-compatible fields
  (`ownerUserId`, `providerDeploymentId`, `providerProjectId`, `deploymentUrl`,
  `productionUrl`, `previewUrl`, `domainIds`, build timestamps, …); `PublishResult`
  gains an optional `deploymentPatch`. Previous deployment records remain readable.

---

## 3. Regression validation (sequential rerun)

Full sequential rerun of every P8 verification step after the final fixes
(no orphaned dev servers; fresh run).

| Suite | Command | Result |
|---|---|---|
| Unit tests | `npm test` (vitest) | ✅ 229 files / **3,315 tests** passed |
| Typecheck | `npx tsc --noEmit` | ✅ pass |
| Lint | `npm run lint` | ✅ pass |
| Build | `npm run build` | ✅ Next.js production build succeeds; all 12 `/api/publish/vercel/*` routes compiled |
| E2E production publishing | `npx playwright test e2e/production-publishing.spec.ts …` | ✅ **4/4** passed (1.2m) — production-publishing, production-rollback, custom-domain, publishing-history |
| E2E cloud sync (shared mock-server change) | `npx playwright test e2e/cloud-sync.spec.ts e2e/cloud-sync-conflicts.spec.ts` | ✅ **3/3** passed (54.9s) |

**Totals:** 3,315 unit + 7 e2e = **3,322 tests green, 0 failures.**

### 3.1 Issues found & fixed during the rerun

- **Determinism test raced the wall clock.** `rule-based-planner.test.ts`
  compared two planner plans with `JSON.stringify` including `createdAt`,
  which is intentionally wall-clock metadata, not planner output — a
  millisecond boundary crossing could flake. The assertion now normalizes
  `createdAt` before comparing. (Accepted per plan: the planner itself was
  unchanged.)
- **Publishing-history e2e asserted the wrong card order.** After rollback the
  current deployment is re-sorted to the top (Current group renders first),
  so the spec now asserts the **first** card carries "Current" + "Published
  from revision 1" and the second does not.
- **IndexedDB store count changed.** Adding the `deploymentDomains` store moved
  the expected store list from 10 to 11; updated in `cloud-sync-queue.test.ts`
  and `my-block-collections.test.ts` (both now assert the new store name too).
- **Mock cloud state moved to `globalThis`.** In Next.js dev every route
  handler is its own webpack bundle, so the old module-level mock singleton
  split sign-up sessions across routes (cloud-sync writes were invisible to
  the publish routes). The mock now lives on `globalThis`, shared by every
  route bundle — confirmed by the cross-device cloud-sync e2e rerun (3/3).
- **Component tests hit IndexedDB on mount.** `TopNav-export.test.tsx` and
  `GuidedPanel.test.tsx` mount components that read deployment history on
  mount; both now import `fake-indexeddb/auto` so those reads resolve.

---

## 4. Notes / risks

- Mock Vercel state + in-memory idempotency are single-instance (reset on
  dev-server restart), mirroring the Phase P6 mock cloud.
- Real build logs are not streamed from Vercel's events API; "Build details"
  shows sanitized stage state + timestamps.
- Cloud sync (P6) intentionally does not sync deployment records or custom
  domains — the production provider is the remote source of truth.
- Genuine Phase P9 candidates (streamed logs, a second provider, team
  deployments, per-environment UI) are documented but **not started**.
