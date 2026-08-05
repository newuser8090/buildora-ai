// ---------------------------------------------------------------------------
// JSX/TSX AST normalization (Phase P1)
//
// Walks a @babel/parser program AST and produces the safe normalized import
// AST. Static React function components are extracted WITHOUT execution;
// dynamic expressions become structured unsupported findings, never runtime
// values. Event handlers, spread props, dangerous keys and unsafe URLs are
// removed. Unknown PascalCase components are recorded, not executed.
// ---------------------------------------------------------------------------

import type {
  ArrayExpression,
  BooleanLiteral,
  CallExpression,
  Expression,
  Identifier,
  ImportDeclaration,
  JSXAttribute,
  JSXElement,
  JSXExpressionContainer,
  JSXFragment,
  JSXIdentifier,
  JSXSpreadAttribute,
  JSXText,
  NumericLiteral,
  ObjectExpression,
  StringLiteral,
} from "@babel/types";

import {
  CODE_AST_TOO_DEEP,
  CODE_DANGEROUS_KEY,
  CODE_TEXT_TOO_LARGE,
  CODE_TOO_MANY_ATTRIBUTES,
  CODE_TOO_MANY_CLASSES,
  CODE_TOO_MANY_NODES,
  CODE_UNSUPPORTED_SYNTAX,
  FINDING_AMBIGUOUS_COMPONENTS,
  FINDING_CUSTOM_COMPONENT,
  FINDING_CUSTOM_COMPONENT_INLINED,
  FINDING_DANGEROUS_HTML,
  FINDING_DYNAMIC_EXPRESSION,
  FINDING_DYNAMIC_IMPORT,
  FINDING_EVENT_HANDLER_REMOVED,
  FINDING_EXTERNAL_IMPORT_IGNORED,
  FINDING_HOOK_UNSUPPORTED,
  FINDING_NETWORK_CALL,
  FINDING_REQUIRE,
  FINDING_SPREAD_REMOVED,
  FINDING_UNRESOLVED_IDENTIFIER,
  FINDING_UNSAFE_URL,
  MAX_ATTRIBUTES_PER_ELEMENT,
  MAX_CLASS_TOKENS_PER_ELEMENT,
  MAX_IMPORT_DEPTH,
  MAX_IMPORT_NODES,
  MAX_TEXT_NODE_LENGTH,
  MAX_TOTAL_TEXT_LENGTH,
} from "../constants";
import { throwFatal } from "../errors";
import { isDangerousKey } from "../security/dangerous-key-check";
import { unsafeUrlReason } from "../security/safe-url";
import type {
  CodeImportNormalizationResult,
  CodeImportSecurityFinding,
  CodeImportUnsupportedFeature,
  ImportAttributeValue,
  ImportElementNode,
  ImportIdFactory,
  ImportNode,
} from "../types";
import type { JsxParseResult } from "../parsing/parse-jsx";
import {
  createDefaultIdFactory,
  IMAGE_URL_ATTRIBUTES,
  isEventHandlerAttribute,
  LINK_URL_ATTRIBUTES,
  parseInlineStyle,
  PathBuilder,
} from "./shared";

export interface NormalizeJsxOptions {
  idFactory?: ImportIdFactory;
}

interface NormalizeState {
  idFactory: ImportIdFactory;
  nodeCount: number;
  totalTextLength: number;
  findings: CodeImportSecurityFinding[];
  unsupported: CodeImportUnsupportedFeature[];
  errors: CodeImportNormalizationResult["errors"];
}

interface LocalComponent {
  name: string;
  jsx: JSXElement | JSXFragment;
}

// ---------------------------------------------------------------------------
// Generic deterministic AST walker (object keys in insertion order)
// ---------------------------------------------------------------------------

const SKIP_KEYS = new Set([
  "loc", "start", "end", "extra", "comments",
  "leadingComments", "trailingComments", "innerComments",
]);

function walkProgramNodes(node: unknown, visit: (n: { type: string }) => void): void {
  if (!node || typeof node !== "object") return;
  const candidate = node as { type?: unknown };
  if (typeof candidate.type !== "string") return;
  visit(candidate as { type: string });
  for (const key of Object.keys(candidate)) {
    if (SKIP_KEYS.has(key)) continue;
    const value = (candidate as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const item of value) walkProgramNodes(item, visit);
    } else {
      walkProgramNodes(value, visit);
    }
  }
}

// ---------------------------------------------------------------------------
// Program-level scan: imports, hooks, network, require, dynamic import
// ---------------------------------------------------------------------------

interface Locatable {
  loc?:
    | {
        start?: { line?: number; column?: number } | null;
        end?: { line?: number; column?: number } | null;
      }
    | null;
  start?: number | null;
  end?: number | null;
}

function locationOf(node: Locatable) {
  const start = node.loc?.start;
  const end = node.loc?.end;
  return {
    startLine: start?.line ?? 1,
    startColumn: (start?.column ?? 0) + 1,
    startOffset: node.start ?? 0,
    endLine: end?.line,
    endColumn: end ? (end.column ?? 0) + 1 : undefined,
    endOffset: node.end ?? undefined,
  };
}

function scanProgram(
  program: JsxParseResult["program"],
  state: NormalizeState,
): void {
  // External import statements are ignored (never resolved or executed).
  for (const statement of program.program.body) {
    if (statement.type === "ImportDeclaration") {
      const decl = statement as ImportDeclaration;
      state.findings.push({
        code: FINDING_EXTERNAL_IMPORT_IGNORED,
        severity: "info",
        message: `External import "${decl.source.value}" ignored in P1`,
        sourceLocation: locationOf(statement),
      });
    }
  }

  walkProgramNodes(program, (node) => {
    if (node.type === "CallExpression") {
      const call = node as CallExpression;
      const callee = call.callee;

      if (callee.type === "Identifier") {
        const name = (callee as Identifier).name;
        if (/^use[A-Z]/.test(name)) {
          state.findings.push({
            code: FINDING_HOOK_UNSUPPORTED,
            severity: "info",
            message: `React hook "${name}" is unsupported in P1`,
            sourceLocation: locationOf(call),
          });
        } else if (name === "fetch") {
          state.findings.push({
            code: FINDING_NETWORK_CALL,
            severity: "warning",
            message: "fetch() network call is unsupported in P1",
            sourceLocation: locationOf(call),
          });
        } else if (name === "require") {
          state.findings.push({
            code: FINDING_REQUIRE,
            severity: "warning",
            message: "require() is ignored in P1",
            sourceLocation: locationOf(call),
          });
        }
      } else if (callee.type === "Import") {
        state.findings.push({
          code: FINDING_DYNAMIC_IMPORT,
          severity: "warning",
          message: "dynamic import() is ignored in P1",
          sourceLocation: locationOf(call),
        });
      }
    }

    if (node.type === "NewExpression") {
      const callee = (node as { callee?: { type?: string; name?: string } }).callee;
      if (
        callee &&
        callee.type === "Identifier" &&
        (callee.name === "XMLHttpRequest" || callee.name === "WebSocket")
      ) {
        state.findings.push({
          code: FINDING_NETWORK_CALL,
          severity: "warning",
          message: `${callee.name} network API is unsupported in P1`,
          sourceLocation: locationOf(node as Locatable),
        });
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Static expression policy (section 20 of the P1 spec)
// ---------------------------------------------------------------------------

function describeDynamicExpression(expression: Expression): string {
  switch (expression.type) {
    case "ConditionalExpression":
      return "ternary requires runtime data";
    case "CallExpression": {
      const callee = (expression as CallExpression).callee;
      if (callee.type === "MemberExpression") {
        const property = (callee as { property?: { name?: string } }).property;
        if (property?.name === "map") return "array .map() requires runtime data";
      }
      return "function call would execute code";
    }
    case "MemberExpression":
      return "member access requires runtime data";
    case "LogicalExpression":
      return "logical expression requires runtime data";
    case "TemplateLiteral":
      return "template literal is not statically resolved";
    case "Identifier":
      return "unresolved identifier";
    default:
      return `${expression.type} is not statically resolvable`;
  }
}

function isStaticStringArray(expression: Expression): expression is ArrayExpression {
  if (expression.type !== "ArrayExpression") return false;
  const array = expression as ArrayExpression;
  return (
    array.elements.length > 0 &&
    array.elements.every((element) => element?.type === "StringLiteral")
  );
}

// ---------------------------------------------------------------------------
// Text handling
// ---------------------------------------------------------------------------

function pushTextNode(
  state: NormalizeState,
  raw: string,
  loc: ReturnType<typeof locationOf>,
  path: string,
  children: ImportNode[],
): void {
  let value = raw;
  const originalLength = value.length;

  if (originalLength > MAX_TEXT_NODE_LENGTH) {
    state.errors.push({
      code: CODE_TEXT_TOO_LARGE,
      message: `Text node is ${originalLength} characters; the maximum is ${MAX_TEXT_NODE_LENGTH}.`,
      limit: MAX_TEXT_NODE_LENGTH,
      actual: originalLength,
      path,
    });
    value = value.slice(0, MAX_TEXT_NODE_LENGTH);
  }

  const remainingBudget = MAX_TOTAL_TEXT_LENGTH - state.totalTextLength;
  if (value.length > remainingBudget) {
    state.errors.push({
      code: CODE_TEXT_TOO_LARGE,
      message: `Total text content exceeds the safe cap of ${MAX_TOTAL_TEXT_LENGTH} characters.`,
      limit: MAX_TOTAL_TEXT_LENGTH,
      actual: state.totalTextLength + originalLength,
      path,
    });
    value = value.slice(0, Math.max(0, remainingBudget));
  }

  state.totalTextLength += value.length;
  if (value.length === 0) return;

  children.push({
    kind: "text",
    id: state.idFactory.next(),
    value,
    sourceLocation: loc,
  });
}

// ---------------------------------------------------------------------------
// Element / attribute normalization
// ---------------------------------------------------------------------------

interface BuiltAttributes {
  attributes: Record<string, ImportAttributeValue>;
  classNames: string[];
  inlineStyles: Record<string, string>;
}

function isCustomTagName(name: string): boolean {
  return /^[A-Z]/.test(name) || name.includes(".") || name.includes(":");
}

function normalizedTagName(name: string): string {
  // PascalCase/member/namespaced names are preserved for analysis; native
  // HTML element names are lowercased.
  return isCustomTagName(name) ? name : name.toLowerCase();
}

class JsxNormalizer {
  private readonly parsed: JsxParseResult;
  private readonly state: NormalizeState;
  private readonly bindings: ReadonlyMap<string, string | number>;
  private readonly localComponents: Map<string, LocalComponent>;
  private readonly paths = new PathBuilder();
  private readonly inlining: string[] = [];

  constructor(
    parsed: JsxParseResult,
    options: NormalizeJsxOptions,
  ) {
    this.parsed = parsed;
    this.state = {
      idFactory: options.idFactory ?? createDefaultIdFactory(),
      nodeCount: 0,
      totalTextLength: 0,
      findings: [],
      unsupported: [],
      errors: [],
    };
    this.bindings = parsed.staticBindings;
    this.localComponents = new Map(
      parsed.componentCandidates
        .filter((candidate) => candidate.parameterCount === 0)
        .map((candidate) => [candidate.name, { name: candidate.name, jsx: candidate.jsx }]),
    );
  }

  normalize(): CodeImportNormalizationResult {
    const parsed = this.parsed;
    scanProgram(parsed.program, this.state);

    const candidates = parsed.componentCandidates;

    if (candidates.length > 0) {
      if (candidates.length > 1) {
        this.state.unsupported.push({
          code: FINDING_AMBIGUOUS_COMPONENTS,
          message: `Multiple component candidates found; deterministically selected the first in source order ("${candidates[0].name}").`,
        });
      }
      const rootNodes: ImportNode[] = [];
      this.normalizeJsxRoot(candidates[0].jsx, rootNodes, 0);
      return this.finish(rootNodes);
    }

    if (parsed.expressionRoots.length === 0) {
      throwFatal(
        CODE_UNSUPPORTED_SYNTAX,
        "Source contains no JSX elements to import.",
      );
    }

    const rootNodes: ImportNode[] = [];
    if (parsed.expressionRoots.length === 1) {
      this.normalizeJsxRoot(parsed.expressionRoots[0], rootNodes, 0);
    } else {
      // Multiple bare JSX expressions: wrap them deterministically in a
      // fragment so nothing is silently dropped.
      const fragment: ImportNode = {
        kind: "fragment",
        id: this.state.idFactory.next(),
        children: [],
      };
      for (const expression of parsed.expressionRoots) {
        this.normalizeJsxRoot(expression, fragment.children, 0);
      }
      rootNodes.push(fragment);
    }
    return this.finish(rootNodes);
  }

  private finish(rootNodes: ImportNode[]): CodeImportNormalizationResult {
    return {
      rootNodes,
      cssRules: [],
      errors: this.state.errors,
      securityFindings: this.state.findings,
      unsupportedFeatures: this.state.unsupported,
    };
  }

  private normalizeJsxRoot(
    node: JSXElement | JSXFragment,
    children: ImportNode[],
    depth: number,
  ): void {
    this.walkJsx(node, children, depth);
  }

  private walkJsx(node: unknown, children: ImportNode[], depth: number): void {
    if (depth > MAX_IMPORT_DEPTH) {
      throwFatal(CODE_AST_TOO_DEEP, `Structure is deeper than ${MAX_IMPORT_DEPTH} levels.`, {
        limit: MAX_IMPORT_DEPTH,
        actual: depth,
        path: this.paths.current(),
      });
    }
    this.state.nodeCount += 1;
    if (this.state.nodeCount > MAX_IMPORT_NODES) {
      throwFatal(CODE_TOO_MANY_NODES, `Source expands to more than ${MAX_IMPORT_NODES} nodes.`, {
        limit: MAX_IMPORT_NODES,
        actual: this.state.nodeCount,
        path: this.paths.current(),
      });
    }

    if (!node || typeof node !== "object") return;
    const candidate = node as { type?: string };

    if (candidate.type === "JSXText") {
      const text = node as JSXText;
      const value = text.value;
      // JSX formatting rule: whitespace-only lines are dropped.
      if (value.includes("\n") && value.trim().length === 0) return;
      pushTextNode(this.state, value, locationOf(text), this.paths.current(), children);
      return;
    }

    if (candidate.type === "JSXExpressionContainer") {
      this.normalizeExpressionContainer(node as JSXExpressionContainer, children);
      return;
    }

    if (candidate.type === "JSXSpreadChild") {
      this.state.unsupported.push({
        code: FINDING_DYNAMIC_EXPRESSION,
        message: "JSX spread child {...values} is unsupported",
        path: this.paths.current(),
        sourceLocation: locationOf(node as Locatable),
      });
      return;
    }

    if (candidate.type === "JSXFragment") {
      const fragment = node as JSXFragment;
      const importFragment: ImportNode = {
        kind: "fragment",
        id: this.state.idFactory.next(),
        children: [],
        sourceLocation: locationOf(fragment),
      };
      for (const child of fragment.children) {
        this.walkJsx(child, importFragment.children, depth + 1);
      }
      children.push(importFragment);
      return;
    }

    if (candidate.type === "JSXElement") {
      this.normalizeElement(node as JSXElement, children, depth);
      return;
    }

    // Any other JSX node type is unsupported.
    this.state.unsupported.push({
      code: CODE_UNSUPPORTED_SYNTAX,
      message: `Unsupported JSX node type "${candidate.type}"`,
      path: this.paths.current(),
    });
  }

  private normalizeExpressionContainer(
    container: JSXExpressionContainer,
    children: ImportNode[],
  ): void {
    const expression = container.expression;
    const loc = locationOf(container);
    const path = this.paths.current();

    if (expression.type === "JSXEmptyExpression") return; // {} renders nothing

    if (expression.type === "StringLiteral") {
      pushTextNode(this.state, (expression as StringLiteral).value, loc, path, children);
      return;
    }
    if (expression.type === "NumericLiteral") {
      pushTextNode(this.state, String((expression as NumericLiteral).value), loc, path, children);
      return;
    }
    if (expression.type === "BooleanLiteral") {
      pushTextNode(this.state, String((expression as BooleanLiteral).value), loc, path, children);
      return;
    }
    if (expression.type === "NullLiteral" || (expression.type === "Identifier" && expression.name === "undefined")) {
      return;
    }

    if (isStaticStringArray(expression)) {
      for (const element of (expression as ArrayExpression).elements) {
        pushTextNode(this.state, (element as StringLiteral).value, loc, path, children);
      }
      return;
    }

    if (expression.type === "Identifier") {
      const bound = this.bindings.get(expression.name);
      if (bound !== undefined) {
        pushTextNode(this.state, String(bound), loc, path, children);
        return;
      }
      this.state.unsupported.push({
        code: FINDING_UNRESOLVED_IDENTIFIER,
        message: `Identifier "${expression.name}" cannot be resolved statically`,
        path,
        sourceLocation: loc,
      });
      return;
    }

    this.state.unsupported.push({
      code: FINDING_DYNAMIC_EXPRESSION,
      message: describeDynamicExpression(expression),
      path,
      sourceLocation: loc,
    });
  }

  private normalizeElement(
    element: JSXElement,
    children: ImportNode[],
    depth: number,
  ): void {
    const opening = element.openingElement;
    const nameNode = opening.name;
    const loc = locationOf(element);

    let rawName: string;
    if (nameNode.type === "JSXIdentifier") {
      rawName = (nameNode as JSXIdentifier).name;
    } else if (nameNode.type === "JSXMemberExpression") {
      rawName = flattenMemberName(nameNode);
    } else if (nameNode.type === "JSXNamespacedName") {
      const ns = nameNode as { namespace?: { name?: string }; name?: { name?: string } };
      rawName = `${ns.namespace?.name ?? ""}:${ns.name?.name ?? ""}`;
    } else {
      rawName = "unknown";
    }

    const tagName = normalizedTagName(rawName);
    const elementPath = this.paths.current() === "root" ? tagName : `${this.paths.current()} > ${tagName}`;

    // ---- Custom component policy (section 21) ----
    if (isCustomTagName(tagName)) {
      const local = this.localComponents.get(tagName);
      if (local && !this.inlining.includes(tagName)) {
        this.state.findings.push({
          code: FINDING_CUSTOM_COMPONENT_INLINED,
          severity: "info",
          message: `Static local component "${tagName}" inlined without execution`,
          path: elementPath,
          sourceLocation: loc,
        });
        this.inlining.push(tagName);
        this.walkJsx(local.jsx, children, depth + 1);
        this.inlining.pop();
        return;
      }
      // Unknown or recursive custom component: record, do not execute.
      const attrCount = this.countAttributes(opening.attributes);
      this.state.unsupported.push({
        code: FINDING_CUSTOM_COMPONENT,
        message: `Custom component "${tagName}" is not executed; recorded for P2 mapping (static attributes: ${attrCount})`,
        path: elementPath,
        sourceLocation: loc,
      });
      this.normalizeElementBody(element, children, depth, tagName, elementPath, opening.attributes, loc);
      return;
    }

    this.normalizeElementBody(element, children, depth, tagName, elementPath, opening.attributes, loc);
  }

  private normalizeElementBody(
    element: JSXElement,
    children: ImportNode[],
    depth: number,
    tagName: string,
    elementPath: string,
    rawAttributes: JSXElement["openingElement"]["attributes"],
    loc: ReturnType<typeof locationOf>,
  ): void {
    // ---- Per-element limits: reject the whole element (never truncate) ----
    if (rawAttributes.length > MAX_ATTRIBUTES_PER_ELEMENT) {
      this.state.errors.push({
        code: CODE_TOO_MANY_ATTRIBUTES,
        message: `Element has ${rawAttributes.length} attributes; the maximum is ${MAX_ATTRIBUTES_PER_ELEMENT}.`,
        limit: MAX_ATTRIBUTES_PER_ELEMENT,
        actual: rawAttributes.length,
        path: elementPath,
      });
      return;
    }

    const built = this.buildAttributes(rawAttributes, elementPath, loc);

    if (built.classNames.length > MAX_CLASS_TOKENS_PER_ELEMENT) {
      this.state.errors.push({
        code: CODE_TOO_MANY_CLASSES,
        message: `Element has more than ${MAX_CLASS_TOKENS_PER_ELEMENT} class tokens.`,
        limit: MAX_CLASS_TOKENS_PER_ELEMENT,
        actual: built.classNames.length,
        path: elementPath,
      });
      return;
    }

    const importElement: ImportElementNode = {
      kind: "element",
      id: this.state.idFactory.next(),
      tagName,
      attributes: built.attributes,
      classNames: built.classNames,
      inlineStyles: built.inlineStyles,
      children: [],
      sourceLocation: loc,
    };

    this.paths.push(tagName);
    for (const child of element.children) {
      this.walkJsx(child, importElement.children, depth + 1);
    }
    this.paths.pop();

    children.push(importElement);
  }

  private countAttributes(attributes: JSXElement["openingElement"]["attributes"]): number {
    return attributes.filter((attribute) => attribute.type === "JSXAttribute").length;
  }

  private buildAttributes(
    rawAttributes: JSXElement["openingElement"]["attributes"],
    elementPath: string,
    loc: ReturnType<typeof locationOf>,
  ): BuiltAttributes {
    const attributes: Record<string, ImportAttributeValue> = {};
    const classNames: string[] = [];
    let inlineStyles: Record<string, string> = {};

    for (const attribute of rawAttributes) {
      if (attribute.type === "JSXSpreadAttribute") {
        void (attribute as JSXSpreadAttribute);
        this.state.findings.push({
          code: FINDING_SPREAD_REMOVED,
          severity: "warning",
          message: "Unknown spread props {...} removed",
          path: elementPath,
          sourceLocation: loc,
          removed: true,
        });
        continue;
      }

      const jsxAttr = attribute as JSXAttribute;
      const nameNode = jsxAttr.name;
      if (nameNode.type !== "JSXIdentifier") continue;
      const name = nameNode.name;
      const attrPath = `${elementPath}[${name}]`;

      if (isEventHandlerAttribute(name)) {
        this.state.findings.push({
          code: FINDING_EVENT_HANDLER_REMOVED,
          severity: "warning",
          message: `Event handler attribute "${name}" removed`,
          path: attrPath,
          sourceLocation: loc,
          removed: true,
        });
        continue;
      }

      if (name === "dangerouslySetInnerHTML") {
        this.state.findings.push({
          code: FINDING_DANGEROUS_HTML,
          severity: "warning",
          message: "dangerouslySetInnerHTML removed",
          path: attrPath,
          sourceLocation: loc,
          removed: true,
        });
        continue;
      }

      if (isDangerousKey(name)) {
        this.state.findings.push({
          code: CODE_DANGEROUS_KEY,
          severity: "warning",
          message: `Dangerous key "${name}" rejected`,
          path: attrPath,
          sourceLocation: loc,
          removed: true,
        });
        continue;
      }

      if (name === "className" || name === "class") {
        const resolved = this.attributeStringValue(jsxAttr, attrPath, loc);
        if (resolved === null) continue;
        for (const token of resolved.split(/\s+/)) {
          if (token.length > 0) classNames.push(token);
        }
        continue;
      }

      if (name === "style") {
        const parsed = this.attributeStyleValue(jsxAttr, attrPath, loc);
        if (parsed) inlineStyles = { ...inlineStyles, ...parsed.styles };
        continue;
      }

      // ---- URL policy for string values ----
      const lowerName = name.toLowerCase();
      if (LINK_URL_ATTRIBUTES.has(lowerName) || IMAGE_URL_ATTRIBUTES.has(lowerName)) {
        const stringValue = this.attributeStringValue(jsxAttr, attrPath, loc);
        if (stringValue !== null) {
          const kind = IMAGE_URL_ATTRIBUTES.has(lowerName) ? "image" : "link";
          const reason = unsafeUrlReason(stringValue, kind);
          if (reason !== null) {
            this.state.findings.push({
              code: FINDING_UNSAFE_URL,
              severity: "warning",
              message: `Unsafe ${kind} URL on "${name}" rejected (${reason})`,
              path: attrPath,
              sourceLocation: loc,
              removed: true,
            });
            continue;
          }
        }
      }

      // ---- Generic attribute value ----
      const scalar = this.attributeScalar(jsxAttr, attrPath, loc);
      if (scalar === "unsupported") continue;
      if (scalar !== null) attributes[name] = scalar;
      else attributes[name] = true; // <input disabled /> shorthand
    }

    return { attributes, classNames, inlineStyles };
  }

  /**
   * Returns the string value for a JSX attribute when it is statically a
   * string, or null when the attribute must be dropped.
   */
  private attributeStringValue(
    jsxAttr: JSXAttribute,
    attrPath: string,
    loc: ReturnType<typeof locationOf>,
  ): string | null {
    const value = jsxAttr.value;
    if (!value) return "";
    if (value.type === "StringLiteral") return value.value;
    if (value.type === "JSXExpressionContainer") {
      const expression = value.expression;
      if (expression.type === "StringLiteral") return expression.value;
      if (expression.type === "Identifier") {
        const bound = this.bindings.get(expression.name);
        if (typeof bound === "string") return bound;
      }
    }
    this.reportDynamicAttribute(jsxAttr, attrPath, loc);
    return null;
  }

  private attributeStyleValue(
    jsxAttr: JSXAttribute,
    attrPath: string,
    loc: ReturnType<typeof locationOf>,
  ): { styles: Record<string, string> } | null {
    const value = jsxAttr.value;
    if (!value) return null;

    if (value.type === "StringLiteral") {
      const { styles, dropped } = parseInlineStyle(value.value);
      for (const drop of dropped) {
        this.state.findings.push({
          code: FINDING_UNSAFE_URL,
          severity: "warning",
          message: `Dangerous style declaration "${drop.property}" removed (${drop.reason})`,
          path: attrPath,
          sourceLocation: loc,
          removed: true,
        });
      }
      return { styles };
    }

    if (value.type === "JSXExpressionContainer" && value.expression.type === "ObjectExpression") {
      const object = value.expression as ObjectExpression;
      const styles: Record<string, string> = {};
      for (const property of object.properties) {
        if (property.type !== "ObjectProperty") continue;
        const key =
          property.key.type === "Identifier" ? property.key.name
          : property.key.type === "StringLiteral" ? property.key.value
          : null;
        if (key === null) continue;
        const propValue = property.value;
        if (propValue.type === "StringLiteral") {
          const lower = propValue.value.toLowerCase();
          if (
            lower.includes("expression(") ||
            lower.includes("javascript:") ||
            lower.includes("vbscript:") ||
            key.toLowerCase() === "behavior" ||
            key.toLowerCase() === "binding"
          ) {
            this.state.findings.push({
              code: FINDING_UNSAFE_URL,
              severity: "warning",
              message: `Dangerous style declaration "${key}" removed`,
              path: attrPath,
              sourceLocation: loc,
              removed: true,
            });
            continue;
          }
          styles[key] = propValue.value;
        } else if (propValue.type === "NumericLiteral") {
          styles[key] = String(propValue.value);
        } else {
          this.state.unsupported.push({
            code: FINDING_DYNAMIC_EXPRESSION,
            message: `Style value for "${key}" is not static`,
            path: attrPath,
            sourceLocation: loc,
          });
        }
      }
      return { styles };
    }

    this.reportDynamicAttribute(jsxAttr, attrPath, loc);
    return null;
  }

  /**
   * Returns the scalar value for a JSX attribute, "unsupported" when the
   * attribute must be dropped, or null for the boolean shorthand.
   */
  private attributeScalar(
    jsxAttr: JSXAttribute,
    attrPath: string,
    loc: ReturnType<typeof locationOf>,
  ): ImportAttributeValue | "unsupported" | null {
    const value = jsxAttr.value;
    if (!value) return null; // <input disabled /> → true

    if (value.type === "StringLiteral") return value.value;

    if (value.type === "JSXExpressionContainer") {
      const expression = value.expression;
      if (expression.type === "StringLiteral") return expression.value;
      if (expression.type === "NumericLiteral") return expression.value;
      if (expression.type === "BooleanLiteral") return expression.value;
      if (expression.type === "NullLiteral") return null;
      if (expression.type === "Identifier") {
        if (expression.name === "undefined") return null;
        const bound = this.bindings.get(expression.name);
        if (bound !== undefined) return bound;
      }
    }

    this.reportDynamicAttribute(jsxAttr, attrPath, loc);
    return "unsupported";
  }

  private reportDynamicAttribute(
    jsxAttr: JSXAttribute,
    attrPath: string,
    loc: ReturnType<typeof locationOf>,
  ): void {
    const value = jsxAttr.value;
    if (value?.type === "JSXExpressionContainer") {
      if (value.expression.type === "JSXEmptyExpression") {
        this.state.unsupported.push({
          code: CODE_UNSUPPORTED_SYNTAX,
          message: "Attribute value cannot be represented statically",
          path: attrPath,
          sourceLocation: loc,
        });
      } else {
        this.state.unsupported.push({
          code: FINDING_DYNAMIC_EXPRESSION,
          message: describeDynamicExpression(value.expression as Expression),
          path: attrPath,
          sourceLocation: loc,
        });
      }
    } else {
      this.state.unsupported.push({
        code: CODE_UNSUPPORTED_SYNTAX,
        message: "Attribute value cannot be represented statically",
        path: attrPath,
        sourceLocation: loc,
      });
    }
  }
}

function flattenMemberName(node: unknown): string {
  const parts: string[] = [];
  let current = node as { type?: string; object?: unknown; property?: { name?: string } };
  while (current && typeof current === "object") {
    if (current.type === "JSXMemberExpression") {
      if (current.property?.name) parts.unshift(current.property.name);
      current = current.object as typeof current;
    } else if (current.type === "JSXIdentifier") {
      const identifier = current as unknown as { name?: string };
      if (identifier.name) parts.unshift(identifier.name);
      break;
    } else {
      break;
    }
  }
  return parts.join(".") || "unknown";
}

/**
 * Normalize a @babel/parser JSX/TSX program into the safe import AST.
 * Enforces limits and the security policy. Deterministic given an injected
 * (or default counter) ID factory.
 */
export function normalizeJsxAst(
  parsed: JsxParseResult,
  options: NormalizeJsxOptions = {},
): CodeImportNormalizationResult {
  return new JsxNormalizer(parsed, options).normalize();
}
