// ---------------------------------------------------------------------------
// Phase P3 — warning grouping
//   - five beginner-facing buckets
//   - friendly explanations for known codes
//   - P1 source locations merged back
//   - de-duplication
//   - safety-critical counts
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { ConversionReportBuilder } from "@/features/code-import/conversion/conversion-report";
import {
  groupWarnings,
  countRemovedAndUnsupported,
  type WarningGrouping,
} from "@/features/code-import/services/warning-grouping";

function buildReport(run: (report: ConversionReportBuilder) => void) {
  const builder = new ConversionReportBuilder();
  run(builder);
  return builder.finalize("html", 10, 1, { container: 1 });
}

function makeAnalysis(findings: unknown[] = []) {
  return {
    language: "html",
    securityFindings: findings,
    unsupportedFeatures: [],
    cssRules: [],
    normalizedAst: { kind: "document", children: [] },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("groupWarnings — bucket mapping", () => {
  it("maps removed-for-safety codes into the removed bucket", () => {
    const report = buildReport((r) => {
      r.replaced("event-handler-removed", "onClick removed", "/button");
      r.replaced("script-removed", "script removed", "/script");
    });
    const grouping = groupWarnings({ report });
    const removed = grouping.groups.find((g) => g.id === "removed");
    expect(removed?.items.length).toBe(2);
    expect(removed?.items[0].friendly).toContain("click action was removed");
  });

  it("maps unsupported constructs into the unsupported bucket", () => {
    const report = buildReport((r) => {
      r.unsupported("hook-usage-unsupported", "useState not converted", "/hero");
      r.unsupported("network-call-unsupported", "fetch omitted", "/hero");
    });
    const grouping = groupWarnings({ report });
    const unsupported = grouping.groups.find((g) => g.id === "unsupported");
    expect(unsupported?.items.length).toBe(2);
    expect(unsupported?.items[0].friendly).toContain("hook");
  });

  it("maps approximations into the approximated bucket", () => {
    const report = buildReport((r) => {
      r.warn("mapping-approximation", "radio → checkbox", "/form/radio");
      r.warn("iframe-placeholder", "iframe placeholder", "/embed");
    });
    const grouping = groupWarnings({ report });
    const approximated = grouping.groups.find((g) => g.id === "approximated");
    expect(approximated?.items.length).toBe(2);
  });

  it("maps asset/link codes into the assets bucket", () => {
    const report = buildReport((r) => {
      r.warn("unsafe-url", "javascript: href removed", "/a");
      r.warn("image-unresolved", "local image not found", "/img");
    });
    const grouping = groupWarnings({ report });
    const assets = grouping.groups.find((g) => g.id === "assets");
    expect(assets?.items.length).toBe(2);
  });

  it("maps unknown codes into the attention bucket with a safe fallback", () => {
    const report = buildReport((r) => {
      r.warn("some-new-code", "a new note", "/x");
    });
    const grouping = groupWarnings({ report });
    const attention = grouping.groups.find((g) => g.id === "attention");
    expect(attention?.items.length).toBe(1);
    expect(attention?.items[0].friendly.length).toBeGreaterThan(0);
  });
});

describe("groupWarnings — quality", () => {
  it("de-duplicates identical entries", () => {
    const report = buildReport((r) => {
      r.warn("unsafe-url", "same message", "/a");
      r.warn("unsafe-url", "same message", "/a");
    });
    const grouping = groupWarnings({ report });
    expect(grouping.total).toBe(1);
  });

  it("counts the total across buckets", () => {
    const report = buildReport((r) => {
      r.replaced("event-handler-removed", "x", "/a");
      r.unsupported("hook-usage-unsupported", "y", "/b");
      r.warn("mapping-approximation", "z", "/c");
    });
    const grouping = groupWarnings({ report });
    expect(grouping.total).toBe(3);
  });

  it("merges P1 source locations back when available", () => {
    const report = buildReport((r) => {
      r.replaced("event-handler-removed", "onClick removed", "/button");
    });
    const analysis = makeAnalysis([
      { code: "event-handler-removed", message: "onClick removed", sourceLocation: { line: 3, column: 5 } },
    ]);
    const grouping = groupWarnings({ report, analysis });
    const item = grouping.groups.find((g) => g.id === "removed")?.items[0];
    expect(item?.sourceLocation).toEqual({ line: 3, column: 5 });
  });

  it("produces empty groups when the report is clean", () => {
    const report = buildReport(() => undefined);
    const grouping = groupWarnings({ report });
    expect(grouping.total).toBe(0);
    expect(grouping.groups.every((g) => g.items.length === 0)).toBe(true);
  });

  it("bucket order is deterministic", () => {
    const report = buildReport((r) => {
      r.warn("unsafe-url", "a", "/1");
      r.replaced("script-removed", "b", "/2");
    });
    const grouping = groupWarnings({ report });
    expect(grouping.groups.map((g) => g.id)).toEqual([
      "removed",
      "unsupported",
      "approximated",
      "assets",
      "attention",
    ]);
  });
});

describe("countRemovedAndUnsupported", () => {
  it("counts the two safety-critical buckets", () => {
    const report = buildReport((r) => {
      r.replaced("event-handler-removed", "a", "/1");
      r.replaced("script-removed", "b", "/2");
      r.unsupported("hook-usage-unsupported", "c", "/3");
      r.warn("mapping-approximation", "d", "/4");
    });
    const grouping: WarningGrouping = groupWarnings({ report });
    expect(countRemovedAndUnsupported(grouping)).toEqual({ removed: 2, unsupported: 1 });
  });
});
