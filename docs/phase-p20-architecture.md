# Phase P20 — Release Readiness & Production Launch Hardening: Architecture

Branch: `phase-p20-release-readiness`
Status: **Audit complete — fixes implemented. Report follows in `docs/phase-p20-report.md`.**

---

## 1. P20 objective

Determine whether Buildora AI, as it exists after P19, is actually ready for a
production release. This is a **release-readiness** phase, not a
feature-development phase. The audit covered production safety, deployment and
configuration correctness, database/migration safety, authorization boundaries,
persistence durability, collaboration reliability, publishing/export
reliability, observability readiness, failure recovery, rollback safety, data
integrity, security posture, user-facing failure behavior, and operational
readiness.

**Guiding principles:** close genuine release blockers only; do not add
infrastructure merely because it sounds "production grade"; every finding needs
evidence; every genuine fix ships with a regression test; P2/P3 items are
documented for future phases unless trivially safe to fix; **P21 is NOT started.**

## 2. Baseline (verified in the repository)

- Branch `phase-p20-release-readiness` cut from merged master; P16–P19 merged.
- Working tree clean at audit start (verified `git status`).
- Baseline validation from P19: 3940/3940 unit tests; full E2E 116/117 (1
  documented pre-existing environmental flake); matrix 13/13; fallback 1/1;
  export-build 1/1; tsc/lint/build clean.
- P19 delivered: logger safe-identifier allow-list, structured logging in the
  four mock API routes, publish failure diagnostics, collab clientId correlation.

## 3. Release-audit methodology

1. **Confirm branch + clean tree** (done — §2).
2. **Read P16–P19 architecture and report docs** to establish what was already
   fixed and what was deliberately deferred (the "candidates" are inputs for
   investigation only — never blindly implemented).
3. **Audit the repository as it actually exists** — every area in the phase
   brief was inspected in code (not inferred from reports):
   - `package.json` / scripts / `next.config.ts` / `playwright.config.ts` /
     `tsconfig.json` / `vitest.config.ts`
   - `.env.example` (gitignored; `.env.local` key NAMES only — values never read)
   - cloud environment resolution (`cloud-environment.ts`), auth services,
     Supabase browser client, publishing server mode/client auth
   - all 8 Supabase migrations (RLS policies, SECURITY DEFINER RPCs, grants,
     retention, constraints) — collab updates, workspaces, share/review,
     presence/activity/versions, cloud-sync, shared libraries, fetch-changes
   - all 17 API routes (workspaces, collab, presence, share, generate, publish
     vercel ×9, cloud)
   - persistence (`ProjectController`), autosave, recovery, beforeunload guard
   - collaboration (`CollabSession`, both transports, mock room handlers,
     session hook, transport factory)
   - publishing (`PublishService`, idempotency, deploy rate limit)
   - failure UX (StatusBar, TopNav, share view, workspace access hook)
   - observability (logger + P19 call sites)
   - E2E harness (runtime audit, config, 56 spec files)
4. **Classify** every finding P0/P1/P2/P3 with evidence (§4).
5. **Implement only genuine P0/P1 fixes** (+ trivially safe P2s), each with a
   regression test (§5).
6. **Validate** the full gate sequence, release smoke path, and affected +
   full E2E (§8 of the report).

## 4. Risk inventory (audit findings)

### 4.1 Genuine findings — fixed with regression tests

**F1 (P1 — serious production risk). `/api/generate` — the only production
API surface with no rate limiting — invokes a PAID AI provider.**

- *Current behavior:* the route is NOT mock-gated (it runs in production
  builds), it calls Gemini with a server-side key, and it is unauthenticated by
  design (generation works without an account — local-first product rule).
  Before P20 it had a body cap and prompt-length cap but **zero throttling**.
- *Evidence:* `grep rateLimit src/app/api/generate/route.ts` → 0 matches. Every
  other API surface in the app has a ceiling: mock auth 10/min/email
  (`mock-cloud-server.ts`), publish deploy 10/min/project
  (`publish-idempotency.ts`), collab 2400/min/room (`mock-workspace-server.ts`),
  share comments 20/min/share (`mock-share-server.ts`).
- *Failure/risk:* an attacker can hammer `/api/generate` and burn the
  operator's paid Gemini quota (cost abuse / DoS on a billable external API)
  with no way to stop it at the app layer.
- *Fix:* a bounded in-memory fixed-window rate limiter
  (`src/features/generation/server/generate-rate-limit.ts`), keyed by the first
  `X-Forwarded-For` entry (bounded to 64 chars), ceiling **60 req/min/client**,
  enforced **in production only** (`NODE_ENV === "production"`). Dev/E2E is a
  local testing surface (mock cloud, force-local header) and the matrix suite
  issues many requests — enforcing there would add flake without protecting
  anything real, mirroring the app's "mock in dev, real in prod" posture.
  429 `RATE_LIMITED` response shape matches the route's existing error envelope.
- *Honest boundary (documented):* in-memory = per warm serverless instance,
  best-effort, exactly like `deployRateLimited`. Multi-instance enforcement
  needs an external limiter (P3 future enhancement). The limiter still closes
  the "no throttling anywhere" hole at the app layer.
- *Regression tests:* 12 tests in
  `src/features/generation/__tests__/generate-rate-limit.test.ts` — ceiling
  hit, per-client isolation, window rollover, forwarded-header parsing, bound
  cap, unknown-client fallback, production-only enforcement, expired-key sweep,
  live-entry insertion-order eviction, and the F3 force-local header
  production/dev gates.

**F2 (P2 — trivially safe). No security headers on any response.**

- *Evidence:* `next.config.ts` was empty (only `/* config options here */`);
  `grep -ri "X-Frame-Options\|Content-Security-Policy\|Strict-Transport" src`
  → 0 matches.
- *Fix:* `src/lib/security-headers.ts` exports a tested, fixed header set
  applied via `next.config.ts` `headers()` to every route:
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy: camera=(), microphone=(), geolocation=()`,
  `X-DNS-Prefetch-Control: off`.
- *Deliberate non-goal (documented):* a Content-Security-Policy is NOT added —
  Next.js injects inline hydration scripts/styles that would require a
  carefully maintained nonce/hash allow-list, and a broken CSP would take the
  whole production build down. The safe header subset is the release-scoped
  improvement; CSP is a P3 future enhancement.
- *Regression tests:* 8 tests in
  `src/lib/__tests__/security-headers.test.ts` — each header present, CSP
  deliberately absent, bounded list.

**F3 (P2 — trivially safe). `x-buildora-force-local` test header honored in
production.**

- *Evidence:* `route.ts` accepted `request.headers.get("x-buildora-force-local")
  === "true"` unconditionally in all four handlers (create/modify/plan/inline);
  the header comment said "accepted for integration testing" but nothing gated
  it to non-production.
- *Failure/risk:* a live deployment could let an arbitrary external request
  bypass the configured AI provider (rule-based instead of Gemini). Not a data
  leak, but an external caller controlling provider selection is a live-config
  integrity issue.
- *Fix:* a `forceLocalHeader()` helper honors the header only when
  `NODE_ENV !== "production"`. In production the ONLY switch is the server-side
  `BUILDORA_FORCE_LOCAL_GENERATION` env var, which an external caller cannot
  set. E2E unaffected (Playwright runs against the dev server).
- *Regression coverage:* the existing `e2e/fallback-isolation.spec.ts` proves
  the header still works in dev (passed 1/1 in the affected batch and the
  dedicated gate).

**F4 (P2 — trivially safe). `.env.example` omitted the AI generation and cloud
provider variables.**

- *Evidence:* `grep -ci GEMINI .env.example` → 0; `NEXT_PUBLIC_CLOUD_PROVIDER`
  also undocumented, though `cloud-environment.ts` documents the resolution
  order in code.
- *Fix:* documented `GEMINI_API_KEY`, `GEMINI_MODEL`, `BUILDORA_FORCE_LOCAL_GENERATION`,
  and `NEXT_PUBLIC_CLOUD_PROVIDER` (server-only / public boundaries noted).
- *Note:* `.env.example` is gitignored by the repo's `.env*` rule, so this is a
  local documentation improvement (never committed); the repository convention
  is that env documentation lives in `.env.example` on each developer's machine
  and in the P-series docs.

### 4.2 Audited and correct — left alone (documented)

- **Secrets/public boundaries.** Only `NEXT_PUBLIC_*` values reach the browser
  (Supabase URL + anon key). `GEMINI_API_KEY`, `VERCEL_API_TOKEN`,
  `VERCEL_TEAM_ID` are read only in server modules. `.env.example` instructs
  never to prefix secrets with `NEXT_PUBLIC_`. E2E secret-exposure tests exist.
- **Cloud environment resolution.** Local-first; mock only in dev (or forced);
  production without credentials → `none` (local-only) / `unavailable`
  (publishing hidden, never a broken action). `NEXT_PUBLIC_CLOUD_PROVIDER=none`
  can force local-only even in dev.
- **Mock route gating.** `/api/cloud`, `/api/collab`, `/api/presence`,
  `/api/share`, `/api/workspaces` return 404 `NOT_CONFIGURED` unless the cloud
  environment resolves to `mock`. Production builds can never reach mock state.
- **Migrations / RLS.** All 8 migrations audited: RLS enabled on every private
  table; SECURITY DEFINER RPCs set `search_path = public`; grants to
  `authenticated` only (never `anon`/`public`); actor always `auth.uid()`;
  membership/owner/editor gates inside RPCs; optimistic concurrency
  (`STALE_REVISION`); bounded retention (300 activity / 50 versions / log
  pruned at checkpoint); allow-listed activity metadata keys; first-writer-wins
  seed; size caps on decoded bytes. Two documented lenient points from P18
  remain documented, not changed: `ws_join_presence` does not validate project
  existence (member-scoped, ephemeral UI state, mode server-resolved) and
  `ws_collab_append_update` does not require the project row (pruned at
  checkpoint, not a security boundary).
- **Workspace authorization.** Mock `requireUser/requireMember/requireOwner/
  requireEditor` on every handler; actor derived from session token; workspace-
  scoped leases; recipient-scoped invitations; removed/downgraded members lose
  access immediately (leases, presence, share links revoked); no cross-workspace
  enumeration (revoke-for-project skips workspaces the caller can't see).
- **Collaboration.** P16/P17 semantics verified intact: prune-at-checkpoint
  retention (no silent drop), session-end checkpoint, connect-failure edit
  fallback, bounded offline queues on BOTH transports, channel-epoch guard,
  per-room send rate limit, size caps on decoded bytes, maintenance lock
  owner-only, restore resets the room. No change needed.
- **Publishing.** `PublishService` never mutates project content, uses
  deterministic export hash + idempotency key, persists intermediate/final
  status (failed/cancelled preserved — never a false success), rollback
  requires confirmation. All Vercel routes verify the Buildora session
  server-side and pass `ownerUserId` per-call. Deploy route: schema validation,
  artifact caps, path sanitization, idempotency reuse, 10/min/project rate
  limit. P19 F3 diagnostics present at every failure boundary.
- **Persistence durability.** Dirty-flush blocks transitions; safe delete
  order; revision-aware save marking; beforeunload guard; recovery snapshots;
  autosave coordinator single-flight. P16/P17/P18 diagnostics present.
- **Share/review.** Token stored as hash only; raw token returned once at
  creation; public resolve returns blanked projectId; feedback requires the
  token in the body, is rate-limited (20/min) and duplicate-guarded; revoked/
  expired → 410 with safe copy; member removal/downgrade revokes links.
- **Observability.** P19 verified in code: logger allow-list survives
  production redaction, mock routes use the structured logger, publish
  diagnostics, collab clientId. No duplication.
- **Failure UX.** StatusBar save states (hydrating/saving/error/unsaved/saved)
  never imply success; collab sync status is text + color; viewer/offline/
  unauthorized resolve to honest read-only; share view shows safe error copy;
  publish store distinguishes success/failure/cancelled.
- **Deployment/build.** `npm run build` clean; static `(○)` pages are the app
  shell + share/preview dynamic routes are `ƒ`. E2E config: workers=1,
  chromium, dev server with webpack flag (Windows junction workaround),
  `reuseExistingServer: true`. No CI pipeline exists in the repo (no
  `.github/workflows`) — a documented P3 operational item, not a code blocker.

## 5. Proposed/implemented fixes (summary)

| # | Severity | Change | Files |
|---|---|---|---|
| F1 | P1 | Production-only rate limit on `/api/generate` (60/min/client, XFF-keyed, bounded) | `src/features/generation/server/generate-rate-limit.ts` (new), `src/app/api/generate/route.ts`, `src/features/generation/__tests__/generate-rate-limit.test.ts` (new, 12 tests) |
| F2 | P2 | Standard security headers on every response | `src/lib/security-headers.ts` (new), `next.config.ts`, `src/lib/__tests__/security-headers.test.ts` (new, 8 tests) |
| F3 | P2 | `x-buildora-force-local` honored in dev only; production uses the env var | `src/app/api/generate/route.ts` + `isTestForceLocalHeader` in `generate-rate-limit.ts` (unit-tested: production ignores, dev honors) |
| F4 | P2 | Document `GEMINI_*`, `BUILDORA_FORCE_LOCAL_GENERATION`, `NEXT_PUBLIC_CLOUD_PROVIDER` | `.env.example` (gitignored — local doc) |

**Non-goals (explicit).** No CSP (P3). No external rate limiter / log sink /
monitoring platform (P3). No request-ID plumbing (P3 candidate). No CI pipeline
addition (P3 operational). No RLS/auth weakening. No CRDT rewrite. No UI
redesign. No changes to tests merely to make new work pass. **P21 not started.**

## 6. Release smoke strategy

The smoke path maps 1:1 onto the existing E2E suite — no redundant new spec is
created (phase brief: "Do not create a huge redundant E2E suite"):

| Smoke step | Coverage |
|---|---|
| 1. Authenticate | `workspace-collaboration`, `workspace-permissions` (signup/signin helpers) |
| 2. Create/open workspace | `workspace-collaboration` |
| 3. Create/open project | `editor.spec.ts`, `workspace-collaboration` |
| 4. Edit project | `editor.spec.ts` (32 tests), `realtime-collaboration` |
| 5. Persist changes | `editor.spec.ts` (save flows), `guided-builder` (persistence) |
| 6. Reload project | `editor.spec.ts`, `realtime-collaboration` (reload convergence) |
| 7. Collaborative editing | `realtime-collaboration` |
| 8. Publish/export | `production-publishing`, `test:export-build` (real build) |
| 9. Verify resulting state | `production-publishing`, `share-review` |
| 10. Authorization boundary | `workspace-permissions`, `share-security`, `realtime-permissions` |

Smoke batch executed: `editor` + `workspace-collaboration` +
`realtime-collaboration` + `production-publishing` + `workspace-permissions` +
`share-review` = **37/37 passed**.

## 7. Security strategy

- Focused release security audit performed against the brief's checklist
  (IDOR, cross-workspace reads/writes, privilege escalation, removed-member
  access, stale auth, token/session leakage, secret exposure, sensitive
  logging, unsafe errors, missing validation, dangerous path handling,
  rate-limit bypass, replay/duplicate ops, RLS gaps, client-side auth trust).
- Every finding above has: minimal fix, regression test, and an explanation in
  the report.
- No authorization was weakened anywhere to make a test pass; the only new
  enforcement (F1 rate limit) is additive and production-only.
- Secrets are never printed or exposed; `.env.local` values were never read
  (only key names).

## 8. Deployment assumptions

- Next.js 16 App Router; `npm run build` then `npm start` (or the platform's
  equivalent). E2E uses `next dev --webpack` (Windows junction workaround).
- Supabase: apply the 8 migrations in order; the collab migration
  (20260813000001) requires the P14 workspaces schema (FKs). RLS + SECURITY
  DEFINER RPCs must be in place — the client holds only the anon key.
- Real publishing requires `VERCEL_API_TOKEN` (server-only). Without it,
  publishing hides in production (never a broken action).
- AI generation requires `GEMINI_API_KEY` (server-only). Without it, generation
  falls back to the rule-based engine. Rate limiting (F1) protects the keyed
  path in production.
- No CI pipeline exists; the release process is the documented local gate
  sequence (tsc → lint → test → build → E2E gates).

## 9. Rollback assumptions

- The F1–F4 changes are behavior-additive or dev-gated: reverting is a simple
  revert of `next.config.ts`, `src/app/api/generate/route.ts`, and the two new
  modules — no data migration, no schema change, no feature flag required.
- The rate limiter is in-memory (no persisted state); restart clears it.
- Security headers are static config; reverting restores the prior behavior.

## 10. Validation plan

`npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build` →
release smoke batch → affected AI/fallback batch → `test:e2e:matrix` →
`test:e2e:fallback` → `test:export-build` → full `test:e2e` (background +
polling, one dev server only). Results in the report.

## 11. Explicit non-goals (recap)

- P21 is NOT started; the P20 "candidates" from prior reports are inputs only.
- No CSP, no external observability/metrics/log drain, no health endpoint.
- No request/operation-ID plumbing.
- No CI pipeline addition, no new infrastructure.
- No CRDT/architecture replacement, no RLS changes, no auth weakening.
- No UI redesign; only release-critical misleading states would be fixed
  (none were found).
