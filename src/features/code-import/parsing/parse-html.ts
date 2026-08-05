// ---------------------------------------------------------------------------
// HTML parsing (Phase P1)
//
// Uses parse5 — a WHATWG-spec-compliant, pure-JS HTML parser with NO DOM and
// NO execution. It parses to plain data structures, recovers from incomplete
// fragments, and reports source locations. Server-safe: no innerHTML, no
// document object. Normalization (not this module) enforces security policy.
// ---------------------------------------------------------------------------

import { parse, parseFragment } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";

export type HtmlParsedRoot =
  | DefaultTreeAdapterMap["document"]
  | DefaultTreeAdapterMap["documentFragment"];

export interface HtmlParseResult {
  root: HtmlParsedRoot;
  isFullDocument: boolean;
}

/**
 * Parse a source string as HTML. Full documents (<!doctype html> or <html>)
 * use the document parser; everything else uses the fragment parser so no
 * html/head/body wrappers are fabricated. parse5 recovers from malformed and
 * incomplete input instead of throwing.
 */
export function parseHtmlSource(source: string): HtmlParseResult {
  const isFullDocument =
    /^\s*<!doctype/i.test(source) || /<html[\s>]/i.test(source);

  const root = isFullDocument
    ? parse(source, { sourceCodeLocationInfo: true })
    : parseFragment(source, { sourceCodeLocationInfo: true });

  return { root, isFullDocument };
}
