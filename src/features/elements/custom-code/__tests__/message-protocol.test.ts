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
