// ---------------------------------------------------------------------------
// Style converter tests (Phase P2)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";

import {
  convertElementStyles,
  convertInlineStyleMap,
  convertTailwindClass,
  isTailwindClass,
} from "../style-converter";

describe("convertTailwindClass — layout", () => {
  it("converts flex display with a layout signal", () => {
    expect(convertTailwindClass("flex")).toEqual({
      kind: "style",
      style: { display: "flex" },
      signals: { display: "flex" },
    });
  });

  it("converts flex direction", () => {
    expect(convertTailwindClass("flex-col")).toEqual({
      kind: "style",
      style: { flexDirection: "column" },
      signals: { flexDirection: "column" },
    });
  });

  it("converts grid columns with a columns signal", () => {
    const result = convertTailwindClass("grid-cols-3");
    expect(result?.kind).toBe("style");
    if (result?.kind !== "style") return;
    expect(result.style.gridTemplateColumns).toContain("repeat(3");
    expect(result.signals).toMatchObject({ display: "grid", columns: 3 });
  });

  it("converts gap and exposes a pixel signal", () => {
    const result = convertTailwindClass("gap-4");
    expect(result?.kind).toBe("style");
    if (result?.kind !== "style") return;
    expect(result.style.gap).toBe("1rem");
    expect(result.signals?.gap).toBe(16);
  });

  it("converts alignment utilities", () => {
    expect(convertTailwindClass("items-center")?.kind === "style").toBe(true);
    expect(convertTailwindClass("justify-between")).toMatchObject({
      kind: "style",
      style: { justifyContent: "space-between" },
    });
  });

  it("converts flex-wrap", () => {
    expect(convertTailwindClass("flex-wrap")).toMatchObject({
      kind: "style",
      style: { flexWrap: "wrap" },
      signals: { flexWrap: true },
    });
  });
});

describe("convertTailwindClass — spacing", () => {
  it("converts padding utilities", () => {
    expect(convertTailwindClass("p-4")).toMatchObject({ kind: "style", style: { padding: "1rem" } });
    expect(convertTailwindClass("pt-2")).toMatchObject({ kind: "style", style: { paddingTop: "0.5rem" } });
    expect(convertTailwindClass("px-6")).toMatchObject({
      kind: "style",
      style: { paddingLeft: "1.5rem", paddingRight: "1.5rem" },
    });
    expect(convertTailwindClass("py-3")).toMatchObject({
      kind: "style",
      style: { paddingTop: "0.75rem", paddingBottom: "0.75rem" },
    });
  });

  it("converts margin utilities including negative values", () => {
    expect(convertTailwindClass("mt-8")).toMatchObject({ kind: "style", style: { marginTop: "2rem" } });
    expect(convertTailwindClass("-mt-4")).toMatchObject({ kind: "style", style: { marginTop: "-1rem" } });
  });

  it("converts the full spacing scale deterministically", () => {
    expect(convertTailwindClass("p-0")?.kind === "style").toBe(true);
    expect(convertTailwindClass("p-px")).toMatchObject({ style: { padding: "1px" } });
    expect(convertTailwindClass("p-96")).toMatchObject({ style: { padding: "24rem" } });
  });
});

describe("convertTailwindClass — typography", () => {
  it("converts font sizes with line height", () => {
    expect(convertTailwindClass("text-lg")).toMatchObject({
      kind: "style",
      style: { fontSize: "1.125rem", lineHeight: "1.75rem" },
    });
  });

  it("converts font weights", () => {
    expect(convertTailwindClass("font-bold")).toMatchObject({ style: { fontWeight: 700 } });
    expect(convertTailwindClass("font-semibold")).toMatchObject({ style: { fontWeight: 600 } });
  });

  it("converts text alignment", () => {
    expect(convertTailwindClass("text-center")).toMatchObject({ style: { textAlign: "center" } });
  });

  it("converts decoration, transform and spacing", () => {
    expect(convertTailwindClass("underline")).toMatchObject({ style: { textDecorationLine: "underline" } });
    expect(convertTailwindClass("uppercase")).toMatchObject({ style: { textTransform: "uppercase" } });
    expect(convertTailwindClass("tracking-tight")).toMatchObject({ style: { letterSpacing: "-0.025em" } });
  });
});

describe("convertTailwindClass — colors", () => {
  it("converts text colors", () => {
    expect(convertTailwindClass("text-blue-500")).toMatchObject({ style: { color: "#3b82f6" } });
    expect(convertTailwindClass("text-white")).toMatchObject({ style: { color: "#ffffff" } });
  });

  it("converts background colors", () => {
    expect(convertTailwindClass("bg-gray-100")).toMatchObject({ style: { background: "#f3f4f6" } });
    expect(convertTailwindClass("bg-red-500")).toMatchObject({ style: { background: "#ef4444" } });
  });

  it("converts border colors", () => {
    expect(convertTailwindClass("border-slate-200")).toMatchObject({ style: { borderColor: "#e2e8f0" } });
  });
});

describe("convertTailwindClass — border, radius, shadow", () => {
  it("converts borders", () => {
    expect(convertTailwindClass("border")).toMatchObject({ style: { borderWidth: 1 } });
    expect(convertTailwindClass("border-2")).toMatchObject({ style: { borderWidth: 2 } });
    expect(convertTailwindClass("border-b")).toMatchObject({ style: { borderBottomWidth: 1 } });
  });

  it("converts radius", () => {
    expect(convertTailwindClass("rounded")).toMatchObject({ style: { borderRadius: "0.25rem" } });
    expect(convertTailwindClass("rounded-lg")).toMatchObject({ style: { borderRadius: "0.5rem" } });
    expect(convertTailwindClass("rounded-full")).toMatchObject({ style: { borderRadius: "9999px" } });
    expect(convertTailwindClass("rounded-t-lg")).toMatchObject({
      style: { borderTopLeftRadius: "0.5rem", borderTopRightRadius: "0.5rem" },
    });
  });

  it("converts shadow to the existing shadowDepth token vocabulary", () => {
    expect(convertTailwindClass("shadow-sm")).toMatchObject({ style: { shadowDepth: "small" } });
    expect(convertTailwindClass("shadow-md")).toMatchObject({ style: { shadowDepth: "medium" } });
    expect(convertTailwindClass("shadow-lg")).toMatchObject({ style: { shadowDepth: "large" } });
    expect(convertTailwindClass("shadow-none")).toMatchObject({ style: { shadowDepth: "none" } });
  });
});

describe("convertTailwindClass — responsive & arbitrary", () => {
  it("routes responsive utilities into a breakpoint bucket", () => {
    const result = convertTailwindClass("md:flex-row");
    expect(result?.kind).toBe("responsive");
    if (result?.kind !== "responsive") return;
    expect(result.breakpoint).toBe("md");
    expect(result.style).toEqual({ flexDirection: "row" });
  });

  it("does not let responsive utilities drive the base layout decision", () => {
    const result = convertElementStyles(["md:flex-row"], {});
    expect(result.responsive).toEqual({ md: { flexDirection: "row" } });
    expect(result.signals).toEqual({});
    expect(result.style).toEqual({});
  });

  it("converts arbitrary values", () => {
    expect(convertTailwindClass("p-[20px]")).toMatchObject({ style: { padding: "20px" } });
    expect(convertTailwindClass("w-[200px]")).toMatchObject({ style: { width: "200px" } });
    expect(convertTailwindClass("bg-[#123456]")).toMatchObject({ style: { background: "#123456" } });
    expect(convertTailwindClass("rounded-[10px]")).toMatchObject({ style: { borderRadius: "10px" } });
  });

  it("rejects arbitrary values with unsafe CSS", () => {
    expect(convertTailwindClass("bg-[javascript:alert(1)]")).toBeNull();
    expect(convertTailwindClass("p-[expression(alert(1))]")).toBeNull();
  });
});

describe("convertTailwindClass — misc", () => {
  it("converts opacity, z-index, object-fit and cursor", () => {
    expect(convertTailwindClass("opacity-50")).toMatchObject({ style: { opacity: 0.5 } });
    expect(convertTailwindClass("z-10")).toMatchObject({ style: { zIndex: 10 } });
    expect(convertTailwindClass("object-cover")).toMatchObject({ style: { objectFit: "cover" } });
    expect(convertTailwindClass("cursor-pointer")).toMatchObject({ style: { cursor: "pointer" } });
  });

  it("converts sizing helpers", () => {
    expect(convertTailwindClass("w-full")).toMatchObject({ style: { width: "100%" } });
    expect(convertTailwindClass("w-1/2")).toMatchObject({ style: { width: "50%" } });
    expect(convertTailwindClass("h-16")).toMatchObject({ style: { height: "4rem" } });
    expect(convertTailwindClass("max-w-lg")).toMatchObject({ style: { maxWidth: "32rem" } });
  });

  it("returns null for unknown classes", () => {
    expect(convertTailwindClass("not-a-real-class")).toBeNull();
    expect(convertTailwindClass("hero")).toBeNull();
    expect(convertTailwindClass("animate-bounce")).toBeNull();
  });

  it("isTailwindClass matches the converter", () => {
    expect(isTailwindClass("flex")).toBe(true);
    expect(isTailwindClass("my-fancy-class")).toBe(false);
  });
});

describe("convertInlineStyleMap", () => {
  it("converts kebab-case to camelCase tokens", () => {
    const result = convertInlineStyleMap({
      "background-color": "#fff",
      "margin-top": "1rem",
      "font-size": "16px",
      "flex-direction": "row",
    });
    expect(result.style).toEqual({
      backgroundColor: "#fff",
      marginTop: "1rem",
      fontSize: "16px",
      flexDirection: "row",
    });
    expect(result.dropped).toEqual([]);
  });

  it("drops custom properties and unsafe values", () => {
    const result = convertInlineStyleMap({
      "--theme-color": "#fff",
      "background-image": "url(javascript:alert(1))",
    });
    expect(result.style).toEqual({});
    expect(result.dropped.sort()).toEqual(["--theme-color", "background-image"]);
  });
});

describe("convertElementStyles", () => {
  it("merges classes, responsive overrides and inline styles", () => {
    const result = convertElementStyles(
      ["flex", "p-4", "md:flex-col", "text-center"],
      { "max-width": "1200px" },
    );
    expect(result.style).toMatchObject({
      display: "flex",
      padding: "1rem",
      textAlign: "center",
      maxWidth: "1200px",
    });
    expect(result.responsive).toEqual({ md: { flexDirection: "column" } });
    // md:flex-col only affects the md breakpoint — the base stays flex row.
    expect(result.signals).toMatchObject({ display: "flex" });
    expect(result.convertedClassCount).toBe(4);
    expect(result.tailwindDetected).toBe(true);
  });

  it("derives layout signals from inline styles", () => {
    const result = convertElementStyles([], {
      display: "flex",
      "flex-direction": "row",
      gap: "1rem",
      "align-items": "center",
      "justify-content": "space-between",
    });
    expect(result.signals).toMatchObject({
      display: "flex",
      flexDirection: "row",
      gap: 16,
      alignItems: "center",
      justifyContent: "space-between",
    });
  });

  it("reports unknown classes as referenced classes", () => {
    const result = convertElementStyles(["flex", "custom-thing"], {});
    expect(result.referencedClasses).toEqual(["custom-thing"]);
    expect(result.convertedClassCount).toBe(1);
  });

  it("derives grid columns from inline grid-template-columns", () => {
    const result = convertElementStyles([], {
      display: "grid",
      "grid-template-columns": "repeat(3, minmax(0, 1fr))",
    });
    expect(result.signals).toMatchObject({ display: "grid", columns: 3 });
  });
});
