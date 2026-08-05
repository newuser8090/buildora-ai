// ---------------------------------------------------------------------------
// Conversion report + error tests (Phase P2)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";

import {
  ConversionReportBuilder,
  createConversionContext,
  foldAnalysisIntoReport,
} from "../conversion-report";
import {
  ConversionFatalError,
  createConversionError,
  createConversionIdFactory,
  throwConversionFatal,
} from "../conversion-errors";
import { analyseImportSource } from "../../analysis/analyse-import-source";

describe("ConversionReportBuilder", () => {
  it("finalizes with deterministic ordering", () => {
    const builder = new ConversionReportBuilder();
    builder.warn("b", "second");
    builder.warn("a", "first");
    builder.unsupported("u", "unsupported thing");
    builder.replaced("r", "runtime omitted");
    builder.ignored("i", "ignored thing");

    const report = builder.finalize("html", 5, 1, { container: 5 });
    expect(report.warnings.map((w) => w.code)).toEqual(["a", "b"]);
    expect(report.unsupportedConstructs).toHaveLength(1);
    expect(report.replacedRuntimeBehavior).toHaveLength(1);
    expect(report.ignoredCode).toHaveLength(1);
    expect(report.detectedFramework).toBe("html");
    expect(report.convertedBlockCount).toBe(5);
    expect(report.rootCount).toBe(1);
    expect(report.blockTypeCounts).toEqual({ container: 5 });
  });

  it("detects react-jsx and css frameworks", () => {
    expect(new ConversionReportBuilder().finalize("jsx", 1, 1, {}).detectedFramework).toBe("react-jsx");
    expect(new ConversionReportBuilder().finalize("css", 0, 0, {}).detectedFramework).toBe("css");
  });

  it("detects tailwind when utilities were converted", () => {
    const builder = new ConversionReportBuilder();
    builder.setTailwindDetected();
    expect(builder.finalize("html", 2, 1, {}).detectedFramework).toBe("tailwind");
  });

  it("computes a bounded, deterministic confidence", () => {
    const builder = new ConversionReportBuilder();
    expect(builder.computeConfidence(0)).toBe(0);
    const clean = new ConversionReportBuilder();
    expect(clean.computeConfidence(10)).toBe(1);
    const noisy = new ConversionReportBuilder();
    noisy.warn("w", "one");
    noisy.unsupported("u", "two");
    noisy.replaced("r", "three");
    noisy.ignored("i", "four");
    const score = noisy.computeConfidence(10);
    expect(score).toBeGreaterThanOrEqual(0.1);
    expect(score).toBeLessThanOrEqual(1);
    // Rounded to 2 decimal places (guard against float drift).
    expect(Math.round(score * 100) / 100).toBe(score);
  });
});

describe("foldAnalysisIntoReport", () => {
  it("buckets P1 findings into replaced / ignored / warnings", () => {
    const analysis = analyseImportSource(
      '<button onclick="x()">Go</button><script>alert(1)</script><div class="a">x</div>',
    );
    const builder = new ConversionReportBuilder();
    foldAnalysisIntoReport(analysis, builder);
    const report = builder.finalize(analysis.detectedLanguage, 1, 1, {});

    expect(report.replacedRuntimeBehavior.some((r) => r.code === "event-handler-removed")).toBe(true);
    expect(report.replacedRuntimeBehavior.some((r) => r.code === "script-removed")).toBe(true);
  });

  it("buckets JSX unsupported features as unsupported constructs", () => {
    const analysis = analyseImportSource(
      "import x from 'y'; export default () => { const [a] = useState(1); return <div><h1>Hi</h1></div>; };",
    );
    const builder = new ConversionReportBuilder();
    foldAnalysisIntoReport(analysis, builder);
    const report = builder.finalize(analysis.detectedLanguage, 2, 1, {});
    expect(report.ignoredCode.some((r) => r.code === "external-import-ignored")).toBe(true);
    expect(report.unsupportedConstructs.some((r) => r.code === "hook-usage-unsupported")).toBe(true);
  });
});

describe("conversion context", () => {
  it("collects CSS class selectors from the analysis", () => {
    // <style> elements are removed in P1 for HTML; pure CSS sources carry rules.
    const analysis = analyseImportSource(
      ".hero { color: red } .card, .other { padding: 1rem }",
    );
    const context = createConversionContext(analysis, createConversionIdFactory());
    expect(context.cssClassSelectors.has("hero")).toBe(true);
    expect(context.cssClassSelectors.has("card")).toBe(true);
    expect(context.cssClassSelectors.has("other")).toBe(true);
  });
});

describe("conversion errors", () => {
  it("creates structured errors", () => {
    const error = createConversionError("NO_CONVERTIBLE_CONTENT", "Nothing to convert.");
    expect(error).toEqual({ code: "NO_CONVERTIBLE_CONTENT", message: "Nothing to convert." });
  });

  it("throws and catches fatal errors", () => {
    let caught: unknown;
    try {
      throwConversionFatal("INVALID_OUTPUT_TREE", "Bad tree.", "detail");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConversionFatalError);
    if (caught instanceof ConversionFatalError) {
      expect(caught.error.code).toBe("INVALID_OUTPUT_TREE");
      expect(caught.error.detail).toBe("detail");
    }
  });

  it("produces deterministic ids from the default factory", () => {
    const factory = createConversionIdFactory("imp");
    expect([factory.next(), factory.next(), factory.next("x")]).toEqual(["imp-1", "imp-2", "x-3"]);
  });
});
