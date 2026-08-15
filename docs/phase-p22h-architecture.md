# Phase P22-H — Element AI Editing (Architecture)

> Buildora AI — Canva-style AI website builder. P22-H delivers **element-scoped
> AI editing** on top of the existing plan pipeline: the user selects a single
> renderable element inside a **custom-block section** (the durable
> element-tree surface), asks the AI to modify it, reviews a proposed
> element operation/diff in the existing `AiEditPlanReview`, and applies it
> atomically through the existing `applyAiEditPlan` / `commitElementTree` /
> `withHistory` path.
>
> **Baseline:** P22-A through P22-G complete and validated (see their reports).
> **Boundary:** `P22-A through P22-G remain closed. No P22-I/J or P23 work.`

---

## 1. P22-H objective and authoritative scope

Per the master P22 architecture (`docs/phase-p22-architecture.md`), P22-H is
the **element-scoped AI editing** capability:

- A selected element in a **custom-block section** can be edited through the
  AI assistant: the request is element-scoped (`pageId` + `sectionId` +
  `elementId`), the planner produces **element operations**, the review UI
  shows element-kind diffs, and application runs through the **same atomic
  plan pipeline** section/page/project plans already use.
- The AI Copilot resolves a selected element to **element scope** and carries a
  **bounded element digest** in its context.

## 2. Scope boundaries (approved, binding)

- **No new renderer, provider, endpoint, persistence model, dependency, or
  parallel AI plan system.** Element operations execute through the existing
  `applyElementOperation` engine; element plans flow through
  `applyAiEditPlan` / `commitElementTree` / `withHistory`.
- **Custom-block sections only** — the durable element-tree surface. Regular
  sections keep their section-specific inspectors and section-scoped planning.
- **Single selected element only.** Multi-select element AI is out of scope.
- **No raw JS / custom-code execution.** Animation/interaction edits reuse the
  P22-G declarative model (no new runtime).
- **Reuse `AiEditPlanReview`** — no second review UI.
- Do NOT reopen or refactor P22-A through P22-G.

## 3. Existing plan pipeline reused (unchanged contract)

P22-H reuses the validated Phase L pipeline **as-is**:

```
instruction + element scope
  → POST /api/generate (mode "plan-edit")
  → planner (Gemini or deterministic rule-based)
  → client re-simulation (plan-simulator) against the live project
  → diff-builder (before/after snapshots)
  → plan summary card + AiEditPlanReview
  → atomic apply through editor-store.applyAiEditPlan
```

The only new vocabulary is the **element scope** and the **element operation
types**; every stage was extended additively to understand them.

## 4. Element scope model

`src/features/ai-editing/plan-types.ts` adds a fourth scope to
`AiEditScope`:

```ts
{ type: "element"; pageId: string; sectionId: string; elementId: string }
```

- `scopeLabel()` renders it as "selected element".
- The Copilot scope (`CopilotScope`, `src/features/ai-copilot/types.ts`)
  gains an optional `elementId` on its element scope — a selected element in a
  custom-block tree — while **preserving** the legacy field-only element scope
  (`fieldPath`) used by inline text editing.
- `toAiEditScope()` maps an element scope with `elementId` to the planner's
  element scope; a field-only scope keeps the legacy section-scoped planning.

## 5. Element operation vocabulary

Nine element operation types were added to `AiEditOperationType`
(`plan-types.ts`):

| Operation | Payload | Semantics |
|---|---|---|
| `update-element-props` | `props` patch | MERGED over current node props (preserves hrefs/assets) |
| `update-element-style` | `style` tokens | MERGED over current node style (validated + bounded) |
| `update-element-responsive` | `breakpoint: "tablet"\|"mobile"` + `style` | Writes viewport overrides into `node.viewport[breakpoint]` |
| `update-element-animation` | `ElementAnimation \| null` | Whole-object replacement; `null` clears |
| `update-element-interaction` | `ElementInteraction \| null` | Whole-object replacement; `null` clears |
| `insert-element` | registered renderable `elementType` + bounded `props`/`style` | Canonical defaults come from the element registry — AI never fabricates subtree JSON |
| `delete-element` | `elementId` | High risk (destructive) |
| `duplicate-element` | `elementId` | Medium risk |
| `set-element-visibility` | `elementId` + `visible` | Hidden elements are not rendered/exported |

Every element op targets a node in a custom-block section tree.

## 6. Zod / security validation

`src/features/ai-editing/schemas/plan-schemas.ts` adds one schema per element
op, all **additive** on `AiEditOperationSchema` (discriminated union):

- `update-element-*` ops require non-empty bounded `pageId` / `sectionId` /
  `elementId` and reuse the **validated element schemas** at the plan boundary:
  `ElementStyleTokensSchema` (bounded record of primitive style tokens),
  `ElementAnimationSchema` / `ElementInteractionSchema` (the P22-A schemas,
  nullable for clearing), and bounded record schemas for props.
- `insert-element` requires a **registered renderable block type**
  (`isRenderableElementType`) — element-only families (no renderer/persistence
  path) are rejected; an insertion `index` requires an explicit
  `parentElementId`.
- Plan-level security is unchanged: dependency integrity, operation cap, id
  caps, instruction length caps, stale/project-mismatch guards — all inherited
  from the Phase L plan schema.

The **plan simulator re-validates at apply time** through
`applyElementOperation` + the element registry + the final section schemas
(defense in depth — the AI never writes unvalidated data).

## 7. Simulator: materialize → applyElementOperation → fold

`src/features/ai-editing/services/plan-simulator.ts` extends the pure
simulator with element-op appliers. Each element op:

1. **Materializes** the target section into an element tree via the existing
   `sectionToElementTree` adapter (`elements/adapters/section-element-adapter.ts`).
2. Validates the element target exists (`ELEMENT_TARGET_NOT_FOUND` style guard
   → `PLAN_OPERATION_INVALID` with the `elementId` field).
3. Applies the op through the existing **`applyElementOperation`** engine
   (the same engine the inspector and canvas manipulation use) — targeted
   patches, registry-driven defaults for inserts, tree structural changes for
   delete/duplicate/visibility.
4. **Folds** the tree back into the validated section via
   `elementTreeToSection` (custom-block sections persist the whole tree, so
   element metadata — style, viewport, animation, interaction — survives the
   fold).

Multi-op element plans simulate sequentially; a failed op fails the whole
simulation and leaves the project untouched.

## 8. Element diff / review behavior

`src/features/ai-editing/services/diff-builder.ts` produces **`kind: "element"`**
diffs from the simulator's before/after snapshots:

- `update-element-props` / `update-element-style` — changed keys only
  (`diffProps` on the before/after node props / style).
- `update-element-responsive` — the viewport override delta for the breakpoint.
- `update-element-animation` — one "Animation" field (before → after, or
  `null` when cleared).
- `update-element-interaction` — one "Interactions" field.
- `insert-element` — "Added" with the resolved element label.
- `delete-element` / `duplicate-element` — "Removed" / "Duplicated" with the
  element label + id.
- `set-element-visibility` — the visibility change.

`AiEditPlanReview` (unchanged UI) gains element summaries in `opSummary()`
("element …"), and the review dialog header shows `scopeLabel(plan.scope)` =
"selected element". Operation cards, risk badges, selective checkboxes,
destructive confirmation, and dependency handling all work for element ops
unchanged.

## 9. Deterministic rule-based planner

`src/features/ai-editing/planner/rule-based-planner.ts` adds a dedicated
**element recognizer set** (`ELEMENT_RECOGNIZERS`) that runs **only** when the
scope is `element` — the section/page recognizers would misinterpret
element-scoped instructions ("make it bold", "hide this element"). Order is
structural-first:

1. `insert-element` (add a registered element)
2. `delete-element` (high risk)
3. `duplicate-element` (medium risk)
4. `set-element-visibility` (hide/show)
5. `update-element-interaction` — link to a page / hover highlight
6. `update-element-animation` — fade/slide/bounce on load or scroll
7. `update-element-responsive` — larger/smaller/hidden on mobile/tablet
8. `update-element-style` — bold / larger / smaller / accent / color keyword

Recognizers produce ops through the same `PlanBuilder` contract (op ids,
warnings) and never fabricate subtree JSON — insert ops carry only a
registered renderable type. Unrecognized instructions return
`PLAN_NO_CHANGES` with a helpful message.

## 10. Gemini provider extension

`src/features/ai-editing/planner/gemini-plan-provider.ts` extends the Gemini
system instruction with the element vocabulary (the nine op types, partial
patch semantics, `null`-clears for animation/interaction, registered-type-only
inserts) and, for element scope, sends a **bounded digest of the selected
element** (its type, current props/style caps, animation/interaction
metadata, sibling count, parent type) instead of the whole tree. The existing
JSON-only, no-code constraints are unchanged; the rule-based fallback is
unchanged.

## 11. Selected-element targeting (one shared definition)

`src/features/ai-editing/selected-element.ts` — **new** — is the ONLY place
the AI element target is resolved, normalizing three sources into one answer:

1. **Canvas element selection** (transient `canvas-interaction-store`) — a
   single NESTED element id wins (the manipulation layer also mirrors the
   section root there, which is treated as the section-level fallback).
2. **Inspector selection** (`block-editor-store.selectedBlockId`, set by
   canvas clicks / the build tree).
3. **Section root** — the inspector's own fallback target.

Guards: only custom-block sections qualify; only a single selection; the
element must be **renderable/durable** (`isRenderableElementType` — registered
block-derived types; element-only families have no renderer/persistence path).

Exposes `resolveElementEditTarget` (pure + deterministic, never touches
stores), `getElementEditTarget` (imperative store read for event callbacks),
and `useElementEditTarget` (React binding). The inspector AI entry and the
copilot both consume this single definition.

## 12. Copilot element context

`src/features/ai-copilot/context/context-builder.ts`:

- `buildElementDigest()` — a **bounded, deterministic** digest of the selected
  element: label, current text value, `elementId`/`elementType`, capped
  whitelisted `props`/`style` entries, capped `viewport` overrides, compact
  `animation`/`interaction` JSON, `siblingCount`, `parentType`. Never exposes
  the whole tree.
- `buildCopilotContext()` now also includes a **bounded page list**
  (id/title/slug, max 10) and a **theme digest** (palette + heading/body
  fonts) so route references and styling resolve. Reduction order trims the
  element digest's richer surfaces (style → props → viewport) before dropping
  the conversation tail.
- Element scope with `elementId` wins over the field-only digest; the
  field-only path is preserved for text-level flows.

`copilot-service.ts` `resolveEffectiveScope()` maps a selected element to
element scope (after the selected-field preference, preserving legacy inline
behavior), and `requestCopilotPlan()` maps element scope with an `elementId`
to the planner's element scope. `useCopilot` wires `getElementEditTarget()`
into the message flow.

## 13. Inspector AI entry

`src/features/inspector/components/ElementInspectorPanel.tsx` adds an
`ElementAiComposer` (Phase P22-H) shown **only** when exactly one valid
renderable element is selected inside a **custom-block** section. It:

- renders `element-ai-composer` / `element-ai-instruction` /
  `element-ai-submit` testids with a "Targeting: type · elementId" caption;
- submits through `useAiPlanEdit().createPlan(instruction, { type: "element",
  pageId, sectionId, elementId })` — the **existing** plan pipeline (plan
  summary card → `AiEditPlanReview`); no second review UI.

## 14. Request / route / service / hook wiring

- `plan-service.ts` `runPlanEdit` already serializes the full scope
  (`{ mode: "plan-edit", ...input }` with `scope`), so the element scope flows
  through the existing `/api/generate` route untouched.
- `useAiPlanEdit` (`src/features/ai-editing/hooks/useAiPlanEdit.ts`) drives
  create → plan → simulate → diff → ready → apply for element scopes exactly
  as for section/page/project scopes; stale detection and request sequencing
  are scope-agnostic.
- `useCopilot` resolves the element target at message time and threads it into
  context + scope; `handleCopilotMessage` passes `selectedElement`.

## 15. Atomic apply / history / undo-redo / stale / destructive

`src/features/editor/store/editor-store.ts` applies element plans through the
existing `applyAiEditPlan` → `commitElementTree` → `withHistory` boundary
(verified by `editor-store-element-ai-plan.test.ts`):

- A multi-op element plan commits **ONE atomic history entry** (one
  project-reference change → one revision → one autosave); one Undo restores
  the full pre-plan tree, one Redo reapplies.
- **Stale** plans (revision changed) are rejected (`PLAN_STALE`) without
  touching history.
- **Project mismatch** plans are rejected (`PLAN_PROJECT_MISMATCH`).
- **Destructive** element ops (`delete-element`, high risk) require explicit
  confirmation (`PLAN_DESTRUCTIVE_CONFIRMATION_REQUIRED`).
- A failed element simulation leaves the project untouched.

## 16. Persistence / collaboration behavior

- Element plans edit the **durable** custom-block tree: the whole tree lives in
  section `props` (P22-C convention), so applied element edits persist through
  `ProjectSchema` → normalizer → serializer, autosave, and save/reload with no
  persistence-model changes.
- Animation/interaction edits reuse the P22-G **durable fields** on stored tree
  nodes (P22-G schema), so they survive the same round-trip.
- Collaboration: the P22-F shape-agnostic `tree-normalizer` bridges element
  trees to Yjs without knowing field names, so element edits normalize
  identically for realtime collaboration (no collab changes needed).

## 17. Security and bounds

- Element ops are **data-only** patches; `insert-element` accepts only
  registered renderable types (registry defaults win — no fabricated subtree
  JSON); style tokens and props are bounded/capped; animation/interaction pass
  the P22-A validated schemas.
- No executable payloads, no arbitrary property paths, no JSON-Patch against
  the Project object (inherited Phase L guarantees).
- No raw JS / custom-code execution; P22-G navigation re-validates hrefs
  through `isSafeNavUrl` / `resolveNavTarget`.
- The AI never mutates the editor store directly — plans are applied only
  through the validated, re-simulated, reviewable path.

## 18. Accessibility / runtime implications

- The P22-H entry is an ordinary labeled input + button in the inspector
  (keyboard-accessible, `Enter` submits, disabled while busy).
- Runtime implications are nil: element plans write the same data the
  inspector already writes; the P22-G renderer consumes animation/interaction
  data unchanged. No new DOM/runtime behavior was added.

## 19. Testing architecture

- **Unit (schemas):** `ai-editing/schemas/__tests__/element-plan-schemas.test.ts`
  — element-op validation, bounds, registered-type-only inserts, security
  rejections.
- **Unit (simulator):** `ai-editing/services/__tests__/element-plan-simulator.test.ts`
  — every element-op applier, merge semantics, fold round-trip, no-op handling,
  ghost-target rejection, multi-op simulation.
- **Unit (diffs):** `ai-editing/services/__tests__/element-plan-diff.test.ts`
  — element-kind diffs for props/style/responsive/animation/interaction,
  structural diffs, visibility.
- **Unit (planner):** `ai-editing/planner/__tests__/element-planner.test.ts`
  — element recognizers, instruction routing, element-only recognizer set for
  element scope.
- **Unit (copilot context):** `ai-copilot/__tests__/element-context.test.ts`
  — bounded element digest, element scope context, pages/theme digests, byte
  cap, determinism, `resolveEffectiveScope` mapping.
- **Store:** `editor/store/editor-store-element-ai-plan.test.ts` — atomic
  apply, one history entry, undo/redo, stale, project mismatch, destructive
  confirmation, failed-simulation safety.
- **Component:** `inspector/__tests__/ElementInspectorPanel.test.tsx`
  (Phase P22-H AI entry) and `ai-editing/components/__tests__/AiEditPlanReview.test.tsx`
  (element plans render with element diffs and apply through the review).
- **E2E:** `e2e/ai-element-editing.spec.ts` — 3 tests (see the report):
  full inspector flow (select → AI entry → element-scoped request → review
  diff → apply → canvas → persist → undo/redo), element animation through the
  P22-G model, and copilot element-scope behavior.

## 20. Dependencies on P22-A through P22-G

- **P22-A** — element model, ops engine (`applyElementOperation`), registry,
  validated animation/interaction schemas.
- **P22-B** — canvas selection + `commitElementTree` / `withHistory` store
  boundary (the plan apply path and the selected-element canvas source).
- **P22-C** — universal inspector + durable custom-block tree (the AI entry and
  the fold target).
- **P22-D** — element library / custom-block section surface (unchanged).
- **P22-E** — routing / page model (the copilot pages digest).
- **P22-F** — responsive viewport overrides (the
  `update-element-responsive` op writes P22-F data).
- **P22-G** — declarative animation/interaction (the
  `update-element-animation` / `update-element-interaction` ops write P22-G
  durable fields consumed by the existing renderer).

## 21. Explicit exclusions

- No multi-select element AI, no element AI on non-custom-block sections.
- No new renderer / provider / endpoint / persistence model / dependency.
- No raw JS / custom-code execution; no P22-I/J or P23 work.
- No reopening or refactoring of P22-A through P22-G.

## 22. Final architecture decisions

1. Element AI is **limited to custom-block sections** — the only durable
   element-tree surface — and to a **single selected renderable element**.
2. P22-H reuses the **entire existing plan pipeline** (simulate → diff →
   review → atomic apply); it only extends the vocabulary.
3. Element operations run through the **existing `applyElementOperation`**
   engine and fold via `sectionToElementTree` / `elementTreeToSection`.
4. `selected-element.ts` is the **one shared definition** of the AI element
   target (inspector entry + copilot).
5. The **copilot carries a bounded element digest** (never the whole tree) and
   resolves a selected element to element scope; legacy inline-field behavior
   is preserved.
6. Plans remain **data, not code**; insert ops accept only registered
   renderable types; destructive ops keep the confirmation gate.

---

**P22-H architecture complete. See `docs/phase-p22h-report.md` for
implementation + validation results.**
