# Phase P22-I — AI Page/Site Generation (Architecture)

> Buildora AI — Canva-style AI website builder. P22-I delivers **multi-page AI
> site generation**: a single prompt ("build a multi-page SaaS website for
> Acme with features, pricing, about, and contact pages") produces a complete
> multi-page `Project` — pages, cross-page navigation, per-page sections and
> one shared theme — through the **existing generation pipeline and project
> factory**, with the **existing rule-based fallback** and **existing export**.
>
> **Baseline:** P22-A through P22-H complete and validated (see their reports).
> **Boundary:** `P22-A through P22-H remain closed. No P22-J or P23 work.`

---

## 1. P22-I objective and authoritative scope

Per the master P22 architecture (`docs/phase-p22-architecture.md` §24):

> **P22-I — AI page/site generation** — *"`mode:"site"` generation (pages +
> nav + sections + basic collections); page generation consistent with
> theme"* — exit criteria *"E2E generation; export-build"*.

The gap table (§11, L8) rated this **High**: `mode:"create"` builds one
landing page (`pages[0]`); there was no site-level "build me a website with
pages/nav" generation. §16 adds: *"a new `mode:"site"` plan produces pages +
sections + navigation + a basic data model (collections) through the existing
project factory + templates; each generated page uses existing page CRUD."*
§25 places the surface entirely in `generation/`, `api/generate/route.ts`,
`generation/types/generation-plan.ts` and `templates/*`.

### Approved decisions (binding)

| # | Decision | Content |
|---|---|---|
| D1 | Site plan shape | Extended `GenerationPlan` transient plan with `pages: PlannedPage[]` (title + slug + sections); ONE generation pipeline, ONE Zod boundary |
| D2 | Site intent | Server-side intent detection on ordinary `create` requests; explicit `mode:"site"` also supported; ordinary landing-page prompts keep single-page create behavior |
| D3 | Collections | **No durable `Project.collections`.** "Basic collections" = collection-style static content built from existing sections (products/menu/pricing). P22-J owns the durable collections model + binding resolver |
| D4 | UI | No new composer scope — the existing Create Website flow is reused unchanged |
| D5 | Input | Fresh site generation from the user's prompt; no project-modification behavior |
| D6 | Rendering | Existing props-based sections; **no element trees**, no renderer changes |
| D7 | Theme | ONE shared theme across the whole generated site |
| D8 | Navigation | Plain string hrefs (`/`, `/about`, `/pricing`) validated by the existing routing/link-safety conventions; no P22-G `NavTarget` |
| D9 | Nav scope | Header/footer cross-page navigation + valid slugs; no nested-route expansion |

---

## 2. Scope boundaries (approved, binding)

**IN:**

- Multi-page AI site generation, 2–6 pages
- Per-page sections from the existing section vocabulary
  (header/hero/features/pricing/faq/cta/footer)
- Cross-page navigation (string hrefs, routing-validated)
- One shared theme per site
- Deterministic rule-based site templates + Gemini site provider + fallback
- Extended `GenerationPlanSchema` (transient plan only)
- E2E generation coverage + export-build coverage of a generated multi-page site
- Site-aware generation summary

**OUT:**

- Durable `Project.collections`, data binding, binding resolver (P22-J)
- Supabase / persistence / normalizer / serializer / collaboration changes
- New AI providers, new endpoints, new dependencies, new persistence fields
- P22-H element AI editing, P22-A element model changes, P22-G `NavTarget`,
  P22-F responsive intelligence
- Canvas / inspector / editor-store changes
- Any reopening of P22-A through P22-H

---

## 3. Existing pipeline reused (unchanged contract)

P22-I extends the create-mode generation pipeline; every stage is reused
unchanged except where explicitly extended:

```
prompt (composer, mode "create")
  → POST /api/generate
  → route: site intent? (explicit mode:"site" OR detectSiteIntent(prompt))
  → provider mode "site": geminiProvider | ruleBasedProvider
  → GenerationPlanSchema (Zod) — now with optional bounded pages
  → generateProject(plan) — multi-page branch when plan.pages present
  → ProjectSchema + per-section AnySectionSchema validation (all pages)
  → initProject → PageTabs renders every page
```

The client keeps sending `mode:"create"` (D4). The server decides site-vs-create
(D2). Ordinary prompts ("Build a dark SaaS website for Huddle") produce exactly
the previous single-page output.

---

## 4. Site plan model (transient)

`src/features/generation/types/generation-plan.ts`:

```ts
interface PlannedPage {
  title: string;
  slug: string;          // "/" for the homepage, "/about" etc. otherwise
  sections: PlannedSection[];
}

interface GenerationPlan {
  websiteType: WebsiteType;
  brandName: string;
  theme: ThemeStyle;
  sections: PlannedSection[];   // unchanged (homepage sections; schema compat)
  pages?: PlannedPage[];        // P22-I — present only for site generation
}
```

`src/features/generation/schemas/generation-plan-schema.ts`:

- `SITE_MIN_PAGES = 2`, `SITE_MAX_PAGES = 6`
- `PlannedPageSchema` — non-empty bounded title, slug validated through the
  existing `validateSlug` routing rules (root `/`, lowercase/hyphen segments,
  no reserved segments), ≥1 section per page
- `GenerationPlanSchema.pages` — optional array, min 2 / max 6
- Single-page create plans (no `pages`) remain valid unchanged

No durable project field was added (D3).

---

## 5. Deterministic site templates

`src/features/generation/templates/site-templates.ts` — **new**.

One canonical multi-page bundle per supported website type:

| Type | Pages |
|---|---|
| SaaS | Home, Features, Pricing, About, Contact |
| E-commerce | Home, Shop, About, Contact |
| Restaurant | Home, Menu, About, Contact |
| Portfolio | Home, Projects, About, Contact |
| Agency | Home, Services, About, Contact |

Guarantees:

- Deterministic — no random ids, no timestamps, no runtime-dependent output
- Homepage first with slug `/`; unique routing-valid non-root slugs
- Every page: header (cross-page `navLinks` → real page slugs) + footer
- Only existing valid section types; orders are 1..N per page
- Brand injected by the caller (analyzer or Gemini completion path)

---

## 6. Prompt analysis — conservative site-intent detection

`src/features/generation/analyzers/prompt-analyzer.ts` — **extended** with:

- `detectSiteIntent(prompt)` — server-side detection used by the route. Signals:
  - `multi-page` / `multipage` / `multi page`
  - page-count phrases ("5 pages", "several pages", "multiple pages")
  - `website/site with` + a page-name token (about/pricing/contact/menu/…)
  - explicit page hints ("about page", "pricing page", "contact page", …)
- `analyzeSitePrompt(prompt)` — deterministic site plan from the canonical
  templates (reuses the existing keyword tables for type/theme/brand)

Deliberately conservative: the established create prompts ("Build a dark SaaS
website for Huddle", "Build a luxury restaurant website called Ember House",
the prompt-matrix set, "Build a website") all keep single-page output.

---

## 7. Rule-based provider (deterministic fallback)

`src/features/generation/providers/rule-based-generation-provider.ts` —
**extended**: `mode:"site"` routes to `analyzeSitePrompt`; every page's
sections run the same type normalization + comprehensive link/props
normalization as create. Fully usable without Gemini (the E2E and export-build
gate run through this path).

`src/features/generation/providers/generation-provider.ts` — `mode` union
extended with `"site"`.

---

## 8. Gemini provider

`src/features/generation/providers/gemini-generation-provider.ts` — **extended**
additively (create path untouched):

- `SITE_SYSTEM_INSTRUCTION` — JSON-only, 2–6 pages, homepage `/` first,
  header+footer per page, cross-page navLinks, ONE theme, no code output,
  prompt-injection resistance (same rules as create)
- Site parsing: `normalizeSiteType/Theme`, `normalizeSiteSlug` (routing rules),
  `extractSitePages` (per-page section normalization through the existing
  `extractSections`)
- **Deterministic completion**: Gemini pages are merged onto the canonical
  site template for the detected type — template provides the page/slug
  skeleton + header/footer shell, Gemini enriches content. Invalid output
  degrades to the template instead of producing an invalid plan
- Final plan re-validated with `GenerationPlanSchema`; failure → ProviderError
  → the route's existing Gemini→rule-based fallback
- Reuses `sanitizePrompt`, `callGemini`, timeout/retry, bounded logging

---

## 9. Project generator (multi-page)

`src/features/generation/generators/project-generator.ts` — **extended**
additively (single-page path unchanged):

- `generateProject(plan)` dispatches to a new `generateSiteProject` when
  `plan.pages` is present
- `pages[0]` is the homepage and always owns the root slug `/`
- Non-home slugs normalized + validated (`validateSlug`) + de-duplicated
  (`-2`, `-3`, …) — deterministic, no timestamps in ids (`page-1`…`page-N`,
  sections `page-N-<type>-<index>`)
- Every generated section runs `finalizeSectionContent` + per-type
  `validateSectionSafe` (same contract as create)
- One shared theme (`getThemeTokens`) for the whole site
- 6-page cap applied; Project persistence shape unchanged

---

## 10. API route

`src/app/api/generate/route.ts` — **extended**:

- `mode:"site"` accepted (prompt required + capped, same limits)
- Server-side `detectSiteIntent` on ordinary create requests
- Provider mode resolved once; both provider calls and the fallback receive
  `{ prompt, mode }`
- Reuses unchanged: `MAX_PROMPT_LENGTH`, `MAX_REQUEST_BYTES`, the production
  rate limiter, `forceLocal`/`x-buildora-force-local`, Gemini→rule-based
  fallback, `ProjectSchema` validation, and per-section validation across ALL
  pages (the existing `validateProjectSections` already loops every page)

No new endpoint.

---

## 11. Generation service / summary

`src/features/generation/services/generation-service.ts` — **extended**:

- `runGeneration` still posts `mode:"create"` (D4) and reconstructs the plan
  with `pages` from the response project
- `buildSummary` gains a site branch: *"I created a 5-page SaaS website for
  Acme: Home, Features, Pricing, About, and Contact."* Single-page summaries
  are byte-identical

`useGeneration`/`LeftSidebar` unchanged — the existing composer, lifecycle and
loading/error states are reused.

---

## 12. Runtime / rendering / export

- **No renderer changes.** Generated pages are props-based sections → the
  existing section registry (canvas/preview/thumbnail) and the existing export
  `page-generator` (one `app/<slug>/page.tsx` per page, cross-page href
  resolution through `resolveInternalHref`).
- **No second renderer, no parallel runtime, no raw code execution.** The site
  plan is data validated by Zod at every boundary.
- P22-F/G parity principles: **not applicable** — P22-I emits no responsive
  overrides, animations, or interactions.
- **Export-build:** the export-build integration test now builds a generated
  multi-page site (see §14).

---

## 13. Security / validation (must never bypass)

- Extended `GenerationPlanSchema` (Zod) — site plans validated at the provider
  boundary; malformed Gemini output falls back
- `ProjectSchema` + `AnySectionSchema` per section, every page (existing)
- Slugs through the existing `validateSlug` routing rules; homepage owns `/`
- Nav hrefs are plain strings; exported pages resolve them through
  `resolveInternalHref`; no `javascript:` etc. (existing link-safety)
- `sanitizePrompt` (cap + control chars) unchanged; prompt-injection
  resistance extended to the site instruction
- Rate limiter, body cap, prompt cap, `forceLocal` all reused
- No executable payloads, no element trees, no new client-trusted inputs

---

## 14. Testing strategy

- **Unit (44 new tests, 6 files):**
  - `schemas/__tests__/site-plan-schema.test.ts` — valid/invalid pages, page
    count bounds, invalid slugs, empty sections, malformed output, create compat
  - `templates/__tests__/site-templates.test.ts` — every type, determinism,
    homepage-first unique slugs, header/footer shell, nav→generated pages,
    plan-schema validity
  - `analyzers/__tests__/site-prompt-analyzer.test.ts` — site intent detected,
    ordinary create prompts stay single-page (incl. the prompt-matrix set),
    type/brand extraction
  - `providers/__tests__/rule-based-site-provider.test.ts` — deterministic,
    schema-valid, every type, create-mode regression
  - `generators/__tests__/site-project-generator.test.ts` — multi-page, homepage
    `/`, unique slugs, section validation, shared theme, deterministic ids,
    single-page regression, 6-page cap
  - `app/api/generate/__tests__/site-route.test.ts` — mode:"site", server-side
    intent detection, create regression, Gemini→rule-based fallback, invalid
    modes/limits, rate limiter reuse
- **E2E:** `e2e/ai-site-generation.spec.ts` — real pipeline (force-local →
    rule-based), 5 page tabs, homepage `/`, cross-page nav, page navigation,
    save+reload persistence, export ZIP one route per page + resolved hrefs
- **Export-build:** `export-build.test.ts` builds a generated multi-page site
  (single install+build cycle) and verifies routes + assets statically

---

## 15. Dependencies on P22-A through P22-H

| Phase | Required? | Why |
|---|---|---|
| P22-A–D | No | No element-model/editor dependency (props-based sections) |
| P22-E | Yes | Multi-page CRUD, slug rules, homepage policy, PageTabs — reused unchanged |
| P22-F/G/H | No | No responsive/interaction/NavTarget/element-AI output |

**No prior phase is reopened.** P22-I only extends the `generation/` feature,
the `/api/generate` route, and their tests.

---

## 16. Final architecture decisions

1. Site generation is a **generation-mode**, not an edit-plan: immediate,
   atomic, undoable project load via `initProject` (no review UI).
2. One pipeline, one Zod boundary; the plan is transient, never stored.
3. Template-first: the deterministic site templates are canonical; Gemini
   enriches, rule-based is the fully-usable fallback.
4. Server-side intent detection keeps the composer (and all existing create
   UX/E2E) unchanged.
5. Generated output is standard multi-page `Project` JSON — existing
   persistence, routing, preview, and export consume it unchanged.

---

**P22-I architecture complete. See `docs/phase-p22i-report.md` for
implementation + validation results.**
