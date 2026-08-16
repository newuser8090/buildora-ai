// ---------------------------------------------------------------------------
// Custom-code runtime constants (Phase P23-B)
// Pins the approved security-sensitive values so they cannot drift.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  HEARTBEAT_DEFAULTS,
  MAX_CUSTOM_CODE_ATTRIBUTES,
  MAX_CUSTOM_CODE_LENGTH,
  MAX_CUSTOM_CODE_TOTAL,
  MAX_FRAME_HEIGHT_PX,
  MAX_RECOVERY_ATTEMPTS,
  MAX_RUNTIME_ERROR_MESSAGE_LENGTH,
  MAX_RUNTIME_ERROR_STACK_LENGTH,
  RUNTIME_MESSAGE_TYPES,
  SANDBOX_CSP,
} from "../constants";

describe("SANDBOX_CSP (approved P23 architecture)", () => {
  it("is exactly the approved policy", () => {
    expect(SANDBOX_CSP).toBe(
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
        "img-src data: https:; font-src data: https:; connect-src 'none'; " +
        "frame-ancestors 'none'; form-action 'none'; base-uri 'none'",
    );
  });

  it("does not grant unsafe-eval or network by default", () => {
    expect(SANDBOX_CSP).not.toContain("unsafe-eval");
    expect(SANDBOX_CSP).toContain("connect-src 'none'");
  });
});

describe("payload caps (re-exported from the element schema)", () => {
  it("keeps the per-field and aggregate limits", () => {
    expect(MAX_CUSTOM_CODE_LENGTH).toBe(20_000);
    expect(MAX_CUSTOM_CODE_TOTAL).toBe(48_000);
    expect(MAX_CUSTOM_CODE_ATTRIBUTES).toBe(16);
  });
});

describe("message protocol constants", () => {
  it("defines exactly the three allowed message types", () => {
    expect(RUNTIME_MESSAGE_TYPES).toEqual({
      ready: "buildora:ready",
      height: "buildora:height",
      error: "buildora:error",
    });
  });

  it("caps frame height at 10,000px", () => {
    expect(MAX_FRAME_HEIGHT_PX).toBe(10_000);
  });

  it("caps sanitized error reports at the approved lengths", () => {
    expect(MAX_RUNTIME_ERROR_MESSAGE_LENGTH).toBe(512);
    expect(MAX_RUNTIME_ERROR_STACK_LENGTH).toBe(2_048);
  });
});

describe("recovery budget (Phase P23-G — bounded retry)", () => {
  it("allows a finite number of recoveries per runtime instance", () => {
    expect(MAX_RECOVERY_ATTEMPTS).toBe(2);
  });
});

describe("heartbeat defaults (bounded, low frequency)", () => {
  it("keeps the approved timing", () => {
    expect(HEARTBEAT_DEFAULTS).toEqual({
      intervalMs: 3_000,
      timeoutMs: 2_000,
      maxMisses: 2,
    });
  });

  it("keeps timeoutMs below intervalMs so a single interval can detect silence", () => {
    expect(HEARTBEAT_DEFAULTS.timeoutMs).toBeLessThan(HEARTBEAT_DEFAULTS.intervalMs);
  });
});
