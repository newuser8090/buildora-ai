# Phase P9 Report — Product Polish, Templates & Growth

Branch: `phase-p9-product-polish-and-growth`
Status: ✅ Complete — all regression suites green

---

## 1. Overview

Phase P9 turns the builder into a *product*: two new beginner templates, a
personal template system ("save this project as a template"), bounded draft
recovery ("restore from backup"), an archive/restore project lifecycle,
dashboard polish (archived view, search/sort/empty states), a truthful help
system (keyboard shortcuts dialog — real shortcuts only), transient
performance instrumentation, offline-aware save status messaging, and
non-spamming undo/redo feedback.

Scope footprint (working tree): **28 modified files plus 37 new files**
(2 docs, 3 e2e specs, 32 feature files/tests) across `src/features/`
(`personal-templates`, `recovery`, `help`, `perf`, `feedback`), the dashboard
and editor surfaces, the template system, the persistence schema, and the e2e
suite. Design decisions are recorded in `docs/phase-p9-architecture.md`.

---

## 2. Architecture decisions

Recorded in `docs/phase-p9-architecture.md` before building. The decisions
that shaped the phase:

- **Template model is kept and extended, not replaced.** `BuildoraTemplate`
  gains optional `source` (`"builtin" | "personal"`) and `difficulty`
  (`"beginner" | "intermediate" | "advanced"`) fields; the internal
  `TemplateCategory` union gains `event` and `personal` so beginner language
  maps to real categories. Templates stay deterministic fixtures that build a
  fresh `Project` from injected IDs.
- **No second project model.** Personal templates wrap/derive from the
  existing Project schema. They are **local-only in IndexedDB** in P9 (new
  `personalTemplates` store), bounded to 25, and never copy deployment,
  domain, sync, or auth state.
- **Draft recovery is last-known-good + bounded.** New `recoverySnapshots`
  store; capture after successful persisted saves (cooldown-gated); retain
  newest 5 per project; restore always writes through the normal save path —
  never auto-overwrites without explicit confirmation.
- **Archive is dashboard metadata, not project data.** `isArchived` lives in
  the per-project dashboard metadata (outside `ProjectSchema`), so archiving
  never touches revision/history and never deletes the project or its remote
  deployments.
- **Performance instrumentation is transient.** In-memory bounded ring only;
  nothing is persisted and nothing is sent anywhere unless explicitly enabled
  (it never is in P9). Soft budgets are documented, not wall-clock-asserted.
- **Explicitly OUT of scope** (deferred to P10 or later): the
  `.buildora-template.json` file format (§44), the public read-only share link
  (§45), the product tour (§49), billing, marketplace, live multiplayer, and
  analytics.

---

## 3. Files created

**Docs**
- `docs/phase-p9-architecture.md`
- `docs/product-quality-checklist.md`

**E2E specs**
- `e2e/template-start.spec.ts` — browse → search → preview → use → edit →
  save as personal template → reuse
- `e2e/project-lifecycle.spec.ts` — create → rename → duplicate → archive →
  restore → save template → delete
- `e2e/project-recovery.spec.ts` — snapshot → changed content → preview →
  restore → recovered

**Feature — personal templates** (`src/features/personal-templates/`)
- `types.ts`, `services/personal-template-service.ts`,
  `storage/personal-template-storage.ts`,
  `convert/personal-template-converter.ts`,
  `store/personal-templates-ui-store.ts`
- `components/PersonalTemplatesPanel.tsx`, `components/SaveAsTemplateDialog.tsx`
- `__tests__/` — `personal-template-service.test.ts`,
  `personal-template-storage.test.ts`, `personal-template-converter.test.ts`,
  `PersonalTemplatesPanel.test.tsx`, `SaveAsTemplateDialog.test.tsx`

**Feature — draft recovery** (`src/features/recovery/`)
- `types.ts`, `services/recovery-service.ts`, `storage/recovery-storage.ts`,
  `store/recovery-ui-store.ts`, `components/RecoveryDialog.tsx`
- `__tests__/` — `recovery-service.test.ts`, `RecoveryDialog.test.tsx`

**Feature — help** (`src/features/help/`)
- `keyboard-shortcuts.ts`, `store/help-ui-store.ts`,
  `components/KeyboardShortcutsDialog.tsx`
- `__tests__/` — `keyboard-shortcuts.test.ts`, `KeyboardShortcutsDialog.test.tsx`

**Feature — performance instrumentation** (`src/features/perf/`)
- `perf-instrumentation.ts`, `__tests__/perf-instrumentation.test.ts`

**Feature — action feedback** (`src/features/feedback/`)
- `action-feedback.ts`, `components/ActionFeedbackHost.tsx`

**Templates**
- `src/features/templates/templates/event-template.ts`
- `src/features/templates/templates/personal-profile-template.ts`

**Tests**
- `src/features/projects/__tests__/dashboard-metadata-archive.test.ts`

---

## 4. Files modified (28)

| Area | Files |
|---|---|
| Editor page / dashboard | `src/app/editor/[projectId]/page.tsx`, `src/app/page.tsx` |
| Editor chrome | `src/components/editor/TopNav.tsx`, `src/components/editor/StatusBar.tsx` |
| Persistence | `src/features/persistence/constants.ts`, `src/features/persistence/services/db-schema.ts`, `src/features/persistence/services/project-controller.ts` |
| Projects (dashboard) | `src/features/projects/types.ts`, `src/features/projects/components/ProjectCard.tsx`, `src/features/projects/hooks/useProjectsDashboard.ts`, `src/features/projects/services/dashboard-metadata-service.ts` |
| Templates | `src/features/templates/types.ts`, `src/features/templates/registry/register-default-templates.ts`, `src/features/templates/components/TemplateCard.tsx`, `src/features/templates/components/TemplateGallery.tsx`, `src/features/templates/hooks/useTemplateGallery.ts` |
| Preview / publishing | `src/features/preview/store/preview-store.ts`, `src/features/publishing/store/publishing-store.ts` |
| Command palette | `src/features/guided-builder/components/CommandPalette.tsx` |
| Keyboard | `src/hooks/useKeyboardShortcuts.ts` |
| Tests | `src/features/cloud-sync/__tests__/cloud-sync-queue.test.ts`, `src/features/my-blocks/__tests__/my-block-collections.test.ts`, `src/features/my-blocks/__tests__/my-block-thumbnail-storage.test.ts`, `src/features/thumbnails/__tests__/thumbnail-db-migration.test.ts`, `src/features/templates/__tests__/template-content.test.ts` |
| E2E specs | `e2e/editor-structure.spec.ts`, `e2e/launch-flow.spec.ts`, `e2e/pages.spec.ts` |

---

## 5. Dependencies added

**None.** `package.json` is unchanged — every P9 feature reuses existing
dependencies (zustand for UI stores, zod for schema validation, lucide-react
for icons, `crypto.randomUUID` for identity). The two new IndexedDB stores
are pure schema additions.

---

## 6. Template system

- **Two new built-in templates**, both deterministic fixtures built from
  `template-section-builders` / `template-theme` and registered by the
  idempotent `registerDefaultTemplates()`:
  - **Event Page** (`template-event`, category `event`, featured, sortOrder
    20, defaultName "My Event", difficulty `beginner`) — header, hero,
    details, schedule, RSVP CTA, footer.
  - **Personal Profile** (`template-personal`, category `personal`, featured,
    sortOrder 21, defaultName "My Personal Page", difficulty `beginner`) —
    header, hero intro, about, skills, experience, contact CTA, footer.
- **Card/dialog UI**: `TemplateCard` shows the plain-language difficulty chip
  ("Beginner friendly", "Intermediate", "Advanced") and a "Yours" badge for
  personal templates; `TemplateGallery` surfaces both.
- **Gallery unification**: `useTemplateGallery` merges saved personal
  templates (from IndexedDB, converted via
  `personalTemplateToBuildoraTemplate`) into the same list, so search,
  category tabs, preview, and "Use" behave identically for built-ins and
  personal templates. The list loads asynchronously and upgrades in place.
- **Preview strategy unchanged**: the deterministic `TemplatePreview` model is
  reused for both; previewing never creates or persists a project.

---

## 7. Personal templates

- **Service** (`PersonalTemplateService`, framework-independent):
  - `saveAsTemplate` — name validation via the canonical
    `validateProjectName`, description ≤ 200 chars, tags ≤ 8 of ≤ 24 chars
    (lowercased), deep-clone of the snapshot validated through `ProjectSchema`,
    and the local quota `MAX_PERSONAL_TEMPLATES` (25) with a beginner-safe
    rejection message (never a silent overwrite). Ids/timestamps are injected
    for deterministic tests.
  - `list` / `get` / `count` / `delete` / `rename` / `duplicate` (with
    copy-name generation).
  - `createProjectFromPersonalTemplate` — deep-clones the stored snapshot,
    assigns fresh project/page/section IDs through the same
    `TemplateIdFactory` used by built-ins, resets timestamps, keeps content/
    styles/theme/site settings/assets, and revalidates through `ProjectSchema`.
- **Storage**: new `personalTemplates` store keyed `personal-<uuid>`;
  local-only in P9; record carries no deployment/domain/sync/revision state.
- **UI**: `SaveAsTemplateDialog` (categories exclude `blank`),
  `PersonalTemplatesPanel` (dashboard "My Templates"), plus the TopNav
  "Template" button, the dashboard project-card "Save as template" action
  (loads the full project from the adapter — cards carry summaries only), and
  a command-palette entry.
- **Controller integration**: `ProjectController._createFromPersonalTemplateIfApplicable`
  routes `personal-` template ids through the same persist → activate →
  hydrate lifecycle as built-ins (lazy import, structured errors,
  retryable flags), so create-from-personal-template is indistinguishable
  from built-ins at the orchestration boundary.

---

## 8. Recovery architecture

- **Storage**: new `recoverySnapshots` store; `RecoverySnapshot` =
  `{ id, projectId, revision, createdAt, reason, project }` (validated deep
  clone).
- **Capture**: after a coordinator-confirmed persisted save,
  `ProjectController._scheduleRecoveryAfterSave` captures a last-known-good
  snapshot (reason `autosave`) — cooldown-gated (60 s per project per
  interval, in-memory), lazy-imported, and never allowed to affect
  saveStatus/revision/dirty state. Manual/open captures bypass the cooldown.
- **Retention**: bounded — newest `MAX_RECOVERY_SNAPSHOTS_PER_PROJECT` (5) per
  project, oldest evicted first (best-effort); snapshots never evict the live
  project.
- **Restore**: `prepareRestore` revalidates the snapshot, guards that it
  belongs to the requested project, and hands the project back to the
  caller's normal save path — the persistence layer is the only writer.
- **Load-failure path**: when opening a project fails validation (not a
  missing record), the editor error screen checks for snapshots and offers
  "Restore from backup" (`RecoveryDialog`); the corrupted raw record is
  preserved, never overwritten. Restore writes a new revision through the
  normal save path and reloads.
- **Surfaces**: TopNav History button, command-palette "Open backups and
  recovery" + "Save a backup now", and the load-error recovery prompt.

---

## 9. Project lifecycle improvements

- **Archive / restore (new)**: `isArchived` dashboard-metadata flag
  (`DashboardMetadataService.setArchived` / `getArchivedMap`) living outside
  `ProjectSchema`. Archived projects are hidden from the main grid, listed in
  the Archived view, and restorable from the card menu. Archiving never
  deletes the project or its remote deployments/domains, and no retention
  policy is added.
- **Duplicate**: retained from P7 (fresh IDs/revision/timestamps, duplicate
  -safe names, no thumbnail/deployment/domain copy).
- **Delete**: P8 flow retained — deleting a project never silently deletes the
  live production site (explicit "Also remove the published site" opt-in).
- The full lifecycle is exercised end-to-end by
  `e2e/project-lifecycle.spec.ts`.

---

## 10. Dashboard improvements

- **"My Templates"** toolbar button opens `PersonalTemplatesPanel`
  (list / search / use / rename / duplicate / delete).
- **Project-card "Save as template"** action (loads the full project from the
  adapter first).
- **Archived toggle** on the toolbar (`showArchived`), archived empty state
  with "Back to projects", and Archive/Restore card menu items with icons.
- Search/sort/empty-state polish per `docs/product-quality-checklist.md` —
  no-results state offers "Clear search", archived state offers a way back.
- Project count, pinned ordering, and thumbnail/status UI retained.

---

## 11. Help system

- **`keyboard-shortcuts.ts`** — a registry of *only real, implemented*
  shortcuts, grouped by surface (Editing, Navigation, AI, Preview,
  Publishing). Palette-only actions are listed with a hint instead of an
  invented key chord; nothing is made up for the dialog.
- **`KeyboardShortcutsDialog`** + `help-ui-store`, opened from the TopNav
  keyboard button and the command palette ("Show keyboard shortcuts").
- **`useKeyboardShortcuts.ts`** — undo/redo chords (Ctrl/⌘+Z,
  Ctrl/⌘+Shift+Z, Ctrl+Y) now surface lightweight action-feedback toasts with
  an inverse action ("Undo"/"Redo"), mirrored in the TopNav undo/redo buttons.
- **`ActionFeedbackHost`** renders the transient toasts (2.6 s, non-spamming —
  only meaningful structural actions, never per-keystroke).

---

## 12. Performance instrumentation

- **`perf-instrumentation.ts`** — `recordPerf` / `measurePerf` / `markPerf`
  into an in-memory bounded ring (200 entries), with read/reset/count helpers.
  Transient: nothing persisted, nothing sent to any server.
- **Instrumented points**: editor hydration (`editor-hydration`, section
  count), template-gallery load (`template-gallery-load`, count),
  preview open (`preview-open`), publish dialog open (`publish-dialog-open`).
- Soft budgets are documented in `docs/product-quality-checklist.md`; unit
  tests assert deterministic operation counts only — no wall-clock
  thresholds.

---

## 13. IndexedDB migration

- **Database version 6 → 8** (`DATABASE_VERSION = 8`):
  - `personalTemplates` store — saved personal templates (local-only).
  - `recoverySnapshots` store — bounded draft-recovery history per project.
- Both are created through the **shared `ensureDatabaseStores()`** helper so
  whichever adapter runs the version-bump upgrade creates every store
  (the Phase P4 lesson that made store drift impossible).
- Migration is non-destructive — existing stores and data are untouched, and
  the phase already persisted v7 data (deployments, deploymentDomains) reads
  through unchanged.
- Store-list assertions updated in `cloud-sync-queue.test.ts` (11 → 13),
  `my-block-collections.test.ts`, `my-block-thumbnail-storage.test.ts`, and
  `thumbnail-db-migration.test.ts`.

---

## 14. Validation results

Final sequential rerun after all Phase P9 work (single worker, shared dev
server):

| Suite | Command | Result |
|---|---|---|
| Unit tests | `npm test` (vitest) | ✅ 240 files / **3,374 tests** passed |
| Typecheck | `npx tsc --noEmit` | ✅ pass |
| Lint | `npm run lint` | ✅ pass |
| Build | `npm run build` | ✅ Next.js 16.2.12 production build succeeds; all routes compiled |
| E2E (full regression) | `npm run test:e2e` | ✅ **83/83 passed**, 0 failures (8.3 min) |

**Totals:** 3,374 unit + 83 e2e = **3,457 tests green, 0 failures.**

### 14.1 Issues found & genuinely fixed

- **Legacy e2e specs used a fragile Save selector.** `editor-structure`,
  `launch-flow`, and `pages` matched `header button[title*="Save"]`, which the
  TopNav restructure made ambiguous. Fixed by adding a dedicated
  `data-testid="topnav-save-button"` and updating the three specs.
- **IndexedDB store-count drift after DB v8.** The two new stores changed the
  expected store list; updated the assertions in `cloud-sync-queue.test.ts`
  (11 → 13), `my-block-collections.test.ts`,
  `my-block-thumbnail-storage.test.ts`, and `thumbnail-db-migration.test.ts`
  (all now also assert the new store names).
- **Template content tests extended** to cover the two new built-in templates
  (`event`, `personal`) in `template-content.test.ts`.
- **Two environment-flaky e2e tests surfaced in one full-suite pass** (first
  run: 81/83):
  - `editor.spec.ts` "Real pipeline › generation succeeds with available
    provider" — the test waits 30 s for a live `/api/generate` 200; under
    full-suite single-worker load the cold dev-server route compile plus
    provider latency exceeded the window.
  - `my-blocks.spec.ts` "cross-project save & reuse" — the saved block's name
    is read from the dialog's suggested-name input immediately on open; under
    load the async suggestion population could race, yielding a different
    saved name than the assertion expected.
  Both verified green in isolation (**2/2, 54.8 s**) and in the final full
  rerun (**83/83**). Root cause is environmental (shared dev server under
  full-suite load), not a code defect — documented as a known limitation
  rather than masked with test-only changes. Per plan, no refactoring was
  performed after the suite went green.

---

## 15. Known limitations

- **Personal templates are local-only** in P9 — not cloud-synced, so they do
  not roam across devices yet.
- **Recovery snapshots are local-only and best-effort** — bounded to 5 per
  project with a 60 s autosave cooldown; capture/eviction failures never break
  the save flow.
- **The two e2e tests above can flake** under heavy single-worker load on a
  shared dev server (live-provider latency; async name-suggestion race).
- **Archived projects have no retention policy** — archiving is a manual
  flag with no auto-purge.
- **StatusBar offline messaging** reflects the browser `online`/`offline`
  state; cloud-sync status is reported separately and is not conflated.
- **Template gallery** loads personal templates asynchronously — the list
  upgrades in place after IndexedDB resolves.

---

## 16. Genuine Phase P10 candidates only

Documented, deliberately **not started** in P9:

- **`.buildora-template.json` file format** (§44) — export/import a template
  as a file for sharing outside the app.
- **Public read-only share link** (§45) — deferred; the ownership/revocation
  model needs a server component.
- **Cloud sync for personal templates + recovery snapshots** — the local
  stores are sync-ready shapes; wiring them through the P6 sync layer is
  straightforward and would make both features roam across devices.
- **Streamed deployment logs + a second hosting provider** (carried forward
  from the P8 report).
- **Product tour** (§49) — deferred deliberately; existing onboarding already
  covers the journey.
- Billing, marketplace monetization, live multiplayer editing, and a full
  analytics suite remain explicitly out of scope.
