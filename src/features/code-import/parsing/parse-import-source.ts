// ---------------------------------------------------------------------------
// Import source parsing router (Phase P1)
//
// Dispatches a detected language to the matching parser + normalizer. Every
// path yields the same safe normalized output contract. Parsing only — no
// execution, no rendering, no editor interaction.
// ---------------------------------------------------------------------------

import { CODE_LANGUAGE_UNKNOWN } from "../constants";
import { throwFatal } from "../errors";
import type {
  CodeImportNormalizationResult,
  ImportedCodeLanguage,
  ImportIdFactory,
} from "../types";
import { normalizeCssAst } from "../normalization/normalize-css-ast";
import { normalizeHtmlAst } from "../normalization/normalize-html-ast";
import { normalizeJsxAst } from "../normalization/normalize-jsx-ast";
import { parseCssSource } from "./parse-css";
import { parseHtmlSource } from "./parse-html";
import { parseJsxSource } from "./parse-jsx";

export interface ParseImportSourceOptions {
  idFactory?: ImportIdFactory;
}

/**
 * Parse + normalize source for a known language. Throws a structured fatal
 * error for unknown languages or unrecoverable parse failures.
 */
export function parseImportSource(
  source: string,
  language: ImportedCodeLanguage,
  options: ParseImportSourceOptions = {},
): CodeImportNormalizationResult {
  switch (language) {
    case "html": {
      const { root } = parseHtmlSource(source);
      return normalizeHtmlAst(root, { idFactory: options.idFactory });
    }
    case "jsx":
    case "tsx":
    case "react": {
      const parsed = parseJsxSource(source);
      return normalizeJsxAst(parsed, { idFactory: options.idFactory });
    }
    case "css": {
      const { root } = parseCssSource(source);
      return normalizeCssAst(root);
    }
    default:
      throwFatal(
        CODE_LANGUAGE_UNKNOWN,
        `Cannot parse source with unknown language "${language}".`,
      );
  }
}
