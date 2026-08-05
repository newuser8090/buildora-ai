import { describe, expect, it } from "vitest";

import {
  findDangerousKeys,
  hasDangerousKeys,
  isDangerousKey,
} from "../security/dangerous-key-check";

describe("dangerous-key-check", () => {
  it("rejects __proto__ as an own enumerable key", () => {
    const value = { ["__proto__"]: 1 } as Record<string, unknown>;
    const findings = findDangerousKeys(value);
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe("root.__proto__");
    expect(isDangerousKey("__proto__")).toBe(true);
  });

  it("rejects prototype and constructor keys", () => {
    const value = { prototype: 1, constructor: 2 };
    const findings = findDangerousKeys(value);
    expect(findings.map((f) => f.path).sort()).toEqual([
      "root.constructor",
      "root.prototype",
    ]);
  });

  it("rejects nested dangerous keys with deterministic paths", () => {
    const value = { a: { b: { ["__proto__"]: 1 } } } as Record<string, unknown>;
    const findings = findDangerousKeys(value);
    expect(findings.map((f) => f.path)).toEqual(["root.a.b.__proto__"]);
  });

  it("rejects dangerous keys inside arrays", () => {
    const value = [{ constructor: 1 }];
    const findings = findDangerousKeys(value);
    expect(findings.map((f) => f.path)).toEqual(["root.0.constructor"]);
  });

  it("rejects dangerous keys in parser-produced attribute maps", () => {
    const attributes = { href: "/x", constructor: "evil", ["__proto__"]: "pollute" } as Record<string, unknown>;
    const findings = findDangerousKeys(attributes);
    expect(findings.map((f) => f.path).sort()).toEqual([
      "root.__proto__",
      "root.constructor",
    ]);
  });

  it("does not flag text VALUES containing dangerous words", () => {
    const value = { text: "constructor prototype __proto__ in prose" };
    expect(findDangerousKeys(value)).toHaveLength(0);
  });

  it("does not count inherited properties", () => {
    const value = Object.create({ constructor: 1, prototype: 2 });
    value.own = 3;
    expect(findDangerousKeys(value)).toHaveLength(0);
  });

  it("ignores non-object values", () => {
    expect(findDangerousKeys("constructor")).toHaveLength(0);
    expect(findDangerousKeys(null)).toHaveLength(0);
    expect(findDangerousKeys(undefined)).toHaveLength(0);
    expect(findDangerousKeys(42)).toHaveLength(0);
  });

  it("does not mutate the input", () => {
    const value = { a: { constructor: 1, nested: { ["__proto__"]: 1 } } } as Record<string, unknown>;
    const snapshot = JSON.parse(JSON.stringify(value));
    findDangerousKeys(value);
    expect(JSON.stringify(value)).toBe(JSON.stringify(snapshot));
  });

  it("exposes hasDangerousKeys", () => {
    expect(hasDangerousKeys({ prototype: 1 })).toBe(true);
    expect(hasDangerousKeys({ safe: "x" })).toBe(false);
  });

  it("accepts safe keys", () => {
    expect(isDangerousKey("data-id")).toBe(false);
    expect(isDangerousKey("href")).toBe(false);
  });
});
