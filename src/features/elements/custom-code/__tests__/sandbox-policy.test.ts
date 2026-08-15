// ---------------------------------------------------------------------------
// Sandbox policy (Phase P23-B) — the isolation boundary is the iframe
// sandbox attribute; these tests pin the authoritative capability model.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  ALLOWED_SANDBOX_CAPABILITIES,
  FORBIDDEN_SANDBOX_CAPABILITIES,
  SANDBOX_POLICY,
  assertSafeSandboxPolicy,
  buildSandboxPolicy,
} from "../sandbox-policy";

describe("SANDBOX_POLICY (the canonical attribute value)", () => {
  it("is exactly allow-scripts", () => {
    expect(SANDBOX_POLICY).toBe("allow-scripts");
  });

  it("contains allow-scripts", () => {
    expect(SANDBOX_POLICY.split(/\s+/)).toContain("allow-scripts");
  });

  it("contains none of the forbidden capabilities", () => {
    for (const forbidden of FORBIDDEN_SANDBOX_CAPABILITIES) {
      expect(SANDBOX_POLICY.split(/\s+/)).not.toContain(forbidden);
    }
  });

  it("passes its own assertion", () => {
    expect(() => assertSafeSandboxPolicy(SANDBOX_POLICY)).not.toThrow();
  });
});

describe("allowed vs forbidden capability sets", () => {
  it("grants exactly one capability", () => {
    expect(ALLOWED_SANDBOX_CAPABILITIES).toEqual(["allow-scripts"]);
  });

  it("has no overlap between allowed and forbidden", () => {
    const allowed = new Set<string>(ALLOWED_SANDBOX_CAPABILITIES);
    for (const forbidden of FORBIDDEN_SANDBOX_CAPABILITIES) {
      expect(allowed.has(forbidden)).toBe(false);
    }
  });

  it("lists every capability that would break the boundary", () => {
    expect(FORBIDDEN_SANDBOX_CAPABILITIES).toEqual(
      expect.arrayContaining([
        "allow-same-origin",
        "allow-top-navigation",
        "allow-popups",
        "allow-forms",
        "allow-downloads",
        "allow-modals",
      ]),
    );
  });
});

describe("buildSandboxPolicy (the only way to obtain a policy string)", () => {
  it("builds the canonical policy by default", () => {
    expect(buildSandboxPolicy()).toBe("allow-scripts");
  });

  it("deduplicates repeated capabilities", () => {
    expect(buildSandboxPolicy(["allow-scripts", "allow-scripts"])).toBe("allow-scripts");
  });

  it("rejects every forbidden capability", () => {
    for (const forbidden of FORBIDDEN_SANDBOX_CAPABILITIES) {
      expect(() => buildSandboxPolicy([forbidden])).toThrow(/forbidden/i);
      expect(() => buildSandboxPolicy(["allow-scripts", forbidden])).toThrow(/forbidden/i);
    }
  });

  it("rejects unknown capabilities", () => {
    expect(() => buildSandboxPolicy(["allow-scripts", "allow-everything"])).toThrow(/forbidden/i);
  });

  it("rejects a policy without allow-scripts", () => {
    expect(() => buildSandboxPolicy([])).toThrow(/allow-scripts/i);
  });
});

describe("assertSafeSandboxPolicy", () => {
  it("accepts the canonical policy", () => {
    expect(() => assertSafeSandboxPolicy("allow-scripts")).not.toThrow();
  });

  it("rejects any policy containing a forbidden capability", () => {
    for (const forbidden of FORBIDDEN_SANDBOX_CAPABILITIES) {
      expect(() => assertSafeSandboxPolicy(`allow-scripts ${forbidden}`)).toThrow(/forbidden/i);
    }
  });

  it("rejects empty and missing-allow-scripts policies", () => {
    expect(() => assertSafeSandboxPolicy("")).toThrow();
    // A forbidden token is rejected first ("Forbidden…"); a policy without
    // allow-scripts but with no forbidden tokens hits the allow-scripts guard.
    expect(() => assertSafeSandboxPolicy("allow-forms")).toThrow();
    expect(() => assertSafeSandboxPolicy("allow-scripts allow-forms")).toThrow(/forbidden/i);
    expect(() => assertSafeSandboxPolicy("allow-forms allow-scripts")).toThrow();
  });
});
