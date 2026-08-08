# Phase P10 Report — AI Copilot & Quality

Branch: `phase-p10-ai-copilot-and-quality`
Status: ✅ Complete — all regression suites green

---

## 1. Overview

Phase P10 turns the existing AI generation/editing foundations into a cohesive,
beginner-first **AI website copilot** living inside the editor. A user can open
the Copilot panel, ask natural-language questions or request changes, see a
structured proposed plan before anything changes, review what the AI intends to
do, apply it atomically through the canonical editor mutation system, undo it
with the normal editor history, and continue the conversation with contextual
follow-ups. The Copilot also answers questions without touching the project
(ASK/EXPLAIN mode) and interprets deterministic launch-readiness findings
without ever fabricating a score.

Scope footprint (working tree): **8 modified files plus 31 new files**
(1 architecture doc, 3 e2e specs, 1 e2e helper, 26 feature files/tests across
`src/features/ai-copilot/`). Design decisions are recorded in
`docs/phase-p10-architecture.md`.

**No new dependencies.** `package.json` is unchanged.

---

## 2. Architecture decisions

Recorded in `docs/phase-p10-architecture.md` before building. The decisions
that shaped the phase:

- **No second editor mutation architecture.** Every Copilot edit flows through
  the canonical `editor-store.applyAiEditPlan` (plan edits) or
  `editor.updateEditableFieldValue` (single-field quick actions) — one history
  boundary, one undo step, atomic commit. The Copilot adds services and UI
  only; it never writes project state directly.
- **Plan machinery is reused end-to-end.** `AiEditPlan` + operations,
  Zod `AiEditPlanSchema`, Gemini + rule-based planners, server-side
  `plan-simulator`, client `plan-service.runPlanEdit`, and the
  `applyAiEditPlan` stale/destructive guards are all inherited from
  Phases P3/P4. P10 adds validation hardening (§6) but replaces nothing.
- **Session-only conversations.** The Copilot conversation is transient and
  bounded (24 messages) — never persisted to IndexedDB, never in
  `ProjectSchema`, never across reloads. No provider internals are stored;
  assistant messages carry only a small structured metadata used for follow-up
  resolution. This is the simplest reliable model and avoids stale-plan
  persistence risk.
- **Deterministic, bounded context.** `buildCopilotContext()` builds a
  whitelisted plain-text snapshot (≤ 12 KB) only when a message is sent, with
  fixed truncation order. Auth tokens, credentials, deployment/sync records,
  assets/data URLs, and unrelated app state are explicitly excluded.
- **Ask/Explain is local and truthful.** ASK/EXPLAIN answers are generated
  deterministically client-side from the bounded context + readiness findings +
  a small glossary — no provider call, no network, no history entries. If the
  Copilot cannot answer from context it says so and offers what it *can* do.
- **The readiness engine stays authoritative.** The Copilot explains findings,
  drafts content, and can create an edit plan that fixes the underlying
  project data — it never writes readiness state and never alters a score.
- **Security hardening is one new authority.** `AiEditPlanSchema` gains a
  superRefine rejecting prototype-pollution keys and `javascript:`/`data:`
  (HTML) hrefs — enforced server-side for every provider (Gemini *and*
  rule-based), with a second raw-payload gate in the Gemini provider (zod's
  `z.record` rebuild silently converts an own `__proto__` key into a prototype
  setter, so the raw scan must run before normalization) and a third
  client-side scan in the Copilot service as defense-in-depth.

---

## 3. Files created

**Docs**
- `docs/phase-p10-architecture.md`

**E2E specs**
- `e2e/ai-copilot.spec.ts` — FLOW A: open → scope → request → plan → apply →
  confirm → undo → restored
- `e2e/ai-copilot-followup.spec.ts` — FLOW B: edit → apply → contextual
  follow-up → re-plan → apply → reload → persisted
- `e2e/ai-copilot-safety.spec.ts` — FLOW C: malformed/dangerous/stale plans
  cannot corrupt or silently mutate the project
- `e2e/helpers/copilot.ts` — deterministic mocked `/api/generate` route +
  panel/prompt helpers (no live AI in CI)

**Feature — AI Copilot** (`src/features/ai-copilot/`, 26 files)

- `types.ts` — `CopilotScope` (project/page/section/element), `CopilotStatus`,
  `CopilotMessage`, `CopilotError`, scope labels and `toAiEditScope` mapping
- `constants.ts` — bounds (context 12 KB, conversation 24 msgs, caps),
  beginner error copy, perf mark names, starter prompts, quick actions
- `context/context-builder.ts` — deterministic bounded context builder with
  exclusion + size reduction
- `conversation/conversation.ts` — bounded message store helpers +
  `resolveFollowUpTarget` (page name → current selection → last section/page →
  project), "same/similar" instruction augmentation
- `services/intent-classifier.ts` — ASK vs EDIT classification
- `services/ask-answerer.ts` — deterministic offline answers from context +
  readiness + glossary
- `services/quality-assistant.ts` — readiness finding explanations, content
  drafting, fix-plan creation; never touches the score
- `services/copilot-service.ts` — orchestrates context → plan request →
  client validation → apply; defensive security scan; sanitized errors
- `store/copilot-store.ts` — transient Zustand store (open/status/scope/
  messages/plan/diffs/error/lastRequest/requestSeq)
- `hooks/useCopilot.ts` — send/apply/cancel/retry/clear/undo flow with stale
  async-discard via `requestSeq`
- `components/CopilotPanel.tsx` + `ScopeBadge.tsx` + `StarterPrompts.tsx` +
  `QuickActions.tsx` + `PlanReview.tsx` + `ChangeSummaryCard.tsx` +
  `ElementSuggestionCard.tsx`
- `__tests__/` — `context-builder.test.ts`, `intent-classifier.test.ts`,
  `conversation.test.ts`, `ask-answerer.test.ts`, `quality-assistant.test.ts`,
  `copilot-service.test.ts`, `copilot-store.test.ts`, `helpers.ts`, and
  `components/__tests__/CopilotPanel.test.tsx`

---

## 4. Files modified (8)

| Area | Files |
|---|---|
| Editor page | `src/app/editor/[projectId]/page.tsx` — lazy-loads (`next/dynamic`) and mounts the Copilot panel once in `EditorShell`; zero Copilot code on the manual-edit hot path |
| Editor chrome | `src/components/editor/TopNav.tsx` — "Copilot" entry point (`data-testid="topnav-copilot-button"`) that opens the canonical panel |
| Command palette | `src/features/guided-builder/components/CommandPalette.tsx` — "Open AI Copilot" / "Ask AI about this page" entries |
| Keyboard | `src/hooks/useKeyboardShortcuts.ts` (Ctrl/⌘+Shift+A, input-target guarded) + `src/features/help/keyboard-shortcuts.ts` (registry entry) |
| Plan security | `src/features/ai-editing/schemas/plan-schemas.ts` (prototype-pollution + unsafe-href rejection) + `src/features/ai-editing/planner/gemini-plan-provider.ts` (raw-payload gate) |
| Tests | `src/features/ai-editing/schemas/__tests__/plan-schemas.test.ts` — adversarial payload coverage |

---

## 5. Dependencies added

**None.** `package.json` is unchanged — every P10 feature reuses existing
dependencies (zustand, zod, lucide-react, `crypto.randomUUID`, testing-library,
playwright).

---

## 6. Copilot architecture

The Copilot is a thin, beginner-first surface over the proven Phase P3/P4
plan/apply machinery. State lives in a transient Zustand store; the UI renders
the store; the service talks to the existing `/api/generate` `plan-edit` and
`inline-edit` providers (Gemini with deterministic rule-based fallback, or
`x-buildora-force-local` for tests). A plan request flows:

```
compose → classify intent (ASK vs EDIT)
  → (EDIT) runPlanEdit → server (Gemini → rule-based → validate → simulate)
  → client re-simulate + diffs → awaiting-approval (high-risk unchecked)
  → Apply → applyAiEditPlan (re-simulation, stale guard, destructive guard)
  → completed + change summary + Undo (editor.undo)
```

Every status in the spec is represented: closed (`open=false`), idle,
composing (derived from the draft), planning, awaiting-approval, applying,
completed, failed. Perf marks `copilot_open` / `context_build` /
`plan_received` / `plan_validated` / `plan_applied` are recorded through the
existing transient ring (no analytics are sent anywhere).

## 7. Context model

`buildCopilotContext(input)` returns a bounded serializable snapshot built only
on send: project id/name, site-settings digest (≤ 160 chars each), active page
with a bounded section list (≤ 12 sections, headline only), the target section
(≤ 5 key text fields, ≤ 160 chars each), the selected element label + value
(≤ 240 chars), readiness top findings (≤ 5), device, and a 4-message
conversation tail (≤ 200 chars each). The whole context is JSON-bounded to
12 KB with a fixed truncation order. It explicitly excludes assets, theme
internals, auth tokens, credentials, deployment/sync/recovery records, and any
non-display field.

## 8. Conversation model

Roles: user / assistant / system. Assistant messages carry a `kind`
(`question | edit-plan | applied | error | system | quality`) and small
structured `metadata` used only for follow-up resolution. Bounded to 24
messages (oldest pair trimmed). Follow-ups ("make it shorter", "keep the
headline but change the button", "do the same on the About page") resolve via
`resolveFollowUpTarget` against the bounded tail **plus live editor state**;
every follow-up triggers a fresh plan against the current project — a previous
plan is never reused, so stale plans cannot apply. Clearing starts a new
conversation and touches nothing in project state.

## 9. Plan model & approval flow

Plans are the existing `AiEditPlan` (versioned, stable ids, projectId,
baseRevision, typed operations, warnings). The PlanReview card lists each
change with before→after, risk badges, per-operation checkboxes (high-risk
unchecked by default), and Apply / Cancel / Regenerate. Apply passes the
selected operation set to `applyAiEditPlan`, which re-simulates against the
live project, rejects stale revisions and unknown/broken-dependency ops,
requires explicit confirmation for destructive ops, and commits **one** history
entry. Invalid plans fail safely before any mutation.

## 10. Undo / history integration

There is **no AI-only undo stack**. After apply, the change summary shows
"Done — updated N things" with an Undo button calling `editor.undo()`, the same
Ctrl/⌘+Z history used for manual edits. Single-field quick actions apply via
`updateEditableFieldValue` — also one atomic history entry. The Copilot never
creates history entries for ASK/EXPLAIN responses.

## 11. Quick actions

Context-sensitive actions stay focused: selected element → Rewrite / Make
shorter / Make longer / Improve clarity / Change tone / Fix grammar;
section → Improve / Simplify / Improve mobile layout / Duplicate idea /
Suggest replacement; page → Improve page / Review content / Improve SEO text.
Element actions are single-field and show the proposed value in the
conversation with an explicit Apply before any change.

## 12. Quality assistant integration

`quality-assistant.ts` bridges the deterministic launch-readiness engine
(authoritative) with the Copilot: it explains any finding in plain language,
shows the current score labeled as computed by Buildora's checks, drafts
content for content findings (with a button that opens the relevant settings
dialog), and creates fix plans where plan ops support it (placeholder text,
empty headings, page meta, SEO description). Site-settings findings get honest
drafts + settings-dialog navigation instead of silent changes. After a fix is
applied the readiness report recomputes from the new project state; the
Copilot can re-run it on demand.

## 13. Provider / fallback behavior

The Copilot reuses the existing provider path untouched: Gemini with the
rule-based deterministic fallback and `x-buildora-force-local` for tests.
ASK/EXPLAIN and readiness explanation need no provider at all, so the Copilot
remains useful offline. When fallback logic cannot honestly satisfy a request
it says so — it never fakes an AI response and never claims a change was
applied unless the editor store confirms it.

## 14. Security guarantees

- AI output is untrusted data end-to-end: schema-validated, simulated,
  re-simulated, applied only through canonical validated mutations.
- No eval / new Function / vm / arbitrary JS / HTML execution anywhere; the
  panel renders plan text as React text nodes — no `dangerouslySetInnerHTML`.
- **New hardening:** `AiEditPlanSchema` rejects prototype-pollution keys
  (`__proto__`, `prototype`, `constructor`) and `javascript:` / `data:`(HTML)
  hrefs across all ops, for every provider; the Gemini provider additionally
  scans the **raw** provider payload before zod normalization; the Copilot
  service adds a client-side defense-in-depth scan.
- Context builder excludes secrets/tokens/assets/sync records; bounded context
  (12 KB), bounded conversation (24 msgs), bounded plan size (existing
  100 KB/30 ops).
- Provider errors map to structured user-safe copy — raw provider output,
  keys, and stack traces never reach the client or the conversation.
- Imported/generated content continues through existing safety boundaries.

## 15. Accessibility work

- `Ctrl/⌘+Shift+A` opens the Copilot — registered in the real shortcuts
  registry and the help dialog; input-target guarded.
- Panel is keyboard-accessible with visible focus states, labelled controls,
  `aria-live` status announcements, Escape-to-close consistent with the app,
  and focus returned to the trigger on close (no disappearing focus, no trap).
- No WCAG certification claim is made.

## 16. Performance

- Panel is lazy-loaded; zero Copilot code on the manual-edit path — opening/
  editing/saving works with the provider down.
- Context built only on send; diffs/simulation only on plan receipt.
- Perf marks (existing transient ring, deterministic counts only):
  `copilot_open`, `context_build`, `plan_received`, `plan_validated`,
  `plan_applied`. No external analytics.

## 17. Validation results

Sequential runs after all Phase P10 work:

| Suite | Command | Result |
|---|---|---|
| Unit tests | `npm test` (vitest) | ✅ **3,485 tests** passed (incl. 109 new Copilot tests) |
| Typecheck | `npx tsc --noEmit` | ✅ pass |
| Lint | `npm run lint` | ✅ pass (0 errors, 0 warnings) |
| Build | `npm run build` | ✅ Next.js production build succeeds |
| P10 E2E | `npx playwright test e2e/ai-copilot*.spec.ts --workers=1` | ✅ **9/9 passed** |
| E2E regression | `npm run test:e2e` | ✅ **92/92 passed** |
| Prompt matrix | `npm run test:e2e:matrix` | ✅ passed |
| Fallback isolation | `npm run test:e2e:fallback` | ✅ passed |
| Export build | `npm run test:export-build` | ✅ passed |

**Totals:** 3,485 unit + 92 e2e = **3,577 tests green, 0 failures.**

### 17.1 Issues found & genuinely fixed

- **Provider-error leak.** The generic provider-error catch in
  `copilot-service.ts` surfaced `err.message` into user-facing copy; replaced
  with sanitized beginner copy (no raw provider text anywhere).
- **`__proto__` silently neutralized by zod.** `z.record` rebuild converts an
  own `__proto__` key into a prototype setter, so a post-zod scan can never see
  it. Fixed by scanning the **raw** Gemini payload pre-normalization (and
  kept the schema superRefine for the rule-based path and defense-in-depth).
- **Test fixtures for `__proto__`.** Object-literal `"__proto__":` syntax sets
  the prototype rather than an own key; fixtures now use
  `Object.defineProperty`/`JSON.parse` so the adversarial payloads actually
  exercise the scan.
- **Follow-up resolution gaps.** "homepage" references were not recognized as
  page names, and "same / do the same / similarly" references only honored the
  previous scope without augmenting the instruction. Both fixed in
  `resolveFollowUpTarget`.
- **ASK answerer dead branch.** The CTA-clarity check sat behind the glossary
  short-circuit; reordered so the specific answer wins before glossary lookup.
- **Stale explicit element scope.** If the selected element disappears while
  the panel is open, an explicit element scope was kept; the panel now resets
  a stale element scope back to page/project.
- **Unused `lastPlanContext`** state removed.
- **E2E reload race.** The follow-up persistence check used a magic delay after
  "Saved"; replaced with a deterministic IndexedDB poll for the persisted
  revision so the reload assertion cannot race the debounced autosave write.
- **11 lint warnings** (unused vars/imports in tests + a switch default)
  cleaned; typecheck and lint are fully clean.

---

## 18. Known limitations

- **Conversations are session-only** — closing the tab discards the
  conversation; nothing is persisted per project (deliberate, §2).
- **Element quick actions are single-field** — a selected multi-field change
  goes through the full plan flow instead.
- **E2E uses a deterministic mocked `/api/generate`** per existing conventions;
  live-provider behavior is covered by the existing prompt-matrix and
  fallback suites.
- **Readiness explanations are local/deterministic** — no generative
  long-form critique of a page; the Copilot drafts copy and proposes plans
  rather than free-form site reviews.
- **Provider latency shows as "planning"** with no streaming — responses
  arrive whole.

---

## 19. Genuine Phase P11 candidates only

Documented, deliberately **not started** in P10:

- **Persist conversations per project (bounded)** — the conversation model is
  session-only by design; a bounded per-project store with a clear action
  would let users resume context after reload.
- **Streaming plan drafting** — show plan operations as they are produced,
  with a longer thinking budget for larger edits.
- **Element-level plan operations** — richer per-element ops so quick actions
  scale beyond single registered text fields.
- **On-device conversation memory for repeated styles** ("keep using this
  tone") — currently follow-ups resolve from the bounded tail only.
- Carried forward from P9: `.buildora-template.json` file format, public
  read-only share links, cloud sync for personal templates/recovery
  snapshots, streamed deployment logs, and a second hosting provider.
- Billing, marketplace, multiplayer, and analytics remain explicitly out of
  scope.
