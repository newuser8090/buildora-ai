# Phase P18 — Production Readiness & Operational Reliability: Report

Branch: `phase-p18-production-readiness`
Status: **COMPLETE**

---

## 1. Starting baseline

P18 began from the clean `phase-p18-production-readiness` branch, cut from master
after P17 was merged. Baseline validated by the P17 report:

| Gate | P17 baseline |
| --- | --- |
| TypeScript (`tsc --noEmit`) | PASS |
| Lint (`eslint .`) | PASS |
| Unit tests | 3916/3916 |
| Production build | PASS |
| Collaboration E2E | 10/10 |
| Full E2E | 117/117 |
| E2E matrix | 13/13 |
| E2E fallback | 1/1 |
| Export build | 1/1 |
| Security re-review | PASS |

P18 made **no changes to the CRDT/collaboration architecture, the canonical-state
model, publishing, RLS, or any established security constraint**. Its goal was
operational reliability: making silent failure boundaries diagnosable and closing
a real mock/Supabase behavioral divergence.

---

## 2. Architecture / risk inventory

The full inventory lives in `docs/phase-p18-architecture.md`. The evidence-based
audit covered: production configuration, the Supabase path, failure recovery,
error handling, observability, data durability, migration safety, performance and
resource safety, security, and production E2E failure scenarios.

**Key audit conclusions (no change made):**

- **Mock/Supabase transports are already cleanly separated** by the transport
  factory (`createCollabTransport`); test controls are exposed only for the mock
  transport in non-production builds, and the Supabase transport never creates
  test controls. No mock behavior can leak into production transport selection.
- **Supabase presence authorization is RPC-gated** (`ws_join_presence`, SECURITY
  DEFINER); presence channels cannot bypass table RLS because presence payloads
  never carry data, and membership is enforced before any `track()`.
- **Migrations** (P15/P16/P17) were audited: SECURITY DEFINER functions set
  `search_path`, use `security definer`, and derive `auth.uid()`; activity types
  and metadata keys are allow-listed; version retention (50/project) bounds
  growth; collab update pruning is checkpoint-frontier-based. No genuine defect
  was found and no migration was modified.
- **Publishing, project recovery, version history, and workspace authorization
  were re-reviewed and found correct** — no genuine production risk in scope
  surfaced that required a change.

---

## 3. F1 — SupabasePresenceProvider heartbeat parity fix

**Current behavior (before):** `SupabasePresenceProvider.heartbeat()` re-tracked a
payload with `projectId: null` and a fresh `joinedAt` on every 10 s heartbeat,
regardless of the scope the user joined with. The mock backend preserves the
session's `projectId` and `joinedAt` across heartbeats.

**Failure / risk:** on the production (Supabase) path, a member who joined a
specific project was dropped from project-scoped presence after the first
heartbeat (their payload's `projectId` silently became `null`), while the same
flow on the mock path (used by E2E) behaved correctly. This is a genuine
mock/Supabase behavioral divergence (architecture Area 2) with a user-visible
failure mode: project-filtered presence (who is editing *this* project) went
stale on the production path.

**Fix:** the joined project scope and first-seen timestamp are now stored on the
channel entry at `join()` and preserved by `heartbeat()` — mock parity. A
heartbeat can no longer wipe the scope the RPC-gated join accepted. The defensive
fallback `entry.joinedAt || new Date().toISOString()` covers an entry that never
saw a successful join.

**Regression coverage:** new `src/features/workspaces/__tests__/supabase-presence-provider.test.ts`
(7 tests, fake-Supabase harness + deterministic fake timers) asserts:

- heartbeat preserves `projectId` and `joinedAt` (mock parity),
- a fresh join records the timestamp; an existing entry preserves it,
- a rejected join (non-member) never creates a channel and never tracks,
- leave clears the entry so a genuine re-join starts a fresh timestamp,
- the join gate is RPC-first (channel created only after the gate passes),
- the defensive `joinedAt` fallback for an entry with no prior join.

**Security implications:** none negative. The join RPC gate runs *before* the
channel entry is created; the fix only preserves what an authorized join already
established. The `projectId` in the payload remains client-claimed (pre-existing,
member-scoped, ephemeral UI state; the editing/viewing *mode* stays
server-resolved). Documented as a known limitation (§10), not a fix — per the
phase rule to document rather than rewrite.

---

## 4. F2 — production-safe diagnostic logging at failure boundaries

**Current behavior (before):** the repo's structured logger (`src/lib/logger.ts`)
existed but was **unused in feature code**. Several production failure
boundaries were completely silent: collab room connect failures, checkpoint
failures, authorization loss while editing, presence join-gate rejections, and
project save/transition failures.

**Failure / risk:** a production incident (auth expiry, RLS break, network loss,
removed member) was invisible to operators — the UI merely flipped status with no
record. The P18 architecture doc (Area 5) requires lightweight structured
diagnostics at exactly these boundaries.

**Fix:** wired the existing logger into the silent boundaries only:

| Boundary | File | Diagnostic |
| --- | --- | --- |
| Collab room connect failure | `collab-session.ts` `start()` | `room connect failed (CODE)` |
| Checkpoint failure | `collab-session.ts` `runCheckpoint()` | `checkpoint failed (CODE)` |
| Checkpoint STALE retry refetch failure | `collab-session.ts` | `checkpoint retry: revision refetch failed (CODE)` |
| Authorization loss while editing | `collab-session.ts` `handleSendFailure()` | `authorization lost while editing (CODE)` — logged once per incident |
| Transport-level auth error | `collab-session.ts` `onAuthError` | `transport authorization error` — deduped |
| Presence join-gate rejection | `supabase-presence-provider.ts` `join()` | `join gate rejected (CODE)` — bounded code only |
| Project save failure | `project-controller.ts` | `project save failed (CODE)` / autosave / transition-blocked |

**Safety properties of the logging design:**

- **Only safe identifiers** are logged: `workspaceId`, `projectId` (UUIDs), and
  bounded, mapped workspace error codes from `toWorkspaceError()`. Never tokens,
  emails, display names, project content, or raw provider messages (the presence
  gate additionally truncates unknown RPC codes to a bounded length).
- **Error codes are embedded in the message string**, not only in the `data`
  object, because the logger drops `data` in production — the code survives
  production redaction, making each diagnostic actionable.
- **Auth-loss logs are deduplicated** via the existing `authLost` flag so a
  single incident produces one record (the transport `onAuthError` and
  `handleSendFailure` can both observe the same auth loss).

**Regression coverage:**

- `collab-session-connect.test.ts` — connect-failure logging assertion (6 tests
  pass).
- `supabase-presence-provider.test.ts` — join-gate rejection logging assertion.
- `project-controller.test.ts` — save-failure logging assertion (47 tests pass
  across the three files).

**Security implications:** no sensitive data can enter logs. The logger drops
`data` in production; the message contains only the bounded mapped code.

---

## 5. E2E harness interaction (runtime audit)

The realtime-permissions spec initially failed after F2: the new intentional
authorization-loss diagnostics are emitted as `console.error`, and the E2E
runtime audit (`e2e/helpers/runtime-audit.ts`) treated every `console.error` as a
failure. The spec deliberately triggers auth loss (downgrade/removal), so the
diagnostics fired by design.

**Fix:** the two intentional diagnostics —
`[collab] authorization lost while editing` and `[collab] transport authorization
error` — were added to the audit's BENIGN_PATTERNS (regex-matched, so the
`(CODE)` suffix cannot defeat the match), exactly as the designed 403/409/404/410
responses already are. The audit still fails on every genuine unexpected error.
This is a test-harness change, not a product behavior change; no assertion was
weakened.

---

## 6. Final security review

A final security re-review was performed on the complete P18 diff (and the wider
surfaces in the audit). **No genuine security findings** requiring a fix were
identified. Confirmed clean:

- **No secrets, tokens, emails, or user data can be logged** (only UUID
  identifiers + bounded mapped error codes; prod drops `data`).
- **Presence authorization unchanged**: join remains RPC-gated and
  server-authoritative; the F1 fix cannot claim presence scope the user did not
  join (heartbeat preserves only the RPC-accepted scope).
- **No RLS / SECURITY DEFINER / authz weakening** anywhere in the diff.
- **No raw provider errors** can reach logs (codes are mapped/truncated).
- **No error-info leakage** to clients — all changed surfaces preserve existing
  user-facing error mapping.

The one acknowledged (non-blocking, member-scoped) parity note — Supabase's
`ws_join_presence` validates workspace membership but not project existence while
the mock additionally validates the project — is pre-existing, carries no
practical exploit (presence is ephemeral self-reported UI state; mode is
server-resolved), and is documented as a known limitation (§10) rather than
"fixed" by weakening anything.

---

## 7. E2E validation

| Gate | Result | Notes |
| --- | --- | --- |
| Affected P18 batch (presence + realtime + workspace) | **9/9 passed** (2.2 m final run) | run repeatedly; final run clean |
| Full `test:e2e` (117 tests, `--workers=1`) | **116 passed / 1 failed** | the 1 failure is a **confirmed pre-existing environmental flake** (§8) |
| `test:e2e:matrix` (prompt matrix) | **13/13 passed** (1.7 m) | report written to `matrix-results/prompt-matrix-report.json` |
| `test:e2e:fallback` | **1/1 passed** (7.4 s) | |
| `test:export-build` | **1/1 passed** (66 s) | real exported build in temp project |

---

## 8. Confirmed environmental / pre-existing flake (with evidence)

**Symptom:** in full-suite runs, one spec failed: `ai-copilot.spec.ts:30`
("opens with the Ctrl+Shift+A shortcut") — the editor loaded fully but the
lazy-loaded CopilotPanel did not appear within the 5 s assertion, because the
Ctrl+Shift+A keypress was swallowed (focus/hydration timing on that load).

**Classification: pre-existing environmental flake — NOT a P18 regression.**
Exact evidence:

1. **Stash A/B (decisive).** The full suite was run three times:

   | Run | P18 changes | Result | Failing spec |
   | --- | --- | --- | --- |
   | #1 | With | 116/1 | ai-copilot:30 |
   | #2 | With | 116/1 | ai-copilot:30 |
   | #3 | **Stashed (without)** | **115/2** | my-blocks + my-blocks-visual-library (ai-copilot **passed**) |

   Without P18, *different* specs fail and ai-copilot passes — the flake identity
   is uncorrelated with the P18 diff. Run #3 was worse than the P18 runs.

2. **No P18 code on the failing path.** The failing test attaches no runtime
   audit and executes none of the P18 changes on its happy path (P18 files on the
   editor load path contain logger calls on *error branches only*). The P18
   diff is logger-only + Supabase-only presence + the audit benign list.

3. **Passes alone.** `ai-copilot.spec.ts` passes **5/5 alone** (15.4 s); the
   identical 14-test ai-copilot family batch passes **14/14**; `realtime-structure`
   (which failed once in a re-run batch) passes **alone**; every spec passes in
   isolation and in the warm affected batch.

4. **Rotating identity.** Failures observed across runs: ai-copilot (with P18),
   my-blocks / my-blocks-visual-library (without P18), realtime-structure (one
   batch) — the failing spec rotates run-to-run, the classic signature of
   dev-server cold-compile / hydration-timing flakiness on this Windows
   webpack-dev setup.

5. **Historical documentation.** P16 report §13 documents the cold-compile /
   first-hit timing flake class on editor routes; P18's failures match it.

**Action taken:** none to product code or assertions. The flake is documented,
the affected spec verified green in isolation and in the warm batch, and all
regression gates (matrix / fallback / export-build / unit / build) are clean.

---

## 9. Full validation totals (final)

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | **PASS** (clean) |
| `npm run lint` | **PASS** (clean) |
| `npm test` (vitest) | **3926/3926 passed** (85 s) — up from 3916 baseline (+10 F1/F2 regression tests) |
| `npm run build` | **PASS** |
| Affected P18 E2E batch | **9/9 passed** |
| `test:e2e` full suite | **116/117** (1 documented pre-existing environmental flake, §8) |
| `test:e2e:matrix` | **13/13 passed** |
| `test:e2e:fallback` | **1/1 passed** |
| `test:export-build` | **1/1 passed** |
| Security re-review (final) | **PASS** — no genuine findings |
| Focused code review (final) | **PASS** — one minor consistency fix applied (checkpoint refetch log now embeds the code in the message, matching all other F2 sites) |

---

## 10. Known limitations

- **Supabase join RPC does not validate project existence** (only workspace
  membership), while the mock also validates the project. Member-scoped, no
  practical exploit; the presence mode is server-resolved and payloads are
  ephemeral UI state. Deliberately documented rather than changed, per the phase
  rule.
- **Full-suite E2E can flake 1 spec** on this dev setup (cold-compile /
  hydration timing). The failing spec rotates between runs and is uncorrelated
  with the P18 diff (stash-proven). Not a product defect.
- **Diagnostics are development/ops-visible via the existing logger** — there is
  no external monitoring sink (none existed; none was added, per the phase rule
  to prefer existing infrastructure).

---

## 11. Deferred work / P19 candidates (NOT started)

These are *candidates only* — **P19 was not started** and no P19 work exists in
this branch:

- Optional: validate project existence in the Supabase `ws_join_presence` RPC
  for full mock parity (needs a Supabase SQL test harness; low priority).
- Optional: an external structured-logging sink (e.g., a log drain) once a
  monitoring platform decision is made — the diagnostics emitted by F2 are ready
  for it.
- Optional: E2E hardening against cold-compile flakes (e.g., pre-warming the
  editor/CopilotPanel routes before the full suite) — an infrastructure, not
  product, change.

---

## 12. Final git state

Working tree contains exactly the intended P18 changes (verified `git status`,
see §13): 6 modified files + 2 new files. **Nothing committed, nothing pushed.**
No P19 work exists.

---

## 13. P18 file inventory

| File | Change |
| --- | --- |
| `src/features/workspaces/providers/supabase-presence-provider.ts` | F1 heartbeat parity fix + F2 join-gate diagnostic |
| `src/features/workspaces/__tests__/supabase-presence-provider.test.ts` | **new** — F1/F2 regression tests (7) |
| `src/features/collaboration/services/collab-session.ts` | F2 diagnostics (connect/checkpoint/auth-loss/refetch) |
| `src/features/collaboration/__tests__/collab-session-connect.test.ts` | F2 logging regression test |
| `src/features/persistence/services/project-controller.ts` | F2 save/transition diagnostics |
| `src/features/persistence/__tests__/project-controller.test.ts` | F2 logging regression test |
| `e2e/helpers/runtime-audit.ts` | intentional-collab-diagnostics benign list |
| `docs/phase-p18-architecture.md` | **new** — P18 architecture document |
| `docs/phase-p18-report.md` | **new** — this report |
