// ---------------------------------------------------------------------------
// HTML AST normalization (Phase P1)
//
// Walks a parse5 tree and produces the safe normalized import AST. This is
// the enforcement boundary for HTML: script/style/iframe/object/embed are
// removed, event handlers and unsafe URLs are stripped, class/className is
// normalized, inline styles are parsed into a string map, and limits are
// enforced with structured errors (no silent structural truncation).
// ---------------------------------------------------------------------------

import type { DefaultTreeAdapterMap } from "parse5";

import {
  CODE_AST_TOO_DEEP,
  CODE_TEXT_TOO_LARGE,
  CODE_TOO_MANY_ATTRIBUTES,
  CODE_TOO_MANY_CLASSES,
  CODE_TOO_MANY_NODES,
  FINDING_DANGEROUS_HTML,
  FINDING_DANGEROUS_KEY,
  FINDING_DATA_URL,
  FINDING_EVENT_HANDLER_REMOVED,
  FINDING_IFRAME_REMOVED,
  FINDING_OBJECT_EMBED_REMOVED,
  FINDING_SCRIPT_REMOVED,
  FINDING_STYLE_REMOVED,
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
  ImportElementNode,
  ImportIdFactory,
  ImportNode,
} from "../types";
import {
  createDefaultIdFactory,
  IMAGE_URL_ATTRIBUTES,
  isBooleanAttribute,
  isEventHandlerAttribute,
  LINK_URL_ATTRIBUTES,
  parseInlineStyle,
  PathBuilder,
  toImportSourceLocation,
} from "./shared";

export interface NormalizeHtmlOptions {
  idFactory?: ImportIdFactory;
}

type ParsedElement = DefaultTreeAdapterMap["element"];
type ParsedText = DefaultTreeAdapterMap["textNode"];

interface NormalizeState {
  idFactory: ImportIdFactory;
  nodeCount: number;
  totalTextLength: number;
  findings: CodeImportSecurityFinding[];
  unsupported: CodeImportUnsupportedFeature[];
  errors: CodeImportNormalizationResult["errors"];
}

function pushError(
  state: NormalizeState,
  code: string,
  message: string,
  opts: { limit?: number; actual?: number; path?: string } = {},
): void {
  state.errors.push({
    code,
    message,
    limit: opts.limit,
    actual: opts.actual,
    path: opts.path,
  });
}

function addTextNode(
  state: NormalizeState,
  raw: string,
  loc: ReturnType<typeof toImportSourceLocation>,
  path: string,
  children: ImportNode[],
): void {
  let value = raw;
  const originalLength = value.length;

  if (originalLength > MAX_TEXT_NODE_LENGTH) {
    pushError(state, CODE_TEXT_TOO_LARGE, `Text node is ${originalLength} characters; the maximum is ${MAX_TEXT_NODE_LENGTH}.`, {
      limit: MAX_TEXT_NODE_LENGTH,
      actual: originalLength,
      path,
    });
    value = value.slice(0, MAX_TEXT_NODE_LENGTH);
  }

  const remainingBudget = MAX_TOTAL_TEXT_LENGTH - state.totalTextLength;
  if (value.length > remainingBudget) {
    pushError(state, CODE_TEXT_TOO_LARGE, `Total text content exceeds the safe cap of ${MAX_TOTAL_TEXT_LENGTH} characters.`, {
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

function walk(
  node: unknown,
  children: ImportNode[],
  depth: number,
  state: NormalizeState,
  paths: PathBuilder,
): void {
  if (depth > MAX_IMPORT_DEPTH) {
    throwFatal(CODE_AST_TOO_DEEP, `Structure is deeper than ${MAX_IMPORT_DEPTH} levels.`, {
      limit: MAX_IMPORT_DEPTH,
      actual: depth,
      path: paths.current(),
    });
  }
  state.nodeCount += 1;
  if (state.nodeCount > MAX_IMPORT_NODES) {
    throwFatal(CODE_TOO_MANY_NODES, `Source expands to more than ${MAX_IMPORT_NODES} nodes.`, {
      limit: MAX_IMPORT_NODES,
      actual: state.nodeCount,
      path: paths.current(),
    });
  }

  if (!node || typeof node !== "object") return;
  const candidate = node as { nodeName?: string; tagName?: string };

  if (candidate.nodeName === "#text") {
    const text = node as ParsedText;
    addTextNode(
      state,
      text.value,
      toImportSourceLocation(text.sourceCodeLocation as never),
      paths.current(),
      children,
    );
    return;
  }

  if (
    candidate.nodeName === "#comment" ||
    candidate.nodeName === "#documentType"
  ) {
    return; // comments & doctypes are ignored
  }

  if (candidate.nodeName === "#document" || candidate.nodeName === "#document-fragment") {
    const container = node as { childNodes?: unknown[] };
    for (const child of container.childNodes ?? []) {
      walk(child, children, depth + 1, state, paths);
    }
    return;
  }

  const element = node as ParsedElement;
  const tagName = element.tagName.toLowerCase();
  const loc = toImportSourceLocation(element.sourceCodeLocation as never);

  if (
    tagName === "script" ||
    tagName === "style" ||
    tagName === "iframe" ||
    tagName === "object" ||
    tagName === "embed"
  ) {
    const code =
      tagName === "script"
        ? FINDING_SCRIPT_REMOVED
        : tagName === "style"
          ? FINDING_STYLE_REMOVED
          : tagName === "iframe"
            ? FINDING_IFRAME_REMOVED
            : FINDING_OBJECT_EMBED_REMOVED;
    state.findings.push({
      code,
      severity: "warning",
      message: `<${tagName}> element removed`,
      path: paths.current(),
      sourceLocation: loc,
      removed: true,
    });
    return; // subtree is dropped with the element
  }

  const elementPath = paths.current() === "root" ? tagName : `${paths.current()} > ${tagName}`;

  // ---- Per-element limits: reject the whole element (never truncate) ----
  if (element.attrs.length > MAX_ATTRIBUTES_PER_ELEMENT) {
    pushError(state, CODE_TOO_MANY_ATTRIBUTES, `Element has ${element.attrs.length} attributes; the maximum is ${MAX_ATTRIBUTES_PER_ELEMENT}.`, {
      limit: MAX_ATTRIBUTES_PER_ELEMENT,
      actual: element.attrs.length,
      path: elementPath,
    });
    return;
  }

  const attributes: Record<string, string | number | boolean | null> = {};
  const classNames: string[] = [];
  let inlineStyles: Record<string, string> = {};
  let classTokens = 0;

  for (const attr of element.attrs) {
    const name = attr.name.toLowerCase();
    const value = attr.value ?? "";

    if (isEventHandlerAttribute(name)) {
      state.findings.push({
        code: FINDING_EVENT_HANDLER_REMOVED,
        severity: "warning",
        message: `Event handler attribute "${name}" removed`,
        path: `${elementPath}[${name}]`,
        sourceLocation: loc,
        removed: true,
      });
      continue;
    }

    if (name === "dangerouslysetinnerhtml") {
      state.findings.push({
        code: FINDING_DANGEROUS_HTML,
        severity: "warning",
        message: `dangerouslySetInnerHTML attribute removed`,
        path: `${elementPath}[${name}]`,
        sourceLocation: loc,
        removed: true,
      });
      continue;
    }

    if (isDangerousKey(name)) {
      state.findings.push({
        code: FINDING_DANGEROUS_KEY,
        severity: "warning",
        message: `Dangerous key "${name}" rejected`,
        path: `${elementPath}[${name}]`,
        sourceLocation: loc,
        removed: true,
      });
      continue;
    }

    if (name === "class" || name === "classname") {
      classTokens += value.split(/\s+/).filter((token) => token.length > 0).length;
      if (classTokens > MAX_CLASS_TOKENS_PER_ELEMENT) {
        pushError(state, CODE_TOO_MANY_CLASSES, `Element has more than ${MAX_CLASS_TOKENS_PER_ELEMENT} class tokens.`, {
          limit: MAX_CLASS_TOKENS_PER_ELEMENT,
          actual: classTokens,
          path: elementPath,
        });
        return; // reject the whole element
      }
      for (const token of value.split(/\s+/)) {
        if (token.length > 0) classNames.push(token);
      }
      continue;
    }

    if (name === "style") {
      const { styles, dropped } = parseInlineStyle(value);
      for (const drop of dropped) {
        state.findings.push({
          code: FINDING_UNSAFE_URL,
          severity: "warning",
          message: `Dangerous style declaration "${drop.property}" removed (${drop.reason})`,
          path: `${elementPath}[style]`,
          sourceLocation: loc,
          removed: true,
        });
      }
      inlineStyles = styles;
      continue;
    }

    // ---- URL policy ----
    if (LINK_URL_ATTRIBUTES.has(name) || IMAGE_URL_ATTRIBUTES.has(name)) {
      const kind = IMAGE_URL_ATTRIBUTES.has(name) ? "image" : "link";
      const reason = unsafeUrlReason(value, kind);
      if (reason !== null) {
        state.findings.push({
          code: FINDING_UNSAFE_URL,
          severity: "warning",
          message: `Unsafe ${kind} URL on "${name}" rejected (${reason})`,
          path: `${elementPath}[${name}]`,
          sourceLocation: loc,
          removed: true,
        });
        if (reason === "data-image-not-enabled") {
          state.findings.push({
            code: FINDING_DATA_URL,
            severity: "info",
            message: `data: URLs for images are not enabled in P1`,
            path: `${elementPath}[${name}]`,
            sourceLocation: loc,
          });
        }
        continue;
      }
    }

    if (isBooleanAttribute(name)) {
      attributes[name] = true;
    } else {
      attributes[name] = value;
    }
  }

  const nodeElement: ImportElementNode = {
    kind: "element",
    id: state.idFactory.next(),
    tagName,
    attributes,
    classNames,
    inlineStyles,
    children: [],
    sourceLocation: loc,
  };

  paths.push(tagName);
  for (const child of element.childNodes ?? []) {
    walk(child, nodeElement.children, depth + 1, state, paths);
  }
  paths.pop();

  children.push(nodeElement);
}

/**
 * Normalize a parse5 HTML tree into the safe import AST. Enforces limits and
 * the security policy. Never mutates the input tree. Deterministic given an
 * injected (or default counter) ID factory.
 */
export function normalizeHtmlAst(
  root: unknown,
  options: NormalizeHtmlOptions = {},
): CodeImportNormalizationResult {
  const state: NormalizeState = {
    idFactory: options.idFactory ?? createDefaultIdFactory(),
    nodeCount: 0,
    totalTextLength: 0,
    findings: [],
    unsupported: [],
    errors: [],
  };

  const rootNodes: ImportNode[] = [];
  walk(root, rootNodes, 0, state, new PathBuilder());

  return {
    rootNodes,
    cssRules: [],
    errors: state.errors,
    securityFindings: state.findings,
    unsupportedFeatures: state.unsupported,
  };
}
