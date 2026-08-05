// ---------------------------------------------------------------------------
// Shared normalization helpers (Phase P1) — framework-independent
// ---------------------------------------------------------------------------

import type { ImportIdFactory, ImportSourceLocation } from "../types";

// ---------------------------------------------------------------------------
// Deterministic ID factory
// ---------------------------------------------------------------------------

export function createDefaultIdFactory(prefix = "n"): ImportIdFactory {
  let counter = 0;
  return {
    next(requestedPrefix?: string): string {
      counter += 1;
      return `${requestedPrefix ?? prefix}${counter}`;
    },
  };
}

// ---------------------------------------------------------------------------
// Source location mapping
// ---------------------------------------------------------------------------

export interface RawSourceLocation {
  startLine: number;
  startCol: number;
  startOffset: number;
  endLine?: number;
  endCol?: number;
  endOffset?: number;
}

export function toImportSourceLocation(
  raw: RawSourceLocation | undefined | null,
): ImportSourceLocation | undefined {
  if (!raw) return undefined;
  return {
    startLine: raw.startLine,
    startColumn: raw.startCol,
    startOffset: raw.startOffset,
    endLine: raw.endLine,
    endColumn: raw.endCol,
    endOffset: raw.endOffset,
  };
}

// ---------------------------------------------------------------------------
// Paths (deterministic, human-readable)
// ---------------------------------------------------------------------------

export class PathBuilder {
  private readonly stack: string[] = [];

  push(name: string): void {
    this.stack.push(name);
  }

  pop(): void {
    this.stack.pop();
  }

  current(): string {
    return this.stack.length === 0 ? "root" : this.stack.join(" > ");
  }
}

// ---------------------------------------------------------------------------
// Boolean attributes
// ---------------------------------------------------------------------------

const BOOLEAN_ATTRIBUTES: ReadonlySet<string> = new Set([
  "allowfullscreen",
  "async",
  "autofocus",
  "autoplay",
  "checked",
  "controls",
  "default",
  "defer",
  "disabled",
  "formnovalidate",
  "hidden",
  "inert",
  "ismap",
  "itemscope",
  "loop",
  "muted",
  "multiple",
  "nomodule",
  "novalidate",
  "open",
  "playsinline",
  "readonly",
  "required",
  "reversed",
  "selected",
]);

export function isBooleanAttribute(name: string): boolean {
  return BOOLEAN_ATTRIBUTES.has(name.toLowerCase());
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

const EVENT_HANDLERS: ReadonlySet<string> = new Set([
  "onabort", "onafterprint", "onbeforeprint", "onbeforeunload", "onblur",
  "oncanplay", "oncanplaythrough", "onchange", "onclick", "oncontextmenu",
  "oncopy", "oncuechange", "oncut", "ondblclick", "ondrag", "ondragend",
  "ondragenter", "ondragleave", "ondragover", "ondragstart", "ondrop",
  "ondurationchange", "onemptied", "onended", "onerror", "onfocus",
  "onhashchange", "oninput", "oninvalid", "onkeydown", "onkeypress",
  "onkeyup", "onload", "onloadeddata", "onloadedmetadata", "onloadstart",
  "onmessage", "onmousedown", "onmouseenter", "onmouseleave", "onmousemove",
  "onmouseout", "onmouseover", "onmouseup", "onoffline", "ononline",
  "onpagehide", "onpageshow", "onpaste", "onpause", "onplay", "onplaying",
  "onpopstate", "onprogress", "onratechange", "onreset", "onresize",
  "onscroll", "onsearch", "onseeked", "onseeking", "onselect", "onshow",
  "onstalled", "onstorage", "onsubmit", "onsuspend", "ontimeupdate",
  "ontoggle", "onunload", "onvolumechange", "onwaiting", "onwheel",
]);

export function isEventHandlerAttribute(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith("on") && EVENT_HANDLERS.has(lower);
}

// ---------------------------------------------------------------------------
// Inline style parsing
// ---------------------------------------------------------------------------

/**
 * Parse an inline style string into a deterministic string map. Dangerous
 * declarations (expression(, javascript:/vbscript: URLs, behavior, binding)
 * are dropped and reported by the caller via the returned `dropped` array.
 */
export function parseInlineStyle(
  styleText: string,
): { styles: Record<string, string>; dropped: Array<{ property: string; value: string; reason: string }> } {
  const styles: Record<string, string> = {};
  const dropped: Array<{ property: string; value: string; reason: string }> = [];

  for (const rawChunk of styleText.split(";")) {
    const chunk = rawChunk.trim();
    if (chunk.length === 0) continue;
    const colon = chunk.indexOf(":");
    if (colon <= 0) {
      // Malformed declaration (no colon) — ignore silently like browsers do.
      continue;
    }
    const property = chunk.slice(0, colon).trim().toLowerCase();
    const value = chunk.slice(colon + 1).trim();
    if (property.length === 0 || value.length === 0) continue;

    const lowerValue = value.toLowerCase();
    if (
      lowerValue.includes("expression(") ||
      lowerValue.includes("javascript:") ||
      lowerValue.includes("vbscript:") ||
      property === "behavior" ||
      property === "binding"
    ) {
      dropped.push({ property, value, reason: "dangerous-style-declaration" });
      continue;
    }
    styles[property] = value;
  }

  return { styles, dropped };
}

// ---------------------------------------------------------------------------
// URL-ish attributes by kind
// ---------------------------------------------------------------------------

export const LINK_URL_ATTRIBUTES: ReadonlySet<string> = new Set([
  "href", "action", "formaction", "cite", "background",
]);

export const IMAGE_URL_ATTRIBUTES: ReadonlySet<string> = new Set([
  "src", "poster",
]);
