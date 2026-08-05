import { expect } from "vitest";

import type { ImportIdFactory } from "../types";

/**
 * Deterministic ID factory for tests. Never uses Math.random.
 */
export function makeIdFactory(prefix = "n"): ImportIdFactory {
  let counter = 0;
  return {
    next(requestedPrefix?: string): string {
      counter += 1;
      return `${requestedPrefix ?? prefix}${counter}`;
    },
  };
}

interface FatalErrorLike {
  error?: { code?: string; limit?: number; actual?: number };
}

/**
 * Assert that fn() throws a structured CodeImportFatalError carrying the
 * given code (and optional limit/actual). Uses try/catch instead of vitest's
 * toThrowError predicate to stay robust across module instances.
 */
export function expectFatalError(
  fn: () => unknown,
  code: string,
  opts?: { limit?: number; actual?: number },
): void {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeDefined();
  const fatal = caught as FatalErrorLike | undefined;
  expect(fatal?.error?.code).toBe(code);
  if (opts?.limit !== undefined) {
    expect(fatal?.error?.limit).toBe(opts.limit);
  }
  if (opts?.actual !== undefined) {
    expect(fatal?.error?.actual).toBe(opts.actual);
  }
}

/** Find the first element node with a given tagName (breadth-first). */
export function findElement(
  nodes: ReadonlyArray<{ kind: string; tagName?: string; children?: unknown[] }>,
  tagName: string,
): { kind: string; tagName?: string; children?: unknown[] } | undefined {
  const queue = [...nodes];
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) continue;
    if (node.kind === "element" && node.tagName === tagName) return node;
    if (node.children) queue.push(...(node.children as typeof nodes));
  }
  return undefined;
}
