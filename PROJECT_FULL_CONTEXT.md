# PROJECT_FULL_CONTEXT.md — Buildora AI

**Purpose:** a single, self-contained technical context document for anyone (human or agent) picking up Buildora AI cold.
**Repository:** `buildora-ai` · **Branch:** `phase-p22-canva-elements` · **Checkpoint:** `d9ddb42` — *feat: implement durable universal element trees (P24-B)*
**Generated:** 2026-09-19 · **Read-only investigation:** no existing source file was modified to produce this document; it is the only file added.

### Verification basis

Everything below is drawn from the repository itself:

| Source | Used for |
|---|---|
| `docs/roadmap.md`, `docs/architecture.md`, `docs/product-experience.md`, `docs/registries.md`, `docs/security.md`, `docs/product-quality-checklist.md` | product/architecture intent |
| `docs/phase-p5-report.md` … `docs/phase-p22-report.md`, `docs/phase-p22a…p22k-architecture/report.md`, `docs/phase-p23-architecture.md`, `docs/phase-p23-report.md`, `docs/phase-p24b-report.md` (67 docs total) | phase chronology and shipped scope |
| `src/types/{project,section,theme}.ts`, `src/features/editor/schemas/section-schemas.ts`, `src/features/elements/{types,schemas/*,registry/*,engine/*,serialization/*,adapters/*}` | current data model |
| `package.json`, `vitest.config.ts`, `playwright.config.ts`, `src/app/**`, `src/features/**` | tech stack and folder layout |
| `git log`, `git status`, `git rev-list --left-right --count origin/…HEAD` | exact checkpoint state |

Where a statement is a reconstruction (e.g. P1–P4, which have no report document) it is labelled **[reconstructed]**.

---

# 1. CORE VISION & PRODUCT SPEC

## 1.1 What Buildora AI is

Buildora AI is a **visual, AI-first, Canva-style website builder** that runs as a Next.js web app. A user describes a brand/site in natural language, an AI (or a deterministic rule-based engine) generates a complete multi-page site, and the user then edits it visually on a freeform canvas — selecting, moving, resizing, rotating and styling individual elements — before publishing, exporting, or sharing it.

The product arc, as evidenced by the docs, is:

1. **Generate** — prompt → `GenerationPlan` → validated `Project` JSON (whole-site, single-section edits, page-level plans, and a chat copilot).
2. **Design** — a Canva-style editor: drag/resize/rotate, a universal styling inspector, an element library, responsive breakpoints, interactions and animations.
3. **Collaborate / distribute** — cloud sync, team workspaces, real-time Yjs collaborative editing, read-only share links, template packages, personal templates.
4. **Ship** — static Next.js site export (ZIP) and real publishing to Vercel with custom domains, deployment history and rollback.

The organising metaphor in the codebase is **"LEGO"**: a generic document model (`Project → Page → Section → tree`), a registry-based renderer (type string → component), and a validated, data-only element tree that flows unchanged through editor, preview, thumbnail, collaborator, and export.

Positioning quotes from the repository:

- `docs/roadmap.md` Sprints 1–5 describe the foundation: *"Generic project model (Project → Page → Section)"*, *"Section Registry for dynamic component resolution"*, *"Rule-Based Generation Engine"*.
- `docs/phase-p22-architecture.md` §24 non-goals: *"full freeform absolute-positioned design as the default (flow-first)"*, *"custom-code execution (deferred)"*.
- `docs/phase-p23-report.md` §8: custom-code authoring is scoped to *"the curated leaf blocks … inside `custom-block` sections"*; *"Broader authoring (any element, any section) is **P24** work once durable universal element trees exist."*

## 1.2 How manipulation works (drag / resize / rotate / style / edit)

The manipulation layer is **pointer-event based, data-only, and single-history-entry per gesture**. There is no third-party manipulation engine; `@dnd-kit` is used only for list/file-style drags (element library → canvas, panel reordering).

**Geometry is data on the node.** `ElementNode.geometry` (`src/features/elements/types.ts`) holds `{ mode: "flow" | "absolute", x?, y?, width?, height?, rotation?, zIndex? }`. Flow mode ignores `x/y` (responsive-safe default); absolute mode uses them. Every geometry write goes through the validated ops engine (`updateElementGeometry` → `applyElementOperation`).

**The canvas pipeline (P22-B):**

```
Canvas.tsx (browser frame, viewport, zoom, theme CSS vars)
  └─ ElementRenderer / BlockRenderer  (one renderer for editor, preview, thumbnail, export)
       └─ SelectionOverlay.tsx        (bounding box, 8 resize handles, rotation handle, floating toolbar)
            └─ CanvasManipulationLayer.tsx  (pointer capture, drag/resize/rotate gestures)
                 └─ useCanvasManipulation.ts + src/features/canvas/engine/*
                      (coords.ts, transform.ts, geometry.ts, snap.ts, align.ts, layering.ts,
                       selection.ts, clipboard.ts, batch.ts, shortcuts.ts)
```

- **Move / resize / rotate** — pointer events with rAF throttling; the gesture resolves to a geometry patch through `canvas/engine/transform.ts` + `snap.ts`/`align.ts`, then commits via the store (`updateElementGeometry`) as **one undo entry** and (in a collaborative session) one reconcile transaction.
- **Resize honours the registry `resizePolicy`** (`none | fixed | fluid`) declared per element definition.
- **Selection** — section-level (`selectedSectionId`) plus element-level selection overlays; `canvas/engine/selection.ts` owns hit-testing/marquee logic; layers panel reuses the build-tree/`PageStructurePanel` patterns.
- **Styling** — `ElementNode.style` is `ElementStyleTokens` (`src/features/elements/types.ts`): typed guidance keys (typography, colours, layout, visual, transform) over a passthrough `[key: string]` index for compatibility with the Phase-O style-token system. Values are sanitised at render time by `src/features/blocks/render/block-style-to-css.ts`; unsafe CSS values are dropped.
- **Text editing** — double-click `EditableText` (Phase M) writes through `updateEditableFieldValue`, which now resolves **field paths into the element tree** rather than only section props.
- **Responsive** — `ElementNode.viewport` holds per-breakpoint overrides; the P22-F decision system persists accepted/dismissed proposals on `Project.responsiveDecisions` (bounded), and **user decisions always outrank AI suggestions**.
- **Interactions / animations** — declarative data only (`ElementNode.interaction`, `ElementNode.animation`): typed `NavTarget`, hover/scroll effects, animation presets. Validated against allow-lists; mapped to safe React handlers in the editor and emitted as client-safe code on export. No raw JS.
- **Custom code** — `ElementNode.customCode` is **inert data** in the document. It executes *only* inside a sandboxed `<iframe sandbox="allow-scripts">` in the opt-in authoring preview and in the exported/published site; the editor canvas, visitor preview, share views and thumbnails render an inert placeholder.

---

# 2. ARCHITECTURE & TECH STACK

## 2.1 Stack (verified in `package.json`)

| Layer | Choice |
|---|---|
| Framework | **Next.js 16.2.12** (App Router; `src/app/**`, route handlers in `src/app/api/**`) |
| UI runtime | **React 19.2.4** / react-dom 19.2.4, TypeScript 5 |
| Styling | **Tailwind CSS v4** (`@tailwindcss/postcss`), `clsx` + `tailwind-merge` (`src/utils/cn.ts`), `motion` (Framer Motion successor) for transitions |
| State | **Zustand 5.0.14** — the editor store is the single source of truth; smaller transient stores (canvas interaction, block editor, editor UI prefs) are explicitly non-durable |
| Validation | **Zod 4.4.3** at every boundary (schemas, plans, persistence, import, share) |
| Collaboration | **Yjs 13.6.32** CRDT (`Y.Doc` per project) + mock HTTP transport and Supabase transport |
| Backend / auth | **Supabase** (`@supabase/supabase-js`) — auth, Postgres, RLS, RPCs; additive SQL migrations in `supabase/migrations` |
| AI | **`@google/genai`** (Gemini) behind `/api/generate`, always with a deterministic **rule-based fallback** |
| Drag & drop | `@dnd-kit/core` + `sortable` + `utilities` (library drag, panel/list reorder) |
| Export / packaging | `jszip` (site + template packages), generated static Next.js site |
| Parsing / import | `parse5` (HTML), `@babel/parser` (JS) for the code-import pipeline |
| Misc | `lucide-react` (icons), `modern-screenshot` (thumbnails), `postcss` |
| Tests / tooling | **Vitest 3.1** (+ `@testing-library/react`, `jsdom`, `fake-indexeddb`), **Playwright 1.52**, **ESLint 9** (`eslint-config-next`), `cross-env` |

## 2.2 State management

| Store | File | Nature |
|---|---|---|
| Editor store (canonical) | `src/features/editor/store/editor-store.ts` | Durable. Holds `project`, `selectedSectionId`, `selectedPageId`, `viewport`, `zoom`, `history {past, present, future}`, persistence status (`saveStatus`, `revision`, `isDirty`, `persistenceError`). **Every** mutation funnels through `withHistory(state, mutate)` or the P16 direct-write path `commitLocalProject`. |
| Canvas interaction store | `src/features/canvas/store/canvas-interaction-store.ts` | Transient (in-flight gesture, hover, marquee). |
| Block editor store | `src/features/blocks/store/block-editor-store.ts` | Transient selection/expansion/browser state; durable block edits go through `commitBlockTree`. |
| Editor UI prefs | `src/features/editor` UI store + localStorage | Panel sizes/tab state. |

Because all durable writes pass one boundary, three cross-cutting concerns are implemented once: **undo/redo**, **collaboration commit hook** (`src/features/collaboration/editor-commit-hook.ts` intercepts the mutation and routes it through `reconcileProject`), and **autosave dirty tracking** (`ProjectController → AutosaveCoordinator`, 3 s debounce, revision-aware).

## 2.3 Folder layout and responsibility boundaries

```
src/
├── app/                      Next.js App Router
│   ├── editor/[projectId]/   editor shell route
│   ├── preview/[projectId]/  standalone visitor preview
│   ├── share/[token]/        public read-only review
│   └── api/                  generate · publish/vercel (×9) · cloud · collab · presence · workspaces · share
├── components/
│   ├── editor/               shell: TopNav, LeftSidebar, Canvas, RightSidebar, StatusBar,
│   │                         PageTabs, PageMetaDialog, ResizeHandle, EditorProvider
│   └── ui/                   design-system primitives
├── features/
│   ├── editor/               store, section/inspector registries, schemas, sections, inspectors,
│   │                         renderer, section-library, page/section structure helpers, mock project
│   ├── blocks/               "LEGO" engine: BlockTree model, block registry, ops engine,
│   │                         BlockRenderer, section↔block adapter, style-to-css
│   ├── elements/             universal element layer: types, registry, engine (ops + validation),
│   │                         schemas, serialization (normalizer/serializer), adapters,
│   │                         inspector, responsive, animation, interaction, binding, navigation,
│   │                         collections, custom-code sandbox
│   ├── canvas/               manipulation engine (coords/transform/geometry/snap/align/layering/
│   │                         selection/clipboard/batch/shortcuts), hooks, components, store
│   ├── inspector/            shared field controls (incl. CustomCodeField / CustomCodePreview)
│   ├── inline-editing/       double-click text editing + inline AI field rewrites
│   ├── persistence/          ProjectController → AutosaveCoordinator → IndexedDB adapter;
│   │                         serializer/envelope, normalizer, migrations, import validators, constants
│   ├── collaboration/        Yjs CRDT (collab-doc bridge, text-diff, tree-normalizer),
│   │                         commit hook, transports, session, components
│   ├── cloud-sync/           offline queue, markers, conflict records (P6)
│   ├── generation/           GenerationPlan schemas + ProjectSchema + rule-based/AI project generator
│   ├── ai-editing/           section/page/project edit plans (simulate → diff → review → atomic apply)
│   ├── ai-copilot/           chat assistant (ASK/EXPLAIN/PLAN-EDIT), memory, context builder
│   ├── code-import/          HTML/JS import studio: parsing, conversion, security, normalization,
│   │                         strip-custom-code (distribution boundary)
│   ├── export/               static Next.js site generator: pipeline, generators, validators, zip
│   ├── publishing/ workspaces/ sharing/ templates/ template-packages/ my-blocks/
│   ├── shared-libraries/ personal-templates/ thumbs/ recovery/ routing/ site-settings/
│   ├── assets/ auth/ launch-readiness/ guided-builder/ library/ integrations/ perf/ help/
├── hooks/ lib/ types/ utils/ constants/
```

**Boundary rules that matter:**

1. `src/features/elements/*` is **pure** (no React, no DOM, no Zustand, no persistence) — safe for server-side validation.
2. The renderer is **one path for editor, preview, thumbnails and export**, so editor/preview/export parity is structural rather than maintained by hand.
3. The CRDT bridge (`collab-doc.ts`) is a **generic JSON ↔ Yjs bridge** (objects→`Y.Map`, arrays→`Y.Array`, strings→`Y.Text`, id-stable array diffing). New document fields flow through it with no bridge change; only `tree-normalizer.ts` clamps them.
4. `project-normalizer.ts` + Zod schemas are the **only** places untrusted payloads are repaired/validated; a non-strict Zod object silently strips undeclared keys, which is why `BaseSection.tree` had to be declared in *both* the editor and the generation/persistence schema layers.

---

# 3. PHASE CHRONOLOGY (P1 → P24-B)

The repository names phases by *outcome*, not by ticket, and each phase lands with its own architecture + report document (P5 onward) and a green gate sequence. Git history: **84 commits**, 32 merged PRs, two human contributors.

### 3.0 Pre-P-series (letter phases, referenced but unreported) **[reconstructed from docs]**

Phases **K / M / L / N / O** precede the numbered series. `docs/phase-p22-architecture.md` §1.2 names three of them directly: **M = inline editing** (`EditableText`, floating toolbar, inline AI field rewrites), **N = guided mode** (beginner journey + experience-mode switcher), **O = block builder** (`BlockTree`, block registry, `applyBlockOperation` validated ops engine, `BlockRenderer`, `custom-block` sections). `docs/phase-p9-architecture.md` summarises the lineage as *"N (guided builder), O–P3 (block engine + import), P4–P5 (My Blocks library)"*.

### 3.1 The numbered arc

| Phase | Pillar | Shipped (one line) |
|---|---|---|
| **P1–P2** | Import security | Secure parsing + block conversion from imported HTML/JS (`5b1af4d`). |
| **P3** | Import studio | Import studio UI and persistent custom blocks. |
| **P4** | Personal library | My Blocks — save reusable blocks locally (IndexedDB `myBlocks`). |
| **P5** | Visual library | Thumbnails, collections/folders, favourites, bulk ops, drag-and-drop insertion onto the canvas. |
| **P6** | Cloud sync & auth | Supabase as sole backend; accounts, private shared libraries, durable offline sync queue + conflict records. |
| **P7** | Publishing foundation | Beginner-first Launch Center, `siteSettings` in `ProjectSchema`, preview modes, deployment history (async deployment records). |
| **P8** | Real publishing | Vercel as production provider, custom domains, deployment details/rollback. |
| **P9** | Product polish | Templates, growth loops, production-readiness pass, personal templates, bounded draft-recovery snapshots. |
| **P10** | AI copilot | Copilot chat (ASK/EXPLAIN/PLAN-EDIT) + quality pass. |
| **P11** | Continuity | Per-project copilot memory (bounded conversation + style notes, local-only, `copilotMemory` store). |
| **P12** | Share & review | Unguessable read-only review links, page-level feedback, revoke/regenerate/expire. |
| **P13** | Portability | Personal templates + portable, versioned, strictly validated `.buildora-template` packages (assets intact). |
| **P14** | Team workspaces | Authenticated workspace collaboration: server-authoritative projects, edit leases, optimistic concurrency, read-only viewers. |
| **P15** | Presence & history | Who's here / what changed: presence, activity, version history, preview, restore, copy. |
| **P16** | Real-time editing | Simultaneous co-editing via Yjs: live remote changes, per-user undo, CRDT merge, offline queues, maintenance lock. |
| **P17** | Hardening | Eliminate highest-value production risks: silent divergence, lost edits at session boundaries, offline-relay parity gaps, authz/DoS surfaces. |
| **P18** | Operational reliability | Predictable behaviour under partial outages; evidence-driven fixes with regression tests. |
| **P19** | Observability | Answer *what happened / when / which subsystem / transient? / retried? / persisted? / authorized?* across frontend, API, persistence, collab. |
| **P20** | Release readiness | Declared **RELEASE READY**; production rate limiter on `/api/generate`, security headers, dev-gated force-local header, env docs. |
| **P21** | Post-release hardening | First post-release pass: reliability, recovery, security, operational weaknesses; Gemini provider timeout + fallback enforcement. |
| **P22 (A→L)** | **Canva-style element layer** | See §3.2. |
| **P23 (A→K)** | **Custom code foundation** | See §3.3. |
| **P24-A** | P23 closeout | Docs + E2E + consolidated security review for P23 — **no product code changed**. |
| **P24-B** | **Durable universal element trees** | See §3.4. |

### 3.2 P22 — Canva-style AI website builder (delivered `2f8046b`)

Nine sub-phases plus validation, all closed:

| Sub-phase | Delivered |
|---|---|
| **P22-A** Element model foundation | `ElementNode extends BlockNode` (additive, all new fields optional → every `BlockTree` is a valid `ElementTree`); `ElementTree`; element registry with element-only families (`section`, `text`, `logo`, `list`, `carousel`, `product-card`, `price`, `custom-component`); normalizer/schema/migration wiring; element ops through the validated engine. |
| **P22-B** Canvas selection + manipulation | Universal `ElementRenderer` render path; selection overlay with move/resize/rotate handles; geometry actions through `withHistory`; `src/features/canvas/*`; WYSIWYG export parity for trees. |
| **P22-C** Typography + styling inspector | Universal style inspector for materialised trees (`src/features/inspector/*`, `ElementInspectorPanel`); field-path text editing; responsive-aware controls; legacy inspectors untouched. |
| **P22-D** Sections + element library | Sections as root elements; `ElementLibrary` categories/search/drag-to-canvas with insertion feedback; section presets as tree factories. |
| **P22-E** Multi-page polish | `setHomePage` + home indicator, page reorder UX, typed navigation surfaced in the "Navigate to…" picker, routing tests. |
| **P22-F** Responsive engine | Responsive overrides on all elements, breakpoint controls, persisted decision system (user-override-wins), responsive AI proposals. |
| **P22-G** Interactions + animations | Typed `NavTarget` + `NavigateToPicker`, hover/scroll effects, animation data + render + export emission. |
| **P22-H** AI element editing | Element-scoped plans; AI element previews (accept/reject/customize); element context in the copilot; validated atomic apply. |
| **P22-I** AI page/site generation | `mode:"site"` generation (pages + nav + sections + basic collections) via Gemini with deterministic rule-based fallback; site templates; `detectSiteIntent`. |
| **P22-J** Backend/data integrations | Visual Data tab, data-binding resolver, scoped collections; secrets server-only; additive `data_records` migration; static export snapshot of runtime records. |
| **P22-K** Premium UI polish | Collapsible/resizable left & right panels, minimal collapsed rails, empty states, accessibility hardening, guided-mode parity, localStorage UI prefs. |
| **P22-L** Production validation | Full gates + E2E matrix + fallback + export-build + security/observability review → `docs/phase-p22-report.md`. Result: **all actionable gates passed** (4757/4759 unit; 158/158 effective E2E after isolated reruns of 3 environmental flakes; matrix 14/14; fallback 1/1; export-build 1/1; typecheck/lint/build green). |

Key P22 architectural decisions (from `docs/phase-p22-architecture.md` §12): **D1** extend `BlockNode`, never fork it; **D2** sections become element trees incrementally (never rewrite); **D3** one renderer for editor/preview/thumbnail/export; **D4** flow-first, absolute optional; **D5** lazy, additive materialisation with `props`/`styles` preserved.

### 3.3 P23 — Custom code foundation (delivered `111df15` → `35fe795`, PRs #28–#32)

P23 shipped **safe, sandboxed, opt-in custom code** (HTML/CSS/JS + validated attributes) for element trees. The implementation was complete but missing docs/E2E/formal review, so it was **formally closed during P24-A**.

| Sub-phase | Delivered |
|---|---|
| **P23-A** (PR #28) | `ElementNode.customCode` field + `ElementCustomCodeSchema` caps; first sandbox foundation. |
| **P23-B** | Runtime foundation: `constants.ts`, `sandbox-policy.ts`, `srcdoc.ts` (document builder + CSP + neutralisation), `message-protocol.ts`, `heartbeat.ts` — pure, framework-independent. |
| **P23-C** | Export: `page-generator.ts` srcdoc map + flag-only tree; `custom-block-generator.ts` `CustomCodeFrame`. |
| **P23-D** | Authoring surface: `CustomCodeField` (opt-in confirmation, warning, per-field + aggregate caps), `CUSTOM_CODE_LEAF_TYPES` registry gating, `BlockRenderer` inert placeholder. |
| **P23-E** (PR #29) | Distribution hardening: `strip-custom-code.ts` + share/template/My Blocks stripping + tests. |
| **P23-F** (PR #30) | Safe custom attributes (`attribute-validation.ts` + attribute rows in the field). |
| **P23-G** (PR #31) | Runtime resilience: `runtime.ts` controller + heartbeat + bounded recovery, mirrored in export. |
| **P23-H** (PR #31) | Runtime diagnostics: `diagnostics.ts` + safe read-only `snapshot()`; isolation hardening. |
| **P23-I** | Height coalescing (`HEIGHT_COALESCE_MS`) in editor runtime and export mirror. |
| **P23-J** (PR #32) | `CustomCodePreview` — opt-in sandboxed authoring preview using the same policy as export. |
| **P23-K** (PR #32) | Preview polish: coalesced preview error/height updates + tests. |
| **P23-L** | **None — never existed.** Closeout happened as P24-A. |

Security model (verified in `docs/phase-p23-report.md` §4 and the P23 sources): sandbox is **`allow-scripts` only** (no `allow-same-origin`, popups, forms, top-navigation, modals, downloads, pointer-lock, presentation, storage-access) → opaque origin; the srcdoc document carries a **first-meta CSP** (`connect-src 'none'`, `form-action 'none'`, `base-uri 'none'`, no `unsafe-eval`); HTML is neutralised (`<script`/`<style`/`</head|body|html>` escaped); attribute names/values are grammar-validated with `on*`, `style`, `srcdoc` and `javascript:` rejected; size caps are per-field 20,000 / aggregate 48,000 and are **re-clamped at emission** (`srcdoc.ts` never trusts its input); runtime messages are shape-allow-listed and validated against `event.source === current contentWindow`; `frame-ancestors` via `<meta>` is documented as ignored by Chromium (real anti-framing = srcdoc-only delivery + the parent `sandbox` attribute).

**Explicitly deferred by P23** (`docs/phase-p23-architecture.md` §10): *"Custom-code authoring is scoped to the curated leaf blocks inside `custom-block` sections … Broader authoring (any element, any section) requires durable universal element trees — **P24**."*

### 3.4 P24-B — Durable universal element trees (`d9ddb42`)

**Objective:** make the element tree a **durable, first-class part of a section** instead of a per-render projection rebuilt from `props`. Before P24-B, `sectionToElementTree(section)` always re-materialised a tree from section `props`, so anything that exists only on the tree (geometry, animation, interaction, **custom code**, arbitrary element fields) was **lost on reload / sync / export**.

| Area | Implementation |
|---|---|
| Model | `BaseSection.tree?: ElementTree` — optional; absent on legacy sections. |
| Schema | `BaseSectionSchema.tree = ElementTreeSchema.optional()` in the editor schemas **and** the explicit `tree` key in the generation/persistence `BaseSectionSchema` (a non-strict Zod object would otherwise silently strip it at every `ProjectSchema` boundary: serializer, export validator, publish, templates, cloud save/load, workspace server). |
| Adapter | `sectionToElementTree` returns the durable tree when present with bound-child content reconciled from current `props`; new `sectionHasDurableTree`; `reconcileDurableTreeWithProps`; `materializeSectionElement` documented as the wired durable shape. |
| Store | New `commitSectionTree(pageId, sectionId, tree)` — the durable persistence boundary; `commitElementTree`, the element-op path and the animation/interaction paths all funnel through one shared `prepareSectionTreeCommit` helper. |
| Normalisation | `normalizeElementTree` at persistence + CRDT boundaries: preserve valid trees, **drop unrepairable ones** (section stays legacy, never dropped), clamp depth/node-count/text, drop invalid element metadata (never coerce). |
| Security | `stripCustomCodeFromProject` now strips node-level `customCode` from **any** section tree (`props.tree` for custom-block and the new `section.tree` on **every** section type) at distribution boundaries. |
| Versioning | `CURRENT_FORMAT_VERSION` 2 → 3 via a tolerant `migrateV2ToV3` (version bump only — no data rewriting; deep clone; never mutates input; never inflates payloads). |

**Durable-tree lifecycle:** legacy open (no tree, byte-identical render path) → first real element-tree edit (normalise → fold back through `elementTreeToSection` → store `{...section, tree, props, styles}`, materialisation is **additive** so props/styles stay in sync) → subsequent edits operate on the durable tree → content reconciliation refreshes only bound-child text nodes so prop edits from inline editing / AI plans / inspectors are never silently reverted → reload/sync/export re-validate at every boundary → **no-op discipline** (re-committing an identical tree, or committing the exact materialisation of a still-legacy section, creates **no history entry** and never eagerly materialises). `custom-block` sections are unchanged: they keep their whole-tree `props.tree` fold and never gain `section.tree`.

**P24-B validation (`docs/phase-p24b-report.md` §14):** TypeScript source-only ✅ exit 0 · ESLint ✅ 0 errors, 1 pre-existing warning · Vitest ✅ **372 files / 5184 tests** · production build ✅ · prompt matrix 14/14 · fallback 1/1 · export-build ✅ (122.9 s) · `git diff --check` ✅. Two residual E2E failures (Batch 10 `realtime-structure`, Batch 11 `workspace-version-history`) are documented as **environmental / pre-existing, not P24-B regressions**, with the evidence recorded and the failures explicitly *not* claimed as passes.

---

# 4. CURRENT PROJECT STATE (`d9ddb42`)

## 4.1 Branch and worktree

| Item | Value |
|---|---|
| Branch | **`phase-p22-canva-elements`** (no other branch created; no merge into `master` in this arc) |
| HEAD | **`d9ddb42`** — `feat: implement durable universal element trees (P24-B)` (2026-09-18 23:50:58 +0530) |
| Upstream | `origin/phase-p22-canva-elements` — **0 ahead / 0 behind** (published; fast-forward `35fe795..d9ddb42`, not a force push) |
| Parent commit | `35fe795` — merge of PR #32 (P23-K preview polish) |
| Tracked modifications | **none** |
| Staged changes | **none** |
| Untracked leftovers (6, intentionally uncommitted) | `.p24b-logs/` and `.p24b-tsconfig.json` (P24-B validation artifacts) · `docs/phase-p23-architecture.md`, `docs/phase-p23-report.md`, `e2e/custom-code-authoring.spec.ts`, `e2e/custom-code-export.spec.ts` (pre-existing P23 leftovers, both spec headers verified "Phase P23") |
| Commit convention | `feat: …` / `fix: …` / `test: …` with `🤖 Generated with Codebuff` + `Co-Authored-By` trailer (now used once, on `d9ddb42`) |

## 4.2 Codebase size and gates

| Metric | Value |
|---|---|
| Source files under `src/` (`*.ts`/`*.tsx`) | 1,107 |
| Vitest test files | 372 (config includes `src/**/*.test.ts(x)`, `environment: node`, `testTimeout: 10_000`) |
| Playwright specs | 68 in `e2e/` (+ `e2e/helpers/`) |
| Phase documents | 67 in `docs/` |
| Unit suite at P24-B closeout | 372 files / 5,184 tests passing |
| Format version | `CURRENT_FORMAT_VERSION = 3` |
| IndexedDB schema version | `DATABASE_VERSION = 9` |

**Gate commands** (`package.json`): `npm run typecheck` (`tsc --noEmit`) · `npm run lint` (`eslint .`) · `npm test` (`vitest run`) · `npm run build` (`next build`) · `npm run test:e2e` (Playwright, `--workers=1`, excludes prompt/fallback) · `npm run test:e2e:matrix` · `npm run test:e2e:fallback` · `npm run test:export-build` (real `npm install && npm run build` of a generated site in a temp dir).

## 4.3 Data schema representation today

**Document model (durable, in-memory + serialized):**

```ts
// src/types/project.ts
interface Project {
  id: string; name: string; theme: Theme;
  pages: Page[]; assets: Asset[];
  createdAt: string; updatedAt: string;
  siteSettings?: SiteSettings;              // P7
  responsiveDecisions?: ResponsiveDecision[]; // P22-F (bounded, validated)
  collections?: Collection[];               // P22-J definitions only (runtime records are provider data)
}

interface Page {
  id: string; title: string; slug: string;
  sections: BaseSection[];
  meta?: PageMeta;                          // P7 SEO/social/canonical/index
}

// src/types/section.ts
interface BaseSection {
  id: string; type: string; order: number; visible: boolean;
  props: Record<string, unknown>;           // typed per section type via SectionPropsMap
  styles: Record<string, unknown>;
  tree?: ElementTree;                       // ← P24-B durable element tree (absent = legacy)
}
```

`SectionPropsMap` types eight section types: `header`, `hero`, `features`, `pricing`, `faq`, `cta`, `footer`, and `custom-block` (`{ name, tree: BlockTree, sourceMetadata? }` — note this is a **separate, older** `BlockTree` inside props, retained untouched by P24-B).

**Element tree model:**

```ts
// src/features/elements/types.ts
interface ElementTree { rootIds: string[]; nodes: Record<string, ElementNode>; }

interface ElementNode extends Omit<BlockNode, "type"> {   // every BlockNode field preserved 1:1
  type: ElementType;                 // BlockType ∪ ElementOnlyType
  geometry?: ElementGeometry;        // { mode: "flow"|"absolute", x?, y?, width?, height?, rotation?, zIndex? }
  viewport?: ElementViewportStyles;  // responsive overrides (base values live in style)
  animation?: ElementAnimation;      // declarative, data-only
  interaction?: ElementInteraction;  // typed NavTarget / hover / scroll, data-only
  binding?: ElementBinding;          // data-binding foundation
  a11y?: ElementAccessibility;
  customCode?: ElementCustomCode;    // { enabled?, css?, js?, html?, attributes? } — INERT DATA
  style?: ElementStyleTokens;
}

interface ElementDefinition {        // the registry contract
  type; label; description; category; iconKey; keywords;
  canHaveChildren; nesting; resizePolicy;
  createProps(); createStyles();
  validateProps?; editableFields?; beginnerFriendly?;
  editor?: { defaultLayout?; supportsViewportOverrides?; supportsAnimation?;
             supportsInteraction?; supportsBinding?; supportsCustomCode?; rendererKey? };
}
```

**Schema/validation layers:**

- `src/features/editor/schemas/section-schemas.ts` — `BaseSectionSchema` (+ optional `tree`), per-type props schemas, `AnySectionSchema` (`z.discriminatedUnion("type", …)`) = the canonical section validation; `validateSection` / `validateSectionSafe`.
- `src/features/generation/schemas/generation-plan-schema.ts` — `ProjectSchema` and the generation boundary; declares `tree` explicitly so non-strict Zod parsing cannot strip durable trees.
- `src/features/elements/schemas/element-schemas.ts` — `ElementTreeSchema`, `ElementNodeSchema`, `ElementCustomCodeSchema` (+ caps), animation/interaction schemas.

**Persistence envelope + pipeline:**

```ts
// serialize:   validate project → wrap in SerializedBuildoraProject envelope (formatVersion: 3) → JSON
// deserialize: parse → detect version → migrate (1→2→3) → normalize → validate → Project
const migrationRegistry = { 1: migrateV1ToV2, 2: migrateV2ToV3 };  // src/features/persistence/services/project-migrations.ts
```

- Allowed envelope keys: `id, name, theme, pages, assets, createdAt, updatedAt, siteSettings, responsiveDecisions, collections` — transient editor state is excluded.
- A newer-than-supported `formatVersion` is rejected with an explicit "update Buildora" error message.
- IndexedDB (`DATABASE_NAME = "buildora"`, `DATABASE_VERSION = 9`) stores: `projects`, `metadata`, `projectThumbnails` (v2), `myBlocks` (v3), `myBlockThumbnails` + `myBlockCollections` (v4), `cloudSyncQueue` + `cloudSyncMarkers` + `cloudSyncConflicts` (v5), `deployments` (v6), `deploymentDomains` (v7), `personalTemplates` + `recoverySnapshots` (v8), `copilotMemory` (v9). Deployment/domain/sync/copilot data live **outside** `ProjectSchema` by design.
- Import limits (`persistence/constants.ts`): file 10 MB · pages 100 · sections 2,000/page (2,000 aggregate) · features 50 · FAQ 50 · assets 2,000 · structural depth 20 · asset payload 5 MB · text field 5,000 chars.

**Collaboration representation:** one `Y.Doc` per project; the project payload is bridged generically (`collab-doc.ts`) and clamped by `collaboration/crdt/tree-normalizer.ts` (`normalizeSections` / `normalizeProject`) before projection. Durable state stays the canonical `Project` payload via debounced checkpoints; `CURRENT_FORMAT_VERSION` is deliberately **not** part of the CRDT payload.

---

# 5. CORE FILE DIRECTORY (25 most critical files)

Grouped by responsibility; every path is real and every role was verified in source.

| # | File | Role |
|---|---|---|
| 1 | `src/features/editor/store/editor-store.ts` | **The single source of truth.** Zustand store: `project`, selection, viewport/zoom, `history {past,present,future}`, persistence status. `withHistory` / `commitLocalProject` are the only mutation boundaries; contains `commitSectionTree` (P24-B), `commitElementTree`, `commitBlockTree`, `applyAiEditPlan`, page/section/asset/collection CRUD, and `prepareSectionTreeCommit` + `deepEqualJson` no-op detection. |
| 2 | `src/types/section.ts` | `BaseSection` (+ optional durable `tree`) and all typed section props (`HeaderSectionProps` … `CustomBlockSectionProps`) + `SectionPropsMap`. |
| 3 | `src/types/project.ts` | `Project`, `Page`, `PageMeta`, `Viewport` — the durable document shape. |
| 4 | `src/features/editor/schemas/section-schemas.ts` | Canonical section validation: `BaseSectionSchema`, per-type schemas, `AnySectionSchema` discriminated union, `validateSection`/`validateSectionSafe`. |
| 5 | `src/features/generation/schemas/generation-plan-schema.ts` | `ProjectSchema` + generation plan schemas; the boundary that decides whether new document fields survive (strict/non-strict Zod behaviour). |
| 6 | `src/features/elements/types.ts` | Universal element model: `ElementNode`, `ElementTree`, geometry, style tokens, a11y, `ElementCustomCode`, `ELEMENT_ONLY_TYPES`, `ElementDefinition` registry contract, structured `ElementError` codes. |
| 7 | `src/features/elements/schemas/element-schemas.ts` | Zod schemas + caps for trees/nodes/custom code/animation/interaction; `elementTypeRefine` narrowing. |
| 8 | `src/features/elements/registry/element-registry.ts` | The element catalogue (element-only types registered eagerly, block types derived lazily from the block registry so definitions never drift). Hosts `CUSTOM_CODE_LEAF_TYPES`, `elementSupportsCustomCode`, `isRenderableElementType`. |
| 9 | `src/features/elements/engine/element-operations.ts` | The **validated ops engine** (~23 ops): `createElement`, `insertElement`, `deleteElement`, `duplicateElement`, `moveElement`, `updateElement{Props,Style,Geometry,Viewport,Responsive,Animation,Interaction,Binding,Accessibility,CustomCode}`, `applyElementPreset`, and the umbrella `applyElementOperation`. |
| 10 | `src/features/elements/engine/element-validation.ts` | Shared validation/invariant helpers used by the ops engine and import paths. |
| 11 | `src/features/elements/serialization/element-normalizer.ts` | `normalizeElementTree` / `normalizeElementNode` — the **untrusted-payload repair boundary** (clamps depth, node count, text length; drops invalid metadata; returns `null` for unrepairable trees). Applied at persistence and CRDT boundaries. |
| 12 | `src/features/elements/serialization/element-serializer.ts` | `serializeElementTree` / `deserializeElementTree` / `cloneElementTree` (structured clone, `ElementResult`-style errors). |
| 13 | `src/features/elements/adapters/section-element-adapter.ts` | The **section ↔ element-tree bridge**: `sectionToElementTree` (durable-preference + `reconcileDurableTreeWithProps`), `elementTreeToSection`, `sectionHasDurableTree`, `materializeSectionElement`, `elementTreeToBlockTree`, `isSectionDerivedElementTree`, `sectionTypeOfElementTree`. |
| 14 | `src/features/blocks/render/BlockRenderer.tsx` | The universal render path used by canvas, preview, thumbnails and import preview. Also owns the **inert custom-code placeholder** (custom code never executes in editor/visitor/share/thumbnail surfaces). |
| 15 | `src/features/blocks/render/block-style-to-css.ts` | Sanitises `style` tokens → CSS; the single place unsafe CSS values are dropped. |
| 16 | `src/components/editor/Canvas.tsx` | Editor canvas frame: browser chrome, viewport widths, zoom, theme CSS variables, section tree render. |
| 17 | `src/features/canvas/components/CanvasManipulationLayer.tsx` + `SelectionOverlay.tsx` | Live drag/resize/rotate gesture surface and the selection overlay (bounding box, 8 handles, rotation handle, floating toolbar). |
| 18 | `src/features/canvas/engine/*` (`transform`, `geometry`, `coords`, `snap`, `align`, `layering`, `selection`, `clipboard`, `batch`, `shortcuts`) + `hooks/useCanvasManipulation.ts` | Pure manipulation math (coordinate conversion, snapping/alignment, z-order, selection/clipboard, shortcut bindings) and the React hook that drives it with rAF throttling. |
| 19 | `src/components/editor/RightSidebar.tsx` | Panel routing: which inspector renders for the selection. **Key restriction site** — `ElementInspectorPanel` (the surface containing the Custom Code section) is mounted only for `custom-block` sections; other section types keep their P4-era inspectors. |
| 20 | `src/features/elements/inspector/schemas.ts` (+ `mutate.ts`, `types.ts`) and `src/features/content/inspectors/*` | Declarative inspector field descriptors for materialised trees; `schemas.ts` gates the custom-code field with `if (elementSupportsCustomCode(type))`. |
| 21 | `src/features/inspector/components/controls/CustomCodeField.tsx` + `CustomCodePreview.tsx` | The custom-code authoring UI (opt-in confirmation, warning, attribute rows, per-field + aggregate caps) and the sandboxed opt-in preview. |
| 22 | `src/features/elements/custom-code/*` (`sandbox-policy`, `srcdoc`, `message-protocol`, `heartbeat`, `runtime`, `diagnostics`, `attribute-validation`, `constants`, `index`) | The entire sandbox/security subsystem: the authoritative capability policy (`allow-scripts` only), CSP-first srcdoc builder with deterministic re-clamping, allow-listed message protocol, heartbeat + bounded height coalescing, runtime controller with idempotent dispose, safe read-only diagnostics snapshot, attribute grammar validation. |
| 23 | `src/features/code-import/services/strip-custom-code.ts` | **Distribution-boundary sanitiser** — strips node-level `customCode` from every section tree (`props.tree` and P24-B `section.tree`) before share/template/My Blocks/export projections. |
| 24 | `src/features/persistence/services/project-serializer.ts` + `project-normalizer.ts` + `project-migrations.ts` + `constants.ts` | The persistence pipeline: canonical envelope serialisation (`formatVersion: 3`, transient keys stripped), tolerant load-side normalisation/clamping, sequential migrations `1→2→3`, and all version/limit constants. `project-controller.ts` + `autosave-coordinator.ts` sit on top (dirty-flush blocking transitions, 3 s debounce, revision-aware single-flight saves). |
| 25 | `src/features/export/pipeline/export-pipeline.ts` + `src/features/export/generators/*` (`project-generator`, `page-generator`, `layout-generator`, `globals-css-generator`, `section-generators/*`, `static-files-generator`, `asset-export-manifest`) + `validators/export-validator.ts` + `zip/` | The static-site generator: validated project → multi-page Next.js app → ZIP. `page-generator.ts` owns the P23 srcdoc map (validated, escaped) and the flag-only custom-code tree; `custom-block-generator.ts` emits the sandboxed `CustomCodeFrame`. |

**Also load-bearing (runner-up tier):** `src/features/collaboration/crdt/collab-doc.ts` (generic JSON↔Yjs bridge) and `crdt/tree-normalizer.ts` (CRDT clamping, P24-B) · `src/features/collaboration/editor-commit-hook.ts` (intercepts store mutations for reconciliation) · `src/features/blocks/engine/block-operations.ts` + `adapters/section-block-adapter.ts` (the Phase-O engine the element layer extends) · `src/app/api/generate/route.ts` (Gemini + rate limit + fallback) and `src/app/api/workspaces/[[...path]]/route.ts` (server-authoritative collaborative save/lease model) · `src/features/generation/*` and `src/features/ai-editing/plan-*.ts` (plan → simulate → diff → review → atomic apply).

---

# 6. KNOWN TECHNICAL DEBT & OPEN QUESTIONS (carried forward, not fixed)

Recorded in `docs/phase-p24b-report.md` §17 and the P24-B read-only investigation; **none blocks the current checkpoint**.

1. `e2e/workspace-version-history.spec.ts` — reproducible post-restore reload/hydration readiness race (editor can render the cached pre-restore project before the workspace fetch + `discardAndOpenProject` + collab re-hydration land; a `.catch(() => undefined)` in `useWorkspaceEditorAccess` hides a re-hydration failure).
2. Mock collaboration checkpoint race — `STALE_REVISION` is not re-scheduled (only `LOCKED` is), so two concurrent checkpoints can leave the server one revision behind until the next edit. Needs a bounded retry/backoff.
3. `boundedErrorToken` in `src/app/api/generate/route.ts` breaks `next build`'s type check via the gitignored Next-generated `.next/dev/types` artifact (pre-existing since P21; source-only `tsc` is clean).
4. Export-build gate is cold-cache fragile (passes in 122.9 s with a warm npm cache; timed out once at >600 s).
5. Pre-existing ESLint warning `'reviewAndApply' is defined but never used` in `e2e/ai-element-editing.spec.ts:310`.

Roadmap-level gaps (from the P24-B read-only roadmap review):

- **No P24-C or P25 exists.** Zero references to `P25` / `phase-p25` anywhere in docs, `src/`, `e2e/`, logs or commit messages; there is also no P24 plan document. The newest planning artefacts (`docs/phase-p23-architecture.md` §10, `docs/phase-p23-report.md` §8) describe only the **one-line deferral**: broader custom-code authoring (any element, any section) requires durable universal element trees — which P24-B has now delivered.
- `docs/roadmap.md` is stale: it stops at "🔜 Sprint 6 — Upcoming" and lists features (export, drag-and-drop reordering, theme editor, add/remove pages) that shipped many phases ago. It should be retired or rewritten.
- The 6 untracked leftovers (2 P24-B validation artifacts + 4 pre-existing P23 files) still need a decision: commit, gitignore, or discard.

---

# 7. QUICK ORIENTATION FOR THE NEXT AGENT

**Where to start reading:** `PROJECT_FULL_CONTEXT.md` (this file) → `docs/phase-p24b-report.md` (most recent closeout) → `docs/phase-p23-architecture.md` (custom-code security model) → `docs/phase-p22-architecture.md` (element model rationale) → `src/features/editor/store/editor-store.ts` + `src/features/elements/types.ts`.

**Invariants you must not break** (`docs/phase-p22-architecture.md` §26 + the P16–P24 record):

1. One mutation boundary — every durable write goes through `withHistory`/`commitLocalProject` (or an explicit `commit*` action built on it), so undo, collab and autosave stay correct.
2. `props`/`styles` remain valid for legacy renderers; materialisation is **additive and lazy** — never eager, never destructive.
3. `tree` is authoritative once present, but `reconcileDurableTreeWithProps` must keep bound-child content in sync with prop edits.
4. Custom code is inert data everywhere except the sandboxed iframe (authoring preview + exported/published site); every new tree location must be stripped at distribution boundaries.
5. Any new durable field must be declared in **both** schema layers (editor + generation/persistence), normalised at **both** untrusted boundaries (persistence + CRDT), and optionally migrated without rewriting existing data.
6. Gate sequence, run sequentially: `typecheck` → `lint` → `vitest` → `build` → affected E2E → matrix → fallback → export-build → full E2E.
