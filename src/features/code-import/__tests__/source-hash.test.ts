// ---------------------------------------------------------------------------
// Phase P3 — source hash
//   - deterministic (same input → same hash)
//   - distinct inputs → distinct hashes
//   - always 8 lowercase hex chars
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { hashSource } from "@/features/code-import/services/source-hash";

describe("hashSource", () => {
  it("is deterministic for identical input", () => {
    const source = "<div class=\"hero\">Hello</div>";
    expect(hashSource(source)).toBe(hashSource(source));
  });

  it("differs for different input", () => {
    expect(hashSource("<div>A</div>")).not.toBe(hashSource("<div>B</div>"));
  });

  it("always returns 8 lowercase hex characters", () => {
    for (const source of ["", "a", "x".repeat(1000), "Ünïcode 👋"]) {
      const hash = hashSource(source);
      expect(hash).toMatch(/^[0-9a-f]{8}$/);
    }
  });

  it("is sensitive to whitespace", () => {
    expect(hashSource("a b")).not.toBe(hashSource("ab"));
  });

  it("handles empty input without throwing", () => {
    expect(() => hashSource("")).not.toThrow();
  });
});
