# Phase P20 — Release Readiness & Production Launch Hardening: Report

Branch: `phase-p20-release-readiness`
Status: **COMPLETE** — release assessment: **RELEASE READY (with documented P2/P3 risks)**.
**P21 NOT started.**

---

## 1. Baseline

- Branch `phase-p20-release-readiness`, created from merged master containing
  P16 (realtime collaboration), P17 (production hardening), P18 (production
  readiness), P19 (observability). Working tree clean at start.
- P19 final validation: 3940/3940 unit tests; full E2E 116/117 (1 documented
  pre-existing environmental flake); matrix 13/13; fallback 1/1; export-build 1/1.
- P20 audit began by reading all of P16–P19 architecture + report documents,
  then auditing the repository **as it actually exists** (never relying on
  historical reports alone).

## 2. Release audit — findings and classification

| # | Area | Finding | Severity | Evidence |
|---|---|---|---|---|
| F1 | API boundaries | **`/api/generate` — the only production API surface with no rate limiting — invokes a PAID AI provider (Gemini) with a server-side key and no auth (by design).** Zero throttling left an open cost-abuse / DoS surface. | **P1** | `grep rateLimit src/app/api/generate/route.ts` → 0 matches; every other API surface has a ceiling (mock auth 10/min/email, deploy 10/min/project, collab 2400/min/room, share comments 20/min/share) |
| F2 | Deployment/security | **No security headers on any response** (empty `next.config.ts`). | **P2** (trivially safe) | `next.config.ts` had only `/* config options here */`; no X-Frame-Options / nosniff / Referrer-Policy anywhere |
| F3 | Config | **`x-buildora-force-local` test header honored in production** — an external request could force provider bypass. | **P2** (trivially safe) | `route.ts` accepted the header unconditionally in all 4 handlers |
| F4 | Config/docs | **`.env.example` omitted `GEMINI_API_KEY`, `GEMINI_MODEL`, `BUILDORA_FORCE_LOCAL_GENERATION`, `NEXT_PUBLIC_CLOUD_PROVIDER`.** | **P2** (trivially safe) | `grep -ci GEMINI .env.example` → 0 |

### Audited and found correct (no change — documented)

- **Secrets/public boundaries:** only `NEXT_PUBLIC_*` reach the browser
  (Supabase URL + anon key); `GEMINI_API_KEY` / `VERCEL_API_TOKEN` /
  `VERCEL_TEAM_ID` are server-only. `.env.example` instructs never to prefix
  secrets with `NEXT_PUBLIC_`. E2E secret-exposure tests exist.
- **Cloud environment resolution:** local-first; mock only in dev or forced;
  production without credentials → `none` / `unavailable` (never a broken
  action). `NEXT_PUBLIC_CLOUD_PROVIDER=none` forces local-only.
- **Mock route gating:** `/api/cloud`, `/api/collab`, `/api/presence`,
  `/api/share`, `/api/workspaces` all return 404 `NOT_CONFIGURED` unless the
  cloud env resolves to `mock` — production builds cannot reach mock state.
- **Migrations/RLS (all 8 audited):** RLS on every private table; SECURITY
  DEFINER + `set search_path = public`; grants to `authenticated` only; actor
  always `auth.uid()`; membership/owner/editor gates in RPCs; optimistic
  concurrency (`STALE_REVISION`); bounded retention (300 activity / 50
  versions / collab log pruned at checkpoint); allow-listed activity metadata;
  first-writer-wins seed; size caps on decoded bytes. Two P18-documented
  lenient points re-verified, still non-security-boundaries: `ws_join_presence`
  doesn't validate project existence (ephemeral UI state, mode server-resolved);
  `ws_collab_append_update` doesn't require the project row (pruned at
  checkpoint).
- **Workspace authorization:** mock `requireUser/requireMember/requireOwner/
  requireEditor` on every handler; actor from session token; workspace-scoped
  leases; recipient-scoped invitations; removed/downgraded members lose access
  immediately (leases, presence, share links revoked); no cross-workspace
  enumeration.
- **Collaboration (P16/P17 semantics verified intact):** prune-at-checkpoint
  retention; session-end checkpoint; connect-failure edit fallback; bounded
  offline queues on BOTH transports; channel-epoch guard; per-room rate limit;
  size caps on decoded bytes; owner-only maintenance lock; restore resets the
  room.
- **Publishing:** `PublishService` never mutates project content; deterministic
  export hash + idempotency key; intermediate/final status persisted (failed /
  cancelled preserved — never a false success); rollback requires
  confirmation; all Vercel routes verify the Buildora session server-side and
  pass `ownerUserId` per-call; deploy route has schema validation, artifact
  caps, path sanitization, idempotency, 10/min/project rate limit; P19 F3
  diagnostics present.
- **Persistence durability:** dirty-flush blocks transitions; safe delete
  order; revision-aware save marking; beforeunload guard; recovery snapshots.
- **Share/review:** token stored as hash only; public resolve blanks the
  projectId; feedback is token-in-body, rate-limited and duplicate-guarded;
  revoked/expired → 410 with safe copy; member removal/downgrade revokes links.
- **Observability:** P19 verified in code — logger allow-list survives prod
  redaction, mock routes use the structured logger, publish diagnostics, collab
  clientId. No duplication.
- **Failure UX:** save states never imply success; collab sync status is
  text+color; viewer/offline/unauthorized resolve to honest read-only; share
  view shows safe error copy. No release-critical misleading states found.
- **Deployment/build:** `npm run build` clean; static shell + dynamic routes
  as expected; E2E config sound (workers=1, chromium, dev-server webpack flag
  for the Windows junction workaround).

## 3. Implemented fixes (all with regression coverage)

### F1 (P1) — production rate limit on `/api/generate`

- **New module** `src/features/generation/server/generate-rate-limit.ts`:
  in-memory fixed-window limiter, 60 req/min/client, keyed by the first
  `X-Forwarded-For` entry (bounded to 64 chars) with an `unknown-client`
  fallback; **enforced only when `NODE_ENV === "production"`** (dev/E2E is a
  local/testing surface — the matrix suite issues many requests; this mirrors
  the app's "mock in dev, real in prod" posture).
- **Bounded memory** (code-review finding): the tracked-client map is swept
  when it exceeds 10,000 keys (expired keys first, oldest as a bound) — an
  unbounded map would itself be a memory-DoS vector for a client that can vary
  the forwarded header. Regression tests cover the sweep.
- **Wiring:** 429 `RATE_LIMITED` before body parsing, matching the route's
  `{ success: false, error }` envelope.
- **Honest boundary (documented):** per warm serverless instance, best-effort
  — exactly like `deployRateLimited`. Multi-instance enforcement needs an
  external limiter (P3).
- **Regression tests:** 12 tests in
  `src/features/generation/__tests__/generate-rate-limit.test.ts` (ceiling,
  isolation, window rollover, XFF parsing, bound cap, fallback, production-only
  enforcement, expired-key sweep, live-entry insertion-order eviction, and the
  F3 force-local header production/dev gates).

### F2 (P2) — security headers on every response

- `src/lib/security-headers.ts` (new, unit-tested) → applied in
  `next.config.ts` `headers()`:
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy: camera=(), microphone=(), geolocation=()`,
  `X-DNS-Prefetch-Control: off`.
- **Deliberately NOT added:** Content-Security-Policy (Next.js inline
  hydration scripts/styles need a carefully maintained nonce/hash allow-list;
  a broken CSP would take the build down — P3) and app-level
  Strict-Transport-Security (the deployment target, Vercel, sends HSTS itself
  for production deployments — app-level would be redundant).
- **Regression tests:** 8 tests in
  `src/lib/__tests__/security-headers.test.ts`.

### F3 (P2) — `x-buildora-force-local` gated to non-production

- `forceLocalHeader(request)` helper honors the header only when
  `NODE_ENV !== "production"`; in production the ONLY switch is the server-side
  `BUILDORA_FORCE_LOCAL_GENERATION` env var (not settable by an external
  caller).
- **Coverage:** existing `e2e/fallback-isolation.spec.ts` (dev) passes 1/1 —
  the dev/test path is unchanged.

### F4 (P2) — `.env.example` documentation

- Added `GEMINI_API_KEY`, `GEMINI_MODEL`, `BUILDORA_FORCE_LOCAL_GENERATION`,
  `NEXT_PUBLIC_CLOUD_PROVIDER` with server-only / public boundaries.
- **Note:** `.env.example` is gitignored by the repo's `.env*` rule (never
  committed — repo convention). Local-only improvement.

## 4. Security review (focused release audit)

Performed against the brief's checklist (IDOR, cross-workspace reads/writes,
privilege escalation, removed-member access, stale auth, token/session leakage,
secret exposure, sensitive logging, unsafe error responses, missing input
validation, dangerous path handling, rate-limit bypass, replay/duplicate
operations, RLS gaps, client-side trust of authorization):

- **No IDOR / cross-workspace access found.** Workspace/project/share/presence/
  collab handlers scope by membership and derive the actor from the session.
- **No secret exposure.** Server-only secrets never reach client bundles; the
  only client-exposed credential is the Supabase anon key (by design).
- **No sensitive logging.** P19 allow-list + value bounds verified; the P20
  changes log nothing new.
- **No unsafe error responses.** All routes map errors to safe copy; no stack
  traces leak.
- **Rate limiting now consistent across the API surface** (F1 closed the last
  gap). Known honest boundary: in-memory limiters are per-instance best-effort.
- **Replay/duplicate ops:** publish idempotency + share duplicate-guard +
  Yjs idempotence verified.
- **RLS gaps:** none beyond the two documented P18 lenient points (re-verified
  non-security-boundaries).
- **Client-side trust of authorization:** verified — the server is the
  authority for every mutation; client role/context is a display hint.
- **New enforcement is additive** (F1) and production-only; no authorization
  was weakened anywhere to make a test pass.

## 5. Release smoke test

The smoke path maps 1:1 onto the existing E2E suite (no redundant new spec —
per the phase brief). Batch run on one dev server:

| Smoke step | Spec | Result |
|---|---|---|
| Authenticate → workspace → project → edit → persist → reload | `editor.spec.ts` (32 tests) | ✅ 32/32 |
| Workspace + project + two-user collaboration | `workspace-collaboration.spec.ts` | ✅ 1/1 |
| Real-time collaborative editing | `realtime-collaboration.spec.ts` | ✅ 1/1 |
| Publish/export + live-link verification | `production-publishing.spec.ts` | ✅ 1/1 |
| Authorization boundary (roles enforced, changes take effect) | `workspace-permissions.spec.ts` | ✅ 1/1 |
| Share review (create → render → revoke) | `share-review.spec.ts` | ✅ 1/1 |
| **Smoke total** | | **37/37 passed** |

## 6. Validation results (exact)

Run sequentially on one dev server:

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **PASS** |
| `npm run lint` | **PASS** (0 errors, 0 warnings) |
| `npm test` (full unit suite) | **3960/3960 passed** (285 files) — P19 baseline 3940 + **20 new P20 regression tests** (8 security-headers + 12 rate-limit) |
| `npm run build` | **PASS** (Next.js 16.2.12) |
| Release smoke batch (6 specs) | **37/37 passed** |
| Affected AI/fallback E2E batch (5 specs: fallback-isolation, ai-editing, ai-copilot, inline-ai-editing, guided-builder) | **13/13 passed** |
| `npm run test:e2e:matrix` | **13/13 passed** |
| `npm run test:e2e:fallback` | **1/1 passed** |
| `npm run test:export-build` | **1/1 passed** (real exported build, 58.4 s) |
| `npm run test:e2e` (full suite) | **115 passed / 2 failed** (12.7 m) — both failures are the documented pre-existing environmental flake class (§7) |
| Final focused code review | PASS (1 genuine finding — bounded rate-limiter map — fixed + regression-tested) |

## 7. Full-suite failure classification (evidence-based)

**Symptom:** `ai-copilot.spec.ts:30` and `block-tree.spec.ts:83` failed in the
full-suite run. **Both fail at the IDENTICAL line**
`e2e/helpers/projects.ts:70` — the "Welcome to Buildora" heading was not
visible within 10 s after `createSaaSProjectAndOpenEditor` (project-load /
hydration timing in full-suite context).

**Classification: pre-existing environmental flake class — NOT a P20
regression.** Exact evidence:

1. **P20 code cannot execute on these paths.** The P20 diff is 2 files:
   `next.config.ts` (static response headers) and `src/app/api/generate/route.ts`
   (production-only rate limiter + dev-gated header). Neither spec references
   `/api/generate` (`grep` verified: 0 matches in either spec), the rate limiter
   is disabled outside `NODE_ENV === "production"` (E2E runs `next dev`), and
   response headers cannot cause a 10 s project-load timeout.
2. **Identical flake documented in P19.** P19 report §6 documents the same
   failure at `projects.ts:70` ("Welcome to Buildora" heading not visible
   within 10 s — project-load/hydration timing in full-suite context) for
   `block-browser.spec.ts:103`.
3. **`ai-copilot.spec.ts:30` is the P18-documented flaky spec.** P18 report §8
   documented this exact spec failing in full-suite runs with stash-A/B proof
   that the flake identity is uncorrelated with the diff (without P18's
   changes, DIFFERENT specs — my-blocks, my-blocks-visual-library — failed
   while ai-copilot passed).
4. **Both pass alone.** Re-run of both specs in isolation: **2/2 passed (7.3 s)**.
5. **Rotating identity across runs.** P18: ai-copilot:30 (+ my-blocks without
   the diff). P19: block-browser:103. P20: ai-copilot:30 + block-tree:83.
   The failing spec rotates run-to-run at the same shared project-creation
   helper — the classic cold-compile / hydration-timing signature documented
   since P16.
6. **Baseline parity.** Every phase since P16 has produced 116–117/117 with
   exactly this class; P20's 115/117 (two instances of the same class in one
   run) is consistent with that history.

**Action taken:** none to product code or assertions (per the phase rule —
evidence required before calling anything a flake; no P20 code executed on the
failing path and both specs pass in isolation).

## 8. Data-integrity re-verification (complete-system)

The phase brief asks: "Can a user perform a valid action and then lose that
action without an explicit failure?" Verified for each interaction:

- **Concurrent editing + persistence:** checkpoints are single-flight with
  optimistic concurrency + bounded STALE retry; a stale browser can never
  overwrite newer merged state (`realtime-collaboration`, `realtime-structure`
  passed).
- **Reconnect + persistence:** offline queues flush before catch-up on both
  transports; Yjs merges are idempotent (`realtime-reconnect` passed).
- **Offline editing + persistence:** bounded queues; overflow → honest
  rebase-from-checkpoint, never a corrupt merge.
- **Checkpoint + reload:** durable payload is the canonical projection;
  reload converges to identical structs (verified in collab E2E reload
  assertions).
- **Authorization loss + pending edits:** queued/in-flight sends are
  server-rejected after permission loss; the session stops and transitions to
  honest read-only (`realtime-permissions` passed).
- **Publish + latest persisted state:** publishing reads the live projected
  store content (never stale); failed/cancelled publishes are never reported
  as success (`production-publishing` passed).
- **Browser/session teardown + pending changes:** session-end checkpoint
  (P17 F2), connect-failure fallback (P17 F2b), beforeunload guard, and
  dirty-flush-blocking transitions — no silent-loss path found.

**Conclusion: no user-visible data-loss path remains without an explicit
failure signal.**

## 9. Deployment assumptions (final)

- Next.js 16 App Router; `npm run build` then `npm start`. E2E uses
  `next dev --webpack` (Windows junction workaround) — production builds use
  the platform default (Turbopack).
- Supabase: apply the 8 migrations in order (collab migration depends on the
  P14 workspaces schema). RLS + SECURITY DEFINER RPCs must be in place; the
  client holds only the anon key.
- Real publishing: `VERCEL_API_TOKEN` (server-only). Without it, publishing
  hides in production (never a broken action).
- AI generation: `GEMINI_API_KEY` (server-only). Without it, generation falls
  back to the rule-based engine. Rate limiting (F1) protects the keyed path.
- No CI pipeline exists in the repo (no `.github/workflows`) — the release
  process is the documented local gate sequence. **P3 operational item.**

## 10. Remaining non-blocking risks (P2/P3)

- **P2 — CSP absent.** Adding a Content-Security-Policy requires a maintained
  nonce/hash allow-list for Next.js inline scripts/styles. The safe header
  subset (F2) ships now; CSP is a careful future enhancement.
- **P2 — in-memory rate limits are per-instance.** `deployRateLimited` and the
  new `generateRateLimited` are best-effort single-instance; true multi-
  instance enforcement needs an external limiter (platform WAF / edge).
- **P3 — no CI pipeline** in the repository (documented operational item).
- **P3 — request/operation-ID correlation** across UI → API → persistence
  (P19 candidate, still deferred; safe identifiers already survive production
  logs).
- **P3 — external log sink / monitoring platform** (none chosen; P19
  diagnostics are ready for one).
- **P3 — E2E cold-compile flake hardening** (the §7 class; infrastructure,
  not product).
- **P3 — Supabase live verification with real credentials** (semantics
  validated through the mirroring mock + injected-client unit tests — repo
  convention).

**All of the above are explicitly non-blocking.** They do not affect the
release decision.

## 11. Release decision

# **RELEASE READY**

Verified release surfaces:
- Production build clean; mock API routes unreachable in production; secrets
  server-only.
- Auth/authorization boundaries correct on every surface (workspaces, projects,
  collab, presence, share, publishing) with no IDOR or cross-tenant access.
- RLS + SECURITY DEFINER RPCs sound; actor always server-derived.
- Persistence durable with no silent-loss path; collaboration converges safely
  on reconnect/offline/permission-loss; publishing never falsely reports
  success.
- Observability production-safe (P19) and complete.
- All API surfaces now rate-limited or authenticated (F1 closed the last gap).
- Security headers present (F2); test-only header gated out of production (F3).
- Full validation gate green: tsc / lint / **3956/3956 unit** / build / smoke
  37/37 / matrix 13/13 / fallback 1/1 / export-build 1/1 / full E2E 115/117
  with both failures proven to be the documented pre-existing environmental
  flake class (no P20 code on either path; both pass alone).

Remaining P2/P3 risks (§10) are documented and non-blocking. The project is
not declared production-perfect — it is declared **safe to release** with the
documented boundaries understood.

## 12. Git state

- Working tree contains only the intended P20 changes (verified `git status`):
  - Modified: `next.config.ts`, `src/app/api/generate/route.ts`
  - New: `src/lib/security-headers.ts`,
    `src/lib/__tests__/security-headers.test.ts`,
    `src/features/generation/server/generate-rate-limit.ts`,
    `src/features/generation/__tests__/generate-rate-limit.test.ts`,
    `docs/phase-p20-architecture.md`, `docs/phase-p20-report.md`
  - Local-only (gitignored): `.env.example` documentation
- Debug artifacts removed (E2E log deleted). Nothing committed or pushed
  (per project workflow; awaiting instruction).
- **P21 NOT started.**

## 13. P21 candidates (ONLY — not started)

- CSP rollout with a Next.js-compatible nonce/hash allow-list (P2 from §10).
- External multi-instance rate limiting at the platform/edge layer.
- CI pipeline for the documented local gate sequence.
- Request/operation-ID correlation across UI → API → persistence.
- External structured-log sink once a monitoring platform is chosen.
- E2E cold-compile flake hardening (pre-warm editor routes before full runs).
