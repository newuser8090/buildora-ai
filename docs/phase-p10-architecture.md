# Phase P10 — Architecture Decisions: AI Copilot & Quality

Branch: `phase-p10-ai-copilot-and-quality`
Written before implementation. This document reconciles the Phase P10
specification with the actual repository state (which has evolved through
Phases K/M/L/N/O/P1–P9) and records every design decision the phase is built
on.

---

## 1. Existing AI editing architecture (as found in the repository)

The repository already contains a mature AI editing stack that P10 builds on.
Nothing below is invented for P10 — it is the ground truth P10 reuses:

- **Plan model** — `src/features/ai-editing/plan-types.ts`. Versioned
  `AiEditPlan` (`version: 1`, stable `id`, `projectId`, `baseRevision`,
  `scope`, `instruction`, `summary`, `operations[]`, `warnings`, `provider`).
  Twelve typed operations (`update-section-props`, `update-section-styles`,
  `insert-section`, `delete-section`, `duplicate-section`, `move-section`,
  `set-section-visibility`, `add-page`, `rename-page`, `delete-page`,
  `move-page`, `update-page-meta`), each with stable operation ids, `risk`
  (`low|medium|high`), `label`, `explanation`, and optional `dependsOn`.
  **Plans are data, never code** — no executable payloads, no arbitrary
  property paths, no JSON Patch against the Project object.
- **Validation** — `schemas/plan-schemas.ts`. Zod `AiEditPlanSchema` with
  per-type section props schemas, page title/slug rules, operation caps
  (≤ 30 ops, ≤ 5 inserted pages, ≤ 20 inserted sections, ≤ 100 KB JSON),
  dependency integrity, and unknown-field stripping. `PlanEditRequestSchema`
  validates the full request server-side.
- **Planners** — `planner/gemini-plan-provider.ts` (Gemini, JSON-only system
  instruction, compact project digest ≤ 18 KB, no assets/data URLs) and
  `planner/rule-based-planner.ts` (deterministic fallback with injectable id
  factories; covers add/delete/move/hide/show sections and pages plus tone
  rewrites). The orchestrator `services/planner-orchestrator.ts` tries Gemini,
  falls back to rule-based, then validates and **simulates every plan**
  server-side before the client ever sees it.
- **Simulator** — `services/plan-simulator.ts`. Pure, deterministic
  application of operations to a deep clone, reusing the canonical
  section/page structure helpers and `ProjectSchema` + `AnySectionSchema` +
  routing validation. Never mutates the store. Produces per-operation
  results, warnings, and (optionally) before/after snapshots.
- **Diffs** — `services/diff-builder.ts`. Converts simulator snapshots into a
  small typed field set (`text|structure|visibility|metadata|page`) for the
  review UI; values are capped (500 chars), never a raw project dump.
- **Client plan flow** — `services/plan-service.ts` `runPlanEdit()` posts
  `mode: "plan-edit"` to `/api/generate` and returns the validated plan plus
  chat summaries. `store/plan-store.ts` holds transient plan state
  (status/selection/diffs/warnings/error/request token). `hooks/useAiPlanEdit.ts`
  drives create → ready → apply with stale-revision detection.
- **Canonical application** — `store/editor-store.ts` `applyAiEditPlan()`.
  One atomic history entry: re-simulates the selected operation set against
  the live project, rejects `PLAN_STALE` (revision mismatch), rejects unknown
  ops / broken dependency closure, requires `allowDestructive` for high-risk
  ops, commits the simulated result as **ONE** history entry, and repairs
  selection. This is the ONLY writer of AI plans into project state.
- **Chat** — `features/chat/store/chat-store.ts`. Transient, session-only
  message list (user/assistant/system, pending/complete/error) used by the
  LeftSidebar AI Assistant.
- **Provider path** — `/api/generate` routes `create` / `modify` /
  `plan-edit` / `inline-edit` through Gemini with a deterministic rule-based
  fallback (`BUILDORA_FORCE_LOCAL_GENERATION` or `x-buildora-force-local`
  header forces local). Structured user-safe errors; raw provider errors are
  never returned to the client.
- **Launch readiness** — `features/launch-readiness/`. Pure deterministic
  engine (`getLaunchReadinessReport`) computing a 0–100 score from typed
  `LaunchCheck` findings. Authoritative for whether a check passes. Never AI,
  never persisted, never mutates.
- **Inline editing** — `features/inline-editing/`. Registered editable text
  fields, a pure validated update service, and `updateEditableFieldValue` on
  the editor store (one atomic history entry). Suggestion providers (Gemini +
  rule-based) via `mode: "inline-edit"`.
- **Perf instrumentation** — `features/perf/perf-instrumentation.ts`.
  Transient in-memory ring; `markPerf` / `measurePerf` / `recordPerf` /
  `countPerf`.
- **Chrome** — TopNav, CommandPalette (`Ctrl/Cmd+K`), keyboard shortcut
  registry (`features/help/keyboard-shortcuts.ts`), `useKeyboardShortcuts`,
  editor page `EditorShell` mounts all shared dialogs.

**Conclusion:** the repository has ALREADY solved plan structuring, schema
validation, provider fallback, atomic execution, and history/undo. P10 must
NOT rebuild these. P10's job is to wrap them in a beginner-first,
context-aware, approval-first Copilot conversation surface, add a bounded
privacy-safe context builder, add ASK/EXPLAIN and quality-assistant behavior
that never mutate, and harden plan validation for adversarial payloads.

---

## 2. What P10 reuses (explicit)

| Capability | Reused from |
|---|---|
| Plan model + operation types | `ai-editing/plan-types.ts` |
| Zod plan/request validation | `ai-editing/schemas/plan-schemas.ts` |
| Gemini + rule-based planning | `ai-editing/planner/*` + `planner-orchestrator.ts` |
| Pure plan simulation | `ai-editing/services/plan-simulator.ts` |
| Review diffs | `ai-editing/services/diff-builder.ts` |
| Plan request client | `ai-editing/services/plan-service.ts` `runPlanEdit` |
| Atomic one-history-entry application | `editor-store.applyAiEditPlan` |
| Undo/redo | `editor-store.undo/redo/canUndo/canRedo` |
| Chat message rendering conventions | `chat/store/chat-store.ts` (Copilot keeps its own store; see §4) |
| Readiness findings | `launch-readiness/engine/*` + `useLaunchReadiness` |
| Field suggestions for single-field quick actions | `inline-editing` service + `updateEditableFieldValue` |
| Perf instrumentation | `features/perf/perf-instrumentation.ts` |
| Keyboard/palette/TopNav chrome | existing stores + registries |
| Provider fallback + force-local | `/api/generate` + `x-buildora-force-local` |

## 3. What must change

1. **New Copilot feature** `src/features/ai-copilot/` (store, context,
   conversation, intent/ask services, quality assistant, copilot service, UI).
2. **Security hardening of plan validation** — add rejection of
   prototype-pollution keys (`__proto__`, `prototype`, `constructor`) and
   unsafe href schemes (`javascript:`, `data:` HTML) to the canonical plan
   schema (`AiEditPlanSchema` superRefine) so **every** plan (Gemini or
   rule-based, server-side) is checked. This is the single new authority; the
   Copilot relies on it rather than duplicating rules.
3. **Chrome wiring** — TopNav AI Copilot button, command-palette entries
   ("Open AI Copilot", "Ask AI about this page"), a real keyboard shortcut
   (`Ctrl/⌘ + Shift + A`) registered in the help registry and
   `useKeyboardShortcuts`, and panel mount in `EditorShell`.
4. **Perf marks** — `copilot_open`, `context_build`, `plan_received`,
   `plan_validated`, `plan_applied` through the existing transient ring.

There is NO second editor mutation architecture. Every Copilot edit flows
through `applyAiEditPlan` / `updateEditableFieldValue` on the canonical
editor store.

---

## 4. Copilot state model

`store/copilot-store.ts` (Zustand, transient — never persisted, never in
ProjectSchema):

```
open: boolean                     — panel open/closed
status: CopilotStatus             — see below
scopeChoice: "auto" | CopilotScope  — user-selected scope ("auto" derives from selection)
scope: CopilotScope | null        — resolved scope for the current request
messages: CopilotMessage[]        — bounded conversation (≤ 24)
plan: AiEditPlan | null           — awaiting-approval plan
diffs: AiEditDiff[]               — review preview
selectedOperationIds: string[]    — checked operations (default: all except high-risk)
warnings: string[]                — planner warnings (sanitized)
error: CopilotError | null        — beginner-safe error
lastRequest: { instruction, scope, ... } | null  — for Regenerate/Retry
lastApplied: { opLabels, count } | null          — for the change summary
requestSeq: number                — monotonic token; stale async responses ignored
```

`CopilotStatus` maps the spec's states 1:1:
`idle` (panel open, awaiting input), `composing` (user is typing a non-empty
draft — derived, since the draft itself is local component state),
`planning`, `awaiting-approval`, `applying`, `completed` (after apply, until
the next request), `failed`. `closed` is represented by `open === false`
(the panel unmounts; the store persists so reopening restores the
conversation for the session).

Actions: `open/close/toggle`, `setStatus`, `setScopeChoice`, `resolveScope`,
`addUserMessage`, `addAssistantMessage` (bounded), `setPlanReady`,
`setApplying`, `setApplied`, `setError`, `setStaleError`, `clear`,
`nextRequestSeq`. Clearing (`clear`) wipes messages + plan + error and
resets to `idle` — it does NOT touch project state.

The Copilot deliberately has its **own** plan state rather than reusing
`useAiPlanStore`. The LeftSidebar AI Assistant (pre-existing surface) keeps
its own global plan store; sharing it would cause the LeftSidebar's plan
summary card to appear for Copilot plans and couple two surfaces. Both
surfaces share the same *services* and the same *application path* — only the
transient UI state is separate. This is the "everything opens the canonical
Copilot panel" rule applied to *new* entries; the pre-existing Assistant is
left untouched for backwards compatibility.

## 5. Conversation model

- **Session-only.** Not persisted, not IndexedDB, not in ProjectSchema.
  Rationale: simplest reliable model; a conversation is ephemeral editor
  context, and stale persisted plans are dangerous. Bounded retention:
  `MAX_MESSAGES = 24` — when exceeded the oldest user/assistant pair is
  trimmed. No provider internals are ever stored; assistant messages carry a
  small structured `metadata` (`kind`, `scope`, `planId`, `opLabels`,
  `pageId`, `sectionId`, `findingId`) used ONLY for follow-up resolution.
- **Roles:** `user`, `assistant`, `system` (status/notice bubbles).
- **Kinds** (on assistant messages): `question` (ASK answer),
  `edit-plan` (proposal awaiting approval), `applied` (post-apply summary),
  `error`, `system`, `quality`.
- **Follow-up resolution** (`conversation/conversation.ts`,
  `resolveFollowUpTarget`): uses bounded conversation tail + **current**
  editor state. Rules in priority order:
  1. If the instruction names a page ("About page", "homepage") → page scope.
  2. Else if a section is currently selected → that section.
  3. Else if the last plan/applied message had a section scope and that
     section still exists → that section.
  4. Else if the last plan/applied message had a page scope → that page.
  5. Else → project scope.
  When the last message had a section scope and the follow-up is vague
  ("make it shorter"), the scope resolves to that section and the instruction
  is passed through (the planner re-plans against current project state).
  For explicit "same/similarly/do the same" references, the previous
  instruction is appended as context so both providers can honor it. **A
  previous plan is NEVER reused** — every follow-up triggers a fresh plan
  against the current project, so a stale plan cannot apply.
- There is **no autonomous memory system**. Only the bounded tail + live
  editor state inform follow-ups.

## 6. Context architecture

`context/context-builder.ts` — `buildCopilotContext(input): CopilotContext`.
Deterministic, serializable, bounded. Built **only when a message is sent**
(never per keystroke). Fields:

- `projectId`, `projectName`
- `siteSettings` digest: `siteName`, `siteDescription`, `seo.title`,
  `seo.description` (each capped to 160 chars) — omitted entirely when absent.
- `activePage`: `{ id, title, slug, meta {title, description}, sectionCount }`
  plus a **bounded section list** (`{ id, type, headline }`, max 12 sections,
  headline capped 120 chars). Structural types only — no raw props dumps.
- `section` (when scope is section/element): `{ id, type, headline }` plus up
  to 5 key text fields (`headline`, `subheadline`, `title`, `subtitle`,
  `ctaText`-like keys) capped at 160 chars each.
- `element` (when scope is element): `{ label, currentValue }` (value capped
  240 chars).
- `readiness`: `{ score, topFindings: [{id, title, status}] }` — max 5
  findings, titles capped.
- `device`: current viewport.
- `conversationTail`: last 4 user/assistant content strings, each capped
  200 chars.
- `instruction`: the user's message, capped 500 chars in the context copy.

**Explicitly excluded:** `assets` (data URLs / blobs), `theme` internals,
auth tokens, provider credentials, deployment records, cloud-sync records,
recovery/personal-template data, unrelated IndexedDB data, hidden app state,
and any field whose value isn't display text. The builder only ever copies
whitelisted plain-text fields.

**Size bounding (deterministic reduction):** the whole context is
JSON-serialized at build time; if it exceeds `CONTEXT_MAX_BYTES` (12 KB) the
builder truncates in a fixed order (drop readiness beyond top 3, drop section
list beyond top 8, cap every string to its limit) and re-checks. The result
is a bounded snapshot that can never grow with project size beyond the caps.

## 7. Prompt/context boundaries

- The **plan-edit request** keeps its existing shape (`runPlanEdit` sends the
  validated Project; the server planner builds its own ≤ 18 KB digest). The
  Copilot does not inject the context digest into the instruction — the
  context builder serves the Copilot's *own* reasoning (intent, ASK answers,
  follow-up target resolution, quality drafting), not the provider prompt.
  This keeps provider boundaries unchanged and avoids double-sending data.
- ASK/EXPLAIN answers are generated **deterministically client-side** from
  the bounded context + readiness findings + a small glossary — no provider
  call, no network, no history entries. They are truthful: if the Copilot
  cannot answer from context, it says so and offers what it CAN do (readiness
  review, a draft, or a plan).

## 8. Plan lifecycle & validation

Copilot plan lifecycle (all through existing machinery):

```
compose → classify intent
  → (plan-edit) runPlanEdit (mode "plan-edit")        [plan_received mark]
  → server: Gemini → rule-based → validate → simulate  [schema hardening §3]
  → client: simulatePlan(live project) + buildDiffs    [plan_validated mark]
  → awaiting-approval (default selection excludes high-risk)
  → Apply → applyAiEditPlan (re-simulation, stale guard,
    destructive guard)                                  [plan_applied mark]
  → completed + change summary + Undo
```

Validation layers (defense in depth, all reused): server request schema →
server plan schema (+ new security superRefine) → server simulation →
client re-simulation → store re-simulation at apply. A plan is applied ONLY
if every target exists, every type matches, the whole set simulates cleanly
against the live project, the revision matches, and destructive ops are
explicitly confirmed. Invalid plans fail safely with structured codes mapped
to beginner copy (§13).

**Stale handling:** `PLAN_STALE` (revision changed), `PLAN_PROJECT_MISMATCH`,
`PLAN_OPERATION_INVALID` (target vanished/type changed), `PLAN_SIMULATION_FAILED`
are surfaced as "The page changed since the suggestion was prepared — nothing
was applied. Try again." with a Regenerate action that re-plans against the
current state. A Copilot plan is never applied to a different target than the
one shown.

## 9. Execution architecture (atomicity)

- **Plan application** = `editor.applyAiEditPlan(...)` — one history entry,
  one undo step, nothing half-applied (simulate-first, commit-after). The
  Copilot adds no parallel execution path.
- **Single-field quick actions** (selected text) use the inline suggestion
  service (`mode: "inline-edit"`) and apply through
  `editor.updateEditableFieldValue` — one validated atomic history entry.
  **Justification for approval-light single-field apply (spec §7):** the
  value is one registered text field, validated by the canonical field
  service, applied atomically, and fully undoable with one Ctrl/⌘+Z. The
  Copilot still shows the proposed value in the conversation and requires an
  explicit Apply click (never silent). No multi-field or structural change
  ever bypasses plan approval.
- **Change summary:** after apply, `completed` state shows "Done — updated N
  things" with operation labels and an **Undo** button that calls
  `editor.undo()` (the existing history — there is NO AI-only undo stack).
- Failure during apply leaves project state untouched (store guarantees).
  Selection is repaired by the store's post-apply selection logic.

## 10. Quality assistant

`services/quality-assistant.ts` — bridges the deterministic readiness engine
(authoritative) with the Copilot (helper). Behaviors:

- **Explain** any `LaunchCheck` in plain language (title + explanation +
  suggestedAction + affected page/section), with the current deterministic
  score shown and explicitly labeled as computed by Buildora's checks.
- **Never fabricates or alters the score.** The score is recomputed by
  `getLaunchReadinessReport` from project state only; the Copilot never
  writes readiness state.
- **Draft content** for content findings (e.g. missing site description,
  page SEO description): extracted deterministically from page copy, shown
  for the user to paste, with a button that opens the relevant settings
  dialog.
- **Create edit plans** where the plan op-set supports it:
  - `placeholder-text` → project-scope tone rewrite ("replace placeholder
    text with finished content").
  - `empty-headings` → section rewrite adding headings.
  - `page-meta` → `update-page-meta` plan for the affected page.
  - `seo-description` (page-level meta) → `update-page-meta` plan.
  Site-settings findings (site name/description/favicon) are not plan ops;
  the assistant drafts copy and opens Site settings instead (honest — it
  cannot and must not silently change settings).
- After an applied fix, the readiness report recomputes automatically from
  the new project state (the hook is memoized on `project`); the Copilot can
  re-run it on demand to show the updated finding.

## 11. Persistence decision

**Nothing new is persisted.** Conversations are session-only (bounded, §5).
No new IndexedDB stores, no schema version bump, no new provider state.
Plans continue to be transient review data. This preserves the P9 recovery
guarantees and keeps P10 out of the persistence layer entirely.

## 12. Privacy & security boundaries

- AI output is treated as untrusted data end-to-end: schema-validated,
  simulated, re-simulated, and applied only through canonical validated
  mutations.
- **No eval, no new Function, no vm, no arbitrary JS/HTML execution** anywhere
  in the Copilot. The panel renders plan text with React text nodes only —
  no `dangerouslySetInnerHTML`.
- **Plan schema hardening (new):** `AiEditPlanSchema` superRefine rejects
  operations containing prototype-pollution keys (`__proto__`, `prototype`,
  `constructor`) anywhere in props/styles/meta, and rejects `javascript:` /
  `data:` (HTML) href values. Enforced server-side for every provider.
- Context builder excludes secrets/tokens/assets/sync records (§6).
- Provider errors are mapped to structured user-safe messages; raw provider
  output, keys, and stack traces never reach the client or the conversation.
- Bounded context (12 KB), bounded conversation (24 messages), bounded plan
  size (existing 100 KB / 30 ops), bounded request body (existing 4 MB).
- Imported/generated content continues through existing safety boundaries
  (import sanitizer, unsafe-href detection, readiness hard-fails).

## 13. Failure handling (beginner UX)

All Copilot failures surface as beginner copy with a recovery path, never
stack traces or raw provider text:

| Underlying | Shown |
|---|---|
| provider unavailable / timeout | "I couldn't prepare that right now. Please try again." |
| malformed plan (schema/simulation) | "The AI suggestion didn't pass Buildora's safety checks — nothing was applied." |
| unsupported operation / no changes | planner's structured warning verbatim |
| stale target / revision changed | "The page changed before the suggestion could be applied. Try again." |
| plan validation failure | same as malformed plan |
| execution failure | "The change couldn't be applied. Your site is unchanged." |
| selection removed | "That section no longer exists, so I didn't apply the change." |
| user cancellation | no-op; plan discarded |

Every error state offers Retry/Regenerate and a Clear conversation action.

## 14. Offline / fallback behavior

The Copilot fully reuses the existing provider path: Gemini with the
deterministic rule-based planner fallback, plus `x-buildora-force-local` for
tests. ASK/EXPLAIN and readiness explanation need no provider at all, so the
Copilot remains useful offline. When the fallback genuinely cannot satisfy a
request (e.g. an unsupported instruction), it says so truthfully — the
Copilot never fakes an AI response and never claims a change was applied
unless the editor store confirms it (apply result `ok: true, changed: true`).

Manual editing, opening, saving, undo/redo, and every non-AI editor feature
have zero dependency on the Copilot: the panel is lazy-loaded
(`next/dynamic`), context is built only on send, and no editor interaction
path passes through Copilot code.

## 15. UI & accessibility

- Floating right-side panel (width ~ 360 px) sliding over the canvas, native
  Buildora tokens (card/border/text-*), mounted once in `EditorShell`.
- Scope indicator always visible: "Whole website" / "Home page" / "Hero
  section" / "Selected text: Headline". The Copilot never claims a selection
  that doesn't exist — section/element scopes appear only when actually
  selected, and the scope can be widened to page/website from the picker.
- Starter prompts (the six from the spec), quick actions per scope
  (element: rewrite/shorter/longer/clarity/grammar; section:
  improve/simplify/mobile layout/duplicate idea/suggest replacement; page:
  improve/review content/improve SEO text).
- Plan preview lists changes with before→after, risk badges, per-operation
  checkboxes (high-risk unchecked by default), Apply / Cancel / Regenerate.
- Change summary with Undo (existing history).
- Keyboard: `Ctrl/⌘ + Shift + A` opens the Copilot (registered in the real
  shortcuts registry); Escape closes; visible focus states; labelled
  controls; `aria-live` for loading/status announcements; focus returns to
  the trigger on close; no focus trap in the panel itself (it is not a modal,
  but Escape + focus handling are modal-consistent).
- No WCAG certification claim is made.

## 16. Performance

- Lazy-load the panel; zero Copilot code on the manual-edit hot path.
- Context built on send only. Diffs/simulation only on plan receipt.
- Perf marks (existing transient ring): `copilot_open`, `context_build`,
  `plan_received`, `plan_validated`, `plan_applied`. Counts are testable;
  wall-clock times are not asserted.
- No analytics are sent anywhere.

## 17. Testing strategy

- **Unit** (vitest): context builder (all scopes, size bounding, exclusion
  of secrets/internal fields), intent classifier, conversation (bounded
  retention, clear, follow-up resolution), ASK answerer, quality assistant
  (finding → explanation, no score mutation, fix plan drafting), copilot
  service (plan flow, stale handling, atomic apply = one history entry,
  undo, failed plan applies nothing, current state authoritative),
  store statuses, and **security** (prototype-pollution payloads,
  `javascript:` URLs, oversized context, provider-error sanitization).
- **Component** (vitest + testing-library): open/close, starter prompts,
  scope indicator, planning/awaiting-approval/applying/completed/failed
  states, apply/cancel/retry, change summary, undo.
- **E2E** (playwright, mocked `/api/generate` per existing conventions, no
  live AI): `ai-copilot.spec.ts` (FLOW A), `ai-copilot-followup.spec.ts`
  (FLOW B), `ai-copilot-safety.spec.ts` (FLOW C).
- Full regression: `tsc --noEmit`, lint, vitest, build, existing E2E
  suites, export-build.

## 18. Explicit P10 scope boundaries

**In scope:** Copilot panel + conversation, scope indicator, bounded context,
intent/ASK mode, structured plans + approval + atomic apply + undo, change
summary, follow-ups, quick actions, quality assistant, security hardening +
tests, keyboard/palette/TopNav integration, perf marks, docs.

**Out of scope (unchanged from the phase spec):** autonomous background
agents, continuous AI modification, multiplayer, comments/review, billing,
analytics dashboards, uptime monitoring, plugin marketplace, arbitrary code
execution, unrestricted web browsing by the AI, full CMS/database builder,
ecommerce backend, email marketing, and ALL Phase P11 work. The pre-existing
LeftSidebar AI Assistant surface is preserved as-is (no refactor).
