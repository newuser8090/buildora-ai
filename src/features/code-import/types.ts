// ---------------------------------------------------------------------------
// Universal Block Import (Phase P) — core types
//
// P1 builds the safe, framework-independent foundation for accepting pasted
// user code. This module contains ONLY the pure data model: no React, no
// Zustand, no editor store, no DOM, no persistence. Everything here is
// serializable, deterministic and safe to test in Node.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Input language model
// ---------------------------------------------------------------------------

export type ImportedCodeLanguage =
  | "html"
  | "jsx"
  | "tsx"
  | "react"
  | "css"
  | "unknown";

export interface CodeImportSource {
  source: string;
  languageHint?: ImportedCodeLanguage;
}

export interface CodeLanguageDetection {
  language: ImportedCodeLanguage;
  confidence: "high" | "medium" | "low";
  reasons: string[];
}

// ---------------------------------------------------------------------------
// Source locations
//
// Convention: lines are 1-based, columns are 1-based (matching parse5 and
// postcss; @babel/parser 0-based columns are converted to 1-based).
// Offsets are 0-based character offsets into the original source string.
// ---------------------------------------------------------------------------

export interface ImportSourceLocation {
  startLine: number;
  startColumn: number;
  startOffset: number;
  endLine?: number;
  endColumn?: number;
  endOffset?: number;
}

// ---------------------------------------------------------------------------
// Normalized import AST — one safe, parser-independent tree
// ---------------------------------------------------------------------------

export type ImportAttributeValue = string | number | boolean | null;

export interface ImportElementNode {
  kind: "element";
  id: string;
  tagName: string;
  attributes: Record<string, ImportAttributeValue>;
  classNames: string[];
  inlineStyles: Record<string, string>;
  children: ImportNode[];
  sourceLocation?: ImportSourceLocation;
}

export interface ImportTextNode {
  kind: "text";
  id: string;
  value: string;
  sourceLocation?: ImportSourceLocation;
}

export interface ImportFragmentNode {
  kind: "fragment";
  id: string;
  children: ImportNode[];
  sourceLocation?: ImportSourceLocation;
}

export type ImportNode = ImportElementNode | ImportTextNode | ImportFragmentNode;

// ---------------------------------------------------------------------------
// Normalized CSS model
// ---------------------------------------------------------------------------

export interface ImportCssDeclaration {
  property: string;
  value: string;
  important: boolean;
}

export interface ImportCssRule {
  selector: string;
  declarations: ImportCssDeclaration[];
  sourceLocation?: ImportSourceLocation;
}

// ---------------------------------------------------------------------------
// Findings / errors
// ---------------------------------------------------------------------------

export type CodeImportSecuritySeverity = "info" | "warning" | "error";

export interface CodeImportSecurityFinding {
  code: string;
  severity: CodeImportSecuritySeverity;
  message: string;
  path?: string;
  sourceLocation?: ImportSourceLocation;
  /** True when the offending construct was removed from the normalized AST. */
  removed?: boolean;
}

export interface CodeImportUnsupportedFeature {
  code: string;
  message: string;
  path?: string;
  sourceLocation?: ImportSourceLocation;
}

export interface CodeImportError {
  code: string;
  message: string;
  limit?: number;
  actual?: number;
  path?: string;
  sourceLocation?: ImportSourceLocation;
}

// ---------------------------------------------------------------------------
// Stats & analysis result
// ---------------------------------------------------------------------------

export interface CodeImportStats {
  nodeCount: number;
  elementCount: number;
  textNodeCount: number;
  attributeCount: number;
  classTokenCount: number;
  cssRuleCount: number;
  cssDeclarationCount: number;
  maxDepth: number;
}

export interface CodeImportAnalysis {
  detectedLanguage: ImportedCodeLanguage;
  confidence: "high" | "medium" | "low";
  /** UTF-8 byte size of the source string. */
  sourceSize: number;
  rootNodes: ImportNode[];
  cssRules: ImportCssRule[];
  syntaxErrors: CodeImportError[];
  securityFindings: CodeImportSecurityFinding[];
  unsupportedFeatures: CodeImportUnsupportedFeature[];
  stats: CodeImportStats;
  canContinueToConversion: boolean;
}

// ---------------------------------------------------------------------------
// Deterministic ID factory
//
// Tests inject factories so node ids are fully deterministic. The default
// factory is a plain counter, never Math.random.
// ---------------------------------------------------------------------------

export interface ImportIdFactory {
  next(prefix?: string): string;
}

export interface CodeImportAnalysisOptions {
  languageHint?: ImportedCodeLanguage;
  idFactory?: ImportIdFactory;
}

// ---------------------------------------------------------------------------
// Internal normalization contract (used by parsing/ + normalization/)
// ---------------------------------------------------------------------------

export interface CodeImportNormalizationResult {
  rootNodes: ImportNode[];
  cssRules: ImportCssRule[];
  errors: CodeImportError[];
  securityFindings: CodeImportSecurityFinding[];
  unsupportedFeatures: CodeImportUnsupportedFeature[];
}
