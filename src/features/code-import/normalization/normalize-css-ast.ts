// ---------------------------------------------------------------------------
// CSS AST normalization (Phase P1)
//
// Walks a postcss Root and produces the safe CSS analysis model. @import,
// behavior/binding, expression( and javascript: URLs are rejected; @media-like
// at-rules are flattened into plain rules (their responsive context is noted,
// not applied); @keyframes-like at-rules are recorded and ignored. Rule and
// declaration counts are enforced with structured errors (no silent
// truncation). CSS is never applied or evaluated here.
// ---------------------------------------------------------------------------

import type { AtRule, Declaration, Root } from "postcss";

import {
  CODE_CSS_TOO_LARGE,
  FINDING_CSS_AT_RULE,
  FINDING_CSS_BEHAVIOR,
  FINDING_CSS_EXPRESSION,
  FINDING_CSS_IMPORT,
  FINDING_CSS_MALFORMED,
  FINDING_UNSAFE_URL,
  MAX_CSS_DECLARATIONS,
  MAX_CSS_DECLARATIONS_PER_RULE,
  MAX_CSS_RULES,
} from "../constants";
import { throwFatal } from "../errors";
import type {
  CodeImportNormalizationResult,
  CodeImportSecurityFinding,
  CodeImportUnsupportedFeature,
  ImportCssDeclaration,
  ImportCssRule,
  ImportSourceLocation,
} from "../types";

export interface NormalizeCssOptions {
  idFactory?: never;
}

interface CssState {
  ruleCount: number;
  declarationCount: number;
  rules: ImportCssRule[];
  findings: CodeImportSecurityFinding[];
  unsupported: CodeImportUnsupportedFeature[];
  errors: CodeImportNormalizationResult["errors"];
}

function locationOf(
  node: { source?: { start?: { line?: number; column?: number; offset?: number }; end?: { line?: number; column?: number; offset?: number } } },
): ImportSourceLocation | undefined {
  const start = node.source?.start;
  const end = node.source?.end;
  if (!start) return undefined;
  return {
    startLine: start.line ?? 1,
    startColumn: start.column ?? 1,
    startOffset: start.offset ?? 0,
    endLine: end?.line,
    endColumn: end?.column,
    endOffset: end?.offset,
  };
}

function pushRule(
  state: CssState,
  selector: string,
  declarations: ImportCssDeclaration[],
  sourceLocation: ImportSourceLocation | undefined,
): void {
  state.ruleCount += 1;
  if (state.ruleCount > MAX_CSS_RULES) {
    throwFatal(CODE_CSS_TOO_LARGE, `CSS has more than ${MAX_CSS_RULES} rules.`, {
      limit: MAX_CSS_RULES,
      actual: state.ruleCount,
      path: selector,
    });
  }
  state.declarationCount += declarations.length;
  if (state.declarationCount > MAX_CSS_DECLARATIONS) {
    throwFatal(CODE_CSS_TOO_LARGE, `CSS has more than ${MAX_CSS_DECLARATIONS} declarations in total.`, {
      limit: MAX_CSS_DECLARATIONS,
      actual: state.declarationCount,
      path: selector,
    });
  }
  if (declarations.length > MAX_CSS_DECLARATIONS_PER_RULE) {
    throwFatal(CODE_CSS_TOO_LARGE, `Rule "${selector}" has more than ${MAX_CSS_DECLARATIONS_PER_RULE} declarations.`, {
      limit: MAX_CSS_DECLARATIONS_PER_RULE,
      actual: declarations.length,
      path: selector,
    });
  }
  state.rules.push({ selector, declarations, sourceLocation });
}

function normalizeDeclarations(
  node: { nodes?: Array<{ type?: string; prop?: string; value?: string; important?: boolean; source?: unknown }> },
  state: CssState,
  path: string,
  sourceLocation: ImportSourceLocation | undefined,
): ImportCssDeclaration[] {
  const declarations: ImportCssDeclaration[] = [];

  for (const child of node.nodes ?? []) {
    if (!child || child.type !== "decl") continue;
    const declaration = child as Declaration;
    const property = (declaration.prop ?? "").toLowerCase();
    const value = declaration.value ?? "";
    const declPath = `${path}[${property}]`;

    if (value.toLowerCase().includes("expression(")) {
      state.findings.push({
        code: FINDING_CSS_EXPRESSION,
        severity: "warning",
        message: `expression( rejected in "${property}"`,
        path: declPath,
        sourceLocation: locationOf(declaration),
        removed: true,
      });
      continue;
    }
    if (property === "behavior" || property === "binding") {
      state.findings.push({
        code: FINDING_CSS_BEHAVIOR,
        severity: "warning",
        message: `CSS property "${property}" rejected`,
        path: declPath,
        sourceLocation: locationOf(declaration),
        removed: true,
      });
      continue;
    }
    if (
      value.toLowerCase().includes("javascript:") ||
      value.toLowerCase().includes("vbscript:")
    ) {
      state.findings.push({
        code: FINDING_UNSAFE_URL,
        severity: "warning",
        message: `javascript:/vbscript: URL rejected in "${property}"`,
        path: declPath,
        sourceLocation: locationOf(declaration),
        removed: true,
      });
      continue;
    }
    if (property.length === 0 || value.trim().length === 0) {
      state.findings.push({
        code: FINDING_CSS_MALFORMED,
        severity: "info",
        message: `Malformed declaration skipped`,
        path: declPath,
        sourceLocation: locationOf(declaration),
      });
      continue;
    }

    declarations.push({
      property,
      value,
      important: Boolean(declaration.important),
    });
  }

  void sourceLocation;
  return declarations;
}

function walkRules(
  container: { nodes?: Array<{ type?: string }> },
  state: CssState,
): void {
  for (const node of container.nodes ?? []) {
    if (!node || typeof node !== "object") continue;
    const candidate = node as { type?: string; name?: string };

    if (candidate.type === "rule") {
      const rule = node as {
        selector?: string;
        source?: { start?: unknown; end?: unknown };
      };
      const selector = rule.selector ?? "";
      const loc = locationOf(rule as never);
      const declarations = normalizeDeclarations(node as never, state, selector, loc);
      pushRule(state, selector, declarations, loc);
      continue;
    }

    if (candidate.type === "atrule") {
      const atRule = node as AtRule;
      const name = (atRule.name ?? "").toLowerCase();
      const loc = locationOf(atRule);

      if (name === "import") {
        state.findings.push({
          code: FINDING_CSS_IMPORT,
          severity: "warning",
          message: `@import rejected ("${atRule.params ?? ""}")`,
          sourceLocation: loc,
          removed: true,
        });
        continue;
      }

      // Container at-rules (media/supports/layer/container): flatten their
      // rules into plain rules; responsive context is noted, not applied.
      if (name === "media" || name === "supports" || name === "layer" || name === "container") {
        state.unsupported.push({
          code: FINDING_CSS_AT_RULE,
          message: `@${name} block flattened; responsive semantics are not preserved in P1`,
          sourceLocation: loc,
        });
        walkRules(atRule, state);
        continue;
      }

      // Keyframes/font-face/page/… are not representable as selector+declarations.
      state.unsupported.push({
        code: FINDING_CSS_AT_RULE,
        message: `@${name} at-rule ignored in P1`,
        sourceLocation: loc,
      });
      continue;
    }

    // comments are ignored by the walk (postcss Comment nodes have no rules).
  }
}

/**
 * Normalize a postcss Root into the safe CSS analysis model. Enforces rule
 * and declaration limits with structured errors. Never mutates the input.
 */
export function normalizeCssAst(
  root: Root,
  _options: NormalizeCssOptions = {},
): CodeImportNormalizationResult {
  const state: CssState = {
    ruleCount: 0,
    declarationCount: 0,
    rules: [],
    findings: [],
    unsupported: [],
    errors: [],
  };

  walkRules(root, state);

  return {
    rootNodes: [],
    cssRules: state.rules,
    errors: state.errors,
    securityFindings: state.findings,
    unsupportedFeatures: state.unsupported,
  };
}
