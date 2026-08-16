// ---------------------------------------------------------------------------
// Sandbox document builder (Phase P23-B)
//
// Builds the complete HTML document that will be loaded inside the sandboxed
// iframe (srcdoc) — the ONLY place custom code may execute (wired in a later
// phase; this module only produces the document string).
//
// Security model:
//   - The document carries the approved SANDBOX_CSP as the FIRST meta CSP in
//     the head (browsers apply the first CSP declared), so user content can
//     never replace it.
//   - User JS is embedded in a single inline <script>; every "</script"
//     sequence is escaped to "<\/script" so user code cannot close the block
//     and inject markup. "\/" is a valid JS escape, so code semantics are
//     preserved.
//   - User CSS is embedded in <style> with "</style" escaped the same way.
//   - User HTML is a body fragment; <script>/<style> tags (opening OR
//     closing) are neutralized so the fragment can never create a script/
//     style element or close a shell block — an unclosed tag would otherwise
//     switch the HTML parser into raw-text mode and swallow the generated
//     CSS/JS shell. Document-level closers (</head|body|html) are also
//     neutralized so the shell document cannot be closed early.
//   - Payloads are RE-CLAMPED at emission (defense in depth — the schema is
//     the authoring boundary, the builder never trusts its input): each field
//     to 20,000 and the aggregate html+css+js to 48,000 (html kept whole,
//     then css, then js trimmed from the end — deterministic).
//   - `enabled !== true` produces NO runtime payload (null).
//   - No eval, no new Function, no unsafe-eval: the user's code is inline in
//     its own sandboxed document — nothing else is executed.
//
// Pure, deterministic, framework-independent (no DOM access).
// ---------------------------------------------------------------------------

import type { ElementCustomCode } from "../types";
import { ElementCustomCodeSchema } from "../schemas/element-schemas";
import {
  MAX_CUSTOM_CODE_LENGTH,
  MAX_CUSTOM_CODE_TOTAL,
  MAX_RUNTIME_ERROR_MESSAGE_LENGTH,
  MAX_RUNTIME_ERROR_STACK_LENGTH,
  RUNTIME_MESSAGE_TYPES,
  SANDBOX_CSP,
} from "./constants";

// ---------------------------------------------------------------------------
// Child-side runtime shell (Phase P23-G)
//
// A small, fixed script emitted into EVERY enabled sandbox document. It is
// the ONLY child-side channel: it reports the document load (`ready`), the
// content height (`height`, via a ResizeObserver when available), and
// structured, sanitized runtime errors (`error` — message/stack strings only,
// capped here and re-validated/re-capped by the parent protocol).
//
// Safety properties:
//   - pure reporting — it never reads parent data, never executes user code,
//     and adds no capability to the sandbox
//   - every path is wrapped so a broken report can never break user code
//   - runs in the HEAD (before any user JS) so it can catch synchronous
//     errors from the user's inline script
//   - ES5 only (no transpilation happens inside the frame)
//   - `</script` is escaped at emission like any other inline script
// ---------------------------------------------------------------------------

const SANDBOX_RUNTIME_SHELL = [
  "(function () {",
  "  'use strict';",
  "  function post(type, payload) {",
  "    try {",
  "      var message = { type: type };",
  "      if (payload) {",
  "        for (var key in payload) {",
  "          if (Object.prototype.hasOwnProperty.call(payload, key)) { message[key] = payload[key]; }",
  "        }",
  "      }",
  "      window.parent.postMessage(message, '*');",
  "    } catch (err) { /* a broken report must never break user code */ }",
  "  }",
  "  function cap(value, limit) {",
  "    try { return typeof value === 'string' ? value.slice(0, limit) : ''; } catch (err) { return ''; }",
  "  }",
  "  function reportError(message, stack) {",
  "    var info = { message: cap(message, " + MAX_RUNTIME_ERROR_MESSAGE_LENGTH + ") };",
  "    var cappedStack = cap(stack, " + MAX_RUNTIME_ERROR_STACK_LENGTH + ");",
  "    if (cappedStack.length > 0) { info.stack = cappedStack; }",
  "    post('" + RUNTIME_MESSAGE_TYPES.error + "', { error: info });",
  "  }",
  "  window.addEventListener('error', function (event) {",
  "    var eventError = event && event.error;",
  "    var message = (event && typeof event.message === 'string' && event.message) || 'Runtime error';",
  "    var stack = (eventError && typeof eventError.stack === 'string' && eventError.stack) || '';",
  "    reportError(message, stack);",
  "  });",
  "  window.addEventListener('unhandledrejection', function (event) {",
  "    var reason = event && event.reason;",
  "    var message = (reason && typeof reason.message === 'string' && reason.message) || 'Unhandled promise rejection';",
  "    var stack = (reason && typeof reason.stack === 'string' && reason.stack) || '';",
  "    reportError(message, stack);",
  "  });",
  "  function reportReady() {",
  "    post('" + RUNTIME_MESSAGE_TYPES.ready + "');",
  "    var root = document.getElementById('buildora-root');",
  "    if (!root) { return; }",
  "    function reportHeight() {",
  "      var height = 0;",
  "      try { height = Math.max(0, Math.round(root.getBoundingClientRect().height)); } catch (err) { height = 0; }",
  "      post('" + RUNTIME_MESSAGE_TYPES.height + "', { height: height });",
  "    }",
  "    if (typeof ResizeObserver === 'function') {",
  "      try {",
  "        var observer = new ResizeObserver(function () { reportHeight(); });",
  "        observer.observe(root);",
  "      } catch (err) { /* fall through to the one-shot report */ }",
  "    }",
  "    reportHeight();",
  "  }",
  "  if (document.readyState === 'loading') {",
  "    document.addEventListener('DOMContentLoaded', reportReady);",
  "  } else {",
  "    reportReady();",
  "  }",
  "})();",
].join("\n");

/** Attribute name grammar (HTML attribute names: letter first, then alnum/-_:). */
const ATTR_NAME_RE = /^[a-zA-Z][a-zA-Z0-9:_-]*$/;

/** Event-handler and shell-control attributes never pass through to markup. */
const FORBIDDEN_ATTR_NAMES = new Set(["srcdoc", "style"]);

function clampString(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  return value.length > limit ? value.slice(0, limit) : value;
}

/**
 * Re-clamp the three code fields at emission. Each field is first capped to
 * its per-field limit, then the aggregate is honored deterministically:
 * html is kept whole (structure first), css next, js trimmed last.
 */
function clampPayload(code: ElementCustomCode): { html: string; css: string; js: string } {
  const html = clampString(code.html, MAX_CUSTOM_CODE_LENGTH);
  const css = clampString(code.css, MAX_CUSTOM_CODE_LENGTH);
  const js = clampString(code.js, MAX_CUSTOM_CODE_LENGTH);
  let remaining = MAX_CUSTOM_CODE_TOTAL;
  const take = (value: string): string => {
    const part = value.slice(0, remaining);
    remaining -= part.length;
    return part;
  };
  return { html: take(html), css: take(css), js: take(js) };
}

/** Escape a user JS body so "</script" can never close the inline block. */
function escapeInlineScript(js: string): string {
  return js.replace(/<\/script/gi, "<\\/script");
}

/** Escape a user CSS body so "</style" can never close the inline block. */
function escapeInlineStyle(css: string): string {
  return css.replace(/<\/style/gi, "<\\/style");
}

/**
 * Neutralize tags in the user HTML fragment that could structurally swallow
 * the generated shell:
 *   - <script>/<style> (opening OR closing, case-insensitive) — an unclosed
 *     opening tag in the fragment switches the HTML parser into raw-text
 *     mode, which would consume the shell's runtime blocks and document
 *     closers until a matching closer appears. Neutralizing BOTH directions
 *     guarantees the fragment can never create a script/style element and
 *     can never close a shell block.
 *   - </head|body|html> (document-level closers) — the fragment cannot close
 *     the shell document (or the head) early.
 * All matches are converted to text entities (`&lt;`), so the fragment stays
 * inert markup inside the wrapper div.
 */
function escapeHtmlFragment(html: string): string {
  return html.replace(
    /<\/?(script|style)(?=[\s>/]|$)|<\/(head|body|html)(?=[\s>]|$)/gi,
    (match) => `&lt;${match.slice(1)}`,
  );
}

function escapeAttrValue(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Serialize the validated custom attributes onto the wrapper element.
 * Defense in depth at emission: only well-formed attribute names pass,
 * event handlers and shell controls are dropped, and per-value limits are
 * re-enforced.
 */
function serializeWrapperAttributes(attributes: unknown): string {
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) {
    return "";
  }
  const parts: string[] = [];
  for (const [key, rawValue] of Object.entries(attributes as Record<string, unknown>)) {
    if (!ATTR_NAME_RE.test(key)) continue;
    const lower = key.toLowerCase();
    if (lower.startsWith("on")) continue; // no event handlers on the shell
    if (FORBIDDEN_ATTR_NAMES.has(lower)) continue;
    if (typeof rawValue !== "string") continue;
    const value = rawValue.length > 2048 ? rawValue.slice(0, 2048) : rawValue;
    parts.push(`${key}="${escapeAttrValue(value)}"`);
  }
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

/**
 * Build the sandbox document for a custom-code payload.
 *
 * Returns `null` when custom code is disabled (absent, or `enabled !== true`)
 * — a disabled element produces NO executable runtime payload. When enabled,
 * always returns a complete, bounded shell document.
 */
export function buildCustomCodeDocument(
  code: ElementCustomCode | null | undefined,
): string | null {
  if (!code || code.enabled !== true) return null;

  const { html, css, js } = clampPayload(code);
  const wrapperAttributes = serializeWrapperAttributes(code.attributes);

  const styleBlock = css.length > 0 ? `<style>${escapeInlineStyle(css)}</style>` : "";
  const scriptBlock = js.length > 0 ? `<script>${escapeInlineScript(js)}</script>` : "";
  // The runtime shell is emitted BEFORE any user code (in the head) so it
  // can report ready/height and catch synchronous user-script errors. It is
  // escaped like any inline script (`</script` can never close its block).
  const shellBlock = `<script>${escapeInlineScript(SANDBOX_RUNTIME_SHELL)}</script>`;
  const wrapper = `<div id="buildora-root" data-buildora-custom-code="1"${wrapperAttributes}>${escapeHtmlFragment(html)}</div>`;

  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    styleBlock,
    shellBlock,
    "</head>",
    "<body>",
    wrapper,
    scriptBlock,
    "</body>",
    "</html>",
  ].join("\n");
}

/**
 * The SINGLE authoritative srcdoc construction path for export (Phase P23-C).
 *
 * Stored custom code → schema validation (per-field 20k + aggregate 48k
 * caps) → explicit `enabled === true` check → deterministic clamping/emission
 * via `buildCustomCodeDocument`. Returns the srcdoc string, or null when the
 * payload is absent, disabled, or malformed — disabled/malformed code NEVER
 * produces a runtime document.
 *
 * This is the only entry point generators use; `buildCustomCodeDocument`
 * remains the only document constructor, so there is exactly one path from
 * persisted data to an emitted srcdoc.
 */
export function buildValidatedCustomCodeSrcdoc(code: unknown): string | null {
  if (code === undefined || code === null) return null;
  const parsed = ElementCustomCodeSchema.safeParse(code);
  if (!parsed.success) return null;
  if (parsed.data.enabled !== true) return null;
  return buildCustomCodeDocument(parsed.data);
}
