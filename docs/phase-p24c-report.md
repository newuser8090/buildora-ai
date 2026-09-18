# Phase P24-C — Broader Custom-Code Authoring & Section-Tree Export (cumulative closeout report)

Branch: `phase-p22-canva-elements`
Specification: `docs/phase-p24c-spec.md` (commit `c90fdea`)
Status date: 2026-09-19
Scope of this report: **validation / closeout of the P24-C implementation.** No product behaviour was
redesigned during closeout. The only implementation change made here is the generated-type widening
authorised by the closeout brief (§5), required because the export compilation gate's own evidence proved
the generated `BlockNode` declaration rejected valid P22-G payloads.

Commits in this phase:

| Commit | What |
| --- | --- |
| `c90fdea` | `docs: add Phase P24-C specification for broader custom code` |
| `c8ccf9d` | `feat(elements): broaden custom-code capability across renderable elements (P24-C Slice 1)` |
| `4d2e523` | `feat(editor): mount universal element inspector for active element selection (P24-C Slice 2)` |
| `eca3d3c` | `feat(export): emit custom-code frames for durable section trees (P24-C Slice 3)` |
| *(this closeout)* | generated-type widening + `docs: close out Phase P24-C broader custom-code authoring and export` |

---

## 1. Outcome

**P24-C is COMPLETE.** Custom code can now be authored on any **renderable** element of any section (Slices 1
+ 2), and custom code stored on a **durable `section.tree`** is discovered recursively and emitted through the
already-validated sandboxed tree runtime (Slice 3) — without widening the sandbox model, without touching the
legacy `custom-block` behaviour, and without executing anything on the editor canvas.

The P23 deferral this phase discharges, quoted verbatim in `docs/phase-p23-architecture.md` §10 and
`docs/phase-p23-report.md` §8:

> *"Custom-code authoring is scoped to the curated leaf blocks inside `custom-block` sections (the durable
> element-tree surface). Broader authoring (any element, any section) requires durable universal element
> trees — **P24**."*

---

## 2. Verified changes

### 2.1 Slice 1 — registry capability (`c8ccf9d`)

| Area | Change |
| --- | --- |
| Capability rule | `elementSupportsCustomCode(type)` now returns `isRenderableElementType(type)` behind an input guard (`typeof type !== "string" \|\| type.length === 0 → false`). The curated leaf allow-list is **no longer the gate**. |
| Legacy set | `CUSTOM_CODE_LEAF_TYPES` is **retained and now exported** as the canonical P23-D legacy leaf set (7 types), with its doc comment rewritten to say it is no longer the gate. |
| Definition flag | `deriveElementDefinitionFromBlock` sets `editor.supportsCustomCode: true` for block-derived definitions (by construction registered + renderable), so the definition flag and the helper cannot disagree — asserted for every registered type. |
| Newly eligible | 22 container / layout / composite / interactive / navigation block types (verified present in `blockRegistry`). |
| Still ineligible | The 8 element-only families (`section`, `text`, `logo`, `list`, `carousel`, `product-card`, `price`, `custom-component`) — no renderer, no durable persistence path; plus unrecognized, empty and non-string input. |
| Inspector schema | Follows the rule automatically (`inspector/schemas.ts:74`); now exposes the group for eligible types and still omits it for element-only ones (REQ-2 satisfied in the schema layer). |

> **Scope note (spec D1).** The slice brief's example *"legacy leaf types (e.g. text, button, etc.) continue to
> return true"* conflicts with the specification, which explicitly keeps element-only families ineligible.
> The spec's rule was implemented and an explicit `text → false` test pins it, rather than silently making an
> element-only type eligible.

### 2.2 Slice 2 — inspector mounting & selection routing (`4d2e523`)

| Area | Change |
| --- | --- |
| Selection source | The transient canvas-interaction-store selection (`selection.ids` / `anchorId`) — **never** a new durable field. Element selection is *not* in the editor store, and still is not. |
| Routing | `RightSidebar`'s `InspectorSlot` order is now: `guided` → `custom-block` **or** active element selection → `ElementInspectorPanel` → the existing per-type inspector. |
| Gating | A non-`custom-block` section routes to the universal panel only when it carries a **durable `section.tree`** and exactly one **nested** element of that tree is selected. |
| Fall-through | Empty, multi (ambiguous), stale (foreign section) and section-root selections all resolve to `null` → the previous inspector renders. Legacy sections are structurally unaffected. |
| Target coherence | `useElementInspector` resolves its target with the **same** shared rule (canvas nested selection → build-tree block → section root), so the panel inspects the element it was mounted for instead of the section root. |
| `Section ↑` | Now restores the section-root selection marker (previously it would have become a no-op once canvas selection outranked the block selection). |

Shared pure helper: `singleNestedSelectionId(tree, selectionIds)` in `canvas/engine/selection.ts` — one rule for
routing and targeting, so the two cannot drift.

### 2.3 Slice 3 — export pipeline & section-tree emission (`eca3d3c`)

| Area | Change |
| --- | --- |
| Discovery | `buildSrcdocsForTreeRecord(tree)` scans **any** tree-shaped payload recursively (legacy `custom-block` `props.tree` **and** durable `section.tree`), one entry per explicitly enabled, schema-valid node. The legacy `buildCustomCodeSrcdocsForSection` now delegates to it so the two surfaces cannot diverge. |
| Emission | `page-generator` resolves each visible section to the component it exports through. A regular section whose durable tree enables custom code is emitted through the **existing bounded tree runtime** (`CustomBlock` + flag-only tree + `srcdocs` map), reusing the P23 sandbox machinery verbatim — no new generated component, no duplicated security surface. |
| Import dedup | Moved from section *types* to resolved *components*, so a mixed page imports the tree runtime exactly once. |
| Unchanged output | A section without enabled custom code (including a durable tree without custom code) keeps its props-driven component and **byte-identical** output — asserted in a test. |
| `custom-block` | Behaviour unchanged; all 30 P23-C export tests still pass. |

### 2.4 Closeout — generated interaction type widening (this commit)

| Area | Change |
| --- | --- |
| File | `src/features/export/generators/section-generators/custom-block-generator.ts` (the generated `BlockNode` declaration template) |
| Change | `interaction.click` gains `formId?: string` and `handlerId?: string`; `interaction.scroll` gains `offset?: number` and `speed?: number`; `interaction.hover` / `interaction.focus` gain `animation?: Record<string, unknown>`. |
| Nature | **Type-only.** The runtime entry points (`baEffective`, `baResolveClick`, `CustomCodeFrame`) are byte-identical; an action this bounded runtime does not implement remains inert data instead of failing the generated site's build. |

Evidence that this was required rather than speculative is in §5.

---

## 3. Anti-regression invariants — confirmed

| Invariant | Evidence |
| --- | --- |
| **REQ-6 — export never routes a durable `ElementTree` through `elementTreeToBlockTree()`** | `section-tree-export.ts` documents and implements an independent projection. A dedicated test asserts both halves: `elementTreeToBlockTree()` **strips** `customCode`/`viewport`/`animation` (why the rule exists), while `projectSectionTreeForExport()` **preserves** them. Confirmed in source that the generated runtime genuinely consumes `node.viewport` (`blockStyle(..., node.viewport, ...)`), `node.animation` and `node.interaction.scroll`/`.load` (`baEffective`) — so the forbidden path would have silently broken responsive overrides, animations and interactions, not only custom code. |
| **Single srcdoc construction path** | Every emitted document comes from `buildValidatedCustomCodeSrcdoc` (schema parse → `enabled === true` → deterministic per-field/aggregate re-clamp → `buildCustomCodeDocument`). Asserted by comparing the emitted, `\u003c`-escaped payload against the authoritative builder's own output, including a max-size valid payload emitted intact and an over-cap payload that emits **nothing**. |
| **Parent page holds no executable user code** | Asserted for the new path: no literal `<script` / `<style`, no `dangerouslySetInnerHTML`, no `eval(`, no `new Function`; the emitted tree carries `"customCode":{"enabled":true}` only; user JS survives solely inside the escaped srcdoc data. |
| **Editor canvas stays inert** | Unchanged by this phase (no new execution surface): the tree runtime is emitted only into the exported/published site, and the only in-editor execution point remains the explicit opt-in `CustomCodePreview`. |
| **Distribution stripping covers both tree surfaces** | `stripCustomCodeFromProject` walks `props.tree` (custom-block) **and** `section.tree` (any section type) in one pass; wired into share projection and template creation, with `stripCustomCodeFromTree` on My Blocks saves. A new test covers both surfaces in a single pass including a **grandchild** node, with the source project unmutated. |
| **Sandbox capability model unchanged** | `allow-scripts` only; CSP, message protocol, heartbeat, height caps, attribute grammar and disposal semantics are untouched. Asserted on the generated component in the existing suites. |
| **Caps unchanged** | 20,000 per field / 48,000 aggregate / 16 attributes; the new surface adds no cap and raises none. |
| **Versions unchanged** | `CURRENT_FORMAT_VERSION = 3`, `DATABASE_VERSION = 9` (no new durable field, no migration, no new store). |
| **Dual-schema declaration** | No schema-visible field was added by P24-C; the existing dual declaration of `tree` (editor + generation/persistence) is what makes the whole slice possible. |
| **Transient selection never persists** | Asserted: focusing an element leaves the project at the identical object reference, leaves history length unchanged, and produces a **byte-identical** `serializeProject()` payload; the editor store has no `selection` / `anchorId` / `selectedElementId` keys. |

Test counts, measured from the suite totals at each commit: P24-B closed at **372 files / 5,184 tests**; Slice 1 → 5,193 (**+9**); Slice 2 → 5,211 (**+18**); Slice 3 → 5,229 (**+18**); closeout generated-type fidelity → **5,233 (+4)**. Phase total: **+49 tests, all green**. Deliberately rewritten assertions (the old leaf-only gate and the generated interaction one-liner) were inverted or generalised with the intent change documented in place — no assertion was deleted.

---

## 5. Export compilation gate — the one required fix, with its evidence

`npm run test:export-build` **passed on the first run** (43.9 s, warm cache): the generated multi-page site
completed one `npm install` + one `npm run build` and reported
`[BUILD TEST] ✅ Multi-page site build succeeded!`.

However, that fixture contains no custom code and no P22-G interactions on a durable tree, so it **cannot
reach** the newly-created emission path. Because Slice 3 widens the *input* surface of the generated module,
the gate was supplemented with a targeted type probe: the generated `BlockNode` declaration was extracted from
`generateCustomBlockComponent()` itself (not hand-copied) and compiled together with every interaction payload
the editor can legally store.

**Probe result before the fix — 6 genuine mismatches (`TS2353`, excess property):**

```
formId    does not exist in type '{ kind: string; target?; elementId?; }'      // click submit-form
handlerId does not exist in type '{ kind: string; target?; elementId?; }'      // click custom
offset    does not exist in type '{ kind: string; animation?; }'               // scroll sticky
speed     does not exist in type '{ kind: string; animation?; }'               // scroll parallax
animation does not exist in type '{ color?; backgroundColor?; scale?; shadow?; }'  // hover animation
animation does not exist in type '{ color?; backgroundColor?; scale?; shadow?; }'  // focus animation
```

This is a latent failure of the **generated site's own type-check** for any project whose tree carries those
valid P22-G targets — i.e. the export would break the moment a user authored them, which the current fixture
cannot reveal. The widening in §2.4 was therefore applied, and the probe re-run against the **regenerated**
declaration reports **zero errors** for all ten payload shapes (including the six above plus
`navigate`/`scroll-to`/`toggle`/`open-modal`/`start-animation` and null animation/interaction).

`npm run test:export-build` was then **re-run after the widening and passed again (41.9 s)**, confirming the
regenerated component still builds. A permanent assertion was added so the declaration cannot silently narrow
again, and the pre-existing P22-G test that pinned the old one-line formatting was updated deliberately (its
intent — "the interaction members are declared" — is preserved and strengthened).

Classification: **pre-existing latent defect in the generated type, newly reachable through P24-C's broader
authoring surface.** Not a regression introduced by Slices 1–3, and no runtime behaviour changed.

---

## 6. Gate results

| Gate | Command | Result |
| --- | --- | --- |
| Export compilation | `npm run test:export-build` | ✅ **PASS** — 1 test, 43.9 s before the widening / **41.9 s after**; `[BUILD TEST] ✅ Multi-page site build succeeded!` |
| TypeScript (source) | `npx tsc --noEmit -p .p24b-tsconfig.json` | ✅ **PASS** — exit 0, no diagnostics |
| TypeScript (default) | `npm run typecheck` | ✅ **PASS** — exit 0, no diagnostics **after** removing the regenerated gitignored `.next` artifact; see §7 for the artifact-only failure |
| ESLint | `npx eslint .` | ✅ **PASS** — 0 errors, 1 pre-existing warning (`e2e/ai-element-editing.spec.ts:310`, untouched) |
| Unit/component | `npm test` | ✅ **PASS** — **374 files / 5,233 tests**, 63.9 s |
| Production build | `npm run build` | ✅ **PASS** — `✓ Compiled successfully in 5.6s`; `✓ Generating static pages (9/9)` |
| E2E — phase-relevant | `npx playwright test custom-code-authoring custom-code-export element-inspector canvas-selection element-library --workers=1` | ✅ **PASS** — 20/20 (1.5 m) |
| E2E — core suite | `npx playwright test --grep-invert "prompt\|fallback\|realtime-structure\|workspace-version-history" --workers=1` | ⚠️ **155 passed / 1 failed (14.7 m)** — the single failure is a load/timing flake, green in isolation; see §7 |
| E2E — flake isolation | `npx playwright test e2e/ai-copilot.spec.ts --workers=1` | ✅ **PASS** — 5/5 (including the failed test) |
| Export type probe | extracted declaration + all P22-G payloads, `tsc --strict` | ✅ **PASS (0 errors)** after the §2.4 widening; 6 errors before it |

Excluded from the core E2E run, per the closeout brief's authorisation for known pre-existing environmental
failures: `realtime-structure.spec.ts` (mock checkpoint `STALE_REVISION` race) and
`workspace-version-history.spec.ts` (post-restore reload race). Both are documented in
`docs/phase-p24b-report.md` §11/§12/§16/§17 with their evidence and remain open (§8).

---

## 7. Failures, flakes and their classification

| # | Symptom | Evidence | Classification |
| --- | --- | --- | --- |
| 1 | `e2e/ai-copilot.spec.ts:30` *"opens with the Ctrl+Shift+A shortcut"* → `copilot-panel` not visible in the full core run | **10/10 isolated runs green** (single test 2.6 s; whole spec 5/5, 14.8 s); the assertion is a keyboard shortcut pressed immediately after project creation (timing-sensitive); the spec exercises the LEFT-sidebar copilot and shares **no** code path with this phase (RightSidebar routing / export generators); the same spec appears in the pre-existing `.p24b-logs/batch1.log` without incident | **Environmental / timing flake — not a P24-C regression** |
| 2 | `npm run typecheck` failing on `.next/dev/types/app/api/generate/route.ts(14,13)` — `boundedErrorToken` incompatible with index signature | The file is a **gitignored Next-generated artifact**; the E2E run regenerates it (typecheck was clean twice earlier in this session, before any E2E run, and clean again after `rm -rf .next`); source-only `tsc -p .p24b-tsconfig.json` is clean; `src/app/api/generate/route.ts` was last touched by `2f8046b` (P22) — **not** by any P24-C commit — and P24-C changed** zero** files under `src/app/` | **Pre-existing baseline issue, reproduced as documented in `docs/phase-p24b-report.md` §14** |
| 3 | Generated `BlockNode` interaction type rejected valid P22-G payloads | 6 × `TS2353` from the extracted declaration; zero after the widening; export-build green before and after | **Pre-existing latent defect, fixed here** (§5) |

No deterministic P24-C product regression was found.

---

## 8. Recorded follow-ups (none blocking; not addressed in this phase)

1. **`export-validator.ts` inspects bindings only in `props.tree`** (the custom-block tree), not in durable
   `section.tree`. Inert for export today (the block runtime has zero `binding` references, so an invalid
   binding cannot reach exported output), but the validation surface should be made consistent.
2. **Mock collaboration checkpoint race** — `STALE_REVISION` is not re-scheduled (only `LOCKED` is), so two
   concurrent checkpoints can leave the server one revision behind until the next edit. Needs a bounded
   retry/backoff. *(Carried forward from P24-B.)*
3. **`workspace-version-history.spec.ts` post-restore reload race** — the editor can render the cached
   pre-restore project before the workspace fetch + `discardAndOpenProject` + collab re-hydration land; a
   `.catch(() => undefined)` in `useWorkspaceEditorAccess` also hides a re-hydration failure. *(Carried
   forward from P24-B.)*
4. **`boundedErrorToken` route export** — pre-existing `npm run typecheck` / `next build` failure via the
   gitignored `.next/dev/types` artifact; fix by moving the helper to a non-route module or excluding
   `.next/dev/types` from `tsconfig.json`. *(Carried forward from P24-B.)*
5. **Export-build gate stability** — passes in ~42 s on a warm npm cache but timed out once (>600 s) on a
   cold cache. Consider `--prefer-offline` / cache warm-up. *(Carried forward from P24-B.)*
6. **Pre-existing ESLint warning** in `e2e/ai-element-editing.spec.ts:310` (`reviewAndApply` unused). *(Carried
   forward from P24-B.)*
7. **Canvas/export asymmetry for durable regular sections** *(new, exposed by Slice 3)* — the export renders a
   durable section's **tree** when it enables custom code, while the editor canvas still renders the
   **props-driven** component for regular sections (only `custom-block` renders a tree). Consequence: a user
   can author custom code on, say, a hero element but cannot see it (or its inert placeholder) in the canvas,
   and WYSIWYG parity for that case is untested end-to-end. A canvas tree-rendering path for durable regular
   sections is the natural follow-up.
8. **Element-scoped AI entry remains `custom-block`-only** — `useElementEditTarget` / `resolveElementEditTarget`
   still reject non-`custom-block` sections (P22-H rule), so the "Ask AI to modify this element" composer is
   not offered on the newly-authorable sections. Broaden deliberately or document as intended.
9. **Interaction runtime coverage** — the generated runtime resolves a bounded subset of the now-accepted
   interaction vocabulary; `submit-form`, `custom`, `sticky` and `parallax` are carried as inert data (they do
   not fail the build, but they also do not execute). Either implement or surface as unsupported in authoring.
10. **`frame-ancestors` via `<meta>`** is ignored by Chromium (console advisory); anti-framing rests on
    srcdoc-only delivery + the parent `sandbox` attribute. *(Carried forward from P23.)*

---

## 9. Final status

- **Implementation:** complete and intact across Slices 1–3, plus the closeout type widening. The capability
  rule, inspector routing, durable-tree export emission, distribution stripping, and generated-type fidelity
  are all present and green in the unit suite.
- **Gates green:** export compilation (before and after the widening), TypeScript (source-only and, after
  artifact removal, default), ESLint (0 errors), Vitest 374 files / 5,233 tests, production build (9/9 static
  pages), phase-relevant E2E 20/20, core E2E 155/1 with the single failure green in isolation.
- **Not claimed as passes:** the two excluded pre-existing E2E failure families (`realtime-structure`,
  `workspace-version-history`) and the artifact-only default-typecheck failure.
- **Spec decisions discharged:** D1 (capability), D2/D3 (selection + mounting), D4 (tree-capable emission),
  D5 (legacy `custom-block` untouched), D6 (sandbox/caps/versions invariant). Spec §10 open questions
  Q1 (authoring guard for containers), Q2 (multi-select) and Q3/Q4 (shared vs duplicated tree runtime /
  fidelity scope) were resolved by implementation as: no extra guard; single-nested-selection only; reuse of
  the existing runtime without extraction; and emission scoped to trees that enable custom code.
