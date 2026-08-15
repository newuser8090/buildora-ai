# Phase P22-H — Element AI Editing (Report)

> Baseline: P22-A through P22-G complete and validated (see their reports).
> P22-H delivers element-scoped AI editing end-to-end: a single renderable
> element in a custom-block section is selected, planned (element-scoped,
> `pageId` + `sectionId` + `elementId`), reviewed as an element operation/diff
> in the existing `AiEditPlanReview`, applied atomically through the existing
> plan pipeline, persisted, and echoed in the AI Copilot's bounded context.
> **P22-A through P22-G remain closed. No P22-I/J or P23 work.**

---

## 1. Implementation summary

- **Element scope + operation vocabulary** — `AiEditScope` gains `element`;
  nine element operations (`update-element-props/style/responsive/animation/
  interaction`, `insert/delete/duplicate-element`, `set-element-visibility`)
  in `plan-types.ts`.
- **Zod schemas** — one schema per element op in `plan-schemas.ts`, reusing the
  validated element style/animation/interaction schemas and rejecting
  element-only (unrenderable) insert types.
- **Simulator** — element-op appliers through the existing
  `applyElementOperation` engine with the materialize → apply → fold
  (`sectionToElementTree` → `elementTreeToSection`) path.
- **Diffs** — `kind: "element"` diffs (changed props/style, viewport deltas,
  animation/interaction objects, insert/delete/duplicate/visibility).
- **Rule-based planner** — a dedicated element recognizer set that runs only
  for element scope (bold/larger/color, responsive, animation, interaction
  links/hover, insert/delete/duplicate/hide/show).
- **Gemini provider** — element op vocabulary in the system instruction + a
  bounded digest of the selected element (never the whole tree).
- **Selected-element helper** — new `selected-element.ts`, the single shared
  resolver (canvas selection → inspector selection → section root).
- **Copilot** — element scope with `elementId`, bounded element digest,
  bounded pages/theme digests, `resolveEffectiveScope` mapping, request
  mapping in `requestCopilotPlan`.
- **Inspector AI entry** — `ElementAiComposer` on the universal element
  inspector (custom-block sections only) routing into the existing plan
  pipeline (plan summary card → `AiEditPlanReview`).
- **Atomic apply** — element plans apply through `applyAiEditPlan` →
  `commitElementTree` → `withHistory` (one atomic entry, undo/redo, stale,
  project-mismatch and destructive guards).

## 2. Exact P22-H changes

**P22-H implementation files** (all verified in the working tree):

- `src/features/ai-editing/plan-types.ts` — element scope + operation types
- `src/features/ai-editing/schemas/plan-schemas.ts` — element-op Zod schemas
- `src/features/ai-editing/services/plan-simulator.ts` — element-op appliers
- `src/features/ai-editing/services/diff-builder.ts` — element diffs
- `src/features/ai-editing/planner/rule-based-planner.ts` — element recognizers
- `src/features/ai-editing/planner/gemini-plan-provider.ts` — element
  instruction + bounded digest
- `src/features/ai-editing/selected-element.ts` — **new** shared selected-element
  helper
- `src/features/ai-editing/components/AiEditPlanReview.tsx` — element op
  summaries (UI unchanged otherwise)
- `src/features/ai-copilot/types.ts` — `CopilotScope` element scope with
  optional `elementId`
- `src/features/ai-copilot/context/context-builder.ts` — bounded element
  digest + pages/theme digests
- `src/features/ai-copilot/services/copilot-service.ts` — element scope
  resolution + planner-scope mapping
- `src/features/ai-copilot/hooks/useCopilot.ts` — selected-element wiring
- `src/features/inspector/components/ElementInspectorPanel.tsx` —
  `ElementAiComposer` (P22-H block inside the P22-C feature directory)
- `src/features/editor/store/editor-store.ts` — element-plan atomic apply path
  (P22-H portion of the store's cumulative working-tree diff)

**P22-H test files:**

- `src/features/ai-editing/schemas/__tests__/element-plan-schemas.test.ts`
- `src/features/ai-editing/planner/__tests__/element-planner.test.ts`
- `src/features/ai-editing/services/__tests__/element-plan-simulator.test.ts`
- `src/features/ai-editing/services/__tests__/element-plan-diff.test.ts`
- `src/features/ai-copilot/__tests__/element-context.test.ts`
- `src/features/editor/store/editor-store-element-ai-plan.test.ts`
  (`applyAiEditPlan — element plans`: atomic apply, ONE history entry for a
  multi-op plan, undo/redo, stale, project mismatch, destructive
  confirmation, failed-simulation safety)
- `src/features/inspector/__tests__/ElementInspectorPanel.test.tsx`
  (`ElementInspectorPanel — Phase P22-H AI entry`)
- `src/features/ai-editing/components/__tests__/AiEditPlanReview.test.tsx`
  (`AiEditPlanReview — element plans`)
- `e2e/ai-element-editing.spec.ts` — **new** E2E spec (3 tests)

**P22-H documentation:**

- `docs/phase-p22h-architecture.md` — created
- `docs/phase-p22h-report.md` — this file

**Pre-existing working-tree changes (NOT P22-H):** the git status shows a
broader set of modified/untracked files (`Canvas.tsx`, `PageTabs.tsx`,
`RightSidebar.tsx`, `editor-ui-store.ts`, `page-structure.ts`,
`persistence/*`, `elements/*`, `canvas/*`, `library/*`, prior-phase E2E
specs, etc.). These are the **P22-A through P22-G working tree** carried
forward — e.g. `Canvas.tsx` mounts the P22-B manipulation layer,
`RightSidebar.tsx` carries the P22-C/D element inspector + Elements tab, and
`PageTabs.tsx` carries the homepage feature. They were NOT modified by P22-H
and were not reverted.

## 3. Validation gates and exact results

| Gate | Result |
|---|---|
| Unit tests (`npx vitest run`) | ✅ **4,611 tests passed** |
| Production build (`npm run build`) | ✅ passed |
| Export-build (`npm run test:export-build`) | ✅ passed |

These three gates were completed before the E2E work and were not re-run after
the only post-implementation change (the E2E spec fix in §4), which touches a
Playwright test file only.

## 4. P22-H E2E results

One spec at a time on a single Playwright-managed webpack dev server
(port 3000, `--workers=1`), per the P22-C/D/E/F/G discipline.

| Run | Result |
|---|---|
| `npx playwright test ai-element-editing --workers=1 --reporter=line` | ✅ **3/3 passed** (~40s) |

Coverage delivered by the three tests:

- **Test 1 (full inspector flow)** — select a renderable heading via the build
  tree (A), open the element AI entry (B), assert the plan request is
  element-scoped with `pageId` + `sectionId` + `elementId` (C), generate an
  element plan (D), review the element op + diff in `AiEditPlanReview` (E),
  apply (F), verify the canvas `font-weight: 700` (G), save + reload
  persistence (H), undo/redo (I).
- **Test 2 (animation)** — an `update-element-animation` plan flows through the
  existing P22-G model: canvas gets `data-ba-anim="load"` +
  `animation-name: ba-fade` and the edit persists across save + reload (K).
- **Test 3 (copilot)** — with an element selected, the copilot resolves element
  scope, the plan request carries the element ids, the review names "this
  element", apply produces "Done — updated 1 thing" and the canvas reflects
  the bold heading (J).

All three tests are **offline-safe**: the `/api/generate` plan-edit route is
mocked with a deterministic, schema-valid, element-scoped plan derived from the
request's own project payload; no live Gemini request is made.

### E2E failure classification (initial run)

The first run of `e2e/ai-element-editing.spec.ts` had **2 of 3 tests fail**:

- **Classification: E2E SPEC BUGS — not product regressions.**
- **Root cause:** the spec's `openProject()` helper returned the preview
  `Locator` instead of the mocked API handle, so the two tests that called
  `const { getPlanRequest } = await openProject(page)` threw
  `TypeError: getPlanRequest is not a function` before reaching any product
  code.
- **Evidence:** the animation test (which did not use `getPlanRequest`) passed
  on the same run; the failures were `TypeError`s inside the test file itself,
  not assertions on product behavior.
- **Fix (spec only):** `openProject()` now returns the `mockApi` handle
  (`{ getPlanRequest }`); product code was NOT changed. After the fix all 3/3
  tests pass deterministically.

## 5. AI regression results

One Playwright run (single managed server, `--workers=1`):

| Spec | Result |
|---|---|
| `e2e/ai-copilot-followup.spec.ts` | ✅ |
| `e2e/ai-copilot-memory.spec.ts` | ✅ 5/5 |
| `e2e/ai-copilot-safety.spec.ts` | ✅ 3/3 |
| `e2e/ai-copilot.spec.ts` | ✅ 5/5 |
| `e2e/ai-editing.spec.ts` | ✅ 3/3 |
| `e2e/inline-ai-editing.spec.ts` | ✅ 2/2 |
| `e2e/ai-page-editing.spec.ts` | ✅ 2/2 |
| `e2e/ai-website-editing.spec.ts` | ✅ 1/1 |
| **Total** | ✅ **22/22 passed** (~1.9m) |

Section/page/project AI editing and copilot behavior remain intact.

## 6. No new dependencies

No new runtime or dev dependencies were introduced. P22-H uses existing
libraries only (React, Zustand, Zod, Playwright, JSZip in E2E).

## 7. No scope expansion / no reopened phases

- Element AI is limited to **custom-block sections** and a **single selected
  renderable element**; multi-select element AI is out of scope.
- No new renderer, provider, endpoint, persistence model, dependency, or
  parallel AI plan system.
- No raw JS / custom-code execution; animation/interaction edits reuse the
  P22-G declarative model.
- `AiEditPlanReview` is reused; no second review UI.
- **P22-A through P22-G remain closed** — none were reopened, refactored, or
  weakened. **P22-I, P22-J, and P23 have not been started.**

## 8. Git / housekeeping status

`git status --short` (P22-H-relevant entries):

- New: `e2e/ai-element-editing.spec.ts`, `src/features/ai-editing/selected-element.ts`,
  the five P22-H unit test files, `docs/phase-p22h-architecture.md`,
  `docs/phase-p22h-report.md`
- Modified (P22-H portions): the `ai-editing/*`, `ai-copilot/*`,
  `inspector/components/ElementInspectorPanel.tsx`, and
  `editor/store/editor-store.ts` files listed in §2
- Modified/untracked remainder: the pre-existing P22-A–G working tree
  (not touched by P22-H, not reverted)

No debug scripts, temp files, or logs were added. Playwright dev-server
instances were stopped after the runs.

## 9. Final P22-H status

**P22-H COMPLETE.**

- Implementation: ✅ PASS
- Unit: ✅ 4,611 tests passed
- Build: ✅ production build passed
- Export-build: ✅ passed
- P22-H E2E: ✅ 3/3 passed (`e2e/ai-element-editing.spec.ts`)
- AI regressions: ✅ 22/22 passed
- Docs: ✅ `docs/phase-p22h-architecture.md` + `docs/phase-p22h-report.md`
- Product-code changes after implementation: ✅ **NONE** — only the E2E spec
  helper was corrected (the `openProject` return value); no product code was
  modified after the initial implementation
- New dependencies: ✅ NONE
- P22-A through P22-G: ✅ remain CLOSED
- P22-I/J: ✅ not started

**P22-H CLOSED.**
