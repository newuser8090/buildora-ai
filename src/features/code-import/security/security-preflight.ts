// ---------------------------------------------------------------------------
// Security preflight (Phase P1)
//
// Scans raw source TEXT for obvious high-risk constructs before parsing.
// Advisory only — normalization is the enforcement boundary. Findings are
// deterministic: patterns run in fixed order and each match reports its
// 1-based line/column and 0-based offset.
// ---------------------------------------------------------------------------

import {
  FINDING_DANGEROUS_HTML,
  FINDING_DANGEROUS_KEY,
  FINDING_DOCUMENT_WRITE,
  FINDING_DYNAMIC_IMPORT,
  FINDING_EVAL,
  FINDING_EVENT_HANDLER_REMOVED,
  FINDING_EXTERNAL_IMPORT_IGNORED,
  FINDING_FUNCTION_CONSTRUCTOR,
  FINDING_HOOK_UNSUPPORTED,
  FINDING_IFRAME_REMOVED,
  FINDING_NETWORK_CALL,
  FINDING_OBJECT_EMBED_REMOVED,
  FINDING_RAW_SCRIPT,
  FINDING_REQUIRE,
  FINDING_UNSAFE_URL,
  FINDING_WINDOW_LOCATION,
} from "../constants";
import type {
  CodeImportSecurityFinding,
  ImportSourceLocation,
} from "../types";

interface PreflightPattern {
  code: string;
  severity: "info" | "warning";
  message: string;
  regex: RegExp;
}

const PATTERNS: readonly PreflightPattern[] = [
  {
    code: FINDING_EVAL,
    severity: "warning",
    message: "eval( usage detected",
    regex: /\beval\s*\(/g,
  },
  {
    code: FINDING_FUNCTION_CONSTRUCTOR,
    severity: "warning",
    message: "Function constructor detected",
    regex: /\bnew\s+Function\s*\(|\bFunction\s*\(/g,
  },
  {
    code: FINDING_RAW_SCRIPT,
    severity: "warning",
    message: "<script> element detected",
    regex: /<script[\s>]/gi,
  },
  {
    code: FINDING_UNSAFE_URL,
    severity: "warning",
    message: "javascript: URL detected",
    // Dotted character classes catch control-character obfuscation such as
    // "java\nscript:" and "java\tscript:".
    regex: /j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t\s*:/gi,
  },
  {
    code: FINDING_UNSAFE_URL,
    severity: "warning",
    message: "vbscript: URL detected",
    regex: /v\s*b\s*s\s*c\s*r\s*i\s*p\s*t\s*:/gi,
  },
  {
    code: FINDING_DANGEROUS_HTML,
    severity: "warning",
    message: "dangerouslySetInnerHTML detected",
    regex: /dangerouslySetInnerHTML/g,
  },
  {
    code: FINDING_DOCUMENT_WRITE,
    severity: "warning",
    message: "document.write( detected",
    regex: /document\.write\s*\(/g,
  },
  {
    code: FINDING_WINDOW_LOCATION,
    severity: "warning",
    message: "window.location mutation detected",
    regex: /window\.location\s*(?:=|\.)/g,
  },
  {
    code: FINDING_DYNAMIC_IMPORT,
    severity: "warning",
    message: "dynamic import( detected",
    regex: /\bimport\s*\(\s*["'`]/g,
  },
  {
    code: FINDING_REQUIRE,
    severity: "warning",
    message: "require( detected",
    regex: /\brequire\s*\(/g,
  },
  {
    code: FINDING_EXTERNAL_IMPORT_IGNORED,
    severity: "info",
    message: "external import statement detected (ignored in P1)",
    regex: /^\s*import\s+(?:[^'"]*?\s+from\s+)?["'][^"']+["']\s*;?/gm,
  },
  {
    code: FINDING_HOOK_UNSUPPORTED,
    severity: "info",
    message: "React hook usage detected (unsupported in P1)",
    regex:
      /\buse(?:State|Effect|Ref|Memo|Callback|Context|Reducer|LayoutEffect|ImperativeHandle|DeferredValue|Transition|Id|SyncExternalStore)\s*\(/g,
  },
  {
    code: FINDING_EVENT_HANDLER_REMOVED,
    severity: "warning",
    message: "event handler attribute detected",
    regex: /\son\w+\s*=\s*["']/gi,
  },
  {
    code: FINDING_IFRAME_REMOVED,
    severity: "warning",
    message: "<iframe> element detected",
    regex: /<iframe[\s>]/gi,
  },
  {
    code: FINDING_OBJECT_EMBED_REMOVED,
    severity: "warning",
    message: "<object>/<embed> element detected",
    regex: /<(?:object|embed)[\s>]/gi,
  },
  {
    code: FINDING_DANGEROUS_KEY,
    severity: "warning",
    message: "prototype-pollution key syntax detected",
    regex: /["']?(?:__proto__|prototype|constructor)["']?\s*:/g,
  },
  {
    code: FINDING_NETWORK_CALL,
    severity: "warning",
    message: "network call detected (fetch/XHR/WebSocket)",
    regex: /\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket\s*\(/g,
  },
];

function locationForMatch(source: string, index: number): ImportSourceLocation {
  let line = 1;
  let lastNewline = -1;
  for (let i = 0; i < index; i += 1) {
    if (source.charCodeAt(i) === 10) {
      line += 1;
      lastNewline = i;
    }
  }
  return {
    startLine: line,
    startColumn: index - lastNewline,
    startOffset: index,
  };
}

/**
 * Scan raw source text for high-risk constructs. Deterministic ordering:
 * patterns run in declaration order, matches in source order.
 */
export function scanSourceForSecurityRisks(
  source: string,
): CodeImportSecurityFinding[] {
  const findings: CodeImportSecurityFinding[] = [];
  for (const pattern of PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(source)) !== null) {
      findings.push({
        code: pattern.code,
        severity: pattern.severity,
        message: pattern.message,
        sourceLocation: locationForMatch(source, match.index),
      });
      if (pattern.regex.lastIndex === match.index) {
        pattern.regex.lastIndex += 1; // never loop forever on zero-width matches
      }
    }
  }
  return findings;
}
