# Phase P24-C — Broader Custom-Code Authoring & Section-Tree Export

**Type:** Formal specification (design record, written before implementation).
**Anchored on:** `PROJECT_FULL_CONTEXT.md` + checkpoint `d9ddb42` — *feat: implement durable universal element trees (P24-B)*.
**Branch:** `phase-p22-canva-elements`.
**Status:** `SPECIFICATION — awaiting review`. Nothing in this document is implemented.
**Provenance:** Every constraint, symbol and line reference below was verified against the working tree at `d9ddb42`. Items that are inference rather than verified fact are explicitly marked **[inference]**.

---

## 0. Why this phase exists

P23 shipped custom code as a **safe, sandboxed, opt-in, data-only** capability, but deliberately scoped *authoring* to a curated set of leaf blocks inside `custom-block` sections. That deferral is recorded verbatim in two places:

- `docs/phase-p23-architecture.md` §10: *"Custom-code authoring is scoped to the curated leaf blocks inside `custom-block` sections (the durable element-tree surface). Broader authoring (any element, any section) requires durable universal element trees — **P24**."*
- `docs/phase-p23-report.md` §8: *"Broader authoring (any element, any section) | **FOLLOW-UP** | P24 — requires durable universal element trees."*

P24-B (`d9ddb42`) delivered that prerequisite: `BaseSection.tree?: ElementTree` is now durable through the store, schemas, persistence, normalizer, CRDT, and distribution stripping. P24-C consumes that enablement: **custom code becomes authorable on any renderable element in any section, and durable section trees are actually emitted by the export pipeline.**

---

## 1. Objective & boundaries

### 1.1 Objective (one sentence)

Extend custom-code **authoring** from the seven curated leaf types to **all renderable element types** inside durable universal element trees, and extend the **export pipeline** so custom code stored on a durable `section.tree` is emitted as validated sandboxed srcdoc via the existing `CustomCodeFrame` — without changing the sandbox capability model, without touching the legacy `BlockTree` in `custom-block` sections, and without ever executing custom code on the editor canvas.

### 1.2 In scope

| # | Scope item | Anchor |
|---|---|---|
| S1 | Broaden authoring capability from `CUSTOM_CODE_LEAF_TYPES` (7 types) to **all renderable element types**. | `src/features/elements/registry/element-registry.ts` (`CUSTOM_CODE_LEAF_TYPES`, `deriveElementDefinitionFromBlock`, `elementSupportsCustomCode`, `isRenderableElementType`) |
| S2 | Mount `ElementInspectorPanel` for **any section** while an element is selected, so the Custom Code section is reachable outside `custom-block`. | `src/components/editor/RightSidebar.tsx:241` mount gate; `src/features/elements/inspector/schemas.ts:75` field gate |
| S3 | Detect and emit durable `section.tree` custom code in the export pipeline using the existing sandboxed `CustomCodeFrame`. | `src/features/export/generators/page-generator.ts`, `src/features/export/generators/section-generators/custom-block-generator.ts`, `src/features/export/pipeline/export-pipeline.ts` |
| S4 | Verify (and only change if a gap is proven) that distribution stripping covers `section.tree` on every section type. | `src/features/code-import/services/strip-custom-code.ts` |
| S5 | Preserve every P23 security property and every P24-B durability property unchanged. | §5, §6 |

### 1.3 Out of scope (explicit non-goals)

1. **No change to the legacy `BlockTree` inside `custom-block` sections.** `props.tree`, `buildCustomCodeSrcdocsForSection`, `customBlockSectionForExport` and the whole-tree fold keep their current behaviour byte-for-byte.
2. **No client-side execution on the main editor canvas.** The editor canvas, visitor preview, share views and thumbnails continue to render the inert placeholder owned by `src/features/blocks/render/BlockRenderer.tsx`. The *only* in-editor execution point remains the explicit opt-in `CustomCodePreview`.
3. **No change to the sandbox capability model.** `sandbox-policy.ts` stays `allow-scripts` only; the CSP in `constants.ts` (`SANDBOX_CSP`) is unchanged; no `allow-same-origin`, no `unsafe-eval`.
4. **No new field, no new collection, no new integration, no AI feature, no publishing change.** No dependency changes (`package.json` zero diff).
5. **No weakening of P16–P24-B invariants** (collaboration semantics, persistence invariants, dual-schema declaration, distribution stripping, no-op history discipline).
6. **Not** a redesign of the custom-code payload, its caps, or its attribute grammar.

---

## 2. Verified baseline — the current restrictions

All line references are from `d9ddb42`. The right-hand column is the enforcement site that P24-C must change (or must deliberately preserve).

| # | Restriction | Current enforcement location | Why it exists | What P24-C changes |
|---|---|---|---|---|
| R1 | Only 7 leaf block types are eligible for custom code | `element-registry.ts:37-45` `CUSTOM_CODE_LEAF_TYPES`; consumed at `element-registry.ts:77` (`supportsCustomCode: CUSTOM_CODE_LEAF_TYPES.has(definition.type)`); read back by `elementSupportsCustomCode` (`:166-168`) | P23-D chose an explicit, never-broad opt-in surface | **Replace the leaf allow-list with a renderable-type predicate** (§3 D1) |
| R2 | The inspector only renders the Custom Code group for eligible types | `inspector/schemas.ts:75` — `if (elementSupportsCustomCode(type))` pushes the `custom-code` section | Single authoritative gate for the authoring UI | Follows R1 automatically (no second allow-list) |
| R3 | The universal `ElementInspectorPanel` is mounted **only** for `custom-block` sections | `RightSidebar.tsx:241-242` — `if (section.type === CUSTOM_BLOCK_SECTION_TYPE) return <ElementInspectorPanel … />` | P22-C preserved the existing per-type inspector E2E surface for regular sections | **Mount for any section while an element is selected**, falling back to the existing per-type inspector otherwise (§3 D2/D3) |
| R4 | Element selection is **not** in the editor store | No `selectedElementId` exists anywhere in `src/` or `e2e/` (verified by repo-wide search). The only selection state is transient: `useCanvasInteractionStore.selection: SelectionState` + `anchorId` (`src/features/canvas/store/canvas-interaction-store.ts:38-41`) | P22-B deliberately kept selection *transient* ("state that must NEVER be persisted or synchronized") | **Derive the "element is selected" signal from the canvas interaction store** — do not add durable selection state (§3 D2) |
| R5 | Element schema already accepts `customCode` on **every** node type | `element-schemas.ts:363` — `customCode: ElementCustomCodeSchema.optional()` on `ElementNodeSchema` | P22-A modelled the field universally | **No change** — documented as already-supported (category A) |
| R6 | The ops engine already accepts custom code on any element | `element-operations.ts:747-773` `updateElementCustomCode` (validates through `ElementCustomCodeSchema`) | Universal metadata op | **No change** |
| R7 | Persistence / CRDT / normalizer already preserve or clamp tree custom code on any type | `element-normalizer.ts`; `persistence/services/project-normalizer.ts`; `collaboration/crdt/tree-normalizer.ts` | P24-B normalisation boundaries | **No change** |
| R8 | Distribution stripping already covers `section.tree` on **any** section type | `strip-custom-code.ts` — `stripCustomCodeFromProject` calls `stripCustomCodeFromTreeRecord(props?.tree)` for `custom-block` **and** `stripCustomCodeFromTreeRecord((section as {tree?: unknown}).tree)` for every section | P24-B hardening case *"strips customCode from durable section trees on ANY section type (P24-B)"* | **Verification only** (§4 R6) — add coverage tests, change code only if a gap is proven |
| R9 | Export emits custom code **only** from `custom-block` `props.tree` | `page-generator.ts:235-240` + `page-generator.ts:486-563` (`customBlockSectionForExport`, `buildCustomCodeSrcdocsForSection`, `serializeSrcdocsForExport`); only `custom-block-generator.ts` contains a tree renderer (`NodeView`, `CustomCodeFrame`) | P23-C wired the one tree location that existed | **Extend to durable `section.tree` on any section type** (§3 D4) |
| R10 | Regular section generators are **props-driven and have no tree path at all** | `src/features/export/generators/section-generators/index.ts` — `sectionGenerators` maps `header/hero/features/pricing/faq/cta/footer/custom-block`; `hero-generator.ts:24` is `Hero({ headline, subheadline, … })`; repo-wide search: `tree` appears in **only** `custom-block-generator.ts` | P22 export parity for element trees was realised through the custom-block renderer only | **This is the largest piece of work in P24-C** — a tree-capable emission path for non-custom-block sections (§3 D4) |

### 2.1 The trap that shapes the export design (verified)

`section-element-adapter.ts:41-49` defines:

```ts
const ELEMENT_ONLY_NODE_KEYS = ["geometry","viewport","animation","interaction","binding","a11y","customCode"] as const;
```

and `elementTreeToBlockTree(tree)` (`:125-136`) deep-strips exactly those keys, i.e. **it deletes `customCode`**.

Consequence: the obvious low-risk reuse — "convert the durable `section.tree` with `elementTreeToBlockTree()` and feed it to the existing `CustomBlock` renderer" — would **silently drop the custom code that P24-C exists to export** (and also drop geometry/animation/binding). Decision D4 below therefore requires an export-specific projection that **preserves** `customCode` (and anything else needed for fidelity), not the general downcast. This is an implementation trap, not a design preference; it must be covered by a dedicated test.

---

## 3. Design decisions

### D1 — Capability becomes a *renderable-type* predicate, not a leaf allow-list

`elementSupportsCustomCode(type)` becomes true for every type that is **registered and renderable/durable**. The existing helper for that already exists and is documented as safe for server-side validation:

```ts
// element-registry.ts — already present at d9ddb42
export function isRenderableElementType(type: string): boolean {
  if (isElementOnlyType(type)) return false;   // text, logo, list, carousel, product-card, price, section, custom-component
  return elementRegistry.has(type);
}
```

- **Allowed:** every block-derived, renderable, durable element type (the full Phase-O block catalogue, not only the 7 current leaf types).
- **Explicitly still excluded:** element-only types (`text`, `logo`, `list`, `carousel`, `product-card`, `price`, `section`, `custom-component`) — they have registry definitions and inspector schemas but **no renderer and no durable persistence path** (`isRenderableElementType` returns `false` by design, and the same exclusion governs AI element insertion). Emitting custom code for a node the export pipeline cannot render would produce dead srcdoc.
- `CUSTOM_CODE_LEAF_TYPES` is **replaced** (not supplemented) so there is exactly one capability source of truth. All existing P23-D/P23-E/P23-F tests that assert leaf-only behaviour must be **updated deliberately** (their intent changes), never silently deleted.
- **Preserved from P23:** the capability remains opt-in at the *payload* level (`enabled === true` is the only runtime switch) and custom code remains inert data everywhere except the sandboxed frame.

**Open decision for review (D1-a):** whether the now-broad capability needs an *authoring* guard beyond the registry flag — e.g. hide the group for container elements whose children render independently, or for non-leaf composites where a frame-wrapping iframe changes layout. §10 Q1.

### D2 — Element selection is read from the transient canvas store

`selectedSectionId` (editor store) and `useCanvasInteractionStore.selection` (canvas store) are two different, deliberately separated concerns. P24-C introduces a **derived**, read-only "selected element within the selected section" signal in the UI layer:

- Source of truth: `useCanvasInteractionStore.selection` / `anchorId`.
- Resolution: the selected element id must belong to the currently selected section's durable tree; ambiguous/empty selections fall through.
- **No new durable state**, no new persisted field, no editor-store API addition that a collaborator would need to merge.

### D3 — Mount the universal inspector for any section *while an element is selected*

`RightSidebar.tsx` gains one branch, ordered so the existing surface wins whenever there is no element selection:

1. `guided` → `GuidedInspector` (unchanged, highest priority).
2. `custom-block` → `ElementInspectorPanel` (unchanged — always, regardless of element selection).
3. **new:** any other section **with an active element selection inside its durable tree** → `ElementInspectorPanel`.
4. otherwise → the existing `inspectorRegistry` per-type inspector (unchanged).

Requirements: the `data-testid="inspector-panel"` contract and every existing per-section inspector E2E assertion must keep passing, because branch 4 is byte-identical to today's behaviour. A section **without** a durable tree cannot have a selected element, so legacy sections are structurally unaffected.

### D4 — Export: one tree-capable emission path, reused for any section

**Problem:** no regular section generator can render a tree (R10), and the existing downcast destroys `customCode` (§2.1).

**Decision:** emit a **generic tree-rendering section component** for any section that carries a durable `tree`, reusing the already-validated sandbox machinery from `custom-block-generator.ts` (`NodeView`, `CustomCodeFrame`, the heartbeat/message wiring, `srcdocs` prop shape). Per-generator tree support for the seven hand-written section components is **not** the path.

Rationale (all verified):

1. The tree renderer already exists, is WYSIWYG-validated, and is the only code that knows how to mount a sandboxed frame — duplicating it seven times would multiply the security surface.
2. `page-generator.ts` already builds per-section `srcdocs` maps and a flag-only emitted tree; the same two helpers generalise from `props.tree` to `section.tree`.
3. `section-element-adapter.ts` already provides `elementTreeToSection` / `isSectionDerivedElementTree` / `sectionHasDurableTree` and the section markers (`_sectionType`, `_sectionId`) that identify a section-derived tree.
4. A section **with** a durable tree is authoritative on its tree (P24-B), so rendering the tree for it is *more* faithful than rendering `props`; a section **without** a tree keeps its existing props-driven component and its existing output.

Required properties:

- **Emission shape unchanged from P23-C principles:** the emitted tree carries custom code reduced to `{ enabled: true }` (never code text); validated srcdoc documents travel separately in a `srcdocs` map; every `<` in each srcdoc is `\u003c`-escaped; the parent page contains no literal executable user code.
- **The srcdoc map must be built from the durable `section.tree`** through the single authoritative builder `buildValidatedCustomCodeSrcdoc` (`custom-code/srcdoc.ts:269`) — no parallel construction path.
- **Projection must preserve `customCode`** (see §2.1); any export-specific downcast must be a named, tested function rather than a reuse of `elementTreeToBlockTree`.
- **`srcdocs` is omitted entirely** when no node in the section has `enabled === true`, so projects without custom code export byte-identically to today.
- **No output change for `custom-block` sections** and no output change for any section without a durable tree.
- `export-pipeline.ts` (`exportProject`) is a pass-through surface for this work: verify the durable tree survives the export-time project projection, and add a regression test — change it only if the projection drops it.

### D5 — Legacy `custom-block` behaviour is frozen

`props.tree` handling (`customBlockSectionForExport`, `buildCustomCodeSrcdocsForSection`) and `custom-block-generator.ts` keep working exactly as at `d9ddb42`, including the P23-E/P23-C export tests. P24-C adds a *new* path beside it; it does not refactor it.

### D6 — Sandbox, caps, schemas and versions are invariant

- Sandbox: `allow-scripts` only, unchanged CSP, unchanged message protocol, unchanged attribute grammar, unchanged disposal/recovery semantics.
- Caps: **20,000 bytes per field (`html`, `css`, `js`)**, **48,000 bytes aggregate**, **16 attributes** — sourced from `element-schemas.ts:41-44` (`ELEMENT_MAX_CUSTOM_CODE_LENGTH`, `ELEMENT_MAX_CUSTOM_CODE_TOTAL`, `ELEMENT_MAX_ATTRIBUTES`) and re-exported by `custom-code/constants.ts` as the single source of truth. Broader authoring does **not** raise any cap.
- **Re-clamping at emission is mandatory**: `buildValidatedCustomCodeSrcdoc` re-clamps per-field and aggregate deterministically (html whole → css → js trimmed last) and never trusts its input. New emission call sites must route through it.
- **Dual-schema synchronisation:** any schema-visible change must be declared in **both** `src/features/editor/schemas/section-schemas.ts` **and** `src/features/generation/schemas/generation-plan-schema.ts` (a non-strict Zod object silently strips undeclared keys — the exact failure P24-B fixed for `tree`).
- **`CURRENT_FORMAT_VERSION` stays 3** (no new durable field ⇒ no migration, no version bump).
- **`DATABASE_VERSION` stays 9** (no new IndexedDB store).

---

## 4. Detailed requirements

| ID | Requirement | Acceptance evidence |
|---|---|---|
| **REQ-1** | `elementSupportsCustomCode(type)` returns true for every renderable element type and false for every element-only/non-renderable type; exactly one capability source of truth remains in the registry. | Unit test over the full `elementRegistry.types` list asserting capability `=== isRenderableElementType(type)` for every type, plus explicit false cases for the 8 element-only types. |
| **REQ-2** | The inspector schema exposes the `custom-code` group for every capable type, and continues to omit it for non-capable types. | Unit test on `getInspectorSchema` across the type catalogue (extends the existing `inspector-custom-code.test.ts`). |
| **REQ-3** | `ElementInspectorPanel` mounts for a non-`custom-block` section while an element in its durable tree is selected; with no element selected, that section's existing inspector renders unchanged. | Component test on `RightSidebar` (selection present/absent) + existing per-section inspector E2E specs still green. |
| **REQ-4** | Authoring custom code on a non-`custom-block` element commits through `commitSectionTree` with one history entry, survives reload/normalisation/CRDT projection, and undo/redo restores correctly. | Unit/component tests extending the P24-B `editor-store-section-tree` and `section-element-durable` suites. |
| **REQ-5** | Export emits durable `section.tree` custom code as validated srcdoc + flag-only tree for any section type; the parent page contains no literal executable user code; no `srcdocs` prop is emitted when nothing is enabled. | Unit tests extending `custom-block-p23c-export.test.ts` to a regular section type; E2E extending `e2e/custom-code-export.spec.ts`. |
| **REQ-6** | The export projection used for durable section trees **preserves** `customCode` (regression against the `elementTreeToBlockTree` strip). | Targeted unit test asserting the projection's output still carries `customCode`, plus a test that `elementTreeToBlockTree` continues to strip it (documenting the difference). |
| **REQ-7** | Distribution stripping covers `section.tree` on **every** section type, at request level and for the exact new authoring surface. | Extends `strip-custom-code.test.ts` (P24-B case already covers any-type `section.tree`); add cases for newly-capable element types and for share/template/My Blocks paths. |
| **REQ-8** | Custom code on a durable tree **never executes** on the editor canvas, visitor preview, share views, or thumbnails. | `BlockRenderer-custom-code.test.tsx` extended to non-`custom-block` trees; assertion that only the opt-in preview and the exported frame mount an iframe. |
| **REQ-9** | No regression for legacy `custom-block` sections or for sections without a durable tree. | Existing P22-C/P23-C/P24-B suites unchanged and green; `custom-block-*` export tests byte-identical. |
| **REQ-10** | Caps and re-clamping hold for the broadened surface. | Tests at the schema, ops-engine, authoring-UI and emission boundaries (20,000 / 48,000 / 16 limits, html→css→js trim order). |
| **REQ-11** | Format and database versions are unchanged. | Assertions that `CURRENT_FORMAT_VERSION === 3` and `DATABASE_VERSION === 9`; migration suite unchanged and green. |
| **REQ-12** | Documentation: `docs/phase-p24c-architecture.md` + `docs/phase-p24c-report.md` are produced before closeout, in the established phase-doc format. | Files exist; report records exact gate results honestly, including any residual failure. |

---

## 5. Invariants (must hold at every commit in this phase)

1. **Single mutation boundary.** Every durable write goes through `withHistory` / `commitLocalProject` / a `commit*` action built on them, so undo, collaboration and autosave stay correct. Selection stays transient.
2. **Additive and lazy materialisation.** `props`/`styles` remain valid for legacy renderers; `tree` is authoritative once present; nothing is eagerly materialised.
3. **Inertness.** Custom code is data everywhere except the sandboxed iframe (opt-in authoring preview + exported/published site). No `eval`, `new Function`, or `dangerouslySetInnerHTML` on user code anywhere.
4. **One srcdoc construction path** — `buildValidatedCustomCodeSrcdoc` — and re-clamping always happens at emission.
5. **Dual-schema declaration** for anything schema-visible.
6. **Boundary normalisation** for any untrusted tree (persistence + CRDT).
7. **No silent output change** for projects that do not use the new capability.
8. **Honest reporting.** Residual failures are classified with evidence and never claimed as passes.

---

## 6. Validation & verification strategy

### 6.1 Targeted unit / component tests (Vitest, `testTimeout: 10_000`, `environment: node`)

| Area | Suites to add/extend |
|---|---|
| Registry capability detection | `element-registry` capability test over the whole type catalogue (REQ-1) |
| Inspector schemas | `src/features/elements/inspector/__tests__/inspector-custom-code.test.ts` (REQ-2) |
| Inspector mounting | new `RightSidebar` component test for the element-selection branch (REQ-3) |
| Store/history durability | `src/features/editor/store/__tests__/editor-store-section-tree.test.ts`, `src/features/elements/__tests__/section-element-durable.test.ts` (REQ-4) |
| Export serialisation | `src/features/export/__tests__/custom-block-p23c-export.test.ts` extended to a regular section type (REQ-5) |
| Export projection trap | new test for the customCode-preserving projection + the `elementTreeToBlockTree` strip (REQ-6) |
| Distribution stripping | `src/features/code-import/services/__tests__/strip-custom-code.test.ts` + share/template/my-blocks suites (REQ-7) |
| Inertness | `src/features/blocks/render/__tests__/BlockRenderer-custom-code.test.tsx` (REQ-8) |
| Caps / re-clamping | `custom-code/__tests__/srcdoc.test.ts`, `element-schemas` caps tests, `element-custom-code.test.ts` (REQ-10) |
| Versions | constants assertions (REQ-11) |

### 6.2 E2E (Playwright, chromium, `--workers=1`, deterministic helpers — no arbitrary sleeps)

- Extend `e2e/custom-code-authoring.spec.ts`: author custom code on a **non-`custom-block`** element in a regular section, confirm the opt-in flow and that nothing executes in the canvas.
- Extend `e2e/custom-code-export.spec.ts`: export a project whose custom code lives on a durable `section.tree`, and assert the generated component carries `CUSTOM_CODE_SANDBOX = "allow-scripts"`, the `srcdocs` map with CSP + escaped user code, the flag-only tree, and **no** literal script/style markup in the parent page.
- Full regression set for the affected specs (editor, element-inspector, canvas-selection, custom-code-*, share, template, my-blocks, export) must stay green.

### 6.3 Required gate order (sequential, never concurrent)

```
1. npx tsc --noEmit                                   (typecheck)
2. npx eslint .                                       (lint)
3. npm test                                           (vitest — 372+ files, testTimeout 10_000)
4. npm run build                                      (production build)
5. npm run test:e2e  (batch affected specs, workers=1)
6. npm run test:e2e:matrix                            (14 prompts)
7. npm run test:e2e:fallback                          (1 test)
8. npm run test:export-build                          (real npm install && npm run build of a generated site)
9. git diff --check                                   (hygiene)
```

### 6.4 Known gate hazards to plan around (documented at P24-B, not introduced here)

- `boundedErrorToken` in `src/app/api/generate/route.ts` breaks `next build`/`tsc` through the gitignored `.next/dev/types` artifact; source-only `tsc` is clean and the build passes once the artifact is removed/rebuilt. Include this in planning rather than "fixing" it silently.
- `test:export-build` is cold-cache fragile (>600 s timeout) but passes on a warm npm cache (~123 s). Warm the cache before the gate.
- The two residual E2E failures from P24-B (`realtime-structure`, `workspace-version-history`) are pre-existing/environmental; re-run them in isolation and report honestly.

---

## 7. Risks & mitigations

| # | Risk | Mitigation |
|---|---|---|
| M1 | Broadening capability to containers/composites produces frames whose layout breaks the surrounding design | Review D1-a (§10 Q1); keep the capability opt-in per payload and validate the authoring guard before shipping |
| M2 | The export projection silently drops `customCode` (via `elementTreeToBlockTree`) | Named, tested projection + REQ-6 regression test |
| M3 | New emission call sites bypass validation/re-clamping | Route **all** emission through `buildValidatedCustomCodeSrcdoc`; add an assertion test |
| M4 | Broadening the authoring surface silently ships custom code into distributed artifacts | REQ-7 stripping tests across share/template/My Blocks, plus export tests asserting flag-only trees |
| M5 | Two render paths (props-driven components vs tree renderer) drift for a section that has a durable tree | One authoritative rule: a section **with** a durable tree renders its tree; without, it renders `props`; WYSIWYG surface covered by the export-build gate |
| M6 | Existing P23-D leaf-only tests fail and get "fixed" by weakening assertions | Update them deliberately, documenting the intent change in the PR/commit; never delete a security assertion |
| M7 | Scope creep into freeform canvas authoring or the sandbox model | §1.3 is binding; sandbox/caps/versions are invariant (D6) |

---

## 8. Likely implementation areas **[inference — file-level surface, not a committed diff plan]**

| Area | Files |
|---|---|
| Registry | `src/features/elements/registry/element-registry.ts` |
| Inspector UI + schemas | `src/components/editor/RightSidebar.tsx`, `src/features/elements/inspector/schemas.ts` (and any consumer of `elementSupportsCustomCode`) |
| Selection bridge (UI only) | `src/features/canvas/store/canvas-interaction-store.ts` (read), `src/features/inspector/components/ElementInspectorPanel.tsx` |
| Export | `src/features/export/generators/page-generator.ts`, `src/features/export/generators/section-generators/custom-block-generator.ts` (reuse/extraction), `src/features/export/generators/section-generators/index.ts`, `src/features/export/pipeline/export-pipeline.ts`, `src/features/export/validators/export-validator.ts` |
| Adapter (projection) | `src/features/elements/adapters/section-element-adapter.ts` |
| Security (verify) | `src/features/code-import/services/strip-custom-code.ts` |
| Tests | the suites listed in §6.1–6.2 |
| Docs | `docs/phase-p24c-architecture.md`, `docs/phase-p24c-report.md` |

---

## 9. Acceptance criteria (phase exit)

P24-C is complete when **all** of the following are observably true:

1. A user can author custom code on any **renderable** element in **any** section (including regular sections with a durable tree), through the same opt-in flow and the same caps as before.
2. Element-only/non-renderable types remain ineligible, and no dead srcdoc can be authored for a node the export cannot render.
3. A section with **no** durable tree, and every legacy `custom-block` section, behaves exactly as at `d9ddb42`.
4. Exported sites emit durable `section.tree` custom code as validated, escaped srcdoc mounted through the sandboxed `CustomCodeFrame`; the parent page contains no literal executable user code; `srcdocs` is omitted when nothing is enabled.
5. Distribution artifacts (share, templates, My Blocks) contain no custom code from any tree surface.
6. Custom code never executes on the editor canvas, visitor preview, share views or thumbnails.
7. Caps (20,000/48,000/16), emission re-clamping, dual-schema declaration, `CURRENT_FORMAT_VERSION = 3` and `DATABASE_VERSION = 9` are all unchanged and test-covered.
8. The gate order in §6.3 is green (or every residual failure is classified with evidence and reported honestly), and both phase documents exist.

---

## 10. Open questions (require review/decision before implementation)

1. **Q1 (D1-a) — authoring guard for containers/composites.** Should the Custom Code group be hidden for container/child-bearing elements (where a wrapping sandboxed frame changes layout semantics), and if so on what rule — registry `canHaveChildren`, `nesting.maxChildren`, or an explicit per-definition flag? The brief says "all renderable element types"; this question only decides whether an additional *UX* guard sits on top.
2. **Q2 (D3) — selection semantics for multi-select.** The canvas store supports multi-selection. Which element owns the inspector when several are selected (first/anchor only, or disable authoring and show a multi-select panel)?
3. **Q3 (D4) — shared tree component vs. generator extraction.** Reuse the custom-block generator's runtime by *extracting* a shared tree-render module, or by emitting the same component for both paths and keeping one copy? (Extraction changes a P23 file; duplication keeps P23 frozen.) §3 D5 leans toward freezing P23 files, so extraction must be justified.
4. **Q4 (D4) — fidelity scope for non-custom-code element metadata.** Should the new tree emission carry geometry/animation/interaction/binding (full WYSIWYG) or only what P24-C needs (content + custom code)? Scope discipline favours the latter, but the two paths would then diverge.
5. **Q5 (REQ-4) — where the "element is selected" signal is computed.** Derived in `RightSidebar` (no new store API), or surfaced by the inspector hook (`useElementInspector`) for reuse?
6. **Q6 (hardening) — should `elementTreeToBlockTree` keep stripping `customCode`?** Preserving it would break the documented "block pipeline compatible" contract of that utility; keeping the strip requires the separate export projection (current plan).

---

## 11. Deliverables

1. `docs/phase-p24c-spec.md` — this document.
2. Implementation per §8 with the tests in §6.1–6.2 (**not started**).
3. `docs/phase-p24c-architecture.md` — design record written against the shipped implementation.
4. `docs/phase-p24c-report.md` — closeout with exact gate results, honest residual-failure classification, and the consolidated security review for the broadened authoring surface.

---

## 12. STOP

This is a specification only. **No source, test, or configuration file has been modified.** Implementation begins only after this document is reviewed and the open questions in §10 are answered.
