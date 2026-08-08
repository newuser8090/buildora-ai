# Phase P11 — Report: Project Memory & Continuity

Branch: `phase-p11-product-evolution`
Design document: `docs/phase-p11-architecture.md` (written before implementation).

Phase P11 ships **bounded per-project Copilot memory** — the AI Copilot
conversation and explicit style notes survive reloads and project re-entry,
restore strictly conversationally (never an approval surface), stay local
(IndexedDB, database version 9), and are explicitly clearable.

---

## 1. Delivered

- **IndexedDB v9 + `copilotMemory` store** — one bounded record per project
  (messages ≤ 24, style notes ≤ 6 × 120 chars), created via the shared
  `ensureDatabaseStores()` helper (non-destructive migration, P4/P9 pattern).
- **Memory feature folder** — `memory/types.ts`, `memory/schema.ts`
  (Zod validate-on-load, strict objects, pollution-key policy),
  `memory/storage/copilot-memory-storage.ts` (P9 adapter pattern),
  `memory/services/copilot-memory-service.ts` (load/save/clear/delete +
  safe serializer), `memory/services/lazy-cleanup.ts` (dynamic-import
  project-delete hook, no dependency cycle).
- **Copilot store extensions** — `styleNotes`, `hydrateMemory` (messages +
  style notes ONLY; plan/approval/error/lastRequest/status never restored),
  `addStyleNote` / `removeStyleNote` / `clearStyleNotes`, `reset()` reset of
  all memory fields, `memoryRestored` flag.
- **AI integration** — `context-builder` exposes bounded `styleNotes`
  (≤ 3, capped); `copilot-service` appends a bounded style suffix (≤ 240
  chars, ≤ 2 notes) to EDIT/quick-action instructions only (ASK never
  mutates or sends); `lastRequest` keeps the raw instruction so
  Regenerate re-applies the suffix.
- **UI** — `StyleNotesSection` (add/remove/clear-all chips, labelled input),
  restore hint in `CopilotPanel`, "New conversation" clears persisted memory.
- **Lifecycle** — project delete calls `lazyCopilotMemoryCleanup`
  (best-effort, never blocks deletion).
- **Tests** — memory schema/storage/service/store unit tests, component
  tests, new hook isolation tests, and the deterministic E2E suite.

---

## 2. Security / privacy review — findings and fixes

The review covered: cross-project isolation, bounded storage, corrupt-record
rejection, prototype-pollution handling, provider-context privacy, no
recovery/history/secret leakage, StrictMode persistence, pagehide flush,
stale project-switch behavior, project-delete cleanup, IndexedDB v9
migration/first-connection safety, and raw error leakage.

### Finding 1 — style-note write-path asymmetry (fixed)

**Issue.** A style note equal to `"__proto__"`, `"prototype"`, or
`"constructor"` passed the read-path schema (defense-in-depth rejected it
only *after* a whole-record read) but the **write path** validated the
freshly built record as a unit: one pollution-key note made the entire
record self-reject, so the whole conversation silently failed to persist.

**Fix.** Pollution-key notes are now **dropped at entry/write sanitization**
(`sanitizeStyleNotes` in the service, `sanitizeStyleNotesInStore` in the
store — deduped, trimmed, capped), so an odd user-authored string can never
fail a whole save. The read-path rejection remains as defense-in-depth
against hostile records. Tests added in
`memory/__tests__/copilot-memory-schema.test.ts` and
`memory/__tests__/copilot-memory-service.test.ts`.

### Finding 2 — `opLabels` write-path asymmetry (fixed)

**Issue.** The same class of bug existed for `message.metadata.opLabels`: a
pollution-key label caused the whole record to self-reject at write time.

**Fix.** `serializeCopilotMessages` now filters pollution keys out of
`opLabels` before persistence; the read path still rejects records that
contain them. Tests added (write path + read path).

### Finding 3 — cross-project isolation on fresh SPA mount (found in final review, fixed)

**Issue.** `useCopilot` resets the Copilot store only when `activeProjectId`
**changes while the editor is mounted**. On SPA navigation
(`/editor/A` → dashboard → `/editor/B`) the editor page resolves
`openProject(B)` — which sets `activeProjectId = B` — *before* EditorShell
mounts, so the subscription never fires. The module-singleton store then
still holds project A's conversation, and `useCopilotMemory`'s
"conversation in progress" guard misclassified it as a live conversation:
project B's saved memory never hydrated, and the next store change would
have **written project A's messages into project B's persisted record**.

**Fix.** `useCopilotMemory` now resets the Copilot store **exactly once per
real mount** (`didInitialResetRef` guard, before the first load), so a fresh
editor mount always starts from a clean store. StrictMode-safe: the
simulated remount reuses the same refs, so the reset runs once; the
existing in-progress guard still protects messages typed *after* mount but
*before* the async load resolves. Verified with a new test file
`src/features/ai-copilot/hooks/__tests__/useCopilotMemory.test.tsx`
(3 tests) — the cross-project test **fails without the fix** (demonstrated
by temporarily disabling it) and passes with it.

### Checklist verdicts (all 12 items)

| Item | Verdict |
| --- | --- |
| Cross-project memory isolation | **Fixed (Finding 3)** — fresh-mount reset + per-project keying + token supersession |
| Bounded message/style-note storage | Sound — caps enforced at store, serializer, and schema (read + write) |
| Malformed/corrupt record rejection | Sound — `validateCopilotMemoryRecord` → null → "no memory"; M5 E2E covers it |
| Prototype-pollution handling | **Fixed (Findings 1–2)** — drop at entry, reject at read (defense-in-depth) |
| Provider-context privacy | Sound — safe projection only; plan payloads/provider internals never persisted |
| No recovery/history/secret leakage | Sound — memory record contains only messages + style notes; nothing else written |
| StrictMode persistence behavior | Sound — token-based load supersession; single-write coalescing; verified by test |
| pagehide flush | Sound — immediate best-effort flush on `pagehide`/`visibilitychange` |
| Stale project-switch behavior | **Fixed (Finding 3)** |
| Project deletion cleanup | Sound — `lazyCopilotMemoryCleanup` on both controller delete paths |
| IndexedDB v9 migration/first-connection safety | Sound — shared `ensureDatabaseStores` creates all stores on first connection; non-destructive |
| Raw error leakage | Sound — user-facing messages are generic; `cause` stays internal, never rendered |

---

## 3. Incidents (documented truthfully)

### Windows export-build cleanup incident (previous session)

During earlier validation, process cleanup / `tree-kill` activity around the
Windows export-build gate disturbed running processes. The
`test:export-build` gate was re-run and passed cleanly; no production code
was changed for it.

### Cold Next/webpack worker crash during E2E revalidation (previous session)

The targeted `ai-copilot-memory` E2E rerun hit an editor HTTP 500 because
the Next.js webpack dev server crashed with
`"Jest worker encountered 2 child process exceptions"` — a consequence of
the earlier process cleanup, not of application code. This session confirmed
that: after terminating all stale processes and starting **one fresh**
`npm run dev -- --webpack` server, the same E2E suite passed **5/5** with a
clean dev-server log and no application/runtime error.

### Unrelated load-sensitive unit-test observations

Under suite load, pre-existing `import-project-dialog` timing tests (in
untouched files) occasionally flaked; they pass repeatedly in isolation and
were **not** modified. This session's full unit suite ran **alone** (no
concurrent dev server or build) and passed **3563/3563**.

---

## 4. Final validation results

### Post-security-fix gates (this session, final state)

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | ✅ clean (exit 0) |
| `npm run lint` | ✅ clean (exit 0) |
| `npm test` (vitest, run alone) | ✅ **254 files / 3563 tests, 0 failures** |
| `npm run build` (Turbopack prod) | ✅ compiled in 6.4s, TypeScript 16.7s, 9/9 static pages |
| `e2e/ai-copilot-memory.spec.ts` (Chromium, 1 worker) | ✅ **5/5 passed** (26.0s, and 25.7s after Finding 3 fix) |
| ai-copilot focused suite | ✅ **187 tests** (14 files, includes new hook tests) |

The new cross-project isolation tests: 3/3 pass with the fix; the
discriminating test fails (1/3) without it.

### Broad regression suites (completed in the previous session, before the two sanitizer fixes)

These surfaces are unrelated to memory serialization, and the security
changes do not affect them; they were already green and were not re-run:

| Suite | Result |
| --- | --- |
| Full E2E (`test:e2e`) | ✅ 97/97 |
| `test:e2e:matrix` | ✅ green |
| `test:e2e:fallback` | ✅ green |
| `test:export-build` | ✅ green (post-cleanup re-run) |

---

## 5. Completion criteria (from the architecture doc)

- ✅ Conversation persists per project across reloads and restores on open.
- ✅ Style notes persist, apply to EDIT requests (bounded), clearable.
- ✅ "New conversation" clears memory explicitly; project delete removes the
  record.
- ✅ No approval surface or plan ever restores from storage; project state
  untouched by memory.
- ✅ Context stays bounded; privacy exclusions hold; corrupt records ignored.
- ✅ v8→v9 migration non-destructive; store-list tests updated to 14.
- ✅ New P11 unit/component/E2E tests pass; existing suites stay green
  (tsc, lint, unit, build, full E2E, matrix, fallback, export-build).
- ✅ `docs/phase-p11-report.md` written. **P12 not started.**
