# Phase P11 — Architecture Decisions: Project Memory & Continuity

Branch: `phase-p11-product-evolution`
Written before implementation. This document reconciles the Phase P11
objective with the actual repository state (Phases K/M/L/N/O/P1–P10 all
merged) and records every design decision the phase is built on.

---

## 1. Phase P11 title

**Project Memory & Continuity** — the AI Copilot remembers your project across
sessions.

## 2. Product goal

A beginner who builds a site over several sessions should never have to
re-explain their work to the AI. Returning to a project restores the Copilot
conversation the user left behind, and the Copilot honors the tone/style
preferences the user has already taught it. The AI feels continuous with the
user's work, not amnesiac between visits.

Concretely, P11 delivers:

1. **Bounded per-project Copilot conversation persistence** — the session-only
   P10 conversation survives reloads and project switches; it is stored
   locally per project, restored when the project is reopened, and cleared
   explicitly (never silently).
2. **On-device tone/style memory ("style notes")** — a small, explicit,
   user-managed set of style preferences (e.g. "keep it friendly", "use
   British spelling") that the Copilot applies to future edit requests and
   ASK answers, persisted per project, bounded, and removable.

Both features are **local-first**: no cloud, no new provider surface, no new
network calls, no change to the AI provider boundaries.

## 3. Current product gap

Walking the full beginner journey against the shipped product:

```
create project → choose template → edit → use AI → preview
→ fix quality → publish → return later → continue working
```

Phases P1–P10 cover every step except the final loop. Specifically:

- The **AI Copilot (P10)** conversation is explicitly session-only
  (`useCopilotStore` header: "Deliberately NOT persisted… Cleared on project
  switch"). Reloading the editor or switching projects wipes all context —
  the user's questions, their approved edits, their follow-up thread.
- The **context builder** only carries a 4-message conversation tail. The
  Copilot has no memory of the site's tone or the user's style preferences,
  so "keep everything friendly" must be re-typed on every visit.
- The **guided builder / Launch Center** track project *state*, not the
  user's *working context*. Nothing tells the AI "what we were doing".

This is the weakest link of the journey: a beginner returning the next day
starts from zero with the very feature (AI help) that is supposed to reduce
their effort.

## 4. Why P11 is the correct next phase

1. **Highest beginner value** — returning and continuing is the most common
   long-horizon journey; conversation persistence is the top candidate named
   by the P10 report for exactly this reason.
2. **Architectural dependency ordering** — P11 builds directly on P10's
   Copilot store, message model (already bounded + structured metadata),
   context builder, and provider boundaries. It does not require P11-first
   infrastructure from any other phase.
3. **Low risk, fully local** — no cloud/sync/network surface, no provider
   changes, no new dependencies, no auth changes. IndexedDB migration follows
   the established P4/P9 pattern (version bump + shared `ensureDatabaseStores`).
4. **Coherent scope** — the two capabilities solve ONE user problem
   ("the AI remembers my project") and share one persistence record, one
   migration, one restore path, and one clear/delete lifecycle.
5. **Privacy-safe by construction** — local-first, bounded, explicit, and
   deleted on demand, satisfying the phase's privacy rules without server
   involvement.

## 5. User stories

- **US1 (continuity):** As a beginner, when I close my browser and return to a
  project the next day, I want the Copilot conversation I left behind to still
  be there so I can continue without re-explaining.
- **US2 (follow-ups across sessions):** As a user, when I asked the Copilot
  to make the hero friendlier yesterday, I want "make it shorter" today to
  still target the same section, so follow-ups work across sessions.
- **US3 (style memory):** As a user, when I tell the Copilot "always use a
  friendly tone", I want it to remember that preference for future edits on
  this project without me repeating it.
- **US4 (explicit control):** As a user, I want a visible "New conversation"
  and a way to forget what the Copilot remembers, so I control my data and
  start clean whenever I choose.
- **US5 (privacy):** As a user, I want conversation memory to stay on my
  device (never sent to any server just to store it), so my drafts and chats
  are not stored remotely without my involvement.
- **US6 (no surprises):** As a user, I never want a restored conversation to
  auto-apply an old plan or alter my project; restoration must be strictly
  conversational.

## 6. In-scope functionality

1. **Per-project conversation persistence (local-first).**
   - New IndexedDB store `copilotMemory` (database version 9) with one record
     per project: bounded messages + style notes + timestamps.
   - Restore on project open/hydration: the Copilot store's `messages` and
     `styleNotes` are hydrated from the record after the project loads.
   - Debounced save when the conversation changes; flush on project switch /
     page unload where practical.
   - "New conversation" clears the in-memory conversation AND the persisted
     record (explicit, never silent). A separate "Forget saved history"
     affordance is NOT needed — the existing Clear action covers it.
2. **On-device style memory.**
   - `styleNotes`: bounded (max 6) explicit short notes (max 120 chars each),
     user-managed from the Copilot panel (add / remove / clear all).
   - Included in the bounded Copilot context (max 3 notes, capped) so ASK
     answers and quality reviews can reflect them.
   - For EDIT intents (plan-edit + inline suggestions), the user's style notes
     are appended to the instruction as a **bounded** suffix (max 240 chars,
     user-authored text only) so the provider honors them. ASK/EXPLAIN never
     mutates anything.
3. **Restore safety.**
   - Only `messages` + `styleNotes` are restored. `planState`,
     `elementSuggestion`, `error`, `lastRequest`, `status`, `appliedSummary`
     are NEVER persisted or restored — no approval surface can reappear from
     storage, and no plan can auto-apply.
   - Restored messages keep their existing structure (`CopilotMessage`), so
     follow-up resolution (`resolveFollowUpTarget`) works across sessions.
4. **Lifecycle cleanup.**
   - Deleting a project deletes its `copilotMemory` record (best-effort via
     the existing controller delete path).
5. **Instrumentation.** Perf marks `copilot_memory_load` and
   `copilot_memory_save` (deterministic counts) through the existing transient
   ring.

## 7. Explicit non-goals (P11)

- **Streaming AI plan drafting** — P10 candidate #2, deferred to P12.
- **Richer element-level AI plan operations** — P10 candidate #3, deferred.
- **`.buildora-template.json` file format** — deferred since P9/P10.
- **Public read-only share links** — deferred since P9 (needs a server
  component and ownership/revocation model).
- **Cloud sync for personal templates / recovery snapshots / conversations** —
  P10 candidate #7, deferred. The `copilotMemory` store is deliberately NOT
  wired into the P6 sync layer.
- **Cross-device memory** — no roaming; local-first only.
- **Autonomous memory** — the Copilot never learns style on its own; only the
  user's explicit notes are remembered. No background agents, no continuous
  AI modification.
- **No change to the AI provider path**, no new AI capabilities, no change to
  plan/apply/history semantics, no changes to manual editing.

## 8. UX flows

**Restore flow (US1/US2):**

```
open /editor/[projectId] → project hydrates → memory hook (mounted in
EditorShell) loads copilotMemory[projectId] → hydrates Copilot store
messages + styleNotes → user opens Copilot panel → conversation visible,
"New conversation" and style chips reflect saved state.
```

**Style memory flow (US3/US4):**

```
Panel footer "Remember my style" → type "keep it friendly" → Add → note
chips appear → on next EDIT request the note is appended (bounded) to the
instruction → provider plans accordingly → ASK answers mention the note when
relevant. "×" on a chip removes it; "Clear all" empties the list.
```

**Clear flow (US4):**

```
"New conversation" → confirm in-place (no modal stacking) → messages cleared
in store AND persisted record deleted → style notes cleared too (they are
part of the same memory record; the user is told what was cleared).
```

**Project delete flow (US5):**

```
Dashboard delete → controller.deleteProject → best-effort delete of
copilotMemory[projectId] alongside the project record.
```

## 9. Architecture overview

```
┌────────────────────────────────────────────────────────────┐
│  EditorShell (editor page)                                  │
│   ├─ CopilotPanel (lazy-loaded)                             │
│   └─ useCopilotMemory (new, mounted once)                   │
│        ├─ subscribes to activeProjectId + isHydrated        │
│        ├─ on open: memoryService.load(projectId)            │
│        │    → hydrate copilot-store messages + styleNotes   │
│        └─ on messages/styleNotes change: debounced save     │
│             → memoryService.save(projectId, record)         │
│                                                             │
│  Copilot store (P10, extended: + styleNotes)                │
│   └─ messages (bounded 24) · styleNotes (bounded 6)         │
│                                                             │
│  memory/ (new feature folder)                               │
│   ├─ types + schema (zod validate-on-load)                  │
│   ├─ storage/copilot-memory-storage.ts (IndexedDB, P9       │
│   │   adapter pattern + ensureDatabaseStores)               │
│   └─ services/copilot-memory-service.ts (load/save/clear/   │
│       delete; serializer that persists only safe fields)    │
│                                                             │
│  persistence (modified)                                     │
│   ├─ constants: DATABASE_VERSION 8→9, STORE_COPILOT_MEMORY  │
│   └─ db-schema: create copilotMemory store (non-destructive)│
└────────────────────────────────────────────────────────────┘
```

No second editor mutation architecture. The memory feature never writes
project state; it only persists/restores the Copilot's own transient UI store.

## 10. Components

- **`src/features/ai-copilot/components/StyleNotesSection.tsx`** (new) — the
  "Remember my style" chip editor inside the Copilot panel: input + add,
  chips with remove, "Clear all", beginner copy, accessible labels.
- **`src/features/ai-copilot/components/CopilotPanel.tsx`** (modified) —
  renders `StyleNotesSection`; "New conversation" action extended to clear the
  persisted memory; a subtle "Saved conversation restored" hint when memory
  was hydrated (kind: system, non-intrusive, not persisted itself).
- **`src/features/ai-copilot/hooks/useCopilotMemory.ts`** (new) — the
  load/save wiring hook (see §9).
- **`src/app/editor/[projectId]/page.tsx`** (modified) — mounts
  `useCopilotMemory` inside `EditorShell`.

## 11. Services

- **`src/features/ai-copilot/memory/services/copilot-memory-service.ts`** —
  framework-independent:
  - `load(projectId)` → validated record or null (never throws to the caller
    of the editor load path).
  - `save(projectId, { messages, styleNotes })` → bounded, sanitized write.
  - `clear(projectId)` → deletes the record.
  - `deleteForProject(projectId)` → same as clear (lifecycle hook).
  - `serializeForStorage(...)` → persists ONLY safe `CopilotMessage` fields
    (id, role, content, kind, metadata, createdAt) — never plan payloads,
    raw provider text, or internal state.
  - Debounce is implemented in the hook (800 ms), not the service.
- **`src/features/ai-copilot/services/copilot-service.ts`** (modified) —
  `handleCopilotMessage` accepts optional `styleNotes`; for EDIT intents the
  bounded style suffix is appended to the instruction before planning.
- **`src/features/ai-copilot/context/context-builder.ts`** (modified) —
  accepts `styleNotes` (bounded to 3, capped 120 chars) and exposes them in
  `CopilotContext.styleNotes`.

## 12. State ownership

- **Copilot store** (existing) owns the live conversation and style notes —
  single source of truth for the panel UI.
- **`copilotMemory` IndexedDB record** owns the persisted copy — only read at
  restore time and written on change.
- **Editor store / Project** are untouched: memory is never part of
  `ProjectSchema`, never in `.buildora.json`, never in the website export.
- The memory hook is the only bridge between the two; it never writes to
  either store's project state.

## 13. Persistence / data-model changes

New record shape (store `copilotMemory`, keyed by `projectId`):

```ts
interface CopilotMemoryRecord {
  projectId: string;
  version: 1;
  messages: PersistedCopilotMessage[];   // bounded to COPILOT_LIMITS.maxMessages (24)
  styleNotes: string[];                  // bounded to MAX_STYLE_NOTES (6) × 120 chars
  createdAt: string;                     // ISO
  updatedAt: string;                     // ISO
}
```

- One record per project; a project with no Copilot activity has no record.
- `PersistedCopilotMessage` is a **safe projection** of `CopilotMessage`
  (whitelisted fields only, no plan payloads).
- Bounds are enforced at write time (trim to maxMessages, cap style notes) AND
  at read time (schema + length guards) so corrupt/oversized records can never
  blow up memory or the UI.

## 14. IndexedDB migration strategy

- `DATABASE_VERSION` 8 → 9. The only schema change is a new object store
  `copilotMemory` (keyPath `id` = `projectId`), created through the shared
  `ensureDatabaseStores()` helper — whichever adapter runs the upgrade creates
  it, and the migration is non-destructive (existing stores/data untouched).
- Store-list assertions in existing tests that hard-code the store count
  (13) are updated to 14 and the new store name added to the expected lists
  (`personal-template-storage.test.ts`, `my-block-collections.test.ts`,
  `my-block-thumbnail-storage.test.ts`, `cloud-sync-queue.test.ts`). This is
  the documented P4/P9 store-drift convention, not a weakened assertion.
- A new migration test asserts v8→v9 preserves existing records and creates
  the new store.

## 15. Cloud-sync implications

**None.** `copilotMemory` is a local-only store and is deliberately NOT wired
into the P6 sync layer:
- The sync engine only knows its own entity types; adding memory would require
  cloud-side schema + conflict rules and would break the "conversations stay on
  device" privacy stance.
- Documented as a P12 candidate ("cloud sync for conversations / memory") with
  an explicit privacy decision required before enabling.
- Existing sync tests are untouched by this phase.

## 16. AI / provider boundaries

- The provider path (`/api/generate`, Gemini + rule-based fallback) is
  unchanged. No new provider mode, no new request shape.
- Style notes reach the provider ONLY as part of the user-authored instruction
  for EDIT intents (bounded ≤ 240-char suffix, max 2 notes) — this is the
  user's own text, not an app-state dump, and it remains within the existing
  instruction size limits.
- ASK/EXPLAIN remains provider-free and mutation-free.
- Never persist or transmit raw provider responses; the serializer strips
  everything except the safe message projection.

## 17. Privacy model

- **Local-first:** memory lives in the user's browser IndexedDB. Nothing is
  sent to any server to be stored; the only network path is the existing
  provider request, which already carries bounded context.
- **Bounded:** 24 messages, 6 style notes × 120 chars, one record per
  project.
- **Explicit:** nothing is remembered until the user converses or adds a
  style note; the "New conversation" action clears the record.
- **Excluded from memory:** plan payloads, provider internals, credentials,
  tokens, error details, project content (only message text), other projects'
  data.
- **No cross-project leakage:** restore is keyed by the active `projectId`
  and the store resets on project switch (existing behavior).

## 18. Security / threat model

- **Validate on load:** persisted records pass a Zod schema (`version`,
  shapes, length caps, role/kind whitelists) before hydrating the store;
  invalid/oversized records are ignored (treated as no memory), never thrown
  into the UI.
- **No HTML execution:** messages and notes render as React text nodes (the
  P10 panel already has no `dangerouslySetInnerHTML`).
- **No prototype pollution:** the schema rejects unexpected keys and the
  record is parsed/validated before use.
- **No secret storage:** the serializer writes only whitelisted fields.
- **Bound enforcement on read AND write** prevents oversized records from
  growing unboundedly.
- **Delete on project delete** prevents orphaned records accumulating per
  deleted project.
- **No new code execution surfaces** (no eval / new Function / vm).

## 19. Validation boundaries

- Write path: trim to caps → validate record with schema → IndexedDB put.
- Read path: get record → schema-validate → cap strings → hydrate store.
- The Copilot's existing plan/apply validation (server + client simulation,
  stale revision guards) is entirely untouched — restored conversations can
  never resurrect an approval surface or bypass a guard.

## 20. Failure / recovery behavior

- **Memory load fails** (IndexedDB error / corrupt record): Copilot opens with
  an empty conversation; a quiet in-panel note ("Couldn't restore the saved
  conversation") is shown; the editor and Copilot keep working normally.
- **Memory save fails** (quota / adapter error): the live conversation still
  works; the failure is logged to the existing logger and surfaced as a
  non-blocking status hint, never an error dialog.
- **Record missing:** treated as a fresh project (no memory) — normal case.
- Restore never blocks project open/hydration (fire-and-forget with
  `isHydrated` gating).

## 21. Offline behavior

Fully offline-capable: IndexedDB is local. Restore/save work with the network
down; provider-dependent EDIT/ASK behaviors keep their existing offline
fallback semantics.

## 22. Performance constraints

- One small IndexedDB read per project open and debounced (800 ms) writes on
  conversation change — never per keystroke.
- Records are bounded (24 msgs / 6 notes), so reads/writes are tiny.
- `useCopilotMemory` mounts in the editor shell but is inert (no reads/writes)
  until a project is hydrated and the conversation changes.
- No new eager bundles: the memory feature lives inside the already
  lazy-loaded Copilot surface.

## 23. Accessibility requirements

- Style-note input has a visible label, the chips are real buttons with
  accessible names and visible focus states, and removal is announced
  (`aria-live` where practical).
- The "New conversation" confirmation stays inline (no modal stacking) and is
  keyboard-accessible.
- Restore hint is a low-emphasis text/status region, not a modal.
- No WCAG certification claim is made.

## 24. Instrumentation / observability

- Perf marks (existing transient ring, deterministic counts only):
  - `copilot_memory_load`
  - `copilot_memory_save`
- No analytics are sent anywhere; nothing is persisted beyond the local
  record.

## 25. Unit / component testing strategy

**Unit (vitest):**
- Memory schema: valid record passes; oversized/corrupt/wrong-version/unknown
  keys rejected; string caps enforced; prototype-pollution keys rejected.
- Serializer: persists only safe fields; strips plan payloads/provider text.
- Storage adapter: CRUD + count + clear + delete-for-project (fake-indexeddb,
  P9 adapter pattern).
- Service: load (null when missing), save (bounds enforced), clear, delete;
  failure isolation (never throws to caller).
- Context builder: style notes included, capped, bounded to 3; excluded when
  empty.
- Copilot service: style suffix appended for EDIT intents, bounded, NOT
  appended for ASK; existing behavior unchanged when no notes exist.
- Restore safety: only messages/styleNotes restored — planState/suggestion/
  error/lastRequest/status never persisted.

**Component (vitest + testing-library):**
- StyleNotesSection: add (valid/invalid/duplicate), remove, clear all,
  disabled at cap, labelled input.
- CopilotPanel: restored conversation renders; "New conversation" clears
  messages + calls the memory clear; restore-hint appears only on restore;
  style chips appear after hydration.

**Backward compatibility:** all existing P10 Copilot tests must pass
unchanged (defaults preserve prior behavior when no memory exists).

## 26. P11 E2E scenarios

New suite **`e2e/ai-copilot-memory.spec.ts`** (deterministic mocked
`/api/generate`, no live AI), using the existing `e2e/helpers/copilot.ts`:

1. **FLOW M1 — conversation survives reload (US1/US2):** open project → open
   Copilot → send an edit → apply plan → send "make it shorter" follow-up →
   reload → reopen Copilot → prior conversation visible → "make it shorter"
   re-plans against the current project (fresh plan, same target).
2. **FLOW M2 — style memory (US3):** add "keep it friendly" note → request an
   edit → mocked provider receives the style suffix → reload → note still
   present → a new edit request still carries it.
3. **FLOW M3 — explicit clear (US4):** conversation + note → "New
   conversation" → reload → conversation and notes gone (record deleted).
4. **FLOW M4 — no stale approval (US6):** prepare a plan (awaiting approval)
   → reload → Copilot opens with conversation but NO plan review card and
   project unchanged.
5. **FLOW M5 — privacy/safety (US5):** a corrupt/oversized `copilotMemory`
   record injected directly into IndexedDB is ignored on load (empty
   conversation, no crash); a second project's conversation never appears in
   the first project.

## 27. Regression requirements

- All existing P10 Copilot unit/component tests pass unchanged.
- Store-list assertions updated to 14 (documented convention).
- Full suites: `npx tsc --noEmit`, `npm run lint`, `npm test`,
  `npm run build`, then `test:e2e`, `test:e2e:matrix`, `test:e2e:fallback`,
  `test:export-build` sequentially.

## 28. Implementation sequence

1. `memory/types.ts` + `memory/schema.ts` (limits, record, persisted-message
   projection, Zod schema).
2. Persistence: `DATABASE_VERSION` 9, `STORE_COPILOT_MEMORY`,
   `ensureDatabaseStores` store creation.
3. `memory/storage/copilot-memory-storage.ts` (IndexedDB adapter, P9 pattern).
4. `memory/services/copilot-memory-service.ts` (load/save/clear/delete +
   serializer) + unit tests.
5. Copilot store: add `styleNotes` + actions (`addStyleNote`, `removeStyleNote`,
   `clearStyleNotes`); extend `clearConversation` semantics at the hook layer.
6. Context builder + copilot-service style integration (+ tests).
7. `hooks/useCopilotMemory.ts` (load on hydrate, debounced save, clear hook).
8. UI: `StyleNotesSection`, CopilotPanel integration, restore hint.
9. Editor page mount + project-delete cleanup hook.
10. Component tests.
11. `e2e/ai-copilot-memory.spec.ts`.
12. Security/privacy review, then full validation, then report.

## 29. Completion criteria

- Conversation persists per project across reloads and restores on open.
- Style notes persist, apply to EDIT requests (bounded), and are clearable.
- "New conversation" clears memory explicitly; project delete removes the
  record.
- No approval surface or plan ever restores from storage; project state
  untouched by memory.
- Context stays bounded; privacy exclusions hold; corrupt records are ignored.
- Store migration v8→v9 non-destructive; store-list tests updated.
- New P11 unit/component/E2E tests pass; ALL existing suites stay green
  (tsc, lint, unit, build, full E2E, matrix, fallback, export-build).
- `docs/phase-p11-report.md` written; P12 not started.

## 30. Explicit P12+ deferrals

- Streaming AI plan drafting.
- Richer element-level plan operations.
- `.buildora-template.json` file format.
- Public read-only share links.
- Cloud sync for personal templates / recovery snapshots / conversations (needs
  an explicit privacy decision).
- Cross-device memory roaming.
- Autonomous style learning (AI infers tone from edits without user notes).
- Billing, marketplace, multiplayer, analytics — remain out of scope.
