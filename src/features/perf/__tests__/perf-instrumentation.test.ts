// ---------------------------------------------------------------------------
// Performance Instrumentation (Phase P9) — tests
//
// Asserts DETERMINISTIC operation counts only — never wall-clock thresholds.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import {
  recordPerf,
  markPerf,
  measurePerf,
  getPerfMeasurements,
  resetPerf,
  countPerf,
} from "../perf-instrumentation";

describe("perf-instrumentation", () => {
  beforeEach(() => {
    resetPerf();
  });

  it("records a marker with a deterministic count", () => {
    markPerf("preview-open");
    markPerf("preview-open", { count: 1 });
    expect(countPerf("preview-open")).toBe(2);
    expect(getPerfMeasurements()).toHaveLength(2);
  });

  it("measurePerf returns the value and records a duration", () => {
    const value = measurePerf("template-gallery-load", () => 42, { count: 7 });
    expect(value).toBe(42);
    const recorded = getPerfMeasurements().find((m) => m.label === "template-gallery-load");
    expect(recorded).toBeDefined();
    expect(recorded?.count).toBe(7);
    expect(recorded?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("bounded ring buffer evicts oldest entries", () => {
    for (let i = 0; i < 250; i += 1) {
      recordPerf(`label-${i % 3}`, 1);
    }
    // Ring is bounded.
    expect(getPerfMeasurements().length).toBeLessThanOrEqual(200);
    // Newest label survived eviction.
    expect(countPerf("label-2")).toBeGreaterThan(0);
  });

  it("reset clears all measurements", () => {
    markPerf("a");
    resetPerf();
    expect(getPerfMeasurements()).toHaveLength(0);
  });
});
