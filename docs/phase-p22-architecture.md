# Phase P22 — Canva-Style AI Website Builder: Architecture

Branch: *(to be created — `phase-p22-canva-editor`)*
Status: **Design document — written after the repository audit, before implementation.**
Baseline: P21 merged into master (working tree clean, verified `git status`).

---

## 0. How to read this document

P22 is a **major architectural phase**. The phase brief requires: repository audit →
gap analysis → architecture proposal → `docs/phase-p22-architecture.md` → **STOP**
for review. This document contains the audit (§1–§10), the gap analysis (§11), the
proposed architecture (§12–§17), the migration/compatibility/testing/security/
performance plans (§18–§22), the risks (§23), the phased implementation plan (§24),
and the exact file-level change surface (§25–§26).

**Nothing in this document is implemented yet.** Implementation is deferred until
the architecture is reviewed and the implementation boundary is approved.

---

## 1. Current architecture (verified against the repository)

Verified by direct code inspection (not from reports alone) on the P21 baseline:

### 1.1 High-level shape

```
app/editor/[projectId]            — editor shell (TopNav / LeftSidebar / Canvas / RightSidebar / StatusBar)
app/preview/[projectId]           — standalone visitor preview
app/share/[token]                 — public share review
app/api/*                         — generate, publish (vercel ×9), cloud, collab, presence,
                                     workspaces, share (mock-gated in dev)
features/editor                   — editor store (Zustand), section registry + inspectors,
                                     schemas, section components, page structure helpers
features/blocks                   — "LEGO builder engine": BlockTree model, block registry,
                                     block operations engine, BlockRenderer, section↔block adapter
features/inline-editing           — double-click inline text editing + inline AI suggestions
features/generation               — whole-website generation (Gemini + rule-based) via /api/generate
features/ai-editing               — targeted section edit (modify) + plan-based page/project edits
features/ai-copilot               — chat assistant (ASK / EXPLAIN / PLAN-EDIT), memory, context builder
features/persistence              — ProjectController → AutosaveCoordinator → IndexedDB
features/collaboration            — Yjs CRDT session, mock + Supabase transports, commit hook
features/publishing               — PublishService → Vercel / local / mock providers
features/export                   — static Next.js site generator (ZIP)
features/workspaces / sharing / site-settings / assets / my-blocks / shared-libraries /
features/templates / template-packages / thumbnails / recovery / cloud-sync / guided-builder
supabase/migrations               — 9 additive, rollback-safe migrations (P6/P14/P15/P16)
```

### 1.2 The editor (verified)

- **Zustand store** `src/features/editor/store/editor-store.ts` is the single source of
  truth. Every mutation funnels through `withHistory(state, mutate)` (undo/redo
  past/present/future stack) or `commitLocalProject` (P16 direct-write path). A
  collab **commit hook** intercepts this single boundary in collaborative sessions.
- Selection is **section-level only** (`selectedSectionId`); viewport
  (`desktop/tablet/mobile`) and zoom (50–125%) are store state.
- Rendering: `Canvas` → theme CSS variables → `SectionRenderer` → per-section
  component from the **section registry** → wrapped in `SelectableSection`
  (hover/selection outline + floating label + duplicate/delete buttons).
- Per-section **inspectors** from an inspector registry (`HeroInspector`, …) edit
  typed props. `RightSidebar` has three tabs: Structure (page structure panel),
  Blocks (block builder), Design (properties/inspector).
- **Inline editing** (Phase M): double-click registered fields → `EditableText` /
  floating toolbar → `updateEditableFieldValue` → one history entry. The inline
  editor also supports AI single-field rewrites with accept/reject.
- **Block builder** (Phase O): a `BlockTree` inside `custom-block` sections only.
  The block store (`block-editor-store.ts`) is explicitly transient (selection,
  expansion, browser state); persisted block edits go through the editor store's
  `commitBlockTree` action. `BlockRenderer` renders trees in canvas/thumbnails/
  import preview. `applyBlockOperation` is a validated ops engine.
- **Guided mode** (Phase N) overlays a beginner journey; the experience-mode
  switcher toggles guided/advanced.

### 1.3 Document model (verified — see §3)

`Project { id, name, theme, pages[], assets[], createdAt, updatedAt, siteSettings }`,
`Page { id, title, slug, sections[], meta? }`, `BaseSection { id, type, order,
visible, props, styles }`, `Theme { palette, typography, spacing, radius, shadows }`,
`BlockTree { rootIds, nodes }` / `BlockNode { id, type, parentId, children, props,
style, responsive, visible, locked, hidden }`.

### 1.4 Persistence (verified — see §4)

`ProjectController` (singleton, transitions block on dirty-flush failure) →
`AutosaveCoordinator` (3 s debounce, revision-aware, single-project scoped) →
IndexedDB adapter. Recovery snapshots, thumbnails, version history, cloud sync
(P6) all layer on top.

### 1.5 Collaboration (verified — see §5)

One `Y.Doc` per workspace project; `collab-doc.ts` is a **generic JSON ↔ Yjs
bridge** (objects→Y.Map, arrays→Y.Array, strings→Y.Text, id-stable array
diffing). The commit hook routes every store mutation through
`reconcileProject`. Durable state stays the canonical Project payload via
debounced checkpoints. Mock HTTP + Supabase transports; per-user undo via
`Y.UndoManager` origins; maintenance lock; bounded offline queues.

### 1.6 Preview (verified — see §6)

Two preview surfaces: (1) the in-editor `Canvas` frame (editor overlays +
theme vars + viewport widths), and (2) the full-screen `PreviewShell` →
`VisitorPageView` (plain registry rendering, internal/external/anchor/special
link classification via `navigation.ts`). Both render the **same section
components** the export pipeline emits, so fidelity is already high for
props-driven sections.

### 1.7 AI (verified — see §7)

- **Create** (whole website): `/api/generate` (Gemini → rule-based fallback,
  Zod-validated, production rate-limited 60/min/client) → `GenerationPlan` →
  project generator → `initProject`.
- **Modify** (one section): `orchestrateEdit` — Gemini or rule-based, per-type
  schema validation, invalid edits fall back to original props.
- **Plan** (page/project): `plan-service` + `plan-simulator` + `diff-builder` →
  review UI → `applyAiEditPlan` (one atomic, undoable history entry; stale/
  destructive guards).
- **Copilot**: intent classification (ASK/EXPLAIN/PLAN-EDIT), bounded context
  builder, on-device memory, style notes; authorization gate for EDIT plans.
- **Inline AI**: single-field suggestions via the same provider abstraction.

### 1.8 Routing / pages (verified — see §8)

Multi-page already exists: `Page` with `slug`; homepage = `pages[0]` owns `/`;
`routes.ts` (slug validation, `computePageRoutes`, `resolveInternalHref`,
`validateRoutingForExport`); `PageTabs` supports create/rename/delete/reorder
(`movePage`); per-page `PageMeta` SEO. `PageMetaDialog` edits metadata.

### 1.9 Publishing / export (verified — see §9)

Export generates a complete Next.js App Router site: `project-generator` →
`page-generator` (one `app/<slug>/page.tsx` per page with metadata) +
`section-generators/*` (React components per section type, including
`custom-block-generator` which renders block trees with a `useViewportWidth`
responsive hook) + `globals-css-generator` (Tailwind v4 `@theme` tokens) +
asset manifest. Publishing: `PublishService` → Vercel/local/mock providers,
idempotency keys, deploy rate limit, rollback-with-confirmation.

### 1.10 Supabase (verified — see §10)

9 additive migrations: cloud sync, shared libraries, fetch-changes, share/review,
workspaces, workspace share gates, presence/activity/versions, collab updates.
RLS on private tables, SECURITY DEFINER RPCs with `auth.uid()` actors,
membership/owner/editor gates, bounded retention, optimistic concurrency.

---

## 2. Current editor limitations (evidence-driven)

| # | Limitation | Evidence | Vision impact |
|---|-----------|----------|---------------|
| L1 | **Selection is section-level only.** No element selection inside sections (except the transient block builder scoped to custom-block sections). | `editor-store.ts` `selectedSectionId`; `SelectableSection.tsx` | Cannot select a heading/button/card and style it |
| L2 | **No canvas manipulation.** No drag-to-move on canvas, no resize handles, no rotation, no alignment tools, no z-index/layering, no copy/paste, no grouping, no absolute positioning. | No `resize`/`rotate`/`pointermove` canvas handling anywhere in `src` (search verified); `ResizePolicy` exists as metadata only | Core Canva interactions missing |
| L3 | **Two parallel element systems.** Sections (typed props + registry components) and blocks (BlockTree, only inside `custom-block`). Each has its own renderer, inspector, and edit path. | `types/section.ts` vs `types/blocks.ts`; `section-block-adapter.ts` bridges them but is only exercised for custom blocks | "Everything is an element" not achieved; duplicate maintenance |
| L4 | **Typography/style controls are per-section-type and shallow.** No universal font-family/weight/letter-spacing/line-height/text-shadow/text-stroke/opacity/border controls on arbitrary elements. | `inspectors/*` (HeroInspector etc.); `RightSidebar` "Theme/Typography/Colors/Spacing" categories render placeholder boxes ("controls will appear here") | Text/styling inspector required |
| L5 | **Links are raw `href` strings.** Users must understand routes; no "Navigate to…" picker. | `HeaderSectionProps.navLinks: {text,href}`; `resolveInternalHref` | Beginner navigation model missing |
| L6 | **Responsive is viewport-frame-only for sections.** The block model has `responsive` overrides (`resolveResponsiveCss`), but it applies only to custom-block trees; sections rely on static CSS in components. No responsive AI, no per-element breakpoint controls in inspectors, no "override AI decisions" preference storage. | `block-style-to-css.ts`; `Canvas.tsx` viewport widths; `CustomBlockSection.tsx` only consumer | Responsive intelligence missing |
| L7 | **No interactions/animations model.** No declarative on-click/on-hover/on-scroll config; no animation triggers/durations/easings as data. Framer-motion (`motion` pkg) is used for editor chrome only. | grep of `interaction`/`animation` in project model → none | Interaction/animation system required |
| L8 | **AI generation is single-page.** `mode:"create"` builds one landing page (`pages[0]`); templates build multi-page but generation does not. No site-level "build me a grocery website" with pages/nav/data model. | `generation-service.ts` returns `data.project.pages[0]?.sections`; templates emit pages | Site-level generation required |
| L9 | **AI is scoped to section/page/project — not element.** Plans target sections and pages; a selected product card or button has no AI action. | `ai-editing/plan-types.ts` scopes `section | page | project` | Element-scoped AI required |
| L10 | **No AI-generated element previews** (accept/reject/customize for "add a product card"). Plan review exists for page/project edits only. | `AiEditPlanReview.tsx` | Context-aware insert previews required |
| L11 | **Editor UI is developer-oriented.** Fixed 320 px chat sidebar + 300 px right panel; no collapsible/resizable panels; general-properties categories are empty placeholders; many controls on screen at once. | `LeftSidebar.tsx`/`RightSidebar.tsx` | Canva-style minimal shell required |
| L12 | **No element library with drag-to-canvas.** Section library + block browser exist as dialogs with click/drag-into-structure, not drag-onto-canvas with insertion preview. | `AddSectionDialog.tsx`, `BlockBrowserDialog.tsx` (dnd-kit to the tree), `InsertionPoint.tsx` | Drag-and-drop library required |
| L13 | **No data binding / integrations UI.** No visual "add Supabase / Stripe / form-to-database" flow; form blocks are static/readonly. | `BlockRenderer.tsx` form blocks `readOnly` | Integration/binding layer required |
| L14 | **Custom code is absent** (by design — no unsafe execution). Vision asks for safe, isolated advanced custom CSS/JS/HTML. | no custom-code surface | Advanced capability to design safely |
| L15 | **Two renderers for the same tree** (canvas `BlockRenderer` vs export `custom-block-generator`) — today they are kept in sync manually; a single renderer is required for the "WYSIWYG" guarantee. | `BlockRenderer.tsx` vs `section-generators/custom-block-generator.ts` | Preview ≈ published fidelity risk |

**What is already strong (do not break):** the single-store mutation boundary with
undo + collab hook, the generic Yjs bridge, the validated block-ops engine, the
registry/schema patterns, the multi-page routing model, per-page SEO, the export
pipeline, the provider-abstraction AI stack, and the P16–P21 security/reliability
infrastructure.

---

## 3. Current document model (detailed)

```
Project
├─ id, name, createdAt, updatedAt
├─ theme        Theme { palette (13 tokens), typography { fontFamily, headingFont,
│                     baseSize, scale }, spacing { sectionPadding, containerMaxWidth, gap },
│                     radius { sm..full }, shadows { sm..xl } }
├─ pages[]      Page { id, title, slug, sections[], meta? }
│                 meta { title, description, seoTitle, seoDescription, socialTitle,
│                        socialDescription, socialImage, index, canonicalUrl }
├─ assets[]     Asset { id, name, kind, dataUrl/…, createdAt } (+ AssetRef { assetId, altText })
└─ siteSettings SiteSettings { siteName, siteDescription, language, favicon, seo, appearance }

BaseSection { id, type, order, visible, props: Record<string,unknown>, styles: Record<string,unknown> }
  type ∈ header | hero | features | pricing | faq | cta | footer | custom-block
  (typed props per type via SectionPropsMap; validated by per-type Zod `AnySectionSchema`)
  custom-block.props.tree = BlockTree

BlockTree  { rootIds: string[], nodes: Record<id, BlockNode> }
BlockNode  { id, type, parentId, children[], props, style, responsive, visible, locked, hidden }
BlockType  layout(container,row,column,grid,stack,divider,spacer) | content(heading,paragraph,
           button,image,video,icon,badge) | interactive(form,input,textarea,checkbox,tabs,accordion) |
           composite(card,pricing-card,feature-card,review-card,faq-item,team-member) |
           navigation(navbar,footer,menu)
BlockNode.responsive: Record<breakpoint("sm".."2xl"), Record<token, value>>  ← already exists
```

The **block model already satisfies most of the "element" requirements** in the
brief: `id, type, parent, children, visibility, locked, responsive rules`. Missing
from the brief's element list: `position, size, rotation, z-index, opacity (as an
explicit field — currently just a style token), typography (a first-class field),
colors/borders/radius/shadows (currently raw style tokens), spacing, animation,
interaction, data binding, accessibility metadata, custom styles/behavior`.

---

## 4. Current persistence model

- Single source of truth: Zustand editor store. Persistence = storage layer only.
- `ProjectController` (framework-independent singleton) orchestrates
  create/open/switch/delete/rename/save; **transitions block when a dirty flush
  fails** (no silent data loss). `saveNow` is revision-aware; failed explicit
  saves surface `unsaved`/`error` honestly.
- `AutosaveCoordinator`: 3 s debounce, per-project scope, revision tracking
  (`highestScheduledRevision` / `currentlySavingRevision` /
  `lastSuccessfullySavedRevision`), single-flight saves, `saved` only when caught
  up.
- Adapter: `IndexedDbProjectAdapter` (with `fake-indexeddb` tests). Plus recovery
  snapshots (P9), thumbnails, P15 version history (server-side for workspace
  projects; content-hash dedupe, retention 50), P6 cloud sync for personal
  projects, `project-normalizer` + `project-migrations` for payload upgrades.
- **Payload format is the validated `Project` JSON** — also the export/import/
  template-package/portability format (P13). Any new model field must flow through
  the normalizer + migration path.

---

## 5. Current collaboration model

- One `Y.Doc` per workspace project; `collab-doc.ts` is a **generic JSON ↔ Yjs
  bridge** — objects→Y.Map, arrays→Y.Array, strings→Y.Text, numbers/bools→scalars,
  id-stable array diffing. It places **no constraint on the JSON shape**: a new
  element model is collaborative by construction once it is plain normalized JSON.
- The commit hook intercepts the editor store's single commit boundary
  (`withHistory`/`commitLocalProject`) → `reconcileProject(doc, next)` in one
  transaction with origin `local:{clientId}`. Observer → `toProject(doc)` →
  normalized Project → `applyRemoteProject`. Per-user undo via `Y.UndoManager`
  origins. Checkpoints persist the validated projection; sessions are
  server-authoritative; mock + Supabase transports share semantics (P16/P17/P18).
- Deletion-wins policy for structure; concurrent inserts survive deterministically;
  maintenance lock for restore/import; bounded offline queues; epoch guard;
  rate limits; size caps.

---

## 6. Current preview architecture

- **Editor canvas**: `Canvas` (browser frame, viewport widths 1440/768/390,
  zoom scale) → `themeToCSSVars` → `SectionRenderer` → `SelectableSection` wrappers
  → registry components. Inline-edit layer floats above.
- **Visitor preview**: `PreviewShell` (device presets phone/tablet/desktop/full,
  page switcher, link classification) → `VisitorPageView` (plain registry
  rendering, no overlays).
- **Share view**: sanitized projection for review.
- **Thumbnails**: headless render of the same registry components.
- **Export**: generated static site uses the *same* section component sources
  (transpiled to standalone components) — so editor preview ≈ export already for
  sections; blocks have two renderers (L15).

---

## 7. Current AI architecture

```
composer (LeftSidebar / CopilotPanel)
  → generation-service (create)      → POST /api/generate → Gemini | rule-based → GenerationPlan → project
  → edit-orchestrator (modify)       → POST /api/generate mode:"modify" → edited section props (validated)
  → plan-service (page/project)      → Gemini | rule-based → AiEditPlan → simulate + diffs → review → applyAiEditPlan
  → inline-suggestion-service        → single-field rewrite suggestion → updateEditableFieldValue
  → copilot-service                  → classify intent → ASK (deterministic) | PLAN-EDIT; context builder; memory
```

All providers: `GenerationProvider` / `EditProvider` / `PlanProvider` interfaces,
Gemini + deterministic rule-based fallback, Zod validation, bounded context,
sanitized prompts, no code execution, atomic undoable application, P20 rate limit
on the create/modify route.

---

## 8. Current routing / page architecture

- `Page.slug`; homepage = `pages[0]` always owns `/`.
- `routes.ts`: slug validation (lowercase/hyphens, reserved segments), route table,
  `resolveInternalHref` for cross-page links, `validateRoutingForExport`.
- Editor: `PageTabs` (add/rename/delete/reorder via `movePage`), `PageMetaDialog`
  (per-page SEO/social), site-wide `SiteSettingsDialog`.
- Export: one route file per page with per-page metadata; preview navigates via
  `classifyPreviewLink`.

---

## 9. Current publishing architecture

`PublishService` (validate project → export ZIP via `export-pipeline` → provider
deploy) → Vercel (server-only token, per-call owner auth, idempotency key,
10/min/project rate limit) / local / mock. Deployment records in IndexedDB,
rollback-with-confirmation, P19/P21 diagnostics. Publishing reads the live
projected content; never mutates it.

---

## 10. Current Supabase integration

Auth (Supabase Auth, anon-key-only client), workspaces + RBAC + presence +
activity + version history (P14/P15), collab update log + RPCs (P16), share/review
(P12), cloud sync (P6), shared libraries (P13). Pattern: RLS on private tables,
SECURITY DEFINER RPCs with `auth.uid()`, provider-boundary services behind
`getCloudEnvironment()`, mock HTTP parity for E2E. 9 additive migrations.

---

## 11. Gap analysis against the Canva-style vision

| Vision requirement | Status today | Gap | Severity |
|---|---|---|---|
| Everything is an element | Sections (typed props) + blocks (trees, custom-block only) | **Two systems; no universal element** | **Critical (foundation)** |
| Select / move / resize / rotate / align / layer / group / lock / hide | Section outline + duplicate/delete only | Full manipulation layer | **Critical (P22-B)** |
| Element-level styling (typography, colors, spacing, effects) | Per-section inspectors; empty general categories | Universal style inspector | **High (P22-C)** |
| Text editing (double-click, typography controls) | Double-click inline text exists (Phase M) | Rich typography controls | **High (P22-C)** |
| Buttons with real navigation ("Navigate to…") | Raw `href` strings | Typed link model + picker | **High (P22-G)** |
| Element library with drag-drop | Dialogs only; click/drag-to-structure | Drag-to-canvas library | **High (P22-D)** |
| Sections as editable elements | Sections reorderable/duplicable | Sections = root elements | **Medium** |
| Multi-page website system | Already multi-page + SEO | Set-homepage + nav config polish | **Low** |
| Responsive intelligence | Viewport frames; block `responsive` tokens (custom-block only) | Engine across all elements + AI | **High (P22-F)** |
| Interactions (click/hover/scroll) + animations as data | None | Declarative model | **High (P22-G)** |
| Preview fidelity (WYSIWYG) | High for sections; two block renderers | Single renderer | **Medium (P22-B/C)** |
| Canva-like UI shell | Fixed chat + inspector panels, developer-ish | Collapsible/resizable, minimal | **High (P22-K)** |
| AI element assistance | Section/page/project scopes | Element scope | **High (P22-H)** |
| AI generated element previews | Page/project plan review exists | Insert previews (accept/reject/customize) | **High (P22-H)** |
| AI site generation (multi-page + data model) | Single landing page | Site-level generation | **High (P22-I)** |
| AI context awareness | Section/page/project context exists | Element context | **Medium** |
| Theme system | Project-wide theme exists; AI theme resolver | Per-element token usage + AI themes | **Low-Medium** |
| Accessibility metadata in model | None on elements; alt text on assets | Model field + AI flagging | **Medium** |
| SEO per page | Full per-page SEO exists | Structured data | **Low** |
| Backend/data integrations | Supabase infra exists; no visual wiring | Visual service connect + data binding | **Later (P22-J)** |
| Custom code (safe, isolated) | None | Advanced opt-in surface | **Later** |
| Performance guardrails | Block/tree normalizer bounds; lazy collab | Element-count/render bounds | **Medium** |

**Strategic conclusion:** the repository already contains 80% of the *plumbing*
(store boundary, CRDT bridge, block ops engine, block tree model with
`responsive`, registries, multi-page routing, export pipeline, AI provider stack).
The transformation is: (1) **make the block/element tree universal**, (2) **build
the manipulation canvas**, (3) **build the style inspector**, (4) **add
interactions/responsive/AI layers on top** — without breaking P16–P21.

---

## 12. Proposed element/document architecture

### D1 — One element model: extend `BlockNode` (do not fork)

The Phase O design already states: *"A website is a tree of reusable visual
blocks. A Section becomes a specialized Container block."* We honor that. The
element model is an **additive superset of `BlockNode`** — new optional fields,
same core:

```ts
interface ElementNode {                       // extends BlockNode semantics
  // identity & structure (existing, preserved 1:1)
  id: string; type: ElementType; parentId: string | null;
  children: string[]; visible: boolean; locked: boolean; hidden: boolean;
  // content & styling (existing)
  props: Record<string, unknown>;             // content (text, href, src, …)
  style: Record<string, unknown>;             // style tokens (existing system)
  responsive: Record<Breakpoint, Record<string, unknown>>;  // existing
  // NEW — geometry (freeform mode only; "auto" = document flow)
  geometry?: { mode: "flow" | "absolute";
               x?: number; y?: number; width?: number; height?: number;
               rotation?: number; zIndex?: number };
  // NEW — metadata (declarative, validated, no raw JS)
  animation?: { trigger: "load"|"scroll"|"hover"|"click"|"viewport";
                type: "fade"|"slide"|"scale"|"bounce"|"reveal"|"blur"|"rotate"|"custom";
                durationMs?: number; delayMs?: number; easing?: string;
                repeat?: "none"|number|"infinite"; direction?: "normal"|"reverse"|"alternate" } | null;
  interaction?: {
    click?: ElementAction; hover?: HoverEffect; scroll?: ScrollEffect;
  } | null;
  binding?: { field?: string; source?: "page"|"project"|"collection";
              collectionId?: string; path?: string } | null;
  a11y?: { alt?: string; label?: string; role?: string; ariaHidden?: boolean } | null;
  // NEW — custom code (advanced, opt-in, sandbox-safe)
  customCode?: { css?: string; js?: string; html?: string; attributes?: Record<string,string> } | null;
}
```

**Element types** = the existing `BlockType` union (layout/content/interactive/
composite/navigation) extended by the vision's missing categories (media:
gallery, carousel, video; commerce: product-card, product-grid, cart, checkout,
price; advanced: modal, tabs, accordion, slider, map, custom). New types register
through the existing `BlockRegistry` (definition: defaults, nesting rules,
`resizePolicy`, editable fields, keywords, category) — **no new registry system**.

Rules:
- `geometry.mode` defaults to `"flow"` — the tree renders in document flow
  (responsive-safe). `"absolute"` is an explicit freeform choice, stored as data,
  never inferred.
- All new fields are optional → old documents remain valid (normalizer + schema
  updated to allow/ignore).
- No executable code in the model; `customCode` is data, executed only by the
  **publishing/render sandbox** under an explicit advanced flag (see §17/§21).

### D2 — Sections become element trees (incremental, not a rewrite)

Keep the durable top-level shape (`page.sections[]`) so routing, version history,
collaboration, templates, generation, import/export and portability are untouched.
Each section gains an optional **element tree**:

```ts
interface SectionElement {                    // "section" = root-level element
  id: string; type: ElementType;              // e.g. "hero" | "container" | "navbar"
  order: number; visible: boolean;
  locked?: boolean;
  tree?: ElementTree;                          // NEW — present when materialized
  props?: Record<string, unknown>;             // LEGACY — kept for back-compat + validation
  styles?: Record<string, unknown>;            // LEGACY
}
```

- **Rendering priority:** a section with `tree` renders through the universal
  `ElementRenderer`; a legacy section (props only) renders through the existing
  registry components until materialized.
- **Materialization:** `sectionToBlockTree`/`blockTreeToSection`
  (`src/features/blocks/adapters/section-block-adapter.ts` — already exists and is
  tested) convert typed props → element tree. Template/generation/import continue
  emitting props-based sections; the first edit in a section can materialize it
  (or generation emits trees directly from P22-I).
- **Presets become tree factories:** each section registry entry gains
  `createSectionTree(type) → ElementTree` alongside `createProps()`. Over time the
  typed-props path is reduced to a compatibility shim.

### D3 — One renderer for editor, preview, thumbnail, and export

- `ElementRenderer` (evolved from `BlockRenderer`) renders any `ElementTree`
  from the element registry, resolving: style tokens + `responsive` overrides
  (`resolveResponsiveCss` — existing) + geometry (flow vs absolute) + animation/
  interaction data + safe link/image policies (existing).
- The export generator for trees replaces `custom-block-generator` with the
  **same** render logic (code generation from the same pure resolution functions:
  `elementCss(node, viewport)` shared by canvas and exporter — eliminating L15).
- Editor overlays (selection, handles, inline edit) are a **wrapper layer** around
  `ElementRenderer`, never baked into the render itself — visitor preview,
  thumbnails and export get identical markup/styles by construction.

---

## 13. Responsive architecture

- **Already present and reused:** per-node `responsive: { breakpoint → token
  overrides }`, `RESPONSIVE_BREAKPOINTS` (sm/md/lg/xl/2xl), `resolveResponsiveCss`
  (min-width merge, later wins), `mediaQueryForBreakpoint`, viewport state in the
  editor store, and the exporter's `useViewportWidth` pattern.
- **Extension (P22-F):** responsive becomes a first-class property set available
  on **every** element (font-size, gap, columns, padding, layout mode), edited
  through simple inspector controls ("Desktop / Tablet / Mobile") that write
  `responsive` entries — no CSS media queries exposed to beginners.
- **Responsive intelligence:** a pure analysis layer inspects a page's tree and
  proposes *responsive decisions* (e.g., "4-column grid → 2-column on tablet,
  horizontal carousel on mobile"). A decision is a small data object
  (`{ elementId, breakpoint, transformation, appliedBy: "ai"|"user" }`) that is
  **persisted explicitly** in the document. User overrides (e.g., "keep 2-column
  grid on mobile") always win — the proposal system records them and never
  re-suggests the opposite.
- **No whole-canvas scaling:** desktop/tablet/mobile viewports re-run the same
  element resolution with different widths (already the editor model).

---

## 14. Canvas architecture

- **Selection layer:** a `SelectionOverlay` wrapper around `ElementRenderer` shows
  the bounding box, 8 resize handles, a rotation handle, and a floating context
  toolbar (duplicate/delete/lock/hide/layer/AI). Multi-select (shift-click, marquee)
  is a later sub-phase; single-element first.
- **Interaction model:** pointer-event based drag/move/resize/rotate using the
  existing store mutation boundary (`updateElementGeometry` → one history entry →
  collab reconcile automatically). No new manipulation library required (dnd-kit
  already available for library drag + panel reorder). Resize honors the element
  registry's `resizePolicy` (`none|fixed|fluid` — already modeled).
- **Drag from library:** reuse the existing dnd-kit pattern (`BlockBrowserDialog`,
  `MyBlockDndProvider`) for drag-from-library onto canvas with **insertion
  feedback** (reuse `InsertionPoint`/`MyBlockDropZone` visual conventions).
- **Panels:** left panel (Elements / Pages / Assets), right panel (Inspector),
  both **collapsible and draggable-resize** (pointer-based; persisted in
  `editor-ui-store`/prefs). Maximize-canvas mode. Layers/tree view reuses
  `BuildTreePanel`/`PageStructurePanel` patterns.
- **Keyboard shortcuts:** extend `useKeyboardShortcuts` (copy/paste, duplicate,
  delete, arrows + shift, group/ungroup) — many handlers already exist for
  sections/blocks.
- **Text editing:** keep the double-click `EditableText` pattern and route all
  text commits through the element tree (field paths instead of section props).

---

## 15. Interaction architecture

- **Typed navigation target** replaces raw `href` for user-authored links:

```ts
type ElementAction =
  | { kind: "navigate"; target: NavTarget }
  | { kind: "scroll-to"; elementId: string }
  | { kind: "open-modal"; elementId: string }
  | { kind: "toggle"; elementId: string }
  | { kind: "open-menu"; elementId: string }
  | { kind: "start-animation"; elementId: string; animationId?: string }
  | { kind: "change-image"; elementId: string }
  | { kind: "submit-form"; formId: string }
  | { kind: "custom"; handlerId: string };   // advanced, sandbox-registered only

type NavTarget =
  | { kind: "page"; pageId: string }          // resolved via computePageRoutes
  | { kind: "section"; pageId?: string; sectionId: string }
  | { kind: "external"; url: string }
  | { kind: "email"; to: string }
  | { kind: "phone"; number: string }
  | { kind: "back" };
```

- The **"Navigate to…"** picker writes `NavTarget`; resolution reuses
  `resolveInternalHref` + `classifyPreviewLink` + `computePageRoutes` (existing,
  tested) to produce the final `href`/behavior at render and export time.
- Hover effects and scroll effects are declarative data (color/scale/shadow/
  animation presets) validated against an allow-list — never raw JS by default.
- Rendering of interactions: `ElementRenderer` maps data → safe React handlers;
  the export generator emits the equivalent client-safe code.

---

## 16. AI architecture

- **Element scope:** extend `AiEditPlan` operations to target `elementId`
  (update element props/style/responsive/animation/interaction; insert/delete/
  duplicate element subtrees). The existing plan pipeline (simulate → diff →
  review → atomic apply) is reused unchanged; only the operation vocabulary grows.
- **AI element previews:** the "add a product card" flow produces a preview
  (context-aware suggestion), with **Accept / Reject / Customize / Ask AI to
  modify** — reusing the `AiEditPlanReview` review UI.
- **AI context:** `buildCopilotContext` already includes page/section/field; extend
  with the selected element subtree + theme + pages list so instructions like
  "make the button on the homepage open checkout" resolve correctly.
- **Responsive AI:** uses the §13 decision system (proposals + user override wins).
- **Site generation (P22-I):** a new `mode:"site"` plan produces pages + sections +
  navigation + a basic data model (collections) through the existing project
  factory + templates; each generated page uses existing page CRUD.
- **AI theme recommendations:** reuse `theme-resolver` + plan apply to update the
  project-wide `Theme`.
- All AI output stays **data-only** (validated by Zod), atomic, undoable, and
  subject to the existing permission gate.

---

## 17. Integration architecture

- **Provider pattern is already the norm** (workspaces, sharing, cloud, publish).
  P22-J adds a *visual integration* layer: "Add Supabase" → guided flow that
  configures connection (env/server-side), tables (via existing migrations), auth,
  storage, and API routes — mirroring the existing mock/Supabase provider split
  and E2E parity harness. Secrets remain server-only (P20 rule).
- **Data binding:** `ElementNode.binding` maps element fields → data sources
  (page metadata, project assets, collections). A collection model
  (`{ id, name, fields }`) is added to the document; binding resolves at render/
  export time through a resolver (like `asset-resolver`).
- **Payments/email/analytics** follow the same connect-and-configure pattern when
  scoped (P22-J or later); each integration ships the P20/P21 security posture
  (bounded codes, no secrets in client, rate limits where server-side).
- **Custom code (advanced, opt-in):** `customCode` is stored as data; executed
  only at publish-time inside a sandboxed iframe (publishing container), never in
  the editor, with explicit enablement and clear warnings. Editor preview shows a
  placeholder for un-enabled custom code.

---

## 18. Migration strategy

1. **Additive schema, versioned.** New fields (`tree`, `geometry`, `animation`,
   `interaction`, `binding`, `a11y`, `customCode`, `collections`) are optional.
   `project-migrations.ts` bumps the payload version; `project-normalizer.ts`
   and the Zod schemas (`AnySectionSchema`, block/plan schemas) are extended.
2. **Read-old/write-new.** Legacy sections render via the registry until
   materialized; materialization is lazy (on first element edit) and never
   destructive (the tree round-trips through `sectionToBlockTree`/`blockTreeToSection`
   with lossless tests).
3. **No schema/data rewrite of durable state.** Workspace payloads, version
   snapshots, exported packages, and recovery snapshots keep their format; the
   normalizer upgrades in memory. Old clients/projects keep working (P16
   backward-compat precedent).
4. **Collab is shape-agnostic** (§5): new fields flow through `reconcileProject`
   with zero changes to the CRDT bridge. Tree-normalizer bounds/clamps the new
   fields (geometry clamping, animation allow-lists) before projection.
5. **Export keeps both paths** during transition: legacy section components for
   props-sections, the unified `ElementRenderer` code-gen for trees. The export
   validator gains rules for the new fields.
6. Every migration step lands with unit + component tests; no step renames or
   removes existing fields.

---

## 19. Backward compatibility strategy

- Personal projects, workspace projects, templates, personal templates, template
  packages, My Blocks, shared libraries, code-import results, cloud-sync payloads,
  and share projections all open unchanged (fields optional; normalizer tolerant).
- All existing E2E specs (editor, guided-builder, inline-editing, my-blocks,
  workspaces, realtime-*, publishing, export, thumbnails, pages, share) must stay
  green; existing data-testids preserved where the UI is restructured.
- The editor store API keeps every existing action; new element actions are
  additive. `applyBlockOperation` remains the validated mutation engine; element
  ops are an extension, not a replacement.
- Guided mode (Phase N) continues to work for beginners; the Canva layer is
  advanced-by-default for new projects and progressively revealed.
- Feature-flag the new canvas behind `experienceMode` (extend the existing
  guided/advanced switcher) so rollback is a flag flip, not a revert.

---

## 20. Testing strategy

- **Unit (vitest):** element model normalizer/clamps; geometry resolution; element
  ops engine (insert/delete/move/duplicate/group); responsive resolution + decision
  persistence + user-override-wins; navigation target resolution; interaction
  allow-list validation; animation validation; binding resolver; section↔tree
  round-trip (lossless); migrations (old payload → new, new → old).
- **Component (testing-library):** selection overlay, resize/rotate handles,
  inspector controls, element library drag, layers panel, "Navigate to…" picker,
  AI element preview (accept/reject/customize), responsive controls.
- **Collab tests:** element ops merge, concurrent geometry edits, delete-wins on
  element subtrees, per-user undo of an element op, offline queue with element
  trees — extending the existing `collab-doc.test.ts` patterns.
- **E2E (Playwright, chromium, workers=1):** new specs for element selection/
  manipulation, drag-from-library, inspector styling, multi-page nav via the
  picker, responsive viewport parity, AI element edit; plus the full existing
  regression set. Deterministic timing (existing helpers — no arbitrary sleeps).
- **Export-build:** extend `test:export-build` to build a site containing element
  trees and assert the built output matches the editor preview rendering
  (WYSIWYG gate).
- **Property/invariant tests:** seeded random element-op sequences (same PRNG
  approach as existing structure tests) — tree invariants hold after every prefix.
- Gate sequence (unchanged convention): `tsc --noEmit` → `lint` → `vitest` →
  `build` → affected E2E → matrix → fallback → export-build → full E2E
  sequentially.

---

## 21. Security implications

- **No new client-trusted inputs:** element data is validated/normalized at the
  same boundaries (store commit, projection, export validator) as today. Geometry/
  animation/interaction fields are clamped and allow-listed; URLs pass the existing
  safe-link/image policies; prototype-pollution keys already stripped by the JSON
  walkers and normalizer.
- **Custom code is the new risk surface:** stored as inert data; executed only at
  publish inside a sandboxed iframe (no parent access, `sandbox` attrs, CSP
  inside the iframe); never executed in the editor or share views; requires an
  explicit advanced toggle; size-capped; audited as a separate security review
  item before P22 ships it (it is NOT in the initial P22-A..L scope).
- **RLS / authz unchanged.** Element edits flow through the editor store gate
  (workspace permission model, P14/P16) and the collab server gates; viewers can
  never mutate.
- **AI prompts/plans** keep the existing sanitization + Zod validation +
  `scanPayloadForSecurityIssues` + bounded context; no new exfiltration surface.
- **Logging** follows P19/P21 rules (bounded codes + allow-listed identifiers,
  never element content).
- Rate limits and size caps extend to any new API surface (none planned in the
  first sub-phases; site-generation uses the existing `/api/generate` limiter).

---

## 22. Performance implications

- **Rendering:** `ElementRenderer` memoizes per-node; the existing store
  subscription granularity is preserved (no whole-project re-render per
  keystroke). Element counts bounded by the existing tree normalizer (≤ 1,000
  nodes, depth ≤ 12) extended with geometry/animation caps.
- **Canvas manipulation** uses pointer events with rAF throttling; geometry
  commits are single history entries (collab = one reconcile transaction).
- **Lazy loading:** the manipulation canvas, element library, and new AI scopes
  load lazily like the collab module (existing dynamic-import pattern). Bundle
  impact of the new UI is kept behind code-splitting.
- **Export:** generated code reuses shared component code (no per-element bloat);
  lazy images (`loading="lazy"` — existing), no runtime JS when static
  interactions suffice.
- **Collab:** element ops produce minimal diffs (id-stable Yjs arrays); no
  whole-document replacement (architecture invariant).
- **Thumbnails:** unchanged (render the same tree, headless).
- Benchmarks: element-tree hydration target < existing section hydration; new
  overhead per element render < a few µs (memoized style resolution).

---

## 23. Risks

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | Two render systems drifting (legacy section components vs ElementRenderer) during transition | Priority order: universal renderer first (D3); legacy components only for un-materialized sections; WYSIWYG export-build gate |
| R2 | Element tree + typed props divergence after materialization (edits in one not reflected in the other) | Materialization is one-way and lazy; `tree` is authoritative once present; round-trip lossless tests; legacy path reads `props` only until materialized |
| R3 | Collab merge regressions with new fields | Shape-agnostic Yjs bridge + normalizer clamp tests + existing collab E2E re-run; new element-op merge tests |
| R4 | Scope creep — P22 becomes "build all of Canva" in one pass | Strict sub-phase plan (§24), each with its own exit criteria; every sub-phase lands with tests and no weakening of existing gates |
| R5 | Breaking the guided/beginner path | New canvas is opt-in via experience mode; guided mode unchanged; E2E for both |
| R6 | Export regression (new fields break generated sites) | Export validator extended; `test:export-build` includes element-tree sites |
| R7 | Performance of live geometry edits | rAF throttle + single transaction per gesture; perf instrumentation (`recordPerf`) |
| R8 | Custom code security (if/when added) | Not in initial scope; separate security review before enabling (see §17/§21) |
| R9 | AI quality for element/site generation | Reuse existing fallback + validation + review UX; deterministic rule-based fallbacks for every new AI surface |
| R10 | Persistence/version-history payload growth | New fields optional; normalizer clamps; version retention unchanged (50) |

---

## 24. Phased implementation plan

Order adapted to the repository (the block/element foundation already exists, so
the canvas layer can come early). Each sub-phase ends green on the full gate
sequence and ships its own tests; the architecture is reviewed after this doc
before P22-A begins.

| Sub-phase | Scope | Exit criteria |
|---|---|---|
| **P22-A — Element model foundation** | Extend `BlockNode` → `ElementNode` (geometry/animation/interaction/binding/a11y fields, optional); extend block registry with new element types + categories; extend normalizer/schemas/migrations; `SectionElement.tree` + materialization via existing adapter; element ops engine (extend `applyBlockOperation`) | Unit/invariant/collab tests; old projects open unchanged; tsc/lint/unit/build green |
| **P22-B — Canvas selection + manipulation** | `ElementRenderer` (universal, replaces BlockRenderer usage); selection overlay + resize/rotate/move handles; element store actions (geometry) through `withHistory`; layers panel; keyboard shortcuts; WYSIWYG export for trees | Component + E2E (select/move/resize/rotate/layer/shortcuts); export-build parity test green |
| **P22-C — Typography + styling inspector** | Universal style inspector (typography/color/spacing/effects) reading/writing element `style` + theme tokens; per-element text editing (extend inline editing to tree field paths); responsive-aware inspector controls | Component tests + E2E styling flow; legacy inspectors untouched |
| **P22-D — Sections + element library** | Sections as root elements; library categories + search + drag-to-canvas with insertion feedback; section presets as tree factories | E2E drag-drop; section materialization tests |
| **P22-E — Multi-page polish** | Set-homepage, page reorder UX, navigation config surfaced in the "Navigate to…" picker (page targets); nested routes where supported | E2E navigation flows; routing tests |
| **P22-F — Responsive engine** | Responsive props on all elements; inspector breakpoint controls; responsive intelligence (proposals + user-override-wins persisted); responsive AI | Unit (decision system) + E2E viewport parity |
| **P22-G — Interactions + animations** | Typed `NavTarget` + picker; hover/scroll effects; animation data + render; export emission | Unit (resolution) + component + E2E |
| **P22-H — AI element editing** | Element-scoped plans; AI element previews (accept/reject/customize); element context in copilot | Unit (plan ops) + E2E AI flows; copilot regression |
| **P22-I — AI page/site generation** | `mode:"site"` generation (pages + nav + sections + basic collections); page generation consistent with theme | E2E generation; export-build |
| **P22-J — Backend/data integrations** | Visual "Add Supabase" flow + data binding resolver + collections (scoped); secrets server-only | Security review + E2E with mock parity |
| **P22-K — Premium Canva-style UI polish** | Collapsible/resizable panels; minimal shell; empty states; polish pass; accessibility | Design QA + a11y checks + full E2E regression |
| **P22-L — Production validation** | Full gates + E2E matrix + fallback + export-build + security/observability review; P22 report | All gates green; `docs/phase-p22-report.md` |

Non-goals for P22 (explicit): full freeform absolute-positioned design as the
default (flow-first), real-time cursor sharing, custom-code execution (deferred),
payments/email/analytics integrations beyond the pattern, multi-instance rate
limiting, and **any P23 work**.

---

## 25. Files/modules likely to change (by sub-phase)

- **P22-A:** `src/types/blocks.ts` (or new `src/features/elements/types.ts`),
  `src/features/blocks/engine/block-operations.ts`, `registry/*`,
  `src/features/persistence/services/project-normalizer.ts`,
  `project-migrations.ts`, `src/features/editor/schemas/section-schemas.ts`,
  `src/features/collaboration/crdt/tree-normalizer.ts`,
  `src/features/blocks/adapters/section-block-adapter.ts`.
- **P22-B:** `src/features/blocks/render/BlockRenderer.tsx` (→ ElementRenderer),
  new `src/features/elements/canvas/*` (selection overlay, handles, geometry
  actions), `src/features/editor/store/editor-store.ts` (additive actions),
  `src/components/editor/Canvas.tsx`, `RightSidebar.tsx`,
  `src/features/editor/components/PageStructurePanel.tsx`,
  `src/features/blocks/components/BuildTreePanel.tsx`,
  `src/features/export/generators/section-generators/custom-block-generator.ts`.
- **P22-C:** new `src/features/elements/inspector/*`, `inline-editing/*`
  (field paths into trees), `src/components/editor/RightSidebar.tsx`.
- **P22-D:** `src/features/editor/registry/section-registry.ts`,
  `section-library/*`, new `src/features/elements/library/*`, `AddSectionDialog.tsx`.
- **P22-E:** `PageTabs.tsx`, `page-structure.ts`, `routes.ts`,
  `src/features/preview/engine/navigation.ts`.
- **P22-F:** `src/features/blocks/render/block-style-to-css.ts` (extended),
  new `src/features/elements/responsive/*`, editor viewport wiring.
- **P22-G:** new `src/features/elements/interactions/*`, `navigation` targets,
  `ElementRenderer` handlers, export emission.
- **P22-H:** `ai-editing/plan-types.ts`, `plan-schemas.ts`, `plan-simulator.ts`,
  `planner/*`, `ai-copilot/context/context-builder.ts`.
- **P22-I:** `generation/` (new site mode), `api/generate/route.ts` (schema
  extension), `generation/types/generation-plan.ts`, `templates/*`.
- **P22-J:** new `src/features/integrations/*`, `binding` resolver,
  `supabase/migrations/<next>_*.sql` (additive).
- **P22-K:** `src/components/editor/{TopNav,LeftSidebar,RightSidebar,Canvas,StatusBar}.tsx`,
  `editor-ui-store.ts`, `globals.css`, prefs.
- **P22-L:** docs/report, config, validation only.

## 26. What should NOT be changed (do not weaken)

1. **P16–P21 collaboration semantics** — Yjs bridge, commit hook, checkpoint
   model, per-user undo, offline queues, epoch guard, maintenance lock, RLS/RPCs.
2. **Persistence invariants** — dirty-flush blocking transitions, revision-aware
   saves, autosave single-flight, safe delete order, recovery/thumbnails.
3. **Workspace/share/cloud authorization** — RBAC, `auth.uid()` actors, share
   token hashing, permission gates, cross-workspace isolation.
4. **Security infrastructure** — rate limits, security headers, bounded logging,
   secret boundaries, validation of AI output, prototype-pollution guards.
5. **Multi-page routing model** — homepage = `pages[0]`, slug rules, export
   route files, `resolveInternalHref`/`classifyPreviewLink`.
6. **The existing store mutation boundary** (`withHistory`/`commitLocalProject`)
   and the `applyBlockOperation` validated-ops engine — new element ops extend,
   never bypass.
7. **Existing tests and data-testids** — no weakening; no removal to simplify.
8. **The registry/schema/provider patterns** — new systems reuse them.
9. **Guided mode, inline editing, AI plan review, publishing flows, share**
   — preserved for compatibility; at most additive enhancement.
10. **No speculative P23 work.**

---

## 27. Completion criteria (for the whole phase)

- Element model foundation (P22-A) landed with unit/invariant/collab tests; old
  projects open unchanged.
- Canvas manipulation (P22-B) with WYSIWYG export parity.
- Style inspector, library, responsive, interactions, AI element/site layers
  landed per sub-phase with their tests.
- tsc/lint/unit/build + affected E2E + matrix + fallback + export-build + full
  E2E all green at every sub-phase gate.
- P16–P21 test counts never decrease; no authorization/security weakening.
- `docs/phase-p22-report.md` written; implementation boundary reviewed before
  P22-A begins.

---

## 28. STOP — implementation boundary

Per the phase brief, **implementation does not begin from this document alone.**
The audit, gap analysis, and architecture above are submitted for review. The
next step is to review and approve the architecture (especially D1/D2/D3 and the
P22-A..L order), after which P22-A can start with a defined implementation
boundary.
