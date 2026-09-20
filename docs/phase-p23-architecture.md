# Phase P23 — Custom Code: Architecture

Branch: `phase-p22-canva-elements` (P23 landed via PRs #28–#32; commits `111df15`–`35fe795`)
Status: **Design/architecture record — written during P24-A closeout from the shipped implementation.** The implementation described here was delivered and merged before this document; this record captures the design as built.

---

## 1. P23 objective

Add **safe, sandboxed, opt-in custom code** (HTML/CSS/JS + safe attributes) to
Buildora element trees. Custom code is stored as **inert data** in the document
model, validated and size-capped at every boundary, and **executes only inside
a sandboxed iframe** — in the opt-in authoring preview and in the exported
published site. It never executes in the editor canvas, visitor preview, share
views, thumbnails, or any other editor surface.

The phase was deliberately bounded: custom-code authoring is granted only to a
curated set of leaf content blocks inside `custom-block` sections (the durable
element-tree surface of P22). Broader authoring is a later-phase concern
(P24) once durable universal element trees exist.

## 2. Scope

Shipped surface (all under `src/features/elements/custom-code/` unless noted):

- custom-code data model + Zod validation + caps (`schemas/element-schemas.ts`)
- HTML/CSS/JS authoring + safe attribute authoring (`inspector/components/controls/CustomCodeField.tsx`, `attribute-validation.ts`)
- sandbox document builder — CSP + HTML neutralization + child runtime shell (`srcdoc.ts`)
- sandbox capability policy (`sandbox-policy.ts`)
- parent-side runtime controller — lifecycle, heartbeat, recovery, diagnostics (`runtime.ts`, `heartbeat.ts`, `diagnostics.ts`, `message-protocol.ts`)
- editor placeholder surface (`blocks/render/BlockRenderer.tsx`)
- sandboxed authoring preview with coalesced updates (`inspector/components/controls/CustomCodePreview.tsx`)
- export: srcdoc generation + flag-only tree reduction (`export/generators/page-generator.ts`, `export/generators/section-generators/custom-block-generator.ts`)
- distribution sanitization — share / templates / My Blocks (`code-import/services/strip-custom-code.ts`)
- unit/component tests for every module

## 3. Data model

```ts
// src/features/elements/types.ts — ElementNode
interface ElementNode {
  // ... existing identity/structure/content/style/responsive fields ...
  customCode?: ElementCustomCode;   // Phase P23 — data only, NEVER executed here
}

// ElementCustomCode (defined alongside ElementCustomCodeSchema in
// src/features/elements/schemas/element-schemas.ts)
{
  css?: string;          // ≤ ELEMENT_MAX_CUSTOM_CODE_LENGTH (20,000)
  js?: string;           // ≤ 20,000
  html?: string;         // ≤ 20,000
  attributes?: Record<string, string>;  // ≤ ELEMENT_MAX_ATTRIBUTES entries
  enabled?: boolean;     // defaults false — the ONLY runtime opt-in
}
```

Validation / caps (verified in source):

| Boundary | Behavior |
|---|---|
| Authoring schema | `ElementCustomCodeSchema` (Zod): per-field string caps (20,000), attribute entry cap, `enabled` boolean. Legacy payloads without `enabled` parse with `enabled: false` (never executed). |
| Aggregate cap | `html + css + js` ≤ `ELEMENT_MAX_CUSTOM_CODE_TOTAL` (48,000) — enforced live in the authoring UI and re-enforced at srcdoc emission. |
| Ops engine | `updateElementCustomCode` (`elements/engine/element-operations.ts`) re-parses through the schema; malformed payloads are rejected (the node keeps its previous value); `null` removes `customCode` entirely. |
| Normalizer | `element-normalizer.ts` walks the payload and preserves only valid `customCode` (prototype-pollution keys already stripped by the shared walker). |
| Emission | `srcdoc.ts` re-clamps per-field and aggregate deterministically (html kept whole → css → js trimmed last) — the builder never trusts its input. |
| Attributes | `attribute-validation.ts`: name grammar `^[a-zA-Z][a-zA-Z0-9:_-]*$`, reserved names rejected, event-handler (`on*`) and shell attributes (`style`, `srcdoc`) rejected, `javascript:` values rejected, name ≤ `MAX_ATTRIBUTE_NAME_LENGTH`, value ≤ 2048. Re-validated at emission (`srcdoc.ts`). |

Removal commits `null` (deletes `customCode` from the node entirely).

## 4. Sandbox architecture

### 4.1 Capability policy — `allow-scripts` ONLY

`sandbox-policy.ts` is the single authoritative capability model:

```ts
export const ALLOWED_SANDBOX_CAPABILITIES = ["allow-scripts"] as const;
export const SANDBOX_POLICY = "allow-scripts";
```

- **Forbidden capabilities are enumerated explicitly** (`allow-same-origin`,
  `allow-top-navigation*`, `allow-popups*`, `allow-forms`, `allow-downloads`,
  `allow-modals`, `allow-pointer-lock`, `allow-presentation`,
  `allow-storage-access-by-user-activation`).
- The only way to obtain a policy string is `buildSandboxPolicy(...)`, which
  **throws** on any capability outside the allow-list and on a missing
  `allow-scripts`. A capability can never slip in as a free-form string.
- The iframe therefore has an **opaque origin** (no `allow-same-origin`): no
  access to the parent document, cookies, storage, or any credentialed
  context, and `event.source` (not `event.origin`) is the identity check.

### 4.2 CSP (inside the sandbox document)

`srcdoc.ts` emits the approved CSP as the **first meta CSP** in the `<head>`
(browsers apply the first CSP declared, so user content can never replace it):

```
default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';
img-src data: https:; font-src data: https:; connect-src 'none';
frame-ancestors 'none'; form-action 'none'; base-uri 'none'
```

- `connect-src 'none'` — no network from inside the sandbox.
- `form-action 'none'` — no form submission.
- `base-uri 'none'` — no base-tag redirection.
- No `unsafe-eval` — user code is inline in the same document; nothing else
  executes.

**Documented browser note (verified during P24-A E2E):** Chromium logs a
console advisory that `frame-ancestors` is ignored when delivered via a
`<meta>` element (it is only honored from HTTP headers). The actual
anti-framing property of the sandbox document is its **srcdoc-only delivery**
(the document string exists only inside the parent iframe) plus the parent
`sandbox` attribute. The directive remains as defense-in-depth.

### 4.3 HTML neutralization (`srcdoc.ts`)

User content is embedded in a fixed shell document:

- User JS is one inline `<script>`; every `</script` is escaped to
  `<\/script` (a valid JS escape — semantics preserved; the block cannot be
  closed and markup injected).
- User CSS is one inline `<style>`; every `</style` is escaped the same way.
- User HTML is a body fragment; `<script>`/`<style>` **opening or closing**
  tags and document-level closers `</head|body|html>` are neutralized to
  `&lt;` entities — the fragment can never create a script/style element or
  close the shell document early.
- The payload is re-clamped at emission (defense in depth).
- `enabled !== true` produces **no runtime payload at all** (`null`).

## 5. Runtime architecture

`runtime.ts` — one controller owns one mounted iframe. Hard invariant:

> A disposed/replaced runtime can never affect the active runtime.

- **Lifecycle states:** `idle → mounting → ready ⇄ unresponsive → recovering → disposed` (terminal).
- **Message validation** (`message-protocol.ts`): only three message types exist — `buildora:ready`, `buildora:height`, `buildora:error`. Each payload has an **exact allow-listed shape** (exact key set, bounded/capped values); unknown types, extra fields, and malformed values are rejected before they touch runtime state.
- **Source identity:** every message must come from the **current** `contentWindow` (read fresh per message, so a replaced frame's old window can never match). Origin checks are meaningless for an opaque-origin sandbox.
- **Heartbeat** (`heartbeat.ts`): one timer per instance — `intervalMs: 3000`, `timeoutMs: 2000`, `maxMisses: 2` — declares a silent frame `unresponsive`.
- **Bounded recovery:** a frame may recover a **finite** number of times (`MAX_RECOVERY_ATTEMPTS = 2`), then it is dead (timers stopped, messages ignored). Recovery is message-driven; a second validated message confirms it.
- **Height reports:** capped at `MAX_FRAME_HEIGHT_PX = 10_000` (layout-bomb guard).
- **Error reports:** structured, sanitized data only — `MAX_RUNTIME_ERROR_MESSAGE_LENGTH = 512`, `MAX_RUNTIME_ERROR_STACK_LENGTH = 2_048`; arbitrary exception objects never cross the boundary.
- **Dispose:** idempotent — stops every timer, transitions to `disposed`, rejects every subsequent message.
- **Observers** (`onStateChange`/`onReady`/`onHeight`/`onUnresponsive`/`onError`/`onDiagnostic`) are invoked through a safe wrapper — a throwing observer can never break state transitions, cleanup, or recovery.
- **Diagnostics** (`diagnostics.ts`): typed, sanitized, bounded records (`ready`, `height`, `error`, `unresponsive`, `recovery-started`, `recovery-succeeded`, `recovery-exhausted`, `disposed`); `snapshot()` returns a fresh, frozen, read-only copy with no iframe/window/DOM/exception references.
- **Child-side shell** (`srcdoc.ts` `SANDBOX_RUNTIME_SHELL`): the only child-side channel — reports `ready`/`height` (ResizeObserver)/`error`; pure reporting, ES5, escaped at emission, never reads parent data, never executes user code.

## 6. Authoring preview

`CustomCodePreview.tsx` (P23-J) + `CustomCodeField.tsx` (P23-D/F):

- The Custom Code inspector section exists **only** for element types whose
  registry definition opts in (`elementSupportsCustomCode` →
  `CUSTOM_CODE_LEAF_TYPES = { heading, paragraph, button, badge, image, video,
  icon }`). Containers, composites, interactive/form blocks, navigation, and
  custom-component never see the section.
- **Explicit opt-in:** enabling always requires the confirmation panel with
  the persistent warning (`CUSTOM_CODE_WARNING`). `enabled` defaults `false`;
  typing code never enables anything.
- **Live counters:** per-field 20,000 via `maxLength`; aggregate 48,000
  enforced at commit with a live counter.
- **Attributes editor:** add/edit/remove rows with per-row validation before
  commit; one pending row at a time.
- **Preview (P23-J):** a toggle mounts `CustomCodePreview` **only when
  enabled**. It builds the srcdoc via the single authoritative
  `buildValidatedCustomCodeSrcdoc` and renders an iframe with
  `sandbox="allow-scripts"` (the same policy as the published site), keyed by
  the srcdoc (any payload change remounts a fresh frame and disposes the
  previous runtime). The preview is the **only** editor-surface execution
  point, and it is explicitly opt-in.
- **Coalescing (P23-K):** validated `height` and `error` updates are
  change-detected and coalesced into at most one state write per
  `HEIGHT_COALESCE_MS = 100` window, so a chatty/hostile frame cannot cause
  layout thrashing or unbounded re-renders. The latest value always wins.
  Runtime state/diagnostics remain immediate.
- Observability: the iframe exposes `data-buildora-status` /
  `data-buildora-error` / `data-buildora-height` plus a status label and
  sanitized error line — bounded, sanitized state only.

## 7. Export

- **Editor canvas / visitor preview / share / thumbnails:** a node with
  `customCode?.enabled === true` renders as an **inert placeholder**
  (`block-custom-code-placeholder`, `BlockRenderer.tsx`) that preserves
  selection/click behavior and the node's own styles — it NEVER mounts an
  iframe and NEVER executes the payload.
- **Generated page module** (`page-generator.ts`):
  - the serialized tree reduces every node's `customCode` to `{ enabled: true }`
    (or drops it) — **the parent page never carries the code text**;
  - a separate `srcdocs` prop maps `nodeId → validated srcdoc`, one entry per
    node with **explicitly enabled, schema-valid** code, built exclusively via
    `buildValidatedCustomCodeSrcdoc`;
  - the srcdocs literal escapes every `<` to its `\u003c` JSON escape, so the
    emitted module source contains no literal script/style sequence; JSON
    decoding restores the exact document inside the sandboxed iframe only.
- **Generated component** (`custom-block-generator.ts`): `CustomCodeFrame`
  renders the srcdoc in an iframe with `sandbox={CUSTOM_CODE_SANDBOX}`
  (`"allow-scripts"`), **keyed by the srcdoc** (payload change → remount →
  previous runtime disposed), and embeds a **faithful mirror** of the editor's
  runtime semantics (heartbeat constants, bounded recovery, height
  coalescing, message allow-list, `data-buildora-status/error/height`) —
  exported files must be self-contained, and the editor controller
  (`custom-code/runtime.ts`) is the tested reference. Without a matching
  srcdoc entry, a node renders exactly as before (data alone never executes).
- **No eval / new Function / dangerouslySetInnerHTML** in any generated code.

## 8. Distribution security

Custom code must never leak through non-export distribution surfaces:

| Surface | Behavior (verified) |
|---|---|
| **Share projections** | `customCode` stripped from custom-block trees before the public projection is validated/stored (`strip-custom-code.ts`; `sharing/__tests__/custom-code-p23e-share.test.ts`). |
| **Template creation** | node-level `customCode` stripped from template-created projects (`templates/__tests__/custom-code-p23e-template.test.ts`). |
| **My Blocks saves** | `customCode` stripped before a reusable block is validated/stored (`my-blocks/__tests__/custom-code-p23e-my-blocks.test.ts`). |
| **Export** | code travels ONLY as validated srcdoc data (flag-only tree); this is the intended vehicle. |
| **Enabled-flag preservation** | the opt-in flag survives schema parsing (`enabled` defaults false for legacy payloads); distribution stripping removes the whole `customCode` field — the flag is never preserved where code is stripped. |

`strip-custom-code.ts` never mutates its input (deep-clones), and strips only
from `custom-block` trees.

## 9. Security review (architecture-level)

Verified against the actual source (each item is implemented):

- **CSP:** first-meta, `connect-src 'none'`, `form-action 'none'`,
  `base-uri 'none'`, no `unsafe-eval`. (Browser advisory: `frame-ancestors`
  via meta is ignored — anti-framing is srcdoc-only delivery + parent sandbox.)
- **Sandbox:** `allow-scripts` only; forbidden capabilities enumerated and
  rejected by the throwing policy builder.
- **HTML neutralization:** script/style open+close and document closers
  neutralized; `</script`/`</style` escaped.
- **Attribute validation:** name grammar, forbidden names (`on*`, `style`,
  `srcdoc`), `javascript:` value rejection, length caps.
- **Payload size limits:** per-field 20,000, aggregate 48,000, attributes
  bounded, re-clamped at emission.
- **Runtime source validation:** `event.source === current contentWindow`.
- **Message validation:** allow-listed exact payload shapes; unknown/malformed
  rejected; capped error/height values.
- **Disposed-runtime isolation:** idempotent dispose; disposed instances
  reject all messages and stop all timers.
- **Distribution sanitization:** share/template/My Blocks strip; export
  flag-only tree + escaped srcdocs.
- **No execution outside the sandbox:** editor canvas/visitor preview/share
  render an inert placeholder; the only execution points are the opt-in
  authoring preview iframe and the exported site iframe — both with the same
  policy.

## 10. Non-goals / later work

- Custom-code authoring is scoped to the curated leaf blocks inside
  `custom-block` sections (the durable element-tree surface). Broader
  authoring (any element, any section) requires durable universal element
  trees — **P24**.
- No new interaction kinds; no dynamic/runtime-fetch export; no forms
  integration.
- No dependency changes (`package.json` zero diff at P23 HEAD).
