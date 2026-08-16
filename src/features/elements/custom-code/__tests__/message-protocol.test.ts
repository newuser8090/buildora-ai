// ---------------------------------------------------------------------------
// Runtime message protocol (Phase P23-B)
// The parent accepts exactly buildora:ready and buildora:height, with a
// validated allow-listed shape — no sensitive data may cross the boundary.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { MAX_FRAME_HEIGHT_PX } from "../constants";
import {
  clampFrameHeight,
  isRuntimeMessageSource,
  parseRuntimeMessage,
} from "../message-protocol";

describe("buildora:ready", () => {
  it("accepts the minimal ready message", () => {
    expect(parseRuntimeMessage({ type: "buildora:ready" })).toEqual({
      type: "buildora:ready",
    });
  });

  it("rejects ready with any extra field (no data may cross)", () => {
    expect(parseRuntimeMessage({ type: "buildora:ready", payload: "x" })).toBeNull();
    expect(parseRuntimeMessage({ type: "buildora:ready", token: "abc" })).toBeNull();
    expect(parseRuntimeMessage({ type: "buildora:ready", height: 5 })).toBeNull();
  });
});

describe("buildora:height", () => {
  it("accepts a valid bounded height", () => {
    expect(parseRuntimeMessage({ type: "buildora:height", height: 500 })).toEqual({
      type: "buildora:height",
      height: 500,
    });
  });

  it("normalizes fractional heights to integers", () => {
    expect(heightOf({ type: "buildora:height", height: 500.6 })).toBe(501);
    expect(heightOf({ type: "buildora:height", height: 99.4 })).toBe(99);
  });

  it("clamps negative heights to 0", () => {
    expect(heightOf({ type: "buildora:height", height: -50 })).toBe(0);
  });

  it("clamps huge heights to the cap", () => {
    expect(heightOf({ type: "buildora:height", height: 99_999 })).toBe(MAX_FRAME_HEIGHT_PX);
  });

  it("rejects NaN, Infinity, and non-number heights", () => {
    expect(parseRuntimeMessage({ type: "buildora:height", height: NaN })).toBeNull();
    expect(parseRuntimeMessage({ type: "buildora:height", height: Infinity })).toBeNull();
    expect(parseRuntimeMessage({ type: "buildora:height", height: -Infinity })).toBeNull();
    expect(parseRuntimeMessage({ type: "buildora:height", height: "500" })).toBeNull();
    expect(parseRuntimeMessage({ type: "buildora:height", height: null })).toBeNull();
    expect(parseRuntimeMessage({ type: "buildora:height", height: undefined })).toBeNull();
    expect(parseRuntimeMessage({ type: "buildora:height", height: {} })).toBeNull();
  });

  it("rejects height with any extra field", () => {
    expect(
      parseRuntimeMessage({ type: "buildora:height", height: 5, token: "abc" }),
    ).toBeNull();
    expect(
      parseRuntimeMessage({ type: "buildora:height", height: 5, projectId: "p1" }),
    ).toBeNull();
  });

  it("rejects height with a missing height key", () => {
    expect(parseRuntimeMessage({ type: "buildora:height" })).toBeNull();
  });
});

describe("buildora:error", () => {
  it("accepts a minimal structured error", () => {
    expect(
      parseRuntimeMessage({ type: "buildora:error", error: { message: "boom" } }),
    ).toEqual({ type: "buildora:error", error: { message: "boom" } });
  });

  it("accepts an error with an optional stack", () => {
    expect(
      parseRuntimeMessage({
        type: "buildora:error",
        error: { message: "boom", stack: "at fn (file.js:1:1)" },
      }),
    ).toEqual({
      type: "buildora:error",
      error: { message: "boom", stack: "at fn (file.js:1:1)" },
    });
  });

  it("caps oversized message and stack at the approved limits", () => {
    const message = "m".repeat(1_000);
    const stack = "s".repeat(5_000);
    const parsed = parseRuntimeMessage({ type: "buildora:error", error: { message, stack } });
    expect(parsed).toEqual({
      type: "buildora:error",
      error: { message: "m".repeat(512), stack: "s".repeat(2_048) },
    });
  });

  it("rejects non-object error payloads", () => {
    expect(parseRuntimeMessage({ type: "buildora:error", error: "boom" })).toBeNull();
    expect(parseRuntimeMessage({ type: "buildora:error", error: 42 })).toBeNull();
    expect(parseRuntimeMessage({ type: "buildora:error", error: ["boom"] })).toBeNull();
    expect(parseRuntimeMessage({ type: "buildora:error" })).toBeNull();
  });

  it("rejects malformed error fields", () => {
    expect(parseRuntimeMessage({ type: "buildora:error", error: { message: 42 } })).toBeNull();
    expect(parseRuntimeMessage({ type: "buildora:error", error: { message: "" } })).toBeNull();
    expect(parseRuntimeMessage({ type: "buildora:error", error: { message: "x", stack: 5 } })).toBeNull();
    expect(parseRuntimeMessage({ type: "buildora:error", error: { message: "x", extra: 1 } })).toBeNull();
    expect(parseRuntimeMessage({ type: "buildora:error", error: { stack: "x" } })).toBeNull();
  });

  it("rejects an error message with any extra top-level field", () => {
    expect(
      parseRuntimeMessage({ type: "buildora:error", error: { message: "x" }, token: "abc" }),
    ).toBeNull();
    expect(
      parseRuntimeMessage({ type: "buildora:error", error: { message: "x" }, height: 5 }),
    ).toBeNull();
  });
});

describe("unknown / malformed messages", () => {
  it("rejects unknown message types", () => {
    expect(parseRuntimeMessage({ type: "buildora:evil" })).toBeNull();
    expect(parseRuntimeMessage({ type: "buildora:ping" })).toBeNull();
    expect(parseRuntimeMessage({ type: "buildora:height2", height: 5 })).toBeNull();
  });

  it("rejects non-object payloads", () => {
    expect(parseRuntimeMessage(null)).toBeNull();
    expect(parseRuntimeMessage(undefined)).toBeNull();
    expect(parseRuntimeMessage("buildora:ready")).toBeNull();
    expect(parseRuntimeMessage(42)).toBeNull();
    expect(parseRuntimeMessage(["buildora:ready"])).toBeNull();
    expect(parseRuntimeMessage(true)).toBeNull();
  });
});

describe("clampFrameHeight", () => {
  it("maps non-finite values to 0", () => {
    expect(clampFrameHeight(NaN)).toBe(0);
    expect(clampFrameHeight(Infinity)).toBe(0);
  });

  it("rounds, floors negatives, and caps oversize values", () => {
    expect(clampFrameHeight(10.4)).toBe(10);
    expect(clampFrameHeight(10.5)).toBe(11);
    expect(clampFrameHeight(-1)).toBe(0);
    expect(clampFrameHeight(MAX_FRAME_HEIGHT_PX + 1)).toBe(MAX_FRAME_HEIGHT_PX);
  });
});

/** Extract the height from a parsed height message (narrows the union). */
function heightOf(data: unknown): number | undefined {
  const message = parseRuntimeMessage(data);
  return message?.type === "buildora:height" ? message.height : undefined;
}

describe("source validation", () => {
  it("accepts a message whose source is exactly the frame contentWindow", () => {
    const contentWindow = { self: "frame" };
    expect(isRuntimeMessageSource(contentWindow, contentWindow)).toBe(true);
  });

  it("rejects any other source", () => {
    const contentWindow = { self: "frame" };
    expect(isRuntimeMessageSource({ other: "window" }, contentWindow)).toBe(false);
    expect(isRuntimeMessageSource(null, contentWindow)).toBe(false);
    expect(isRuntimeMessageSource(undefined, contentWindow)).toBe(false);
    expect(isRuntimeMessageSource(contentWindow, null)).toBe(false);
  });
});
