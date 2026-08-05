// ---------------------------------------------------------------------------
// Source analysis entry point (Phase P1)
//
// analyseImportSource(source) is the single public P1 API. It:
//   1. validates input (empty, size limits)
//   2. runs the security preflight scan
//   3. detects the language
//   4. parses + normalizes into the safe import AST
//   5. computes stats
//   6. returns a fully deterministic, serializable CodeImportAnalysis
//
// P1 stops here — no BlockTree conversion, no editor writes.
// ---------------------------------------------------------------------------

import {
  CODE_AST_TOO_DEEP,
  CODE_CSS_TOO_LARGE,
  CODE_IMPORT_EMPTY,
  CODE_IMPORT_TOO_LARGE,
  CODE_LANGUAGE_UNKNOWN,
  CODE_PARSE_FAILED,
  CODE_TOO_MANY_NODES,
  MAX_PARSER_ERRORS_RETURNED,
} from "../constants";
import { detectCodeLanguage } from "../detection/detect-code-language";
import { CodeImportFatalError } from "../errors";
import { parseImportSource } from "../parsing/parse-import-source";
import { scanSourceForSecurityRisks } from "../security/security-preflight";
import { checkSourceSize, sourceByteSize } from "../security/source-limits";
import type {
  CodeImportAnalysis,
  CodeImportAnalysisOptions,
  CodeImportError,
  CodeImportSecurityFinding,
  CodeImportSource,
  CodeImportStats,
  CodeImportUnsupportedFeature,
  ImportNode,
} from "../types";

// Errors that mean "no usable safe AST was produced".
const FATAL_ERROR_CODES: ReadonlySet<string> = new Set([
  CODE_IMPORT_EMPTY,
  CODE_IMPORT_TOO_LARGE,
  CODE_LANGUAGE_UNKNOWN,
  CODE_PARSE_FAILED,
  CODE_AST_TOO_DEEP,
  CODE_TOO_MANY_NODES,
  CODE_CSS_TOO_LARGE,
]);

const SEVERITY_RANK: Record<string, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

function emptyAnalysis(): CodeImportAnalysis {
  return {
    detectedLanguage: "unknown",
    confidence: "low",
    sourceSize: 0,
    rootNodes: [],
    cssRules: [],
    syntaxErrors: [],
    securityFindings: [],
    unsupportedFeatures: [],
    stats: {
      nodeCount: 0,
      elementCount: 0,
      textNodeCount: 0,
      attributeCount: 0,
      classTokenCount: 0,
      cssRuleCount: 0,
      cssDeclarationCount: 0,
      maxDepth: 0,
    },
    canContinueToConversion: false,
  };
}

function computeStats(rootNodes: ImportNode[], cssRuleCount: number, cssDeclarationCount: number): CodeImportStats {
  let nodeCount = 0;
  let elementCount = 0;
  let textNodeCount = 0;
  let attributeCount = 0;
  let classTokenCount = 0;
  let maxDepth = 0;

  const walk = (nodes: ImportNode[], depth: number): void => {
    for (const node of nodes) {
      nodeCount += 1;
      maxDepth = Math.max(maxDepth, depth);
      if (node.kind === "element") {
        elementCount += 1;
        attributeCount += Object.keys(node.attributes).length;
        classTokenCount += node.classNames.length;
        walk(node.children, depth + 1);
      } else if (node.kind === "fragment") {
        walk(node.children, depth + 1);
      } else {
        textNodeCount += 1;
      }
    }
  };

  walk(rootNodes, 1);

  return {
    nodeCount,
    elementCount,
    textNodeCount,
    attributeCount,
    classTokenCount,
    cssRuleCount,
    cssDeclarationCount,
    maxDepth,
  };
}

function sortFindings(
  findings: CodeImportSecurityFinding[],
): CodeImportSecurityFinding[] {
  return [...findings].sort((a, b) => {
    const positionA = a.sourceLocation?.startOffset ?? Number.MAX_SAFE_INTEGER;
    const positionB = b.sourceLocation?.startOffset ?? Number.MAX_SAFE_INTEGER;
    if (positionA !== positionB) return positionA - positionB;
    const severityA = SEVERITY_RANK[a.severity] ?? 3;
    const severityB = SEVERITY_RANK[b.severity] ?? 3;
    if (severityA !== severityB) return severityA - severityB;
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    const pathA = a.path ?? "";
    const pathB = b.path ?? "";
    return pathA < pathB ? -1 : pathA > pathB ? 1 : 0;
  });
}

function sortUnsupported(
  items: CodeImportUnsupportedFeature[],
): CodeImportUnsupportedFeature[] {
  return [...items].sort((a, b) => {
    const positionA = a.sourceLocation?.startOffset ?? Number.MAX_SAFE_INTEGER;
    const positionB = b.sourceLocation?.startOffset ?? Number.MAX_SAFE_INTEGER;
    if (positionA !== positionB) return positionA - positionB;
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    const pathA = a.path ?? "";
    const pathB = b.path ?? "";
    return pathA < pathB ? -1 : pathA > pathB ? 1 : 0;
  });
}

function capErrors(errors: CodeImportError[]): CodeImportError[] {
  return errors.slice(0, MAX_PARSER_ERRORS_RETURNED);
}

/**
 * Analyse pasted source without executing it. Accepts a plain string or a
 * CodeImportSource with an optional language hint.
 */
export function analyseImportSource(
  input: CodeImportSource | string,
  options: CodeImportAnalysisOptions = {},
): CodeImportAnalysis {
  const source = typeof input === "string" ? input : input.source;
  const hint =
    options.languageHint ??
    (typeof input === "string" ? undefined : input.languageHint);

  const result = emptyAnalysis();
  result.sourceSize = sourceByteSize(source);

  // 1. Empty input.
  if (source.trim().length === 0) {
    result.syntaxErrors = [
      {
        code: CODE_IMPORT_EMPTY,
        message: "Pasted source is empty.",
      },
    ];
    return result;
  }

  // 2. Size limit.
  const sizeError = checkSourceSize(source);
  if (sizeError) {
    result.syntaxErrors = [sizeError];
    return result;
  }

  // 3. Security preflight (advisory scan of raw text).
  result.securityFindings = sortFindings(scanSourceForSecurityRisks(source));

  // 4. Language detection.
  const detection = detectCodeLanguage(source, { hint });
  result.detectedLanguage = detection.language;
  result.confidence = detection.confidence;

  if (detection.language === "unknown") {
    result.syntaxErrors = [
      {
        code: CODE_LANGUAGE_UNKNOWN,
        message:
          "Could not recognize the pasted content as HTML, JSX/TSX, React or CSS.",
      },
    ];
    return result;
  }

  // 5. Parse + normalize.
  let normalization;
  try {
    normalization = parseImportSource(source, detection.language, {
      idFactory: options.idFactory,
    });
  } catch (err) {
    if (err instanceof CodeImportFatalError) {
      result.syntaxErrors = [err.error];
      return result;
    }
    throw err;
  }

  result.rootNodes = normalization.rootNodes;
  result.cssRules = normalization.cssRules;
  result.syntaxErrors = capErrors(normalization.errors);
  result.securityFindings = sortFindings([
    ...result.securityFindings,
    ...normalization.securityFindings,
  ]);
  result.unsupportedFeatures = sortUnsupported(normalization.unsupportedFeatures);

  const cssDeclarationCount = normalization.cssRules.reduce(
    (acc, rule) => acc + rule.declarations.length,
    0,
  );
  result.stats = computeStats(
    normalization.rootNodes,
    normalization.cssRules.length,
    cssDeclarationCount,
  );

  const hasFatalError = result.syntaxErrors.some((error) =>
    FATAL_ERROR_CODES.has(error.code),
  );
  result.canContinueToConversion = !hasFatalError;

  return result;
}
