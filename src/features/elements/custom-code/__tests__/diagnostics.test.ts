// ---------------------------------------------------------------------------
// Runtime diagnostics model (Phase P23-H)
//
// The diagnostics are typed, sanitized, bounded, immutable records — fixed
// controller-generated messages, protocol-validated height/error data, and
// never raw payloads or exception objects.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  MAX_DIAGNOSTIC_MESSAGE_LENGTH,
  createRuntimeDiagnostic,
  type RuntimeDiagnostic,
  type RuntimeDiagnosticKind,
} from "../diagnostics";
import { MAX_FRAME_HEIGHT_PX } from "../constants";

const ALL_KINDS: RuntimeDiagnosticKind[] = [
  "ready",
  "height",
  "error",
  "unresponsive",
  "recovery-started",
  "recovery-succeeded",
  "recovery-exhausted",
  "disposed",
];

function makeDiagnostic(
  overrides: Partial<Parameters<typeof createRuntimeDiagnostic>[0]> = {},
): RuntimeDiagnostic {
  return createRuntimeDiagnostic({
    instanceId: 7,
    kind: "ready",
    message: "Frame ready",
    at: 123,
    ...overrides,
  });
}

describe("diagnostic shape", () => {
  it("carries instance identity, kind, bounded message, and a timestamp", () => {
    const diagnostic = makeDiagnostic();
    expect(diagnostic.instanceId).toBe(7);
    expect(diagnostic.kind).toBe("ready");
    expect(diagnostic.message).toBe("Frame ready");
    expect(diagnostic.at).toBe(123);
  });

  it("supports the full set of runtime event kinds", () => {
    for (const kind of ALL_KINDS) {
      const diagnostic = makeDiagnostic({ kind });
      expect(diagnostic.kind).toBe(kind);
    }
  });
});

describe("bounded strings", () => {
  it("caps oversized diagnostic messages", () => {
    const diagnostic = makeDiagnostic({
      message: "x".repeat(MAX_DIAGNOSTIC_MESSAGE_LENGTH + 500),
    });
    expect(diagnostic.message.length).toBe(MAX_DIAGNOSTIC_MESSAGE_LENGTH);
  });

  it("maps non-string messages to an empty string (never raw payloads)", () => {
    const numeric = makeDiagnostic({
      message: 42 as unknown as string,
    });
    expect(numeric.message).toBe("");

    // A hostile payload never reaches the diagnostic message field — the
    // controller only ever supplies fixed strings; this is defense in depth.
    const hostile = makeDiagnostic({
      message: { toString: () => "evil" } as unknown as string,
    });
    expect(hostile.message).toBe("");
  });
});

describe("height diagnostics", () => {
  it("carries the validated height", () => {
    const diagnostic = makeDiagnostic({ kind: "height", height: 500 });
    expect(diagnostic.height).toBe(500);
  });

  it("re-clamps an out-of-range height defensively", () => {
    expect(makeDiagnostic({ kind: "height", height: -50 }).height).toBe(0);
    expect(
      makeDiagnostic({ kind: "height", height: MAX_FRAME_HEIGHT_PX + 999 }).height,
    ).toBe(MAX_FRAME_HEIGHT_PX);
    expect(makeDiagnostic({ kind: "height", height: 500.6 }).height).toBe(501);
  });

  it("omits height for non-height kinds", () => {
    expect(makeDiagnostic({ kind: "ready" }).height).toBeUndefined();
  });
});

describe("error diagnostics", () => {
  it("carries the protocol-sanitized error info", () => {
    const diagnostic = makeDiagnostic({
      kind: "error",
      error: { message: "boom", stack: "at fn (file.js:1:1)" },
    });
    expect(diagnostic.error).toEqual({
      message: "boom",
      stack: "at fn (file.js:1:1)",
    });
  });

  it("shallow-copies the error so callers cannot mutate the diagnostic", () => {
    const error = { message: "boom" };
    const diagnostic = makeDiagnostic({ kind: "error", error });
    error.message = "mutated";
    expect(diagnostic.error?.message).toBe("boom");
  });
});

describe("immutability", () => {
  it("freezes every diagnostic (read-only for observers and snapshots)", () => {
    const diagnostic = makeDiagnostic();
    expect(Object.isFrozen(diagnostic)).toBe(true);
  });

  it("omits optional fields entirely (no empty height/error on unrelated events)", () => {
    const diagnostic = makeDiagnostic({ kind: "disposed" });
    expect(Object.keys(diagnostic).sort()).toEqual([
      "at",
      "instanceId",
      "kind",
      "message",
    ]);
  });
});
