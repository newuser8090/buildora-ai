# Phase P8 — Architecture Decisions

This document records the decisions made before building Phase P8 (real
production publishing through a hosting provider, custom domains, deployment
details, rollback, and the beginner-first "put my site online" flow). It
reuses the Phase P7 publishing abstraction — nothing in P7's provider
registry, publish pipeline, deployment store, or Launch Center is replaced.

## A. Selected production provider

**Vercel** is the only real provider implemented in P8.

Rationale:

- The exported sites are Next.js apps (P7 export pipeline), and Vercel is
  the native Next.js host — build behavior matches what P7 already validates
  (`npm run test:export-build`).
- Vercel has a documented REST API for projects, deployments, aliases, and
  domains with no CLI required.
- The provider interface stays generic; a second provider (e.g. Cloudflare
  Pages) can be added later without touching the UI, which is driven by
  declared capabilities (section I).

A Cloudflare Pages / Netlify provider is intentionally NOT implemented in
P8. Adding a second provider is only worthwhile once the first is fully
complete; weakening the Vercel adapter to claim multi-provider support was
explicitly rejected.

### Mock Vercel API (dev/E2E only)

Because unit tests and E2E must never require real credentials, the server
side ships an in-process `MockVercelServer` (server-only module, same pattern
as the Phase P6 mock cloud backend). When no `VERCEL_API_TOKEN` is set and
the environment is development, the publish routes use the mock; in
production with no token, the provider is simply unavailable. The same
`VercelApiClient` interface drives both modes, so the E2E suites exercise the
exact wire contract the real adapter uses.

## B. Credentials model

Server-only environment variables (see `.env.example`):

```
VERCEL_API_TOKEN=        # Vercel access token (never NEXT_PUBLIC_)
VERCEL_TEAM_ID=          # optional team scope (sent as ?teamId=)
VERCEL_PROJECT_PREFIX=   # optional prefix for generated project names
VERCEL_API_BASE_URL=     # optional override; default https://api.vercel.com
```

Rules:

- Tokens are read **only inside server route handlers** — never in client
  code, never `NEXT_PUBLIC_`, never persisted to IndexedDB, never logged.
- Missing credentials disable only the Vercel provider. Local Export always
  works; Mock publish keeps working in dev/E2E; startup/build/tests never
  break.
- The client learns availability through `GET /api/publish/vercel/status`
  (cached client-side with a short TTL) and shows "Vercel publishing isn't
  configured on this Buildora installation." to users — it never asks a
  normal user for a platform token.

## C. Server/client boundary

```
Browser
  VercelPublishingProvider (client adapter, id "vercel")
    ├─ regenerates export files from the P7 snapshot (same generator,
    │  same deterministic hash)
    ├─ POST /api/publish/vercel/deploy   (files payload, Bearer session)
    ├─ GET  /api/publish/vercel/deployments/:id   (bounded polling)
    ├─ POST .../cancel | POST .../rollback | DELETE .../:id
    └─ /api/publish/vercel/domains/*     (attach / status / remove)
Next.js route handlers (Node runtime)
    ├─ verify Buildora session server-side (Supabase or mock)
    ├─ strict request validation + caps (zod)
    ├─ idempotency registry (in-memory, single-instance)
    └─ VercelApiClient → ProviderHttpClient → api.vercel.com  (real)
                         └─ MockVercelServer                (dev/E2E)
```

- The browser NEVER holds the Vercel token; every privileged provider call
  goes through a Buildora server route.
- Buildora does not need to be hosted on Vercel; the routes only need the
  token + outbound HTTPS.
- `ProviderHttpClient` is an injectable transport so unit tests stub
  success/auth/rate-limit/malformed/timeout without any live credentials.

## D. Artifact upload strategy

The P7 `PublishService` remains the canonical pipeline (validate → export
validation → generate export files → deterministic hash → create deployment
record → invoke provider). The Vercel client adapter:

1. Re-runs `generateExportProject(snapshot)` to obtain the exact `OutputFile[]`
   (same code, same hash — never a live project reference).
2. POSTs the files to Buildora's `/api/publish/vercel/deploy` with a strict
   cap (default: 2,000 files, 25 MB total, 5 MB per file) and per-path
   sanitization (relative paths only, no `..`, no absolute/backslash, no
   null bytes, no shell metacharacters).
3. The server computes SHA-1 per file, creates/ensures the provider project,
   POSTs `/v13/deployments` with the files map, and uploads any `missing`
   files through the provider-returned upload URLs (validated against the
   provider host allowlist).

No shell commands, no Vercel CLI, no per-publish Git repository.

## E. Deployment-state model changes

`DeploymentRecord` gains only optional, backward-compatible fields:

```ts
ownerUserId?           // Buildora user who owns the deployment
providerDeploymentId?  // e.g. dpl_...
providerProjectId?     // e.g. prj_...
providerProjectName?   // e.g. buildora-<projectId>
providerState?         // provider raw state (e.g. "READY") — advanced detail
deploymentUrl?         // immutable provider URL
productionUrl?         // the public/current URL (alias or custom domain)
previewUrl?            // preview URL when the provider supports it
domainIds?: string[]   // custom domains attached to the deployment
buildStartedAt? / buildCompletedAt?
```

- No tokens, secret headers, or access credentials are ever stored.
- The `PublishResult` gains an optional `deploymentPatch` so providers can
  surface provider metadata that `PublishService` persists on success — the
  service remains the only writer of deployment records.
- The IndexedDB database is bumped once (6 → 7) adding a single generic
  `deploymentDomains` store via the shared `ensureDatabaseStores()` helper;
  all adapters keep creating every store, and previous deployment records
  remain readable.

## F. Domain strategy

- Generic `DeploymentDomainRecord` model (outside ProjectSchema): domains are
  deployment infrastructure, not site content — never exported/imported with
  the project, never part of undo history.
- Stored in the `deploymentDomains` IndexedDB store; the provider is the
  remote source of truth, the local store is product history/cache.
- Input validation: hostname syntax only (`example.com`), no protocol, no
  path/query, lowercase, length caps, private/reserved/localhost rejected,
  duplicate detection, whitespace trimmed. Placeholder `example.com` with
  "no https:// needed" helper copy.
- Provider abstraction extended with `addDomain / removeDomain /
  getDomainStatus / getDomainInstructions` on the Vercel client adapter
  (through server routes) — no separate provider-specific domain
  architecture.
- Verification: Buildora tells the hosting provider to attach the domain,
  receives structured DNS instructions, and re-checks state. Buildora never
  modifies the user's DNS (no registrar/API credentials accepted in P8) and
  never stores private keys; HTTPS provisioning is the provider's job
  ("Secure connection is being prepared.").
- One primary domain per project in P8; multiple domains are stored and
  listed but the primary is the first verified one (documented limitation).

## G. Rollback support

- Mock: refreshes the active deployment (P7 semantics, unchanged).
- Vercel: server route calls the provider promote/rollback API
  (`POST /v1/projects/{projectId}/rollback/{deploymentId}`) which repoints
  the production alias to the target deployment.
- Project editor content is never touched by rollback — only which
  deployment is "current". Confirmation is always required; unsupported
  providers disable the action. Rollback is never faked.

## H. Security model

- Vercel token: server-only, no `NEXT_PUBLIC_`, not in IndexedDB, not in
  deployment records, never logged; provider responses are redacted before
  logging.
- Session: real publishing requires a signed-in Buildora user. Every
  privileged route verifies the session server-side (Supabase server client
  or the mock session map — never the client auth state alone). Deployment
  ownership is stored server-side and enforced on management calls.
- HTTP client: fixed provider base URL (no user-controlled endpoint), no
  redirect-following, request timeout, response size limit, strict JSON
  validation, `Authorization` set server-side only.
- Artifacts: path sanitization (no traversal), payload caps, no shell
  execution, no arbitrary filesystem paths from the client.
- URLs: provider-returned URLs are validated (`https:`, plus
  `http://localhost` for the mock) before rendering or opening; unsafe
  schemes are rejected.
- Errors: raw provider errors are never sent to the browser; every failure
  maps to a structured, beginner-safe code + message.
- Project deletion never silently deletes the live production site; the
  dashboard prompts separately ("Also remove the published site") and only
  offers it when the provider supports secure deletion.

## I. Provider capability differences

```ts
interface PublishingProviderCapabilities {
  realHosting: boolean;      // live URL on the public internet
  customDomains: boolean;    // attach + verify custom domains
  rollback: boolean;         // restore a previous deployment
  deploymentLogs: boolean;   // build details/logs
  cancelDeployment: boolean; // cancel queued/building deployments
  deleteDeployment: boolean; // delete a deployment remotely
  previewDeployments: boolean; // separate preview URL per deploy
}
```

- Local Export: `realHosting:false`, everything else `false`.
- Mock: `realHosting:false` (labeled "Demo publish" — never claims public
  internet), `rollback:true`, `deleteDeployment:true`.
- Vercel: `realHosting:true`, `customDomains:true`, `rollback:true`,
  `deploymentLogs:true`, `cancelDeployment:true`, `deleteDeployment:true`,
  `previewDeployments:true`.

The UI derives every action (Open / Copy / Republish / Roll back / Cancel /
Delete / Manage domain / Build details) from these capabilities — no
"Vercel"-specific strings in generic publishing UI.

## J. Deployment status mapping

Provider states are mapped centrally (server response → Buildora status):

| Provider (Vercel) | Buildora status |
| ----------------- | --------------- |
| QUEUED / INITIALIZING | queued |
| BUILDING | building |
| READY | live |
| ERROR | failed |
| CANCELED | cancelled |

The generic UI only ever sees Buildora statuses; the raw provider state is
shown only in the advanced section of the deployment details dialog.

## K. Concurrency & idempotency

- Client: a module-level in-flight registry keyed by
  `projectId:providerId` prevents accidental duplicate production publishes
  (second click focuses the running publish).
- Server: an in-memory idempotency registry keyed by
  `${projectId}:${exportHash}` returns the existing deployment result for
  identical, recently-successful (≤90 s) publishes instead of creating
  duplicates; failed/cancelled/older entries allow a fresh attempt. This is
  best-effort single-instance and documented as such.
- Snapshot consistency: the export is generated once from the snapshot
  captured at publish start; edits during publishing never change the
  in-flight artifact; afterwards the UI correctly shows "changes
  unpublished".

## L. Known limitations

- In-memory idempotency + mock Vercel state are single-instance (reset on
  dev-server restart), mirroring the Phase P6 mock cloud.
- Real build logs are not streamed from Vercel's events API; "Build
  details" shows sanitized stage state + timestamps (bounded, no secrets).
- One primary domain per project; multiple domains attach but only the
  first verified is treated as primary.
- Cloud sync (P6) intentionally does not sync deployment records or custom
  domains — the production provider is the remote source of truth; local
  deployment records are product history/cache.

## M. Genuine Phase P9 candidates (NOT started)

- Streaming provider build logs; background deployment rehydration/resume
  after reload.
- Second real provider (Cloudflare Pages / Netlify) once Vercel is proven.
- Shared/team deployments with cross-user management.
- Per-environment (preview/production) deployment management UI.
