// ---------------------------------------------------------------------------
// Universal Block Import (Phase P2) — conversion report model
//
// Every conversion produces a deterministic ConversionReport alongside the
// converted BlockTree. The report carries:
//   - warnings              — non-fatal conversion decisions (downgrades, folds)
//   - unsupported constructs— source features that cannot become editable blocks
//   - replaced runtime behavior — things P1/P2 removed or stubbed instead of executing
//   - ignored code          — source that was intentionally not carried over
//   - detected framework    — html / react-jsx / tailwind / css / unknown
//   - confidence            — deterministic 0..1 heuristic score
//
// Pure and serializable: no React, no DOM, no store.
// ---------------------------------------------------------------------------

import type { CodeImportAnalysis } from "../types";
import type { ConversionIdFactory } from "./conversion-errors";

// ---------------------------------------------------------------------------
// Report model
// ---------------------------------------------------------------------------

export type DetectedFramework =
  | "html"
  | "react-jsx"
  | "tailwind"
  | "css"
  | "unknown";

export interface ConversionWarning {
  code: string;
  message: string;
  path?: string;
}

export interface UnsupportedConstruct {
  code: string;
  message: string;
  path?: string;
}

export interface ReplacedRuntimeBehavior {
  code: string;
  message: string;
  path?: string;
}

export interface IgnoredCode {
  code: string;
  message: string;
  path?: string;
}

export interface ConversionReport {
  warnings: ConversionWarning[];
  unsupportedConstructs: UnsupportedConstruct[];
  replacedRuntimeBehavior: ReplacedRuntimeBehavior[];
  ignoredCode: IgnoredCode[];
  detectedFramework: DetectedFramework;
  /** Deterministic heuristic in [0, 1] (2 decimal places). */
  confidence: number;
  /** Total number of block nodes in the converted tree. */
  convertedBlockCount: number;
  /** Number of top-level (root) blocks. */
  rootCount: number;
  /** Block type → count for every block in the converted tree. */
  blockTypeCounts: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Finding code buckets (P1 constants referenced by value, not by import, so
// this module stays decoupled from P1's constant file)
// ---------------------------------------------------------------------------

/** P1 findings that represent runtime behavior replaced by a safe stub. */
const REPLACED_FINDING_CODES: ReadonlySet<string> = new Set([
  "event-handler-removed",
  "spread-props-removed",
  "dangerously-set-inner-html",
  "script-removed",
  "iframe-removed",
  "object-embed-removed",
  "style-element-removed",
]);

/** P1 findings that represent code that was deliberately ignored. */
const IGNORED_FINDING_CODES: ReadonlySet<string> = new Set([
  "external-import-ignored",
  "dynamic-import-ignored",
  "require-ignored",
  "css-at-rule-ignored",
  "custom-component-inlined",
]);

/** P1 findings that represent constructs that cannot become editable blocks. */
const UNSUPPORTED_FINDING_CODES: ReadonlySet<string> = new Set([
  "hook-usage-unsupported",
  "network-call-unsupported",
  "eval-detected",
  "function-constructor-detected",
  "document-write-detected",
  "window-location-mutation",
  "dynamic-expression-unsupported",
  "unresolved-identifier",
  "custom-component-unsupported",
  "css-import-rejected",
  "css-expression-rejected",
  "css-behavior-property-rejected",
  "ambiguous-component-selection",
]);

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export class ConversionReportBuilder {
  private warnings: ConversionWarning[] = [];
  private unsupportedItems: UnsupportedConstruct[] = [];
  private replacedItems: ReplacedRuntimeBehavior[] = [];
  private ignoredItems: IgnoredCode[] = [];
  private detectedFramework: DetectedFramework = "unknown";
  private tailwindClassTokenSeen = false;

  warn(code: string, message: string, path?: string): void {
    this.warnings.push({ code, message, path });
  }

  unsupported(code: string, message: string, path?: string): void {
    this.unsupportedItems.push({ code, message, path });
  }

  replaced(code: string, message: string, path?: string): void {
    this.replacedItems.push({ code, message, path });
  }

  ignored(code: string, message: string, path?: string): void {
    this.ignoredItems.push({ code, message, path });
  }

  setTailwindDetected(): void {
    this.tailwindClassTokenSeen = true;
  }

  // -------------------------------------------------------------------------
  // Framework + confidence
  // -------------------------------------------------------------------------

  resolveFramework(language: string): DetectedFramework {
    if (language === "jsx" || language === "tsx" || language === "react") {
      this.detectedFramework = "react-jsx";
    } else if (language === "css") {
      this.detectedFramework = "css";
    } else if (language === "html") {
      this.detectedFramework = this.tailwindClassTokenSeen ? "tailwind" : "html";
    } else {
      this.detectedFramework = "unknown";
    }
    return this.detectedFramework;
  }

  /** Deterministic heuristic confidence from the collected report entries. */
  computeConfidence(convertedBlockCount: number): number {
    if (convertedBlockCount === 0) return 0;
    let score = 1;
    score -= this.warnings.length * 0.05;
    score -= this.unsupportedItems.length * 0.08;
    score -= this.replacedItems.length * 0.05;
    score -= this.ignoredItems.length * 0.03;
    score = Math.max(0.1, Math.min(1, score));
    return Math.round(score * 100) / 100;
  }

  // -------------------------------------------------------------------------
  // Finalize
  // -------------------------------------------------------------------------

  /** Deterministic ordering: by optional path, then code, then message. */
  finalize(
    language: string,
    convertedBlockCount: number,
    rootCount: number,
    blockTypeCounts: Record<string, number>,
  ): ConversionReport {
    const byPathThenCode = <T extends { code: string; message: string; path?: string }>(
      a: T,
      b: T,
    ): number => {
      const pathA = a.path ?? "";
      const pathB = b.path ?? "";
      if (pathA !== pathB) return pathA < pathB ? -1 : 1;
      if (a.code !== b.code) return a.code < b.code ? -1 : 1;
      if (a.message !== b.message) return a.message < b.message ? -1 : 1;
      return 0;
    };

    return {
      warnings: [...this.warnings].sort(byPathThenCode),
      unsupportedConstructs: [...this.unsupportedItems].sort(byPathThenCode),
      replacedRuntimeBehavior: [...this.replacedItems].sort(byPathThenCode),
      ignoredCode: [...this.ignoredItems].sort(byPathThenCode),
      detectedFramework: this.resolveFramework(language),
      confidence: this.computeConfidence(convertedBlockCount),
      convertedBlockCount,
      rootCount,
      blockTypeCounts,
    };
  }
}

// ---------------------------------------------------------------------------
// Context shared by every converter module
// ---------------------------------------------------------------------------

export interface ConversionContext {
  /** The P1 analysis being converted. */
  analysis: CodeImportAnalysis;
  /** Deterministic block id factory. */
  idFactory: ConversionIdFactory;
  /** Accumulating report. */
  report: ConversionReportBuilder;
  /** Class selectors declared by the imported CSS (e.g. ".hero"). */
  cssClassSelectors: Set<string>;
}

/** Create a fresh conversion context for one analysis run. */
export function createConversionContext(
  analysis: CodeImportAnalysis,
  idFactory: ConversionIdFactory,
): ConversionContext {
  const cssClassSelectors = new Set<string>();
  for (const rule of analysis.cssRules) {
    for (const token of rule.selector.split(",")) {
      const selector = token.trim();
      if (selector.startsWith(".")) {
        cssClassSelectors.add(selector.slice(1));
      }
    }
  }
  return {
    analysis,
    idFactory,
    report: new ConversionReportBuilder(),
    cssClassSelectors,
  };
}

// ---------------------------------------------------------------------------
// Mapping of P1 findings into the report buckets
// ---------------------------------------------------------------------------

/**
 * Fold P1 security findings + unsupported features into the conversion report
 * so the UI sees one consolidated, ordered picture. Deterministic.
 */
export function foldAnalysisIntoReport(
  analysis: CodeImportAnalysis,
  report: ConversionReportBuilder,
): void {
  for (const finding of analysis.securityFindings) {
    const path = finding.path;
    if (finding.removed && REPLACED_FINDING_CODES.has(finding.code)) {
      report.replaced(finding.code, finding.message, path);
    } else if (UNSUPPORTED_FINDING_CODES.has(finding.code)) {
      report.unsupported(finding.code, finding.message, path);
    } else if (IGNORED_FINDING_CODES.has(finding.code)) {
      report.ignored(finding.code, finding.message, path);
    } else {
      // Remaining findings (unsafe URLs, data URLs, dangerous keys…) are
      // security notes — surfaced as warnings, never fatal.
      report.warn(finding.code, finding.message, path);
    }
  }

  for (const feature of analysis.unsupportedFeatures) {
    report.unsupported(feature.code, feature.message, feature.path);
  }
}
