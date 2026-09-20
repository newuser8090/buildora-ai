# Phase P26 — AI Copilot Element-Tree Context & In-Place Direct Editing

**Type:** Formal specification (design record, written before implementation).
**Anchored on:** `PROJECT_FULL_CONTEXT.md` + `docs/phase-p24c-report.md` (commit `60dac60`) + `docs/phase-p25-report.md` (commit `c3ca4fb`) + commit `d97a406` (P23 artifact closeout).
**Branch:** `phase-p22-canva-elements`.
**Status:** `SPECIFICATION — awaiting review`. Nothing in this document is implemented.
**Provenance:** Every symbol, line reference and behaviour below was verified by reading the working tree at
`d97a406`. Items that are inference rather than verified fact are explicitly marked **[inference]**.

---

## 0. Why this phase exists

P25 made the canvas render a section's durable `section.tree` and gave it a nested-element selection
producer, so the universal element inspector is finally reachable for **every** section type. Two debts
on the AI side were deliberately left open by that phase and by P24-C:

> **8. Element-scoped AI entry remains `custom-block`-only** — `useElementEditTarget` / `resolveElementEditTarget`
> still reject non-`custom-block` sections (P22-H rule), so the "Ask AI to modify this element" composer is
> not offered on the newly-authorable sections. Broaden deliberately or document as intended.
> — `docs/phase-p24c-report.md` §8, item 8 (still open; referenced as **OQ-3** in `docs/phase-p25-spec.md`)

The P25 report records the matching items it did not discharge (§7, items 1–4), none of which concern AI
targeting directly. So the asymmetry P24-C named in item 8 is doubly load-bearing after P25: a user can now
*select* an element on any durable section, the inspector routes correctly, canvas rendering is WYSIWYG — and
the AI copilot still refuses to see or touch that element because the target resolver hard-rejects anything
that is not a `custom-block`.

P26 is the phase that pays that debt: **the copilot sees the selected element wherever it lives, and can edit
it in place, atomically.**

**Naming note (honest derivation):** no roadmap document in this repository defines a "P26". The only
forward-looking statement that motivates this scope is P24-C follow-up #8 above. This document is the
**first** artifact to name P26. If the project prefers to fold this into a "P22-H extension" or a P25-D, only
the filename and the heading change.

---

## 1. Objective & boundaries

### 1.1 Objective (one sentence)

Extend the existing AI element-scope pipeline — context digest, element edit plans, preview and atomic apply —
from `custom-block`-only to **every durable section tree**, adding element `geometry` to the copilot's element
context and to the element-operation vocabulary, without introducing a second commit path, a new durable
field, or any executable AI output.

### 1.2 In scope

| # | Scope item | Anchor |
|---|---|---|
| S1 | **Context awareness.** Inject the currently selected element's schema type, whitelisted props, style tokens, viewport overrides, animation, interaction **and geometry** into the copilot context, sampled at prompt-generation time. | `src/features/ai-copilot/context/context-builder.ts` (`buildElementDigest`, `CopilotElementDigest`, `BuildCopilotContextInput.selectedElement`) |
| S2 | **Element-scoped edit planning.** The copilot emits targeted `ElementOperation`s (style patches, animation presets, geometry adjustments) for the selected node, validated at the plan boundary. | `src/features/ai-editing/schemas/plan-schemas.ts` (element ops), `src/features/ai-editing/**` |
| S3 | **Durable-section targeting.** Element AI targeting/planning accepts any section carrying a durable tree, not only `custom-block`. | `src/features/ai-editing/selected-element.ts:88`, `src/features/ai-editing/services/plan-simulator.ts:481-488` |
| S4 | **Preview and atomic apply.** Accepted element edit plans route through `commitSectionTree` / `withHistory` as exactly **one** undoable transaction. | `src/features/editor/store/editor-store.ts:1413` (`commitSectionTree`), `:406` (`withHistory`) |
| S5 | **Copilot UI.** Chat message interface plus plan review / accept / reject controls that render element-level changes. | `src/features/ai-copilot/components/PlanReview.tsx`, `src/features/ai-editing/components/AiEditPlanReview.tsx`, `CopilotPanel.tsx`, `ElementSuggestionCard.tsx` |
| S6 | Unit tests covering element context extraction, element edit-plan schemas, and atomic plan application; sequential gates green. | §6 |
| S7 | Preserve every P22-B/P22-H/P23/P24/P25 invariant unchanged. | §5 |

### 1.3 Out of scope (explicit non-goals)

1. **No change to server-side rate-limiters or the Gemini fallback mechanism.** The provider abstraction,
   request throttling, and `gemini → rule-based` fallback ordering are frozen inputs to this phase.
2. **No mutation of the legacy `BlockTree` inside `custom-block` sections.** `props.tree`,
   `customBlockTreeFromSection` / `elementTreeToSection` and the whole-tree fold keep their current behaviour
   byte-for-byte. P26 reads and writes the durable tree surface, it does not restructure the legacy one.
3. **No change to `formatVersion: 3` or `DATABASE_VERSION = 9`.**
   `CURRENT_FORMAT_VERSION = 3` (`src/features/persistence/constants.ts:21`) and `DATABASE_VERSION = 9`
   (`:101`) are frozen. No new durable field, no migration, no new store.
4. **No arbitrary AI-authored code, at any layer.** No `eval`, `new Function`, srcdoc, iframe payload, or
   raw subtree JSON accepted from a model. Insert ops keep carrying a *registered renderable type plus bounded
   content*, never a whole tree.
5. **No new section/page/project operation types.** P26 does not widen the non-element operation vocabulary.
6. **No change to the export pipeline, the sandbox capability model (`allow-scripts` only), the CSP, the
   message protocol or the capsule caps** (20,000 per field / 48,000 aggregate / 16 attributes).
7. **No change to the plan size/count caps** (`PLAN_LIMITS`, `maxOperations: 30`, `maxPlanJsonBytes: 100_000`).

---

## 2. Verified current state — the P22-H element-scope baseline

This section is the phase's factual base. Every claim was read from the tree at `d97a406`. It matters because
a substantial part of what this phase describes **already exists** for one section type; P26 is a *generalization
plus a gap-fill*, not a greenfield build. Getting that wrong would produce a phase that rebuilds working code.

### 2.1 What already exists (Phase P22-H)

| Capability | Where | Verified behaviour |
|---|---|---|
| Element plan scope | `plan-schemas.ts` (`AiEditScopeSchema`) | Discriminated union includes `{ type: "element", pageId, sectionId, elementId }` |
| Element operations | `plan-schemas.ts` | `update-element-props`, `update-element-style`, `update-element-responsive`, `update-element-animation`, `update-element-interaction`, `insert-element`, `delete-element`, `duplicate-element`, `set-element-visibility` |
| Security scan | `plan-schemas.ts` (`scanPayloadForSecurityIssues`, wired into `AiEditPlanSchema.superRefine`) | Recursive rejection of `__proto__`/`prototype`/`constructor` and of unsafe URL schemes |
| Style validation | `plan-schemas.ts` → `ElementStyleTokensSchema` | Element ops carry **validated style tokens**, not free CSS |
| Animation validation | `element-schemas.ts:181` → `ElementAnimationSchema` | Closed `type` enum (`fade`, `slide`, `scale`, `bounce`, `reveal`, `blur`, `rotate`, `custom`), `trigger` enum, bounded `durationMs`/`delayMs`, regex-constrained `easing` |
| Simulation / diff | `services/plan-simulator.ts`, `services/diff-builder.ts` | Pure, deterministic, store-free; builds typed before/after fields per element op |
| Plan apply | `editor-store.ts:1144` (`applyAiEditPlan`) | Applies selected operations, no-op detection, ONE history entry; element ops run through `applyElementOperation` (`:1479`, `:1549`) |
| Apply entry points | `hooks/useAiPlanEdit.ts:150`, `ai-copilot/services/copilot-service.ts:490` | Both call `applyAiEditPlan` |
| Element context digest | `context-builder.ts` (`buildElementDigest`) | Bounded digest: `label`, `currentValue`, `elementId`, `elementType`, props, style, viewport, animation, interaction, `parentType`, `siblingCount`. Capped at 8 keys / 120 chars, metadata at 300 chars |
| Element target resolution | `selected-element.ts` (`resolveElementEditTarget`, `getElementEditTarget`, `useElementEditTarget`) | Three-tier precedence: canvas element selection → inspector `selectedBlockId` → section root |
| Review UI | `ai-editing/components/AiEditPlanReview.tsx`, `ai-copilot/components/PlanReview.tsx`, `ElementSuggestionCard.tsx`, `ScopeBadge.tsx` | Plan review / accept / reject scaffolding exists |

### 2.2 Findings that shape the design (all verified)

**F1 — The element target resolver hard-rejects every non-`custom-block` section.**
`src/features/ai-editing/selected-element.ts:88` reads literally
`if (!isCustomBlockSection(section)) return null;`, under the P22-H comment *"Element AI targets custom-block
sections only (durable element trees)."* This single line is why the copilot cannot see an element the user
has just selected on a durable `hero`/`features`/`pricing` section — the exact asymmetry P24-C item 8
recorded. **This is the phase's headline fix.**

**F2 — The copilot's element digest only reads `props.tree`.**
`context-builder.ts:235` reads
`const tree = (section.props as { tree?: unknown })?.tree`. A durable regular section stores its tree at
`section.tree`, **not** `props.tree` (`prepareSectionTreeCommit`, `editor-store.ts:530-585`). So even if F1
were fixed, the digest would resolve `null` for a durable regular section and silently fall back to the
inline-field digest — producing a copilot that *looks* context-aware while sending the model nothing about
the element. **Both F1 and F2 must be fixed together or neither fix is observable.**

**F3 — The digest has no `geometry` field.** `CopilotElementDigest` declares `props`, `style`, `viewport`,
`animation`, `interaction`, `parentType`, `siblingCount` — and no geometry. Geometry is the field that
distinguishes element-tree editing from props editing, and P22-B/P25 made it a durable, first-class node
concern. `ElementGeometrySchema` already exists (`element-schemas.ts:153`) and is attached to nodes at `:357`,
so the schema substrate for injection **and** for a geometry operation is present; only the digest field and
the operation type are missing.

**F4 — The plan simulator restricts element ops to `custom-block`.** `plan-simulator.ts:481-488` carries the
comment *"Element operations (Phase P22-H) — custom-block element trees only … Targets are restricted to
CUSTOM-BLOCK sections (the durable element-tree surface); regular sections are rejected rather than silently
dropping element metadata after persistence."* That rationale was **correct when written** and is now partly
obsolete: since P24-B, regular sections persist element metadata durably, so the stated reason for rejecting
them ("silently dropping element metadata after persistence") no longer holds.

**F5 — There is no geometry element operation.** The element op union contains no
`update-element-geometry` / `move-element` / `resize-element` member. §1.2 S2 names "geometry adjustments" as
in scope, so this is a genuinely **new** operation family, not an extension of an existing one. It needs its
own schema, its own simulator arm, its own apply path, and its own diff arm — and a decision about whether the
model may author absolute pixel geometry at all (see OQ-3).

**F6 — Two commit boundaries now exist and they are not the same function.**
`commitElementTree` (`editor-store.ts:1385`) and `commitSectionTree` (`:1413`) are **byte-identical in body** —
both delegate to `prepareSectionTreeCommit` and wrap the result in ONE `withHistory`. Separately,
`applyAiEditPlan` (`:1144`) is the AI-plan boundary and already produces ONE history entry for the whole plan.
So S4's requirement "route element edit plans through `commitSectionTree` / `withHistory` as a single undoable
transaction" is a statement about **which** of these owns the write. Naively inserting a `commitSectionTree`
call inside the existing `applyAiEditPlan` element arm would create **two** history entries per plan and break
REQ-9. This is the phase's sharpest correctness trap (R2).

**F7 — Selection is already transient and already sampled lazily.** `useCanvasInteractionStore` documents
itself as *"never through this store"* for the commit boundary, and `getElementEditTarget()` reads it
imperatively via `getState()` inside a callback — i.e. sampling at prompt-generation time is the **existing**
behaviour, not a change P26 introduces. Invariant 1 is therefore a *preservation* obligation with an existing
test surface (`canvas-interaction-store.test.ts`), not new design.

**F8 — The sanitization the brief names is split across two layers, and neither is where the brief implies.**
The brief requires that "style modifications pass through `block-style-to-css.ts` sanitization". Verified:
`block-style-to-css.ts` exports `styleTokensToCss` (`:47`), `resolveResponsiveCss` (`:79`), `blockCss` (`:94`)
— it is the **render-time token→CSS translator**, not an input validator. The actual AI style boundary is
`ElementStyleTokensSchema` in the plan schema, plus `scanPayloadForSecurityIssues`. Both matter and both are
kept; but a spec that claims `block-style-to-css.ts` is the sanitizer would send the implementer to the wrong
file. See §3 D5.

---

## 3. Design decisions

### D1 — Generalize the target predicate to "durable tree", gated on the P25 selection contract

Replace `isCustomBlockSection(section)` at `selected-element.ts:88` with the canonical durable predicate
`sectionHasDurableTree(section)` (`src/features/elements/adapters/section-element-adapter.ts:169`) — the same
predicate P24-C Slice 2 uses for inspector routing and P25 uses for the canvas render switch, so routing,
rendering, targeting and AI cannot drift.

`custom-block` must keep working: it is a durable surface in its own right and its tree is read through
`sectionToElementTree`, which already handles both shapes. The predicate becomes
`isCustomBlockSection(section) || sectionHasDurableTree(section)` if `sectionHasDurableTree` proves not to
cover `custom-block` **[inference — to be confirmed by the implementer; the two must not be allowed to
disagree]**.

Non-negotiable guards on the widening:
- R-1a: the `isRenderableElementType` filter (`selected-element.ts`, `targetFor`) stays. Widening the
  *section* predicate must not admit non-renderable element types.
- R-1b: the single-selection rule stays. Multi-select must keep resolving to `null` rather than picking one.

### D2 — The element digest must read the canonical tree, not `props.tree`

`buildElementDigest` (`context-builder.ts:235`) reads the tree through `sectionToElementTree(section)` — the
single materialization entry, which also keeps `reconcileDurableTreeWithProps` active — instead of poking at
`section.props.tree`. This is F2's fix and it removes a second, divergent tree lookup from the codebase.

Consequence to accept deliberately: the digest argument type must widen from "custom-block tree" to
"any section". Keep the function **pure and store-free** (it takes `project` + a scope), so the existing
determinism and boundedness tests continue to hold.

### D3 — Add `geometry` to the element digest, bounded like every other surface

`CopilotElementDigest` gains `geometry?: { x, y, width, height, rotation? }` reduced to capped scalars (not a
raw JSON blob), consistent with the existing `capEntries` / `ELEMENT_DIGEST_VALUE_CAP` treatment. It must be
added to the **deterministic reduction ladder** in `reduceContext` at the correct priority, and it must count
against `COPILOT_LIMITS.maxContextBytes` so the element scope can never grow past its byte cap.

Reduction priority: geometry is dropped **after** `style`/`props`/`viewport` (it is the most valuable
element-scoped signal and the cheapest to express), but it must be dropped **before** the conversation tail and
style notes, matching the existing rung ordering **[inference on exact rung placement — the implementer should
pin it with a byte-budget test rather than trust this document]**.

### D4 — A geometry operation is new; define it over `ElementGeometrySchema`, never over raw CSS

Because F5 shows no geometry op exists, P26 adds `update-element-geometry` backed by the **existing**
`ElementGeometrySchema` (`element-schemas.ts:153`), following the exact shape of the style op:

```
{ type: "update-element-geometry", pageId, sectionId, elementId, geometry: ElementGeometrySchema }
```

Requirements:
- It is a **partial patch** of the allowed geometry keys, not a replacement object that can drop an unrelated
  axis by omission.
- It must be clamped at the boundary, consistent with the tree normalizer's existing clamps (depth ≤ 12,
  nodes ≤ 1,000, text ≤ 10,000), and must not be able to produce a node outside the section's bounds.
- It needs a simulator arm and a diff arm (`kind: "element"`) so preview shows a real before/after.

### D5 — Sanitization stays two-layered and explicit (F8 correction)

| Layer | Mechanism | Owns |
|---|---|---|
| Plan/data boundary | `ElementStyleTokensSchema`, `ElementAnimationSchema`, `ElementInteractionSchema`, `ElementGeometrySchema`, `scanPayloadForSecurityIssues` | *What a model may propose* — closed enums, bounded records, prototype-pollution and unsafe-URL rejection |
| Render/emit | `styleTokensToCss` / `resolveResponsiveCss` / `blockCss` (`block-style-to-css.ts`) | *What those tokens become* — pure token→CSS translation used by the canvas and export |

P26 keeps both and adds no third path. The brief's phrasing ("must pass through `block-style-to-css.ts`
sanitization") is **corrected here to the two layers above**; `block-style-to-css.ts` is a translator and must
never become a validation boundary, because it is also on the export path and the export is frozen (§1.3).

### D6 — Animation and interaction remain strictly allow-listed, and "allow-listed" is not "executable"

Verified allow-lists: `ElementAnimationSchema.type` is a closed 8-value enum (`element-schemas.ts:181`) and
`trigger` a closed 5-value enum; `easing` is a regex-constrained string. P26 adds **no** new animation or
interaction vocabulary.

Two honest caveats the implementer must not smooth over:
- The animation `type` enum contains **`custom`**. "Strictly allow-listed presets" therefore means *closed
  tokens*, not *closed effects*: a `custom` token is a permitted value but carries no arbitrary code, and must
  never be interpreted as a script hook. If the project prefers a genuinely closed preset set for AI-authored
  animations, that is a **tightening** of the enum — an AI-only allow-list narrower than the authoring enum —
  and it is recorded as OQ-5.
- Per P24-C follow-up #9, the generated runtime resolves only a **bounded subset** of the interaction
  vocabulary; `submit-form`, `custom`, `sticky` and `parallax` are accepted as inert data. So an AI-authored
  interaction can be schema-legal and still do nothing on the published page. P26 must not present such a plan
  as effective. Surface it as a warning or exclude it (OQ-6).

### D7 — Apply owns exactly one history entry; `commitSectionTree` is the durable write path (F6)

The safe composition, stated as the decision:

1. `applyAiEditPlan` remains **the single AI-plan transaction boundary**. It is what
   `useAiPlanEdit.ts:150` and `copilot-service.ts:490` call, it already performs no-op detection and one
   `withHistory` entry, and moving the boundary would invalidate the existing `editor-store-ai-plan.test.ts`
   suite.
2. The element arm must therefore fold its result back into the section and commit through the **same**
   durable boundary the rest of the app uses — `prepareSectionTreeCommit` → ONE `withHistory` — rather than
   calling `commitSectionTree` in addition to its own commit.
3. Whether that inner step is expressed as a shared helper extracted from `commitSectionTree`, or
   `applyAiEditPlan` reuses the existing `commitSectionTree` body, is an implementation choice. What is
   **forbidden** is two nested `withHistory` entries for one plan. REQ-9 and its test pin this.

`commitSectionTree` and `commitElementTree` being byte-identical (F6) is pre-existing duplication. P26 may
consolidate them **only** if the consolidation is provably behaviour-preserving for BOTH P22-B canvas gestures
and P24-B durable commits; otherwise leave them and record it as a follow-up. Consolidation is explicitly not
a P26 goal.

### D8 — The simulator's `custom-block` restriction is lifted for the same reason the resolver's is

`plan-simulator.ts:481-488` (F4) must widen in lockstep with `selected-element.ts:88` (F1). Lifting one
without the other produces a plan that validates but cannot simulate, or simulates but cannot be targeted.
The obsolete rationale comment must be updated in the same change — and replaced with the real remaining
constraint (durable tree present), not deleted.

Legacy `custom-block` behaviour is preserved exactly: it keeps folding through `props.tree`.

### D9 — Preview stays pure; nothing is written before acceptance

`plan-simulator.ts` is pure and store-free by design ("NEVER mutate the store, NEVER persist, NEVER create
history"). P26 keeps that. Element preview = simulate on a clone + diff; apply = one transaction on accept.
No speculative writes, no optimistic mutation, no partial commit of a rejected plan.

---

## 4. Detailed requirements

| ID | Requirement |
|---|---|
| **REQ-1** | `resolveElementEditTarget` accepts any section with a durable tree, in addition to `custom-block`, keeping the renderable-type filter and the single-selection rule. `getElementEditTarget` / `useElementEditTarget` inherit the widening unchanged. |
| **REQ-2** | `buildElementDigest` resolves the tree via `sectionToElementTree(section)` (not `section.props.tree`) and returns a digest for a durable regular section. |
| **REQ-3** | `CopilotElementDigest` gains a bounded `geometry` field, included in the deterministic reduction ladder and counted against `COPILOT_LIMITS.maxContextBytes`. |
| **REQ-4** | The digest remains bounded and deterministic: caps (8 keys / 120 chars / 300-char metadata) hold for the widened input; two identical inputs produce byte-identical context. |
| **REQ-5** | A new `update-element-geometry` element operation is added to `AiEditOperationSchema`, backed by `ElementGeometrySchema`, as a clamped partial patch; it validates at the plan boundary, simulates, and produces an element diff. |
| **REQ-6** | `plan-simulator` element ops accept durable sections (not only `custom-block`); the obsolete restriction comment is replaced with the accurate remaining constraint. |
| **REQ-7** | **No arbitrary code.** No `eval`, `new Function`, `dangerouslySetInnerHTML`, srcdoc or iframe payload enters any AI path; insert ops still carry only a registered renderable type plus bounded content; raw model-authored subtree JSON is rejected. |
| **REQ-8** | **Allow-listed presets.** Animation `type`/`trigger`/`easing` and the interaction vocabulary stay closed-enum/regex constrained; P26 adds no new animation or interaction vocabulary. Any AI-authored interaction that the runtime does not execute is surfaced as unsupported rather than presented as effective. |
| **REQ-9** | **Single-history guarantee.** Applying an accepted element plan produces exactly ONE `withHistory` entry (`history.past.length` +1), regardless of operation count; undo restores the pre-plan project exactly; undo/redo and collab behave as for any other durable edit. |
| **REQ-10** | **No regression to site/page/section plans.** All non-element operation types, their validation, simulation, diffs, dependency ordering, caps and destructive-operation gating behave byte-identically to today. |
| **REQ-11** | Element selection remains transient: targeting samples `useCanvasInteractionStore` at prompt-generation time only; no `selectedElementId` / `selection` key is added to the editor store; `serializeProject()` is unaffected by selection. |
| **REQ-12** | `formatVersion: 3`, `DATABASE_VERSION = 9`, all persistence schemas, the export pipeline, the sandbox capability model and the capsule caps are unchanged. |
| **REQ-13** | Legacy `custom-block` keeps its existing whole-tree `props.tree` fold; existing custom-block element flows (targeting, planning, applying) behave as before. |
| **REQ-14** | **Graceful degradation.** An absent, empty, corrupt or unnormalizable tree, a non-renderable target type, a multi-selection, and a stale plan (`baseRevision` mismatch) must all fail closed with a structured result — never a thrown error and never a partial apply. |
| **REQ-15** | `scanPayloadForSecurityIssues` applies to the new geometry payload exactly as it does to existing element payloads (no bypass by adding a new op type). |

---

## 5. Invariants (must hold at every commit in this phase)

| Invariant | Why it must hold |
|---|---|
| **Transient selection, sampled at prompt time** | Element focus is UI state only; it never enters the project, history, persistence or CRDT. Sampling happens when a prompt is built, never on every keystroke (the existing `context-builder.ts` contract). |
| **Single commit boundary** | One accepted plan → one `withHistory` entry, via `prepareSectionTreeCommit`. No nested history entries (F6/R2). |
| **Single materialization entry** | `sectionToElementTree(section)` stays the only way a section becomes a tree in every AI path, so `reconcileDurableTreeWithProps` stays active. |
| **No executable AI output** | No AI-supplied string is ever executed or injected as markup or CSS; style/animation/interaction/geometry all pass schema validation and closed enums. |
| **Two-layer sanitization** | Data-boundary schemas own what a model may propose; `block-style-to-css.ts` remains a pure render-time translator and is never promoted to a validation boundary (D5). |
| **Bounded context** | The element digest and the whole context stay within their caps; every new field participates in the reduction ladder. |
| **Plan purity** | Simulation never mutates the store, never persists, never creates history. |
| **Non-element plans frozen** | Site/page/section plan behaviour is byte-identical. |
| **Legacy `custom-block` frozen** | `props.tree`, the whole-tree fold, and custom-block AI flows are untouched. |
| **Versions frozen** | `formatVersion: 3`, `DATABASE_VERSION = 9`, no new durable field, no migration. |
| **Shared predicate** | Targeting, simulation, inspector routing and canvas rendering all consult the shared durable-tree predicate — never a private re-implementation. |

---

## 6. Validation & verification strategy

### 6.1 Targeted unit tests (Vitest, `testTimeout: 10_000`)

| Suite | What it must pin |
|---|---|
| `ai-copilot/__tests__/element-context.test.ts` *(exists — extend)* | Durable **regular** section element produces a digest (F2 regression); geometry present and bounded; existing custom-block digest assertions unchanged; byte-identical context for identical input; reduction ladder drops geometry at the intended rung without exceeding `maxContextBytes`. |
| `ai-editing/__tests__/` — selected-element / target resolution *(new or extended)* | `resolveElementEditTarget` returns a target for a durable regular section; still `null` for a section without a durable tree; still `null` for non-renderable types and multi-selection; precedence order (canvas → inspector → root) unchanged. |
| `ai-editing/planner/__tests__/element-planner.test.ts` *(exists — extend)* | Element plans targeting durable regular sections; the new geometry operation is produced/validated only against a selected element. |
| `ai-editing/schemas/__tests__/` *(exists — extend)* | `update-element-geometry` accepts a valid clamped patch, rejects out-of-range/unknown keys, rejects missing identifiers, and is covered by the security scan. A raw subtree-JSON insert payload is still rejected (REQ-7). |
| `ai-editing/**/plan-simulator` tests *(extend)* | Element ops apply on a durable regular section; legacy `custom-block` unchanged; non-element ops unchanged (REQ-10). |
| `editor-store-ai-plan.test.ts` *(exists — extend)* | **Atomic apply:** an element plan over a durable regular section yields exactly ONE history entry; undo restores exactly; a multi-operation plan still yields ONE entry; no-op plans add none; revision guard and destructive gating unchanged. |
| `editor-store-section-tree.test.ts` *(exists — keep green)* | `commitSectionTree` materialization/no-op/persistence/custom-block compatibility unchanged — this is the suite that catches an accidental double-commit (R2). |
| `canvas-interaction-store.test.ts` *(exists — keep green)* | Selection remains transient; no `history` involvement (Invariant 1). |

### 6.2 E2E (Playwright, chromium, `--workers=1`, deterministic helpers — no arbitrary sleeps)

| Spec | Coverage to add |
|---|---|
| `e2e/ai-element-editing.spec.ts` *(exists — extend)* | Select an element inside a **durable regular** section, ask the copilot to change it, review, accept; assert one undo returns to the prior state. |
| *new or extended* | Element context awareness end-to-end: the prompt sent for a durable-section element includes that element's identity and geometry, and the applied result lands on the tree the canvas renders (no canvas/export divergence). |
| *new or extended* | Reject path: rejecting a plan writes nothing, creates no history entry, and leaves the tree byte-identical. |

### 6.3 Required gate order (sequential, never concurrent)

```
npm run typecheck   →   npm run lint   →   npm test   →   npm run build   →   npm run test:export-build   →   npm run test:e2e
```

Note: the brief's gate list names `typecheck → lint → vitest (testTimeout: 10_000) → build → export-build →
E2E`. `test:export-build` is included **because** this phase touches the element-op apply path, which the
export pipeline consumes; a green baseline is a required evidence artifact even though export output is frozen
by §1.3.

### 6.4 Known hazards to plan around (documented pre-existing — not introduced here)

1. **`boundedErrorToken` / `.next/dev/types` artifact failure** — `npm run typecheck` / `next build` can fail
   via the gitignored `.next/dev/types/app/api/generate/route.ts` after an E2E run regenerates it. Clean the
   artifact or use the source-only config (`.p24b-tsconfig.json`, now gitignored), and record which was used.
2. **Cold-cache `test:export-build`** — passes warm in ~42 s but has timed out once cold (>600 s).
   `--prefer-offline` / cache warm-up is the known mitigation.
3. **Pre-existing ESLint warning** — `e2e/ai-element-editing.spec.ts:310` (`reviewAndApply` unused). Not
   fixed by this phase; do not let it be misreported as a P26 regression.
4. **Pre-existing E2E flake families** — `realtime-structure` (`STALE_REVISION` mock race),
   `workspace-version-history` (post-restore reload race), and the AI-copilot shortcut load/timing flake that
   passes in isolation. Classify any failure explicitly rather than silently excluding it.
5. **The custom-code E2E specs are now tracked** (committed in `d97a406`), discharging P25 follow-up #1 — but
   they are parser/spec files only. Any new P26 E2E spec must be committed in the same phase, or the evidence
   will not be reproducible from a clean clone.

---

## 7. Risks & mitigations

| # | Risk | Mitigation |
|---|---|---|
| R1 | **Double history entry (highest).** Adding a `commitSectionTree` call inside `applyAiEditPlan`'s element arm produces two `withHistory` entries per plan, silently breaking undo granularity. | D7's explicit composition rule + REQ-9's `history.past.length` +1 assertion + keeping `editor-store-section-tree.test.ts` green. |
| R2 | **Silent no-op targeting.** Fixing F1 without F2 (or vice versa) yields a copilot that reports an element target but sends no element context, or a valid context that can never be reached. | REQ-1/REQ-2 are a single atomic change; the durable-regular-section digest test and the target-resolution test land together. |
| R3 | **Context bloat.** Geometry plus existing surfaces can push the element scope past `maxContextBytes`, and the reduction ladder may drop the wrong rung, degrading the very context this phase adds. | REQ-3/REQ-4 byte-budget test asserting which rung drops first and that the cap holds. |
| R4 | **Model-authored geometry is a layout footgun.** Absolute pixel geometry from an LLM can produce broken or out-of-bounds layouts. | D4's clamped partial patch + REQ-14's fail-closed behaviour; OQ-3 decides whether the model may propose geometry at all or only deltas. |
| R5 | **`custom` in the animation allow-list read as an escape hatch.** "Allow-listed presets" is satisfied by a closed token set that still contains `custom`. | D6's explicit caveat + REQ-8 + OQ-5 (an AI-only narrower allow-list). |
| R6 | **Unexecutable interactions presented as applied.** A schema-legal `submit-form`/`sticky`/`parallax` plan does nothing at runtime (P24-C follow-up #9), so the user believes a change landed. | REQ-8's unsupported-surfacing requirement; OQ-6 decides warning vs exclusion. |
| R7 | **`block-style-to-css.ts` mistaken for a sanitizer (F8).** An implementer routes AI style through the render translator believing that validates it. | D5's two-layer table + REQ-7; the render translator stays off the validation path. |
| R8 | **Widening the predicate breaks legacy custom-block flows.** A unified predicate that changes `custom-block` behaviour silently regresses P22-H. | REQ-13 + keeping the existing custom-block element tests green; R-1a/R-1b guards on the widened predicate. |
| R9 | **Non-element plans regress.** Refactoring the plan boundary for element ops perturbs page/section ops. | REQ-10 + the existing `editor-store-ai-plan.test.ts` suite as the frozen contract. |
| R10 | **Duplicated commit functions diverge further.** `commitSectionTree` and `commitElementTree` are byte-identical today (F6); a third copy is easy to add. | D7 forbids faking the shared path; consolidation is deferred and recorded as a follow-up rather than smuggled in. |
| R11 | **Stale plan applied against a moved target.** `baseRevision` mismatch or a since-deleted element. | REQ-14 + the existing stale-plan path (`buildStalePlanSummary`, `plan-service.ts:147`); re-validate against the freshest project at apply time. |

---

## 8. Likely implementation areas **[inference — file-level surface, not a committed diff plan]**

| Area | File | Expected nature of change |
|---|---|---|
| Element target | `src/features/ai-editing/selected-element.ts` | Widen the section predicate at `:88` (D1). |
| Element context | `src/features/ai-copilot/context/context-builder.ts` | `sectionToElementTree` lookup (`:235`); add `geometry` to `CopilotElementDigest`, `buildElementDigest`, and the `reduceContext` ladder (D2/D3). |
| Plan schemas | `src/features/ai-editing/schemas/plan-schemas.ts` | Add `update-element-geometry`; add it to `AiEditOperationSchema` (D4). |
| Plan types | `src/features/ai-editing/plan-types.ts`, `types.ts` | Geometry operation type + diff typing. |
| Simulator | `src/features/ai-editing/services/plan-simulator.ts` | Lift the custom-block restriction (`:481-488`); geometry arm (D8). |
| Diff | `src/features/ai-editing/services/diff-builder.ts` | Geometry diff arm (`kind: "element"`). |
| Apply boundary | `src/features/editor/store/editor-store.ts` | Element arm of `applyAiEditPlan` (`:1144`) commits through the durable boundary once (D7). |
| Copilot service | `src/features/ai-copilot/services/copilot-service.ts`, `src/features/ai-editing/services/plan-service.ts` | Pass the widened element scope/target through; keep `resolveEffectiveScope` semantics. |
| Review UI | `src/features/ai-copilot/components/PlanReview.tsx`, `src/features/ai-editing/components/AiEditPlanReview.tsx` | Render geometry diffs; surface unsupported interactions (D6). |
| Elements schemas | `src/features/elements/schemas/element-schemas.ts` | **No change expected** — `ElementGeometrySchema` (`:153`) is consumed as-is. |
| Style translation | `src/features/blocks/render/block-style-to-css.ts` | **No change expected** — consumed at render time only (D5). |
| Sandbox / export | `src/features/export/**`, sandbox runtime | **No change expected** (§1.3). |
| Tests | `ai-copilot/__tests__/`, `ai-editing/**/__tests__/`, `editor/store/*ai-plan*` suites | Per §6.1. |
| E2E | `e2e/ai-element-editing.spec.ts` (+ new) | Per §6.2. |

**Correction to the brief's file list:** the brief names `src/features/ai-editing/` for "element plan schema,
diff generator, simulate/apply pipeline" — all three exist, but they are split as `schemas/plan-schemas.ts`
(schema), `services/diff-builder.ts` (diff), and `services/plan-simulator.ts` (simulate) with apply living in
`src/features/editor/store/editor-store.ts` (`applyAiEditPlan`), **not** inside `ai-editing`. The apply boundary
is in the editor store. Both are reflected above. The brief also places the active-element descriptor in
`ai-copilot/`; the descriptor resolution lives in `ai-editing/selected-element.ts` and is *consumed* by
`ai-copilot` — which is why the F1 fix and the F2 fix are in two different directories.

---

## 9. Acceptance criteria (phase exit)

1. Selecting an element inside a **durable regular** section and asking the copilot to change it produces an
   element-scoped plan targeting that element (today: no plan is offered at all).
2. The prompt/context built for that element includes its identity, renderable type, bounded props/styles, and
   **geometry** — and stays within the context byte cap.
3. A geometry change requested through the copilot applies as a schema-validated, clamped patch, or is refused
   with a structured error — never a partial write.
4. Accepting an element plan creates exactly **one** history entry; a single undo restores the pre-plan project
   exactly; rejecting writes nothing.
5. Site/page/section-level plans are byte-identical in behaviour to the pre-phase baseline.
6. Legacy `custom-block` element targeting, planning and applying are unchanged.
7. No AI-supplied string is executed, and no raw model-authored subtree JSON is accepted.
8. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:export-build` and the
   phase-relevant Playwright specs are green, with any excluded failure classified and documented.

---

## 10. Open questions (require review/decision before implementation)

| # | Question | Why it matters |
|---|---|---|
| **OQ-1** | Does the widened target predicate use `sectionHasDurableTree(section)` alone, or `isCustomBlockSection(section) \|\| sectionHasDurableTree(section)`? | Determines whether `custom-block` flows are untouched by construction or only by test. Must not be answered by assumption — verify against `section-element-adapter.ts:169`. |
| **OQ-2** | Should the element digest read geometry from the durable node unconditionally, or only when a geometry op is plausible? | Geometry for every element scope raises context size; this interacts with the reduction ladder (R3). |
| **OQ-3** | May the model author **absolute** geometry, or only **relative deltas** ("move down 16px", "make it wider")? | Absolute pixel geometry from an LLM is the highest-risk payload in this phase (R4). Deltas are safer but need a different operation shape. |
| **OQ-4** | Does P26 fold in P25's **OQ-3** (broadening the element-scoped AI entry) as its headline, or is that tracked separately? | This document treats it as the headline motivation (§0); confirm ownership so it is not left unowned twice. |
| **OQ-5** | Tighten the animation `type` enum to a narrower **AI-only** allow-list (excluding `custom`), or accept the authoring enum as-is for AI? | "Strictly allow-listed presets" (Invariant 2) is only literally true under the narrower option (R5/D6). |
| **OQ-6** | For interactions the runtime does not execute (P24-C follow-up #9 — `submit-form`, `custom`, `sticky`, `parallax`), does the planner warn, or refuse to propose them? | Prevents a schema-legal plan that silently does nothing (R6). |
| **OQ-7** | Consolidate `commitSectionTree` and `commitElementTree` (byte-identical today, F6), or leave both and record it? | Touching the shared boundary risks the P22-B canvas and P24-B durable contracts; but leaving it invites a third copy (R10). |
| **OQ-8** | Does P26 change the **planner prompt/system prompt** shape (a new element-context section), or only the context payload? | The brief names "system prompt injection"; if the prompt template changes, prompt-level tests and any embedded few-shot examples are affected. |

---

## 11. Deliverables

1. `docs/phase-p26-spec.md` — this document.
2. Implementation slices with their own commits, at minimum: **Slice 1** targeted generalization
   (`selected-element.ts` + `plan-simulator.ts`) with the digest fix (S3, S1); **Slice 2** geometry in the
   digest and as an operation (S1, S2); **Slice 3** the apply-boundary composition + copilot UI review
   surfaces (S4, S5); **Slice 4** tests and E2E (S6).
3. `docs/phase-p26-report.md` — outcome, verified changes per slice, invariant confirmations with evidence,
   gate results table, flake classification, and recorded follow-ups.
4. Answers to OQ-1 … OQ-8, recorded in the report even when resolved by implementation.

---

## 12. STOP

This document specifies only. It modifies no source file, no test, and no schema; it changes no version
constant, no cap, and no sandbox property. Implementation must not begin until **OQ-1** (predicate shape) and
**OQ-3** (absolute vs relative geometry) are answered, because together they define what this phase actually
ships.
