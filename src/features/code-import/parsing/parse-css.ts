// ---------------------------------------------------------------------------
// CSS parsing (Phase P1)
//
// Uses postcss.parse ONLY — the tokenizer/parser, not the processing
// pipeline. No plugins, no source-map loading (from is undefined and process()
// is never called), no imports resolved, no remote assets fetched, and no
// evaluation of custom properties. Malformed CSS that postcss can recover
// from stays parseable; unbalanced braces throw a structured error.
// ---------------------------------------------------------------------------

import postcss from "postcss";
import type { Root } from "postcss";

import { CODE_PARSE_FAILED } from "../constants";
import { sanitizeParserMessage, throwFatal } from "../errors";
import type { ImportSourceLocation } from "../types";

export interface CssParseResult {
  root: Root;
}

/**
 * Parse a CSS source string. Throws a structured CODE_PARSE_FAILED error on
 * unrecoverable syntax errors. Never applies or executes the CSS.
 */
export function parseCssSource(source: string): CssParseResult {
  let root: Root;
  try {
    root = postcss.parse(source, { from: undefined });
  } catch (err) {
    const e = err as {
      message?: string;
      line?: number;
      column?: number;
    };
    const loc: ImportSourceLocation | undefined = e.line
      ? {
          startLine: e.line,
          startColumn: e.column ?? 1,
          startOffset: 0,
        }
      : undefined;
    throwFatal(
      CODE_PARSE_FAILED,
      `Could not parse CSS source: ${sanitizeParserMessage(e.message ?? "syntax error")}`,
      { sourceLocation: loc },
    );
  }
  return { root };
}
