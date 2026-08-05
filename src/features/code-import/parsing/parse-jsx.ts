// ---------------------------------------------------------------------------
// JSX/TSX parsing (Phase P1)
//
// Uses @babel/parser as a PARSER ONLY — no transforms, no plugins that emit
// code, no execution. It understands JSX + TypeScript syntax and reports
// source locations. This module extracts:
//   - top-level JSX expression statements (bare pasted markup)
//   - static React function components (function / const arrow returning JSX)
//   - simple top-level const string/number bindings (statically resolvable)
//
// Nothing is transpiled or executed here. The program AST is handed to the
// normalizer, which enforces the security policy.
// ---------------------------------------------------------------------------

import { parse } from "@babel/parser";
import type {
  ArrowFunctionExpression,
  ExportDefaultDeclaration,
  ExportNamedDeclaration,
  Expression,
  File,
  FunctionExpression,
  JSXElement,
  JSXFragment,
  NumericLiteral,
  StringLiteral,
} from "@babel/types";

import { CODE_PARSE_FAILED } from "../constants";
import { sanitizeParserMessage, throwFatal } from "../errors";

export interface JsxComponentCandidate {
  name: string;
  jsx: JSXElement | JSXFragment;
  parameterCount: number;
  startOffset: number;
  startLine: number;
  startColumn: number;
  endOffset: number;
}

export interface JsxParseResult {
  program: File;
  /** Top-level const string/number bindings, resolved statically. */
  staticBindings: Map<string, string | number>;
  /** Static React function/arrow components found in the file. */
  componentCandidates: JsxComponentCandidate[];
  /** Top-level JSX expression statements (e.g. a bare <div/> paste). */
  expressionRoots: Array<JSXElement | JSXFragment>;
}

function isJsxRoot(expression: Expression): expression is JSXElement | JSXFragment {
  return expression.type === "JSXElement" || expression.type === "JSXFragment";
}

/** The JSX returned by a function/arrow body, or null when not trivially static. */
function jsxFromFunctionBody(body: unknown): JSXElement | JSXFragment | null {
  if (!body || typeof body !== "object") return null;
  const candidate = body as { type?: string; body?: unknown };
  if (candidate.type === "JSXElement" || candidate.type === "JSXFragment") {
    return candidate as JSXElement | JSXFragment;
  }
  if (candidate.type === "BlockStatement") {
    // Any number of leading statements are allowed (they are never executed;
    // hooks/effects inside them are reported by the normalizer's program scan)
    // as long as the LAST statement returns JSX statically.
    const block = candidate as { body?: Array<{ type?: string; argument?: unknown }> };
    if (block.body && block.body.length >= 1) {
      const last = block.body[block.body.length - 1];
      if (
        last.type === "ReturnStatement" &&
        isJsxRoot(last.argument as Expression)
      ) {
        return last.argument as JSXElement | JSXFragment;
      }
    }
  }
  return null;
}

/**
 * Parse JSX/TSX source. Throws a structured CODE_PARSE_FAILED error on
 * syntax errors. Never executes anything.
 */
export function parseJsxSource(source: string): JsxParseResult {
  let program: File;
  try {
    program = parse(source, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
      errorRecovery: false,
    });
  } catch (err) {
    const e = err as {
      message?: string;
      loc?: { line?: number; column?: number };
      pos?: number;
    };
    const loc = e.loc
      ? {
          startLine: e.loc.line ?? 1,
          startColumn: (e.loc.column ?? 0) + 1,
          startOffset: e.pos ?? 0,
        }
      : undefined;
    throwFatal(
      CODE_PARSE_FAILED,
      `Could not parse JSX/TSX source: ${sanitizeParserMessage(e.message ?? "syntax error")}`,
      { sourceLocation: loc },
    );
  }

  const staticBindings = new Map<string, string | number>();
  const componentCandidates: JsxComponentCandidate[] = [];
  const expressionRoots: Array<JSXElement | JSXFragment> = [];

  for (const statement of program.program.body) {
    if (statement.type === "ExpressionStatement") {
      if (isJsxRoot(statement.expression)) {
        expressionRoots.push(statement.expression);
      }
      continue;
    }

    if (statement.type === "VariableDeclaration") {
      for (const declarator of statement.declarations) {
        const id = declarator.id;
        const init = declarator.init;
        if (id.type !== "Identifier" || !init) continue;

        // Static literal binding: const TITLE = "Hi" | const COUNT = 42.
        if (init.type === "StringLiteral" || init.type === "NumericLiteral") {
          staticBindings.set(
            id.name,
            (init as StringLiteral | NumericLiteral).value,
          );
          continue;
        }

        // Component: const Card = () => (…JSX…) | const Card = function() {…}.
        if (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression") {
          const fn = init as ArrowFunctionExpression | FunctionExpression;
          const jsx = jsxFromFunctionBody(fn.body);
          if (jsx && /^[A-Z]/.test(id.name)) {
            componentCandidates.push({
              name: id.name,
              jsx,
              parameterCount: fn.params.length,
              startOffset: (id.start ?? 0),
              startLine: (id.loc?.start?.line ?? 1),
              startColumn: (id.loc?.start?.column ?? 0) + 1,
              endOffset: fn.end ?? 0,
            });
          }
        }
      }
      continue;
    }

    if (statement.type === "FunctionDeclaration") {
      registerFunctionComponent(
        statement.id?.name,
        statement.body,
        statement.params.length,
        statement.start ?? 0,
        statement.loc?.start?.line ?? 1,
        (statement.loc?.start?.column ?? 0) + 1,
        statement.end ?? 0,
      );
      continue;
    }

    // Export forms — the standard way React files expose components:
    //   export default function Hero() {…}
    //   export default () => <div/>
    //   export default <div/> (bare JSX default export)
    //   export function Card() {…}
    //   export const Card = () => <div/>
    if (
      statement.type === "ExportDefaultDeclaration" ||
      statement.type === "ExportNamedDeclaration"
    ) {
      const exportStatement = statement as
        | ExportDefaultDeclaration
        | ExportNamedDeclaration;
      const declaration = exportStatement.declaration;
      if (!declaration) continue;

      // export default <div>…</div>
      if (isJsxRoot(declaration as Expression)) {
        expressionRoots.push(declaration as JSXElement | JSXFragment);
        continue;
      }

      if (declaration.type === "FunctionDeclaration") {
        registerFunctionComponent(
          declaration.id?.name ?? "default",
          declaration.body,
          declaration.params.length,
          declaration.start ?? 0,
          declaration.loc?.start?.line ?? 1,
          (declaration.loc?.start?.column ?? 0) + 1,
          declaration.end ?? 0,
        );
        continue;
      }

      if (
        declaration.type === "ArrowFunctionExpression" ||
        declaration.type === "FunctionExpression"
      ) {
        const fn = declaration as ArrowFunctionExpression | FunctionExpression;
        const jsx = jsxFromFunctionBody(fn.body);
        if (jsx) {
          componentCandidates.push({
            name: "default",
            jsx,
            parameterCount: fn.params.length,
            startOffset: declaration.start ?? 0,
            startLine: declaration.loc?.start?.line ?? 1,
            startColumn: (declaration.loc?.start?.column ?? 0) + 1,
            endOffset: declaration.end ?? 0,
          });
        }
        continue;
      }

      if (declaration.type === "VariableDeclaration") {
        for (const declarator of declaration.declarations) {
          const id = declarator.id;
          const init = declarator.init;
          if (id.type !== "Identifier" || !init) continue;
          if (init.type === "StringLiteral" || init.type === "NumericLiteral") {
            staticBindings.set(id.name, (init as StringLiteral | NumericLiteral).value);
            continue;
          }
          if (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression") {
            const fn = init as ArrowFunctionExpression | FunctionExpression;
            const jsx = jsxFromFunctionBody(fn.body);
            if (jsx && /^[A-Z]/.test(id.name)) {
              componentCandidates.push({
                name: id.name,
                jsx,
                parameterCount: fn.params.length,
                startOffset: id.start ?? 0,
                startLine: id.loc?.start?.line ?? 1,
                startColumn: (id.loc?.start?.column ?? 0) + 1,
                endOffset: fn.end ?? 0,
              });
            }
          }
        }
      }
    }
  }

  /** Register a function component candidate from any declaration form. */
  function registerFunctionComponent(
    name: string | undefined,
    body: unknown,
    parameterCount: number,
    startOffset: number,
    startLine: number,
    startColumn: number,
    endOffset: number,
  ): void {
    if (!name || !/^[A-Z]/.test(name)) return;
    const jsx = jsxFromFunctionBody(body);
    if (!jsx) return;
    componentCandidates.push({
      name,
      jsx,
      parameterCount,
      startOffset,
      startLine,
      startColumn,
      endOffset,
    });
  }

  // Deterministic ordering: source position.
  componentCandidates.sort((a, b) => a.startOffset - b.startOffset);
  expressionRoots.sort(
    (a, b) => (a.start ?? 0) - (b.start ?? 0),
  );

  return { program, staticBindings, componentCandidates, expressionRoots };
}
