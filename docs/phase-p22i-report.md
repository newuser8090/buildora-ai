# Phase P22-I — AI Page/Site Generation (Report)

> Baseline: P22-A through P22-H complete and validated (see their reports).
> P22-I delivers **multi-page AI site generation** through the existing
> generation pipeline: a prompt produces a 2–6 page site (pages + cross-page
> navigation + per-page sections + one shared theme), deterministically via
> the rule-based site templates or via Gemini with template-completed output,
> validated by the extended `GenerationPlanSchema`, loaded through the
> existing project factory, and exported through the existing multi-page
> export pipeline.
> **P22-A through P22-H remain closed. P22-J has not been started.**

---

## 1. What was implemented

- **Site plan model** — `GenerationPlan.pages?: PlannedPage[]` (title, slug,
  sections) added to `types/generation-plan.ts`; `PlannedPageSchema` +
  `pages` (min 2 / max 6) added to `schemas/generation-plan-schema.ts`,
  with slugs validated through the existing `validateSlug` routing rules.
  Single-page create plans are unchanged.
- **Deterministic site templates** — new `templates/site-templates.ts` with
  one canonical 4–5 page bundle per supported website type (SaaS,
  E-commerce, Restaurant, Portfolio, Agency); homepage-first, unique routing
  slugs, header/footer shell per page, cross-page navLinks, brand-injected,
  no random ids/timestamps.
- **Conservative site-intent detection** — `detectSiteIntent()` +
  `analyzeSitePrompt()` in `analyzers/prompt-analyzer.ts`. Clear multi-page
  signals (multi-page, page hints, "website with …", N-pages) flip a create
  prompt into site generation; every established create prompt
  (prompt-matrix set, fallback-isolation prompt) stays single-page.
- **Rule-based provider** — `mode:"site"` routes to the deterministic site
  analyzer with per-page section normalization; fully usable without Gemini.
- **Gemini provider** — dedicated site system instruction (JSON-only, 2–6
  pages, homepage `/`, header/footer, one theme, no code) plus
  template-merge completion: Gemini content enriches the canonical template
  skeleton; invalid output degrades to the template; final plan re-validated
  by Zod. Create path untouched.
- **Project generator** — multi-page branch: `pages[0]` homepage owns `/`,
  unique validated slugs, deterministic ids, per-section `AnySectionSchema`
  validation, one shared theme, 6-page cap. Single-page path unchanged.
- **API route** — `mode:"site"` accepted; server-side `detectSiteIntent` on
  create requests; provider mode threaded through Gemini→rule-based fallback;
  rate limiter / body cap / prompt cap / forceLocal all reused.
- **Summary** — site-aware assistant message ("Created a 5-page SaaS website
  for Acme: Home, Features, Pricing, About, and Contact."); single-page
  summaries byte-identical.
- **E2E + export-build** — new `e2e/ai-site-generation.spec.ts`; the
  export-build integration test now builds a generated multi-page site.

---

## 2. Files / components changed

**P22-I additions on the pre-existing P22-A–H working tree:**

**Extended (10):**

- `src/features/generation/types/generation-plan.ts` — `PlannedPage` +
  `GenerationPlan.pages`
- `src/features/generation/schemas/generation-plan-schema.ts` —
  `PlannedPageSchema`, `SITE_MIN_PAGES`/`SITE_MAX_PAGES`, optional `pages`
- `src/features/generation/analyzers/prompt-analyzer.ts` — `detectSiteIntent`,
  `analyzeSitePrompt`
- `src/features/generation/providers/generation-provider.ts` — `mode` union
  `"site"`
- `src/features/generation/providers/rule-based-generation-provider.ts` —
  site mode + per-page normalization
- `src/features/generation/providers/gemini-generation-provider.ts` — site
  instruction, site parsing + template merge, `buildSitePlan`
- `src/features/generation/generators/project-generator.ts` —
  `generateSiteProject` + helpers (multi-page branch)
- `src/features/generation/services/generation-service.ts` — site summary +
  plan pages reconstruction
- `src/app/api/generate/route.ts` — `mode:"site"` + server-side intent
  detection
- `src/features/export/__tests__/export-build.test.ts` — single-build test
  covering the generated multi-page site + asset export (see §5 for the
  timeout/cleanup root-cause fix)

**New (9):**

- `src/features/generation/templates/site-templates.ts`
- `src/features/generation/schemas/__tests__/site-plan-schema.test.ts`
- `src/features/generation/templates/__tests__/site-templates.test.ts`
- `src/features/generation/analyzers/__tests__/site-prompt-analyzer.test.ts`
- `src/features/generation/providers/__tests__/rule-based-site-provider.test.ts`
- `src/features/generation/generators/__tests__/site-project-generator.test.ts`
- `src/app/api/generate/__tests__/site-route.test.ts`
- `e2e/ai-site-generation.spec.ts`
- `docs/phase-p22i-architecture.md` (this phase's architecture doc)

**Documentation:** `docs/phase-p22i-architecture.md`, `docs/phase-p22i-report.md`

---

## 3. Validation gates and exact results

| Gate | Result |
|---|---|
| TypeScript (`npx tsc --noEmit`) | ✅ passed (exit 0) |
| Lint (`npm run lint`) | ✅ 0 errors — 1 warning, PRE-EXISTING (P22-H's `e2e/ai-element-editing.spec.ts:310` unused `reviewAndApply`) |
| Unit (`npx vitest run`) | ✅ **4,655 tests passed** (337 files; 4,611 P22-H baseline + **44 new** P22-I tests) |
| Production build (`npm run build`) | ✅ passed |
| Export-build (`npm run test:export-build`) | ✅ passed (single build, ~319s) |
| P22-I E2E (`e2e/ai-site-generation.spec.ts`) | ✅ **1/1 passed** |
| AI regression suite (8 specs) + P22-I spec | ✅ **23/23 passed** |

---

## 4. E2E results

`npx playwright test ai-site-generation --workers=1 --reporter=line` → **1/1
passed (~4 min incl. dev-server start).**

The spec drives the **real generation pipeline** (server-side rule-based via
the `x-buildora-force-local` header, matching the fallback-isolation
convention) and covers: prompt → 5-page site → five PageTabs → homepage `/`
with home indicator → cross-page nav labels in the header → navigate between
pages (Features/Pricing/About/Home render their content) → save + reload
persistence → export ZIP with `app/page.tsx` + one `app/<slug>/page.tsx` per
page → resolved cross-page hrefs inside the exported pages.

The generated project is re-keyed to the editor URL's project id in the mocked
response — the same harness convention P22-H uses — so save+reload persists to
the project the URL points at. Product code is untouched.

**First-run classification:** the only failure on the first run was an E2E
SPEC helper bug (the ZIP helper keyed page files by absolute path while the
ZIP root carries a project-folder prefix) — a test-only fix; the full product
flow passed on the rerun.

---

## 5. Export-build: root cause + fix (Windows)

**Symptom:** the new generated-multi-page export test failed — first with
`ENOTEMPTY` during Windows temp-dir cleanup, then with `Test timed out in
180000ms` — even though both `npm install` and `npm run build` completed.

**Diagnosis (measured with temporary instrumentation):** on this Windows
environment a fresh temp-dir `npm install` is **network-bound (~275s)**,
`npm run build` ~20s, and deleting the resulting `node_modules` ~90s — one
full install+build+cleanup cycle is **~380s**, i.e. beyond the previous 180s
per-test budget. Two cycles (the pre-existing assets test + the new
multi-page test) made the gate both flaky and ~12 minutes long.

**Fix (test harness only — no production code changed):**

- Merged the two tests into **ONE** full `npm install` + `npm run build`
  cycle on the generated multi-page site; the asset-export assertions are
  pure export-file checks and now run statically alongside it (same coverage,
  one build, deterministic gate).
- Raised the per-command timeout (`COMMAND_TIMEOUT_MS`) to 480s and the
  per-test timeout to 600s, with comments documenting the measured times.
- Kept the Windows-safe `removeDirWithRetry` cleanup (ENOTEMPTY-tolerant;
  cleanup failure never fails the gate).

Result: `npm run test:export-build` → **1 test passed in 319s** (install +
build + cleanup on the generated multi-page site; `.next/build-manifest.json`
asserted; one route per page asserted).

---

## 6. Security / validation evidence

- Site plans validated by the extended `GenerationPlanSchema` at the provider
  boundary; invalid Gemini output degrades to the deterministic template or
  triggers the existing rule-based fallback — the AI never writes
  unvalidated data.
- Every generated section passes the existing per-type `AnySectionSchema`
  validation; the generated project passes `ProjectSchema`.
- Slugs validated through the existing `validateSlug` routing rules
  (homepage owns `/`; lowercase/hyphen segments; no reserved segments);
  cross-page hrefs resolved through the existing `resolveInternalHref` at
  export (no `javascript:`/unsafe schemes).
- Rate limiter, `MAX_PROMPT_LENGTH`, `MAX_REQUEST_BYTES`, `sanitizePrompt`,
  and the `forceLocal` escape hatch all reused unchanged; no new endpoint.
- No executable payloads, no element trees, no new client-trusted inputs,
  no persistence/normalizer/serializer/collaboration/Supabase changes.

---

## 7. No new dependencies

No runtime or dev dependencies were added. `package.json` untouched. P22-I
uses existing libraries only (Zod, React, Vitest, Playwright, JSZip in E2E).

---

## 8. No scope expansion / no reopened phases

- Site generation is a **generation mode** — no edit-plan/review UI, no new
  composer scope, no project-modification behavior (D4/D5).
- No durable `Project.collections`, no binding resolver — **P22-J was not
  preempted** (D3). "Basic collections" = collection-style static content.
- Props-based sections only — no element trees, no renderer changes (D6).
- String-href navigation — no P22-G `NavTarget` (D8/D9).
- **P22-A through P22-H remain closed** — none were reopened, refactored, or
  weakened. **P22-J and P23 have not been started.**

---

## 9. Known limitations

- Site-intent detection is deliberately conservative: only clear multi-page
  signals trigger site generation; a bare "ecommerce website" prompt still
  produces the existing single-page output (by design — D2).
- Gemini site output is merged onto the deterministic template skeleton
  (template pages/slugs win structurally); the richest deterministic behavior
  is the rule-based path, which is what the E2E and export-build gates
  exercise.
- `.next/dev/types` (Next.js dev-server generated output) can trip `tsc`
  against the pre-existing `boundedErrorToken` route export after a `next
  dev` run; clearing the regenerable `.next/dev/types` restores the green
  gate (pre-existing condition, unrelated to P22-I).
- The export-build gate is network-bound on Windows (`npm install` ~4.5 min
  measured); it is a single-build test with a documented 600s budget.

---

## 10. Final P22-I status

**P22-I COMPLETE.**

- Implementation: ✅ PASS (extended generation pipeline only; no production
  code outside the P22-I surface)
- Unit: ✅ 4,655 tests passed (44 new)
- Build: ✅ production build passed
- Export-build: ✅ passed (single build, 319s)
- P22-I E2E: ✅ 1/1 passed
- AI regressions: ✅ 23/23 passed (8 AI specs + P22-I spec)
- Docs: ✅ `docs/phase-p22i-architecture.md` + `docs/phase-p22i-report.md`
- Dependencies: ✅ NONE
- P22-A through P22-H: ✅ remain CLOSED
- P22-J: ✅ not started / not preempted

**P22-I CLOSED.**
