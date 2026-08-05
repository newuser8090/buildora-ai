// ---------------------------------------------------------------------------
// Dangerous-key check (Phase P1)
//
// Rejects own enumerable keys named __proto__, prototype or constructor —
// the classic prototype-pollution keys. Walks plain objects, nested objects
// and arrays without mutating anything. Text VALUES containing those words
// are never flagged (only keys are), and inherited properties do not count.
// Paths are deterministic ("root.a.0.b").
// ---------------------------------------------------------------------------

import { FINDING_DANGEROUS_KEY } from "../constants";
import type { CodeImportSecurityFinding } from "../types";

export const DANGEROUS_KEYS = ["__proto__", "prototype", "constructor"] as const;

export type DangerousKey = (typeof DANGEROUS_KEYS)[number];

const DANGEROUS_KEY_SET: ReadonlySet<string> = new Set(DANGEROUS_KEYS);

/** True when `key` is a prototype-pollution key. */
export function isDangerousKey(key: string): boolean {
  return DANGEROUS_KEY_SET.has(key);
}

/**
 * Walk an arbitrary value (object/array/scalar) and return findings for every
 * own enumerable dangerous key. Deterministic order: depth-first, keys in
 * insertion order. Never mutates the input.
 */
export function findDangerousKeys(
  value: unknown,
  path = "root",
  depth = 0,
  findings: CodeImportSecurityFinding[] = [],
): CodeImportSecurityFinding[] {
  if (value === null || value === undefined || typeof value !== "object") {
    return findings;
  }
  // Guard against pathological nesting; structural limits already cap the AST.
  if (depth > 100) return findings;

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      findDangerousKeys(value[i], `${path}.${i}`, depth + 1, findings);
    }
    return findings;
  }

  // Own enumerable string keys only — inherited properties do not count.
  for (const key of Object.keys(value)) {
    const childPath = `${path}.${key}`;
    if (isDangerousKey(key)) {
      findings.push({
        code: FINDING_DANGEROUS_KEY,
        severity: "warning",
        message: `Dangerous key "${key}" rejected at ${childPath}`,
        path: childPath,
      });
    }
    findDangerousKeys(
      (value as Record<string, unknown>)[key],
      childPath,
      depth + 1,
      findings,
    );
  }
  return findings;
}

/** True when the value contains any own enumerable dangerous key. */
export function hasDangerousKeys(value: unknown): boolean {
  return findDangerousKeys(value).length > 0;
}
