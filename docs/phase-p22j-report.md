# Phase P22-J — Data Integrations (Report)

> Baseline: P22-A through P22-I complete and validated (see their reports).
> P22-J delivers the **approved minimal data layer**: durable collection
> definitions on the Project document, a pure bounded binding resolver,
> static-snapshot export, collection CRUD + a Data/Binding inspector section,
> and a minimal "Add Supabase" guided flow with mock/Supabase provider parity
> and one additive migration. **P22-A through P22-I remain CLOSED.**

---

## 1. What was implemented

- **Collection model (D-J1/D-J2/D-J3)** — `Collection { id, name, fields }`
  with minimal `{ id, name, type }` fields (`text | number | boolean |
  image | url`) and deterministic ids; `Project.collections?` is optional and
  additive (old projects load unchanged; no migration bump).
- **Canonical schema** — `CollectionsSchema` / `CollectionFieldSchema`
  (bounded) validated through the existing `ProjectSchema`
  (`generation-plan-schema.ts`); serializer + normalizer allow-lists extended
  so `serialize → deserialize → normalize → validate` preserves collections.
- **Pure binding resolver** — `src/features/elements/binding/resolve.ts`
  (patterned after `asset-resolver.ts`): allow-listed bounded paths
  (`price`, `product.name`, `images[0].src`), unsafe-key/`..`/proto rejection,
  string/number/boolean coercion, image/url safety policies, structured
  unresolved results, never throws, no eval/Function/arbitrary access. Only
  `source: "collection"` resolves; other sources remain future capability.
- **Collaboration carry** — the CRDT `tree-normalizer.ts` carries `binding`
  through the existing `carryValidatedElementField` mechanism and projects
  `collections`; the stored custom-block node schema gains optional
  `binding` (re-validated with the shared `ElementBindingSchema`).
- **Store CRUD** — `addCollection` / `renameCollection` / `deleteCollection` /
  `addCollectionField` / `removeCollectionField` / `renameCollectionField` /
  `setCollectionFieldType` on the editor store via the existing
  `withHistory` boundary (one atomic undo entry each; pure helpers in
  `collection-structure.ts`).
- **Rendering** — the existing `BlockRenderer` (P22-G path) resolves
  `node.binding` via `resolveNodeBindingProps`; unbound/unresolved nodes
  render exactly as before. `CustomBlockSection` passes `collections` +
  integration `records` into the renderer.
- **Export (D-J4, STATIC SNAPSHOT)** — `export-pipeline.ts` validates the
  original project (dangling references rejected), then bakes every binding
  into static props and strips binding metadata. No runtime fetch, no
  secrets, no dynamic code.
- **UI** — new RightSidebar "Data" tab (`DataPanel`: integration status +
  minimal Add-Supabase flow + collection management) and a Data/Binding
  section in the existing element inspector (`BindingField` control). All
  mutations route through the validated `commitField` → `commitElementTree`
  → `withHistory` boundary; `ElementBindingSchema` / `updateElementBinding`
  reused — no second binding system.
- **Integrations (D-J5)** — `src/features/integrations/*` provider split:
  contract types, environment resolution (mirrors cloud-sync), mock provider
  (deterministic demo records, re-derived on field-definition changes),
  Supabase provider (SECURITY DEFINER RPCs, `auth.uid()` + workspace
  membership), singleton factory, and a runtime-only records store. Secrets
  stay server-side (only the public anon key reaches the browser).
- **Migration** — additive-only
  `supabase/migrations/20260814000001_data_records.sql`; no existing
  migration/RLS modified, no authz weakened.

---

## 2. Files / components changed

**P22-J additions on the pre-existing P22-A–I working tree:**

**New (23):**

- `src/features/elements/collections/types.ts` — `Collection`, `CollectionField`, `CollectionFieldType`, `CollectionRecord(s)`
- `src/features/elements/schemas/collection-schema.ts` — `CollectionsSchema` + bounds/constants
- `src/features/elements/binding/resolve.ts` — pure resolver + `resolveNodeBindingProps` + `bakeTreeBindings`
- `src/features/elements/binding/__tests__/resolve.test.ts` — resolver suite (24 tests)
- `src/features/editor/store/collection-structure.ts` — pure collection list mutations
- `src/features/editor/store/__tests__/editor-store-collections.test.ts` — CRUD + undo/redo
- `src/features/persistence/__tests__/project-collections.test.ts` — persistence round-trip + old-project compat
- `src/features/collaboration/__tests__/tree-normalizer-p22j.test.ts` — binding carry + drop-invalid
- `src/features/export/__tests__/p22j-binding-export.test.ts` — bake, dangling refs, injection-inertness
- `src/features/integrations/types.ts` — provider contract
- `src/features/integrations/environment.ts` — env resolution (mock/supabase/none)
- `src/features/integrations/mock/mock-data-provider.ts` — demo records + re-derive-on-field-change
- `src/features/integrations/supabase/supabase-data-provider.ts` — RPC-backed provider
- `src/features/integrations/provider-factory.ts` — singleton resolution + test hooks
- `src/features/integrations/store/data-integration-store.ts` — runtime records store
- `src/features/integrations/components/DataPanel.tsx` — Data tab UI
- `src/features/integrations/__tests__/data-integration-provider.test.ts` — mock/supabase parity + demo-refresh regression (9 tests)
- `src/features/inspector/components/controls/BindingField.tsx` — binding editor control
- `e2e/data-integrations.spec.ts` — mock-parity E2E
- `supabase/migrations/20260814000001_data_records.sql` — additive migration
- `docs/phase-p22j-architecture.md`, `docs/phase-p22j-report.md` — this phase's docs

**Extended (additive edits to existing files):**

- `src/types/project.ts` — `collections?: Collection[]`
- `src/features/generation/schemas/generation-plan-schema.ts` — `CollectionsSchema.optional()`
- `src/features/persistence/services/project-serializer.ts` + `project-normalizer.ts` — collections allow-list
- `src/features/collaboration/crdt/tree-normalizer.ts` — binding carry + collections projection
- `src/features/code-import/schemas/custom-block-schema.ts` — optional `binding` on stored nodes + repair carry
- `src/features/editor/store/editor-store.ts` — 7 collection actions via `withHistory`
- `src/features/blocks/render/BlockRenderer.tsx` — `resolveNodeBindingProps` at render (+ hook-order fix)
- `src/features/export/pipeline/export-pipeline.ts` — validate-then-bake static snapshot
- `src/features/export/validators/export-validator.ts` — dangling binding rejection + `custom-block` fallback type
- `src/features/editor/sections/CustomBlockSection.tsx` — pass collections + records to renderer
- `src/features/editor/ui/editor-ui-store.ts` + `src/components/editor/RightSidebar.tsx` — Data tab
- `src/features/elements/inspector/types.ts` / `mutate.ts` / `resolver.ts` / `fields.ts` / `schemas.ts` — `binding` field kind + Data section
- `src/features/inspector/components/InspectorField.tsx` + `ElementInspectorPanel.tsx` — BindingField wiring (collections + node context)
- `src/components/editor/TopNav.tsx` — passes runtime records at export

---

## 3. Decisions D-J1..D-J6 (as approved)

- **D-J1** — Collection definitions live in the Project document
  (`{ id, name, fields }`); no durable records array — runtime records live in
  the integration/provider layer. **Implemented as specified.**
- **D-J2** — Minimal field model (`text | number | boolean | image | url`);
  no date/enum/relationships/formulas. **Implemented.**
- **D-J3** — Deterministic ids for generated definitions; runtime records use
  existing id conventions. **Implemented.**
- **D-J4** — Static-snapshot export: bindings baked at export; no runtime
  Supabase fetching, no client credentials. **Implemented + verified.**
- **D-J5** — Minimal "Add Supabase" guided flow with server-side env,
  provider split, connection status, mock parity. **Implemented** (migration +
  provider + guided flow UI). The broad tables/auth/storage/API vision is
  explicitly out of scope.
- **D-J6** — Forms out of scope; `form` binding source remains future
  capability (resolves `unsupported-source`). **Implemented as specified.**

---

## 4. Validation gates and exact results

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | ✅ exit 0 against source. (Next's generated `.next/dev/types` — a gitignored artifact regenerated by dev-server runs — surfaces the same pre-existing `boundedErrorToken` route-check as the build; see below.) |
| `npx eslint .` | ✅ 0 errors (1 pre-existing warning in `e2e/ai-element-editing.spec.ts`, untouched by P22-J) |
| `npx vitest run` (full unit) | ✅ 343 files / 4724 tests passed |
| P22-J E2E `e2e/data-integrations.spec.ts` | ✅ 1 passed (connect → create collection → bind → preview resolves → export bakes → reload persists) |
| AI regression E2E (`ai-*` specs + P22-J) | ✅ 25 passed in one run |
| `npm run build` (next build) | ❌ fails at type-check — **pre-existing baseline failure**, reproduced identically at clean `HEAD` (committed P21) — `route.ts` exports `boundedErrorToken`, which the Next.js/Turbopack route type-check rejects. Not caused by P22-J (or P22-A–I); the committed baseline fails the same way. `tsc --noEmit` against source passes (the failure only appears in Next-generated type files, which are gitignored build artifacts). |
| Export-build integration (`RUN_BUILD_TEST=true`, full npm install + build of generated site) | ✅ 1 passed (~113s) |
| `git diff` / `git status` | ✅ P22-J changes confined to the additive files above |

**Flake note:** during an earlier full-suite run, `import-project-dialog.test.tsx`
failed once but passed in isolation (15/15) and passed in the subsequent clean
full-suite run — no reproduction, no P22-J code on its path (P22-J never
touches project import). Not a P22-J regression.

---

## 5. E2E results

`e2e/data-integrations.spec.ts` (mock parity, real `MockDataProvider` via dev
env): connect demo data → create "Products" collection + `name` text field →
select the heading block → bind `text` to `Products.name` through the
inspector Data section → canvas preview resolves "Sample name" → export ZIP
contains the baked resolved value with no binding metadata/runtime fetch →
reload keeps the collection + binding and the preview still resolves.

**Bug found & fixed during E2E:** the mock provider cached a demo record
seeded *before* a field was added, so a bound path reported `missing-path`
(stale demo without the new field). Fixed by re-deriving demo records when the
collection's field signature changes (user-created records are never
clobbered); regression test added to `data-integration-provider.test.ts`.

---

## 6. Security review

- **Path traversal / prototype pollution** — resolver rejects `..`, absolute
  paths, `__proto__`/`prototype`/`constructor`/`toString`/etc. at every
  depth; `hasOwnProperty`-gated reads. Covered by tests.
- **HTML/code injection** — all collection values are inert data; render
  outputs text via JSX (React-escaped), URLs pass the safe-link/image
  policies, export bakes values as JSON-encoded inert payloads. Export test
  proves an injected `<img onerror=…>` string cannot break out of the
  generated code.
- **Secret leakage** — service-role keys never appear in browser code; only
  `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` reach the
  client, exactly like cloud sync.
- **Export validator** — dangling collection references are rejected before
  generation.
- **Migration authz** — additive SECURITY DEFINER RPCs gated by `auth.uid()`
  + existing workspace-membership checks; no existing RLS weakened.

---

## 7. No new dependencies

`package.json` is untouched — everything uses packages already installed.

---

## 8. No scope expansion / no reopened phases

No P22-K, no P23, no runtime-fetch exported sites, no form→collection writes,
no custom code execution, no new AI providers, no payments/email/analytics, no
broad integration suite. **P22-A through P22-I remain CLOSED** — no P22-A..I
file was modified outside the additive extensions listed in section 2.

---

## 9. Known limitations

- Runtime records exist only while connected to a provider (mock in-memory /
  Supabase); they are never written into the Project document.
- Only the `collection` binding source is authorable/resolved; `page`,
  `project`, `form`, `auth` remain future capability.
- The Supabase path is implemented to the provider contract + migration but
  is exercised in CI only through the parity contract tests (no live
  Supabase credentials in this environment).- `next build` fails at baseline (pre-existing `route.ts` `boundedErrorToken` route-export type-check issue, section 4) — outside P22-J's scope to fix. Source-level `tsc --noEmit` is clean.
- The Data tab is the minimal approved surface: no table designer, no
  record-editing grid, no auth/storage/payments/email/analytics.

---

## 10. Final P22-J status

**COMPLETE.** All approved scope implemented, unit suite + P22-J E2E + AI
regression E2E + export-build gate green, `tsc`/`eslint` clean, docs written,
and the working tree verified to contain only the P22-J additions on the
pre-existing P22-A–I tree. P22-A..I remain closed.
