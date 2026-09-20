# Phase P23 — Custom Code (Report)

> **P23 implementation was delivered and merged before this report** (PRs
> #28–#32; commits `111df15`–`35fe795` on `phase-p22-canva-elements`). The
> phase was **formally closed during P24-A** — the repository audit found the
> implementation complete and hardened but missing its architecture/report
> documents, dedicated E2E coverage, and the consolidated security review.
> P24-A added exactly those (docs + E2E + final validation) and changed **no
> P23 product code**.

---

## 1. Executive summary

P23 delivered **safe, sandboxed, opt-in custom code** (HTML/CSS/JS + safe
attributes) for Buildora element trees. The implementation is complete and
hardened:

- custom code is **inert data** in the document model, validated and
  size-capped at every boundary;
- it **executes only inside a sandboxed iframe** (`allow-scripts` only, CSP-first
  srcdoc) in the opt-in authoring preview and the exported published site;
- the editor canvas, visitor preview, share views, and thumbnails render an
  inert placeholder;
- distribution surfaces (share / templates / My Blocks) strip custom code;
- the exported site receives the code only as validated, escaped srcdoc data.

The phase was formally closed during **P24-A (P23 Closeout & Consolidation)**:

1. `docs/phase-p23-architecture.md` — the design record (written from the
   shipped implementation).
2. `docs/phase-p23-report.md` — this document.
3. `e2e/custom-code-authoring.spec.ts` + `e2e/custom-code-export.spec.ts` —
   dedicated E2E coverage.
4. Full validation (unit, E2E, matrix, fallback, export-build, typecheck,
   lint) — all green (§7).

## 2. Sub-phase history

Reconstructed from the actual commits and source comments. **There is no
P23-L (or later) implementation work** — the final merged commit is the P23-K
preview-polish PR (#32).

| Sub-phase | Commits | Delivered |
|---|---|---|
| **P23-A** — sandboxed custom-code support (initial) | `111df15` (PR #28) | Element `customCode` field + schema caps; first sandbox foundation. |
| **P23-B** — runtime foundation | code comments "Phase P23-B" | `constants.ts`, `sandbox-policy.ts`, `srcdoc.ts` (document builder + CSP + neutralization), `message-protocol.ts`, `heartbeat.ts` — pure, framework-independent modules. |
| **P23-C** — export | code comments "Phase P23-C" | `page-generator.ts` srcdocs map + flag-only tree; `custom-block-generator.ts` `CustomCodeFrame`; `custom-block-p23c-export.test.ts`. |
| **P23-D** — authoring + editor surface | code comments "Phase P23-D" | `CustomCodeField` (opt-in confirmation, warning, per-field + aggregate caps), `CUSTOM_CODE_LEAF_TYPES` registry gating, `BlockRenderer` inert placeholder. |
| **P23-E** — distribution hardening | `9539a5f`–`658855e` (PR #29) | `strip-custom-code.ts` + share/template/My Blocks stripping + tests. |
| **P23-F** — attributes | `3c4445b` (PR #30) | `attribute-validation.ts` + `CustomCodeField` attribute rows. |
| **P23-G** — runtime resilience | `4e8986a` (PR #31) | `runtime.ts` controller + heartbeat integration + bounded recovery; export mirror. |
| **P23-H** — runtime diagnostics | `0a22c3b`, `f1f1e0d` (PR #31) | `diagnostics.ts` + safe read-only `snapshot()`; runtime isolation hardening. |
| **P23-I** — height coalescing | constants `HEIGHT_COALESCE_MS` | Bounded height-write window in editor runtime + export mirror. |
| **P23-J** — authoring preview | `40b10c7` (PR #32) | `CustomCodePreview` — opt-in sandboxed preview (same policy as export). |
| **P23-K** — preview polish | `bcc56c5`, `c8227a5` (PR #32) | Coalesced preview error/height updates + tests. |
| **P23-L** | — | **None.** Closeout (this document + E2E + review) was executed as P24-A. |

## 3. Files / features delivered

See `docs/phase-p23-architecture.md` §2 for the full surface. Highlights:

- `src/features/elements/custom-code/` — `constants.ts`, `sandbox-policy.ts`,
  `srcdoc.ts`, `message-protocol.ts`, `heartbeat.ts`, `diagnostics.ts`,
  `runtime.ts`, `attribute-validation.ts`, `index.ts` (+ tests).
- `src/features/elements/schemas/element-schemas.ts` — `ElementCustomCodeSchema`
  with caps.
- `src/features/elements/registry/element-registry.ts` —
  `CUSTOM_CODE_LEAF_TYPES` + `elementSupportsCustomCode`.
- `src/features/inspector/components/controls/{CustomCodeField,CustomCodePreview}.tsx`.
- `src/features/blocks/render/BlockRenderer.tsx` — inert placeholder.
- `src/features/export/generators/{page-generator,custom-block-generator}.ts`.
- `src/features/code-import/services/strip-custom-code.ts` + share/template/
  My Blocks wiring.

No new dependencies: `package.json` is unchanged at P23 HEAD.

## 4. Security review (consolidated, P24-A)

Reviewed against the actual source. Classifications: **PASS** (implemented and
tested), **DOCUMENTED / OUT OF SCOPE**, **FOLLOW-UP**.

| Area | Verdict | Notes |
|---|---|---|
| Sandbox policy — `allow-scripts` ONLY | **PASS** | `sandbox-policy.ts`; throwing `buildSandboxPolicy`; forbidden capabilities enumerated (`allow-same-origin`, popups, forms, top-navigation, modals, downloads, pointer-lock, presentation, storage-access). Opaque origin. |
| CSP inside sandbox document | **PASS** | First-meta CSP; `connect-src 'none'`, `form-action 'none'`, `base-uri 'none'`, no `unsafe-eval`. |
| `frame-ancestors 'none'` delivery | **DOCUMENTED** | Chromium ignores `frame-ancestors` in `<meta>` (console advisory observed in E2E). Actual anti-framing = srcdoc-only delivery + parent `sandbox` attribute. Directive kept as defense-in-depth. |
| HTML neutralization | **PASS** | `<script`/`<style` (open+close) and `</head|body|html>` → `&lt;`; `</script`/`</style` → `<\/…`. |
| Attribute validation | **PASS** | Name grammar, `on*`/`style`/`srcdoc` rejected, `javascript:` values rejected, caps at authoring and emission. |
| Payload size limits | **PASS** | Per-field 20,000 / aggregate 48,000 / attribute caps; re-clamped at emission. |
| Runtime source validation | **PASS** | `event.source === current contentWindow` (read fresh per message). |
| Message validation | **PASS** | Exact allow-listed shapes; unknown/malformed rejected; capped error/height values. |
| Disposed-runtime isolation | **PASS** | Idempotent dispose; disposed instances reject everything; keyed remounts. |
| No execution outside the sandbox | **PASS** | Editor/visitor/share/thumbnail = inert placeholder (`BlockRenderer.tsx`); execution only in opt-in preview iframe and exported iframe. |
| Distribution sanitization | **PASS** | Share/templates/My Blocks strip; export flag-only tree + `\u003c`-escaped srcdocs; no literal script/style in parent page. |
| No exec mechanisms in generated code | **PASS** | No `eval(`, `new Function`, `dangerouslySetInnerHTML` (unit + E2E asserted). |
| App-level HTTP CSP on the editor app | **DOCUMENTED / OUT OF SCOPE** | P20 §10 P2 item; unrelated to the sandbox CSP. |
| Broader authoring surface (any element) | **FOLLOW-UP** | P24 — requires durable universal element trees. |

**No vulnerabilities manufactured; no P23 security boundary requires a code
change.**

## 5. Distribution review (P24-A verification)

Verified by the dedicated unit suites (all green in P24-A):

- **Share:** `custom-code-p23e-share.test.ts` — node-level `customCode` is
  absent from the public projection; the original node still carries it.
- **Templates:** `custom-code-p23e-template.test.ts` — template-created
  projects strip `customCode`.
- **My Blocks:** `custom-code-p23e-my-blocks.test.ts` — reusable-block saves
  strip `customCode`.
- **Export:** `custom-block-p23c-export.test.ts` + the new
  `e2e/custom-code-export.spec.ts` — the exported page carries the flag-only
  tree plus `\u003c`-escaped srcdocs; no raw code text in the parent page.

## 6. Export review (P24-A verification)

- **Unit:** `custom-block-p23c-export.test.ts` — enabled code → exactly one
  srcdoc entry via the authoritative builder; disabled/malformed → none;
  generated component has `allow-scripts` only, no `allow-same-origin`, no
  eval/Function/innerHTML; parent page has no literal `<script`/`<style`.
- **E2E (new):** `e2e/custom-code-export.spec.ts` — real project with enabled
  custom code exported through the existing `export-site-button` ZIP flow; the
  generated `custom-block.tsx` carries `CUSTOM_CODE_SANDBOX = "allow-scripts"`,
  `srcDoc`, heartbeat/message constants, status wiring; the generated page
  carries `srcdocs={{"head":…}}` with CSP + user code escaped, the tree reduced
  to `"customCode":{"enabled":true}`, and no literal script/style markup.
- **Export-build gate:** `npm run test:export-build` — real
  `npm install && npm run build` of a generated site — **PASS**.

## 7. Validation (P24-A execution — exact results)

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | ✅ **PASS** — exit 0 (clean; no stale `.next` artifact) |
| Lint | `npx eslint .` | ✅ **PASS** — 0 errors, 1 pre-existing warning (`e2e/ai-element-editing.spec.ts:310` `reviewAndApply`, untouched) |
| Full unit | `npm test` | ✅ **PASS** — 368 files / **5143** tests |
| Custom-code unit/component (targeted) | `npx vitest run …custom-code…` | ✅ **PASS** — 19 files / 371 tests |
| Authoring E2E (new) | `npx playwright test e2e/custom-code-authoring.spec.ts` | ✅ **PASS** — 2/2 |
| Export E2E (new) | `npx playwright test e2e/custom-code-export.spec.ts` | ✅ **PASS** — 1/1 |
| E2E matrix | `npm run test:e2e:matrix` | ✅ **PASS** — 14/14 (11-prompt matrix 11/11) |
| E2E fallback | `npm run test:e2e:fallback` | ✅ **PASS** — 1/1 |
| Export build | `npm run test:export-build` | ✅ **PASS** — 1/1 (real build of generated site, 91.7s) |
| Full E2E regression | batched `npx playwright test` (workers=1, all 66 non-prompt/fallback specs) | ✅ **PASS** — 160 executions: 159 in-batch; the single failure (`realtime-collaboration.spec.ts:41`, presence-indicator timeout) is the documented pre-existing flake family — **isolated rerun 1/1 passed** |
| Diff hygiene | `git diff --check` | ✅ **PASS** — exit 0 |
| Worktree | `git status --short` | only the 4 intended P24-A files (2 docs + 2 specs) |

## 8. Known limitations

- **Authoring scope:** custom-code authoring is restricted to the curated leaf
  blocks (`heading`, `paragraph`, `button`, `badge`, `image`, `video`, `icon`)
  inside `custom-block` sections — the durable element-tree surface of P22.
  Broader authoring (any element, any section) is **P24** work once durable
  universal element trees exist. This is the architectural limitation the
  phase brief anticipated; it is preserved, not widened.
- **`frame-ancestors` via `<meta>`** is ignored by Chromium (console advisory);
  the real anti-framing property is srcdoc-only delivery + the parent `sandbox`
  attribute (§4).
- **Editor surfaces never execute custom code** — the sandboxed authoring
  preview is the only in-editor execution point, and it is explicit opt-in.
- **No runtime-fetch/dynamic export**; the exported site is static (P22-J
  D-J4 decision) and custom code runs client-side inside the sandboxed iframe.
- **No live Supabase verification** for the data-integration path (P22-J
  known limitation, unchanged).

## 9. Git / worktree state

- Branch: `phase-p22-canva-elements` (unchanged; P24-A made **no commits**).
- HEAD: `35fe795` (P23-K merge) — unchanged.
- Working tree before P24-A: clean. After P24-A: 4 untracked files —
  `docs/phase-p23-architecture.md`, `docs/phase-p23-report.md`,
  `e2e/custom-code-authoring.spec.ts`, `e2e/custom-code-export.spec.ts`.
- `git diff --check`: clean. No commits, no pushes, no branch created, no
  merge into master (per P24-A instructions).

## 10. P23 completion status

**P23 — COMPLETE (formally closed during P24-A).**

- Implementation: complete and hardened (commits `111df15`–`35fe795`).
- Architecture document: `docs/phase-p23-architecture.md` ✅
- Report + consolidated security review: this document ✅
- Dedicated E2E coverage: `custom-code-authoring` (2) + `custom-code-export`
  (1) ✅
- Full validation: typecheck, lint, 5143 unit tests, targeted 371 custom-code
  tests, full E2E regression (160 executions, 1 documented flake green in
  isolation), matrix 14/14, fallback 1/1, export-build 1/1, `git diff --check`
  — **all green** ✅
- No P23 product code was modified during closeout; no P23-L implementation
  exists or was invented.
