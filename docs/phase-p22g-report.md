# Phase P22-G — Interactions + Animations (Report)

> Baseline: P22-A/B/C/D/E/F complete and validated (see their reports). P22-G
> delivers declarative interactions + animations end-to-end on the P22-A
> element model: typed NavTarget authoring, hover/focus/click behaviors,
> entrance animations (load + scroll reveal), visitor-preview runtime,
> reduced-motion support, accessibility, durable persistence, one-atomic-entry
> store/history actions, and export emission parity with the canvas.
> **P22-A through P22-F remain closed. P22-H has not been started.**

---

## 1. What was implemented

- **Pure presentation/resolution layer** (`elements/interactions/present.ts`)
  that deterministically turns the P22-A declarative model
  (`ElementAnimation` / `ElementInteraction` / `NavTarget`) into safe CSS,
  attributes, and click behavior — shared by canvas, preview, and export.
- **BlockRenderer runtime** — tree-level `<style>` injection (keyframes,
  hover/focus rules, reduced-motion guard), a scroll-reveal
  `IntersectionObserver`, real safe anchors for click→navigate,
  keyboard-accessible scroll-to/back handlers, `tabIndex` focusability, and
  inert editing-surface links.
- **Store/history** — `updateElementAnimation` / `updateElementInteraction`
  (schema-validated at the boundary, no-op skip, ONE `withHistory` entry).
- **Inspector UI** — universal **Animation** + **Interactions** groups on
  every element schema, with composite controls (`AnimationField`,
  `InteractionField`) and the **full typed NavTarget picker** (page, section,
  external, email, phone, back).
- **Export emission** — the generated custom-block component emits keyframes,
  hover/focus rules, the reduced-motion guard, a bounded safe-navigation
  runtime (`baIsSafeNav`, `baScrollTo`), and the page route map (typed
  NavTargets resolve to real exported routes).
- **Reduced motion** — entrance animations disabled, interaction feedback
  preserved, instant scrolling.
- **Accessibility** — keyboard-focusable focus effects, `role="link"` +
  Enter handling for scroll/back, native anchors for navigation.
- **Durable persistence** — animation/interaction are optional Zod-bounded
  fields on stored custom-block tree nodes; old trees open unchanged.

## 2. Files / components changed

**P22-G additions on the pre-existing P22-A/B/C/D/E/F working tree:**

- `src/features/elements/interactions/present.ts` — **new** pure resolution
  layer (see architecture §6).
- `src/features/blocks/render/BlockRenderer.tsx` — **extended** with
  animation/interaction presentation, scroll-reveal observer,
  `InteractiveContentLink`, safe anchor + keyboard-accessible preview paths.
- `src/features/editor/store/editor-store.ts` — **extended** with
  `updateElementAnimation` / `updateElementInteraction` (one atomic entry).
- `src/features/code-import/schemas/custom-block-schema.ts` — **extended**
  with optional `animation` / `interaction` fields on stored tree nodes.
- `src/features/collaboration/crdt/tree-normalizer.ts` — shape-agnostic
  bridge verified for the new fields (no logic change needed; covered by
  `tree-normalizer-p22g.test.ts`).
- `src/features/elements/inspector/{types,fields,schemas,mutate,resolver}.ts`
  — **extended** with the universal Animation + Interactions field sources.
- `src/features/inspector/components/controls/AnimationField.tsx`,
  `InteractionField.tsx` — **new** composite inspector controls.
- `src/features/editor/components/NavigateToPicker.tsx` — **new** full typed
  `NavTargetPicker` (supersedes the P22-E href-writing picker for
  interaction targets).
- `src/features/export/generators/section-generators/custom-block-generator.ts`
  — **extended** with animation/interaction emission + safe runtime + route map.
- `src/features/editor/sections/CustomBlockSection.tsx` — passes project
  pages so typed NavTargets resolve in the visitor preview.
- `src/components/editor/RightSidebar.tsx` — custom-block sections route to
  the universal element inspector (P22-C panel).

**Tests added:**

- `src/features/elements/__tests__/present.test.ts` (resolution layer)
- `src/features/editor/store/__tests__/editor-store-element-animation.test.ts`
- `src/features/inspector/__tests__/AnimationInteractionFields.test.tsx`
- `src/features/editor/components/__tests__/{NavTargetPicker,NavigateToPicker}.test.tsx`
- `src/features/code-import/__tests__/custom-block-p22g-persistence.test.ts`
- `src/features/collaboration/__tests__/tree-normalizer-p22g.test.ts`
- `src/features/export/__tests__/custom-block-p22g-export.test.ts`
- `e2e/interactions-animations.spec.ts` (6 E2E tests)
- `docs/phase-p22g-architecture.md`, `docs/phase-p22g-report.md`

## 3. Persistence behavior

- The stored custom-block tree-node schema carries optional
  `animation: ElementAnimationSchema` and `interaction:
  ElementInteractionSchema` (bounded, Zod-validated at the schema boundary).
- Old trees without the fields validate unchanged; new trees round-trip
  through `ProjectSchema` → normalizer → serializer and the shape-agnostic
  collab bridge (`custom-block-p22g-persistence.test.ts`,
  `tree-normalizer-p22g.test.ts`).
- E2E verifies save → reload preserves the animation + interaction
  configuration in the editor store and inspector.

## 4. Store / history behavior

- Both new actions: reject non-writable sessions, validate at the boundary
  (invalid configs rejected, never coerced), no-op by durable content (no
  history entry), apply one validated op, fold the tree, commit **one atomic
  `withHistory` entry**. Undo/redo revert the full entry
  (`editor-store-element-animation.test.ts`).

## 5. Rendering behavior

- Canvas: animation attributes + inline animation properties + injected
  hover/focus rules render on the element; selection-first click handling;
  links stay inert.
- Visitor preview: click→navigate becomes a real safe `<a href>`
  (bubbling to the existing preview-shell classification), click→scroll-to
  becomes `<a href="#id">` with the bounded `scrollElementIntoView`, back is
  handled inline, focus effects add `tabIndex` with `:focus-visible` rules.

## 6. Inspector behavior

- Every element schema gets **Animation** + **Interactions** groups (last
  position, preserving the default-open first section).
- `AnimationField`: trigger, preset, duration, delay, easing, clear.
- `InteractionField`: Click (navigate with the full picker, or scroll-to with
  an in-tree target select), Hover (color/background/scale/shadow), Focus
  (same surface). Clearing commits `null`.

## 7. NavTarget behavior

- The full picker writes a typed `NavTarget` (page / section / external /
  email / phone / back) into the click interaction and shows the resolved
  href via `navTargetToHref`; unresolved targets show "(unresolved)".
- `resolveNavTarget` resolves through the existing `computePageRoutes`
  route table; `isSafeNavUrl` rejects unsafe schemes; the renderer re-checks
  the resolved href before emitting an anchor.
- Exported pages pass the route map so typed targets resolve to real routes.

## 8. Export behavior

- Emitted custom-block component contains `@keyframes ba-fade`, the
  `prefers-reduced-motion` guard, `animation: none !important`, the bounded
  runtime (`baIsSafeNav`, `function baScrollTo`), and no `eval(` /
  `new Function`.
- Emitted page file serializes the animation + passes
  `routes={"page-1":"/","page-2":"/about"}` so typed NavTargets resolve to
  real exported routes.
- The generated site compiles via `test:export-build`.

## 9. Reduced-motion behavior

- Guard emitted only when a tree has an entrance animation;
  `[data-ba-anim="load"]` and `[data-ba-anim="scroll"]` become
  `animation: none !important` (scroll reveals force `opacity: 1`).
- Hover/focus feedback and navigation remain functional under reduced
  motion; `scrollElementIntoView` scrolls instantly.

## 10. Validation gates and exact results

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | ✅ clean (0 errors) |
| `npm run lint` | ✅ 0 problems |
| `npx vitest run --maxWorkers=4` | ✅ **325 files / 4509 tests passed** (P22-F baseline: 318 / 4415 → +7 files / +94 tests) |
| `npm run build` | ✅ production build succeeded |
| `npm run test:export-build` | ✅ generated site builds (1/1, ~57s) |

## 11. E2E results

One spec at a time on a single Playwright-managed webpack dev server
(port 3000, `--workers=1`), per the P22-C/D/E/F discipline.

| Spec | Result |
|---|---|
| `e2e/interactions-animations.spec.ts` (P22-G) | ✅ **6/6** |
| `e2e/element-inspector.spec.ts` (P22-C, directly affected) | ✅ 6/6 |
| `e2e/canvas-selection.spec.ts` (P22-B regression) | ✅ 7/7 |
| `e2e/element-library.spec.ts` (P22-D regression) | ✅ 4/4 |
| `e2e/page-navigation.spec.ts` (P22-E regression) | ✅ 4/4 |
| `e2e/pages.spec.ts` (P22-E regression) | ✅ 2/2 |
| `e2e/editor.spec.ts` (directly affected) | ✅ 31/32 — 1 environmental (see §12) |
| `e2e/block-tree.spec.ts` (Phase O regression) | ✅ 7/7 |
| `e2e/responsive-engine.spec.ts` (P22-F regression) | ✅ 5/5 |

**P22-G spec coverage confirmed:** A — entrance animation config, canvas
render, reload persistence, export emission, reduced-motion disable;
B — hover effect renders visually + keyboard focus effect; C — click→page
via the full picker, resolved `/about`, preview navigation through the
existing routing/security model, exported safe anchor + route map; D —
click→scroll-to scrolls the preview to the target; E — reload persistence of
animation + interaction configuration. Scope exclusions honored (no toggle /
open-modal / submit-form / custom handlers / sticky / parallax / timeline /
orchestration / raw JS / second renderer / new dependencies).

## 12. Failures and their evidence-based classification

**First P22-G run: 6/6 failed — all test-spec bugs, not product regressions.**

1. **Test 1 (persistence) + Test 5 (export)** — the mock's About page had
   `sections: []`. The project schema (`PageSchema.sections.min(1)`) and the
   export validator both require ≥1 section per page, so save→reload failed
   deserialization ("Opening project…" + recovery alert) and export failed
   with `Page "page-2" must have at least one section` (visible in the page
   snapshot). **Fix: the mock's page-2 got its own small custom-block
   section.** Product unchanged.
2. **Tests 2/3/4 (strict-mode violations)** — the visitor preview overlays
   the canvas, so `[data-testid="block-button"]`, `[data-block-id="target"]`,
   and the `style` locator matched both surfaces. Product rendering was
   correct (both matched elements were the expected anchors/elements).
   **Fix: scope locators to `visitor-preview-content` / the custom-block
   section's style; use `expect.poll(textContent)` for `<style>` (Playwright
   text assertions strip style content).**
3. **Test 6 (reduced motion)** — the test configured click→navigate on the
   **heading** but asserted on the **button**, and relied on an unbounded
   tab loop that the canvas's contentEditable heading (same `id`) short-
   circuits. **Fix: focus effect on the heading + click→navigate on the
   button; deterministic keyboard focus (focus last preview-toolbar button,
   then one Tab) asserted against the visitor-preview element.**

After the spec fixes: **6/6 P22-G tests pass deterministically.**

**Regression run:** `editor.spec.ts` → "Real pipeline › generation succeeds
with available provider" failed once (30s `waitForResponse` timeout awaiting
a real `/api/generate` response). **Classified environmental**: the test
exercises the un-mocked external generation path; the route awaits the
Gemini SDK call with no timeout, and the rule-based fallback only triggers on
rejection, so an outbound request that exceeds the window times out.
**Evidence**: (a) the isolated re-run **passed** (1/1, 40.5s — rule-based
fallback responded); (b) all 31 mocked generate tests in the same spec pass;
(c) P22-G touches none of the generation route/providers (`git diff` shows no
changes to `app/api/generate`, `gemini`/`rule-based` providers). No product
code was changed for it.

## 13. Dependencies / no new dependencies

No new dependencies were introduced. P22-G uses existing runtime deps only
(React, Zustand, Zod, JSZip for E2E asserts, Playwright).

## 14. Git scope verification

- `git status` shows only the intended P22-A/B/C/D/E/F working tree plus the
  P22-G files listed in §2; no debug scripts, temp files, or logs were added.
- No previously shipped phase was reopened or weakened; P22-G changes are
  additive (optional fields, new actions, extended renderer/generator).
- Port 3000 was verified free and leftover Playwright/Node processes were
  killed after the runs.

## 15. Explicit scope exclusions

- No `toggle`, `open-modal`, `submit-form`, `custom` handlers,
  `start-animation` (typed in the P22-A model but inert in P22-G).
- No `sticky` / `parallax` scroll effects, timeline editor, cross-element
  animation orchestration, raw JavaScript execution, second renderer/runtime,
  or new dependencies.
- No redesign/refactor/reopening of P22-A through P22-F.

## 16. Final P22-G status

**P22-G COMPLETE.** Declarative interactions + animations are implemented
and validated end-to-end: durable persistence, one-atomic-entry store/history
actions, a pure shared presentation layer, extended `BlockRenderer` runtime,
visitor-preview safe navigation, the full typed NavTarget picker, universal
inspector groups, reduced-motion + accessibility behavior, and export
emission parity. All gates green (tsc, lint, 4509 vitest tests, production
build, export-build) and 6/6 P22-G E2E + 71/72 regression E2E (the single
failure is the pre-existing external-provider real-pipeline test, re-passed
in isolation).

**P22-A through P22-F remain closed. P22-H has not been started.**
